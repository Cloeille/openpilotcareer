import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AUTONOMY_FACTOR, DAY_MS, LINE_TICK_MS, MAX_OFFLINE_DAYS, PAX_KG, jobPayout, lineTickOf, settle, blockHours, fuelPriceFactor, type Job, type NetworkView, type ScheduledFlight,
} from '@opc/shared';
import { catchUpLines, nextBoundary } from './lines.ts';
import { createLine } from './lines-manage.ts';
import { seedAi } from './ai.ts';
import { airports, catalogType } from './catalog.ts';
import { all, get, MIGRATIONS, openDb, run } from './db.ts';
import { insertAircraft } from './fleet-extras.ts';
import { finishFlight, type FlightRow } from './game.ts';
import { grantStarterCrew } from './staff-people.ts';
import { refreshLine } from './lines.ts';
import { harness } from './harness.ts';

const T0 = Date.UTC(2026, 10, 4, 12, 0, 0); // Wednesday 4 Nov 2026, 12:00Z (the harness clock)
const HOUR = 3_600_000;
const body = (over: Record<string, unknown> = {}) => ({ a: 'LFPG', b: 'LFLL', freqPerDay: 3, days: Array(7).fill(true), windowStart: '06:00', windowEnd: '18:00', aircraftIds: [] as number[], ...over });

/** A player at LFPG with one AT76 (the harness clock is T0) and, optionally, the LFPG-LFLL line flown by it. */
async function world(o: { line?: boolean; ai?: boolean } = {}) {
  const h = await harness(o.ai ? { ai: true } : {});
  const u = await h.register('amy', 'LFPG');
  const cid = u.me.company.id as number;
  const ac = insertAircraft(h.db, { companyId: cid, icao: 'AT76', hub: 'LFPG', value: 1_000_000, ownership: 'owned', at: h.clock.t });
  const tok = u.token;
  const get_ = (url: string) => h.call('GET', url, { token: tok });
  const lineBody = body({ aircraftIds: [ac] });
  let lineId = 0;
  if (o.line !== false) {
    const r = await h.call('POST', '/api/v1/lines', { token: tok, body: lineBody });
    assert.equal(r.status, 201, r.text);
    lineId = r.body.id;
    // C11: a new company hires its crew; these fixtures start with the starter crew the migration grants to existing companies
    grantStarterCrew(h.db, cid, h.clock.t);
    refreshLine(h.db, lineId, h.clock.t);
  }
  /** Move the clock and make the one request that plays the ticks. */
  const advance = async (ms: number) => { h.clock.t += ms; await get_('/api/v1/network'); };
  const lineMoney = () => get<{ s: number }>(h.db, "SELECT COALESCE(SUM(amount), 0) AS s FROM transactions WHERE company_id = ? AND kind LIKE 'line_%'", cid)!.s;
  const reputation = () => get<{ r: number }>(h.db, 'SELECT reputation AS r FROM companies WHERE id = ?', cid)!.r;
  const legs = () => all<{ id: number; status: string; dep_at: number; cancel_cause: string | null; delay_min: number; delay_cause: string | null; pax: number | null; revenue: number | null; fuel_cost: number | null; flight_no: number; taken_job: string | null }>(
    h.db, 'SELECT * FROM scheduled_flights ORDER BY dep_at, id');
  const ledger = () => all(h.db, "SELECT at, kind, amount, memo FROM transactions WHERE company_id = ? AND kind LIKE 'line_%' ORDER BY id", cid);
  return { h, u, cid, ac, tok, lineId, lineBody, get: get_, advance, lineMoney, reputation, legs, ledger };
}

// ---------------------------------------------------------------- migration

test('SCHEMA_V7 creates the line tables on a fresh database', () => {
  const db = openDb(':memory:');
  assert.equal(get<{ user_version: number }>(db, 'PRAGMA user_version')!.user_version, MIGRATIONS.length);
  for (const t of ['line_ticks', 'line_networks', 'lines', 'line_aircraft', 'scheduled_flights']) assert.ok(get(db, "SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?", t), t);
});

test('SCHEMA_V7 upgrades a v5 database and keeps its SimBrief imports (source defaults to simbrief)', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'opc-v7-')), 'v5.sqlite');
  const raw = new DatabaseSync(file);
  for (let i = 0; i < 5; i++) raw.exec(MIGRATIONS[i]!);
  raw.exec('PRAGMA user_version = 5');
  raw.exec(`INSERT INTO users VALUES (1, 'a', 'h', 1);
    INSERT INTO companies (id, user_id, name, balance, reputation, created_at) VALUES (1, 1, 'A Air', 1, 50, 1);
    INSERT INTO custom_jobs VALUES ('sb-1', 1, 5, 'pax', 'LFPG', 'EGLL', 195, 300, 3, 3000, 'C172', NULL, NULL);`);
  raw.close();
  const db = openDb(file);
  assert.equal(get<{ user_version: number }>(db, 'PRAGMA user_version')!.user_version, MIGRATIONS.length);
  const job = get<{ source: string; expires_at: number | null }>(db, "SELECT source, expires_at FROM custom_jobs WHERE id = 'sb-1'")!;
  assert.deepEqual({ ...job }, { source: 'simbrief', expires_at: null });
});

