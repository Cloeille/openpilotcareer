// OpenHangar v2, lot START: the operations behind onboarding, hub suggestions, first-job reservation and the realism hooks.
// Routes live in routes-start.ts; money goes through game.ts `post`, like everything else.
import {
  FIRST_JOB_RESERVATION_MS, HUB_PARKING_MONTHLY, START_MODES, START_MODE_HUB_SIZES, cannotFly, presetSetting, realismModifiers, seasonOf, settle, withToggles,
  type Airport, type CreateCompanyStart, type HubNoteKey, type HubSuggestion, type FirstJob, type Job, type Onboarding, type OnboardingStep, type OnboardingUpdate,
  type Realism, type RealismToggles, type StartMode,
} from '@opc/shared';
import { boardFor } from './board.ts';
import { airports, searchAirports } from './catalog.ts';
import { all, get, run, type Db } from './db.ts';
import { createCompany, openBoard, post, typeFor, type AircraftRow } from './game.ts';
import { HttpError } from './http.ts';
import { realismOf, realismSettingOf, saveRealism } from './realism.ts';
import { release, reservationOf, reserve } from './reservations.ts';

export { wearEnabled, toleratedFlags } from './realism.ts';

// ---------------------------------------------------------------- onboarding state

type OnboardingRow = { user_id: number; completed: number; step: number; start_mode: StartMode | null; company_id: number | null; draft: string };

const hasCompany = (db: Db, userId: number): boolean => !!get(db, 'SELECT 1 AS x FROM companies WHERE user_id = ?', userId);

