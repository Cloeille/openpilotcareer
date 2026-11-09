import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGENCY_MAX_COUNT, AGENCY_NOTICE_DAYS, AGENCY_SEARCH_DAYS, DAY_MS, OVERDRAFT_LIMIT, START_NOW_FEE, experienceFactor, salaryFor, type AgencyRequest, type AgencyView, type Candidate, type LineProblemView, type MissionView, type SignResult, type StaffOverview } from '@opc/shared';
import { all, get, MIGRATIONS, openDb, run } from './db.ts';
import { insertAircraft } from './fleet-extras.ts';
import { typeFor } from './game.ts';
import { harness } from './harness.ts';
import { grantStarterCrew } from './staff-people.ts';
import { crewShortage } from './staff.ts';

const HOUR = 3_600_000;
const V1 = '/api/v1';
const CAPTAIN = { family: 'pilot', role: 'captain' } as const;
const AT76_CAPTAINS: AgencyRequest = { ...CAPTAIN, base: 'LFPG', qual: 'AT76', count: 2 };
const cabin = (count: number): AgencyRequest => ({ family: 'cabin', role: 'attendant', base: 'LFPG', qual: null, count });
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
  const staff = () => all<{ id: number; family: string; role: string; candidate_id: string | null; starts_at: number; hired_at: number; notice_days: number; salary: number; contract: string }>(h.db, 'SELECT * FROM staff WHERE company_id = ? ORDER BY id', cid);
  const view = async (q = '') => (await call('GET', `/agency/options${q}`)).body as AgencyView;
  const open = (b: Record<string, unknown> = AT76_CAPTAINS) => call('POST', '/agency/missions', b);
  /** What the company's own grid pays this person: the market's `salaryFor` on the same hours, the same type. */
  const gridOf = (c: Candidate) => salaryFor(c.family, c.role, experienceFactor(c.family, c.experience), c.qual ? typeFor(h.db, cid, c.qual).category : null);
  const query = (r: Partial<AgencyRequest>) => `?${new URLSearchParams(Object.entries(r).flatMap(([k, v]) => (v === null || v === undefined ? [] : [[k, String(v)]])))}`;
  const overview = async () => (await call('GET', '/staff')).body as StaffOverview;
  await advance(2 * HOUR);
  return { h, u, cid, call, advance, balance, tx, staff, view, open, overview, lineId, ac, gridOf, query };
}

const pilotRow = (o: StaffOverview, type: string) => o.families.find((f) => f.family === 'pilot')!.children!.find((c) => c.type === type)!;

test('the options price the position that lacks pilots, against the stopped line\'s revenue a day (the figure of the problem screen)', async () => {
  const w = await world();
  const v = await w.view();
  const need = pilotRow(await w.overview(), 'AT76').need;
  assert.ok(need > 2, 'the timetable needs crews for the rotation, not the two seats of one flight');
  assert.deepEqual(v.gaps.filter((g) => g.family === 'pilot').map((g) => [g.base, g.qual, g.have, g.need, g.open, g.lines.length]), [['LFPG', 'AT76', 0, need, need, 1]], 'the need is the staffing screen\'s');
  const problem = (await w.call('GET', `/lines/${w.lineId}/problem`)).body as LineProblemView;
  assert.ok(problem.cost.perDay > 0);
  assert.equal(v.perDay, problem.cost.perDay, 'one daily figure: the stoppage cost of the line');
  assert.deepEqual(v.request, { ...CAPTAIN, base: 'LFPG', qual: 'AT76', count: Math.min(need, AGENCY_MAX_COUNT) }, 'no query: the post that costs the most, as many as one mission can ask');
  assert.deepEqual(v.options.map((o) => o.id), ['agency', 'train', 'classic']);
  for (const o of v.options) assert.equal(o.total, o.fees + o.stopped, o.id);
  const [agency, train, classic] = v.options;
  assert.equal(agency!.stopped, (AGENCY_SEARCH_DAYS + AGENCY_NOTICE_DAYS) * v.perDay);
  assert.equal(agency!.resumeAt, w.h.clock.t + (AGENCY_SEARCH_DAYS + AGENCY_NOTICE_DAYS) * DAY_MS);
  assert.equal(train!.available, false, 'nobody is employed, so nobody can be trained');
  assert.ok(classic!.fees > 0, 'the market lists captains for the post');
  assert.equal(v.mission, null);
  const asked = await w.view(w.query({ ...AT76_CAPTAINS, count: 1 }));
  assert.deepEqual(asked.request, { ...AT76_CAPTAINS, count: 1 });
  assert.ok(asked.options[0]!.fees < v.options[0]!.fees, 'one person costs less than two');
  assert.equal(w.balance(), 5_000_000, 'looking pays nothing');
});

