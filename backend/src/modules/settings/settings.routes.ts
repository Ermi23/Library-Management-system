import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { audit } from '../../lib/audit.js';
import { conflict } from '../../lib/errors.js';
import { param } from '../../lib/http.js';
import { getSettings, librarySettingsSchema, saveSettings } from '../../lib/settings.js';
import { emptyToNull, money, optionalId, optionalText } from '../../lib/zod.js';
import { requireAdmin, requireStaff } from '../../middleware/auth.js';
import { emailEnabled } from '../notices/notices.service.js';

export const settingsRouter = Router();

/** Public subset used by the OPAC header and patron pages. */
settingsRouter.get('/public', async (_req, res) => {
  const s = await getSettings();
  res.json({
    libraryName: s.libraryName,
    address: s.address,
    phone: s.phone,
    email: s.email,
    currency: s.currency,
    allowOpacHolds: s.allowOpacHolds,
    allowPatronRenewal: s.allowPatronRenewal,
  });
});

settingsRouter.get('/library', requireStaff, async (_req, res) => {
  res.json({ ...(await getSettings()), emailEnabled: emailEnabled() });
});

settingsRouter.put('/library', requireAdmin, async (req, res) => {
  const patch = librarySettingsSchema.partial().parse(req.body);
  const saved = await saveSettings(patch);
  await audit(req.user!.id, 'update', 'Setting', 'library', { fields: Object.keys(patch) });
  res.json(saved);
});

// ---------------------------------------------------------------------------
// Circulation rules
// ---------------------------------------------------------------------------

const ruleSchema = z.object({
  branchId: optionalId,
  patronCategoryId: optionalId,
  itemTypeId: optionalId,
  loanPeriodDays: z.coerce.number().int().min(0).max(365),
  maxLoans: z.coerce.number().int().min(0).max(1000),
  maxRenewals: z.coerce.number().int().min(0).max(100),
  maxHolds: z.coerce.number().int().min(0).max(1000),
  holdPickupDays: z.coerce.number().int().min(1).max(90),
  finePerDay: money,
  maxFine: emptyToNull(money.nullish()),
});

settingsRouter.get('/rules', requireStaff, async (_req, res) => {
  const rules = await prisma.circulationRule.findMany({
    include: {
      branch: { select: { id: true, name: true } },
      patronCategory: { select: { id: true, name: true } },
      itemType: { select: { id: true, name: true } },
    },
  });
  // Most general first, matching how staff think about defaults and exceptions.
  const specificity = (r: (typeof rules)[number]) => (r.branchId ? 4 : 0) + (r.patronCategoryId ? 2 : 0) + (r.itemTypeId ? 1 : 0);
  res.json(rules.sort((a, b) => specificity(a) - specificity(b)));
});

async function assertUniqueRule(data: { branchId: string | null; patronCategoryId: string | null; itemTypeId: string | null }, excludeId?: string) {
  const dup = await prisma.circulationRule.findFirst({
    where: { branchId: data.branchId, patronCategoryId: data.patronCategoryId, itemTypeId: data.itemTypeId, NOT: excludeId ? { id: excludeId } : undefined },
  });
  if (dup) throw conflict('A rule for this branch / patron category / item type combination already exists. Edit it instead.');
}

settingsRouter.post('/rules', requireAdmin, async (req, res) => {
  const data = ruleSchema.parse(req.body);
  await assertUniqueRule(data);
  const rule = await prisma.circulationRule.create({ data });
  await audit(req.user!.id, 'create', 'CirculationRule', rule.id, data);
  res.status(201).json(rule);
});

settingsRouter.put('/rules/:id', requireAdmin, async (req, res) => {
  const data = ruleSchema.parse(req.body);
  await assertUniqueRule(data, param(req));
  const rule = await prisma.circulationRule.update({ where: { id: param(req) }, data });
  await audit(req.user!.id, 'update', 'CirculationRule', rule.id, data);
  res.json(rule);
});

settingsRouter.delete('/rules/:id', requireAdmin, async (req, res) => {
  await prisma.circulationRule.delete({ where: { id: param(req) } });
  await audit(req.user!.id, 'delete', 'CirculationRule', param(req));
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Item types and patron categories
// ---------------------------------------------------------------------------

const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_-]{1,12}$/, 'Code must be 1-12 letters, digits, - or _');

const itemTypeSchema = z.object({ code, name: z.string().trim().min(1).max(100), notForLoan: z.boolean().default(false) });

settingsRouter.post('/item-types', requireAdmin, async (req, res) => {
  const type = await prisma.itemType.create({ data: itemTypeSchema.parse(req.body) });
  await audit(req.user!.id, 'create', 'ItemType', type.id, { code: type.code });
  res.status(201).json(type);
});

settingsRouter.put('/item-types/:id', requireAdmin, async (req, res) => {
  const type = await prisma.itemType.update({ where: { id: param(req) }, data: itemTypeSchema.parse(req.body) });
  await audit(req.user!.id, 'update', 'ItemType', type.id);
  res.json(type);
});

settingsRouter.delete('/item-types/:id', requireAdmin, async (req, res) => {
  const inUse = await prisma.item.count({ where: { itemTypeId: param(req) } });
  if (inUse) throw conflict(`${inUse} copies use this item type. Change them first.`);
  await prisma.circulationRule.deleteMany({ where: { itemTypeId: param(req) } });
  await prisma.itemType.delete({ where: { id: param(req) } });
  await audit(req.user!.id, 'delete', 'ItemType', param(req));
  res.status(204).end();
});

const categorySchema = z.object({
  code,
  name: z.string().trim().min(1).max(100),
  description: optionalText(500),
  enrolmentPeriodMonths: z.coerce.number().int().min(1).max(600),
});

settingsRouter.post('/patron-categories', requireAdmin, async (req, res) => {
  const category = await prisma.patronCategory.create({ data: categorySchema.parse(req.body) });
  await audit(req.user!.id, 'create', 'PatronCategory', category.id, { code: category.code });
  res.status(201).json(category);
});

settingsRouter.put('/patron-categories/:id', requireAdmin, async (req, res) => {
  const category = await prisma.patronCategory.update({ where: { id: param(req) }, data: categorySchema.parse(req.body) });
  await audit(req.user!.id, 'update', 'PatronCategory', category.id);
  res.json(category);
});

settingsRouter.delete('/patron-categories/:id', requireAdmin, async (req, res) => {
  const inUse = await prisma.user.count({ where: { patronCategoryId: param(req) } });
  if (inUse) throw conflict(`${inUse} patrons are in this category. Move them first.`);
  await prisma.circulationRule.deleteMany({ where: { patronCategoryId: param(req) } });
  await prisma.patronCategory.delete({ where: { id: param(req) } });
  await audit(req.user!.id, 'delete', 'PatronCategory', param(req));
  res.status(204).end();
});
