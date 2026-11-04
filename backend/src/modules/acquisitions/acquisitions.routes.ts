/**
 * Acquisitions: vendors, funds (budgets), purchase orders and receiving.
 * Receiving an order line adds new copies to the catalog and charges the fund.
 */
import { Router } from 'express';
import { Prisma, PurchaseOrderStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { audit } from '../../lib/audit.js';
import { badRequest, confirmationRequired, conflict, notFound } from '../../lib/errors.js';
import { param } from '../../lib/http.js';
import { workingBranchId } from '../../lib/branch.js';
import { buildCallNumber } from '../../lib/callNumber.js';
import { generateItemBarcodes, generateOrderNumber } from '../../lib/counters.js';
import { getSettings } from '../../lib/settings.js';
import { paged, paginationSchema, toSkipTake } from '../../lib/pagination.js';
import { emptyToNull, money, optionalDate, optionalEmail, optionalId, optionalText } from '../../lib/zod.js';
import { requireStaff } from '../../middleware/auth.js';

export const acquisitionsRouter = Router();
acquisitionsRouter.use(requireStaff);

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------

const vendorSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  contactName: optionalText(200),
  email: optionalEmail,
  phone: optionalText(50),
  address: optionalText(500),
  website: optionalText(300),
  accountNumber: optionalText(100),
  discountPercent: emptyToNull(z.coerce.number().min(0).max(100).nullish()),
  notes: optionalText(2000),
  isActive: z.boolean().default(true),
});

acquisitionsRouter.get('/vendors', async (_req, res) => {
  const vendors = await prisma.vendor.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { orders: true, subscriptions: true } } },
  });
  res.json(vendors);
});

acquisitionsRouter.post('/vendors', async (req, res) => {
  const vendor = await prisma.vendor.create({ data: vendorSchema.parse(req.body) });
  await audit(req.user!.id, 'create', 'Vendor', vendor.id, { name: vendor.name });
  res.status(201).json(vendor);
});

acquisitionsRouter.patch('/vendors/:id', async (req, res) => {
  const vendor = await prisma.vendor.update({ where: { id: param(req) }, data: vendorSchema.partial().parse(req.body) });
  await audit(req.user!.id, 'update', 'Vendor', vendor.id);
  res.json(vendor);
});

// ---------------------------------------------------------------------------
// Funds
// ---------------------------------------------------------------------------

const fundSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{2,20}$/, 'Code must be 2-20 letters, digits, - or _'),
  name: z.string().trim().min(1).max(200),
  fiscalYear: z.coerce.number().int().min(2000).max(2100),
  allocated: money,
  branchId: optionalId,
  isActive: z.boolean().default(true),
});

/** Committed = ordered but not yet received; spent = received. */
async function fundBalances(fundIds?: string[]) {
  const lines = await prisma.orderLine.findMany({
    where: { fundId: fundIds ? { in: fundIds } : { not: null }, order: { status: { notIn: ['CANCELLED', 'DRAFT'] } } },
    select: { fundId: true, quantity: true, quantityReceived: true, unitPrice: true, order: { select: { status: true } } },
  });
  const balances = new Map<string, { committed: number; spent: number }>();
  for (const l of lines) {
    const b = balances.get(l.fundId!) ?? { committed: 0, spent: 0 };
    const price = Number(l.unitPrice);
    b.spent += l.quantityReceived * price;
    // Lines on a closed (fully received) order no longer commit money.
    if (l.order.status !== 'RECEIVED') b.committed += Math.max(0, l.quantity - l.quantityReceived) * price;
    balances.set(l.fundId!, b);
  }
  return balances;
}

acquisitionsRouter.get('/funds', async (_req, res) => {
  const funds = await prisma.fund.findMany({ orderBy: [{ fiscalYear: 'desc' }, { code: 'asc' }], include: { branch: { select: { name: true } } } });
  const balances = await fundBalances(funds.map((f) => f.id));
  res.json(
    funds.map((f) => {
      const b = balances.get(f.id) ?? { committed: 0, spent: 0 };
      return { ...f, committed: b.committed, spent: b.spent, available: Number(f.allocated) - b.committed - b.spent };
    }),
  );
});

acquisitionsRouter.post('/funds', async (req, res) => {
  const fund = await prisma.fund.create({ data: fundSchema.parse(req.body) });
  await audit(req.user!.id, 'create', 'Fund', fund.id, { code: fund.code });
  res.status(201).json(fund);
});

acquisitionsRouter.patch('/funds/:id', async (req, res) => {
  const fund = await prisma.fund.update({ where: { id: param(req) }, data: fundSchema.partial().parse(req.body) });
  await audit(req.user!.id, 'update', 'Fund', fund.id);
  res.json(fund);
});

// ---------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------