// ---------------------------------------------------------------- the clock: lazy, idempotent, deterministic

test('a line earns while the player is away: one request plays the ticks that are due and a leg earns its settlement x AUTONOMY_FACTOR', async () => {
  const w = await world();
  assert.equal(w.lineMoney(), 0);
  await w.advance(DAY_MS);
  const done = w.legs().filter((l) => l.status === 'done');
  assert.ok(done.length >= 6, `${done.length} legs flown`);
  assert.ok(w.lineMoney() > 0);
  // the same maths as a flown job: settle() with the leg's passengers, revenue scaled by the autonomy factor, costs paid in full
  const leg = done[0]!;
  const t = catalogType('AT76');
  const dist = Math.round(airports.get('LFPG')!.lat > 0 ? await distance('LFPG', 'LFLL') : 0);
  const s = settle({ payout: jobPayout('pax', dist, leg.pax! * PAX_KG), distanceNm: dist, aircraft: t, status: 'verified', destSize: 'large', destIsHub: false });
  assert.equal(leg.revenue, Math.round(s.revenue * AUTONOMY_FACTOR));
  assert.equal(leg.fuel_cost, s.fuelCost);
  assert.equal(AUTONOMY_FACTOR, 0.5);
});
const distance = async (a: string, b: string): Promise<number> => {
  const { distanceNm } = await import('@opc/shared');
  const x = airports.get(a)!, y = airports.get(b)!;
  return distanceNm(x.lat, x.lon, y.lat, y.lon);
};

test('replaying the clock changes nothing: the same or an earlier instant plays no tick and pays nothing twice', async () => {
  const w = await world();
  await w.advance(DAY_MS);
  const before = JSON.stringify([w.ledger(), w.legs(), w.reputation()]);
  assert.equal(catchUpLines(w.h.db, w.h.clock.t), 0);
  assert.equal(catchUpLines(w.h.db, w.h.clock.t - 6 * HOUR), 0);
  await w.get('/api/v1/network');
  assert.equal(JSON.stringify([w.ledger(), w.legs(), w.reputation()]), before);
  // a tick row is the lock: removing the newest one makes exactly that tick replay, and a leg is resolved only once
  run(w.h.db, 'DELETE FROM line_ticks WHERE tick = (SELECT MAX(tick) FROM line_ticks)');
  assert.equal(catchUpLines(w.h.db, w.h.clock.t), 1);
  assert.equal(JSON.stringify([w.ledger(), w.legs(), w.reputation()]), before);
});

test('catching up in one jump equals ticking along: same ledger, same legs, same reputation (up to the 2-day replay bound)', async () => {
  const stepwise = await world();
  for (let i = 0; i < 4 * 24 * 2; i++) { stepwise.h.clock.t += LINE_TICK_MS; catchUpLines(stepwise.h.db, stepwise.h.clock.t); }
  const jumped = await world();
  await jumped.advance(2 * DAY_MS);
  assert.deepEqual(jumped.ledger(), stepwise.ledger());
  assert.deepEqual(jumped.legs(), stepwise.legs());
  assert.equal(jumped.reputation(), stepwise.reputation());
});

test('a long absence is settled in bulk: the same money as ticking along, one ledger line per line, day and kind', async () => {
  const stepwise = await world();
  for (let i = 0; i < 4 * 24 * 6; i++) { stepwise.h.clock.t += LINE_TICK_MS; catchUpLines(stepwise.h.db, stepwise.h.clock.t); }
  const away = await world();
  await away.advance(6 * DAY_MS);
  assert.equal(away.lineMoney(), stepwise.lineMoney(), 'bulk settlement books exactly what replaying leg by leg would');
  assert.ok(away.ledger().length < stepwise.ledger().length / 2, `${away.ledger().length} ledger lines instead of ${stepwise.ledger().length}`);
  assert.ok(away.ledger().some((e) => /^LFLL-LFPG 2026-11-0\d x\d+$/.test((e as { memo: string }).memo) || /^LFPG-LFLL 2026-11-0\d x\d+$/.test((e as { memo: string }).memo)), 'aggregated memo "A-B day xN"');
  assert.deepEqual(away.legs(), stepwise.legs());
});

test('two identical worlds produce identical books: no randomness, no wall clock', async () => {
  const run1 = await world(), run2 = await world();
  await run1.advance(3 * DAY_MS); await run2.advance(3 * DAY_MS);
  assert.deepEqual(run1.ledger(), run2.ledger());
  assert.deepEqual(run1.legs(), run2.legs());
});

test('legs are laid for today and tomorrow only, never before the line existed, and resolved only at their departure tick', async () => {
  const w = await world();
  const laid = w.legs();
  assert.ok(laid.every((l) => l.dep_at >= T0 + LINE_TICK_MS - LINE_TICK_MS % LINE_TICK_MS && l.dep_at > T0), 'nothing before the line was created');
  assert.ok(laid.every((l) => l.dep_at < Date.UTC(2026, 10, 6)), 'nothing past tomorrow');
  assert.ok(laid.every((l) => l.status === 'scheduled'));
  assert.ok(laid.every((l) => l.dep_at % LINE_TICK_MS === 0), 'departures on the tick grid');
  await w.advance(3 * HOUR); // 15:00: the 14:00 rotation has left, the 15:45 return has not
  const flown = w.legs().filter((l) => l.status === 'done').map((l) => l.dep_at);
  assert.deepEqual(flown, [Date.UTC(2026, 10, 4, 14)]);
});

