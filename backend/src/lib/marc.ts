/**
 * MARC 21 bibliographic records: conversion to/from catalog fields, ISO 2709 (.mrc) and MARCXML.
 * Holdings use Koha's 952 field so exports can be loaded into Koha and vice versa.
 */
import { normalizeIsbn } from './isbn.js';
import { normalizeClassification } from './callNumber.js';

export interface MarcSubfield {
  code: string;
  value: string;
}
export interface MarcControlField {
  tag: string;
  value: string;
}
export interface MarcDataField {
  tag: string;
  ind1: string;
  ind2: string;
  subfields: MarcSubfield[];
}
export type MarcField = MarcControlField | MarcDataField;
export interface MarcRecord {
  leader: string;
  fields: MarcField[];
}

export const isControlField = (f: MarcField): f is MarcControlField => 'value' in f;

const FIELD_TERMINATOR = '\x1e';
const RECORD_TERMINATOR = '\x1d';
const SUBFIELD_DELIMITER = '\x1f';
const DEFAULT_LEADER = '00000nam a2200000 i 4500';

// ---------------------------------------------------------------------------
// Catalog fields <-> MARC
// ---------------------------------------------------------------------------

export interface BiblioFields {
  title: string;
  subtitle?: string | null;
  authors: string[];
  isbn13?: string | null;
  isbn10?: string | null;
  issn?: string | null;
  publisher?: string | null;
  publicationPlace?: string | null;
  publicationYear?: number | null;
  edition?: string | null;
  physicalDescription?: string | null;
  language?: string | null;
  ddc?: string | null;
  subjects: string[];
  series?: string | null;
  summary?: string | null;
  notes?: string | null;
}

/** Holdings data carried in MARC 952 (Koha convention). */
export interface MarcHolding {
  barcode?: string;
  homeBranchCode?: string;
  currentBranchCode?: string;
  callNumber?: string;
  itemTypeCode?: string;
  shelfLocation?: string;
  price?: string;
  enumeration?: string;
}

/** Tags generated from catalog fields; anything else in an imported record is preserved as-is. */
const MAPPED_TAGS = new Set([
  '001', '005', '008', '020', '022', '082', '100', '245', '250', '260', '264', '300', '490', '500', '520', '650', '700', '952',
]);

function sub(code: string, value: string | null | undefined): MarcSubfield[] {
  return value ? [{ code, value }] : [];
}

function df(tag: string, ind1: string, ind2: string, subfields: MarcSubfield[]): MarcDataField | null {
  return subfields.length ? { tag, ind1, ind2, subfields } : null;
}

function nonFilingChars(title: string): string {
  const m = title.match(/^(the |an |a )/i);
  return m ? String(m[1].length) : '0';
}

function build008(b: BiblioFields, created: Date): string {
  const yymmdd = created.toISOString().slice(2, 10).replace(/-/g, '');
  const year = b.publicationYear ? String(b.publicationYear).padStart(4, '0').slice(0, 4) : 'uuuu';
  const lang = /^[a-z]{3}$/.test(b.language ?? '') ? b.language! : 'und';
  const field = `${yymmdd}s${year}    xx            000 0 ${lang} d`;
  return field.padEnd(40, ' ').slice(0, 40);
}

