import { Router } from 'express';
import { FineStatus, FineType, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { audit } from '../../lib/audit.js';
import { notFound } from '../../lib/errors.js';
import { param } from '../../lib/http.js';
import { getSettings } from '../../lib/settings.js';
import { paged, paginationSchema, toSkipTake } from '../../lib/pagination.js';
import { money, optionalText } from '../../lib/zod.js';
import { requireStaff } from '../../middleware/auth.js';
import { payFines, waiveFine } from '../circulation/circulation.service.js';
import { createNotice, flushEmails } from '../notices/notices.service.js';

export const finesRouter = Router();
finesRouter.use(requireStaff);

export const PAYMENT_METHODS = ['CASH', 'CARD', 'MOBILE_MONEY', 'BANK_TRANSFER', 'CHEQUE', 'OTHER'] as const;

const listSchema = paginationSchema.extend({
  patronId: z.string().optional(),
  status: z.enum(FineStatus).optional(),
  type: z.enum(FineType).optional(),
});

finesRouter.get('/', async (req, res) => {
  const query = listSchema.parse(req.query);
  const where: Prisma.FineWhereInput = { patronId: query.patronId, status: query.status, type: query.type };
  const [data, total, sums] = await Promise.all([
    prisma.fine.findMany({
      where,
      include: {
        patron: { select: { id: true, firstName: true, lastName: true, cardNumber: true } },
        loan: { select: { id: true, item: { select: { barcode: true, biblio: { select: { title: true } } } } } },
        payments: { select: { id: true, amount: true, method: true, createdAt: true } },
      },
      orderBy: { createdAt: 'desc' },
      ...toSkipTake(query),
    }),
    prisma.fine.count({ where }),
    prisma.fine.aggregate({ where, _sum: { amount: true, outstanding: true } }),
  ]);
  res.json({
    ...paged(data, total, query),
    totals: { amount: Number(sums._sum.amount ?? 0), outstanding: Number(sums._sum.outstanding ?? 0) },
  });
});

const chargeSchema = z.object({
  patronId: z.string().min(1),
  type: z.enum(['MANUAL', 'DAMAGE', 'LOST']).default('MANUAL'),
  amount: money.refine((v) => v > 0, 'Amount must be greater than zero'),
  description: z.string().trim().min(1, 'Describe the charge').max(500),
});

finesRouter.post('/', async (req, res) => {
  const input = chargeSchema.parse(req.body);
  const settings = await getSettings();
  const fine = await prisma.$transaction(async (tx) => {
    const created = await tx.fine.create({ data: { ...input, outstanding: input.amount } });
    await createNotice(tx, {
      patronId: input.patronId,
      type: 'FINE',
      subject: 'New charge on your library account',
      body: `A charge of ${input.amount.toFixed(2)} ${settings.currency} was added to your account: ${input.description}.`,
    });
    return created;
  });
  flushEmails();
  await audit(req.user!.id, 'charge', 'Fine', fine.id, { amount: input.amount, type: input.type });
  res.status(201).json(fine);
});

const paySchema = z.object({
  patronId: z.string().min(1),
  amount: money,
  method: z.enum(PAYMENT_METHODS).default('CASH'),
  fineIds: z.array(z.string()).optional(),
});

finesRouter.post('/pay', async (req, res) => {
  const input = paySchema.parse(req.body);
  const result = await payFines({ ...input, staffId: req.user!.id });
  await audit(req.user!.id, 'payment', 'Fine', undefined, { patronId: input.patronId, amount: input.amount, method: input.method });
  res.json(result);
});

finesRouter.post('/:id/waive', async (req, res) => {
  const { reason } = z.object({ reason: optionalText(300) }).parse(req.body ?? {});
  const fine = await waiveFine({ fineId: param(req), reason: reason ?? 'Waived by staff' });
  await audit(req.user!.id, 'waive', 'Fine', fine.id, { reason });
  res.json(fine);
});

finesRouter.get('/payments', async (req, res) => {
  const query = paginationSchema.extend({ patronId: z.string().optional() }).parse(req.query);
  const where = { patronId: query.patronId };
  const [data, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      include: {
        fine: { select: { id: true, type: true, description: true } },
        patron: { select: { id: true, firstName: true, lastName: true, cardNumber: true } },
        receivedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      ...toSkipTake(query),
    }),
    prisma.payment.count({ where }),
  ]);
  res.json(paged(data, total, query));
});

finesRouter.get('/:id', async (req, res) => {
  const fine = await prisma.fine.findUnique({ where: { id: param(req) }, include: { payments: true, patron: true } });
  if (!fine) throw notFound('Fine not found');
  res.json(fine);
});
