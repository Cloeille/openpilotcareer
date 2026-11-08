import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AircraftLine, HistoryEntry } from '@opc/shared';
import { refreshLine } from './lines.ts';
import { all, get, run } from './db.ts';
import { insertAircraft } from './fleet-extras.ts';
import { finishFlight, type FlightRow } from './game.ts';
import { grantStarterCrew } from './staff-people.ts';
import { harness } from './harness.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 10, 4, 12, 0, 0);

/** A player with one AT76 flying LFPG-LFLL three rotations a day; the clock starts at T0 (Wed 12:00Z). */
async function world() {
  const h = await harness();
  const u = await h.register('amy', 'LFPG');
  const cid = u.me.company.id as number;
  const ac = insertAircraft(h.db, { companyId: cid, icao: 'AT76', hub: 'LFPG', value: 1_000_000, ownership: 'owned', at: h.clock.t });
  const line = await h.call('POST', '/api/v1/lines', { token: u.token, body: { a: 'LFPG', b: 'LFLL', freqPerDay: 3, days: Array(7).fill(true), windowStart: '06:00', windowEnd: '18:00', aircraftIds: [ac] } });
  assert.equal(line.status, 201, line.text);
  grantStarterCrew(h.db, cid, h.clock.t);
  refreshLine(h.db, line.body.id, h.clock.t);
  const get_ = (url: string) => h.call('GET', url, { token: u.token });
  const advance = async (ms: number) => { h.clock.t += ms; await get_('/api/v1/network'); };
  const history = async (q = '') => { const r = await get_(`/api/v1/me/history${q}`); assert.equal(r.status, 200, r.text); return r.body as HistoryEntry[]; };
  return { h, u, cid, ac, lineId: line.body.id as number, get: get_, advance, history };
}

const legsIn = (w: Awaited<ReturnType<typeof world>>, status: string) => all<{ id: number; dep_at: number; flight_no: number; revenue: number; fuel_cost: number; landing_fee: number; maintenance: number }>(w.h.db, 'SELECT * FROM scheduled_flights WHERE company_id = ? AND status = ? ORDER BY dep_at, id', w.cid, status);

test('history lists the done line legs with their money, equal to the ledger rows of the leg; future legs are left out', async () => {
  const w = await world();
  await w.advance(DAY);
  const done = legsIn(w, 'done');
  assert.ok(done.length >= 3, 'the line flew');
  assert.ok(legsIn(w, 'scheduled').length > 0, 'and has legs ahead');

  const rows = await w.history('?source=lines');
  assert.equal(rows.length, done.length, 'only the legs that happened');
  assert.ok(rows.every((r) => r.source === 'line' && ['done', 'flying'].includes(r.leg.status)));
  assert.deepEqual(rows.map((r) => r.at), done.map((l) => l.dep_at).reverse(), 'newest first, dated by departure');
  for (const r of rows) {
    if (r.source !== 'line') throw new Error('line rows only');
    const posted = get<{ s: number }>(w.h.db, "SELECT COALESCE(SUM(amount), 0) AS s FROM transactions WHERE company_id = ? AND aircraft_id = ? AND at = ? AND kind IN ('line_revenue', 'line_fuel', 'line_fee', 'line_maintenance')", w.cid, w.ac, r.at)!.s;
    assert.ok(r.leg.revenue > 0 && r.leg.pax !== null && r.leg.pax > 0);
    assert.equal(r.leg.net, r.leg.revenue - r.leg.fuelCost - r.leg.landingFee - r.leg.maintenance);
    assert.equal(r.leg.net, posted, `leg ${r.leg.flightNo}: net equals what the ledger posted`);
    assert.equal(r.leg.reg, get<{ registration: string }>(w.h.db, 'SELECT registration FROM aircraft WHERE id = ?', w.ac)!.registration);
    assert.equal(r.leg.icao, 'AT76');
    assert.match(r.leg.flightNo, /^[A-Z]{3} \d+$/);
    assert.equal(r.leg.lineId, w.lineId);
  }
  assert.deepEqual(await w.history('?source=flown'), [], 'no flown flight yet');
});

test('cancelled legs are listed with their cause; a rotation the player took over is not a leg of the line', async () => {
  const w = await world();
  await w.advance(2 * HOUR);
  const rot = (await w.get(`/api/v1/lines/${w.lineId}`)).body.day.find((l: { status: string }) => l.status === 'scheduled');
  assert.equal((await w.h.call('POST', `/api/v1/lines/${w.lineId}/rotations/${rot.id}/take`, { token: w.u.token })).status, 201);
  run(w.h.db, "UPDATE aircraft SET status = 'maintenance', maintenance_until = ? WHERE id = ?", T0 + 3 * 24 * HOUR, w.ac);
  await w.advance(DAY);
  const rows = await w.history('?source=lines');
  const cancelled = rows.filter((r) => r.source === 'line' && r.leg.status === 'cancelled');
  assert.ok(cancelled.length > 0);
  assert.ok(cancelled.every((r) => r.source === 'line' && r.leg.cancelCause === 'aircraft_unavailable' && r.leg.net === 0 && r.leg.id !== rot.id));
});

