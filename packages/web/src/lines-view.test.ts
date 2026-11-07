import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FlyingNow, Line, Network, OpsRow, ScheduledFlight } from './api-lines.ts';
import {
  asProgramme, causesOf, clockNow, dayKind, draftProblem, everyHours, faceToFace, filterOps, firstAlert, ganttLanes, hhmm, isoDay, lineDelay, lineVisual, mapAirportCodes, mapFlights, mapLines,
  minuteOfDay, minutesOf, nextFilter, opsBadge, pairId, meterFraction, rivalOrder, sinceToday, phaseOf, perHour, freqFromPerHour, windowHours, isRoundTheClock, ROUND_THE_CLOCK, previewProgramme, pnlParts, progressPct, projectionKind, reopenTarget, stepDay, DEFAULT_DRAFT, forecastShare, candidateAircraft,
} from './lines-view.ts';

const line = (o: Partial<Line> = {}): Line => ({
  id: 1, a: 'LFLL', b: 'LFMN', status: 'active', distanceNm: 153, blockMinutes: 75, freqPerDay: 4, days: [true, true, true, true, true, false, false], windowStart: '06:00', windowEnd: '22:00', turnaroundMin: 40,
  flightNos: [1131, 1138], aircraft: [{ id: 7, registration: 'F-HAZA', icao: 'AT76' }], interruptedSince: null, interruptCause: null, ...o,
});
const flying = (o: Partial<FlyingNow> = {}): FlyingNow => ({ flightId: 1, flightNo: 'AZR 1136', lineId: 1, from: 'LFLL', to: 'LFMN', progress: 0.82, delayMin: 0, reg: 'F-HAZA', own: false, ...o });
const net = (o: Partial<Network> = {}): Network => ({ now: 0, enabled: true, lines: [line()], flying: [], today: { done: 0, cancelled: 0, onTimePct: 100, nextDeparture: null }, ...o });
const T0 = Date.parse('2026-11-06T00:00:00Z');
const leg = (o: Partial<ScheduledFlight> = {}): ScheduledFlight => ({
  id: 1, lineId: 1, flightNo: 'AZR 1131', dep: T0 + 6 * 3_600_000, arr: T0 + 7.25 * 3_600_000, origin: 'LFMN', dest: 'LFLL', aircraftId: 7, status: 'scheduled', delayMin: 0, cancelCause: null, pax: null, takenByPlayer: false, ...o,
});

test('a line is delayed only while one of its aircraft is late, and interrupted or paused win over that', () => {
  assert.equal(lineVisual(line(), []), 'ok');
  assert.equal(lineVisual(line(), [flying({ delayMin: 14 })]), 'delayed');
  assert.equal(lineVisual(line(), [flying({ delayMin: 14, lineId: 2 })]), 'ok');
  assert.equal(lineVisual(line({ status: 'interrupted' }), [flying({ delayMin: 14 })]), 'interrupted');
  assert.equal(lineVisual(line({ status: 'paused' }), []), 'paused');
  assert.equal(lineDelay(line(), [flying({ delayMin: 14 }), flying({ delayMin: 20 })]), 20);
  assert.equal(lineDelay(line(), []), 0);
});

test('departure spacing is the window shared by the day\'s departures', () => {
  assert.equal(everyHours({ freqPerDay: 8, windowStart: '06:00', windowEnd: '22:00' }), 2);
  assert.equal(everyHours({ freqPerDay: 1, windowStart: '06:00', windowEnd: '22:00' }), 16);
  assert.equal(everyHours({ freqPerDay: 100, windowStart: '06:00', windowEnd: '07:00' }), 1);
});

test('own network: lines keep their state; the rival view dims them and marks shared pairs as contested', () => {
  const own = net({ lines: [line(), line({ id: 2, a: 'LFLL', b: 'LFML', status: 'interrupted' })] });
  assert.deepEqual(mapLines(own, null).map((l) => [l.id, l.owner, l.state, l.dim ?? false]), [['LFLL-LFMN', 'player', 'ok', false], ['LFLL-LFML', 'player', 'interrupted', false]]);
  const rival = net({ lines: [line({ id: 9, a: 'LFLL', b: 'LFMN' }), line({ id: 10, a: 'LFML', b: 'LIMC' })] });
  const both = mapLines(own, rival);
  assert.equal(both.length, 4);
  assert.ok(both.filter((l) => l.owner === 'player').every((l) => l.dim));
  assert.deepEqual(both.filter((l) => l.owner === 'rival').map((l) => [l.id, l.contested ?? false]), [['LFLL-LFMN', true], ['LFML-LIMC', false]]);
});

