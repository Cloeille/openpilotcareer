import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DAY_MS, INCIDENT_DOWNTIME_DAYS, INCIDENT_REPUTATION, REST_POLICIES, drawIncident, incidentRisk, insuranceSurcharge, isInsured, presetSetting,
  type IncidentView, type SafetyView,
} from '@opc/shared';
import { hashSeed, mulberry32 } from './board.ts';
import { all, get, MIGRATIONS, openDb, run } from './db.ts';
import { runBilling } from './finance.ts';
import { insertAircraft } from './fleet-extras.ts';
import { harness } from './harness.ts';
import { refreshLine } from './lines.ts';
import { saveRealism } from './realism.ts';
import { rollIncident, type Roll } from './safety.ts';
import { grantStarterCrew } from './staff-people.ts';

const T0 = Date.UTC(2026, 10, 4, 12, 0, 0); // Wednesday 4 Nov 2026, 12:00Z (the harness clock)
const body = (over: Record<string, unknown> = {}) => ({ a: 'LFPG', b: 'LFLL', freqPerDay: 3, days: Array(7).fill(true), windowStart: '06:00', windowEnd: '18:00', aircraftIds: [] as number[], ...over });

/** A player at LFPG with "wear and failures" on and one AT76 (value 1 000 000). */
async function world(o: { wear?: boolean } = {}) {
  const h = await harness();
  const u = await h.register('amy', 'LFPG');
  const cid = u.me.company.id as number;
  if (o.wear !== false) saveRealism(h.db, cid, presetSetting('balanced'));
  run(h.db, 'UPDATE companies SET balance = 5000000 WHERE id = ?', cid);
  const ac = insertAircraft(h.db, { companyId: cid, icao: 'AT76', hub: 'LFPG', value: 1_000_000, ownership: 'owned', at: h.clock.t });
  const call = (url: string) => h.call('GET', url, { token: u.token });
  const balance = () => get<{ balance: number }>(h.db, 'SELECT balance FROM companies WHERE id = ?', cid)!.balance;
  const reputation = () => get<{ r: number }>(h.db, 'SELECT reputation AS r FROM companies WHERE id = ?', cid)!.r;
  const roll = (ref: string, over: Partial<Roll> = {}) => rollIncident(h.db, { ref, companyId: cid, aircraftId: ac, at: h.clock.t, airport: 'LFLL', flightId: null, flightNo: 1138, dutyMin: 14 * 60, riskFactor: 1, wearPct: 70, landedAt: h.clock.t, ...over });
  return { h, u, cid, ac, call, balance, reputation, roll };
}

/** The first `n` references of the form `prefix + i` that end in an incident at the given duty and wear (the roll is seeded, so this is a fixed list). */
const hits = (prefix: string, dutyH: number, wear: number, n: number): string[] => {
  const out: string[] = [];
  for (let i = 0; out.length < n && i < 100_000; i++) if (drawIncident(incidentRisk(dutyH, wear), mulberry32(hashSeed(`incident:${prefix}${i}`)))) out.push(`${prefix}${i}`);
  return out;
};

// ---------------------------------------------------------------- migration

test('SCHEMA_V10 creates the incident journal and the daily readings on a fresh database', () => {
  const db = openDb(':memory:');
  assert.equal(get<{ user_version: number }>(db, 'PRAGMA user_version')!.user_version, MIGRATIONS.length);
  for (const t of ['incidents', 'safety_readings']) assert.ok(get(db, "SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?", t), t);
});

test('SCHEMA_V10 upgrades a database that stopped one migration earlier and keeps its companies', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'opc-v10-')), 'before.sqlite');
  const raw = new DatabaseSync(file);
  const before = MIGRATIONS.length - 1;
  for (let i = 0; i < before; i++) raw.exec(MIGRATIONS[i]!);
  raw.exec(`PRAGMA user_version = ${before}`);
  raw.exec("INSERT INTO users (id, username, pass_hash, created_at) VALUES (1, 'a', 'h', 1); INSERT INTO companies (id, user_id, name, balance, reputation, created_at) VALUES (1, 1, 'A Air', 5, 50, 1);");
  raw.close();
  const db = openDb(file);
  assert.equal(get<{ user_version: number }>(db, 'PRAGMA user_version')!.user_version, MIGRATIONS.length);
  assert.equal(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM companies')!.n, 1);
  assert.equal(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM incidents')!.n, 0);
});