export function biblioToMarc(
  b: BiblioFields & { id?: string; createdAt?: Date; updatedAt?: Date; marc?: unknown },
  holdings: MarcHolding[] = [],
): MarcRecord {
  const now = b.updatedAt ?? new Date();
  const fields: (MarcField | null)[] = [];

  if (b.id) fields.push({ tag: '001', value: b.id });
  fields.push({ tag: '005', value: `${now.toISOString().replace(/[-:T]/g, '').slice(0, 14)}.0` });
  fields.push({ tag: '008', value: build008(b, b.createdAt ?? now) });
  if (b.isbn13) fields.push(df('020', ' ', ' ', sub('a', b.isbn13)));
  if (b.isbn10) fields.push(df('020', ' ', ' ', sub('a', b.isbn10)));
  if (b.issn) fields.push(df('022', ' ', ' ', sub('a', b.issn)));
  if (b.ddc) fields.push(df('082', '0', '4', [...sub('a', b.ddc), { code: '2', value: '23' }]));
  const [mainAuthor, ...addedAuthors] = b.authors;
  if (mainAuthor) fields.push(df('100', '1', ' ', sub('a', mainAuthor)));

  const titleSubfields: MarcSubfield[] = [{ code: 'a', value: b.subtitle ? `${b.title} :` : b.title }];
  if (b.subtitle) titleSubfields.push({ code: 'b', value: b.subtitle });
  if (b.authors.length) {
    titleSubfields[titleSubfields.length - 1].value += ' /';
    titleSubfields.push({ code: 'c', value: `${b.authors.join(', ')}.` });
  }
  fields.push(df('245', mainAuthor ? '1' : '0', nonFilingChars(b.title), titleSubfields));

  if (b.edition) fields.push(df('250', ' ', ' ', sub('a', b.edition)));
  fields.push(
    df('264', ' ', '1', [
      ...sub('a', b.publicationPlace ? `${b.publicationPlace} :` : null),
      ...sub('b', b.publisher ? `${b.publisher},` : null),
      ...sub('c', b.publicationYear ? String(b.publicationYear) : null),
    ]),
  );
  if (b.physicalDescription) fields.push(df('300', ' ', ' ', sub('a', b.physicalDescription)));
  if (b.series) fields.push(df('490', '0', ' ', sub('a', b.series)));
  if (b.notes) fields.push(df('500', ' ', ' ', sub('a', b.notes)));
  if (b.summary) fields.push(df('520', ' ', ' ', sub('a', b.summary)));
  for (const subject of b.subjects) {
    const [main, ...subdivisions] = subject.split(/\s*--\s*/);
    fields.push(df('650', ' ', '0', [{ code: 'a', value: main }, ...subdivisions.map((s) => ({ code: 'x', value: s }))]));
  }
  for (const author of addedAuthors) fields.push(df('700', '1', ' ', sub('a', author)));

  for (const h of holdings) {
    fields.push(
      df('952', ' ', ' ', [
        ...sub('a', h.homeBranchCode),
        ...sub('b', h.currentBranchCode),
        ...sub('c', h.shelfLocation),
        ...sub('g', h.price),
        ...sub('h', h.enumeration),
        ...sub('o', h.callNumber),
        ...sub('p', h.barcode),
        ...sub('y', h.itemTypeCode),
      ]),
    );
  }

  // Keep fields from an imported record that the catalog form does not edit (e.g. 041, 505, 6XX variants).
  const stored = b.marc as MarcRecord | null | undefined;
  const preserved = stored?.fields?.filter((f) => !MAPPED_TAGS.has(f.tag)) ?? [];

  const all = [...fields.filter((f): f is MarcField => f !== null), ...preserved];
  all.sort((a, z) => a.tag.localeCompare(z.tag));
  return { leader: stored?.leader ?? DEFAULT_LEADER, fields: all };
}

/** Removes ISBD punctuation that MARC places at the end of subfields. */
export function trimPunctuation(value: string): string {
  let v = value.trim().replace(/[\s/:;,=+]+$/, '').trim();
  // Drop a trailing period unless it ends an initial ("Smith, J.") or abbreviation ("Inc.").
  if (v.endsWith('.') && !/(\b[A-Z]|\b(?:Inc|Ltd|Co|Jr|Sr|ed|eds|etc))\.$/.test(v)) v = v.slice(0, -1);
  return v.trim();
}

function subfieldValues(f: MarcDataField, codes: string): string[] {
  return f.subfields.filter((s) => codes.includes(s.code)).map((s) => s.value);
}

function first(record: MarcRecord, tag: string): MarcDataField | undefined {
  return record.fields.find((f): f is MarcDataField => f.tag === tag && !isControlField(f));
}

function all(record: MarcRecord, ...tags: string[]): MarcDataField[] {
  return record.fields.filter((f): f is MarcDataField => tags.includes(f.tag) && !isControlField(f));
}