test('flights: the player\'s own is `me`, a rival view shows only the rival\'s aircraft, a delay becomes a tag', () => {
  const own = net({ flying: [flying({ delayMin: 14 }), flying({ flightId: 2, reg: 'F-HAZR', lineId: null, own: true })] });
  const f = mapFlights(own, null, (x) => x.flightNo);
  assert.deepEqual(f.map((x) => [x.reg, x.owner, x.line, x.late]), [['F-HAZA', 'player', 'LFLL-LFMN', '+14 min'], ['F-HAZR', 'me', null, undefined]]);
  const rival = net({ lines: [line({ id: 5, a: 'LFML', b: 'LIMC' })], flying: [flying({ lineId: 5, from: 'LFML', to: 'LIMC', reg: 'F-HMRC' })] });
  assert.deepEqual(mapFlights(own, rival, () => '').map((x) => [x.reg, x.owner, x.line]), [['F-HMRC', 'rival', 'LFML-LIMC']]);
});

test('the map asks for every airport a line, a flight or a hub touches, once', () => {
  const own = net({ flying: [flying({ from: 'LFPG', to: 'LFMN', lineId: null })] });
  assert.deepEqual(mapAirportCodes(own, null, ['LFMN']).sort(), ['LFLL', 'LFMN', 'LFPG']);
  const rival = net({ lines: [line({ a: 'LFML', b: 'LIMC' })] });
  assert.deepEqual(mapAirportCodes(own, rival, []).sort(), ['LFLL', 'LFML', 'LFMN', 'LFPG', 'LIMC']);
});

test('face to face: shared pairs, the rival\'s own lines, and which shared line to reopen', () => {
  const mine = [line({ id: 1, a: 'LFMN', b: 'LFPG' }), line({ id: 2, a: 'LFLL', b: 'LFML', status: 'interrupted' })];
  const theirs = [line({ id: 8, a: 'LFLL', b: 'LFML' }), line({ id: 9, a: 'LFMN', b: 'LFPG' }), line({ id: 10, a: 'LFML', b: 'LEBL' })];
  const { shared, alone } = faceToFace(mine, theirs);
  assert.deepEqual(shared.map((s) => s.pair), ['LFLL-LFML', 'LFMN-LFPG']);
  assert.deepEqual(alone.map((l) => pairId(l)), ['LEBL-LFML']);
  assert.equal(pairId({ a: 'LFMN', b: 'LFLL' }), pairId({ a: 'LFLL', b: 'LFMN' }));
  assert.equal(reopenTarget(shared)?.own.id, 2);
  assert.equal(reopenTarget(shared.filter((s) => s.own.id === 1)), null);
});

test('clock helpers: HH:MM, ISO day, minute of the UTC day, and a clock that keeps running between polls', () => {
  assert.equal(minutesOf('06:30'), 390);
  assert.equal(hhmm(390), '06:30');
  assert.equal(hhmm(1440 + 30), '00:30');
  assert.equal(isoDay(Date.parse('2026-11-06T23:59:59Z')), '2026-11-06');
  assert.equal(minuteOfDay(Date.parse('2026-11-06T17:58:30Z')), 17 * 60 + 58);
  assert.equal(clockNow(1000, 5000, 7500), 3500);
  assert.equal(clockNow(1000, 5000, 4000), 1000);
});

test('the week strip: arrows stop at its ends and days are past, today or future', () => {
  const week = ['2026-11-02', '2026-11-03', '2026-11-04'].map((date) => ({ date }));
  assert.equal(stepDay(week, '2026-11-03', 1), '2026-11-04');
  assert.equal(stepDay(week, '2026-11-04', 1), '2026-11-04');
  assert.equal(stepDay(week, '2026-11-02', -1), '2026-11-02');
  assert.equal(stepDay(week, 'nope', 1), '2026-11-02');
  assert.equal(dayKind('2026-11-02', '2026-11-03'), 'past');
  assert.equal(dayKind('2026-11-03', '2026-11-03'), 'today');
  assert.equal(dayKind('2026-11-04', '2026-11-03'), 'future');
});

