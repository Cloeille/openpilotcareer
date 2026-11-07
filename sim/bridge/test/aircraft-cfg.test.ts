import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSimAircraft, indexCfgs, isFlyable, mergeModular, parseCfg, readAircraftCfg, type Listing } from '../src/aircraft-cfg.ts';

// Shapes measured on a real MSFS 2024 install (D:\MSFS2024\Packages\Community): a jet bridge helper that declares B772 and two jet engines,
// an FSLTL traffic base + its variation, a legacy multi-variation cfg (PMDG), a livery package that only names its base container, a modular aircraft (Fenix).
const JETWAY = `[VERSION]
major = 1

[GENERAL]
atc_type = "ApronLife"
Category = "airplane"
editable = 0
icao_type_designator = "B772"
icao_engine_type = "Jet"
icao_engine_count = 2

[FLTSIM.0]
title = "ApronLife_JetwayHelper_H"
ui_manufacturer = "ApronLife"
ui_type = "Jet bridge helper H"
isairtraffic = 1
isuserselectable = 0

[FLTSIM.1]
title = "ApronLife_JetwayHelper_H AAL"
ui_manufacturer = "ApronLife"
ui_type = "Jet bridge helper H"
isairtraffic = 1
isuserselectable = 0
`;
const FSLTL_BASE = `[GENERAL]
Category = "airplane"
icao_type_designator = "A332"
icao_engine_type = "Jet"
icao_engine_count = 2
icao_generic = 0

[FLTSIM.0]
title = "FSLTL_A332_ZZZZ" ; Variation name
ui_manufacturer = "AIRBUS"
ui_type = "AIRBUS A332"
isairtraffic = 1 ; airtraffic flag
isuserselectable = 0
`;
const FSLTL_VARIATION = `[GENERAL]
icao_type_designator = "A332"

[VARIATION]
base_container = "..\\FSLTL_A332"

[FLTSIM.0]
title = "FSLTL_TFS_A332_Cedar_Jet" ; Variation name
ui_manufacturer = "Airbus" ; e.g. Boeing
ui_type = "Airbus A332"
isairtraffic = 1
isuserselectable = 0
`;
const PMDG = `[fltsim.0]
title="PMDG 737-800 PMDG House (N738BW | 2022)"
ui_manufacturer="Boeing"
ui_type="737-800"
isUserSelectable=1

[fltsim.1]
title="PMDG 737-800 PMDG House (N738SW | 2022)"
ui_manufacturer="Boeing"
ui_type="737-800"
isUserSelectable=1
`;
const A320_GENERAL = `[GENERAL]
Category = "airplane"
icao_type_designator = "A20N"
icao_manufacturer = "AIRBUS"
icao_model = "A-320neo"
icao_engine_type = "Jet"
icao_engine_count = 2
`;
const A320_LIVERY = `[VARIATION]
base_container = "..\\FlyByWire_A320_NEO"

[FLTSIM.0]
title = "FlyByWire Airbus A320neo Air France F-HEPH"
ui_variation = "Air France (F-HEPH)"
`;
const A320_BASE = `${A320_GENERAL}
[FLTSIM.0]
title = "FlyByWire Airbus A320neo"
ui_manufacturer = "Airbus"
ui_type = "A320neo"
`;

const cfgOf = (text: string, folder: string) => readAircraftCfg(text, folder);

test('parseCfg: quoted values, comments, keys in any case, several [FLTSIM.N] sections in order', () => {
  const s = parseCfg(PMDG);
  assert.deepEqual(s.map((x) => x.name), ['fltsim.0', 'fltsim.1']);
  assert.equal(s[0]!.values.title, 'PMDG 737-800 PMDG House (N738BW | 2022)');
  assert.equal(s[1]!.values.isuserselectable ?? s[1]!.values.isuserselectable, '1');
  const c = parseCfg('[GENERAL]\n; a comment\natc_model = "A; B" ; trailing\nicao_engine_count=2 ; two\nicao_WTC = H\n');
  assert.deepEqual(c[0]!.values, { atc_model: 'A; B', icao_engine_count: '2', icao_wtc: 'H' });
});

test('parseCfg: a byte order mark, CRLF line ends and lines before any section are tolerated', () => {
  const s = parseCfg('\uFEFFstray = 1\r\n[GENERAL]\r\nicao_type_designator = "C172"\r\n');
  assert.deepEqual(s, [{ name: 'general', values: { icao_type_designator: 'C172' } }]);
});

test('a jet bridge helper that declares B772 and two jet engines is not an aircraft: it is not user selectable', () => {
  const index = indexCfgs([cfgOf(JETWAY, 'ApronLife_JetwayHelper_H')]);
  const rec = index.get('apronlife_jetwayhelper_h')!;
  assert.equal(rec.icao, 'B772');
  assert.equal(rec.engineCount, 2);
  assert.equal(isFlyable(rec), false);
});

