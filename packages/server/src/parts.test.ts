import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DAY_MS, DELIVERY_DAYS, FAILURE_WEAR_PCT, FERRY_DAYS, FIX_HOURS_WITH_PART, HANGAR_FIX_HOURS, OVERHAUL_WEAR_PCT, PARTS, PARTS_OF_COMPONENT, PARTS_RESALE_FACTOR, REFURB_DAYS, RENEWED_WEAR_PCT, TRANSPORT_COST,
  componentRate, groundDaysPerYear, incidentRisk, kitCapital, kitCovers, partById, presetSetting, refurbCost, reliabilityRiskFactor, seedWear, settle,
  type OrderResult, type PolicyResult, type RefurbishResult, type WarehouseView, type WearView,
} from '@opc/shared';
import { catalogType } from './catalog.ts';
import { all, get, MIGRATIONS, openDb, run } from './db.ts';
import { accrueWear, flightCosts, insertAircraft } from './fleet-extras.ts';
import { harness } from './harness.ts';
import { componentRows, policiesAt, reliabilityRisk, targetsOf } from './parts.ts';
import { saveRealism } from './realism.ts';
import { rollIncident } from './safety.ts';

const V1 = '/api/v1';
const T0 = Date.UTC(2026, 10, 4, 12, 0, 0); // Wednesday 4 Nov 2026, 12:00Z (the harness clock)
const HOUR = 3_600_000;
type H = Awaited<ReturnType<typeof harness>>;

/** A player at LFPG with "wear and failures" on, plenty of money, an owned ATR 72 based at LFPG, and `call` acting as her. */
async function world(o: { wear?: boolean; money?: number; name?: string; h?: H } = {}) {
  const h = o.h ?? (await harness());
  const u = await h.register(o.name ?? 'amy', 'LFPG');
  const cid = u.me.company.id as number;
  if (o.wear !== false) saveRealism(h.db, cid, presetSetting('balanced'));
  run(h.db, 'UPDATE companies SET balance = ? WHERE id = ?', o.money ?? 20_000_000, cid);
  const atr = insertAircraft(h.db, { companyId: cid, icao: 'AT76', hub: 'LFPG', value: 1_500_000, ownership: 'owned', at: T0 });
  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: unknown) => h.call(method, `${V1}${url}`, { token: u.token, ...(body === undefined ? {} : { body }) });
  const balance = (): number => get<{ balance: number }>(h.db, 'SELECT balance FROM companies WHERE id = ?', cid)!.balance;
  const ledger = async (kind?: string): Promise<{ kind: string; amount: number; memo: string; at: number }[]> =>
    ((await call('GET', '/me/transactions?limit=200')).body as { kind: string; amount: number; memo: string; at: number }[]).filter((t) => kind === undefined || t.kind === kind);
  const warp = (t: number): void => { h.clock.t = t; run(h.db, 'UPDATE sessions SET expires_at = ?', t + 1_000_000_000); };
  const staff = (n: number, base = 'LFPG'): void => {
    for (let i = 0; i < n; i++) run(h.db, `INSERT INTO staff (company_id, family, name, role, base, hired_at, starts_at, salary, reliability, morale) VALUES (?, 'maintenance', ?, 'technician', ?, 0, 0, 4600, 80, 80)`, cid, `tech ${i}`, base);
  };
  const warehouse = async (hub = 'LFPG'): Promise<WarehouseView> => (await call('GET', `/warehouse/${hub}`)).body;
  const wear = async (id = atr, query = ''): Promise<WearView> => (await call('GET', `/me/fleet/${id}/wear${query}`)).body;
  const setComponent = (id: number, component: string, pct: number): void => { run(h.db, 'INSERT INTO aircraft_components (aircraft_id, component, wear_pct) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET wear_pct = excluded.wear_pct', id, component, pct); };
  const fly = (id = atr, hours = 1, at = h.clock.t): void => accrueWear(h.db, cid, id, 'turboprop-airliner', hours, at);
  const aircraft = (id = atr) => get<{ status: string; maintenance_until: number | null; wear_pct: number }>(h.db, 'SELECT status, maintenance_until, wear_pct FROM aircraft WHERE id = ?', id)!;
  return { h, u, cid, atr, call, balance, ledger, warp, staff, warehouse, wear, setComponent, fly, aircraft };
}
type W = Awaited<ReturnType<typeof world>>;
const breakdowns = (w: W) => all<{ component: string; part: string; failed_at: number; eta: number; ready_at: number; paid: number; from_stock: number; hub: string }>(w.h.db, 'SELECT * FROM breakdowns ORDER BY id');
/** Put a part on the shelf of LFPG without paying for it (the tests of the breakdown are not about buying). */
const shelve = (w: W, partId: string, qty: number): void => { run(w.h.db, 'INSERT INTO parts_stock (company_id, hub, part, qty) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET qty = excluded.qty', w.cid, 'LFPG', partId, qty); };

// ---------------------------------------------------------------- SCHEMA_V11

