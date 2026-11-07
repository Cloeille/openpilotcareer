import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Arrival, Blocker, DutyBlock, FamilyRow, LeaveRequest, PolicyOption } from './api-staff.ts';
import { translate, translatePlural } from './i18n.ts';
import {
  absentOn, availabilitySegments, blockerOf, chartDay, dayBars, dayColumns, defaultExpanded, defaultRow, dutyDays, dutyFacts, dutyPeriods, emptyRows, firstProblem, ganttOf, interimPrice, keepSelection, limitMeters,
  loadMeter, nextArrival, meanSalary, medicalState, membersOf, monthSpan, monthsSince, moraleLevel, moveCell, pendingRequests, plannedHours, policyPreview, presetFor, requestImpact, rowBadge, service7dMin, shortDays,
  startsAt, stepMember, toggleAll, trainingOffers, unblocks, visibleRows, worst,
} from './staff-view.ts';

const avail = (o: Partial<FamilyRow['availability']> = {}): FamilyRow['availability'] => ({ onDuty: 0, resting: 0, leave: 0, training: 0, free: 0, pending: 0, vacant: 0, ...o });
const row = (o: Partial<FamilyRow> = {}): FamilyRow => ({ family: 'pilot', label: 'Pilotes', headcount: 8, need: 8, availability: avail({ onDuty: 8 }), arriving: [], salaries: 59_400, note: null, ...o });
const atr = row({ type: 'AT76', label: 'ATR 72', headcount: 13, need: 14, note: 'Lefèvre · 12 h 10 sur 13 h', members: [{ id: 1, name: 'Perrin', role: 'captain' }, { id: 2, name: 'Lefèvre', role: 'fo' }] });
const a220 = row({ type: 'BCS3', label: 'A220', members: [{ id: 3, name: 'Vidal', role: 'captain' }] });
const crj = row({ type: 'CRJ7', label: 'CRJ', headcount: 2, need: 4, availability: avail({ resting: 1, leave: 1, vacant: 2 }) });
const pilots = row({ label: 'Pilotes', headcount: 23, need: 26, children: [atr, a220, crj] });
const cabin = row({ family: 'cabin', label: 'Personnel de cabine', headcount: 18, need: 18 });
const ground = row({ family: 'ground', label: 'Personnel au sol', headcount: 14, need: 16 });
const crjBlock: Blocker = { kind: 'no_crew', family: 'pilot', type: 'CRJ7', flights: 2 };

test('a row is blocked by its own blocker; the family by any blocker of its types; other types are not', () => {
  assert.equal(blockerOf([crjBlock], crj), crjBlock);
  assert.equal(blockerOf([crjBlock], pilots), crjBlock);
  assert.equal(blockerOf([crjBlock], atr), null);
  assert.equal(blockerOf([crjBlock], cabin), null);
});

test('row badge: blocker, then the server note, then a missing head, then complete', () => {
  assert.deepEqual(rowBadge(pilots, [crjBlock]), { tone: 'bad', kind: 'blocks', flights: 2 });
  assert.deepEqual(rowBadge(crj, [crjBlock]), { tone: 'bad', kind: 'none' });
  assert.deepEqual(rowBadge(crj, [{ ...crjBlock, kind: 'duty_limit' }]), { tone: 'bad', kind: 'blocks', flights: 2 });
  assert.deepEqual(rowBadge(atr, [crjBlock]), { tone: 'warn', kind: 'note', note: 'Lefèvre · 12 h 10 sur 13 h' });
  assert.deepEqual(rowBadge(ground, []), { tone: 'warn', kind: 'missing', n: 2 });
  assert.deepEqual(rowBadge(cabin, []), { tone: 'ok', kind: 'complete' });
});

test('visible rows: types appear only under an expanded family; the arrows walk this list', () => {
  const closed = visibleRows([pilots, cabin], new Set());
  assert.deepEqual(closed.map((r) => r.key), ['pilot', 'cabin']);
  assert.equal(closed[0]!.expandable, true);
  assert.equal(closed[1]!.expandable, false);
  const open = visibleRows([pilots, cabin], new Set(['pilot']));
  assert.deepEqual(open.map((r) => `${r.depth}:${r.key}`), ['0:pilot', '1:pilot:AT76', '1:pilot:BCS3', '1:pilot:CRJ7', '0:cabin']);
  assert.equal(open[0]!.expanded, true);
});

