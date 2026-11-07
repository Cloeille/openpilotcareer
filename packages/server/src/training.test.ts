import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DAY_MS, INSTRUCTOR_PAY_PCT, OVERDRAFT_LIMIT, RETIREMENT_AGE, ROLE_INSTRUCTOR, SEATS_PER_INSTRUCTOR, TRAINING_COURSE, TRAINING_INHOUSE_DAYS_FACTOR, TRAINING_INHOUSE_FACTOR, birthYearOf, retirementAt,
  type RetrainResult, type RetrainView, type StaffDetail, type StaffOverview, type TrainResult, type TrainingView,
} from '@opc/shared';
import { all, get, MIGRATIONS, openDb, run } from './db.ts';
import { insertAircraft } from './fleet-extras.ts';
import { harness } from './harness.ts';
import { crewShortage } from './staff.ts';

const V1 = '/api/v1';
const OUTSIDE = TRAINING_COURSE['jet-airliner'];
const OWN = { cost: Math.round(OUTSIDE.cost * TRAINING_INHOUSE_FACTOR), days: Math.ceil(OUTSIDE.days * TRAINING_INHOUSE_DAYS_FACTOR) };

/** A player at LFMN with an AT76 and an A320 in her fleet, rich. Pilots are rows made by hand (`pilot`): the market and the clock are not what these tests are about. */
async function world() {
  const h = await harness();
  const u = await h.register('amy', 'LFMN');
  const cid = u.me.company.id as number;
  for (const icao of ['AT76', 'A320']) insertAircraft(h.db, { companyId: cid, icao, hub: 'LFMN', value: 1_000_000, ownership: 'owned', at: h.clock.t });
  run(h.db, 'UPDATE companies SET balance = 20000000 WHERE id = ?', cid);
  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: unknown) => h.call(method, `${V1}${url}`, { token: u.token, ...(body === undefined ? {} : { body }) });
  const pilot = (o: { role?: string; quals?: string[]; birth?: number | null; base?: string; contract?: 'cdi' | 'cdd'; family?: string; salary?: number } = {}): number => {
    const id = run(h.db, `INSERT INTO staff (company_id, family, name, role, base, hired_at, starts_at, salary, experience, reliability, morale, contract, birth_year) VALUES (?, ?, ?, ?, ?, 0, 0, ?, 5000, 80, 80, ?, ?)`,
      cid, o.family ?? 'pilot', `P${Math.random().toString(36).slice(2, 6)}`, o.role ?? 'captain', o.base ?? 'LFMN', o.salary ?? 10_000, o.contract ?? 'cdi', o.birth === undefined ? 1980 : o.birth).id;
    for (const q of o.quals ?? ['AT76']) run(h.db, 'INSERT INTO staff_quals (staff_id, type_icao, valid_from) VALUES (?, ?, 0)', id, q);
    return id;
  };
  const centre = async () => {
    const plan = (await call('GET', '/hubs/LFMN/plan')).body.buildings as { slot: string; facilityId: number }[];
    const r = await call('POST', `/facilities/${plan.find((b) => b.slot === 'TC')!.facilityId}/lease`, {});
    assert.equal(r.status, 201, r.text);
  };
  const warp = (t: number): void => { h.clock.t = t; run(h.db, 'UPDATE sessions SET expires_at = ?', t + 1_000_000_000); };
  const balance = () => get<{ balance: number }>(h.db, 'SELECT balance FROM companies WHERE id = ?', cid)!.balance;
  const view = async () => (await call('GET', '/training')).body as TrainingView;
  const book = (staffId: number, place: 'own' | 'outside', type = 'A320') => call('POST', '/training/courses', { staffId, type, place });
  const tx = (kind: string) => all<{ amount: number; memo: string }>(h.db, 'SELECT amount, memo FROM transactions WHERE company_id = ? AND kind = ? ORDER BY id', cid, kind);
  return { h, u, cid, call, pilot, centre, balance, view, book, tx, warp };
}

// ---------------------------------------------------------------- migration

