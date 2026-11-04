import nodemailer, { type Transporter } from 'nodemailer';
import type { NoticeType, Prisma } from '@prisma/client';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';

type Db = Prisma.TransactionClient;

let transporter: Transporter | null | undefined;

function mailer(): Transporter | null {
  if (transporter === undefined) {
    transporter = env.SMTP_HOST
      ? nodemailer.createTransport({
          host: env.SMTP_HOST,
          port: env.SMTP_PORT,
          secure: env.SMTP_SECURE,
          auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
        })
      : null;
  }
  return transporter;
}

export const emailEnabled = () => mailer() !== null;

/**
 * Records a notice for a patron: always in-app, plus an email (queued) when SMTP is configured
 * and the patron has an email address. Call `sendPendingEmails()` after the transaction commits.
 */
export async function createNotice(
  db: Db,
  input: { patronId: string; type: NoticeType; subject: string; body: string; loanId?: string | null },
) {
  const patron = await db.user.findUnique({ where: { id: input.patronId }, select: { email: true } });
  await db.notice.create({
    data: { ...input, channel: 'IN_APP', status: 'SENT', sentAt: new Date() },
  });
  if (patron?.email && emailEnabled()) {
    await db.notice.create({ data: { ...input, channel: 'EMAIL', status: 'PENDING' } });
  }
}

let sending = false;

/** Sends queued email notices. Safe to call often; concurrent calls are collapsed. */
export async function sendPendingEmails(): Promise<void> {
  const transport = mailer();
  if (!transport || sending) return;
  sending = true;
  try {
    const pending = await prisma.notice.findMany({
      where: { channel: 'EMAIL', status: 'PENDING' },
      include: { patron: { select: { email: true, firstName: true } } },
      take: 100,
      orderBy: { createdAt: 'asc' },
    });
    for (const notice of pending) {
      if (!notice.patron.email) {
        await prisma.notice.update({ where: { id: notice.id }, data: { status: 'FAILED', error: 'Patron has no email' } });
        continue;
      }
      try {
        await transport.sendMail({
          from: env.SMTP_FROM,
          to: notice.patron.email,
          subject: notice.subject,
          text: `Dear ${notice.patron.firstName},\n\n${notice.body}\n`,
        });
        await prisma.notice.update({ where: { id: notice.id }, data: { status: 'SENT', sentAt: new Date(), error: null } });
      } catch (err) {
        await prisma.notice.update({
          where: { id: notice.id },
          data: { status: 'FAILED', error: err instanceof Error ? err.message.slice(0, 500) : 'Send failed' },
        });
      }
    }
  } finally {
    sending = false;
  }
}

/** Fire-and-forget wrapper for use after a request has been answered. */
export function flushEmails() {
  sendPendingEmails().catch((err) => console.error('Failed to send notices', err));
}
