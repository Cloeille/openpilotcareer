import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FleetQuote, HubUsage, LeaseOffer, LoanQuote } from './api-finance.ts';
import {
  aircraftName, byRegistration, cheapestRent, defaultDuration, defaultLoan, deliveryAt, downPayment, findLoan, freeSpots, fundingOptions, inBudget, lastRentMonth, leaseQuote,
  loanBreakdown, loanDownPcts, loanMonths, nextCharges, parkingSummary, starterRow, starterSummary, statusOf, wearOf,
} from './finance-view.ts';

const offer = (o: Partial<LeaseOffer> = {}): LeaseOffer => ({
  id: 7, lessor: 'Viking Air Leasing', icao: 'DHC6', typeName: 'DHC-6 Twin Otter 400', year: 2015, airframeHours: 6840, maintenanceIncluded: true, insuranceMonthly: 2100,
  deposit: 76_000, ferryFee: 12_500, deliveryHours: 24, minMonths: 6,
  durations: [{ months: 12, monthlyRent: 42_000 }, { months: 24, monthlyRent: 38_000 }, { months: 36, monthlyRent: 34_500 }],
  purchaseOptionPrice: 2_650_000, earlyExit: { afterMonths: 6, penaltyRents: 2 }, ...o,
});
const loans: LoanQuote[] = [
  { downPct: 20, months: 60, monthly: 60_000, total: 3_800_000 }, { downPct: 20, months: 84, monthly: 47_450, total: 4_100_000 }, { downPct: 30, months: 84, monthly: 41_000, total: 3_700_000 },
  { downPct: 20, months: 120, monthly: 40_000, total: 4_900_000 },
];

test('status: finance fields win, the legacy busy flag is the fallback', () => {
  const now = 1_000_000_000_000;
  assert.deepEqual(statusOf({ busy: false }, now), { kind: 'available', hoursLeft: null, flight: null });
  assert.deepEqual(statusOf({ busy: true }, now, { destination: 'LFPG', flightId: 4127 }), { kind: 'flying', hoursLeft: null, flight: { destination: 'LFPG', flightId: 4127 } });
  assert.equal(statusOf({ busy: false, status: 'maintenance', maintenanceUntil: now + 11.2 * 3_600_000 }, now).hoursLeft, 12);
  assert.equal(statusOf({ busy: false, status: 'maintenance', maintenanceUntil: now - 5 }, now).hoursLeft, 1);
  assert.equal(statusOf({ busy: false, status: 'available', maintenanceUntil: null }, now, { destination: 'X', flightId: 1 }).flight, null);
});

test('wear is clamped, absent when the server does not report it', () => {
  assert.equal(wearOf({ wearPct: 63.4 }), 63);
  assert.equal(wearOf({ wearPct: 140 }), 100);
  assert.equal(wearOf({}), null);
});

test('registration is the name, sorted naturally; legacy aircraft keep ICAO #id', () => {
  assert.equal(aircraftName({ registration: 'F-HAZA', icao: 'C172', id: 1 }), 'F-HAZA');
  assert.equal(aircraftName({ icao: 'C172', id: 1 }), 'C172 #1');
  const sorted = byRegistration([{ registration: 'F-HAZC', icao: 'a', id: 3 }, { registration: 'F-HAZA', icao: 'a', id: 1 }, { registration: 'F-HAZB', icao: 'a', id: 2 }]);
  assert.deepEqual(sorted.map((a) => a.registration), ['F-HAZA', 'F-HAZB', 'F-HAZC']);
});

test('parking: "4 sur 10 · LFKB complet"', () => {
  const usage: HubUsage[] = [{ icao: 'LFMN', spots: 10, used: 8 }, { icao: 'LFKB', spots: 10, used: 10 }, { icao: 'LFML', spots: 10, used: 8 }];
  assert.deepEqual(parkingSummary(usage), { free: 4, total: 30, full: ['LFKB'] });
  assert.equal(parkingSummary(null), null);
  assert.equal(parkingSummary([]), null);
  assert.equal(freeSpots(usage, 'LFMN'), 2);
  assert.equal(freeSpots(usage, 'LFKB'), 0);
  assert.equal(freeSpots(usage, 'LFPG'), null);
  assert.equal(freeSpots([{ icao: 'A', spots: 10, used: 12 }], 'A'), 0);
});

test('upcoming charges: soonest first, capped', () => {
  const u = [{ at: 30, kind: 'a', amount: 1, memo: '' }, { at: 10, kind: 'b', amount: 1, memo: '' }, { at: 20, kind: 'c', amount: 1, memo: '' }];
  assert.deepEqual(nextCharges(u, 2).map((x) => x.at), [10, 20]);
});

test('lease quote reproduces the mockup: 38 000 + 76 000 + 12 500 = 126 500, balance after 1 158 060', () => {
  const o = offer();
  const q = leaseQuote(o, 24, 1_284_560)!;
  assert.equal(q.firstPayment, 126_500);
  assert.equal(q.balanceAfter, 1_158_060);
  assert.equal(q.totalRent, 912_000);
  assert.equal(q.penalty, 76_000);
  assert.equal(q.affordable, true);
  assert.equal(leaseQuote(o, 12, 1_000_000)!.totalRent, 504_000);
  assert.equal(leaseQuote(o, 36, 1_000_000)!.totalRent, 1_242_000);
  assert.equal(leaseQuote(o, 18, 1_000_000), null);
});

