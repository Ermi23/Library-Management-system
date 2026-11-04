import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { badRequest, unauthorized } from '../../lib/errors.js';
import { clearSession, issueSession, requireAuth } from '../../middleware/auth.js';
import { publicUserSelect } from '../users/users.select.js';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { message: 'Too many login attempts. Try again in a few minutes.' } },
});

const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your email or card number'),
  password: z.string().min(1, 'Enter your password'),
});

// Compared against when the user does not exist, so response time does not reveal valid accounts.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { identifier, password } = loginSchema.parse(req.body);

  const user = await prisma.user.findFirst({
    where: { OR: [{ email: identifier.toLowerCase() }, { cardNumber: identifier }] },
    select: { id: true, role: true, status: true, passwordHash: true },
  });

  const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !user.passwordHash || !valid) throw unauthorized('Incorrect email/card number or password');
  if (user.role !== 'PATRON' && user.status !== 'ACTIVE') throw unauthorized('This account is disabled');

  issueSession(res, user.id);
  const me = await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
    select: publicUserSelect,
  });
  res.json(me);
});

authRouter.post('/logout', (_req, res) => {
  clearSession(res);
  res.status(204).end();
});

authRouter.get('/me', requireAuth(), async (req, res) => {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: publicUserSelect });
  res.json(me);
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

authRouter.post('/change-password', requireAuth(), async (req, res) => {
  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!user.passwordHash || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw badRequest('Current password is incorrect');
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(newPassword, 10) },
  });
  res.status(204).end();
});
