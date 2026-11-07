import { z } from 'zod';
import { icaoAirportSchema, icaoTypeSchema } from '@opc/shared';
import type { SimbriefLink } from '@opc/shared';
import { get, run, type Db } from './db.ts';
import { HttpError } from './http.ts';

const TIMEOUT_MS = 8_000;
const MAX_BYTES = 4 * 1024 * 1024;
const LBS_TO_KG = 0.45359237;

const num = z.coerce.number().finite().min(0);
/** SimBrief writes numeric ids as strings and empty elements as `{}` (with `json=1`): anything that is not a positive integer is "absent". */
const optionalId = z.coerce.number().int().positive().optional().catch(undefined);
const ofpSchema = z.object({
  origin: z.object({ icao_code: icaoAirportSchema }),
  destination: z.object({ icao_code: icaoAirportSchema }),
  aircraft: z.object({ icaocode: icaoTypeSchema }),
  weights: z.object({ payload: num, pax_count_actual: num.default(0) }),
  fuel: z.object({ plan_ramp: num }),
  general: z.object({ route: z.string().max(4000).default('') }),
  params: z.object({ units: z.string(), request_id: optionalId }),
  /** The static id the plan was generated with (`{}` when it had none). */
  fetch: z.object({ static_id: z.string().optional().catch(undefined) }).optional().catch(undefined),
});
const refusalSchema = z.object({ fetch: z.object({ status: z.string(), userid: optionalId }) });
const accountSchema = z.object({ params: z.object({ user_id: optionalId }) });

/** What SimBrief's fetcher is asked for: the latest plan of an account, or (with `staticId`) exactly the plan generated with that static id. */
export type OfpQuery = { username: string } | { pilotId: number; staticId?: string | undefined };

export type Ofp = {
  origin: string; destination: string; aircraftIcao: string; payloadKg: number; pax: number; plannedFuelKg: number; route: string;
  /** SimBrief's id of this plan (`params.request_id`), when the answer carries it. */
  ofpId: string | null;
};

export type Fetch = typeof fetch;

