import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_MS, FACILITY_EFFECTS, HANGAR_TECHNICIANS, LEVEL3_AFTER_DAYS, facilityLevelCost, facilityLevels, facilityQuerySchema, hangarEffect, leaseExitFee, leaseTermEnd, leaseTerms, maintenanceSale,
  nextLevelAt, planFacilityMonth, purchaseTerms, signing, slotsFor, upkeepOf, buyBodySchema, leaseBodySchema, upgradeBodySchema, type PlanFacility,
} from './index.ts';

const MX = 18_500; // the mockup's hangar rent
const lease = (over: Partial<PlanFacility> = {}): PlanFacility => ({ id: 1, label: 'LFMN MX1', kind: 'lease', started_at: Date.UTC(2026, 10, 4), months: 36, months_paid: 0, monthly: MX, upkeep: 0, principal: 0, income: 0, ...over });

test('the hangar terms are the mockup\'s: 36 months, 37 000 deposit, 3 months notice, 127 months of rent to buy, 2 400 upkeep, 75 % resale', () => {
  assert.deepEqual(leaseTerms(MX), { monthly: 18_500, months: 36, deposit: 37_000, noticeMonths: 3, totalOverTerm: 666_000 });
  const buy = purchaseTerms(MX);
  assert.deepEqual({ price: buy.price, rentMonths: buy.rentMonths, upkeep: buy.upkeep, resale: buy.resale, resalePct: buy.resalePct, creditPct: buy.creditPct }, { price: 2_350_000, rentMonths: 127, upkeep: 2_400, resale: 1_762_500, resalePct: 75, creditPct: 80 });
  assert.equal(buy.loans.length, 12, 'three down payments by four durations');
  assert.deepEqual([facilityLevelCost(MX, 1), facilityLevelCost(MX, 2), facilityLevelCost(MX, 3)], [0, 420_000, 1_150_000]);
});

test('signing: one function gives what leaves the account today and what the building costs a month, for rent, cash or credit', () => {
  // the contract screen: deposit 37 000 + level 2 works 420 000 = 457 000 today, then the 18 500 rent
  const l = signing(MX, 'lease', 2);
  assert.deepEqual({ today: l.today, deposit: l.deposit, works: l.works, monthly: l.monthly, months: l.months }, { today: 457_000, deposit: 37_000, works: 420_000, monthly: 18_500, months: 36 });
  const cash = signing(MX, 'purchase', 1);
  assert.deepEqual({ today: cash.today, principal: cash.principal, monthly: cash.monthly, months: cash.months }, { today: 2_350_000, principal: 0, monthly: 2_400, months: null });
  const credit = signing(MX, 'purchase', 1, { downPct: 20, months: 120 });
  assert.equal(credit.down, 470_000);
  assert.equal(credit.principal, 1_880_000);
  assert.equal(credit.today, 470_000);
  assert.equal(credit.monthly, 2_400 + credit.instalment);
  assert.ok(credit.instalment > 1_880_000 / 120, 'the instalment carries interest');
});

test('the catalogue: Nice has the mockup\'s ten buildings, every building with an effect is offered at a rent, every other one is not', () => {
  const nice = slotsFor('LFMN', 'large');
  assert.equal(nice.length, 10);
  assert.deepEqual(nice.filter((s) => s.owner === 'available').map((s) => s.slot), ['MX1', 'MX2', 'AD', 'OPS']);
  assert.deepEqual(nice.find((s) => s.owner === 'ai'), { slot: 'CG1', name: 'Freight and storage', kind: 'cargo', effect: 'none', areaM2: 3_200, rent: 0, owner: 'ai', holder: 'Méridia Cargo' });
  for (const size of ['large', 'medium', 'small'] as const) {
    const s = slotsFor('LFXX', size);
    assert.equal(new Set(s.map((x) => x.slot)).size, s.length, `${size}: slots are unique`);
    for (const x of s) {
      assert.ok(FACILITY_EFFECTS.includes(x.effect));
      assert.equal(x.owner === 'available', x.effect !== 'none' && x.rent > 0, `${size} ${x.slot}: only a building with an effect has a rent`);
    }
  }
  assert.ok(!slotsFor('LFXX', 'small').some((s) => s.slot === 'OPS'), 'a small airport has no operations centre');
  assert.ok(slotsFor('LFXX', 'medium').find((s) => s.slot === 'MX1')!.rent < slotsFor('LFXX', 'large').find((s) => s.slot === 'MX1')!.rent, 'rents follow the size of the airport');
});

test('levels: the rent does not change, works take 3 and 8 weeks, level 3 opens after 6 months at level 2', () => {
  const levels = facilityLevels('hangar', MX);
  assert.deepEqual(levels.map((l) => [l.level, l.cost, l.worksDays, l.technicians, l.aircraft]), [[1, 0, 0, 6, 2], [2, 420_000, 21, 10, 3], [3, 1_150_000, 56, 16, 4]]);
  assert.deepEqual(levels.map((l) => l.widebody), [false, false, true]);
  assert.deepEqual(facilityLevels('desks', 6_200).map((l) => l.desks), [18, 36, 54]);
  assert.equal(facilityLevels('ops', 9_800).length, 1);
  const t = Date.UTC(2026, 10, 4);
  assert.equal(nextLevelAt(1, t), t, 'level 2 opens at signing');
  assert.equal(nextLevelAt(2, t), t + LEVEL3_AFTER_DAYS * DAY_MS);
});

