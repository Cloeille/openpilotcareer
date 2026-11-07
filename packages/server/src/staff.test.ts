import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DAY_MS, DUTY_MAX_MIN, FIRING_MONTHS, FLIGHT_MAX_28D_MIN, LINE_TICK_MS, REST_POLICIES, TRAINING_COURSE, dayNo,
  type CandidatesView, type LeaveView, type StaffDetail, type StaffOverview,
} from '@opc/shared';
import { buildApp } from './app.ts';
import { sha256 } from './auth.ts';
import { all, get, MIGRATIONS, openDb, run } from './db.ts';
import { insertAircraft } from './fleet-extras.ts';
import { planMonth, runBilling } from './finance.ts';
import { harness } from './harness.ts';
import { catchUpLines, refreshLine } from './lines.ts';
import { grantStarterCrew } from './staff-people.ts';
import { stateOf, type StaffRow } from './staff.ts';

const T0 = Date.UTC(2026, 10, 4, 12, 0, 0); // Wednesday 4 Nov 2026, 12:00Z (the harness clock)
const body = (over: Record<string, unknown> = {}) => ({ a: 'LFPG', b: 'LFLL', freqPerDay: 3, days: Array(7).fill(true), windowStart: '06:00', windowEnd: '18:00', aircraftIds: [] as number[], ...over });

/** A player at LFPG with one AT76 and the LFPG-LFLL line, NO crew yet (unless `crew`). */
async function world(o: { crew?: boolean; freq?: number } = {}) {
  const h = await harness();
  const u = await h.register('amy', 'LFPG');
  const cid = u.me.company.id as number;
  const ac = insertAircraft(h.db, { companyId: cid, icao: 'AT76', hub: 'LFPG', value: 1_000_000, ownership: 'owned', at: h.clock.t });
  run(h.db, 'UPDATE companies SET balance = 5000000 WHERE id = ?', cid);
  const tok = u.token;
  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, b?: unknown) => h.call(method, url, { token: tok, ...(b === undefined ? {} : { body: b }) });
  const made = await call('POST', '/api/v1/lines', body({ aircraftIds: [ac], freqPerDay: o.freq ?? 3, windowEnd: o.freq ? '22:00' : '18:00' }));
  assert.equal(made.status, 201, made.text);
  const lineId = made.body.id as number;
  if (o.crew) { grantStarterCrew(h.db, cid, h.clock.t); refreshLine(h.db, lineId, h.clock.t); }
  const advance = async (ms: number) => { h.clock.t += ms; await call('GET', '/api/v1/network'); };
  const legs = () => all<{ id: number; status: string; dep_at: number; cancel_cause: string | null; crew_family: string | null }>(h.db, 'SELECT * FROM scheduled_flights ORDER BY dep_at, id');
  const balance = () => get<{ balance: number }>(h.db, 'SELECT balance FROM companies WHERE id = ?', cid)!.balance;
  const tx = (kind: string) => all<{ amount: number; memo: string; at: number }>(h.db, 'SELECT amount, memo, at FROM transactions WHERE company_id = ? AND kind = ? ORDER BY id', cid, kind);
  return { h, u, cid, ac, tok, lineId, call, advance, legs, balance, tx };
}

// ---------------------------------------------------------------- migration and the starter crew (C11)

test('SCHEMA_V8 creates the staff tables on a fresh database', () => {
  const db = openDb(':memory:');
  assert.equal(get<{ user_version: number }>(db, 'PRAGMA user_version')!.user_version, MIGRATIONS.length);
  for (const t of ['staff_company', 'staff', 'staff_quals', 'staff_leave', 'staff_duty']) assert.ok(get(db, "SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?", t), t);
});