test('gantt: one lane per aircraft with positions in percent of 24 h, flights cut at midnight, number without the company code', () => {
  const flights = [
    leg(),
    leg({ id: 2, flightNo: 'AZR 1132', dep: T0 + 7.25 * 3_600_000 + 40 * 60_000, arr: T0 + 9.5 * 3_600_000, status: 'delayed', delayMin: 10 }),
    leg({ id: 3, flightNo: 'AZR 1133', aircraftId: 8, dep: T0 - 3_600_000, arr: T0 + 3_600_000, status: 'done' }),
    leg({ id: 4, flightNo: 'AZR 1139', dep: T0 + 30 * 3_600_000, arr: T0 + 31 * 3_600_000 }),
  ];
  const lanes = ganttLanes(flights, [7, 8], '2026-11-06');
  assert.equal(lanes.length, 2);
  assert.deepEqual(lanes[0]!.segments.map((s) => [s.flightNo, s.left, s.kind]), [['1131', 25, 'scheduled'], ['1132', 33.68, 'delayed']]);
  assert.equal(lanes[0]!.segments[0]!.width, 5.21);
  assert.equal(lanes[0]!.rotations, 1);
  assert.equal(lanes[1]!.segments[0]!.left, 0);
  assert.equal(lanes[1]!.segments[0]!.width, 4.17);
});

test('gantt: a delayed flight leaves late: a warning bar from the planned departure, the flight drawn after it', () => {
  const late = ganttLanes([leg({ status: 'delayed', delayMin: 36 })], [7], '2026-11-06')[0]!.segments[0]!;
  assert.equal(late.delayLeft, 25);
  assert.equal(late.delay, 2.5);
  assert.equal(late.left, 27.5);
  assert.equal(late.width, 5.21);
  const cancelled = ganttLanes([leg({ status: 'cancelled', delayMin: 36 })], [7], '2026-11-06')[0]!.segments[0]!;
  assert.equal(cancelled.delay, 0);
  assert.equal(cancelled.left, 25);
  assert.equal(ganttLanes([leg()], [7], '2026-11-06')[0]!.segments[0]!.delay, 0);
});

test('dependency meters: filled from a percentage or an a-of-b text, none for anything else', () => {
  assert.equal(meterFraction('84 %'), 0.84);
  assert.equal(meterFraction('84,5 %'), 0.845);
  assert.equal(meterFraction('140 %'), 1);
  assert.equal(meterFraction('4 sur 4'), 1);
  assert.equal(meterFraction('3 of 4'), 0.75);
  assert.equal(meterFraction('0 of 0'), null);
  assert.equal(meterFraction('9 h 13 / 13 h'), null);
  assert.equal(meterFraction('ok'), null);
});

test('rival networks: the ones that share pairs with the player come first, then by name', () => {
  const own = [{ a: 'LFMN', b: 'LFPG' }, { a: 'LFLL', b: 'LFML' }];
  const rivals = [
    { name: 'Zeta', lines: [{ a: 'LFML', b: 'LEBL' }] }, { name: 'Alpha', lines: [{ a: 'LFML', b: 'LEBL' }] },
    { name: 'Meridia', lines: [{ a: 'LFMN', b: 'LFPG' }, { a: 'LFLL', b: 'LFML' }] }, { name: 'Link', lines: [{ a: 'LFMN', b: 'LFPG' }] },
  ];
  assert.deepEqual(rivalOrder(own, rivals).map((r) => r.name), ['Meridia', 'Link', 'Alpha', 'Zeta']);
});

test('"since" shows the date only when it was not today', () => {
  const now = Date.parse('2026-11-06T04:50:00Z');
  assert.ok(sinceToday(Date.parse('2026-11-06T01:00:00Z'), now));
  assert.ok(!sinceToday(Date.parse('2026-11-05T14:00:00Z'), now));
});

