import { cannotFly, cannotFlyCause, type AircraftType, type CannotFlyCause, type CompanyProfile, type Job, type Me } from '@opc/shared';

/** The shape of GET /jobs: board jobs at every airport where the company has an aircraft, plus the player's pending SimBrief imports. */
export type Board = { jobs: Job[]; imported: Job[] };

export type Plane = Me['fleet'][number];
/** `A35K JA0004`: the type and the registration; `C172 #3` for an aircraft without one. */
export const planeLabel = (a: Pick<Plane, 'icao' | 'registration' | 'id'>): string => `${a.icao} ${a.registration || `#${a.id}`}`;
/** Not on a flight (a ferry flight included) and not in the workshop. */
const free = (a: Plane): boolean => !a.busy && a.status !== 'maintenance';

/** Can one of the company's idle aircraft, standing at the job's origin, fly it? */
export const flyable = (me: Me, j: Job): boolean => me.fleet.some((a) => free(a) && a.location === j.origin && !cannotFly(a.type, j));

/** Idle aircraft that can take `j` right now. */
export const candidates = (me: Me, j: Job): Me['fleet'] => me.fleet.filter((a) => free(a) && a.location === j.origin && !cannotFly(a.type, j));

/** Distance in nm between two airports, null when either is unknown. */
export type Distance = (from: string, to: string) => number | null;

/** Why no aircraft can take a job now, and what the player can do about it. */
export type NoAircraftReason =
  | { kind: 'none' }
  | { kind: 'type'; icao: string }
  /** No aircraft is big enough or has the range: `aircraft` is the closest, `have` of the `need` (seats, kg or nm). */
  | { kind: 'seats' | 'cargo' | 'range'; aircraft: Plane; need: number; have: number }
  /** An idle aircraft that could fly it stands somewhere else: ferry it to the job's origin. */
  | { kind: 'elsewhere'; aircraft: Plane; distanceNm: number | null }
  /** The same, but the origin is beyond the aircraft's range: no single ferry flight gets it there. */
  | { kind: 'far'; aircraft: Plane; distanceNm: number }
  /** A ferry flight is about to land at the job's origin. */
  | { kind: 'arriving'; aircraft: Plane; at: number }
  | { kind: 'busy' };

/** How near an aircraft is to fitting the job for the cause it fails on: 1 = just short, 0 = hopeless; the required type is never "near". */
const nearness = (a: Plane, j: Job, cause: CannotFlyCause): number =>
  cause === 'seats' ? a.type.seats / j.pax : cause === 'cargo' ? a.type.cargoKg / j.payloadKg : cause === 'range' ? a.type.rangeNm / j.distanceNm : -1;

/** `null` when the job can be flown from where an idle aircraft stands; otherwise the first true reason it cannot, from "too small" (naming the closest-fitting aircraft)
 *  through "right aircraft, wrong airport" (the one to ferry, nearest first) to "right aircraft, busy". */
export function noAircraftReason(me: Me, j: Job, dist: Distance = () => null): NoAircraftReason | null {
  if (flyable(me, j)) return null;
  if (me.fleet.length === 0) return { kind: 'none' };
  const fits = me.fleet.filter((a) => cannotFlyCause(a.type, j) === null);
  if (fits.length === 0) {
    const tries = me.fleet.map((a) => ({ a, cause: cannotFlyCause(a.type, j)! }));
    const best = tries.reduce((b, x) => (nearness(x.a, j, x.cause) > nearness(b.a, j, b.cause) ? x : b));
    if (best.cause === 'type') return { kind: 'type', icao: j.requiredAircraft ?? best.a.icao };
    const [need, have] = best.cause === 'seats' ? [j.pax, best.a.type.seats] : best.cause === 'cargo' ? [j.payloadKg, best.a.type.cargoKg] : [j.distanceNm, best.a.type.rangeNm];
    return { kind: best.cause, aircraft: best.a, need, have };
  }
  const landing = fits.flatMap((a) => (a.location === j.origin && a.ferryUntil !== null ? [{ a, at: a.ferryUntil }] : []))[0];
  if (landing) return { kind: 'arriving', aircraft: landing.a, at: landing.at };
  const options = fits.filter((a) => free(a) && a.location !== j.origin).map((a) => ({ a, d: dist(a.location, j.origin) }));
  if (options.length === 0) return { kind: 'busy' };
  const reachable = (o: { a: Plane; d: number | null }): boolean => o.d === null || o.d <= o.a.type.rangeNm;
  const best = options.sort((x, y) => Number(reachable(y)) - Number(reachable(x)) || (x.d ?? Infinity) - (y.d ?? Infinity) || x.a.id - y.a.id)[0]!;
  return reachable(best) || best.d === null ? { kind: 'elsewhere', aircraft: best.a, distanceNm: best.d } : { kind: 'far', aircraft: best.a, distanceNm: best.d };
}

