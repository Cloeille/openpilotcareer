import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { backfillRegistrations } from './registrations.ts';

export type Db = DatabaseSync;

const SCHEMA_V1 = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, pass_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE api_keys (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, label TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, last_used_at INTEGER);
CREATE TABLE companies (
  id INTEGER PRIMARY KEY, user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE, personality TEXT, balance INTEGER NOT NULL, reputation REAL NOT NULL,
  flights INTEGER NOT NULL DEFAULT 0, hours REAL NOT NULL DEFAULT 0, revenue INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE hubs (
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE, icao TEXT NOT NULL, PRIMARY KEY (company_id, icao));
CREATE TABLE custom_aircraft (
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE, icao TEXT NOT NULL, name TEXT NOT NULL,
  category TEXT NOT NULL, engines INTEGER NOT NULL, wtc TEXT NOT NULL, seats INTEGER NOT NULL, cargo_kg INTEGER NOT NULL,
  cruise_kts INTEGER NOT NULL, range_nm INTEGER NOT NULL, PRIMARY KEY (company_id, icao));
CREATE TABLE aircraft (
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE, icao TEXT NOT NULL,
  location TEXT NOT NULL, value INTEGER NOT NULL, available_at INTEGER NOT NULL DEFAULT 0);
CREATE INDEX aircraft_company ON aircraft(company_id);
CREATE TABLE custom_jobs (
  id TEXT PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE, created_at INTEGER NOT NULL,
  kind TEXT NOT NULL, origin TEXT NOT NULL, destination TEXT NOT NULL, distance_nm REAL NOT NULL, payload_kg INTEGER NOT NULL,
  pax INTEGER NOT NULL, payout INTEGER NOT NULL, required_aircraft TEXT, planned_fuel_kg INTEGER, route TEXT);
CREATE TABLE flights (
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  aircraft_id INTEGER NOT NULL REFERENCES aircraft(id) ON DELETE CASCADE, aircraft_icao TEXT NOT NULL,
  job_id TEXT NOT NULL, source TEXT NOT NULL, kind TEXT NOT NULL, origin TEXT NOT NULL, destination TEXT NOT NULL,
  distance_nm REAL NOT NULL, payload_kg INTEGER NOT NULL, pax INTEGER NOT NULL, payout INTEGER NOT NULL,
  required_aircraft TEXT, planned_fuel_kg INTEGER, route TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','verified','unverified','rejected','cancelled')),
  reject_reason TEXT, accepted_at INTEGER NOT NULL, completed_at INTEGER, season TEXT,
  revenue INTEGER NOT NULL DEFAULT 0, fuel_cost INTEGER NOT NULL DEFAULT 0, landing_fee INTEGER NOT NULL DEFAULT 0,
  maintenance INTEGER NOT NULL DEFAULT 0, net INTEGER NOT NULL DEFAULT 0, telemetry TEXT);
CREATE UNIQUE INDEX one_active_flight_per_aircraft ON flights(aircraft_id) WHERE status = 'active';
CREATE INDEX flights_company ON flights(company_id, id);
CREATE TABLE job_claims (
  job_id TEXT PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE, claimed_at INTEGER NOT NULL);
CREATE TABLE transactions (
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE, at INTEGER NOT NULL,
  kind TEXT NOT NULL, amount INTEGER NOT NULL, balance_after INTEGER NOT NULL, flight_id INTEGER, memo TEXT NOT NULL);
CREATE INDEX transactions_company ON transactions(company_id, id);
CREATE TABLE season_stats (
  season TEXT NOT NULL, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  net_worth INTEGER NOT NULL, flights INTEGER NOT NULL, reputation REAL NOT NULL, PRIMARY KEY (season, company_id));
CREATE TABLE ai_ticks (tick INTEGER PRIMARY KEY);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

// A user may own several companies: SQLite cannot drop a UNIQUE constraint, so the table is rebuilt (ids and every child row survive).
const SCHEMA_V2 = `
CREATE TABLE companies_new (
  id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE, personality TEXT, balance INTEGER NOT NULL, reputation REAL NOT NULL,
  flights INTEGER NOT NULL DEFAULT 0, hours REAL NOT NULL DEFAULT 0, revenue INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
INSERT INTO companies_new (id, user_id, name, personality, balance, reputation, flights, hours, revenue, created_at)
  SELECT id, user_id, name, personality, balance, reputation, flights, hours, revenue, created_at FROM companies;
DROP TABLE companies;
ALTER TABLE companies_new RENAME TO companies;
CREATE INDEX companies_user ON companies(user_id);
`;

// OpenHangar v2, lot START: company identity, start mode, realism (JSON, NULL = neutral), onboarding state per user,
// first-job reservations (one per company) and the once-per-season bankruptcy bailouts.
const SCHEMA_V3 = `
ALTER TABLE companies ADD COLUMN code TEXT;
ALTER TABLE companies ADD COLUMN callsign TEXT;
ALTER TABLE companies ADD COLUMN livery_color TEXT;
ALTER TABLE companies ADD COLUMN start_mode TEXT;
ALTER TABLE companies ADD COLUMN realism TEXT;
CREATE UNIQUE INDEX companies_code ON companies(code) WHERE code IS NOT NULL;
CREATE TABLE onboarding (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, completed INTEGER NOT NULL DEFAULT 0, step INTEGER NOT NULL DEFAULT 1,
  start_mode TEXT, company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL, draft TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL);
CREATE TABLE job_reservations (
  job_id TEXT PRIMARY KEY, company_id INTEGER NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE, reserved_until INTEGER NOT NULL);
CREATE TABLE bailouts (
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE, season TEXT NOT NULL, at INTEGER NOT NULL, amount INTEGER NOT NULL,
  PRIMARY KEY (company_id, season));
`;

// Lot FINANCE: registrations, ownership, wear, maintenance, hub parking; leases/loans/club/rental contracts; monthly billing runs.
// `returned_at` marks an aircraft handed back (lease ended, rental stopped): the row stays so flight history keeps its foreign key.
const SCHEMA_V4 = `
ALTER TABLE aircraft ADD COLUMN registration TEXT;
ALTER TABLE aircraft ADD COLUMN ownership TEXT NOT NULL DEFAULT 'owned' CHECK (ownership IN ('owned','leased','financed','club','rented'));
ALTER TABLE aircraft ADD COLUMN wear_pct REAL NOT NULL DEFAULT 0;
ALTER TABLE aircraft ADD COLUMN status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','maintenance'));
ALTER TABLE aircraft ADD COLUMN maintenance_until INTEGER;
ALTER TABLE aircraft ADD COLUMN base TEXT;
ALTER TABLE aircraft ADD COLUMN acquired_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE aircraft ADD COLUMN returned_at INTEGER;
UPDATE aircraft SET base = COALESCE(
  (SELECT h.icao FROM hubs h WHERE h.company_id = aircraft.company_id AND h.icao = aircraft.location),
  (SELECT MIN(h.icao) FROM hubs h WHERE h.company_id = aircraft.company_id), aircraft.location),
  acquired_at = COALESCE((SELECT c.created_at FROM companies c WHERE c.id = aircraft.company_id), 0);
CREATE UNIQUE INDEX aircraft_registration ON aircraft(registration) WHERE registration IS NOT NULL;
CREATE TABLE contracts (
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  aircraft_id INTEGER NOT NULL REFERENCES aircraft(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('lease','loan','club','rental')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  started_at INTEGER NOT NULL, ends_at INTEGER, months INTEGER, months_paid INTEGER NOT NULL DEFAULT 0,
  monthly INTEGER NOT NULL DEFAULT 0, hourly INTEGER, deposit INTEGER NOT NULL DEFAULT 0, insurance INTEGER NOT NULL DEFAULT 0,
  principal INTEGER NOT NULL DEFAULT 0, terms TEXT, ended_at INTEGER);
CREATE INDEX contracts_company ON contracts(company_id, status);
CREATE INDEX contracts_aircraft ON contracts(aircraft_id);
CREATE INDEX aircraft_maintenance ON aircraft(maintenance_until) WHERE status = 'maintenance';
CREATE TABLE billing_runs (
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE, month TEXT NOT NULL, at INTEGER NOT NULL,
  PRIMARY KEY (company_id, month));
-- Companies that exist now start being billed from the month of the migration (no retroactive parking fees).
INSERT INTO billing_runs (company_id, month, at) SELECT id, strftime('%Y-%m', 'now'), CAST(strftime('%s', 'now') AS INTEGER) * 1000 FROM companies WHERE user_id IS NOT NULL;
`;

// Lot LIVE: when the last live sample of a flight arrived (the sample itself lives in memory only).
const SCHEMA_V5 = `ALTER TABLE flights ADD COLUMN last_live_at INTEGER;`;

// OpenHangar v3, lot LINES: the line engine's clock ticks, each company's network switch and last-seen time (the offline cap),
// the lines themselves with their aircraft, and the timetable. A scheduled flight keeps its own money columns (the day P&L reads them).
// lines.live_from: no leg departing before it is ever created (the line did not exist yet, was paused, switched off or its owner was away);
// lines.laid_through: legs exist up to that instant (the end of tomorrow, B.2 item 1), so ticks re-lay only when the day has turned.
// Only 'scheduled', 'done' and 'cancelled' are stored: flying and delayed are derived from the clock and delay_min (docs/v3-plan.md B.2, S1 notes).
const SCHEMA_V7 = `
CREATE TABLE line_ticks (tick INTEGER PRIMARY KEY);
CREATE TABLE line_networks (
  company_id INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE, enabled INTEGER NOT NULL DEFAULT 1, seen_at INTEGER NOT NULL, lapsed_at INTEGER);
CREATE TABLE lines (
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE, a TEXT NOT NULL, b TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','interrupted')), created_at INTEGER NOT NULL,
  freq_per_day INTEGER NOT NULL, days INTEGER NOT NULL, window_start_min INTEGER NOT NULL, window_end_min INTEGER NOT NULL,
  turnaround_min INTEGER NOT NULL, flight_base INTEGER NOT NULL, live_from INTEGER NOT NULL DEFAULT 0, laid_through INTEGER NOT NULL DEFAULT 0, paused_at INTEGER, interrupted_since INTEGER, interrupt_cause TEXT, stoppage_charged REAL NOT NULL DEFAULT 0,
  UNIQUE (company_id, a, b), CHECK (a < b));
CREATE TABLE line_aircraft (
  line_id INTEGER NOT NULL REFERENCES lines(id) ON DELETE CASCADE, aircraft_id INTEGER NOT NULL REFERENCES aircraft(id) ON DELETE CASCADE,
  home TEXT NOT NULL, PRIMARY KEY (line_id, aircraft_id));
CREATE INDEX line_aircraft_aircraft ON line_aircraft(aircraft_id);
CREATE TABLE scheduled_flights (
  id INTEGER PRIMARY KEY, line_id INTEGER NOT NULL REFERENCES lines(id) ON DELETE CASCADE, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  aircraft_id INTEGER NOT NULL REFERENCES aircraft(id) ON DELETE CASCADE, flight_no INTEGER NOT NULL, dep_at INTEGER NOT NULL, arr_at INTEGER NOT NULL,
  origin TEXT NOT NULL, dest TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','done','cancelled')),
  delay_min INTEGER NOT NULL DEFAULT 0, delay_cause TEXT, cancel_cause TEXT, taken_job TEXT,
  pax INTEGER, revenue INTEGER, fuel_cost INTEGER, landing_fee INTEGER, maintenance INTEGER,
  UNIQUE (line_id, flight_no, dep_at));
CREATE INDEX scheduled_due ON scheduled_flights(status, dep_at);
CREATE INDEX scheduled_company_day ON scheduled_flights(company_id, dep_at);
CREATE INDEX scheduled_aircraft ON scheduled_flights(aircraft_id, dep_at);
-- A rotation the player takes over becomes a private job (source 'line') that stays hers until the leg is over; SimBrief imports keep the default.
ALTER TABLE custom_jobs ADD COLUMN source TEXT NOT NULL DEFAULT 'simbrief';
ALTER TABLE custom_jobs ADD COLUMN expires_at INTEGER;
`;

// Lot SIMBRIEF-LINK (runs after V7: V7 was deployed first, so the reserved V6 slot can no longer be used without re-running V7 on live databases): the saved SimBrief identifier of an account (public, not a secret) and the SimBrief side of a flight.
const SCHEMA_SIMBRIEF = `
ALTER TABLE users ADD COLUMN simbrief_username TEXT;
ALTER TABLE users ADD COLUMN simbrief_pilot_id INTEGER;
ALTER TABLE users ADD COLUMN simbrief_verified_at INTEGER;
ALTER TABLE flights ADD COLUMN simbrief_static_id TEXT;
ALTER TABLE flights ADD COLUMN simbrief_ofp_id TEXT;
-- Flights already in the air get the id they would have got at accept time (same shape as game.ts startFlight).
UPDATE flights SET simbrief_static_id = 'opc_' || id || '_' || lower(hex(randomblob(6))) WHERE status = 'active';
`;

// OpenHangar v3, lot STAFF: employees (one row per person, whatever the family), their type ratings, leave and training days, and the per-leg duty ledger the
// line engine's crew check reads. `staff_company` holds the rest policy and the one-shot marker of the starter crew (decision C11): every human company that already
// flies a line when this migration runs gets a crew sized to its timetable, granted lazily by the first request (the sizing needs the airport catalogue, not SQL).
// staff_duty is keyed (person, departure): nobody flies two legs at once. leg_id is not a foreign key: scheduled legs are pruned after 35 days but the 12-month flight limit needs the ledger for a year.
const SCHEMA_V8 = `
CREATE TABLE staff_company (
  company_id INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE, policy TEXT NOT NULL DEFAULT 'standard' CHECK (policy IN ('legal','standard','generous')),
  starter_pending INTEGER NOT NULL DEFAULT 0);
CREATE TABLE staff (
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  family TEXT NOT NULL CHECK (family IN ('pilot','cabin','ground','admin','maintenance','kitchen')), name TEXT NOT NULL, role TEXT NOT NULL, base TEXT NOT NULL,
  hired_at INTEGER NOT NULL, starts_at INTEGER NOT NULL, ends_at INTEGER /* last day on the payroll; NULL: still employed */, salary INTEGER NOT NULL, experience REAL NOT NULL DEFAULT 0,
  reliability REAL NOT NULL, morale REAL NOT NULL,
  contract TEXT NOT NULL DEFAULT 'cdi' CHECK (contract IN ('cdi','cdd')), notice_days INTEGER NOT NULL DEFAULT 7, candidate_id TEXT,
  UNIQUE (company_id, candidate_id));
CREATE INDEX staff_roster ON staff(company_id, family);
CREATE TABLE staff_quals (
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE, type_icao TEXT NOT NULL, valid_from INTEGER NOT NULL DEFAULT 0, valid_until INTEGER,
  PRIMARY KEY (staff_id, type_icao));
CREATE TABLE staff_leave (
  id INTEGER PRIMARY KEY, staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE, from_day INTEGER NOT NULL, to_day INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','granted','refused')), kind TEXT NOT NULL DEFAULT 'leave' CHECK (kind IN ('leave','rest','training')),
  UNIQUE (staff_id, from_day, kind));
CREATE TABLE staff_duty (
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE, leg_id INTEGER, day INTEGER NOT NULL, flight_no INTEGER NOT NULL,
  dep_at INTEGER NOT NULL, arr_at INTEGER NOT NULL, origin TEXT NOT NULL, dest TEXT NOT NULL, duty_start INTEGER NOT NULL, duty_min INTEGER NOT NULL, flight_min INTEGER NOT NULL,
  PRIMARY KEY (staff_id, dep_at));
CREATE INDEX staff_duty_day ON staff_duty(staff_id, day);
CREATE INDEX staff_duty_leg ON staff_duty(leg_id);
-- A scheduled_flights id can be reused once its row is gone (no AUTOINCREMENT): the ledger must never point at a leg that is not there. leg_id becomes NULL, the hours stay.
CREATE TRIGGER staff_duty_leg_gone BEFORE DELETE ON scheduled_flights BEGIN UPDATE staff_duty SET leg_id = NULL WHERE leg_id = OLD.id; END;
-- which family ran short when a leg was cancelled for want of crew (the staff screen's blockers)
ALTER TABLE scheduled_flights ADD COLUMN crew_family TEXT;
INSERT INTO staff_company (company_id, starter_pending) SELECT DISTINCT l.company_id, 1 FROM lines l JOIN companies c ON c.id = l.company_id WHERE c.user_id IS NOT NULL;
`;

// OpenHangar v3, lot FACILITIES: buildings at hubs. `facilities` is only the id of a slot at an airport (the catalogue itself, names, areas, rents, who holds what at the start,
// is code in shared/src/facilities.ts, so retuning it never needs a migration); rows are created the first time a hub's plan is read. What a company holds is a contract:
// a lease (36 months, a deposit) or a purchase (cash or credit). The partial unique index is the guard that nobody else can hold a building at the same time.
// `level` is the level in force when the last upgrade started, `works_to` / `works_until` an upgrade in progress or just over (the level at any instant is derived from the clock; the next upgrade folds it into `level`), `level_since` when the level began.
// `value` is what the building would resell for (net worth), `principal` the credit left. Nothing is billed retroactively: a contract starts paying on the 1st after it was signed.
const SCHEMA_V9 = `
CREATE TABLE facilities (id INTEGER PRIMARY KEY, hub_icao TEXT NOT NULL, slot TEXT NOT NULL, UNIQUE (hub_icao, slot));
CREATE TABLE facility_contracts (
  id INTEGER PRIMARY KEY, facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('lease','purchase')), status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  started_at INTEGER NOT NULL, ended_at INTEGER, months INTEGER, months_paid INTEGER NOT NULL DEFAULT 0,
  monthly INTEGER NOT NULL, upkeep INTEGER NOT NULL DEFAULT 0, deposit INTEGER NOT NULL DEFAULT 0, price INTEGER NOT NULL DEFAULT 0,
  principal INTEGER NOT NULL DEFAULT 0, value INTEGER NOT NULL DEFAULT 0, notice_months INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1, level_since INTEGER NOT NULL, works_to INTEGER, works_until INTEGER);
CREATE UNIQUE INDEX facility_contract_active ON facility_contracts(facility_id) WHERE status = 'active';
CREATE INDEX facility_contract_company ON facility_contracts(company_id, status);
`;

// OpenHangar v3, lot SAFETY: the incident journal and one reading of the safety index per company and day (the "since Monday" delta needs a past to compare with).
// `ref` is the roll's identity (`flight:<id>` or `leg:<line>:<departure>:<number>`), unique per company: a roll that is played twice is recorded once, so its money and reputation are never charged twice.
const SCHEMA_V10 = `
CREATE TABLE incidents (
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE, ref TEXT NOT NULL, at INTEGER NOT NULL, season TEXT NOT NULL,
  aircraft_id INTEGER NOT NULL REFERENCES aircraft(id) ON DELETE CASCADE, airport TEXT NOT NULL, flight_id INTEGER, flight_no INTEGER,
  severity TEXT NOT NULL CHECK (severity IN ('minor','serious','grave')), kind TEXT NOT NULL, duty_min INTEGER NOT NULL, wear_pct REAL NOT NULL, risk REAL NOT NULL,
  cost INTEGER NOT NULL, covered INTEGER NOT NULL, downtime_until INTEGER NOT NULL, reputation_delta REAL NOT NULL,
  UNIQUE (company_id, ref));
CREATE INDEX incidents_season ON incidents(company_id, season, at);
CREATE TABLE safety_readings (
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE, day INTEGER NOT NULL, idx INTEGER NOT NULL, PRIMARY KEY (company_id, day));
`;

// OpenHangar v3, lot PARTS: the wear of each component of an aircraft (rows are made the first time an aircraft wears or is looked at: seeded from the lease offer's airframe hours, else new),
// the spare parts a company keeps at a hub and the orders on their way, the stock policy per aircraft type (a target the shelf is topped up to; `cls` is the part class of the type, so billing and
// breakdowns need no catalogue lookup), and the breakdowns: a mechanical component that reached its failure wear. The catalogue of parts (names, prices, kits) is code in shared/src/parts.ts.
// `breakdowns` is unique per (aircraft, component, failed_at): a breakdown that is played twice is recorded once, so its part and its bill are never taken twice.
const SCHEMA_V11 = `
CREATE TABLE aircraft_components (
  aircraft_id INTEGER NOT NULL REFERENCES aircraft(id) ON DELETE CASCADE,
  component TEXT NOT NULL CHECK (component IN ('engines','gear','propellers','avionics','interior','paint')),
  wear_pct REAL NOT NULL, refurb_until INTEGER, PRIMARY KEY (aircraft_id, component));
CREATE TABLE parts_stock (
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE, hub TEXT NOT NULL, part TEXT NOT NULL, qty INTEGER NOT NULL CHECK (qty >= 0), PRIMARY KEY (company_id, hub, part));
CREATE TABLE parts_orders (
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE, hub TEXT NOT NULL, part TEXT NOT NULL, qty INTEGER NOT NULL,
  ordered_at INTEGER NOT NULL, eta INTEGER NOT NULL, cost INTEGER NOT NULL, express INTEGER NOT NULL DEFAULT 0, received INTEGER NOT NULL DEFAULT 0);
CREATE INDEX parts_orders_open ON parts_orders(company_id, received, eta);
CREATE TABLE parts_policy (
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE, hub TEXT NOT NULL, icao TEXT NOT NULL, cls TEXT NOT NULL,
  policy TEXT NOT NULL CHECK (policy IN ('none','critical','full')), PRIMARY KEY (company_id, hub, icao));
CREATE TABLE breakdowns (
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE, aircraft_id INTEGER NOT NULL REFERENCES aircraft(id) ON DELETE CASCADE,
  hub TEXT NOT NULL, component TEXT NOT NULL, part TEXT NOT NULL, failed_at INTEGER NOT NULL, eta INTEGER NOT NULL, ready_at INTEGER NOT NULL, paid INTEGER NOT NULL, from_stock INTEGER NOT NULL,
  UNIQUE (aircraft_id, component, failed_at));
CREATE INDEX breakdowns_company ON breakdowns(company_id, failed_at);
`;

// OpenHangar v3, lot SERVICE: cabin service and the central kitchen. `service_policy` is a history, not a state: one row per change, `since` the first instant it is in force (the next UTC midnight,
// "applique le lendemain"), so the configuration at any instant is a read and a replayed tick sees the one of its own time. The policy cells are (haul, item); the meal quality is the row (`all`, `meal_quality`).
// `kitchen` is the same history for who makes the meals at an airport. `service_days` is the log the satisfaction, the kitchen's day and the service figures read: one row per company, day and departure airport.
// `sat_pax` is the sum of passengers x satisfaction of the legs, so a mean over any window is a ratio of sums.
const SCHEMA_V12 = `
CREATE TABLE service_policy (
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE, haul TEXT NOT NULL, item TEXT NOT NULL, mode TEXT NOT NULL, since INTEGER NOT NULL,
  PRIMARY KEY (company_id, haul, item, since));
CREATE TABLE kitchen (
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE, hub TEXT NOT NULL, provider TEXT NOT NULL CHECK (provider IN ('own','caterer')), since INTEGER NOT NULL,
  PRIMARY KEY (company_id, hub, since));
CREATE TABLE service_days (
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE, day INTEGER NOT NULL, hub TEXT NOT NULL,
  pax INTEGER NOT NULL DEFAULT 0, sat_pax REAL NOT NULL DEFAULT 0, sales INTEGER NOT NULL DEFAULT 0, cost INTEGER NOT NULL DEFAULT 0,
  snacks INTEGER NOT NULL DEFAULT 0, hot INTEGER NOT NULL DEFAULT 0, unserved INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, day, hub));
`;

/** Append-only; `PRAGMA user_version` records how many ran. */
// OpenHangar v4, lot REPORTS: the ledger remembers what a posting was about. `line_id` / `aircraft_id` are what the statement filters and the profitability reports group on, `counterparty_id` is the
// other company of an intra-group flow (lot GROUP writes it), `legs` how many flown legs a revenue posting covers (scheduled legs are pruned after 35 days, the ledger is not: it is the only
// place a closed month's flights can be counted). No foreign keys, like staff_duty.leg_id: a line's id can be reused once its row is gone, so deleting a line clears its links instead of handing
// its history to the next line. The three backfills are best effort for postings made before this migration: flights give their aircraft, the memo of a line posting gives its pair (the line
// of that pair), for a bulk-booked day its leg count, and for a leg still on the timetable (35 days) its aircraft; the memo of a monthly charge starts with the registration. Bulk-booked line postings of the past keep a NULL aircraft.
const SCHEMA_V13 = `
ALTER TABLE transactions ADD COLUMN line_id INTEGER;
ALTER TABLE transactions ADD COLUMN aircraft_id INTEGER;
ALTER TABLE transactions ADD COLUMN counterparty_id INTEGER;
ALTER TABLE transactions ADD COLUMN legs INTEGER NOT NULL DEFAULT 0;
CREATE INDEX transactions_company_at ON transactions(company_id, at);
CREATE TRIGGER transactions_line_gone BEFORE DELETE ON lines BEGIN UPDATE transactions SET line_id = NULL WHERE line_id = OLD.id; END;
UPDATE transactions SET aircraft_id = (SELECT f.aircraft_id FROM flights f WHERE f.id = transactions.flight_id), legs = CASE WHEN kind = 'payout' THEN 1 ELSE 0 END WHERE flight_id IS NOT NULL;
UPDATE transactions SET
  line_id = (SELECT l.id FROM lines l WHERE l.company_id = transactions.company_id AND substr(transactions.memo, 1, 9) IN (l.a || '-' || l.b, l.b || '-' || l.a)),
  legs = CASE WHEN kind <> 'line_revenue' THEN 0 WHEN memo GLOB '* x[0-9]*' THEN CAST(substr(memo, length(rtrim(memo, '0123456789')) + 1) AS INTEGER) ELSE 1 END
  WHERE flight_id IS NULL AND kind IN ('line_revenue', 'line_fuel', 'line_fee', 'line_maintenance', 'service_sales', 'service_cost');
UPDATE transactions SET aircraft_id = (SELECT sf.aircraft_id FROM scheduled_flights sf WHERE sf.line_id = transactions.line_id AND sf.dep_at = transactions.at
  AND sf.flight_no = CAST(substr(transactions.memo, length(rtrim(transactions.memo, '0123456789')) + 1) AS INTEGER))
  WHERE line_id IS NOT NULL AND aircraft_id IS NULL AND memo NOT GLOB '* x[0-9]*';
UPDATE transactions SET aircraft_id = (SELECT a.id FROM aircraft a WHERE a.company_id = transactions.company_id AND a.registration = substr(memo, 1, instr(memo || ' ', ' ') - 1))
  WHERE aircraft_id IS NULL AND kind IN ('lease_rent', 'insurance', 'parking', 'loan_installment', 'deposit', 'deposit_refund', 'ferry', 'refurbish', 'incident', 'parts_emergency');
`;

export const MIGRATIONS = [SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5, SCHEMA_V7, SCHEMA_SIMBRIEF, SCHEMA_V8, SCHEMA_V9, SCHEMA_V10, SCHEMA_V11, SCHEMA_V12, SCHEMA_V13];

export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  // Foreign keys stay off while migrations run: rebuilding a parent table would otherwise cascade-delete its children.
  // (The pragma is a no-op inside a transaction.) Each migration must leave no dangling reference, or it rolls back.
  db.exec('PRAGMA foreign_keys = OFF');
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    tx(db, () => {
      db.exec(MIGRATIONS[v]!);
      const dangling = db.prepare('PRAGMA foreign_key_check').all().length;
      if (dangling > 0) throw new Error(`migration ${v + 1} left ${dangling} dangling foreign key(s)`);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
  // Aircraft that existed before migration 4 (or were inserted without one) get their registration here: it needs the airport data, not SQL.
  if (db.prepare('SELECT 1 FROM aircraft WHERE registration IS NULL LIMIT 1').get()) tx(db, () => backfillRegistrations(db)); // no write lock when nothing is missing
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

/** Run `fn` in one write transaction. `fn` must be synchronous: nothing else interleaves with it. */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const all = <T>(db: Db, sql: string, ...p: SQLInputValue[]): T[] => db.prepare(sql).all(...p) as T[];
export const get = <T>(db: Db, sql: string, ...p: SQLInputValue[]): T | undefined => db.prepare(sql).get(...p) as T | undefined;
export const run = (db: Db, sql: string, ...p: SQLInputValue[]) => {
  const r = db.prepare(sql).run(...p);
  return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
};
