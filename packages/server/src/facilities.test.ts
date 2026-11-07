import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DAY_MS, HANGAR_MAINTENANCE_DISCOUNT, MAINTENANCE_HOURS, MAX_LINES_PER_COMPANY, MAX_LINES_WITH_OPS, OVERDRAFT_LIMIT, PARKING_SPOTS_PER_HUB, leaseExitFee, maintenanceSale, settle,
  type FacilityDetail, type FacilitySignResult, type FacilityTerminateResult, type FacilityUpgradeResult, type HubPlan, type HubsOverview,
} from '@opc/shared';
import { catalogType } from './catalog.ts';
import { all, get, MIGRATIONS, openDb, run } from './db.ts';
import { accrueWear, flightCosts, insertAircraft } from './fleet-extras.ts';
import { harness } from './harness.ts';
import { lineLimit } from './facilities.ts';

const V1 = '/api/v1';
const T0 = Date.UTC(2026, 10, 4, 12, 0, 0); // Wednesday 4 Nov 2026, 12:00Z (the harness clock)
const MX = 18_500;
type H = Awaited<ReturnType<typeof harness>>;
type Tx = { kind: string; amount: number; memo: string; at: number };

/** A player at `hub` with plenty of money; `call` acts as her. */
async function world(o: { hub?: string; name?: string; money?: number; h?: H } = {}) {
  const h = o.h ?? (await harness());
  const hub = o.hub ?? 'LFMN';
  const u = await h.register(o.name ?? 'amy', hub);
  const cid = u.me.company.id as number;
  run(h.db, 'UPDATE companies SET balance = ? WHERE id = ?', o.money ?? 20_000_000, cid);
  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: unknown) => h.call(method, `${V1}${url}`, { token: u.token, ...(body === undefined ? {} : { body }) });
  const plan = async (icao = hub): Promise<HubPlan> => (await call('GET', `/hubs/${icao}/plan`)).body;
  const id = async (slot: string, icao = hub): Promise<number> => (await plan(icao)).buildings.find((b) => b.slot === slot)!.facilityId;
  const balance = (): number => get<{ balance: number }>(h.db, 'SELECT balance FROM companies WHERE id = ?', cid)!.balance;
  const ledger = async (): Promise<Tx[]> => (await call('GET', '/me/transactions?limit=200')).body;
  const warp = (t: number): void => { h.clock.t = t; run(h.db, 'UPDATE sessions SET expires_at = ?', t + 1_000_000_000); };
  const staff = (family: string, n: number, base = hub): void => {
    for (let i = 0; i < n; i++) run(h.db, `INSERT INTO staff (company_id, family, name, role, base, hired_at, starts_at, salary, reliability, morale) VALUES (?, ?, ?, 'technician', ?, 0, 0, 4600, 80, 80)`, cid, family, `${family} ${i}`, base);
  };
  const lease = async (slot: string, level?: number) => call('POST', `/facilities/${await id(slot)}/lease`, level === undefined ? {} : { level });
  return { h, u, cid, hub, call, plan, id, balance, ledger, warp, staff, lease };
}
type W = Awaited<ReturnType<typeof world>>;
const kinds = (l: Tx[], k: string): Tx[] => l.filter((t) => t.kind === k);

// ---------------------------------------------------------------- SCHEMA_V9

test('SCHEMA_V9 is the ninth migration and creates the facility tables; a v8 database upgrades with its rows intact', () => {
  assert.ok(MIGRATIONS[8]!.includes('facility_contracts'));
  const db = openDb(':memory:');
  for (const t of ['facilities', 'facility_contracts']) assert.ok(get(db, "SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?", t), t);

  const file = join(mkdtempSync(join(tmpdir(), 'opc-v9-')), 'v8.sqlite');
  const raw = new DatabaseSync(file);
  for (let i = 0; i < 8; i++) raw.exec(MIGRATIONS[i]!);
  raw.exec('PRAGMA user_version = 8');
  raw.exec(`INSERT INTO users (id, username, pass_hash, created_at) VALUES (1, 'a', 'h', 1); INSERT INTO companies (id, user_id, name, balance, reputation, created_at) VALUES (1, 1, 'A Air', 5, 50, 1);`);
  raw.close();
  const up = openDb(file);
  assert.equal(get<{ user_version: number }>(up, 'PRAGMA user_version')!.user_version, MIGRATIONS.length);
  assert.equal(get<{ balance: number }>(up, 'SELECT balance FROM companies WHERE id = 1')!.balance, 5);
  assert.deepEqual(all(up, 'SELECT * FROM facilities'), []);
});

