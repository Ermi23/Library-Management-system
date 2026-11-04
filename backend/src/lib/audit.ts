import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';

/** Records who changed what. Failures are logged, never thrown, so auditing cannot break a request. */
export async function audit(
  userId: string | undefined,
  action: string,
  entity: string,
  entityId?: string,
  details?: Prisma.InputJsonValue,
) {
  try {
    await prisma.auditLog.create({ data: { userId, action, entity, entityId, details } });
  } catch (err) {
    console.error('Failed to write audit log', err);
  }
}
