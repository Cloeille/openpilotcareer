// Domain operations. Players (HTTP routes) and AI companies (tick) both go through these, so rules and money
// maths exist once. Nothing here opens a transaction: callers wrap each operation in `tx` (see app.ts / ai.ts).
// Rule violations throw HttpError.
import { randomUUID } from 'node:crypto';
import {
  HUB_PRICE, MAX_COMPANIES_PER_USER, PAX_KG, REJECT_REPUTATION_PENALTY, START_MODES, START_REPUTATION, STARTER_AIRCRAFT, STARTING_BALANCE,
  aircraftPrice, aircraftValue, blockHours, cannotFly, distanceNm, fuelPriceFactor, jobPayout, minFlightHours, presetSetting, rankFor, realismModifiers, realismView, seasonOf, settle,
  type AircraftType, type Company, type CompanyProfile, type CustomAircraftInput, type FleetAircraft, type Flight,
  type FlightStatus, type Job, type Leaderboard, type LeaderboardRow, type Me, type Personality, type Pilot, type StartMode, type Telemetry, type Transaction,
} from '@opc/shared';
import { airports, catalogType } from './catalog.ts';
import { boardFor, boardJob, windowOf } from './board.ts';
import { all, get, run, type Db } from './db.ts';
import { HttpError } from './http.ts';
import { parseRealism, realismSettingOf, saveRealism } from './realism.ts';
import { release, reservedAgainst, reservedIds, reservationOf, windowOfJobId } from './reservations.ts';
import type { Ofp } from './simbrief.ts';

export const MAX_CUSTOM_AIRCRAFT = 20;
export const MAX_PENDING_IMPORTS = 25;
const IMPORT_TTL_MS = 7 * 24 * 3_600_000;
const NET_WORTH_SQL = `c.balance + COALESCE((SELECT SUM(value) FROM aircraft WHERE company_id = c.id), 0)`;
const SB_PREFIX = 'sb-';

// ---------------------------------------------------------------- rows

type CompanyRow = {
  id: number; user_id: number | null; name: string; personality: string | null; balance: number; reputation: number; flights: number; hours: number; revenue: number;
  code: string | null; callsign: string | null; livery_color: string | null; start_mode: StartMode | null; realism: string | null;
};
export type AircraftRow = { id: number; company_id: number; icao: string; location: string; value: number };
type JobColumns = {
  source: 'board' | 'simbrief'; kind: 'pax' | 'cargo'; origin: string; destination: string; distance_nm: number; payload_kg: number;
  pax: number; payout: number; required_aircraft: string | null; planned_fuel_kg: number | null; route: string | null;
};
type CustomJobRow = JobColumns & { id: string; company_id: number; created_at: number };
export type FlightRow = JobColumns & {
  id: number; company_id: number; aircraft_id: number; aircraft_icao: string; job_id: string; status: FlightStatus;
  reject_reason: string | null; accepted_at: number; completed_at: number | null; season: string | null;
  revenue: number; fuel_cost: number; landing_fee: number; maintenance: number; net: number; telemetry: string | null;
};
type CustomRow = { icao: string; name: string; category: AircraftType['category']; engines: number; wtc: AircraftType['wtc']; seats: number; cargo_kg: number; cruise_kts: number; range_nm: number };

const round1 = (n: number): number => Math.round(n * 10) / 10;
const hasHub = (db: Db, companyId: number, icao: string): boolean => !!get(db, 'SELECT 1 AS x FROM hubs WHERE company_id = ? AND icao = ?', companyId, icao);

/** The aircraft record every calculation uses: the company's own custom definition, else the catalog, else the category fallback. */
export function typeFor(db: Db, companyId: number, icao: string): AircraftType {
  const c = get<CustomRow>(db, 'SELECT * FROM custom_aircraft WHERE company_id = ? AND icao = ?', companyId, icao);
  if (!c) return catalogType(icao);
  return { icao: c.icao, name: c.name, category: c.category, engines: c.engines, wtc: c.wtc, seats: c.seats, cargoKg: c.cargo_kg, cruiseKts: c.cruise_kts, rangeNm: c.range_nm, derived: false };
}