test('one building has at most one active contract (the partial unique index), an ended one frees it', () => {
  const db = openDb(':memory:');
  run(db, "INSERT INTO users (id, username, pass_hash, created_at) VALUES (1, 'a', 'h', 1)");
  run(db, 'INSERT INTO companies (id, user_id, name, balance, reputation, created_at) VALUES (1, 1, ?, 0, 50, 1), (2, NULL, ?, 0, 50, 1)', 'A', 'B');
  run(db, "INSERT INTO facilities (id, hub_icao, slot) VALUES (1, 'LFMN', 'MX1')");
  const ins = (company: number): void => { run(db, "INSERT INTO facility_contracts (facility_id, company_id, kind, started_at, monthly, level_since) VALUES (1, ?, 'lease', 1, 1, 1)", company); };
  ins(1);
  assert.throws(() => ins(2), /UNIQUE/);
  run(db, "UPDATE facility_contracts SET status = 'ended'");
  ins(2);
});

// ---------------------------------------------------------------- the plan and the catalogue

test('the plan of Nice: ten buildings, the kitchen hall and the training centre, who holds what relative to the player, the drawn layout and the real parking', async () => {
  const w = await world();
  const p = await w.plan();
  assert.equal(p.buildings.length, 12);
  assert.equal(p.layout, 'LFMN');
  assert.deepEqual(p.summary, { yours: 0, available: 6, ai: 1 });
  const by = Object.fromEntries(p.buildings.map((b) => [b.slot, b]));
  assert.deepEqual({ o: by.MX1!.owner, rent: by.MX1!.rent }, { o: 'available', rent: MX });
  assert.deepEqual({ o: by.CG1!.owner, name: by.CG1!.ownerName }, { o: 'ai', name: 'Méridia Cargo' });
  assert.equal(by.TWR!.owner, 'airport');
  assert.deepEqual(p.parking, { spots: PARKING_SPOTS_PER_HUB, used: 1, monthly: 3_900 }, 'the existing parking fee of a large airport, for the starter aircraft');
  assert.deepEqual((await w.call('GET', '/hubs/lfmn/plan')).body.airport, 'LFMN', 'the code is case-insensitive');
  assert.equal((await w.call('GET', '/hubs/LFPG/plan')).status, 409, 'not a hub of hers');
  assert.equal((await w.call('GET', '/hubs/NOPE1/plan')).status, 400);
});

test('an airport without a drawn plan answers layout null and a catalogue scaled by its size', async () => {
  const w = await world({ hub: 'LFPG' });
  const p = await w.plan();
  assert.equal(p.layout, null);
  assert.deepEqual(p.buildings.map((b) => b.slot), ['T1', 'MX1', 'AD', 'OPS', 'KT', 'TC', 'MX2', 'TWR']);
  assert.equal(p.buildings.find((b) => b.slot === 'T1')!.owner, 'airport');
});

// ---------------------------------------------------------------- lease, buy, money

test('leasing at level 2 books the deposit and the works at once, previewed by the same numbers; the rent starts on the 1st of the next month', async () => {
  const w = await world();
  const mx = await w.id('MX2');
  const d = (await w.call('GET', `/facilities/${mx}?mode=lease&level=2`)).body as FacilityDetail;
  assert.deepEqual(d.due, { today: 457_000, monthly: MX, staffMonthly: 10 * 4_600, balanceAfter: w.balance() - 457_000 });
  assert.equal(d.required[0]!.need, 10, 'a level-2 hangar needs ten technicians');
  assert.equal(d.facility.owner, 'available');
  assert.deepEqual(d.levels.map((l) => l.cost), [0, 420_000, 1_150_000]);
  assert.deepEqual({ lease: d.offer!.lease.deposit, buy: d.offer!.purchase.price }, { lease: 37_000, buy: 2_350_000 });

  const before = w.balance();
  const r = await w.call('POST', `/facilities/${mx}/lease`, { level: 2 });
  assert.equal(r.status, 201, r.text);
  const res = r.body as FacilitySignResult;
  assert.deepEqual({ due: res.due, kind: res.contract.kind, months: res.contract.months, notice: res.contract.noticeMonths, deposit: res.contract.deposit }, { due: 457_000, kind: 'lease', months: 36, notice: 3, deposit: 37_000 });
  assert.equal(w.balance(), before - 457_000);
  assert.equal(res.balanceAfter, w.balance());
  const l = await w.ledger();
  assert.deepEqual([kinds(l, 'facility_deposit')[0]!.amount, kinds(l, 'facility_works')[0]!.amount], [-37_000, -420_000]);
  assert.equal(kinds(l, 'facility_rent').length, 0, 'no rent for the month of signing');

  const view = ((await w.call('GET', `/facilities/${mx}`)).body as FacilityDetail).facility;
  assert.deepEqual({ owner: view.owner, level: view.level, works: view.works?.toLevel, monthly: view.monthly }, { owner: 'player', level: 1, works: 2, monthly: MX }, 'level 1 in force while the works run');
  assert.equal(view.works!.until, T0 + 21 * DAY_MS);
  assert.equal(((await w.call('GET', `/facilities/${mx}`)).body as FacilityDetail).due, null, 'a building she holds has nothing to sign');
});