const orderInclude = {
  vendor: { select: { id: true, name: true, email: true, discountPercent: true } },
  branch: { select: { id: true, name: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  lines: {
    include: {
      biblio: { select: { id: true, title: true, authors: true, isbn13: true } },
      fund: { select: { id: true, code: true, name: true } },
      itemType: { select: { id: true, name: true } },
      items: { select: { id: true, barcode: true, status: true } },
    },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.PurchaseOrderInclude;

function withTotals<T extends { lines: { quantity: number; quantityReceived: number; unitPrice: Prisma.Decimal }[] }>(order: T) {
  const total = order.lines.reduce((s, l) => s + l.quantity * Number(l.unitPrice), 0);
  const received = order.lines.reduce((s, l) => s + l.quantityReceived * Number(l.unitPrice), 0);
  const copies = order.lines.reduce((s, l) => s + l.quantity, 0);
  const copiesReceived = order.lines.reduce((s, l) => s + l.quantityReceived, 0);
  return { ...order, totals: { total, received, copies, copiesReceived } };
}

acquisitionsRouter.get('/orders', async (req, res) => {
  const query = paginationSchema.extend({ status: z.enum(PurchaseOrderStatus).optional(), vendorId: z.string().optional() }).parse(req.query);
  const where = { status: query.status, vendorId: query.vendorId };
  const [data, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      include: {
        vendor: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        lines: { select: { quantity: true, quantityReceived: true, unitPrice: true } },
      },
      orderBy: { createdAt: 'desc' },
      ...toSkipTake(query),
    }),
    prisma.purchaseOrder.count({ where }),
  ]);
  res.json(paged(data.map(withTotals), total, query));
});

async function loadOrder(id: string) {
  const order = await prisma.purchaseOrder.findUnique({ where: { id }, include: orderInclude });
  if (!order) throw notFound('Purchase order not found');
  return withTotals(order);
}

acquisitionsRouter.get('/orders/:id', async (req, res) => {
  res.json(await loadOrder(param(req)));
});

const orderSchema = z.object({
  vendorId: z.string().min(1, 'Choose a vendor'),
  branchId: z.string().optional(),
  expectedAt: optionalDate,
  notes: optionalText(2000),
});

acquisitionsRouter.post('/orders', async (req, res) => {
  const input = orderSchema.parse(req.body);
  const branchId = input.branchId || (await workingBranchId(req));
  const order = await prisma.$transaction(async (tx) =>
    tx.purchaseOrder.create({
      data: { ...input, branchId, orderNumber: await generateOrderNumber(tx), createdById: req.user!.id },
    }),
  );
  await audit(req.user!.id, 'create', 'PurchaseOrder', order.id, { orderNumber: order.orderNumber });
  res.status(201).json(order);
});

acquisitionsRouter.patch('/orders/:id', async (req, res) => {
  const order = await prisma.purchaseOrder.findUnique({ where: { id: param(req) } });
  if (!order) throw notFound('Purchase order not found');
  if (['RECEIVED', 'CANCELLED'].includes(order.status)) throw conflict('Closed orders cannot be edited.');
  const input = orderSchema.partial().parse(req.body);
  await prisma.purchaseOrder.update({ where: { id: order.id }, data: input });
  res.json(await loadOrder(order.id));
});

const lineSchema = z.object({
  biblioId: z.string().min(1, 'Choose a title'),
  itemTypeId: z.string().min(1, 'Choose an item type'),
  fundId: optionalId,
  quantity: z.coerce.number().int().min(1).max(1000),
  unitPrice: money,
  notes: optionalText(500),
});

async function assertDraft(orderId: string) {
  const order = await prisma.purchaseOrder.findUnique({ where: { id: orderId } });
  if (!order) throw notFound('Purchase order not found');
  if (order.status !== 'DRAFT') throw conflict('Lines can only be changed while the order is a draft.');
  return order;
}

acquisitionsRouter.post('/orders/:id/lines', async (req, res) => {
  const order = await assertDraft(param(req));
  await prisma.orderLine.create({ data: { ...lineSchema.parse(req.body), orderId: order.id } });
  res.status(201).json(await loadOrder(order.id));
});

acquisitionsRouter.patch('/orders/:id/lines/:lineId', async (req, res) => {
  const order = await assertDraft(param(req));
  await prisma.orderLine.update({ where: { id: param(req, 'lineId'), orderId: order.id }, data: lineSchema.partial().parse(req.body) });
  res.json(await loadOrder(order.id));
});

acquisitionsRouter.delete('/orders/:id/lines/:lineId', async (req, res) => {
  const order = await assertDraft(param(req));
  await prisma.orderLine.delete({ where: { id: param(req, 'lineId'), orderId: order.id } });
  res.json(await loadOrder(order.id));
});

/** Sends the order to the vendor. Warns when a fund would be overspent. */
acquisitionsRouter.post('/orders/:id/place', async (req, res) => {
  const { override } = z.object({ override: z.boolean().default(false) }).parse(req.body ?? {});
  const order = await loadOrder(param(req));
  if (order.status !== 'DRAFT') throw conflict('Only draft orders can be placed.');
  if (!order.lines.length) throw badRequest('Add at least one title to the order.');

  const perFund = new Map<string, number>();
  for (const l of order.lines) if (l.fundId) perFund.set(l.fundId, (perFund.get(l.fundId) ?? 0) + l.quantity * Number(l.unitPrice));
  const funds = await prisma.fund.findMany({ where: { id: { in: [...perFund.keys()] } } });
  const balances = await fundBalances([...perFund.keys()]);
  const reasons = funds
    .map((f) => {
      const b = balances.get(f.id) ?? { committed: 0, spent: 0 };
      const available = Number(f.allocated) - b.committed - b.spent;
      const needed = perFund.get(f.id)!;
      return needed > available ? { code: 'FUND_OVERSPENT', message: `Fund ${f.code} has ${available.toFixed(2)} available but this order needs ${needed.toFixed(2)}.` } : null;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  if (reasons.length && !override) throw confirmationRequired(reasons);

  await prisma.purchaseOrder.update({ where: { id: order.id }, data: { status: 'ORDERED', orderedAt: new Date() } });
  await audit(req.user!.id, 'place', 'PurchaseOrder', order.id, { total: order.totals.total });
  res.json(await loadOrder(order.id));
});

const receiveSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: z.string(),
        quantity: z.coerce.number().int().min(1),
        barcodes: z.array(z.string().trim().min(1)).optional(),
        shelfLocation: optionalText(100),
      }),
    )
    .min(1),
  status: z.enum(['AVAILABLE', 'IN_PROCESSING']).default('IN_PROCESSING'),
});

