import { describe, expect, it } from 'vitest';
import { cleanIsbn, isValidIsbn10, isValidIsbn13, isbn10to13, isbn13to10, normalizeIsbn } from './isbn.js';

describe('isbn', () => {
  it('cleans hyphens, spaces and qualifiers', () => {
    expect(cleanIsbn('978-0-13-235088-4')).toBe('9780132350884');
    expect(cleanIsbn('0132350882 (pbk.)')).toBe('0132350882');
    expect(cleanIsbn('0-8044-2957-x')).toBe('080442957X');
  });

  it('validates checksums', () => {
    expect(isValidIsbn13('9780132350884')).toBe(true);
    expect(isValidIsbn13('9780132350885')).toBe(false);
    expect(isValidIsbn10('0132350882')).toBe(true);
    expect(isValidIsbn10('080442957X')).toBe(true);
    expect(isValidIsbn10('0132350883')).toBe(false);
  });

  it('converts between ISBN-10 and ISBN-13', () => {
    expect(isbn10to13('0132350882')).toBe('9780132350884');
    expect(isbn13to10('9780132350884')).toBe('0132350882');
    expect(isbn13to10('9791034304444')).toBeNull();
  });

  it('normalizes either form to both', () => {
    expect(normalizeIsbn('0-13-235088-2')).toEqual({ isbn13: '9780132350884', isbn10: '0132350882' });
    expect(normalizeIsbn('978-0-13-235088-4')).toEqual({ isbn13: '9780132350884', isbn10: '0132350882' });
    expect(normalizeIsbn('12345')).toBeNull();
    expect(normalizeIsbn('')).toBeNull();
  });
});