test('refusals leave nothing booked: occupied, not for sale, not a hub, not enough money, a level the building cannot start at', async () => {
  const w = await world({ money: 30_000 - OVERDRAFT_LIMIT }); // 30 000 spendable once the overdraft is counted
  const mx = await w.id('MX1');
  const poor = await w.call('POST', `/facilities/${mx}/lease`, {});
  assert.deepEqual({ s: poor.status, e: poor.body.error, missing: poor.body.missing }, { s: 409, e: 'insufficient_funds', missing: 7_000 });
  assert.equal(w.balance(), 30_000 - OVERDRAFT_LIMIT);
  assert.deepEqual(all(w.h.db, 'SELECT * FROM facility_contracts'), []);
  assert.equal((await w.ledger()).filter((t) => t.kind.startsWith('facility')).length, 0);

  run(w.h.db, 'UPDATE companies SET balance = 20000000 WHERE id = ?', w.cid);
  assert.equal((await w.call('POST', `/facilities/${await w.id('CG1')}/lease`, {})).body.error, 'occupied', 'the freight hall is held by an AI company');
  assert.equal((await w.call('POST', `/facilities/${await w.id('TWR')}/lease`, {})).body.error, 'not_offered');
  assert.equal((await w.call('POST', `/facilities/${mx}/lease`, { level: 3 })).status, 400, 'level 3 cannot be started at signing');
  assert.equal((await w.call('POST', `/facilities/${await w.id('OPS')}/lease`, { level: 2 })).body.error, 'invalid_level', 'the operations centre has one level');
  assert.equal((await w.call('POST', `/facilities/${mx}/lease`, {})).status, 201);
  assert.equal((await w.call('POST', `/facilities/${mx}/lease`, {})).body.error, 'occupied', 'not twice');

  const other = await world({ h: w.h, name: 'bob', hub: 'LFPG' });
  const nice = await w.id('MX2');
  const away = await other.call('POST', `/facilities/${nice}/lease`, {});
  assert.deepEqual({ s: away.status, e: away.body.error }, { s: 409, e: 'not_a_hub' }, 'buildings are for hubs');
  assert.equal((await other.call('GET', `/facilities/${nice}`)).status, 409);
  assert.equal((await w.call('GET', '/facilities/abc')).status, 404);
  assert.equal((await w.call('GET', '/facilities/99999')).body.error, 'facility_not_found');
  assert.equal((await w.h.call('GET', `${V1}/hubs/overview`)).status, 401);
});

test('two companies at the same hub: the second finds the building taken and sees who holds it; ending the contract puts it back on offer', async () => {
  const w = await world();
  const b = await world({ h: w.h, name: 'bob' });
  assert.equal((await w.lease('MX1')).status, 201);
  const seen = ((await b.call('GET', `/facilities/${await b.id('MX1')}`)).body as FacilityDetail);
  assert.deepEqual({ owner: seen.facility.owner, name: seen.facility.ownerName, offer: seen.offer, due: seen.due }, { owner: 'ai', name: 'amy Aviation', offer: null, due: null });
  assert.equal((await b.lease('MX1')).body.error, 'occupied');
  assert.equal((await b.call('POST', `/facilities/${await b.id('MX1')}/terminate`)).body.error, 'not_held', 'only the holder ends a contract');
  assert.equal((await b.call('POST', `/facilities/${await b.id('MX1')}/upgrade`, { toLevel: 2 })).body.error, 'not_held');
  assert.equal((await w.call('POST', `/facilities/${await w.id('MX1')}/terminate`)).status, 200);
  assert.equal((await b.lease('MX1')).status, 201, 'free again');
});

