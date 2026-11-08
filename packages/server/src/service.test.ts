import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DAY_MS, DEFAULT_POLICY, LINE_TICK_MS, MEALS, SATISFACTION_STREAK_DAYS, kitchenCapacity, offerFor, pairLoadFactor, weeklyDemand, weeklySeats, withSatisfaction, dayNo,
  type CandidatesView, type CatererQuote, type KitchenView, type ServicePreview, type ServiceView,
} from '@opc/shared';
import { seedAi } from './ai.ts';
import { catalogType } from './catalog.ts';
import { all, get, MIGRATIONS, openDb, run } from './db.ts';
import { insertAircraft } from './fleet-extras.ts';
import { finishFlight, type FlightRow } from './game.ts';
import { harness } from './harness.ts';
import { catchUpLines, loadFactorOf, refreshLine, sizeOf, lineDistance } from './lines.ts';
import { bookLeg, configAt, planLeg, providerAt, type LegPlan } from './service.ts';
import { grantStarterCrew } from './staff-people.ts';

const V1 = '/api/v1';
const T0 = Date.UTC(2026, 10, 4, 12, 0, 0); // Wednesday 4 Nov 2026, 12:00Z (the harness clock)
const body = (over: Record<string, unknown> = {}) => ({ a: 'LFPG', b: 'LFLL', freqPerDay: 3, days: Array(7).fill(true), windowStart: '06:00', windowEnd: '18:00', aircraftIds: [] as number[], ...over });
type Tx = { kind: string; amount: number; memo: string; flightId: number | null };

/** A player at LFPG (a large airport: it has a kitchen hall to rent) with one AT76 (72 seats, a cabin) flying LFLL-LFPG three round trips a day, and her starter crew. */
async function world(o: { line?: boolean; money?: number } = {}) {
  const h = await harness();
  const u = await h.register('amy', 'LFPG');
  const cid = u.me.company.id as number;
  run(h.db, 'UPDATE companies SET balance = ? WHERE id = ?', o.money ?? 20_000_000, cid);
  const ac = insertAircraft(h.db, { companyId: cid, icao: 'AT76', hub: 'LFPG', value: 1_000_000, ownership: 'owned', at: h.clock.t });
  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, b?: unknown) => h.call(method, `${V1}${url}`, { token: u.token, ...(b === undefined ? {} : { body: b }) });
  let lineId = 0;
  if (o.line !== false) {
    const r = await call('POST', '/lines', body({ aircraftIds: [ac] }));
    assert.equal(r.status, 201, r.text);
    lineId = r.body.id;
    grantStarterCrew(h.db, cid, h.clock.t);
    refreshLine(h.db, lineId, h.clock.t);
  }
  const advance = async (ms: number) => { h.clock.t += ms; await call('GET', '/network'); };
  const ledger = (): Tx[] => all<Tx>(h.db, "SELECT kind, amount, memo, flight_id AS flightId FROM transactions WHERE company_id = ? AND kind LIKE 'service_%' ORDER BY id", cid);
  const sum = (kind: string): number => ledger().filter((t) => t.kind === kind).reduce((s, t) => s + t.amount, 0);
  const days = () => all<{ day: number; hub: string; pax: number; sat_pax: number; sales: number; cost: number; snacks: number; hot: number; unserved: number }>(h.db, 'SELECT * FROM service_days WHERE company_id = ? ORDER BY day, hub', cid);
  const reputation = (): number => get<{ r: number }>(h.db, 'SELECT reputation AS r FROM companies WHERE id = ?', cid)!.r;
  const cooks = (n: number, base = 'LFPG'): void => { for (let i = 0; i < n; i++) run(h.db, "INSERT INTO staff (company_id, family, name, role, base, hired_at, starts_at, salary, reliability, morale) VALUES (?, 'kitchen', ?, 'cook', ?, 0, 0, 2900, 80, 80)", cid, `cook ${i}`, base); };
  const hall = async (icao = 'LFPG'): Promise<number> => (await call('GET', `/hubs/${icao}/plan`)).body.buildings.find((b: { effect: string }) => b.effect === 'kitchen').facilityId;
  const sat = async (): Promise<ServiceView> => (await call('GET', '/service')).body;
  return { h, u, cid, ac, lineId, call, advance, ledger, sum, days, reputation, cooks, hall, sat };
}

