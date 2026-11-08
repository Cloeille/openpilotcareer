import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DAY_MS, MORALE_BASE, driftMorale, moraleTarget, paidSalary, type HrView, type PayLevel, type StaffOverview } from '@opc/shared';
import { all, get, MIGRATIONS, openDb, run, tx } from './db.ts';
import { runBilling } from './finance.ts';
import { harness } from './harness.ts';
import { payAt, setPay } from './hr.ts';

const V1 = '/api/v1';
const at = (y: number, m: number, d = 1, hh = 10): number => Date.UTC(y, m - 1, d, hh);
/** The 1st of a month at midnight: the instant billing dates its postings. */
const first = (y: number, m: number): number => Date.UTC(y, m - 1, 1);
type H = Awaited<ReturnType<typeof harness>>;
const warp = (h: H, t: number): void => { h.clock.t = t; run(h.db, 'UPDATE sessions SET expires_at = ?', t + 1_000_000_000); };

/** A player at LFPG whose company is billed from December on (November, the month of its creation, is never billed). `crew(n, morale)` puts n permanent staff on the payroll, hired long ago. */
async function world(name = 'amy') {
  const h = await harness();
  const u = await h.register(name, 'LFPG');
  const cid = u.me.company.id as number;
  run(h.db, 'UPDATE companies SET balance = 500000000 WHERE id = ?', cid);
  const call = (method: 'GET' | 'PUT' | 'POST', url: string, body?: unknown) => h.call(method, `${V1}${url}`, { token: u.token, ...(body === undefined ? {} : { body }) });
  const crew = (n: number, o: { morale?: number; salary?: number; contract?: 'cdi' | 'cdd'; family?: string } = {}): number[] => Array.from({ length: n }, (_, i) =>
    run(h.db, `INSERT INTO staff (company_id, family, name, role, base, hired_at, starts_at, salary, experience, reliability, morale, contract, birth_year) VALUES (?, ?, ?, 'attendant', 'LFPG', 0, 0, ?, 5, 80, ?, ?, 1990)`,
      cid, o.family ?? 'cabin', `P${i}`, o.salary ?? 3_000, o.morale ?? 80, o.contract ?? 'cdi').id);
  const bill = (t: number): number => { warp(h, t); return tx(h.db, () => runBilling(h.db, cid, t)); };
  const morale = (id: number): number => get<{ morale: number }>(h.db, 'SELECT morale FROM staff WHERE id = ?', id)!.morale;
  const ends = (id: number): number | null => get<{ ends_at: number | null }>(h.db, 'SELECT ends_at FROM staff WHERE id = ?', id)!.ends_at;
  const payroll = (month: number): number => get<{ s: number | null }>(h.db, "SELECT SUM(amount) AS s FROM transactions WHERE company_id = ? AND kind = 'payroll' AND at = ?", cid, month)?.s ?? 0;
  const view = async () => (await call('GET', '/hr')).body as HrView;
  return { h, u, cid, call, crew, bill, morale, ends, payroll, view };
}

// ---------------------------------------------------------------- migration