/** Receives copies: creates catalog items with barcodes and updates the order status. */
acquisitionsRouter.post('/orders/:id/receive', async (req, res) => {
  const input = receiveSchema.parse(req.body);
  const settings = await getSettings();
  const orderId = param(req);
  const created = await prisma.$transaction(async (tx) => {
    const order = await tx.purchaseOrder.findUnique({ where: { id: orderId }, include: { lines: { include: { biblio: true } } } });
    if (!order) throw notFound('Purchase order not found');
    if (!['ORDERED', 'PARTIALLY_RECEIVED'].includes(order.status)) throw conflict('Only placed orders can be received.');

    const items = [];
    for (const r of input.lines) {
      const line = order.lines.find((l) => l.id === r.lineId);
      if (!line) throw badRequest('Order line not found.');
      const outstanding = line.quantity - line.quantityReceived;
      if (r.quantity > outstanding) throw badRequest(`Only ${outstanding} cop${outstanding === 1 ? 'y is' : 'ies are'} outstanding for "${line.biblio.title}".`);
      let barcodes = r.barcodes?.filter(Boolean) ?? [];
      if (barcodes.length && barcodes.length !== r.quantity) throw badRequest('Enter one barcode per copy, or leave barcodes blank to generate them.');
      if (barcodes.length) {
        const taken = await tx.item.findMany({ where: { barcode: { in: barcodes } }, select: { barcode: true } });
        if (taken.length) throw conflict(`Barcode already in use: ${taken.map((t) => t.barcode).join(', ')}`);
      } else {
        barcodes = await generateItemBarcodes(tx, settings.itemBarcodePrefix, r.quantity);
      }
      const existing = await tx.item.count({ where: { biblioId: line.biblioId } });
      for (const [i, barcode] of barcodes.entries()) {
        items.push(
          await tx.item.create({
            data: {
              barcode,
              biblioId: line.biblioId,
              itemTypeId: line.itemTypeId,
              homeBranchId: order.branchId,
              currentBranchId: order.branchId,
              callNumber: buildCallNumber(line.biblio),
              shelfLocation: r.shelfLocation,
              copyNumber: existing + i + 1,
              price: line.unitPrice,
              acquiredAt: new Date(),
              orderLineId: line.id,
              status: input.status,
            },
          }),
        );
      }
      await tx.orderLine.update({ where: { id: line.id }, data: { quantityReceived: { increment: r.quantity } } });
    }

    const lines = await tx.orderLine.findMany({ where: { orderId } });
    const complete = lines.every((l) => l.quantityReceived >= l.quantity);
    await tx.purchaseOrder.update({
      where: { id: orderId },
      data: { status: complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED', closedAt: complete ? new Date() : null },
    });
    return items;
  });
  await audit(req.user!.id, 'receive', 'PurchaseOrder', orderId, { items: created.map((i) => i.barcode) });
  res.json({ order: await loadOrder(orderId), items: created });
});

acquisitionsRouter.post('/orders/:id/cancel', async (req, res) => {
  const order = await prisma.purchaseOrder.findUnique({ where: { id: param(req) }, include: { lines: true } });
  if (!order) throw notFound('Purchase order not found');
  if (['RECEIVED', 'CANCELLED'].includes(order.status)) throw conflict('This order is already closed.');
  const anyReceived = order.lines.some((l) => l.quantityReceived > 0);
  // A partly received order is closed as received for what arrived; the rest is no longer committed.
  await prisma.purchaseOrder.update({
    where: { id: order.id },
    data: { status: anyReceived ? 'RECEIVED' : 'CANCELLED', closedAt: new Date() },
  });
  await audit(req.user!.id, anyReceived ? 'close' : 'cancel', 'PurchaseOrder', order.id);
  res.json(await loadOrder(order.id));
});
