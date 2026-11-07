import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Blocker, DutyBlock, FamilyRow, PolicyOption } from './api-staff.ts';
import {
  availabilitySegments, blockerOf, chartDay, dayBars, dayColumns, defaultExpanded, emptyFamilies, firstProblem, ganttOf, hirePremium, keepSelection, loadMeter, medicalState, membersOf, monthSpan, moraleLevel, moveCell,
  policyPreview, prefersElsewhere, presetFor, rowBadge, shortDays, stepMember, toggleAll, visibleRows, worst, alertAt, pendingRequests,
} from './staff-view.ts';

const avail = (o: Partial<FamilyRow['availability']> = {}): FamilyRow['availability'] => ({ onDuty: 0, resting: 0, leave: 0, training: 0, vacant: 0, ...o });
const row = (o: Partial<FamilyRow> = {}): FamilyRow => ({ family: 'pilot', label: 'Pilotes', headcount: 8, need: 8, availability: avail({ onDuty: 8 }), salaries: 59_400, note: null, ...o });
const atr = row({ type: 'AT76', label: 'ATR 72', headcount: 13, need: 14, note: 'Lefèvre · 12 h 10 sur 13 h', members: [{ id: 1, name: 'Perrin', role: 'captain' }, { id: 2, name: 'Lefèvre', role: 'fo' }] });
const a220 = row({ type: 'BCS3', label: 'A220', members: [{ id: 3, name: 'Vidal', role: 'captain' }] });
const crj = row({ type: 'CRJ7', label: 'CRJ', headcount: 2, need: 4, availability: avail({ resting: 1, leave: 1, vacant: 2 }) });
const pilots = row({ label: 'Pilotes', headcount: 23, need: 26, children: [atr, a220, crj] });
const cabin = row({ family: 'cabin', label: 'Personnel de cabine', headcount: 18, need: 18 });
const ground = row({ family: 'ground', label: 'Personnel au sol', headcount: 14, need: 16, note: null });
const crjBlock: Blocker = { family: 'pilot', type: 'CRJ7', title: 'Aucun pilote CRJ disponible', detail: '', flights: ['AZR 7345', 'AZR 7346'], aircraft: 'F-HAZC', missing: '1 Cdt · 1 OPL', lostPerDay: 21_400 };

test('a row is blocked by its own blocker; the family by any blocker of its types; other types are not', () => {
  assert.equal(blockerOf([crjBlock], crj), crjBlock);
  assert.equal(blockerOf([crjBlock], pilots), crjBlock);
  assert.equal(blockerOf([crjBlock], atr), null);
  assert.equal(blockerOf([crjBlock], cabin), null);
});

test('row badge: blocker, then the server note, then a missing head, then complete', () => {
  assert.deepEqual(rowBadge(pilots, [crjBlock]), { tone: 'bad', kind: 'blocks', flights: 2 });
  assert.deepEqual(rowBadge(crj, [crjBlock]), { tone: 'bad', kind: 'none' });
  assert.deepEqual(rowBadge(atr, [crjBlock]), { tone: 'warn', kind: 'note', note: 'Lefèvre · 12 h 10 sur 13 h' });
  assert.deepEqual(rowBadge(ground, []), { tone: 'warn', kind: 'missing', n: 2 });
  assert.deepEqual(rowBadge(cabin, []), { tone: 'ok', kind: 'complete' });
  const covered = row({ type: 'CRJ7', availability: avail({ onDuty: 1 }) });
  assert.equal(rowBadge(covered, [crjBlock]).kind, 'blocks');
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
  assert.deepEqual([...defaultExpanded([pilots, cabin], [])], ['pilot']);
  assert.deepEqual([...defaultExpanded([row({ children: [a220] }), cabin], [])], []);
  assert.deepEqual([...toggleAll([pilots, cabin], new Set())], ['pilot']);
  assert.deepEqual([...toggleAll([pilots, cabin], new Set(['pilot']))], []);
});

