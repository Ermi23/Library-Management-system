/** API base URL. Empty in development (Vite proxies /api to the backend). */
const BASE_URL = import.meta.env.VITE_API_URL ?? '';

export const BRANCH_STORAGE_KEY = 'lms.workingBranch';

export interface Reason {
  code: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: Record<string, unknown>,
    public readonly code?: string,
  ) {
    super(message);
  }

  /** Warnings a librarian can override (returned with code CONFIRMATION_REQUIRED). */
  get reasons(): Reason[] {
    return this.code === 'CONFIRMATION_REQUIRED' ? ((this.details?.reasons as Reason[]) ?? []) : [];
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Query;
  /** Send the body as-is (e.g. a File) instead of JSON. */
  raw?: boolean;
}

/** The branch picked in the staff header ("Working at"). */
export function workingBranch(): string | null {
  try {
    return localStorage.getItem(BRANCH_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function buildUrl(path: string, query?: Query): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return `${BASE_URL}/api${path}${qs ? `?${qs}` : ''}`;
}

export async function api<T>(path: string, { method = 'GET', body, query, raw }: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const branch = workingBranch();
  if (branch) headers['X-Branch-Id'] = branch;
  if (body !== undefined && !raw) headers['Content-Type'] = 'application/json';
  if (raw) headers['Content-Type'] = 'application/octet-stream';

  const res = await fetch(buildUrl(path, query), {
    method,
    credentials: 'include',
    headers,
    body: body === undefined ? undefined : raw ? (body as BodyInit) : JSON.stringify(body),
  });

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.message ?? `Request failed (${res.status})`, data?.error?.details, data?.error?.code);
  }
  return data as T;
}

/** Downloads a file from the API (MARC export, etc.) using the session cookie. */
export async function download(path: string, query?: Query) {
  const res = await fetch(buildUrl(path, query), { credentials: 'include' });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.error?.message ?? 'Download failed');
  }
  const blob = await res.blob();
  const name = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'download';
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** First validation message for a field, if the error is a 400 with field details. */
export function fieldError(error: unknown, field: string): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const value = error.details?.[field];
  return Array.isArray(value) ? (value[0] as string) : undefined;
}
