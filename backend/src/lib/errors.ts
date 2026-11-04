export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
    /** Machine-readable error code the frontend can react to. */
    public readonly code?: string,
  ) {
    super(message);
  }
}

/** A circulation check the librarian may override (e.g. patron owes fines). */
export interface Reason {
  code: string;
  message: string;
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details);
export const unauthorized = (message = 'Please sign in') => new HttpError(401, message);
export const forbidden = (message = 'You do not have permission to do this') => new HttpError(403, message);
export const notFound = (message = 'Not found') => new HttpError(404, message);
export const conflict = (message: string, code?: string) => new HttpError(409, message, undefined, code);

/** Returned when an action has warnings; the client repeats the request with `override: true` to proceed. */
export const confirmationRequired = (reasons: Reason[]) =>
  new HttpError(409, reasons.map((r) => r.message).join(' '), { reasons }, 'CONFIRMATION_REQUIRED');