export function marcToBiblio(record: MarcRecord): { biblio: BiblioFields; holdings: MarcHolding[] } {
  const f245 = first(record, '245');
  const title = trimPunctuation(f245 ? subfieldValues(f245, 'anp').join(' ') : '') || '[Untitled]';
  const subtitle = f245 ? trimPunctuation(subfieldValues(f245, 'b').join(' ')) || null : null;

  const authors = [
    ...all(record, '100', '110', '111').map((f) => trimPunctuation(subfieldValues(f, 'a').join(' '))),
    ...all(record, '700', '710', '711').map((f) => trimPunctuation(subfieldValues(f, 'a').join(' '))),
  ].filter(Boolean);

  let isbn13: string | null = null;
  let isbn10: string | null = null;
  for (const f of all(record, '020')) {
    for (const raw of subfieldValues(f, 'a')) {
      const n = normalizeIsbn(raw);
      if (n && !isbn13) {
        isbn13 = n.isbn13;
        isbn10 = n.isbn10;
      }
    }
  }

  const f022 = first(record, '022');
  const f082 = first(record, '082');
  const pub = all(record, '264').find((f) => f.ind2 === '1') ?? first(record, '260');
  const f008 = record.fields.find((f): f is MarcControlField => f.tag === '008' && isControlField(f));
  const f041 = first(record, '041');
  const pubDate = pub ? subfieldValues(pub, 'c').join(' ') : '';
  const yearMatch = pubDate.match(/\d{4}/) ?? f008?.value.slice(7, 11).match(/^\d{4}$/);
  const lang008 = f008?.value.slice(35, 38);

  const subjects = all(record, '600', '610', '611', '630', '650', '651', '655')
    .map((f) => subfieldValues(f, 'axyzv').map(trimPunctuation).filter(Boolean).join(' -- '))
    .filter(Boolean);

  const join = (f: MarcDataField | undefined, codes: string) => (f ? trimPunctuation(subfieldValues(f, codes).join(' ')) || null : null);

  const biblio: BiblioFields = {
    title,
    subtitle,
    authors: [...new Set(authors)],
    isbn13,
    isbn10,
    issn: f022 ? subfieldValues(f022, 'a')[0] ?? null : null,
    publisher: join(pub, 'b'),
    publicationPlace: join(pub, 'a'),
    publicationYear: yearMatch ? Number(yearMatch[0]) : null,
    edition: join(first(record, '250'), 'ab'),
    physicalDescription: join(first(record, '300'), 'abc'),
    language: (f041 ? subfieldValues(f041, 'a')[0] : null) ?? (lang008 && /^[a-z]{3}$/.test(lang008) ? lang008 : null),
    ddc: f082 ? normalizeClassification(subfieldValues(f082, 'a')[0]) : null,
    subjects: [...new Set(subjects)],
    series: join(first(record, '490') ?? first(record, '830'), 'av'),
    // Summaries are prose: keep their punctuation as written.
    summary: first(record, '520') ? subfieldValues(first(record, '520')!, 'a').join(' ').trim() || null : null,
    notes: all(record, '500').map((f) => subfieldValues(f, 'a').join(' ')).join('\n') || null,
  };

  const holdings: MarcHolding[] = all(record, '952').map((f) => {
    const get = (code: string) => f.subfields.find((s) => s.code === code)?.value?.trim() || undefined;
    return {
      homeBranchCode: get('a'),
      currentBranchCode: get('b'),
      shelfLocation: get('c'),
      price: get('g') ?? get('v'),
      enumeration: get('h'),
      callNumber: get('o'),
      barcode: get('p'),
      itemTypeCode: get('y'),
    };
  });

  return { biblio, holdings };
}

// ---------------------------------------------------------------------------
// ISO 2709 (binary .mrc)
// ---------------------------------------------------------------------------

export function encodeIso2709(record: MarcRecord): Buffer {
  const directory: string[] = [];
  const data: Buffer[] = [];
  let offset = 0;

  for (const field of record.fields) {
    const content = isControlField(field)
      ? field.value
      : field.ind1.padEnd(1, ' ').slice(0, 1) +
        field.ind2.padEnd(1, ' ').slice(0, 1) +
        field.subfields.map((s) => SUBFIELD_DELIMITER + s.code + s.value).join('');
    const bytes = Buffer.from(content + FIELD_TERMINATOR, 'utf8');
    directory.push(field.tag.padStart(3, '0') + String(bytes.length).padStart(4, '0') + String(offset).padStart(5, '0'));
    data.push(bytes);
    offset += bytes.length;
  }

  const directoryBytes = Buffer.from(directory.join('') + FIELD_TERMINATOR, 'ascii');
  const baseAddress = 24 + directoryBytes.length;
  const recordLength = baseAddress + offset + 1;

  const leader = record.leader.padEnd(24, ' ').split('');
  leader.splice(0, 5, ...String(recordLength).padStart(5, '0'));
  leader[9] = 'a'; // UTF-8
  leader[10] = '2';
  leader[11] = '2';
  leader.splice(12, 5, ...String(baseAddress).padStart(5, '0'));
  leader.splice(20, 4, '4', '5', '0', '0');

  return Buffer.concat([Buffer.from(leader.join('').slice(0, 24), 'ascii'), directoryBytes, ...data, Buffer.from(RECORD_TERMINATOR)]);
}