test('upgrading a v7 database: companies that fly lines are owed a starter crew, granted once by the first request, free, and paid only from the next month', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'opc-v8-')), 'v7.sqlite');
  const raw = new DatabaseSync(file);
  for (let i = 0; i < 6; i++) raw.exec(MIGRATIONS[i]!);
  raw.exec('PRAGMA user_version = 6');
  raw.exec(`INSERT INTO users VALUES (1, 'amy', 'h', 1), (2, 'bob', 'h', 1);
    INSERT INTO sessions VALUES ('${sha256('tok')}', 1, ${T0 + 99 * DAY_MS});
    INSERT INTO companies (id, user_id, name, balance, reputation, created_at, code) VALUES (1, 1, 'Amy Air', 1000000, 50, 1, 'AMY'), (2, 2, 'Bob Air', 1000000, 50, 1, 'BOB'), (3, NULL, 'Bot', 1000000, 50, 1, NULL);
    INSERT INTO hubs VALUES (1, 'LFPG'), (2, 'LFPG'), (3, 'LFPG');
    INSERT INTO aircraft (id, company_id, icao, location, value, registration, base, acquired_at) VALUES (1, 1, 'AT76', 'LFPG', 1, 'F-HAAA', 'LFPG', 1), (2, 2, 'AT76', 'LFPG', 1, 'F-HBBB', 'LFPG', 1), (3, 3, 'AT76', 'LFPG', 1, 'F-HCCC', 'LFPG', 1);
    INSERT INTO billing_runs VALUES (1, '2026-11', 1), (2, '2026-11', 1);
    INSERT INTO lines (id, company_id, a, b, created_at, freq_per_day, days, window_start_min, window_end_min, turnaround_min, flight_base) VALUES (1, 1, 'LFLL', 'LFPG', 1, 3, 127, 360, 1080, 30, 1100), (2, 3, 'LFLL', 'LFPG', 1, 3, 127, 360, 1080, 30, 1100);
    INSERT INTO line_aircraft VALUES (1, 1, 'LFPG'), (2, 3, 'LFPG');`);
  raw.close();
  const db = openDb(file);
  assert.deepEqual(all<{ company_id: number; starter_pending: number }>(db, 'SELECT company_id, starter_pending FROM staff_company ORDER BY company_id').map((r) => ({ company_id: r.company_id, starter_pending: r.starter_pending })), [{ company_id: 1, starter_pending: 1 }], 'only the human company with a line; Bob has no line, the bot has no staff model');
  assert.equal(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM staff')!.n, 0);

  const clock = { t: T0 };
  const app = await buildApp({ db, now: () => clock.t, ai: false });
  const balance = get<{ balance: number }>(db, 'SELECT balance FROM companies WHERE id = 1')!.balance;
  const r = await app.inject({ method: 'GET', url: '/api/v1/staff', headers: { authorization: 'Bearer tok' } });
  assert.equal(r.statusCode, 200, r.body);
  const o = JSON.parse(r.body) as StaffOverview;
  assert.ok(o.people > 0 && o.people >= o.positions, `${o.people} people for ${o.positions} positions: the starter crew covers the need`);
  assert.equal(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM staff WHERE company_id != 1')!.n, 0, 'nobody for Bob or the bot');
  assert.equal(get<{ b: number }>(db, 'SELECT balance AS b FROM companies WHERE id = 1')!.b, balance, 'the starter crew costs nothing');
  assert.equal(get<{ starter_pending: number }>(db, 'SELECT starter_pending FROM staff_company WHERE company_id = 1')!.starter_pending, 0);
  const n = get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM staff')!.n;
  await app.inject({ method: 'GET', url: '/api/v1/staff', headers: { authorization: 'Bearer tok' } });
  assert.equal(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM staff')!.n, n, 'granted once');

  // the payroll starts with the next month: November (the month of the upgrade) is already billed and December pays them all
  const staff = all<{ salary: number; since: number; ends_at: number | null }>(db, 'SELECT salary, MAX(starts_at, hired_at) AS since, ends_at FROM staff WHERE company_id = 1');
  const total = staff.reduce((t, s) => t + s.salary, 0);
  assert.equal(planMonth(Date.UTC(2026, 10, 1), [], [], staff).charges.length, 0, 'not for November');
  assert.deepEqual(planMonth(Date.UTC(2026, 11, 1), [], [], staff).charges, [{ kind: 'payroll', amount: -total, memo: `payroll ${staff.length} people` }]);
  await app.close();
});

test('a starter crew flies a month of the line without one cancellation for want of crew; stepping the clock or jumping it gives the same books', async () => {
  const stepwise = await world({ crew: true });
  for (let i = 0; i < 4 * 24 * 12; i++) { stepwise.h.clock.t += LINE_TICK_MS; catchUpLines(stepwise.h.db, stepwise.h.clock.t); }
  const jumped = await world({ crew: true });
  await jumped.advance(12 * DAY_MS);
  const flown = (w: typeof stepwise) => w.legs().filter((l) => l.status === 'done');
  assert.ok(flown(stepwise).length > 60, `${flown(stepwise).length} legs flown`);
  assert.deepEqual(stepwise.legs().filter((l) => l.status === 'cancelled'), [], 'no cancellation for want of crew');
  assert.deepEqual(jumped.legs(), stepwise.legs());
  const ledger = (w: typeof stepwise) => all(w.h.db, 'SELECT person, leg, day, dep_at, duty_min, flight_min FROM (SELECT staff_id AS person, leg_id AS leg, day, dep_at, duty_min, flight_min FROM staff_duty) ORDER BY person, leg');
  assert.deepEqual(ledger(jumped), ledger(stepwise), 'the duty ledger is the same');
});

// ---------------------------------------------------------------- the invariants of the duty rules, checked on the ledger

test('across 30 days no person ever exceeds the duty limits: 13 h a day, 28-day flight time, 6 days in a row, rest between periods', async () => {
  const w = await world({ crew: true, freq: 4 });
  // one pilot crew for a four-rotation programme: the limits actually bind
  run(w.h.db, "DELETE FROM staff WHERE family = 'pilot' AND id NOT IN (SELECT id FROM staff WHERE family = 'pilot' ORDER BY id LIMIT 2)");
  await w.advance(30 * DAY_MS);
  const rows = all<{ staff_id: number; day: number; dep_at: number; arr_at: number; duty_start: number; flight_min: number }>(w.h.db, 'SELECT * FROM staff_duty ORDER BY staff_id, dep_at');
  assert.ok(rows.length > 100, `${rows.length} bookings`);
  const bySid = new Map<number, typeof rows>();
  for (const r of rows) bySid.set(r.staff_id, [...(bySid.get(r.staff_id) ?? []), r]);
  for (const [sid, list] of bySid) {
    for (const r of list) assert.ok((r.arr_at + 15 * 60_000 - r.duty_start) / 60_000 <= DUTY_MAX_MIN, `staff ${sid}: a duty period over 13 h`);
    for (const r of list) {
      const window = list.filter((x) => x.dep_at > r.dep_at - 28 * DAY_MS && x.dep_at <= r.dep_at).reduce((t, x) => t + x.flight_min, 0);
      assert.ok(window <= FLIGHT_MAX_28D_MIN, `staff ${sid}: ${window} min in 28 days`);
    }
    const days = [...new Set(list.map((x) => x.day))].sort((a, b) => a - b);
    let run_ = 1;
    for (let i = 1; i < days.length; i++) { run_ = days[i] === days[i - 1]! + 1 ? run_ + 1 : 1; assert.ok(run_ <= 6, `staff ${sid}: ${run_} duty days in a row`); }
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1]!, cur = list[i]!;
      if (cur.duty_start !== prev.duty_start) assert.ok(cur.duty_start - (prev.arr_at + 15 * 60_000) >= 12 * 3_600_000 - 1 || cur.dep_at - prev.arr_at >= 6 * 3_600_000, `staff ${sid}: not enough rest`);
    }
  }
  const causes = new Set(w.legs().filter((l) => l.status === 'cancelled').map((l) => l.cancel_cause));
  assert.ok(causes.has('duty_limit') || causes.has('no_crew'), `understaffed, so legs were cancelled for crew (${[...causes]})`);
});