test('families that need attention open on arrival; "Tout dérouler" opens all, then closes all', () => {
  assert.deepEqual([...defaultExpanded([pilots, cabin], [crjBlock])], ['pilot']);
  assert.deepEqual([...defaultExpanded([row({ children: [a220] }), cabin], [])], []);
  assert.deepEqual([...toggleAll([pilots, cabin], new Set())], ['pilot']);
  assert.deepEqual([...toggleAll([pilots, cabin], new Set(['pilot']))], []);
});

test('the availability bar has one segment per state that has people', () => {
  assert.deepEqual(availabilitySegments(avail({ onDuty: 8, free: 2, resting: 9, leave: 4, training: 2 })).map((s) => `${s.kind}:${s.count}`), ['duty:8', 'free:2', 'rest:9', 'leave:4', 'training:2']);
  assert.deepEqual(availabilitySegments(avail()), []);
});

const arrival = (id: number, startsAt: number, role: Arrival['role'] = 'captain'): Arrival => ({ id, name: `Pilote ${id}`, role, startsAt });
const NOV_14 = Date.UTC(2026, 10, 14, 12), NOV_16 = Date.UTC(2026, 10, 16, 12);
/** Chloé's live pilots row: 12 posts, nobody working yet, 10 hires in notice. */
const hired = row({ headcount: 0, need: 12, availability: avail({ pending: 10, vacant: 2 }), arriving: Array.from({ length: 10 }, (_, i) => arrival(i + 1, i < 9 ? NOV_14 : NOV_16)), note: '2 vacant' });

test('the availability bar shows hires in notice as their own segment, between the working states and the vacant posts', () => {
  assert.deepEqual(availabilitySegments(hired.availability).map((s) => `${s.kind}:${s.count}`), ['pending:10', 'vacant:2']);
  assert.deepEqual(availabilitySegments(avail({ onDuty: 3, free: 1, pending: 4, vacant: 2 })).map((s) => `${s.kind}:${s.count}`), ['duty:3', 'free:1', 'pending:4', 'vacant:2']);
});

test('a row whose missing people are all in notice is complete on the day the last one needed starts; one still short stays missing', () => {
  assert.deepEqual(rowBadge(row({ headcount: 0, need: 10, availability: avail({ pending: 10 }), arriving: hired.arriving }), []), { tone: 'warn', kind: 'arriving', at: NOV_16 });
  assert.deepEqual(rowBadge(row({ headcount: 8, need: 9, availability: avail({ onDuty: 8, pending: 2 }), arriving: [arrival(1, NOV_14), arrival(2, NOV_16)] }), []), { tone: 'warn', kind: 'arriving', at: NOV_14 }, 'one is enough: the second is a spare');
  assert.deepEqual(rowBadge(row({ headcount: 0, need: 12, availability: avail({ pending: 10, vacant: 2 }), arriving: hired.arriving, note: '2 vacant' }), []), { tone: 'warn', kind: 'note', note: '2 vacant' });
  assert.deepEqual(rowBadge(row({ headcount: 0, need: 12, availability: avail({ pending: 10, vacant: 2 }), arriving: hired.arriving }), []), { tone: 'warn', kind: 'missing', n: 2 });
  assert.deepEqual(rowBadge(row({ headcount: 8, need: 8, availability: avail({ onDuty: 8, pending: 1 }), arriving: [arrival(1, NOV_14)] }), []), { tone: 'ok', kind: 'complete' }, 'a spare changes nothing');
});

test('the next arrival is the earliest start over the families, null when nobody is in notice', () => {
  assert.equal(nextArrival([hired, row({ family: 'cabin', arriving: [arrival(30, NOV_14 - 86_400_000, 'attendant')] })]), NOV_14 - 86_400_000);
  assert.equal(nextArrival([row(), cabin]), null);
});

test('the notice labels read in both languages', () => {
  const day = '14 nov.';
  assert.equal(translate('fr', 'st.arrives', { date: day }), 'Arrive le 14 nov.');
  assert.equal(translate('en', 'st.arrives', { date: day }), 'Arrives 14 nov.');
  assert.equal(translate('fr', 'st.have.arriving', { n: 10 }), '+10 en préavis');
  assert.equal(translate('fr', 'st.avail.pending', { n: 10 }), '10 en préavis');
  assert.equal(translate('fr', 'st.b.arriving', { date: day }), 'Complet le 14 nov.');
  assert.equal(translatePlural('fr', 'st.ov.arriving', 18, { date: day }), '18 recrues en préavis, arrivent dès le 14 nov.');
  assert.equal(translatePlural('en', 'st.ov.arriving', 1, { date: day }), '1 hire in notice, arriving 14 nov.');
});

