import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_COMPANIES_PER_USER, OVERDRAFT_LIMIT, presetSetting, type GroupView } from '@opc/shared';
import { all as rows, get as one, MIGRATIONS, openDb, run, type Db } from './db.ts';
import { insertAircraft } from './fleet-extras.ts';
import { companyView } from './game.ts';
import { post } from './ledger.ts';
import { saveRealism } from './realism.ts';
import { applyBailout } from './start.ts';
import { cashView } from './reports.ts';
import { harness } from './harness.ts';

const V1 = '/api/v1';
const PASSWORD = 'correct horse';
const OCT = Date.UTC(2026, 9, 15);
type H = Awaited<ReturnType<typeof harness>>;

/** Rows as plain objects (node:sqlite returns null-prototype ones, which deepEqual tells from literals). */
const all = <T>(db: Db, sql: string, ...p: Parameters<typeof rows>[2][]): T[] => rows<T>(db, sql, ...p).map((r) => ({ ...r }));
const get = <T>(db: Db, sql: string, ...p: Parameters<typeof rows>[2][]): T | undefined => { const r = one<T>(db, sql, ...p); return r === undefined ? r : { ...r }; };

const sub = (name: string, code: string, over: Record<string, unknown> = {}) => ({ name, hub: 'LFMN', code, activity: 'cargo', ...over });

/** A player with a parent company (the starter C172 and the starting capital), and a second player who must never reach into hers. */
async function world() {
  const h = await harness();
  const a = await h.register('amy', 'LFPG');
  const b = await h.register('ben', 'LFPG');
  const parent = a.me.company.id as number;
  const balance = (id: number): number => get<{ balance: number }>(h.db, 'SELECT balance FROM companies WHERE id = ?', id)!.balance;
  const sumBalances = (): number => get<{ s: number }>(h.db, 'SELECT SUM(balance) AS s FROM companies')!.s;
  const found = (body: Record<string, unknown>, token = a.token, company?: number) => h.call('POST', `${V1}/group/subsidiaries`, { token, body, ...(company === undefined ? {} : { company }) });
  const transfer = (body: Record<string, unknown>, token = a.token) => h.call('POST', `${V1}/group/transfers`, { token, body });
  const owner = (aircraftId: number): number => get<{ company_id: number }>(h.db, 'SELECT company_id FROM aircraft WHERE id = ?', aircraftId)!.company_id;
  const companies = (): number => get<{ n: number }>(h.db, 'SELECT COUNT(*) AS n FROM companies')!.n;
  return { h, a, b, parent, starter: a.me.fleet[0].id as number, balance, sumBalances, found, transfer, owner, companies };
}
type W = Awaited<ReturnType<typeof world>>;

async function withSub(w: W, funding = 100_000, over: Record<string, unknown> = {}): Promise<number> {
  const r = await w.found(sub('Azur Cargo', 'AZC', { funding, ...over }));
  assert.equal(r.status, 201, r.text);
  return r.body.id as number;
}

// ---------------------------------------------------------------- founding (C21, C32)

