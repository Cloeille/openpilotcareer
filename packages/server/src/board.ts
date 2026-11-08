// Deterministic shared job board: a pure function of (airport, 6-hour window). Nothing is stored until a job is claimed.
import { EXPRESS_AIRCRAFT, EXPRESS_MAX_NM, EXPRESS_MIN_NM, EXPRESS_PAYLOAD_KG, PAX_KG, distanceNm, expressPayout, jobPayout, type Airport, type AirportSize, type Job } from '@opc/shared';
import { airportList, airports } from './catalog.ts';

export const JOB_WINDOW_MS = 6 * 3_600_000;
export const windowOf = (ms: number): number => Math.floor(ms / JOB_WINDOW_MS);

const JOBS_PER_BOARD: Record<AirportSize, number> = { large: 24, medium: 18, small: 8 };
const MAX_RANGE_NM: Record<AirportSize, number> = { large: 3000, medium: 1500, small: 600 };

/** Every board mixes load classes so any aircraft finds work: light (C172), regional (turboprop/regional jet), narrowbody, widebody. Only a job that fills enough of an aircraft is offered to it
 *  (`jobMisfit`), so each class serves the aircraft of its own size; the load ranges overlap so that no size falls between two classes. */
const TIERS = [
  { pax: [1, 4], cargoKg: [30, 200], nm: [30, 450] },
  { pax: [5, 70], cargoKg: [200, 3_000], nm: [100, 1_500] },
  { pax: [70, 200], cargoKg: [3_000, 9_000], nm: [300, 3_000] },
  { pax: [150, 400], cargoKg: [8_000, 25_000], nm: [500, 3_000] },
] as const;
/** The tiers a board cycles through, by airport size: small airports only offer light jobs, medium ones light, regional and narrowbody (an A320 flies from a regional airport too: about 4 fitting jobs
 *  per window, widebodies stay rare there). Large airports are where airliners stand: half of their jobs are for narrowbodies and widebodies, so a 290-seat aircraft finds at least about 4 jobs that fit it per window. */
const TIER_PATTERN: Record<AirportSize, readonly number[]> = { large: [0, 1, 2, 3], medium: [0, 1, 2], small: [0] };
const DEST_WEIGHT: Record<AirportSize, number> = { large: 4, medium: 2, small: 1 };
/** Spaceplane express jobs (a Quasar only) are offered at large airports, the only runways it uses, between large airports; a few per board keeps them rare. */
const EXPRESS_PER_BOARD = 2;
const MIN_RANGE_NM = 25;
const FALLBACK_DESTINATIONS = 10;
const CACHE_LIMIT = 4000;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

export const boardJobId = (icao: string, window: number, i: number): string => `${icao}-${window}-${i}`;

const logUniform = (rand: number, min: number, max: number): number => Math.exp(Math.log(min) + rand * (Math.log(max) - Math.log(min)));

type Candidate = { a: Airport; d: number };

/** Airports of `list` at least MIN_RANGE_NM from `origin`, nearest first. */
function distancesFrom(origin: Airport, list: readonly Airport[]): Candidate[] {
  const all: Candidate[] = [];
  for (const a of list) {
    if (a.icao === origin.icao) continue;
    const d = distanceNm(origin.lat, origin.lon, a.lat, a.lon);
    if (d >= MIN_RANGE_NM) all.push({ a, d });
  }
  return all.sort((x, y) => x.d - y.d);
}

/** Airports reachable from `origin`, nearest first. Remote origins fall back to their nearest airports so no board is ever empty. */
function candidatesFor(origin: Airport): Candidate[] {
  const all = distancesFrom(origin, airportList);
  const inRange = all.filter((c) => c.d <= MAX_RANGE_NM[origin.size]);
  return inRange.length > 0 ? inRange : all.slice(0, FALLBACK_DESTINATIONS);
}

const largeAirports = airportList.filter((a) => a.size === 'large');

/** A destination at about `target` nm (within 15 %, else the nearest to it), larger airports preferred. `cands` is sorted and not empty. */
function pickDestination(cands: readonly Candidate[], target: number, rand: () => number): Candidate {
  const near = cands.filter((c) => c.d >= target * 0.85 && c.d <= target * 1.15);
  const pool = near.length > 0 ? near : [cands.reduce((best, c) => (Math.abs(c.d - target) < Math.abs(best.d - target) ? c : best))];
  let pick = rand() * pool.reduce((sum, c) => sum + DEST_WEIGHT[c.a.size], 0);
  for (const c of pool) if ((pick -= DEST_WEIGHT[c.a.size]) < 0) return c;
  return pool[pool.length - 1]!;
}

const cache = new Map<string, Job[]>();

export function boardFor(origin: Airport, window: number): Job[] {
  const key = `${origin.icao}:${window}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const rand = mulberry32(hashSeed(key));
  const cands = candidatesFor(origin);
  const jobs: Job[] = [];
  for (let i = 0; cands.length > 0 && i < JOBS_PER_BOARD[origin.size]; i++) {
    const pattern = TIER_PATTERN[origin.size];
    const tier = TIERS[pattern[i % pattern.length]!]!;
    // Target distance is log-uniform within the class, so short hops are as common as long hauls.
    const reach = cands[cands.length - 1]!.d;
    const lo = Math.min(tier.nm[0], reach), hi = Math.max(lo + 1, Math.min(tier.nm[1], reach));
    const target = logUniform(rand(), lo, hi);
    const dest = pickDestination(cands, target, rand);
    const kind = rand() < 0.65 ? 'pax' : 'cargo';
    const pax = kind === 'pax' ? Math.round(logUniform(rand(), tier.pax[0], tier.pax[1])) : 0;
    const payloadKg = kind === 'pax' ? pax * PAX_KG : Math.round(logUniform(rand(), tier.cargoKg[0], tier.cargoKg[1]) / 10) * 10;
    const distance = Math.round(dest.d);
    jobs.push({ id: boardJobId(origin.icao, window, i), source: 'board', kind, origin: origin.icao, destination: dest.a.icao, distanceNm: distance, payloadKg, pax, payout: jobPayout(kind, distance, payloadKg) });
  }
  if (origin.size === 'large') {
    const far = distancesFrom(origin, largeAirports).filter((c) => c.d >= EXPRESS_MIN_NM && c.d <= EXPRESS_MAX_NM);
    for (let k = 0; far.length > 0 && k < EXPRESS_PER_BOARD; k++) {
      const dest = pickDestination(far, logUniform(rand(), EXPRESS_MIN_NM, Math.min(EXPRESS_MAX_NM, far[far.length - 1]!.d)), rand);
      const distance = Math.round(dest.d);
      jobs.push({
        id: boardJobId(origin.icao, window, jobs.length), source: 'board', kind: 'cargo', origin: origin.icao, destination: dest.a.icao, distanceNm: distance,
        payloadKg: EXPRESS_PAYLOAD_KG, pax: 0, payout: expressPayout(distance), requiredAircraft: EXPRESS_AIRCRAFT,
      });
    }
  }
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, jobs);
  return jobs;
}

/** Resolve a board job id back to its job (null if malformed, unknown airport, or from another window). */
export function boardJob(id: string, window: number): Job | null {
  const m = /^([A-Z]{4})-(\d+)-(\d+)$/.exec(id);
  if (!m || Number(m[2]) !== window) return null;
  const origin = airports.get(m[1]!);
  return origin ? (boardFor(origin, window).find((j) => j.id === id) ?? null) : null;
}