test('the migration adds birth_year to every staff row, deterministic per id and equal to the shared formula, and a course table that follows its company', () => {
  const at = MIGRATIONS.findIndex((m) => m.includes('training_courses'));
  assert.ok(at > 0, 'found by content, not by position');
  const file = join(mkdtempSync(join(tmpdir(), 'opc-training-')), 'prev.sqlite');
  const raw = new DatabaseSync(file);
  for (let i = 0; i < at; i++) raw.exec(MIGRATIONS[i]!);
  raw.exec(`PRAGMA user_version = ${at}`);
  const hired = Date.UTC(2026, 5, 1);
  raw.exec(`INSERT INTO users (id, username, pass_hash, created_at) VALUES (1, 'a', 'h', 1);
    INSERT INTO companies (id, user_id, name, balance, reputation, created_at) VALUES (1, 1, 'A Air', 1, 50, 1);`);
  const people = [
    { id: 1, family: 'pilot', experience: 0 }, { id: 2, family: 'pilot', experience: 4_200 }, { id: 3, family: 'pilot', experience: 14_200 },
    { id: 4, family: 'cabin', experience: 3 }, { id: 5, family: 'kitchen', experience: 19 }, { id: 9, family: 'maintenance', experience: 40 }, { id: 10, family: 'pilot', experience: 30_000 },
  ] as const;
  for (const p of people) raw.exec(`INSERT INTO staff (id, company_id, family, name, role, base, hired_at, starts_at, salary, experience, reliability, morale) VALUES (${p.id}, 1, '${p.family}', 'n${p.id}', 'x', 'LFMN', ${hired}, 0, 1000, ${p.experience}, 80, 80)`);
  raw.close();
  const db = openDb(file);
  assert.equal(get<{ user_version: number }>(db, 'PRAGMA user_version')!.user_version, MIGRATIONS.length);
  const rows = all<{ id: number; birth_year: number }>(db, 'SELECT id, birth_year FROM staff ORDER BY id');
  assert.deepEqual(rows.map((r) => r.birth_year), people.map((p) => birthYearOf({ ...p, hiredAt: hired })), 'the SQL backfill and the shared rule give the same year for everybody');
  assert.ok(rows.every((r) => 2026 - r.birth_year < RETIREMENT_AGE - 4), 'nobody is hired within four years of the retirement');
  assert.equal(new Set(rows.map((r) => r.birth_year)).size > 3, true, 'the spread by id and experience gives different years');
  // the same file opened again changes nothing: the backfill ran once
  db.close();
  assert.deepEqual(all<{ birth_year: number }>(openDb(file), 'SELECT birth_year FROM staff ORDER BY id').map((r) => r.birth_year), rows.map((r) => r.birth_year));
  const again = openDb(':memory:');
  run(again, "INSERT INTO users (id, username, pass_hash, created_at) VALUES (1, 'a', 'h', 1)");
  run(again, "INSERT INTO companies (id, user_id, name, balance, reputation, created_at) VALUES (1, 1, 'A Air', 1, 50, 1)");
  const sid = run(again, "INSERT INTO staff (company_id, family, name, role, base, hired_at, starts_at, salary, reliability, morale) VALUES (1, 'pilot', 'n', 'captain', 'LFMN', 1, 0, 1, 80, 80)").id;
  run(again, "INSERT INTO training_courses (company_id, staff_id, type_icao, base, place, start_at, end_at, cost) VALUES (1, ?, 'AT76', 'LFMN', 'own', 1, 2, 5)", sid);
  assert.throws(() => run(again, "INSERT INTO training_courses (company_id, staff_id, type_icao, base, place, start_at, end_at, cost) VALUES (1, ?, 'AT76', 'LFMN', 'abroad', 1, 2, 5)", sid), /CHECK/);
  run(again, 'DELETE FROM companies WHERE id = 1');
  assert.equal(get<{ n: number }>(again, 'SELECT COUNT(*) AS n FROM training_courses')!.n, 0);
});

