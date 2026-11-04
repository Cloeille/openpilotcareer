// Deterministic shared job board: a pure function of (airport, 6-hour window). Nothing is stored until a job is claimed.
import { PAX_KG, distanceNm, jobPayout, type Airport, type AirportSize, type Job } from '@opc/shared';
import { airportList, airports } from './catalog.ts';

export const JOB_WINDOW_MS = 6 * 3_600_000;
export const windowOf = (ms: number): number => Math.floor(ms / JOB_WINDOW_MS);

const JOBS_PER_BOARD: Record<AirportSize, number> = { large: 14, medium: 9, small: 6 };
const MAX_RANGE_NM: Record<AirportSize, number> = { large: 3000, medium: 1200, small: 450 };
const MAX_PAX: Record<AirportSize, number> = { large: 300, medium: 90, small: 12 };
const MAX_CARGO_KG: Record<AirportSize, number> = { large: 20_000, medium: 4_000, small: 500 };
const DEST_WEIGHT: Record<AirportSize, number> = { large: 4, medium: 2, small: 1 };
const MIN_RANGE_NM = 25;
const MIN_CARGO_KG = 30;
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

/** Airports reachable from `origin`, nearest first. Remote origins fall back to their nearest airports so no board is ever empty. */
function candidatesFor(origin: Airport): Candidate[] {
  const all: Candidate[] = [];
  for (const a of airportList) {
    if (a.icao === origin.icao) continue;
    const d = distanceNm(origin.lat, origin.lon, a.lat, a.lon);
    if (d >= MIN_RANGE_NM) all.push({ a, d });
  }
  all.sort((x, y) => x.d - y.d);
  const inRange = all.filter((c) => c.d <= MAX_RANGE_NM[origin.size]);
  return inRange.length > 0 ? inRange : all.slice(0, FALLBACK_DESTINATIONS);
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
    // Target distance is log-uniform so short hops (light aircraft) are as common as long hauls.
    const first = cands[0]!, last = cands[cands.length - 1]!;
    const target = logUniform(rand(), first.d, Math.max(last.d, first.d + 1));
    const near = cands.filter((c) => c.d >= target * 0.85 && c.d <= target * 1.15);
    const pool = near.length > 0 ? near : [cands.reduce((best, c) => (Math.abs(c.d - target) < Math.abs(best.d - target) ? c : best))];
    let pick = rand() * pool.reduce((sum, c) => sum + DEST_WEIGHT[c.a.size], 0);
    let dest = pool[pool.length - 1]!;
    for (const c of pool) if ((pick -= DEST_WEIGHT[c.a.size]) < 0) { dest = c; break; }
    const kind = rand() < 0.65 ? 'pax' : 'cargo';
    const pax = kind === 'pax' ? Math.max(1, Math.round(logUniform(rand(), 1, MAX_PAX[origin.size]))) : 0;
    const payloadKg = kind === 'pax' ? pax * PAX_KG : Math.round(logUniform(rand(), MIN_CARGO_KG, MAX_CARGO_KG[origin.size]) / 10) * 10;
    const distance = Math.round(dest.d);
    jobs.push({ id: boardJobId(origin.icao, window, i), source: 'board', kind, origin: origin.icao, destination: dest.a.icao, distanceNm: distance, payloadKg, pax, payout: jobPayout(kind, distance, payloadKg) });
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