test('SCHEMA_V11 creates the parts tables on a fresh database; a database one migration behind upgrades with its rows intact', () => {
  assert.ok(MIGRATIONS.some((m) => m.includes('aircraft_components')));
  const db = openDb(':memory:');
  assert.equal(get<{ user_version: number }>(db, 'PRAGMA user_version')!.user_version, MIGRATIONS.length);
  for (const t of ['aircraft_components', 'parts_stock', 'parts_orders', 'parts_policy', 'breakdowns']) assert.ok(get(db, "SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?", t), t);

  const at = MIGRATIONS.findIndex((m) => m.includes('CREATE TABLE aircraft_components'));
  const file = join(mkdtempSync(join(tmpdir(), 'opc-v11-')), 'before.sqlite');
  const raw = new DatabaseSync(file);
  for (let i = 0; i < at; i++) raw.exec(MIGRATIONS[i]!);
  raw.exec(`PRAGMA user_version = ${at}`);
  raw.exec("INSERT INTO users (id, username, pass_hash, created_at) VALUES (1, 'a', 'h', 1); INSERT INTO companies (id, user_id, name, balance, reputation, created_at) VALUES (1, 1, 'A Air', 5, 50, 1);");
  raw.exec("INSERT INTO aircraft (id, company_id, icao, location, value, registration, ownership, base, acquired_at) VALUES (1, 1, 'AT76', 'LFPG', 1000, 'F-HAZA', 'owned', 'LFPG', 1);");
  raw.close();
  const up = openDb(file);
  assert.equal(get<{ user_version: number }>(up, 'PRAGMA user_version')!.user_version, MIGRATIONS.length);
  assert.equal(get<{ balance: number }>(up, 'SELECT balance FROM companies WHERE id = 1')!.balance, 5);
  assert.equal(get<{ n: number }>(up, 'SELECT COUNT(*) AS n FROM aircraft')!.n, 1);
  assert.deepEqual(all(up, 'SELECT * FROM aircraft_components'), [], 'nothing is invented for existing aircraft: components are made when an aircraft wears');
});

// ---------------------------------------------------------------- components: seeded from the lease, worn by the hours

