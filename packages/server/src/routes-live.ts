// Lot LIVE routes: the bridge pushes a LiveSample per flight, the web app reads the latest one back.
// Only the latest sample per flight is kept, in memory (a live position is worthless after a restart); the receive time is
// also written to `flights.last_live_at` so "bridge lost" still works across a restart.
import type { FastifyInstance } from 'fastify';
import { airports } from './catalog.ts';
import { apiKeyAuth, sessionAuth } from './auth.ts';
import { get, run, type Db } from './db.ts';
import { HttpError, NUMERIC_ID, parse } from './http.ts';
import { isBridgeLost, liveProgress, liveSampleSchema, LIVE_MIN_INTERVAL_MS, type FlightStatus, type LiveSample, type LiveState } from '@opc/shared';

export type LiveCtx = { db: Db; now: () => number };

type Entry = { sample: LiveSample; receivedAt: number };
type FlightFacts = { id: number; status: FlightStatus; destination: string; last_live_at: number | null };

const PRUNE_ABOVE = 200;
const STALE_ENTRY_MS = 24 * 3_600_000;

const flightId = (params: unknown): number => {
  const raw = (params as { id?: string }).id ?? '';
  if (!NUMERIC_ID.test(raw)) throw new HttpError(404, 'flight_not_found', 'flight not found');
  return Number(raw);
};

/** The flight if it belongs to one of the player's companies, whatever its status. */
const flightOfUser = (db: Db, id: number, userId: number): FlightFacts => {
  const f = get<FlightFacts>(db, 'SELECT f.id, f.status, f.destination, f.last_live_at FROM flights f JOIN companies c ON c.id = f.company_id WHERE f.id = ? AND c.user_id = ?', id, userId);
  if (!f) throw new HttpError(404, 'flight_not_found', 'flight not found');
  return f;
};

export function registerLive(app: FastifyInstance, ctx: LiveCtx): void {
  const { db, now } = ctx;
  const latest = new Map<number, Entry>();

  const prune = (at: number): void => {
    if (latest.size <= PRUNE_ABOVE) return;
    for (const [id, e] of latest) if (at - e.receivedAt > STALE_ENTRY_MS) latest.delete(id);
  };

  // Bridge side (API key): 1 sample per second per flight at most.
  app.post('/api/v1/flights/:id/live', async (req, reply) => {
    const p = apiKeyAuth(db, req, now());
    const id = flightId(req.params);
    const sample = parse(liveSampleSchema, req.body);
    const f = flightOfUser(db, id, p.userId);
    if (f.status !== 'active') {
      latest.delete(id);
      throw new HttpError(409, 'flight_closed', `flight is already ${f.status}`);
    }
    const at = now();
    const prev = latest.get(id);
    if (prev && at - prev.receivedAt < LIVE_MIN_INTERVAL_MS) throw new HttpError(429, 'rate_limited', 'at most one live sample per second per flight');
    latest.set(id, { sample, receivedAt: at });
    run(db, 'UPDATE flights SET last_live_at = ? WHERE id = ?', at, id);
    prune(at);
    return reply.status(204).send();
  });

  // Web side (session): the latest sample plus what follows from it.
  app.get('/api/v1/flights/:id/live', async (req): Promise<LiveState> => {
    const p = sessionAuth(db, req, now());
    const id = flightId(req.params);
    const f = flightOfUser(db, id, p.userId);
    const at = now();
    if (f.status !== 'active') {
      latest.delete(id);
      return { status: f.status, sample: null, receivedAt: f.last_live_at, bridgeLost: false, remainingNm: null, etaAt: null };
    }
    const e = latest.get(id);
    const receivedAt = e?.receivedAt ?? f.last_live_at;
    const dest = airports.get(f.destination);
    const progress = e ? liveProgress(e.sample, e.receivedAt, dest ?? null) : { remainingNm: null, etaAt: null };
    return { status: f.status, sample: e?.sample ?? null, receivedAt, bridgeLost: isBridgeLost(receivedAt, at), ...progress };
  });
}