test('the migration adds the pay history, which follows its company, takes the five levels and nothing else, and lives once per company and instant', () => {
  const idx = MIGRATIONS.findIndex((m) => m.includes('CREATE TABLE hr_policy'));
  assert.ok(idx > 0, 'found by content, not by position');
  const file = join(mkdtempSync(join(tmpdir(), 'opc-hr-')), 'prev.sqlite');
  const raw = new DatabaseSync(file);
  for (let i = 0; i < idx; i++) raw.exec(MIGRATIONS[i]!);
  raw.exec(`PRAGMA user_version = ${idx}`);
  raw.exec("INSERT INTO users (id, username, pass_hash, created_at) VALUES (1, 'a', 'h', 1); INSERT INTO companies (id, user_id, name, balance, reputation, created_at) VALUES (1, 1, 'A Air', 1, 50, 1);");
  raw.close();
  const db = openDb(file);
  assert.equal(get<{ user_version: number }>(db, 'PRAGMA user_version')!.user_version, MIGRATIONS.length);
  assert.equal(payAt(db, 1), 0, 'no row is market pay: an upgraded company pays what it paid');
  run(db, 'INSERT INTO hr_policy (company_id, pay_pct, since) VALUES (1, -10, 5)');
  run(db, 'INSERT INTO hr_policy (company_id, pay_pct, since) VALUES (1, 10, 9)');
  assert.throws(() => run(db, 'INSERT INTO hr_policy (company_id, pay_pct, since) VALUES (1, 11, 20)'), /CHECK/);
  assert.throws(() => run(db, 'INSERT INTO hr_policy (company_id, pay_pct, since) VALUES (1, 5, 5)'), /UNIQUE|PRIMARY/);
  assert.deepEqual([payAt(db, 1, 4), payAt(db, 1, 5), payAt(db, 1, 8), payAt(db, 1, 9), payAt(db, 1)], [0, -10, -10, 10, 10], 'the level at an instant is the latest row in force then');
  run(db, 'DELETE FROM companies WHERE id = 1');
  assert.equal(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM hr_policy')!.n, 0);
});

// ---------------------------------------------------------------- the payroll (C31: on the 1st, through the one payroll code)

test('the pay level moves the real payroll of the 1st: the ledger line, the projection and the staff overview all agree, and the contract salaries are untouched', async () => {
  const w = await world();
  w.crew(4, { salary: 3_000 }); w.crew(2, { salary: 8_300, family: 'pilot' });
  const grid = 4 * 3_000 + 2 * 8_300;
  assert.equal((await w.view()).payroll, grid, 'market pay: the grid');
  assert.equal((await w.call('PUT', '/hr/policy', { payPct: 5 })).status, 200);
  const v = await w.view();
  assert.deepEqual({ cur: v.pay.current, next: v.pay.next, payroll: v.payroll }, { cur: 0, next: 5, payroll: 4 * paidSalary(3_000, 5) + 2 * paidSalary(8_300, 5) });
  const projected = ((await w.call('GET', '/me/finance')).body.upcoming as { at: number; kind: string; amount: number }[]).find((c) => c.kind === 'payroll' && c.at === first(2026, 12))!;
  assert.equal(-projected.amount, v.payroll, 'the forecast is the number the 1st will charge');
  assert.equal(((await w.call('GET', '/staff')).body as StaffOverview).payroll, grid, 'the staff overview is the pay in force: the grid until the change applies');
  warp(w.h, at(2026, 11, 5, 0));
  assert.equal(((await w.call('GET', '/staff')).body as StaffOverview).payroll, v.payroll, 'and the paid one from the next UTC day');
  assert.equal(w.bill(at(2026, 12, 1)), 1);
  assert.equal(-w.payroll(first(2026, 12)), v.payroll, 'December paid at +5 %');
  assert.deepEqual(all<{ salary: number }>(w.h.db, 'SELECT DISTINCT salary FROM staff ORDER BY salary').map((r) => r.salary), [3_000, 8_300], 'the grid on the contracts is never rewritten');
  await w.call('PUT', '/hr/policy', { payPct: -10 });
  w.bill(at(2027, 1, 1));
  assert.equal(-w.payroll(first(2027, 1)), 4 * paidSalary(3_000, -10) + 2 * paidSalary(8_300, -10), 'January paid at -10 %');
});

test('a change applies from the next UTC day, like the service policy: the billing of the day it is made still pays the old level', async () => {
  const w = await world();
  w.crew(3, { salary: 4_000 });
  warp(w.h, at(2026, 12, 1, 9));
  assert.equal((await w.call('PUT', '/hr/policy', { payPct: 10 })).status, 200, 'December is billed by this very request, then the change is recorded');
  assert.equal(-w.payroll(first(2026, 12)), 12_000, 'December keeps the old level: the change made on the 1st applies on the 2nd');
  const v = await w.view();
  assert.deepEqual({ cur: v.pay.current, next: v.pay.next, applyFrom: v.applyFrom }, { cur: 0, next: 10, applyFrom: at(2026, 12, 2, 0) });
  assert.equal(v.payroll, 3 * 4_400, 'the preview is the next billing');
  warp(w.h, at(2026, 12, 2, 0)); assert.equal((await w.view()).pay.current, 10, 'in force from the stroke of midnight');
  w.bill(at(2027, 1, 1)); assert.equal(-w.payroll(first(2027, 1)), 13_200);
  await w.call('PUT', '/hr/policy', { payPct: -5 }); await w.call('PUT', '/hr/policy', { payPct: 0 });
  assert.equal(get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM hr_policy WHERE company_id = ?', w.cid)!.n, 2, 'two changes the same day are one row, the last wins');
  assert.equal((await w.view()).pay.next, 0);
});

test('a billing month is paid at the level of its own time, not today\'s: a catch-up of three months at once equals three months billed one by one', async () => {
  const stepwise = await world(), catchUp = await world();
  for (const w of [stepwise, catchUp]) w.crew(2, { salary: 5_000 });
  stepwise.bill(at(2026, 12, 5));
  for (const w of [stepwise, catchUp]) tx(w.h.db, () => setPay(w.h.db, w.cid, 5, at(2026, 12, 20)));
  stepwise.bill(at(2027, 1, 5)); stepwise.bill(at(2027, 2, 5));
  assert.equal(catchUp.bill(at(2027, 2, 5)), 3, 'December, January and February in one run');
  const months = [first(2026, 12), first(2027, 1), first(2027, 2)];
  assert.deepEqual(months.map((m) => -stepwise.payroll(m)), [10_000, 10_500, 10_500], 'December before the change, January and February after');
  assert.deepEqual(months.map((m) => -catchUp.payroll(m)), [10_000, 10_500, 10_500]);
});

// ---------------------------------------------------------------- morale: drift (C30)

test('each billing month moves morale a quarter of the way to the target, once: the same request twice, or the same month replayed, changes nothing more', async () => {
  const w = await world();
  const [a, b] = w.crew(2, { morale: 90 });
  const target = moraleTarget(0, 'standard');
  assert.equal(target, MORALE_BASE);
  w.bill(at(2026, 12, 3));
  const dec = driftMorale(90, target);
  assert.deepEqual([w.morale(a!), w.morale(b!)], [dec, dec]);
  for (let i = 0; i < 3; i++) assert.equal(w.bill(at(2026, 12, 20 + i)), 0, 'billing says nothing is due');
  assert.equal((await w.call('GET', '/hr')).status, 200); await w.call('GET', '/hr');
  assert.equal(w.morale(a!), dec, 'December is stepped once whatever the number of requests');
  w.bill(at(2027, 1, 2));
  assert.equal(w.morale(a!), driftMorale(dec, target));
  run(w.h.db, 'DELETE FROM billing_runs WHERE company_id = ? AND month = ?', w.cid, '2027-01');
  assert.equal(tx(w.h.db, () => runBilling(w.h.db, w.cid, w.h.clock.t)), 1, 'only the billing_runs row stands between a month and a second step: that is the guard');
});

test('two worlds with the same history have the same morale and the same leavers to the day, and a catch-up of five months equals five months billed one at a time', async () => {
  const run3 = async (stepwise: boolean) => {
    const w = await world();
    const ids = w.crew(60, { morale: 62 });
    await w.call('PUT', '/hr/policy', { payPct: -10 });
    if (stepwise) for (const m of [12, 1, 2, 3, 4]) w.bill(at(m === 12 ? 2026 : 2027, m, 9));
    else w.bill(at(2027, 4, 9));
    return ids.map((id) => [w.morale(id), w.ends(id)]);
  };
  const a = await run3(true), b = await run3(true), c = await run3(false);
  assert.deepEqual(b, a, 'a second world gives the same morale and the same departures');
  assert.deepEqual(c, a, 'and so does one request that bills the five months at once');
  const left = a.filter((r) => r[1] !== null).length;
  assert.ok(left > 0 && left < 60, `some leave and not everybody does: ${left} of 60`);
  const stayers = a.filter((r) => r[1] === null).map((r) => r[0]);
  assert.ok(stayers.length > 0 && stayers.every((m) => m === stayers[0]), 'those who stayed were stepped the same five months');
});

test('the target is the pay level and the rest policy: a company that never opens the screen sits at 60, a rest policy moves it, a hire arrives with their own morale', async () => {
  const w = await world();
  assert.deepEqual([(await w.view()).morale.target, (await w.view()).rest], [60, 'standard']);
  await w.call('PUT', '/staff/rest-policy', { policy: 'generous' });
  assert.equal((await w.view()).morale.target, moraleTarget(0, 'generous'));
  await w.call('PUT', '/staff/rest-policy', { policy: 'legal' });
  await w.call('PUT', '/hr/policy', { payPct: -10 });
  const v = await w.view();
  assert.equal(v.morale.target, moraleTarget(-10, 'legal'));
  assert.deepEqual(v.options.map((o) => [o.payPct, o.leaves]), [[-10, true], [-5, true], [0, false], [5, false], [10, false]].map(([p, l]) => [p, l]), 'at market pay even the legal minimum leaves nobody under the line');
  const ids = w.crew(3, { morale: 30, contract: 'cdd' });
  w.bill(at(2026, 12, 2));
  assert.deepEqual(ids.map((id) => w.morale(id)), [30, 30, 30], 'a temporary contract is outside HR');
});

// ---------------------------------------------------------------- the one effect: leaving

test('market pay loses nobody in a year, whatever the morale they were hired at above the line; below the line, and only then, people give notice, once, for good', async () => {
  const calm = await world();
  const stay = calm.crew(80, { morale: 52 });
  for (let i = 0; i < 12; i++) calm.bill(at(2026 + Math.floor((11 + i) / 12), ((11 + i) % 12) + 1, 5));
  assert.equal(stay.filter((id) => calm.ends(id) !== null).length, 0, 'at 60 nobody who started at 52 is ever under 50');
  assert.ok(stay.every((id) => calm.morale(id) > 52 && calm.morale(id) <= 60));

  const w = await world();
  const ids = w.crew(80, { morale: 40 });
  assert.equal((await w.view()).rule.atRisk, 80);
  w.bill(at(2026, 12, 5));
  const gone = ids.filter((id) => w.ends(id) !== null);
  assert.ok(gone.length > 0 && gone.length < 80, `a few of the 80 in the low band give notice: ${gone.length}`);
  for (const id of gone) assert.equal(w.ends(id), first(2026, 12) + 7 * DAY_MS, 'the notice is the 1st plus their notice period (7 days)');
  assert.equal(all(w.h.db, "SELECT 1 FROM transactions WHERE company_id = ? AND kind = 'severance'", w.cid).length, 0, 'a person who quits is owed no severance');
  assert.equal(-w.payroll(first(2026, 12)), 80 * 3_000, 'the month they gave notice in is paid in full');
  const snapshot = new Map(gone.map((id) => [id, w.ends(id)]));
  w.bill(at(2027, 1, 5));
  assert.equal(-w.payroll(first(2027, 1)), (80 - gone.length) * 3_000, 'January pays only the ones still there');
  for (const [id, e] of snapshot) assert.equal(w.ends(id), e, 'notice is given once: the date never moves again');
  const v = await w.view(), onNotice = all(w.h.db, 'SELECT 1 FROM staff WHERE ends_at > ?', w.h.clock.t).length;
  assert.ok(gone.every((id) => w.ends(id)! < w.h.clock.t), 'December\'s leavers are gone by January');
  assert.deepEqual([v.leaving, v.people], [onNotice, 80 - gone.length - onNotice - all(w.h.db, 'SELECT 1 FROM staff WHERE ends_at <= ? AND ends_at > ?', w.h.clock.t, at(2026, 12, 20)).length], 'the view counts who is still here, who is on notice, and nobody who left');
});

test('who leaves is a seeded roll of the person and the month, not of the clock: the same ids leave in two worlds, a later request time changes nothing', async () => {
  const roll = async (hour: number) => {
    const w = await world();
    w.crew(120, { morale: 20 });
    w.bill(at(2026, 12, 9, hour));
    return all<{ id: number }>(w.h.db, 'SELECT id FROM staff WHERE ends_at IS NOT NULL ORDER BY id').map((r) => r.id).join();
  };
  const early = await roll(0), late = await roll(23);
  assert.equal(early, late);
  assert.ok(early.length > 0);
});

// ---------------------------------------------------------------- the view

test('the view says who is where: per family morale, who is at risk, who is on notice, and what each level would charge and do', async () => {
  const w = await world();
  w.crew(2, { morale: 40, family: 'cabin' }); w.crew(2, { morale: 80, family: 'pilot', salary: 8_000 });
  const gone = w.crew(1, { morale: 70, family: 'ground' })[0]!;
  run(w.h.db, 'UPDATE staff SET ends_at = ? WHERE id = ?', w.h.clock.t + 3 * DAY_MS, gone);
  const v = await w.view();
  assert.equal(v.people, 4); assert.equal(v.leaving, 1);
  assert.equal(v.morale.average, 60);
  assert.deepEqual(v.morale.families, [{ family: 'pilot', people: 2, morale: 80 }, { family: 'cabin', people: 2, morale: 40 }]);
  assert.equal(v.rule.atRisk, 2);
  assert.deepEqual(v.options.map((o) => o.payPct), [-10, -5, 0, 5, 10] satisfies PayLevel[]);
  assert.equal(v.options.find((o) => o.payPct === 0)!.payrollDelta, 0);
  assert.equal(v.options.find((o) => o.payPct === 10)!.payrollDelta, 2 * paidSalary(3_000, 10) + 2 * paidSalary(8_000, 10) - 2 * 3_000 - 2 * 8_000 + 0, 'the preview is the difference the real payroll would show');
  assert.equal((await w.call('GET', '/hr')).status, 200);
  assert.equal(get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM hr_policy')!.n, 0, 'reading writes nothing');
});

// ---------------------------------------------------------------- auth

test('the HR routes need a signed-in player and are scoped to her company: nobody else sees or sets her pay, other companies 403, an API key 401, no axis but pay', async () => {
  const w = await world();
  w.crew(2);
  for (const [m, url, body] of [['GET', '/hr'], ['PUT', '/hr/policy', { payPct: 5 }]] as const) assert.equal((await w.h.call(m, `${V1}${url}`, body ? { body } : {})).status, 401, `${m} ${url} signed out`);
  const key = await w.h.apiKey(w.u.token);
  for (const [m, url, body] of [['GET', '/hr'], ['PUT', '/hr/policy', { payPct: 5 }]] as const) assert.equal((await w.h.call(m, `${V1}${url}`, { token: key, ...(body ? { body } : {}) })).status, 401, `${m} ${url} with an API key`);
  const bob = await w.h.register('bob', 'LFMN');
  assert.equal((await w.h.call('GET', `${V1}/hr`, { token: bob.token, company: w.cid })).status, 403, 'her company through his session');
  assert.equal((await w.h.call('PUT', `${V1}/hr/policy`, { token: bob.token, company: w.cid, body: { payPct: 10 } })).status, 403);
  assert.equal((await w.h.call('PUT', `${V1}/hr/policy`, { token: bob.token, body: { payPct: -10 } })).status, 200, 'his own company is his to set');
  assert.equal((await w.view()).pay.next, 0, 'and hers did not move');
  assert.equal(get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM hr_policy WHERE company_id = ?', w.cid)!.n, 0);
  for (const bad of [{ payPct: 7 }, { payPct: '5' }, { payPct: 2.5 }, { payPct: 50 }, {}, { payPct: 5, law: 'illegal' }, { law: 'illegal' }, { style: 'warm' }]) {
    assert.equal((await w.call('PUT', '/hr/policy', bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await w.view()).pay.next, 0, 'a refused body changes nothing: no compliance axis exists to set (C27)');
});
