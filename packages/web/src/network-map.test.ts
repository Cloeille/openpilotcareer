import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arcHeight, arcLift, buildNetworkMap, dashed, DEFAULT_CAMERA, pathOf, tagWidth, type MapInput } from './network-map.ts';

const AP = [
  { icao: 'LFMN', city: 'Nice', lat: 43.665, lon: 7.215, hub: 'player' as const },
  { icao: 'LFLL', city: 'Lyon', lat: 45.726, lon: 5.091 },
  { icao: 'LFPG', city: 'Paris', lat: 49.01, lon: 2.548 },
  { icao: 'LFML', city: 'Marseille', lat: 43.439, lon: 5.221 },
];
const input = (o: Partial<MapInput> = {}): MapInput => ({
  airports: AP, lines: [{ id: 'LFLL-LFMN', a: 'LFLL', b: 'LFMN', owner: 'player', state: 'ok' }, { id: 'LFMN-LFPG', a: 'LFMN', b: 'LFPG', owner: 'player', state: 'interrupted' }],
  flights: [{ reg: 'F-HAZA', info: 'AZR 1136 → LFMN', from: 'LFLL', to: 'LFMN', t: 0.5, owner: 'player', line: 'LFLL-LFMN' }],
  fit: { left: 110, top: 215, right: 1100, bottom: 680 }, size: { w: 1600, h: 778 }, camera: DEFAULT_CAMERA, text: { interrupted: 'Interrupted', contested: 'Contested' }, ...o,
});
const names = (m: ReturnType<typeof buildNetworkMap>): string[] => m.prims.map((p) => ('name' in p ? p.name : p.kind));

test('the camera frames every airport inside the fit box', () => {
  const m = buildNetworkMap(input());
  const box = input().fit;
  for (const [code, p] of m.airports) {
    assert.ok(p.x >= box.left - 1 && p.x <= box.right + 1 && p.y >= box.top - 1 && p.y <= box.bottom + 1, `${code} at ${p.x},${p.y}`);
  }
  assert.equal(m.airports.size, 3);
});

test('north is up-ish: Paris is drawn above Nice on the screen, whatever the framing', () => {
  const m = buildNetworkMap(input({ camera: { azimuth: 0, elevation: 40, distance: 30 } }));
  assert.ok(m.airports.get('LFPG')!.y < m.airports.get('LFMN')!.y);
});

test('every line becomes an arc, an interrupted one a dashed stroke with a flag, a flight a trail, a plane and a tag', () => {
  const m = buildNetworkMap(input());
  const n = names(m);
  assert.ok(n.includes('line LFLL-LFMN') && n.includes('line LFMN-LFPG'));
  const down = m.prims.find((p) => p.kind === 'path' && p.name === 'line LFMN-LFPG');
  assert.ok(down && down.kind === 'path' && down.stroke === 'var(--danger)' && (down.d.match(/M/g) ?? []).length > 3, 'dashed: many sub-paths');
  assert.ok(m.prims.some((p) => p.kind === 'label' && p.name === 'flag LFMN-LFPG' && p.lines[0]!.text === 'Interrupted'));
  assert.ok(n.includes('flown F-HAZA') && n.includes('F-HAZA') && n.includes('shadow F-HAZA'));
  assert.ok(m.prims.some((p) => p.kind === 'tag' && p.reg === 'F-HAZA' && p.info === 'AZR 1136 → LFMN'));
});

test('the flown trail stops where the aircraft is: a plane at 50 % sits between its airports, at 0 on the departure', () => {
  const at = (t: number): { x: number; y: number } => { const p = buildNetworkMap(input({ flights: [{ ...input().flights[0]!, t }] })).prims.find((q) => q.kind === 'plane')!; assert.equal(p.kind, 'plane'); return p as { x: number; y: number }; };
  const m = buildNetworkMap(input());
  const lyon = m.airports.get('LFLL')!, nice = m.airports.get('LFMN')!;
  const mid = at(0.5);
  assert.ok(mid.x > Math.min(lyon.x, nice.x) - 1 && mid.x < Math.max(lyon.x, nice.x) + 1);
  assert.ok(mid.y < (lyon.y + nice.y) / 2, 'lifted above the ground track');
  assert.ok(Math.hypot(at(0).x - lyon.x, at(0).y - lyon.y) < 1);
  assert.ok(Math.hypot(at(1).x - nice.x, at(1).y - nice.y) < 1);
});

test('a flight on a reversed line is drawn from its own departure airport', () => {
  const m = buildNetworkMap(input({ flights: [{ reg: 'F-HAZB', info: 'x', from: 'LFMN', to: 'LFLL', t: 0.1, owner: 'player', line: 'LFLL-LFMN' }] }));
  const plane = m.prims.find((p) => p.kind === 'plane');
  const nice = m.airports.get('LFMN')!;
  assert.ok(plane && plane.kind === 'plane' && Math.hypot(plane.x - nice.x, plane.y - nice.y) < 60);
});

