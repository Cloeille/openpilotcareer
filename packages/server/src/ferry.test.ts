import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OVERDRAFT_LIMIT, blockHours, settle, type FerryBooked, type FerryPreview } from '@opc/shared';
import { catalogType } from './catalog.ts';
import { get, run } from './db.ts';
import { insertAircraft } from './fleet-extras.ts';
import { harness } from './harness.ts';
import { lineDistance } from './lines.ts';

const HOUR = 3_600_000;
const C172 = catalogType('C172');

/** A player at LFPG with the starter C172 (id `plane`). */
async function world() {
  const h = await harness();
  const u = await h.register('amy', 'LFPG');
  const cid = u.me.company.id as number;
  const plane = u.me.fleet[0].id as number;
  const call = (method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) => h.call(method, url, { token: u.token, ...(body === undefined ? {} : { body }) });
  const ferryUrl = (id: number) => `/api/v1/me/fleet/${id}/ferry`;
  const balance = () => get<{ balance: number }>(h.db, 'SELECT balance FROM companies WHERE id = ?', cid)!.balance;
  const where = (id = plane) => get<{ location: string }>(h.db, 'SELECT location FROM aircraft WHERE id = ?', id)!.location;
  const ledger = () => h.db.prepare("SELECT at, amount, memo, balance_after FROM transactions WHERE company_id = ? AND kind = 'ferry_flight'").all(cid) as { at: number; amount: number; memo: string; balance_after: number }[];
  return { h, u, cid, plane, call, ferryUrl, balance, where, ledger };
}

test('ferry: the preview books nothing, booking charges exactly the preview, moves the aircraft and keeps it busy until it lands', async () => {
  const w = await world();
  const dist = lineDistance('LFPG', 'LFLL');
  const hours = blockHours(C172, dist);
  const before = w.balance();

  const pv = await w.call('GET', `${w.ferryUrl(w.plane)}?to=LFLL`);
  const preview = pv.body as FerryPreview;
  assert.equal(pv.status, 200, pv.text);
  assert.equal(preview.ok, true);
  assert.equal(preview.distanceNm, dist);
  assert.equal(preview.hours, hours);
  assert.equal(preview.arrivesAt, w.h.clock.t + Math.round(hours * HOUR));
  // the existing flight model with nothing paid: fuel + landing fee + maintenance of the distance (LFLL is not a hub, wear and hangars are off)
  const s = settle({ payout: 0, distanceNm: dist, aircraft: C172, destSize: 'large', destIsHub: false, status: 'verified' });
  assert.equal(preview.cost, s.fuelCost + s.landingFee + s.maintenance);
  assert.ok(preview.cost > 0);
  assert.equal(w.balance(), before, 'a preview charges nothing');
  assert.equal(w.where(), 'LFPG');
  assert.equal(w.ledger().length, 0);

  const booked = await w.call('POST', w.ferryUrl(w.plane), { to: 'LFLL' });
  assert.equal(booked.status, 201, booked.text);
  const b = booked.body as FerryBooked;
  assert.equal(b.cost, preview.cost);
  assert.equal(b.arrivesAt, preview.arrivesAt);
  assert.equal(b.balanceAfter, before - preview.cost);
  assert.equal(w.balance(), before - preview.cost);
  assert.deepEqual(w.ledger().map((x) => [x.amount, x.at]), [[-preview.cost, w.h.clock.t]]);
  assert.equal(w.where(), 'LFLL');

  const mid = (await w.call('GET', '/api/v1/me')).body.fleet[0];
  assert.equal(mid.busy, true);
  assert.equal(mid.status, 'flying');
  assert.equal(mid.ferryUntil, preview.arrivesAt);
  const again = await w.call('POST', w.ferryUrl(w.plane), { to: 'LFPG' });
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'aircraft_busy');

  // not usable for a job until it lands, then it flies one from its new airport
  const job = await w.h.flyableJob(w.u.token, w.plane);
  assert.equal(job.origin, 'LFLL');
  w.h.clock.t = preview.arrivesAt - 60_000;
  const early = await w.call('POST', `/api/v1/jobs/${job.id}/accept`, { aircraftId: w.plane });
  assert.equal(early.status, 409);
  assert.equal(early.body.error, 'aircraft_busy');
  w.h.clock.t = preview.arrivesAt;
  const after = (await w.call('GET', '/api/v1/me')).body.fleet[0];
  assert.equal(after.busy, false);
  assert.equal(after.ferryUntil, null);
  const ok = await w.call('POST', `/api/v1/jobs/${job.id}/accept`, { aircraftId: w.plane });
  assert.equal(ok.status, 201, ok.text);
});