/** Jobs the player can act on: those starting where an idle aircraft stands, the flyable ones first, then by payout. */
export function jobsAtIdleAirports(me: Me, board: Board): Job[] {
  const airports = new Set(me.fleet.filter((a) => !a.busy).map((a) => a.location));
  const fly = new Map(board.jobs.map((j) => [j.id, flyable(me, j)]));
  return board.jobs.filter((j) => airports.has(j.origin)).sort((a, b) => Number(fly.get(b.id)) - Number(fly.get(a.id)) || b.payout - a.payout || a.id.localeCompare(b.id));
}

/** Jobs seen on earlier loads, so a job someone else took meanwhile can still be shown (the API only lists open jobs). */
const seen = new Map<string, Job>();
export function remember(board: Board): Board {
  for (const j of [...board.jobs, ...board.imported]) seen.set(j.id, j);
  return board;
}
export const lookupJob = (board: Board, id: string): { job: Job; open: boolean } | null => {
  const open = [...board.jobs, ...board.imported].find((j) => j.id === id);
  if (open) return { job: open, open: true };
  const old = seen.get(id);
  return old ? { job: old, open: false } : null;
};

/** Unix ms at which the next wave of board jobs appears (the board is a pure function of a 6-hour window). */
export const nextBoardWave = (now: number): number => (Math.floor(now / 21_600_000) + 1) * 21_600_000;

export type JobFilters = { kind: 'all' | 'pax' | 'cargo'; from: string; distance: 'any' | 'short' | 'mid' | 'long'; gain: 'any' | '3000' | '10000'; fleetOnly: boolean };
export const DEFAULT_FILTERS: JobFilters = { kind: 'all', from: '', distance: 'any', gain: 'any', fleetOnly: true };
const BANDS: Record<JobFilters['distance'], [number, number]> = { any: [0, Infinity], short: [0, 200], mid: [200, 500], long: [500, Infinity] };

/** Everything the board filters can say except the passenger/cargo split, which only changes what the segment counts show. */
export function matchesFilters(me: Me, j: Job, f: JobFilters, ignoreKind = false): boolean {
  const [lo, hi] = BANDS[f.distance];
  return (ignoreKind || f.kind === 'all' || j.kind === f.kind)
    && (f.from === '' || j.origin === f.from)
    && j.distanceNm >= lo && j.distanceNm < hi
    && (f.gain === 'any' || j.payout >= Number(f.gain))
    && (!f.fleetOnly || flyable(me, j));
}

/** Imported SimBrief jobs first (they are the player's own), then by payout. */
export function boardRows(me: Me, board: Board): Job[] {
  return [...board.imported, ...board.jobs].sort((a, b) => Number(b.source === 'simbrief') - Number(a.source === 'simbrief') || Number(flyable(me, b)) - Number(flyable(me, a)) || b.payout - a.payout || a.id.localeCompare(b.id));
}

/** The API has no live position for AI aircraft, so "contested" is derived from what it does expose: an AI company based at the job's origin whose fleet includes a type able to fly the job could take it. It is a possibility, never a timed prediction. */
export function aiCanTake(ai: Pick<CompanyProfile, 'hubs' | 'fleet'>, types: ReadonlyMap<string, AircraftType>, job: Job): boolean {
  return ai.hubs.includes(job.origin) && ai.fleet.some((f) => { const t = types.get(f.icao); return t !== undefined && !cannotFly(t, job); });
}