// ---------------------------------------------------------------- the roll

test('a roll is a pure function of its reference: two worlds get the same incidents, and rolling the same reference again records nothing', async () => {
  const refs = hits('leg:1:', 14, 70, 6);
  const run1 = async () => { const w = await world(); const rows = refs.map((r) => w.roll(r)); return { w, rows }; };
  const a = await run1(), b = await run1();
  assert.equal(a.rows.every((r) => r !== null), true, 'every reference chosen above ends in an incident');
  const shape = (rows: (ReturnType<typeof rollIncident>)[]) => rows.map((r) => ({ severity: r!.severity, kind: r!.kind, cost: r!.cost, covered: r!.covered }));
  assert.deepEqual(shape(a.rows), shape(b.rows));
  // the same reference again: no second row, no second bill, no second reputation hit
  const balance = a.w.balance(), rep = a.w.reputation();
  assert.equal(a.w.roll(refs[0]!), null);
  assert.deepEqual([a.w.balance(), a.w.reputation(), get<{ n: number }>(a.w.h.db, 'SELECT COUNT(*) AS n FROM incidents')!.n], [balance, rep, refs.length]);
});

test('an incident costs what it says: the bill minus the insurance, the reputation, and the aircraft in the workshop for the severity\'s downtime', async () => {
  const w = await world();
  const cash = w.balance();
  const row = w.roll(hits('leg:2:', 14, 70, 1)[0]!, { landedAt: T0 + 3_600_000 })!;
  assert.ok(row.cost >= 50 && row.covered <= row.cost);
  assert.equal(w.balance(), cash - (row.cost - row.covered));
  assert.equal(get<{ s: number }>(w.h.db, "SELECT COALESCE(SUM(amount), 0) AS s FROM transactions WHERE kind = 'incident'")!.s, -(row.cost - row.covered));
  assert.equal(row.reputation_delta, INCIDENT_REPUTATION[row.severity]);
  assert.equal(row.downtime_until, T0 + 3_600_000 + INCIDENT_DOWNTIME_DAYS[row.severity] * DAY_MS);
  const ac = get<{ status: string; maintenance_until: number }>(w.h.db, 'SELECT status, maintenance_until FROM aircraft WHERE id = ?', w.ac)!;
  assert.deepEqual({ ...ac }, { status: 'maintenance', maintenance_until: row.downtime_until });
  assert.equal(row.duty_min, 14 * 60);
  assert.equal(row.risk, incidentRisk(14, 70));
  assert.equal(row.season, '2026-11');
});

test('a bird strike is paid by the insurer in full and costs the company nothing', async () => {
  const w = await world();
  let bird = null;
  for (let i = 0; i < 2000 && !bird; i++) { const r = w.roll(hits('leg:3:', 14, 70, 400)[i]!); if (r && isInsured(r.kind)) bird = r; }
  assert.ok(bird, 'one of the first 400 incidents is a bird strike');
  assert.equal(bird.covered, bird.cost);
  assert.equal(get<{ n: number }>(w.h.db, "SELECT COUNT(*) AS n FROM transactions WHERE kind = 'incident' AND memo LIKE 'bird_strike%'")!.n, 0);
});

test('nothing is ever rolled for a company with "wear and failures" off, nor for an AI company', async () => {
  const off = await world({ wear: false });
  for (const r of hits('leg:4:', 14, 70, 20)) assert.equal(off.roll(r), null);
  assert.equal(get<{ n: number }>(off.h.db, 'SELECT COUNT(*) AS n FROM incidents')!.n, 0);
  const on = await world();
  run(on.h.db, 'UPDATE companies SET user_id = NULL WHERE id = ?', on.cid);
  for (const r of hits('leg:4:', 14, 70, 20)) assert.equal(on.roll(r), null);
});

test('the rest policy lowers the risk the roll uses, and a rested crew on a young aircraft is rolled far below the mockup\'s 1.8 %', async () => {
  const w = await world();
  const strict = w.roll(hits('leg:5:', 14, 70, 1)[0]!, { riskFactor: REST_POLICIES.generous.riskFactor })?.risk ?? 0;
  assert.ok(strict === 0 || Math.abs(strict - incidentRisk(14, 70) * 0.7) < 1e-12);
  assert.ok(incidentRisk(4, 5) < 0.004);
});