test('a subsidiary is founded without a starting grant: funded only by a transfer from its parent, which both ledgers show; the labels are stored', async () => {
  const w = await world();
  const before = w.sumBalances(), parentBefore = w.balance(w.parent);
  const r = await w.found(sub('Azur Cargo', 'AZC', { iata: 'n7', activity: 'passengers', callsign: 'AZURCARGO', funding: 150_000 }));
  assert.equal(r.status, 201, r.text);
  const id = r.body.id as number;
  assert.equal(w.balance(id), 150_000);
  assert.equal(w.balance(w.parent), parentBefore - 150_000);
  assert.equal(w.sumBalances(), before, 'the money in the world is the same: nothing was granted');
  assert.deepEqual(all(w.h.db, 'SELECT kind, amount, counterparty_id AS cp FROM transactions WHERE company_id = ? ORDER BY id', id), [{ kind: 'group_transfer', amount: 150_000, cp: w.parent }]);
  assert.deepEqual(all(w.h.db, "SELECT amount, counterparty_id AS cp FROM transactions WHERE company_id = ? AND kind = 'group_transfer'", w.parent), [{ amount: -150_000, cp: id }]);
  assert.deepEqual(get(w.h.db, 'SELECT parent_id AS parent, code, iata, activity, callsign, start_mode AS mode, realism FROM companies WHERE id = ?', id), { parent: w.parent, code: 'AZC', iata: 'N7', activity: 'passengers', callsign: 'AZURCARGO', mode: null, realism: null });
  assert.equal(get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM aircraft WHERE company_id = ?', id)!.n, 0, 'no starter aircraft either');
  assert.deepEqual(r.body.group.companies.map((c: { id: number; role: string }) => [c.id, c.role]), [[w.parent, 'parent'], [id, 'subsidiary']]);
  assert.equal(get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM billing_runs WHERE company_id = ?', id)!.n, 1, 'billed like any player company');
});

test('founding with no funding books nothing at all: the subsidiary starts at zero', async () => {
  const w = await world();
  const id = await withSub(w, 0);
  assert.equal(w.balance(id), 0);
  assert.equal(get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM transactions WHERE company_id = ?', id)!.n, 0);
});

test('the 5-company cap counts subsidiaries: the fifth company is the last, a sixth is refused from either door, and nothing is founded or paid by a refusal', async () => {
  const w = await world();
  for (let i = 1; i < MAX_COMPANIES_PER_USER; i++) await withSub(w, 1_000, { name: `Sub ${i}`, code: `SB${String.fromCharCode(64 + i)}` });
  assert.equal(get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM companies WHERE user_id = (SELECT user_id FROM companies WHERE id = ?)', w.parent)!.n, MAX_COMPANIES_PER_USER);
  const before = { companies: w.companies(), sum: w.sumBalances(), parent: w.balance(w.parent) };
  const sixth = await w.found(sub('Sub Six', 'SBZ', { funding: 1_000 }));
  assert.equal(sixth.status, 409);
  assert.equal(sixth.body.error, 'limit_reached');
  assert.equal((await w.h.call('POST', `${V1}/me/companies`, { token: w.a.token, body: { name: 'Plain Six', hub: 'LFPG' } })).body.error, 'limit_reached');
  assert.deepEqual({ companies: w.companies(), sum: w.sumBalances(), parent: w.balance(w.parent) }, before);
  assert.equal((await w.h.call('GET', `${V1}/group`, { token: w.a.token })).body.createRefusal, 'limit_reached');
});

test('a subsidiary cannot found a subsidiary, and the refusal is shown by the view', async () => {
  const w = await world();
  const id = await withSub(w);
  const r = await w.found(sub('Grand Child', 'GCH'), w.a.token, id);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'is_subsidiary');
  const view = (await w.h.call('GET', `${V1}/group`, { token: w.a.token, company: id })).body as GroupView;
  assert.deepEqual([view.createRefusal, view.companies.map((c) => c.id)], ['is_subsidiary', [w.parent, id]], 'seen from the subsidiary, the group is the same group');
});

test('a funding the parent cannot pay founds nothing: it is held to spendable (balance plus the overdraft), like any payment', async () => {
  const w = await world();
  const spendable = w.balance(w.parent) + OVERDRAFT_LIMIT;
  const before = { companies: w.companies(), sum: w.sumBalances(), parent: w.balance(w.parent), txs: get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM transactions')!.n };
  const r = await w.found(sub('Too Rich', 'TRC', { funding: spendable + 1 }));
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'insufficient_funds');
  assert.equal(r.body.missing, 1);
  assert.deepEqual({ companies: w.companies(), sum: w.sumBalances(), parent: w.balance(w.parent), txs: get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM transactions')!.n }, before, 'the company row was rolled back with the refused transfer');
  assert.equal((await w.found(sub('Just Enough', 'JEN', { funding: spendable }))).status, 201);
  assert.equal(w.balance(w.parent), -OVERDRAFT_LIMIT);
});

test('the identity is validated: unknown code, taken name or code, bad IATA or activity, unknown airport', async () => {
  const w = await world();
  await withSub(w, 0);
  assert.equal((await w.found(sub('Other', 'OTH', { activity: 'nope' }))).status, 400);
  assert.equal((await w.found(sub('Other', 'OTH', { iata: 'N' }))).status, 400);
  assert.equal((await w.found(sub('Other', 'OTH', { funding: -5 }))).status, 400);
  assert.equal((await w.found({ name: 'Other', hub: 'LFMN', code: 'OTH' })).status, 400, 'the activity is required');
  assert.equal((await w.found(sub('Azur Cargo', 'OTH'))).body.error, 'name_taken');
  assert.equal((await w.found(sub('Other', 'AZC'))).body.error, 'code_taken');
  assert.equal((await w.found(sub('Other', 'OTH', { hub: 'ZZZZ' }))).status, 422);
  assert.equal(w.companies(), 3, 'amy, ben and the one subsidiary');
});

test('a subsidiary is hidden from the leaderboard, the current season and a past one, while the parent stays and its net worth includes the subsidiary', async () => {
  const w = await world();
  const id = await withSub(w, 100_000);
  const rows = (season?: string) => w.h.call('GET', `${V1}/leaderboard${season ? `?season=${season}` : ''}`).then((r) => r.body.rows as { companyId: number; netWorth: number }[]);
  const now = await rows();
  assert.deepEqual(now.map((r) => r.companyId).sort(), [w.a.me.company.id, w.b.me.company.id].sort());
  assert.equal(now.find((r) => r.companyId === w.parent)!.netWorth, companyView(w.h.db, w.parent).netWorth);
  assert.equal(companyView(w.h.db, w.parent).netWorth, w.balance(w.parent) + w.balance(id) + get<{ v: number }>(w.h.db, 'SELECT value AS v FROM aircraft WHERE id = ?', w.starter)!.v, 'parent cash + subsidiary cash + the starter aircraft at book value');
  for (const c of [w.parent, id]) run(w.h.db, "INSERT INTO season_stats (season, company_id, net_worth, flights, reputation) VALUES ('2026-10', ?, 1, 0, 50)", c);
  assert.deepEqual((await rows('2026-10')).map((r) => r.companyId), [w.parent]);
});

test('moving cash to a subsidiary leaves the parent\'s net worth unchanged: it owns the subsidiary, so the group neither gains nor loses', async () => {
  const w = await world();
  const id = await withSub(w, 0);
  const before = companyView(w.h.db, w.parent).netWorth;
  assert.equal((await w.transfer({ from: w.parent, to: id, cash: 123_456 })).status, 200);
  assert.equal(companyView(w.h.db, w.parent).netWorth, before);
  assert.equal((await w.transfer({ from: id, to: w.parent, cash: 23_456 })).status, 200);
  assert.equal(companyView(w.h.db, w.parent).netWorth, before);
});

// ---------------------------------------------------------------- transfers

test('a transfer between parent and subsidiary, either way, keeps the sum of balances and posts both sides tagged with the counterparty in one go', async () => {
  const w = await world();
  const id = await withSub(w, 40_000);
  const sum = w.sumBalances();
  const out = await w.transfer({ from: w.parent, to: id, cash: 25_000 });
  assert.equal(out.status, 200, out.text);
  const back = await w.transfer({ from: id, to: w.parent, cash: 60_000 });
  assert.equal(back.status, 200, back.text);
  assert.equal(w.sumBalances(), sum);
  assert.equal(w.balance(id), 40_000 + 25_000 - 60_000);
  const t = all<{ company_id: number; amount: number; counterparty_id: number; kind: string }>(w.h.db, "SELECT company_id, amount, counterparty_id, kind FROM transactions WHERE kind = 'group_transfer' ORDER BY id");
  assert.deepEqual(t.slice(2).map((x) => [x.company_id, x.amount, x.counterparty_id]), [[w.parent, -25_000, id], [id, 25_000, w.parent], [id, -60_000, w.parent], [w.parent, 60_000, id]]);
  assert.equal(back.body.total.balance, w.balance(w.parent) + w.balance(id), 'the answer is the refreshed group');
});

test('the sender is held to spendable: a subsidiary at zero can draw its overdraft and no more, and a refused transfer moves nothing', async () => {
  const w = await world();
  const id = await withSub(w, 10_000);
  const sum = w.sumBalances();
  const refused = await w.transfer({ from: id, to: w.parent, cash: 10_000 + OVERDRAFT_LIMIT + 1 });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'insufficient_funds');
  assert.equal(refused.body.missing, 1);
  assert.equal(w.balance(id), 10_000);
  assert.equal((await w.transfer({ from: id, to: w.parent, cash: 10_000 + OVERDRAFT_LIMIT })).status, 200);
  assert.equal(w.balance(id), -OVERDRAFT_LIMIT);
  assert.equal(w.sumBalances(), sum, 'a debt moved, no money was made');
});

test('only a parent and its own subsidiary exchange anything: siblings, two unrelated companies and a stranger\'s subsidiary are refused', async () => {
  const w = await world();
  const s1 = await withSub(w, 10_000);
  const s2 = await withSub(w, 10_000, { name: 'Azur Regional', code: 'AZG' });
  const spare = (await w.h.call('POST', `${V1}/me/companies`, { token: w.a.token, body: { name: 'Spare Air', hub: 'LFPG' } })).body.company.id as number;
  const spareSub = (await w.found(sub('Spare Sub', 'SPS'), w.a.token, spare)).body.id as number;
  const sum = w.sumBalances();
  for (const [from, to] of [[s1, s2], [s2, s1], [w.parent, spare], [spare, w.parent], [w.parent, spareSub], [spareSub, w.parent], [s1, spareSub]]) {
    const r = await w.transfer({ from, to, cash: 100 });
    assert.deepEqual([r.status, r.body.error], [409, 'not_in_group'], `${from} -> ${to}`);
  }
  assert.equal(w.sumBalances(), sum);
  assert.equal((await w.transfer({ from: spare, to: spareSub, cash: 100 })).status, 200, 'each parent reaches its own subsidiary');
});

test('both companies are authorised for the player, not through the active-company header: another player\'s company is 403 on either side', async () => {
  const w = await world();
  const id = await withSub(w, 10_000);
  const strangerSub = (await w.found(sub('Ben Cargo', 'BNC'), w.b.token)).body.id as number;
  const sum = w.sumBalances();
  for (const body of [{ from: w.parent, to: strangerSub }, { from: strangerSub, to: w.parent }, { from: w.b.me.company.id, to: id }, { from: id, to: w.b.me.company.id }, { from: 9999, to: id }]) {
    const r = await w.transfer({ ...body, cash: 100 });
    assert.deepEqual([r.status, r.body.error], [403, 'not_your_company'], JSON.stringify(body));
  }
  assert.equal(w.sumBalances(), sum);
  const other = await w.h.call('POST', `${V1}/group/transfers`, { token: w.b.token, company: w.b.me.company.id, body: { from: w.parent, to: id, cash: 100 } });
  assert.equal(other.status, 403, 'ben cannot move amy\'s money with his own header');
});

test('auth: no token and an API key are 401 on every group route, another player\'s company header is 403, a bad body is 400', async () => {
  const w = await world();
  const id = await withSub(w, 10_000);
  const key = await w.h.apiKey(w.a.token);
  for (const [method, url, body] of [['GET', '/group', undefined], ['POST', '/group/subsidiaries', sub('X Air', 'XXA')], ['POST', '/group/transfers', { from: w.parent, to: id, cash: 1 }]] as const) {
    assert.equal((await w.h.call(method, `${V1}${url}`, { ...(body ? { body } : {}) })).status, 401, `${url} without a token`);
    assert.equal((await w.h.call(method, `${V1}${url}`, { token: key, ...(body ? { body } : {}) })).status, 401, `${url} with an API key`);
  }
  assert.equal((await w.h.call('GET', `${V1}/group`, { token: w.b.token, company: w.parent })).status, 403);
  for (const bad of [{ from: w.parent, to: w.parent, cash: 5 }, { from: w.parent, to: id }, { from: w.parent, to: id, cash: -1 }, { from: w.parent, to: id, cash: 1.5 }, { from: 'x', to: id, cash: 1 }]) {
    assert.equal((await w.transfer(bad)).status, 400, JSON.stringify(bad));
  }
});

// ---------------------------------------------------------------- aircraft cession (C33)

test('an idle owned aircraft is ceded at book value: it keeps its registration, value and wear, the cession creates and destroys no money, and the subsidiary can then fly it', async () => {
  const w = await world();
  const id = await withSub(w, 0);
  const row = () => get<{ company_id: number; registration: string; value: number; base: string; wear_pct: number }>(w.h.db, 'SELECT company_id, registration, value, base, wear_pct FROM aircraft WHERE id = ?', w.starter)!;
  const was = row();
  const [sum, txs] = [w.sumBalances(), get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM transactions')!.n];
  const netWorth = companyView(w.h.db, w.parent).netWorth;
  const r = await w.transfer({ from: w.parent, to: id, aircraftIds: [w.starter] });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(row(), { ...was, company_id: id, base: 'LFMN' }, 'only the owner (and the base, since the subsidiary has no LFPG hub) changed');
  assert.deepEqual([w.sumBalances(), get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM transactions')!.n], [sum, txs], 'no posting, no money');
  assert.equal(companyView(w.h.db, w.parent).netWorth, netWorth, 'the group owns the same');
  assert.deepEqual(r.body.companies.map((c: { id: number; aircraft: number }) => [c.id, c.aircraft]), [[w.parent, 0], [id, 1]]);
  const mine = (await w.h.call('GET', `${V1}/me`, { token: w.a.token, company: id })).body.fleet;
  assert.deepEqual(mine.map((f: { id: number }) => f.id), [w.starter]);
  const back = await w.transfer({ from: id, to: w.parent, aircraftIds: [w.starter] });
  assert.equal(back.status, 200, 'and back');
  assert.equal(w.owner(w.starter), w.parent);
});

test('a financed aircraft is ceded with its loan: the instalments follow it, the debt of the group is unchanged', async () => {
  const w = await world();
  const id = await withSub(w, 0);
  const ac = insertAircraft(w.h.db, { companyId: w.parent, icao: 'AT76', hub: 'LFPG', value: 1_000_000, ownership: 'financed', at: w.h.clock.t });
  run(w.h.db, "INSERT INTO contracts (company_id, aircraft_id, kind, started_at, months, monthly, principal) VALUES (?, ?, 'loan', ?, 36, 28_000, 900000)", w.parent, ac, w.h.clock.t);
  const r = await w.transfer({ from: w.parent, to: id, aircraftIds: [ac] });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(all(w.h.db, "SELECT company_id AS cid, principal FROM contracts WHERE aircraft_id = ? AND kind = 'loan'", ac), [{ cid: id, principal: 900_000 }]);
});

test('cession guards: leased, club and rented aircraft, a flight in progress, a line, a workshop stay and a foreign or unknown aircraft are all refused, and nothing moves', async () => {
  const w = await world();
  const id = await withSub(w, 0);
  const at = w.h.clock.t;
  const add = (ownership: 'leased' | 'club' | 'rented' | 'owned') => insertAircraft(w.h.db, { companyId: w.parent, icao: 'AT76', hub: 'LFPG', value: 500_000, ownership, at });
  const [leased, club, rented, workshop, online] = [add('leased'), add('club'), add('rented'), add('owned'), add('owned')];
  run(w.h.db, "UPDATE aircraft SET status = 'maintenance', maintenance_until = ? WHERE id = ?", at + 86_400_000, workshop);
  const line = await w.h.call('POST', `${V1}/lines`, { token: w.a.token, body: { a: 'LFPG', b: 'LFLL', freqPerDay: 2, days: Array(7).fill(true), windowStart: '06:00', windowEnd: '18:00', aircraftIds: [online] } });
  assert.equal(line.status, 201, line.text);
  const job = await w.h.flyableJob(w.a.token, w.starter);
  assert.equal((await w.h.call('POST', `${V1}/jobs/${job.id}/accept`, { token: w.a.token, body: { aircraftId: w.starter } })).status, 201);
  const strangers = w.b.me.fleet[0].id as number;
  const sum = w.sumBalances();
  const expected: [number, number, string][] = [[leased, 409, 'leased_aircraft'], [club, 409, 'leased_aircraft'], [rented, 409, 'leased_aircraft'], [workshop, 409, 'in_maintenance'], [online, 409, 'aircraft_on_line'], [w.starter, 409, 'aircraft_busy'], [strangers, 404, 'aircraft_not_found'], [99_999, 404, 'aircraft_not_found']];
  for (const [aircraft, status, error] of expected) {
    const r = await w.transfer({ from: w.parent, to: id, aircraftIds: [aircraft] });
    assert.deepEqual([r.status, r.body.error], [status, error], `aircraft ${aircraft}`);
  }
  assert.deepEqual([leased, club, rented, workshop, online, w.starter].map(w.owner), Array(6).fill(w.parent));
  assert.equal(w.sumBalances(), sum);
  const fleet = ((await w.h.call('GET', `${V1}/group`, { token: w.a.token })).body as GroupView).companies[0]!.fleet;
  assert.deepEqual(Object.fromEntries(fleet.map((f) => [f.id, f.cession])), { [leased]: 'leased_aircraft', [club]: 'leased_aircraft', [rented]: 'leased_aircraft', [workshop]: 'in_maintenance', [online]: 'aircraft_on_line', [w.starter]: 'aircraft_busy' }, 'the view says why, before the player tries');
});

test('a batch is all or nothing: a refused aircraft undoes the cash and the aircraft before it, and a short balance undoes the aircraft', async () => {
  const w = await world();
  const id = await withSub(w, 0);
  const idle = insertAircraft(w.h.db, { companyId: w.parent, icao: 'AT76', hub: 'LFPG', value: 500_000, ownership: 'owned', at: w.h.clock.t });
  const leased = insertAircraft(w.h.db, { companyId: w.parent, icao: 'AT76', hub: 'LFPG', value: 500_000, ownership: 'leased', at: w.h.clock.t });
  const state = () => [w.balance(w.parent), w.balance(id), w.owner(idle), w.owner(leased), get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM transactions')!.n];
  const before = state();
  const r1 = await w.transfer({ from: w.parent, to: id, cash: 5_000, aircraftIds: [idle, leased] });
  assert.deepEqual([r1.status, r1.body.error], [409, 'leased_aircraft']);
  assert.deepEqual(state(), before);
  const r2 = await w.transfer({ from: w.parent, to: id, cash: w.balance(w.parent) + OVERDRAFT_LIMIT + 1, aircraftIds: [idle] });
  assert.deepEqual([r2.status, r2.body.error], [409, 'insufficient_funds']);
  assert.deepEqual(state(), before);
  const ok = await w.transfer({ from: w.parent, to: id, cash: 5_000, aircraftIds: [idle] });
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual([w.balance(id), w.owner(idle)], [5_000, id]);
  const twice = await w.transfer({ from: w.parent, to: id, aircraftIds: [idle, idle] });
  assert.equal(twice.status, 400, 'the same aircraft twice is a bad request');
});

test('founding with aircraft cedes them in the same transaction, and a refused aircraft founds nothing', async () => {
  const w = await world();
  const refused = await w.found(sub('Azur Cargo', 'AZC', { aircraftIds: [w.b.me.fleet[0].id] }));
  assert.equal(refused.status, 404);
  assert.equal(w.companies(), 2, 'no company was left behind');
  const ok = await w.found(sub('Azur Cargo', 'AZC', { aircraftIds: [w.starter], funding: 1_000 }));
  assert.equal(ok.status, 201, ok.text);
  assert.equal(w.owner(w.starter), ok.body.id);
});

test('a cession respects the subsidiary\'s parking: a hub with no free spot refuses the aircraft', async () => {
  const w = await world();
  const id = await withSub(w, 0);
  const ids = Array.from({ length: 11 }, () => insertAircraft(w.h.db, { companyId: w.parent, icao: 'C172', hub: 'LFMN', value: 10_000, ownership: 'owned', at: w.h.clock.t }));
  run(w.h.db, 'INSERT INTO hubs (company_id, icao) VALUES (?, ?)', w.parent, 'LFMN');
  const r = await w.transfer({ from: w.parent, to: id, aircraftIds: ids });
  assert.deepEqual([r.status, r.body.error], [409, 'hub_full']);
  assert.deepEqual(ids.map(w.owner), Array(11).fill(w.parent));
  assert.equal((await w.transfer({ from: w.parent, to: id, aircraftIds: ids.slice(0, 10) })).status, 200);
});

// ---------------------------------------------------------------- the consolidated view

test('the consolidated view is the sum of each company\'s own cash report; what the group moves between its companies is not a result, and the figures the view shows are the reports\'', async () => {
  const w = await world();
  const id = await withSub(w, 0);
  const seed = (cid: number, at: number, kind: string, amount: number, cp?: number) => post(w.h.db, cid, at, kind, amount, 'seed', null, cp === undefined ? {} : { counterpartyId: cp });
  seed(w.parent, OCT, 'line_revenue', 120_000); seed(w.parent, OCT + 1, 'fuel', -20_000); seed(w.parent, OCT + 2, 'group_transfer', -50_000, id);
  seed(id, OCT, 'line_revenue', 30_000); seed(id, OCT + 1, 'payroll', -10_000); seed(id, OCT + 2, 'group_transfer', 50_000, w.parent);
  const view = (await w.h.call('GET', `${V1}/group`, { token: w.a.token })).body as GroupView;
  assert.equal(view.month, '2026-10');
  assert.deepEqual(view.companies.map((c) => c.month), [{ revenue: 120_000, spend: 20_000, result: 100_000 }, { revenue: 30_000, spend: 10_000, result: 20_000 }]);
  assert.deepEqual([view.total.revenue, view.total.spend, view.total.result], [150_000, 30_000, 120_000]);
  assert.equal(view.total.balance, view.companies.reduce((t, c) => t + c.balance, 0));
  assert.equal(view.total.balance, w.sumBalances() - w.balance(w.b.me.company.id), 'amy\'s group, not ben\'s company');
  for (const c of view.companies) assert.equal(c.month.revenue, cashView(w.h.db, c.id, w.h.clock.t, 2).months.find((m) => m.month === '2026-10')!.revenue, 'the revenue is the cash report\'s');
  assert.equal(view.total.netWorth, companyView(w.h.db, w.parent).netWorth);
  assert.deepEqual([view.total.aircraft, view.total.staff, view.total.lines], [1, 0, 0]);
  assert.deepEqual(view.companies.map((c) => [c.name, c.code, c.activity, c.hub]), [['amy Aviation', null, null, 'LFPG'], ['Azur Cargo', 'AZC', 'cargo', 'LFMN']]);
  const same = (await w.h.call('GET', `${V1}/group`, { token: w.a.token, company: id })).body as GroupView;
  assert.deepEqual(same.total, view.total);
});

test('a transfer is not part of the runway: the cash report does not count capital as burn, so funding a subsidiary does not shorten the parent\'s days', async () => {
  const w = await world();
  const id = await withSub(w, 0);
  post(w.h.db, w.parent, OCT, 'fuel', -30_000, 'seed');
  const days = () => cashView(w.h.db, w.parent, w.h.clock.t, 3).runwayDays;
  const before = days();
  post(w.h.db, w.parent, OCT + 1, 'group_transfer', -50_000, 'seed', null, { counterpartyId: id });
  assert.equal(days(), cashView(w.h.db, w.parent, w.h.clock.t, 3).runwayDays);
  assert.ok(before !== null);
});

// ---------------------------------------------------------------- lifecycle (company-lifecycle.ts)

const del = (w: W, id: number, token = w.a.token) => w.h.call('DELETE', `${V1}/companies/${id}`, { token, body: { password: PASSWORD } });

test('deleting a parent that still has subsidiaries is refused with 409 has_subsidiaries and changes nothing; resetting it is refused too', async () => {
  const w = await world();
  const id = await withSub(w, 10_000);
  const before = [w.companies(), w.sumBalances(), w.owner(w.starter)];
  const r = await del(w, w.parent);
  assert.deepEqual([r.status, r.body.error], [409, 'has_subsidiaries']);
  const reset = await w.h.call('POST', `${V1}/companies/${w.parent}/reset`, { token: w.a.token, body: { password: PASSWORD, startMode: 'airliner' } });
  assert.deepEqual([reset.status, reset.body.error], [409, 'has_subsidiaries']);
  assert.deepEqual([w.companies(), w.sumBalances(), w.owner(w.starter)], before);
  assert.equal((await del(w, id)).status, 204);
  assert.equal((await del(w, w.parent)).status, 204, 'once nothing hangs off it, it can go');
});

test('deleting a subsidiary dissolves it into its parent: its cash, a debt included, and the aircraft it owns go back, so nothing is burned and no overdraft is wiped', async () => {
  const w = await world();
  const id = await withSub(w, 40_000);
  await w.transfer({ from: w.parent, to: id, aircraftIds: [w.starter] });
  assert.equal((await w.transfer({ from: id, to: w.parent, cash: 40_000 + 60_000 })).status, 200);
  assert.equal(w.balance(id), -60_000);
  const sum = w.sumBalances();
  const r = await del(w, id);
  assert.equal(r.status, 204);
  assert.equal(w.sumBalances(), sum, 'the subsidiary\'s -60 000 left the sum with its row and came back to the parent as a charge: the debt is the group\'s, not wiped');
  assert.equal(w.owner(w.starter), w.parent);
  assert.equal(get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM companies WHERE parent_id IS NOT NULL')!.n, 0);
  assert.deepEqual(all(w.h.db, 'PRAGMA foreign_key_check'), []);
});

test('a subsidiary that still owes (a loan on an aircraft) cannot be deleted: the cascade would wipe the debt while the parent kept the cash', async () => {
  const w = await world();
  const id = await withSub(w, 0);
  const ac = insertAircraft(w.h.db, { companyId: w.parent, icao: 'AT76', hub: 'LFPG', value: 1_000_000, ownership: 'financed', at: w.h.clock.t });
  run(w.h.db, "INSERT INTO contracts (company_id, aircraft_id, kind, started_at, months, monthly, principal) VALUES (?, ?, 'loan', ?, 36, 28000, 900000)", w.parent, ac, w.h.clock.t);
  assert.equal((await w.transfer({ from: w.parent, to: id, aircraftIds: [ac] })).status, 200);
  const r = await del(w, id);
  assert.deepEqual([r.status, r.body.error], [409, 'has_debt']);
  assert.equal(w.owner(ac), id);
});

test('a subsidiary cannot be reset (it would be re-founded with a starting capital), and another player cannot delete it', async () => {
  const w = await world();
  const id = await withSub(w, 0);
  const reset = await w.h.call('POST', `${V1}/companies/${id}/reset`, { token: w.a.token, body: { password: PASSWORD, startMode: 'hardcore' } });
  assert.deepEqual([reset.status, reset.body.error], [409, 'is_subsidiary']);
  assert.equal(w.balance(id), 0);
  assert.equal((await del(w, id, w.b.token)).status, 403);
});

test('deleting the account takes the subsidiaries with it: no orphan row is left in any table', async () => {
  const w = await world();
  const id = await withSub(w, 25_000);
  const ac = insertAircraft(w.h.db, { companyId: id, icao: 'AT76', hub: 'LFMN', value: 1, ownership: 'owned', at: w.h.clock.t });
  assert.ok(ac > 0);
  const r = await w.h.call('DELETE', `${V1}/me`, { token: w.a.token, body: { password: PASSWORD } });
  assert.equal(r.status, 204, r.text);
  assert.equal(get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM companies WHERE id IN (?, ?)', w.parent, id)!.n, 0);
  assert.equal(get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM aircraft WHERE company_id = ?', id)!.n, 0);
  assert.equal(get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM transactions WHERE company_id = ?', id)!.n, 0);
  assert.deepEqual(all(w.h.db, 'PRAGMA foreign_key_check'), []);
});

// ---------------------------------------------------------------- no farming

test('no bailout for a subsidiary: its overdraft is the group\'s debt, a bailout per subsidiary would be a grant per subsidiary', async () => {
  const w = await world();
  const id = await withSub(w, 0);
  for (const c of [w.parent, id]) saveRealism(w.h.db, c, presetSetting('relaxed'));
  post(w.h.db, id, w.h.clock.t, 'fuel', -5_000, 'seed');
  post(w.h.db, w.parent, w.h.clock.t, 'fuel', -(w.balance(w.parent) + 5_000), 'seed');
  assert.equal(applyBailout(w.h.db, id, w.h.clock.t), 0);
  assert.equal(w.balance(id), -5_000);
  assert.equal(applyBailout(w.h.db, w.parent, w.h.clock.t), 5_000, 'the parent keeps the rule its realism chose');
});

test('a subsidiary takes its parent\'s realism and start mode, and its reputation starts like any company\'s', async () => {
  const w = await world();
  saveRealism(w.h.db, w.parent, presetSetting('hardcore'));
  run(w.h.db, "UPDATE companies SET start_mode = 'hardcore' WHERE id = ?", w.parent);
  const id = await withSub(w, 0);
  assert.deepEqual(get(w.h.db, 'SELECT start_mode AS m, realism AS r FROM companies WHERE id = ?', id), { m: 'hardcore', r: get<{ r: string }>(w.h.db, 'SELECT realism AS r FROM companies WHERE id = ?', w.parent)!.r });
});

// ---------------------------------------------------------------- migration

test('migration GROUP adds the parent link and the labels to a database at the previous version, and a parent takes its subsidiaries with it when it is removed', () => {
  const at = MIGRATIONS.findIndex((m) => m.includes('parent_id'));
  assert.ok(at > 0, 'found by content, not by position');
  const file = join(mkdtempSync(join(tmpdir(), 'opc-group-')), 'prev.sqlite');
  const raw = new DatabaseSync(file);
  for (let i = 0; i < at; i++) raw.exec(MIGRATIONS[i]!);
  raw.exec(`PRAGMA user_version = ${at}`);
  raw.exec(`INSERT INTO users (id, username, pass_hash, created_at) VALUES (1, 'a', 'h', 1);
    INSERT INTO companies (id, user_id, name, balance, reputation, created_at) VALUES (1, 1, 'A Air', 1, 50, 1);`);
  raw.close();
  const db = openDb(file);
  assert.equal(get<{ user_version: number }>(db, 'PRAGMA user_version')!.user_version, MIGRATIONS.length);
  assert.deepEqual(get(db, 'SELECT parent_id, iata, activity FROM companies WHERE id = 1'), { parent_id: null, iata: null, activity: null }, 'an existing company is a root with no label');
  run(db, "INSERT INTO companies (id, user_id, name, balance, reputation, created_at, parent_id, activity) VALUES (2, 1, 'A Cargo', 0, 50, 1, 1, 'cargo')");
  assert.throws(() => run(db, "INSERT INTO companies (id, user_id, name, balance, reputation, created_at, activity) VALUES (3, 1, 'Bad', 0, 50, 1, 'balloons')"), /CHECK/);
  run(db, 'DELETE FROM companies WHERE id = 1');
  assert.equal(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM companies')!.n, 0);
});