test('the side panel opens on the type that blocks, else the family that does, else the first row', () => {
  const rows = visibleRows([pilots, cabin], new Set(['pilot']));
  assert.equal(defaultRow(rows, [crjBlock]), 'pilot:CRJ7');
  assert.equal(defaultRow(visibleRows([pilots, cabin], new Set()), [crjBlock]), 'pilot');
  assert.equal(defaultRow(rows, []), 'pilot');
  assert.equal(defaultRow([], []), null);
});

test('the recruit key opens the family of the row, with the type of a pilot row or of the blocker', () => {
  assert.deepEqual(presetFor(crj, null), { family: 'pilot', qual: 'CRJ7' });
  assert.deepEqual(presetFor(cabin, null), { family: 'cabin', qual: null });
  assert.deepEqual(presetFor(null, crjBlock), { family: 'pilot', qual: 'CRJ7' });
  assert.deepEqual(presetFor(null, null), { family: 'pilot', qual: null });
});

test('members are listed in the overview order and the sheet steps through them, stopping at the ends', () => {
  const list = membersOf({ families: [pilots, cabin] });
  assert.deepEqual(list.map((m) => m.id), [1, 2, 3]);
  assert.equal(stepMember(list, 1, 1)?.id, 2);
  assert.equal(stepMember(list, 3, 1), null);
  assert.equal(stepMember(list, 1, -1), null);
  assert.equal(stepMember(list, 99, 1), null);
  assert.deepEqual(membersOf({ families: [cabin] }), []);
});

test('load meters: amber from 85 % of the limit, red past it, clamped', () => {
  assert.deepEqual(loadMeter(74, 100), { fraction: 0.74, tone: 'ok' });
  assert.equal(loadMeter(46, 60).tone, 'ok');
  assert.equal(loadMeter(812, 900).tone, 'warn');
  assert.equal(loadMeter(11.2, 13).tone, 'warn');
  assert.deepEqual(loadMeter(14, 13), { fraction: 1, tone: 'bad' });
  assert.deepEqual(loadMeter(5, 0), { fraction: 0, tone: 'bad' });
});

test('the sheet\'s three limit bars use the duty limits of B.3', () => {
  const m = limitMeters({ flight28d: 74 * 60, flight12m: 812 * 60 }, 46 * 60);
  assert.deepEqual(m.map((x) => [x.key, x.limitMin / 60, x.tone]), [['28', 100, 'ok'], ['7', 60, 'ok'], ['12', 900, 'warn']]);
  assert.equal(service7dMin([{ hours: 8 }, { hours: null }, { hours: 10.5 }]), 1110);
});

test('morale words, hiring start and the flights a hire unblocks come from numbers; nothing is invented', () => {
  assert.deepEqual([90, 75, 74, 50, 49].map(moraleLevel), ['high', 'high', 'medium', 'medium', 'low']);
  assert.equal(startsAt(0, { noticeDays: 7 }), 7 * 86_400_000);
  assert.equal(keepSelection([{ id: 'a' }, { id: 'b' }], 'b'), 'b');
  assert.equal(keepSelection([{ id: 'a' }, { id: 'b' }], 'zz'), 'a');
  assert.equal(keepSelection([], 'a'), null);
  assert.equal(unblocks([crjBlock], { family: 'pilot', qual: 'CRJ7' }), 2);
  assert.equal(unblocks([crjBlock], { family: 'pilot', qual: 'AT76' }), 0);
  assert.equal(unblocks([crjBlock], { family: 'cabin', qual: null }), 0);
  assert.equal(unblocks([{ ...crjBlock, family: 'cabin', type: 'AT76' }], { family: 'cabin', qual: null }), 2);
  assert.equal(unblocks([{ ...crjBlock, family: null }], { family: 'pilot', qual: 'CRJ7' }), 2, 'an unknown family is the pilots');
});