test('lease quote flags a shortfall', () => {
  const q = leaseQuote(offer(), 24, 100_000)!;
  assert.equal(q.affordable, false);
  assert.equal(q.shortfall, 26_500);
  assert.equal(q.balanceAfter, -26_500);
});

test('default duration is 24 months, else the middle one; cheapest rent', () => {
  assert.equal(defaultDuration(offer())!.months, 24);
  assert.equal(defaultDuration(offer({ durations: [{ months: 12, monthlyRent: 1 }, { months: 36, monthlyRent: 2 }, { months: 36, monthlyRent: 3 }] }))!.monthlyRent, 2);
  assert.equal(defaultDuration(offer({ durations: [] })), null);
  assert.equal(cheapestRent(offer()), 34_500);
  assert.equal(cheapestRent(offer({ durations: [] })), null);
});

test('last rent: signed in November 2026 for 24 months, the last rent is October 2028', () => {
  const d = lastRentMonth(Date.UTC(2026, 10, 6, 12), 24);
  assert.equal(d.getUTCFullYear(), 2028);
  assert.equal(d.getUTCMonth(), 9);
  assert.equal(lastRentMonth(Date.UTC(2026, 10, 6), 1).getUTCMonth(), 10);
  assert.equal(lastRentMonth(Date.UTC(2026, 11, 31), 3).getUTCFullYear(), 2027);
  assert.equal(deliveryAt(1000, { deliveryHours: 2 }), 1000 + 7_200_000);
});

test('loan: 20 % of 4 200 000 down, as in the mockup', () => {
  assert.equal(downPayment(4_200_000, { downPct: 20 }), 840_000);
  const b = loanBreakdown(4_200_000, loans[1]!, 1_284_560);
  assert.equal(b.down, 840_000);
  assert.equal(b.financed, 3_360_000);
  assert.equal(b.balanceAfter, 444_560);
  assert.equal(b.affordable, true);
  assert.equal(b.interest, 4_100_000 - 3_360_000);
  assert.equal(loanBreakdown(4_200_000, loans[1]!, 100_000).affordable, false);
});

test('default loan: 20 % / 84 months when quoted, else the nearest', () => {
  assert.deepEqual(defaultLoan(loans), loans[1]);
  assert.deepEqual(defaultLoan([loans[0]!, loans[3]!]), loans[0]);
  assert.deepEqual(defaultLoan([loans[2]!]), loans[2]);
  assert.equal(defaultLoan([]), null);
});

test('loan pickers list what the server quotes', () => {
  assert.deepEqual(loanDownPcts(loans), [20, 30]);
  assert.deepEqual(loanMonths(loans, 20), [60, 84, 120]);
  assert.deepEqual(loanMonths(loans, 30), [84]);
  assert.deepEqual(findLoan(loans, 30, 84), loans[2]);
  assert.equal(findLoan(loans, 30, 60), null);
});

test('funding options: loan first, then the lease when the server has one', () => {
  const quote: FleetQuote = { cash: 4_212_500, loans, leaseOffers: 1 };
  const opts = fundingOptions(4_200_000, quote, 1_284_560, offer());
  assert.deepEqual(opts.map((o) => o.kind), ['loan', 'lease']);
  const lease = opts[1]!;
  assert.equal(lease.kind === 'lease' && lease.balanceAfter, 1_158_060);
  assert.deepEqual(fundingOptions(4_200_000, { ...quote, leaseOffers: 0 }, 1_284_560, offer()).map((o) => o.kind), ['loan']);
  assert.deepEqual(fundingOptions(4_200_000, quote, 1_284_560, null).map((o) => o.kind), ['loan']);
  assert.deepEqual(fundingOptions(4_200_000, null, 1_284_560, null), []);
});

test('starter list: lease vs buy for a 1 500 000 capital (mockup row C208)', () => {
  const c208 = offer({ icao: 'C208', typeName: 'Cessna 208B', deposit: 37_000, ferryFee: 9_500, durations: [{ months: 12, monthlyRent: 20_000 }, { months: 24, monthlyRent: 18_500 }, { months: 36, monthlyRent: 17_000 }] });
  const row = starterRow(c208, null, 1_320_000, 1_500_000);
  assert.equal(row.rent, 18_500);
  assert.equal(row.months, 24);
  assert.equal(row.leaseAffordable, true);
  assert.equal(row.buyAffordable, true);
  assert.equal(row.buyBalanceAfter, 180_000);
  const lease = starterSummary(row, 'lease', 1_500_000)!;
  assert.equal(lease.balanceAfter, 1_435_000);
  assert.equal(lease.today, 65_000);
  assert.equal(lease.saved, 1_255_000);
  assert.equal(starterSummary(row, 'buy', 1_500_000)!.balanceAfter, 180_000);
  assert.equal(starterSummary(starterRow(c208, null, null, 1_500_000), 'buy', 1_500_000), null);
});

test('starter list: counts what fits the budget, buy disabled when it does not', () => {
  const o = offer({ icao: 'A20N' });
  const rows = [starterRow(o, null, 90_000_000, 1_500_000), starterRow(offer({ icao: 'X', deposit: 5_000_000 }), null, 90_000_000, 1_500_000), starterRow(o, null, 640_000, 1_500_000)];
  assert.equal(rows[0]!.buyAffordable, false);
  assert.equal(rows[0]!.leaseAffordable, true);
  assert.equal(rows[1]!.leaseAffordable, false);
  assert.equal(inBudget(rows), 2);
  assert.equal(starterSummary(rows[0]!, 'lease', 1_500_000)!.saved, 90_000_000 - 126_500);
});
