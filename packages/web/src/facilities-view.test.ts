import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiNames, contractsOf, creditLoans, defaultSlot, effectOf, filtersOf, firstLevel, holdingOf, keepSlot, keyOrder, leaseMonthsLeft, levelState, matchesFilter, monthsBetween, previewQuery, shown, staffLine, stepLevel, stepOf, teamRows } from './facilities-view.ts';
import { LFLL, LFMN, LFMN_FACILITIES, MX2, OVERVIEW, PLAN } from './facilities-fixtures.ts';
import { LAYOUTS, buildAirportChart, slotFor } from './airport-chart.ts';

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-06T18:00:00Z');

test('a row says how the player stands: leased, bought, available, taken by an AI company, the airport\'s', () => {
  const by = Object.fromEntries(LFMN_FACILITIES.map((f) => [f.slot, holdingOf(f)]));
  assert.deepEqual([by.AD, by.MX1, by.MX2, by.CG1, by.T1], ['leased', 'owned', 'available', 'ai', 'airport']);
});

test('the hub card lists what she holds, then what is free; the airport\'s own buildings and the overflow of free ones go to the "also" line', () => {
  const { rows, more } = shown(LFMN.facilities);
  assert.deepEqual(rows.map((f) => f.slot), ['AD', 'MX1', 'MX2', 'OPS']);
  assert.equal(more.length, 0);
  const many = shown(LFMN.facilities, 3);
  assert.deepEqual(many.rows.map((f) => f.slot), ['AD', 'MX1', 'MX2']);
  assert.deepEqual(many.more.map((f) => f.slot), ['OPS']);
  assert.deepEqual(shown(LFMN_FACILITIES).rows.map((f) => f.slot).includes('TWR'), false);
});

test('contracts at a hub are told in one word', () => {
  assert.equal(contractsOf(LFLL.facilities), 'leased');
  assert.equal(contractsOf(LFMN.facilities), 'mixed');
  assert.equal(contractsOf([]), 'none');
  assert.equal(contractsOf(LFMN.facilities.filter((f) => f.slot === 'MX1')), 'owned');
});

test('the team rows are biggest first and leave empty families out', () => {
  assert.deepEqual(teamRows({ pilot: 14, cabin: 9, ground: 0, maintenance: 7 }).map((r) => r.family), ['pilot', 'cabin', 'maintenance']);
  assert.deepEqual(teamRows({}), []);
});

test('the plan opens on the first building to take, else hers, else the first; an asked slot wins when the plan has it', () => {
  const order = keyOrder(PLAN.buildings, ['MX1', 'MX2', 'ZZZ', 'T1']);
  assert.deepEqual(order.slice(0, 3), ['MX1', 'MX2', 'T1']);
  assert.equal(order.length, PLAN.buildings.length);
  assert.equal(defaultSlot(PLAN.buildings, order), 'MX2');
  assert.equal(keepSlot(PLAN.buildings, order, 'AD'), 'AD');
  assert.equal(keepSlot(PLAN.buildings, order, 'NOPE'), 'MX2');
  assert.equal(defaultSlot(PLAN.buildings.filter((b) => b.owner === 'airport'), ['T1']), 'T1');
  assert.equal(defaultSlot([], []), null);
});

test('filters list only the kinds the plan has, in the mockup\'s order; the stands add parking', () => {
  assert.deepEqual(filtersOf(PLAN.buildings, true), ['all', 'maintenance', 'terminal', 'cargo', 'office', 'parking']);
  assert.deepEqual(filtersOf(PLAN.buildings.filter((b) => b.kind === 'terminal'), false), ['all', 'terminal']);
  assert.equal(matchesFilter('office', 'all'), true);
  assert.equal(matchesFilter('office', 'cargo'), false);
});

test('stepping wraps around and starts from the ends when nothing is selected', () => {
  assert.equal(stepOf(['a', 'b', 'c'], 'c', 1), 'a');
  assert.equal(stepOf(['a', 'b', 'c'], 'a', -1), 'c');
  assert.equal(stepOf(['a', 'b', 'c'], null, 1), 'a');
  assert.equal(stepOf(['a', 'b', 'c'], null, -1), 'c');
  assert.equal(stepOf([], null, 1), null);
});

test('AI company names are listed once each', () => {
  assert.deepEqual(aiNames(PLAN.buildings), ['Méridia Cargo']);
  assert.deepEqual(aiNames([{ owner: 'ai', ownerName: 'X' }, { owner: 'ai', ownerName: 'X' }, { owner: 'ai', ownerName: null }]), ['X']);
});

test('the effect sentence follows the building\'s effect, not its kind (an operations centre and offices are both offices)', () => {
  assert.equal(effectOf({ effect: 'hangar', kind: 'maintenance' }).key, 'fc.effect.maintenance');
  assert.equal(effectOf({ effect: 'ops', kind: 'office' }).key, 'fc.effect.ops');
  assert.equal(effectOf({ effect: 'desks', kind: 'office' }).key, 'fc.effect.office');
  assert.equal(effectOf({ effect: 'none', kind: 'terminal' }).key, 'fc.effect.none');
});

test('before signing the levels that open later are locked; once held only the next one is, when its date has come and no works run', () => {
  const [l1, l2, l3] = MX2.levels;
  const free = MX2.facility;
  assert.deepEqual([l1, l2, l3].map((l) => levelState(l!, free, NOW)), ['pickable', 'pickable', 'locked']);
  const mine = { ...free, owner: 'player' as const, level: 1, nextLevelAt: NOW - DAY, works: null };
  assert.deepEqual([l1, l2, l3].map((l) => levelState(l!, mine, NOW)), ['done', 'pickable', 'locked']);
  assert.equal(levelState(l2!, { ...mine, nextLevelAt: NOW + DAY }, NOW), 'locked');
  assert.equal(levelState(l2!, { ...mine, works: { toLevel: 2, until: NOW + DAY } }, NOW), 'locked');
  assert.equal(levelState(l3!, { ...mine, level: 2 }, NOW), 'pickable');
});