// ---------------------------------------------------------------- SCHEMA_V12

test('SCHEMA_V12 creates the service tables on a fresh database', () => {
  const db = openDb(':memory:');
  assert.equal(get<{ user_version: number }>(db, 'PRAGMA user_version')!.user_version, MIGRATIONS.length);
  for (const t of ['service_policy', 'kitchen', 'service_days']) assert.ok(get(db, "SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?", t), t);
});

test('SCHEMA_V12 upgrades a database that stopped just before it and keeps its companies (the position is whatever the orchestrator gave it)', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'opc-v12-')), 'before.sqlite');
  const raw = new DatabaseSync(file);
  const mine = MIGRATIONS.findIndex((m) => m.includes('CREATE TABLE service_policy'));
  assert.ok(mine > 0);
  for (let i = 0; i < mine; i++) raw.exec(MIGRATIONS[i]!);
  raw.exec(`PRAGMA user_version = ${mine}`);
  raw.exec("INSERT INTO users (id, username, pass_hash, created_at) VALUES (1, 'a', 'h', 1); INSERT INTO companies (id, user_id, name, balance, reputation, created_at) VALUES (1, 1, 'A Air', 5, 50, 1);");
  raw.close();
  const up = openDb(file);
  assert.equal(get<{ user_version: number }>(up, 'PRAGMA user_version')!.user_version, MIGRATIONS.length);
  assert.equal(get<{ balance: number }>(up, 'SELECT balance FROM companies WHERE id = 1')!.balance, 5);
  assert.deepEqual(all(up, 'SELECT * FROM service_policy'), []);
  assert.equal(configAt(up, 1).policy.medium.hot_meal, 'paid', 'a company that never touched the table has the default policy');
});

// ---------------------------------------------------------------- the line engine books the service, once

test('every leg a line flies sells and costs its service: ledger, day log and satisfaction agree to the euro', async () => {
  const w = await world();
  await w.advance(DAY_MS);
  const legs = all<{ pax: number; origin: string }>(w.h.db, "SELECT pax, origin FROM scheduled_flights WHERE status = 'done'");
  assert.ok(legs.length >= 6, `${legs.length} legs flown`);
  assert.ok(w.sum('service_sales') > 0 && w.sum('service_cost') < 0);
  const log = w.days();
  assert.equal(log.reduce((s, d) => s + d.sales, 0), w.sum('service_sales'), 'the day log is what the ledger booked');
  assert.equal(log.reduce((s, d) => s + d.cost, 0), -w.sum('service_cost'));
  assert.equal(log.reduce((s, d) => s + d.pax, 0), legs.reduce((s, l) => s + l.pax, 0), 'every passenger of every leg is in the log');
  // short haul, default policy: free drinks and paid snacks, caterer at both ends: 2.5 + 0.4 + 0.2 / 2 = 3.0
  for (const d of log) assert.equal(Math.round((d.sat_pax / d.pax) * 100) / 100, 3);
  const view = await w.sat();
  assert.deepEqual({ v: view.satisfaction.value, est: view.satisfaction.estimated }, { v: 3, est: false });
});

test('a line replays to the same books: ticking along, jumping, and replaying a tick all agree and nothing is booked twice', async () => {
  const stepwise = await world();
  for (let i = 0; i < 4 * 24 * 6; i++) { stepwise.h.clock.t += LINE_TICK_MS; catchUpLines(stepwise.h.db, stepwise.h.clock.t); }
  const away = await world();
  await away.advance(6 * DAY_MS);
  assert.equal(away.sum('service_sales'), stepwise.sum('service_sales'), 'bulk settlement books what the leg-by-leg replay books');
  assert.equal(away.sum('service_cost'), stepwise.sum('service_cost'));
  assert.ok(away.ledger().length < stepwise.ledger().length / 2, 'and in far fewer ledger lines');
  assert.deepEqual(away.days(), stepwise.days());
  const before = JSON.stringify([away.ledger(), away.days(), away.reputation()]);
  assert.equal(catchUpLines(away.h.db, away.h.clock.t), 0);
  run(away.h.db, 'DELETE FROM line_ticks WHERE tick = (SELECT MAX(tick) FROM line_ticks)');
  assert.equal(catchUpLines(away.h.db, away.h.clock.t), 1);
  assert.equal(JSON.stringify([away.ledger(), away.days(), away.reputation()]), before);
});