async function readCapped(res: Response): Promise<string> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_BYTES || !res.body) throw new HttpError(502, 'simbrief_invalid', 'SimBrief response is too large or empty');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > MAX_BYTES) throw new HttpError(502, 'simbrief_invalid', 'SimBrief response is too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const queryString = (q: OfpQuery): string =>
  'username' in q ? `username=${encodeURIComponent(q.username)}` : `userid=${q.pilotId}${q.staticId ? `&static_id=${encodeURIComponent(q.staticId)}` : ''}`;

type Reply = { ok: true; body: unknown } | { ok: false; reason: string; pilotId: number | undefined };

/** Ask the fetcher. SimBrief answers HTTP 400 with `{ fetch: { status: "Error: ..." } }` when it has nothing to give: that is a `Reply`, not a failure.
 *  Everything else that is not a plan (network, timeout, size, not JSON, other statuses) is a clear HttpError, never a crash. */
async function ask(q: OfpQuery, doFetch: Fetch): Promise<Reply> {
  let res: Response;
  try {
    res = await doFetch(`https://www.simbrief.com/api/xml.fetcher.php?${queryString(q)}&json=1`, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error', headers: { accept: 'application/json' } });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new HttpError(504, 'simbrief_unavailable', timeout ? 'SimBrief did not answer in time, try again' : 'SimBrief could not be reached, try again');
  }
  let body: unknown;
  try {
    body = JSON.parse(await readCapped(res));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, 'simbrief_invalid', 'SimBrief returned something that is not JSON');
  }
  if (res.ok) return { ok: true, body };
  const refusal = refusalSchema.safeParse(body);
  if (res.status === 400 && refusal.success) return { ok: false, reason: refusal.data.fetch.status.replace(/^Error:\s*/, ''), pilotId: refusal.data.fetch.userid };
  throw new HttpError(502, 'simbrief_unavailable', `SimBrief answered HTTP ${res.status}`);
}

/** SimBrief says `Unknown UserID` for a name or Pilot ID that is not an account; any other refusal ("No flight plan on file ...") means the account exists but has nothing to fetch. */
const UNKNOWN_USER = /Unknown UserID/i;
const refused = (reason: string): HttpError => UNKNOWN_USER.test(reason)
  ? new HttpError(422, 'simbrief_user_not_found', `SimBrief: ${reason}`)
  : new HttpError(404, 'simbrief_not_found', `SimBrief: ${reason}`);

/** Fetch and validate a SimBrief plan: the latest of an account, or the one made with a static id. */
export async function fetchOfp(q: OfpQuery, doFetch: Fetch): Promise<Ofp> {
  const r = await ask(q, doFetch);
  if (!r.ok) throw refused(r.reason);
  const ofp = ofpSchema.safeParse(r.body);
  if (!ofp.success) throw new HttpError(502, 'simbrief_invalid', 'SimBrief returned a flight plan this server cannot read');
  const o = ofp.data;
  // The answer echoes the static id of the plan it holds: a plan made under another id (or none) is not the one that was asked for.
  if ('staticId' in q && q.staticId !== undefined && o.fetch?.static_id !== q.staticId) throw new HttpError(404, 'ofp_not_found', 'SimBrief has no plan for this flight yet: generate it on SimBrief first');
  const toKg = /^k/i.test(o.params.units) ? 1 : LBS_TO_KG;
  return {
    origin: o.origin.icao_code, destination: o.destination.icao_code, aircraftIcao: o.aircraft.icaocode,
    payloadKg: Math.round(o.weights.payload * toKg), pax: Math.round(o.weights.pax_count_actual),
    plannedFuelKg: Math.round(o.fuel.plan_ramp * toKg), route: o.general.route,
    ofpId: o.params.request_id === undefined ? null : String(o.params.request_id),
  };
}

/** Does SimBrief know this account? A plan on file or not, an existing account is valid; only `Unknown UserID` throws (422). Returns the Pilot ID when SimBrief tells it. */
export async function lookupAccount(q: OfpQuery, doFetch: Fetch): Promise<{ pilotId: number | null }> {
  const r = await ask(q, doFetch);
  if (r.ok) return { pilotId: accountSchema.safeParse(r.body).data?.params.user_id ?? null };
  if (UNKNOWN_USER.test(r.reason)) throw refused(r.reason);
  return { pilotId: r.pilotId ?? ('pilotId' in q ? q.pilotId : null) };
}

/** Why a plan is not for this flight, or null when origin, destination and aircraft type all match. Language-neutral on purpose: the web app puts it inside its own sentence. */
export function ofpMismatch(ofp: Pick<Ofp, 'origin' | 'destination' | 'aircraftIcao'>, flight: { origin: string; destination: string; aircraftIcao: string }): string | null {
  if (ofp.origin === flight.origin && ofp.destination === flight.destination && ofp.aircraftIcao === flight.aircraftIcao) return null;
  const route = (r: { origin: string; destination: string; aircraftIcao: string }): string => `${r.origin} → ${r.destination} (${r.aircraftIcao})`;
  return `SimBrief ${route(ofp)}, flight ${route(flight)}`;
}

/** The SimBrief identifier saved on an account: all null while nothing is connected. */
export function linkOf(db: Db, userId: number): SimbriefLink {
  const r = get<{ username: string | null; pilot_id: number | null; verified_at: number | null }>(db, 'SELECT simbrief_username AS username, simbrief_pilot_id AS pilot_id, simbrief_verified_at AS verified_at FROM users WHERE id = ?', userId);
  return { username: r?.username ?? null, pilotId: r?.pilot_id ?? null, verifiedAt: r?.verified_at ?? null };
}

export function saveLink(db: Db, userId: number, link: SimbriefLink): void {
  run(db, 'UPDATE users SET simbrief_username = ?, simbrief_pilot_id = ?, simbrief_verified_at = ? WHERE id = ?', link.username, link.pilotId, link.verifiedAt, userId);
}