// ---------------------------------------------------------------- C1: the offline cap

test('after 14 days without a request the lines stop earning; the next request restarts them without paying for the gap', async () => {
  const w = await world();
  w.h.clock.t += 20 * DAY_MS;
  await w.get('/api/v1/network'); // the owner is back after 20 days: the past is played with the old presence
  const cap = T0 + MAX_OFFLINE_DAYS * DAY_MS;
  const flown = w.legs().filter((l) => l.status === 'done');
  assert.ok(flown.length > 0 && flown.every((l) => l.dep_at <= cap), 'nothing flew past the cap');
  assert.ok((w.ledger() as { at: number }[]).every((e) => e.at <= cap), 'nothing was paid past the cap');
  assert.equal(w.legs().filter((l) => l.status === 'scheduled' && l.dep_at < w.h.clock.t).length, 0, 'no leg of the lapsed days is left pending');
  const net = (await w.get('/api/v1/network')).body as NetworkView;
  assert.equal(net.lapsedAt, cap);
  assert.ok(w.legs().some((l) => l.status === 'scheduled' && l.dep_at > w.h.clock.t), 'today\'s timetable is laid at once on the return, not at the next tick');
  const paid = w.lineMoney();
  await w.advance(DAY_MS);
  assert.ok(w.lineMoney() > paid, 'the lines run again after the login');
  assert.ok(w.legs().filter((l) => l.status === 'done' && l.dep_at > cap).every((l) => l.dep_at >= T0 + 20 * DAY_MS), 'and only from the login on');
});

// ---------------------------------------------------------------- C3: the network switch

test('switching the network off stops every leg and every payment; switching it on again resumes from the next tick', async () => {
  const w = await world();
  assert.ok(w.legs().length > 0);
  const off = await w.h.call('PUT', '/api/v1/network/enabled', { token: w.tok, body: { enabled: false } });
  assert.deepEqual(off.body, { enabled: false });
  assert.equal(w.legs().length, 0, 'unflown legs are dropped');
  await w.advance(2 * DAY_MS);
  assert.equal(w.legs().length, 0);
  assert.equal(w.lineMoney(), 0);
  assert.equal(((await w.get('/api/v1/network')).body as NetworkView).enabled, false);
  await w.h.call('PUT', '/api/v1/network/enabled', { token: w.tok, body: { enabled: true } });
  assert.ok(w.legs().length > 0 && w.legs().every((l) => l.dep_at > w.h.clock.t), 'laid again from the next tick, none of the gap');
  await w.advance(DAY_MS);
  assert.ok(w.lineMoney() > 0);
});

// ---------------------------------------------------------------- cancellations, delays, stoppages

test('an aircraft in the workshop cancels its legs (-0.02 reputation each); the line is interrupted and the stoppage costs -2 then -1 a day, once', async () => {
  const w = await world();
  const rep0 = w.reputation();
  run(w.h.db, "UPDATE aircraft SET status = 'maintenance', maintenance_until = ? WHERE id = ?", T0 + 10 * DAY_MS, w.ac);
  await w.advance(DAY_MS); // to Thu 12:00
  const cancelled = w.legs().filter((l) => l.status === 'cancelled');
  assert.ok(cancelled.length >= 4 && cancelled.every((l) => l.cancel_cause === 'aircraft_unavailable'));
  assert.equal(w.lineMoney(), 0);
  const line = (await w.get(`/api/v1/lines/${w.lineId}`)).body.line;
  assert.equal(line.status, 'interrupted');
  assert.equal(line.interruptCause, 'aircraft');
  assert.equal(line.interruptedSince, T0 + LINE_TICK_MS, 'detected at the first tick after the fault');
  const first = rep0 - cancelled.length * 0.02 - 2;
  assert.ok(Math.abs(w.reputation() - first) < 1e-9, `${w.reputation()} vs ${first}`);
  await w.advance(DAY_MS); // the second midnight: -1 more
  const n2 = w.legs().filter((l) => l.status === 'cancelled').length;
  assert.ok(Math.abs(w.reputation() - (rep0 - n2 * 0.02 - 3)) < 1e-9);
  const again = w.reputation();
  await w.get('/api/v1/network'); catchUpLines(w.h.db, w.h.clock.t);
  assert.equal(w.reputation(), again, 'requests that play no tick charge nothing');

  const p = (await w.get(`/api/v1/lines/${w.lineId}/problem`)).body;
  assert.equal(p.problem[0].kind, 'aircraft');
  assert.equal(p.cost.cancelled, n2);
  assert.ok(p.cost.lostRevenue > 0 && p.cost.perDay > 0);
  assert.equal(p.cost.reputation, -3);
  assert.equal(p.cost.slotsLostAt, T0 + LINE_TICK_MS + 14 * DAY_MS);
  assert.deepEqual(p.options.pause, { fixedCostPerDay: 0 });
  assert.equal(p.options.recruit, null);
  assert.deepEqual(p.projection.map((d: { status: string }) => d.status), Array(7).fill('stopped'));
});