test('a position the lines do not lack has no options; one the company cannot employ is refused', async () => {
  const w = await world();
  const ask = (r: Partial<AgencyRequest>) => w.call('GET', `/agency/options${w.query(r)}`);
  assert.equal((await ask(AT76_CAPTAINS)).status, 200);
  assert.equal((await ask({ ...AT76_CAPTAINS, base: 'EGLL' })).body.error, 'not_a_base');
  assert.equal((await ask({ ...AT76_CAPTAINS, qual: 'B738' })).body.error, 'not_a_fleet_type');
  assert.equal((await w.call('GET', '/agency/options?base=LFPG')).status, 400, 'family, role, base and count go together');
  assert.equal((await ask({ ...AT76_CAPTAINS, count: AGENCY_MAX_COUNT })).status, 200, 'the largest mission');
  assert.equal((await ask({ ...AT76_CAPTAINS, count: AGENCY_MAX_COUNT + 1 })).status, 400);
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
  assert.deepEqual([m.family, m.role, m.base, m.qual, m.count, m.ready, m.shortlist, m.quote, m.readyAt - m.startedAt], ['pilot', 'captain', 'LFPG', 'AT76', 2, false, null, null, AGENCY_SEARCH_DAYS * DAY_MS]);
  assert.equal(w.balance(), before, 'opening a mission pays nothing');
  assert.equal(w.tx('agency_fee').length, 0);
  assert.equal((await w.open()).body.error, 'mission_open');
  assert.equal((await w.open()).status, 409);
  assert.equal((await w.open({ ...AT76_CAPTAINS, count: 1 })).status, 409, 'whatever the count');
  assert.equal((await w.open({ ...AT76_CAPTAINS, role: 'fo' })).status, 201, 'another role of the same family and rating is another post');

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
  const need = pilotRow(await w.overview(), 'AT76').need;
  const m = (await w.open()).body as MissionView;
  const t0 = w.h.clock.t;
  await w.advance(AGENCY_SEARCH_DAYS * DAY_MS);
  const v = await w.view();
  const list = v.mission!.shortlist!;
  assert.equal(list.length, 3, 'two asked, one more to choose from');
  assert.ok(list.every((c) => c.family === 'pilot' && c.role === 'captain' && c.qual === 'AT76' && c.base === 'LFPG' && c.id.startsWith('a')), 'captains rated on the type, at the base, with ids the market cannot mistake for its own');
  assert.ok(list.every((c) => c.experience >= 3_000), 'a captain has a captain\'s hours');
  for (const c of list) assert.deepEqual([c.askingSalary, c.premium], [w.gridOf(c), c.askingSalary], 'paid exactly the company grid; the commission is one month of that salary');
  assert.ok(list.every((c) => !('grid' in c)), 'no second price to show: the grid is the price');
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
  assert.ok(!('surchargeMonthly' in s) && !('surchargeMonthly' in pick.mission!.quote!), 'no surcharge anywhere');
  assert.equal(pick.options[0]!.fees, list[0]!.premium + list[1]!.premium, 'the comparison panel prices the first two (the mission\'s ask) at their commission and nothing else');

  const people = w.staff();
  assert.equal(people.length, 2);
  for (const p of people) assert.deepEqual([p.family, p.contract, p.hired_at, p.starts_at, p.notice_days], ['pilot', 'cdi', w.h.clock.t, w.h.clock.t + AGENCY_NOTICE_DAYS * DAY_MS, AGENCY_NOTICE_DAYS], 'a normal hire in notice');
  assert.deepEqual(people.map((p) => p.salary).sort(), [w.gridOf(list[0]!), w.gridOf(list[2]!)].sort(), 'on the payroll at the company\'s grid salary');
  const quals = all<{ staff_id: number; type_icao: string; valid_from: number }>(w.h.db, 'SELECT * FROM staff_quals ORDER BY staff_id');
  assert.deepEqual(quals.map((q) => [q.type_icao, q.valid_from]), people.map((p) => ['AT76', p.starts_at]));
  assert.ok(s.members.every((x) => x.state === 'pending' && x.quals.includes('AT76')));

  const after = await w.view();
  assert.deepEqual(after.gaps.filter((g) => g.family === 'pilot').map((g) => [g.have, g.open]), [[0, need - 2]], 'the two hires in notice fill two posts: nobody is paid for twice, the rest is still open');
  const o = await w.overview();
  assert.deepEqual([o.people, o.pending, o.vacant, o.positions], [0, 2, o.positions - 2, o.positions], 'the header adds up: working + in notice + vacant = posts');
  assert.equal(after.mission, null, 'the mission is over');
  assert.equal(get<{ status: string; commission: number }>(w.h.db, 'SELECT status, commission FROM recruit_missions WHERE id = ?', m.id)!.status, 'signed');
  assert.equal(get<{ commission: number }>(w.h.db, 'SELECT commission FROM recruit_missions WHERE id = ?', m.id)!.commission, commission);

  assert.ok(crewShortage(w.h.db, w.cid, ['AT76'], ['LFPG', 'LFLL'], t0 + AGENCY_SEARCH_DAYS * DAY_MS).some((x) => x.family === 'pilot'), 'in notice they do not count yet');
  await w.advance(AGENCY_NOTICE_DAYS * DAY_MS);
  assert.deepEqual(crewShortage(w.h.db, w.cid, ['AT76'], ['LFPG', 'LFLL'], w.h.clock.t).filter((x) => x.family === 'pilot'), [], 'the notice is over: the crew check counts them');
});

