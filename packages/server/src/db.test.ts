import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { all, get, MIGRATIONS, openDb } from './db.ts';

/** A database exactly as the v1 schema left it (one company per user), filled with rows in every table. */
function v1Database(): string {
  const file = join(mkdtempSync(join(tmpdir(), 'opc-migrate-')), 'v1.sqlite');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(MIGRATIONS[0]!);
  db.exec('PRAGMA user_version = 1');
  db.exec(`
    INSERT INTO users VALUES (1, 'alice', 'h', 1), (2, 'bob', 'h', 2);
    INSERT INTO sessions VALUES ('s1', 1, 9999999999999);
    INSERT INTO api_keys VALUES (1, 1, 'sim', 'k1', 1, NULL);
    INSERT INTO companies VALUES (1, 1, 'Alice Air', NULL, 350000, 51.5, 3, 4.5, 9000, 10), (2, 2, 'Bob Air', NULL, 400000, 50, 0, 0, 0, 20),
      (3, NULL, 'Robo Air', '{"style":"cautious","preferred":["C172"]}', 500000, 60, 40, 80, 70000, 30);
    INSERT INTO hubs VALUES (1, 'LFPG'), (2, 'EGLL'), (3, 'KJFK');
    INSERT INTO custom_aircraft VALUES (1, 'ZZZ1', 'Homebuilt', 'piston', 1, 'L', 2, 50, 90, 300);
    INSERT INTO aircraft VALUES (1, 1, 'C172', 'LFPG', 100000, 0), (2, 2, 'C172', 'EGLL', 100000, 0), (3, 3, 'C172', 'KJFK', 100000, 0);
    INSERT INTO custom_jobs VALUES ('sb-1', 1, 5, 'pax', 'LFPG', 'EGLL', 195, 300, 3, 3000, 'C172', NULL, NULL);
    INSERT INTO flights (id, company_id, aircraft_id, aircraft_icao, job_id, source, kind, origin, destination, distance_nm, payload_kg, pax, payout, status, accepted_at)
      VALUES (1, 1, 1, 'C172', 'LFPG-1-0', 'board', 'pax', 'LFPG', 'EGLL', 195, 300, 3, 3000, 'active', 40);
    INSERT INTO job_claims VALUES ('LFPG-1-0', 1, 40), ('KJFK-1-0', 3, 41);
    INSERT INTO transactions VALUES (1, 1, 10, 'grant', 400000, 400000, NULL, 'starting capital'), (2, 3, 30, 'grant', 500000, 500000, NULL, 'starting capital');
    INSERT INTO season_stats VALUES ('2026-11', 1, 450000, 3, 51.5), ('2026-11', 3, 570000, 40, 60);
    INSERT INTO ai_ticks VALUES (7);
    INSERT INTO meta VALUES ('k', 'v');
  `);
  db.close();
  return file;
}

const TABLES = ['users', 'sessions', 'api_keys', 'companies', 'hubs', 'custom_aircraft', 'aircraft', 'custom_jobs', 'flights', 'job_claims', 'transactions', 'season_stats', 'ai_ticks', 'meta'];