test('buying: cash or credit, the resale value counts in net worth, selling pays the credit left and brings the resale back', async () => {
  const w = await world();
  const net0 = (await w.call('GET', '/me')).body.company.netWorth as number;
  const mx = await w.id('MX1');
  const r = await w.call('POST', `/facilities/${mx}/buy`, { financing: { downPct: 20, months: 60 } });
  assert.equal(r.status, 201, r.text);
  assert.deepEqual({ due: r.body.due, kind: r.body.contract.kind, principal: r.body.contract.principal, price: r.body.contract.price }, { due: 470_000, kind: 'purchase', principal: 1_880_000, price: 2_350_000 });
  const net1 = (await w.call('GET', '/me')).body.company.netWorth as number;
  assert.equal(net1 - net0, -470_000 + 1_762_500 - 1_880_000, 'cash out, the building in at its resale value, the credit owed');
  const sold = (await w.call('POST', `/facilities/${mx}/terminate`)).body as FacilityTerminateResult;
  assert.deepEqual({ kind: sold.kind, fee: sold.fee, refund: sold.refund }, { kind: 'purchase', fee: 1_880_000, refund: 1_762_500 });
  const l = await w.ledger();
  assert.equal(kinds(l, 'facility_sale')[0]!.amount, 1_762_500);
  assert.equal(kinds(l, 'facility_loan')[0]!.amount, -1_880_000);
  assert.equal(((await w.call('GET', '/me')).body.company.netWorth as number) - net0, -(2_350_000 - 1_762_500), 'a round trip costs the 25 % resale loss');
});

// ---------------------------------------------------------------- billing (the injected clock)

test('monthly billing: rent from the month after signing, once per month, in the finance projection too; a credit is amortised with its upkeep', async () => {
  const w = await world();
  await w.lease('MX1');
  const buy = await w.call('POST', `/facilities/${await w.id('MX2')}/buy`, { financing: { downPct: 20, months: 36 } });
  assert.equal(buy.status, 201, buy.text);
  const up = (await w.call('GET', '/me/finance')).body.upcoming as { kind: string; amount: number }[];
  assert.ok(up.some((c) => c.kind === 'facility_rent' && c.amount === -MX), 'the projection knows the rent');
  assert.ok(up.some((c) => c.kind === 'facility_loan') && up.some((c) => c.kind === 'facility_upkeep'));

  w.warp(Date.UTC(2026, 11, 2, 9));
  const dec = await w.ledger();
  assert.deepEqual(kinds(dec, 'facility_rent').map((t) => [t.amount, t.memo]), [[-MX, 'LFMN MX1 rent 1/36']]);
  assert.equal(kinds(dec, 'facility_upkeep')[0]!.amount, -2_400);
  assert.equal(kinds(dec, 'facility_loan').length, 1);
  await w.call('GET', '/me/finance');
  assert.equal(kinds(await w.ledger(), 'facility_rent').length, 1, 'idempotent within the month');

  w.warp(Date.UTC(2027, 1, 3, 9));
  const feb = await w.ledger();
  assert.deepEqual(kinds(feb, 'facility_rent').map((t) => t.memo).reverse(), ['LFMN MX1 rent 1/36', 'LFMN MX1 rent 2/36', 'LFMN MX1 rent 3/36'], 'a catch-up bills every month once');
  const c = get<{ months_paid: number; principal: number }>(w.h.db, "SELECT months_paid, principal FROM facility_contracts WHERE kind = 'purchase'")!;
  assert.equal(c.months_paid, 3);
  assert.ok(c.principal < 1_880_000 && c.principal > 1_700_000);
});

