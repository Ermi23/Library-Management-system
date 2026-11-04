/** ISBN-10 / ISBN-13 validation and conversion. */

/** Strips hyphens, spaces and qualifiers such as "(pbk.)". */
export function cleanIsbn(raw: string): string {
  // Try the 13-digit form first, otherwise the 10-digit pattern matches the start of an ISBN-13.
  const match = raw.toUpperCase().replace(/[\s-]/g, '').match(/\d{13}|\d{9}[\dX]/);
  return match ? match[0] : raw.toUpperCase().replace(/[^0-9X]/g, '');
}

export function isValidIsbn10(isbn: string): boolean {
  if (!/^\d{9}[\dX]$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const digit = isbn[i] === 'X' ? 10 : Number(isbn[i]);
    sum += digit * (10 - i);
  }
  return sum % 11 === 0;
}

export function isValidIsbn13(isbn: string): boolean {
  if (!/^\d{13}$/.test(isbn)) return false;
  return isbn13CheckDigit(isbn.slice(0, 12)) === isbn[12];
}

function isbn13CheckDigit(first12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}

function isbn10CheckDigit(first9: string): string {
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(first9[i]) * (10 - i);
  const check = (11 - (sum % 11)) % 11;
  return check === 10 ? 'X' : String(check);
}

export function isbn10to13(isbn10: string): string {
  const first12 = `978${isbn10.slice(0, 9)}`;
  return first12 + isbn13CheckDigit(first12);
}

/** Only 978-prefixed ISBN-13s have an ISBN-10 equivalent. */
export function isbn13to10(isbn13: string): string | null {
  if (!isbn13.startsWith('978')) return null;
  const first9 = isbn13.slice(3, 12);
  return first9 + isbn10CheckDigit(first9);
}

/** Returns both forms for a valid ISBN, or null if the input is not a valid ISBN. */
export function normalizeIsbn(raw: string | null | undefined): { isbn13: string; isbn10: string | null } | null {
  if (!raw) return null;
  const isbn = cleanIsbn(raw);
  if (isValidIsbn13(isbn)) return { isbn13: isbn, isbn10: isbn13to10(isbn) };
  if (isValidIsbn10(isbn)) return { isbn13: isbn10to13(isbn), isbn10: isbn };
  return null;
}
