import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Leaderboard, NetworkView, StatementView, Transaction } from '@opc/shared';
import { get as one, run } from './db.ts';
import { insertAircraft } from './fleet-extras.ts';
import { post } from './ledger.ts';
import { harness } from './harness.ts';

const V1 = '/api/v1';
const NOW = Date.UTC(2026, 10, 4, 12, 0, 0);
const HOUR = 3_600_000;

/** AMERICA (a parent with starting capital) and America Cargo (its subsidiary, founded with a 100 000 transfer), a second player ben with his own company, and a rival parent of ben's. */
async function world() {
  const h = await harness();
  const a = await h.register('amy', 'LFPG');
  const b = await h.register('ben', 'LFPG');
  const parent = a.me.company.id as number;
  const made = await h.call('POST', `${V1}/group/subsidiaries`, { token: a.token, body: { name: 'America Cargo', hub: 'LFMN', code: 'AMC', activity: 'cargo', funding: 100_000 } });
  assert.equal(made.status, 201, made.text);
  const sub = made.body.id as number;
  const line = (company: number, a: string, b: string): number => run(h.db, `INSERT INTO lines (company_id, a, b, created_at, freq_per_day, days, window_start_min, window_end_min, turnaround_min, flight_base) VALUES (?, ?, ?, 1, 3, 127, 360, 1080, 30, ?)`, company, a, b, 1000 + company * 100).id;
  const gets = <T>(url: string, token = a.token, company?: number) => h.call('GET', `${V1}${url}`, { token, ...(company === undefined ? {} : { company }) }).then((r) => ({ ...r, body: r.body as T }));
  const tx = (company: number, at: number, kind: string, amount: number) => post(h.db, company, at, kind, amount, `${kind} ${at}`);
  return { h, a, b, parent, sub, line, gets, tx };
}

test('company scope is the default and shows only the company\'s own rows; group scope adds the subsidiary\'s, newest first, each tagged', async () => {
  const w = await world();
  w.tx(w.parent, NOW + 1 * HOUR, 'line_revenue', 500);
  w.tx(w.sub, NOW + 2 * HOUR, 'line_revenue', 700);
  w.tx(w.parent, NOW + 3 * HOUR, 'fuel', -50);
  const own = (await w.gets<Transaction[]>('/me/transactions?limit=200')).body;
  assert.ok(own.length > 0 && own.every((t) => t.companyId === w.parent && t.companyName.length > 0), 'the default scope is the company alone');
  assert.ok(!own.some((t) => t.amount === 700));
  const group = (await w.gets<Transaction[]>('/me/transactions?limit=200&scope=group')).body;
  assert.deepEqual(group.slice(0, 3).map((t) => [t.companyId, t.amount]), [[w.parent, -50], [w.sub, 700], [w.parent, 500]]);
  assert.equal(group[1]!.companyName, 'America Cargo');
  assert.equal(group.length, own.length + (await w.gets<Transaction[]>('/me/transactions?limit=200', w.a.token, w.sub)).body.length, 'the group is the two books');
  const order = group.map((t) => [t.at, t.id]);
  assert.deepEqual(order, [...order].sort((x, y) => y[0]! - x[0]! || y[1]! - x[1]!), 'ordered by at desc, id desc');
});

test('pagination walks the merged set: every row once, none missed, across the page boundary', async () => {
  const w = await world();
  for (let i = 0; i < 7; i++) { w.tx(w.parent, NOW + (2 * i) * HOUR, 'line_revenue', 10 + i); w.tx(w.sub, NOW + (2 * i + 1) * HOUR, 'line_revenue', 100 + i); }
  const all = (await w.gets<Transaction[]>('/me/transactions?limit=200&scope=group')).body;
  const seen: number[] = [];
  for (let before: number | undefined; ;) {
    const page = (await w.gets<Transaction[]>(`/me/transactions?limit=4&scope=group${before ? `&before=${before}` : ''}`)).body;
    seen.push(...page.map((t) => t.id));
    if (page.length < 4) break;
    before = page.at(-1)!.id;
  }
  assert.deepEqual(seen, all.map((t) => t.id));
  assert.equal(new Set(seen).size, all.length);
});

test('a subsidiary asking for the group gets only itself: its parent and siblings are not reachable', async () => {
  const w = await world();
  w.tx(w.parent, NOW + HOUR, 'line_revenue', 500);
  w.tx(w.sub, NOW + 2 * HOUR, 'line_revenue', 700);
  const rows = (await w.gets<Transaction[]>('/me/transactions?limit=200&scope=group', w.a.token, w.sub)).body;
  assert.ok(rows.length > 0 && rows.every((t) => t.companyId === w.sub), 'only its own book');
  const view = (await w.gets<StatementView>('/finance/ledger?scope=group&limit=200', w.a.token, w.sub)).body;
  assert.equal(view.subsidiaries, 0);
  assert.deepEqual([...new Set(view.days.flatMap((d) => d.rows.map((r) => r.companyId)))], [w.sub]);
  const net = (await w.gets<NetworkView>('/network?scope=group', w.a.token, w.sub)).body;
  assert.deepEqual(net.companies.map((c) => c.id), [w.sub]);
  assert.ok(!rows.some((t) => t.amount === 500));
});

