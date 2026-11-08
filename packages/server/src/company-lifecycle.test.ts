import { test } from 'node:test';
import assert from 'node:assert/strict';
import { START_MODES } from '@opc/shared';
import { all, get, run } from './db.ts';
import { grantStarterCrew } from './staff-people.ts';
import { insertAircraft } from './fleet-extras.ts';
import { snapshot } from './game.ts';
import { harness } from './harness.ts';

const V1 = '/api/v1';
const PASSWORD = 'correct horse';
type H = Awaited<ReturnType<typeof harness>>;

/** Rows per table. `facilities` (a slot of an airport, shared by every company), the clocks and `meta` belong to no company. */
const SHARED = new Set(['facilities', 'line_ticks', 'ai_ticks', 'meta']);
const tables = (h: H): string[] => all<{ name: string }>(h.db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((t) => t.name);
const counts = (h: H): Record<string, number> => Object.fromEntries(tables(h).filter((t) => !SHARED.has(t)).map((t) => [t, get<{ n: number }>(h.db, `SELECT COUNT(*) AS n FROM ${t}`)!.n]));
/** Every table that has a company_id column: this list comes from the schema, so a table added later is covered without touching the test. */
const companyTables = (h: H): string[] => tables(h).filter((t) => all<{ name: string }>(h.db, `PRAGMA table_info(${t})`).some((c) => c.name === 'company_id'));
const rowsOf = (h: H, table: string, cid: number): number => get<{ n: number }>(h.db, `SELECT COUNT(*) AS n FROM ${table} WHERE company_id = ?`, cid)!.n;
const perCompany = (h: H, cid: number): Record<string, number> => Object.fromEntries(companyTables(h).map((t) => [t, rowsOf(h, t, cid)]));

const del = (h: H, token: string, id: number, password: unknown = PASSWORD) => h.call('DELETE', `${V1}/companies/${id}`, { token, body: { password } });
const reset = (h: H, token: string, id: number, body: Record<string, unknown> = { startMode: 'airliner' }) => h.call('POST', `${V1}/companies/${id}/reset`, { token, body: { password: PASSWORD, ...body } });

/** A player with one company that stays untouched (the bystander) and a v2 company founded with a start mode, filled until every company table holds a row. */
async function world(h: H, o: { fill: boolean; mode?: 'airliner' | 'hardcore' } = { fill: true }) {
  const u = await h.register('amy', 'LFPG');
  const bystander = u.me.company.id as number;
  const found = await h.call('POST', `${V1}/me/companies`, { token: u.token, body: { name: 'Azur Régional', hub: 'LFMN', code: 'AZR', callsign: 'AZUR', liveryColor: '#3B82F6', startMode: o.mode ?? 'airliner' } });
  assert.equal(found.status, 201, found.text);
  const cid = found.body.company.id as number;
  if (o.fill) await fill(h, u.token, cid);
  return { token: u.token, userId: get<{ id: number }>(h.db, 'SELECT id FROM users WHERE username = ?', 'amy')!.id, bystander, cid };
}

async function fill(h: H, token: string, cid: number): Promise<void> {
  const at = h.clock.t;
  const ac = insertAircraft(h.db, { companyId: cid, icao: 'AT76', hub: 'LFMN', value: 1_000_000, ownership: 'owned', at });
  const line = await h.call('POST', `${V1}/lines`, { token, company: cid, body: { a: 'LFMN', b: 'LFML', freqPerDay: 2, days: Array(7).fill(true), windowStart: '06:00', windowEnd: '18:00', aircraftIds: [ac] } });
  assert.equal(line.status, 201, line.text);
  grantStarterCrew(h.db, cid, at);
  const staff = get<{ id: number }>(h.db, 'SELECT id FROM staff WHERE company_id = ? LIMIT 1', cid)!.id;
  run(h.db, 'INSERT INTO custom_aircraft (company_id, icao, name, category, engines, wtc, seats, cargo_kg, cruise_kts, range_nm) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', cid, 'ZZ99', 'Zed', 'piston', 1, 'L', 4, 100, 120, 500);
  run(h.db, `INSERT INTO flights (company_id, aircraft_id, aircraft_icao, job_id, source, kind, origin, destination, distance_nm, payload_kg, pax, payout, status, accepted_at)
    VALUES (?, ?, 'AT76', 'LFMN-1-1', 'board', 'pax', 'LFMN', 'LFML', 100, 500, 10, 900, 'verified', ?)`, cid, ac, at);
  run(h.db, 'INSERT INTO job_claims (job_id, company_id, claimed_at) VALUES (?, ?, ?)', 'LFMN-1-1', cid, at);
  run(h.db, 'INSERT INTO job_reservations (job_id, company_id, reserved_until) VALUES (?, ?, ?)', 'LFMN-2-2', cid, at + 1);
  run(h.db, `INSERT INTO custom_jobs (id, company_id, created_at, kind, origin, destination, distance_nm, payload_kg, pax, payout) VALUES ('sb-1', ?, ?, 'pax', 'LFMN', 'LFML', 100, 500, 10, 900)`, cid, at);
  run(h.db, "INSERT INTO contracts (company_id, aircraft_id, kind, started_at) VALUES (?, ?, 'lease', ?)", cid, ac, at);
  run(h.db, 'INSERT INTO bailouts (company_id, season, at, amount) VALUES (?, ?, ?, ?)', cid, '2026-11', at, 1);
  run(h.db, 'INSERT INTO facilities (hub_icao, slot) VALUES (?, ?) ON CONFLICT DO NOTHING', 'LFMN', 'hangar');
  const facility = get<{ id: number }>(h.db, "SELECT id FROM facilities WHERE hub_icao = 'LFMN' AND slot = 'hangar'")!.id;
  run(h.db, "INSERT INTO facility_contracts (facility_id, company_id, kind, started_at, monthly, level_since) VALUES (?, ?, 'lease', ?, 100, ?)", facility, cid, at, at);
  run(h.db, "INSERT INTO incidents (company_id, ref, at, season, aircraft_id, airport, severity, kind, duty_min, wear_pct, risk, cost, covered, downtime_until, reputation_delta) VALUES (?, 'flight:1', ?, '2026-11', ?, 'LFMN', 'minor', 'bird', 1, 1, 1, 1, 0, ?, 0)", cid, at, ac, at);
  run(h.db, 'INSERT INTO staff_company (company_id) VALUES (?) ON CONFLICT DO NOTHING', cid);
  run(h.db, 'INSERT INTO safety_readings (company_id, day, idx) VALUES (?, 1, 90)', cid);
  run(h.db, "INSERT INTO staff_leave (staff_id, from_day, to_day, status) VALUES (?, 10, 12, 'granted')", staff);
  run(h.db, "INSERT INTO staff_duty (staff_id, leg_id, day, flight_no, dep_at, arr_at, origin, dest, duty_start, duty_min, flight_min) VALUES (?, NULL, 1, 1, ?, ?, 'LFMN', 'LFML', ?, 60, 40)", staff, at, at + 1, at);
  run(h.db, "INSERT INTO parts_stock (company_id, hub, part, qty) VALUES (?, 'LFMN', 'filter', 2)", cid);
  run(h.db, "INSERT INTO credits (company_id, bank, principal0, principal, rate, months, monthly, fee, insurance, early_penalty_pct, started_at) VALUES (?, 'alpes', 100, 100, 0.072, 12, 9, 0, 0, 0, ?)", cid, at);
  run(h.db, "INSERT INTO training_courses (company_id, staff_id, type_icao, base, place, start_at, end_at, cost, saved) VALUES (?, ?, 'AT76', 'LFMN', 'own', ?, ?, 100, 50)", cid, staff, at, at + 1);
  run(h.db, "INSERT INTO recruit_missions (company_id, base, qual, count, started_at, ready_at, premium_pct) VALUES (?, 'LFMN', 'AT76', 2, ?, ?, 11)", cid, at, at + 1);
  run(h.db, "INSERT INTO parts_orders (company_id, hub, part, qty, ordered_at, eta, cost) VALUES (?, 'LFMN', 'filter', 1, ?, ?, 100)", cid, at, at + 1);
  run(h.db, "INSERT INTO parts_policy (company_id, hub, icao, cls, policy) VALUES (?, 'LFMN', 'AT76', 'turboprop', 'critical')", cid);
  run(h.db, "INSERT INTO breakdowns (company_id, aircraft_id, hub, component, part, failed_at, eta, ready_at, paid, from_stock) VALUES (?, ?, 'LFMN', 'engines', 'filter', ?, ?, ?, 100, 1)", cid, ac, at, at + 1, at + 2);
  run(h.db, "INSERT INTO service_policy (company_id, haul, item, mode, since) VALUES (?, 'short', 'snack', 'sold', ?)", cid, at);
  run(h.db, "INSERT INTO kitchen (company_id, hub, provider, since) VALUES (?, 'LFMN', 'caterer', ?)", cid, at);
  run(h.db, "INSERT INTO service_days (company_id, day, hub) VALUES (?, 1, 'LFMN')", cid);
  // v4 ALLIANCE: a club of which she is the only member, with a pending vote on her other company (a ballot of hers on it): the last member leaving takes the alliance, its vote and its ballot away
  const club = run(h.db, "INSERT INTO alliances (name, founded_at) VALUES ('Fixture Club', ?)", at).id;
  run(h.db, 'INSERT INTO alliance_members (alliance_id, company_id, since) VALUES (?, ?, ?)', club, cid, at);
  const vote = run(h.db, 'INSERT INTO alliance_votes (alliance_id, candidate_id, created_at) VALUES (?, (SELECT id FROM companies WHERE user_id = (SELECT user_id FROM companies WHERE id = ?) AND id != ?), ?)', club, cid, cid, at).id;
  run(h.db, "INSERT INTO alliance_ballots (vote_id, company_id, choice) VALUES (?, ?, 'yes')", vote, cid);
  snapshot(h.db, cid, at);
}

test('a company with a row in every company table: deleting it leaves every table as it was before the company existed', async () => {
  const lone = await harness();
  await lone.register('amy', 'LFPG');
  const before = counts(lone); // the player with her one other company, nothing else
  const h = await harness();
  const w = await world(h);
  const full = perCompany(h, w.cid);
  assert.deepEqual(Object.entries(full).filter(([, n]) => n === 0).map(([t]) => t), [], 'the fixture must put a row in every company table, so no table escapes the check');
  assert.ok(companyTables(h).length >= 20);
  assert.equal(get<{ n: number }>(h.db, 'SELECT COUNT(*) AS n FROM onboarding WHERE company_id = ?', w.cid)!.n, 1);

  const r = await del(h, w.token, w.cid);
  assert.equal(r.status, 204, r.text);
  for (const t of companyTables(h)) assert.equal(rowsOf(h, t, w.cid), 0, `${t} keeps rows of the deleted company`);
  assert.equal(get<{ n: number }>(h.db, 'SELECT COUNT(*) AS n FROM onboarding WHERE company_id = ?', w.cid)!.n, 0);
  assert.deepEqual(all(h.db, 'PRAGMA foreign_key_check'), []);
  const now = counts(h);
  for (const t of Object.keys(before)) if (t !== 'onboarding') assert.equal(now[t], before[t], `${t}: ${before[t]} rows before the company, ${now[t]} after its deletion`);
});

test('every reference to companies cascades, except onboarding.company_id, which the deletion fixes up itself', async () => {
  const h = await harness();
  const loose = tables(h).flatMap((t) => all<{ table: string; on_delete: string; from: string }>(h.db, `PRAGMA foreign_key_list(${t})`).filter((f) => f.table === 'companies' && f.on_delete !== 'CASCADE').map((f) => `${t}.${f.from}`));
  assert.deepEqual(loose, ['onboarding.company_id']);
});

test('resetting a company wipes its career and restarts it as a freshly founded company: same id and identity, same rows in every table', async () => {
  const fresh = await harness();
  const f = await world(fresh, { fill: false });
  const h = await harness();
  const w = await world(h);
  const impact = (await h.call('GET', `${V1}/companies/${w.cid}/impact`, { token: w.token })).body;
  assert.ok(impact.aircraft >= 1 && impact.lines === 1 && impact.staff > 0 && impact.flights === 1 && impact.flightActive === false && impact.balance === START_MODES.airliner.capital);

  const r = await reset(h, w.token, w.cid, { startMode: 'airliner', hub: 'LFMN' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(
    { id: r.body.company.id, name: r.body.company.name, code: r.body.company.code, callsign: r.body.company.callsign, liveryColor: r.body.company.liveryColor, startMode: r.body.company.startMode, balance: r.body.company.balance, flights: r.body.company.flights },
    { id: w.cid, name: 'Azur Régional', code: 'AZR', callsign: 'AZUR', liveryColor: '#3B82F6', startMode: 'airliner', balance: START_MODES.airliner.capital, flights: 0 });
  assert.deepEqual(r.body.hubs, ['LFMN']);
  assert.deepEqual(r.body.fleet, []);
  assert.deepEqual(perCompany(h, w.cid), perCompany(fresh, f.cid), 'the reset company holds the rows of a company that was just founded, table by table');
  assert.deepEqual(counts(h), counts(fresh), 'and no table holds anything the fresh world does not');
  assert.deepEqual(all(h.db, 'PRAGMA foreign_key_check'), []);
  assert.equal((await h.call('GET', `${V1}/me/transactions`, { token: w.token, company: w.cid })).body.map((t: { kind: string }) => t.kind).join(), 'grant');
  const ob = (await h.call('GET', `${V1}/onboarding`, { token: w.token })).body;
  assert.deepEqual({ completed: ob.completed, step: ob.step, startMode: ob.startMode, companyId: ob.companyId }, { completed: false, step: 3, startMode: 'airliner', companyId: w.cid });
  assert.ok((await h.call('GET', `${V1}/me`, { token: w.token, company: w.bystander })).body.fleet.length === 1, 'the other company is untouched');
});

test('a reset can pick the hardcore start and a new hub, and refuses an unknown start mode, an unknown hub and a bystander onboarding', async () => {
  const h = await harness();
  const w = await world(h, { fill: false });
  assert.equal((await reset(h, w.token, w.cid, { startMode: 'nope' })).status, 400);
  assert.equal((await reset(h, w.token, w.cid, { startMode: 'hardcore', hub: 'ZZZZ' })).status, 422);
  assert.equal(get<{ balance: number }>(h.db, 'SELECT balance FROM companies WHERE id = ?', w.cid)!.balance, START_MODES.airliner.capital, 'a refused reset changes nothing');
  const ok = await reset(h, w.token, w.cid, { startMode: 'hardcore', hub: 'LFTZ' });
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual([ok.body.company.startMode, ok.body.company.balance, ok.body.hubs], ['hardcore', START_MODES.hardcore.capital, ['LFTZ']]);
  const second = await h.call('POST', `${V1}/me/companies`, { token: w.token, body: { name: 'Third Air', hub: 'LFMN', code: 'THR', callsign: 'THIRD', startMode: 'airliner' } });
  assert.equal(second.status, 201, second.text);
  const other = await reset(h, w.token, w.bystander);
  assert.equal(other.status, 409);
  assert.equal(other.body.error, 'onboarding_pending', 'the onboarding of the company being founded must not be repointed by a reset of another');
});

test('refused with 409 flight_active while a flight is in progress, for both actions, and nothing is touched; it works once the flight is over', async () => {
  const h = await harness();
  const a = await h.register('pilot', 'LFPG');
  const cid = a.me.company.id as number;
  await h.call('POST', `${V1}/me/companies`, { token: a.token, body: { name: 'Spare Air', hub: 'LFPG' } });
  const job = await h.flyableJob(a.token, a.me.fleet[0].id);
  const flight = await h.call('POST', `${V1}/jobs/${job.id}/accept`, { token: a.token, body: { aircraftId: a.me.fleet[0].id } });
  assert.equal(flight.status, 201, flight.text);
  const before = counts(h);
  assert.equal((await h.call('GET', `${V1}/companies/${cid}/impact`, { token: a.token })).body.flightActive, true);
  for (const r of [await del(h, a.token, cid), await reset(h, a.token, cid)]) {
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'flight_active');
  }
  assert.deepEqual(counts(h), before);
  assert.equal((await h.call('POST', `${V1}/flights/${flight.body.id}/cancel`, { token: a.token })).status, 200);
  assert.equal((await reset(h, a.token, cid, { startMode: 'hardcore' })).status, 200);
  assert.equal((await del(h, a.token, cid)).status, 204);
});

test('the password is re-checked: wrong, missing or empty is refused and nothing is deleted or reset', async () => {
  const h = await harness();
  const w = await world(h);
  const before = counts(h);
  assert.equal((await del(h, w.token, w.cid, 'not the password')).status, 403);
  assert.equal((await del(h, w.token, w.cid, 'not the password')).body.error, 'bad_password');
  assert.equal((await h.call('POST', `${V1}/companies/${w.cid}/reset`, { token: w.token, body: { password: 'nope', startMode: 'airliner' } })).status, 403);
  assert.equal((await h.call('DELETE', `${V1}/companies/${w.cid}`, { token: w.token })).status, 400);
  assert.equal((await del(h, w.token, w.cid, '')).status, 400);
  assert.equal((await h.call('POST', `${V1}/companies/${w.cid}/reset`, { token: w.token, body: { startMode: 'airliner' } })).status, 400);
  assert.deepEqual(counts(h), before);
});

test('only the owner, only with a session: another player 403, an AI company 403, an API key or no token 401', async () => {
  const h = await harness({ ai: true });
  const a = await h.register('owner');
  const b = await h.register('rival');
  const cid = a.me.company.id as number;
  const ai = get<{ id: number }>(h.db, 'SELECT id FROM companies WHERE user_id IS NULL ORDER BY id LIMIT 1')!.id;
  const key = await h.apiKey(a.token);
  const before = counts(h);
  for (const [token, id] of [[b.token, cid], [a.token, ai]] as const) {
    assert.equal((await del(h, token, id)).status, 403);
    assert.equal((await reset(h, token, id)).status, 403);
    assert.equal((await h.call('GET', `${V1}/companies/${id}/impact`, { token })).status, 403);
  }
  for (const token of [key, undefined]) {
    assert.equal((await h.call('DELETE', `${V1}/companies/${cid}`, { ...(token ? { token } : {}), body: { password: PASSWORD } })).status, 401);
    assert.equal((await h.call('POST', `${V1}/companies/${cid}/reset`, { ...(token ? { token } : {}), body: { password: PASSWORD, startMode: 'airliner' } })).status, 401);
  }
  assert.equal((await h.call('DELETE', `${V1}/companies/abc`, { token: a.token, body: { password: PASSWORD } })).status, 404);
  assert.deepEqual(counts(h), before);
});

test('deleting a company keeps the others; deleting the last one sends the player back to the onboarding', async () => {
  const h = await harness();
  const w = await world(h, { fill: false });
  assert.equal((await del(h, w.token, w.cid)).status, 204);
  const me = await h.call('GET', `${V1}/me`, { token: w.token });
  assert.equal(me.status, 200);
  assert.deepEqual(me.body.companies.map((c: { id: number }) => c.id), [w.bystander]);
  assert.equal((await h.call('GET', `${V1}/me`, { token: w.token, company: w.cid })).status, 403, 'the deleted id is no longer yours');

  assert.equal((await del(h, w.token, w.bystander)).status, 204);
  const gone = await h.call('GET', `${V1}/me`, { token: w.token });
  assert.equal(gone.status, 409);
  assert.equal(gone.body.error, 'no_company');
  assert.deepEqual((await h.call('GET', `${V1}/onboarding`, { token: w.token })).body, { completed: false, step: 1, startMode: null, companyId: null, draft: {} });
  const login = await h.call('POST', `${V1}/auth/login`, { body: { username: 'amy', password: PASSWORD } });
  assert.equal(login.body.onboarding.completed, false);
  const again = await h.call('POST', `${V1}/me/companies`, { token: w.token, body: { name: 'Second Wind', hub: 'LFMN', code: 'SEC', callsign: 'SECOND', startMode: 'hardcore' } });
  assert.equal(again.status, 201, again.text);
  assert.equal((await h.call('GET', `${V1}/onboarding`, { token: w.token })).body.companyId, again.body.company.id);
});

test('an unfinished onboarding company can be deleted while another company exists, and the freed name and code can be founded again', async () => {
  const h = await harness();
  const w = await world(h, { fill: false });
  assert.equal((await del(h, w.token, w.cid)).status, 204);
  const ob = (await h.call('GET', `${V1}/onboarding`, { token: w.token })).body;
  assert.equal(ob.companyId, null);
  const again = await h.call('POST', `${V1}/me/companies`, { token: w.token, body: { name: 'Azur Régional', hub: 'LFMN', code: 'AZR', callsign: 'AZUR', startMode: 'airliner' } });
  assert.equal(again.status, 201, again.text);
});
