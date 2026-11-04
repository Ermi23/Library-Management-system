import { Router } from 'express';
import { HoldStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { audit } from '../../lib/audit.js';
import { param } from '../../lib/http.js';
import { workingBranchId } from '../../lib/branch.js';
import { paged, paginationSchema, toSkipTake } from '../../lib/pagination.js';
import { optionalDate, optionalText } from '../../lib/zod.js';
import { requireStaff } from '../../middleware/auth.js';
import { cancelHold, placeHold } from '../circulation/circulation.service.js';

export const holdsRouter = Router();
holdsRouter.use(requireStaff);

const holdInclude = {
  biblio: { select: { id: true, title: true, authors: true } },
  patron: { select: { id: true, firstName: true, lastName: true, cardNumber: true, phone: true, email: true } },
  pickupBranch: { select: { id: true, name: true } },
  item: { select: { id: true, barcode: true, callNumber: true } },
} satisfies Prisma.HoldInclude;

const listSchema = paginationSchema.extend({
  status: z.enum(HoldStatus).optional(),
  active: z.enum(['true', 'false']).optional(),
  pickupBranchId: z.string().optional(),
  patronId: z.string().optional(),
  biblioId: z.string().optional(),
});

holdsRouter.get('/', async (req, res) => {
  const query = listSchema.parse(req.query);
  const where: Prisma.HoldWhereInput = {
    status: query.status ?? (query.active === 'true' ? { in: ['PENDING', 'IN_TRANSIT', 'READY'] } : undefined),
    pickupBranchId: query.pickupBranchId,
    patronId: query.patronId,
    biblioId: query.biblioId,
  };
  const [data, total] = await Promise.all([
    prisma.hold.findMany({ where, include: holdInclude, orderBy: { placedAt: 'asc' }, ...toSkipTake(query) }),
    prisma.hold.count({ where }),
  ]);
  res.json(paged(data, total, query));
});

/**
 * Holds to pull: pending holds where a copy is sitting on a shelf. Staff pull the copy and check it in,
 * which traps it for the patron (hold shelf, or transfer to the pickup branch).
 */
holdsRouter.get('/to-pull', async (req, res) => {
  const { branchId } = z.object({ branchId: z.string().optional() }).parse(req.query);
  const holds = await prisma.hold.findMany({
    where: {
      status: 'PENDING',
      itemId: null,
      biblio: { items: { some: { status: 'AVAILABLE', itemType: { notForLoan: false }, ...(branchId ? { currentBranchId: branchId } : {}) } } },
    },
    include: {
      ...holdInclude,
      biblio: {
        select: {
          id: true,
          title: true,
          authors: true,
          items: {
            where: { status: 'AVAILABLE', itemType: { notForLoan: false }, ...(branchId ? { currentBranchId: branchId } : {}) },
            select: { id: true, barcode: true, callNumber: true, shelfLocation: true, currentBranch: { select: { id: true, name: true } } },
          },
        },
      },
    },
    orderBy: { placedAt: 'asc' },
    take: 200,
  });
  // Only the first hold per title needs a copy pulled for each available copy.
  const perBiblio = new Map<string, number>();
  const result = holds.filter((h) => {
    const used = perBiblio.get(h.biblioId) ?? 0;
    if (used >= h.biblio.items.length) return false;
    perBiblio.set(h.biblioId, used + 1);
    return true;
  });
  res.json(result);
});

/** Hold shelf: copies waiting for pickup at the current branch, flagging those past their pickup date. */
holdsRouter.get('/shelf', async (req, res) => {
  const branchId = (req.query.branchId as string | undefined) ?? (await workingBranchId(req));
  const holds = await prisma.hold.findMany({
    where: { status: 'READY', pickupBranchId: branchId },
    include: holdInclude,
    orderBy: { readyAt: 'asc' },
  });
  const now = new Date();
  res.json(holds.map((h) => ({ ...h, expired: !!h.expiresAt && h.expiresAt < now })));
});

const placeSchema = z.object({
  biblioId: z.string().min(1),
  patronId: z.string().min(1),
  pickupBranchId: z.string().optional(),
  expiresAt: optionalDate,
  notes: optionalText(500),
  override: z.boolean().default(false),
});

holdsRouter.post('/', async (req, res) => {
  const input = placeSchema.parse(req.body);
  const pickupBranchId = input.pickupBranchId || (await workingBranchId(req));
  const result = await placeHold({ ...input, pickupBranchId, actor: 'staff' });
  await audit(req.user!.id, 'place', 'Hold', result.hold.id, { biblioId: input.biblioId, patronId: input.patronId });
  res.status(201).json(result);
});

holdsRouter.post('/:id/cancel', async (req, res) => {
  const result = await cancelHold({ holdId: param(req), byStaff: true });
  await audit(req.user!.id, 'cancel', 'Hold', result.holdId);
  res.json(result);
});

holdsRouter.patch('/:id', async (req, res) => {
  const input = z
    .object({ pickupBranchId: z.string().optional(), expiresAt: optionalDate, notes: optionalText(500) })
    .parse(req.body);
  const hold = await prisma.hold.update({ where: { id: param(req) }, data: input, include: holdInclude });
  await audit(req.user!.id, 'update', 'Hold', hold.id, { fields: Object.keys(input) });
  res.json(hold);
});
