import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { audit } from '../../lib/audit.js';
import { notFound } from '../../lib/errors.js';
import { STAFF_ROLES, requireAdmin, requireStaff } from '../../middleware/auth.js';

export const branchesRouter = Router();

const optionalText = z
  .string()
  .trim()
  .max(500)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

const branchSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{2,12}$/, 'Code must be 2-12 letters, digits, - or _'),
  name: z.string().trim().min(1, 'Name is required').max(200),
  address: optionalText,
  phone: optionalText,
  email: z.string().trim().email().optional().nullable().or(z.literal('').transform(() => null)),
  isActive: z.boolean().default(true),
});

// Public: the OPAC needs active branches for hold pickup. Staff also see inactive ones.
branchesRouter.get('/', async (req, res) => {
  const isStaff = !!req.user && STAFF_ROLES.includes(req.user.role);
  const branches = await prisma.branch.findMany({
    where: isStaff ? undefined : { isActive: true },
    orderBy: { name: 'asc' },
    include: isStaff
      ? { _count: { select: { homeItems: true, users: { where: { role: 'PATRON' } } } } }
      : undefined,
  });
  res.json(branches);
});

branchesRouter.get('/:id', requireStaff, async (req: Request<{ id: string }>, res) => {
  const branch = await prisma.branch.findUnique({ where: { id: req.params.id } });
  if (!branch) throw notFound('Branch not found');
  res.json(branch);
});

branchesRouter.post('/', requireAdmin, async (req, res) => {
  const data = branchSchema.parse(req.body);
  const branch = await prisma.branch.create({ data });
  await audit(req.user!.id, 'create', 'Branch', branch.id, data);
  res.status(201).json(branch);
});

branchesRouter.patch('/:id', requireAdmin, async (req: Request<{ id: string }>, res) => {
  const data = branchSchema.partial().parse(req.body);
  const branch = await prisma.branch.update({ where: { id: req.params.id }, data });
  await audit(req.user!.id, 'update', 'Branch', branch.id, data);
  res.json(branch);
});