test('ferry: the aircraft wears by the block hours when wear is on', async () => {
  const w = await world();
  await w.call('PUT', `/api/v1/companies/${w.cid}/realism`, { preset: 'balanced' });
  assert.equal(get<{ wear_pct: number }>(w.h.db, 'SELECT wear_pct FROM aircraft WHERE id = ?', w.plane)!.wear_pct, 0);
  assert.equal((await w.call('POST', w.ferryUrl(w.plane), { to: 'LFLL' })).status, 201);
  assert.ok(get<{ wear_pct: number }>(w.h.db, 'SELECT wear_pct FROM aircraft WHERE id = ?', w.plane)!.wear_pct > 0);
});

test('ferry refusals: same airport, unknown airport, bad code, out of range, not enough money, on a flight, on a line, another company', async () => {
  const w = await world();
  const refuse = async (id: number, to: string, status: number, code: string) => {
    const before = [w.balance(), w.where(id)];
    const pv = await w.call('GET', `${w.ferryUrl(id)}?to=${to}`);
    const r = await w.call('POST', w.ferryUrl(id), { to });
    assert.equal(r.status, status, r.text);
    assert.equal(r.body.error, code);
    if (pv.status === 200) assert.deepEqual([pv.body.ok, pv.body.reason], [false, code], 'the preview says the same thing');
    assert.deepEqual([w.balance(), w.where(id)], before, 'a refusal charges nothing and moves nothing');
    assert.equal(w.ledger().length, 0);
  };

  await refuse(w.plane, 'LFPG', 422, 'same_airport');
  await refuse(w.plane, 'ZZZZ', 422, 'unknown_airport');
  await refuse(w.plane, 'KJFK', 422, 'out_of_range');
  assert.equal((await w.call('POST', w.ferryUrl(w.plane), { to: 'lfll' })).status, 400, 'a malformed code is a validation error');
  assert.equal((await w.call('GET', w.ferryUrl(w.plane))).status, 400);

  run(w.h.db, 'UPDATE companies SET balance = ? WHERE id = ?', 10 - OVERDRAFT_LIMIT, w.cid);
  await refuse(w.plane, 'LFLL', 402, 'insufficient_funds');
  run(w.h.db, 'UPDATE companies SET balance = 1000000 WHERE id = ?', w.cid);

  const rival = await w.h.register('rival', 'LFPG');
  const theirs = rival.me.fleet[0].id as number;
  await refuse(theirs, 'LFLL', 404, 'aircraft_not_found');
  assert.equal(get<{ location: string }>(w.h.db, 'SELECT location FROM aircraft WHERE id = ?', theirs)!.location, 'LFPG');
  assert.equal((await w.h.call('POST', w.ferryUrl(w.plane), { token: rival.token, body: { to: 'LFLL' } })).status, 404, 'nor can the rival send mine');

  const job = await w.h.flyableJob(w.u.token, w.plane);
  assert.equal((await w.call('POST', `/api/v1/jobs/${job.id}/accept`, { aircraftId: w.plane })).status, 201);
  await refuse(w.plane, 'LFLL', 409, 'aircraft_busy');

  const atr = insertAircraft(w.h.db, { companyId: w.cid, icao: 'AT76', hub: 'LFPG', value: 1_000_000, ownership: 'owned', at: w.h.clock.t });
  const line = await w.call('POST', '/api/v1/lines', { a: 'LFPG', b: 'LFLL', freqPerDay: 3, days: Array(7).fill(true), windowStart: '06:00', windowEnd: '18:00', aircraftIds: [atr] });
  assert.equal(line.status, 201, line.text);
  await refuse(atr, 'LFLL', 409, 'aircraft_on_line');
});

test('ferry: an aircraft in the workshop is refused', async () => {
  const w = await world();
  run(w.h.db, "UPDATE aircraft SET status = 'maintenance', maintenance_until = ? WHERE id = ?", w.h.clock.t + 5 * HOUR, w.plane);
  const r = await w.call('POST', w.ferryUrl(w.plane), { to: 'LFLL' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'in_maintenance');
});
