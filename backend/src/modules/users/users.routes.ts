import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { Prisma, Role, UserStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { audit } from '../../lib/audit.js';
import { forbidden, notFound } from '../../lib/errors.js';
import { param } from '../../lib/http.js';
import { addMonths } from '../../lib/dates.js';
import { generateCardNumber } from '../../lib/counters.js';
import { paged, paginationSchema, toSkipTake } from '../../lib/pagination.js';
import { optionalDate, optionalEmail, optionalId, optionalText } from '../../lib/zod.js';
import { requireStaff, type AuthUser } from '../../middleware/auth.js';
import { publicUserSelect } from './users.select.js';

export const usersRouter = Router();
usersRouter.use(requireStaff);

const userFields = {
  email: optionalEmail,
  firstName: z.string().trim().min(1, 'First name is required').max(100),
  lastName: z.string().trim().min(1, 'Last name is required').max(100),
  phone: optionalText(50),
  address: optionalText(500),
  notes: optionalText(2000),
  role: z.enum(Role),
  status: z.enum(UserStatus),
  cardNumber: optionalText(50),
  homeBranchId: optionalId,
  patronCategoryId: optionalId,
  dateOfBirth: optionalDate,
  expiresAt: optionalDate,
  password: z.string().min(8, 'Password must be at least 8 characters').optional().or(z.literal('')),
};

const createUserSchema = z
  .object({ ...userFields, status: userFields.status.default('ACTIVE') })
  .refine((u) => u.role === 'PATRON' || !!u.email, { message: 'Staff accounts need an email to sign in', path: ['email'] });

const updateUserSchema = z.object(userFields).partial();

const listQuerySchema = paginationSchema.extend({
  q: z.string().trim().optional(),
  role: z.enum(Role).optional(),
  staff: z.enum(['true', 'false']).optional(),
  status: z.enum(UserStatus).optional(),
  branchId: z.string().optional(),
  patronCategoryId: z.string().optional(),
  expired: z.enum(['true', 'false']).optional(),
});

/** Librarians manage patrons only; admins manage everyone. */
function assertCanManage(actor: AuthUser, targetRole: Role) {
  if (actor.role !== 'ADMIN' && targetRole !== 'PATRON') {
    throw forbidden('Only administrators can manage staff accounts');
  }
}

usersRouter.get('/', async (req, res) => {
  const query = listQuerySchema.parse(req.query);
  const where: Prisma.UserWhereInput = {
    role: query.role ?? (query.staff === 'true' ? { in: ['ADMIN', 'LIBRARIAN'] } : undefined),
    status: query.status,
    homeBranchId: query.branchId,
    patronCategoryId: query.patronCategoryId,
    ...(query.expired === 'true' && { expiresAt: { lt: new Date() } }),
  };
  if (query.q) {
    const terms = query.q.split(/\s+/).filter(Boolean);
    where.AND = terms.map((t) => ({
      OR: [
        { firstName: { contains: t, mode: 'insensitive' } },
        { lastName: { contains: t, mode: 'insensitive' } },
        { email: { contains: t, mode: 'insensitive' } },
        { cardNumber: { contains: t } },
        { phone: { contains: t } },
      ],
    }));
  }

  const [data, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        ...publicUserSelect,
        _count: { select: { loans: { where: { returnedAt: null } } } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      ...toSkipTake(query),
    }),
    prisma.user.count({ where }),
  ]);
  res.json(paged(data, total, query));
});

usersRouter.get('/:id', async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: param(req) }, select: publicUserSelect });
  if (!user) throw notFound('User not found');
  res.json(user);
});

usersRouter.post('/', async (req, res) => {
  const { password, ...input } = createUserSchema.parse(req.body);
  assertCanManage(req.user!, input.role);

  const user = await prisma.$transaction(async (tx) => {
    const isPatron = input.role === 'PATRON';
    const cardNumber = input.cardNumber ?? (isPatron ? await generateCardNumber(tx) : null);
    let expiresAt = input.expiresAt ?? null;
    if (isPatron && !expiresAt) {
      const category = input.patronCategoryId
        ? await tx.patronCategory.findUnique({ where: { id: input.patronCategoryId } })
        : null;
      expiresAt = addMonths(new Date(), category?.enrolmentPeriodMonths ?? 12);
    }
    return tx.user.create({
      data: {
        ...input,
        cardNumber,
        expiresAt,
        passwordHash: password ? await bcrypt.hash(password, 10) : null,
      },
      select: publicUserSelect,
    });
  });
  await audit(req.user!.id, 'create', 'User', user.id, { role: user.role });
  res.status(201).json(user);
});

usersRouter.patch('/:id', async (req, res) => {
  const id = param(req);
  const { password, ...input } = updateUserSchema.parse(req.body);
  const existing = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  if (!existing) throw notFound('User not found');

  assertCanManage(req.user!, existing.role);
  if (input.role) assertCanManage(req.user!, input.role);
  if (id === req.user!.id && input.role && input.role !== req.user!.role) {
    throw forbidden('You cannot change your own role');
  }
  if (id === req.user!.id && input.status && input.status !== 'ACTIVE') {
    throw forbidden('You cannot suspend your own account');
  }

  const user = await prisma.user.update({
    where: { id },
    data: {
      ...input,
      ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}),
    },
    select: publicUserSelect,
  });
  await audit(req.user!.id, 'update', 'User', user.id, {
    fields: Object.keys(input).concat(password ? ['password'] : []),
  });
  res.json(user);
});
