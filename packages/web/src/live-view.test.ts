import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCatalogEntry, type AircraftType } from '@opc/shared';
import { buildModel, placeTags, project, schematicCategory, SCHEMATIC_CATEGORIES, DEPTH_LEVELS } from './schematic.ts';
import { cabinItems, deriveCabin, layoutCabin, occupiedSeats } from './cabin.ts';
import { aircraftExtras, altitudeOf, arcDash, callsignLabel, checksOf, engineVm, enginesRunning, flightLevelLabel, fuelVm, liveFacts, loadVm, nextView, phaseOf, progressOf, ringDash, wearLevel, zuluSeconds } from './live-view.ts';
import type { LiveResponse, LiveSample } from './api-live.ts';

const type = (category: AircraftType['category'], seats: number, engines = 2): AircraftType =>
  resolveCatalogEntry({ icao: 'TEST', name: 'Test', category, engines, wtc: 'M', perf: { seats, cargoKg: 1000, cruiseKts: 270, rangeNm: 800 } });

const sample = (over: Partial<LiveSample> = {}): LiveSample => ({
  t: 1_000_000, lat: 44, lon: 5, altFt: 24_000, gsKts: 412.4, vsFpm: 0, headingDeg: 340, fuelKg: 2140.4, phase: 'airborne', paused: false, simRate: 1, flags: [], engines: [{ torquePct: 84.2, ittC: 712, oilPsi: 62 }], ...over,
});

// ---------------------------------------------------------------- schematic

test('every catalogue category maps to a drawing, and big jets are not drawn as regional jets', () => {
  assert.equal(schematicCategory({ category: 'turboprop-airliner', seats: 70, engines: 2 }), 'turboprop');
  assert.equal(schematicCategory({ category: 'jet-airliner', seats: 90, engines: 2 }), 'regional-jet');
  assert.equal(schematicCategory({ category: 'jet-airliner', seats: 180, engines: 2 }), 'narrowbody');
  assert.equal(schematicCategory({ category: 'jet-widebody', seats: 300, engines: 2 }), 'widebody');
  assert.equal(schematicCategory({ category: 'piston-single', seats: 4, engines: 1 }), 'piston-single');
  assert.equal(schematicCategory({ category: 'helicopter', seats: 4, engines: 1 }), 'helicopter');
  assert.equal(schematicCategory({ category: 'other', seats: 4, engines: 2 }), 'piston-twin');
  assert.equal(schematicCategory({ category: 'jet-business', seats: 8, engines: 2 }), 'bizjet');
});

test('each drawing has points, a cockpit, cabin and engine callout; a cargo hold only on big fuselages', () => {
  for (const c of SCHEMATIC_CATEGORIES) {
    const m = buildModel(c, { seats: 8 });
    assert.ok(m.pts.length > 200, `${c} has points`);
    assert.ok(m.pts.every((p) => Number.isFinite(p.x + p.y + p.z)), `${c} finite`);
    const keys = m.anchors.map((a) => a.key);
    for (const k of ['cockpit', 'cabin', 'engines']) assert.ok(keys.includes(k as never), `${c} has ${k}`);
  }
  assert.ok(buildModel('widebody').anchors.some((a) => a.key === 'cargo'));
  assert.ok(buildModel('narrowbody').anchors.some((a) => a.key === 'cargo'));
  assert.ok(!buildModel('piston-single').anchors.some((a) => a.key === 'cargo'));
  assert.ok(!buildModel('helicopter').anchors.some((a) => a.key === 'cargo'));
});

test('a wide body is longer than a single, and seats follow the seat count', () => {
  assert.ok(buildModel('widebody').length > buildModel('piston-single').length * 5);
  assert.equal(buildModel('narrowbody', { seats: 150 }).seats.length, 150);
  assert.equal(buildModel('narrowbody').seats.length, 0);
});

