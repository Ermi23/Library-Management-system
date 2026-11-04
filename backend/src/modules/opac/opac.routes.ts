/** Public catalog (OPAC) and the signed-in patron's own account ("My account"). */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { audit } from '../../lib/audit.js';
import { notFound } from '../../lib/errors.js';
import { param } from '../../lib/http.js';
import { getSettings } from '../../lib/settings.js';
import { paged, paginationSchema, toSkipTake } from '../../lib/pagination.js';
import { optionalText } from '../../lib/zod.js';
import { requireAuth } from '../../middleware/auth.js';
import { accruedFine, cancelHold, outstandingTotal, placeHold, renew } from '../circulation/circulation.service.js';
import { resolveRule } from '../../lib/rules.js';
import { searchBiblios, searchSchema, summarizeItems } from '../catalog/search.js';

export const opacRouter = Router();

opacRouter.get('/search', async (req, res) => {
  res.json(await searchBiblios(searchSchema.parse(req.query), { publicOnly: true }));
});

opacRouter.get('/new', async (_req, res) => {
  const biblios = await prisma.biblio.findMany({
    where: { items: { some: { status: { not: 'WITHDRAWN' } } } },
    select: { id: true, title: true, authors: true, coverUrl: true, publicationYear: true },
    orderBy: { createdAt: 'desc' },
    take: 12,
  });
  res.json(biblios);
});

opacRouter.get('/facets', async (_req, res) => {
  const [itemTypes, branches, languages] = await Promise.all([
    prisma.itemType.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.branch.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.biblio.findMany({ where: { language: { not: null } }, distinct: ['language'], select: { language: true } }),
  ]);
  res.json({ itemTypes, branches, languages: languages.map((l) => l.language).filter(Boolean) });
});

opacRouter.get('/biblios/:id', async (req, res) => {
  const biblio = await prisma.biblio.findUnique({
    where: { id: param(req) },
    select: {
      id: true,
      title: true,
      subtitle: true,
      authors: true,
      isbn13: true,
      isbn10: true,
      issn: true,
      publisher: true,
      publicationPlace: true,
      publicationYear: true,
      edition: true,
      physicalDescription: true,
      language: true,
      ddc: true,
      subjects: true,
      series: true,
      summary: true,
      notes: true,
      coverUrl: true,
      items: {
        where: { status: { not: 'WITHDRAWN' } },
        select: {
          id: true,
          status: true,
          callNumber: true,
          shelfLocation: true,
          enumeration: true,
          itemType: { select: { id: true, name: true, notForLoan: true } },
          currentBranch: { select: { id: true, name: true } },
          loans: { where: { returnedAt: null }, select: { dueAt: true } },
        },
        orderBy: { currentBranch: { name: 'asc' } },
      },
      _count: { select: { holds: { where: { status: { in: ['PENDING', 'IN_TRANSIT', 'READY'] } } } } },
    },
  });
  if (!biblio) throw notFound('Title not found');
  const { items, _count, ...rest } = biblio;
  const myHold = req.user
    ? await prisma.hold.findFirst({ where: { biblioId: biblio.id, patronId: req.user.id, status: { in: ['PENDING', 'IN_TRANSIT', 'READY'] } } })
    : null;
  res.json({
    ...rest,
    activeHolds: _count.holds,
    myHold,
    availability: summarizeItems(items, true),
    items: items.map(({ loans, ...i }) => ({ ...i, dueAt: loans[0]?.dueAt ?? null })),
  });
});

// ---------------------------------------------------------------------------
// My account (signed-in patron)
// ---------------------------------------------------------------------------