const H = 3_600_000;
const M = 60_000;
const D0 = Date.parse('2026-11-06T00:00:00Z');
const at = (h: number): number => D0 + h * H;
const leg = (no: string, from: number, to: number, o: Partial<DutyBlock> = {}): DutyBlock => ({ flightNo: no, dep: at(from), arr: at(to), origin: 'LFMN', dest: 'LFLL', ...o });
// The mockup's day: report 08:45Z, legs at 09:30-10:45, 11:15-12:30 (then a break), 15:20-16:35, 17:05-18:20, 19:00-20:15, 20:45-22:00 (limit 21:45).
const mockupDay: DutyBlock[] = [leg('AZR 1131', 9.5, 10.75), leg('AZR 1132', 11.25, 12.5), leg('AZR 1135', 15 + 1 / 3, 16.5833), leg('AZR 1136', 17.0833, 18.3333), leg('AZR 1137', 19, 20.25), leg('AZR 1138', 20.75, 22, { origin: 'LFLL', dest: 'LFMN' })];

test('duty periods: legs close together share one period that starts 45 min before the first departure', () => {
  const p = dutyPeriods(mockupDay, at(17.97), at(21.75));
  assert.equal(p.length, 1);
  assert.equal(p[0]!.start, at(8.75));
  assert.equal(p[0]!.limitAt, at(21.75));
  assert.deepEqual(p[0]!.blocks.map((b) => b.kind), ['brief', 'flight', 'flight', 'pause', 'flight', 'flight', 'flight', 'flight']);
  assert.deepEqual(p[0]!.blocks.filter((b) => b.kind === 'flight').map((b) => b.status), ['done', 'done', 'done', 'flying', 'planned', 'planned']);
});

test('duty periods: only the flight whose release passes the limit is over, from the limit itself', () => {
  const [p] = dutyPeriods(mockupDay, at(17.97), at(21.75));
  const over = p!.blocks.filter((b) => b.over);
  assert.deepEqual(over.map((b) => b.flightNo), ['AZR 1138']);
  assert.equal(over[0]!.over!.from, at(21.75));
  const [edge] = dutyPeriods([leg('AZR 9', 20, 21.6)], at(20.5), at(21.75));
  assert.equal(edge!.blocks.find((b) => b.kind === 'flight')!.over!.from, at(21.6), 'landing 9 min before the limit: breached by the release only, nothing flies past the limit');
});

test('duty periods: without a duty in progress the limit is 13 h after the report; a long gap starts another period', () => {
  const [p] = dutyPeriods([leg('A', 9, 10)], at(5), null);
  assert.equal(p!.limitAt, at(8.25) + 13 * H);
  const two = dutyPeriods([leg('A', 9, 10), leg('B', 17, 18)], at(5), null);
  assert.equal(two.length, 2);
  assert.deepEqual(dutyPeriods([], at(5), null), []);
});

test('duty facts: on duty only when the server says so and a period covers now; what is left counts the flight in progress', () => {
  const periods = dutyPeriods(mockupDay, at(17.97), at(21.75));
  const f = dutyFacts({ endsAt: at(21.75), dutyMin: Math.round(9.2167 * 60) }, periods, at(17.97));
  assert.equal(f.onDuty, true);
  assert.equal(f.limitAt, at(21.75));
  assert.equal(f.remaining.flights, 3);
  assert.equal(f.remaining.minutes, Math.round((18.3333 - 17.97) * 60 + 75 + 75));
  const off = dutyFacts({ endsAt: null, dutyMin: 0 }, periods, at(17.97));
  assert.deepEqual([off.onDuty, off.startedAt, off.limitAt, off.remaining.flights], [false, null, null, 0]);
});

test('duty chart: an even-hour axis around the blocks, bars in percent, the part past the limit apart', () => {
  const g = ganttOf(dutyPeriods(mockupDay, at(17.97), at(21.75)), at(17.97));
  assert.equal(g.startMs, at(8));
  assert.equal(g.endMs, at(22));
  assert.equal(g.ticks[0]!.label, '08:00');
  assert.equal(g.ticks.at(-1)!.label, '22:00');
  const brief = g.bars[0]!;
  assert.ok(Math.abs(brief.left - (0.75 / 14) * 100) < 1e-9);
  const last = g.bars.at(-1)!;
  assert.ok(last.over);
  assert.ok(Math.abs(last.over.left - ((21.75 - 8) / 14) * 100) < 1e-9);
  assert.ok(Math.abs(last.over.left + last.over.width - 100) < 1e-9);
  assert.ok(Math.abs(g.nowPct! - ((17.97 - 8) / 14) * 100) < 1e-9);
  assert.ok(Math.abs(g.limitPct! - ((21.75 - 8) / 14) * 100) < 1e-9);
  assert.deepEqual(ganttOf([], at(5)).bars, []);
});

