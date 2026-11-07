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
// SCHEMA_V6 is reserved for the SimBrief-link lot: the orchestrator slots it in before this one at merge.
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

// OpenHangar v3, lot STAFF: employees (one row per person, whatever the family), their type ratings, leave and training days, and the per-leg duty ledger the
// line engine's crew check reads. `staff_company` holds the rest policy and the one-shot marker of the starter crew (decision C11): every human company that already
// flies a line when this migration runs gets a crew sized to its timetable, granted lazily by the first request (the sizing needs the airport catalogue, not SQL).
// staff_duty.leg_id is NOT a foreign key: scheduled legs are pruned after 35 days but the 12-month flight limit needs the ledger for a year.
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
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE, leg_id INTEGER NOT NULL, day INTEGER NOT NULL, flight_no INTEGER NOT NULL,
  dep_at INTEGER NOT NULL, arr_at INTEGER NOT NULL, origin TEXT NOT NULL, dest TEXT NOT NULL, duty_start INTEGER NOT NULL, duty_min INTEGER NOT NULL, flight_min INTEGER NOT NULL,
  PRIMARY KEY (staff_id, leg_id));
CREATE INDEX staff_duty_day ON staff_duty(staff_id, day);
CREATE INDEX staff_duty_leg ON staff_duty(leg_id);
-- which family ran short when a leg was cancelled for want of crew (the staff screen's blockers)
ALTER TABLE scheduled_flights ADD COLUMN crew_family TEXT;
INSERT INTO staff_company (company_id, starter_pending) SELECT DISTINCT l.company_id, 1 FROM lines l JOIN companies c ON c.id = l.company_id WHERE c.user_id IS NOT NULL;
`;

/** Append-only; `PRAGMA user_version` records how many ran. */
export const MIGRATIONS = [SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5, SCHEMA_V7, SCHEMA_V8];

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