test('migration 2 lets a user own several companies and loses no row, id or relation', () => {
  const file = v1Database();
  const raw = new DatabaseSync(file);
  const before = Object.fromEntries(TABLES.map((t) => [t, raw.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
  raw.close();

  const db = openDb(file);
  assert.equal(get<{ user_version: number }>(db, 'PRAGMA user_version')!.user_version, MIGRATIONS.length);
  assert.equal(get<{ foreign_keys: number }>(db, 'PRAGMA foreign_keys')!.foreign_keys, 1, 'foreign keys are enforced again after migrating');
  assert.deepEqual(all(db, 'PRAGMA foreign_key_check'), []);
  // later migrations only ADD columns: every column the v1 schema had keeps its value
  const keepOldColumns = (rows: Record<string, unknown>[], old: Record<string, unknown>[]) => rows.map((r) => Object.fromEntries(Object.keys(old[0] ?? {}).map((k) => [k, r[k]])));
  for (const t of TABLES) assert.deepEqual(keepOldColumns(all(db, `SELECT * FROM ${t} ORDER BY rowid`), before[t]!), keepOldColumns(before[t]!, before[t]!), `${t} unchanged`);

  // the old one-company-per-user constraint is gone ...
  db.exec("INSERT INTO companies (user_id, name, balance, reputation, created_at) VALUES (1, 'Alice Cargo', 1, 50, 99)");
  assert.equal(get<{ n: number }>(db, 'SELECT COUNT(*) n FROM companies WHERE user_id = 1')!.n, 2);
  // ... names stay unique case-insensitively ...
  assert.throws(() => db.exec("INSERT INTO companies (user_id, name, balance, reputation, created_at) VALUES (2, 'ALICE CARGO', 1, 50, 99)"), /UNIQUE/);
  // ... and deleting a user still cascades through the rebuilt table to everything it owns.
  db.exec('DELETE FROM users WHERE id = 1');
  for (const t of ['hubs', 'aircraft', 'flights', 'job_claims', 'transactions', 'season_stats', 'custom_aircraft', 'custom_jobs']) {
    assert.equal(get<{ n: number }>(db, `SELECT COUNT(*) n FROM ${t} WHERE company_id = 1`)!.n, 0, `${t} of alice gone`);
  }
  assert.equal(get<{ n: number }>(db, 'SELECT COUNT(*) n FROM companies')!.n, 2, "bob's and the AI company survive");
  assert.deepEqual(all(db, 'PRAGMA foreign_key_check'), []);
});

test('migrating is idempotent: reopening a migrated database changes nothing', () => {
  const file = v1Database();
  openDb(file).close();
  const db = openDb(file);
  assert.equal(get<{ n: number }>(db, 'SELECT COUNT(*) n FROM companies')!.n, 3);
  assert.equal(get<{ user_version: number }>(db, 'PRAGMA user_version')!.user_version, MIGRATIONS.length);
});

test('migration 4 backfills registrations (country prefix, unique), ownership, base and wear on existing aircraft', () => {
  const db = openDb(v1Database());
  const rows = all<{ id: number; registration: string; ownership: string; base: string; wear_pct: number; status: string }>(db, 'SELECT id, registration, ownership, base, wear_pct, status FROM aircraft ORDER BY id');
  assert.deepEqual(rows.map((r) => r.registration), ['F-HAZA', 'G-HAZA', 'N100AA']);
  assert.deepEqual(rows.map((r) => r.base), ['LFPG', 'EGLL', 'KJFK']);
  assert.ok(rows.every((r) => r.ownership === 'owned' && r.wear_pct === 0 && r.status === 'available'));
  assert.throws(() => db.exec("UPDATE aircraft SET registration = 'F-HAZA' WHERE id = 2"), /UNIQUE/);
});

test('migration 5 (live) adds flights.last_live_at, empty for existing flights', () => {
  const db = openDb(v1Database());
  assert.equal(get<{ last_live_at: number | null }>(db, 'SELECT last_live_at FROM flights WHERE id = 1')!.last_live_at, null);
  db.exec('UPDATE flights SET last_live_at = 123 WHERE id = 1');
  assert.equal(get<{ last_live_at: number }>(db, 'SELECT last_live_at FROM flights WHERE id = 1')!.last_live_at, 123);
});

test('SCHEMA_SIMBRIEF runs after V7 (position 7) on a database that already ran V7, and gives flights in the air a static id', () => {
  assert.equal(MIGRATIONS.length, 7);
  assert.ok(MIGRATIONS[5]!.includes('line_ticks') && MIGRATIONS[6]!.includes('simbrief_static_id'));
  const file = join(mkdtempSync(join(tmpdir(), 'opc-sb-')), 'v7.sqlite');
  const raw = new DatabaseSync(file);
  for (let i = 0; i < 6; i++) raw.exec(MIGRATIONS[i]!);
  raw.exec('PRAGMA user_version = 6');
  raw.exec(`INSERT INTO users VALUES (1, 'a', 'h', 1);
    INSERT INTO companies (id, user_id, name, balance, reputation, created_at) VALUES (1, 1, 'A Air', 1, 50, 1);
    INSERT INTO aircraft (id, company_id, icao, location, value) VALUES (1, 1, 'C172', 'LFPG', 100000);
    INSERT INTO flights (id, company_id, aircraft_id, aircraft_icao, job_id, source, kind, origin, destination, distance_nm, payload_kg, pax, payout, status, accepted_at)
      VALUES (1, 1, 1, 'C172', 'J1', 'board', 'pax', 'LFPG', 'EGLL', 195, 300, 3, 3000, 'active', 40), (2, 1, 1, 'C172', 'J2', 'board', 'pax', 'LFPG', 'EGLL', 195, 300, 3, 3000, 'verified', 41);`);
  raw.close();
  const db = openDb(file);
  assert.equal(get<{ user_version: number }>(db, 'PRAGMA user_version')!.user_version, 7);
  const rows = all<{ id: number; sid: string | null }>(db, 'SELECT id, simbrief_static_id AS sid FROM flights ORDER BY id');
  assert.match(rows[0]!.sid!, /^opc_1_[0-9a-f]{12}$/);
  assert.equal(rows[1]!.sid, null, 'closed flights have nothing to fetch');
  assert.deepEqual({ ...get(db, 'SELECT simbrief_username AS u, simbrief_pilot_id AS p, simbrief_verified_at AS v FROM users WHERE id = 1')! }, { u: null, p: null, v: null });
});