test('own flight uses the route colour and a longer trajectory; rival contested lines are warning-coloured and flagged', () => {
  const m = buildNetworkMap(input({
    lines: [{ id: 'LFML-LFLL', a: 'LFML', b: 'LFLL', owner: 'rival', state: 'ok', contested: true }],
    flights: [{ reg: 'F-HAZR', info: 'mine', from: 'LFMN', to: 'LFPG', t: 0.55, owner: 'me', line: null }],
  }));
  assert.ok(names(m).includes('own trajectory'));
  const contested = m.prims.find((p) => p.kind === 'path' && p.name === 'rival LFML-LFLL');
  assert.ok(contested && contested.kind === 'path' && contested.stroke === 'var(--warning)');
  assert.ok(m.prims.some((p) => p.kind === 'label' && p.name === 'flag LFML-LFLL' && p.flagIcon === 'swords'));
  const plane = m.prims.find((p) => p.kind === 'plane');
  assert.ok(plane && plane.kind === 'plane' && plane.color === 'var(--route)' && plane.size === 22);
});

test('a dimmed line is not selected and carries no flag; the selected line is drawn heavier', () => {
  const dim = buildNetworkMap(input({ lines: [{ id: 'LFMN-LFPG', a: 'LFMN', b: 'LFPG', owner: 'player', state: 'interrupted', dim: true }], flights: [] }));
  assert.ok(!names(dim).includes('flag LFMN-LFPG'));
  const sel = buildNetworkMap(input({ selected: 'LFLL-LFMN', flights: [] }));
  const heavy = sel.prims.find((p) => p.kind === 'path' && p.name === 'line LFLL-LFMN');
  assert.ok(heavy && heavy.kind === 'path' && heavy.width === 2.5 && heavy.glow);
});

test('lines to an airport the map does not know are skipped, not crashed on; an empty network still draws', () => {
  const m = buildNetworkMap(input({ lines: [{ id: 'LFMN-XXXX', a: 'LFMN', b: 'XXXX', owner: 'player', state: 'ok' }], flights: [{ reg: 'F-Z', info: '', from: 'XXXX', to: 'LFMN', t: 0.5, owner: 'player', line: null }] }));
  assert.ok(!names(m).includes('line LFMN-XXXX') && !names(m).includes('F-Z'));
  const empty = buildNetworkMap(input({ airports: [], lines: [], flights: [] }));
  assert.ok(empty.prims.length > 0);
  const lone = buildNetworkMap(input({ airports: [AP[0]!, AP[1]!], lines: [], flights: [] }));
  assert.deepEqual([...lone.airports.keys()], ['LFMN'], 'with no line only the hub is placed');
});

test('the hub gets a highlighted halo and its own label style, other airports the plain code', () => {
  const m = buildNetworkMap(input());
  const label = (code: string) => m.prims.find((p) => p.kind === 'label' && p.name === `label ${code}`);
  const hub = label('LFMN'), other = label('LFLL');
  assert.ok(hub && hub.kind === 'label' && hub.lines[0]!.cls === 'code-hub' && hub.lines[1]!.text === 'Nice');
  assert.ok(other && other.kind === 'label' && other.lines[0]!.cls === 'code');
});

test('airport labels sit on the side facing away from the rest of the network', () => {
  const m = buildNetworkMap(input({ lines: [{ id: 'LFLL-LFPG', a: 'LFLL', b: 'LFPG', owner: 'player', state: 'ok' }, { id: 'LFLL-LFMN', a: 'LFLL', b: 'LFMN', owner: 'player', state: 'ok' }], flights: [], camera: { azimuth: 0, elevation: 40, distance: 30 } }));
  const side = (code: string): string => (m.prims.find((p) => p.kind === 'label' && p.name === `label ${code}`) as { side: string }).side;
  assert.equal(side('LFPG'), 'above', 'the northernmost airport is labelled above it');
  assert.equal(side('LFMN'), 'below', 'the southernmost below');
});

test('pure helpers: paths, dashes, arc heights and tag widths', () => {
  assert.equal(pathOf([{ x: 1.04, y: 2 }, { x: 3, y: 4.96 }]), 'M1 2L3 5');
  assert.equal(pathOf([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], true), 'M0 0L1 0L1 1Z');
  const d = dashed([{ x: 0, y: 0 }, { x: 40, y: 0 }], 7, 6);
  assert.equal((d.match(/M/g) ?? []).length, 4);
  assert.ok(d.startsWith('M0 0L7 0'));
  assert.equal(arcLift(10, 0.2, 0.5), 2);
  assert.equal(arcLift(10, 0.2, 0), 0);
  assert.ok(arcHeight(0, true) > arcHeight(0));
  assert.notEqual(arcHeight(0), arcHeight(1));
  assert.ok(tagWidth('F-HAZA', 'AZR 1136 → LFMN', '+14 min') > tagWidth('F-HAZA', 'AZR 1136 → LFMN'));
});