test('another user reads nothing of the group: not by scope, not by naming its company', async () => {
  const w = await world();
  const anon = await w.h.call('GET', `${V1}/me/transactions?scope=group`);
  assert.equal(anon.status, 401);
  const mine = (await w.gets<Transaction[]>('/me/transactions?limit=200&scope=group', w.b.token)).body;
  assert.ok(mine.every((t) => t.companyId === (w.b.me.company.id as number)), 'ben\'s group scope is ben\'s company');
  assert.equal((await w.gets('/me/transactions?scope=group', w.b.token, w.parent)).status, 403, 'acting as amy\'s company is refused');
  assert.equal((await w.gets('/me/transactions?scope=group', w.b.token, w.sub)).status, 403);
  assert.equal((await w.h.call('GET', `${V1}/me/export?format=transactions.csv&scope=group`, { token: w.b.token, company: w.parent })).status, 403);
  assert.equal((await w.gets('/network?scope=group', w.b.token, w.parent)).status, 403);
  assert.equal((await w.gets('/me/transactions?scope=everything')).status, 400, 'an unknown scope is refused');
});

test('group totals are consolidated and leave group_transfer out; the transfer itself stays listed on both books, tagged', async () => {
  const w = await world();
  const revenueAt = NOW + 20 * 24 * HOUR;
  w.tx(w.parent, revenueAt, 'line_revenue', 500);
  w.tx(w.sub, revenueAt + HOUR, 'line_revenue', 700);
  w.tx(w.sub, revenueAt + 2 * HOUR, 'fuel', -100);
  const own = (await w.gets<StatementView>('/finance/ledger?limit=200')).body;
  const grp = (await w.gets<StatementView>('/finance/ledger?limit=200&scope=group')).body;
  const rows = grp.days.flatMap((d) => d.rows);
  const transfers = rows.filter((r) => r.kind === 'group_transfer');
  assert.equal(transfers.length, 2, 'both legs of the founding transfer are kept');
  assert.ok(transfers.every((r) => r.internal === true));
  assert.deepEqual(transfers.map((r) => r.amount).sort((x, y) => x - y), [-100_000, 100_000]);
  assert.ok(own.days.flatMap((d) => d.rows).filter((r) => r.kind === 'group_transfer').every((r) => r.internal === undefined), 'on a single book a transfer is a real movement');
  // the day nets, the summary and the cash read as the consolidated result
  assert.equal(grp.summary.in - own.summary.in, 700, 'the subsidiary\'s revenue is added; its 100 000 funding is not income');
  assert.equal(grp.summary.out - own.summary.out, 100 - 100_000, 'its fuel is added to the spend, and the parent\'s 100 000 sent to it is taken out');
  assert.equal(grp.summary.net, own.summary.net + 700 - 100 + 100_000, 'the parent\'s side of the transfer is not spend any more');
  assert.equal(grp.summary.count, rows.length, 'the count is the rows listed');
  const capital = (v: StatementView) => v.summary.byCategory.find((c) => c.category === 'capital');
  assert.deepEqual(capital(grp), { ...capital(own)!, out: 0 }, 'the capital line holds the starting grant only: not a cent of the transfer');
  assert.equal(capital(own)!.out, 100_000, 'while the parent alone sees its transfer as an outflow');
  assert.equal(grp.balance, (one<{ s: number }>(w.h.db, 'SELECT SUM(balance) AS s FROM companies WHERE id IN (?, ?)', w.parent, w.sub))!.s);
  assert.equal(own.subsidiaries, 1); assert.equal(grp.subsidiaries, 1);
  const dayNet = grp.days.reduce((s, d) => s + d.net, 0);
  assert.equal(dayNet, grp.summary.net, 'the day nets add up to the summary');
  assert.equal(rows.at(-1)!.balanceAfter, grp.balance - rows.slice(0, -1).reduce((s, r) => s + (r.internal ? 0 : r.amount), 0), 'the running balance is the group\'s cash, a transfer between its companies not moving it');
});

test('the CSV honours the scope: the company column appears in group scope only', async () => {
  const w = await world();
  w.tx(w.sub, NOW + HOUR, 'line_revenue', 700);
  const csv = (q: string) => w.h.call('GET', `${V1}/me/export?format=transactions.csv${q}`, { token: w.a.token });
  const own = (await csv('')).text.split('\r\n');
  assert.equal(own[0], 'id,at,kind,amount,balanceAfter,flightId,memo');
  assert.ok(!own.some((l) => l.includes(',line_revenue,700,')), 'the subsidiary\'s revenue is not in the company\'s CSV');
  const grp = (await csv('&scope=group')).text.split('\r\n').filter(Boolean);
  assert.equal(grp[0], 'id,at,kind,amount,balanceAfter,flightId,memo,company,internal');
  assert.ok(grp.some((l) => l.includes(',line_revenue,700,') && l.endsWith(',America Cargo,')), 'the subsidiary\'s revenue is tagged with its company');
  const legs = grp.filter((l) => l.includes(',group_transfer,'));
  assert.equal(legs.length, 2);
  assert.ok(legs.every((l) => l.endsWith(',yes')), 'transfers inside the group are flagged');
  const alone = (await w.h.call('GET', `${V1}/me/export?format=transactions.csv&scope=group`, { token: w.a.token, company: w.sub })).text.split('\r\n');
  assert.ok(alone[0]!.endsWith('company,internal'));
  assert.ok(alone.filter((l) => l && !l.startsWith('id,')).every((l) => l.endsWith(',America Cargo,') || l.endsWith(',America Cargo,yes')), 'a subsidiary\'s group CSV holds its own rows only');
});