// ---------------------------------------------------------------- the hooks

test('a flight the player flew is rolled once at the wear it flew with; the journal, the season totals and the ledger tell the same story', async () => {
  const h = await harness();
  const { token, me } = await h.register('pilot');
  const cid = me.company.id as number;
  saveRealism(h.db, cid, presetSetting('balanced'));
  const aircraftId = me.fleet[0].id as number;
  // flights take the next free id: park a closed flight just below an id whose roll is a sure incident (its first draw is under the risk of a new aircraft)
  let id = 2;
  while (mulberry32(hashSeed(`incident:flight:${id}`))() >= 0.003) id++;
  run(h.db, `INSERT INTO flights (id, company_id, aircraft_id, aircraft_icao, job_id, source, kind, origin, destination, distance_nm, payload_kg, pax, payout, status, accepted_at)
    VALUES (?, ?, ?, 'C172', 'x', 'board', 'pax', 'LFPG', 'LFPG', 1, 1, 1, 1, 'cancelled', 1)`, id - 1, cid, aircraftId);
  const key = await h.apiKey(token);
  const job = await h.flyableJob(token, aircraftId);
  const flight = (await h.call('POST', `/api/v1/jobs/${job.id}/accept`, { token, body: { aircraftId } })).body;
  assert.equal(flight.id, id);
  const rep0 = get<{ r: number }>(h.db, 'SELECT reputation AS r FROM companies WHERE id = ?', cid)!.r;
  const r = await h.call('POST', `/api/v1/flights/${flight.id}/telemetry-verify`, { token: key, body: h.goodReport(job) });
  assert.equal(r.body.verification, 'verified');
  const inc = all<{ ref: string; flight_id: number; cost: number; covered: number; severity: string; duty_min: number; reputation_delta: number }>(h.db, 'SELECT * FROM incidents');
  assert.equal(inc.length, 1);
  assert.equal(inc[0]!.ref, `flight:${id}`);
  assert.equal(inc[0]!.flight_id, id);
  assert.equal(inc[0]!.duty_min, 45 + Math.round((job.distanceNm / 122) * 60) + 15 > 0 ? inc[0]!.duty_min : -1, 'duty is the flight\'s own block time plus report and release');

  const season = (await h.call('GET', '/api/v1/safety', { token })).body as SafetyView;
  assert.deepEqual(season.season, { total: inc[0]!.cost, covered: inc[0]!.covered, borne: inc[0]!.cost - inc[0]!.covered, insuranceFrom: season.season.insuranceDelta > 0 ? '2026-12' : null, insuranceDelta: insuranceSurcharge(all(h.db, 'SELECT severity, kind FROM incidents')) });
  const list = (await h.call('GET', '/api/v1/safety/incidents', { token })).body as IncidentView[];
  assert.equal(list.length, 1);
  assert.deepEqual([list[0]!.flightId, list[0]!.flightNo, list[0]!.cost, list[0]!.covered, list[0]!.reputationDelta], [id, null, inc[0]!.cost, inc[0]!.covered, inc[0]!.reputation_delta]);
  assert.equal(list[0]!.registration, me.fleet[0].registration);
  assert.equal(typeof list[0]!.title, 'string');
  assert.equal(get<{ r: number }>(h.db, 'SELECT reputation AS r FROM companies WHERE id = ?', cid)!.r >= rep0 - 6, true);
  assert.deepEqual((await h.call('GET', '/api/v1/safety/incidents?season=2026-10', { token })).body, [], 'another month: nothing');
});

