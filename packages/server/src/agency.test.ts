import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGENCY_NOTICE_DAYS, AGENCY_SEARCH_DAYS, DAY_MS, OVERDRAFT_LIMIT, START_NOW_FEE, type AgencyView, type LineProblemView, type MissionView, type SignResult } from '@opc/shared';
import { all, get, MIGRATIONS, openDb, run } from './db.ts';
import { insertAircraft } from './fleet-extras.ts';
import { harness } from './harness.ts';
import { crewShortage } from './staff.ts';

const HOUR = 3_600_000;
const V1 = '/api/v1';
const body = (over: Record<string, unknown> = {}) => ({ a: 'LFPG', b: 'LFLL', freqPerDay: 3, days: Array(7).fill(true), windowStart: '06:00', windowEnd: '18:00', aircraftIds: [] as number[], ...over });

/** A player at LFPG with one AT76 (2 pilots and 2 cabin crew needed) and a line, nobody employed: the line is interrupted for crew. */
async function world() {
  const h = await harness();
  const u = await h.register('amy', 'LFPG');
  const cid = u.me.company.id as number;
  const ac = insertAircraft(h.db, { companyId: cid, icao: 'AT76', hub: 'LFPG', value: 1_000_000, ownership: 'owned', at: h.clock.t });
  run(h.db, 'UPDATE companies SET balance = 5000000 WHERE id = ?', cid);
  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, b?: unknown) => h.call(method, `${V1}${url}`, { token: u.token, ...(b === undefined ? {} : { body: b }) });
  const made = await call('POST', '/lines', body({ aircraftIds: [ac] }));
  assert.equal(made.status, 201, made.text);
  const lineId = made.body.id as number;
  const advance = async (ms: number) => { h.clock.t += ms; await call('GET', '/network'); };
  const balance = () => get<{ balance: number }>(h.db, 'SELECT balance FROM companies WHERE id = ?', cid)!.balance;
  const tx = (kind: string) => all<{ amount: number; memo: string; at: number }>(h.db, 'SELECT amount, memo, at FROM transactions WHERE company_id = ? AND kind = ? ORDER BY id', cid, kind);
  const staff = () => all<{ id: number; family: string; candidate_id: string | null; starts_at: number; hired_at: number; notice_days: number; salary: number; contract: string }>(h.db, 'SELECT * FROM staff WHERE company_id = ? ORDER BY id', cid);
  const view = async (q = '') => (await call('GET', `/agency/options${q}`)).body as AgencyView;
  const open = (b: Record<string, unknown> = { base: 'LFPG', qual: 'AT76', count: 2 }) => call('POST', '/agency/missions', b);
  await advance(2 * HOUR);
  return { h, u, cid, call, advance, balance, tx, staff, view, open, lineId, ac };
}

test('the options price the position that lacks pilots, against the stopped line\'s revenue a day (the figure of the problem screen)', async () => {
  const w = await world();
  const v = await w.view();
  assert.deepEqual(v.gaps.map((g) => [g.base, g.qual, g.open, g.lines.length]), [['LFPG', 'AT76', 2, 1]]);
  const problem = (await w.call('GET', `/lines/${w.lineId}/problem`)).body as LineProblemView;
  assert.ok(problem.cost.perDay > 0);
  assert.equal(v.perDay, problem.cost.perDay, 'one daily figure: the stoppage cost of the line');
  assert.deepEqual(v.request, { base: 'LFPG', qual: 'AT76', count: 2 }, 'no query: the position that costs the most');
  assert.deepEqual(v.options.map((o) => o.id), ['agency', 'train', 'classic']);
  for (const o of v.options) assert.equal(o.total, o.fees + o.stopped, o.id);
  const [agency, train, classic] = v.options;
  assert.equal(agency!.stopped, (AGENCY_SEARCH_DAYS + AGENCY_NOTICE_DAYS) * v.perDay);
  assert.equal(agency!.resumeAt, w.h.clock.t + (AGENCY_SEARCH_DAYS + AGENCY_NOTICE_DAYS) * DAY_MS);
  assert.equal(train!.available, false, 'nobody is employed, so nobody can be trained');
  assert.equal(classic!.available, true);
  assert.equal(v.mission, null);
  const asked = await w.view('?base=LFPG&qual=AT76&count=1');
  assert.deepEqual(asked.request, { base: 'LFPG', qual: 'AT76', count: 1 });
  assert.ok(asked.options[0]!.fees < v.options[0]!.fees, 'one person costs less than two');
  assert.equal(w.balance(), 5_000_000, 'looking pays nothing');
});