test('hangar effect: -35 % maintenance and half the downtime, halved when short of technicians, wide-bodies need level 3', () => {
  const full = hangarEffect([1], HANGAR_TECHNICIANS[0], false)!;
  assert.deepEqual(full, { discount: 0.35, downtimeFactor: 0.5, understaffed: false });
  const short = hangarEffect([1], 5, false)!;
  assert.equal(short.understaffed, true);
  assert.equal(short.discount, 0.175);
  assert.equal(short.downtimeFactor, 0.75);
  assert.equal(hangarEffect([], 99, false), null);
  assert.equal(hangarEffect([2], 99, true), null, 'a level-2 hangar cannot take a wide-body');
  assert.ok(hangarEffect([2, 3], 99, true));
  assert.equal(hangarEffect([1, 1], 11, false)!.understaffed, true, 'two hangars share their technicians as a pool: 12 are needed');
  assert.equal(maintenanceSale(MX, 46_200), Math.round(0.4 * (18_500 + 46_200)));
});

test('the monthly plan: a lease pays from the first of the month after signing; a purchase pays upkeep then its instalments; income arrives', () => {
  const dec = Date.UTC(2026, 11, 1), nov = Date.UTC(2026, 10, 1);
  assert.deepEqual(planFacilityMonth(nov, [lease()]).charges, [], 'signed on 4 Nov: nothing is billed for November');
  const first = planFacilityMonth(dec, [lease()]);
  assert.deepEqual(first.charges, [{ kind: 'facility_rent', amount: -18_500, memo: 'LFMN MX1 rent 1/36' }]);
  assert.equal(first.rows[0]!.months_paid, 1);
  assert.equal(lease().months_paid, 0, 'the input is not touched');
  assert.equal(planFacilityMonth(dec, [lease({ months_paid: 36 })]).charges[0]!.memo, 'LFMN MX1 rent 37', 'a lease renews month by month after its term');

  const buy = signing(MX, 'purchase', 1, { downPct: 20, months: 36 });
  const row: PlanFacility = { id: 2, label: 'LFMN MX2', kind: 'purchase', started_at: Date.UTC(2026, 10, 4), months: 36, months_paid: 0, monthly: buy.instalment, upkeep: buy.upkeep, principal: buy.principal, income: 0 };
  let rows = [row];
  const kinds: string[] = [];
  for (let i = 0; i < 36; i++) {
    const p = planFacilityMonth(Date.UTC(2026, 11 + i, 1), rows);
    kinds.push(...p.charges.map((c) => c.kind));
    rows = p.rows;
  }
  assert.equal(rows[0]!.principal, 0, 'the last instalment clears the credit');
  assert.equal(rows[0]!.months_paid, 36);
  assert.equal(kinds.filter((k) => k === 'facility_loan').length, 36);
  assert.equal(kinds.filter((k) => k === 'facility_upkeep').length, 36);
  assert.deepEqual(planFacilityMonth(Date.UTC(2030, 0, 1), rows).charges.map((c) => c.kind), ['facility_upkeep'], 'once paid off, only the upkeep remains');
  assert.deepEqual(planFacilityMonth(dec, [lease({ income: 30_000 })]).charges.map((c) => c.kind), ['facility_rent', 'facility_income']);
});

test('ending a lease: the notice, or the rest of the term when that is longer', () => {
  assert.equal(leaseExitFee(MX, 36, 1, 3), 35 * MX);
  assert.equal(leaseExitFee(MX, 36, 34, 3), 3 * MX);
  assert.equal(leaseExitFee(MX, 36, 40, 3), 3 * MX, 'past the term it is the notice');
  assert.equal(leaseTermEnd(Date.UTC(2026, 10, 4), 36), Date.UTC(2029, 11, 1), 'the signing month is free, then 36 rents');
  assert.equal(upkeepOf(MX), 2_400);
});

test('request schemas: a level is 1 or 2 at signing, an upgrade is to 2 or 3, a preview needs both credit fields or none', () => {
  assert.equal(leaseBodySchema.safeParse({ level: 3 }).success, false);
  assert.equal(leaseBodySchema.safeParse({}).success, true);
  assert.equal(buyBodySchema.safeParse({ level: 2, financing: { downPct: 20, months: 60 } }).success, true);
  assert.equal(upgradeBodySchema.safeParse({ toLevel: 1 }).success, false);
  assert.equal(facilityQuerySchema.safeParse({ mode: 'buy', downPct: '20' }).success, false);
  assert.deepEqual(facilityQuerySchema.parse({}), { mode: 'lease', level: 1 });
  assert.equal(facilityQuerySchema.parse({ mode: 'buy', downPct: '20', months: '60' }).months, 60);
});
