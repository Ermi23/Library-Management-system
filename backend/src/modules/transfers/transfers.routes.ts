import { Router } from 'express';
import { Prisma, TransferStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { param } from '../../lib/http.js';
import { workingBranchId } from '../../lib/branch.js';
import { paged, paginationSchema, toSkipTake } from '../../lib/pagination.js';
import { optionalText } from '../../lib/zod.js';
import { requireStaff } from '../../middleware/auth.js';
import { checkin } from '../circulation/circulation.service.js';

export const transfersRouter = Router();
transfersRouter.use(requireStaff);

const transferInclude = {
  item: { select: { id: true, barcode: true, callNumber: true, status: true, biblio: { select: { id: true, title: true } } } },
  fromBranch: { select: { id: true, name: true } },
  toBranch: { select: { id: true, name: true } },
} satisfies Prisma.TransferInclude;

const listSchema = paginationSchema.extend({
  status: z.enum(TransferStatus).optional(),
  direction: z.enum(['incoming', 'outgoing', 'all']).default('all'),
});

transfersRouter.get('/', async (req, res) => {
  const query = listSchema.parse(req.query);
  const branchId = await workingBranchId(req);
  const where: Prisma.TransferWhereInput = {
    status: query.status,
    ...(query.direction === 'incoming' && { toBranchId: branchId }),
    ...(query.direction === 'outgoing' && { fromBranchId: branchId }),
  };
  const [data, total] = await Promise.all([
    prisma.transfer.findMany({ where, include: transferInclude, orderBy: { sentAt: 'desc' }, ...toSkipTake(query) }),
    prisma.transfer.count({ where }),
  ]);
  res.json(paged(data, total, query));
});

const createSchema = z.object({
  barcode: z.string().trim().min(1),
  toBranchId: z.string().min(1),
  reason: optionalText(200),
});

/** Send a copy that is on the shelf to another branch. */
transfersRouter.post('/', async (req, res) => {
  const input = createSchema.parse(req.body);
  const fromBranchId = await workingBranchId(req);
  const transfer = await prisma.$transaction(async (tx) => {
    const item = await tx.item.findUnique({ where: { barcode: input.barcode } });
    if (!item) throw notFound(`No item with barcode "${input.barcode}"`);
    if (item.status !== 'AVAILABLE') throw conflict(`Only copies on the shelf can be transferred (this one is ${item.status.toLowerCase().replace(/_/g, ' ')}).`);
    if (item.currentBranchId === input.toBranchId) throw badRequest('The item is already at that branch.');
    await tx.item.update({ where: { id: item.id }, data: { status: 'IN_TRANSIT' } });
    return tx.transfer.create({
      data: { itemId: item.id, fromBranchId: item.currentBranchId ?? fromBranchId, toBranchId: input.toBranchId, reason: input.reason ?? 'MANUAL' },
      include: transferInclude,
    });
  });
  await audit(req.user!.id, 'send', 'Transfer', transfer.id, { barcode: input.barcode, to: transfer.toBranch.name });
  res.status(201).json(transfer);
});

/** Receiving is a checkin at the destination, which also traps holds waiting for the copy. */
transfersRouter.post('/:id/receive', async (req, res) => {
  const transfer = await prisma.transfer.findUnique({ where: { id: param(req) }, include: { item: true } });
  if (!transfer) throw notFound('Transfer not found');
  if (transfer.status !== 'IN_TRANSIT') throw conflict('This transfer is not in transit.');
  const result = await checkin({ barcode: transfer.item.barcode, branchId: transfer.toBranchId, staffId: req.user!.id });
  await audit(req.user!.id, 'receive', 'Transfer', transfer.id);
  res.json(result);
});

transfersRouter.post('/:id/cancel', async (req, res) => {
  const result = await prisma.$transaction(async (tx) => {
    const transfer = await tx.transfer.findUnique({ where: { id: param(req) } });
    if (!transfer) throw notFound('Transfer not found');
    if (transfer.status !== 'IN_TRANSIT') throw conflict('This transfer is not in transit.');
    const holdWaiting = await tx.hold.findFirst({ where: { itemId: transfer.itemId, status: 'IN_TRANSIT' } });
    if (holdWaiting) await tx.hold.update({ where: { id: holdWaiting.id }, data: { status: 'PENDING', itemId: null } });
    await tx.item.update({ where: { id: transfer.itemId }, data: { status: 'AVAILABLE', currentBranchId: transfer.fromBranchId } });
    return tx.transfer.update({ where: { id: transfer.id }, data: { status: 'CANCELLED' }, include: transferInclude });
  });
  await audit(req.user!.id, 'cancel', 'Transfer', result.id);
  res.json(result);
});