test('two identical worlds produce identical service books: no randomness, no wall clock', async () => {
  const a = await world(), b = await world();
  await a.advance(2 * DAY_MS); await b.advance(2 * DAY_MS);
  assert.deepEqual(a.ledger(), b.ledger());
  assert.deepEqual(a.days(), b.days());
});

// ---------------------------------------------------------------- satisfaction feeds the load factor

test('the load factor takes the satisfaction term: a better cabin fills more seats, by at most 6 %, and the engine uses the number the forecast shows', async () => {
  const w = await world({ line: false });
  const p = { companyId: w.cid, a: 'LFLL', b: 'LFPG', freqPerDay: 9, days: 127, fleet: [{ icao: 'AT76' }] };
  const demand = weeklyDemand(sizeOf('LFLL'), sizeOf('LFPG'), lineDistance('LFLL', 'LFPG'));
  const base = pairLoadFactor(demand, weeklySeats(9, 127, [72]), 0);
  assert.ok(base > 0.5 && base < 0.95, `${base}: below the cap, so the term is visible`);
  const lf = loadFactorOf(w.h.db, p);
  const sat = offerFor(DEFAULT_POLICY.short, 'short', 'turboprop-airliner', 'soigne').satisfaction;
  assert.equal(lf, withSatisfaction(base, sat));
  assert.ok(lf < base, 'a short-haul offer of drinks and paid snacks (3.0) is below the neutral 3.5');
  assert.ok(lf / base > 0.94 && lf / base < 1, `${lf / base}`);

  // nothing on board: 2.5, the -4 % end; generous short-haul policy: higher, never past +6 %
  for (const item of ['drinks', 'snack'] as const) assert.equal((await w.call('PUT', '/service/policy', { haul: 'short', item, mode: 'none' })).status, 200);
  assert.equal(loadFactorOf(w.h.db, { ...p, at: T0 }), lf, 'a change applies the next day: at this instant nothing moves');
  assert.equal(loadFactorOf(w.h.db, p), withSatisfaction(base, 2.5), 'the forecast, which shows the policy as it will be, already does');
  const tomorrow = Math.floor(T0 / DAY_MS) * DAY_MS + DAY_MS;
  assert.equal(loadFactorOf(w.h.db, { ...p, at: tomorrow }), withSatisfaction(base, 2.5));
  assert.equal(loadFactorOf(w.h.db, { ...p, at: tomorrow - 1 }), lf, 'one millisecond before midnight it is still the old policy');
  for (const item of ['drinks', 'snack', 'hot_meal', 'alcohol', 'comfort'] as const) await w.call('PUT', '/service/policy', { haul: 'short', item, mode: 'free' });
  await w.call('PUT', '/service/meal-quality', { quality: 'gastronomique' });
  const best = loadFactorOf(w.h.db, { ...p, at: tomorrow });
  assert.ok(best > lf && best / base <= 1.06 + 1e-9, `${best / base}`);

  // the engine: a leg's passengers are the seats times that same load factor, at the policy of its own time
  const live = await world();
  await live.advance(DAY_MS);
  const leg = all<{ pax: number; dep_at: number }>(live.h.db, "SELECT pax, dep_at FROM scheduled_flights WHERE status = 'done' ORDER BY dep_at LIMIT 1")[0]!;
  const line = get<{ freq_per_day: number; days: number }>(live.h.db, 'SELECT * FROM lines WHERE id = ?', live.lineId)!;
  assert.equal(leg.pax, Math.round(72 * loadFactorOf(live.h.db, { companyId: live.cid, a: 'LFLL', b: 'LFPG', freqPerDay: line.freq_per_day, days: line.days, fleet: [{ icao: 'AT76' }], excludeLineId: live.lineId, at: leg.dep_at })));
});