test('a stopped line comes back by itself when the workshop releases its aircraft, and the stoppage counters reset', async () => {
  const w = await world();
  run(w.h.db, "UPDATE aircraft SET status = 'maintenance', maintenance_until = ? WHERE id = ?", T0 + 60 * HOUR, w.ac);
  await w.advance(DAY_MS);
  assert.equal((await w.get(`/api/v1/lines/${w.lineId}`)).body.line.status, 'interrupted');
  await w.advance(2 * DAY_MS);
  const line = (await w.get(`/api/v1/lines/${w.lineId}`)).body.line;
  assert.equal(line.status, 'active');
  assert.equal(line.interruptedSince, null);
  assert.ok(w.lineMoney() > 0, 'and it earns again');
});

test('delays are deterministic: +10 min per 10 wear points from 70 %, shown with their cause', async () => {
  const w = await world();
  run(w.h.db, 'UPDATE aircraft SET wear_pct = 85 WHERE id = ?', w.ac);
  await w.advance(DAY_MS);
  const flown = w.legs().filter((l) => l.status === 'done');
  assert.ok(flown.length > 0 && flown.every((l) => l.delay_min === 20 && l.delay_cause === 'wear'));
  const ops = (await w.get('/api/v1/ops')).body;
  const row = [...ops.flying, ...ops.upcoming].find((r: { delayCause: string | null }) => r.delayCause === 'wear');
  assert.equal(row?.note, 'aircraft wear');
  const net = (await w.get('/api/v1/network')).body as NetworkView;
  assert.equal(net.today.onTimePct, 0, 'every departed leg is more than 15 minutes late');
});

test('an aircraft in the air on a line cannot be taken for a flown job; the player\'s own active flight cancels the legs it overlaps', async () => {
  const w = await world();
  await w.advance(2 * HOUR + 30 * 60_000); // 14:30: the 14:00 leg is in the air until ~15:07
  const flying = (await w.get('/api/v1/network')).body as NetworkView;
  assert.equal(flying.flying.length, 1);
  assert.ok(flying.flying[0]!.progress > 0 && flying.flying[0]!.progress < 1);
  assert.equal(flying.flying[0]!.own, false);
  const jobs = (await w.get('/api/v1/jobs')).body.jobs as Job[];
  const r = await w.h.call('POST', `/api/v1/jobs/${jobs[0]!.id}/accept`, { token: w.tok, body: { aircraftId: w.ac } });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'aircraft_busy');
});

// ---------------------------------------------------------------- take a rotation

test('taking a rotation turns the leg into a private job paid at 100 % through the normal flight path, with no penalty', async () => {
  const w = await world();
  const day = (await w.get(`/api/v1/lines/${w.lineId}`)).body.day as ScheduledFlight[];
  const leg = day.find((l) => l.status === 'scheduled')!;
  const rep0 = w.reputation();
  const r = await w.h.call('POST', `/api/v1/lines/${w.lineId}/rotations/${leg.id}/take`, { token: w.tok });
  assert.equal(r.status, 201, r.text);
  const job = r.body.job as Job;
  assert.equal(job.source, 'line');
  assert.equal(job.requiredAircraft, 'AT76');
  assert.equal(r.body.reservedUntil, leg.arr);
  assert.equal(job.payout, jobPayout('pax', job.distanceNm, job.pax * PAX_KG));
  assert.equal((await w.h.call('POST', `/api/v1/lines/${w.lineId}/rotations/${leg.id}/take`, { token: w.tok })).status, 409, 'once only');

  const listed = (await w.get('/api/v1/jobs')).body.imported as Job[];
  assert.ok(listed.some((j) => j.id === job.id), 'listed with the private jobs');
  const accepted = await w.h.call('POST', `/api/v1/jobs/${job.id}/accept`, { token: w.tok, body: { aircraftId: w.ac } });
  assert.equal(accepted.status, 201, accepted.text);
  const ops = (await w.get('/api/v1/ops')).body;
  assert.equal(ops.flying[0].own, true, '"Ton vol"');
  const flight = get<FlightRow>(w.h.db, 'SELECT * FROM flights WHERE id = ?', accepted.body.id)!;
  const done = finishFlight(w.h.db, flight, 'verified', w.h.clock.t + HOUR);
  assert.equal(done.revenue, job.payout, '100 % of the job rate, no autonomy factor');
  assert.ok(done.revenue > 0);

  const taken = w.legs().find((l) => l.id === leg.id)!;
  assert.equal(taken.status, 'cancelled');
  assert.equal(taken.cancel_cause, null);
  assert.equal(w.reputation(), rep0 + 0.1, 'only the flown job counts: no cancellation penalty');
  const view = ((await w.get(`/api/v1/lines/${w.lineId}`)).body.day as ScheduledFlight[]).find((l) => l.id === leg.id)!;
  assert.equal(view.takenByPlayer, true);
  assert.equal(((await w.get('/api/v1/network')).body as NetworkView).today.cancelled, 0, 'a rotation she flew is not a cancellation');
});

