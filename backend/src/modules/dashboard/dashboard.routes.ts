import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { addDays, startOfDay } from '../../lib/dates.js';
import { workingBranchId } from '../../lib/branch.js';
import { requireStaff } from '../../middleware/auth.js';

export const dashboardRouter = Router();
dashboardRouter.use(requireStaff);

dashboardRouter.get('/stats', async (req, res) => {
  const now = new Date();
  const today = startOfDay(now);
  const branchId = await workingBranchId(req);
  const [
    titles,
    items,
    availableItems,
    patrons,
    activeLoans,
    overdueLoans,
    pendingHolds,
    branches,
    checkoutsToday,
    returnsToday,
    holdsReady,
    incomingTransfers,
    outstandingFines,
    holdsToPull,
  ] = await Promise.all([
    prisma.biblio.count(),
    prisma.item.count({ where: { status: { not: 'WITHDRAWN' } } }),
    prisma.item.count({ where: { status: 'AVAILABLE' } }),
    prisma.user.count({ where: { role: 'PATRON', status: 'ACTIVE' } }),
    prisma.loan.count({ where: { returnedAt: null } }),
    prisma.loan.count({ where: { returnedAt: null, dueAt: { lt: now } } }),
    prisma.hold.count({ where: { status: { in: ['PENDING', 'IN_TRANSIT', 'READY'] } } }),
    prisma.branch.count({ where: { isActive: true } }),
    prisma.loan.count({ where: { checkedOutAt: { gte: today } } }),
    prisma.loan.count({ where: { returnedAt: { gte: today } } }),
    prisma.hold.count({ where: { status: 'READY', pickupBranchId: branchId } }),
    prisma.transfer.count({ where: { status: 'IN_TRANSIT', toBranchId: branchId } }),
    prisma.fine.aggregate({ where: { status: 'OUTSTANDING' }, _sum: { outstanding: true } }),
    prisma.hold.count({
      where: { status: 'PENDING', itemId: null, biblio: { items: { some: { status: 'AVAILABLE', currentBranchId: branchId } } } },
    }),
  ]);

  res.json({
    titles,
    items,
    availableItems,
    patrons,
    activeLoans,
    overdueLoans,
    pendingHolds,
    branches,
    checkoutsToday,
    returnsToday,
    holdsReady,
    incomingTransfers,
    holdsToPull,
    outstandingFines: Number(outstandingFines._sum.outstanding ?? 0),
  });
});

dashboardRouter.get('/activity', async (_req, res) => {
  const since = addDays(startOfDay(new Date()), -13);
  const [loans, recent] = await Promise.all([
    prisma.$queryRaw<{ day: Date; checkouts: bigint; returns: bigint }[]>`
      SELECT d.day,
        (SELECT count(*) FROM "Loan" WHERE date_trunc('day', "checkedOutAt") = d.day)::bigint AS checkouts,
        (SELECT count(*) FROM "Loan" WHERE date_trunc('day', "returnedAt") = d.day)::bigint AS returns
      FROM generate_series(date_trunc('day', ${since}::timestamp), date_trunc('day', now()), interval '1 day') AS d(day)
      ORDER BY d.day`,
    prisma.auditLog.findMany({
      where: { action: { in: ['checkout', 'checkin', 'renew', 'place', 'payment', 'create'] } },
      include: { user: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 12,
    }),
  ]);
  res.json({
    trend: loans.map((r) => ({ day: r.day.toISOString().slice(0, 10), checkouts: Number(r.checkouts), returns: Number(r.returns) })),
    recent,
  });
});