test('a position the lines do not lack has no options; one the company cannot employ is refused', async () => {
  const w = await world();
  assert.equal((await w.call('GET', '/agency/options?base=LFPG&qual=AT76&count=2')).status, 200);
  assert.equal((await w.call('GET', '/agency/options?base=EGLL&qual=AT76&count=2')).body.error, 'not_a_base');
  assert.equal((await w.call('GET', '/agency/options?base=LFPG&qual=B738&count=2')).body.error, 'not_a_fleet_type');
  assert.equal((await w.call('GET', '/agency/options?base=LFPG')).status, 400, 'base, type and count go together');
  assert.equal((await w.call('GET', '/agency/options?base=LFPG&qual=AT76&count=9')).status, 400);
  const empty = await harness();
  const u = await empty.register('bob', 'LFPG');
  const r = (await empty.call('GET', `${V1}/agency/options`, { token: u.token })).body as AgencyView;
  assert.deepEqual([r.gaps, r.request, r.options, r.mission], [[], null, [], null], 'a company with no short line has nothing to compare');
});

test('a mission costs nothing until the signature, hides its shortlist until it is ready, and one position has one open mission', async () => {
  const w = await world();
  const before = w.balance();
  const r = await w.open();
  assert.equal(r.status, 201, r.text);
  const m = r.body as MissionView;
  assert.deepEqual([m.base, m.qual, m.count, m.ready, m.shortlist, m.quote, m.readyAt - m.startedAt], ['LFPG', 'AT76', 2, false, null, null, AGENCY_SEARCH_DAYS * DAY_MS]);
  assert.equal(w.balance(), before, 'opening a mission pays nothing');
  assert.equal(w.tx('agency_fee').length, 0);
  assert.equal((await w.open()).body.error, 'mission_open');
  assert.equal((await w.open()).status, 409);
  assert.equal((await w.open({ base: 'LFPG', qual: 'AT76', count: 1 })).status, 409, 'whatever the count');

  const early = await w.call('POST', `/agency/missions/${m.id}/sign`, { candidateIds: ['x'] });
  assert.deepEqual([early.status, early.body.error], [409, 'mission_not_ready']);
  assert.equal(w.staff().length, 0);
  const v = await w.view();
  assert.equal(v.mission!.id, m.id, 'the open mission is the one the screen shows');
  assert.equal(v.mission!.shortlist, null);
  assert.equal(v.options[0]!.stopped, (AGENCY_SEARCH_DAYS + AGENCY_NOTICE_DAYS) * v.perDay, 'at the start the whole search is still to come');
  await w.advance(DAY_MS);
  assert.equal((await w.view()).options[0]!.stopped, (1 + AGENCY_NOTICE_DAYS) * v.perDay, 'a day into the search, a day less of stoppage to pay for');
});