test('a leased aircraft starts at the wear its offer\'s airframe hours imply, an aircraft bought new at zero; looking writes nothing', async () => {
  const w = await world();
  const offer = (await w.call('GET', '/leasing/offers?icao=DHC6')).body[0];
  const lease = await w.call('POST', '/me/leases', { offerId: offer.id, months: 24, hub: 'LFPG' });
  assert.equal(lease.status, 201, lease.text);
  const dhc6 = lease.body.aircraft.id as number;
  const v = await w.wear(dhc6);
  assert.deepEqual(v.components.map((c) => c.component), ['engines', 'gear', 'propellers', 'avionics', 'interior', 'paint']);
  for (const c of v.components) assert.equal(c.wearPct, Math.round(seedWear(c.component, 'turboprop-multi', offer.airframeHours) * 10) / 10, c.component);
  assert.ok(v.components.every((c) => c.wearPct > 0));
  assert.equal(get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM aircraft_components')!.n, 0, 'a read writes no component row');

  const fresh = await w.wear(w.atr);
  assert.ok(fresh.components.every((c) => c.wearPct === 0), 'bought new');
  assert.equal(fresh.components.length, 6, 'a turboprop airliner has propellers');
  const jet = insertAircraft(w.h.db, { companyId: w.cid, icao: 'A20N', hub: 'LFPG', value: 5_000_000, ownership: 'owned', at: T0 });
  assert.equal((await w.wear(jet)).components.some((c) => c.component === 'propellers'), false, 'a jet has none');
});

test('flying wears every component by its weight and the hours; with "wear and failures" off nothing wears and no row is made', async () => {
  const w = await world();
  w.fly(w.atr, 100);
  const rows = Object.fromEntries(componentRows(w.h.db, w.atr).map((r) => [r.component, r.wear_pct]));
  for (const c of ['engines', 'gear', 'propellers', 'avionics', 'interior', 'paint'] as const) assert.equal(rows[c], Math.round(componentRate(c, 'turboprop-airliner') * 100 * 100) / 100, c);
  assert.ok(rows.engines! > rows.gear! && rows.gear! > rows.paint!, 'the engines wear the most');

  const off = await world({ wear: false, name: 'bob', h: w.h });
  off.fly(off.atr, 500);
  assert.deepEqual(all(w.h.db, 'SELECT * FROM aircraft_components WHERE aircraft_id = ?', off.atr), []);
  assert.equal(get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM breakdowns')!.n, 0);
  assert.equal(off.aircraft().wear_pct, 0, 'the existing wear is off too');
});

test('an AI company\'s aircraft never wear a component (they are not simulated at that depth)', async () => {
  const h = await harness({ ai: true });
  const ai = get<{ id: number }>(h.db, 'SELECT id FROM companies WHERE user_id IS NULL LIMIT 1')!;
  const a = get<{ id: number; icao: string }>(h.db, 'SELECT id, icao FROM aircraft WHERE company_id = ? LIMIT 1', ai.id);
  if (!a) return;
  accrueWear(h.db, ai.id, a.id, 'turboprop-airliner', 500, T0);
  assert.deepEqual(all(h.db, 'SELECT * FROM aircraft_components WHERE aircraft_id = ?', a.id), []);
});

// ---------------------------------------------------------------- effects of wear on money and on the incident roll

test('worn components cost a flight: fewer passengers, more fuel and maintenance; nothing when wear is off; the same flight on a new aircraft is untouched', async () => {
  const w = await world();
  const s = settle({ payout: 40_000, distanceNm: 400, aircraft: catalogType('AT76'), status: 'verified', destSize: 'large', destIsHub: false });
  const cost = (id: number) => flightCosts(w.h.db, id, 2, s, 'turboprop-airliner', T0).settlement;
  const raw = cost(w.atr);
  assert.deepEqual([raw.revenue, raw.fuelCost, raw.maintenance], [s.revenue, s.fuelCost, s.maintenance], 'nothing has worn: the settlement is the settle() one');
  w.setComponent(w.atr, 'interior', 80); w.setComponent(w.atr, 'engines', 80);
  const worn = cost(w.atr);
  assert.ok(worn.revenue < raw.revenue && worn.fuelCost > raw.fuelCost && worn.maintenance > raw.maintenance, JSON.stringify([raw, worn]));
  assert.equal(worn.net, worn.revenue - worn.fuelCost - worn.landingFee - worn.maintenance);
  assert.ok(Math.abs(worn.revenue / raw.revenue - 0.96 * (1 - 0.04 * 0.6)) < 0.001, 'interior at 80 %: -4 % passengers and -0.6 satisfaction');

  const off = await world({ wear: false, name: 'bob', h: w.h });
  off.setComponent(off.atr, 'interior', 80);
  assert.deepEqual(flightCosts(off.h.db, off.atr, 2, s, 'turboprop-airliner', T0).settlement, s, 'wear off: components cost nothing');
});

test('worn gear and avionics make the incident roll riskier by the reliability they cost', async () => {
  const w = await world();
  assert.equal(reliabilityRisk(w.h.db, w.atr), 1, 'no components yet');
  w.setComponent(w.atr, 'gear', 80); w.setComponent(w.atr, 'avionics', 80);
  assert.equal(reliabilityRisk(w.h.db, w.atr), reliabilityRiskFactor(5));
  const roll = (ref: string) => rollIncident(w.h.db, { ref, companyId: w.cid, aircraftId: w.atr, at: T0, airport: 'LFPG', flightId: null, flightNo: 1, dutyMin: 14 * 60, riskFactor: 1, wearPct: 70, landedAt: T0 });
  let found = null;
  for (let i = 0; i < 4000 && !found; i++) found = roll(`flight:${i}`);
  assert.ok(found, 'at 14 h of duty a roll ends in an incident within a few thousand tries');
  assert.equal(found!.risk, incidentRisk(14, 70, reliabilityRiskFactor(5)), 'the stored risk carries the worn components');
  assert.ok(found!.risk > incidentRisk(14, 70));
});

// ---------------------------------------------------------------- breakdowns

test('a mechanical component reaching its failure wear is a breakdown: no part on the shelf means the delivery plus the repair, the part and its freight are billed, the component starts again', async () => {
  const w = await world();
  w.setComponent(w.atr, 'engines', FAILURE_WEAR_PCT - 0.01);
  const before = w.balance();
  w.fly(w.atr, 1, T0);
  const [b] = breakdowns(w);
  assert.ok(b, 'a breakdown was recorded');
  assert.equal(b!.component, 'engines');
  assert.ok((PARTS_OF_COMPONENT.engines as readonly string[]).includes(b!.part.split('.')[1]!), b!.part);
  assert.equal(b!.from_stock, 0);
  const days = (b!.eta - T0) / DAY_MS;
  assert.ok((DELIVERY_DAYS as readonly number[]).includes(days), `${days} days of delivery`);
  assert.equal(b!.ready_at, b!.eta + FIX_HOURS_WITH_PART * HOUR);
  const part = partById(b!.part)!;
  assert.equal(b!.paid, part.price + TRANSPORT_COST.regional.normal);
  assert.equal(w.balance(), before - b!.paid);
  assert.deepEqual((await w.ledger('parts_emergency')).map((t) => t.amount), [-b!.paid]);
  assert.deepEqual({ ...w.aircraft() }, { status: 'maintenance', maintenance_until: b!.ready_at, wear_pct: w.aircraft().wear_pct });
  assert.equal(componentRows(w.h.db, w.atr).find((r) => r.component === 'engines')!.wear_pct, RENEWED_WEAR_PCT);
  // the workshop hands it back when the repair is over
  w.warp(b!.ready_at + 1);
  assert.equal((await w.call('GET', '/me')).body.fleet.find((f: { id: number }) => f.id === w.atr).status, 'available');
});

test('with the failed part on the shelf the repair takes six hours, costs nothing but the part, and the shelf is topped up to the policy (a standing order, no freight)', async () => {
  const w = await world();
  assert.equal((await w.call('PUT', '/warehouse/LFPG/policy', { icao: 'AT76', policy: 'full' })).status, 200);
  w.warp(T0 + 6 * DAY_MS); await w.warehouse(); // the kit has arrived
  const engineId = 'regional.engine';
  const stock = (id: string) => get<{ qty: number }>(w.h.db, 'SELECT qty FROM parts_stock WHERE company_id = ? AND hub = ? AND part = ?', w.cid, 'LFPG', id)?.qty ?? 0;
  assert.equal(stock(engineId), 1);
  w.setComponent(w.atr, 'engines', FAILURE_WEAR_PCT - 0.01);
  const at = w.h.clock.t, balance = w.balance();
  w.fly(w.atr, 1, at);
  const [b] = breakdowns(w);
  assert.equal(b!.from_stock, 1);
  assert.equal(b!.paid, 0);
  assert.equal(b!.eta, at);
  assert.equal(b!.ready_at, at + FIX_HOURS_WITH_PART * HOUR, 'six hours');
  assert.equal(stock(b!.part), 0, 'the part left the shelf');
  const standing = all<{ part: string; qty: number; cost: number; eta: number }>(w.h.db, 'SELECT * FROM parts_orders WHERE received = 0');
  assert.equal(standing.length, 1);
  assert.deepEqual([standing[0]!.part, standing[0]!.qty, standing[0]!.cost], [b!.part, 1, partById(b!.part)!.price], 'ordered back to the policy, parts only');
  assert.equal(w.balance(), balance - partById(b!.part)!.price);
  assert.equal(get<{ n: number }>(w.h.db, "SELECT COUNT(*) AS n FROM transactions WHERE kind = 'parts_emergency'")!.n, 0);
  w.warp(standing[0]!.eta + 1); await w.warehouse();
  assert.equal(stock(b!.part), 1, 'the shelf is full again once the order arrives');
});

test('a staffed level-2 hangar fixes an AOG in four hours; without technicians it is the normal six', async () => {
  const w = await world();
  const lease = async () => w.call('POST', `/facilities/${(await w.call('GET', '/hubs/LFPG/plan')).body.buildings.find((b: { slot: string }) => b.slot === 'MX1').facilityId}/lease`, { level: 2 });
  assert.equal((await lease()).status, 201);
  shelve(w, 'regional.engine', 1); shelve(w, 'regional.starter', 1);
  w.setComponent(w.atr, 'engines', FAILURE_WEAR_PCT - 0.01);
  w.warp(T0 + 30 * DAY_MS);
  w.fly(w.atr, 1, w.h.clock.t);
  assert.equal(breakdowns(w)[0]!.ready_at - breakdowns(w)[0]!.failed_at, FIX_HOURS_WITH_PART * HOUR, 'a hangar with no technicians does not count');
  run(w.h.db, "UPDATE aircraft SET status = 'available', maintenance_until = NULL");
  w.staff(10);
  shelve(w, 'regional.engine', 1); shelve(w, 'regional.starter', 1);
  w.setComponent(w.atr, 'engines', FAILURE_WEAR_PCT - 0.01);
  w.warp(w.h.clock.t + DAY_MS);
  w.fly(w.atr, 1, w.h.clock.t);
  const b = breakdowns(w)[1]!;
  assert.equal(b.ready_at - b.failed_at, HANGAR_FIX_HOURS * HOUR, 'B.4: AOG fixed in 4 h');
});

test('a lessor with maintenance included and the club pay for the part themselves; the aircraft still waits for it', async () => {
  const w = await world();
  const offers = (await w.call('GET', '/leasing/offers?icao=DHC6')).body[0];
  const lease = (await w.call('POST', '/me/leases', { offerId: offers.id, months: 24, hub: 'LFPG' })).body.aircraft.id as number;
  assert.equal(offers.maintenanceIncluded, true);
  w.setComponent(lease, 'engines', FAILURE_WEAR_PCT - 0.01);
  const before = w.balance();
  accrueWear(w.h.db, w.cid, lease, 'turboprop-multi', 1, T0);
  const b = breakdowns(w).find((x) => x.component === 'engines')!;
  assert.equal(b.paid, 0, 'the lessor pays');
  assert.equal(w.balance(), before);
  assert.ok(b.ready_at > b.failed_at, 'the aircraft is still out of service for the delivery');

  const club = await w.call('POST', '/me/club-rental', { icao: 'C172', hub: 'LFPG' });
  assert.equal(club.status, 201, club.text);
  const cessna = club.body.aircraft.id as number;
  w.setComponent(cessna, 'engines', FAILURE_WEAR_PCT - 0.01);
  const cash = w.balance();
  accrueWear(w.h.db, w.cid, cessna, 'piston-single', 1, T0);
  const c = breakdowns(w).find((x) => x.component === 'engines' && x.failed_at === T0 && x.hub === 'LFPG' && x.paid === 0 && x.part.startsWith('piston'))!;
  assert.ok(c, 'the club\'s Cessna broke down');
  assert.equal(w.balance(), cash, 'the club pays');
  const own = insertAircraft(w.h.db, { companyId: w.cid, icao: 'C172', hub: 'LFPG', value: 40_000, ownership: 'owned', at: T0 });
  w.setComponent(own, 'engines', FAILURE_WEAR_PCT - 0.01);
  accrueWear(w.h.db, w.cid, own, 'piston-single', 1, T0);
  assert.ok(w.balance() < cash, 'her own Cessna pays for its part');
});

test('a breakdown played twice is recorded once and billed once; the same world gives the same breakdown', async () => {
  const run1 = async () => {
    const w = await world();
    w.setComponent(w.atr, 'avionics', FAILURE_WEAR_PCT - 0.01);
    w.fly(w.atr, 1, T0);
    return w;
  };
  const a = await run1(), b = await run1();
  assert.deepEqual(breakdowns(a), breakdowns(b), 'seeded by aircraft, component and instant');
  const bal = a.balance();
  a.setComponent(a.atr, 'avionics', FAILURE_WEAR_PCT + 3);
  a.fly(a.atr, 1, T0);
  assert.equal(breakdowns(a).length, 1, 'the same instant is the same breakdown');
  assert.equal(a.balance(), bal, 'and costs nothing twice');
});

test('a breakdown replayed with the part on the shelf takes the part once', async () => {
  const w = await world();
  shelve(w, 'regional.avionics', 3); shelve(w, 'regional.engine', 3); shelve(w, 'regional.starter', 3);
  w.setComponent(w.atr, 'engines', FAILURE_WEAR_PCT - 0.01);
  w.fly(w.atr, 1, T0);
  const shelf = () => get<{ n: number }>(w.h.db, 'SELECT SUM(qty) AS n FROM parts_stock')!.n;
  const after = shelf();
  assert.equal(after, 8, 'one part left the shelf');
  w.setComponent(w.atr, 'engines', FAILURE_WEAR_PCT + 1);
  w.fly(w.atr, 1, T0);
  assert.equal(shelf(), after, 'the replay took nothing');
  assert.equal(breakdowns(w).length, 1);
});

test('the interior and the paint wear but never break down', async () => {
  const w = await world();
  w.setComponent(w.atr, 'interior', 99); w.setComponent(w.atr, 'paint', 99);
  w.fly(w.atr, 1, T0);
  assert.equal(breakdowns(w).length, 0);
  assert.deepEqual(componentRows(w.h.db, w.atr).filter((r) => r.wear_pct >= FAILURE_WEAR_PCT).map((r) => r.component), ['interior', 'paint'], 'worn past the failure wear, and still flying');
  assert.equal(w.aircraft().status, 'available');
});

// ---------------------------------------------------------------- the warehouse

test('a policy buys the kit of the type for the hub: parts only, delivered in 2 to 5 days, on the shelf once they arrive; the screen carries what each choice ties up and the ground days it leaves', async () => {
  const w = await world();
  const before = w.balance();
  const r = await w.call('PUT', '/warehouse/LFPG/policy', { icao: 'AT76', policy: 'full' });
  assert.equal(r.status, 200, r.text);
  const res = r.body as PolicyResult;
  assert.deepEqual([res.ordered, res.capital, res.refund, res.balanceAfter], [kitCapital('regional', 'full'), 382_500, 0, before - 382_500]);
  assert.equal(w.balance(), before - 382_500);
  assert.ok(res.deltaGroundDays < 0 && res.annualSaving > 0, 'fewer ground days a year, which are worth money');
  assert.ok(Math.abs(res.deltaGroundDays + groundDaysPerYear('turboprop-airliner', () => false) - groundDaysPerYear('turboprop-airliner', kitCovers('regional', 'full'))) < 1e-9, 'delta = full - none, for the aircraft of the type');

  const v0 = await w.warehouse();
  assert.equal(v0.capital, 0, 'still on its way');
  assert.equal(v0.onOrder, 382_500);
  assert.ok(v0.orders.length > 0 && v0.orders.every((o) => o.eta - T0 >= 2 * DAY_MS && o.eta - T0 <= 5 * DAY_MS));
  const atr0 = v0.policies.find((p) => p.icao === 'AT76')!;
  assert.deepEqual(v0.policies.map((p) => [p.icao, p.policy]), [['C172', 'none'], ['AT76', 'full']], 'in fleet order; the starter Cessna has its own, empty, policy');
  assert.deepEqual(atr0.options.map((o) => [o.policy, o.capital]), [['none', 0], ['critical', kitCapital('regional', 'critical')], ['full', 382_500]]);
  assert.equal(atr0.covered, false);

  w.warp(T0 + 6 * DAY_MS);
  const v = await w.warehouse();
  assert.equal(v.capital, 382_500);
  assert.equal(v.onOrder, 0);
  assert.deepEqual(v.covered, { count: 1, of: 2 }, 'the ATR is covered, the Cessna is not');
  const atr = v.policies.find((p) => p.icao === 'AT76')!;
  assert.ok(atr.covered && atr.expectedGroundDays < atr0.expectedGroundDays, 'the shelf now cuts the expected ground days');
  assert.equal(v.inventory.find((l) => l.part === 'regional.engine')!.qty, 1);
  assert.equal(v.facility, null);
  assert.deepEqual((await w.warehouse()), v, 'idempotent: reading again changes nothing');
});

test('lowering a policy sells back what only the old one asked for, at 80 %; what the player ordered by hand stays', async () => {
  const w = await world();
  await w.call('PUT', '/warehouse/LFPG/policy', { icao: 'AT76', policy: 'full' });
  w.warp(T0 + 6 * DAY_MS);
  await w.call('POST', '/warehouse/LFPG/order', { partId: 'regional.engine', qty: 1 });
  w.warp(T0 + 12 * DAY_MS);
  const before = w.balance();
  const r = (await w.call('PUT', '/warehouse/LFPG/policy', { icao: 'AT76', policy: 'critical' })).body as PolicyResult;
  const expected = PARTS.filter((p) => p.cls === 'regional').reduce((t, p) => {
    const gone = Math.max(0, p.full - p.critical);
    const have = p.id === 'regional.engine' ? 2 : p.full;
    return t + Math.round(p.price * Math.min(have, gone) * PARTS_RESALE_FACTOR);
  }, 0);
  assert.equal(r.refund, expected);
  assert.equal(w.balance(), before + expected);
  const v = await w.warehouse();
  assert.equal(v.inventory.find((l) => l.part === 'regional.engine')!.qty, 1, 'the hand-ordered engine beyond the kit was sold only as far as the full kit asked: one stays');
  assert.deepEqual(await w.ledger('parts_sale').then((l) => l.length > 0), true);
  const none = (await w.call('PUT', '/warehouse/LFPG/policy', { icao: 'AT76', policy: 'none' })).body as PolicyResult;
  assert.ok(none.deltaGroundDays > 0 && none.annualSaving < 0, 'giving the stock up costs ground days');
});

test('a policy is refused for a type with no aircraft at the hub, for a hub that is not hers, and when the balance cannot carry the kit; nothing is half-booked', async () => {
  const w = await world({ money: 100_000 });
  assert.equal((await w.call('PUT', '/warehouse/LFPG/policy', { icao: 'A20N', policy: 'full' })).body.error, 'no_aircraft');
  assert.equal((await w.call('PUT', '/warehouse/EGLL/policy', { icao: 'AT76', policy: 'full' })).body.error, 'not_a_hub');
  const r = await w.call('PUT', '/warehouse/LFPG/policy', { icao: 'AT76', policy: 'full' });
  assert.equal(r.status, 409, r.text);
  assert.equal(r.body.error, 'insufficient_funds');
  assert.equal(r.body.missing, 382_500 - 100_000);
  assert.equal(w.balance(), 100_000);
  assert.deepEqual(all(w.h.db, 'SELECT * FROM parts_policy'), [], 'the refused policy is not stored');
  assert.deepEqual(all(w.h.db, 'SELECT * FROM parts_orders'), []);
  assert.equal((await w.call('PUT', '/warehouse/LFPG/policy', { icao: 'AT76', policy: 'rich' })).status, 400);
});

test('ordering a part: the price and the freight leave now, it arrives in 2 to 5 days (one day express, dearer), then sits on the shelf; unknown parts, nothing to pay with and bad quantities are refused', async () => {
  const w = await world();
  const part = partById('regional.brake')!;
  const before = w.balance();
  const r = await w.call('POST', '/warehouse/LFPG/order', { partId: part.id, qty: 2 });
  assert.equal(r.status, 201, r.text);
  const o = r.body as OrderResult;
  assert.equal(o.cost, 2 * part.price + TRANSPORT_COST.regional.normal);
  assert.equal(w.balance(), before - o.cost);
  assert.equal(o.balanceAfter, w.balance());
  assert.ok(o.order.eta - T0 >= 2 * DAY_MS && o.order.eta - T0 <= 5 * DAY_MS && !o.order.express);
  const x = (await w.call('POST', '/warehouse/LFPG/order', { partId: part.id, qty: 1, express: true })).body as OrderResult;
  assert.equal(x.order.eta, T0 + DAY_MS);
  assert.equal(x.cost, part.price + TRANSPORT_COST.regional.express);
  assert.ok(TRANSPORT_COST.regional.express > TRANSPORT_COST.regional.normal);

  w.warp(T0 + DAY_MS + 1);
  assert.deepEqual((await w.warehouse()).inventory.find((l) => l.part === part.id)!.qty, 1, 'the express one has arrived');
  w.warp(T0 + 6 * DAY_MS);
  const v = await w.warehouse();
  assert.equal(v.inventory.find((l) => l.part === part.id)!.qty, 3);
  assert.equal(v.orders.length, 0);
  assert.equal(v.capital, 3 * part.price);
  assert.equal((await w.call('POST', '/warehouse/LFPG/order', { partId: 'regional.nope', qty: 1 })).body.error, 'unknown_part');
  assert.equal((await w.call('POST', '/warehouse/LFPG/order', { partId: part.id, qty: 0 })).status, 400);
  assert.equal((await w.call('POST', '/warehouse/EGLL/order', { partId: part.id, qty: 1 })).body.error, 'not_a_hub');
  run(w.h.db, 'UPDATE companies SET balance = 100 WHERE id = ?', w.cid);
  const poor = await w.call('POST', '/warehouse/LFPG/order', { partId: part.id, qty: 1 });
  assert.deepEqual([poor.status, poor.body.error], [409, 'insufficient_funds']);
  assert.equal(w.balance(), 100);
});

test('the AOG case of the warehouse: the aircraft on the ground, its part and delivery date, what the days cost, when the part would have had it flying, and what the critical kit would have tied up', async () => {
  const w = await world();
  assert.equal((await w.warehouse()).aog, null);
  w.setComponent(w.atr, 'engines', FAILURE_WEAR_PCT - 0.01);
  w.fly(w.atr, 1, T0);
  const b = breakdowns(w)[0]!;
  const v = await w.warehouse();
  const aog = v.aog!;
  assert.deepEqual([aog.aircraftId, aog.component, aog.part, aog.failedAt, aog.eta, aog.readyAt, aog.fromStock, aog.paid], [w.atr, 'engines', b.part, T0, b.eta, b.ready_at, false, b.paid]);
  assert.equal(aog.withPartBackAt, T0 + FIX_HOURS_WITH_PART * HOUR);
  assert.ok(aog.withPartBackAt < aog.readyAt);
  assert.equal(aog.criticalKit, kitCapital('regional', 'critical'));
  assert.ok(aog.dayValue > 0 && aog.lost === Math.round(((b.ready_at - T0) / DAY_MS) * aog.dayValue));
  w.warp(b.ready_at + HOUR);
  assert.equal((await w.warehouse()).aog, null, 'repaired: the case is closed');
});

// ---------------------------------------------------------------- the wear screen and the workshop

test('GET wear: components with their choices, the effects now and after, the recommended works, totals and the balance after; ?pick= previews another selection', async () => {
  const w = await world();
  for (const [c, pct] of [['engines', 20], ['gear', 76], ['propellers', 64], ['avionics', 70], ['interior', 68], ['paint', 58]] as const) w.setComponent(w.atr, c, pct);
  const v = await w.wear();
  assert.deepEqual([v.active, v.refurbishable, v.lease, v.months, v.hoursPerMonth], [true, true, null, 24, 80]);
  assert.equal(v.aircraft.registration.startsWith('F-'), true);
  const gear = v.components.find((c) => c.component === 'gear')!;
  assert.equal(gear.wearPct, 76);
  assert.ok(gear.choices.leave.monthlyLoss > 0 && gear.choices.overhaul.cost === refurbCost('overhaul', 'gear', 1_500_000));
  assert.ok(gear.choices.overhaul.paybackMonths !== null && gear.choices.overhaul.net > 0, 'a worn gear pays back');
  assert.ok(v.kpi.after.reliability > v.kpi.now.reliability, 'the recommended works raise the reliability');
  const picked = v.recommended.filter((s) => s.action !== 'leave');
  assert.ok(picked.length > 0 && picked.every((s) => v.components.find((c) => c.component === s.component)!.choices[s.action].net > 0));
  assert.equal(v.totals.cost, picked.reduce((t, s) => t + v.components.find((c) => c.component === s.component)!.choices[s.action].cost, 0));
  assert.equal(v.balanceAfter, w.balance() - v.totals.cost - v.works.ferryCost);
  assert.equal(v.totals.cashCurve.length, 24);
  assert.deepEqual(v.selection, v.recommended);

  const none = await w.wear(w.atr, '?pick=gear:leave');
  assert.deepEqual([none.totals.cost, none.totals.cashCurve.every((x) => x === 0), none.works.days, none.balanceAfter], [0, true, 0, w.balance()]);
  const one = await w.wear(w.atr, '?pick=gear:replace');
  assert.equal(one.totals.cost, gear.choices.replace.cost);
  assert.deepEqual(one.selection, [{ component: 'gear', action: 'replace' }]);
  assert.equal((await w.call('GET', `/me/fleet/${w.atr}/wear?pick=wings:replace`)).status, 400);
  assert.equal((await w.call('GET', `/me/fleet/${w.atr}/wear?pick=gear:polish`)).status, 400);
  assert.equal((await w.call('GET', '/me/fleet/999999/wear')).status, 404);
  assert.equal((await w.call('GET', '/me/fleet/abc/wear')).status, 404);
});

test('a leased aircraft: the horizon is the months left, handing it back and buying it give two totals, and the lease terms are on the screen', async () => {
  const w = await world();
  const offer = (await w.call('GET', '/leasing/offers?icao=DHC6')).body[0];
  const id = (await w.call('POST', '/me/leases', { offerId: offer.id, months: 24, hub: 'LFPG' })).body.aircraft.id as number;
  const v = await w.wear(id);
  assert.equal(v.months, 24);
  assert.deepEqual([v.lease!.monthsLeft, v.lease!.purchaseOptionPrice, v.lease!.maintenanceIncluded, v.lease!.lessor], [24, offer.purchaseOptionPrice, offer.maintenanceIncluded, offer.lessor]);
  assert.ok(v.totals.buy > v.totals.give, 'buying the aircraft keeps the new parts');
  assert.ok(v.totals.give > 0, 'with these hours some works pay back in the term');
  const later = await (async () => { w.warp(T0 + 400 * DAY_MS); return w.wear(id); })();
  assert.ok(later.months < v.months && later.months >= 10, `${later.months} months left`);
  assert.equal(later.totals.cashCurve.length, later.months);
});

test('refurbishing: the works are paid now, the aircraft is out of service for the longest item, the components start over, and what was previewed is what was booked', async () => {
  const w = await world();
  for (const [c, pct] of [['gear', 76], ['avionics', 70], ['interior', 68]] as const) w.setComponent(w.atr, c, pct);
  const items = [{ component: 'gear', action: 'overhaul' }, { component: 'avionics', action: 'overhaul' }, { component: 'interior', action: 'replace' }] as const;
  const pick = '?pick=gear:overhaul,avionics:overhaul,interior:replace';
  const preview = await w.wear(w.atr, pick);
  const before = w.balance();
  const r = await w.call('POST', `/me/fleet/${w.atr}/refurbish`, { items });
  assert.equal(r.status, 200, r.text);
  const res = r.body as RefurbishResult;
  assert.equal(res.cost, preview.totals.cost + preview.works.ferryCost);
  assert.equal(res.balanceAfter, preview.balanceAfter);
  assert.equal(w.balance(), before - res.cost);
  assert.equal(res.downUntil, T0 + preview.works.days * DAY_MS);
  assert.equal(res.downUntil, T0 + Math.max(...items.map((i) => REFURB_DAYS[i.action][i.component])) * DAY_MS, 'no hangar: the longest item, and ten days is not a heavy check: no ferry');
  assert.equal(res.ferry, 0);
  assert.deepEqual(res.items.map((i) => [i.component, i.cost]), items.map((i) => [i.component, refurbCost(i.action, i.component, 1_500_000)]));
  const rows = Object.fromEntries(componentRows(w.h.db, w.atr).map((c) => [c.component, c.wear_pct]));
  assert.deepEqual([rows.gear, rows.avionics, rows.interior], [OVERHAUL_WEAR_PCT, OVERHAUL_WEAR_PCT, 0]);
  assert.deepEqual({ status: w.aircraft().status, until: w.aircraft().maintenance_until }, { status: 'maintenance', until: res.downUntil });
  assert.equal((await w.ledger('refurbish')).length, 3);
  assert.equal((await w.wear()).components.find((c) => c.component === 'gear')!.worksUntil, res.downUntil);
  // in the workshop: refused until it is out, and it comes out serviced
  assert.equal((await w.call('POST', `/me/fleet/${w.atr}/refurbish`, { items: [{ component: 'paint', action: 'overhaul' }] })).body.error, 'in_maintenance');
  w.warp(res.downUntil + 1);
  const out = (await w.call('GET', '/me')).body.fleet.find((f: { id: number }) => f.id === w.atr);
  assert.deepEqual([out.status, out.wearPct], ['available', 5]);
});

test('a hangar at the base halves the days of a workshop visit; a heavy check without a staffed level-2 hangar adds the convoy fee and two days, with one it does not', async () => {
  const heavy = [{ component: 'engines', action: 'replace' }] as const;
  const plain = await world();
  plain.setComponent(plain.atr, 'engines', 85);
  const pv = await plain.wear(plain.atr, '?pick=engines:replace');
  assert.ok(pv.works.ferry && pv.works.ferryCost > 0, 'an engine replacement is a heavy check');
  assert.equal(pv.works.days, REFURB_DAYS.replace.engines + FERRY_DAYS);
  const rp = (await plain.call('POST', `/me/fleet/${plain.atr}/refurbish`, { items: heavy })).body as RefurbishResult;
  assert.equal(rp.ferry, pv.works.ferryCost);
  assert.equal(rp.cost, refurbCost('replace', 'engines', 1_500_000) + rp.ferry);
  assert.equal((await plain.ledger('ferry')).length, 1);
  assert.equal(rp.downUntil, T0 + (REFURB_DAYS.replace.engines + FERRY_DAYS) * DAY_MS);

  const h = await harness();
  const w = await world({ h, name: 'cat' });
  const mx = (await w.call('GET', '/hubs/LFPG/plan')).body.buildings.find((b: { slot: string }) => b.slot === 'MX1').facilityId;
  assert.equal((await w.call('POST', `/facilities/${mx}/lease`, { level: 2 })).status, 201);
  w.staff(10);
  w.warp(T0 + 22 * DAY_MS); // the works to level 2 take 21 days: until then the hangar works at level 1
  w.setComponent(w.atr, 'engines', 85);
  const wv = await w.wear(w.atr, '?pick=engines:replace');
  assert.deepEqual([wv.works.heavyHangar, wv.works.ferry, wv.works.ferryCost, wv.works.downtimeFactor], [true, false, 0, 0.5]);
  assert.equal(wv.works.days, Math.ceil(REFURB_DAYS.replace.engines / 2), 'halved and no ferry');
  const early = await (async () => { const x = await world({ h, name: 'dan' }); const id = (await x.call('GET', '/hubs/LFPG/plan')).body.buildings.find((b: { slot: string }) => b.slot === 'MX1').facilityId; await x.call('POST', `/facilities/${id}/lease`, { level: 2 }); x.staff(10); x.setComponent(x.atr, 'engines', 85); return x.wear(x.atr, '?pick=engines:replace'); })();
  assert.deepEqual([early.works.heavyHangar, early.works.ferry], [false, true], 'a hangar still under works is a level-1 hangar: the heavy check still goes to a workshop');
});

test('refurbishing is refused for another company\'s aircraft, an unknown component, a club or rented aircraft, a company without wear and failures, an aircraft on a flight, and too little money; none of them books anything', async () => {
  const w = await world();
  const other = await world({ h: w.h, name: 'zed' });
  const body = { items: [{ component: 'gear', action: 'overhaul' }] };
  assert.equal((await other.call('POST', `/me/fleet/${w.atr}/refurbish`, body)).status, 404, 'not hers');
  assert.equal((await w.call('POST', `/me/fleet/${w.atr}/refurbish`, { items: [{ component: 'wings', action: 'overhaul' }] })).status, 400);
  const jet = insertAircraft(w.h.db, { companyId: w.cid, icao: 'A20N', hub: 'LFPG', value: 5_000_000, ownership: 'owned', at: T0 });
  assert.equal((await w.call('POST', `/me/fleet/${jet}/refurbish`, { items: [{ component: 'propellers', action: 'overhaul' }] })).body.error, 'no_such_component', 'a jet has no propellers');
  const club = insertAircraft(w.h.db, { companyId: w.cid, icao: 'C172', hub: 'LFPG', value: 40_000, ownership: 'club', at: T0 });
  assert.equal((await w.call('POST', `/me/fleet/${club}/refurbish`, body)).body.error, 'not_refurbishable');
  assert.equal((await other.call('POST', `/me/fleet/${other.atr}/refurbish`, body)).status, 200, 'control: the same body works for its owner');
  const off = await world({ wear: false, name: 'bob', h: w.h });
  assert.equal((await off.call('POST', `/me/fleet/${off.atr}/refurbish`, body)).body.error, 'wear_off');
  assert.equal(((await off.wear()) as WearView).refurbishable, false);
  run(w.h.db, "INSERT INTO flights (company_id, aircraft_id, aircraft_icao, job_id, source, kind, origin, destination, distance_nm, payload_kg, pax, payout, status, accepted_at) VALUES (?, ?, 'AT76', 'JX', 'board', 'pax', 'LFPG', 'LFLL', 200, 100, 2, 1000, 'active', ?)", w.cid, w.atr, T0);
  assert.equal((await w.call('POST', `/me/fleet/${w.atr}/refurbish`, body)).body.error, 'aircraft_busy');
  run(w.h.db, "DELETE FROM flights WHERE job_id = 'JX'");
  run(w.h.db, 'UPDATE companies SET balance = 1000 WHERE id = ?', w.cid);
  const poor = await w.call('POST', `/me/fleet/${w.atr}/refurbish`, body);
  assert.deepEqual([poor.status, poor.body.error], [409, 'insufficient_funds']);
  assert.equal(w.balance(), 1000);
  assert.equal(get<{ n: number }>(w.h.db, "SELECT COUNT(*) AS n FROM transactions WHERE kind = 'refurbish' AND company_id = ?", w.cid)!.n, 0);
  assert.equal(w.aircraft().status, 'available');
});

// ---------------------------------------------------------------- auth

test('every route needs a signed-in company', async () => {
  const h = await harness();
  for (const [m, u] of [['GET', '/warehouse/LFPG'], ['PUT', '/warehouse/LFPG/policy'], ['POST', '/warehouse/LFPG/order'], ['GET', '/me/fleet/1/wear'], ['POST', '/me/fleet/1/refurbish']] as const) {
    assert.equal((await h.call(m, `${V1}${u}`, { body: {} })).status, 401, `${m} ${u}`);
  }
  const w = await world({ h });
  assert.equal((await w.call('GET', '/warehouse/NOPE1')).status, 400);
  assert.equal((await w.call('GET', '/warehouse/lfpg')).status, 200, 'the code is case-insensitive');
});

test('policies keep only what still has an aircraft: when the last aircraft of a type leaves the hub its policy stops asking for parts', async () => {
  const w = await world();
  await w.call('PUT', '/warehouse/LFPG/policy', { icao: 'AT76', policy: 'full' });
  assert.ok(targetsOf(policiesAt(w.h.db, w.cid, 'LFPG')).size > 0);
  run(w.h.db, 'UPDATE aircraft SET returned_at = ? WHERE id = ?', T0, w.atr);
  assert.equal(targetsOf(policiesAt(w.h.db, w.cid, 'LFPG')).size, 0);
});
