import { Router } from 'express';
import { NoticeChannel, NoticeStatus, NoticeType, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { audit } from '../../lib/audit.js';
import { paged, paginationSchema, toSkipTake } from '../../lib/pagination.js';
import { requireAdmin, requireStaff } from '../../middleware/auth.js';
import { emailEnabled, flushEmails } from './notices.service.js';
import { lastJobReport, runJobsSafely } from './jobs.js';
import { createNotice } from './notices.service.js';

export const noticesRouter = Router();
noticesRouter.use(requireStaff);

noticesRouter.get('/', async (req, res) => {
  const query = paginationSchema
    .extend({
      type: z.enum(NoticeType).optional(),
      status: z.enum(NoticeStatus).optional(),
      channel: z.enum(NoticeChannel).optional(),
      patronId: z.string().optional(),
    })
    .parse(req.query);
  const where: Prisma.NoticeWhereInput = { type: query.type, status: query.status, channel: query.channel, patronId: query.patronId };
  const [data, total] = await Promise.all([
    prisma.notice.findMany({
      where,
      include: { patron: { select: { id: true, firstName: true, lastName: true, cardNumber: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      ...toSkipTake(query),
    }),
    prisma.notice.count({ where }),
  ]);
  res.json({ ...paged(data, total, query), emailEnabled: emailEnabled(), lastRun: lastJobReport() });
});

/** Send a message to a patron (appears in their account, and by email if configured). */
noticesRouter.post('/', async (req, res) => {
  const input = z
    .object({ patronId: z.string().min(1), subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(5000) })
    .parse(req.body);
  await createNotice(prisma, { ...input, type: 'GENERAL' });
  flushEmails();
  await audit(req.user!.id, 'send', 'Notice', undefined, { patronId: input.patronId, subject: input.subject });
  res.status(201).json({ ok: true });
});

noticesRouter.post('/run-jobs', requireAdmin, async (req, res) => {
  const report = await runJobsSafely();
  await audit(req.user!.id, 'run', 'Jobs', undefined, report ? { ...report, ranAt: report.ranAt.toISOString() } : { skipped: true });
  res.json(report ?? { skipped: true, message: 'Jobs are already running.' });
});