test('a person hired through the market gets a birth year at once, the same as the formula says', async () => {
  const w = await world();
  const list = (await w.call('GET', '/staff/candidates?family=pilot&qual=AT76')).body;
  const c = list.candidates[0];
  const r = await w.call('POST', '/staff/hire', { candidateId: c.id });
  assert.equal(r.status, 201, r.text);
  const row = get<{ id: number; birth_year: number; hired_at: number }>(w.h.db, 'SELECT id, birth_year, hired_at FROM staff WHERE candidate_id = ?', c.id)!;
  assert.equal(row.birth_year, birthYearOf({ id: row.id, family: 'pilot', experience: c.experience, hiredAt: row.hired_at }));
  assert.equal(r.body.member.age, 2026 - row.birth_year);
});

// ---------------------------------------------------------------- the centre: price, duration, capacity

test('the centre makes the same course cheaper and shorter; outside stays the server\'s price (24 000 euros, 21 days, not the mockup\'s 42 000 and 18); every course is recorded', async () => {
  const w = await world();
  await w.centre();
  const instructor = w.pilot({ role: ROLE_INSTRUCTOR, quals: ['AT76', 'A320'] });
  const a = w.pilot(), b = w.pilot();
  const before = w.balance();

  const outside = await w.book(a, 'outside');
  assert.equal(outside.status, 201, outside.text);
  const o = outside.body as TrainResult;
  assert.deepEqual([o.place, o.cost, o.days, o.saved], ['outside', 24_000, 21, 0]);
  assert.equal(o.until, w.h.clock.t + 21 * DAY_MS);
  assert.equal(w.balance(), before - 24_000);

  const own = await w.book(b, 'own');
  assert.equal(own.status, 201, own.text);
  const n = own.body as TrainResult;
  assert.deepEqual([n.place, n.cost, n.days, n.saved], ['own', 14_400, 16, 9_600]);
  assert.deepEqual([n.cost, n.days], [OWN.cost, OWN.days]);
  assert.equal(n.until, w.h.clock.t + 16 * DAY_MS, 'the person is back sooner');
  assert.equal(w.balance(), before - 24_000 - 14_400);
  assert.deepEqual(w.tx('training').map((t) => t.amount), [-24_000, -14_400], 'both go through the ledger');
  assert.match(w.tx('training')[1]!.memo, /training centre/);
  assert.equal(n.member.state, 'training');

  const v = await w.view();
  assert.equal(v.savedYear, 9_600, 'only the own course saved anything');
  assert.equal(v.running, 2);
  assert.deepEqual(v.courses.map((c) => [c.place, c.cost, c.saved, c.running]).sort(), [['outside', 24_000, 0, true], ['own', 14_400, 9_600, true]]);
  assert.deepEqual(v.instructors.map((i) => i.staffId), [instructor]);
  assert.equal(v.centres[0]!.monthly, 12_000, 'the centre costs its rent a month');
  assert.equal((await w.book(b, 'own')).body.error, 'already_qualified', 'a course is not taken twice');
});

