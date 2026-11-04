/**
 * Copy cataloging: fetch a record by ISBN from the Library of Congress (full MARC),
 * Open Library and Google Books in parallel, then merge the best data from each.
 */
import { env } from '../../config/env.js';
import { normalizeIsbn } from '../../lib/isbn.js';
import { normalizeClassification } from '../../lib/callNumber.js';
import { marcToBiblio, parseMarcXml, type BiblioFields, type MarcRecord } from '../../lib/marc.js';

export interface LookupResult {
  found: boolean;
  sources: string[];
  biblio: (BiblioFields & { coverUrl?: string | null }) | null;
  marc: MarcRecord | null;
}

/** ISO 639-1 to MARC language codes for the languages lookups return most often. */
const LANG_2_TO_3: Record<string, string> = {
  en: 'eng', fr: 'fre', es: 'spa', de: 'ger', it: 'ita', pt: 'por', ar: 'ara', am: 'amh', zh: 'chi', ja: 'jpn',
  ru: 'rus', hi: 'hin', sw: 'swa', nl: 'dut', ko: 'kor', tr: 'tur', so: 'som', om: 'orm', ti: 'tir', he: 'heb',
};

async function fetchWithTimeout(url: string): Promise<Response> {
  return fetch(url, {
    signal: AbortSignal.timeout(env.LOOKUP_TIMEOUT_MS),
    headers: { 'User-Agent': 'LibraryManagementSystem/1.0 (catalog lookup)' },
  });
}

async function fromLibraryOfCongress(isbn: string): Promise<{ biblio: BiblioFields; marc: MarcRecord } | null> {
  const url = `https://lx2.loc.gov/sru/lcdb?version=1.1&operation=searchRetrieve&query=bath.isbn%3D${isbn}&maximumRecords=1&recordSchema=marcxml`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) return null;
  const [record] = parseMarcXml(await res.text());
  if (!record || !record.fields.some((f) => f.tag === '245')) return null;
  return { biblio: marcToBiblio(record).biblio, marc: record };
}

interface OpenLibraryBook {
  title?: string;
  subtitle?: string;
  authors?: { name: string }[];
  publishers?: { name: string }[];
  publish_places?: { name: string }[];
  publish_date?: string;
  number_of_pages?: number;
  pagination?: string;
  subjects?: { name: string }[];
  classifications?: { dewey_decimal_class?: string[] };
  cover?: { large?: string; medium?: string };
  notes?: string | { value: string };
  identifiers?: { isbn_10?: string[]; isbn_13?: string[] };
}

async function fromOpenLibrary(isbn: string): Promise<Partial<BiblioFields> & { coverUrl?: string | null } | null> {
  const res = await fetchWithTimeout(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
  if (!res.ok) return null;
  const json = (await res.json()) as Record<string, OpenLibraryBook>;
  const book = json[`ISBN:${isbn}`];
  if (!book?.title) return null;
  const year = book.publish_date?.match(/\d{4}/)?.[0];
  return {
    title: book.title,
    subtitle: book.subtitle ?? null,
    authors: book.authors?.map((a) => a.name) ?? [],
    publisher: book.publishers?.[0]?.name ?? null,
    publicationPlace: book.publish_places?.[0]?.name ?? null,
    publicationYear: year ? Number(year) : null,
    physicalDescription: book.number_of_pages ? `${book.number_of_pages} pages` : (book.pagination ?? null),
    subjects: book.subjects?.slice(0, 10).map((s) => s.name) ?? [],
    ddc: normalizeClassification(book.classifications?.dewey_decimal_class?.[0]),
    coverUrl: book.cover?.large ?? book.cover?.medium ?? null,
  };
}

interface GoogleVolume {
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    description?: string;
    pageCount?: number;
    categories?: string[];
    language?: string;
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
  };
}

async function fromGoogleBooks(isbn: string): Promise<Partial<BiblioFields> & { coverUrl?: string | null } | null> {
  const res = await fetchWithTimeout(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
  if (!res.ok) return null;
  const json = (await res.json()) as { items?: GoogleVolume[] };
  const info = json.items?.[0]?.volumeInfo;
  if (!info?.title) return null;
  const year = info.publishedDate?.match(/\d{4}/)?.[0];
  return {
    title: info.title,
    subtitle: info.subtitle ?? null,
    authors: info.authors ?? [],
    publisher: info.publisher ?? null,
    publicationYear: year ? Number(year) : null,
    summary: info.description ?? null,
    physicalDescription: info.pageCount ? `${info.pageCount} pages` : null,
    subjects: info.categories ?? [],
    language: info.language ? (LANG_2_TO_3[info.language] ?? null) : null,
    coverUrl: info.imageLinks?.thumbnail?.replace(/^http:/, 'https:') ?? null,
  };
}

/** Picks the first non-empty value, in source priority order. */
function pick<T>(...values: (T | null | undefined)[]): T | null {
  for (const v of values) {
    if (Array.isArray(v) ? v.length : v !== null && v !== undefined && v !== '') return v as T;
  }
  return null;
}

export async function lookupIsbn(raw: string): Promise<LookupResult> {
  const isbn = normalizeIsbn(raw);
  if (!isbn) return { found: false, sources: [], biblio: null, marc: null };

  const [loc, ol, gb] = await Promise.allSettled([
    fromLibraryOfCongress(isbn.isbn13),
    fromOpenLibrary(isbn.isbn13),
    fromGoogleBooks(isbn.isbn13),
  ]);
  const lc = loc.status === 'fulfilled' ? loc.value : null;
  const open = ol.status === 'fulfilled' ? ol.value : null;
  const google = gb.status === 'fulfilled' ? gb.value : null;

  const sources = [lc && 'Library of Congress', open && 'Open Library', google && 'Google Books'].filter((s): s is string => !!s);
  if (!sources.length) return { found: false, sources, biblio: null, marc: null };

  const l = lc?.biblio;
  const biblio: BiblioFields & { coverUrl?: string | null } = {
    title: pick(l?.title, open?.title, google?.title) ?? '',
    subtitle: pick(l?.subtitle, open?.subtitle, google?.subtitle),
    authors: pick(l?.authors, open?.authors, google?.authors) ?? [],
    isbn13: isbn.isbn13,
    isbn10: isbn.isbn10,
    publisher: pick(l?.publisher, open?.publisher, google?.publisher),
    publicationPlace: pick(l?.publicationPlace, open?.publicationPlace),
    publicationYear: pick(l?.publicationYear, open?.publicationYear, google?.publicationYear),
    edition: pick(l?.edition),
    physicalDescription: pick(l?.physicalDescription, open?.physicalDescription, google?.physicalDescription),
    language: pick(l?.language, google?.language),
    ddc: pick(l?.ddc, open?.ddc),
    subjects: pick(l?.subjects, open?.subjects, google?.subjects) ?? [],
    series: pick(l?.series),
    summary: pick(l?.summary, google?.summary),
    notes: null,
    coverUrl: pick(open?.coverUrl, google?.coverUrl),
  };
  return { found: true, sources, biblio, marc: lc?.marc ?? null };
}
