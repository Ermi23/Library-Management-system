import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { audit } from '../../lib/audit.js';
import { notFound } from '../../lib/errors.js';
import { param } from '../../lib/http.js';
import { workingBranchId } from '../../lib/branch.js';
import { getSettings } from '../../lib/settings.js';
import { paged, paginationSchema, toSkipTake } from '../../lib/pagination.js';
import { optionalDate } from '../../lib/zod.js';
import { requireStaff } from '../../middleware/auth.js';
import { accruedFine, checkin, checkout, outstandingTotal, patronBlocks, renew } from './circulation.service.js';

export const circulationRouter = Router();
circulationRouter.use(requireStaff);

const loanInclude = {
  item: {
    select: {
      id: true,
      barcode: true,
      callNumber: true,
      itemTypeId: true,
      biblio: { select: { id: true, title: true, authors: true } },
    },
  },
  patron: { select: { id: true, firstName: true, lastName: true, cardNumber: true, email: true, phone: true, patronCategoryId: true } },
  branch: { select: { id: true, name: true } },
} satisfies Prisma.LoanInclude;

/** Find a patron by card number (scanned), or by exact email. */
circulationRouter.get('/patrons/lookup', async (req, res) => {
  const { q } = z.object({ q: z.string().trim().min(1) }).parse(req.query);
  const patron = await prisma.user.findFirst({
    where: { OR: [{ cardNumber: q }, { email: q.toLowerCase() }] },
    select: { id: true },
  });
  if (!patron) throw notFound(`No patron with card number "${q}"`);
  res.json(await patronCirculationSummary(patron.id));
});

circulationRouter.get('/patrons/:id/summary', async (req, res) => {
  res.json(await patronCirculationSummary(param(req)));
});

/** Everything the circulation desk needs about a patron on one screen. */
export async function patronCirculationSummary(patronId: string) {
  const settings = await getSettings();
  const patron = await prisma.user.findUnique({
    where: { id: patronId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      cardNumber: true,
      role: true,
      status: true,
      expiresAt: true,
      notes: true,
      patronCategoryId: true,
      patronCategory: { select: { id: true, name: true } },
      homeBranch: { select: { id: true, name: true } },
    },
  });
  if (!patron) throw notFound('Patron not found');

  const [loans, holds, owed, blocks] = await Promise.all([
    prisma.loan.findMany({ where: { patronId, returnedAt: null }, include: loanInclude, orderBy: { dueAt: 'asc' } }),
    prisma.hold.findMany({
      where: { patronId, status: { in: ['PENDING', 'IN_TRANSIT', 'READY'] } },
      include: {
        biblio: { select: { id: true, title: true } },
        pickupBranch: { select: { id: true, name: true } },
        item: { select: { id: true, barcode: true } },
      },
      orderBy: { placedAt: 'asc' },
    }),
    outstandingTotal(prisma, patronId),
    patronBlocks(prisma, patron, settings),
  ]);

  const now = new Date();
  const loansWithFines = await Promise.all(
    loans.map(async (l) => ({
      ...l,
      overdue: l.dueAt < now,
      accruedFine: l.dueAt < now ? await accruedFine(prisma, l, { patronCategoryId: patron.patronCategoryId, itemTypeId: l.item.itemTypeId }, settings) : 0,
    })),
  );
  return { patron, loans: loansWithFines, holds, outstanding: owed, blocks, currency: settings.currency };
}

const checkoutSchema = z.object({
  patronId: z.string().min(1),
  barcode: z.string().trim().min(1, 'Scan or type an item barcode'),
  override: z.boolean().default(false),
  dueAt: optionalDate,
});

circulationRouter.post('/checkout', async (req, res) => {
  const input = checkoutSchema.parse(req.body);
  const branchId = await workingBranchId(req);
  const result = await checkout({ ...input, branchId, staffId: req.user!.id });
  await audit(req.user!.id, 'checkout', 'Loan', result.loan.id, {
    barcode: input.barcode,
    patronId: input.patronId,
    overrides: result.overridden.map((r) => r.code),
  });
  res.status(201).json(result);
});

circulationRouter.post('/checkin', async (req, res) => {
  const { barcode } = z.object({ barcode: z.string().trim().min(1, 'Scan or type an item barcode') }).parse(req.body);
  const branchId = await workingBranchId(req);
  const result = await checkin({ barcode, branchId, staffId: req.user!.id });
  await audit(req.user!.id, 'checkin', 'Item', result.item.id, { barcode, action: result.route.action, fine: result.fine?.amount.toString() });
  res.json(result);
});

circulationRouter.post('/loans/:id/renew', async (req, res) => {
  const { override } = z.object({ override: z.boolean().default(false) }).parse(req.body ?? {});
  const loan = await renew({ loanId: param(req), actor: 'staff', override });
  await audit(req.user!.id, 'renew', 'Loan', loan.id, { dueAt: loan.dueAt, override });
  res.json(loan);
});

/** Renew by item barcode (renewal desk / scanner). */
circulationRouter.post('/renew', async (req, res) => {
  const { barcode, override } = z.object({ barcode: z.string().trim().min(1), override: z.boolean().default(false) }).parse(req.body);
  const loan = await prisma.loan.findFirst({ where: { returnedAt: null, item: { barcode } }, select: { id: true } });
  if (!loan) throw notFound(`Item "${barcode}" is not checked out.`);
  const renewed = await renew({ loanId: loan.id, actor: 'staff', override });
  await audit(req.user!.id, 'renew', 'Loan', renewed.id, { dueAt: renewed.dueAt, override });
  res.json(renewed);
});

const loansQuerySchema = paginationSchema.extend({
  status: z.enum(['active', 'overdue', 'returned', 'dueToday', 'all']).default('active'),
  patronId: z.string().optional(),
  branchId: z.string().optional(),
  q: z.string().trim().optional(),
});

circulationRouter.get('/loans', async (req, res) => {
  const query = loansQuerySchema.parse(req.query);
  const now = new Date();
  const endToday = new Date(now);
  endToday.setHours(23, 59, 59, 999);
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);

  const where: Prisma.LoanWhereInput = {
    patronId: query.patronId,
    branchId: query.branchId,
    ...(query.status === 'active' && { returnedAt: null }),
    ...(query.status === 'overdue' && { returnedAt: null, dueAt: { lt: now } }),
    ...(query.status === 'returned' && { returnedAt: { not: null } }),
    ...(query.status === 'dueToday' && { returnedAt: null, dueAt: { gte: startToday, lte: endToday } }),
    ...(query.q && {
      OR: [
        { item: { barcode: { contains: query.q, mode: 'insensitive' } } },
        { item: { biblio: { title: { contains: query.q, mode: 'insensitive' } } } },
        { patron: { lastName: { contains: query.q, mode: 'insensitive' } } },
        { patron: { cardNumber: { contains: query.q } } },
      ],
    }),
  };
  const [data, total] = await Promise.all([
    prisma.loan.findMany({
      where,
      include: { ...loanInclude, returnBranch: { select: { name: true } } },
      orderBy: query.status === 'returned' ? { returnedAt: 'desc' } : { dueAt: 'asc' },
      ...toSkipTake(query),
    }),
    prisma.loan.count({ where }),
  ]);
  res.json(paged(data.map((l) => ({ ...l, overdue: !l.returnedAt && l.dueAt < now })), total, query));
});