test('the overview prices the hub: buildings, stand fees, team by family, renewals; a base she flies to a lot is suggested', async () => {
  const w = await world();
  await w.lease('AD');
  w.staff('ground', 2);
  w.staff('maintenance', 1);
  for (let i = 0; i < 12; i++) run(w.h.db, `INSERT INTO flights (company_id, aircraft_id, aircraft_icao, job_id, source, kind, origin, destination, distance_nm, payload_kg, pax, payout, status, accepted_at, completed_at)
    VALUES (?, ?, 'C172', ?, 'board', 'pax', 'LFMN', 'LFBO', 100, 100, 2, 1000, 'verified', ?, ?)`, w.cid, w.u.me.fleet[0].id, `J${i}`, T0 - 2 * DAY_MS, T0 - DAY_MS);
  const o = (await w.call('GET', '/hubs/overview')).body as HubsOverview;
  assert.deepEqual(o.company, { name: 'amy Aviation', hubs: 1, aircraft: 1, employees: 3 });
  const hub = o.hubs[0]!;
  assert.deepEqual({ icao: hub.icao, role: hub.role, layout: hub.layout, team: hub.team }, { icao: 'LFMN', role: 'main', layout: 'LFMN', team: { total: 3, byFamily: { ground: 2, maintenance: 1 } } });
  assert.deepEqual(hub.facilities.map((f) => [f.slot, f.owner]), [['MX1', 'available'], ['MX2', 'available'], ['AD', 'player'], ['OPS', 'available'], ['KT', 'available'], ['TC', 'available']]);
  assert.equal(hub.monthlyCost, 6_200 + 3_900, 'the offices and the stand of the aircraft based there');
  assert.equal(o.monthlyCost, hub.monthlyCost);
  assert.deepEqual(hub.aircraft.map((a) => [a.icao, a.status]), [['C172', 'available']]);
  assert.deepEqual({ icao: o.suggestion?.icao, flightsPerWeek: o.suggestion?.flightsPerWeek }, { icao: 'LFBO', flightsPerWeek: 3 });
  assert.equal(o.suggestion!.fromMonthly, 6_200, 'the cheapest building to rent there: its offices (LFBO is a large airport)');
  assert.equal(hub.renewals.length, 0, 'the term ends in three years');
});

// ---------------------------------------------------------------- the effects: hangar

test('a staffed hangar takes 35 % off the maintenance of the aircraft based at its hub, half of that when short of technicians, nothing without a hangar or elsewhere', async () => {
  const w = await world({ hub: 'LFPG' });
  const at = insertAircraft(w.h.db, { companyId: w.cid, icao: 'AT76', hub: 'LFPG', value: 1_000_000, ownership: 'owned', at: T0 });
  const elsewhere = insertAircraft(w.h.db, { companyId: w.cid, icao: 'AT76', hub: 'LFPG', value: 1_000_000, ownership: 'owned', at: T0 });
  run(w.h.db, "UPDATE aircraft SET base = 'LFMN' WHERE id = ?", elsewhere);
  const s = settle({ payout: 20_000, distanceNm: 400, aircraft: catalogType('AT76'), status: 'verified', destSize: 'large', destIsHub: false });
  const maint = (id: number): number => flightCosts(w.h.db, id, 2, s, 'turboprop-airliner', T0).settlement.maintenance;
  const raw = s.maintenance;
  assert.ok(raw > 100);
  assert.equal(maint(at), raw, 'no hangar yet');

  assert.equal((await w.lease('MX1')).status, 201);
  const half = Math.round(raw * (1 - HANGAR_MAINTENANCE_DISCOUNT / 2));
  assert.equal(maint(at), half, 'short of technicians (here none): half the effect');
  w.staff('maintenance', 3);
  assert.equal(maint(at), half, 'three of six technicians: still half');
  w.staff('maintenance', 3);
  const full = flightCosts(w.h.db, at, 2, s, 'turboprop-airliner', T0).settlement;
  assert.equal(full.maintenance, Math.round(raw * 0.65));
  assert.equal(full.net, s.net + raw - full.maintenance, 'the saving goes to the net');
  assert.equal(maint(elsewhere), raw, 'only aircraft based at that hub');
  assert.equal(flightCosts(w.h.db, at, 2, s, 'turboprop-airliner', T0 - DAY_MS).settlement.maintenance, raw, 'a contract is not retroactive');
});

test('the same flight, with and without a hangar, in the real settlement path: the ledger line and the flight both carry the discount', async () => {
  const run1 = async (hangar: boolean): Promise<{ maintenance: number; net: number; ledger: number }> => {
    const w = await world({ hub: 'LFPG', name: hangar ? 'with' : 'without' });
    if (hangar) { w.staff('maintenance', 6); assert.equal((await w.lease('MX1')).status, 201); }
    const plane = w.u.me.fleet[0].id as number;
    const key = await w.h.apiKey(w.u.token);
    const job = await w.h.flyableJob(w.u.token, plane);
    const acc = await w.call('POST', `/jobs/${job.id}/accept`, { aircraftId: plane });
    assert.equal(acc.status, 201, acc.text);
    const rep = w.h.goodReport(job);
    const done = await w.h.call('POST', `${V1}/flights/${acc.body.id}/telemetry-verify`, { token: key, body: rep });
    assert.equal(done.body.verification, 'verified', done.text);
    const f = done.body.flight;
    return { maintenance: f.maintenance, net: f.net, ledger: -kinds(await w.ledger(), 'maintenance')[0]!.amount };
  };
  const a = await run1(true), b = await run1(false);
  assert.ok(b.maintenance > 0);
  assert.equal(a.maintenance, Math.round(b.maintenance * 0.65));
  assert.equal(a.ledger, a.maintenance);
  assert.equal(a.net - b.net, b.maintenance - a.maintenance);
});

