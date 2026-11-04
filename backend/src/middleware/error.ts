import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { HttpError } from '../lib/errors.js';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { message: `No route for ${req.method} ${req.path}` } });
}

// Express recognises error handlers by their four parameters, so `_next` must stay.
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { message: err.message, code: err.code, details: err.details } });
    return;
  }

  if (err instanceof z.ZodError) {
    const { fieldErrors, formErrors } = z.flattenError(err);
    const first = formErrors[0] ?? Object.entries(fieldErrors).map(([k, v]) => `${k}: ${(v as string[])[0]}`)[0];
    res.status(400).json({
      error: { message: first ? `Some fields are invalid (${first})` : 'Some fields are invalid', details: fieldErrors },
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const fields = (err.meta?.target as string[] | undefined)?.join(', ') ?? 'value';
      res.status(409).json({ error: { message: `A record with this ${fields} already exists` } });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ error: { message: 'Record not found' } });
      return;
    }
    if (err.code === 'P2003') {
      res.status(409).json({ error: { message: 'This record is still referenced by other records' } });
      return;
    }
  }

  // Malformed JSON body from express.json()
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: { message: 'Request body is not valid JSON' } });
    return;
  }

  console.error(err);
  res.status(500).json({ error: { message: 'Something went wrong on the server' } });
}
