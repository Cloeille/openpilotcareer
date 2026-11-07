import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CATEGORIES, DAY_MS, KNOWN_KINDS, OPERATING_INCOME, SCENARIOS, SEASONALITY, categoryOf, revenueOf, walkBalance,
  type CashView, type DecisionResult, type ForecastView, type ProfitView, type StatementView,
} from '@opc/shared';
import { all, get, MIGRATIONS, openDb, run } from './db.ts';
import { insertAircraft } from './fleet-extras.ts';
import { lastMonthRevenue, monthRevenue } from './reports.ts';
import { grantStarterCrew } from './staff-people.ts';
import { refreshLine } from './lines.ts';
import { harness } from './harness.ts';

const V1 = '/api/v1';
const T0 = Date.UTC(2026, 10, 4, 12, 0, 0);
const body = (aircraftIds: number[], over: Record<string, unknown> = {}) => ({ a: 'LFPG', b: 'LFLL', freqPerDay: 3, days: Array(7).fill(true), windowStart: '06:00', windowEnd: '18:00', aircraftIds, ...over });

/** A player at LFPG with one AT76 flying LFPG-LFLL under a starter crew, 40 days in: several billed months of tickets, fuel, fees, payroll, parking and insurance. */
async function world(o: { days?: number } = {}) {
  const h = await harness();
  const u = await h.register('amy', 'LFPG');
  const cid = u.me.company.id as number;
  const ac = insertAircraft(h.db, { companyId: cid, icao: 'AT76', hub: 'LFPG', value: 1_000_000, ownership: 'owned', at: h.clock.t });
  const made = await h.call('POST', `${V1}/lines`, { token: u.token, body: body([ac]) });
  assert.equal(made.status, 201, made.text);
  grantStarterCrew(h.db, cid, h.clock.t);
  refreshLine(h.db, made.body.id, h.clock.t);
  h.clock.t += (o.days ?? 40) * DAY_MS;
  run(h.db, 'UPDATE sessions SET expires_at = ?', h.clock.t + 1e10);
  await h.call('GET', `${V1}/network`, { token: u.token }); // plays the ticks
  const get_ = async <T>(url: string): Promise<T> => { const r = await h.call('GET', `${V1}${url}`, { token: u.token }); assert.equal(r.status, 200, r.text); return r.body as T; };
  return { h, u, cid, ac, lineId: made.body.id as number, get: get_ };
}

// ---------------------------------------------------------------- pure rules

test('every ledger kind has a category, a payout is freight only for a cargo flight, an unknown kind is other', () => {
  for (const k of KNOWN_KINDS) assert.ok((CATEGORIES as readonly string[]).includes(categoryOf(k)), k);
  assert.equal(categoryOf('payout', 'cargo'), 'freight');
  assert.equal(categoryOf('payout', 'pax'), 'jobs');
  assert.equal(categoryOf('payout'), 'jobs');
  assert.equal(categoryOf('line_revenue'), 'tickets');
  assert.equal(categoryOf('brand_new_kind'), 'other');
});

test('the revenue of a month is operating income only: a grant, a refund or a resale is not revenue', () => {
  const by = [{ category: 'tickets', in: 100, out: 0 }, { category: 'capital', in: 400, out: 0 }, { category: 'jobs', in: 20, out: 5 }, { category: 'leasing', in: 50, out: 70 }, { category: 'service', in: 7, out: 9 }] as const;
  assert.equal(revenueOf(by), 127);
  assert.deepEqual([...OPERATING_INCOME].sort(), ['freight', 'jobs', 'service', 'tickets']);
});

test('the seasonal factors average one: the forecast moves money between months, it does not make any', () => {
  assert.equal(SEASONALITY.length, 12);
  assert.ok(Math.abs(SEASONALITY.reduce((t, x) => t + x, 0) / 12 - 1) < 1e-9);
});

test('walkBalance finds the lowest day of each month, the overdraft days and the end', () => {
  const day0 = Date.UTC(2026, 0, 30);
  const w = walkBalance({ from: day0, to: day0 + 5 * DAY_MS, balance: 100, charges: (d) => (d === day0 + 2 * DAY_MS ? -250 : 0), net: () => 10 });
  // 30 Jan 100 | 31 Jan 110 | 1 Feb -130 | 2 Feb -120 | 3 Feb -110 | 4 Feb -100
  assert.deepEqual([...w.lowByMonth], [['2026-01', 100], ['2026-02', -130]]);
  assert.deepEqual(w.summary, { lowest: { balance: -130, at: day0 + 2 * DAY_MS }, end: -100, overdraft: { days: 4, from: day0 + 2 * DAY_MS, to: day0 + 5 * DAY_MS } });
});

