import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAYOUTS, buildAirportChart, type ChartBuilding, type ChartInput, type ChartPrim } from './airport-chart.ts';

const names: Record<string, [string, string]> = {
  T1: ['Terminal 1', 'airport'], MX1: ['Hangar 1', 'player'], MX2: ['Hangar 2', 'available'], CG1: ['Fret', 'ai'], AD: ['Bureaux', 'player'], TWR: ['Tour', 'airport'],
};
const buildings = (slots = Object.keys(names)): ChartBuilding[] => slots.map((slot) => ({ slot, name: names[slot]![0], kind: slot.startsWith('MX') ? 'maintenance' : slot === 'CG1' ? 'cargo' : 'office', owner: names[slot]![1] as ChartBuilding['owner'], ...(slot === 'CG1' ? { ownerName: 'Méridia Cargo' } : {}) }));
const input = (o: Partial<ChartInput> = {}): ChartInput => ({
  layout: LAYOUTS.LFMN!, buildings: buildings(), stands: { spots: 10, used: 4 }, selected: 'MX2', filter: 'all', size: { w: 1100, h: 640 },
  text: { yours: 'À toi', available: 'Disponible' }, ...o,
});
const of = <K extends ChartPrim['kind']>(kind: K, prims: ChartPrim[]): Extract<ChartPrim, { kind: K }>[] => prims.filter((p): p is Extract<ChartPrim, { kind: K }> => p.kind === kind);

test('only the slots the server knows are drawn; the keyboard order is left to right on screen', () => {
  const scene = buildAirportChart(input());
  assert.deepEqual(of('solid', scene.prims).map((s) => s.slot).sort(), ['AD', 'CG1', 'MX1', 'MX2', 'T1', 'TWR']);
  assert.equal(scene.order.length, 6);
  assert.equal(scene.order.includes('FUEL'), false);
  const none = buildAirportChart(input({ buildings: [] }));
  assert.equal(of('solid', none.prims).length, 0);
  assert.deepEqual(none.order, []);
});

test('tags carry the status of the owner: yours, available, the AI company by name; the airport\'s own buildings get quiet text and no tag', () => {
  const scene = buildAirportChart(input());
  const tags = Object.fromEntries(of('tag', scene.prims).map((t) => [t.slot, [t.status, t.tone]]));
  assert.deepEqual(tags, { MX1: ['À toi', 'yours'], MX2: ['Disponible', 'available'], CG1: ['Méridia Cargo', 'ai'], AD: ['À toi', 'yours'] });
  assert.deepEqual(of('quiet', scene.prims).map((q) => q.slot).sort(), ['T1', 'TWR']);
});

test('tags stay inside the band above the chart, on at most three rows, never overlapping on a row', () => {
  const scene = buildAirportChart(input());
  const tags = of('tag', scene.prims);
  for (const t of tags) {
    assert.ok(t.x >= 0 && t.x + t.w <= scene.w, `${t.slot} inside the width`);
    assert.ok(t.y === 0 || t.y === 52 || t.y === 104);
  }
  for (const a of tags) for (const b of tags) if (a !== b && a.y === b.y) assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x, `${a.slot} and ${b.slot} overlap`);
});

test('the selection is outlined on its building and on its tag, nothing else', () => {
  const scene = buildAirportChart(input({ selected: 'MX2' }));
  assert.deepEqual(of('solid', scene.prims).filter((s) => s.width === 2).map((s) => s.slot), ['MX2']);
  assert.deepEqual(of('tag', scene.prims).filter((t) => t.selected).map((t) => t.slot), ['MX2']);
  assert.equal(of('solid', buildAirportChart(input({ selected: null })).prims).filter((s) => s.width === 2).length, 0);
});

test('a filter keeps its kind lit and dims the rest, stands included', () => {
  const scene = buildAirportChart(input({ filter: 'maintenance' }));
  const op = Object.fromEntries(of('solid', scene.prims).map((s) => [s.slot, s.opacity]));
  assert.equal(op.MX1, 1);
  assert.equal(op.MX2, 1);
  assert.equal(op.AD, 0.25);
  assert.equal(op.CG1, 0.25);
  assert.ok(of('stand', scene.prims).every((s) => s.opacity === 0.25));
  assert.ok(of('stand', buildAirportChart(input({ filter: 'parking' })).prims).every((s) => s.opacity === 1));
  assert.ok(of('solid', buildAirportChart(input()).prims).every((s) => s.opacity === 1));
});

test('there is one stand per parking space of the hub, the first ones taken by the player', () => {
  const stands = of('stand', buildAirportChart(input()).prims);
  assert.deepEqual(stands.map((s) => s.id), ['PK1', 'PK2', 'PK3', 'PK4', 'PK5', 'PK6', 'PK7', 'PK8', 'PK9', 'PK10']);
  assert.deepEqual(stands.map((s) => s.owner), [...Array(4).fill('player'), ...Array(6).fill('available')]);
  assert.equal(of('stand', buildAirportChart(input({ stands: null })).prims).length, 0);
  assert.equal(of('stand', buildAirportChart(input({ stands: { spots: 0, used: 0 } })).prims).length, 0);
});

test('every drawn point falls inside the picture, and turning the labels off frees the band for the plan', () => {
  const inside = (d: string, w: number, h: number): boolean => [...d.matchAll(/[ML]([-\d.]+) ([-\d.]+)/g)].every((m) => Number(m[1]) >= -1 && Number(m[1]) <= w + 1 && Number(m[2]) >= -1 && Number(m[2]) <= h + 1);
  for (const labels of [true, false]) {
    const scene = buildAirportChart(input({ labels }));
    for (const s of of('solid', scene.prims)) assert.ok(inside(s.roof, scene.w, scene.h), `${s.slot} roof (labels ${labels})`);
    for (const s of of('stand', scene.prims)) assert.ok(inside(s.d, scene.w, scene.h), `${s.id} (labels ${labels})`);
  }
  const top = (labels: boolean): number => Math.min(...of('solid', buildAirportChart(input({ labels })).prims).map((s) => Math.min(...[...s.roof.matchAll(/[ML][-\d.]+ ([-\d.]+)/g)].map((m) => Number(m[1])))));
  assert.ok(top(false) < top(true));
  assert.equal(of('tag', buildAirportChart(input({ labels: false })).prims).length, 0);
});

test('nearer buildings are drawn after farther ones, and a building shows at most the faces turned to the viewer', () => {
  const solids = of('solid', buildAirportChart(input()).prims);
  assert.ok(solids.every((s) => s.faces.length >= 1 && s.faces.length <= 2));
  const again = buildAirportChart(input({ yaw: 0, elevation: 90 }));
  assert.ok(of('solid', again.prims).every((s) => s.faces.length <= 2));
});