test('the chart opens on today if it has duty, else the next duty day, else the last one', () => {
  const days = ['2026-11-05', '2026-11-07'];
  assert.equal(chartDay(['2026-11-05', '2026-11-06'], at(12)), '2026-11-06');
  assert.equal(chartDay(days, at(12)), '2026-11-07');
  assert.equal(chartDay(['2026-11-04', '2026-11-05'], at(12)), '2026-11-05');
  assert.equal(chartDay([], at(12)), null);
  assert.deepEqual(dutyDays(dutyPeriods(mockupDay, at(17), null)), ['2026-11-06']);
});

test('seven-day bars scale to the daily limit; a heavy closed day is amber, rest days have no height, planned hours stack on today', () => {
  const planned = plannedHours([leg('A', 17, 21)], at(17));
  assert.equal(planned.get('2026-11-06'), 4);
  const bars = dayBars([{ day: '2026-11-01', hours: null, kind: 'rest' }, { day: '2026-11-04', hours: 11.2, kind: 'duty' }, { day: '2026-11-06', hours: 9.2, kind: 'duty' }], planned, 13);
  assert.equal(bars[0]!.height, 0);
  assert.equal(bars[1]!.tone, 'warn');
  assert.ok(Math.abs(bars[2]!.plannedHeight - 4 / 13) < 1e-9);
  assert.equal(bars[2]!.tone, 'ok');
});

test('medical: amber under 30 days, red once lapsed; training offers are the fleet types not yet held, priced by category', () => {
  assert.equal(medicalState(23).tone, 'warn');
  assert.equal(medicalState(120).tone, 'ok');
  assert.equal(medicalState(-1).tone, 'bad');
  const fleet = [{ icao: 'AT76', name: 'ATR 72-600', category: 'turboprop-airliner' as const }, { icao: 'CRJ7', name: 'CRJ700', category: 'jet-airliner' as const }];
  assert.deepEqual(trainingOffers([{ type: 'AT76' }], fleet), [{ type: 'CRJ7', name: 'CRJ700', days: 21, cost: 24_000 }]);
  assert.deepEqual(trainingOffers([{ type: 'AT76' }, { type: 'CRJ7' }], fleet), []);
  assert.equal(monthsSince(Date.parse('2025-09-06T00:00:00Z'), Date.parse('2026-11-06T00:00:00Z')), 14);
});

test('calendar columns: weekday initial, day of month, weekends; the month span names both months once', () => {
  const cols = dayColumns('2026-11-06', 28, 'fr-FR');
  assert.equal(cols.length, 28);
  assert.deepEqual([cols[0]!.weekday, cols[0]!.date, cols[0]!.weekend], ['V', 6, false]);
  assert.deepEqual([cols[1]!.weekday, cols[1]!.weekend, cols[2]!.weekend], ['S', true, true]);
  assert.equal(cols[24]!.date, 30);
  assert.equal(cols[25]!.date, 1);
  assert.equal(monthSpan(cols, 'fr-FR'), 'novembre → décembre');
  assert.equal(monthSpan(cols.slice(0, 5), 'fr-FR'), 'novembre');
  assert.equal(monthSpan([], 'fr-FR'), '');
});

test('the calendar opens on the first day somebody is missing, not on a standing "no one qualified" row', () => {
  const rows = [
    ['ok', 'tight', 'ok', 'ok'], ['none', 'none', 'none', 'none'], ['ok', 'ok', 'short', 'ok'], ['ok', 'ok', 'ok', 'short'],
  ].map((days) => ({ days: days as ('ok' | 'tight' | 'short' | 'none')[] }));
  assert.deepEqual(firstProblem(rows), { row: 2, day: 2 });
  assert.deepEqual(firstProblem([{ days: ['ok', 'ok'] }]), { row: 0, day: 0 });
  assert.deepEqual(firstProblem([]), { row: 0, day: 0 });
  assert.equal(shortDays(rows), 2);
  assert.deepEqual(emptyRows([{ label: 'Pilotes CRJ', days: ['none', 'none'] }, { label: 'PNC', days: ['ok', 'none'] }, { label: 'x', days: [] }]), ['Pilotes CRJ']);
  assert.equal(worst(['ok', 'tight', 'short', 'ok']), 'short');
  assert.equal(worst([]), 'ok');
});