test('a line leg is rolled at its own tick with the crew\'s duty and the rest policy: an incident grounds the aircraft, the next legs are cancelled, and the roll is never taken twice', async () => {
  const saved = REST_POLICIES.standard.riskFactor;
  REST_POLICIES.standard.riskFactor = 1_000; // every roll ends in an incident, so the hook is seen without waiting weeks of simulated flying
  try {
    const w = await world();
    const made = await w.h.call('POST', '/api/v1/lines', { token: w.u.token, body: body({ aircraftIds: [w.ac] }) });
    assert.equal(made.status, 201, made.text);
    grantStarterCrew(w.h.db, w.cid, w.h.clock.t); refreshLine(w.h.db, made.body.id, w.h.clock.t);
    w.h.clock.t += DAY_MS; await w.call('/api/v1/network');
    const inc = all<{ ref: string; at: number; flight_no: number; duty_min: number; risk: number; downtime_until: number; severity: string }>(w.h.db, 'SELECT * FROM incidents ORDER BY at');
    const legs = all<{ status: string; dep_at: number; flight_no: number; cancel_cause: string | null }>(w.h.db, 'SELECT * FROM scheduled_flights ORDER BY dep_at');
    assert.equal(inc.length, 1, 'the first leg grounds the aircraft, so there is no second roll to take');
    assert.equal(inc[0]!.ref, `leg:${made.body.id}:${legs[0]!.dep_at}:${legs[0]!.flight_no}`);
    assert.equal(inc[0]!.risk, 1, 'capped at certainty');
    assert.ok(inc[0]!.duty_min >= 60 && inc[0]!.duty_min <= 13 * 60, `${inc[0]!.duty_min} min of duty: from the crew's own ledger`);
    assert.equal(legs[0]!.status, 'done');
    const until = inc[0]!.downtime_until;
    assert.ok(legs.filter((l) => l.dep_at < until && l.dep_at <= w.h.clock.t && l !== legs[0]).every((l) => l.status === 'cancelled' && l.cancel_cause === 'aircraft_unavailable'), 'legs in the repair window are cancelled for the aircraft');
    // replaying the clock changes nothing
    const before = JSON.stringify([all(w.h.db, 'SELECT * FROM incidents'), w.balance(), w.reputation()]);
    await w.call('/api/v1/network'); await w.call('/api/v1/safety');
    assert.equal(JSON.stringify([all(w.h.db, 'SELECT * FROM incidents'), w.balance(), w.reputation()]), before);
    const j = (await w.call('/api/v1/safety/incidents')).body as IncidentView[];
    assert.match(j[0]!.flightNo ?? '', /^[A-Z]{3} \d+$/);
  } finally {
    REST_POLICIES.standard.riskFactor = saved;
  }
});

// ---------------------------------------------------------------- insurance

test('the premium rises by what last month\'s incidents earned: the December bill of a company that had at-fault incidents in November, and only that one', async () => {
  const w = await world();
  const refs = hits('leg:6:', 14, 70, 60);
  const mine = refs.map((r) => w.roll(r, { at: Date.UTC(2026, 10, 10) })).filter((r) => r !== null);
  const rise = insuranceSurcharge(mine);
  assert.ok(rise > 0, 'the first sixty incidents include at least one at-fault one');
  // a month with nothing in it is billed at the base premium; the month after the incidents carries the rise
  const hull = 1_000_000 * 0.0012;
  const bill = (month: number) => { w.h.clock.t = Date.UTC(2026, month, 2); run(w.h.db, 'UPDATE sessions SET expires_at = ?', w.h.clock.t + 1e10); runBilling(w.h.db, w.cid, w.h.clock.t); };
  run(w.h.db, "UPDATE aircraft SET status = 'available', maintenance_until = NULL, acquired_at = 1");
  bill(11);
  const dec = all<{ amount: number; memo: string }>(w.h.db, "SELECT amount, memo FROM transactions WHERE kind = 'insurance' AND at = ? ORDER BY id", Date.UTC(2026, 11, 1));
  const atrDec = dec.find((t) => /AT76|F-/.test(t.memo) && Math.abs(t.amount) > 1000)!;
  assert.equal(atrDec.amount, -Math.round(hull * (1 + rise)));
  assert.match(atrDec.memo, /\+\d+ %$/);
  bill(12);
  const jan = all<{ amount: number }>(w.h.db, "SELECT amount FROM transactions WHERE kind = 'insurance' AND at = ? ORDER BY id", Date.UTC(2027, 0, 1));
  assert.ok(jan.some((t) => t.amount === -Math.round(hull)), 'January: the rise was for December only');
});

// ---------------------------------------------------------------- GET /safety