test('a staffed hangar halves the time an aircraft stays in the workshop, a short-staffed one cuts a quarter', async () => {
  const w = await world({ hub: 'LFPG' });
  run(w.h.db, 'UPDATE companies SET realism = ? WHERE id = ?', JSON.stringify({ preset: 'custom', toggles: { wearAndFailures: true } }), w.cid);
  const a = insertAircraft(w.h.db, { companyId: w.cid, icao: 'AT76', hub: 'LFPG', value: 1_000_000, ownership: 'owned', at: T0 });
  const wear = (): number => { run(w.h.db, "UPDATE aircraft SET wear_pct = 79.9, status = 'available', maintenance_until = NULL WHERE id = ?", a); accrueWear(w.h.db, w.cid, a, 'turboprop-airliner', 5, T0); return get<{ maintenance_until: number }>(w.h.db, 'SELECT maintenance_until FROM aircraft WHERE id = ?', a)!.maintenance_until - T0; };
  const base = MAINTENANCE_HOURS['turboprop-airliner'] * 3_600_000;
  assert.equal(wear(), base);
  assert.equal((await w.lease('MX1')).status, 201);
  w.staff('maintenance', 6);
  assert.equal(wear(), base / 2);
  run(w.h.db, 'DELETE FROM staff WHERE rowid IN (SELECT rowid FROM staff LIMIT 3)');
  assert.equal(wear(), base * 0.75, 'half the effect when short: a quarter off');
});

test('a hangar adds parking: the hub holds more aircraft, and the hangar cannot be given up while they would not fit', async () => {
  const w = await world({ hub: 'LFPG' });
  for (let i = 0; i < PARKING_SPOTS_PER_HUB - 1; i++) assert.equal((await w.call('POST', '/me/fleet', { icao: 'C152', hub: 'LFPG' })).status, 201);
  assert.equal((await w.call('POST', '/me/fleet', { icao: 'C152', hub: 'LFPG' })).body.error, 'hub_full');
  await w.lease('MX1');
  assert.deepEqual((await w.call('GET', '/me/hubs')).body, [{ icao: 'LFPG', spots: 12, used: 10 }]);
  assert.equal((await w.call('POST', '/me/fleet', { icao: 'C152', hub: 'LFPG' })).status, 201, 'the hangar houses two more');
  assert.equal((await w.call('POST', '/me/fleet', { icao: 'C152', hub: 'LFPG' })).status, 201);
  assert.equal((await w.call('POST', '/me/fleet', { icao: 'C152', hub: 'LFPG' })).body.error, 'hub_full');
  const out = await w.call('POST', `/facilities/${await w.id('MX1')}/terminate`);
  assert.deepEqual({ s: out.status, e: out.body.error, used: out.body.used, spots: out.body.spots }, { s: 409, e: 'hub_in_use', used: 12, spots: 10 });
  assert.equal(get(w.h.db, "SELECT 1 AS x FROM facility_contracts WHERE status = 'active'") !== undefined, true, 'nothing was booked');
});

test('income of a staffed level-3 hangar: 40 % of its rent and the technicians\' payroll, only when the hub is fully staffed', async () => {
  const w = await world({ hub: 'LFPG' });
  const mx = await w.id('MX1');
  run(w.h.db, `INSERT INTO facility_contracts (facility_id, company_id, kind, started_at, months, monthly, deposit, notice_months, level, level_since) VALUES (?, ?, 'lease', ?, 36, ?, 37000, 3, 3, ?)`, mx, w.cid, T0 - 200 * DAY_MS, MX, T0 - 20 * DAY_MS);
  w.staff('maintenance', 10);
  w.warp(Date.UTC(2026, 11, 2));
  let l = await w.ledger();
  assert.equal(kinds(l, 'facility_income').length, 0, '10 of 16 technicians: nothing to sell');
  assert.equal(kinds(l, 'facility_rent').length, 1);
  w.staff('maintenance', 6);
  w.warp(Date.UTC(2027, 0, 2));
  l = await w.ledger();
  assert.deepEqual(kinds(l, 'facility_income').map((t) => t.amount), [maintenanceSale(MX, 16 * 4_600)]);
});

// ---------------------------------------------------------------- upgrades

