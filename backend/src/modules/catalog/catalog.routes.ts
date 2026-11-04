import express, { Router } from 'express';
import { ItemStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { param } from '../../lib/http.js';
import { normalizeIsbn } from '../../lib/isbn.js';
import { buildCallNumber, CLASSIFICATION_PATTERN, normalizeClassification } from '../../lib/callNumber.js';
import { buildSearchFields } from '../../lib/text.js';
import { generateItemBarcodes } from '../../lib/counters.js';
import { getSettings } from '../../lib/settings.js';
import { workingBranchId } from '../../lib/branch.js';
import { paged, paginationSchema, toSkipTake } from '../../lib/pagination.js';
import { booleanQuery, emptyToNull, money, optionalDate, optionalText } from '../../lib/zod.js';
import {
  biblioToMarc,
  decodeIso2709,
  encodeIso2709,
  marcToBiblio,
  marcToText,
  parseMarcXml,
  toMarcXml,
  type MarcHolding,
  type MarcRecord,
} from '../../lib/marc.js';
import { requireStaff } from '../../middleware/auth.js';
import { accruedFine, setItemStatus } from '../circulation/circulation.service.js';
import { lookupIsbn } from './lookup.js';
import { searchBiblios, searchSchema } from './search.js';

export const catalogRouter = Router();
catalogRouter.use(requireStaff);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const stringList = z
  .array(z.string().trim().max(300))
  .default([])
  .transform((list) => [...new Set(list.filter(Boolean))]);

const biblioSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(500),
  subtitle: optionalText(500),
  authors: stringList,
  isbn: optionalText(40),
  issn: optionalText(20),
  publisher: optionalText(300),
  publicationPlace: optionalText(200),
  publicationYear: emptyToNull(z.coerce.number().int().min(1000).max(new Date().getFullYear() + 2).nullish()),
  edition: optionalText(100),
  physicalDescription: optionalText(300),
  language: optionalText(10),
  ddc: z
    .string()
    .max(30)
    .nullish()
    .transform(normalizeClassification)
    .refine((v) => v === null || CLASSIFICATION_PATTERN.test(v), 'Use a Dewey number such as 005.133, or a shelf label such as FIC, E, B or REF'),
  subjects: stringList,
  series: optionalText(300),
  summary: optionalText(5000),
  notes: optionalText(5000),
  coverUrl: z
    .string()
    .trim()
    .max(1000)
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^https?:\/\//.test(v), 'Cover must be an http(s) URL'),
  marc: z.any().optional(),
});

type BiblioInput = z.infer<typeof biblioSchema>;

/** Turns form input into database columns: ISBN normalisation and search columns. */
function toBiblioData(input: BiblioInput) {
  const { isbn, marc, ...rest } = input;
  let isbn13: string | null = null;
  let isbn10: string | null = null;
  if (isbn) {
    const n = normalizeIsbn(isbn);
    if (!n) throw badRequest('That ISBN is not valid. Check the digits (ISBN-10 or ISBN-13).', { isbn: ['Invalid ISBN checksum'] });
    isbn13 = n.isbn13;
    isbn10 = n.isbn10;
  }
  const data = { ...rest, isbn13, isbn10, publicationYear: rest.publicationYear ?? null };
  return {
    ...data,
    ...buildSearchFields({ ...data, authors: data.authors, subjects: data.subjects }),
    ...(marc !== undefined ? { marc: (marc ?? Prisma.JsonNull) as Prisma.InputJsonValue } : {}),
  };
}

const itemFields = {
  itemTypeId: z.string().min(1, 'Choose an item type'),
  homeBranchId: z.string().min(1, 'Choose a branch'),
  callNumber: optionalText(100),
  shelfLocation: optionalText(100),
  enumeration: optionalText(100),
  price: emptyToNull(money.nullish()),
  acquiredAt: optionalDate,
  notes: optionalText(2000),
};

const addItemsSchema = z.object({
  ...itemFields,
  count: z.coerce.number().int().min(1).max(200).default(1),
  barcodes: z.array(z.string().trim().min(1).max(50)).optional(),
  status: z.enum(['AVAILABLE', 'IN_PROCESSING']).default('AVAILABLE'),
});