// ---------------------------------------------------------------- ledger

/** The only place a balance changes: updates the balance and appends the matching ledger line. */
export function post(db: Db, companyId: number, at: number, kind: string, amount: number, memo: string, flightId: number | null = null): void {
  const row = get<{ balance: number }>(db, 'UPDATE companies SET balance = balance + ? WHERE id = ? RETURNING balance', amount, companyId);
  if (!row) throw new HttpError(404, 'company_not_found', 'company not found');
  run(db, 'INSERT INTO transactions (company_id, at, kind, amount, balance_after, flight_id, memo) VALUES (?, ?, ?, ?, ?, ?, ?)', companyId, at, kind, amount, row.balance, flightId, memo);
}

function spend(db: Db, companyId: number, at: number, kind: string, price: number, memo: string): void {
  const c = get<{ balance: number }>(db, 'SELECT balance FROM companies WHERE id = ?', companyId);
  if (!c || c.balance < price) throw new HttpError(402, 'insufficient_funds', `needs ${price}, balance is ${c?.balance ?? 0}`);
  post(db, companyId, at, kind, -price, memo);
}

/** Record the company's current numbers in the season of `at` (history for past seasons; the current one is read live). */
function snapshot(db: Db, companyId: number, at: number): void {
  const season = seasonOf(at);
  run(db, `INSERT INTO season_stats (season, company_id, net_worth, flights, reputation)
    SELECT ?1, c.id, ${NET_WORTH_SQL}, (SELECT COUNT(*) FROM flights f WHERE f.company_id = c.id AND f.season = ?1 AND f.status IN ('verified','unverified')), c.reputation
    FROM companies c WHERE c.id = ?2
    ON CONFLICT (season, company_id) DO UPDATE SET net_worth = excluded.net_worth, flights = excluded.flights, reputation = excluded.reputation`, season, companyId);
}

// ---------------------------------------------------------------- company, hubs, fleet

function assertNameFree(db: Db, name: string, exceptId = 0): void {
  if (get(db, 'SELECT 1 AS x FROM companies WHERE name = ? AND id != ?', name, exceptId)) throw new HttpError(409, 'name_taken', `company name "${name}" is already taken`);
}

export type NewCompany = {
  userId: number | null; name: string; hub: string; personality?: Personality; now: number;
  /** v2 identity. With `startMode` the company starts from that mode's capital with NO aircraft (the onboarding leases or rents one) and its suggested realism. */
  code?: string; callsign?: string; liveryColor?: string | null; startMode?: StartMode;
};