test('the centre\'s capacity: it needs the building, an instructor who holds the type, and a seat; the seats are the instructors\' and come back when a course ends', async () => {
  const w = await world();
  const [a, b, c, d, e] = [w.pilot(), w.pilot(), w.pilot(), w.pilot(), w.pilot()];
  const refusal = async (id: number) => { const r = await w.book(id, 'own'); assert.equal(r.status, 409, r.text); return r.body.error as string; };
  assert.equal(await refusal(a), 'no_training_centre', 'no building');
  assert.equal(w.balance(), 20_000_000, 'a refusal charges nothing');
  assert.equal(get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM training_courses')!.n, 0, 'and books nothing');

  await w.centre();
  assert.equal(await refusal(a), 'no_instructor', 'a building without a teacher');
  w.pilot({ role: ROLE_INSTRUCTOR, quals: ['AT76'] });
  assert.equal(await refusal(a), 'no_instructor', 'an instructor who does not hold the type teaches nobody on it');
  const v0 = await w.view();
  assert.ok(v0.offers.filter((o) => o.type === 'A320').every((o) => o.ownWhy === 'no_instructor'), 'every offer says why the centre cannot take it');

  w.pilot({ role: ROLE_INSTRUCTOR, quals: ['AT76', 'A320'] });
  assert.deepEqual((await w.view()).centres[0], { hub: 'LFMN', instructors: 2, seats: 2 * SEATS_PER_INSTRUCTOR, used: 0, monthly: 12_000 });
  for (const id of [a, b, c, d]) assert.equal((await w.book(id, 'own')).status, 201);
  assert.equal(await refusal(e), 'centre_full', 'four seats for two instructors: the fifth is turned away');
  assert.equal((await w.view()).centres[0]!.used, 4);
  assert.equal(get<{ n: number }>(w.h.db, "SELECT COUNT(*) AS n FROM training_courses WHERE place = 'own'")!.n, 4, 'the refusal booked nothing');
});

test('seats are exactly SEATS_PER_INSTRUCTOR per instructor employed at the hub; a course frees its seat the day it ends; another hub\'s pilots are not served', async () => {
  const w = await world();
  await w.centre();
  w.pilot({ role: ROLE_INSTRUCTOR, quals: ['AT76', 'A320'] });
  const people = Array.from({ length: SEATS_PER_INSTRUCTOR + 1 }, () => w.pilot());
  for (const id of people.slice(0, SEATS_PER_INSTRUCTOR)) assert.equal((await w.book(id, 'own')).status, 201);
  const last = people[SEATS_PER_INSTRUCTOR]!;
  assert.equal((await w.book(last, 'own')).body.error, 'centre_full');
  assert.equal((await w.view()).offers.find((o) => o.staffId === last && o.type === 'A320')!.ownWhy, 'centre_full');
  assert.equal((await w.book(last, 'outside')).status, 201, 'outside has no seat limit');

  const other = w.pilot({ base: 'LFPG' });
  assert.equal((await w.book(other, 'own')).body.error, 'no_training_centre', 'the centre serves the pilots of its own hub');

  w.h.clock.t += OWN.days * DAY_MS - 1;
  assert.equal((await w.view()).running > 0, true);
  const stillFull = await w.book(w.pilot(), 'own');
  assert.equal(stillFull.body.error, 'centre_full', 'one millisecond before the end the seats are taken');
  w.h.clock.t += 1;
  const freed = await w.book(w.pilot(), 'own');
  assert.equal(freed.status, 201, freed.text);
});

test('an instructor who left (or has not started) gives no seat, and the plain staff route trains outside by default', async () => {
  const w = await world();
  await w.centre();
  const teacher = w.pilot({ role: ROLE_INSTRUCTOR, quals: ['AT76', 'A320'] });
  const p = w.pilot();
  run(w.h.db, 'UPDATE staff SET ends_at = ? WHERE id = ?', w.h.clock.t - 1, teacher);
  assert.equal((await w.book(p, 'own')).body.error, 'no_instructor');
  const r = await w.call('POST', `/staff/${p}/train`, { type: 'A320' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.body.place, r.body.cost, r.body.days], ['outside', 24_000, 21], 'the member sheet\'s door is unchanged');
  const q = w.pilot();
  run(w.h.db, 'UPDATE staff SET ends_at = NULL, starts_at = ? WHERE id = ?', w.h.clock.t + DAY_MS, teacher);
  assert.equal((await w.call('POST', `/staff/${q}/train`, { type: 'A320', place: 'own' })).body.error, 'no_instructor', 'the plain route can take the centre too');
});

test('the centre is a facility of the catalogue: leased like the kitchen hall, one level, and its rent reaches the hub\'s monthly cost', async () => {
  const w = await world();
  const plan = (await w.call('GET', '/hubs/LFMN/plan')).body.buildings as { slot: string; effect: string; rent: number; owner: string; facilityId: number }[];
  const tc = plan.find((b) => b.slot === 'TC')!;
  assert.deepEqual([tc.effect, tc.rent, tc.owner], ['training', 12_000, 'available']);
  const detail = (await w.call('GET', `/facilities/${tc.facilityId}`)).body;
  assert.equal(detail.levels.length, 1);
  assert.equal((await w.call('POST', `/facilities/${tc.facilityId}/lease`, { level: 2 })).body.error, 'invalid_level');
  await w.centre();
  const hub = ((await w.call('GET', '/hubs/overview')).body.hubs as { icao: string; facilities: { slot: string; owner: string; monthly: number }[] }[])[0]!;
  assert.deepEqual(hub.facilities.filter((f) => f.slot === 'TC').map((f) => [f.owner, f.monthly]), [['player', 12_000]]);
});

// ---------------------------------------------------------------- retirement (C26), injected clock

test('everybody retires on the 1st of January of the year they turn 65, an instructor at 70; the sweep is deterministic from the clock', async () => {
  const w = await world();
  const young = w.pilot({ birth: 1990 });
  const turns65Jan2027 = w.pilot({ birth: 1962 });
  const turns65Jan2026 = w.pilot({ birth: 1961 });
  const unknown = w.pilot({ birth: null });
  const teacher = w.pilot({ birth: 1961, role: ROLE_INSTRUCTOR });
  const ends = () => Object.fromEntries(all<{ id: number; ends_at: number | null }>(w.h.db, 'SELECT id, ends_at FROM staff WHERE id IN (?, ?, ?, ?, ?)', young, turns65Jan2027, turns65Jan2026, unknown, teacher).map((r) => [r.id, r.ends_at]));

  assert.equal(retirementAt(1962, 'captain'), Date.UTC(2027, 0, 1));
  assert.equal(retirementAt(1961, ROLE_INSTRUCTOR), Date.UTC(2031, 0, 1), 'an instructor teaches on to 70');
  assert.equal(retirementAt(null, 'captain'), null);

  await w.call('GET', '/staff');
  assert.deepEqual(ends(), { [young]: null, [turns65Jan2027]: null, [turns65Jan2026]: Date.UTC(2026, 0, 1), [unknown]: null, [teacher]: null }, 'on 4 Nov 2026 the 1961 pilot is past 65 and leaves as of 1 Jan 2026, the rest stay');
  const o = (await w.call('GET', '/staff')).body as StaffOverview;
  assert.equal(o.people, 4);
  assert.equal((await w.call('GET', `/staff/${turns65Jan2026}`)).body.member.state, 'left');

  w.warp(Date.UTC(2026, 11, 31, 23, 59, 59));
  await w.call('GET', '/staff');
  assert.equal(ends()[turns65Jan2027], null, 'the last second of the year he is 64 on the books');
  const d = (await w.call('GET', `/staff/${turns65Jan2027}`)).body as StaffDetail;
  assert.deepEqual([d.member.age, d.member.retiresAt], [64, Date.UTC(2027, 0, 1)]);

  w.warp(Date.UTC(2027, 0, 1));
  await w.call('GET', '/staff');
  assert.equal(ends()[turns65Jan2027], Date.UTC(2027, 0, 1), 'the first instant of the year he is retired, with no pay and no seat');
  assert.equal(ends()[young], null);
  assert.equal(ends()[unknown], null, 'nobody retires from an unknown birth year');
  assert.equal(ends()[teacher], null, 'the instructor of the same age is still here');
  const again = ends();
  await w.call('GET', '/staff');
  assert.deepEqual(ends(), again, 'running the sweep again changes nothing');

  w.warp(Date.UTC(2031, 0, 1));
  await w.call('GET', '/staff');
  assert.equal(ends()[teacher], Date.UTC(2031, 0, 1));
});

test('a retired captain is no longer crew: the line check does not count him and he is not paid', async () => {
  const w = await world();
  const captain = w.pilot({ birth: 1962, salary: 9_000 });
  const second = w.pilot({ birth: 1990 });
  const crew = () => crewShortage(w.h.db, w.cid, ['AT76'], ['LFMN', 'LFML'], w.h.clock.t).filter((s) => s.family === 'pilot').map((s) => s.have);
  assert.deepEqual(crew(), []);
  w.warp(Date.UTC(2027, 0, 2));
  await w.call('GET', '/staff');
  assert.deepEqual(crew(), [1], 'one pilot left of the two a flight deck needs');
  assert.equal(get<{ ends_at: number }>(w.h.db, 'SELECT ends_at FROM staff WHERE id = ?', captain)!.ends_at, Date.UTC(2027, 0, 1));
  assert.ok(second);
});

// ---------------------------------------------------------------- reconversion

test('a captain becomes an instructor: role and pay change, his ratings stay, and he leaves the line crews and the pilot counts', async () => {
  const w = await world();
  const cap = w.pilot({ salary: 11_400, quals: ['AT76', 'A320'], birth: 1962 });
  const fo = w.pilot({ role: 'fo' });
  const before = (await w.call('GET', '/staff')).body as StaffOverview;
  const pilots = (o: StaffOverview) => o.families.find((f) => f.family === 'pilot')!.headcount;
  assert.equal(pilots(before), 2);

  const v = (await w.call('GET', `/staff/${cap}/retrain`)).body as RetrainView;
  assert.equal(v.why, null);
  assert.deepEqual(v.offer, { salary: 9_100, retiresAt: Date.UTC(2032, 0, 1), types: ['A320', 'AT76'], seats: SEATS_PER_INSTRUCTOR, centre: false });
  assert.equal(v.offer!.salary, Math.round((11_400 * INSTRUCTOR_PAY_PCT) / 100 / 50) * 50);
  assert.deepEqual([v.age, v.inWindow], [2026 - 1962, true], 'he turns 65 within the year: the screen opens');
  assert.deepEqual(v.gap.map((g) => [g.type, g.have]), [['A320', 1], ['AT76', 2]], 'who flies each type at his base, him included');

  assert.equal((await w.call('GET', `/staff/${fo}/retrain`)).body.why, 'not_a_captain');
  assert.equal((await w.call('GET', `/staff/${fo}/retrain`)).body.offer, null);

  const r = await w.call('POST', `/staff/${cap}/retrain`, { option: 'instructor' });
  assert.equal(r.status, 200, r.text);
  const done = r.body as RetrainResult;
  assert.deepEqual([done.member.role, done.salary, done.member.salary, done.member.quals.join()], [ROLE_INSTRUCTOR, 9_100, 9_100, 'A320,AT76']);
  assert.equal(done.member.retiresAt, Date.UTC(2032, 0, 1), 'his retirement moves to 70');

  const after = (await w.call('GET', '/staff')).body as StaffOverview;
  assert.equal(pilots(after), 1, 'an instructor is not line crew');
  assert.equal(crewShortage(w.h.db, w.cid, ['AT76'], ['LFMN', 'LFML'], w.h.clock.t)[0]!.have, 1);
  assert.equal(get<{ n: number }>(w.h.db, "SELECT COUNT(*) AS n FROM staff WHERE role = 'instructor'")!.n, 1);
  assert.equal((await w.call('POST', `/staff/${cap}/retrain`, { option: 'instructor' })).body.error, 'already_instructor');
  assert.equal((await w.call('GET', `/staff/${cap}/retrain`)).body.why, 'already_instructor');
  assert.equal(w.balance(), 20_000_000, 'the conversion costs nothing: the pay is what changes');
});

test('who can be made an instructor: a captain with a rating on a permanent contract; the refusals name why and change nothing', async () => {
  const w = await world();
  const noRating = w.pilot({ quals: [] }), temp = w.pilot({ contract: 'cdd' }), cabin = w.pilot({ family: 'cabin', role: 'attendant', quals: [] }), fo = w.pilot({ role: 'fo' });
  const err = async (id: number) => { const r = await w.call('POST', `/staff/${id}/retrain`, { option: 'instructor' }); return [r.status, r.body.error]; };
  assert.deepEqual(await err(noRating), [409, 'no_rating']);
  assert.deepEqual(await err(temp), [409, 'temporary_contract']);
  assert.deepEqual(await err(cabin), [422, 'not_a_pilot']);
  assert.deepEqual(await err(fo), [409, 'not_a_captain']);
  const spare = w.pilot({ birth: 1999 });
  assert.equal((await w.call('POST', `/staff/${spare}/retrain`, { option: 'chief_pilot' })).status, 400, 'only the modelled option');
  assert.equal(get<{ n: number }>(w.h.db, "SELECT COUNT(*) AS n FROM staff WHERE role = 'instructor'")!.n, 0);
  const younger = w.pilot({ birth: 1985 }), older = w.pilot({ birth: 1962 }), mid = w.pilot({ birth: 1970 });
  const v = await w.view();
  assert.deepEqual(v.convertible.map((c) => c.staffId), [older, mid, younger, spare], 'only the captains who can be converted, soonest retirement first');
  assert.deepEqual(v.convertible.map((c) => c.inWindow), [true, false, false, false]);
});

test('a captain who is flying right now is converted once his duty is over', async () => {
  const w = await world();
  const cap = w.pilot();
  run(w.h.db, "INSERT INTO staff_duty (staff_id, leg_id, day, flight_no, dep_at, arr_at, origin, dest, duty_start, duty_min, flight_min) VALUES (?, NULL, 1, 1, ?, ?, 'LFMN', 'LFML', ?, 60, 40)", cap, w.h.clock.t - 1_800_000, w.h.clock.t + 1_800_000, w.h.clock.t - 3_600_000);
  assert.equal((await w.call('POST', `/staff/${cap}/retrain`, { option: 'instructor' })).body.error, 'on_duty');
  w.h.clock.t += 2 * 3_600_000;
  assert.equal((await w.call('POST', `/staff/${cap}/retrain`, { option: 'instructor' })).status, 200);
});

// ---------------------------------------------------------------- auth

test('the training routes need a signed-in player and are scoped to her company: other people\'s pilots are 404, other companies 403, an API key 401', async () => {
  const w = await world();
  const mine = w.pilot();
  assert.equal((await w.h.call('GET', `${V1}/training`)).status, 401);
  assert.equal((await w.h.call('POST', `${V1}/training/courses`, { body: { staffId: mine, type: 'A320', place: 'outside' } })).status, 401);
  assert.equal((await w.h.call('GET', `${V1}/staff/${mine}/retrain`)).status, 401);
  assert.equal((await w.h.call('POST', `${V1}/staff/${mine}/retrain`, { body: { option: 'instructor' } })).status, 401);
  const key = await w.h.apiKey(w.u.token);
  for (const [m, url, body] of [['GET', '/training'], ['POST', '/training/courses', { staffId: mine, type: 'A320', place: 'outside' }], ['GET', `/staff/${mine}/retrain`], ['POST', `/staff/${mine}/retrain`, { option: 'instructor' }]] as const) {
    assert.equal((await w.h.call(m, `${V1}${url}`, { token: key, ...(body ? { body } : {}) })).status, 401, `${m} ${url} with an API key`);
  }

  const bob = await w.h.register('bob', 'LFMN');
  const bobCall = (m: 'GET' | 'POST', url: string, body?: unknown) => w.h.call(m, `${V1}${url}`, { token: bob.token, ...(body === undefined ? {} : { body }) });
  assert.equal((await bobCall('GET', `/staff/${mine}/retrain`)).status, 404, 'her pilot is not his');
  assert.equal((await bobCall('POST', `/staff/${mine}/retrain`, { option: 'instructor' })).status, 404);
  assert.equal((await bobCall('POST', '/training/courses', { staffId: mine, type: 'A320', place: 'outside' })).status, 404);
  assert.equal(get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM training_courses')!.n, 0);
  assert.equal(get<{ role: string }>(w.h.db, 'SELECT role FROM staff WHERE id = ?', mine)!.role, 'captain');
  assert.equal((await w.h.call('GET', `${V1}/training`, { token: bob.token, company: w.cid })).status, 403, 'her company through his session');
  assert.equal(((await bobCall('GET', '/training')).body as TrainingView).courses.length, 0, 'his own centre sees none of her courses');

  assert.equal((await w.call('POST', '/training/courses', { staffId: mine, type: 'A320', place: 'moon' })).status, 400);
  assert.equal((await w.call('POST', '/training/courses', { staffId: 0, type: 'A320', place: 'own' })).status, 400);
  assert.equal((await w.call('POST', '/training/courses', { staffId: mine, type: 'a320', place: 'own' })).status, 400);
  assert.equal((await w.call('GET', '/staff/abc/retrain')).status, 404);
  assert.equal((await w.call('GET', '/staff/99999/retrain')).status, 404);
  const poor = w.pilot();
  run(w.h.db, 'UPDATE companies SET balance = ? WHERE id = ?', -OVERDRAFT_LIMIT, w.cid);
  const refused = await w.book(poor, 'outside');
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'insufficient_funds');
  assert.equal(get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM training_courses')!.n, 0, 'a refused payment books no course');
});