const updateItemSchema = z.object({
  ...itemFields,
  barcode: z.string().trim().min(1).max(50),
  currentBranchId: z.string().optional(),
  copyNumber: z.coerce.number().int().min(1).nullish(),
}).partial();

// ---------------------------------------------------------------------------
// Biblios
// ---------------------------------------------------------------------------

catalogRouter.get('/biblios', async (req, res) => {
  res.json(await searchBiblios(searchSchema.parse(req.query), { publicOnly: false }));
});

catalogRouter.get('/biblios/:id', async (req, res) => {
  const biblio = await prisma.biblio.findUnique({
    where: { id: param(req) },
    include: {
      items: {
        include: {
          itemType: true,
          homeBranch: { select: { id: true, code: true, name: true } },
          currentBranch: { select: { id: true, code: true, name: true } },
          loans: {
            where: { returnedAt: null },
            select: { id: true, dueAt: true, checkedOutAt: true, renewals: true, patron: { select: { id: true, firstName: true, lastName: true, cardNumber: true } } },
          },
          holds: { where: { status: { in: ['READY', 'IN_TRANSIT'] } }, select: { id: true, status: true, patron: { select: { id: true, firstName: true, lastName: true } } } },
        },
        orderBy: [{ homeBranch: { name: 'asc' } }, { barcode: 'asc' }],
      },
      holds: {
        where: { status: { in: ['PENDING', 'IN_TRANSIT', 'READY'] } },
        orderBy: { placedAt: 'asc' },
        include: {
          patron: { select: { id: true, firstName: true, lastName: true, cardNumber: true } },
          pickupBranch: { select: { id: true, name: true } },
          item: { select: { id: true, barcode: true } },
        },
      },
      orderLines: { include: { order: { select: { id: true, orderNumber: true, status: true } } } },
      subscriptions: { select: { id: true, frequency: true, isActive: true } },
    },
  });
  if (!biblio) throw notFound('Title not found');
  const { searchText: _s, authorsText: _a, subjectsText: _sub, ...rest } = biblio;
  res.json({ ...rest, suggestedCallNumber: buildCallNumber(biblio) });
});

catalogRouter.post('/biblios', async (req, res) => {
  const input = biblioSchema.parse(req.body);
  const data = toBiblioData(input);
  if (data.isbn13 && !req.query.allowDuplicate) {
    const dup = await prisma.biblio.findFirst({ where: { isbn13: data.isbn13 }, select: { id: true, title: true } });
    if (dup) throw conflict(`"${dup.title}" with this ISBN is already in the catalog (${dup.id}). Add copies to it instead.`, 'DUPLICATE_ISBN');
  }
  const biblio = await prisma.biblio.create({ data });
  await audit(req.user!.id, 'create', 'Biblio', biblio.id, { title: biblio.title });
  res.status(201).json(biblio);
});

catalogRouter.patch('/biblios/:id', async (req, res) => {
  const existing = await prisma.biblio.findUnique({ where: { id: param(req) } });
  if (!existing) throw notFound('Title not found');
  const input = biblioSchema.partial().parse(req.body);
  // Merge with stored values so search columns are rebuilt from the full record.
  const merged = biblioSchema.parse({
    ...existing,
    isbn: existing.isbn13,
    ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
    ...(input.isbn === undefined ? {} : { isbn: input.isbn }),
  });
  if (input.marc === undefined) delete merged.marc;
  const biblio = await prisma.biblio.update({ where: { id: existing.id }, data: toBiblioData(merged) });
  await audit(req.user!.id, 'update', 'Biblio', biblio.id, { fields: Object.keys(input) });
  res.json(biblio);
});