/** Every new company gets the same starting capital and aircraft, so the per-player cap is what limits farming that grant. */
export function createCompany(db: Db, o: NewCompany): number {
  if (!airports.has(o.hub)) throw new HttpError(422, 'unknown_airport', `airport ${o.hub} is not in the airport database`);
  if (o.userId !== null && get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM companies WHERE user_id = ?', o.userId)!.n >= MAX_COMPANIES_PER_USER) {
    throw new HttpError(409, 'limit_reached', `at most ${MAX_COMPANIES_PER_USER} companies per player`);
  }
  assertNameFree(db, o.name);
  if (o.code !== undefined && get(db, 'SELECT 1 AS x FROM companies WHERE code = ?', o.code)) throw new HttpError(409, 'code_taken', `airline code ${o.code} is already taken`);
  const mode = o.startMode ? START_MODES[o.startMode] : null;
  const id = run(db, `INSERT INTO companies (user_id, name, personality, balance, reputation, created_at, code, callsign, livery_color, start_mode, realism) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
    o.userId, o.name, o.personality ? JSON.stringify(o.personality) : null, START_REPUTATION, o.now, o.code ?? null, o.callsign ?? null, o.liveryColor ?? null, o.startMode ?? null,
    mode ? JSON.stringify(presetSetting(mode.suggestedRealism)) : null).id;
  post(db, id, o.now, 'grant', mode?.capital ?? STARTING_BALANCE, 'starting capital');
  run(db, 'INSERT INTO hubs (company_id, icao) VALUES (?, ?)', id, o.hub);
  if (!mode) {
    const starter = catalogType(STARTER_AIRCRAFT);
    run(db, 'INSERT INTO aircraft (company_id, icao, location, value) VALUES (?, ?, ?, ?)', id, starter.icao, o.hub, aircraftValue(starter));
  }
  return id;
}

export function renameCompany(db: Db, companyId: number, name: string): Company {
  assertNameFree(db, name, companyId);
  run(db, 'UPDATE companies SET name = ? WHERE id = ?', name, companyId);
  return companyView(db, companyId);
}

export function buyHub(db: Db, companyId: number, icao: string, now: number): void {
  if (!airports.has(icao)) throw new HttpError(422, 'unknown_airport', `airport ${icao} is not in the airport database`);
  if (hasHub(db, companyId, icao)) throw new HttpError(409, 'hub_exists', `${icao} is already a hub`);
  spend(db, companyId, now, 'purchase_hub', HUB_PRICE, `hub ${icao}`);
  run(db, 'INSERT INTO hubs (company_id, icao) VALUES (?, ?)', companyId, icao);
  snapshot(db, companyId, now);
}

export function buyAircraft(db: Db, companyId: number, icao: string, hub: string, now: number): AircraftRow {
  if (!hasHub(db, companyId, hub)) throw new HttpError(422, 'not_a_hub', `${hub} is not one of your hubs`);
  const t = typeFor(db, companyId, icao);
  spend(db, companyId, now, 'purchase_aircraft', aircraftPrice(t), `${t.icao} ${t.name}`);
  const id = run(db, 'INSERT INTO aircraft (company_id, icao, location, value) VALUES (?, ?, ?, ?)', companyId, t.icao, hub, aircraftValue(t)).id;
  snapshot(db, companyId, now);
  return get<AircraftRow>(db, 'SELECT * FROM aircraft WHERE id = ?', id)!;
}

export function addCustomAircraft(db: Db, companyId: number, a: CustomAircraftInput): AircraftType {
  const n = get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM custom_aircraft WHERE company_id = ?', companyId)!.n;
  if (n >= MAX_CUSTOM_AIRCRAFT) throw new HttpError(409, 'limit_reached', `at most ${MAX_CUSTOM_AIRCRAFT} custom aircraft`);
  if (get(db, 'SELECT 1 AS x FROM custom_aircraft WHERE company_id = ? AND icao = ?', companyId, a.icao)) throw new HttpError(409, 'custom_aircraft_exists', `custom aircraft ${a.icao} already exists`);
  run(db, 'INSERT INTO custom_aircraft (company_id, icao, name, category, engines, wtc, seats, cargo_kg, cruise_kts, range_nm) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    companyId, a.icao, a.name, a.category, a.engines, a.wtc, a.seats, a.cargoKg, a.cruiseKts, a.rangeNm);
  return typeFor(db, companyId, a.icao);
}

export function deleteCustomAircraft(db: Db, companyId: number, icao: string): void {
  if (get(db, 'SELECT 1 AS x FROM aircraft WHERE company_id = ? AND icao = ?', companyId, icao)) throw new HttpError(409, 'in_use', `a ${icao} is in your fleet`);
  if (run(db, 'DELETE FROM custom_aircraft WHERE company_id = ? AND icao = ?', companyId, icao).changes === 0) throw new HttpError(404, 'not_found', `no custom aircraft ${icao}`);
}

// ---------------------------------------------------------------- views

export function companyView(db: Db, id: number): Company {
  const r = get<CompanyRow & { net_worth: number }>(db, `SELECT c.*, ${NET_WORTH_SQL} AS net_worth FROM companies c WHERE c.id = ?`, id);
  if (!r) throw new HttpError(404, 'company_not_found', 'company not found');
  return {
    id: r.id, name: r.name, balance: r.balance, reputation: round1(r.reputation), flights: r.flights, hours: round1(r.hours), revenue: r.revenue, netWorth: r.net_worth, isAI: r.user_id === null,
    code: r.code, callsign: r.callsign, liveryColor: r.livery_color, startMode: r.start_mode, realism: realismView(parseRealism(r.realism)),
  };
}

export function fleetView(db: Db, companyId: number): FleetAircraft[] {
  return all<AircraftRow & { busy: number }>(db, `SELECT a.*, EXISTS (SELECT 1 FROM flights f WHERE f.aircraft_id = a.id AND f.status = 'active') AS busy FROM aircraft a WHERE a.company_id = ? ORDER BY a.id`, companyId)
    .map((a) => ({ id: a.id, icao: a.icao, type: typeFor(db, companyId, a.icao), location: a.location, busy: !!a.busy, value: a.value }));
}

export const hubsOf = (db: Db, companyId: number): string[] => all<{ icao: string }>(db, 'SELECT icao FROM hubs WHERE company_id = ? ORDER BY icao', companyId).map((h) => h.icao);

export const customAircraftOf = (db: Db, companyId: number): AircraftType[] =>
  all<{ icao: string }>(db, 'SELECT icao FROM custom_aircraft WHERE company_id = ? ORDER BY icao', companyId).map((c) => typeFor(db, companyId, c.icao));

export const companiesOf = (db: Db, userId: number): Company[] =>
  all<{ id: number }>(db, 'SELECT id FROM companies WHERE user_id = ? ORDER BY id', userId).map((c) => companyView(db, c.id));

/** The pilot is the account: rank counts hours and flights over all of the player's companies, so it is derived, never stored. */
export function pilotView(db: Db, userId: number): Pilot {
  const t = get<{ hours: number; flights: number }>(db, 'SELECT COALESCE(SUM(hours), 0) AS hours, COALESCE(SUM(flights), 0) AS flights FROM companies WHERE user_id = ?', userId)!;
  return { rank: rankFor(t.hours, t.flights), hours: round1(t.hours), flights: t.flights };
}

/** The account seen through `companyId`, which the caller has already proven is the user's (auth.ts `ownedCompany`). */
export function meView(db: Db, userId: number, companyId: number): Me {
  const u = get<{ username: string }>(db, 'SELECT username FROM users WHERE id = ?', userId);
  if (!u) throw new HttpError(404, 'user_not_found', 'user not found');
  return { username: u.username, pilot: pilotView(db, userId), company: companyView(db, companyId), companies: companiesOf(db, userId), hubs: hubsOf(db, companyId), fleet: fleetView(db, companyId), customAircraft: customAircraftOf(db, companyId) };
}

export function jobView(r: JobColumns & { id: string }): Job {
  const j: Job = { id: r.id, source: r.source, kind: r.kind, origin: r.origin, destination: r.destination, distanceNm: r.distance_nm, payloadKg: r.payload_kg, pax: r.pax, payout: r.payout };
  if (r.required_aircraft) j.requiredAircraft = r.required_aircraft;
  if (r.planned_fuel_kg !== null) j.plannedFuelKg = r.planned_fuel_kg;
  if (r.route) j.route = r.route;
  return j;
}

export const flightView = (r: FlightRow): Flight => ({
  id: r.id, companyId: r.company_id, job: jobView({ ...r, id: r.job_id }), aircraftId: r.aircraft_id, aircraftIcao: r.aircraft_icao, status: r.status, rejectReason: r.reject_reason,
  acceptedAt: r.accepted_at, completedAt: r.completed_at, revenue: r.revenue, fuelCost: r.fuel_cost, landingFee: r.landing_fee, maintenance: r.maintenance, net: r.net,
});

export function flightsOf(db: Db, companyId: number, limit: number, before?: number, status?: FlightStatus): FlightRow[] {
  return all<FlightRow>(db, 'SELECT * FROM flights WHERE company_id = ?1 AND id < ?2 AND (?3 IS NULL OR status = ?3) ORDER BY id DESC LIMIT ?4', companyId, before ?? Number.MAX_SAFE_INTEGER, status ?? null, limit);
}

/** Active flights across all of a player's companies: what a (player-wide) API key reports on. */
export const activeFlightsOfUser = (db: Db, userId: number, limit: number): FlightRow[] =>
  all<FlightRow>(db, `SELECT f.* FROM flights f JOIN companies c ON c.id = f.company_id WHERE c.user_id = ? AND f.status = 'active' ORDER BY f.id DESC LIMIT ?`, userId, limit);

export function transactionsOf(db: Db, companyId: number, limit: number, before?: number): Transaction[] {
  return all<{ id: number; at: number; kind: string; amount: number; balance_after: number; flight_id: number | null; memo: string }>(
    db, 'SELECT * FROM transactions WHERE company_id = ? AND id < ? ORDER BY id DESC LIMIT ?', companyId, before ?? Number.MAX_SAFE_INTEGER, limit,
  ).map((t) => ({ id: t.id, at: t.at, kind: t.kind, amount: t.amount, balanceAfter: t.balance_after, flightId: t.flight_id, memo: t.memo }));
}

// ---------------------------------------------------------------- job board

const claimedIds = (db: Db, prefix: string): Set<string> =>
  new Set(all<{ job_id: string }>(db, 'SELECT job_id FROM job_claims WHERE job_id LIKE ?', `${prefix}%`).map((c) => c.job_id));

/** Shared board of an airport for the window containing `now`, minus jobs already taken by anyone and jobs reserved for another
 *  company (`companyId`: the one looking; without it every live reservation is hidden, which is what the AI sees). */
export function openBoard(db: Db, icao: string, now: number, companyId?: number): Job[] {
  const origin = airports.get(icao);
  if (!origin) throw new HttpError(404, 'unknown_airport', `airport ${icao} is not in the airport database`);
  const window = windowOf(now);
  const prefix = `${icao}-${window}-`;
  const taken = claimedIds(db, prefix);
  const held = reservedIds(db, prefix, companyId, now);
  return boardFor(origin, window).filter((j) => !taken.has(j.id) && !held.has(j.id));
}

export function pendingImports(db: Db, companyId: number, now: number): Job[] {
  return all<CustomJobRow>(db, `SELECT j.* FROM custom_jobs j WHERE j.company_id = ? AND j.created_at > ? AND NOT EXISTS (SELECT 1 FROM job_claims c WHERE c.job_id = j.id) ORDER BY j.created_at DESC`, companyId, now - IMPORT_TTL_MS).map(jobView);
}

/** Create a custom job from a validated SimBrief OFP. Payload maths follow the board rules, so pax jobs pay for pax x PAX_KG only. */
export function importJob(db: Db, companyId: number, ofp: Ofp, now: number): Job {
  const from = airports.get(ofp.origin), to = airports.get(ofp.destination);
  if (!from || !to) throw new HttpError(422, 'unknown_airport', `${!from ? ofp.origin : ofp.destination} is not in the airport database`);
  if (from.icao === to.icao) throw new HttpError(422, 'invalid_plan', 'origin and destination are the same airport');
  const kind = ofp.pax > 0 ? 'pax' : 'cargo';
  const payloadKg = kind === 'pax' ? ofp.pax * PAX_KG : ofp.payloadKg;
  if (payloadKg <= 0) throw new HttpError(422, 'invalid_plan', 'the flight plan carries no passengers or cargo');
  run(db, 'DELETE FROM custom_jobs WHERE company_id = ? AND created_at <= ?', companyId, now - IMPORT_TTL_MS);
  const n = get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM custom_jobs j WHERE j.company_id = ? AND NOT EXISTS (SELECT 1 FROM job_claims c WHERE c.job_id = j.id)`, companyId)!.n;
  if (n >= MAX_PENDING_IMPORTS) throw new HttpError(409, 'limit_reached', `at most ${MAX_PENDING_IMPORTS} imported jobs can wait; fly or let some expire`);
  const dist = Math.round(distanceNm(from.lat, from.lon, to.lat, to.lon));
  const pax = kind === 'pax' ? ofp.pax : 0;
  const payout = jobPayout(kind, dist, payloadKg);
  const id = SB_PREFIX + randomUUID();
  run(db, `INSERT INTO custom_jobs (id, company_id, created_at, kind, origin, destination, distance_nm, payload_kg, pax, payout, required_aircraft, planned_fuel_kg, route)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, companyId, now, kind, ofp.origin, ofp.destination, dist, payloadKg, pax, payout, ofp.aircraftIcao, ofp.plannedFuelKg, ofp.route);
  return jobView({ id, source: 'simbrief', kind, origin: ofp.origin, destination: ofp.destination, distance_nm: dist, payload_kg: payloadKg, pax, payout, required_aircraft: ofp.aircraftIcao, planned_fuel_kg: ofp.plannedFuelKg, route: ofp.route });
}

/** Resolve an acceptable job: an own pending import, or a board job of the current window. */
function resolveJob(db: Db, companyId: number, id: string, now: number): Job {
  if (id.startsWith(SB_PREFIX)) {
    const j = get<CustomJobRow>(db, 'SELECT * FROM custom_jobs WHERE id = ? AND company_id = ? AND created_at > ?', id, companyId, now - IMPORT_TTL_MS);
    if (!j) throw new HttpError(404, 'job_not_found', 'imported job not found or expired');
    return jobView({ ...j, source: 'simbrief' });
  }
  // A first-job reservation outlives the 6 h board window it was made in: the reserving company may still accept it.
  const w = windowOf(now);
  const own = reservationOf(db, companyId, now);
  const b = boardJob(id, own?.jobId === id ? (windowOfJobId(id) ?? w) : w);
  if (!b) throw new HttpError(404, 'job_not_found', 'job not found or its board has been refreshed');
  return b;
}

// ---------------------------------------------------------------- flights

/** Claim `job` (unique per job id, so a job can only ever be taken once) and open an active flight on `aircraft`. */
export function startFlight(db: Db, companyId: number, job: Job, aircraft: AircraftRow, now: number): FlightRow {
  if (aircraft.location !== job.origin) throw new HttpError(422, 'wrong_location', `aircraft ${aircraft.icao} is at ${aircraft.location}, the job starts at ${job.origin}`);
  const why = cannotFly(typeFor(db, companyId, aircraft.icao), job);
  if (why) throw new HttpError(422, 'cannot_fly', why);
  if (get(db, "SELECT 1 AS x FROM flights WHERE aircraft_id = ? AND status = 'active'", aircraft.id)) throw new HttpError(409, 'aircraft_busy', `aircraft ${aircraft.id} is already on a flight`);
  if (reservedAgainst(db, job.id, companyId, now)) throw new HttpError(409, 'job_reserved', 'this job is reserved for another company');
  if (run(db, 'INSERT INTO job_claims (job_id, company_id, claimed_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', job.id, companyId, now).changes === 0) {
    throw new HttpError(409, 'job_taken', 'this job has already been taken');
  }
  release(db, companyId, job.id);
  const id = run(db, `INSERT INTO flights (company_id, aircraft_id, aircraft_icao, job_id, source, kind, origin, destination, distance_nm, payload_kg, pax, payout, required_aircraft, planned_fuel_kg, route, status, accepted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
  companyId, aircraft.id, aircraft.icao, job.id, job.source, job.kind, job.origin, job.destination, job.distanceNm, job.payloadKg, job.pax, job.payout, job.requiredAircraft ?? null, job.plannedFuelKg ?? null, job.route ?? null, now).id;
  return get<FlightRow>(db, 'SELECT * FROM flights WHERE id = ?', id)!;
}

export function acceptJob(db: Db, companyId: number, jobId: string, aircraftId: number, now: number): FlightRow {
  const aircraft = get<AircraftRow>(db, 'SELECT * FROM aircraft WHERE id = ? AND company_id = ?', aircraftId, companyId);
  if (!aircraft) throw new HttpError(404, 'aircraft_not_found', 'aircraft not found');
  return startFlight(db, companyId, resolveJob(db, companyId, jobId, now), aircraft, now);
}

/** An active flight of one of the player's companies; with `companyId`, of that company only (what a session acting as it may touch). */
export function activeFlight(db: Db, flightId: number, userId: number, companyId?: number): FlightRow {
  const f = get<FlightRow>(db, 'SELECT f.* FROM flights f JOIN companies c ON c.id = f.company_id WHERE f.id = ?1 AND c.user_id = ?2 AND (?3 IS NULL OR c.id = ?3)', flightId, userId, companyId ?? null);
  if (!f) throw new HttpError(404, 'flight_not_found', 'flight not found');
  if (f.status !== 'active') throw new HttpError(409, 'flight_closed', `flight is already ${f.status}`);
  return f;
}

/** Close a flight as paid (verified or unverified): books the settlement, moves the aircraft, updates stats and rank inputs.
 *  A telemetry `report` is always stored, but only a *verified* flight is costed from its measured fuel, block time and landing
 *  rate; unverified (manual) flights use the type's estimates, so untrusted numbers can never lower a cost. */
export function finishFlight(db: Db, f: FlightRow, status: 'verified' | 'unverified', at: number, report?: { telemetry: Telemetry; blockHours: number }): FlightRow {
  const type = typeFor(db, f.company_id, f.aircraft_icao);
  const t = report?.telemetry;
  const measured = status === 'verified' && report ? { fuelUsedKg: report.telemetry.fuelUsedKg, blockHours: report.blockHours, landingFpm: report.telemetry.landingFpm } : {};
  const realism = realismSettingOf(db, f.company_id);
  const s = settle({
    payout: f.payout, distanceNm: f.distance_nm, aircraft: type, status,
    destSize: airports.get(f.destination)?.size ?? 'small', destIsHub: hasHub(db, f.company_id, f.destination), ...measured,
    ...realismModifiers(realism.toggles),
    ...(realism.toggles.realFuelPrice ? { fuelPriceFactor: fuelPriceFactor(f.origin, f.accepted_at) } : {}),
  });
  run(db, `UPDATE flights SET status = ?, completed_at = ?, season = ?, revenue = ?, fuel_cost = ?, landing_fee = ?, maintenance = ?, net = ?, telemetry = ? WHERE id = ?`,
    status, at, seasonOf(at), s.revenue, s.fuelCost, s.landingFee, s.maintenance, s.net, t ? JSON.stringify(t) : null, f.id);
  run(db, 'UPDATE aircraft SET location = ? WHERE id = ?', f.destination, f.aircraft_id);
  run(db, 'UPDATE companies SET flights = flights + 1, hours = hours + ?, revenue = revenue + ?, reputation = MIN(100, MAX(0, reputation + ?)) WHERE id = ?',
    measured.blockHours ?? blockHours(type, f.distance_nm), s.revenue, s.reputationDelta, f.company_id);
  const memo = `${f.origin}-${f.destination} ${f.aircraft_icao}`;
  post(db, f.company_id, at, 'payout', s.revenue, memo, f.id);
  post(db, f.company_id, at, 'fuel', -s.fuelCost, memo, f.id);
  post(db, f.company_id, at, 'landing_fee', -s.landingFee, memo, f.id);
  post(db, f.company_id, at, 'maintenance', -s.maintenance, memo, f.id);
  snapshot(db, f.company_id, at);
  return get<FlightRow>(db, 'SELECT * FROM flights WHERE id = ?', f.id)!;
}

/** Pay a flight without telemetry (unverified, reduced pay) - with anti-cheat on, not before it could physically have been flown. */
export function completeManually(db: Db, f: FlightRow, at: number, antiCheat: boolean): FlightRow {
  const waitMs = f.accepted_at + minFlightHours(typeFor(db, f.company_id, f.aircraft_icao), f.distance_nm) * 3_600_000 - at;
  if (antiCheat && waitMs > 0) throw new HttpError(409, 'too_early', `this flight takes at least ${Math.ceil(waitMs / 60_000)} more minute(s) to fly`);
  return finishFlight(db, f, 'unverified', at);
}

/** Close a flight without pay. `rejected` (failed verification): reputation penalty, the job stays claimed so a failed
 *  attempt cannot be retried until it passes. `cancelled` (abandoned): the claim is released and the job returns to the board,
 *  so accept-and-cancel cannot be used to hoard jobs. */
export function closeUnpaid(db: Db, f: FlightRow, status: 'rejected' | 'cancelled', at: number, reason?: string, telemetry?: Telemetry): FlightRow {
  run(db, 'UPDATE flights SET status = ?, reject_reason = ?, completed_at = ?, season = ?, telemetry = ? WHERE id = ?', status, reason ?? null, at, seasonOf(at), telemetry ? JSON.stringify(telemetry) : null, f.id);
  if (status === 'rejected') {
    run(db, 'UPDATE companies SET reputation = MAX(0, reputation - ?) WHERE id = ?', REJECT_REPUTATION_PENALTY, f.company_id);
    snapshot(db, f.company_id, at);
  } else {
    run(db, 'DELETE FROM job_claims WHERE job_id = ? AND company_id = ?', f.job_id, f.company_id);
  }
  return get<FlightRow>(db, 'SELECT * FROM flights WHERE id = ?', f.id)!;
}

// ---------------------------------------------------------------- leaderboard & profiles

export const currentSeason = (now: number): string => seasonOf(now);

export function leaderboard(db: Db, season: string, now: number): Leaderboard {
  const seasons = [...new Set([currentSeason(now), ...all<{ season: string }>(db, 'SELECT DISTINCT season FROM season_stats ORDER BY season DESC').map((s) => s.season)])];
  const rows = season === currentSeason(now)
    ? all<Omit<LeaderboardRow, 'rank'>>(db, `SELECT c.id AS companyId, c.name, c.user_id IS NULL AS isAI, ${NET_WORTH_SQL} AS netWorth, c.reputation AS reputation,
        (SELECT COUNT(*) FROM flights f WHERE f.company_id = c.id AND f.season = ?1 AND f.status IN ('verified','unverified')) AS flights
        FROM companies c ORDER BY netWorth DESC, c.id LIMIT 100`, season)
    : all<Omit<LeaderboardRow, 'rank'>>(db, `SELECT c.id AS companyId, c.name, c.user_id IS NULL AS isAI, s.net_worth AS netWorth, s.reputation AS reputation, s.flights AS flights
        FROM season_stats s JOIN companies c ON c.id = s.company_id WHERE s.season = ? ORDER BY s.net_worth DESC, c.id LIMIT 100`, season);
  return { season, seasons, rows: rows.map((r, i) => ({ ...r, isAI: !!r.isAI, reputation: round1(r.reputation), rank: i + 1 })) };
}

export function companyProfile(db: Db, id: number): CompanyProfile {
  const c = companyView(db, id);
  const personality = get<{ personality: string | null }>(db, 'SELECT personality FROM companies WHERE id = ?', id)!.personality;
  const fleet = all<{ icao: string; count: number }>(db, 'SELECT icao, COUNT(*) AS count FROM aircraft WHERE company_id = ? GROUP BY icao ORDER BY count DESC, icao', id);
  const seasons = all<{ season: string; net_worth: number; flights: number; reputation: number }>(db, 'SELECT * FROM season_stats WHERE company_id = ? ORDER BY season DESC LIMIT 12', id)
    .map((s) => ({ season: s.season, netWorth: s.net_worth, flights: s.flights, reputation: round1(s.reputation) }));
  return { ...c, hubs: hubsOf(db, id), fleet, personality: personality ? (JSON.parse(personality) as Personality) : null, seasons };
}
