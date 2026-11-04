import type { Request } from 'express';

/** Route parameter as a string (Express 5 types allow arrays for wildcard params). */
export function param(req: Request, name = 'id'): string {
  const value = req.params[name] as string | string[] | undefined;
  return Array.isArray(value) ? value.join('/') : (value ?? '');
}
