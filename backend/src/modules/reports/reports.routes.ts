import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { addDays, startOfDay } from '../../lib/dates.js';
import { DDC_CLASSES } from '../../lib/callNumber.js';
import { requireStaff } from '../../middleware/auth.js';

export const reportsRouter = Router();
reportsRouter.use(requireStaff);

const rangeSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  branchId: z.string().optional(),
});

/** Defaults to the last 30 days; `to` is inclusive of the whole day. */
function range(query: unknown) {
  const { from, to, branchId } = rangeSchema.parse(query);
  const end = to ? addDays(startOfDay(to), 1) : addDays(startOfDay(new Date()), 1);
  const start = from ? startOfDay(from) : addDays(end, -30);
  return { start, end, branchId };
}

const num = (v: unknown) => Number(v ?? 0);

reportsRouter.get('/summary', async (req, res) => {
  const { start, end, branchId } = range(req.query);
  const inRange = { gte: start, lt: end };
  const [checkouts, returns, renewals, newPatrons, newTitles, newItems, charged, collected, waived, holdsPlaced] = await Promise.all([
    prisma.loan.count({ where: { checkedOutAt: inRange, branchId } }),
    prisma.loan.count({ where: { returnedAt: inRange, returnBranchId: branchId } }),
    prisma.loan.count({ where: { lastRenewedAt: inRange, branchId } }),
    prisma.user.count({ where: { role: 'PATRON', createdAt: inRange, homeBranchId: branchId } }),
    prisma.biblio.count({ where: { createdAt: inRange } }),
    prisma.item.count({ where: { createdAt: inRange, homeBranchId: branchId } }),
    prisma.fine.aggregate({ where: { createdAt: inRange }, _sum: { amount: true } }),
    prisma.payment.aggregate({ where: { createdAt: inRange }, _sum: { amount: true } }),
    prisma.fine.aggregate({ where: { updatedAt: inRange, status: 'WAIVED' }, _sum: { amount: true } }),
    prisma.hold.count({ where: { placedAt: inRange, pickupBranchId: branchId } }),
  ]);
  res.json({
    from: start,
    to: addDays(end, -1),
    checkouts,
    returns,
    renewals,
    holdsPlaced,
    newPatrons,
    newTitles,
    newItems,
    finesCharged: num(charged._sum.amount),
    finesCollected: num(collected._sum.amount),
    finesWaived: num(waived._sum.amount),
  });
});

