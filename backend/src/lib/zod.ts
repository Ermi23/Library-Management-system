import { z } from 'zod';

/** Optional free text: empty strings are stored as null. */
export const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || z.email().safeParse(v).success, 'Enter a valid email address');

export const optionalId = z
  .string()
  .nullish()
  .transform((v) => (v ? v : null));

export const optionalDate = z
  .union([z.coerce.date(), z.literal(''), z.null()])
  .optional()
  .transform((v) => (v instanceof Date ? v : v === undefined ? undefined : null));

export const money = z.coerce.number().min(0).max(1_000_000);

export const idParam = z.object({ id: z.string().min(1) });

export const booleanQuery = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0', ''])])
  .optional()
  .transform((v) => v === true || v === 'true' || v === '1');

/** Treats an empty form value ("") as null before validating (avoids "" being coerced to 0). */
export const emptyToNull = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === '' ? null : v), schema);