test('an aircraft without a cabin crew serves nothing and has no satisfaction term; an AI company is not modelled', async () => {
  const w = await world({ line: false });
  assert.equal(planLeg(w.h.db, { companyId: w.cid, category: 'piston-single', seats: 4, origin: 'LFPG', dep: T0, blockMin: 60, pax: 3 }), null);
  const p = { companyId: w.cid, a: 'LFLL', b: 'LFPG', freqPerDay: 6, days: 127 };
  const c172 = loadFactorOf(w.h.db, { ...p, fleet: [{ icao: 'C172' }] });
  assert.equal(c172, pairLoadFactor(weeklyDemand(sizeOf('LFLL'), sizeOf('LFPG'), lineDistance('LFLL', 'LFPG')), weeklySeats(6, 127, [catalogType('C172').seats]), 0), 'no cabin: the pair\'s own load factor');
  seedAi(w.h.db, T0);
  const ai = get<{ id: number }>(w.h.db, 'SELECT id FROM companies WHERE user_id IS NULL LIMIT 1')!.id;
  assert.equal(planLeg(w.h.db, { companyId: ai, category: 'jet-airliner', seats: 150, origin: 'EGLL', dep: T0, blockMin: 120, pax: 100 }), null);
});

// ---------------------------------------------------------------- the central kitchen

test('an own kitchen needs the hall and takes effect the next day; a hall given up puts the caterer back', async () => {
  const w = await world();
  const noHall = await w.call('PUT', '/kitchen/LFPG', { provider: 'own' });
  assert.deepEqual({ s: noHall.status, e: noHall.body.error }, { s: 409, e: 'no_kitchen_hall' });
  assert.equal((await w.call('PUT', '/kitchen/LFLL', { provider: 'caterer' })).body.error, 'not_a_hub', 'a kitchen is for her hubs');
  assert.equal((await w.call('PUT', '/kitchen/LFPG', {})).status, 400);

  const id = await w.hall();
  const k0 = (await w.call('GET', '/kitchen/LFPG')).body as KitchenView;
  assert.deepEqual({ provider: k0.provider, held: k0.hall!.held, id: k0.hall!.facilityId }, { provider: 'caterer', held: false, id });
  assert.equal((await w.call('POST', `/facilities/${id}/lease`, {})).status, 201);
  const set = (await w.call('PUT', '/kitchen/LFPG', { provider: 'own', quality: 'gastronomique' })).body as KitchenView;
  assert.deepEqual({ p: set.provider, next: set.nextProvider, q: set.quality, nq: set.quality.next, eff: set.effectiveQuality }, { p: 'caterer', next: 'own', q: set.quality, nq: 'gastronomique', eff: 'soigne' });
  w.h.clock.t += DAY_MS;
  const k1 = (await w.call('GET', '/kitchen/LFPG')).body as KitchenView;
  assert.deepEqual({ p: k1.provider, next: k1.nextProvider, q: k1.quality.current, eff: k1.effectiveQuality }, { p: 'own', next: null, q: 'gastronomique', eff: 'gastronomique' });

  assert.equal((await w.call('POST', `/facilities/${id}/terminate`)).status, 200);
  assert.equal(providerAt(w.h.db, w.cid, 'LFPG', w.h.clock.t), 'caterer', 'nobody cooks in a building they gave back');
  assert.equal(providerAt(w.h.db, w.cid, 'LFPG', w.h.clock.t - 1000), 'own', 'a replayed instant before it sees the kitchen it had');
  const k2 = (await w.call('GET', '/kitchen/LFPG')).body as KitchenView;
  assert.deepEqual({ p: k2.provider, eff: k2.effectiveQuality, cap: k2.day.capacity }, { p: 'caterer', eff: 'soigne', cap: null });
});

