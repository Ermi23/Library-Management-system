import { describe, expect, it } from 'vitest';
import {
  biblioToMarc,
  decodeIso2709,
  encodeIso2709,
  marcToBiblio,
  parseMarcXml,
  toMarcXml,
  trimPunctuation,
  type BiblioFields,
} from './marc.js';

const sample: BiblioFields = {
  title: 'The pragmatic programmer',
  subtitle: 'your journey to mastery',
  authors: ['Thomas, David', 'Hunt, Andrew'],
  isbn13: '9780135957059',
  isbn10: '0135957052',
  publisher: 'Addison-Wesley',
  publicationPlace: 'Boston',
  publicationYear: 2019,
  edition: '20th anniversary edition',
  physicalDescription: 'xxii, 321 pages',
  language: 'eng',
  ddc: '005.1',
  subjects: ['Computer programming', 'Software engineering -- Handbooks, manuals, etc.'],
  series: null,
  summary: 'Classic guide — with “smart quotes” & ünïcödé.',
  notes: null,
};

describe('marc', () => {
  it('round-trips catalog fields through MARC', () => {
    const record = biblioToMarc(sample, [{ barcode: 'B0000001', homeBranchCode: 'MAIN', callNumber: '005.1 THO', itemTypeCode: 'BOOK' }]);
    const { biblio, holdings } = marcToBiblio(record);
    expect(biblio.title).toBe(sample.title);
    expect(biblio.subtitle).toBe(sample.subtitle);
    expect(biblio.authors).toEqual(sample.authors);
    expect(biblio.isbn13).toBe(sample.isbn13);
    expect(biblio.ddc).toBe('005.1');
    expect(biblio.publicationYear).toBe(2019);
    expect(biblio.publisher).toBe('Addison-Wesley');
    expect(biblio.language).toBe('eng');
    expect(biblio.subjects).toEqual(sample.subjects);
    expect(holdings).toEqual([expect.objectContaining({ barcode: 'B0000001', homeBranchCode: 'MAIN', callNumber: '005.1 THO', itemTypeCode: 'BOOK' })]);
  });

  it('sets 245 non-filing indicator for leading articles', () => {
    const f245 = biblioToMarc(sample).fields.find((f) => f.tag === '245');
    expect(f245 && 'ind2' in f245 ? f245.ind2 : null).toBe('4');
  });

  it('encodes and decodes ISO 2709 with UTF-8 byte lengths', () => {
    const records = [biblioToMarc(sample), biblioToMarc({ ...sample, title: 'Second record', isbn13: null, isbn10: null })];
    const buffer = Buffer.concat(records.map(encodeIso2709));
    const decoded = decodeIso2709(buffer);
    expect(decoded).toHaveLength(2);
    expect(marcToBiblio(decoded[0]).biblio.summary).toBe(sample.summary);
    expect(marcToBiblio(decoded[1]).biblio.title).toBe('Second record');
    expect(decoded[0].leader.slice(0, 5)).toBe(String(encodeIso2709(records[0]).length).padStart(5, '0'));
  });

  it('writes and parses MARCXML, including namespaced input', () => {
    const xml = toMarcXml([biblioToMarc(sample)]);
    expect(marcToBiblio(parseMarcXml(xml)[0]).biblio.title).toBe(sample.title);
    const prefixed = xml.replace(/<(\/?)(collection|record|leader|controlfield|datafield|subfield)/g, '<$1marc:$2');
    expect(marcToBiblio(parseMarcXml(prefixed)[0]).biblio.isbn13).toBe(sample.isbn13);
  });

  it('trims ISBD punctuation but keeps initials', () => {
    expect(trimPunctuation('The title /')).toBe('The title');
    expect(trimPunctuation('Boston :')).toBe('Boston');
    expect(trimPunctuation('Smith, J.')).toBe('Smith, J.');
    expect(trimPunctuation('Programming.')).toBe('Programming');
  });
});