test('an autonomous leg of the same size earns exactly half of what the player gets for flying it', async () => {
  const w = await world();
  const day = (await w.get(`/api/v1/lines/${w.lineId}`)).body.day as ScheduledFlight[];
  const legId = day.find((l) => l.status === 'scheduled' && l.origin === 'LFPG')!.id;
  const job = (await w.h.call('POST', `/api/v1/lines/${w.lineId}/rotations/${legId}/take`, { token: w.tok })).body.job as Job;
  const other = await world(); // same world, same programme, nobody takes the leg
  await other.advance(DAY_MS);
  const auto = other.legs().find((l) => l.status === 'done' && l.pax === job.pax)!;
  const full = settle({ payout: job.payout, distanceNm: job.distanceNm, aircraft: catalogType('AT76'), status: 'verified', destSize: 'large', destIsHub: false }).revenue;
  assert.equal(auto.revenue, Math.round(full * AUTONOMY_FACTOR));
  assert.equal(blockHours(catalogType('AT76'), job.distanceNm) > 0, true);
});

// ---------------------------------------------------------------- API: validation, forecast, edits, privacy

test('line creation validates in one place and the forecast reports the same problems without creating anything', async () => {
  const w = await world({ line: false });
  const post = (b: object) => w.h.call('POST', '/api/v1/lines', { token: w.tok, body: b });
  assert.equal((await w.h.call('POST', '/api/v1/lines', { body: w.lineBody })).status, 401);
  assert.equal((await post({ ...w.lineBody, windowEnd: '05:00' })).status, 400);
  assert.equal((await post({ ...w.lineBody, b: 'ZZZZ' })).body.error, 'unknown_airport');
  assert.equal((await post({ ...w.lineBody, b: 'LFPG' })).body.error, 'same_airport');
  assert.equal((await post({ ...w.lineBody, aircraftIds: [9999] })).body.error, 'aircraft_not_found');
  assert.equal((await post({ ...w.lineBody, a: 'LFMN', b: 'LFML' })).body.error, 'hub_missing');
  assert.equal((await post({ ...w.lineBody, b: 'KJFK' })).body.error, 'distance_exceeds_range');
  assert.equal((await post({ ...w.lineBody, freqPerDay: 6, windowEnd: '09:00' })).body.error, 'aircraft_busy');
  const f = await w.h.call('POST', '/api/v1/lines/forecast', { token: w.tok, body: { ...w.lineBody, freqPerDay: 6, windowEnd: '09:00' } });
  assert.equal(f.body.valid, false);
  assert.deepEqual(f.body.problems, ['aircraft_busy']);
  assert.ok(f.body.conflicts.length > 0);
  assert.equal(all(w.h.db, 'SELECT * FROM lines').length, 0, 'nothing created by failures or by the forecast');

  const ok = await w.h.call('POST', '/api/v1/lines/forecast', { token: w.tok, body: w.lineBody });
  assert.equal(ok.body.valid, true);
  assert.equal(ok.body.crewModelled, true);
  assert.equal(ok.body.forecast.estimated, true);
  assert.ok(ok.body.forecast.revenue > 0 && ok.body.forecast.profit === ok.body.forecast.revenue - ok.body.forecast.costs);
  assert.ok(ok.body.forecast.loadFactor >= 0.35 && ok.body.forecast.loadFactor <= 0.95);
  assert.equal(all(w.h.db, 'SELECT * FROM lines').length, 0);

  const made = await post(w.lineBody);
  assert.equal(made.status, 201);
  assert.deepEqual([made.body.a, made.body.b], ['LFLL', 'LFPG'], 'airports are stored in a fixed order');
  assert.deepEqual(made.body.flightNos, [1100, 1105]);
  assert.equal((await post({ ...w.lineBody, a: 'LFLL', b: 'LFPG' })).body.error, 'duplicate_line');
});

test('the forecast agrees with the result: one week of the programme valued by the engine\'s own maths', async () => {
  const w = await world({ line: false });
  const f = (await w.h.call('POST', '/api/v1/lines/forecast', { token: w.tok, body: w.lineBody })).body.forecast;
  const fix = await world(); // the same programme, really flown
  await fix.advance(8 * DAY_MS);
  const day7 = fix.legs().filter((l) => l.status === 'done' && l.dep_at >= Date.UTC(2026, 10, 5) && l.dep_at < Date.UTC(2026, 10, 12));
  assert.equal(day7.length, 7 * 6);
  const revenue = day7.reduce((s, l) => s + l.revenue!, 0);
  assert.equal(revenue, f.revenue, 'the forecast IS the engine\'s maths over a week');
});

