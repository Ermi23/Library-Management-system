/**
 * Keyword search over the catalog, shared by the staff catalog and the OPAC.
 * Uses the denormalised, lower-cased Biblio.searchText column (GIN trigram index) and ranks with pg_trgm.
 */
import { Prisma, type ItemStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { escapeLike, normalizeText } from '../../lib/text.js';
import { normalizeIsbn } from '../../lib/isbn.js';

export const searchSchema = z.object({
  q: z.string().trim().max(300).optional().default(''),
  field: z.enum(['all', 'title', 'author', 'subject', 'isbn', 'ddc', 'series', 'publisher', 'barcode']).default('all'),
  itemTypeId: z.string().optional(),
  branchId: z.string().optional(),
  available: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0', ''])])
    .optional()
    .transform((v) => v === true || v === 'true' || v === '1'),
  language: z.string().max(10).optional(),
  yearFrom: z.coerce.number().int().optional(),
  yearTo: z.coerce.number().int().optional(),
  ddcClass: z.string().regex(/^\d$/).optional(),
  sort: z.enum(['relevance', 'title', 'newest', 'year_desc', 'year_asc', 'author']).default('relevance'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type SearchParams = z.infer<typeof searchSchema>;

const like = (token: string) => `%${escapeLike(token)}%`;

function buildWhere(p: SearchParams, opts: { publicOnly: boolean }): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];
  const q = normalizeText(p.q);
  const tokens = q.split(' ').filter(Boolean).slice(0, 12);

  if (tokens.length) {
    switch (p.field) {
      case 'title':
        for (const t of tokens) conditions.push(Prisma.sql`lower(b."title" || ' ' || coalesce(b."subtitle", '')) LIKE ${like(t)}`);
        break;
      case 'author':
        for (const t of tokens) conditions.push(Prisma.sql`b."authorsText" LIKE ${like(t)}`);
        break;
      case 'subject':
        for (const t of tokens) conditions.push(Prisma.sql`b."subjectsText" LIKE ${like(t)}`);
        break;
      case 'series':
        conditions.push(Prisma.sql`lower(coalesce(b."series", '')) LIKE ${like(q)}`);
        break;
      case 'publisher':
        conditions.push(Prisma.sql`lower(coalesce(b."publisher", '')) LIKE ${like(q)}`);
        break;
      case 'ddc':
        conditions.push(Prisma.sql`b."ddc" LIKE ${`${escapeLike(p.q.trim())}%`}`);
        break;
      case 'isbn': {
        const isbn = normalizeIsbn(p.q);
        const digits = p.q.replace(/[^0-9Xx]/g, '').toUpperCase();
        conditions.push(
          isbn
            ? Prisma.sql`(b."isbn13" = ${isbn.isbn13} OR b."isbn10" = ${isbn.isbn10 ?? ''})`
            : Prisma.sql`(b."isbn13" LIKE ${`%${digits}%`} OR b."isbn10" LIKE ${`%${digits}%`} OR b."issn" LIKE ${`%${p.q.trim()}%`})`,
        );
        break;
      }
      case 'barcode':
        conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM "Item" bi WHERE bi."biblioId" = b."id" AND bi."barcode" = ${p.q.trim()})`);
        break;
      default: {
        const isbn = normalizeIsbn(p.q);
        const keyword = Prisma.join(
          tokens.map((t) => Prisma.sql`b."searchText" LIKE ${like(t)}`),
          ' AND ',
        );
        // Also match an exact item barcode or ISBN typed into the general search box.
        conditions.push(
          Prisma.sql`((${keyword})
            OR EXISTS (SELECT 1 FROM "Item" bi WHERE bi."biblioId" = b."id" AND bi."barcode" = ${p.q.trim()})
            ${isbn ? Prisma.sql`OR b."isbn13" = ${isbn.isbn13}` : Prisma.empty})`,
        );
      }
    }
  }

  if (p.language) conditions.push(Prisma.sql`b."language" = ${p.language}`);
  if (p.yearFrom) conditions.push(Prisma.sql`b."publicationYear" >= ${p.yearFrom}`);
  if (p.yearTo) conditions.push(Prisma.sql`b."publicationYear" <= ${p.yearTo}`);
  if (p.ddcClass) conditions.push(Prisma.sql`b."ddc" LIKE ${`${p.ddcClass}%`}`);

  const itemConditions: Prisma.Sql[] = [];
  if (p.itemTypeId) itemConditions.push(Prisma.sql`i."itemTypeId" = ${p.itemTypeId}`);
  if (p.branchId) itemConditions.push(Prisma.sql`i."currentBranchId" = ${p.branchId}`);
  if (p.available) itemConditions.push(Prisma.sql`i."status" = 'AVAILABLE'::"ItemStatus"`);
  if (opts.publicOnly) itemConditions.push(Prisma.sql`i."status" <> 'WITHDRAWN'::"ItemStatus"`);
  if (itemConditions.length && (p.itemTypeId || p.branchId || p.available)) {
    conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM "Item" i WHERE i."biblioId" = b."id" AND ${Prisma.join(itemConditions, ' AND ')})`);
  }

  return conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
}

function buildOrder(p: SearchParams): Prisma.Sql {
  const q = normalizeText(p.q);
  switch (p.sort) {
    case 'title':
      return Prisma.sql`ORDER BY lower(b."title") ASC, b."id"`;
    case 'author':
      return Prisma.sql`ORDER BY b."authorsText" ASC, lower(b."title") ASC, b."id"`;
    case 'newest':
      return Prisma.sql`ORDER BY b."createdAt" DESC, b."id"`;
    case 'year_desc':
      return Prisma.sql`ORDER BY b."publicationYear" DESC NULLS LAST, lower(b."title"), b."id"`;
    case 'year_asc':
      return Prisma.sql`ORDER BY b."publicationYear" ASC NULLS LAST, lower(b."title"), b."id"`;
    default:
      return q
        ? Prisma.sql`ORDER BY (similarity(lower(b."title"), ${q}) * 2 + word_similarity(${q}, b."searchText")) DESC, lower(b."title"), b."id"`
        : Prisma.sql`ORDER BY b."createdAt" DESC, b."id"`;
  }
}

const summaryItemSelect = {
  id: true,
  status: true,
  callNumber: true,
  currentBranch: { select: { id: true, name: true } },
  itemType: { select: { id: true, name: true, notForLoan: true } },
} satisfies Prisma.ItemSelect;

export interface AvailabilitySummary {
  total: number;
  available: number;
  onLoan: number;
  branches: { id: string; name: string; available: number; total: number }[];
  callNumber: string | null;
  itemTypes: string[];
}

export function summarizeItems(items: Prisma.ItemGetPayload<{ select: typeof summaryItemSelect }>[], publicOnly: boolean): AvailabilitySummary {
  const visible = publicOnly ? items.filter((i) => i.status !== 'WITHDRAWN') : items;
  const branches = new Map<string, { id: string; name: string; available: number; total: number }>();
  for (const i of visible) {
    const b = branches.get(i.currentBranch.id) ?? { ...i.currentBranch, available: 0, total: 0 };
    b.total += 1;
    if (i.status === 'AVAILABLE') b.available += 1;
    branches.set(i.currentBranch.id, b);
  }
  const count = (s: ItemStatus) => visible.filter((i) => i.status === s).length;
  return {
    total: visible.length,
    available: count('AVAILABLE'),
    onLoan: count('ON_LOAN'),
    branches: [...branches.values()],
    callNumber: visible.find((i) => i.callNumber)?.callNumber ?? null,
    itemTypes: [...new Set(visible.map((i) => i.itemType.name))],
  };
}

export async function searchBiblios(p: SearchParams, opts: { publicOnly: boolean }) {
  const where = buildWhere(p, opts);
  const offset = (p.page - 1) * p.pageSize;

  const [countRows, idRows] = await Promise.all([
    prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*)::bigint AS count FROM "Biblio" b ${where}`,
    prisma.$queryRaw<{ id: string }[]>`SELECT b."id" FROM "Biblio" b ${where} ${buildOrder(p)} LIMIT ${p.pageSize} OFFSET ${offset}`,
  ]);
  const total = Number(countRows[0]?.count ?? 0);
  const ids = idRows.map((r) => r.id);

  const biblios = ids.length
    ? await prisma.biblio.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          title: true,
          subtitle: true,
          authors: true,
          isbn13: true,
          publisher: true,
          publicationYear: true,
          edition: true,
          ddc: true,
          series: true,
          language: true,
          coverUrl: true,
          subjects: true,
          items: { select: summaryItemSelect },
          _count: { select: { holds: { where: { status: { in: ['PENDING', 'IN_TRANSIT', 'READY'] } } } } },
        },
      })
    : [];
  const byId = new Map(biblios.map((b) => [b.id, b]));

  const data = ids
    .map((id) => byId.get(id))
    .filter((b): b is NonNullable<typeof b> => !!b)
    .map(({ items, _count, ...b }) => ({ ...b, activeHolds: _count.holds, availability: summarizeItems(items, opts.publicOnly) }));

  return { data, total, page: p.page, pageSize: p.pageSize, totalPages: Math.max(1, Math.ceil(total / p.pageSize)) };
}