test('the day\'s bar splits costs and margin as shares of the whole; a loss shows costs only', () => {
  const parts = pnlParts({ fuel: 2936, fees: 4052, crews: 1430, maintenance: 2816, margin: 22222 });
  assert.equal(parts.length, 5);
  assert.equal(Math.round(parts.reduce((s, p) => s + p.share, 0)), 100);
  assert.deepEqual(parts.map((p) => p.part), ['fuel', 'fees', 'crews', 'maintenance', 'margin']);
  const loss = pnlParts({ fuel: 100, fees: 100, crews: 0, maintenance: 0, margin: -50 });
  assert.equal(loss.at(-1)!.share, 0);
  assert.equal(loss[0]!.share, 50);
  assert.ok(pnlParts({ fuel: 0, fees: 0, crews: 0, maintenance: 0, margin: 0 }).every((p) => p.share === 0));
});

test('a draft is creatable only with known airports, two different ends, an aircraft, a day, a real window and a sane frequency', () => {
  const ok = { ...DEFAULT_DRAFT, a: 'LFMN', b: 'LEBL', aircraftIds: [1] };
  const both = { a: true, b: true };
  assert.equal(draftProblem(ok, both), null);
  assert.equal(draftProblem(ok, { a: true, b: false }), 'airports');
  assert.equal(draftProblem({ ...ok, b: 'LFMN' }, both), 'same');
  assert.equal(draftProblem({ ...ok, aircraftIds: [] }, both), 'aircraft');
  assert.equal(draftProblem({ ...ok, days: [false, false, false, false, false, false, false] }, both), 'days');
  assert.equal(draftProblem({ ...ok, windowStart: '22:00', windowEnd: '06:00' }, both), 'window');
  assert.equal(draftProblem({ ...ok, freqPerDay: 0 }, both), 'freq');
  assert.equal(draftProblem({ ...ok, freqPerDay: 99 }, both), 'freq');
  assert.deepEqual(asProgramme(ok), { a: 'LFMN', b: 'LEBL', freqPerDay: 4, days: ok.days, windowStart: '06:00', windowEnd: '22:00', aircraftIds: [1] });
});

test('programme preview: departures spread over the window, returns after block + turnaround, aircraft take turns, weekly totals follow the days', () => {
  const p = previewProgramme({ freqPerDay: 7, days: [true, true, true, true, true, true, false], windowStart: '06:00', windowEnd: '22:00', aircraftIds: [1, 2] }, 80, 40);
  assert.equal(p.fromA.length, 7);
  assert.equal(p.fromA[0], 360);
  assert.equal(p.fromB[0], 360 + 80 + 40);
  assert.deepEqual(p.lanes.map((l) => l.blocks.length), [8, 6]);
  assert.equal(p.roundTripsPerWeek, 42);
  assert.equal(p.weekHours, 112);
  const spread = p.fromA.at(-1)! + 2 * 80 + 40;
  assert.ok(spread <= 22 * 60, 'the last rotation is back before the window closes');
});

test('programme preview: one round trip leaves at the start; no aircraft means no lanes; a clash marks the block', () => {
  const one = previewProgramme({ freqPerDay: 1, days: [true, false, false, false, false, false, false], windowStart: '08:00', windowEnd: '20:00', aircraftIds: [3] }, 60, 30);
  assert.deepEqual(one.fromA, [480]);
  assert.equal(one.roundTripsPerWeek, 1);
  assert.equal(previewProgramme({ freqPerDay: 3, days: [true, true, true, true, true, true, true], windowStart: '06:00', windowEnd: '22:00', aircraftIds: [] }, 60, 30).lanes.length, 0);
  const at = Date.parse('2026-11-06T08:30:00Z');
  const clash = previewProgramme({ freqPerDay: 1, days: [true, true, true, true, true, true, true], windowStart: '08:00', windowEnd: '20:00', aircraftIds: [3] }, 60, 30, [{ aircraftId: 3, at }]);
  assert.deepEqual(clash.lanes[0]!.blocks.map((b) => b.conflict), [true, false]);
});