test('one paginated, date-ordered list across both sources; the source filter splits it', async () => {
  const w = await world();
  // a flight flown by hand with the starter C172, dated between line legs
  const other = w.u.me.fleet[0].id as number;
  await w.advance(DAY);
  const job = await w.h.flyableJob(w.u.token, other);
  const accepted = await w.h.call('POST', `/api/v1/jobs/${job.id}/accept`, { token: w.u.token, body: { aircraftId: other } });
  assert.equal(accepted.status, 201, accepted.text);
  const flight = get<FlightRow>(w.h.db, 'SELECT * FROM flights WHERE id = ?', accepted.body.id)!;
  finishFlight(w.h.db, flight, 'verified', T0 + 5 * HOUR);

  const all_ = await w.history('?limit=200');
  const flown = await w.history('?source=flown');
  const lines = await w.history('?source=lines');
  assert.equal(flown.length, 1);
  assert.ok(lines.length >= 3);
  assert.equal(all_.length, flown.length + lines.length);
  assert.deepEqual(all_.map((r) => r.at), [...all_.map((r) => r.at)].sort((a, b) => b - a), 'date-ordered');
  assert.ok(all_.some((r, i) => r.source === 'flown' && i > 0 && i < all_.length - 1), 'the flown flight sits between line legs');

  const pages: HistoryEntry[] = [];
  let before: string | undefined;
  for (let i = 0; i < 20; i++) {
    const page = await w.history(`?limit=2${before ? `&before=${before}` : ''}`);
    assert.ok(page.length <= 2);
    pages.push(...page);
    if (page.length < 2) break;
    before = page[page.length - 1]!.cursor;
  }
  assert.deepEqual(pages.map((r) => r.cursor), all_.map((r) => r.cursor), 'pages concatenate to the whole list, no gap and no repeat');
  assert.equal(new Set(pages.map((r) => r.cursor)).size, pages.length);
});

test('a company only sees its own legs; a bad cursor or source is a 400', async () => {
  const w = await world();
  await w.advance(DAY);
  const other = await w.h.register('bob', 'LFPG');
  const r = await w.h.call('GET', '/api/v1/me/history', { token: other.token });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, []);
  const hijack = await w.h.call('GET', '/api/v1/me/history', { token: other.token, company: w.cid });
  assert.equal(hijack.status, 403);
  assert.equal((await w.h.call('GET', '/api/v1/me/history')).status, 401);
  for (const q of ['?before=abc', '?before=1-2-3', '?source=all2', '?limit=0']) assert.equal((await w.get(`/api/v1/me/history${q}`)).status, 400, q);
});

test('an aircraft of a line: in the air it is flying (fleet busy), on the ground it has a next departure and its last leg with the net', async () => {
  const w = await world();
  const states = async () => {
    const me = (await w.get('/api/v1/me')).body;
    return { air: (await w.get('/api/v1/network/aircraft')).body as AircraftLine[], plane: me.fleet.find((x: { id: number }) => x.id === w.ac) as { busy: boolean; status: string; location: string } };
  };
  assert.deepEqual((await states()).air.map((a) => [a.aircraftId, a.flying, a.last]), [[w.ac, null, null]], 'nothing flown yet');
  assert.equal((await states()).air[0]!.next!.status, 'scheduled');

  await w.advance(2 * HOUR + 30 * 60_000); // 14:30: the 14:00 leg is in the air
  let s = await states();
  const a = s.air[0]!;
  assert.ok(a.flying, 'in the air');
  assert.equal(a.flying!.status, 'flying');
  assert.equal(s.plane.busy, true);
  assert.equal(s.plane.status, 'flying');
  assert.equal(a.last, null);

  await w.advance(7 * HOUR + 30 * 60_000); // 22:00: the day's rotations are over, the next departure is tomorrow
  s = await states();
  const b = s.air[0]!;
  assert.equal(b.flying, null);
  assert.equal(s.plane.busy, false);
  assert.ok(b.last && b.last.status === 'done');
  const done = legsIn(w, 'done').filter((l) => l.dep_at <= w.h.clock.t);
  const last = done[done.length - 1]!;
  assert.equal(b.last!.net, last.revenue - last.fuel_cost - last.landing_fee - last.maintenance);
  assert.ok(b.next && b.next.dep >= w.h.clock.t);
  assert.equal(b.location, s.plane.location);
  assert.equal((await w.h.call('GET', '/api/v1/network/aircraft', { token: (await w.h.register('cyd')).token })).body.length, 0);
});