// ---------------------------------------------------------------- no crew: cancellation, interruption, recruiting

test('a line with nobody to fly it cancels for no_crew, is interrupted for crew without a reputation cost, and recruiting brings it back', async () => {
  const w = await world();
  const rep0 = get<{ r: number }>(w.h.db, 'SELECT reputation AS r FROM companies WHERE id = ?', w.cid)!.r;
  await w.advance(2 * 3_600_000);
  const first = w.legs().filter((l) => l.status === 'cancelled');
  assert.ok(first.length > 0 && first.every((l) => l.cancel_cause === 'no_crew' && l.crew_family === 'pilot'), 'cancelled for want of pilots');
  const fc = (await w.call('POST', '/api/v1/lines/forecast', body({ aircraftIds: [w.ac] }))).body;
  assert.equal(fc.crewModelled, true);
  assert.ok(fc.needs.pilots.required >= 4 && fc.needs.pilots.available === 0 && fc.needs.cabin.available === 0, JSON.stringify(fc.needs));
  assert.deepEqual(fc.needs.ground.missingAt.sort(), ['LFLL', 'LFPG']);

  const line = (await w.call('GET', `/api/v1/lines/${w.lineId}`)).body;
  assert.equal(line.line.status, 'interrupted');
  assert.equal(line.line.interruptCause, 'crew');
  assert.ok(line.depends.some((d: { key: string; ok: boolean }) => d.key === 'crew' && !d.ok));
  const problem = (await w.call('GET', `/api/v1/lines/${w.lineId}/problem`)).body;
  assert.ok(problem.problem.some((p: { kind: string }) => p.kind === 'crew'));
  assert.ok(problem.options.recruit && problem.options.recruit.candidates >= 4 && problem.options.recruit.monthly > 0, JSON.stringify(problem.options.recruit));
  const ops = (await w.call('GET', '/api/v1/staff')).body as StaffOverview;
  assert.ok(ops.blockers.some((b) => b.kind === 'no_crew' && b.family === 'pilot' && b.type === 'AT76' && b.flights > 0), JSON.stringify(ops.blockers));
  assert.equal(get<{ r: number }>(w.h.db, 'SELECT reputation AS r FROM companies WHERE id = ?', w.cid)!.r, rep0 - first.length * 0.02, 'cancelled legs cost 0.02 each, the stoppage nothing yet');

  const before = w.balance();
  const res = await w.call('POST', `/api/v1/lines/${w.lineId}/resolve`, { option: 'recruit' });
  assert.equal(res.status, 200, res.text);
  assert.ok(w.balance() < before, 'the hiring premiums are paid');
  assert.ok(w.tx('hire_premium').length >= 4);
  await w.advance(8 * DAY_MS);
  assert.equal(((await w.call('GET', `/api/v1/lines/${w.lineId}`)).body).line.status, 'active', 'the crew has started: the line is back');
  assert.ok(w.legs().some((l) => l.status === 'done'), 'and flies');
  assert.equal((await w.call('POST', `/api/v1/lines/${w.lineId}/resolve`, { option: 'recruit' })).body.error, 'nothing_to_recruit');
});