test('the availability bar has one segment per state that has people', () => {
  assert.deepEqual(availabilitySegments(avail({ onDuty: 8, resting: 9, leave: 4, training: 2 })).map((s) => `${s.kind}:${s.count}`), ['duty:8', 'rest:9', 'leave:4', 'training:2']);
  assert.deepEqual(availabilitySegments(avail()), []);
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

test('morale words and the hiring premium come from numbers; nothing is invented', () => {
  assert.deepEqual([90, 75, 74, 50, 49].map(moraleLevel), ['high', 'high', 'medium', 'medium', 'low']);
  assert.equal(hirePremium({ salary: 13_800 }), 13_800);
  assert.equal(prefersElsewhere({ base: 'LFMN', prefersBase: 'LFMN' }), null);
  assert.equal(prefersElsewhere({ base: 'LFLL', prefersBase: 'LFMN' }), 'LFMN');
  assert.equal(prefersElsewhere({ base: 'LFLL', prefersBase: null }), null);
  assert.equal(keepSelection([{ id: 'a' }, { id: 'b' }], 'b'), 'b');
  assert.equal(keepSelection([{ id: 'a' }, { id: 'b' }], 'zz'), 'a');
  assert.equal(keepSelection([], 'a'), null);
});

const H = 3_600_000;
const D0 = Date.parse('2026-11-06T00:00:00Z');
const at = (h: number): number => D0 + h * H;
const flight = (no: string, from: number, to: number, o: Partial<DutyBlock> = {}): DutyBlock => ({ kind: 'flight', flightNo: no, origin: 'LFMN', dest: 'LFLL', start: at(from), end: at(to), status: 'planned', over: false, ...o });

test('duty chart: an even-hour axis around the blocks, bars in percent, the part past the limit apart', () => {
  const blocks = [flight('AZR 1131', 9.5, 10.75, { status: 'done' }), flight('AZR 1138', 20.5, 22)];
  const g = ganttOf(blocks, at(21.75), at(17.97));
  assert.equal(g.startMs, at(8));
  assert.equal(g.endMs, at(22));
  assert.equal(g.ticks[0]!.label, '08:00');
  assert.equal(g.ticks.at(-1)!.label, '22:00');
  const first = g.bars[0]!;
  assert.equal(first.over, null);
  assert.ok(Math.abs(first.left - (1.5 / 14) * 100) < 1e-9);
  const last = g.bars[1]!;
  assert.ok(last.over);
  assert.ok(Math.abs(last.over.left - ((21.75 - 8) / 14) * 100) < 1e-9);
  assert.ok(Math.abs(last.over.left + last.over.width - ((22 - 8) / 14) * 100) < 1e-9);
  assert.ok(Math.abs(g.nowPct! - ((17.97 - 8) / 14) * 100) < 1e-9);
  assert.ok(Math.abs(g.limitPct! - ((21.75 - 8) / 14) * 100) < 1e-9);
});

test('duty chart: no limit means nothing is over; the limit outside the axis draws no marker; an empty day has no bars', () => {
  const g = ganttOf([flight('AZR 1', 9, 10)], null, at(5));
  assert.equal(g.bars[0]!.over, null);
  assert.equal(g.limitPct, null);
  assert.equal(g.nowPct, null);
  assert.deepEqual(ganttOf([], null, at(5)).bars, []);
  assert.equal(chartDay(['2026-11-05', '2026-11-06'], at(12)), '2026-11-06');
  assert.equal(chartDay(['2026-11-07'], at(12)), '2026-11-07');
  assert.equal(chartDay([], at(12)), null);
});

test('seven-day bars scale to the daily limit; a heavy closed day is amber, rest days have no height', () => {
  const bars = dayBars([{ day: '2026-11-01', hours: null, kind: 'rest' }, { day: '2026-11-04', hours: 11.2, kind: 'duty' }, { day: '2026-11-06', hours: 9.2, kind: 'planned', plannedHours: 4 }], 13);
  assert.equal(bars[0]!.height, 0);
  assert.equal(bars[1]!.tone, 'warn');
  assert.ok(Math.abs(bars[2]!.plannedHeight - 4 / 13) < 1e-9);
  assert.equal(bars[2]!.tone, 'ok');
});

test('medical: amber under 30 days, red once lapsed', () => {
  assert.equal(medicalState(23).tone, 'warn');
  assert.equal(medicalState(120).tone, 'ok');
  assert.equal(medicalState(-1).tone, 'bad');
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
    { days: ['ok', 'tight', 'ok', 'ok'] as const },
    { days: ['none', 'none', 'none', 'none'] as const },
    { days: ['ok', 'ok', 'short', 'ok'] as const },
    { days: ['ok', 'ok', 'ok', 'short'] as const },
  ].map((r) => ({ days: [...r.days] }));
  assert.deepEqual(firstProblem(rows), { row: 2, day: 2 });
  assert.deepEqual(firstProblem([{ days: ['ok', 'ok'] }]), { row: 0, day: 0 });
  assert.deepEqual(firstProblem([]), { row: 0, day: 0 });
  assert.equal(shortDays(rows), 2);
  assert.deepEqual(emptyFamilies([{ label: 'Pilotes CRJ', days: ['none', 'none'] }, { label: 'PNC', days: ['ok', 'none'] }, { label: 'x', days: [] }]), ['Pilotes CRJ']);
  assert.equal(worst(['ok', 'tight', 'short', 'ok']), 'short');
  assert.equal(worst([]), 'ok');
});

test('the selected cell moves by day and by row and stays on the grid', () => {
  assert.deepEqual(moveCell({ row: 0, day: 0 }, 7, 28, { day: -1 }), { row: 0, day: 0 });
  assert.deepEqual(moveCell({ row: 6, day: 27 }, 7, 28, { day: 1, row: 1 }), { row: 6, day: 27 });
  assert.deepEqual(moveCell({ row: 2, day: 9 }, 7, 28, { day: 1 }), { row: 2, day: 10 });
  assert.deepEqual(moveCell({ row: 0, day: 0 }, 0, 0, { day: 1 }), { row: 0, day: 0 });
});

test('the server writes the alert of a cell; the screen only looks it up', () => {
  const alerts = [{ family: 'pilot:AT76', day: '2026-11-15', available: 11, needed: 12, detail: 'x', flights: ['AZR 1641'], interim: null }];
  assert.equal(alertAt(alerts, { family: 'pilot:AT76' }, '2026-11-15')?.available, 11);
  assert.equal(alertAt(alerts, { family: 'pilot:AT76' }, '2026-11-16'), null);
  assert.equal(alertAt(alerts, { family: 'cabin' }, '2026-11-15'), null);
});

const opt = (o: Partial<PolicyOption>): PolicyOption => ({ id: 'standard', rest: { baseH: 12, awayH: 10, dutyDays: 6, weeklyH: 36, nights: 2 }, extraHeadcount: 0, payrollDelta: 0, fatigueAfter: 38, riskDelta: 0, ...o });
test('policy preview: nothing for the policy in force; otherwise the server\'s figures, fatigue from today\'s mean', () => {
  assert.equal(policyPreview('standard', opt({ id: 'standard' }), 38.2), null);
  assert.deepEqual(policyPreview('standard', opt({ id: 'generous', extraHeadcount: 5, payrollDelta: 21_600, fatigueAfter: 24.4, riskDelta: -0.3 }), 38.2), { extraHeadcount: 5, payrollDelta: 21_600, fatigueFrom: 38, fatigueTo: 24, riskPct: -30 });
});

test('only pending requests carry buttons', () => {
  assert.deepEqual(pendingRequests([{ status: 'pending', id: 1 }, { status: 'granted', id: 2 }, { status: 'refused', id: 3 }]).map((r) => r.id), [1]);
});
