import type { Prisma } from '@prisma/client';

/** User fields that are safe to send to the client (never the password hash). */
export const publicUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  address: true,
  role: true,
  status: true,
  cardNumber: true,
  dateOfBirth: true,
  expiresAt: true,
  notes: true,
  lastLoginAt: true,
  createdAt: true,
  homeBranch: { select: { id: true, code: true, name: true } },
  patronCategory: { select: { id: true, code: true, name: true } },
} satisfies Prisma.UserSelect;
