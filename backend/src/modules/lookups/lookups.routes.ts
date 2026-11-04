import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { requireStaff } from '../../middleware/auth.js';
import { PAYMENT_METHODS } from '../fines/fines.routes.js';

/** Reference lists used to fill dropdowns in staff forms. */
export const lookupsRouter = Router();
lookupsRouter.use(requireStaff);

lookupsRouter.get('/item-types', async (_req, res) => {
  res.json(await prisma.itemType.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { items: true } } } }));
});

lookupsRouter.get('/patron-categories', async (_req, res) => {
  res.json(await prisma.patronCategory.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { users: true } } } }));
});

lookupsRouter.get('/payment-methods', (_req, res) => {
  res.json(PAYMENT_METHODS);
});

lookupsRouter.get('/shelf-locations', async (_req, res) => {
  const rows = await prisma.item.findMany({ where: { shelfLocation: { not: null } }, distinct: ['shelfLocation'], select: { shelfLocation: true } });
  res.json(rows.map((r) => r.shelfLocation).filter(Boolean).sort());
});
