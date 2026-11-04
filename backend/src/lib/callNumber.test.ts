import { describe, expect, it } from 'vitest';
import { authorMark, buildCallNumber, CLASSIFICATION_PATTERN, ddcClass, normalizeClassification } from './callNumber.js';
import { daysLate } from './dates.js';
import { buildSearchFields, normalizeText } from './text.js';

describe('call numbers', () => {
  it('builds DDC + author mark', () => {
    expect(buildCallNumber({ ddc: '005.133', authors: ['Knuth, Donald E.'], title: 'The art of computer programming' })).toBe('005.133 KNU');
    expect(buildCallNumber({ ddc: '823.914', authors: ['Chinua Achebe'], title: 'Things fall apart' })).toBe('823.914 ACH');
  });

  it('falls back to the title without leading articles', () => {
    expect(authorMark([], 'The Hobbit')).toBe('HOB');
    expect(buildCallNumber({ ddc: null, authors: [], title: 'A tale' })).toBe('TAL');
  });

  it('normalizes Dewey numbers and shelf labels', () => {
    expect(normalizeClassification('813/.54')).toBe('813.54');
    expect(normalizeClassification('[Fic]')).toBe('FIC');
    expect(normalizeClassification('  ')).toBeNull();
    for (const ok of ['005.133', '909', 'FIC', 'E', 'YA FIC']) expect(CLASSIFICATION_PATTERN.test(ok)).toBe(true);
    for (const bad of ['5.1', '00a', 'THIS IS TOO LONG']) expect(CLASSIFICATION_PATTERN.test(bad)).toBe(false);
    expect(buildCallNumber({ ddc: 'FIC', authors: ['Collins, Suzanne'], title: 'The hunger games' })).toBe('FIC COL');
  });

  it('finds the DDC main class', () => {
    expect(ddcClass('005.1')).toBe('000');
    expect(ddcClass('823.914')).toBe('800');
    expect(ddcClass(null)).toBeNull();
  });
});

describe('dates', () => {
  it('counts whole calendar days late', () => {
    const due = new Date(2026, 0, 10, 23, 59, 59);
    expect(daysLate(due, new Date(2026, 0, 10, 23, 59, 59))).toBe(0);
    expect(daysLate(due, new Date(2026, 0, 11, 0, 5))).toBe(1);
    expect(daysLate(due, new Date(2026, 0, 20, 12))).toBe(10);
    expect(daysLate(due, new Date(2026, 0, 5))).toBe(0);
  });
});

describe('search text', () => {
  it('normalizes accents and case', () => {
    expect(normalizeText('  Ünïcödé   Café ')).toBe('unicode cafe');
  });

  it('includes authors, subjects and identifiers', () => {
    const fields = buildSearchFields({ title: 'Things Fall Apart', authors: ['Achebe, Chinua'], subjects: ['Igbo (African people) -- Fiction'], isbn13: '9780385474542' });
    expect(fields.searchText).toContain('achebe');
    expect(fields.searchText).toContain('9780385474542');
    expect(fields.subjectsText).toContain('igbo');
  });
});
