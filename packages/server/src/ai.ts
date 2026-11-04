// AI companies: a deterministic tick, idempotent by tick index, run lazily on request (see app.ts).
// They play through the same game.ts operations and the same `settle` maths as players, from the same shared board.
import { aircraftPrice, blockHours, cannotFly, settle, type Job, type Personality } from '@opc/shared';
import { airports } from './catalog.ts';
import { hashSeed, mulberry32 } from './board.ts';
import { all, get, run, tx, type Db } from './db.ts';
import { buyAircraft, createCompany, finishFlight, openBoard, startFlight, typeFor, type AircraftRow } from './game.ts';

/** ponytail: a tick lets each aircraft fly at most one leg; leg duration is not simulated. 6 h keeps AI pace within reach of a diligent human. */
export const TICK_MS = 6 * 3_600_000;
const MAX_CATCHUP_TICKS = 12;
const MAX_AI_FLEET = 12;
const WARMUP_TICKS = 8;

export type AiSeed = { name: string; hub: string; personality: Personality };

export const AI_COMPANIES: AiSeed[] = [
  { name: 'Aurora Airways', hub: 'EGLL', personality: { style: 'cautious', preferred: ['C208', 'DH8D', 'E170', 'A320', 'B738'] } },
  { name: 'Redwood Regional', hub: 'KSEA', personality: { style: 'cautious', preferred: ['PC12', 'B190', 'AT76', 'DH8D'] } },
  { name: 'Skyline Express', hub: 'KJFK', personality: { style: 'aggressive', preferred: ['PA46', 'PC12', 'E170', 'B738', 'B763'] } },
  { name: 'Pacific Wings', hub: 'RJTT', personality: { style: 'aggressive', preferred: ['C208', 'AT76', 'A320', 'B788', 'B77W'] } },
  { name: 'Sahara Cargo', hub: 'OMDB', personality: { style: 'aggressive', preferred: ['C208', 'B190', 'B763', 'B77W'] } },
  { name: 'Alpine Charter', hub: 'LSZH', personality: { style: 'cautious', preferred: ['TBM9', 'PC12', 'C750', 'GLF6'] } },
  { name: 'Outback Bush Air', hub: 'YSSY', personality: { style: 'cautious', preferred: ['C182', 'C208', 'PC12', 'B190'] } },
  { name: 'Nordic Link', hub: 'ENGM', personality: { style: 'aggressive', preferred: ['PC12', 'AT76', 'DH8D', 'E170'] } },
];

// Style decides how much cash stays in reserve when buying, how often an aircraft flies, and what a job is scored by.
const STYLE = {
  aggressive: { reserve: 0.1, flyChance: 0.9 },
  cautious: { reserve: 0.5, flyChance: 0.6 },
} as const;

export const tickOf = (now: number): number => Math.floor(now / TICK_MS);

/** Create the AI companies that do not exist yet and pin the first tick. Idempotent. */
export function seedAi(db: Db, now: number): void {
  tx(db, () => {
    for (const s of AI_COMPANIES) {
      if (!get(db, 'SELECT 1 AS x FROM companies WHERE name = ? AND user_id IS NULL', s.name)) {
        createCompany(db, { userId: null, name: s.name, hub: s.hub, personality: s.personality, now });
      }
    }
    // First boot starts a day in the past so the competition already has history when the first player arrives.
    run(db, "INSERT INTO meta (key, value) VALUES ('ai_start_tick', ?) ON CONFLICT DO NOTHING", String(tickOf(now) - WARMUP_TICKS));
  });
}

type AiCompany = { id: number; personality: string };

function playCompany(db: Db, c: AiCompany, tick: number): void {
  const at = tick * TICK_MS;
  const personality = JSON.parse(c.personality) as Personality;
  const style = STYLE[personality.style];
  const rand = mulberry32(hashSeed(`ai:${c.id}:${tick}`));
  const hubs = all<{ icao: string }>(db, 'SELECT icao FROM hubs WHERE company_id = ? ORDER BY icao', c.id).map((h) => h.icao);
  const fleet = all<AircraftRow>(db, 'SELECT * FROM aircraft WHERE company_id = ? ORDER BY id', c.id);

  for (const aircraft of fleet) {
    if (rand() >= style.flyChance) continue;
    const type = typeFor(db, c.id, aircraft.icao);
    let best: { job: Job; score: number } | null = null;
    for (const job of openBoard(db, aircraft.location, at)) {
      if (cannotFly(type, job)) continue;
      const s = settle({ payout: job.payout, distanceNm: job.distanceNm, aircraft: type, status: 'verified', destSize: airports.get(job.destination)?.size ?? 'small', destIsHub: hubs.includes(job.destination) });
      // at a hub an unprofitable job is skipped; elsewhere the best one is flown anyway to reposition
      if (s.net <= 0 && hubs.includes(aircraft.location)) continue;
      // aggressive: biggest absolute profit; cautious: best profit per block hour
      const score = personality.style === 'aggressive' ? s.net : s.net / blockHours(type, job.distanceNm);
      if (!best || score > best.score) best = { job, score };
    }
    if (best) finishFlight(db, startFlight(db, c.id, best.job, aircraft, at), 'verified', at);
  }

  const company = get<{ balance: number }>(db, 'SELECT balance FROM companies WHERE id = ?', c.id)!;
  if (fleet.length < MAX_AI_FLEET) {
    // Buy the most expensive preferred type that still leaves the style's cash reserve.
    const pick = personality.preferred
      .map((icao) => typeFor(db, c.id, icao))
      .filter((t) => company.balance >= aircraftPrice(t) * (1 + style.reserve))
      .sort((a, b) => aircraftPrice(b) - aircraftPrice(a))[0];
    if (pick) buyAircraft(db, c.id, pick.icao, hubs[Math.floor(rand() * hubs.length)]!, at);
  }
}

/** Run one tick. Returns false (and changes nothing) when that tick index has already been played. */
export function runTick(db: Db, tick: number): boolean {
  return tx(db, () => {
    if (run(db, 'INSERT INTO ai_ticks (tick) VALUES (?) ON CONFLICT DO NOTHING', tick).changes === 0) return false;
    for (const c of all<AiCompany>(db, 'SELECT id, personality FROM companies WHERE user_id IS NULL AND personality IS NOT NULL ORDER BY id')) playCompany(db, c, tick);
    return true;
  });
}

/** Play every tick that is due (bounded; older ones are skipped, never replayed). Cheap no-op when up to date. */
export function catchUp(db: Db, now: number): number {
  const start = Number(get<{ value: string }>(db, "SELECT value FROM meta WHERE key = 'ai_start_tick'")?.value ?? tickOf(now));
  const last = get<{ t: number | null }>(db, 'SELECT MAX(tick) AS t FROM ai_ticks')?.t ?? start - 1;
  const current = tickOf(now);
  let played = 0;
  for (let t = Math.max(last + 1, current - MAX_CATCHUP_TICKS + 1); t <= current; t++) if (runTick(db, t)) played++;
  return played;
}
