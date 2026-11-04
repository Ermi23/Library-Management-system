import { z } from 'zod';
import { prisma } from './prisma.js';

/** Library-wide policies, stored as one JSON row in Setting(key = "library"). */
export const librarySettingsSchema = z.object({
  libraryName: z.string().trim().min(1).max(200).default('City Library'),
  address: z.string().trim().max(500).default(''),
  phone: z.string().trim().max(50).default(''),
  email: z.string().trim().max(200).default(''),
  currency: z.string().trim().min(1).max(5).default('USD'),
  /** Prefix for generated item barcodes, e.g. "B" -> B0000123. */
  itemBarcodePrefix: z.string().trim().max(5).default('B'),
  /** Days after the due date before overdue fines start. */
  fineGraceDays: z.coerce.number().int().min(0).max(60).default(0),
  /** Patrons owing more than this cannot borrow (librarians can override). */
  maxOutstandingFines: z.coerce.number().min(0).default(10),
  blockOnOverdue: z.boolean().default(true),
  /** "home": returned copies travel back to their owning branch. "float": they stay where returned. */
  returnPolicy: z.enum(['home', 'float']).default('home'),
  allowPatronRenewal: z.boolean().default(true),
  allowOpacHolds: z.boolean().default(true),
  defaultReplacementCost: z.coerce.number().min(0).default(25),
  lostProcessingFee: z.coerce.number().min(0).default(5),
  dueSoonNoticeDays: z.coerce.number().int().min(0).max(14).default(2),
  /** Send overdue notices when an item is this many days late. */
  overdueNoticeDays: z.array(z.coerce.number().int().min(1)).default([1, 7, 14]),
  membershipReminderDays: z.coerce.number().int().min(0).default(30),
});

export type LibrarySettings = z.infer<typeof librarySettingsSchema>;

const KEY = 'library';
const CACHE_MS = 30_000;
let cache: { value: LibrarySettings; at: number } | null = null;

export async function getSettings(): Promise<LibrarySettings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  // Unknown or invalid stored values fall back to defaults instead of breaking circulation.
  const parsed = librarySettingsSchema.safeParse(row?.value ?? {});
  const value = parsed.success ? parsed.data : librarySettingsSchema.parse({});
  cache = { value, at: Date.now() };
  return value;
}

export async function saveSettings(patch: Partial<LibrarySettings>): Promise<LibrarySettings> {
  const current = await getSettings();
  const value = librarySettingsSchema.parse({ ...current, ...patch });
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  cache = { value, at: Date.now() };
  return value;
}
