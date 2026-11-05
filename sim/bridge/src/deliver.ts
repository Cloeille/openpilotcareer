// Delivery of one report: queue it on disk first, then send with exponential backoff until the server gives a final answer.
import type { Telemetry } from '@opc/shared';
import { ApiError, type ServerClient } from './client.ts';
import type { Outbox, Pending } from './outbox.ts';

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 5 * 60_000;

/** `verified`/`rejected`: the server decided. `closed`: it had already closed this flight (an earlier send got through, its answer was lost).
 *  `queued`: still on disk, will be retried. `dropped`: the server refuses it for good, nothing to retry. */
export type Delivery =
  | { state: 'verified' | 'unverified' | 'rejected' | 'closed' | 'dropped'; reason: string | null }
  | { state: 'queued'; reason: string };

export type DeliverOptions = {
  /** Total tries; the report stays queued after the last one. */
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (error: ApiError, nextInMs: number) => void;
};

export const backoffMs = (attempt: number): number => Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);

export async function deliver(client: ServerClient, outbox: Outbox, p: Pending, o: DeliverOptions = {}): Promise<Delivery> {
  const { maxAttempts = Infinity, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), onRetry } = o;
  outbox.put(p);
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await client.verify(p.flightId, p.report);
      outbox.remove(p.serverUrl, p.flightId);
      return { state: r.verification, reason: r.reason };
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      if (e.status === 409) { outbox.remove(p.serverUrl, p.flightId); return { state: 'closed', reason: e.message }; }
      // 401/403: the key was revoked or is wrong. Keep the report: a new key (opc-bridge setup) can still send it.
      if (e.status === 401 || e.status === 403) return { state: 'queued', reason: `${e.message} - run opc-bridge setup with a valid API key` };
      if (e.kind === 'refused' || e.kind === 'protocol') { outbox.remove(p.serverUrl, p.flightId); return { state: 'dropped', reason: e.message }; }
      if (attempt + 1 >= maxAttempts) return { state: 'queued', reason: e.message };
      const wait = backoffMs(attempt);
      onRetry?.(e, wait);
      await sleep(wait);
    }
  }
}

/** Send everything an earlier run left in the outbox for this server (in the background of a new session). */
export const flushOutbox = (client: ServerClient, outbox: Outbox, serverUrl: string, o: DeliverOptions = {}): Promise<Delivery[]> =>
  Promise.all(outbox.list(serverUrl).map((p) => deliver(client, outbox, p, o)));

export const pendingFor = (serverUrl: string, flightId: number, report: Telemetry, now: number): Pending => ({ serverUrl, flightId, report, queuedAt: now });
