import { z } from 'zod';

export const NUMERIC_ID = /^\d+$/;

/** An error with a stable machine code, rendered as `{ error, message }` by the app's error handler. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  /** Extra machine-readable fields merged into the error body (`needed`, `options`...). */
  readonly extra: Record<string, unknown> | undefined;
  constructor(status: number, code: string, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/** Trust boundary: every request body/query goes through a zod schema here. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input ?? {});
  if (!r.success) {
    const issues = r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`);
    throw new HttpError(400, 'invalid_request', issues.join('; '));
  }
  return r.data;
}

/** Fixed-window in-memory limiter for credential endpoints. ponytail: per-process, resets on restart. */
export class Limiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private readonly max: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  constructor(max: number, windowMs: number, now: () => number) {
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
  }
  /** Count one hit; throws 429 when over the limit. */
  hit(key: string): void {
    const t = this.now();
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
    const cur = this.hits.get(key);
    if (!cur || cur.resetAt <= t) this.hits.set(key, { count: 1, resetAt: t + this.windowMs });
    else if (++cur.count > this.max) throw new HttpError(429, 'rate_limited', 'too many attempts, try again later');
  }
}
