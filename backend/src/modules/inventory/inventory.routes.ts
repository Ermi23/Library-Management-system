/**
 * Stock-taking: staff scan every copy on the shelves; the system reports copies that should be
 * on the shelf but were not scanned (missing), copies at the wrong branch, and copies shown as on loan.
 */
import { Router } from 'express';
import { InventoryStatus, Prisma, type ItemStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { param } from '../../lib/http.js';
import { workingBranchId } from '../../lib/branch.js';
import { paged, paginationSchema, toSkipTake } from '../../lib/pagination.js';
import { optionalText } from '../../lib/zod.js';
import { requireStaff } from '../../middleware/auth.js';

export const inventoryRouter = Router();
inventoryRouter.use(requireStaff);

/** Copies that should physically be on the shelves of the branch being counted. */
const EXPECTED_STATUSES: ItemStatus[] = ['AVAILABLE', 'IN_PROCESSING', 'DAMAGED', 'ON_HOLD_SHELF'];

function expectedWhere(session: { branchId: string; shelfLocation: string | null }): Prisma.ItemWhereInput {
  return {
    currentBranchId: session.branchId,
    status: { in: EXPECTED_STATUSES },
    ...(session.shelfLocation ? { shelfLocation: session.shelfLocation } : {}),
  };
}

inventoryRouter.get('/sessions', async (req, res) => {
  const query = paginationSchema.extend({ status: z.enum(InventoryStatus).optional() }).parse(req.query);
  const where = { status: query.status };
  const [data, total] = await Promise.all([
    prisma.inventorySession.findMany({
      where,
      include: {
        branch: { select: { id: true, name: true } },
        startedBy: { select: { firstName: true, lastName: true } },
        _count: { select: { scans: true } },
      },
      orderBy: { startedAt: 'desc' },
      ...toSkipTake(query),
    }),
    prisma.inventorySession.count({ where }),
  ]);
  res.json(paged(data, total, query));
});

inventoryRouter.post('/sessions', async (req, res) => {
  const input = z
    .object({ branchId: z.string().optional(), shelfLocation: optionalText(100), notes: optionalText(500) })
    .parse(req.body);
  const branchId = input.branchId || (await workingBranchId(req));
  const session = await prisma.inventorySession.create({
    data: { branchId, shelfLocation: input.shelfLocation, notes: input.notes, startedById: req.user!.id },
  });
  await audit(req.user!.id, 'start', 'InventorySession', session.id, { branchId, shelfLocation: input.shelfLocation });
  res.status(201).json(session);
});

async function sessionSummary(id: string) {
  const session = await prisma.inventorySession.findUnique({
    where: { id },
    include: { branch: { select: { id: true, name: true } }, startedBy: { select: { firstName: true, lastName: true } } },
  });
  if (!session) throw notFound('Inventory session not found');
  const [expected, scannedExpected, byResult] = await Promise.all([
    prisma.item.count({ where: expectedWhere(session) }),
    prisma.item.count({ where: { ...expectedWhere(session), inventoryScans: { some: { sessionId: id } } } }),
    prisma.inventoryScan.groupBy({ by: ['result'], where: { sessionId: id }, _count: true }),
  ]);
  return {
    ...session,
    stats: {
      expected,
      scannedExpected,
      notYetScanned: expected - scannedExpected,
      results: Object.fromEntries(byResult.map((r) => [r.result, r._count])),
    },
  };
}

inventoryRouter.get('/sessions/:id', async (req, res) => {
  const id = param(req);
  const [summary, recentScans] = await Promise.all([
    sessionSummary(id),
    prisma.inventoryScan.findMany({
      where: { sessionId: id },
      include: {
        item: {
          select: { id: true, barcode: true, callNumber: true, status: true, biblio: { select: { title: true } }, currentBranch: { select: { name: true } } },
        },
      },
      orderBy: { scannedAt: 'desc' },
      take: 50,
    }),
  ]);
  res.json({ ...summary, recentScans });
});

inventoryRouter.post('/sessions/:id/scan', async (req, res) => {
  const { barcode } = z.object({ barcode: z.string().trim().min(1) }).parse(req.body);
  const session = await prisma.inventorySession.findUnique({ where: { id: param(req) } });
  if (!session) throw notFound('Inventory session not found');
  if (session.status !== 'OPEN') throw conflict('This inventory session is closed.');

  const item = await prisma.item.findUnique({
    where: { barcode },
    include: { biblio: { select: { title: true } }, currentBranch: { select: { name: true } } },
  });
  const duplicate = item ? await prisma.inventoryScan.findFirst({ where: { sessionId: session.id, itemId: item.id } }) : null;
  if (duplicate) {
    res.json({ scan: duplicate, item, duplicate: true, message: 'Already scanned in this session.' });
    return;
  }

  let result: 'FOUND' | 'WRONG_BRANCH' | 'CHECKED_OUT' | 'UNKNOWN_BARCODE' = 'FOUND';
  let message = 'Found.';
  if (!item) {
    result = 'UNKNOWN_BARCODE';
    message = 'This barcode is not in the catalog.';
  } else if (item.status === 'ON_LOAN') {
    result = 'CHECKED_OUT';
    message = 'The system shows this copy as on loan. Check it in.';
  } else if (item.currentBranchId !== session.branchId) {
    result = 'WRONG_BRANCH';
    message = `This copy should be at ${item.currentBranch.name}.`;
  } else if (item.status === 'MISSING') {
    message = 'Was marked missing: now marked available.';
  } else if (item.status === 'LOST') {
    message = 'Marked lost: check it in to clear the replacement charge.';
  } else if (item.status === 'WITHDRAWN') {
    message = 'This copy is withdrawn and should not be on the shelf.';
  }

  const scan = await prisma.$transaction(async (tx) => {
    if (item) {
      await tx.item.update({
        where: { id: item.id },
        data: { lastSeenAt: new Date(), ...(item.status === 'MISSING' && result === 'FOUND' ? { status: 'AVAILABLE' } : {}) },
      });
    }
    return tx.inventoryScan.create({ data: { sessionId: session.id, barcode, itemId: item?.id, result } });
  });
  res.json({ scan, item, duplicate: false, message });
});

/** Copies expected on the shelf that have not been scanned in this session. */
inventoryRouter.get('/sessions/:id/missing', async (req, res) => {
  const id = param(req);
  const query = paginationSchema.parse(req.query);
  const session = await prisma.inventorySession.findUnique({ where: { id } });
  if (!session) throw notFound('Inventory session not found');
  const where: Prisma.ItemWhereInput = { ...expectedWhere(session), inventoryScans: { none: { sessionId: id } } };
  const [data, total] = await Promise.all([
    prisma.item.findMany({
      where,
      select: { id: true, barcode: true, callNumber: true, shelfLocation: true, status: true, lastSeenAt: true, biblio: { select: { id: true, title: true } } },
      orderBy: { callNumber: 'asc' },
      ...toSkipTake(query),
    }),
    prisma.item.count({ where }),
  ]);
  res.json(paged(data, total, query));
});

inventoryRouter.post('/sessions/:id/complete', async (req, res) => {
  const id = param(req);
  const { markMissing } = z.object({ markMissing: z.boolean().default(false) }).parse(req.body ?? {});
  const session = await prisma.inventorySession.findUnique({ where: { id } });
  if (!session) throw notFound('Inventory session not found');
  if (session.status !== 'OPEN') throw badRequest('This inventory session is already closed.');

  const marked = await prisma.$transaction(async (tx) => {
    let count = 0;
    if (markMissing) {
      const result = await tx.item.updateMany({
        where: { ...expectedWhere(session), status: { in: ['AVAILABLE', 'IN_PROCESSING', 'DAMAGED'] }, inventoryScans: { none: { sessionId: id } } },
        data: { status: 'MISSING' },
      });
      count = result.count;
    }
    await tx.inventorySession.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date() } });
    return count;
  });
  await audit(req.user!.id, 'complete', 'InventorySession', id, { markedMissing: marked });
  res.json({ ...(await sessionSummary(id)), markedMissing: marked });
});

inventoryRouter.post('/sessions/:id/cancel', async (req, res) => {
  const session = await prisma.inventorySession.update({ where: { id: param(req) }, data: { status: 'CANCELLED', completedAt: new Date() } });
  await audit(req.user!.id, 'cancel', 'InventorySession', session.id);
  res.json(session);
});
