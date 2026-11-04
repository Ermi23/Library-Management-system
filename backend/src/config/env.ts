import 'dotenv/config';
import { z } from 'zod';

const optional = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  SESSION_HOURS: z.coerce.number().positive().default(12),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  // Background jobs: due-soon/overdue notices, hold expiry, membership expiry.
  JOBS_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v !== 'false'),
  JOBS_INTERVAL_MINUTES: z.coerce.number().positive().default(60),
  // Outgoing email. Leave SMTP_HOST empty to keep notices in-app only.
  SMTP_HOST: optional,
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_USER: optional,
  SMTP_PASS: optional,
  SMTP_FROM: z.string().default('Library <no-reply@library.local>'),
  // Book metadata lookups (Library of Congress, Open Library, Google Books).
  LOOKUP_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment variables (check backend/.env):');
  console.error(z.flattenError(parsed.error).fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