test('granted leave takes a person off the roster; a leg with a crew that is on leave is cancelled, and the leave decision is checked', async () => {
  const w = await world({ crew: true });
  const pilots = all<{ id: number }>(w.h.db, "SELECT id FROM staff WHERE family = 'pilot' ORDER BY id");
  const cabin = all<{ id: number }>(w.h.db, "SELECT id FROM staff WHERE family = 'cabin' ORDER BY id");
  const d0 = dayNo(w.h.clock.t);
  // everyone is away today and tomorrow: the line cannot fly
  for (const p of [...pilots, ...cabin]) run(w.h.db, "INSERT INTO staff_leave (staff_id, from_day, to_day, status, kind) VALUES (?, ?, ?, 'granted', 'leave')", p.id, d0, d0 + 1);
  await w.advance(DAY_MS);
  const cancelled = w.legs().filter((l) => l.status === 'cancelled' && l.dep_at < w.h.clock.t);
  assert.ok(cancelled.length > 0 && cancelled.every((l) => l.cancel_cause === 'no_crew'), `${cancelled.length} cancelled for no crew`);
  await w.advance(2 * DAY_MS);
  assert.ok(w.legs().some((l) => l.status === 'done' && l.dep_at >= (d0 + 2) * DAY_MS), 'flying again when the leave is over');
  assert.equal(((await w.call('GET', `/api/v1/lines/${w.lineId}`)).body).line.status, 'active');
});

// ---------------------------------------------------------------- recruitment, hiring, firing, training

test('candidates are the same people all day, differ between days, and hiring pays a month up front and starts after the notice', async () => {
  const w = await world();
  const a = (await w.call('GET', '/api/v1/staff/candidates?family=pilot&base=LFPG&qual=AT76')).body as CandidatesView;
  assert.ok(a.market >= 6 && a.candidates.length === a.market, `${a.market} pilots on the market`);
  assert.ok(a.candidates.every((c) => c.family === 'pilot' && c.qual === 'AT76' && c.base === 'LFPG' && c.askingSalary > 0 && c.premium === c.askingSalary && c.noticeDays === 7));
  assert.ok(a.candidates.every((c) => c.reliability >= 60 && c.reliability <= 98));
  assert.deepEqual((await w.call('GET', '/api/v1/staff/candidates?family=pilot&base=LFPG&qual=AT76')).body, a, 'deterministic');
  assert.ok(a.suggestion && a.suggestion.count > 0, 'the biggest vacancy is suggested');
  const sorted = (await w.call('GET', '/api/v1/staff/candidates?family=pilot&base=LFPG&qual=AT76&sort=salary')).body as CandidatesView;
  assert.deepEqual(sorted.candidates.map((c) => c.askingSalary), [...sorted.candidates.map((c) => c.askingSalary)].sort((x, y) => x - y));
  w.h.clock.t += DAY_MS;
  const b = (await w.call('GET', '/api/v1/staff/candidates?family=pilot&base=LFPG&qual=AT76')).body as CandidatesView;
  assert.notDeepEqual(b.candidates.map((c) => c.name), a.candidates.map((c) => c.name), 'a new day, new people');
  w.h.clock.t -= DAY_MS;

  const c = a.candidates[0]!;
  const before = w.balance();
  const r = await w.call('POST', '/api/v1/staff/hire', { candidateId: c.id });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.premium, c.askingSalary);
  assert.equal(r.body.startsAt, w.h.clock.t + 7 * DAY_MS);
  assert.equal(r.body.balanceAfter, before - c.askingSalary);
  assert.equal(r.body.member.state, 'pending');
  assert.deepEqual(r.body.member.quals, ['AT76']);
  assert.deepEqual(w.tx('hire_premium').map((t) => t.amount), [-c.askingSalary]);
  assert.equal((await w.call('POST', '/api/v1/staff/hire', { candidateId: c.id })).body.error, 'candidate_taken');
  assert.equal((await w.call('POST', '/api/v1/staff/hire', { candidateId: '1.LFPG.pilot.AT76.0' })).status, 404, 'a candidate of another day');
  assert.equal((await w.call('POST', '/api/v1/staff/hire', { candidateId: 'nonsense' })).status, 404);
  const after = (await w.call('GET', '/api/v1/staff/candidates?family=pilot&base=LFPG&qual=AT76')).body as CandidatesView;
  assert.equal(after.market, a.market - 1, 'the hired candidate is gone from the market');
  assert.equal(((await w.call('GET', '/api/v1/staff')).body as StaffOverview).people, 0, 'not counted until they start');
  await w.advance(8 * DAY_MS);
  assert.equal(((await w.call('GET', `/api/v1/staff/${r.body.member.id}`)).body as StaffDetail).member.state, 'free');
});

