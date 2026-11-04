/**
 * Circulation engine: checkout, checkin, renewal, holds, fines and routing of copies between branches.
 * Every operation runs in one database transaction so item status, loans, holds and fines stay consistent.
 */
import { Prisma, type ItemStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { conflict, confirmationRequired, notFound, badRequest, type Reason } from '../../lib/errors.js';
import { addDays, daysLate, endOfDay } from '../../lib/dates.js';
import { resolveRule } from '../../lib/rules.js';
import { getSettings, type LibrarySettings } from '../../lib/settings.js';
import { createNotice, flushEmails } from '../notices/notices.service.js';

type Db = Prisma.TransactionClient;

const TX_OPTIONS = { timeout: 20_000, maxWait: 10_000 };

/** Statuses a librarian sets by hand; the item keeps them through checkin and is not used to fill holds. */
const MANUAL_HOLD_STATUSES: ItemStatus[] = ['DAMAGED', 'WITHDRAWN', 'IN_PROCESSING'];

const patronSelect = {
  id: true,
  firstName: true,
  lastName: true,
  cardNumber: true,
  email: true,
  status: true,
  expiresAt: true,
  patronCategoryId: true,
} satisfies Prisma.UserSelect;

const itemInclude = {
  biblio: { select: { id: true, title: true, authors: true } },
  itemType: true,
  homeBranch: { select: { id: true, code: true, name: true } },
  currentBranch: { select: { id: true, code: true, name: true } },
} satisfies Prisma.ItemInclude;

type ItemWithRefs = Prisma.ItemGetPayload<{ include: typeof itemInclude }>;

const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Patron eligibility and fines
// ---------------------------------------------------------------------------

export async function outstandingTotal(db: Db, patronId: string): Promise<number> {
  const agg = await db.fine.aggregate({ where: { patronId, status: 'OUTSTANDING' }, _sum: { outstanding: true } });
  return Number(agg._sum.outstanding ?? 0);
}

/** Reasons the patron should not borrow right now. Librarians may override them. */
export async function patronBlocks(
  db: Db,
  patron: { id: string; status: string; expiresAt: Date | null },
  settings: LibrarySettings,
): Promise<Reason[]> {
  const reasons: Reason[] = [];
  const now = new Date();
  if (patron.status === 'SUSPENDED') reasons.push({ code: 'PATRON_SUSPENDED', message: 'The patron account is suspended.' });
  if (patron.status === 'EXPIRED' || (patron.expiresAt && patron.expiresAt < now)) {
    reasons.push({
      code: 'MEMBERSHIP_EXPIRED',
      message: patron.expiresAt ? `Membership expired on ${isoDate(patron.expiresAt)}.` : 'Membership has expired.',
    });
  }
  const owed = await outstandingTotal(db, patron.id);
  if (owed > settings.maxOutstandingFines) {
    reasons.push({
      code: 'FINES',
      message: `Patron owes ${owed.toFixed(2)} ${settings.currency} (limit ${settings.maxOutstandingFines.toFixed(2)}).`,
    });
  }
  if (settings.blockOnOverdue) {
    const overdue = await db.loan.count({ where: { patronId: patron.id, returnedAt: null, dueAt: { lt: now } } });
    if (overdue) reasons.push({ code: 'OVERDUE', message: `Patron has ${overdue} overdue item(s).` });
  }
  return reasons;
}

/** Charges the overdue fine for a loan up to `until` (on return, or when an overdue loan is renewed). */
async function chargeOverdue(
  db: Db,
  loan: { id: string; dueAt: Date; branchId: string; patronId: string },
  ctx: { patronCategoryId: string | null; itemTypeId: string; title: string },
  until: Date,
  settings: LibrarySettings,
) {
  const days = daysLate(loan.dueAt, until);
  if (days <= settings.fineGraceDays) return null;
  const rule = await resolveRule(db, { branchId: loan.branchId, patronCategoryId: ctx.patronCategoryId, itemTypeId: ctx.itemTypeId });
  let amount = new Prisma.Decimal(rule.finePerDay).mul(days);
  if (rule.maxFine !== null && amount.gt(rule.maxFine)) amount = new Prisma.Decimal(rule.maxFine);
  if (amount.lte(0)) return null;
  return db.fine.create({
    data: {
      patronId: loan.patronId,
      loanId: loan.id,
      type: 'OVERDUE',
      amount,
      outstanding: amount,
      description: `${days} day${days === 1 ? '' : 's'} overdue: ${ctx.title}`,
    },
  });
}

/** Overdue fine accrued so far on an open loan (shown to staff and patrons before return). */
export async function accruedFine(
  db: Db,
  loan: { dueAt: Date; branchId: string },
  ctx: { patronCategoryId: string | null; itemTypeId: string },
  settings: LibrarySettings,
): Promise<number> {
  const days = daysLate(loan.dueAt, new Date());
  if (days <= settings.fineGraceDays) return 0;
  const rule = await resolveRule(db, { branchId: loan.branchId, ...ctx });
  let amount = Number(rule.finePerDay) * days;
  if (rule.maxFine !== null) amount = Math.min(amount, Number(rule.maxFine));
  return Math.round(amount * 100) / 100;
}

// ---------------------------------------------------------------------------
// Routing: where does a copy go after it is returned or released from a hold?
// ---------------------------------------------------------------------------

export type RouteAction = 'RESHELVE' | 'HOLD_SHELF' | 'TRANSFER_FOR_HOLD' | 'TRANSFER_HOME' | 'KEEP_ASIDE';

export interface RouteResult {
  action: RouteAction;
  message: string;
  hold?: { id: string; patronName: string; cardNumber: string | null; pickupBranch: string; expiresAt?: Date | null };
  toBranch?: { id: string; name: string };
}

async function routeItem(db: Db, item: ItemWithRefs, status: ItemStatus, branchId: string, settings: LibrarySettings, now: Date): Promise<RouteResult> {
  const canFillHolds = !item.itemType.notForLoan && !MANUAL_HOLD_STATUSES.includes(status);
  const holdInclude = { patron: { select: patronSelect }, pickupBranch: { select: { id: true, name: true } } } as const;

  // A hold already waiting for this copy, otherwise the oldest title-level hold in the queue.
  let hold = canFillHolds
    ? await db.hold.findFirst({ where: { itemId: item.id, status: { in: ['IN_TRANSIT', 'READY'] } }, include: holdInclude })
    : null;
  if (!hold && canFillHolds) {
    hold = await db.hold.findFirst({
      where: { biblioId: item.biblioId, status: 'PENDING', itemId: null, pickupBranch: { isActive: true } },
      orderBy: { placedAt: 'asc' },
      include: holdInclude,
    });
  }

  if (hold) {
    const holdInfo = { id: hold.id, patronName: fullName(hold.patron), cardNumber: hold.patron.cardNumber, pickupBranch: hold.pickupBranch.name };
    if (hold.pickupBranchId === branchId) {
      const rule = await resolveRule(db, { branchId, patronCategoryId: hold.patron.patronCategoryId, itemTypeId: item.itemTypeId });
      const expiresAt = endOfDay(addDays(now, rule.holdPickupDays));
      await db.hold.update({ where: { id: hold.id }, data: { status: 'READY', itemId: item.id, readyAt: now, expiresAt } });
      await db.item.update({ where: { id: item.id }, data: { status: 'ON_HOLD_SHELF', currentBranchId: branchId } });
      await createNotice(db, {
        patronId: hold.patronId,
        type: 'HOLD_READY',
        subject: `Ready for pickup: ${item.biblio.title}`,
        body: `"${item.biblio.title}" is waiting for you at ${hold.pickupBranch.name}. Please collect it by ${isoDate(expiresAt)}.`,
      });
      return {
        action: 'HOLD_SHELF',
        message: `Hold for ${holdInfo.patronName}: put it on the hold shelf.`,
        hold: { ...holdInfo, expiresAt },
      };
    }
    await db.hold.update({ where: { id: hold.id }, data: { status: 'IN_TRANSIT', itemId: item.id } });
    await db.item.update({ where: { id: item.id }, data: { status: 'IN_TRANSIT', currentBranchId: branchId } });
    await db.transfer.create({ data: { itemId: item.id, fromBranchId: branchId, toBranchId: hold.pickupBranchId, reason: 'HOLD' } });
    return {
      action: 'TRANSFER_FOR_HOLD',
      message: `Hold for ${holdInfo.patronName}: send to ${hold.pickupBranch.name}.`,
      hold: holdInfo,
      toBranch: { id: hold.pickupBranchId, name: hold.pickupBranch.name },
    };
  }

  const keepStatus = MANUAL_HOLD_STATUSES.includes(status);
  if (!keepStatus && settings.returnPolicy === 'home' && item.homeBranchId !== branchId) {
    await db.item.update({ where: { id: item.id }, data: { status: 'IN_TRANSIT', currentBranchId: branchId } });
    await db.transfer.create({ data: { itemId: item.id, fromBranchId: branchId, toBranchId: item.homeBranchId, reason: 'RETURN_HOME' } });
    return {
      action: 'TRANSFER_HOME',
      message: `Belongs to ${item.homeBranch.name}: send it home.`,
      toBranch: { id: item.homeBranch.id, name: item.homeBranch.name },
    };
  }

  await db.item.update({ where: { id: item.id }, data: { status: keepStatus ? status : 'AVAILABLE', currentBranchId: branchId } });
  return keepStatus
    ? { action: 'KEEP_ASIDE', message: `Item is marked ${status.replace('_', ' ').toLowerCase()}: do not reshelve.` }
    : { action: 'RESHELVE', message: 'Reshelve the item.' };
}

/** Puts a hold back in the queue (used when a librarian overrides it by lending the copy to someone else). */
async function requeueHold(db: Db, holdId: string, itemId: string) {
  await db.hold.update({ where: { id: holdId }, data: { status: 'PENDING', itemId: null, readyAt: null, expiresAt: null } });
  await db.transfer.updateMany({ where: { itemId, status: 'IN_TRANSIT' }, data: { status: 'CANCELLED' } });
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

export async function checkout(input: {
  patronId: string;
  barcode: string;
  branchId: string;
  staffId: string;
  override?: boolean;
  dueAt?: Date | null;
}) {
  const settings = await getSettings();
  return prisma.$transaction(async (tx) => {
    const patron = await tx.user.findUnique({ where: { id: input.patronId }, select: patronSelect });
    if (!patron) throw notFound('Patron not found');
    const item = await tx.item.findUnique({ where: { barcode: input.barcode.trim() }, include: itemInclude });
    if (!item) throw notFound(`No item with barcode "${input.barcode}"`);

    const reasons: Reason[] = await patronBlocks(tx, patron, settings);

    const activeLoan = await tx.loan.findFirst({
      where: { itemId: item.id, returnedAt: null },
      include: { patron: { select: patronSelect } },
    });
    if (activeLoan?.patronId === patron.id) {
      throw conflict('This item is already checked out to this patron. Renew it instead.', 'ALREADY_CHECKED_OUT');
    }
    if (activeLoan) {
      reasons.push({ code: 'ON_LOAN', message: `Checked out to ${fullName(activeLoan.patron)}; it will be checked in from them first.` });
    }

    const assignedHold = await tx.hold.findFirst({
      where: { itemId: item.id, status: { in: ['READY', 'IN_TRANSIT'] } },
      include: { patron: { select: patronSelect } },
    });
    const heldForOther = assignedHold && assignedHold.patronId !== patron.id ? assignedHold : null;
    if (heldForOther) reasons.push({ code: 'HELD_FOR_OTHER', message: `This copy is on hold for ${fullName(heldForOther.patron)}.` });

    if (item.status === 'IN_TRANSIT' && !assignedHold) reasons.push({ code: 'IN_TRANSIT', message: 'The item is in transit between branches.' });
    if (item.status === 'LOST' || item.status === 'MISSING') {
      reasons.push({ code: 'LOST', message: `The item is marked ${item.status.toLowerCase()}; checking it out will mark it found.` });
    }
    if (item.status === 'DAMAGED') reasons.push({ code: 'DAMAGED', message: 'The item is marked damaged.' });
    if (item.status === 'WITHDRAWN') reasons.push({ code: 'WITHDRAWN', message: 'The item has been withdrawn from the collection.' });
    if (item.status === 'IN_PROCESSING') reasons.push({ code: 'IN_PROCESSING', message: 'The item is still being processed.' });
    if (item.itemType.notForLoan) reasons.push({ code: 'NOT_FOR_LOAN', message: `${item.itemType.name} items are for library use only.` });

    const rule = await resolveRule(tx, { branchId: input.branchId, patronCategoryId: patron.patronCategoryId, itemTypeId: item.itemTypeId });
    const loanCount = await tx.loan.count({ where: { patronId: patron.id, returnedAt: null } });
    if (loanCount >= rule.maxLoans) reasons.push({ code: 'TOO_MANY_LOANS', message: `Patron already has ${loanCount} item(s) out (limit ${rule.maxLoans}).` });

    if (!assignedHold || heldForOther) {
      const waiting = await tx.hold.count({ where: { biblioId: item.biblioId, status: 'PENDING', patronId: { not: patron.id } } });
      if (waiting) reasons.push({ code: 'HAS_HOLDS', message: `${waiting} other patron(s) are waiting for this title.` });
    }

    if (reasons.length && !input.override) throw confirmationRequired(reasons);

    const now = new Date();
    if (activeLoan) {
      await tx.loan.update({ where: { id: activeLoan.id }, data: { returnedAt: now, returnBranchId: input.branchId, receivedById: input.staffId } });
      await chargeOverdue(tx, activeLoan, { patronCategoryId: activeLoan.patron.patronCategoryId, itemTypeId: item.itemTypeId, title: item.biblio.title }, now, settings);
    }
    if (heldForOther) await requeueHold(tx, heldForOther.id, item.id);
    if (item.status === 'LOST') {
      await tx.fine.updateMany({ where: { type: 'LOST', status: 'OUTSTANDING', loan: { itemId: item.id } }, data: { status: 'WAIVED', outstanding: 0 } });
    }
    await tx.transfer.updateMany({ where: { itemId: item.id, status: 'IN_TRANSIT' }, data: { status: 'CANCELLED' } });

    // Guard against two desks lending the same copy at the same moment.
    const claimed = await tx.item.updateMany({
      where: { id: item.id, status: item.status },
      data: { status: 'ON_LOAN', currentBranchId: input.branchId, lastSeenAt: now },
    });
    if (claimed.count !== 1) throw conflict('The item changed while checking out. Please scan it again.');

    const dueAt = input.dueAt ? endOfDay(input.dueAt) : endOfDay(addDays(now, rule.loanPeriodDays));
    const loan = await tx.loan.create({
      data: { itemId: item.id, patronId: patron.id, branchId: input.branchId, issuedById: input.staffId, checkedOutAt: now, dueAt },
    });

    // This checkout satisfies the patron's own hold on the title, if any.
    const ownHold = await tx.hold.findFirst({
      where: { biblioId: item.biblioId, patronId: patron.id, status: { in: ['PENDING', 'READY', 'IN_TRANSIT'] } },
      orderBy: { placedAt: 'asc' },
    });
    if (ownHold) {
      await tx.hold.update({ where: { id: ownHold.id }, data: { status: 'FULFILLED', fulfilledAt: now, itemId: item.id } });
      if (ownHold.itemId && ownHold.itemId !== item.id) {
        // A different copy was waiting for the patron: release it to the next person in line.
        const other = await tx.item.findUnique({ where: { id: ownHold.itemId }, include: itemInclude });
        if (other && other.status === 'ON_HOLD_SHELF') await routeItem(tx, other, 'AVAILABLE', other.currentBranchId, settings, now);
      }
    }

    return {
      loan: { ...loan, item: { id: item.id, barcode: item.barcode, callNumber: item.callNumber, biblio: item.biblio } },
      overridden: input.override ? reasons : [],
      holdFulfilled: !!ownHold,
    };
  }, TX_OPTIONS);
}

// ---------------------------------------------------------------------------
// Checkin
// ---------------------------------------------------------------------------

export async function checkin(input: { barcode: string; branchId: string; staffId: string }) {
  const settings = await getSettings();
  const result = await prisma.$transaction(async (tx) => {
    const item = await tx.item.findUnique({ where: { barcode: input.barcode.trim() }, include: itemInclude });
    if (!item) throw notFound(`No item with barcode "${input.barcode}"`);

    const now = new Date();
    const messages: string[] = [];
    const loan = await tx.loan.findFirst({ where: { itemId: item.id, returnedAt: null }, include: { patron: { select: patronSelect } } });

    let fine = null;
    if (loan) {
      await tx.loan.update({ where: { id: loan.id }, data: { returnedAt: now, returnBranchId: input.branchId, receivedById: input.staffId } });
      fine = await chargeOverdue(tx, loan, { patronCategoryId: loan.patron.patronCategoryId, itemTypeId: item.itemTypeId, title: item.biblio.title }, now, settings);
      if (fine) messages.push(`Overdue: ${fine.description}. Fine of ${fine.amount.toFixed(2)} ${settings.currency} charged.`);
    } else if (item.status === 'ON_LOAN' || item.status === 'AVAILABLE') {
      messages.push('The item was not checked out.');
    }

    if (item.status === 'LOST') {
      const waived = await tx.fine.updateMany({
        where: { type: 'LOST', status: 'OUTSTANDING', loan: { itemId: item.id } },
        data: { status: 'WAIVED', outstanding: 0 },
      });
      messages.push(waived.count ? 'Lost item found: the replacement charge was waived.' : 'Lost item found.');
    }
    if (item.status === 'MISSING') messages.push('Missing item found.');

    const transfer = await tx.transfer.findFirst({ where: { itemId: item.id, status: 'IN_TRANSIT' }, include: { toBranch: true } });
    if (transfer) {
      if (transfer.toBranchId === input.branchId) {
        await tx.transfer.update({ where: { id: transfer.id }, data: { status: 'RECEIVED', receivedAt: now } });
        messages.push('Transfer received.');
      } else {
        await tx.transfer.update({ where: { id: transfer.id }, data: { status: 'CANCELLED' } });
        messages.push(`The item was on its way to ${transfer.toBranch.name}; it has been rerouted.`);
      }
    }

    const statusForRouting: ItemStatus = MANUAL_HOLD_STATUSES.includes(item.status) ? item.status : 'AVAILABLE';
    const route = await routeItem(tx, item, statusForRouting, input.branchId, settings, now);
    await tx.item.update({ where: { id: item.id }, data: { lastSeenAt: now } });

    const updated = await tx.item.findUniqueOrThrow({ where: { id: item.id }, include: itemInclude });
    return {
      item: updated,
      loan: loan ? { id: loan.id, checkedOutAt: loan.checkedOutAt, dueAt: loan.dueAt, returnedAt: now, wasOverdue: loan.dueAt < now } : null,
      patron: loan?.patron ?? null,
      fine,
      route,
      messages,
    };
  }, TX_OPTIONS);
  flushEmails();
  return result;
}

// ---------------------------------------------------------------------------
// Renewal
// ---------------------------------------------------------------------------

export async function renew(input: { loanId: string; actor: 'staff' | 'patron'; patronId?: string; override?: boolean }) {
  const settings = await getSettings();
  return prisma.$transaction(async (tx) => {
    const loan = await tx.loan.findUnique({
      where: { id: input.loanId },
      include: { item: { include: itemInclude }, patron: { select: patronSelect } },
    });
    if (!loan || (input.patronId && loan.patronId !== input.patronId)) throw notFound('Loan not found');
    if (loan.returnedAt) throw conflict('This item has already been returned.');

    const rule = await resolveRule(tx, { branchId: loan.branchId, patronCategoryId: loan.patron.patronCategoryId, itemTypeId: loan.item.itemTypeId });
    const reasons: Reason[] = [];
    if (loan.renewals >= rule.maxRenewals) reasons.push({ code: 'TOO_MANY_RENEWALS', message: `Renewal limit reached (${rule.maxRenewals}).` });
    const waiting = await tx.hold.count({ where: { biblioId: loan.item.biblioId, status: 'PENDING', patronId: { not: loan.patronId } } });
    if (waiting) reasons.push({ code: 'HAS_HOLDS', message: `${waiting} other patron(s) are waiting for this title.` });
    reasons.push(...(await patronBlocks(tx, loan.patron, settings)).filter((r) => r.code !== 'OVERDUE'));

    if (input.actor === 'patron') {
      if (!settings.allowPatronRenewal) throw badRequest('Online renewal is turned off. Please contact the library.');
      if (reasons.length) throw badRequest(`This item cannot be renewed: ${reasons.map((r) => r.message).join(' ')}`);
    } else if (reasons.length && !input.override) {
      throw confirmationRequired(reasons);
    }

    const now = new Date();
    if (loan.dueAt < now) {
      await chargeOverdue(tx, loan, { patronCategoryId: loan.patron.patronCategoryId, itemTypeId: loan.item.itemTypeId, title: loan.item.biblio.title }, now, settings);
    }
    const proposed = endOfDay(addDays(now, rule.loanPeriodDays));
    const dueAt = proposed > loan.dueAt ? proposed : loan.dueAt;
    return tx.loan.update({
      where: { id: loan.id },
      data: { dueAt, renewals: { increment: 1 }, lastRenewedAt: now },
      include: { item: { select: { id: true, barcode: true, biblio: { select: { id: true, title: true } } } } },
    });
  }, TX_OPTIONS);
}

// ---------------------------------------------------------------------------
// Item status changes (lost, damaged, withdrawn, ...)
// ---------------------------------------------------------------------------

const SYSTEM_STATUSES: ItemStatus[] = ['ON_LOAN', 'ON_HOLD_SHELF', 'IN_TRANSIT'];

export async function setItemStatus(input: { itemId: string; status: ItemStatus; staffId: string; note?: string | null }) {
  if (SYSTEM_STATUSES.includes(input.status)) {
    throw badRequest('That status is set automatically by circulation. Use checkout, checkin or transfers instead.');
  }
  const settings = await getSettings();
  const result = await prisma.$transaction(async (tx) => {
    const item = await tx.item.findUnique({ where: { id: input.itemId }, include: itemInclude });
    if (!item) throw notFound('Item not found');
    const now = new Date();
    const loan = await tx.loan.findFirst({ where: { itemId: item.id, returnedAt: null }, include: { patron: { select: patronSelect } } });
    let charged = null;

    if (input.status === 'LOST' && loan) {
      // Close the loan and bill the patron for a replacement (refunded if the item comes back).
      await tx.loan.update({ where: { id: loan.id }, data: { returnedAt: now } });
      await chargeOverdue(tx, loan, { patronCategoryId: loan.patron.patronCategoryId, itemTypeId: item.itemTypeId, title: item.biblio.title }, now, settings);
      const amount = new Prisma.Decimal(item.price ?? settings.defaultReplacementCost).add(settings.lostProcessingFee);
      if (amount.gt(0)) {
        charged = await tx.fine.create({
          data: {
            patronId: loan.patronId,
            loanId: loan.id,
            type: 'LOST',
            amount,
            outstanding: amount,
            description: `Lost item replacement: ${item.biblio.title} (${item.barcode})`,
          },
        });
        await createNotice(tx, {
          patronId: loan.patronId,
          type: 'FINE',
          subject: `Item marked lost: ${item.biblio.title}`,
          body: `"${item.biblio.title}" has been marked lost and a replacement charge of ${amount.toFixed(2)} ${settings.currency} was added to your account. If you find it, return it and the charge will be removed.`,
          loanId: loan.id,
        });
      }
    } else if (loan) {
      throw conflict(`The item is checked out to ${fullName(loan.patron)}. Check it in first.`);
    }

    // Holds waiting on this copy go back into the queue.
    const assigned = await tx.hold.findMany({ where: { itemId: item.id, status: { in: ['READY', 'IN_TRANSIT'] } } });
    for (const h of assigned) await requeueHold(tx, h.id, item.id);
    if (!assigned.length) await tx.transfer.updateMany({ where: { itemId: item.id, status: 'IN_TRANSIT' }, data: { status: 'CANCELLED' } });

    const notes = input.note ? [item.notes, `${isoDate(now)} ${input.status}: ${input.note}`].filter(Boolean).join('\n') : item.notes;
    const updated = await tx.item.update({ where: { id: item.id }, data: { status: input.status, notes }, include: itemInclude });
    return { item: updated, charged, closedLoan: input.status === 'LOST' && loan ? loan.id : null };
  }, TX_OPTIONS);
  flushEmails();
  return result;
}

// ---------------------------------------------------------------------------
// Holds
// ---------------------------------------------------------------------------

export async function placeHold(input: {
  biblioId: string;
  patronId: string;
  pickupBranchId: string;
  actor: 'staff' | 'patron';
  override?: boolean;
  expiresAt?: Date | null;
  notes?: string | null;
}) {
  const settings = await getSettings();
  return prisma.$transaction(async (tx) => {
    if (input.actor === 'patron' && !settings.allowOpacHolds) throw badRequest('Online holds are turned off. Please contact the library.');

    const [patron, biblio, branch] = await Promise.all([
      tx.user.findUnique({ where: { id: input.patronId }, select: patronSelect }),
      tx.biblio.findUnique({ where: { id: input.biblioId }, include: { items: { include: { itemType: true } } } }),
      tx.branch.findUnique({ where: { id: input.pickupBranchId } }),
    ]);
    if (!patron) throw notFound('Patron not found');
    if (!biblio) throw notFound('Title not found');
    if (!branch || !branch.isActive) throw badRequest('Choose an active pickup branch.');

    const existing = await tx.hold.findFirst({
      where: { biblioId: biblio.id, patronId: patron.id, status: { in: ['PENDING', 'IN_TRANSIT', 'READY'] } },
    });
    if (existing) throw conflict('This patron already has a hold on this title.', 'DUPLICATE_HOLD');

    // Overdue items block borrowing, not reserving: a hold hands nothing out.
    const reasons: Reason[] = (await patronBlocks(tx, patron, settings)).filter((r) => r.code !== 'OVERDUE');
    const holdable =biblio.items.filter((i) => !i.itemType.notForLoan && !['WITHDRAWN', 'LOST', 'MISSING', 'DAMAGED'].includes(i.status));
    if (!holdable.length) reasons.push({ code: 'NO_HOLDABLE_ITEMS', message: 'There are no copies of this title that can be borrowed.' });
    const borrowing = await tx.loan.count({ where: { patronId: patron.id, returnedAt: null, item: { biblioId: biblio.id } } });
    if (borrowing) reasons.push({ code: 'ALREADY_BORROWED', message: 'The patron already has a copy of this title checked out.' });
    const rule = await resolveRule(tx, { branchId: branch.id, patronCategoryId: patron.patronCategoryId });
    const activeHolds = await tx.hold.count({ where: { patronId: patron.id, status: { in: ['PENDING', 'IN_TRANSIT', 'READY'] } } });
    if (activeHolds >= rule.maxHolds) reasons.push({ code: 'TOO_MANY_HOLDS', message: `Hold limit reached (${rule.maxHolds}).` });

    if (reasons.length) {
      if (input.actor === 'patron') throw badRequest(`The hold could not be placed: ${reasons.map((r) => r.message).join(' ')}`);
      if (!input.override) throw confirmationRequired(reasons);
    }

    const hold = await tx.hold.create({
      data: {
        biblioId: biblio.id,
        patronId: patron.id,
        pickupBranchId: branch.id,
        expiresAt: input.expiresAt ?? null,
        notes: input.notes ?? null,
      },
    });
    const position = await tx.hold.count({ where: { biblioId: biblio.id, status: 'PENDING', placedAt: { lte: hold.placedAt } } });
    const onShelf = holdable.filter((i) => i.status === 'AVAILABLE').length;
    return { hold, position, copiesOnShelf: onShelf };
  }, TX_OPTIONS);
}

export async function cancelHold(input: { holdId: string; patronId?: string; byStaff: boolean; status?: 'CANCELLED' | 'EXPIRED' }) {
  const settings = await getSettings();
  const result = await prisma.$transaction(async (tx) => {
    const hold = await tx.hold.findUnique({ where: { id: input.holdId }, include: { biblio: { select: { title: true } } } });
    if (!hold || (input.patronId && hold.patronId !== input.patronId)) throw notFound('Hold not found');
    if (!['PENDING', 'IN_TRANSIT', 'READY'].includes(hold.status)) throw conflict('This hold is no longer active.');

    const now = new Date();
    const status = input.status ?? 'CANCELLED';
    await tx.hold.update({ where: { id: hold.id }, data: { status, cancelledAt: now } });

    let route: RouteResult | null = null;
    if (hold.status === 'READY' && hold.itemId) {
      // The copy on the hold shelf goes to the next patron in line, or back to the shelf.
      const item = await tx.item.findUnique({ where: { id: hold.itemId }, include: itemInclude });
      if (item && item.status === 'ON_HOLD_SHELF') route = await routeItem(tx, item, 'AVAILABLE', item.currentBranchId, settings, now);
    }
    if (input.byStaff || status === 'EXPIRED') {
      await createNotice(tx, {
        patronId: hold.patronId,
        type: 'HOLD_CANCELLED',
        subject: `Hold ${status === 'EXPIRED' ? 'expired' : 'cancelled'}: ${hold.biblio.title}`,
        body:
          status === 'EXPIRED'
            ? `Your hold on "${hold.biblio.title}" has expired because it was not collected in time.`
            : `Your hold on "${hold.biblio.title}" was cancelled by the library.`,
      });
    }
    return { holdId: hold.id, status, route };
  }, TX_OPTIONS);
  flushEmails();
  return result;
}

// ---------------------------------------------------------------------------
// Fines and payments
// ---------------------------------------------------------------------------

/** Applies a payment to the selected fines (or all outstanding fines, oldest first). */
export async function payFines(input: { patronId: string; amount: number; method: string; fineIds?: string[]; staffId: string }) {
  return prisma.$transaction(async (tx) => {
    const fines = await tx.fine.findMany({
      where: { patronId: input.patronId, status: 'OUTSTANDING', ...(input.fineIds?.length ? { id: { in: input.fineIds } } : {}) },
      orderBy: { createdAt: 'asc' },
    });
    if (!fines.length) throw badRequest('There is nothing outstanding to pay.');
    const totalDue = fines.reduce((sum, f) => sum.add(f.outstanding), new Prisma.Decimal(0));
    let remaining = new Prisma.Decimal(input.amount);
    if (remaining.lte(0)) throw badRequest('Enter an amount greater than zero.');
    if (remaining.gt(totalDue)) throw badRequest(`The amount is more than what is owed (${totalDue.toFixed(2)}).`);

    const payments = [];
    for (const fine of fines) {
      if (remaining.lte(0)) break;
      const applied = Prisma.Decimal.min(remaining, fine.outstanding);
      const outstanding = fine.outstanding.sub(applied);
      await tx.fine.update({ where: { id: fine.id }, data: { outstanding, status: outstanding.lte(0) ? 'PAID' : 'OUTSTANDING' } });
      payments.push(
        await tx.payment.create({
          data: { fineId: fine.id, patronId: input.patronId, amount: applied, method: input.method, receivedById: input.staffId },
        }),
      );
      remaining = remaining.sub(applied);
    }
    return { payments, paid: input.amount, remainingBalance: Number(totalDue.sub(input.amount)) };
  }, TX_OPTIONS);
}

export async function waiveFine(input: { fineId: string; reason: string }) {
  const fine = await prisma.fine.findUnique({ where: { id: input.fineId } });
  if (!fine) throw notFound('Fine not found');
  if (fine.status !== 'OUTSTANDING') throw conflict('Only outstanding fines can be waived.');
  return prisma.fine.update({
    where: { id: fine.id },
    data: {
      status: 'WAIVED',
      outstanding: 0,
      description: [fine.description, `Waived: ${input.reason}`].filter(Boolean).join(' | '),
    },
  });
}
