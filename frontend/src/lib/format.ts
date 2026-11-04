import type { ItemStatus } from './types';

const dateFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return dateFmt.format(new Date(value));
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return dateTimeFmt.format(new Date(value));
}

/** "in 3 days", "2 days ago", "today". */
export function relativeDays(value: string | Date): string {
  const day = 86_400_000;
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((start(new Date(value)) - start(new Date())) / day);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  return diff > 0 ? `in ${diff} days` : `${-diff} days ago`;
}

export function formatMoney(value: string | number | null | undefined, currency = 'USD'): string {
  const n = Number(value ?? 0);
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

export const toDateInput = (value: string | Date | null | undefined) => (value ? new Date(value).toISOString().slice(0, 10) : '');

export const fullName = (p: { firstName: string; lastName: string } | null | undefined) => (p ? `${p.firstName} ${p.lastName}` : '—');

export const ITEM_STATUS: Record<ItemStatus, { label: string; tone: 'green' | 'blue' | 'amber' | 'red' | 'gray' | 'purple' }> = {
  AVAILABLE: { label: 'Available', tone: 'green' },
  ON_LOAN: { label: 'On loan', tone: 'blue' },
  ON_HOLD_SHELF: { label: 'On hold shelf', tone: 'purple' },
  IN_TRANSIT: { label: 'In transit', tone: 'amber' },
  IN_PROCESSING: { label: 'In processing', tone: 'gray' },
  LOST: { label: 'Lost', tone: 'red' },
  DAMAGED: { label: 'Damaged', tone: 'amber' },
  MISSING: { label: 'Missing', tone: 'red' },
  WITHDRAWN: { label: 'Withdrawn', tone: 'gray' },
};

/** Common MARC language codes for the language picker. */
export const LANGUAGES: Record<string, string> = {
  eng: 'English',
  amh: 'Amharic',
  ara: 'Arabic',
  chi: 'Chinese',
  fre: 'French',
  ger: 'German',
  hin: 'Hindi',
  ita: 'Italian',
  jpn: 'Japanese',
  kor: 'Korean',
  orm: 'Oromo',
  por: 'Portuguese',
  rus: 'Russian',
  som: 'Somali',
  spa: 'Spanish',
  swa: 'Swahili',
  tir: 'Tigrinya',
  tur: 'Turkish',
  und: 'Undetermined',
};

export const DDC_CLASSES: Record<string, string> = {
  '0': '000 Computer science & general works',
  '1': '100 Philosophy & psychology',
  '2': '200 Religion',
  '3': '300 Social sciences',
  '4': '400 Language',
  '5': '500 Science',
  '6': '600 Technology',
  '7': '700 Arts & recreation',
  '8': '800 Literature',
  '9': '900 History & geography',
};

export function toCsv(rows: Record<string, unknown>[], columns?: { key: string; label: string }[]): string {
  const cols = columns ?? Object.keys(rows[0] ?? {}).map((key) => ({ key, label: key }));
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.map((c) => escape(c.label)).join(','), ...rows.map((r) => cols.map((c) => escape(r[c.key])).join(','))].join('\n');
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[], columns?: { key: string; label: string }[]) {
  const blob = new Blob([`﻿${toCsv(rows, columns)}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
