import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENCY_COMMISSION_MONTHS, AGENCY_MAX_COUNT, AGENCY_NOTICE_DAYS, AGENCY_SEARCH_DAYS, DAY_MS, HIRED_ROLES, STAFF_FAMILIES, agencyCommission, agencyQuerySchema, agencySavings, isPost, missionBodySchema, optionsOf, quoteOf, requestForGap, signBodySchema,
  type Candidate, type OptionInputs,
} from './index.ts';

/** A candidate of the agency: paid the grid, the commission is one month of it. */
const cand = (id: string, salary: number): Candidate => ({
  id, family: 'pilot', role: 'captain', name: id, base: 'LFLL', qual: 'CRJ7', experience: 5000, reliability: 80, morale: 70, askingSalary: salary, noticeDays: AGENCY_NOTICE_DAYS, premium: agencyCommission(salary),
});

// The mockup's recruiter frame (docs/v4-plan.md A.4): Delaunay 7 500 and Vasseur 5 300 a month on the grid.
const DELAUNAY = cand('a1', 7_500), VASSEUR = cand('a2', 5_300);

test('the commission is one month of the person\'s salary, once, and the quote has no surcharge', () => {
  assert.equal(AGENCY_COMMISSION_MONTHS, 1);
  assert.equal(agencyCommission(7_500), 7_500);
  assert.equal(agencyCommission(DELAUNAY.askingSalary) + agencyCommission(VASSEUR.askingSalary), 12_800);
  const q = quoteOf([DELAUNAY, VASSEUR], 100_000);
  assert.deepEqual(q, { picked: ['a1', 'a2'], commission: 12_800, balanceAfter: 87_200 });
  assert.ok(!('surchargeMonthly' in q), 'no monthly surcharge exists');
  assert.equal(quoteOf([], 5).commission, 0);
});

const inputs = (over: Partial<OptionInputs> = {}): OptionInputs => ({
  count: 2, searchDays: AGENCY_SEARCH_DAYS, perDay: 5_400, now: 0, agency: quoteOf([DELAUNAY, VASSEUR], 500_000),
  course: { days: 21, cost: 24_000 }, trainable: 2, market: [9_000, 9_500, 12_000], marketNotice: 7, ...over,
});

test('three options, each priced fees + days x the stopped line\'s revenue per day: the agency\'s fees are the commission and nothing else', () => {
  const [agency, train, classic] = optionsOf(inputs());
  assert.equal(agency!.id, 'agency');
  assert.equal(agency!.fees, 12_800, 'one month of each salary: no premium over a year on top');
  assert.deepEqual([agency!.days, agency!.stopped, agency!.total], [AGENCY_SEARCH_DAYS + AGENCY_NOTICE_DAYS, (AGENCY_SEARCH_DAYS + AGENCY_NOTICE_DAYS) * 5_400, 12_800 + (AGENCY_SEARCH_DAYS + AGENCY_NOTICE_DAYS) * 5_400]);
  assert.equal(agency!.resumeAt, agency!.days * DAY_MS);
  assert.deepEqual([train!.id, train!.fees, train!.days, train!.stopped, train!.available], ['train', 48_000, 21, 21 * 5_400, true], 'two courses of the server\'s price and days');
  assert.deepEqual([classic!.id, classic!.fees, classic!.days, classic!.available], ['classic', 18_500, 7, true], 'the two cheapest premiums of the market, then its notice');
});

test('a family without type ratings has no training route: the agency and the market only', () => {
  assert.deepEqual(optionsOf(inputs({ course: null, trainable: 0 })).map((o) => o.id), ['agency', 'classic']);
});

test('an option that cannot be taken says so: nobody to train, too few on the market, too few on the shortlist', () => {
  const o = (over: Partial<OptionInputs>) => optionsOf(inputs(over)).map((x) => [x.id, x.available]);
  assert.deepEqual(o({ trainable: 1 }), [['agency', true], ['train', false], ['classic', true]]);
  assert.deepEqual(o({ market: [9_000] }), [['agency', true], ['train', true], ['classic', false]]);
  assert.deepEqual(o({ agency: quoteOf([DELAUNAY], 0) }), [['agency', false], ['train', true], ['classic', true]]);
});

test('a mission already under way has fewer days of search left, so the agency is cheaper by the days that went by', () => {
  const fresh = optionsOf(inputs())[0]!, later = optionsOf(inputs({ searchDays: 0 }))[0]!;
  assert.equal(fresh.total - later.total, AGENCY_SEARCH_DAYS * 5_400);
});

