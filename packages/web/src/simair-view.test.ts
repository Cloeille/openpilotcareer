import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AircraftType, SimAircraftList, SimAircraftView } from '@opc/shared';
import { filterIsOn, filterRows, narrow, offersOf, rowsOf, summaryOf, titlesLabel } from './simair-view.ts';

const type = (icao: string, name: string, over: Partial<AircraftType> = {}): AircraftType => ({ icao, name, category: 'jet-airliner', engines: 2, wtc: 'M', seats: 150, cargoKg: 3000, cruiseKts: 450, rangeNm: 2800, derived: false, ...over });
const a = (title: string, icao: string | null, over: Partial<SimAircraftView> = {}): SimAircraftView => ({ title, icao, manual: false, manufacturer: '', model: '', source: 'official', liveries: 1, hidden: false, ...over });
const list = (aircraft: SimAircraftView[], types: AircraftType[]): SimAircraftList => ({ scannedAt: 1, aircraft, types });
const A20N = type('A20N', 'Airbus A320neo');
const C172 = type('C172', 'Cessna 172 Skyhawk', { category: 'piston-single', engines: 1, wtc: 'L', seats: 4 });
const XXX1 = type('XXX1', 'XXX1', { derived: true, category: 'other' });

test('offers: one per type she can fly, shown by its simulator titles; hidden entries and entries without a designator are not offered', () => {
  const offers = offersOf(list([a('FlyByWire A320neo', 'A20N', { source: 'community' }), a('Airbus A320neo (Asobo)', 'A20N'), a('Cessna 172 Skyhawk (Asobo)', 'C172'), a('Hidden one', 'C172', { hidden: true }), a('Mystery', null), a('Mod', 'XXX1')], [A20N, C172, XXX1]));
  assert.deepEqual(offers.map((o) => [o.type.icao, o.titles, o.estimated]), [['A20N', ['FlyByWire A320neo', 'Airbus A320neo (Asobo)'], false], ['C172', ['Cessna 172 Skyhawk (Asobo)'], false], ['XXX1', ['Mod'], true]]);
});

test('a type the company defined itself takes its own numbers and is not an estimate; a designator the server sent no type for is not offered', () => {
  const mine = type('XXX1', 'My mod', { seats: 9 });
  const offers = offersOf(list([a('Mod', 'XXX1'), a('Ghost', 'GHST')], [XXX1]), [mine]);
  assert.deepEqual(offers.map((o) => [o.type.name, o.type.seats, o.estimated]), [['My mod', 9, false]]);
});

test('no list (never scanned, or the server cannot say) offers nothing', () => {
  assert.deepEqual(offersOf(null), []);
  assert.deepEqual(offersOf(list([], [])), []);
});

test('the filter is on by default when there is something to filter by, off when the player chose "all", never on over an empty list', () => {
  const offers = offersOf(list([a('x', 'C172')], [C172]));
  assert.equal(filterIsOn(null, offers), true);
  assert.equal(filterIsOn('mine', offers), true);
  assert.equal(filterIsOn('all', offers), false);
  assert.equal(filterIsOn(null, []), false);
  assert.equal(filterIsOn('mine', []), false);
});

test('narrow: by type name, designator or simulator title, and by category tab', () => {
  const offers = offersOf(list([a('FlyByWire A320neo', 'A20N'), a('Cessna 172 Skyhawk (Asobo)', 'C172')], [A20N, C172]));
  assert.deepEqual(narrow(offers, '', 'all').map((o) => o.type.icao), ['A20N', 'C172']);
  assert.deepEqual(narrow(offers, 'a20', 'all').map((o) => o.type.icao), ['A20N']);
  assert.deepEqual(narrow(offers, 'skyhawk', 'all').map((o) => o.type.icao), ['C172']);
  assert.deepEqual(narrow(offers, 'flybywire', 'all').map((o) => o.type.icao), ['A20N']);
  assert.deepEqual(narrow(offers, '', 'piston').map((o) => o.type.icao), ['C172']);
  assert.deepEqual(narrow(offers, '', 'helicopter'), []);
});

test('titlesLabel names the first title and counts the others', () => {
  assert.equal(titlesLabel([]), '');
  assert.equal(titlesLabel(['A']), 'A');
  assert.equal(titlesLabel(['A', 'B', 'C']), 'A +2');
});

test('settings rows: offered, hidden, or no type; the summary counts them and the sources', () => {
  const rows = rowsOf(list([a('A', 'A20N', { manufacturer: 'Airbus', model: 'A320neo', source: 'community' }), a('B', 'C172', { hidden: true }), a('C', null), a('D', 'XXX1')], [A20N, C172, XXX1]));
  assert.deepEqual(rows.map((r) => [r.title, r.state, r.estimated, r.detail]), [['A', 'offered', false, 'Airbus A320neo'], ['B', 'hidden', false, ''], ['C', 'noType', false, ''], ['D', 'offered', true, '']]);
  assert.deepEqual(summaryOf(rows), { total: 4, offered: 2, hidden: 1, noType: 1, official: 3, community: 1 });
});

test('the "no type" filter keeps only the rows still to be typed; a type picked by hand shows as manual and counts as typed', () => {
  const rows = rowsOf(list([a('Fenix A320', 'A20N', { manual: true }), a('iniBuilds A350', null), a('Cessna', 'C172')], [A20N, C172]));
  assert.deepEqual(rows.map((r) => [r.title, r.manual, r.state]), [['Fenix A320', true, 'offered'], ['iniBuilds A350', false, 'noType'], ['Cessna', false, 'offered']]);
  assert.deepEqual(filterRows(rows, 'noType').map((r) => r.title), ['iniBuilds A350']);
  assert.deepEqual(filterRows(rows, 'all').map((r) => r.title), ['Fenix A320', 'iniBuilds A350', 'Cessna']);
  assert.equal(summaryOf(rows).noType, 1);
});

test('the buy filter offers an aircraft by its effective type: the one the player picked by hand, under its simulator title', () => {
  const list_ = list([a('Fenix A320', 'A20N', { manual: true }), a('Airbus A320neo (Asobo)', 'A20N'), a('iniBuilds A350', null), a('Cessna', 'C172')], [A20N, C172]);
  const offers = offersOf(list_);
  assert.deepEqual(offers.map((o) => [o.type.icao, o.titles]), [['A20N', ['Fenix A320', 'Airbus A320neo (Asobo)']], ['C172', ['Cessna']]]);
  assert.deepEqual(narrow(offers, 'fenix', 'all').map((o) => o.type.icao), ['A20N'], 'found by the title she knows it by');
  assert.deepEqual(offersOf(list([a('Fenix A320', null)], [])), [], 'cleared: not offered again');
});