test('aircraft for a new line: the workshop ones are left out, those standing at A come first, then idle before busy', () => {
  const fleet = [
    { id: 1, location: 'LFLL', busy: false, status: 'available' }, { id: 2, location: 'LFMN', busy: true, status: 'flying' },
    { id: 3, location: 'LFMN', busy: false, status: 'available' }, { id: 4, location: 'LFMN', busy: false, status: 'maintenance' },
  ];
  assert.deepEqual(candidateAircraft(fleet, 'LFMN').map((a) => a.id), [3, 2, 1]);
});

test('forecast bar: costs and margin as shares of the larger of revenue and costs', () => {
  assert.deepEqual(forecastShare({ revenue: 418_900, costs: 352_400 }), { costs: 84, margin: 16 });
  assert.deepEqual(forecastShare({ revenue: 100, costs: 200 }), { costs: 100, margin: 0 });
});

test('interrupted: one or two causes; the projection shows a cancelled day as such', () => {
  assert.deepEqual(causesOf({ interruptCause: 'both' }), ['aircraft', 'crew']);
  assert.deepEqual(causesOf({ interruptCause: 'crew' }), ['crew']);
  assert.deepEqual(causesOf({ interruptCause: null }), []);
  assert.equal(projectionKind('cancelled'), 'cancelled');
  assert.equal(projectionKind('2 A/R · ATR'), 'flying');
});

const row = (o: Partial<OpsRow> = {}): OpsRow => ({ ...leg(), reg: 'F-HAZA', typeName: 'ATR 72-600', crew: null, note: null, own: false, ...o });

test('ops board: badges, filters and the alert Enter treats', () => {
  const rows = [row({ id: 1 }), row({ id: 2, status: 'delayed', delayMin: 20 }), row({ id: 3, status: 'cancelled', cancelCause: 'no_crew' }), row({ id: 4, own: true, status: 'flying' })];
  assert.deepEqual(rows.map(opsBadge), ['ontime', 'delayed', 'cancelled', 'mine']);
  assert.deepEqual(filterOps(rows, 'all').map((r) => r.id), [1, 2, 3, 4]);
  assert.deepEqual(filterOps(rows, 'delayed').map((r) => r.id), [2]);
  assert.deepEqual(filterOps(rows, 'cancelled').map((r) => r.id), [3]);
  assert.deepEqual(filterOps(rows, 'mine').map((r) => r.id), [4]);
  assert.equal(firstAlert(rows)?.id, 3);
  assert.equal(firstAlert(rows.slice(0, 2)), null);
  assert.equal(nextFilter('all'), 'delayed');
  assert.equal(nextFilter('mine'), 'all');
});

test('progress along a flight is clamped to 0-100', () => {
  const f = { dep: 1000, arr: 3000 };
  assert.equal(progressPct(f, 500), 0);
  assert.equal(progressPct(f, 2000), 50);
  assert.equal(progressPct(f, 9000), 100);
  assert.equal(progressPct({ ...f, delayMin: 1 }, 1000 + 60_000 + 1000), 50, 'a late flight has flown less at the same instant');
  assert.equal(progressPct({ ...f, delayMin: 1 }, 1000 + 30_000), 0, 'and has not left yet');
});

test('frequency per hour: round trips per hour of the window, converted both ways and capped', () => {
  const w = { windowStart: '06:00', windowEnd: '22:00' };
  assert.equal(windowHours(w), 16);
  assert.equal(perHour({ ...w, freqPerDay: 16 }), 1);
  assert.equal(perHour({ ...w, freqPerDay: 7 }), 1, 'never below one per hour');
  assert.equal(freqFromPerHour(1, w), 16);
  assert.equal(freqFromPerHour(2, w), 24, 'capped at the maximum');
  assert.equal(windowHours({ windowStart: '10:00', windowEnd: '10:00' }), 1);
  assert.ok(isRoundTheClock(ROUND_THE_CLOCK));
  assert.ok(!isRoundTheClock(w));
});

test('flight phase follows the progress', () => {
  assert.deepEqual([0, 0.1, 0.4, 0.8, 0.82, 1].map(phaseOf), ['climb', 'climb', 'cruise', 'cruise', 'descent', 'descent']);
});