test('the savings compare the agency with the cheapest other option that can be taken, and are null when it saves nothing', () => {
  const o = optionsOf(inputs());
  assert.deepEqual(agencySavings(o), { against: 'classic', days: 7 - (AGENCY_SEARCH_DAYS + AGENCY_NOTICE_DAYS), amount: o[2]!.total - o[0]!.total }, 'at 5 400 a day the commission (12 800) is below the market\'s premiums plus its longer stoppage');
  assert.ok(agencySavings(o)!.amount > 0);
  assert.equal(agencySavings(optionsOf(inputs({ perDay: 0, market: [1_000, 1_000] }))), null, 'a cheap market and no stopped line: the agency saves nothing');
  assert.equal(agencySavings(optionsOf(inputs({ market: [] })))?.against, 'train', 'with nobody on the market the agency is compared with training');
});

const post = { family: 'cabin', role: 'attendant', base: 'LFLL' };

test('request schemas: family, role, base and count go together; count is 1 to 20; no candidate twice', () => {
  assert.equal(AGENCY_MAX_COUNT, 20);
  assert.ok(agencyQuerySchema.safeParse({}).success);
  assert.ok(agencyQuerySchema.safeParse({ ...post, count: '2' }).success);
  assert.ok(agencyQuerySchema.safeParse({ family: 'pilot', role: 'fo', base: 'LFLL', qual: 'CRJ7', count: '2' }).success);
  assert.ok(!agencyQuerySchema.safeParse({ base: 'LFLL' }).success);
  assert.ok(!agencyQuerySchema.safeParse({ ...post }).success, 'no count');
  assert.ok(!agencyQuerySchema.safeParse({ ...post, family: 'astronaut', count: '1' }).success);
  assert.ok(!agencyQuerySchema.safeParse({ ...post, base: 'lfll', count: '1' }).success);
  assert.ok(agencyQuerySchema.safeParse({ ...post, count: '20' }).success);
  assert.ok(!agencyQuerySchema.safeParse({ ...post, count: '21' }).success, '21 is refused');
  assert.equal(missionBodySchema.parse({ ...post, count: 1 }).qual, null, 'no rating is a null rating');
  assert.ok(missionBodySchema.safeParse({ ...post, count: 20 }).success);
  assert.ok(!missionBodySchema.safeParse({ ...post, count: 21 }).success, '21 is refused');
  assert.ok(!missionBodySchema.safeParse({ ...post, count: 0 }).success);
  assert.ok(!missionBodySchema.safeParse({ ...post, count: 1.5 }).success);
  assert.ok(!missionBodySchema.safeParse({ ...post, role: 'boss', count: 1 }).success);
  assert.ok(signBodySchema.safeParse({ candidateIds: ['a', 'b'] }).success);
  assert.ok(!signBodySchema.safeParse({ candidateIds: ['a', 'a'] }).success);
  assert.ok(!signBodySchema.safeParse({ candidateIds: [] }).success);
});

test('a post exists when its role belongs to the family and only pilots hold a type rating', () => {
  for (const family of STAFF_FAMILIES) {
    for (const role of HIRED_ROLES[family]) assert.ok(isPost({ family, role, qual: family === 'pilot' ? 'AT76' : null }), `${family} ${role}`);
    assert.ok(!isPost({ family, role: 'instructor', qual: family === 'pilot' ? 'AT76' : null }), `${family}: an instructor is retrained, never hired`);
    assert.ok(!isPost({ family, role: HIRED_ROLES[family][0]!, qual: family === 'pilot' ? null : 'AT76' }), `${family}: ${family === 'pilot' ? 'a pilot needs a rating' : 'only a pilot has a rating'}`);
  }
  assert.ok(!isPost({ family: 'cabin', role: 'captain', qual: null }), 'a cabin captain does not exist');
  assert.ok(!isPost({ family: 'pilot', role: 'cook', qual: 'AT76' }), 'a pilot cook neither');
});

test('a gap proposes the first role of its family, as many as are open up to one mission', () => {
  assert.deepEqual(requestForGap({ family: 'cabin', base: 'LFLL', qual: null, open: 41 }), { family: 'cabin', role: 'attendant', base: 'LFLL', qual: null, count: 20 });
  assert.deepEqual(requestForGap({ family: 'pilot', base: 'LFLL', qual: 'A319', open: 3 }), { family: 'pilot', role: 'captain', base: 'LFLL', qual: 'A319', count: 3 });
});
