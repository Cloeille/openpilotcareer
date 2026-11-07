import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DUTY_MAX_MIN, DUTY_RELEASE_MIN, DUTY_REPORT_MIN, REST_POLICIES, TRAINING_COURSE, coverageOf, crewNeeded, crewTeams, dayIso, dayNo, dutyIncrementMin, dutyViolation, fatigueOf, interimPrice,
  isoDayNo, positionsFor, salaryFor, type DutyInput,
} from './index.ts';

const H = 3_600_000, MIN = 60_000;
const T0 = Date.UTC(2026, 10, 4, 6, 0);
const fresh = (over: Partial<DutyInput> = {}): DutyInput => ({ base: 'LFPG', dutyStart: null, lastEnd: null, lastAt: null, flight28Min: 0, flight12Min: 0, duty7Min: 0, streakDays: 0, dutyToday: false, ...over });
const leg = (depH: number, hours: number) => ({ dep: T0 + depH * H, arr: T0 + (depH + hours) * H });

test('crew need: two pilots, one attendant per 40 seats from 20 seats, a C172 flies with one pilot and nobody behind', () => {
  assert.deepEqual(crewNeeded(72), { pilots: 2, cabin: 2 }); // the ATR 72 of the mockup
  assert.deepEqual(crewNeeded(130), { pilots: 2, cabin: 4 }); // the A220 of the mockup
  assert.deepEqual(crewNeeded(4), { pilots: 1, cabin: 0 });
});

test('a rested pilot can fly; every duty rule names itself and by how much it is broken', () => {
  const p = REST_POLICIES.legal;
  assert.equal(dutyViolation(fresh(), leg(0, 2), p), null);
  // rest: landed at base 10 h ago, 12 h are needed between release and the next report (13.5 h from landing to departure with the 45 + 15 min margins)
  const landed = T0 - 10 * H;
  assert.deepEqual(dutyViolation(fresh({ dutyStart: landed - 2 * H, lastEnd: landed, lastAt: 'LFPG' }), leg(0, 2), p), { rule: 'rest', overBy: 12 * 60 - (10 * 60 - DUTY_REPORT_MIN - DUTY_RELEASE_MIN) });
  // away from base 10 h are enough: the same gap, 10 h rest + the margins
  assert.equal(dutyViolation(fresh({ dutyStart: landed - 12 * H, lastEnd: T0 - 11 * H, lastAt: 'LFLL' }), leg(0, 2), p), null);
  assert.equal(dutyViolation(fresh({ dutyStart: landed - 12 * H, lastEnd: T0 - 11 * H, lastAt: 'LFPG' }), leg(0, 2), p)?.rule, 'rest');
  // busy: the previous leg has not landed
  assert.equal(dutyViolation(fresh({ dutyStart: T0 - H, lastEnd: T0 + H, lastAt: 'LFPG' }), leg(0, 2), p)?.rule, 'busy');
  // the 13 h daily limit: a duty period started 11 h earlier cannot take a 2 h leg after a 20 min break
  const start = T0 - 11 * H;
  assert.equal(dutyViolation(fresh({ dutyStart: start, lastEnd: T0 - 20 * MIN, lastAt: 'LFLL' }), leg(0, 2), p)?.rule, 'daily');
  assert.equal(dutyViolation(fresh({ dutyStart: start, lastEnd: T0 - 20 * MIN, lastAt: 'LFLL' }), leg(0, 1), p)?.rule, undefined);
  // 28 days, 12 months, 7 days
  assert.deepEqual(dutyViolation(fresh({ flight28Min: 99 * 60 }), leg(0, 2), p), { rule: 'flight28', overBy: 60 });
  assert.deepEqual(dutyViolation(fresh({ flight12Min: 899 * 60 }), leg(0, 2), p), { rule: 'flight12', overBy: 60 });
  assert.equal(dutyViolation(fresh({ duty7Min: 59 * 60 }), leg(0, 2), p)?.rule, 'week');
  // six duty days in a row: no seventh, unless the day already has duty
  assert.deepEqual(dutyViolation(fresh({ streakDays: 6 }), leg(0, 2), p), { rule: 'streak', overBy: 1 });
  assert.equal(dutyViolation(fresh({ streakDays: 6, dutyToday: true }), leg(0, 2), p), null);
  assert.equal(dutyViolation(fresh({ streakDays: 5 }), leg(0, 2), p), null);
});

test('a leg shortly after the last landing continues the duty period; the second one costs only the time since the landing', () => {
  const p = REST_POLICIES.legal;
  const s = fresh({ dutyStart: T0 - 3 * H, lastEnd: T0 - 30 * MIN, lastAt: 'LFLL' });
  assert.equal(dutyViolation(s, leg(0, 1.5), p), null);
  assert.equal(dutyIncrementMin(s, leg(0, 1.5)), 30 + 90);
  assert.equal(dutyIncrementMin(fresh(), leg(0, 1.5)), DUTY_REPORT_MIN + 90 + DUTY_RELEASE_MIN);
});

