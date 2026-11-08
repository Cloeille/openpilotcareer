import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driftMorale, moraleTarget, paidSalary } from '@opc/shared';
import { get, run, tx } from './db.ts';
import { runBilling } from './finance.ts';
import { harness } from './harness.ts';
import { post } from './ledger.ts';

const V1 = '/api/v1';
const first = (y: number, m: number): number => Date.UTC(y, m - 1, 1);

test('v4 monthly billing: the alliance dues and the HR pay level meet in the one billing_runs guard, in the forecast and in the ledger, once per month', async () => {
  const h = await harness();
  const u = await h.register('amy', 'LFPG');
  const cid = u.me.company.id as number;
  run(h.db, 'UPDATE companies SET balance = 500000000 WHERE id = ?', cid);
  const call = (method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) => h.call(method, `${V1}${url}`, { token: u.token, ...(body === undefined ? {} : { body }) });
  const ids = [3_000, 3_000].map((salary, i) => run(h.db,
    `INSERT INTO staff (company_id, family, name, role, base, hired_at, starts_at, salary, experience, reliability, morale, contract, birth_year) VALUES (?, 'cabin', ?, 'attendant', 'LFPG', 0, 0, ?, 5, 80, 90, 'cdi', 1990)`, cid, `P${i}`, salary).id);
  assert.equal((await call('POST', '/alliance', { name: 'Skyline Club' })).status, 201);
  assert.equal((await call('PUT', '/hr/policy', { payPct: 5 })).status, 200);
  post(h.db, cid, h.clock.t, 'line_revenue', 100_000, 'seed');
  h.clock.t += 2 * 86_400_000; // the pay level applies from the next UTC midnight
  run(h.db, 'UPDATE sessions SET expires_at = ?', Date.UTC(2030, 0, 1));

  const upcoming = ((await call('GET', '/me/finance')).body.upcoming as { at: number; kind: string; amount: number }[]).filter((c) => c.at === first(2026, 12));
  const forecast = (kind: string): number => upcoming.filter((c) => c.kind === kind).reduce((n, c) => n + c.amount, 0);
  assert.equal(forecast('payroll'), -2 * paidSalary(3_000, 5), 'the forecast pays the level');
  assert.equal(forecast('alliance_dues'), -2_000, 'and owes the dues');

  const rows = (kind: string): number[] => (h.db.prepare('SELECT amount FROM transactions WHERE company_id = ? AND kind = ? AND at = ?').all(cid, kind, first(2026, 12)) as { amount: number }[]).map((r) => r.amount);
  h.clock.t = Date.UTC(2026, 11, 3, 10);
  assert.equal(tx(h.db, () => runBilling(h.db, cid, h.clock.t)), 1);
  assert.deepEqual([rows('payroll'), rows('alliance_dues')], [[forecast('payroll')], [forecast('alliance_dues')]], 'the ledger posts what the forecast said');
  const morale = (id: number): number => get<{ morale: number }>(h.db, 'SELECT morale FROM staff WHERE id = ?', id)!.morale;
  const stepped = driftMorale(90, moraleTarget(5, 'standard'));
  assert.deepEqual(ids.map(morale), [stepped, stepped], 'morale stepped once, on the pay level of the month');

  for (let i = 0; i < 3; i++) assert.equal(tx(h.db, () => runBilling(h.db, cid, h.clock.t + i)), 0, 'a replay bills nothing');
  assert.deepEqual([rows('payroll').length, rows('alliance_dues').length, morale(ids[0]!)], [1, 1, stepped]);
});