test('the people signed use the existing start-now and cancellation rules like any hire in notice', async () => {
  const w = await world();
  const m = (await w.open({ ...AT76_CAPTAINS, count: 1 })).body as MissionView;
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
  const second = (await w.open({ ...AT76_CAPTAINS, count: 1 })).body as MissionView;
  await w.advance(AGENCY_SEARCH_DAYS * DAY_MS);
  const list = (await w.view()).mission!.shortlist!;
  const signed = (await w.call('POST', `/agency/missions/${second.id}/sign`, { candidateIds: [list[0]!.id] })).body as SignResult;
  const third = (await w.open({ ...AT76_CAPTAINS, count: 1 })).body as MissionView;
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
    ['GET', '/agency/options'], ['POST', '/agency/missions', { ...AT76_CAPTAINS, count: 1 }], ['POST', `/agency/missions/${m.id}/sign`, { candidateIds: [list[0]!.id] }], ['DELETE', `/agency/missions/${m.id}`],
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
  assert.equal((await w.h.call('POST', `${V1}/agency/missions`, { token: other.token, company: w.cid, body: { ...AT76_CAPTAINS, count: 1 } })).status, 403);
  assert.equal(get(w.h.db, "SELECT 1 AS x FROM recruit_missions WHERE company_id != ?", w.cid), undefined);

  const second = await w.h.call('POST', `${V1}/me/companies`, { token: w.u.token, body: { name: 'Amy Cargo', hub: 'LFPG' } });
  const cid2 = second.body.company.id as number;
  assert.equal((await w.h.call('POST', `${V1}/agency/missions/${m.id}/sign`, { token: w.u.token, company: cid2, body: { candidateIds: [list[0]!.id] } })).status, 404, "the first company's mission is not the second's");
  assert.deepEqual((await w.h.call('GET', `${V1}/agency/options`, { token: w.u.token, company: cid2 })).body.mission, null);
  assert.equal(w.staff().length, 0);
  assert.equal(w.balance(), 5_000_000);
});