opacRouter.get('/account', requireAuth(), async (req, res) => {
  const id = req.user!.id;
  const settings = await getSettings();
  const [user, loans, holds, fines, owed, unreadNotices] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        address: true,
        cardNumber: true,
        status: true,
        expiresAt: true,
        patronCategoryId: true,
        patronCategory: { select: { name: true } },
        homeBranch: { select: { name: true } },
      },
    }),
    prisma.loan.findMany({
      where: { patronId: id, returnedAt: null },
      include: { item: { select: { barcode: true, itemTypeId: true, callNumber: true, biblio: { select: { id: true, title: true, authors: true, coverUrl: true } } } } },
      orderBy: { dueAt: 'asc' },
    }),
    prisma.hold.findMany({
      where: { patronId: id, status: { in: ['PENDING', 'IN_TRANSIT', 'READY'] } },
      include: { biblio: { select: { id: true, title: true, authors: true } }, pickupBranch: { select: { name: true } } },
      orderBy: { placedAt: 'asc' },
    }),
    prisma.fine.findMany({ where: { patronId: id, status: 'OUTSTANDING' }, orderBy: { createdAt: 'desc' } }),
    outstandingTotal(prisma, id),
    prisma.notice.count({ where: { patronId: id, channel: 'IN_APP', readAt: null } }),
  ]);

  const now = new Date();
  const loansDetailed = await Promise.all(
    loans.map(async (l) => {
      const rule = await resolveRule(prisma, { branchId: l.branchId, patronCategoryId: user.patronCategoryId, itemTypeId: l.item.itemTypeId });
      const waiting = await prisma.hold.count({ where: { biblioId: l.item.biblio.id, status: 'PENDING', patronId: { not: id } } });
      return {
        ...l,
        overdue: l.dueAt < now,
        accruedFine: l.dueAt < now ? await accruedFine(prisma, l, { patronCategoryId: user.patronCategoryId, itemTypeId: l.item.itemTypeId }, settings) : 0,
        renewalsLeft: Math.max(0, rule.maxRenewals - l.renewals),
        canRenew: settings.allowPatronRenewal && l.renewals < rule.maxRenewals && waiting === 0,
      };
    }),
  );
  const holdsDetailed = await Promise.all(
    holds.map(async (h) => ({
      ...h,
      position: h.status === 'PENDING' ? await prisma.hold.count({ where: { biblioId: h.biblioId, status: 'PENDING', placedAt: { lte: h.placedAt } } }) : null,
    })),
  );
  res.json({ user, loans: loansDetailed, holds: holdsDetailed, fines, outstanding: owed, unreadNotices, currency: settings.currency });
});

opacRouter.patch('/account', requireAuth(), async (req, res) => {
  const input = z.object({ phone: optionalText(50), address: optionalText(500) }).partial().parse(req.body);
  const user = await prisma.user.update({ where: { id: req.user!.id }, data: input, select: { id: true, phone: true, address: true } });
  res.json(user);
});

opacRouter.get('/account/history', requireAuth(), async (req, res) => {
  const query = paginationSchema.parse(req.query);
  const where = { patronId: req.user!.id, returnedAt: { not: null } };
  const [data, total] = await Promise.all([
    prisma.loan.findMany({
      where,
      include: { item: { select: { biblio: { select: { id: true, title: true, authors: true } } } } },
      orderBy: { returnedAt: 'desc' },
      ...toSkipTake(query),
    }),
    prisma.loan.count({ where }),
  ]);
  res.json(paged(data, total, query));
});

opacRouter.get('/account/notices', requireAuth(), async (req, res) => {
  const query = paginationSchema.parse(req.query);
  const where = { patronId: req.user!.id, channel: 'IN_APP' as const };
  const [data, total] = await Promise.all([
    prisma.notice.findMany({ where, orderBy: { createdAt: 'desc' }, ...toSkipTake(query) }),
    prisma.notice.count({ where }),
  ]);
  res.json(paged(data, total, query));
});

opacRouter.post('/account/notices/read', requireAuth(), async (req, res) => {
  await prisma.notice.updateMany({ where: { patronId: req.user!.id, readAt: null }, data: { readAt: new Date() } });
  res.status(204).end();
});

opacRouter.post('/holds', requireAuth(), async (req, res) => {
  const input = z.object({ biblioId: z.string().min(1), pickupBranchId: z.string().min(1) }).parse(req.body);
  const result = await placeHold({ ...input, patronId: req.user!.id, actor: 'patron' });
  await audit(req.user!.id, 'place', 'Hold', result.hold.id, { biblioId: input.biblioId, via: 'opac' });
  res.status(201).json(result);
});

opacRouter.post('/holds/:id/cancel', requireAuth(), async (req, res) => {
  const result = await cancelHold({ holdId: param(req), patronId: req.user!.id, byStaff: false });
  await audit(req.user!.id, 'cancel', 'Hold', result.holdId, { via: 'opac' });
  res.json(result);
});

opacRouter.post('/loans/:id/renew', requireAuth(), async (req, res) => {
  const loan = await renew({ loanId: param(req), actor: 'patron', patronId: req.user!.id });
  await audit(req.user!.id, 'renew', 'Loan', loan.id, { via: 'opac', dueAt: loan.dueAt });
  res.json(loan);
});
