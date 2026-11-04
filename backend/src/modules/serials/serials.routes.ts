/**
 * Serials: subscriptions to magazines/journals, prediction of expected issues, check-in of
 * received issues (optionally creating a circulating copy), and a late-issues list for claiming.
 */
import { Router } from 'express';
import { Prisma, SerialFrequency } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { audit } from '../../lib/audit.js';
import { conflict, notFound } from '../../lib/errors.js';
import { param } from '../../lib/http.js';
import { addDays, addMonths } from '../../lib/dates.js';
import { buildCallNumber } from '../../lib/callNumber.js';
import { generateItemBarcodes } from '../../lib/counters.js';
import { getSettings } from '../../lib/settings.js';
import { optionalDate, optionalId, optionalText } from '../../lib/zod.js';
import { requireStaff } from '../../middleware/auth.js';

export const serialsRouter = Router();
serialsRouter.use(requireStaff);

/** Days after the expected date before an issue counts as late. */
const LATE_AFTER_DAYS = 7;

export function nextIssueDate(from: Date, frequency: SerialFrequency): Date {
  switch (frequency) {
    case 'WEEKLY':
      return addDays(from, 7);
    case 'BIWEEKLY':
      return addDays(from, 14);
    case 'MONTHLY':
      return addMonths(from, 1);
    case 'BIMONTHLY':
      return addMonths(from, 2);
    case 'QUARTERLY':
      return addMonths(from, 3);
    case 'SEMIANNUAL':
      return addMonths(from, 6);
    case 'ANNUAL':
      return addMonths(from, 12);
  }
}

export function issueLabel(pattern: string, number: number, expectedOn: Date): string {
  const month = expectedOn.toLocaleString('en', { month: 'short', year: 'numeric' });
  return pattern.replace(/\{n\}/g, String(number)).replace(/\{date\}/g, month);
}

/** Predicts the next `count` issues after the last one already generated. */
async function generateIssues(tx: Prisma.TransactionClient, subscriptionId: string, count: number) {
  const sub = await tx.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
  const last = await tx.serialIssue.findFirst({ where: { subscriptionId }, orderBy: { number: 'desc' } });
  let date = last ? nextIssueDate(last.expectedOn, sub.frequency) : sub.startDate;
  let number = sub.nextNumber;
  const created = [];
  for (let i = 0; i < count; i++) {
    if (sub.endDate && date > sub.endDate) break;
    created.push(
      await tx.serialIssue.create({
        data: { subscriptionId, number, label: issueLabel(sub.labelPattern, number, date), expectedOn: date },
      }),
    );
    number++;
    date = nextIssueDate(date, sub.frequency);
  }
  await tx.subscription.update({ where: { id: subscriptionId }, data: { nextNumber: number } });
  return created;
}

const subscriptionSchema = z.object({
  biblioId: z.string().min(1, 'Choose a title'),
  vendorId: optionalId,
  branchId: z.string().min(1, 'Choose a branch'),
  itemTypeId: optionalId,
  frequency: z.enum(SerialFrequency),
  startDate: z.coerce.date(),
  endDate: optionalDate,
  labelPattern: z.string().trim().min(1).max(100).default('No. {n}'),
  firstNumber: z.coerce.number().int().min(1).default(1),
  createItems: z.boolean().default(true),
  isActive: z.boolean().default(true),
  notes: optionalText(1000),
  predict: z.coerce.number().int().min(0).max(52).default(12),
});

const subscriptionInclude = {
  biblio: { select: { id: true, title: true, issn: true } },
  vendor: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
  itemType: { select: { id: true, name: true } },
} satisfies Prisma.SubscriptionInclude;