test('projection fits every point inside the view box and uses all depth levels', () => {
  for (const c of SCHEMATIC_CATEGORIES) {
    const view = { w: 1536, h: 588, yaw: 24, pitch: 14, labels: true };
    const pr = project(buildModel(c, { seats: 20 }), view);
    for (const d of pr.dots) assert.ok(d.x >= 0 && d.x <= view.w && d.y >= 0 && d.y <= view.h, `${c} dot inside`);
    assert.equal(new Set(pr.dots.map((d) => d.level)).size, DEPTH_LEVELS, `${c} depth levels`);
    for (const a of pr.anchors) assert.ok(a.x >= 0 && a.x <= view.w && a.y >= 0 && a.y <= view.h);
  }
});

test('rotating changes the projection', () => {
  const m = buildModel('turboprop');
  const a = project(m, { w: 800, h: 400, yaw: 24, pitch: 14, labels: true });
  const b = project(m, { w: 800, h: 400, yaw: 90, pitch: 14, labels: true });
  assert.notDeepEqual(a.dots[10], b.dots[10]);
});

test('callout boxes in one row never overlap and stay inside the box', () => {
  const tags = placeTags([
    { key: 'cockpit', ax: 40, ay: 100, side: 'top', w: 120 }, { key: 'cabin', ax: 60, ay: 100, side: 'top', w: 140 },
    { key: 'cargo', ax: 700, ay: 300, side: 'bottom', w: 100 }, { key: 'engines', ax: 780, ay: 300, side: 'bottom', w: 100 },
  ], 800, 400);
  const top = tags.filter((x) => x.side === 'top');
  assert.ok(top[1]!.x >= top[0]!.x + top[0]!.w);
  const bottom = tags.filter((x) => x.side === 'bottom');
  assert.ok(bottom[1]!.x >= bottom[0]!.x + bottom[0]!.w);
  for (const x of tags) assert.ok(x.x >= 0 && x.x + x.w <= 800);
});

// ---------------------------------------------------------------- cabin

test('cabin configuration is derived from seats and category', () => {
  const atr = deriveCabin(type('turboprop-airliner', 70));
  assert.equal(atr.pattern, '2-2');
  assert.equal(atr.rows, 18);
  assert.equal(atr.lastRow, 2);
  assert.equal(atr.rows * 4 - (4 - atr.lastRow), 70);
  assert.ok(atr.cockpit && atr.lavs >= 1 && atr.galleys >= 1 && atr.doors >= 2);
  assert.equal(deriveCabin(type('jet-airliner', 180)).pattern, '3-3');
  assert.equal(deriveCabin(type('jet-widebody', 300)).pattern, '3-4-3');
  const c172 = deriveCabin(type('piston-single', 4, 1));
  assert.deepEqual([c172.pattern, c172.lavs, c172.galleys, c172.cockpit, c172.doors], ['2', 0, 0, false, 1]);
});

test('seat occupancy is deterministic per flight and has exactly the requested count', () => {
  const a = occupiedSeats(70, 48, 7);
  assert.deepEqual(a, occupiedSeats(70, 48, 7));
  assert.equal(a.filter(Boolean).length, 48);
  assert.notDeepEqual(a, occupiedSeats(70, 48, 8));
  assert.equal(occupiedSeats(10, 99, 1).filter(Boolean).length, 10);
  assert.equal(occupiedSeats(10, 0, 1).filter(Boolean).length, 0);
});

