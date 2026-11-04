const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Loans fall due at the end of the day, so a book due "today" can be returned any time today. */
export function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 0);
  return d;
}

/** Whole calendar days `later` is after `earlier` (0 if same day or before). */
export function daysLate(dueAt: Date, at: Date): number {
  const diff = startOfDay(at).getTime() - startOfDay(dueAt).getTime();
  return Math.max(0, Math.round(diff / DAY_MS));
}