test('isFlyable: the documented rule, one case per clause', () => {
  const base = { title: 't', folder: 'f', manufacturer: 'm', model: 'x', icao: 'C172', category: 'airplane' as string | null, engineType: 'piston' as string | null, engineCount: 1 as number | null, generic: false, userSelectable: undefined as boolean | undefined, airTraffic: undefined as boolean | undefined };
  assert.equal(isFlyable(base), true, 'no flag at all: selectable');
  assert.equal(isFlyable({ ...base, userSelectable: false }), false);
  assert.equal(isFlyable({ ...base, airTraffic: true }), false, 'a traffic model without an explicit isUserSelectable');
  assert.equal(isFlyable({ ...base, airTraffic: true, userSelectable: true }), true, 'explicitly selectable wins');
  assert.equal(isFlyable({ ...base, generic: true }), false);
  assert.equal(isFlyable({ ...base, engineCount: 0 }), false);
  assert.equal(isFlyable({ ...base, engineType: 'none' }), false);
  assert.equal(isFlyable({ ...base, category: 'glider' }), false);
  assert.equal(isFlyable({ ...base, category: 'helicopter' }), true);
  assert.equal(isFlyable({ ...base, category: null, engineType: null, engineCount: null }), true, 'a cfg that says nothing is trusted');
});

test('a variation takes what it lacks from its base container (folder named by base_container)', () => {
  const index = indexCfgs([cfgOf(FSLTL_VARIATION, 'FSLTL_A332_MEA'), cfgOf(FSLTL_BASE, 'FSLTL_A332')]);
  const v = index.get('fsltl_tfs_a332_cedar_jet')!;
  assert.equal(v.icao, 'A332');
  assert.equal(v.engineCount, 2, 'engines come from the base [GENERAL]');
  assert.equal(v.folder, 'FSLTL_A332');
  assert.equal(isFlyable(v), false);

  const livery = indexCfgs([cfgOf(A320_LIVERY, 'liv'), cfgOf(A320_BASE, 'FlyByWire_A320_NEO')]).get('flybywire airbus a320neo air france f-heph')!;
  assert.deepEqual([livery.manufacturer, livery.model, livery.icao, livery.folder], ['Airbus', 'A320neo', 'A20N', 'FlyByWire_A320_NEO']);
  assert.equal(isFlyable(livery), true);
});

test('a modular aircraft (no top-level aircraft.cfg) is read from common/config and its presets', () => {
  const common = cfgOf('[GENERAL]\nCategory = "Airplane"\nicao_type_designator = B77L\nicao_engine_count=2\nicao_engine_type = "Jet"\nicao_manufacturer = "Boeing"\n', 'PMDG 777F');
  const preset = cfgOf('[fltsim.0]\ntitle = "PMDG 777F House"\nui_manufacturer = "Boeing"\nui_type = "777F"\nisuserselectable = 1\n', 'House');
  const rec = indexCfgs([mergeModular('PMDG 777F', common, [preset])]).get('pmdg 777f house')!;
  assert.deepEqual([rec.icao, rec.manufacturer, rec.model, rec.engineCount, rec.userSelectable], ['B77L', 'Boeing', '777F', 2, true]);
});

test('buildSimAircraft: liveries fold into one entry per model, official titles without a cfg stay, non-aircraft go', () => {
  const index = indexCfgs([cfgOf(JETWAY, 'jw'), cfgOf(PMDG, 'PMDG 737-800'), cfgOf(A320_BASE, 'FlyByWire_A320_NEO'), cfgOf(A320_LIVERY, 'liv')]);
  const listing: Listing[] = [
    { title: 'Cessna 172 Skyhawk (Asobo)', livery: 'Livery A' }, { title: 'Cessna 172 Skyhawk (Asobo)', livery: 'Livery B' }, { title: 'Cessna 172 Skyhawk (Asobo)', livery: '' },
    { title: 'Airbus A320neo (Asobo)', livery: '' },
    { title: 'ApronLife_JetwayHelper_H', livery: '' }, { title: 'ApronLife_JetwayHelper_H AAL', livery: '' },
    { title: 'PMDG 737-800 PMDG House (N738BW | 2022)', livery: '' }, { title: 'PMDG 737-800 PMDG House (N738SW | 2022)', livery: '' },
    { title: 'FlyByWire Airbus A320neo', livery: '' }, { title: 'FlyByWire Airbus A320neo Air France F-HEPH', livery: '' },
  ];
  const { entries, stats } = buildSimAircraft(listing, index, 2000);
  assert.deepEqual(stats, { listed: 10, dropped: 2, invalid: 0, cut: 0 });
  assert.deepEqual(entries.map((e) => [e.title, e.icao, e.source, e.liveries]), [
    ['Airbus A320neo (Asobo)', null, 'official', 1],
    ['Cessna 172 Skyhawk (Asobo)', null, 'official', 3],
    ['FlyByWire Airbus A320neo', 'A20N', 'community', 2],
    ['PMDG 737-800 PMDG House (N738BW | 2022)', null, 'community', 2],
  ]);
  assert.ok(!entries.some((e) => /jetway/i.test(e.title)));
});

test('buildSimAircraft: the entry is capped at max and an entry the server would refuse is counted, not sent', () => {
  const listing: Listing[] = Array.from({ length: 5 }, (_, i) => ({ title: `Plane ${i}`, livery: '' }));
  listing.push({ title: 'x'.repeat(300), livery: '' });
  const r = buildSimAircraft(listing, new Map(), 3);
  assert.equal(r.entries.length, 3);
  assert.deepEqual(r.stats, { listed: 6, dropped: 0, invalid: 1, cut: 2 });
});
