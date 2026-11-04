import type { Prisma } from '@prisma/client';

type Db = Prisma.TransactionClient;

export interface ResolvedRule {
  id: string | null;
  loanPeriodDays: number;
  maxLoans: number;
  maxRenewals: number;
  maxHolds: number;
  holdPickupDays: number;
  finePerDay: Prisma.Decimal | number;
  maxFine: Prisma.Decimal | number | null;
}

/** Used only if the library has deleted its default rule. */
const FALLBACK: ResolvedRule = {
  id: null,
  loanPeriodDays: 14,
  maxLoans: 5,
  maxRenewals: 2,
  maxHolds: 5,
  holdPickupDays: 7,
  finePerDay: 0,
  maxFine: null,
};

/**
 * Finds the circulation rule for a branch / patron category / item type combination.
 * A blank value on a rule means "any". Precedence follows Koha: branch, then patron category,
 * then item type, so a branch-specific rule beats a library-wide one.
 */
export async function resolveRule(
  db: Db,
  ctx: { branchId?: string | null; patronCategoryId?: string | null; itemTypeId?: string | null },
): Promise<ResolvedRule> {
  const candidates = await db.circulationRule.findMany({
    where: {
      AND: [
        { OR: [{ branchId: null }, ...(ctx.branchId ? [{ branchId: ctx.branchId }] : [])] },
        { OR: [{ patronCategoryId: null }, ...(ctx.patronCategoryId ? [{ patronCategoryId: ctx.patronCategoryId }] : [])] },
        { OR: [{ itemTypeId: null }, ...(ctx.itemTypeId ? [{ itemTypeId: ctx.itemTypeId }] : [])] },
      ],
    },
  });
  if (!candidates.length) return FALLBACK;

  const score = (r: (typeof candidates)[number]) => (r.branchId ? 4 : 0) + (r.patronCategoryId ? 2 : 0) + (r.itemTypeId ? 1 : 0);
  return candidates.reduce((best, r) => (score(r) > score(best) ? r : best));
}