test('← → step over the pickable levels only and stay put at the ends', () => {
  const states = new Map([[1, 'pickable'], [2, 'pickable'], [3, 'locked']] as const);
  assert.equal(stepLevel(MX2.levels, states, 1, 1), 2);
  assert.equal(stepLevel(MX2.levels, states, 2, 1), 2);
  assert.equal(stepLevel(MX2.levels, states, 2, -1), 1);
  assert.equal(stepLevel(MX2.levels, states, 1, -1), 1);
  assert.equal(firstLevel(MX2.levels, states), 1);
  assert.equal(firstLevel(MX2.levels, new Map([[1, 'done'], [2, 'pickable']] as const)), 2);
});

test('the staff a level needs is the level\'s own figure, the roster and the market come from the server', () => {
  assert.deepEqual(staffLine(MX2, 2), { need: 10, have: 0, candidates: 23, missing: 10 });
  assert.deepEqual(staffLine({ ...MX2, required: [{ ...MX2.required[0]!, have: 4 }] }, 1), { need: 6, have: 4, candidates: 23, missing: 2 });
  assert.equal(staffLine({ ...MX2, levels: MX2.levels.map((l) => ({ ...l, technicians: 0 })) }, 1), null);
});

test('the credit offered is the loans with the smallest down payment', () => {
  const p = { creditPct: 80, loans: [{ downPct: 20, months: 36 }, { downPct: 30, months: 36 }, { downPct: 20, months: 120 }] } as never;
  assert.deepEqual(creditLoans(p).map((l) => l.months), [36, 120]);
});

test('the preview asks S3 for the mode, the level and, on credit, the down payment with the term', () => {
  assert.equal(previewQuery({ mode: 'lease', level: 2, credit: null }), 'mode=lease&level=2');
  assert.equal(previewQuery({ mode: 'purchase', level: 1, credit: null }), 'mode=buy&level=1');
  assert.equal(previewQuery({ mode: 'purchase', level: 1, credit: { downPct: 20, months: 120 } }), 'mode=buy&level=1&downPct=20&months=120');
  assert.equal(previewQuery({ mode: 'lease', level: 1, credit: { downPct: 20, months: 120 } }), 'mode=lease&level=1');
});

test('calendar months between two dates count the day of the month; a lease has its term minus the months gone', () => {
  assert.equal(monthsBetween(Date.parse('2025-09-06T00:00:00Z'), Date.parse('2026-11-06T00:00:00Z')), 14);
  assert.equal(monthsBetween(Date.parse('2025-09-06T00:00:00Z'), Date.parse('2026-11-05T00:00:00Z')), 13);
  assert.equal(monthsBetween(NOW, NOW - DAY), 0);
  assert.equal(leaseMonthsLeft(Date.parse('2026-02-06T00:00:00Z'), 36, NOW), 27);
  assert.equal(leaseMonthsLeft(Date.parse('2020-02-06T00:00:00Z'), 36, NOW), 0);
});

test('the fixtures add up like the mockup: the hub totals are the overview total', () => {
  assert.equal(OVERVIEW.hubs.reduce((n, h) => n + h.monthlyCost, 0), OVERVIEW.monthlyCost);
  assert.equal(MX2.due!.today, MX2.offer!.lease.deposit + MX2.levels[1]!.cost);
  assert.equal(MX2.offer!.lease.totalOverTerm, MX2.offer!.lease.monthly * MX2.offer!.lease.months);
});

// ---------------------------------------------------------------- the chart's tag placement

test('tags keep their place when nothing is in the way, step aside a little when that is enough, and drop a row when it is not', () => {
  assert.deepEqual(slotFor([], 100, 150, 1100), { x: 100, row: 0 });
  assert.deepEqual(slotFor([{ x: 0, w: 140, row: 0 }], 100, 150, 1100), { x: 150, row: 0 });
  assert.deepEqual(slotFor([{ x: 90, w: 150, row: 0 }], 100, 150, 1100), { x: 100, row: 1 });
});

test('a tag too far from its building on one row goes to a row below; none ever overlaps another on its row', () => {
  const placed: { x: number; w: number; row: number }[] = [];
  for (const want of [300, 320, 340, 360, 380, 400, 420]) {
    const s = slotFor(placed, want, 180, 1100);
    assert.ok(s.x >= 0 && s.x + 180 <= 1100);
    for (const q of placed) if (q.row === s.row) assert.ok(s.x >= q.x + q.w || q.x >= s.x + 180, `overlap at ${want}`);
    placed.push({ x: s.x, w: 180, row: s.row });
  }
  assert.ok(new Set(placed.map((p) => p.row)).size > 1);
});

test('the tags of the Nice plan with its fixtures never overlap', () => {
  const scene = buildAirportChart({
    layout: LAYOUTS.LFMN!, size: { w: 1100, h: 560 }, selected: 'OPS', filter: 'all', stands: { spots: 6, used: 4 }, text: { yours: 'À toi', available: 'Disponible' },
    buildings: PLAN.buildings.map((b) => ({ slot: b.slot, name: b.name, kind: b.kind, owner: b.owner, ...(b.ownerName ? { ownerName: b.ownerName } : {}) })),
  });
  const tags = scene.prims.flatMap((p) => (p.kind === 'tag' ? [p] : []));
  assert.ok(tags.length >= 5);
  for (const a of tags) for (const b of tags) if (a !== b && a.y === b.y) assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x, `${a.slot} and ${b.slot} overlap`);
});