test('cabin layout draws every seat once, inside the box, with doors, services and the hold for freight', () => {
  const cfg = deriveCabin(type('turboprop-airliner', 70));
  const lay = layoutCabin(cfg, occupiedSeats(70, 50, 1), false, 1536, 330);
  assert.equal(lay.seats.length, 70);
  assert.equal(lay.seats.filter((s) => s.taken).length, 50);
  for (const s of lay.seats) assert.ok(s.x >= 0 && s.x + s.w <= 1536 && s.y >= 0 && s.y + s.h <= 330);
  assert.equal(lay.doors.length, cabinItems(cfg, false).filter((i) => i.t === 'door').length);
  assert.equal(lay.pilots.length, 2);
  assert.equal(lay.hold, null);
  assert.ok(lay.services.some((s) => s.kind === 'lav') && lay.services.some((s) => s.kind === 'galley'));
  assert.ok(layoutCabin(cfg, [], true, 1536, 330).hold);
  const small = layoutCabin(deriveCabin(type('piston-single', 4, 1)), [], false, 1536, 330);
  assert.equal(small.seats.length, 4);
  assert.equal(small.pilots.length, 0);
});

// ---------------------------------------------------------------- live view-model

test('phase: airborne is split by vertical speed and altitude', () => {
  assert.equal(phaseOf(sample()), 'cruise');
  assert.equal(phaseOf(sample({ vsFpm: 1800 })), 'climb');
  assert.equal(phaseOf(sample({ vsFpm: -900 })), 'descent');
  assert.equal(phaseOf(sample({ altFt: 3000 })), 'airborne');
  assert.equal(phaseOf(sample({ phase: 'taxiOut' })), 'taxi');
  assert.equal(phaseOf(sample({ phase: 'parked' })), 'parked');
  assert.equal(phaseOf(null), 'unknown');
});

test('altitude is a flight level from 18 000 ft and feet below', () => {
  assert.deepEqual(altitudeOf(24_000), { kind: 'fl', level: 240 });
  assert.equal(flightLevelLabel(95), 'FL095');
  assert.deepEqual(altitudeOf(4_987), { kind: 'ft', ft: 4_990 });
  assert.deepEqual(altitudeOf(-30), { kind: 'ft', ft: 0 });
});

test('anti-cheat checks: unknown without data, flagged by bridge flags and by a sim rate above 1x', () => {
  assert.deepEqual(checksOf(null).map((c) => c.state), ['unknown', 'unknown', 'unknown', 'unknown']);
  assert.deepEqual(checksOf(sample()).map((c) => c.state), ['ok', 'ok', 'ok', 'ok']);
  const flagged = checksOf(sample({ flags: ['slew_detected', 'weird_flag'] }));
  assert.equal(flagged.find((c) => c.id === 'slew')!.state, 'flagged');
  assert.equal(flagged.find((c) => c.id === 'pause')!.state, 'ok');
  assert.deepEqual(flagged.at(-1), { id: 'other', state: 'flagged', raw: 'weird_flag' });
  assert.equal(checksOf(sample({ simRate: 2 })).find((c) => c.id === 'timeAccel')!.state, 'flagged');
});

test('engines: torque dial first, N1 as the fallback, nothing when the stream has no engine data', () => {
  assert.deepEqual(engineVm({ torquePct: 84.2, ittC: 712, oilPsi: 62 }, 0), { index: 0, dial: { value: 84.2, unit: 'torque' }, n1Pct: null, ittC: 712, oilPsi: 62 });
  assert.deepEqual(engineVm({ n1Pct: 91 }, 1).dial, { value: 91, unit: 'n1' });
  assert.equal(engineVm({}, 0).dial, null);
});

test('facts: rounds the sample, ages the silence, and falls back to nothing when no sample ever came', () => {
  const r: LiveResponse = { sample: sample(), receivedAt: 995_000, bridgeLost: false, remainingNm: 312, etaAt: 5_000_000 };
  const f = liveFacts(r, 1_000_000);
  assert.deepEqual([f.gsKts, f.fuelKg, f.silentMs, f.phase, f.remainingNm, f.etaAt, f.lost], [412, 2140, 5000, 'cruise', 312, 5_000_000, false]);
  assert.equal(f.engines.length, 1);
  const none = liveFacts({ sample: null, receivedAt: null, bridgeLost: false, remainingNm: null, etaAt: null }, 1);
  assert.deepEqual([none.sample, none.gsKts, none.altitude, none.silentMs, none.phase], [null, null, null, null, 'unknown']);
  assert.equal(liveFacts(null, 1).lost, false);
  assert.equal(liveFacts({ ...r, bridgeLost: true }, 1_000_000).lost, true);
});

