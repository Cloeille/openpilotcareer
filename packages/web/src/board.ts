import { cannotFly, type AircraftType, type CompanyProfile, type Job, type Me } from '@opc/shared';

/** The shape of GET /jobs: board jobs at every airport where the company has an aircraft, plus the player's pending SimBrief imports. */
export type Board = { jobs: Job[]; imported: Job[] };

/** Can one of the company's idle aircraft, standing at the job's origin, fly it? */
export const flyable = (me: Me, j: Job): boolean => me.fleet.some((a) => !a.busy && a.location === j.origin && !cannotFly(a.type, j));

/** Idle aircraft that can take `j` right now. */
export const candidates = (me: Me, j: Job): Me['fleet'] => me.fleet.filter((a) => !a.busy && a.location === j.origin && !cannotFly(a.type, j));

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