test('network: group scope adds the subsidiary\'s lines, hubs and aircraft in the air, tagged by company; company scope does not; a subsidiary cannot see its parent', async () => {
  const w = await world();
  const own = w.line(w.parent, 'LFLL', 'LFPG');
  const theirs = w.line(w.sub, 'LFMN', 'LFPG');
  const ac = insertAircraft(w.h.db, { companyId: w.sub, icao: 'AT76', hub: 'LFMN', value: 1_000_000, ownership: 'owned', at: NOW });
  run(w.h.db, 'INSERT INTO line_aircraft (line_id, aircraft_id, home) VALUES (?, ?, ?)', theirs, ac, 'LFMN');
  run(w.h.db, `INSERT INTO scheduled_flights (line_id, company_id, aircraft_id, flight_no, dep_at, arr_at, origin, dest, status) VALUES (?, ?, ?, 1, ?, ?, 'LFMN', 'LFPG', 'done')`, theirs, w.sub, ac, NOW - HOUR, NOW + HOUR);
  const company = (await w.gets<NetworkView>('/network')).body;
  assert.deepEqual(company.lines.map((l) => l.id), [own]);
  assert.equal(company.flying.length, 0);
  assert.equal(company.subsidiaries, 1, 'the toggle is offered even in company scope');
  assert.equal(company.companies.length, 1);
  const group = (await w.gets<NetworkView>('/network?scope=group')).body;
  assert.deepEqual(group.lines.map((l) => [l.id, l.companyId]), [[own, w.parent], [theirs, w.sub]]);
  assert.deepEqual(group.companies.map((c) => c.name).slice(1), ['America Cargo']);
  assert.ok(group.companies[1]!.hubs.includes('LFMN'));
  assert.deepEqual(group.flying.map((f) => f.companyId), [w.sub]);
  assert.equal(group.lines[1]!.aircraft.length, 1, 'its aircraft are listed on its line');
  const child = (await w.gets<NetworkView>('/network?scope=group', w.a.token, w.sub)).body;
  assert.deepEqual(child.lines.map((l) => l.id), [theirs], 'the subsidiary sees its own line only');
  assert.deepEqual(child.companies.map((c) => c.id), [w.sub]);
  assert.equal((await w.gets<NetworkView>(`/network?scope=group`, w.b.token)).body.lines.length, 0, 'another player sees none of it');
  assert.equal((await w.gets(`/network?company=${w.parent}`, w.b.token)).status, 404, 'another player\'s network stays theirs');
});

test('leaderboard: a parent carries its subsidiaries nested and unranked; the subsidiary has no row of its own; the parent\'s numbers are unchanged; visible to everyone', async () => {
  const w = await world();
  const before = (await w.gets<Leaderboard>('/leaderboard', w.b.token)).body;
  const row = before.rows.find((r) => r.companyId === w.parent)!;
  assert.deepEqual(row.subsidiaries!.map((s) => [s.name, s.hub]), [['America Cargo', 'LFMN']]);
  assert.equal(row.subsidiaries!.length, 1);
  assert.equal(typeof row.subsidiaries![0]!.flights, 'number'); assert.equal(typeof row.subsidiaries![0]!.netWorth, 'number');
  assert.ok(!before.rows.some((r) => r.companyId === w.sub), 'no rank of its own');
  assert.deepEqual(before.rows.map((r) => r.rank), before.rows.map((_, i) => i + 1));
  assert.equal(before.rows.find((r) => r.companyId === (w.b.me.company.id as number))!.subsidiaries, undefined, 'a company without subsidiaries has none');
  const worth = one<{ w: number }>(w.h.db, 'SELECT c.balance AS w FROM companies c WHERE id = ?', w.sub)!.w;
  assert.ok(row.subsidiaries![0]!.netWorth >= worth, 'its own net worth');
  w.tx(w.sub, NOW + HOUR, 'line_revenue', 1_000);
  const after = (await w.gets<Leaderboard>('/leaderboard', w.b.token)).body.rows.find((r) => r.companyId === w.parent)!;
  assert.equal(after.netWorth - row.netWorth, 1_000, 'the parent\'s net worth already holds the subsidiary\'s, and nothing is added twice');
  assert.equal(after.subsidiaries![0]!.netWorth - row.subsidiaries![0]!.netWorth, 1_000);
});