test('upgrading: works take weeks and cost the level price, the old level works meanwhile, level 3 waits six months at level 2', async () => {
  const w = await world({ hub: 'LFPG' });
  const mx = await w.id('MX1');
  await w.lease('MX1');
  const up = async (toLevel: number) => w.call('POST', `/facilities/${mx}/upgrade`, { toLevel });
  assert.equal((await up(3)).body.error, 'invalid_level', 'one level at a time');
  const r = await up(2);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual({ cost: (r.body as FacilityUpgradeResult).cost, until: r.body.until, to: r.body.toLevel }, { cost: 420_000, until: T0 + 21 * DAY_MS, to: 2 });
  assert.equal((await up(2)).body.error, 'works_in_progress');
  const view = async () => ((await w.call('GET', `/facilities/${mx}`)).body as FacilityDetail).facility;
  assert.deepEqual({ level: (await view()).level, works: (await view()).works?.toLevel }, { level: 1, works: 2 });
  assert.equal((await w.call('GET', '/me/hubs')).body[0].spots, 12, 'level 1 houses two aircraft');

  w.warp(T0 + 21 * DAY_MS);
  assert.deepEqual({ level: (await view()).level, works: (await view()).works }, { level: 2, works: null }, 'the level is derived from the clock');
  assert.equal((await w.call('GET', '/me/hubs')).body[0].spots, 13);
  assert.equal((await up(3)).body.error, 'too_early');
  assert.equal((await view()).nextLevelAt, T0 + 21 * DAY_MS + 180 * DAY_MS);
  w.warp(T0 + 201 * DAY_MS);
  const three = await up(3);
  assert.equal(three.status, 200, three.text);
  assert.equal(three.body.cost, 1_150_000);
  w.warp(T0 + 201 * DAY_MS + 56 * DAY_MS);
  assert.equal((await view()).level, 3);
  assert.equal((await view()).nextLevelAt, null);
  assert.equal((await up(3)).body.error, 'invalid_level');
  assert.equal((await w.call('POST', `/facilities/${await w.id('OPS')}/upgrade`, { toLevel: 2 })).body.error, 'not_held');
  const poor = await world({ h: w.h, name: 'poor', hub: 'LFPG', money: 40_000 });
  assert.equal((await poor.lease('MX2')).status, 201);
  const broke = await poor.call('POST', `/facilities/${await poor.id('MX2')}/upgrade`, { toLevel: 2 });
  assert.deepEqual({ s: broke.status, e: broke.body.error }, { s: 409, e: 'insufficient_funds' });
});

// ---------------------------------------------------------------- terminate

test('ending a lease pays the notice or the rest of the term, returns the deposit and puts the building back on offer; works in progress are lost', async () => {
  const w = await world();
  const mx = await w.id('MX1');
  await w.call('POST', `/facilities/${mx}/lease`, { level: 2 });
  const before = w.balance();
  const out = (await w.call('POST', `/facilities/${mx}/terminate`)).body as FacilityTerminateResult;
  assert.deepEqual({ kind: out.kind, fee: out.fee, refund: out.refund }, { kind: 'lease', fee: leaseExitFee(MX, 36, 0, 3), refund: 37_000 });
  assert.equal(out.fee, 36 * MX, 'nothing paid yet: the whole term is owed');
  assert.equal(w.balance(), before - 36 * MX + 37_000);
  assert.equal(out.balanceAfter, w.balance());
  const l = await w.ledger();
  assert.deepEqual([kinds(l, 'facility_rent')[0]!.amount, kinds(l, 'facility_deposit_refund')[0]!.amount], [-36 * MX, 37_000]);
  const view = ((await w.call('GET', `/facilities/${mx}`)).body as FacilityDetail);
  assert.deepEqual({ owner: view.facility.owner, contract: view.facility.contract, level: view.facility.level }, { owner: 'available', contract: null, level: 1 });
  assert.equal((await w.call('POST', `/facilities/${mx}/terminate`)).body.error, 'not_held');
  run(w.h.db, 'UPDATE companies SET balance = ? WHERE id = ?', 1000 - OVERDRAFT_LIMIT, w.cid);
  await w.call('POST', `/facilities/${await w.id('MX2')}/lease`, {}).then((r) => assert.equal(r.body.error, 'insufficient_funds'));
});