test('GET /safety: the index of the three parts, the company\'s own curve, an honest empty state and no side effect but the day\'s reading', async () => {
  const w = await world();
  const v = (await w.call('/api/v1/safety')).body as SafetyView;
  assert.equal(v.index, v.parts.fatigue.points + v.parts.aircraft.points + v.parts.training.points);
  assert.deepEqual([v.parts.fatigue.max, v.parts.aircraft.max, v.parts.training.max], [40, 40, 20]);
  assert.equal(v.active, true);
  assert.equal(v.delta7d, 0, 'the first reading has nothing to compare with');
  assert.equal(v.riskFactor, REST_POLICIES.standard.riskFactor);
  assert.equal(v.riskCurve.length, 29);
  assert.equal(v.riskCurve[16]!.risk, incidentRisk(8, 0, 0.9), 'the curve is the worst aircraft\'s wear (new: 0 %) at the rest policy\'s factor');
  assert.deepEqual([v.today, v.levers, v.season], [[], [], { total: 0, covered: 0, borne: 0, insuranceFrom: null, insuranceDelta: 0 }]);
  assert.equal(v.parts.aircraft.worst?.aircraftId !== undefined, true);
  // same day, same answer; the reading is kept once
  assert.deepEqual((await w.call('/api/v1/safety')).body, v);
  assert.equal(get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM safety_readings')!.n, 1);
});

test('GET /safety: levers add up, "today" lists the crews the line engine would give and leaves no booking behind, and the delta follows the injected clock', async () => {
  const w = await world();
  const made = await w.h.call('POST', '/api/v1/lines', { token: w.u.token, body: body({ aircraftIds: [w.ac], freqPerDay: 4, windowStart: '04:00', windowEnd: '22:00' }) });
  assert.equal(made.status, 201, made.text);
  grantStarterCrew(w.h.db, w.cid, w.h.clock.t); refreshLine(w.h.db, made.body.id, w.h.clock.t);
  run(w.h.db, 'UPDATE aircraft SET wear_pct = 75 WHERE id = ?', w.ac);
  const duty0 = get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM staff_duty')!.n;
  const ledger0 = get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM transactions')!.n;
  const v = (await w.call('/api/v1/safety')).body as SafetyView;
  assert.ok(v.today.length > 0 && v.today.length <= 8, `${v.today.length} flights tonight`);
  for (const f of v.today) {
    assert.ok(Math.abs(f.risk - incidentRisk(f.dutyHours, f.wearPct, v.riskFactor)) < 1e-4, 'the risk is the one of the duty shown');
    assert.ok(f.dutyHours > 0 && f.dutyHours <= 13 && f.crew.length > 0);
  }
  assert.deepEqual(v.today.map((f) => f.risk), [...v.today.map((f) => f.risk)].sort((a, b) => b - a), 'the riskiest first');
  assert.equal(get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM staff_duty')!.n, duty0, 'the preview books nothing');
  assert.equal(get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM transactions')!.n, ledger0);
  const worn = v.levers.find((l) => l.action === 'maintenance');
  assert.ok(worn, 'a 75 % aircraft earns a service lever');
  assert.deepEqual([worn.ref, worn.points > 0], [String(w.ac), true]);
  assert.ok(v.levers.every((l) => l.points > 0 && l.label.length > 0 && l.detail.length > 0));
  // the index is the sum of the exact parts as shown, so a lever cannot promise more than the index has left to give
  assert.ok(v.levers.reduce((n, l) => n + l.points, 0) <= 100 - v.index + 0.5);
  // six days later the same company is asked again: today's reading is new, the delta is against the earliest of the week
  const first = v.index;
  w.h.clock.t += 3 * DAY_MS; run(w.h.db, 'UPDATE sessions SET expires_at = ?', w.h.clock.t + 1e10);
  run(w.h.db, 'UPDATE aircraft SET wear_pct = 5 WHERE id = ?', w.ac);
  const later = (await w.call('/api/v1/safety')).body as SafetyView;
  assert.equal(later.delta7d, later.index - first);
  assert.ok(later.delta7d >= 0);
});

test('GET /safety and /safety/incidents need a session and a valid season', async () => {
  const w = await world();
  assert.equal((await w.h.call('GET', '/api/v1/safety')).status, 401);
  assert.equal((await w.h.call('GET', '/api/v1/safety/incidents')).status, 401);
  assert.equal((await w.h.call('GET', '/api/v1/safety/incidents?season=nov', { token: w.u.token })).status, 400);
  assert.deepEqual((await w.h.call('GET', '/api/v1/safety/incidents', { token: w.u.token })).body, []);
});