test('signing hires the shortlist as normal staff: commission through the ledger, the usual notice and starts_at, pilots rated from the day they start, and the gap closes', async () => {
  const w = await world();
  const m = (await w.open()).body as MissionView;
  const t0 = w.h.clock.t;
  await w.advance(AGENCY_SEARCH_DAYS * DAY_MS);
  const v = await w.view();
  const list = v.mission!.shortlist!;
  assert.equal(list.length, 3, 'two asked, one more to choose from');
  assert.ok(list.every((c) => c.qual === 'AT76' && c.base === 'LFPG' && c.askingSalary > c.grid && c.id.startsWith('a')), 'rated, at the base, paid above the grid, with ids the market cannot mistake for its own');
  assert.deepEqual(v.mission!.quote!.picked, [list[0]!.id, list[1]!.id], 'the first two unless the caller picks');
  const pick = await w.view(`?pick=${list[2]!.id},${list[0]!.id}`);
  assert.deepEqual(pick.mission!.quote!.picked.sort(), [list[0]!.id, list[2]!.id].sort());
  assert.equal(pick.mission!.quote!.commission, list[0]!.premium + list[2]!.premium);

  const commission = list[0]!.premium + list[2]!.premium;
  const before = w.balance();
  const signed = await w.call('POST', `/agency/missions/${m.id}/sign`, { candidateIds: [list[0]!.id, list[2]!.id] });
  assert.equal(signed.status, 201, signed.text);
  const s = signed.body as SignResult;
  assert.equal(s.commission, commission);
  assert.equal(before - w.balance(), commission, 'the commission is exactly what the quote said');
  assert.equal(s.balanceAfter, w.balance());
  assert.deepEqual(w.tx('agency_fee').map((x) => -x.amount).sort(), [list[0]!.premium, list[2]!.premium].sort(), 'one ledger row per person, kind agency_fee');
  assert.equal(w.tx('hire_premium').length, 0, 'the market\'s premium is not charged on top');
  assert.equal(s.surchargeMonthly, list[0]!.askingSalary - list[0]!.grid + list[2]!.askingSalary - list[2]!.grid);

  const people = w.staff();
  assert.equal(people.length, 2);
  for (const p of people) assert.deepEqual([p.family, p.contract, p.hired_at, p.starts_at, p.notice_days], ['pilot', 'cdi', w.h.clock.t, w.h.clock.t + AGENCY_NOTICE_DAYS * DAY_MS, AGENCY_NOTICE_DAYS], 'a normal hire in notice');
  assert.deepEqual(people.map((p) => p.salary).sort(), [list[0]!.askingSalary, list[2]!.askingSalary].sort(), 'on the payroll at the agency\'s price');
  const quals = all<{ staff_id: number; type_icao: string; valid_from: number }>(w.h.db, 'SELECT * FROM staff_quals ORDER BY staff_id');
  assert.deepEqual(quals.map((q) => [q.type_icao, q.valid_from]), people.map((p) => ['AT76', p.starts_at]));
  assert.ok(s.members.every((x) => x.state === 'pending' && x.quals.includes('AT76')));

  const after = await w.view();
  assert.deepEqual(after.gaps, [], 'hires in notice fill the positions: the gap is closed, nobody is paid for twice');
  assert.equal(after.mission, null, 'the mission is over');
  assert.equal(get<{ status: string; commission: number }>(w.h.db, 'SELECT status, commission FROM recruit_missions WHERE id = ?', m.id)!.status, 'signed');
  assert.equal(get<{ commission: number }>(w.h.db, 'SELECT commission FROM recruit_missions WHERE id = ?', m.id)!.commission, commission);

  assert.ok(crewShortage(w.h.db, w.cid, ['AT76'], ['LFPG', 'LFLL'], t0 + AGENCY_SEARCH_DAYS * DAY_MS).some((x) => x.family === 'pilot'), 'in notice they do not count yet');
  await w.advance(AGENCY_NOTICE_DAYS * DAY_MS);
  assert.deepEqual(crewShortage(w.h.db, w.cid, ['AT76'], ['LFPG', 'LFLL'], w.h.clock.t).filter((x) => x.family === 'pilot'), [], 'the notice is over: the crew check counts them');
});

test('the people signed use the existing start-now and cancellation rules like any hire in notice', async () => {
  const w = await world();
  const m = (await w.open({ base: 'LFPG', qual: 'AT76', count: 1 })).body as MissionView;
  await w.advance(AGENCY_SEARCH_DAYS * DAY_MS);
  const c = (await w.view()).mission!.shortlist![0]!;
  const s = (await w.call('POST', `/agency/missions/${m.id}/sign`, { candidateIds: [c.id] })).body as SignResult;
  const id = s.members[0]!.id;
  const before = w.balance();
  const now = await w.call('POST', `/staff/${id}/start-now`);
  assert.equal(now.status, 200, now.text);
  assert.equal(before - w.balance(), START_NOW_FEE, 'START_NOW_FEE through the same route');
  assert.equal(get<{ starts_at: number }>(w.h.db, 'SELECT starts_at FROM staff WHERE id = ?', id)!.starts_at, w.h.clock.t);
  assert.equal(get<{ valid_from: number }>(w.h.db, 'SELECT valid_from FROM staff_quals WHERE staff_id = ?', id)!.valid_from, w.h.clock.t, 'the type rating starts with him');
});