test('the cooks set the output: too few and meals are not made, nor sold nor paid, and the passengers who expected them are less satisfied', async () => {
  const run1 = async (cooks: number | null) => {
    const w = await world();
    await w.call('PUT', '/service/policy', { haul: 'short', item: 'hot_meal', mode: 'free' });
    if (cooks !== null) {
      w.cooks(cooks);
      assert.equal((await w.call('POST', `/facilities/${await w.hall()}/lease`, {})).status, 201);
      assert.equal((await w.call('PUT', '/kitchen/LFPG', { provider: 'own' })).status, 200);
    }
    w.h.clock.t += DAY_MS; // the policy and the kitchen are in force from this midnight
    const t0 = w.h.clock.t;
    await w.call('GET', '/network');
    const mark = w.days().length;
    await w.advance(DAY_MS);
    const day2 = w.days().filter((d) => d.day === dayNo(t0 + DAY_MS) || d.day === dayNo(t0));
    return { w, day: day2.filter((d) => d.hub === 'LFPG'), mark };
  };
  const [full, short, none, caterer] = [await run1(6), await run1(1), await run1(0), await run1(null)];
  const at = (r: Awaited<ReturnType<typeof run1>>) => r.day.reduce((a, d) => ({ meals: a.meals + d.snacks + d.hot, unserved: a.unserved + d.unserved, pax: a.pax + d.pax, sat: a.sat + d.sat_pax }), { meals: 0, unserved: 0, pax: 0, sat: 0 });
  const f = at(full), s = at(short), n = at(none), c = at(caterer);
  assert.equal(f.unserved, 0, 'six cooks make 620 meals: the departures of LFPG are all served');
  assert.ok(s.meals > 0 && s.meals <= 2 * kitchenCapacity('soigne', 1) && s.unserved > 0, 'one cook makes 103 meals a day, whatever the passengers ask');
  assert.deepEqual({ meals: n.meals, short: n.unserved > 0 }, { meals: 0, short: true }, 'no cook, no meal');
  assert.equal(c.unserved, 0, 'a caterer has no cap');
  assert.ok(f.sat / f.pax > s.sat / s.pax && s.sat / s.pax > n.sat / n.pax, 'satisfaction falls with the meals not made');
  assert.ok(full.w.sum('service_sales') > none.w.sum('service_sales') && full.w.sum('service_cost') < none.w.sum('service_cost'), 'a meal not made is neither sold nor paid for (the cost is booked negative)');
});

test('a cook is hired from the market like anyone else, and the cooks hired are the cooks of the kitchen: capacity = cooks x maxOutput / team', async () => {
  const w = await world();
  assert.equal((await w.call('POST', `/facilities/${await w.hall()}/lease`, {})).status, 201);
  assert.equal((await w.call('PUT', '/kitchen/LFPG', { provider: 'own', quality: 'economy' })).status, 200);
  w.h.clock.t += DAY_MS; // the own kitchen is in force from this midnight
  const listed = (await w.call('GET', '/staff/candidates?family=kitchen&base=LFPG')).body as CandidatesView;
  assert.ok(listed.candidates.length >= 6, 'the market has cooks');
  assert.ok(listed.candidates.every((c) => c.family === 'kitchen' && c.role === 'cook' && c.qual === null && c.base === 'LFPG' && c.askingSalary > 0), 'cooks, at the hub, with no qualification');
  const cooksOf = async () => ((await w.call('GET', '/kitchen/LFPG')).body as KitchenView);
  assert.deepEqual({ employed: (await cooksOf()).cooks.employed, cap: (await cooksOf()).day.capacity }, { employed: 0, cap: 0 });

  const before = get<{ balance: number }>(w.h.db, 'SELECT balance FROM companies WHERE id = ?', w.cid)!.balance;
  const [first, second] = listed.candidates;
  const hired = await w.call('POST', '/staff/hire', { candidateId: first!.id });
  assert.equal(hired.status, 201, hired.text);
  assert.deepEqual({ family: hired.body.member.family, role: hired.body.member.role, premium: hired.body.premium }, { family: 'kitchen', role: 'cook', premium: first!.askingSalary });
  assert.equal(get<{ balance: number }>(w.h.db, 'SELECT balance FROM companies WHERE id = ?', w.cid)!.balance, before - first!.askingSalary);
  assert.equal((await cooksOf()).cooks.employed, 0, 'a cook in notice makes no meal yet');
  assert.equal((await w.call('POST', '/staff/hire', { candidateId: second!.id, startNow: true })).status, 201);
  w.h.clock.t += 8 * DAY_MS;
  const k = await cooksOf();
  assert.deepEqual({ employed: k.cooks.employed, onDuty: k.cooks.onDuty, cap: k.day.capacity }, { employed: 2, onDuty: 2, cap: kitchenCapacity('economy', 2) });
  assert.equal(k.day.capacity, Math.floor((2 * MEALS.economy.maxOutput) / MEALS.economy.team), 'cooks available x maxOutput / team');
  assert.ok(k.day.capacity! > 0);
});