test('the all-profiles migration rebuilds recruit_missions on a live database: open and signed missions become a captain\'s, one open mission per post, 20 people at most, and it follows the company when deleted', () => {
  const to = MIGRATIONS.findIndex((m) => m.includes('recruit_missions_new'));
  assert.ok(to > 0, 'found by content, not by position');
  const file = join(mkdtempSync(join(tmpdir(), 'opc-agency-')), 'prev.sqlite');
  const raw = new DatabaseSync(file);
  for (let i = 0; i < to; i++) raw.exec(MIGRATIONS[i]!);
  raw.exec(`PRAGMA user_version = ${to}`);
  raw.exec(`INSERT INTO users (id, username, pass_hash, created_at) VALUES (1, 'a', 'h', 1);
    INSERT INTO companies (id, user_id, name, balance, reputation, created_at) VALUES (1, 1, 'A Air', 1, 50, 1);
    INSERT INTO recruit_missions (company_id, base, qual, count, started_at, ready_at, premium_pct, commission, status) VALUES (1, 'LFPG', 'AT76', 2, 1, 2, 11, 0, 'searching'), (1, 'LFPG', 'B738', 3, 1, 2, 11, 9000, 'signed');`);
  raw.close();
  const db = openDb(file);
  assert.equal(get<{ user_version: number }>(db, 'PRAGMA user_version')!.user_version, MIGRATIONS.length);
  assert.deepEqual(all<Record<string, unknown>>(db, 'SELECT family, role, base, qual, count, commission, status FROM recruit_missions ORDER BY id').map((r) => ({ ...r })), [
    { family: 'pilot', role: 'captain', base: 'LFPG', qual: 'AT76', count: 2, commission: 0, status: 'searching' },
    { family: 'pilot', role: 'captain', base: 'LFPG', qual: 'B738', count: 3, commission: 9000, status: 'signed' },
  ]);
  assert.ok(!all<{ name: string }>(db, 'PRAGMA table_info(recruit_missions)').some((c) => c.name === 'premium_pct'), 'no surcharge to remember');
  const add = (family: string, role: string, qual: string | null, status = 'searching', count = 2) =>
    run(db, 'INSERT INTO recruit_missions (company_id, family, role, base, qual, count, started_at, ready_at, status) VALUES (1, ?, ?, ?, ?, ?, 1, 2, ?)', family, role, 'LFPG', qual, count, status);
  add('cabin', 'attendant', null);
  assert.throws(() => add('cabin', 'attendant', null), /UNIQUE/, 'two open missions for one post, a post without a rating included');
  assert.throws(() => add('pilot', 'captain', 'AT76'), /UNIQUE/, 'the migrated open mission still holds its post');
  add('cabin', 'attendant', null, 'signed'); add('cabin', 'attendant', null, 'cancelled'); add('pilot', 'fo', 'AT76'); add('kitchen', 'cook', null, 'searching', 20);
  assert.throws(() => add('maintenance', 'technician', null, 'searching', 21), /CHECK/, 'at most 20 people');
  assert.throws(() => add('astronaut', 'captain', null), /CHECK/, 'a family the staff table does not know');
  run(db, 'DELETE FROM companies WHERE id = 1');
  assert.equal(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM recruit_missions')!.n, 0);
});

// ---------------------------------------------------------------- what is short: the staffing screen's need, not a flight deck

/** An AMERICA-like company: two lines from one hub (an AT76 and an A319), a starter crew, then the pilots cut to one deck per type: every leg has a crew on paper, the rotation does not. */
async function america() {
  const w = await world(); // its first line was interrupted for want of crew: forget the cancellations, the crew is about to come
  run(w.h.db, 'DELETE FROM scheduled_flights');
  run(w.h.db, "UPDATE lines SET status = 'active', interrupted_since = NULL, interrupt_cause = NULL, stoppage_charged = 0");
  const second = insertAircraft(w.h.db, { companyId: w.cid, icao: 'A319', hub: 'LFPG', value: 3_000_000, ownership: 'owned', at: w.h.clock.t });
  const made = await w.call('POST', '/lines', body({ b: 'LFMN', freqPerDay: 2, aircraftIds: [second] }));
  assert.equal(made.status, 201, made.text);
  grantStarterCrew(w.h.db, w.cid, w.h.clock.t);
  for (const type of ['AT76', 'A319']) {
    const keep = all<{ id: number }>(w.h.db, "SELECT s.id FROM staff s JOIN staff_quals q ON q.staff_id = s.id WHERE s.company_id = ? AND s.family = 'pilot' AND q.type_icao = ? ORDER BY s.id LIMIT 2", w.cid, type).map((r) => r.id);
    run(w.h.db, `DELETE FROM staff WHERE company_id = ? AND family = 'pilot' AND id IN (SELECT s.id FROM staff s JOIN staff_quals q ON q.staff_id = s.id WHERE q.type_icao = ?) AND id NOT IN (${keep.join(',')})`, w.cid, type);
  }
  await w.advance(3 * DAY_MS);
  return w;
}

test('a base with a flight deck for every leg but too few crews for the rotation is short of pilots: legs are cancelled for duty limits and the agency says so', async () => {
  const w = await america();
  const cancelled = all<{ cancel_cause: string; crew_family: string }>(w.h.db, "SELECT cancel_cause, crew_family FROM scheduled_flights WHERE status = 'cancelled'");
  assert.ok(cancelled.some((l) => l.cancel_cause === 'duty_limit' && l.crew_family === 'pilot'), `legs cancelled for the pilots' duty limits (${JSON.stringify(cancelled)})`);
  for (const l of all<{ id: number; a: string; b: string }>(w.h.db, 'SELECT id, a, b FROM lines')) {
    const icaos = all<{ icao: string }>(w.h.db, 'SELECT DISTINCT a.icao FROM line_aircraft la JOIN aircraft a ON a.id = la.aircraft_id WHERE la.line_id = ?', l.id).map((r) => r.icao);
    assert.deepEqual(crewShortage(w.h.db, w.cid, icaos, [l.a, l.b], w.h.clock.t), [], 'each line has a deck: the headcount check sees no missing person, which is why it cannot be the agency\'s measure');
  }

  const o = await w.overview();
  const v = await w.view();
  const pilots = v.gaps.filter((g) => g.family === 'pilot');
  assert.deepEqual(pilots.map((g) => g.qual).sort(), ['A319', 'AT76'], 'both types lack crews');
  for (const g of pilots) {
    const row = pilotRow(o, g.qual!);
    assert.deepEqual([g.base, g.have, g.need, g.open], ['LFPG', 2, row.need, row.availability.vacant], `${g.qual}: the agency's gap is the staffing screen's vacancy`);
    assert.ok(g.need > g.have && g.perDay > 0 && g.lines.length === 1, String(g.qual));
  }
  assert.ok(v.request && v.request.count > 0, 'there is a position to fill');
  assert.equal(o.people + o.pending + o.vacant, o.positions, 'the header adds up: working + in notice + vacant = posts');
  assert.equal(o.vacant, o.families.reduce((n, f) => n + f.availability.vacant, 0));

});

test('the agency lists every post that lacks people, not only pilots: cabin crew, ground, maintenance and administration come with their open count, at the company\'s bases only', async () => {
  const w = await world();
  const v = await w.view();
  const o = await w.overview();
  const byFamily = (f: string) => v.gaps.filter((g) => g.family === f);
  for (const family of ['pilot', 'cabin', 'ground', 'maintenance', 'admin']) assert.equal(byFamily(family).length, 1, `${family} is short`);
  assert.equal(byFamily('cabin')[0]!.qual, null, 'a type rating is for pilots only');
  assert.deepEqual(v.gaps.filter((g) => g.family !== 'pilot').map((g) => g.qual), [null, null, null, null], 'only a pilot gap names a type');
  assert.ok(v.gaps.every((g) => g.base === 'LFPG'), 'LFLL is neither a hub nor a base: nobody can be employed there');
  assert.equal(v.gaps.reduce((n, g) => n + g.open, 0), o.vacant - 1, 'the agency lists the vacancies of the staffing header, but the ground agent of LFLL (neither a hub nor a base: nobody can be employed there)');
  const cabinNeed = o.families.find((f) => f.family === 'cabin')!.need;
  assert.deepEqual([byFamily('cabin')[0]!.have, byFamily('cabin')[0]!.need, byFamily('cabin')[0]!.open], [0, cabinNeed, cabinNeed]);
  assert.ok(byFamily('cabin')[0]!.perDay > 0 && byFamily('cabin')[0]!.lines.length === 1, 'the stopped line is also lost for want of cabin crew');
  assert.equal(byFamily('ground')[0]!.perDay, 0, 'no line stops for want of a ground agent');
  assert.deepEqual(v.gaps.map((g) => g.perDay), [...v.gaps.map((g) => g.perDay)].sort((a, b) => b - a), 'the most costly first');
  const cabinGap = await w.view(w.query({ ...cabin(Math.min(cabinNeed, AGENCY_MAX_COUNT)) }));
  assert.deepEqual(cabinGap.options.map((x) => x.id), ['agency', 'classic'], 'cabin crew have no type rating course to train for');
  assert.equal(cabinGap.options[0]!.available, true, 'the agency always has as many candidates as posts');
  const listed = (await w.call('GET', '/staff/candidates?family=cabin&base=LFPG')).body.market as number;
  assert.equal(cabinGap.options[1]!.available, listed >= cabinGap.request!.count, 'the market has 6 to 10 people a day: a bigger need is what the agency is for');
  grantStarterCrew(w.h.db, w.cid, w.h.clock.t);
  assert.deepEqual((await w.view()).gaps, [], 'a full crew: nothing is short');
});

test('a cabin crew mission signs people as normal staff rows: family cabin, no rating, paid the grid, the commission one month of each salary', async () => {
  const w = await world();
  const m = (await w.open(cabin(10))).body as MissionView;
  assert.deepEqual([m.family, m.role, m.qual, m.count], ['cabin', 'attendant', null, 10]);
  await w.advance(AGENCY_SEARCH_DAYS * DAY_MS);
  const v = await w.view();
  const list = v.mission!.shortlist!;
  assert.equal(list.length, 11, 'ten asked, one more to choose from');
  assert.ok(list.every((c) => c.family === 'cabin' && c.role === 'attendant' && c.qual === null && c.base === 'LFPG' && c.id.startsWith('a')));
  assert.ok(list.every((c) => c.experience >= 0 && c.experience <= 20 && c.reliability >= 60 && c.reliability < 99 && c.morale >= 50 && c.morale < 96), 'the market\'s ranges for the family: years of experience, not flight hours');
  const ids = list.slice(0, 10).map((c) => c.id);
  const before = w.balance();
  const signed = await w.call('POST', `/agency/missions/${m.id}/sign`, { candidateIds: ids });
  assert.equal(signed.status, 201, signed.text);
  const s = signed.body as SignResult;
  const people = w.staff();
  assert.equal(people.length, 10);
  assert.ok(people.every((p) => p.family === 'cabin' && p.role === 'attendant' && p.contract === 'cdi' && p.starts_at === w.h.clock.t + AGENCY_NOTICE_DAYS * DAY_MS), 'signed staff rows of family cabin, in notice');
  assert.equal(get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM staff_quals')!.n, 0, 'cabin crew hold no type rating');
  const payroll = people.reduce((t, p) => t + p.salary, 0);
  assert.equal(s.commission, payroll, 'the commission is exactly one month of the salaries signed');
  assert.equal(before - w.balance(), payroll);
  assert.deepEqual(w.tx('agency_fee').map((x) => -x.amount).sort(), list.slice(0, 10).map((c) => c.premium).sort(), 'one ledger row per person');
  assert.deepEqual(people.map((p) => p.salary).sort(), list.slice(0, 10).map((c) => w.gridOf(c)).sort(), 'every one is paid the grid: no surcharge');
  assert.equal(s.members.every((x) => x.state === 'pending' && x.family === 'cabin'), true);
  const after = await w.view();
  assert.equal(after.gaps.find((g) => g.family === 'cabin')?.open ?? 0, Math.max(0, v.gaps.find((g) => g.family === 'cabin')!.open - 10), 'ten hires in notice fill ten posts');
});

test('a cook and a mechanic mission work: kitchen cooks and maintenance technicians, no rating, paid the grid; a mission asks for 20 at most', async () => {
  const w = await world();
  for (const [family, role] of [['kitchen', 'cook'], ['maintenance', 'technician'], ['ground', 'agent'], ['admin', 'clerk']] as const) {
    const r = await w.open({ family, role, base: 'LFPG', qual: null, count: 1 });
    assert.equal(r.status, 201, `${family}: ${r.text}`);
  }
  await w.advance(AGENCY_SEARCH_DAYS * DAY_MS);
  assert.equal((await w.view()).mission!.family, 'pilot' === 'pilot' ? 'kitchen' : '', 'the first open mission is the one the screen shows');
  for (const [family, role] of [['kitchen', 'cook'], ['maintenance', 'technician']] as const) {
    const mission = (await w.view(w.query({ family, role, base: 'LFPG', count: 1 }))).mission!;
    assert.equal(mission.shortlist!.length, 2);
    const signed = await w.call('POST', `/agency/missions/${mission.id}/sign`, { candidateIds: [mission.shortlist![0]!.id] });
    assert.equal(signed.status, 201, signed.text);
    const row = w.staff().find((p) => p.family === family)!;
    assert.deepEqual([row.role, row.salary], [role, w.gridOf(mission.shortlist![0]!)]);
    assert.equal((signed.body as SignResult).commission, row.salary, 'one month of the salary');
  }
  const big = await w.call('POST', '/agency/missions', { family: 'cabin', role: 'attendant', base: 'LFPG', qual: null, count: AGENCY_MAX_COUNT });
  assert.equal(big.status, 201, `${AGENCY_MAX_COUNT} people are accepted: ${big.text}`);
  assert.equal(AGENCY_MAX_COUNT, 20);
  assert.equal((await w.call('POST', '/agency/missions', { family: 'ground', role: 'agent', base: 'LFPG', qual: null, count: 21 })).status, 400, '21 is refused');
  await w.advance(AGENCY_SEARCH_DAYS * DAY_MS);
  const list = (await w.view(w.query(cabin(AGENCY_MAX_COUNT)))).mission!.shortlist!;
  assert.equal(list.length, AGENCY_MAX_COUNT + 1);
  const twenty = await w.call('POST', `/agency/missions/${(big.body as MissionView).id}/sign`, { candidateIds: list.slice(0, AGENCY_MAX_COUNT).map((c) => c.id) });
  assert.equal(twenty.status, 201, twenty.text);
  assert.equal(w.staff().filter((p) => p.family === 'cabin').length, AGENCY_MAX_COUNT);
});

test('hiring cannot forge a post: a role the family does not have, a rating on a non-pilot, a pilot without one, an instructor, a type the company does not fly or a base it does not employ at are all refused, and nothing is written', async () => {
  const w = await world();
  const refused = async (b: Record<string, unknown>, status: number, error: string) => {
    const r = await w.open(b);
    assert.deepEqual([r.status, r.body.error ?? r.body.code], [status, error], JSON.stringify(b));
  };
  await refused({ family: 'cabin', role: 'captain', base: 'LFPG', qual: null, count: 1 }, 422, 'invalid_post');
  await refused({ family: 'pilot', role: 'attendant', base: 'LFPG', qual: 'AT76', count: 1 }, 422, 'invalid_post');
  await refused({ family: 'kitchen', role: 'technician', base: 'LFPG', qual: null, count: 1 }, 422, 'invalid_post');
  await refused({ family: 'cabin', role: 'attendant', base: 'LFPG', qual: 'AT76', count: 1 }, 422, 'invalid_post');
  await refused({ family: 'maintenance', role: 'technician', base: 'LFPG', qual: 'AT76', count: 1 }, 422, 'invalid_post');
  await refused({ family: 'pilot', role: 'captain', base: 'LFPG', qual: null, count: 1 }, 422, 'invalid_post');
  await refused({ family: 'pilot', role: 'instructor', base: 'LFPG', qual: 'AT76', count: 1 }, 422, 'invalid_post');
  await refused({ family: 'cabin', role: 'instructor', base: 'LFPG', qual: null, count: 1 }, 422, 'invalid_post');
  await refused({ family: 'pilot', role: 'captain', base: 'LFPG', qual: 'B738', count: 1 }, 422, 'not_a_fleet_type');
  await refused({ family: 'cabin', role: 'attendant', base: 'EGLL', qual: null, count: 1 }, 422, 'not_a_base');
  await refused({ family: 'astronaut', role: 'captain', base: 'LFPG', qual: null, count: 1 }, 400, 'invalid_request');
  await refused({ family: 'cabin', role: 'attendant', base: 'LFPG', qual: null, count: 21 }, 400, 'invalid_request');
  assert.equal((await w.call('GET', `/agency/options${w.query({ family: 'cabin', role: 'captain', base: 'LFPG', count: 1 })}`)).body.error, 'invalid_post', 'the comparison guards the same way');
  assert.equal(get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM recruit_missions')!.n, 0, 'no mission was written');

  const m = (await w.open(cabin(2))).body as MissionView;
  await w.advance(AGENCY_SEARCH_DAYS * DAY_MS);
  const day = Math.floor(w.h.clock.t / DAY_MS);
  const forged = [
    `a${day}.LFPG.pilot.captain.AT76.0`, `a${day}.LFPG.cabin.captain.-.0`, `a${day}.LFPG.cabin.attendant.AT76.0`, `a${day}.LFPG.kitchen.cook.-.0`, `a${day}.LFPG.cabin.attendant.-.99999`,
    '1.LFPG.pilot.AT76.0', '1.LFPG.cabin.-.0',
  ];
  for (const id of forged) assert.equal((await w.call('POST', `/agency/missions/${m.id}/sign`, { candidateIds: [id] })).status, 404, `${id}: not on this mission's shortlist`);
  const viaMarket = await w.h.call('POST', `${V1}/staff/hire`, { token: w.u.token, body: { candidateId: `a${day}.LFPG.cabin.attendant.-.0` } });
  assert.equal(viaMarket.status, 404, 'the market\'s hire does not take an agency id either');
  assert.deepEqual([w.staff().length, w.tx('agency_fee').length, w.balance()], [0, 0, 5_000_000], 'nothing was hired, nothing paid');
});

test('the price: 10 cabin crew and 6 A319 captains cost one month of each salary at signature, no surcharge, where the old terms asked 20 % of the year plus 11 % more pay forever', async () => {
  const w = await world();
  run(w.h.db, 'UPDATE companies SET balance = 50000000 WHERE id = ?', w.cid);
  insertAircraft(w.h.db, { companyId: w.cid, icao: 'A319', hub: 'LFPG', value: 3_000_000, ownership: 'owned', at: w.h.clock.t });
  const old = (c: Candidate) => { const grid = w.gridOf(c), asking = Math.round((grid * 1.11) / 50) * 50; return { commission: Math.round(asking * 12 * 0.2), surcharge: asking - grid }; };
  const out: Record<string, { months: number; commission: number; payrollAfter: number; oldCommission: number; oldYear: number }> = {};
  for (const [label, r] of [['10 cabin crew', cabin(10)], ['6 A319 captains', { ...CAPTAIN, base: 'LFPG', qual: 'A319', count: 6 }]] as const) {
    const opened = await w.open(r);
    assert.equal(opened.status, 201, opened.text);
    await w.advance(AGENCY_SEARCH_DAYS * DAY_MS);
    const view = await w.view(w.query(r));
    const picked = view.mission!.shortlist!.slice(0, r.count);
    const quote = view.mission!.quote!;
    const salaries = picked.reduce((t, c) => t + c.askingSalary, 0);
    assert.deepEqual([quote.commission, view.options[0]!.fees], [salaries, salaries], `${label}: the quote and the comparison panel are one month of the salaries`);
    const was = picked.reduce((t, c) => ({ commission: t.commission + old(c).commission, surcharge: t.surcharge + old(c).surcharge }), { commission: 0, surcharge: 0 });
    out[label] = { months: 1, commission: quote.commission, payrollAfter: salaries, oldCommission: was.commission, oldYear: was.commission + 12 * was.surcharge };
    const signed = await w.call('POST', `/agency/missions/${view.mission!.id}/sign`, { candidateIds: picked.map((c) => c.id) });
    assert.equal(signed.status, 201, signed.text);
  }
  for (const [label, p] of Object.entries(out)) {
    assert.ok(p.commission * 2.5 < p.oldCommission, `${label}: the commission alone is under 40 % of the old one (${p.commission} against ${p.oldCommission})`);
    assert.ok(p.commission * 3 < p.oldYear, `${label}: over a year the old terms cost more than three times as much (${p.oldYear})`);
  }
});