serialsRouter.get('/subscriptions', async (_req, res) => {
  const lateBefore = addDays(new Date(), -LATE_AFTER_DAYS);
  const subs = await prisma.subscription.findMany({
    include: {
      ...subscriptionInclude,
      issues: { where: { status: 'EXPECTED' }, orderBy: { expectedOn: 'asc' }, take: 1 },
      _count: { select: { issues: { where: { status: 'EXPECTED', expectedOn: { lt: lateBefore } } } } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(subs.map(({ issues, _count, ...s }) => ({ ...s, nextIssue: issues[0] ?? null, lateCount: _count.issues })));
});

serialsRouter.get('/subscriptions/:id', async (req, res) => {
  const sub = await prisma.subscription.findUnique({
    where: { id: param(req) },
    include: {
      ...subscriptionInclude,
      issues: { orderBy: { number: 'desc' }, include: { item: { select: { id: true, barcode: true, status: true } } } },
    },
  });
  if (!sub) throw notFound('Subscription not found');
  const lateBefore = addDays(new Date(), -LATE_AFTER_DAYS);
  res.json({ ...sub, issues: sub.issues.map((i) => ({ ...i, late: i.status === 'EXPECTED' && i.expectedOn < lateBefore })) });
});

serialsRouter.post('/subscriptions', async (req, res) => {
  const { predict, firstNumber, ...input } = subscriptionSchema.parse(req.body);
  const sub = await prisma.$transaction(async (tx) => {
    const created = await tx.subscription.create({ data: { ...input, nextNumber: firstNumber } });
    if (predict) await generateIssues(tx, created.id, predict);
    return created;
  });
  await audit(req.user!.id, 'create', 'Subscription', sub.id, { biblioId: input.biblioId });
  res.status(201).json(sub);
});

serialsRouter.patch('/subscriptions/:id', async (req, res) => {
  const input = subscriptionSchema.omit({ predict: true, firstNumber: true, biblioId: true }).partial().parse(req.body);
  const sub = await prisma.subscription.update({ where: { id: param(req) }, data: input });
  await audit(req.user!.id, 'update', 'Subscription', sub.id);
  res.json(sub);
});

serialsRouter.post('/subscriptions/:id/generate', async (req, res) => {
  const { count } = z.object({ count: z.coerce.number().int().min(1).max(52).default(6) }).parse(req.body ?? {});
  const issues = await prisma.$transaction((tx) => generateIssues(tx, param(req), count));
  res.json(issues);
});

serialsRouter.post('/issues/:id/receive', async (req, res) => {
  const { barcode, notes } = z.object({ barcode: optionalText(50), notes: optionalText(500) }).parse(req.body ?? {});
  const settings = await getSettings();
  const result = await prisma.$transaction(async (tx) => {
    const issue = await tx.serialIssue.findUnique({ where: { id: param(req) }, include: { subscription: { include: { biblio: true } } } });
    if (!issue) throw notFound('Issue not found');
    if (issue.status === 'RECEIVED') throw conflict('This issue has already been received.');
    const sub = issue.subscription;

    let itemId: string | null = null;
    if (sub.createItems) {
      const itemTypeId =
        sub.itemTypeId ?? (await tx.itemType.findFirst({ where: { code: 'MAG' } }))?.id ?? (await tx.itemType.findFirstOrThrow()).id;
      const code = barcode ?? (await generateItemBarcodes(tx, settings.itemBarcodePrefix, 1))[0];
      if (await tx.item.findUnique({ where: { barcode: code } })) throw conflict(`Barcode ${code} is already in use.`);
      const item = await tx.item.create({
        data: {
          barcode: code,
          biblioId: sub.biblioId,
          itemTypeId,
          homeBranchId: sub.branchId,
          currentBranchId: sub.branchId,
          callNumber: buildCallNumber(sub.biblio),
          enumeration: issue.label,
          acquiredAt: new Date(),
        },
      });
      itemId = item.id;
    }
    return tx.serialIssue.update({
      where: { id: issue.id },
      data: { status: 'RECEIVED', receivedOn: new Date(), itemId, notes: notes ?? issue.notes },
      include: { item: { select: { id: true, barcode: true } } },
    });
  });
  await audit(req.user!.id, 'receive', 'SerialIssue', result.id, { label: result.label, barcode: result.item?.barcode });
  res.json(result);
});

serialsRouter.post('/issues/:id/missing', async (req, res) => {
  const issue = await prisma.serialIssue.update({ where: { id: param(req) }, data: { status: 'MISSING' } });
  await audit(req.user!.id, 'missing', 'SerialIssue', issue.id);
  res.json(issue);
});

/** Issues not received within a week of their expected date, for claiming from the vendor. */
serialsRouter.get('/late', async (_req, res) => {
  const issues = await prisma.serialIssue.findMany({
    where: { status: 'EXPECTED', expectedOn: { lt: addDays(new Date(), -LATE_AFTER_DAYS) }, subscription: { isActive: true } },
    include: { subscription: { include: subscriptionInclude } },
    orderBy: { expectedOn: 'asc' },
  });
  res.json(issues);
});