test('a caterer quote is deterministic, has no chef\'s menu, and compares with an own kitchen\'s ingredients, cooks and hall', async () => {
  const w = await world();
  await w.advance(DAY_MS);
  const q1 = (await w.call('POST', '/kitchen/LFPG/quote', { quality: 'gastronomique' })).body as CatererQuote;
  const q2 = (await w.call('POST', '/kitchen/LFPG/quote', { quality: 'gastronomique' })).body as CatererQuote;
  assert.deepEqual(q1, q2);
  assert.deepEqual({ q: q1.quality, eff: q1.effectiveQuality }, { q: 'gastronomique', eff: 'soigne' });
  assert.ok(q1.perMeal > 0 && q1.snack > 0 && q1.monthly === Math.round(30 * (q1.mealsPerDay.snacks * q1.snack + q1.mealsPerDay.hot * q1.perMeal)));
  assert.ok(q1.own && q1.own.hallRent > 0 && q1.own.cooks >= 0);
  assert.equal((await w.call('POST', '/kitchen/LFLL/quote', {})).body.error, 'not_a_hub');
});

// ---------------------------------------------------------------- the screens' read models

test('GET /service: the table with its next-day changes, the meal cards, the crew, today\'s sales and cost; a refused mode changes nothing', async () => {
  const w = await world();
  let v = await w.sat();
  assert.deepEqual(v.hauls.map((h) => [h.haul, h.operated.map((o) => o.icao)]), [['short', ['AT76']], ['medium', []], ['long', []]]);
  const cell = (h: 'short' | 'medium' | 'long', item: string) => v.hauls.find((x) => x.haul === h)!.cells.find((c) => c.item === item)!;
  assert.deepEqual({ m: cell('short', 'snack').mode, u: cell('short', 'films').unavailable, w: cell('short', 'wifi').unavailable }, { m: 'paid', u: true, w: true }, 'an ATR has no screens or Wi-Fi');
  assert.deepEqual(cell('short', 'duty_free').allowed, ['none', 'paid']);
  assert.deepEqual(v.qualities.map((q) => [q.quality, q.price, q.catererAvailable]), [['economy', 9, true], ['soigne', 14, true], ['gastronomique', 23, false]]);
  assert.deepEqual(v.crew, [{ icao: 'AT76', name: catalogType('AT76').name, seats: 72, cabin: 2, legalMinimum: 2 }]);
  assert.deepEqual({ lines: v.network.lines, fpd: v.network.flightsPerDay, bonus: v.crewBonusPct, est: v.satisfaction.estimated }, { lines: 1, fpd: 6, bonus: 5, est: true });
  assert.equal(v.satisfaction.value, 3, 'before a flight: what the policy gives');
  assert.ok(v.perDay.sales > 0 && v.perDay.cost > 0, 'the day\'s legs still to fly are expected');
  assert.equal(v.applyFrom, Math.floor(T0 / DAY_MS) * DAY_MS + DAY_MS);

  const bad = await w.call('PUT', '/service/policy', { haul: 'short', item: 'duty_free', mode: 'free' });
  assert.equal(bad.status, 400);
  v = (await w.call('PUT', '/service/policy', { haul: 'short', item: 'snack', mode: 'free' })).body as ServiceView;
  assert.deepEqual({ now: cell('short', 'snack').mode, next: cell('short', 'snack').next }, { now: 'paid', next: 'free' }, '"applied tomorrow"');
  assert.equal((await w.call('PUT', '/service/policy', { haul: 'short', item: 'snack', mode: 'paid' })).body.hauls[0].cells.find((c: { item: string }) => c.item === 'snack').next, null, 'asking for what is in force again leaves nothing pending');
  v = (await w.call('PUT', '/service/meal-quality', { quality: 'economy' })).body as ServiceView;
  assert.deepEqual(v.quality, { current: 'soigne', next: 'economy' });
  assert.equal((await w.call('PUT', '/service/meal-quality', { quality: 'caviar' })).status, 400);
  assert.equal((await w.h.call('GET', `${V1}/service`)).status, 401);
});