test('refusals: a payment the balance cannot cover rolls the whole signature back; a candidate that is not on the list, too many, unknown or closed missions change nothing', async () => {
  const w = await world();
  const m = (await w.open()).body as MissionView;
  await w.advance(AGENCY_SEARCH_DAYS * DAY_MS);
  const list = (await w.view()).mission!.shortlist!;
  const sign = (ids: string[]) => w.call('POST', `/agency/missions/${m.id}/sign`, { candidateIds: ids });
  const untouched = () => assert.deepEqual([w.staff().length, w.tx('agency_fee').length, get<{ status: string }>(w.h.db, 'SELECT status FROM recruit_missions WHERE id = ?', m.id)!.status], [0, 0, 'searching']);

  const poorBalance = list[0]!.premium + 1 - OVERDRAFT_LIMIT; // spendable (balance + overdraft): the first is payable, the second is not
  run(w.h.db, 'UPDATE companies SET balance = ? WHERE id = ?', poorBalance, w.cid);
  const poor = await sign([list[0]!.id, list[1]!.id]);
  assert.deepEqual([poor.status, poor.body.error], [409, 'insufficient_funds']);
  assert.equal(w.balance(), poorBalance, 'not a cent left the account');
  untouched();

  run(w.h.db, 'UPDATE companies SET balance = 5000000 WHERE id = ?', w.cid);
  assert.deepEqual([(await sign([list[0]!.id, 'a1.LFPG.AT76.99'])).status], [404], 'an id the agency did not propose');
  assert.equal((await sign(['1.LFPG.pilot.AT76.0'])).status, 404, 'a market candidate is not an agency candidate');
  assert.deepEqual([(await sign(list.map((c) => c.id))).body.error], ['too_many_candidates'], 'three for a mission of two');
  assert.equal((await sign([])).status, 400);
  assert.equal((await sign([list[0]!.id, list[0]!.id])).status, 400, 'the same person twice');
  untouched();
  assert.equal(w.balance(), 5_000_000);
  assert.equal((await w.call('POST', '/agency/missions/999/sign', { candidateIds: [list[0]!.id] })).body.error, 'mission_not_found');
  assert.equal((await w.call('POST', '/agency/missions/abc/sign', { candidateIds: [list[0]!.id] })).status, 404);

  assert.equal((await sign([list[0]!.id])).status, 201, 'fewer than asked is allowed');
  assert.deepEqual([(await sign([list[1]!.id])).body.error], ['mission_closed'], 'signed once: closed');
  assert.equal((await w.call('DELETE', `/agency/missions/${m.id}`)).body.error, 'mission_closed');
  assert.equal(w.staff().length, 1);
  assert.equal(w.tx('agency_fee').length, 1);
});

test('a cancelled mission owes nothing and frees the position; a new mission never offers the people already signed', async () => {
  const w = await world();
  const first = (await w.open()).body as MissionView;
  const before = w.balance();
  assert.equal((await w.call('DELETE', `/agency/missions/${first.id}`)).status, 204);
  assert.equal(w.balance(), before);
  assert.equal((await w.call('POST', `/agency/missions/${first.id}/sign`, { candidateIds: ['x'] })).body.error, 'mission_closed');
  const second = (await w.open({ base: 'LFPG', qual: 'AT76', count: 1 })).body as MissionView;
  await w.advance(AGENCY_SEARCH_DAYS * DAY_MS);
  const list = (await w.view()).mission!.shortlist!;
  const signed = (await w.call('POST', `/agency/missions/${second.id}/sign`, { candidateIds: [list[0]!.id] })).body as SignResult;
  const third = (await w.open({ base: 'LFPG', qual: 'AT76', count: 1 })).body as MissionView;
  assert.equal(signed.members.length, 1);
  await w.advance(AGENCY_SEARCH_DAYS * DAY_MS);
  const next = (await w.view()).mission!.shortlist!.map((c) => c.id);
  assert.equal(third.base, 'LFPG');
  assert.ok(!next.includes(list[0]!.id), 'the person signed is not on the next shortlist');
  assert.equal(next.length, 2);
});