test('changing a line\'s programme lays the legs that have not departed again, and only those: flown legs and the leg in the air stay', async () => {
  const w = await world();
  const second = insertAircraft(w.h.db, { companyId: w.cid, icao: 'AT76', hub: 'LFPG', value: 1_000_000, ownership: 'owned', at: w.h.clock.t });
  const more = { freqPerDay: 6, aircraftIds: [w.ac, second] }; // more flights need a second aircraft
  const url = `/api/v1/lines/${w.lineId}`;
  w.h.clock.t = Date.UTC(2026, 10, 5, 10, 30); // Thursday 10:30: the 06:00 and 07:45 legs are done, the 10:00 one is in the air, 11:45 and 14:00 are ahead
  await w.get('/api/v1/network');
  const air = get<{ id: number; dep_at: number; arr_at: number }>(w.h.db, "SELECT * FROM scheduled_flights WHERE status = 'done' AND dep_at <= ? AND arr_at > ?", w.h.clock.t, w.h.clock.t);
  assert.ok(air, 'a leg is in the air at this instant');
  const departed = () => JSON.stringify(all(w.h.db, 'SELECT * FROM scheduled_flights WHERE dep_at <= ? ORDER BY id', w.h.clock.t));
  const frozen = departed();
  assert.ok(w.legs().filter((l) => l.status === 'done').length >= 3);
  const before = w.legs().filter((l) => l.dep_at > w.h.clock.t);
  assert.ok(before.length > 0 && before.every((l) => l.status === 'scheduled'));

  const total = w.legs().length;
  const f = await w.h.call('POST', `${url}/forecast`, { token: w.tok, body: more });
  assert.equal(f.status, 200, f.text);
  assert.deepEqual({ valid: f.body.valid, conflicts: f.body.conflicts.length }, { valid: true, conflicts: 0 }, 'the line does not conflict with itself');
  assert.equal(w.legs().length, total, 'the forecast changes nothing');

  const patched = await w.h.call('PATCH', url, { token: w.tok, body: more });
  assert.equal(patched.status, 200, patched.text);
  assert.equal(departed(), frozen, 'the legs flown and the one in the air are untouched');
  const after = w.legs().filter((l) => l.dep_at > w.h.clock.t);
  assert.ok(after.every((l) => l.status === 'scheduled' && l.dep_at >= nextBoundary(w.h.clock.t)), 'laid again from the next tick');
  const laid = (legs: { dep_at: number }[], day: number) => legs.filter((l) => l.dep_at >= day && l.dep_at < day + DAY_MS).length;
  assert.equal(laid(after, Date.UTC(2026, 10, 6)), 12, 'tomorrow is the new programme: six round trips');
  assert.equal(laid(before, Date.UTC(2026, 10, 6)), 6, 'it was three');
});

test('a programme that clashes with another line on a shared aircraft is reported by the forecast and refused by the patch', async () => {
  const w = await world();
  const url = `/api/v1/lines/${w.lineId}`;
  const widen = { freqPerDay: 3, windowEnd: '22:00' };
  assert.equal((await w.h.call('POST', `${url}/forecast`, { token: w.tok, body: widen })).body.valid, true, 'alone, the wider programme is fine');
  const evening = await w.h.call('POST', '/api/v1/lines', { token: w.tok, body: body({ a: 'LFPG', b: 'LFMN', freqPerDay: 1, windowStart: '19:00', windowEnd: '23:50', aircraftIds: [w.ac] }) });
  assert.equal(evening.status, 201, evening.text);
  const f = await w.h.call('POST', `${url}/forecast`, { token: w.tok, body: widen });
  assert.deepEqual({ valid: f.body.valid, problems: f.body.problems }, { valid: false, problems: ['aircraft_busy'] });
  assert.ok(f.body.conflicts.length > 0 && f.body.conflicts.every((c: { aircraftId: number }) => c.aircraftId === w.ac));
  const legs = JSON.stringify(w.legs());
  const refused = await w.h.call('PATCH', url, { token: w.tok, body: widen });
  assert.deepEqual({ status: refused.status, error: refused.body.error }, { status: 409, error: 'aircraft_busy' });
  assert.equal(JSON.stringify(w.legs()), legs, 'a refused change leaves the timetable as it was');
  assert.equal((await w.h.call('POST', `${url}/forecast`, { token: w.tok, body: {} })).status, 400, 'a forecast of nothing is a bad request');
  const bob = await w.h.register('bob', 'LFPG');
  assert.equal((await w.h.call('POST', `${url}/forecast`, { token: bob.token, body: { freqPerDay: 2 } })).status, 404, 'another company cannot probe your line');
});

test('a line is edited, paused, resumed and deleted; pausing keeps no unflown leg and costs nothing extra', async () => {
  const w = await world();
  const url = `/api/v1/lines/${w.lineId}`;
  const patched = await w.h.call('PATCH', url, { token: w.tok, body: { freqPerDay: 2 } });
  assert.equal(patched.body.freqPerDay, 2);
  assert.ok(w.legs().length > 0 && w.legs().length <= 8, 'the timetable was laid again');
  assert.equal((await w.h.call('PATCH', url, { token: w.tok, body: {} })).status, 400);
  assert.equal((await w.h.call('PATCH', url, { token: w.tok, body: { freqPerDay: 9, windowEnd: '07:00' } })).body.error, 'aircraft_busy');
  const balance = () => get<{ b: number }>(w.h.db, 'SELECT balance AS b FROM companies WHERE id = ?', w.cid)!.b;
  const b0 = balance();
  assert.equal((await w.h.call('POST', `${url}/pause`, { token: w.tok })).body.status, 'paused');
  assert.equal((await w.h.call('POST', `${url}/pause`, { token: w.tok })).status, 409);
  assert.equal(w.legs().length, 0);
  await w.advance(2 * DAY_MS);
  assert.equal(balance(), b0, 'a paused line costs nothing (C2)');
  assert.equal((await w.h.call('POST', `${url}/resume`, { token: w.tok })).body.status, 'active');
  assert.ok(w.legs().length > 0);
  assert.equal((await w.h.call('DELETE', url, { token: w.tok })).status, 204);
  assert.equal(all(w.h.db, 'SELECT * FROM scheduled_flights').length, 0);
  assert.equal((await w.get(url)).status, 404);
});