// ---------------------------------------------------------------- migration

test('SCHEMA_V13 adds the ledger links and backfills what the old rows say: flights give their aircraft, line memos their line and leg count, charges their registration', () => {
  const v13 = MIGRATIONS.findIndex((m) => m.includes('counterparty_id'));
  assert.ok(v13 > 0, 'found by content, not by position (later lots append after it)');
  const file = join(mkdtempSync(join(tmpdir(), 'opc-v13-')), 'v12.sqlite');
  const raw = new DatabaseSync(file);
  for (let i = 0; i < v13; i++) raw.exec(MIGRATIONS[i]!);
  raw.exec(`PRAGMA user_version = ${v13}`);
  raw.exec(`INSERT INTO users (id, username, pass_hash, created_at) VALUES (1, 'a', 'h', 1);
    INSERT INTO companies (id, user_id, name, balance, reputation, created_at) VALUES (1, 1, 'A Air', 0, 50, 1), (2, 1, 'B Air', 0, 50, 1);
    INSERT INTO aircraft (id, company_id, icao, location, value, registration) VALUES (7, 1, 'AT76', 'LFPG', 1, 'F-HAZB'), (8, 2, 'AT76', 'LFPG', 1, 'F-HAZC');
    INSERT INTO lines (id, company_id, a, b, created_at, freq_per_day, days, window_start_min, window_end_min, turnaround_min, flight_base) VALUES (3, 1, 'LFLL', 'LFPG', 1, 3, 127, 360, 1080, 40, 1100);
    INSERT INTO flights (id, company_id, aircraft_id, aircraft_icao, job_id, source, kind, origin, destination, distance_nm, payload_kg, pax, payout, status, accepted_at)
      VALUES (5, 1, 7, 'AT76', 'J', 'board', 'cargo', 'LFPG', 'EGLL', 200, 300, 0, 3000, 'verified', 40);
    INSERT INTO scheduled_flights (id, line_id, company_id, aircraft_id, flight_no, dep_at, arr_at, origin, dest, status) VALUES (1, 3, 1, 7, 1100, 5000, 9000, 'LFPG', 'LFLL', 'done');
    INSERT INTO transactions (id, company_id, at, kind, amount, balance_after, flight_id, memo) VALUES
      (1, 1, 10, 'payout', 3000, 3000, 5, 'LFPG-EGLL AT76'),
      (2, 1, 5000, 'line_revenue', 900, 3900, NULL, 'LFPG-LFLL 2026-11-04 1100'),
      (3, 1, 6000, 'line_revenue', 9000, 12900, NULL, 'LFLL-LFPG 2026-11-02 x8'),
      (4, 1, 6000, 'line_fuel', -90, 12810, NULL, 'LFLL-LFPG 2026-11-02 x8'),
      (5, 1, 7000, 'parking', -450, 12360, NULL, 'F-HAZB parking LFPG'),
      (6, 2, 7000, 'parking', -450, -450, NULL, 'F-HAZB parking LFPG'),
      (7, 1, 8000, 'grant', 5, 12365, NULL, 'starting capital');`);
  raw.close();
  const db = openDb(file);
  assert.equal(get<{ user_version: number }>(db, 'PRAGMA user_version')!.user_version, MIGRATIONS.length);
  const rows = new Map(all<{ id: number; line_id: number | null; aircraft_id: number | null; legs: number }>(db, 'SELECT id, line_id, aircraft_id, legs FROM transactions').map((r) => [r.id, r]));
  assert.deepEqual({ ...rows.get(1)! }, { id: 1, line_id: null, aircraft_id: 7, legs: 1 }, 'a flight gives its aircraft and one leg');
  assert.deepEqual({ ...rows.get(2)! }, { id: 2, line_id: 3, aircraft_id: 7, legs: 1 }, 'a leg still on the timetable gives its aircraft');
  assert.deepEqual({ ...rows.get(3)! }, { id: 3, line_id: 3, aircraft_id: null, legs: 8 }, 'a bulk-booked day gives its line and leg count, no aircraft');
  assert.deepEqual({ ...rows.get(4)! }, { id: 4, line_id: 3, aircraft_id: null, legs: 0 }, 'only the revenue posting counts legs');
  assert.deepEqual({ ...rows.get(5)! }, { id: 5, line_id: null, aircraft_id: 7, legs: 0 }, 'a charge gives the aircraft of its registration, in its own company');
  assert.equal(rows.get(6)!.aircraft_id, null, 'a registration is looked up in the company that paid, never in another');
  assert.deepEqual({ ...rows.get(7)! }, { id: 7, line_id: null, aircraft_id: null, legs: 0 });
  assert.ok(get(db, "SELECT 1 AS x FROM sqlite_master WHERE type = 'index' AND name = 'transactions_company_at'"));
  run(db, 'DELETE FROM lines WHERE id = 3');
  assert.equal(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM transactions WHERE line_id IS NOT NULL')!.n, 0, 'a deleted line leaves no link for a reused id to inherit');
});

// ---------------------------------------------------------------- the ledger carries the links

test('a line leg posts its money tagged with the line, the aircraft and one leg; a bulk-booked day carries the same totals', async () => {
  const w = await world();
  const rows = all<{ kind: string; line_id: number | null; aircraft_id: number | null; legs: number; amount: number }>(w.h.db, "SELECT kind, line_id, aircraft_id, legs, amount FROM transactions WHERE company_id = ? AND kind LIKE 'line_%'", w.cid);
  assert.ok(rows.length > 0 && rows.every((r) => r.line_id === w.lineId && r.aircraft_id === w.ac), 'every line posting is about the line and its aircraft');
  const legsFlown = get<{ n: number }>(w.h.db, "SELECT COUNT(*) AS n FROM scheduled_flights WHERE line_id = ? AND status = 'done'", w.lineId)!.n;
  assert.ok(legsFlown > 0);
  // the 35-day timetable keeps the legs the ledger counted since the start: bulk lines count x8, single legs count 1, nothing else carries legs
  assert.ok(rows.filter((r) => r.kind !== 'line_revenue').every((r) => r.legs === 0));
  const counted = rows.filter((r) => r.kind === 'line_revenue').reduce((t, r) => t + r.legs, 0);
  assert.ok(counted >= legsFlown, `the ledger counts ${counted} legs, the timetable still holds ${legsFlown}`);
  const charges = all<{ kind: string; aircraft_id: number | null }>(w.h.db, "SELECT kind, aircraft_id FROM transactions WHERE company_id = ? AND kind IN ('parking', 'insurance')", w.cid);
  assert.ok(charges.length > 0 && charges.every((c) => c.aircraft_id !== null), 'a monthly parking or insurance charge is about one aircraft');
});

// ---------------------------------------------------------------- cash flow

test('the cash flow adds up: each month is its ledger, the last end balance is the balance, categories and totals agree', async () => {
  const w = await world();
  const cash = await w.get<CashView>('/finance/cash?months=12');
  const balance = get<{ balance: number }>(w.h.db, 'SELECT balance FROM companies WHERE id = ?', w.cid)!.balance;
  assert.equal(cash.balance, balance);
  assert.equal(cash.months.at(-1)!.endBalance, balance, 'the running balance by date ends on the balance');
  assert.ok(cash.months.length >= 2);
  for (const m of cash.months) {
    const sum = get<{ s: number; i: number; o: number }>(w.h.db, `SELECT SUM(amount) AS s, SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS i, SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS o
      FROM transactions WHERE company_id = ? AND strftime('%Y-%m', at / 1000, 'unixepoch') = ?`, w.cid, m.month)!;
    assert.equal(m.net, sum.s, `${m.month} net`);
    assert.equal(m.spend, sum.o, `${m.month} spend`);
    assert.equal(m.revenue + m.other, sum.i, `${m.month} inflows`);
    assert.equal(m.byCategory.reduce((t, c) => t + c.in - c.out, 0), m.net, `${m.month} categories`);
    assert.equal(m.revenue, revenueOf(m.byCategory));
  }
  const grant = cash.months[0]!.byCategory.find((c) => c.category === 'capital');
  assert.ok(grant && grant.in > 0 && cash.months[0]!.revenue < cash.months[0]!.net + cash.months[0]!.spend, 'the starting capital is not revenue');
  for (let i = 1; i < cash.months.length; i++) assert.equal(cash.months[i]!.netVsPrevious, cash.months[i]!.net - cash.months[i - 1]!.net);
  assert.equal(cash.months[0]!.netVsPrevious, null);
  assert.equal((await w.get<CashView>('/finance/cash?months=1')).months.length, 1);
});

test('the runway is the balance over the last closed month\'s daily spend; a company with no closed month has none', async () => {
  const w = await world();
  const cash = await w.get<CashView>('/finance/cash');
  const prev = cash.months.at(-2)!;
  assert.ok(prev.closed && prev.spend > 0);
  assert.equal(cash.runwayDays, Math.round((cash.balance / (prev.spend / 30)) * 10) / 10);
  const fresh = await harness();
  const f = await fresh.register('fresh', 'LFPG');
  const c = (await fresh.call('GET', `${V1}/finance/cash`, { token: f.token })).body as CashView;
  assert.equal(c.runwayDays, null);
  assert.equal(c.months.length, 1);
  assert.equal(c.months[0]!.revenue, 0);
});

test('the upcoming debits are what the next billing will post, and billing then posts them', async () => {
  const w = await world();
  const before = await w.get<CashView>('/finance/cash');
  assert.ok(before.upcoming.length > 0 && before.upcoming.every((u) => u.amount < 0));
  assert.equal(before.upcomingTotal, before.upcoming.reduce((t, u) => t + u.amount, 0));
  const due = before.upcoming[0]!.at;
  w.h.clock.t = due + 3_600_000;
  const after = await w.get<CashView>('/finance/cash');
  const posted = new Map(all<{ kind: string; s: number }>(w.h.db, "SELECT kind, SUM(amount) AS s FROM transactions WHERE company_id = ? AND at = ? AND kind IN ('payroll','parking','insurance') GROUP BY kind", w.cid, due).map((r) => [r.kind, r.s]));
  for (const u of before.upcoming.filter((x) => ['payroll', 'parking', 'insurance'].includes(x.kind))) assert.equal(posted.get(u.kind), u.amount, `${u.kind} projected = posted`);
  assert.ok(after.months.some((m) => m.month === new Date(due).toISOString().slice(0, 7)));
});

test('the revenue helper credit reads: operating income of one UTC month, the last full month before now', async () => {
  const w = await world();
  const cash = await w.get<CashView>('/finance/cash');
  const prev = cash.months.at(-2)!;
  assert.equal(monthRevenue(w.h.db, w.cid, prev.month), prev.revenue);
  assert.equal(lastMonthRevenue(w.h.db, w.cid, w.h.clock.t), prev.revenue);
  assert.ok(prev.revenue > 0);
  const first = cash.months[0]!;
  assert.equal(monthRevenue(w.h.db, w.cid, first.month), first.revenue, 'the grant of the first month is not in it');
  assert.equal(monthRevenue(w.h.db, w.cid, '2001-01'), 0);
  const other = await w.h.register('bob', 'LFPG');
  assert.equal(lastMonthRevenue(w.h.db, other.me.company.id, w.h.clock.t), 0, 'scoped to the company');
});

test('debt counts the principal still owed on a financed aircraft and its instalment', async () => {
  const h = await harness();
  const u = await h.register('loan', 'LFPG');
  run(h.db, 'UPDATE companies SET balance = 50000000 WHERE id = ?', u.me.company.id);
  const bought = await h.call('POST', `${V1}/me/fleet`, { token: u.token, body: { icao: 'DHC6', hub: 'LFPG', financing: { downPct: 20, months: 84 } } });
  assert.equal(bought.status, 201, bought.text);
  const loan = get<{ principal: number; monthly: number }>(h.db, "SELECT principal, monthly FROM contracts WHERE company_id = ? AND kind = 'loan'", u.me.company.id)!;
  const cash = (await h.call('GET', `${V1}/finance/cash`, { token: u.token })).body as CashView;
  assert.deepEqual(cash.debt, { total: loan.principal, monthly: loan.monthly, credits: 1 });
  const tagged = get<{ n: number }>(h.db, "SELECT COUNT(*) AS n FROM transactions WHERE company_id = ? AND kind = 'purchase_aircraft' AND aircraft_id IS NOT NULL", u.me.company.id)!.n;
  assert.equal(tagged, 1, 'the purchase is about the aircraft it bought');
});

// ---------------------------------------------------------------- statement

test('the statement is the ledger in date order with a running balance, grouped by day, with links to the line and the aircraft', async () => {
  const w = await world();
  const all_ = await w.get<StatementView>('/finance/ledger?limit=200');
  const rows = all_.days.flatMap((d) => d.rows);
  assert.equal(rows.length + (all_.next === null ? 0 : 1) > 0, true);
  assert.equal(rows[0]!.balanceAfter, get<{ balance: number }>(w.h.db, 'SELECT balance FROM companies WHERE id = ?', w.cid)!.balance, 'the newest row ends on the balance');
  for (let i = 0; i + 1 < rows.length; i++) assert.equal(rows[i]!.balanceAfter - rows[i]!.amount, rows[i + 1]!.balanceAfter, 'each balance follows the previous row');
  for (const d of all_.days) assert.equal(d.net, d.rows.reduce((t, r) => t + r.amount, 0), `${d.day} net`);
  assert.deepEqual(all_.days.map((d) => d.day), [...new Set(rows.map((r) => new Date(r.at).toISOString().slice(0, 10)))], 'newest day first, one group per day');
  const leg = rows.find((r) => r.kind === 'line_revenue')!;
  assert.deepEqual(leg.line, { id: w.lineId, a: 'LFLL', b: 'LFPG' });
  assert.equal(leg.aircraft?.id, w.ac);
  assert.equal(leg.category, 'tickets');
  assert.equal(rows.find((r) => r.kind === 'grant')?.line, null);
  assert.equal(all_.summary.net, all_.summary.in - all_.summary.out);
  assert.equal(all_.summary.count, get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM transactions WHERE company_id = ?', w.cid)!.n);
  assert.ok(all_.scheduled && all_.scheduled.amount < 0);
});

test('the statement pages by cursor without gap or repeat, and the filters narrow rows and summary alike', async () => {
  const w = await world();
  const seen: number[] = [];
  let before: number | null = null, pages = 0;
  do {
    const page: StatementView = await w.get<StatementView>(`/finance/ledger?limit=40${before === null ? '' : `&before=${before}`}`);
    seen.push(...page.days.flatMap((d) => d.rows.map((r) => r.id)));
    before = page.next;
    pages++;
  } while (before !== null && pages < 50);
  const ledgerIds = all<{ id: number }>(w.h.db, 'SELECT id FROM transactions WHERE company_id = ? ORDER BY at DESC, id DESC', w.cid).map((r) => r.id);
  assert.deepEqual(seen, ledgerIds);
  assert.ok(pages > 1);

  const fuel = await w.get<StatementView>('/finance/ledger?category=fuel&limit=200');
  assert.ok(fuel.days.flatMap((d) => d.rows).every((r) => r.category === 'fuel'));
  assert.deepEqual(fuel.summary.byCategory.map((c) => c.category), ['fuel']);
  const onLine = await w.get<StatementView>(`/finance/ledger?line=${w.lineId}&limit=200`);
  assert.ok(onLine.summary.count > 0 && onLine.days.flatMap((d) => d.rows).every((r) => r.line?.id === w.lineId));
  const day = new Date(T0 + 2 * DAY_MS).toISOString().slice(0, 10);
  const one = await w.get<StatementView>(`/finance/ledger?from=${day}&to=${day}&limit=200`);
  assert.ok(one.days.length === 1 && one.days[0]!.day === day, 'from and to are whole UTC days, both included');
  assert.equal(one.summary.net, one.days[0]!.net);
  assert.equal((await w.get<StatementView>('/finance/ledger?line=99999')).summary.count, 0);
});

test('the statement refuses what it cannot read: bad dates, categories and limits are 400, and another company\'s line shows nothing', async () => {
  const w = await world();
  for (const q of ['from=yesterday', 'from=2026-02-31', 'category=pizza', 'limit=0', 'limit=500', 'line=abc', 'before=-1']) {
    assert.equal((await w.h.call('GET', `${V1}/finance/ledger?${q}`, { token: w.u.token })).status, 400, q);
  }
  assert.equal((await w.h.call('GET', `${V1}/finance/cash?months=0`, { token: w.u.token })).status, 400);
  assert.equal((await w.h.call('GET', `${V1}/finance/lines?month=2026-13`, { token: w.u.token })).status, 400);
  assert.equal((await w.h.call('GET', `${V1}/finance/lines?by=pilot`, { token: w.u.token })).status, 400);
  const bob = await w.h.register('bob', 'LFPG');
  const theirs = (await w.h.call('GET', `${V1}/finance/ledger?line=${w.lineId}`, { token: bob.token })).body as StatementView;
  assert.equal(theirs.summary.count, 0);
});

// ---------------------------------------------------------------- profitability

test('profitability: a line\'s revenue and costs are the month\'s ledger, crew is added from the duty ledger, and the aircraft view adds the fixed costs', async () => {
  const w = await world();
  const cash = await w.get<CashView>('/finance/cash');
  const month = cash.months.at(-2)!.month;
  const view = await w.get<ProfitView>(`/finance/lines?month=${month}`);
  assert.equal(view.closed, true);
  assert.equal(view.by, 'line');
  assert.equal(view.rows.length, 1);
  const row = view.rows[0]!;
  assert.ok(row.by === 'line' && row.id === w.lineId && row.a === 'LFLL' && row.b === 'LFPG');
  const sum = (kinds: string[]) => get<{ s: number }>(w.h.db, `SELECT COALESCE(SUM(amount), 0) AS s FROM transactions WHERE company_id = ? AND line_id = ? AND strftime('%Y-%m', at / 1000, 'unixepoch') = ? AND kind IN (${kinds.map(() => '?').join(',')})`, w.cid, w.lineId, month, ...kinds)!.s;
  assert.equal(row.revenue, sum(['line_revenue', 'service_sales']));
  assert.equal(row.breakdown.fuel, -sum(['line_fuel']));
  assert.equal(row.breakdown.fees, -sum(['line_fee']));
  assert.equal(row.breakdown.maintenance, -sum(['line_maintenance']));
  assert.equal(row.breakdown.service, -sum(['service_cost']));
  assert.ok(row.breakdown.crew > 0, 'the starter crew flew the line');
  assert.equal(row.costs, Object.values(row.breakdown).reduce((t, x) => t + x, 0));
  assert.equal(row.margin, row.revenue - row.costs);
  assert.equal(row.marginPct, row.margin / row.revenue);
  assert.equal(row.flights, get<{ n: number }>(w.h.db, "SELECT SUM(legs) AS n FROM transactions WHERE company_id = ? AND line_id = ? AND strftime('%Y-%m', at / 1000, 'unixepoch') = ?", w.cid, w.lineId, month)!.n);
  assert.deepEqual(view.totals, { margin: row.margin, profitable: { count: row.margin >= 0 ? 1 : 0, margin: Math.max(0, row.margin) }, losing: { count: row.margin < 0 ? 1 : 0, margin: Math.min(0, row.margin) } });

  // the aircraft view: the same flying, whole fixed costs (the world was never billed for November, so book the month's parking and insurance as billing would)
  run(w.h.db, "INSERT INTO transactions (company_id, at, kind, amount, balance_after, memo, aircraft_id) VALUES (?, ?, 'parking', -3900, 0, 'F-HAZB parking LFPG', ?), (?, ?, 'insurance', -1200, 0, 'F-HAZB insurance', ?)",
    w.cid, Date.parse(`${month}-01T00:00:00Z`), w.ac, w.cid, Date.parse(`${month}-01T00:00:00Z`), w.ac);
  const inLine = (await w.get<ProfitView>(`/finance/lines?month=${month}`)).rows[0]!;
  const byAircraft = await w.get<ProfitView>(`/finance/lines?month=${month}&by=aircraft`);
  const ac = byAircraft.rows.find((r) => r.id === w.ac)!;
  assert.ok(ac.by === 'aircraft' && ac.icao === 'AT76' && ac.lines.includes('LFLL-LFPG'));
  assert.equal(ac.revenue, inLine.revenue);
  assert.equal(ac.breakdown.crew, inLine.breakdown.crew, 'the crew follows the aircraft that flew');
  assert.equal(ac.breakdown.fixed, 5100, 'parking and insurance of the month, whole');
  assert.equal(inLine.breakdown.fixed, 5100, 'on its one line the aircraft\'s fixed costs follow its minutes');
  assert.equal(ac.margin, inLine.margin);
});

test('profitability: an aircraft that flew nothing shows its fixed costs as a loss; a company with no activity has no rows; the default month is the last full one', async () => {
  const w = await world();
  const idle = insertAircraft(w.h.db, { companyId: w.cid, icao: 'C172', hub: 'LFPG', value: 100_000, ownership: 'owned', at: w.h.clock.t - 90 * DAY_MS });
  const month = (await w.get<CashView>('/finance/cash')).months.at(-2)!.month;
  run(w.h.db, "INSERT INTO transactions (company_id, at, kind, amount, balance_after, memo, aircraft_id) VALUES (?, ?, 'parking', -450, 0, 'idle parking', ?)", w.cid, Date.parse(`${month}-01T00:00:00Z`), idle);
  const view = await w.get<ProfitView>(`/finance/lines?month=${month}&by=aircraft`);
  const row = view.rows.find((r) => r.id === idle)!;
  assert.deepEqual([row.revenue, row.costs, row.margin, row.marginPct], [0, 450, -450, null]);
  assert.equal(view.rows.at(-1)!.id, idle, 'the worst margin is last');
  assert.equal((await w.get<ProfitView>('/finance/lines')).month, month);
  const empty = await w.get<ProfitView>('/finance/lines?month=2020-01');
  assert.deepEqual([empty.rows.length, empty.totals.margin], [0, 0]);
});

test('profitability: crew pay is split by minutes flown, so the parts always add up to the pay of the month', async () => {
  const w = await world();
  const month = (await w.get<CashView>('/finance/cash')).months.at(-2)!.month;
  const [from, to] = [Date.parse(`${month}-01T00:00:00Z`), Date.parse(`${month}-01T00:00:00Z`) + 31 * DAY_MS];
  const pay = Math.round(all<{ c: number }>(w.h.db, `SELECT d.flight_min * 1.0 / (SELECT SUM(x.flight_min) FROM staff_duty x WHERE x.staff_id = d.staff_id AND x.day = d.day) * s.salary / 30 AS c
    FROM staff_duty d JOIN staff s ON s.id = d.staff_id WHERE d.dep_at >= ? AND d.dep_at < ?`, from, to).reduce((t, r) => t + r.c, 0));
  const row = (await w.get<ProfitView>(`/finance/lines?month=${month}`)).rows[0]!;
  assert.ok(Math.abs(row.breakdown.crew - pay) <= 1, `crew ${row.breakdown.crew} vs duty pay ${pay}`);
});

// ---------------------------------------------------------------- forecast

test('the forecast is twelve months, three scenarios ordered prudent <= central <= optimistic, built from planMonth and the line engine', async () => {
  const w = await world();
  const f = await w.get<ForecastView>('/finance/forecast');
  assert.equal(f.points.length, 12);
  assert.equal(f.points[0]!.month, new Date(w.h.clock.t).toISOString().slice(0, 7));
  assert.equal(f.balance, get<{ balance: number }>(w.h.db, 'SELECT balance FROM companies WHERE id = ?', w.cid)!.balance);
  for (const p of f.points) assert.ok(p.prudent <= p.central && p.central <= p.optimistic, p.month);
  for (const s of SCENARIOS) {
    assert.ok(f.summary[s].lowest.balance <= f.balance, `${s} lowest`);
    assert.equal(f.summary[s].lowest.balance, Math.min(...f.points.map((p) => p[s]), f.balance), `${s} lowest is the lowest month point`);
  }
  assert.deepEqual(await w.get<ForecastView>('/finance/forecast'), f, 'same clock, same forecast: no randomness');
  // the billing of the next month is exactly what planMonth projects: the first of the month drops the central curve by the projected charges, before flying
  const upcoming = (await w.get<CashView>('/finance/cash')).upcomingTotal;
  assert.ok(upcoming < 0);
});

test('a company that flies nothing has a forecast that only pays its bills; a stopped line stops earning', async () => {
  const h = await harness();
  const u = await h.register('idle', 'LFPG');
  const f = (await h.call('GET', `${V1}/finance/forecast`, { token: u.token })).body as ForecastView;
  assert.equal(f.points.length, 12);
  assert.ok(f.points.every((p) => p.central === p.prudent && p.prudent === p.optimistic), 'no flying, no scenario');
  assert.ok(f.points.at(-1)!.central <= f.balance);
  assert.deepEqual(f.decisions.map((d) => [d.id, d.available]), [['pause_line', false], ['lease_aircraft', true]]);
});

test('testing a decision re-runs the same forecast: pausing the weakest line removes its earnings, leasing adds the deposit and the rent', async () => {
  const w = await world();
  const f = await w.get<ForecastView>('/finance/forecast');
  const pause = await w.h.call('POST', `${V1}/finance/forecast/decision`, { token: w.u.token, body: { decision: 'pause_line' } });
  assert.equal(pause.status, 200, pause.text);
  const p = pause.body as DecisionResult;
  const d = f.decisions.find((x) => x.id === 'pause_line')!;
  assert.deepEqual(d.line, { id: w.lineId, a: 'LFLL', b: 'LFPG' });
  assert.deepEqual(p.points.map((x) => x.month), f.points.map((x) => x.month));
  for (const s of SCENARIOS) {
    assert.equal(p.effect[s].lowDelta, p.summary[s].lowest.balance - f.summary[s].lowest.balance);
    assert.deepEqual(d.effect![s], p.effect[s], 'the list and the test agree');
  }
  assert.ok(p.summary.central.end < f.summary.central.end, 'a line that earns money, paused, ends lower');
  const lease = (await w.h.call('POST', `${V1}/finance/forecast/decision`, { token: w.u.token, body: { decision: 'lease_aircraft' } })).body as DecisionResult;
  const ld = f.decisions.find((x) => x.id === 'lease_aircraft')!;
  assert.ok(ld.icao === 'AT76' && ld.upfront > 0, 'one more of the type she flies most');
  assert.ok(lease.summary.central.end < f.summary.central.end, 'an aircraft with no line only costs');
  assert.ok(lease.effect.central.lowDelta <= -ld.upfront + 1 || lease.effect.central.lowDelta < 0);
  assert.equal(get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM contracts WHERE company_id = ?', w.cid)!.n, 0, 'testing writes nothing');
  assert.equal((await w.h.call('POST', `${V1}/finance/forecast/decision`, { token: w.u.token, body: { decision: 'sell_everything' } })).status, 400);
  assert.equal((await w.h.call('POST', `${V1}/finance/forecast/decision`, { token: w.u.token, body: {} })).status, 400);
  const before = JSON.stringify(all(w.h.db, 'SELECT * FROM transactions ORDER BY id'));
  await w.h.call('POST', `${V1}/finance/forecast/decision`, { token: w.u.token, body: { decision: 'lease_aircraft' } });
  assert.equal(JSON.stringify(all(w.h.db, 'SELECT * FROM transactions ORDER BY id')), before, 'the ledger did not move');
  const idle = await harness();
  const i = await idle.register('idle2', 'LFPG');
  assert.equal((await idle.call('POST', `${V1}/finance/forecast/decision`, { token: i.token, body: { decision: 'pause_line' } })).body.error, 'decision_unavailable');
});

// ---------------------------------------------------------------- auth

test('every report needs a session: no token and an API key are 401, a company that is not yours is 403, and each player sees only his own company', async () => {
  const w = await world();
  const bob = await w.h.register('bob', 'LFPG');
  const key = await w.h.apiKey(w.u.token);
  const routes: [string, string, unknown?][] = [['GET', '/finance/cash'], ['GET', '/finance/lines'], ['GET', '/finance/ledger'], ['GET', '/finance/forecast'], ['POST', '/finance/forecast/decision', { decision: 'lease_aircraft' }]];
  for (const [method, url, b] of routes) {
    const o = b === undefined ? {} : { body: b };
    assert.equal((await w.h.call(method as 'GET', `${V1}${url}`, o)).status, 401, `${url} without a token`);
    assert.equal((await w.h.call(method as 'GET', `${V1}${url}`, { ...o, token: key })).status, 401, `${url} with an API key`);
    assert.equal((await w.h.call(method as 'GET', `${V1}${url}`, { ...o, token: bob.token, company: w.cid })).status, 403, `${url} for someone else's company`);
  }
  const mine = (await w.h.call('GET', `${V1}/finance/cash`, { token: w.u.token })).body as CashView;
  const his = (await w.h.call('GET', `${V1}/finance/cash`, { token: bob.token })).body as CashView;
  assert.notEqual(mine.balance, his.balance);
  assert.equal(his.months.at(-1)!.revenue, 0, 'bob has not flown');
  assert.equal(((await w.h.call('GET', `${V1}/finance/ledger?limit=200`, { token: bob.token })).body as StatementView).summary.count, 1, 'his statement is his starting capital');
});

test('reading a report settles the month first: the statement never lags the balance', async () => {
  const w = await world();
  const next = Date.UTC(2027, 0, 2, 9);
  w.h.clock.t = next;
  run(w.h.db, 'UPDATE sessions SET expires_at = ?', next + 1e10);
  const stmt = await w.get<StatementView>('/finance/ledger?limit=5');
  const balance = get<{ balance: number }>(w.h.db, 'SELECT balance FROM companies WHERE id = ?', w.cid)!.balance;
  assert.equal(stmt.days[0]!.rows[0]!.balanceAfter, balance);
  assert.ok(get(w.h.db, "SELECT 1 AS x FROM transactions WHERE company_id = ? AND kind = 'payroll' AND at = ?", w.cid, Date.UTC(2027, 0, 1)), 'January is billed by the read');
});