export function decodeIso2709(buffer: Buffer): MarcRecord[] {
  const records: MarcRecord[] = [];
  let start = 0;
  while (start < buffer.length) {
    let end = buffer.indexOf(0x1d, start);
    if (end === -1) end = buffer.length;
    const chunk = buffer.subarray(start, end);
    start = end + 1;
    if (chunk.length < 25) continue;

    const leader = chunk.subarray(0, 24).toString('latin1');
    const baseAddress = Number(leader.slice(12, 17));
    if (!Number.isFinite(baseAddress) || baseAddress <= 24) throw new Error('Invalid MARC record: bad base address');
    const encoding = leader[9] === 'a' ? 'utf8' : 'latin1';
    const directory = chunk.subarray(24, baseAddress - 1).toString('latin1');

    const fields: MarcField[] = [];
    for (let i = 0; i + 12 <= directory.length; i += 12) {
      const tag = directory.slice(i, i + 3);
      const length = Number(directory.slice(i + 3, i + 7));
      const offset = Number(directory.slice(i + 7, i + 12));
      const raw = chunk
        .subarray(baseAddress + offset, baseAddress + offset + length)
        .toString(encoding)
        .replace(/\x1e$/, '');
      if (tag < '010' && /^\d+$/.test(tag)) {
        fields.push({ tag, value: raw });
      } else {
        const [indicators, ...parts] = raw.split(SUBFIELD_DELIMITER);
        fields.push({
          tag,
          ind1: indicators[0] ?? ' ',
          ind2: indicators[1] ?? ' ',
          subfields: parts.filter(Boolean).map((p) => ({ code: p[0], value: p.slice(1) })),
        });
      }
    }
    records.push({ leader, fields });
  }
  return records;
}

// ---------------------------------------------------------------------------
// MARCXML
// ---------------------------------------------------------------------------

const xmlEscape = (s: string) =>
  s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);

// Characters that are illegal in XML 1.0 (MARC data occasionally contains them).
const stripInvalidXml = (s: string) => s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');

export function toMarcXml(records: MarcRecord[]): string {
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<collection xmlns="http://www.loc.gov/MARC21/slim">'];
  for (const r of records) {
    out.push('  <record>', `    <leader>${xmlEscape(r.leader)}</leader>`);
    for (const f of r.fields) {
      if (isControlField(f)) {
        out.push(`    <controlfield tag="${f.tag}">${xmlEscape(stripInvalidXml(f.value))}</controlfield>`);
      } else {
        out.push(`    <datafield tag="${f.tag}" ind1="${xmlEscape(f.ind1)}" ind2="${xmlEscape(f.ind2)}">`);
        for (const s of f.subfields) {
          out.push(`      <subfield code="${xmlEscape(s.code)}">${xmlEscape(stripInvalidXml(s.value))}</subfield>`);
        }
        out.push('    </datafield>');
      }
    }
    out.push('  </record>');
  }
  out.push('</collection>');
  return out.join('\n');
}

function xmlUnescape(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_m, entity: string) => {
    const e = entity.toLowerCase();
    if (e.startsWith('#x')) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith('#')) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e]!;
  });
}

function attr(tag: string, name: string): string {
  return xmlUnescape(tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`))?.[1] ?? tag.match(new RegExp(`${name}\\s*=\\s*'([^']*)'`))?.[1] ?? '');
}

/** Parses MARCXML (with or without a namespace prefix such as `marc:`). */
export function parseMarcXml(xml: string): MarcRecord[] {
  const records: MarcRecord[] = [];
  const recordRe = /<(?:\w+:)?record\b[^>]*>([\s\S]*?)<\/(?:\w+:)?record>/g;
  for (const [, body] of xml.matchAll(recordRe)) {
    const leader = xmlUnescape(body.match(/<(?:\w+:)?leader[^>]*>([\s\S]*?)<\/(?:\w+:)?leader>/)?.[1] ?? DEFAULT_LEADER);
    const fields: MarcField[] = [];
    const fieldRe =
      /<(?:\w+:)?controlfield\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?controlfield>|<(?:\w+:)?datafield\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?datafield>/g;
    for (const m of body.matchAll(fieldRe)) {
      if (m[1] !== undefined) {
        fields.push({ tag: attr(m[1], 'tag'), value: xmlUnescape(m[2]) });
      } else {
        const subfields: MarcSubfield[] = [];
        for (const s of m[4].matchAll(/<(?:\w+:)?subfield\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?subfield>/g)) {
          subfields.push({ code: attr(s[1], 'code'), value: xmlUnescape(s[2]) });
        }
        fields.push({ tag: attr(m[3], 'tag'), ind1: attr(m[3], 'ind1') || ' ', ind2: attr(m[3], 'ind2') || ' ', subfields });
      }
    }
    if (leader.length === 24 || fields.length) records.push({ leader: leader.padEnd(24, ' ').slice(0, 24), fields });
  }
  return records;
}

/** Human-readable MARC view: `245 10 $a Title : $b subtitle`. */
export function marcToText(record: MarcRecord): string {
  const lines = [`LDR    ${record.leader}`];
  for (const f of record.fields) {
    lines.push(
      isControlField(f)
        ? `${f.tag}    ${f.value}`
        : `${f.tag} ${f.ind1.replace(' ', '_')}${f.ind2.replace(' ', '_')} ${f.subfields.map((s) => `$${s.code} ${s.value}`).join(' ')}`,
    );
  }
  return lines.join('\n');
}