test('auth: no session is 401, an API key is 401 on every management route, another player sees a 404, a company that is not yours is a 403, and a second company of the same player has its own missions', async () => {
  const w = await world();
  const m = (await w.open()).body as MissionView;
  await w.advance(AGENCY_SEARCH_DAYS * DAY_MS);
  const list = (await w.view()).mission!.shortlist!;
  const key = await w.h.apiKey(w.u.token);
  const routes: [Parameters<typeof w.h.call>[0], string, unknown?][] = [
    ['GET', '/agency/options'], ['POST', '/agency/missions', { base: 'LFPG', qual: 'AT76', count: 1 }], ['POST', `/agency/missions/${m.id}/sign`, { candidateIds: [list[0]!.id] }], ['DELETE', `/agency/missions/${m.id}`],
  ];
  for (const [method, url, b] of routes) {
    assert.equal((await w.h.call(method, `${V1}${url}`, { ...(b === undefined ? {} : { body: b }) })).status, 401, `${method} ${url} without a session`);
    assert.equal((await w.h.call(method, `${V1}${url}`, { token: key, ...(b === undefined ? {} : { body: b }) })).status, 401, `${method} ${url} with an API key`);
  }
  const other = await w.h.register('eve', 'LFPG');
  for (const [method, url, b] of routes.slice(2)) {
    const r = await w.h.call(method, `${V1}${url}`, { token: other.token, ...(b === undefined ? {} : { body: b }) });
    assert.equal(r.status, 404, `${method} ${url}: another player's mission does not exist`);
    assert.equal(r.body.error, 'mission_not_found');
  }
  const stolen = await w.h.call('GET', `${V1}/agency/options`, { token: other.token, company: w.cid });
  assert.equal(stolen.status, 403, "someone else's company in the header");
  assert.equal((await w.h.call('POST', `${V1}/agency/missions`, { token: other.token, company: w.cid, body: { base: 'LFPG', qual: 'AT76', count: 1 } })).status, 403);
  assert.equal(get(w.h.db, "SELECT 1 AS x FROM recruit_missions WHERE company_id != ?", w.cid), undefined);

  const second = await w.h.call('POST', `${V1}/me/companies`, { token: w.u.token, body: { name: 'Amy Cargo', hub: 'LFPG' } });
  const cid2 = second.body.company.id as number;
  assert.equal((await w.h.call('POST', `${V1}/agency/missions/${m.id}/sign`, { token: w.u.token, company: cid2, body: { candidateIds: [list[0]!.id] } })).status, 404, "the first company's mission is not the second's");
  assert.deepEqual((await w.h.call('GET', `${V1}/agency/options`, { token: w.u.token, company: cid2 })).body.mission, null);
  assert.equal(w.staff().length, 0);
  assert.equal(w.balance(), 5_000_000);
});

test('migration V15 adds recruit_missions on a database at the previous version, keeps one open mission per position and follows the company when it is deleted', () => {
  const at = MIGRATIONS.findIndex((m) => m.includes('recruit_missions'));
  assert.ok(at > 0, 'found by content, not by position');
  const file = join(mkdtempSync(join(tmpdir(), 'opc-agency-')), 'prev.sqlite');
  const raw = new DatabaseSync(file);
  for (let i = 0; i < at; i++) raw.exec(MIGRATIONS[i]!);
  raw.exec(`PRAGMA user_version = ${at}`);
  raw.exec(`INSERT INTO users (id, username, pass_hash, created_at) VALUES (1, 'a', 'h', 1);
    INSERT INTO companies (id, user_id, name, balance, reputation, created_at) VALUES (1, 1, 'A Air', 1, 50, 1);`);
  raw.close();
  const db = openDb(file);
  assert.equal(get<{ user_version: number }>(db, 'PRAGMA user_version')!.user_version, MIGRATIONS.length);
  assert.equal(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM recruit_missions')!.n, 0);
  const add = (status: string) => run(db, "INSERT INTO recruit_missions (company_id, base, qual, count, started_at, ready_at, premium_pct, status) VALUES (1, 'LFPG', 'AT76', 2, 1, 2, 11, ?)", status);
  add('searching');
  assert.throws(() => add('searching'), /UNIQUE/, 'two open missions for one position');
  add('signed'); add('cancelled');
  assert.throws(() => run(db, "INSERT INTO recruit_missions (company_id, base, qual, count, started_at, ready_at, premium_pct, status) VALUES (1, 'LFPG', 'B738', 9, 1, 2, 11, 'signed')"), /CHECK/, 'at most 6 people');
  run(db, 'DELETE FROM companies WHERE id = 1');
  assert.equal(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM recruit_missions')!.n, 0);
});
