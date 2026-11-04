/**
 * Scheduled circulation housekeeping: due-soon and overdue notices, expiry of uncollected holds,
 * membership expiry reminders, and sending queued emails.
 */
import { prisma } from '../../lib/prisma.js';
import { addDays, daysLate, endOfDay } from '../../lib/dates.js';
import { getSettings } from '../../lib/settings.js';
import { env } from '../../config/env.js';
import { cancelHold } from '../circulation/circulation.service.js';
import { createNotice, sendPendingEmails } from './notices.service.js';

export interface JobReport {
  dueSoon: number;
  overdue: number;
  holdsExpired: number;
  membershipReminders: number;
  membershipsExpired: number;
  ranAt: Date;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export async function runJobs(): Promise<JobReport> {
  const settings = await getSettings();
  const now = new Date();
  const report: JobReport = { dueSoon: 0, overdue: 0, holdsExpired: 0, membershipReminders: 0, membershipsExpired: 0, ranAt: now };

  // Due soon: one reminder per loan period.
  if (settings.dueSoonNoticeDays > 0) {
    const loans = await prisma.loan.findMany({
      where: {
        returnedAt: null,
        dueAt: { gte: now, lte: endOfDay(addDays(now, settings.dueSoonNoticeDays)) },
        notices: { none: { type: 'DUE_SOON', createdAt: { gte: addDays(now, -settings.dueSoonNoticeDays - 1) } } },
      },
      include: { item: { select: { biblio: { select: { title: true } } } } },
    });
    for (const loan of loans) {
      await createNotice(prisma, {
        patronId: loan.patronId,
        loanId: loan.id,
        type: 'DUE_SOON',
        subject: `Due soon: ${loan.item.biblio.title}`,
        body: `"${loan.item.biblio.title}" is due on ${isoDate(loan.dueAt)}. Renew it online or return it to avoid fines.`,
      });
      report.dueSoon++;
    }
  }

  // Overdue: one notice at each configured threshold (e.g. 1, 7 and 14 days late).
  const thresholds = [...settings.overdueNoticeDays].sort((a, b) => a - b);
  if (thresholds.length) {
    const overdue = await prisma.loan.findMany({
      where: { returnedAt: null, dueAt: { lt: now } },
      include: {
        item: { select: { biblio: { select: { title: true } } } },
        _count: { select: { notices: { where: { type: 'OVERDUE', channel: 'IN_APP' } } } },
      },
    });
    for (const loan of overdue) {
      const late = daysLate(loan.dueAt, now);
      const reached = thresholds.filter((t) => late >= t).length;
      if (reached > loan._count.notices) {
        await createNotice(prisma, {
          patronId: loan.patronId,
          loanId: loan.id,
          type: 'OVERDUE',
          subject: `Overdue: ${loan.item.biblio.title}`,
          body: `"${loan.item.biblio.title}" was due on ${isoDate(loan.dueAt)} and is now ${late} day(s) overdue. Please return it as soon as possible; fines are accruing.`,
        });
        report.overdue++;
      }
    }
  }

  // Holds not collected in time, and pending holds past the patron's "not needed after" date.
  const expiredHolds = await prisma.hold.findMany({
    where: { status: { in: ['READY', 'PENDING'] }, expiresAt: { lt: now } },
    select: { id: true },
  });
  for (const hold of expiredHolds) {
    try {
      await cancelHold({ holdId: hold.id, byStaff: false, status: 'EXPIRED' });
      report.holdsExpired++;
    } catch (err) {
      console.error('Failed to expire hold', hold.id, err);
    }
  }

  // Membership: remind before expiry, then mark expired.
  if (settings.membershipReminderDays > 0) {
    const expiring = await prisma.user.findMany({
      where: {
        role: 'PATRON',
        status: 'ACTIVE',
        expiresAt: { gte: now, lte: addDays(now, settings.membershipReminderDays) },
        notices: { none: { type: 'MEMBERSHIP_EXPIRY', createdAt: { gte: addDays(now, -settings.membershipReminderDays) } } },
      },
      select: { id: true, expiresAt: true },
    });
    for (const p of expiring) {
      await createNotice(prisma, {
        patronId: p.id,
        type: 'MEMBERSHIP_EXPIRY',
        subject: 'Your library membership is expiring',
        body: `Your membership expires on ${isoDate(p.expiresAt!)}. Visit the library to renew it.`,
      });
      report.membershipReminders++;
    }
  }
  const expired = await prisma.user.updateMany({
    where: { role: 'PATRON', status: 'ACTIVE', expiresAt: { lt: now } },
    data: { status: 'EXPIRED' },
  });
  report.membershipsExpired = expired.count;

  await sendPendingEmails();
  return report;
}

let running = false;
let lastReport: JobReport | null = null;
export const lastJobReport = () => lastReport;

export async function runJobsSafely(): Promise<JobReport | null> {
  if (running) return null;
  running = true;
  try {
    lastReport = await runJobs();
    return lastReport;
  } catch (err) {
    console.error('Scheduled jobs failed', err);
    return null;
  } finally {
    running = false;
  }
}

export function startScheduler() {
  if (!env.JOBS_ENABLED) return;
  const interval = env.JOBS_INTERVAL_MINUTES * 60_000;
  // First run shortly after start-up, then on the interval.
  setTimeout(() => void runJobsSafely(), 15_000).unref();
  setInterval(() => void runJobsSafely(), interval).unref();
  console.log(`Background jobs every ${env.JOBS_INTERVAL_MINUTES} min`);
}
