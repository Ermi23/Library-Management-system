import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { audit } from '../../lib/audit.js';
import { notFound } from '../../lib/errors.js';
import { param } from '../../lib/http.js';
import { addMonths } from '../../lib/dates.js';
import { paged, paginationSchema, toSkipTake } from '../../lib/pagination.js';
import { requireStaff } from '../../middleware/auth.js';
import { patronCirculationSummary } from '../circulation/circulation.routes.js';

export const patronsRouter = Router();
patronsRouter.use(requireStaff);

patronsRouter.get('/:id', async (req, res) => {
  const id = param(req);
  const [summary, profile, totalLoans] = await Promise.all([
    patronCirculationSummary(id),
    prisma.user.findUnique({
      where: { id },
      select: { address: true, dateOfBirth: true, createdAt: true, lastLoginAt: true },
    }),
    prisma.loan.count({ where: { patronId: id } }),
  ]);
  res.json({ ...summary, patron: { ...summary.patron, ...profile }, totalLoans });
});

patronsRouter.get('/:id/history', async (req, res) => {
  const query = paginationSchema.parse(req.query);
  const where = { patronId: param(req), returnedAt: { not: null } };
  const [data, total] = await Promise.all([
    prisma.loan.findMany({
      where,
      include: {
        item: { select: { barcode: true, biblio: { select: { id: true, title: true, authors: true } } } },
        fines: { select: { amount: true, type: true, status: true } },
      },
      orderBy: { returnedAt: 'desc' },
      ...toSkipTake(query),
    }),
    prisma.loan.count({ where }),
  ]);
  res.json(paged(data, total, query));
});

patronsRouter.get('/:id/notices', async (req, res) => {
  const query = paginationSchema.parse(req.query);
  const where = { patronId: param(req) };
  const [data, total] = await Promise.all([
    prisma.notice.findMany({ where, orderBy: { createdAt: 'desc' }, ...toSkipTake(query) }),
    prisma.notice.count({ where }),
  ]);
  res.json(paged(data, total, query));
});

/** Extends membership by the patron category's enrolment period (from today or the current expiry, whichever is later). */
patronsRouter.post('/:id/renew-membership', async (req, res) => {
  const { months } = z.object({ months: z.coerce.number().int().min(1).max(120).optional() }).parse(req.body ?? {});
  const patron = await prisma.user.findUnique({ where: { id: param(req) }, include: { patronCategory: true } });
  if (!patron) throw notFound('Patron not found');
  const from = patron.expiresAt && patron.expiresAt > new Date() ? patron.expiresAt : new Date();
  const expiresAt = addMonths(from, months ?? patron.patronCategory?.enrolmentPeriodMonths ?? 12);
  const updated = await prisma.user.update({
    where: { id: patron.id },
    data: { expiresAt, status: patron.status === 'EXPIRED' ? 'ACTIVE' : patron.status },
    select: { id: true, expiresAt: true, status: true },
  });
  await audit(req.user!.id, 'renew-membership', 'User', patron.id, { expiresAt });
  res.json(updated);
});