test('hiring with an empty purse is refused and charges nothing', async () => {
  const w = await world();
  run(w.h.db, 'UPDATE companies SET balance = 100 WHERE id = ?', w.cid);
  const c = ((await w.call('GET', '/api/v1/staff/candidates?family=cabin&base=LFPG')).body as CandidatesView).candidates[0]!;
  const r = await w.call('POST', '/api/v1/staff/hire', { candidateId: c.id });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'insufficient_funds');
  assert.equal(w.balance(), 100);
  assert.equal(get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM staff')!.n, 0);
});

test('letting someone go costs three months of salary (C7), once, and takes them off the payroll and the roster', async () => {
  const w = await world({ crew: true });
  const p = get<{ id: number; salary: number }>(w.h.db, "SELECT id, salary FROM staff WHERE family = 'pilot' ORDER BY id LIMIT 1")!;
  const before = w.balance();
  const r = await w.call('DELETE', `/api/v1/staff/${p.id}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.severance, p.salary * FIRING_MONTHS);
  assert.equal(r.body.balanceAfter, before - p.salary * FIRING_MONTHS);
  assert.deepEqual(w.tx('severance').map((t) => t.amount), [-p.salary * FIRING_MONTHS]);
  assert.equal((await w.call('DELETE', `/api/v1/staff/${p.id}`)).body.error, 'already_left');
  assert.equal(((await w.call('GET', `/api/v1/staff/${p.id}`)).body as StaffDetail).member.state, 'left');
  const o = (await w.call('GET', '/api/v1/staff')).body as StaffOverview;
  assert.equal(o.people, get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM staff WHERE ends_at IS NULL')!.n);
  assert.equal((await w.call('DELETE', '/api/v1/staff/99999')).status, 404);
});

test('a type rating takes the pilot off the roster for the course, costs it, and the pilot flies the type afterwards; only pilots can train', async () => {
  const w = await world({ crew: true });
  const pilot = get<{ id: number }>(w.h.db, "SELECT id FROM staff WHERE family = 'pilot' ORDER BY id LIMIT 1")!;
  const cabin = get<{ id: number }>(w.h.db, "SELECT id FROM staff WHERE family = 'cabin' ORDER BY id LIMIT 1")!;
  const before = w.balance();
  const r = await w.call('POST', `/api/v1/staff/${pilot.id}/train`, { type: 'A320' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.body.cost, r.body.days], [TRAINING_COURSE['jet-airliner'].cost, 21]);
  assert.equal(r.body.until, w.h.clock.t + 21 * DAY_MS);
  assert.equal(w.balance(), before - 24_000);
  assert.equal(r.body.member.state, 'training');
  assert.equal((await w.call('POST', `/api/v1/staff/${pilot.id}/train`, { type: 'A320' })).body.error, 'already_qualified');
  assert.equal((await w.call('POST', `/api/v1/staff/${cabin.id}/train`, { type: 'A320' })).body.error, 'not_a_pilot');
  const d = (await w.call('GET', `/api/v1/staff/${pilot.id}`)).body as StaffDetail;
  assert.deepEqual(d.quals.map((q) => [q.type, q.inTraining]), [['A320', true], ['AT76', false]]);
  await w.advance(22 * DAY_MS);
  const d2 = (await w.call('GET', `/api/v1/staff/${pilot.id}`)).body as StaffDetail;
  assert.equal(d2.member.state, 'free');
  assert.deepEqual(d2.quals.map((q) => q.inTraining), [false, false]);
});

test('an interim pilot starts now for the days booked and leaves by himself; transfer and rest respect the roster', async () => {
  const w = await world({ crew: true });
  const before = w.balance();
  const r = await w.call('POST', '/api/v1/staff/interim', { family: 'pilot', qual: 'AT76', days: 4 });
  assert.equal(r.status, 201, r.text);
  assert.ok(r.body.cost > 0 && w.balance() === before - r.body.cost);
  assert.equal(r.body.member.state, 'free');
  assert.equal(r.body.member.contract, 'cdd');
  assert.equal(r.body.endsAt, w.h.clock.t + 4 * DAY_MS);
  assert.equal((await w.call('POST', '/api/v1/staff/interim', { family: 'pilot', days: 2 })).status, 400, 'a pilot needs the type');
  assert.equal((await w.call('DELETE', `/api/v1/staff/${r.body.member.id}`)).body.error, 'temporary_contract');
  await w.advance(5 * DAY_MS);
  assert.equal(((await w.call('GET', `/api/v1/staff/${r.body.member.id}`)).body as StaffDetail).member.state, 'left');

  const cabin = get<{ id: number }>(w.h.db, "SELECT id FROM staff WHERE family = 'cabin' ORDER BY id LIMIT 1")!;
  assert.equal((await w.call('POST', `/api/v1/staff/${cabin.id}/transfer`, { base: 'LFLL' })).status, 422, 'LFLL is not a hub or base of the company');
  const rested = await w.call('POST', `/api/v1/staff/${cabin.id}/rest`);
  assert.equal(rested.status, 200, rested.text);
  assert.equal(rested.body.state, 'leave');
});

// ---------------------------------------------------------------- payroll (C7)

test('payroll is its own monthly charge: people who started before the 1st and have not left, none for a hire in notice, none for the month of the premium', () => {
  const m = Date.UTC(2026, 11, 1);
  const staff = [
    { salary: 6_200, since: Date.UTC(2026, 10, 4), ends_at: null },
    { salary: 3_400, since: Date.UTC(2026, 10, 20), ends_at: null },
    { salary: 3_000, since: Date.UTC(2026, 11, 3), ends_at: null }, // starts after the 1st
    { salary: 4_000, since: Date.UTC(2026, 9, 1), ends_at: Date.UTC(2026, 10, 15) }, // left in November
  ];
  const plan = planMonth(m, [], [], staff);
  assert.deepEqual(plan.charges, [{ kind: 'payroll', amount: -9_600, memo: 'payroll 2 people' }]);
  assert.deepEqual(planMonth(m, [], [], []).charges, [], 'no staff, no charge');
});

test('billing posts the payroll once per month through runBilling (idempotent); firing someone lowers the next one', async () => {
  const w = await world({ crew: true });
  const staff = all<{ id: number; salary: number }>(w.h.db, 'SELECT id, salary FROM staff ORDER BY id');
  const total = staff.reduce((t, s) => t + s.salary, 0);
  run(w.h.db, "UPDATE staff SET hired_at = ?, starts_at = 0", Date.UTC(2026, 9, 1));
  const dec = Date.UTC(2026, 11, 1, 3);
  w.h.clock.t = dec;
  assert.equal(runBilling(w.h.db, w.cid, dec), 1);
  assert.equal(runBilling(w.h.db, w.cid, dec), 0, 'the month is billed once');
  assert.deepEqual(w.tx('payroll').map((t) => [t.amount, t.at]), [[-total, Date.UTC(2026, 11, 1)]]);
  const gone = staff[0]!;
  run(w.h.db, 'UPDATE staff SET ends_at = ? WHERE id = ?', Date.UTC(2026, 11, 10), gone.id);
  const jan = Date.UTC(2027, 0, 1, 3);
  runBilling(w.h.db, w.cid, jan);
  assert.deepEqual(w.tx('payroll').map((t) => t.amount), [-total, -(total - gone.salary)]);
  const fin = (await w.call('GET', '/api/v1/me/finance')).body as { upcoming: { kind: string; amount: number }[] };
  assert.ok(fin.upcoming.some((c) => c.kind === 'payroll' && c.amount === -(total - gone.salary)), 'the finance forecast shows the payroll as its own charge');
});

// ---------------------------------------------------------------- read models and leave

test('fatigue comes from the duty actually worked; the card alerts on the next flight the person could not fly, naming the rule; tired people are on the watch list', async () => {
  const w = await world({ crew: true });
  const p = get<{ id: number }>(w.h.db, "SELECT id FROM staff WHERE family = 'pilot' ORDER BY id LIMIT 1")!;
  const today = dayNo(w.h.clock.t);
  // six consecutive duty days of 7 h 40 (46 h in 7 days: the mockup's Camille Lefèvre) and 99 h flown in 28 days
  for (let i = 1; i <= 6; i++) {
    const dep = (today - i) * DAY_MS + 6 * 3_600_000;
    run(w.h.db, 'INSERT INTO staff_duty (staff_id, leg_id, day, flight_no, dep_at, arr_at, origin, dest, duty_start, duty_min, flight_min) VALUES (?, ?, ?, 1100, ?, ?, ?, ?, ?, 460, 990)', p.id, -i, today - i, dep, dep + 3_600_000, 'LFPG', 'LFPG', dep - 45 * 60_000);
  }
  const d = (await w.call('GET', `/api/v1/staff/${p.id}`)).body as StaffDetail;
  assert.equal(d.duty.fatigue, 55, 'the mockup\'s 46 h in 7 days and 6 duty days in a row');
  assert.equal(d.duty.flight28d, 99);
  assert.equal(d.last7d.filter((x) => x.kind === 'duty').length, 6);
  assert.ok(d.alert && d.alert.rule === 'streak' && d.alert.overBy === 1 && /^\w{3} \d+$/.test(d.alert.flightNo), 'six days in a row: the next flight would be a seventh');
  run(w.h.db, 'DELETE FROM staff_duty WHERE leg_id = -1');
  run(w.h.db, 'UPDATE staff_duty SET flight_min = 1000 WHERE leg_id = -2');
  const over = (await w.call('GET', `/api/v1/staff/${p.id}`)).body as StaffDetail;
  assert.ok(over.alert && over.alert.rule === 'flight28' && over.alert.overBy > 0, JSON.stringify(over.alert));
  const o = (await w.call('GET', '/api/v1/staff')).body as StaffOverview;
  assert.ok(o.watch.some((x) => x.staffId === p.id && x.reason === 'fatigue' && x.value === 55), JSON.stringify(o.watch));
});

test('a person is on duty until the release after the landing, resting until the rest policy\'s hours are over, then free', async () => {
  const w = await world({ crew: true });
  await w.advance(2 * DAY_MS);
  const last = get<{ staff_id: number; arr_at: number; dest: string }>(w.h.db, "SELECT staff_id, arr_at, dest FROM staff_duty d JOIN staff s ON s.id = d.staff_id WHERE s.family = 'pilot' ORDER BY arr_at DESC LIMIT 1")!;
  const s = get<StaffRow>(w.h.db, 'SELECT * FROM staff WHERE id = ?', last.staff_id)!;
  const rules = REST_POLICIES.standard;
  const state = (t: number) => stateOf(w.h.db, s, t, rules);
  const released = last.arr_at + 15 * 60_000;
  assert.equal(state(last.arr_at - 60_000), 'onDuty');
  assert.equal(state(released + 3_600_000), 'resting');
  const restH = last.dest === s.base ? rules.restBaseH : rules.restAwayH;
  assert.equal(state(released + restH * 3_600_000 - 60_000), 'resting');
  assert.equal(state(released + restH * 3_600_000 + 60_000), 'free');
});
test('the overview counts people, positions and payroll by family with pilots by type, and the watch list names tired people', async () => {
  const w = await world({ crew: true });
  await w.advance(3 * DAY_MS);
  const o = (await w.call('GET', '/api/v1/staff')).body as StaffOverview;
  assert.equal(o.people, get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM staff')!.n);
  assert.equal(o.payroll, get<{ s: number }>(w.h.db, "SELECT SUM(salary) AS s FROM staff WHERE contract = 'cdi'")!.s);
  assert.ok(o.positions >= o.families.reduce((n, f) => n + f.need, 0) - 1);
  const pilots = o.families.find((f) => f.family === 'pilot')!;
  assert.equal(pilots.children?.[0]?.type, 'AT76');
  assert.equal(pilots.children![0]!.headcount, pilots.headcount);
  const a = pilots.availability;
  assert.equal(a.onDuty + a.resting + a.leave + a.training + a.free, pilots.headcount, 'every pilot is in exactly one state');
  assert.deepEqual(o.families.map((f) => f.family).sort(), ['admin', 'cabin', 'ground', 'maintenance', 'pilot']);
  const cdg = (await w.call('GET', '/api/v1/staff?base=LFLL')).body as StaffOverview;
  assert.ok(cdg.people < o.people, 'filtered by base');
  assert.equal((await w.call('GET', '/api/v1/staff?base=lfpg')).status, 400);
});

test('a member card shows duty, hours, the weekly Gantt, the last seven days and the contract', async () => {
  const w = await world({ crew: true });
  await w.advance(2 * DAY_MS);
  const booked = get<{ staff_id: number }>(w.h.db, 'SELECT staff_id FROM staff_duty ORDER BY dep_at LIMIT 1')!;
  const d = (await w.call('GET', `/api/v1/staff/${booked.staff_id}`)).body as StaffDetail;
  assert.ok(d.week.length > 0 && d.week[0]!.flightNo.startsWith(get<{ code: string }>(w.h.db, 'SELECT code FROM companies WHERE id = ?', w.cid)!.code ?? ''));
  assert.equal(d.last7d.length, 7);
  assert.ok(d.last7d.some((x) => x.kind === 'duty' && x.hours! > 0));
  assert.ok(d.duty.flight28d > 0 && d.duty.flight12m >= d.duty.flight28d && d.duty.limitMin === 780 && d.duty.fatigue >= 0);
  assert.equal(d.contract.firingCost, d.member.salary * 3);
  assert.equal((await w.call('GET', '/api/v1/staff/abc')).status, 404);
  const other = await w.h.register('other', 'LFPG');
  assert.equal((await w.h.call('GET', `/api/v1/staff/${booked.staff_id}`, { token: other.token })).status, 404, "someone else's employee");
});

test('leave: requests with an impact preview, a decision checked against the balance, coverage by family and day, and the rest policy', async () => {
  const w = await world({ crew: true });
  const v = (await w.call('GET', '/api/v1/staff/leave')).body as LeaveView;
  assert.equal(v.policy, 'standard');
  assert.equal(v.coverage[0]!.days.length, 60);
  assert.ok(v.coverage.every((c) => c.days.every((x) => ['ok', 'tight', 'short', 'none'].includes(x))));
  assert.deepEqual(v.policies.map((p) => p.policy), ['legal', 'standard', 'generous']);
  assert.equal(v.policies[0]!.extraHeadcount, 0);
  assert.ok(v.policies[2]!.extraHeadcount >= v.policies[1]!.extraHeadcount && v.policies[2]!.riskFactor < v.policies[0]!.riskFactor);
  assert.ok(v.balance > 0);
  const pending = v.requests.filter((r) => r.status === 'pending');
  assert.ok(pending.length > 0, 'people ask for leave');
  assert.ok(pending.every((r) => r.impact && ['ok', 'tight', 'short', 'none'].includes(r.impact.after)));
  assert.deepEqual((await w.call('GET', '/api/v1/staff/leave')).body.requests, v.requests, 'the same requests every time');

  const req = pending[0]!;
  const done = await w.call('POST', `/api/v1/staff/leave/${req.id}`, { decision: 'grant' });
  assert.equal(done.status, 200, done.text);
  assert.equal((done.body as LeaveView).requests.find((r) => r.id === req.id)!.status, 'granted');
  assert.ok(done.body.balance < v.balance);
  assert.equal((await w.call('POST', `/api/v1/staff/leave/${req.id}`, { decision: 'refuse' })).body.error, 'already_decided');
  const refused = await w.call('POST', `/api/v1/staff/leave/${pending[1]!.id}`, { decision: 'refuse' });
  assert.equal(refused.body.requests.find((r: { id: number }) => r.id === pending[1]!.id).status, 'refused');
  assert.equal((await w.call('POST', '/api/v1/staff/leave/99999', { decision: 'grant' })).status, 404);
  assert.equal((await w.call('POST', `/api/v1/staff/leave/${req.id}`, { decision: 'maybe' })).status, 400);
  // a request that would take more than 25 days in the year is refused by the balance check
  const sid = get<{ staff_id: number }>(w.h.db, 'SELECT staff_id FROM staff_leave WHERE id = ?', req.id)!.staff_id;
  const d1 = dayNo(Date.UTC(2026, 11, 1));
  run(w.h.db, "INSERT INTO staff_leave (staff_id, from_day, to_day, status, kind) VALUES (?, ?, ?, 'granted', 'leave')", sid, d1, d1 + 21);
  const big = run(w.h.db, "INSERT INTO staff_leave (staff_id, from_day, to_day, status, kind) VALUES (?, ?, ?, 'pending', 'leave')", sid, d1 + 23, d1 + 27).id;
  assert.equal((await w.call('POST', `/api/v1/staff/leave/${big}`, { decision: 'grant' })).body.error, 'leave_balance');

  const pol = await w.call('PUT', '/api/v1/staff/rest-policy', { policy: 'generous' });
  assert.deepEqual(pol.body, { policy: 'generous' });
  assert.equal(((await w.call('GET', '/api/v1/staff/leave')).body as LeaveView).policy, 'generous');
  assert.equal((await w.call('PUT', '/api/v1/staff/rest-policy', { policy: 'lazy' })).status, 400);
});

test('a stricter rest policy asks for more rest between duty periods and so cancels more legs for the same crew', async () => {
  const easy = await world({ crew: true, freq: 4 }), hard = await world({ crew: true, freq: 4 });
  for (const w of [easy, hard]) run(w.h.db, 'DELETE FROM staff WHERE id IN (SELECT id FROM staff WHERE family = ? ORDER BY id DESC LIMIT 2)', 'pilot');
  await hard.call('PUT', '/api/v1/staff/rest-policy', { policy: 'generous' });
  await easy.call('PUT', '/api/v1/staff/rest-policy', { policy: 'legal' });
  await easy.advance(20 * DAY_MS); await hard.advance(20 * DAY_MS);
  const lost = (w: typeof easy) => w.legs().filter((l) => l.status === 'cancelled').length;
  assert.ok(lost(hard) >= lost(easy), `${lost(hard)} cancelled under generous rest, ${lost(easy)} under legal`);
  assert.equal(REST_POLICIES.legal.restBaseH, 12);
});

test('the staff routes need a signed-in player with a company and validate their input', async () => {
  const h = await harness();
  assert.equal((await h.call('GET', '/api/v1/staff')).status, 401);
  assert.equal((await h.call('POST', '/api/v1/staff/hire', { body: { candidateId: 'x' } })).status, 401);
  const u = await h.register('zed', 'LFPG');
  const t = { token: u.token };
  assert.equal((await h.call('POST', '/api/v1/staff/hire', { ...t, body: {} })).status, 400);
  assert.equal((await h.call('GET', '/api/v1/staff/candidates?family=pirate', t)).status, 400);
  assert.equal((await h.call('POST', '/api/v1/staff/interim', { ...t, body: { family: 'cabin', days: 99 } })).status, 400);
  assert.equal((await h.call('GET', '/api/v1/staff/leave?days=2', t)).status, 400);
  const empty = (await h.call('GET', '/api/v1/staff', t)).body as StaffOverview;
  assert.deepEqual([empty.people, empty.positions, empty.payroll], [0, 0, 0], 'a company without lines has no need and no payroll');
});