test('GET /service/preview: what going gastronomique does to satisfaction, the meal margin, the meals and the cooks', async () => {
  const w = await world();
  await w.advance(DAY_MS);
  const p = (await w.call('GET', '/service/preview?quality=gastronomique')).body as ServicePreview;
  assert.deepEqual({ q: p.quality, cur: p.current }, { q: 'gastronomique', cur: 'soigne' });
  assert.deepEqual(p.mealMargin, { from: 0.54, to: 0.36 });
  assert.ok(p.satisfaction.from !== null && p.satisfaction.to !== null && p.satisfaction.to >= p.satisfaction.from);
  assert.ok(p.cooks.to > p.cooks.from, 'the chef\'s menu needs more cooks');
  assert.ok(p.meals.to <= p.meals.from, 'and makes fewer meals with the cooks you have');
  assert.equal((await w.call('GET', '/service/preview')).status, 400);
  assert.equal((await w.call('GET', '/service/preview?quality=soigne')).body.satisfaction.from, p.satisfaction.from, 'a preview books nothing');
  assert.equal(get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM service_policy')!.n, 0);
});

// ---------------------------------------------------------------- flights the player flew, and the reputation rule

test('a passenger flight the player flies serves its passengers too; cargo and an aircraft without a cabin crew do not', async () => {
  const w = await world({ line: false });
  const flight = (icao: string, kind: 'pax' | 'cargo', n: number): FlightRow => {
    const id = run(w.h.db, `INSERT INTO flights (company_id, aircraft_id, aircraft_icao, job_id, source, kind, origin, destination, distance_nm, payload_kg, pax, payout, status, accepted_at)
      VALUES (?, ?, ?, ?, 'board', ?, 'LFPG', 'LFLL', 200, ?, ?, 20000, 'active', ?)`, w.cid, w.ac, icao, `J${n}`, kind, kind === 'pax' ? 4000 : 800, kind === 'pax' ? 40 : 0, w.h.clock.t).id;
    return get<FlightRow>(w.h.db, 'SELECT * FROM flights WHERE id = ?', id)!;
  };
  const f1 = flight('AT76', 'pax', 1);
  finishFlight(w.h.db, f1, 'verified', w.h.clock.t + 3_600_000);
  const l = w.ledger();
  assert.deepEqual(l.map((t) => [t.kind, t.flightId]), [['service_sales', f1.id], ['service_cost', f1.id]]);
  assert.ok(l[0]!.amount > 0 && l[1]!.amount < 0);
  assert.equal(w.days().length, 1);
  assert.equal(w.days()[0]!.pax, 40);
  finishFlight(w.h.db, flight('AT76', 'cargo', 2), 'verified', w.h.clock.t + 7_200_000);
  finishFlight(w.h.db, flight('C172', 'pax', 3), 'verified', w.h.clock.t + 10_800_000);
  assert.equal(w.ledger().length, 2, 'nothing for cargo or a four-seater');
});

test('fourteen days of service below 3 cost 0.02 reputation for each further day with service, once a day; a good day breaks the streak', async () => {
  const w = await world({ line: false });
  const leg = (day: number, satisfaction = 2.5): LegPlan => ({ companyId: w.cid, day, hub: 'LFPG', pax: 50, satisfaction, sales: 0, cost: 0, snacks: 0, hot: 0, asked: 0, share: 1, provider: 'caterer' });
  const lost = (rep: number): number => Math.round((rep - w.reputation()) * 100) / 100;
  const today = dayNo(T0), rep = w.reputation();
  for (let d = today - SATISFACTION_STREAK_DAYS; d < today; d++) bookLeg(w.h.db, leg(d));
  assert.equal(lost(rep), 0, 'fourteen bad days are not yet fourteen bad days BEFORE the day being checked');
  bookLeg(w.h.db, leg(today));
  assert.equal(lost(rep), 0.02);
  bookLeg(w.h.db, leg(today));
  assert.equal(lost(rep), 0.02, 'checked by the first leg of the day only');
  bookLeg(w.h.db, leg(today + 1));
  assert.equal(lost(rep), 0.04);
  bookLeg(w.h.db, leg(today + 2, 4));
  assert.equal(lost(rep), 0.06, 'the good day itself still follows fourteen bad ones');
  bookLeg(w.h.db, leg(today + 3));
  bookLeg(w.h.db, leg(today + 4));
  assert.equal(lost(rep), 0.06, 'and now the streak is broken');
});
