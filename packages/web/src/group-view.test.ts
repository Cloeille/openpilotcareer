import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GroupAircraft, GroupCompany, GroupView } from '@opc/shared';
import { FUNDING_STEP, cleanTransfer, emptyDraft, emptyTransfer, nextSub, requestOf, sides, stepCash, subsidiariesOf, toggleId, transferRequest } from './group-view.ts';

const ac = (id: number, cession: GroupAircraft['cession'] = null): GroupAircraft => ({ id, registration: `F-H${id}`, icao: 'AT76', location: 'LFMN', value: 1_000_000, cession });
const co = (id: number, role: GroupCompany['role'], fleet: GroupAircraft[] = []): GroupCompany => ({
  id, name: `Co ${id}`, code: 'CO' + id, iata: null, activity: role === 'parent' ? null : 'cargo', role, hub: 'LFMN', balance: 1000 * id, month: { revenue: 0, spend: 0, result: 0 }, aircraft: fleet.length, staff: 0, lines: 0, fleet,
});
const group = (...companies: GroupCompany[]): GroupView => ({ month: '2026-10', total: { revenue: 0, spend: 0, result: 0, balance: 0, netWorth: 0, aircraft: 0, staff: 0, lines: 0 }, companies, createRefusal: null });
const g = group(co(1, 'parent', [ac(10), ac(11, 'aircraft_busy')]), co(2, 'subsidiary', [ac(20)]), co(3, 'subsidiary', [ac(30)]));

test('cash steps by FUNDING_STEP and never goes below zero', () => {
  assert.equal(stepCash(0, 1), FUNDING_STEP);
  assert.equal(stepCash(0, -1), 0);
  assert.equal(stepCash(25_000, 1), 40_000, 'snaps to the grid on the way up');
  assert.equal(stepCash(FUNDING_STEP, -1), 0);
});

test('ticking an id twice unticks it', () => {
  assert.deepEqual(toggleId([1, 2], 3), [1, 2, 3]);
  assert.deepEqual(toggleId([1, 2, 3], 2), [1, 3]);
});

test('the new-subsidiary form builds the request the server\'s own schema accepts, and nothing before', () => {
  const d = { ...emptyDraft('LFMN'), name: 'Azur Cargo', code: 'azc', iata: '', funding: 150_000, aircraft: [10] };
  assert.deepEqual(requestOf(d), { name: 'Azur Cargo', hub: 'LFMN', code: 'AZC', activity: 'passengers', funding: 150_000, aircraftIds: [10] }, 'the code is upper-cased, an empty IATA is left out');
  assert.equal(requestOf({ ...d, iata: 'n7' })!.iata, 'N7');
  assert.equal(requestOf({ ...d, name: '' }), null);
  assert.equal(requestOf({ ...d, code: 'AZ' }), null);
  assert.equal(requestOf({ ...d, iata: 'N' }), null);
  assert.equal(requestOf({ ...d, hub: '' }), null);
  assert.equal(requestOf({ ...d, funding: -1 }), null);
  assert.equal(requestOf({ ...d, aircraft: [1, 1] }), null, 'the same aircraft twice');
});

test('a transfer goes parent to subsidiary, or the other way when reversed, to the chosen subsidiary', () => {
  assert.deepEqual([sides(g, { ...emptyTransfer(), sub: 3 })!.from.id, sides(g, { ...emptyTransfer(), sub: 3 })!.to.id], [1, 3]);
  assert.deepEqual([sides(g, { ...emptyTransfer(), sub: 3, reversed: true })!.from.id, sides(g, { ...emptyTransfer(), sub: 3, reversed: true })!.to.id], [3, 1]);
  assert.equal(sides(g, { ...emptyTransfer(), sub: 1 }), null, 'the parent is not a subsidiary');
  assert.equal(sides(group(co(1, 'parent')), emptyTransfer()), null, 'no subsidiary, no transfer');
});

test('the transfer request names both companies and moves something, or is null', () => {
  assert.equal(transferRequest(g, { ...emptyTransfer(), sub: 2 }), null);
  assert.deepEqual(transferRequest(g, { sub: 2, reversed: false, cash: 5_000, aircraft: [10] }), { from: 1, to: 2, cash: 5_000, aircraftIds: [10] });
  assert.deepEqual(transferRequest(g, { sub: 2, reversed: true, cash: 0, aircraft: [20] }), { from: 2, to: 1, cash: 0, aircraftIds: [20] });
});

test('a stale draft is cleaned to what is still true: a subsidiary that exists, aircraft the giver still holds and can cede', () => {
  assert.equal(cleanTransfer(g, emptyTransfer()).sub, 2, 'the first subsidiary when none is chosen');
  assert.equal(cleanTransfer(g, { ...emptyTransfer(), sub: 99 }).sub, 2, 'a deleted subsidiary');
  assert.deepEqual(cleanTransfer(g, { sub: 2, reversed: false, cash: 7, aircraft: [10, 11, 20, 99] }).aircraft, [10], 'the busy one, the other side\'s and an unknown aircraft are dropped');
  assert.deepEqual(cleanTransfer(g, { sub: 2, reversed: true, cash: 7, aircraft: [10, 20] }).aircraft, [20]);
  assert.equal(cleanTransfer(group(co(1, 'parent')), { ...emptyTransfer(), sub: 2 }).sub, null);
});

test('the next subsidiary wraps around', () => {
  assert.equal(nextSub(g, 2), 3);
  assert.equal(nextSub(g, 3), 2);
  assert.equal(nextSub(g, null), 2, 'from none: the first');
  assert.equal(nextSub(group(co(1, 'parent')), null), null);
  assert.deepEqual(subsidiariesOf(g).map((c) => c.id), [2, 3]);
});