test('the reassign remedy puts a free aircraft on a stopped line; recruiting is refused while the crew is complete', async () => {
  const w = await world();
  run(w.h.db, "UPDATE aircraft SET status = 'maintenance', maintenance_until = ? WHERE id = ?", T0 + 10 * DAY_MS, w.ac);
  await w.advance(DAY_MS);
  const spare = insertAircraft(w.h.db, { companyId: w.cid, icao: 'AT76', hub: 'LFPG', value: 1_000_000, ownership: 'owned', at: w.h.clock.t });
  const p = (await w.get(`/api/v1/lines/${w.lineId}/problem`)).body;
  assert.ok(p.options.reassign.aircraft.some((a: { id: number }) => a.id === spare), 'the spare is offered');
  assert.ok(p.options.reassign.aircraft.every((a: { id: number }) => a.id !== w.ac), 'the grounded aircraft is not');
  assert.equal((await w.h.call('POST', `/api/v1/lines/${w.lineId}/resolve`, { token: w.tok, body: { option: 'recruit' } })).body.error, 'nothing_to_recruit');
  assert.equal((await w.h.call('POST', `/api/v1/lines/${w.lineId}/resolve`, { token: w.tok, body: { option: 'reassign', aircraftId: 9999 } })).body.error, 'aircraft_not_free');
  const r = await w.h.call('POST', `/api/v1/lines/${w.lineId}/resolve`, { token: w.tok, body: { option: 'reassign', aircraftId: spare } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.status, 'active');
  await w.advance(DAY_MS);
  assert.ok(w.lineMoney() > 0);
  assert.equal((await w.h.call('POST', `/api/v1/lines/${w.lineId}/resolve`, { token: w.tok, body: { option: 'pause' } })).body.status, 'paused');
});

test('lines belong to their company: another player gets 404 on every line route, and cannot read the network of a human rival', async () => {
  const w = await world();
  const bob = await w.h.register('bob', 'LFPG');
  for (const [m, url] of [['GET', ''], ['PATCH', ''], ['DELETE', ''], ['POST', '/pause'], ['GET', '/problem']] as const) {
    assert.equal((await w.h.call(m, `/api/v1/lines/${w.lineId}${url}`, { token: bob.token, body: m === 'PATCH' ? { freqPerDay: 2 } : undefined })).status, 404, `${m} ${url}`);
  }
  const bobsNet = (await w.h.call('GET', '/api/v1/network', { token: bob.token })).body as NetworkView;
  assert.deepEqual(bobsNet.lines, []);
  assert.equal((await w.h.call('GET', `/api/v1/network?company=${w.cid}`, { token: bob.token })).status, 404);
  assert.equal((await w.h.call('GET', '/api/v1/lines/abc', { token: w.tok })).status, 404);
});

test('the operations board lists what flies, what leaves next and why a leg was cancelled', async () => {
  const w = await world();
  run(w.h.db, "UPDATE aircraft SET status = 'maintenance', maintenance_until = ? WHERE id = ?", T0 + 3 * DAY_MS, w.ac);
  await w.advance(4 * HOUR); // 16:00 on the day
  const ops = (await w.get('/api/v1/ops')).body;
  assert.equal(ops.enabled, true);
  const cancelled = ops.upcoming.filter((r: { status: string }) => r.status === 'cancelled');
  assert.ok(cancelled.length > 0 && cancelled.every((r: { note: string; cancelCause: string; reg: string; typeName: string }) => r.note === 'aircraft unavailable' && r.cancelCause === 'aircraft_unavailable' && r.reg === 'F-HAZB' && r.typeName.length > 0));
  assert.equal(ops.counts.cancelled, cancelled.length);
  assert.match(cancelled[0].flightNo, /^AMY? ?\d+$|^[A-Z]{3} 11\d\d$/);
});

// ---------------------------------------------------------------- competition and AI networks

test('a rival on the same pair shares the demand by seats, shows in the forecast, and its network is public', async () => {
  const h = await harness({ ai: true });
  const u = await h.register('amy', 'EGLL');
  const cid = u.me.company.id as number;
  const mine = insertAircraft(h.db, { companyId: cid, icao: 'AT76', hub: 'EGLL', value: 1, ownership: 'owned', at: h.clock.t });
  const probe = { a: 'EGLL', b: 'EGPH', freqPerDay: 2, days: Array(7).fill(true), windowStart: '06:00', windowEnd: '18:00', aircraftIds: [mine] };
  const alone = (await h.call('POST', '/api/v1/lines/forecast', { token: u.token, body: probe })).body;
  assert.equal(alone.forecast.competition, null);

  const ai = get<{ id: number }>(h.db, "SELECT id FROM companies WHERE name = 'Aurora Airways'")!.id;
  const theirs = insertAircraft(h.db, { companyId: ai, icao: 'DH8D', hub: 'EGLL', value: 1, ownership: 'owned', at: h.clock.t });
  createLine(h.db, ai, { ...probe, freqPerDay: 3, aircraftIds: [theirs] }, h.clock.t);
  const shared = (await h.call('POST', '/api/v1/lines/forecast', { token: u.token, body: probe })).body;
  assert.deepEqual(shared.forecast.competition, { company: 'Aurora Airways', flightsPerDay: 3 });
  assert.ok(shared.forecast.loadFactor < alone.forecast.loadFactor, `${shared.forecast.loadFactor} < ${alone.forecast.loadFactor}`);

  const net = (await h.call('GET', `/api/v1/network?company=${ai}`, { token: u.token })).body as NetworkView;
  const shared_ = net.lines.find((l) => l.a === 'EGLL' && l.b === 'EGPH');
  assert.equal(shared_?.freqPerDay, 3, 'the rival\'s network lists its lines (it may have more than this one)');
  assert.ok(net.flying.every((f) => !f.own));
  assert.equal((await h.call('GET', '/api/v1/network?company=999999', { token: u.token })).status, 404);
});

test('seedAi stays idempotent with the line engine installed', async () => {
  const db = openDb(':memory:');
  seedAi(db, T0);
  seedAi(db, T0 + 1000);
  assert.equal(lineTickOf(T0) * LINE_TICK_MS <= T0, true);
  assert.equal(catchUpLines(db, T0), 1, 'no lines: the clock just remembers where it is');
  assert.equal(catchUpLines(db, T0 + 6 * HOUR), 1);
  assert.ok(fuelPriceFactor('LFPG', T0) > 0);
});

test('AI companies fly their bought aircraft on lines through the same engine; their other aircraft keep taking board jobs', async () => {
  const { runTick, tickOf, TICK_MS } = await import('./ai.ts');
  const db = openDb(':memory:');
  seedAi(db, T0);
  for (let t = tickOf(T0) - 8; t <= tickOf(T0) + 24; t++) { runTick(db, t); catchUpLines(db, (t + 1) * TICK_MS - 1); }
  const lines = all<{ company_id: number; a: string; b: string; freq_per_day: number }>(db, 'SELECT * FROM lines');
  assert.ok(lines.length >= 4, `${lines.length} AI lines`);
  for (const l of lines) assert.ok(l.a < l.b);
  const flown = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM scheduled_flights WHERE status = 'done'")!.n;
  assert.ok(flown > 0, 'AI lines flew');
  const money = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM transactions WHERE kind = 'line_revenue'")!.n;
  assert.ok(money > 0);
  // an aircraft on a line is never given a board job: no active or finished flight row belongs to it
  const onLine = all<{ aircraft_id: number }>(db, 'SELECT aircraft_id FROM line_aircraft').map((r) => r.aircraft_id);
  assert.ok(onLine.length > 0);
  assert.equal(all(db, `SELECT 1 FROM flights WHERE aircraft_id IN (${onLine.join(',')})`).length, 0);
  assert.ok(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM flights')!.n > 0, 'while the starter aircraft still fly jobs');
});

test('the two French rivals exist so a player\'s French pair has competition (C15)', async () => {
  const db = openDb(':memory:');
  seedAi(db, T0);
  const rows = all<{ name: string; hub: string }>(db, "SELECT c.name, h.icao AS hub FROM companies c JOIN hubs h ON h.company_id = c.id WHERE c.name IN ('Alpes Air Link', 'Méridia Cargo') ORDER BY c.name");
  assert.deepEqual(rows.map((r) => [r.name, r.hub]), [['Alpes Air Link', 'LFML'], ['Méridia Cargo', 'LFLL']]);
});

test('deleting the account removes its lines, timetable and private line jobs with it', async () => {
  const w = await world();
  const day = (await w.get(`/api/v1/lines/${w.lineId}`)).body.day as ScheduledFlight[];
  await w.h.call('POST', `/api/v1/lines/${w.lineId}/rotations/${day.find((l) => l.status === 'scheduled')!.id}/take`, { token: w.tok });
  await w.advance(DAY_MS);
  const del = await w.h.call('DELETE', '/api/v1/me', { token: w.tok, body: { password: 'correct horse' } });
  assert.equal(del.status, 204, del.text);
  for (const t of ['lines', 'line_aircraft', 'scheduled_flights', 'line_networks', 'custom_jobs']) assert.equal(get<{ n: number }>(w.h.db, `SELECT COUNT(*) AS n FROM ${t}`)!.n, 0, t);
});

test('presence comes from the owner\'s session or bridge API key, not from anonymous requests', async () => {
  const w = await world();
  const key = await w.h.apiKey(w.tok);
  const seen = () => get<{ s: number }>(w.h.db, 'SELECT seen_at AS s FROM line_networks WHERE company_id = ?', w.cid)!.s;
  const t0 = seen();
  w.h.clock.t += 10 * DAY_MS;
  await w.h.call('GET', '/api/v1/leaderboard');
  assert.equal(seen(), t0, 'a public request proves nothing');
  await w.h.call('GET', '/api/v1/flights/active', { token: key });
  assert.equal(seen(), w.h.clock.t, 'the bridge key refreshes presence');
  w.h.clock.t += 10 * DAY_MS;
  await w.h.call('GET', '/api/v1/flights/active', { token: key });
  assert.equal(((await w.get('/api/v1/network')).body as NetworkView).lapsedAt, null, 'ten days after the last sign of life is within the cap');
});
