import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENCY_COMPARE_MONTHS, AGENCY_NOTICE_DAYS, AGENCY_SEARCH_DAYS, DAY_MS, agencyCommission, agencyQuerySchema, agencySalary, agencySavings, missionBodySchema, optionsOf, quoteOf, signBodySchema,
  type AgencyCandidate, type OptionInputs,
} from './index.ts';

const cand = (id: string, grid: number, asking: number): AgencyCandidate => ({
  id, family: 'pilot', role: 'captain', name: id, base: 'LFLL', qual: 'CRJ7', experience: 5000, reliability: 80, morale: 70, grid, askingSalary: asking, noticeDays: AGENCY_NOTICE_DAYS, premium: agencyCommission(asking),
});

// The mockup's recruiter frame (docs/v4-plan.md A.4): Delaunay 8 300 over a grid of 7 500, Vasseur 5 900 over 5 300.
const DELAUNAY = cand('a1', 7_500, 8_300), VASSEUR = cand('a2', 5_300, 5_900);

test('the commission is 20 % of the annual salary, the surcharge is the premium over the grid: the frame\'s 34 080 and +1 400 a month', () => {
  assert.equal(agencyCommission(8_300) + agencyCommission(5_900), 34_080);
  const q = quoteOf([DELAUNAY, VASSEUR], 100_000);
  assert.deepEqual(q, { picked: ['a1', 'a2'], commission: 34_080, surchargeMonthly: 1_400, balanceAfter: 65_920 });
  assert.equal(quoteOf([], 5).commission, 0);
});

test('the agency asks 11 % above the grid, in steps of 50 euros', () => {
  assert.equal(agencySalary(5_300, 11), 5_900);
  assert.equal(agencySalary(7_500, 11), 8_350, '8 325 rounds up to the next 50 (the frame shows 8 300)');
  assert.equal(agencySalary(6_200, 0), 6_200);
});

const inputs = (over: Partial<OptionInputs> = {}): OptionInputs => ({
  count: 2, searchDays: AGENCY_SEARCH_DAYS, perDay: 5_400, now: 0, agency: quoteOf([DELAUNAY, VASSEUR], 500_000),
  course: { days: 21, cost: 24_000 }, trainable: 2, market: [9_000, 9_500, 12_000], marketNotice: 7, ...over,
});

test('three options, each priced fees + days x the stopped line\'s revenue per day (the frame: 50 880 of fees for the agency)', () => {
  const [agency, train, classic] = optionsOf(inputs());
  assert.equal(agency!.id, 'agency');
  assert.equal(agency!.fees, 34_080 + AGENCY_COMPARE_MONTHS * 1_400, '34 080 commission and 12 months of premium: the frame\'s 50 880');
  assert.equal(agency!.fees, 50_880);
  assert.deepEqual([agency!.days, agency!.stopped, agency!.total], [AGENCY_SEARCH_DAYS + AGENCY_NOTICE_DAYS, (AGENCY_SEARCH_DAYS + AGENCY_NOTICE_DAYS) * 5_400, 50_880 + (AGENCY_SEARCH_DAYS + AGENCY_NOTICE_DAYS) * 5_400]);
  assert.equal(agency!.resumeAt, agency!.days * DAY_MS);
  assert.deepEqual([train!.id, train!.fees, train!.days, train!.stopped, train!.available], ['train', 48_000, 21, 21 * 5_400, true], 'two courses of the server\'s price and days');
  assert.deepEqual([classic!.id, classic!.fees, classic!.days, classic!.available], ['classic', 18_500, 7, true], 'the two cheapest premiums of the market, then its notice');
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
  const dear = optionsOf(inputs({ perDay: 30_000, market: [9_000, 9_000], course: { days: 30, cost: 50_000 } }));
  assert.deepEqual(agencySavings(dear), { against: 'classic', days: 7 - (AGENCY_SEARCH_DAYS + AGENCY_NOTICE_DAYS), amount: dear[2]!.total - dear[0]!.total });
  assert.ok(agencySavings(dear)!.amount > 0);
  assert.equal(agencySavings(optionsOf(inputs())), null, 'at 5 400 a day the market is cheaper than the commission: no saving to show');
  assert.equal(agencySavings(optionsOf(inputs({ market: [] })))?.against, 'train', 'with nobody on the market the agency is compared with training');
});

test('request schemas: base, type and count go together; count is 1 to 6; no candidate twice', () => {
  assert.ok(agencyQuerySchema.safeParse({}).success);
  assert.ok(agencyQuerySchema.safeParse({ base: 'LFLL', qual: 'CRJ7', count: '2' }).success);
  assert.ok(!agencyQuerySchema.safeParse({ base: 'LFLL' }).success);
  assert.ok(!agencyQuerySchema.safeParse({ base: 'LFLL', qual: 'CRJ7', count: '7' }).success);
  assert.ok(!agencyQuerySchema.safeParse({ base: 'lfll', qual: 'CRJ7', count: '1' }).success);
  assert.ok(!missionBodySchema.safeParse({ base: 'LFLL', qual: 'CRJ7', count: 0 }).success);
  assert.ok(!missionBodySchema.safeParse({ base: 'LFLL', qual: 'CRJ7', count: 1.5 }).success);
  assert.ok(signBodySchema.safeParse({ candidateIds: ['a', 'b'] }).success);
  assert.ok(!signBodySchema.safeParse({ candidateIds: ['a', 'a'] }).success);
  assert.ok(!signBodySchema.safeParse({ candidateIds: [] }).success);
});
