/**
 * Call numbers: DDC class number followed by a three-letter author mark, e.g. "005.133 KNU".
 * This simplified Cutter scheme is what most school and public libraries print on spine labels.
 */

const LEADING_ARTICLE = /^(the|a|an|le|la|les|el|los|las|der|die|das)\s+/i;

function lettersOnly(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z]/g, '')
    .toUpperCase();
}

/** Surname of a "Surname, Forename" or "Forename Surname" heading. */
export function surnameOf(name: string): string {
  const trimmed = name.trim();
  if (trimmed.includes(',')) return trimmed.split(',')[0];
  const parts = trimmed.split(/\s+/);
  return parts[parts.length - 1] ?? '';
}

export function authorMark(authors: string[], title: string): string {
  const source = authors[0] ? surnameOf(authors[0]) : title.replace(LEADING_ARTICLE, '');
  return lettersOnly(source).slice(0, 3);
}

export function buildCallNumber(b: { ddc?: string | null; authors: string[]; title: string }): string | null {
  const mark = authorMark(b.authors, b.title);
  const ddc = b.ddc?.replace(/\//g, '').trim();
  if (ddc) return mark ? `${ddc} ${mark}` : ddc;
  // Fiction and unclassified material is usually shelved by author mark alone.
  return mark || null;
}

/**
 * Cleans a classification from MARC 082 or user input. Dewey numbers lose the segmentation marks
 * ("813/.54" -> "813.54"); shelf labels used instead of Dewey (e.g. "[Fic]", "E", "B", "REF") are upper-cased.
 */
export function normalizeClassification(raw: string | null | undefined): string | null {
  const value = (raw ?? '').replace(/[[\]/'’]/g, '').trim();
  if (!value) return null;
  return /^\d/.test(value) ? value.replace(/\s+/g, '') : value.toUpperCase();
}

/** A Dewey number (005.133) or a short shelf label (FIC, E, B, REF, YA FIC). */
export const CLASSIFICATION_PATTERN = /^(\d{3}(\.\d+)?|[A-Z][A-Z0-9 ]{0,9})$/;

/** Top-level DDC class (000-900) for a classification number. */
export function ddcClass(ddc: string | null | undefined): string | null {
  const m = ddc?.match(/^(\d)/);
  return m ? `${m[1]}00` : null;
}

export const DDC_CLASSES: Record<string, string> = {
  '000': 'Computer science, information & general works',
  '100': 'Philosophy & psychology',
  '200': 'Religion',
  '300': 'Social sciences',
  '400': 'Language',
  '500': 'Science',
  '600': 'Technology',
  '700': 'Arts & recreation',
  '800': 'Literature',
  '900': 'History & geography',
};
