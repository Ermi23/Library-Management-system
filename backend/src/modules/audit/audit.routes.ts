import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { addDays } from '../../lib/dates.js';
import { paged, paginationSchema, toSkipTake } from '../../lib/pagination.js';
import { requireAdmin } from '../../middleware/auth.js';

export const auditRouter = Router();
auditRouter.use(requireAdmin);

const querySchema = paginationSchema.extend({
  entity: z.string().optional(),
  action: z.string().optional(),
  userId: z.string().optional(),
  entityId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

auditRouter.get('/', async (req, res) => {
  const query = querySchema.parse(req.query);
  const where: Prisma.AuditLogWhereInput = {
    entity: query.entity,
    action: query.action,
    userId: query.userId,
    entityId: query.entityId,
    createdAt: query.from || query.to ? { gte: query.from, lt: query.to ? addDays(query.to, 1) : undefined } : undefined,
  };
  const [data, total, entities] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { user: { select: { id: true, firstName: true, lastName: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      ...toSkipTake(query),
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ distinct: ['entity'], select: { entity: true }, orderBy: { entity: 'asc' } }),
  ]);
  res.json({ ...paged(data, total, query), entities: entities.map((e) => e.entity) });
});
