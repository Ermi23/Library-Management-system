import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Role, UserStatus } from '@prisma/client';
import { env, isProd } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { forbidden, unauthorized } from '../lib/errors.js';

export const SESSION_COOKIE = 'lms_session';

export interface AuthUser {
  id: string;
  role: Role;
  status: UserStatus;
  homeBranchId: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const STAFF_ROLES: Role[] = ['ADMIN', 'LIBRARIAN'];

export function issueSession(res: Response, userId: string) {
  const maxAgeSeconds = Math.round(env.SESSION_HOURS * 3600);
  const token = jwt.sign({}, env.JWT_SECRET, { subject: userId, expiresIn: maxAgeSeconds });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: maxAgeSeconds * 1000,
    path: '/',
  });
}

export function clearSession(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/**
 * Reads the session cookie and attaches the current user to `req.user`.
 * The user is re-loaded from the database so role changes and suspensions apply immediately.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next();

  let userId: string | undefined;
  try {
    userId = (jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload).sub;
  } catch {
    return next(); // expired or tampered token: continue as anonymous
  }
  if (!userId) return next();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, status: true, homeBranchId: true },
  });
  // Staff accounts that are suspended lose access immediately. Patrons keep access
  // so they can still see their account; circulation rules block their borrowing.
  if (user && (user.role === 'PATRON' || user.status === 'ACTIVE')) {
    req.user = user;
  }
  next();
}

/** Requires a signed-in user, optionally restricted to the given roles. */
export function requireAuth(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw unauthorized();
    if (roles.length > 0 && !roles.includes(req.user.role)) throw forbidden();
    next();
  };
}

export const requireStaff = requireAuth(...STAFF_ROLES);
export const requireAdmin = requireAuth('ADMIN');