test('the selected cell moves by day and by row and stays on the grid', () => {
  assert.deepEqual(moveCell({ row: 0, day: 0 }, 7, 28, { day: -1 }), { row: 0, day: 0 });
  assert.deepEqual(moveCell({ row: 6, day: 27 }, 7, 28, { day: 1, row: 1 }), { row: 6, day: 27 });
  assert.deepEqual(moveCell({ row: 2, day: 9 }, 7, 28, { day: 1 }), { row: 2, day: 10 });
  assert.deepEqual(moveCell({ row: 0, day: 0 }, 0, 0, { day: 1 }), { row: 0, day: 0 });
});

const request = (o: Partial<LeaveRequest>): LeaveRequest => ({ id: 1, staffId: 5, name: 'Perrin', family: 'pilot', from: '2026-11-21', to: '2026-11-27', days: 7, status: 'pending', kind: 'leave', impact: null, ...o });
test('who is away on a day: granted and pending requests of the family, not refused ones', () => {
  const rs = [request({ id: 1 }), request({ id: 2, status: 'granted', from: '2026-11-25', to: '2026-11-25' }), request({ id: 3, status: 'refused' }), request({ id: 4, family: 'cabin' })];
  assert.deepEqual(absentOn(rs, 'pilot', '2026-11-25').map((r) => r.id), [1, 2]);
  assert.deepEqual(absentOn(rs, 'pilot', '2026-11-28'), []);
});

test('a request is a problem only when granting it leaves someone missing that it did not before', () => {
  assert.deepEqual(requestImpact(request({ impact: { before: 'ok', after: 'tight', worstDay: '2026-11-23' } })), { kind: 'none' });
  assert.deepEqual(requestImpact(request({ impact: { before: 'tight', after: 'short', worstDay: '2026-11-23' } })), { kind: 'worse', after: 'short', day: '2026-11-23' });
  assert.deepEqual(requestImpact(request({ impact: { before: 'short', after: 'short', worstDay: '2026-11-23' } })), { kind: 'none' });
  assert.deepEqual(requestImpact(request({ impact: null })), { kind: 'none' });
  assert.deepEqual(pendingRequests([{ status: 'pending', id: 1 }, { status: 'granted', id: 2 }, { status: 'refused', id: 3 }]).map((r) => r.id), [1]);
});

const policy = (o: Partial<PolicyOption>): PolicyOption => ({ policy: 'standard', restBaseH: 13, restAwayH: 11, extraHeadcount: 2, payrollDelta: 9_000, riskFactor: 0.9, ...o });
test('policy preview: nothing for the policy in force; otherwise the difference of the two policies (the server counts against the legal minimum)', () => {
  assert.equal(policyPreview(policy({}), policy({}), 38.2), null);
  const generous = policy({ policy: 'generous', extraHeadcount: 5, payrollDelta: 21_600, riskFactor: 0.7 });
  assert.deepEqual(policyPreview(policy({ policy: 'legal', extraHeadcount: 0, payrollDelta: 0, riskFactor: 1 }), generous, 38.2), { extraHeadcount: 5, payrollDelta: 21_600, fatigueFrom: 38, fatigueTo: 24, riskPct: -30 });
  const fromStandard = policyPreview(policy({}), generous, 38.2)!;
  assert.deepEqual([fromStandard.extraHeadcount, fromStandard.payrollDelta, fromStandard.fatigueTo, fromStandard.riskPct], [3, 12_600, 30, -22]);
  assert.equal(policyPreview(policy({}), policy({ policy: 'legal', extraHeadcount: 0, payrollDelta: 0, riskFactor: 1 }), 30)!.riskPct, 11);
});

test('a temp is priced like S2 prices it: 1.2 x the daily salary x 1.5 x days', () => {
  assert.equal(interimPrice(6_200, 1), Math.round((6_200 / 30) * 1.8));
  assert.equal(interimPrice(6_200, 3), Math.round((6_200 / 30) * 1.8 * 3));
  assert.equal(meanSalary([row({ family: 'pilot', headcount: 2, salaries: 12_400 }), row({ family: 'pilot', headcount: 2, salaries: 12_400 }), cabin], 'pilot'), 6_200);
  assert.equal(meanSalary([row({ family: 'pilot', headcount: 0, salaries: 0 })], 'pilot'), null);
});