reportsRouter.get('/circulation-trend', async (req, res) => {
  const { start, end, branchId } = range(req.query);
  const branchFilter = branchId ? Prisma.sql`AND "branchId" = ${branchId}` : Prisma.empty;
  const returnFilter = branchId ? Prisma.sql`AND "returnBranchId" = ${branchId}` : Prisma.empty;
  const [out, back] = await Promise.all([
    prisma.$queryRaw<{ day: Date; count: bigint }[]>`
      SELECT date_trunc('day', "checkedOutAt") AS day, count(*)::bigint AS count FROM "Loan"
      WHERE "checkedOutAt" >= ${start} AND "checkedOutAt" < ${end} ${branchFilter} GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ day: Date; count: bigint }[]>`
      SELECT date_trunc('day', "returnedAt") AS day, count(*)::bigint AS count FROM "Loan"
      WHERE "returnedAt" >= ${start} AND "returnedAt" < ${end} ${returnFilter} GROUP BY 1 ORDER BY 1`,
  ]);
  const key = (d: Date) => d.toISOString().slice(0, 10);
  const outMap = new Map(out.map((r) => [key(r.day), num(r.count)]));
  const backMap = new Map(back.map((r) => [key(r.day), num(r.count)]));
  const days = [];
  for (let d = new Date(start); d < end; d = addDays(d, 1)) {
    const k = key(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())));
    days.push({ day: k, checkouts: outMap.get(k) ?? 0, returns: backMap.get(k) ?? 0 });
  }
  res.json(days);
});

reportsRouter.get('/top-titles', async (req, res) => {
  const { start, end, branchId } = range(req.query);
  const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }).parse(req.query);
  const branchFilter = branchId ? Prisma.sql`AND l."branchId" = ${branchId}` : Prisma.empty;
  const rows = await prisma.$queryRaw<{ id: string; title: string; authors: string[]; loans: bigint }[]>`
    SELECT b."id", b."title", b."authors", count(*)::bigint AS loans
    FROM "Loan" l JOIN "Item" i ON i."id" = l."itemId" JOIN "Biblio" b ON b."id" = i."biblioId"
    WHERE l."checkedOutAt" >= ${start} AND l."checkedOutAt" < ${end} ${branchFilter}
    GROUP BY b."id" ORDER BY loans DESC, b."title" LIMIT ${limit}`;
  res.json(rows.map((r) => ({ ...r, loans: num(r.loans) })));
});

reportsRouter.get('/top-patrons', async (req, res) => {
  const { start, end } = range(req.query);
  const rows = await prisma.$queryRaw<{ id: string; firstName: string; lastName: string; cardNumber: string | null; loans: bigint }[]>`
    SELECT u."id", u."firstName", u."lastName", u."cardNumber", count(*)::bigint AS loans
    FROM "Loan" l JOIN "User" u ON u."id" = l."patronId"
    WHERE l."checkedOutAt" >= ${start} AND l."checkedOutAt" < ${end}
    GROUP BY u."id" ORDER BY loans DESC LIMIT 20`;
  res.json(rows.map((r) => ({ ...r, loans: num(r.loans) })));
});

reportsRouter.get('/overdue', async (req, res) => {
  const { branchId } = rangeSchema.parse(req.query);
  const now = new Date();
  const loans = await prisma.loan.findMany({
    where: { returnedAt: null, dueAt: { lt: now }, branchId },
    include: {
      item: { select: { barcode: true, callNumber: true, price: true, biblio: { select: { title: true } } } },
      patron: { select: { id: true, firstName: true, lastName: true, cardNumber: true, email: true, phone: true } },
      branch: { select: { name: true } },
    },
    orderBy: { dueAt: 'asc' },
  });
  res.json(loans.map((l) => ({ ...l, daysOverdue: Math.floor((now.getTime() - l.dueAt.getTime()) / 86_400_000) })));
});

reportsRouter.get('/collection', async (req, res) => {
  const { branchId } = rangeSchema.parse(req.query);
  const branchFilter = branchId ? Prisma.sql`AND i."homeBranchId" = ${branchId}` : Prisma.empty;
  const [byClass, byType, byBranch, byStatus, totals] = await Promise.all([
    prisma.$queryRaw<{ cls: string | null; items: bigint; titles: bigint }[]>`
      SELECT CASE WHEN b."ddc" ~ '^[0-9]' THEN substr(b."ddc", 1, 1) || '00' ELSE NULL END AS cls,
             count(i.*)::bigint AS items, count(DISTINCT b."id")::bigint AS titles
      FROM "Item" i JOIN "Biblio" b ON b."id" = i."biblioId"
      WHERE i."status" <> 'WITHDRAWN' ${branchFilter} GROUP BY 1 ORDER BY 1 NULLS LAST`,
    prisma.$queryRaw<{ name: string; items: bigint }[]>`
      SELECT t."name", count(*)::bigint AS items FROM "Item" i JOIN "ItemType" t ON t."id" = i."itemTypeId"
      WHERE i."status" <> 'WITHDRAWN' ${branchFilter} GROUP BY t."name" ORDER BY items DESC`,
    prisma.$queryRaw<{ name: string; items: bigint; available: bigint }[]>`
      SELECT br."name", count(*)::bigint AS items, count(*) FILTER (WHERE i."status" = 'AVAILABLE')::bigint AS available
      FROM "Item" i JOIN "Branch" br ON br."id" = i."homeBranchId"
      WHERE i."status" <> 'WITHDRAWN' ${branchFilter} GROUP BY br."name" ORDER BY items DESC`,
    prisma.$queryRaw<{ status: string; items: bigint }[]>`
      SELECT i."status"::text AS status, count(*)::bigint AS items FROM "Item" i WHERE true ${branchFilter} GROUP BY 1 ORDER BY items DESC`,
    prisma.$queryRaw<{ value: Prisma.Decimal | null; items: bigint }[]>`
      SELECT sum(i."price") AS value, count(*)::bigint AS items FROM "Item" i WHERE i."status" <> 'WITHDRAWN' ${branchFilter}`,
  ]);
  res.json({
    byClass: byClass.map((r) => ({ class: r.cls, label: r.cls ? DDC_CLASSES[r.cls] : 'Unclassified', items: num(r.items), titles: num(r.titles) })),
    byType: byType.map((r) => ({ name: r.name, items: num(r.items) })),
    byBranch: byBranch.map((r) => ({ name: r.name, items: num(r.items), available: num(r.available) })),
    byStatus: byStatus.map((r) => ({ status: r.status, items: num(r.items) })),
    totalItems: num(totals[0]?.items),
    totalValue: num(totals[0]?.value),
  });
});

reportsRouter.get('/patrons', async (_req, res) => {
  const since = addDays(startOfDay(new Date()), -365);
  const [byCategory, byMonth, active, total] = await Promise.all([
    prisma.$queryRaw<{ name: string | null; patrons: bigint }[]>`
      SELECT c."name", count(*)::bigint AS patrons FROM "User" u LEFT JOIN "PatronCategory" c ON c."id" = u."patronCategoryId"
      WHERE u."role" = 'PATRON' GROUP BY c."name" ORDER BY patrons DESC`,
    prisma.$queryRaw<{ month: Date; patrons: bigint }[]>`
      SELECT date_trunc('month', "createdAt") AS month, count(*)::bigint AS patrons FROM "User"
      WHERE "role" = 'PATRON' AND "createdAt" >= ${since} GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(DISTINCT "patronId")::bigint AS count FROM "Loan" WHERE "checkedOutAt" >= ${since}`,
    prisma.user.count({ where: { role: 'PATRON' } }),
  ]);
  res.json({
    total,
    activeBorrowers: num(active[0]?.count),
    byCategory: byCategory.map((r) => ({ name: r.name ?? 'No category', patrons: num(r.patrons) })),
    newByMonth: byMonth.map((r) => ({ month: r.month.toISOString().slice(0, 7), patrons: num(r.patrons) })),
  });
});

reportsRouter.get('/fines', async (req, res) => {
  const { start, end } = range(req.query);
  const [byType, byMethod, outstanding] = await Promise.all([
    prisma.fine.groupBy({ by: ['type', 'status'], where: { createdAt: { gte: start, lt: end } }, _sum: { amount: true }, _count: true }),
    prisma.payment.groupBy({ by: ['method'], where: { createdAt: { gte: start, lt: end } }, _sum: { amount: true }, _count: true }),
    prisma.fine.aggregate({ where: { status: 'OUTSTANDING' }, _sum: { outstanding: true }, _count: true }),
  ]);
  res.json({
    byType: byType.map((r) => ({ type: r.type, status: r.status, amount: num(r._sum.amount), count: r._count })),
    byMethod: byMethod.map((r) => ({ method: r.method, amount: num(r._sum.amount), count: r._count })),
    outstanding: { amount: num(outstanding._sum.outstanding), count: outstanding._count },
  });
});

/** Copies not borrowed in the last N months (or never): candidates for weeding. */
reportsRouter.get('/dead-stock', async (req, res) => {
  const { months, branchId } = z.object({ months: z.coerce.number().int().min(1).max(120).default(24), branchId: z.string().optional() }).parse(req.query);
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const items = await prisma.item.findMany({
    where: {
      status: { in: ['AVAILABLE', 'DAMAGED'] },
      acquiredAt: { lt: cutoff },
      homeBranchId: branchId,
      loans: { none: { checkedOutAt: { gte: cutoff } } },
    },
    select: {
      id: true,
      barcode: true,
      callNumber: true,
      acquiredAt: true,
      lastSeenAt: true,
      biblio: { select: { id: true, title: true, publicationYear: true } },
      homeBranch: { select: { name: true } },
      _count: { select: { loans: true } },
    },
    orderBy: { callNumber: 'asc' },
    take: 500,
  });
  res.json(items);
});

reportsRouter.get('/acquisitions', async (_req, res) => {
  const rows = await prisma.$queryRaw<{ code: string; name: string; fiscalYear: number; allocated: Prisma.Decimal; spent: Prisma.Decimal | null; titles: bigint }[]>`
    SELECT f."code", f."name", f."fiscalYear", f."allocated",
           sum(ol."quantityReceived" * ol."unitPrice") AS spent, count(DISTINCT ol."biblioId")::bigint AS titles
    FROM "Fund" f LEFT JOIN "OrderLine" ol ON ol."fundId" = f."id"
    GROUP BY f."id" ORDER BY f."fiscalYear" DESC, f."code"`;
  res.json(rows.map((r) => ({ ...r, allocated: num(r.allocated), spent: num(r.spent), titles: num(r.titles) })));
});