catalogRouter.delete('/biblios/:id', async (req, res) => {
  const id = param(req);
  const biblio = await prisma.biblio.findUnique({ where: { id }, include: { _count: { select: { items: true, orderLines: true } } } });
  if (!biblio) throw notFound('Title not found');
  if (biblio._count.items) throw conflict('Delete or withdraw all copies before deleting the title.');
  if (biblio._count.orderLines) throw conflict('This title is on a purchase order and cannot be deleted.');
  await prisma.biblio.delete({ where: { id } });
  await audit(req.user!.id, 'delete', 'Biblio', id, { title: biblio.title });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// ISBN lookup (copy cataloging)
// ---------------------------------------------------------------------------

catalogRouter.get('/lookup/isbn/:isbn', async (req, res) => {
  const raw = param(req, 'isbn');
  const isbn = normalizeIsbn(raw);
  if (!isbn) throw badRequest('That is not a valid ISBN-10 or ISBN-13.');
  const existing = await prisma.biblio.findFirst({ where: { isbn13: isbn.isbn13 }, select: { id: true, title: true } });
  const result = await lookupIsbn(isbn.isbn13);
  res.json({ ...result, isbn, existing });
});

// ---------------------------------------------------------------------------
// MARC
// ---------------------------------------------------------------------------

const holdingSelect = {
  barcode: true,
  callNumber: true,
  shelfLocation: true,
  price: true,
  enumeration: true,
  homeBranch: { select: { code: true } },
  currentBranch: { select: { code: true } },
  itemType: { select: { code: true } },
} satisfies Prisma.ItemSelect;

function holdingsOf(items: Prisma.ItemGetPayload<{ select: typeof holdingSelect }>[]): MarcHolding[] {
  return items.map((i) => ({
    barcode: i.barcode,
    callNumber: i.callNumber ?? undefined,
    shelfLocation: i.shelfLocation ?? undefined,
    price: i.price?.toString(),
    enumeration: i.enumeration ?? undefined,
    homeBranchCode: i.homeBranch.code,
    currentBranchCode: i.currentBranch.code,
    itemTypeCode: i.itemType.code,
  }));
}

function sendMarc(res: express.Response, records: MarcRecord[], format: string, filename: string) {
  if (format === 'xml') {
    res.setHeader('Content-Type', 'application/marcxml+xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xml"`);
    res.send(toMarcXml(records));
  } else if (format === 'mrc') {
    res.setHeader('Content-Type', 'application/marc');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.mrc"`);
    res.send(Buffer.concat(records.map(encodeIso2709)));
  } else {
    res.json(records.length === 1 ? { record: records[0], text: marcToText(records[0]) } : records);
  }
}

catalogRouter.get('/biblios/:id/marc', async (req, res) => {
  const { format } = z.object({ format: z.enum(['json', 'xml', 'mrc']).default('json') }).parse(req.query);
  const biblio = await prisma.biblio.findUnique({ where: { id: param(req) }, include: { items: { select: holdingSelect } } });
  if (!biblio) throw notFound('Title not found');
  sendMarc(res, [biblioToMarc(biblio, holdingsOf(biblio.items))], format, `biblio-${biblio.id}`);
});

catalogRouter.get('/export', async (req, res) => {
  const { format, ids } = z
    .object({ format: z.enum(['xml', 'mrc']).default('mrc'), ids: z.string().optional() })
    .parse(req.query);
  const where = ids ? { id: { in: ids.split(',') } } : {};
  const biblios = await prisma.biblio.findMany({ where, include: { items: { select: holdingSelect } }, orderBy: { createdAt: 'asc' } });
  await audit(req.user!.id, 'export', 'Biblio', undefined, { count: biblios.length, format });
  sendMarc(res, biblios.map((b) => biblioToMarc(b, holdingsOf(b.items))), format, `catalog-${new Date().toISOString().slice(0, 10)}`);
});

const importQuerySchema = z.object({
  dryRun: booleanQuery,
  createItems: booleanQuery,
  skipDuplicates: booleanQuery,
});

/** Accepts a .mrc (ISO 2709) or MARCXML file as the raw request body. */
catalogRouter.post('/import', express.raw({ type: () => true, limit: '50mb' }), async (req, res) => {
  const opts = importQuerySchema.parse(req.query);
  const body = req.body as Buffer;
  if (!Buffer.isBuffer(body) || !body.length) throw badRequest('Upload a MARC file (.mrc or .xml).');

  let records: MarcRecord[];
  try {
    const head = body.subarray(0, 200).toString('utf8').trimStart();
    records = head.startsWith('<') ? parseMarcXml(body.toString('utf8')) : decodeIso2709(body);
  } catch (err) {
    throw badRequest(`Could not read the MARC file: ${err instanceof Error ? err.message : 'unknown format'}`);
  }
  if (!records.length) throw badRequest('No MARC records were found in the file.');

  const settings = await getSettings();
  const [branches, itemTypes] = await Promise.all([prisma.branch.findMany(), prisma.itemType.findMany()]);
  const branchByCode = new Map(branches.map((b) => [b.code.toUpperCase(), b]));
  const typeByCode = new Map(itemTypes.map((t) => [t.code.toUpperCase(), t]));
  const defaultBranchId = await workingBranchId(req);
  const defaultType = typeByCode.get('BOOK') ?? itemTypes[0];

  const results: { index: number; title: string; isbn: string | null; status: 'created' | 'duplicate' | 'error' | 'preview'; message?: string; biblioId?: string; items?: number }[] = [];

  for (const [index, record] of records.entries()) {
    const { biblio: fields, holdings } = marcToBiblio(record);
    const isbn = fields.isbn13 ?? null;
    try {
      const dup = isbn ? await prisma.biblio.findFirst({ where: { isbn13: isbn }, select: { id: true } }) : null;
      if (dup && opts.skipDuplicates) {
        results.push({ index, title: fields.title, isbn, status: 'duplicate', biblioId: dup.id, message: 'Already in catalog (skipped)' });
        continue;
      }
      if (opts.dryRun) {
        results.push({ index, title: fields.title, isbn, status: 'preview', items: opts.createItems ? holdings.length : 0, message: dup ? 'Duplicate ISBN' : undefined });
        continue;
      }
      const created = await prisma.$transaction(async (tx) => {
        const data = toBiblioData(biblioSchema.parse({ ...fields, isbn, marc: record }));
        const biblio = await tx.biblio.create({ data });
        let itemCount = 0;
        if (opts.createItems && holdings.length) {
          const missing = holdings.filter((h) => !h.barcode).length;
          const generated = missing ? await generateItemBarcodes(tx, settings.itemBarcodePrefix, missing) : [];
          for (const h of holdings) {
            const barcode = h.barcode ?? generated.shift()!;
            if (await tx.item.findUnique({ where: { barcode }, select: { id: true } })) continue;
            const home = (h.homeBranchCode && branchByCode.get(h.homeBranchCode.toUpperCase())?.id) || defaultBranchId;
            const current = (h.currentBranchCode && branchByCode.get(h.currentBranchCode.toUpperCase())?.id) || home;
            const price = h.price ? Number(h.price.replace(/[^0-9.]/g, '')) : NaN;
            await tx.item.create({
              data: {
                biblioId: biblio.id,
                barcode,
                itemTypeId: (h.itemTypeCode && typeByCode.get(h.itemTypeCode.toUpperCase())?.id) || defaultType.id,
                homeBranchId: home,
                currentBranchId: current,
                callNumber: h.callNumber ?? buildCallNumber(biblio),
                shelfLocation: h.shelfLocation ?? null,
                enumeration: h.enumeration ?? null,
                price: Number.isFinite(price) ? price : null,
                acquiredAt: new Date(),
              },
            });
            itemCount++;
          }
        }
        return { biblio, itemCount };
      });
      results.push({ index, title: fields.title, isbn, status: 'created', biblioId: created.biblio.id, items: created.itemCount });
    } catch (err) {
      results.push({ index, title: fields.title, isbn, status: 'error', message: err instanceof Error ? err.message : 'Failed' });
    }
  }

  if (!opts.dryRun) {
    await audit(req.user!.id, 'import', 'Biblio', undefined, {
      records: records.length,
      created: results.filter((r) => r.status === 'created').length,
    });
  }
  res.json({
    total: records.length,
    created: results.filter((r) => r.status === 'created').length,
    duplicates: results.filter((r) => r.status === 'duplicate').length,
    errors: results.filter((r) => r.status === 'error').length,
    results,
  });
});

// ---------------------------------------------------------------------------
// Items (physical copies)
// ---------------------------------------------------------------------------

const itemDetailInclude = {
  biblio: { select: { id: true, title: true, subtitle: true, authors: true, isbn13: true, ddc: true, coverUrl: true } },
  itemType: true,
  homeBranch: { select: { id: true, code: true, name: true } },
  currentBranch: { select: { id: true, code: true, name: true } },
  loans: {
    where: { returnedAt: null },
    include: { patron: { select: { id: true, firstName: true, lastName: true, cardNumber: true, patronCategoryId: true } } },
  },
  holds: {
    where: { status: { in: ['READY', 'IN_TRANSIT'] } },
    include: { patron: { select: { id: true, firstName: true, lastName: true } }, pickupBranch: { select: { name: true } } },
  },
  transfers: {
    where: { status: 'IN_TRANSIT' },
    include: { fromBranch: { select: { name: true } }, toBranch: { select: { name: true } } },
  },
  orderLine: { select: { id: true, order: { select: { id: true, orderNumber: true } } } },
} satisfies Prisma.ItemInclude;

const itemListSchema = paginationSchema.extend({
  q: z.string().trim().optional(),
  status: z.enum(ItemStatus).optional(),
  branchId: z.string().optional(),
  itemTypeId: z.string().optional(),
  shelfLocation: z.string().optional(),
});

catalogRouter.get('/items', async (req, res) => {
  const query = itemListSchema.parse(req.query);
  const where: Prisma.ItemWhereInput = {
    status: query.status,
    itemTypeId: query.itemTypeId,
    shelfLocation: query.shelfLocation,
    ...(query.branchId ? { OR: [{ currentBranchId: query.branchId }, { homeBranchId: query.branchId }] } : {}),
    ...(query.q
      ? {
          AND: [
            {
              OR: [
                { barcode: { contains: query.q, mode: 'insensitive' } },
                { callNumber: { contains: query.q, mode: 'insensitive' } },
                { biblio: { title: { contains: query.q, mode: 'insensitive' } } },
              ],
            },
          ],
        }
      : {}),
  };
  const [data, total] = await Promise.all([
    prisma.item.findMany({
      where,
      include: {
        biblio: { select: { id: true, title: true, authors: true } },
        itemType: { select: { id: true, name: true } },
        homeBranch: { select: { id: true, name: true } },
        currentBranch: { select: { id: true, name: true } },
      },
      orderBy: [{ updatedAt: 'desc' }],
      ...toSkipTake(query),
    }),
    prisma.item.count({ where }),
  ]);
  res.json(paged(data, total, query));
});

catalogRouter.get('/items/barcode/:barcode', async (req, res) => {
  const item = await prisma.item.findUnique({ where: { barcode: param(req, 'barcode').trim() }, include: itemDetailInclude });
  if (!item) throw notFound(`No item with barcode "${param(req, 'barcode')}"`);
  res.json(item);
});

catalogRouter.get('/items/:id', async (req, res) => {
  const item = await prisma.item.findUnique({ where: { id: param(req) }, include: itemDetailInclude });
  if (!item) throw notFound('Item not found');
  const settings = await getSettings();
  const loan = item.loans[0];
  const fine = loan ? await accruedFine(prisma, loan, { patronCategoryId: loan.patron.patronCategoryId, itemTypeId: item.itemTypeId }, settings) : 0;
  res.json({ ...item, accruedFine: fine });
});

catalogRouter.get('/items/:id/history', async (req, res) => {
  const query = paginationSchema.parse(req.query);
  const where = { itemId: param(req) };
  const [data, total] = await Promise.all([
    prisma.loan.findMany({
      where,
      include: {
        patron: { select: { id: true, firstName: true, lastName: true, cardNumber: true } },
        branch: { select: { name: true } },
        returnBranch: { select: { name: true } },
      },
      orderBy: { checkedOutAt: 'desc' },
      ...toSkipTake(query),
    }),
    prisma.loan.count({ where }),
  ]);
  res.json(paged(data, total, query));
});

catalogRouter.post('/biblios/:id/items', async (req, res) => {
  const input = addItemsSchema.parse(req.body);
  const biblio = await prisma.biblio.findUnique({ where: { id: param(req) } });
  if (!biblio) throw notFound('Title not found');
  const settings = await getSettings();
  const count = input.barcodes?.length || input.count;

  const items = await prisma.$transaction(async (tx) => {
    let barcodes = input.barcodes ?? [];
    if (barcodes.length) {
      const taken = await tx.item.findMany({ where: { barcode: { in: barcodes } }, select: { barcode: true } });
      if (taken.length) throw conflict(`Barcode already in use: ${taken.map((t) => t.barcode).join(', ')}`);
      if (new Set(barcodes).size !== barcodes.length) throw badRequest('The same barcode was entered twice.');
    } else {
      barcodes = await generateItemBarcodes(tx, settings.itemBarcodePrefix, count);
    }
    const existingCopies = await tx.item.count({ where: { biblioId: biblio.id } });
    const callNumber = input.callNumber ?? buildCallNumber(biblio);
    const created = [];
    for (const [i, barcode] of barcodes.entries()) {
      created.push(
        await tx.item.create({
          data: {
            biblioId: biblio.id,
            barcode,
            itemTypeId: input.itemTypeId,
            homeBranchId: input.homeBranchId,
            currentBranchId: input.homeBranchId,
            callNumber,
            shelfLocation: input.shelfLocation,
            enumeration: input.enumeration,
            copyNumber: existingCopies + i + 1,
            price: input.price ?? null,
            acquiredAt: input.acquiredAt ?? new Date(),
            status: input.status,
            notes: input.notes,
          },
        }),
      );
    }
    return created;
  });
  await audit(req.user!.id, 'create', 'Item', undefined, { biblioId: biblio.id, barcodes: items.map((i) => i.barcode) });
  res.status(201).json(items);
});

catalogRouter.patch('/items/:id', async (req, res) => {
  const input = updateItemSchema.parse(req.body);
  const item = await prisma.item.update({ where: { id: param(req) }, data: input, include: itemDetailInclude });
  await audit(req.user!.id, 'update', 'Item', item.id, { fields: Object.keys(input) });
  res.json(item);
});

const statusSchema = z.object({ status: z.enum(ItemStatus), note: optionalText(500) });

catalogRouter.post('/items/:id/status', async (req, res) => {
  const { status, note } = statusSchema.parse(req.body);
  const result = await setItemStatus({ itemId: param(req), status, staffId: req.user!.id, note });
  await audit(req.user!.id, 'status', 'Item', result.item.id, { status, note, charged: result.charged?.amount.toString() });
  res.json(result);
});

catalogRouter.delete('/items/:id', async (req, res) => {
  const id = param(req);
  const item = await prisma.item.findUnique({ where: { id }, include: { _count: { select: { loans: true } } } });
  if (!item) throw notFound('Item not found');
  if (item._count.loans) throw conflict('This copy has circulation history. Mark it withdrawn instead of deleting it.');
  await prisma.$transaction([
    prisma.hold.updateMany({ where: { itemId: id }, data: { itemId: null, status: 'PENDING' } }),
    prisma.transfer.deleteMany({ where: { itemId: id } }),
    prisma.inventoryScan.updateMany({ where: { itemId: id }, data: { itemId: null } }),
    prisma.item.delete({ where: { id } }),
  ]);
  await audit(req.user!.id, 'delete', 'Item', id, { barcode: item.barcode });
  res.status(204).end();
});

/** Data for printing spine and barcode labels. */
catalogRouter.get('/labels', async (req, res) => {
  const { ids, biblioId } = z.object({ ids: z.string().optional(), biblioId: z.string().optional() }).parse(req.query);
  if (!ids && !biblioId) throw badRequest('Choose items to print labels for.');
  const items = await prisma.item.findMany({
    where: ids ? { id: { in: ids.split(',') } } : { biblioId },
    select: {
      id: true,
      barcode: true,
      callNumber: true,
      enumeration: true,
      copyNumber: true,
      biblio: { select: { title: true, authors: true } },
      homeBranch: { select: { name: true, code: true } },
    },
    orderBy: { barcode: 'asc' },
  });
  res.json(items);
});