const parseDraft = (raw: string): Record<string, unknown> => {
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

/** Without a stored row: a player who already has companies is done (they predate the onboarding), one who has none starts at step 1. */
export function onboardingOf(db: Db, userId: number): Onboarding {
  const r = get<OnboardingRow>(db, 'SELECT * FROM onboarding WHERE user_id = ?', userId);
  if (!r) return { completed: hasCompany(db, userId), step: 1, startMode: null, companyId: null, draft: {} };
  return { completed: !!r.completed, step: r.step as OnboardingStep, startMode: r.start_mode, companyId: r.company_id, draft: parseDraft(r.draft) };
}

export function save(db: Db, userId: number, o: Onboarding, at: number): void {
  run(db, `INSERT INTO onboarding (user_id, completed, step, start_mode, company_id, draft, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET completed = excluded.completed, step = excluded.step, start_mode = excluded.start_mode, company_id = excluded.company_id, draft = excluded.draft, updated_at = excluded.updated_at`,
  userId, o.completed ? 1 : 0, o.step, o.startMode, o.companyId, JSON.stringify(o.draft), at);
}

/** Delete the unfinished onboarding company (it only exists for the onboarding). Refused once it has flown: that is a real company. */
function dropOnboardingCompany(db: Db, userId: number, companyId: number): void {
  if (!get(db, 'SELECT 1 AS x FROM companies WHERE id = ? AND user_id = ?', companyId, userId)) return;
  if (get(db, 'SELECT 1 AS x FROM flights WHERE company_id = ?', companyId)) throw new HttpError(409, 'company_exists', 'the onboarding company has already flown and cannot be replaced');
  run(db, 'DELETE FROM companies WHERE id = ?', companyId);
}

export function updateOnboarding(db: Db, userId: number, u: OnboardingUpdate, at: number): Onboarding {
  let o = onboardingOf(db, userId);
  if (o.completed) {
    // A finished onboarding only starts again when the player picks a start (a new company from the company switcher).
    if (!u.startMode) throw new HttpError(409, 'onboarding_completed', 'the onboarding is already completed');
    o = { completed: false, step: 1, startMode: null, companyId: null, draft: {} };
  }
  if (u.startMode && u.startMode !== o.startMode) {
    if (o.companyId !== null) dropOnboardingCompany(db, userId, o.companyId);
    o = { ...o, startMode: u.startMode, companyId: null };
  }
  if (u.step !== undefined) o = { ...o, step: u.step as OnboardingStep };
  if (u.draft !== undefined) o = { ...o, draft: u.draft };
  save(db, userId, o, at);
  return o;
}

export function completeOnboarding(db: Db, userId: number, at: number): Onboarding {
  const o = onboardingOf(db, userId);
  if (o.completed) return o;
  if (o.companyId === null || !get(db, 'SELECT 1 AS x FROM companies WHERE id = ? AND user_id = ?', o.companyId, userId)) throw new HttpError(409, 'no_company', 'found your company first');
  if (!get(db, 'SELECT 1 AS x FROM aircraft WHERE company_id = ?', o.companyId)) throw new HttpError(409, 'no_aircraft', 'get a first aircraft before finishing the onboarding');
  const done: Onboarding = { ...o, completed: true, step: 6 };
  save(db, userId, done, at);
  return done;
}

// ---------------------------------------------------------------- founding a company

/** `POST /me/companies`. Without `startMode` this is the legacy flow (starter C172, flat capital). With it the company starts from the mode's
 *  capital with no aircraft, and the onboarding points at it; a previous unfinished onboarding company is replaced (the player went back a step). */
export function foundCompany(db: Db, userId: number, b: CreateCompanyStart, now: number): number {
  const identity = { ...(b.code !== undefined ? { code: b.code } : {}), ...(b.callsign !== undefined ? { callsign: b.callsign } : {}), ...(b.liveryColor ? { liveryColor: b.liveryColor } : {}) };
  if (!b.startMode) return createCompany(db, { userId, name: b.name, hub: b.hub, now, ...identity });
  const before = onboardingOf(db, userId);
  if (!before.completed && before.companyId !== null) dropOnboardingCompany(db, userId, before.companyId);
  const id = createCompany(db, { userId, name: b.name, hub: b.hub, now, startMode: b.startMode, ...identity });
  // The company is founded at the end of step 2: the player moves on to the first aircraft (3) unless they are already further.
  save(db, userId, { completed: false, step: Math.max(3, before.completed ? 3 : before.step) as OnboardingStep, startMode: b.startMode, companyId: id, draft: before.completed ? {} : before.draft }, now);
  return id;
}

export const airlineCodeAvailable = (db: Db, code: string): boolean => !get(db, 'SELECT 1 AS x FROM companies WHERE code = ?', code);

// ---------------------------------------------------------------- hub suggestions

const CURATED_HUBS: Record<StartMode, string[]> = {
  airliner: ['LFMN', 'LFPG', 'LFLL', 'LFML', 'LFBO', 'EGLL', 'EDDF', 'EHAM'],
  hardcore: ['LFTZ', 'LFNA', 'LFOU', 'LFOO', 'LFAB', 'LFAQ', 'LFHM', 'LFEY'],
};
const NEARBY_NM = 300;
const MAX_HUBS = 6;
const DAY_MS = 86_400_000;

/** Departures within 300 nm on the boards of the UTC day of `now` (4 boards of 6 h): real board data, not an estimate. */
export function jobsNearby(a: Airport, now: number): number {
  const first = Math.floor(now / DAY_MS) * 4;
  let n = 0;
  for (let w = first; w < first + 4; w++) n += boardFor(a, w).filter((j) => j.distanceNm <= NEARBY_NM).length;
  return n;
}

const aiBasedAt = (db: Db): Map<string, number> =>
  new Map(all<{ icao: string; n: number }>(db, 'SELECT h.icao AS icao, COUNT(*) AS n FROM hubs h JOIN companies c ON c.id = h.company_id WHERE c.user_id IS NULL GROUP BY h.icao').map((r) => [r.icao, r.n]));

const NOTES: Record<HubNoteKey, string> = {
  most_jobs: 'The most departures',
  least_competition: 'The least competition',
  balanced: 'A balanced start',
  match: 'Matches your search',
};

export function hubSuggestions(db: Db, mode: StartMode, q: string | undefined, now: number): HubSuggestion[] {
  const sizes = START_MODE_HUB_SIZES[mode];
  const query = q?.trim() ?? '';
  const picked = query
    ? searchAirports(query, 100).filter((a) => sizes.includes(a.size)).slice(0, MAX_HUBS)
    : CURATED_HUBS[mode].map((c) => airports.get(c)).filter((a): a is Airport => !!a && START_MODES[mode].hubSize === a.size).slice(0, MAX_HUBS);
  const ai = aiBasedAt(db);
  const rows = picked.map((a) => ({ a, jobs: jobsNearby(a, now), ai: ai.get(a.icao) ?? 0 }));
  const mostJobs = rows.length > 1 ? rows.reduce((b, r) => (r.jobs > b.jobs ? r : b)).a.icao : null;
  const rest = rows.filter((r) => r.a.icao !== mostJobs);
  const quietest = rest.length > 0 ? rest.reduce((b, r) => (r.ai < b.ai ? r : b)) : null;
  const leastCompetition = quietest && rest.some((r) => r.ai > quietest.ai) ? quietest.a.icao : null;
  return rows.map(({ a, jobs, ai: aiCount }) => {
    const noteKey: HubNoteKey = query ? 'match' : a.icao === mostJobs ? 'most_jobs' : a.icao === leastCompetition ? 'least_competition' : 'balanced';
    return { icao: a.icao, name: a.name, city: a.city, size: a.size, parkingMonthly: HUB_PARKING_MONTHLY[a.size], jobsNearby: jobs, aiCompaniesBased: aiCount, note: NOTES[noteKey], noteKey };
  });
}

// ---------------------------------------------------------------- realism

/** The mode the company was founded with; null for companies that predate v2 and for AI companies. */
export const startModeOf = (db: Db, companyId: number): StartMode | null =>
  get<{ start_mode: StartMode | null }>(db, 'SELECT start_mode FROM companies WHERE id = ?', companyId)?.start_mode ?? null;

export function setRealism(db: Db, companyId: number, u: { preset: 'relaxed' | 'balanced' | 'hardcore' } | { toggles: Partial<RealismToggles> }): Realism {
  const cur = realismSettingOf(db, companyId);
  const next = 'preset' in u ? presetSetting(u.preset) : withToggles(cur, Object.fromEntries(Object.entries(u.toggles).filter(([, v]) => v !== undefined)));
  saveRealism(db, companyId, next);
  return realismOf(db, companyId);
}

/** Monthly billing calls this once per billed month: with `bankruptcyBailout` on, a negative balance is cleared once per season.
 *  Returns the amount written off (0: nothing to do). Posts a `bailout` ledger line; the caller wraps it in its transaction. */
export function applyBailout(db: Db, companyId: number, at: number): number {
  if (!realismSettingOf(db, companyId).toggles.bankruptcyBailout) return 0;
  const balance = get<{ balance: number }>(db, 'SELECT balance FROM companies WHERE id = ?', companyId)?.balance ?? 0;
  if (balance >= 0) return 0;
  const season = seasonOf(at);
  if (run(db, 'INSERT INTO bailouts (company_id, season, at, amount) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', companyId, season, at, -balance).changes === 0) return 0;
  post(db, companyId, at, 'bailout', -balance, `bank bailout ${season}`);
  return -balance;
}

// ---------------------------------------------------------------- first job

/** The first job: reserved 2 h for the company, so neither another player nor the AI can take it. Asking again returns the same job while it is held. */
export function firstJob(db: Db, companyId: number, now: number): FirstJob {
  const held = reservationOf(db, companyId, now);
  if (held) {
    const job = boardJobById(held.jobId);
    if (job) return { job, reservedUntil: held.reservedUntil };
    release(db, companyId, held.jobId);
  }
  const fleet = all<AircraftRow & { busy: number }>(db, `SELECT a.*, EXISTS (SELECT 1 FROM flights f WHERE f.aircraft_id = a.id AND f.status = 'active') AS busy FROM aircraft a WHERE a.company_id = ? ORDER BY a.id`, companyId);
  if (fleet.length === 0) throw new HttpError(409, 'no_aircraft', 'the company has no aircraft yet');
  const hubs = all<{ icao: string }>(db, 'SELECT icao FROM hubs WHERE company_id = ? ORDER BY icao', companyId).map((h) => h.icao);
  let best: { job: Job; net: number } | null = null;
  for (const hub of hubs) {
    const ready = fleet.filter((a) => a.location === hub && !a.busy).map((a) => typeFor(db, companyId, a.icao));
    if (ready.length === 0) continue;
    for (const job of openBoard(db, hub, now, companyId)) {
      const type = ready.find((t) => !cannotFly(t, job));
      if (!type) continue;
      const net = settle({ payout: job.payout, distanceNm: job.distanceNm, aircraft: type, status: 'verified', destSize: airports.get(job.destination)?.size ?? 'small', destIsHub: hubs.includes(job.destination), ...realismModifiers(realismSettingOf(db, companyId).toggles) }).net;
      if (net > 0 && (!best || net > best.net || (net === best.net && job.id < best.job.id))) best = { job, net };
    }
  }
  if (!best) throw new HttpError(409, 'no_flyable_job', 'no job at your hub fits your fleet right now; try again after the next board refresh');
  const reservedUntil = now + FIRST_JOB_RESERVATION_MS;
  reserve(db, companyId, best.job.id, reservedUntil);
  return { job: best.job, reservedUntil };
}

function boardJobById(id: string): Job | null {
  const m = /^([A-Z]{4})-(\d+)-\d+$/.exec(id);
  const origin = m && airports.get(m[1]!);
  return origin ? (boardFor(origin, Number(m![2])).find((j) => j.id === id) ?? null) : null;
}
