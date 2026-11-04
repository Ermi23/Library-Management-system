/** Lower-cases, strips accents and collapses whitespace so searches match regardless of diacritics. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

interface SearchableBiblio {
  title: string;
  subtitle?: string | null;
  authors: string[];
  subjects: string[];
  isbn13?: string | null;
  isbn10?: string | null;
  issn?: string | null;
  publisher?: string | null;
  series?: string | null;
  ddc?: string | null;
  publicationYear?: number | null;
}

/** Denormalised search columns stored on Biblio, rebuilt whenever a record is saved. */
export function buildSearchFields(b: SearchableBiblio) {
  const authorsText = normalizeText(b.authors.join(' ; '));
  const subjectsText = normalizeText(b.subjects.join(' ; '));
  const searchText = normalizeText(
    [
      b.title,
      b.subtitle,
      authorsText,
      subjectsText,
      b.isbn13,
      b.isbn10,
      b.issn,
      b.publisher,
      b.series,
      b.ddc,
      b.publicationYear?.toString(),
    ]
      .filter(Boolean)
      .join(' '),
  );
  return { searchText, authorsText, subjectsText };
}

/** Escapes LIKE wildcards in user input. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