test('exit fee of a lease that has run its course is the notice alone; ending it cannot take the account below the overdraft limit', async () => {
  const w = await world();
  const mx = await w.id('MX1');
  await w.lease('MX1');
  run(w.h.db, 'UPDATE facility_contracts SET months_paid = 36 WHERE facility_id = ?', mx);
  run(w.h.db, 'UPDATE companies SET balance = ? WHERE id = ?', 3 * MX - 37_000 - 1 - OVERDRAFT_LIMIT, w.cid);
  assert.equal((await w.call('POST', `/facilities/${mx}/terminate`)).body.error, 'insufficient_funds', 'the net of the notice and the deposit is what must be covered');
  run(w.h.db, 'UPDATE companies SET balance = ? WHERE id = ?', 3 * MX, w.cid);
  const out = (await w.call('POST', `/facilities/${mx}/terminate`)).body as FacilityTerminateResult;
  assert.equal(out.fee, 3 * MX);
  assert.equal(w.balance(), 37_000);
});

test('deleting the account frees its buildings', async () => {
  const w = await world();
  await w.lease('MX1');
  assert.equal((await w.call('DELETE', '/me', { password: 'correct horse' })).status, 204);
  assert.deepEqual(all(w.h.db, 'SELECT * FROM facility_contracts'), []);
  const b = await world({ h: w.h, name: 'bob' });
  assert.equal((await b.lease('MX1')).status, 201);
});

// ---------------------------------------------------------------- the effects: offices and the operations centre

test('offices: six workstations come with the airport, each ground agent or administrator needs one more; renting offices adds 18 per level', async () => {
  const w = await world();
  w.staff('ground', 4);
  w.staff('admin', 2);
  const interim = (family: string, base = 'LFMN') => w.call('POST', '/staff/interim', { family, days: 2, base });
  const full = await interim('ground');
  assert.deepEqual({ s: full.status, e: full.body.error, used: full.body.used, capacity: full.body.capacity }, { s: 409, e: 'no_workstation', used: 6, capacity: 6 });
  assert.equal((await interim('cabin')).status, 201, 'cabin crew and pilots sit in no office');
  assert.equal((await w.call('POST', '/staff/interim', { family: 'maintenance', days: 2 })).status, 201);
  const cand = (await w.call('GET', '/staff/candidates?family=ground&base=LFMN')).body.candidates[0];
  assert.equal((await w.call('POST', '/staff/hire', { candidateId: cand.id })).body.error, 'no_workstation', 'hiring is refused, with no premium paid');
  assert.equal(kinds(await w.ledger(), 'hire_premium').length, 0);

  assert.equal((await w.lease('AD')).status, 201);
  assert.equal((await interim('ground')).status, 201);
  assert.equal((await w.call('POST', '/staff/hire', { candidateId: cand.id })).status, 201);
  run(w.h.db, 'UPDATE staff SET base = ? WHERE company_id = ? AND family = ?', 'LFLL', w.cid, 'admin');
  const hubs = (await w.call('GET', '/hubs/overview')).body as HubsOverview;
  assert.equal(hubs.hubs[0]!.team.byFamily.ground, 5, 'the hired one is still in notice: not on the team yet, but already holding a workstation');
});

test('the operations centre lifts the line limit from 6 to 24, and ending the contract takes it back', async () => {
  const w = await world({ hub: 'LFPG' });
  const ends = ['LFBO', 'LFLL', 'LFML', 'LFMT', 'LFBD', 'LFMN'];
  ends.slice(0, MAX_LINES_PER_COMPANY).forEach((a, i) => run(w.h.db, `INSERT INTO lines (company_id, a, b, created_at, freq_per_day, days, window_start_min, window_end_min, turnaround_min, flight_base) VALUES (?, ?, 'LFPG', 1, 3, 127, 360, 1080, 30, ?)`, w.cid, a, 1100 + 100 * i));
  const form = { a: 'LFPG', b: 'LFQQ', freqPerDay: 3, days: Array(7).fill(true), windowStart: '06:00', windowEnd: '18:00', aircraftIds: [w.u.me.fleet[0].id as number] };
  const problems = async (): Promise<string[]> => (await w.call('POST', '/lines/forecast', form)).body.problems;
  assert.equal(lineLimit(w.h.db, w.cid), MAX_LINES_PER_COMPANY);
  const first = await w.call('POST', '/lines/forecast', form);
  assert.equal(first.status, 200, first.text);
  assert.ok((await problems()).includes('line_limit'));
  const ops = await w.id('OPS');
  assert.equal((await w.call('POST', `/facilities/${ops}/lease`, {})).status, 201);
  assert.equal(lineLimit(w.h.db, w.cid), MAX_LINES_WITH_OPS);
  assert.ok(!(await problems()).includes('line_limit'));
  assert.equal((await w.call('POST', `/facilities/${ops}/terminate`)).status, 200);
  assert.ok((await problems()).includes('line_limit'));
});
