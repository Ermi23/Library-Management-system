import type { Request } from 'express';
import { prisma } from './prisma.js';
import { badRequest } from './errors.js';

/**
 * The branch a staff member is working at. The frontend sends the branch picked in the header
 * as `X-Branch-Id`; otherwise the user's home branch, then the first active branch, is used.
 */
export async function workingBranchId(req: Request): Promise<string> {
  const requested = req.header('x-branch-id');
  if (requested) {
    const branch = await prisma.branch.findFirst({ where: { id: requested, isActive: true }, select: { id: true } });
    if (branch) return branch.id;
  }
  if (req.user?.homeBranchId) return req.user.homeBranchId;
  const fallback = await prisma.branch.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!fallback) throw badRequest('No active branch exists. Create a branch first.');
  return fallback.id;
}