test('progress along the route is clamped to 0..1 and unknown without a remaining distance', () => {
  assert.equal(progressOf(700, 315), 0.55);
  assert.equal(progressOf(700, 900), 0);
  assert.equal(progressOf(700, -5), 1);
  assert.equal(progressOf(700, null), null);
  assert.equal(progressOf(0, 10), null);
});

test('fuel: endurance and arrival fuel are derived from the type burn rate; scale never below what is on board', () => {
  const t = type('turboprop-airliner', 70);
  const v = fuelVm(t, 2140, 270, 300);
  assert.equal(v.onBoardKg, 2140);
  assert.ok(v.scaleKg >= 2140 && v.fraction > 0 && v.fraction <= 1);
  assert.ok(v.enduranceH! > 0);
  assert.ok(v.arrivalKg! < 2140 && v.arrivalKg! >= 0);
  assert.equal(fuelVm(t, 2140, null, null).arrivalKg, null);
  assert.equal(fuelVm(t, 1e9, 270, 0).fraction, 1);
});

test('load: payload plus live fuel; unknown fuel leaves the carried mass unknown', () => {
  assert.deepEqual(loadVm({ payloadKg: 6800 }, 8000, 2140), { payloadKg: 6800, capacityKg: 8000, carriedKg: 8940 });
  assert.equal(loadVm({ payloadKg: 6800 }, 8000, null).carriedKg, null);
});

test('wear levels and defensive reading of fields other lots add', () => {
  assert.deepEqual([wearLevel(18), wearLevel(37), wearLevel(80)], ['ok', 'warn', 'danger']);
  assert.deepEqual(aircraftExtras({ registration: 'F-HAZR', wearPct: 22 }), { registration: 'F-HAZR', wearPct: 22 });
  assert.deepEqual(aircraftExtras(undefined), {});
});

test('arc geometry: dial sweeps 270 degrees, red zone starts at the redline, ring is a share of the circle', () => {
  const r = 70;
  const c = 2 * Math.PI * r;
  const full = arcDash(r, 0, 110);
  assert.equal(Number(full.dasharray.split(' ')[0]), Number((0.75 * c).toFixed(2)));
  assert.equal(full.dashoffset, -0);
  const red = arcDash(r, 100, 110);
  assert.ok(Math.abs(red.dashoffset + (100 / 110) * 0.75 * c) < 1e-9);
  assert.ok(Number(red.dasharray.split(' ')[0]) < Number(full.dasharray.split(' ')[0]) / 5);
  assert.equal(Number(arcDash(r, 0, 500).dasharray.split(' ')[0]), Number(full.dasharray.split(' ')[0]));
  assert.equal(Number(arcDash(r, 0, -4).dasharray.split(' ')[0]), 0);
  assert.equal(Number(ringDash(35, 50).split(' ')[0]), Number((Math.PI * 35).toFixed(2)));
  assert.equal(Number(ringDash(35, 400).split(' ')[0]), Number((2 * Math.PI * 35).toFixed(2)));
});

test('running engines, UTC clock with seconds, view cycle, callsign label', () => {
  assert.equal(enginesRunning([engineVm({ torquePct: 84 }, 0), engineVm({ torquePct: 0 }, 1), engineVm({}, 2)]), 1);
  assert.equal(zuluSeconds(Date.UTC(2026, 10, 6, 17, 58, 12)), '17:58:12Z');
  assert.deepEqual([nextView('cutaway'), nextView('cabin'), nextView('systems')], ['cabin', 'systems', 'cutaway']);
  assert.equal(callsignLabel('AZR', 4127), 'AZR 4127');
  assert.equal(callsignLabel(null, 4127), null);
});