test('the rest policies are ordered: stricter rest, more headcount, less risk', () => {
  const { legal, standard, generous } = REST_POLICIES;
  assert.ok(legal.restBaseH < standard.restBaseH && standard.restBaseH < generous.restBaseH);
  assert.ok(legal.extraHeadcountPct < standard.extraHeadcountPct && standard.extraHeadcountPct < generous.extraHeadcountPct);
  assert.ok(legal.riskFactor > standard.riskFactor && standard.riskFactor > generous.riskFactor);
  assert.equal(legal.restBaseH, 12);
  assert.equal(legal.restAwayH, 10);
  assert.equal(DUTY_MAX_MIN, 780);
});

test('fatigue (B.3): the numbers of the mockup come out', () => {
  assert.equal(fatigueOf({ duty7Min: 46 * 60, streakDays: 6, restDays: 0 }), 55); // Camille Lefèvre
  assert.equal(fatigueOf({ duty7Min: 30 * 60, streakDays: 3, restDays: 0 }), 32);
  assert.equal(fatigueOf({ duty7Min: 10 * 60, streakDays: 0, restDays: 2 }), 0, 'a long rest clamps at zero');
  assert.equal(fatigueOf({ duty7Min: 200 * 60, streakDays: 7, restDays: 0 }), 100);
});

test('coverage: ok from 85 % of the positions, tight down to the 70 % floor, short below, none without anyone', () => {
  assert.equal(coverageOf(10, 10), 'ok');
  assert.equal(coverageOf(9, 10), 'ok');
  assert.equal(coverageOf(8, 10), 'tight');
  assert.equal(coverageOf(7, 10), 'tight');
  assert.equal(coverageOf(6, 10), 'short');
  assert.equal(coverageOf(0, 10), 'none');
  assert.equal(coverageOf(0, 0), 'ok');
});

test('crew teams: an ATR on a daily 3 rotations needs the yearly flight limit and the rest, not the daily limit', () => {
  // 6 legs of 1.5 h from 06:00 to 18:00: span 12 h + margins, 9 h flown, 7 days
  const span = 12 * 60 + 105, flight = 9 * 60;
  const t = crewTeams(span, flight, 7, 12);
  assert.ok(t >= 2 && t <= 4, `${t} teams`);
  assert.equal(crewTeams(0, 0, 7, 12), 0);
  assert.equal(crewTeams(span, flight, 0, 12), 0);
  // a short, light timetable fits one team
  assert.equal(crewTeams(200, 120, 3, 12), 1);
  // more flying never needs fewer crews
  assert.ok(crewTeams(span, flight, 5, 12) <= crewTeams(span, flight, 7, 12));
});

test('positions: people kept busy over the slack, plus the policy headcount; nothing for nothing', () => {
  assert.equal(positionsFor(0, REST_POLICIES.legal), 0);
  assert.equal(positionsFor(7, REST_POLICIES.legal), 10);
  assert.equal(positionsFor(7, REST_POLICIES.generous), Math.ceil((7 / 0.7) * 1.07));
  assert.ok(positionsFor(28, REST_POLICIES.generous) > positionsFor(28, REST_POLICIES.legal));
});

test('salaries: the ATR captain of the mockup, an FO below, jets above; rounded to 50 euros', () => {
  assert.equal(salaryFor('pilot', 'captain', 0.5, 'turboprop-airliner'), 6_200);
  assert.ok(salaryFor('pilot', 'fo', 0.5, 'turboprop-airliner') < 6_200);
  assert.ok(salaryFor('pilot', 'captain', 0.5, 'jet-airliner') > 6_200);
  assert.equal(salaryFor('cabin', 'attendant', 0.5, null), 3_400);
  assert.ok(salaryFor('cabin', 'attendant', 1, null) > salaryFor('cabin', 'attendant', 0, null));
  for (const e of [0, 0.37, 1]) assert.equal(salaryFor('ground', 'agent', e, null) % 50, 0);
});

test('training and interim prices: the CRJ course is the mockup\'s 21 days and 24 000 euros; an interim is 1.8 x the daily salary per day', () => {
  assert.deepEqual(TRAINING_COURSE['jet-airliner'], { days: 21, cost: 24_000 });
  assert.equal(interimPrice(6_000, 1), 360);
  assert.equal(interimPrice(6_000, 4), 1_440);
});

test('day numbers round-trip with ISO dates', () => {
  assert.equal(dayIso(dayNo(T0)), '2026-11-04');
  assert.equal(isoDayNo('2026-11-04'), dayNo(T0));
});
