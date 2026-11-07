import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLUB, MONTHLY_RENTAL, PARKING_FEE_BY_SIZE, PARKING_SPOTS_PER_HUB, loanPayment, type LeaseOffer } from '@opc/shared';
import { get, run, tx } from './db.ts';
import { planMonth, runBilling } from './finance.ts';
import { dayOf, leaseOffer } from './leasing.ts';
import { catalogType } from './catalog.ts';
import { harness } from './harness.ts';

const V1 = '/api/v1';
type H = Awaited<ReturnType<typeof harness>>;
type Tx = { kind: string; amount: number; memo: string; at: number };
const HOUR = 3_600_000;
const setBalance = (h: H, companyId: number, balance: number): void => { run(h.db, 'UPDATE companies SET balance = ? WHERE id = ?', balance, companyId); };
const me = async (h: H, token: string) => (await h.call('GET', `${V1}/me`, { token })).body;
const ledger = async (h: H, token: string): Promise<Tx[]> => (await h.call('GET', `${V1}/me/transactions?limit=200`, { token })).body;
const ofKind = (l: Tx[], kind: string): Tx[] => l.filter((t) => t.kind === kind);
const at = (y: number, m: number, d = 2, hh = 10): number => Date.UTC(y, m - 1, d, hh);
/** Jump the server clock; sessions are kept alive (they would expire after 30 days). */
const warp = (h: H, t: number): void => { h.clock.t = t; run(h.db, 'UPDATE sessions SET expires_at = ?', t + 1_000_000_000); };

async function rich(h: H, name: string, money = 50_000_000, hub = 'LFPG') {
  const p = await h.register(name, hub);
  setBalance(h, p.me.company.id, money);
  return p;
}
const offerFor = async (h: H, token: string, icao: string): Promise<LeaseOffer> => (await h.call('GET', `${V1}/leasing/offers?icao=${icao}`, { token })).body[0];
const leaseBody = (o: LeaseOffer, months: number, hub = 'LFPG') => ({ offerId: o.id, months, hub });
const rentOf = (o: LeaseOffer, months: number): number => o.durations.find((d) => d.months === months)!.monthlyRent;

test('fleet carries registration, ownership, wear, status and contract; registrations are unique and follow the hub country', async () => {
  const h = await harness();
  const ps = [await h.register('regA', 'LFPG'), await h.register('regB', 'LFPG'), await h.register('regC', 'EGLL'), await h.register('regD', 'KJFK'), await h.register('regE', 'EDDF')];
  assert.deepEqual(ps.map((p) => p.me.fleet[0].registration), ['F-HAZA', 'F-HAZB', 'G-HAZA', 'N100AA', 'D-HAZA']);
  const f = ps[0]!.me.fleet[0];
  assert.deepEqual({ ownership: f.ownership, wearPct: f.wearPct, status: f.status, maintenanceUntil: f.maintenanceUntil, contract: f.contract }, { ownership: 'owned', wearPct: 0, status: 'available', maintenanceUntil: null, contract: null });
});

test('quote: literal cash price, convoy fee and loan table; unknown hub and missing icao are refused', async () => {
  const h = await harness();
  const { token } = await h.register('quoter');
  const q = (await h.call('GET', `${V1}/me/fleet/quote?icao=C208&hub=LFPG`, { token })).body;
  assert.deepEqual({ price: q.price, ferryFee: q.ferryFee, cash: q.cash, balance: q.balance, leaseOffers: q.leaseOffers, loans: q.loans.length }, { price: 204_600, ferryFee: 600, cash: 205_200, balance: 400_000, leaseOffers: 1, loans: 12 });
  const l = q.loans.find((x: { downPct: number; months: number }) => x.downPct === 20 && x.months === 60);
  assert.deepEqual(l, { downPct: 20, months: 60, monthly: 3_233, total: 40_920 + 3_233 * 60 + 600, down: 40_920, dueToday: 41_520 });
  assert.equal(loanPayment(163_680, 60), 3_233);
  assert.equal((await h.call('GET', `${V1}/me/fleet/quote?icao=C208&hub=KJFK`, { token })).body.error, 'not_a_hub');
  assert.equal((await h.call('GET', `${V1}/me/fleet/quote?hub=LFPG`, { token })).status, 400);
});

test('cash purchase pays price + convoy fee; short funds: 409 insufficient_funds with needed and options', async () => {
  const h = await harness();
  const { token, me: m0 } = await h.register('cash');
  const ok = await h.call('POST', `${V1}/me/fleet`, { token, body: { icao: 'C208', hub: 'LFPG' } });
  assert.equal(ok.status, 201, ok.text);
  assert.equal(ok.body.company.balance, 400_000 - 204_600 - 600);
  assert.equal(ok.body.fleet.at(-1).registration, 'F-HAZB');
  assert.equal(ok.body.fleet.at(-1).ownership, 'owned');
  const l = await ledger(h, token);
  assert.deepEqual([ofKind(l, 'purchase_aircraft')[0]!.amount, ofKind(l, 'ferry')[0]!.amount], [-204_600, -600]);
  const short = await h.call('POST', `${V1}/me/fleet`, { token, body: { icao: 'DHC6', hub: 'LFPG' } });
  assert.equal(short.status, 409);
  assert.deepEqual({ error: short.body.error, needed: short.body.needed, options: short.body.options, missing: short.body.missing }, { error: 'insufficient_funds', needed: 280_850, options: ['loan', 'lease'], missing: 280_850 - ok.body.company.balance });
  assert.equal((await me(h, token)).fleet.length, m0.fleet.length + 1, 'a refused purchase changes nothing');
});

test('financed purchase: down payment + convoy now, annuity contract, debt off the net worth, instalments at billing', async () => {
  const h = await harness();
  const { token, me: m0 } = await h.register('loaner');
  const body = { icao: 'DHC6', hub: 'LFPG', financing: { downPct: 20, months: 84 } };
  const r = await h.call('POST', `${V1}/me/fleet`, { token, body });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.company.balance, 400_000 - 56_000 - 850);
  const plane = r.body.fleet.at(-1);
  assert.deepEqual({ ownership: plane.ownership, kind: plane.contract.kind, monthly: plane.contract.monthly, hourly: plane.contract.hourly }, { ownership: 'financed', kind: 'loan', monthly: 3_370, hourly: null });
  assert.equal(loanPayment(224_000, 84), 3_370);
  assert.equal(r.body.company.netWorth, m0.company.netWorth - 56_850, 'the debt cancels the aircraft value; only the down payment and fee are gone');
  warp(h, at(2026, 12));
  const f = (await h.call('GET', `${V1}/me/finance`, { token })).body;
  assert.equal(f.contracts.length, 1);
  assert.equal(f.contracts[0].balance, 224_000 - (3_370 - Math.round(224_000 * 0.069 / 12)), 'one instalment billed: principal reduced by its capital share');
  const l = await ledger(h, token);
  assert.equal(ofKind(l, 'loan_installment')[0]!.amount, -3_370);
  assert.equal(ofKind(l, 'loan_installment')[0]!.at, Date.UTC(2026, 11, 1));
  const poor = await h.register('poorloan');
  setBalance(h, poor.me.company.id, 1_000);
  const no = await h.call('POST', `${V1}/me/fleet`, { token: poor.token, body });
  assert.deepEqual({ s: no.status, e: no.body.error, needed: no.body.needed, options: no.body.options }, { s: 409, e: 'insufficient_funds', needed: 56_850, options: undefined });
  assert.equal((await h.call('POST', `${V1}/me/fleet`, { token, body: { ...body, financing: { downPct: 10, months: 84 } } })).status, 400, 'down payment 20-50 %');
  assert.equal((await h.call('POST', `${V1}/me/fleet`, { token, body: { ...body, financing: { downPct: 20, months: 24 } } })).status, 400, 'term 36-120 months');
});

test('lease offers: deterministic per type and day, mockup lessors and rents, three by default', async () => {
  const h = await harness();
  const { token } = await h.register('lessee');
  const three = (await h.call('GET', `${V1}/leasing/offers`, { token })).body as LeaseOffer[];
  assert.deepEqual(three.map((o) => [o.icao, o.lessor]), [['A20N', 'AerCap'], ['B738', 'SMBC Aviation'], ['E295', 'Azorra']]);
  assert.deepEqual(three.map((o) => o.minMonths), [24, 12, 18]);
  assert.deepEqual(three.map((o) => o.maintenanceIncluded), [true, false, true]);
  assert.deepEqual((await h.call('GET', `${V1}/leasing/offers`, { token })).body, three, 'same day, same offers');
  const dhc6 = await offerFor(h, token, 'DHC6');
  assert.deepEqual({ lessor: dhc6.lessor, year: dhc6.year, hours: dhc6.airframeHours, d: dhc6.durations, dep: dhc6.deposit, opt: dhc6.purchaseOptionPrice, ins: dhc6.insuranceMonthly, exit: dhc6.earlyExit },
    { lessor: 'Viking Air Leasing', year: 2015, hours: 6_840, d: [{ months: 12, monthlyRent: 42_000 }, { months: 24, monthlyRent: 38_000 }, { months: 36, monthlyRent: 34_500 }], dep: 76_000, opt: 2_650_000, ins: 2_100, exit: { afterMonths: 6, penaltyRents: 2 } });
  for (let d = 0; d < 60; d++) {
    const rent = leaseOffer(catalogType('A20N'), 20_000 + d).durations.find((x) => x.months === 24)!.monthlyRent;
    assert.ok(rent >= 312_000 && rent <= 328_000, `A320neo rent ${rent} stays within 2.5 % of 320 000`);
    const b = leaseOffer(catalogType('B738'), 20_000 + d).durations.find((x) => x.months === 24)!.monthlyRent;
    assert.ok(b >= 229_000 && b <= 241_000, `B738 ${b}`);
  }
  const odd = await offerFor(h, token, 'AT76');
  assert.ok(odd.durations.length >= 2 && odd.durations[0]!.monthlyRent > 10_000 && odd.durations[0]!.monthlyRent < 100_000, 'other types scale with their value');
  assert.equal(dayOf(Date.UTC(2026, 10, 4, 12)), 20_761);
});

test('signing a lease debits first rent + deposit + convoy fee; short funds: 409 with needed; bad term, stale offer, unknown hub refused', async () => {
  const h = await harness();
  const { token, me: m0 } = await rich(h, 'signer', 3_000_000);
  const o = await offerFor(h, token, 'DHC6');
  const r = await h.call('POST', `${V1}/me/leases`, { token, body: leaseBody(o, 24) });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.firstPayment, 38_000 + 76_000 + 850);
  assert.equal(r.body.balanceAfter, 3_000_000 - 114_850);
  assert.deepEqual({ own: r.body.aircraft.ownership, kind: r.body.aircraft.contract.kind, monthly: r.body.aircraft.contract.monthly, reg: r.body.aircraft.registration, st: r.body.aircraft.status }, { own: 'leased', kind: 'lease', monthly: 38_000, reg: 'F-HAZB', st: 'available' });
  assert.equal(r.body.aircraft.contract.endsAt, Date.UTC(2028, 10, 1));
  const l = await ledger(h, token);
  assert.deepEqual([ofKind(l, 'lease_rent')[0]!.amount, ofKind(l, 'deposit')[0]!.amount, ofKind(l, 'ferry')[0]!.amount], [-38_000, -76_000, -850]);
  const after = await me(h, token);
  assert.equal(after.company.netWorth, m0.company.netWorth + (3_000_000 - 400_000) - 38_000 - 850, 'leased aircraft are not assets; the deposit is');
  const poor = await h.register('poorlessee');
  setBalance(h, poor.me.company.id, 100_000);
  const no = await h.call('POST', `${V1}/me/leases`, { token: poor.token, body: leaseBody(o, 24) });
  assert.deepEqual({ s: no.status, e: no.body.error, needed: no.body.needed }, { s: 409, e: 'insufficient_funds', needed: 114_850 });
  assert.equal((await h.call('POST', `${V1}/me/leases`, { token, body: leaseBody(o, 18) })).body.error, 'invalid_term');
  assert.equal((await h.call('POST', `${V1}/me/leases`, { token, body: { ...leaseBody(o, 24), hub: 'EGLL' } })).body.error, 'not_a_hub');
  assert.equal((await h.call('POST', `${V1}/me/leases`, { token, body: { ...leaseBody(o, 24), offerId: 'L-DHC6-1' } })).body.error, 'offer_not_found');
  assert.equal((await h.call('POST', `${V1}/me/leases`, { token, body: { offerId: 'nope', months: 24, hub: 'LFPG' } })).body.error, 'offer_not_found');
});

test('billing is lazy and idempotent per UTC month: running twice charges once; skipped months are caught up', async () => {
  const h = await harness();
  const { token, me: m0 } = await h.register('biller');
  const id = m0.company.id as number;
  assert.equal(ofKind(await ledger(h, token), 'parking').length, 0, 'no charge in the month of creation');
  warp(h, at(2026, 12));
  assert.equal(tx(h.db, () => runBilling(h.db, id, h.clock.t)), 1, 'December is billed once');
  assert.equal(tx(h.db, () => runBilling(h.db, id, h.clock.t)), 0, 'running again bills nothing');
  await me(h, token);
  await me(h, token);
  let l = await ledger(h, token);
  assert.equal(ofKind(l, 'parking').length, 1);
  assert.equal(ofKind(l, 'parking')[0]!.amount, -PARKING_FEE_BY_SIZE.large);
  assert.equal(ofKind(l, 'parking')[0]!.at, Date.UTC(2026, 11, 1));
  assert.equal(ofKind(l, 'insurance')[0]!.amount, -82, 'C172 hull insurance: 0.21 % of 39 040 a month');
  assert.equal((await me(h, token)).company.balance, 400_000 - 3_900 - 82);
  warp(h, at(2027, 2, 10));
  await me(h, token);
  l = await ledger(h, token);
  assert.deepEqual(ofKind(l, 'parking').map((t) => t.at), [Date.UTC(2027, 1, 1), Date.UTC(2027, 0, 1), Date.UTC(2026, 11, 1)], 'January and February caught up');
  assert.equal(get<{ n: number }>(h.db, 'SELECT COUNT(*) AS n FROM billing_runs WHERE company_id = ?', id)!.n, 4);
  assert.equal(l.reduce((s, t) => s + t.amount, 0), (await me(h, token)).company.balance, 'ledger sums to the balance');
});

test('lease billing: rent, insurance and parking on the 1st; /me/finance projects the next charges', async () => {
  const h = await harness();
  const { token } = await rich(h, 'rentpayer', 3_000_000);
  const o = await offerFor(h, token, 'DHC6');
  await h.call('POST', `${V1}/me/leases`, { token, body: leaseBody(o, 24) });
  const before = (await h.call('GET', `${V1}/me/finance`, { token })).body;
  const next = before.upcoming.filter((c: { at: number }) => c.at === Date.UTC(2026, 11, 1));
  assert.deepEqual(next.map((c: { kind: string; amount: number }) => [c.kind, c.amount]).sort(), [['insurance', -2_100], ['insurance', -82], ['lease_rent', -38_000], ['parking', -3_900], ['parking', -3_900]].sort());
  assert.equal(before.contracts[0].kind, 'lease');
  const l = await ledger(h, token);
  warp(h, at(2026, 12));
  const after = await ledger(h, token);
  assert.equal(after.length - l.length, 5);
  assert.deepEqual(ofKind(after, 'lease_rent').map((t) => t.amount), [-38_000, -38_000]);
  assert.equal(ofKind(after, 'insurance').length, 2);
  assert.equal(ofKind(after, 'parking').length, 2);
});

test('early exit: refused before the minimum, then pays the penalty and returns the deposit; the aircraft leaves the fleet', async () => {
  const h = await harness();
  const { token } = await rich(h, 'quitter', 3_000_000);
  const o = await offerFor(h, token, 'DHC6');
  const sign = await h.call('POST', `${V1}/me/leases`, { token, body: leaseBody(o, 24) });
  const lease = sign.body.aircraft.contract.id as number;
  warp(h, at(2027, 3));
  const early = await h.call('POST', `${V1}/me/leases/${lease}/terminate`, { token });
  assert.deepEqual({ s: early.status, e: early.body.error, paid: early.body.monthsPaid, after: early.body.afterMonths }, { s: 409, e: 'too_early', paid: 5, after: 6 });
  warp(h, at(2027, 4));
  const balance = (await me(h, token)).company.balance;
  const r = await h.call('POST', `${V1}/me/leases/${lease}/terminate`, { token });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual({ penalty: r.body.penalty, refund: r.body.depositRefunded, balanceAfter: r.body.balanceAfter }, { penalty: 76_000, refund: 76_000, balanceAfter: balance });
  assert.equal(ofKind(await ledger(h, token), 'deposit_refund')[0]!.amount, 76_000);
  assert.equal((await me(h, token)).fleet.length, 1, 'the leased aircraft is gone');
  assert.equal((await h.call('POST', `${V1}/me/leases/${lease}/terminate`, { token })).body.error, 'contract_not_found');
  assert.equal((await h.call('POST', `${V1}/me/leases/${lease}/buyout`, { token })).status, 404);
});

test('purchase option: pay the option price minus the deposit, the aircraft becomes owned and rents stop', async () => {
  const h = await harness();
  const { token } = await rich(h, 'buyer', 10_000_000);
  const o = await offerFor(h, token, 'DHC6');
  const sign = await h.call('POST', `${V1}/me/leases`, { token, body: leaseBody(o, 24) });
  const lease = sign.body.aircraft.contract.id as number;
  assert.equal((await h.call('POST', `${V1}/me/leases/${lease}/buyout`, { token })).body.error, 'too_early');
  warp(h, at(2027, 4));
  const before = (await me(h, token)).company.balance;
  const r = await h.call('POST', `${V1}/me/leases/${lease}/buyout`, { token });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual({ own: r.body.aircraft.ownership, contract: r.body.aircraft.contract, paid: r.body.firstPayment, after: r.body.balanceAfter }, { own: 'owned', contract: null, paid: 2_650_000, after: before - 2_650_000 + 76_000 });
  const l = await ledger(h, token);
  assert.deepEqual([ofKind(l, 'purchase_aircraft')[0]!.amount, ofKind(l, 'deposit_refund')[0]!.amount], [-2_650_000, 76_000]);
  const poor = await rich(h, 'poorbuyer', 200_000);
  const po = await offerFor(h, poor.token, 'DHC6');
  const ps = await h.call('POST', `${V1}/me/leases`, { token: poor.token, body: leaseBody(po, 12) });
  warp(h, at(2027, 11));
  const fail = await h.call('POST', `${V1}/me/leases/${ps.body.aircraft.contract.id}/buyout`, { token: poor.token });
  const deposit = (await h.call('GET', `${V1}/me/finance`, { token: poor.token })).body.contracts[0].deposit;
  assert.deepEqual({ s: fail.status, e: fail.body.error, needed: fail.body.needed }, { s: 409, e: 'insufficient_funds', needed: 2_650_000 - deposit });
});

test('a lease that runs to its end returns the aircraft and the deposit', async () => {
  const h = await harness();
  const { token } = await rich(h, 'finisher', 5_000_000);
  const o = await offerFor(h, token, 'DHC6');
  await h.call('POST', `${V1}/me/leases`, { token, body: leaseBody(o, 12) });
  warp(h, at(2027, 10));
  assert.equal((await me(h, token)).fleet.length, 2, 'still leased in the last month');
  warp(h, at(2027, 11));
  const m = await me(h, token);
  assert.equal(m.fleet.length, 1);
  const l = await ledger(h, token);
  assert.equal(ofKind(l, 'lease_rent').length, 12, 'twelve rents in all');
  assert.equal(ofKind(l, 'deposit_refund')[0]!.amount, 76_000, 'deposit = two rents of the 24-month price');
});

test('parking: ten spots per hub; buying or leasing into a full hub is 409 hub_full, club aircraft take none', async () => {
  const h = await harness();
  const { token } = await h.register('crowded');
  for (let i = 0; i < PARKING_SPOTS_PER_HUB - 1; i++) assert.equal((await h.call('POST', `${V1}/me/fleet`, { token, body: { icao: 'C152', hub: 'LFPG' } })).status, 201);
  assert.deepEqual((await h.call('GET', `${V1}/me/hubs`, { token })).body, [{ icao: 'LFPG', spots: 10, used: 10 }]);
  const full = await h.call('POST', `${V1}/me/fleet`, { token, body: { icao: 'C152', hub: 'LFPG' } });
  assert.deepEqual({ s: full.status, e: full.body.error }, { s: 409, e: 'hub_full' });
  assert.equal((await h.call('POST', `${V1}/me/fleet`, { token, body: { icao: 'C152', hub: 'LFPG', financing: { downPct: 20, months: 36 } } })).body.error, 'hub_full');
  const o = await offerFor(h, token, 'C172');
  assert.equal((await h.call('POST', `${V1}/me/leases`, { token, body: leaseBody(o, 12) })).body.error, 'hub_full');
  assert.equal((await h.call('POST', `${V1}/me/club-rental`, { token, body: { hub: 'LFPG', icao: 'C172' } })).status, 201, 'the club parks its own aircraft');
  assert.equal((await h.call('GET', `${V1}/me/hubs`, { token })).body[0].used, 10);
  assert.equal((await h.call('POST', `${V1}/me/hubs`, { token, body: { icao: 'EGLL' } })).status, 201);
  assert.equal((await h.call('POST', `${V1}/me/fleet`, { token, body: { icao: 'C152', hub: 'EGLL' } })).status, 201, 'another hub has free spots');
  assert.deepEqual((await h.call('GET', `${V1}/me/hubs`, { token })).body, [{ icao: 'EGLL', spots: 10, used: 1 }, { icao: 'LFPG', spots: 10, used: 10 }]);
});

test('club hours are billed at settlement per block hour (ledger kind club_hours), no fixed cost, no maintenance', async () => {
  const h = await harness();
  const { token, me: m0 } = await h.register('clubber');
  const key = await h.apiKey(token);
  const r = await h.call('POST', `${V1}/me/club-rental`, { token, body: { hub: 'LFPG', icao: 'C172' } });
  assert.equal(r.status, 201, r.text);
  assert.deepEqual({ own: r.body.aircraft.ownership, kind: r.body.aircraft.contract.kind, hourly: r.body.aircraft.contract.hourly, monthly: r.body.aircraft.contract.monthly, paid: r.body.firstPayment }, { own: 'club', kind: 'club', hourly: CLUB.C172!.hourly, monthly: 0, paid: 0 });
  assert.equal(r.body.balanceAfter, m0.company.balance);
  assert.equal((await h.call('POST', `${V1}/me/club-rental`, { token, body: { hub: 'LFPG', icao: 'C172' } })).body.error, 'already_rented');
  assert.equal((await h.call('POST', `${V1}/me/club-rental`, { token, body: { hub: 'LFPG', icao: 'A20N' } })).body.error, 'not_offered');
  const club = r.body.aircraft.id as number;
  const job = await h.flyableJob(token, club);
  const accept = await h.call('POST', `${V1}/jobs/${job.id}/accept`, { token, body: { aircraftId: club } });
  assert.equal(accept.status, 201, accept.text);
  const rep = h.goodReport(job);
  const hours = (Date.parse(rep.landedAt) - Date.parse(rep.takeoffAt)) / HOUR;
  const done = await h.call('POST', `${V1}/flights/${accept.body.id}/telemetry-verify`, { token: key, body: rep });
  assert.equal(done.status, 200, done.text);
  const f = done.body.flight;
  assert.equal(f.fuelCost, Math.round(210 * hours));
  assert.equal(f.maintenance, 0);
  assert.equal(f.net, f.revenue - f.fuelCost - f.landingFee);
  const l = await ledger(h, token);
  assert.deepEqual([ofKind(l, 'club_hours')[0]!.amount, ofKind(l, 'fuel').length, ofKind(l, 'maintenance')[0]!.amount], [-f.fuelCost, 0, 0]);
  assert.equal(l.reduce((s, t) => s + t.amount, 0), (await me(h, token)).company.balance);
});

test('monthly rental: deposit + first month now, fixed fee each month, fuel at the real price, deposit back after the minimum term', async () => {
  const h = await harness();
  const { token, me: m0 } = await h.register('renter');
  setBalance(h, m0.company.id, 45_000);
  const r = await h.call('POST', `${V1}/me/monthly-rental`, { token, body: { hub: 'LFPG', icao: 'C172' } });
  assert.equal(r.status, 201, r.text);
  const spec = MONTHLY_RENTAL.C172!;
  assert.deepEqual({ own: r.body.aircraft.ownership, kind: r.body.aircraft.contract.kind, monthly: r.body.aircraft.contract.monthly, hourly: r.body.aircraft.contract.hourly, paid: r.body.firstPayment, bal: r.body.balanceAfter },
    { own: 'rented', kind: 'rental', monthly: 1_900, hourly: 110, paid: 6_900, bal: 45_000 - 6_900 });
  assert.equal(spec.minMonths, 6);
  const id = r.body.aircraft.contract.id as number;
  warp(h, at(2026, 12));
  await me(h, token);
  let l = await ledger(h, token);
  assert.equal(ofKind(l, 'lease_rent').length, 2);
  assert.equal(ofKind(l, 'parking').length, 1, 'only the starter pays parking; the rented aircraft does not');
  assert.equal((await h.call('POST', `${V1}/me/leases/${id}/terminate`, { token })).body.error, 'too_early');
  warp(h, at(2027, 4));
  const stop = await h.call('POST', `${V1}/me/leases/${id}/terminate`, { token });
  assert.deepEqual({ s: stop.status, penalty: stop.body.penalty, refund: stop.body.depositRefunded }, { s: 200, penalty: 0, refund: 5_000 });
  l = await ledger(h, token);
  assert.equal(ofKind(l, 'deposit_refund')[0]!.amount, 5_000);
  assert.equal(ofKind(l, 'lease_rent').length, 6, 'six months of fixed fee, as the minimum term says');
});

test('wear accrues per block hour; at the threshold the aircraft goes to maintenance, cannot fly, and is back with low wear', async () => {
  const h = await harness();
  const { token, me: m0 } = await h.register('wearer');
  assert.equal((await h.call('PUT', `${V1}/companies/${m0.company.id}/realism`, { token, body: { preset: 'balanced' } })).status, 200, 'wear is a realism choice: a pre-v2 company has none');
  const key = await h.apiKey(token);
  const plane = m0.fleet[0].id as number;
  const job = await h.flyableJob(token, plane);
  const accept = await h.call('POST', `${V1}/jobs/${job.id}/accept`, { token, body: { aircraftId: plane } });
  assert.equal(accept.status, 201, accept.text);
  const rep = h.goodReport(job);
  const hours = (Date.parse(rep.landedAt) - Date.parse(rep.takeoffAt)) / HOUR;
  await h.call('POST', `${V1}/flights/${accept.body.id}/telemetry-verify`, { token: key, body: rep });
  const w1 = (await me(h, token)).fleet[0];
  assert.equal(w1.wearPct, Math.round(0.8 * hours * 10) / 10, 'piston single: 0.8 % per block hour');
  assert.equal(w1.status, 'available');
  run(h.db, 'UPDATE aircraft SET wear_pct = 79.9 WHERE id = ?', plane);
  const job2 = await h.flyableJob(token, plane);
  const a2 = await h.call('POST', `${V1}/jobs/${job2.id}/accept`, { token, body: { aircraftId: plane } });
  assert.equal(a2.status, 201, a2.text);
  const rep2 = h.goodReport(job2);
  const done = h.clock.t;
  await h.call('POST', `${V1}/flights/${a2.body.id}/telemetry-verify`, { token: key, body: rep2 });
  const w2 = (await me(h, token)).fleet[0];
  assert.deepEqual({ st: w2.status, until: w2.maintenanceUntil }, { st: 'maintenance', until: done + 12 * HOUR });
  const job3 = await h.flyableJob(token, plane);
  const blocked = await h.call('POST', `${V1}/jobs/${job3.id}/accept`, { token, body: { aircraftId: plane } });
  assert.deepEqual({ s: blocked.status, e: blocked.body.error }, { s: 409, e: 'in_maintenance' });
  h.clock.t = done + 13 * HOUR;
  const w3 = (await me(h, token)).fleet[0];
  assert.deepEqual({ st: w3.status, wear: w3.wearPct, until: w3.maintenanceUntil }, { st: 'available', wear: 5, until: null });
});

test('a lease with maintenance included pays no maintenance on its flights', async () => {
  const h = await harness();
  const { token } = await rich(h, 'covered', 2_000_000);
  const key = await h.apiKey(token);
  const o = await offerFor(h, token, 'C172');
  const sign = await h.call('POST', `${V1}/me/leases`, { token, body: leaseBody(o, 12) });
  assert.equal(sign.status, 201, sign.text);
  const plane = sign.body.aircraft.id as number;
  const flyOnce = async (): Promise<{ maintenance: number }> => {
    const job = await h.flyableJob(token, plane);
    const a = await h.call('POST', `${V1}/jobs/${job.id}/accept`, { token, body: { aircraftId: plane } });
    assert.equal(a.status, 201, a.text);
    return (await h.call('POST', `${V1}/flights/${a.body.id}/telemetry-verify`, { token: key, body: h.goodReport(job) })).body.flight;
  };
  run(h.db, `UPDATE contracts SET terms = json_set(terms, '$.maintenanceIncluded', json('false')) WHERE aircraft_id = ?`, plane);
  assert.ok((await flyOnce()).maintenance > 0, 'maintenance is on the lessee when the lease does not include it');
  run(h.db, `UPDATE contracts SET terms = json_set(terms, '$.maintenanceIncluded', json('true')) WHERE aircraft_id = ?`, plane);
  assert.equal((await flyOnce()).maintenance, 0);
});

test('finance routes need a session and only touch the caller company', async () => {
  const h = await harness();
  const a = await rich(h, 'owner', 3_000_000);
  const b = await rich(h, 'intruder', 3_000_000);
  for (const [m, u] of [['GET', '/leasing/offers'], ['GET', '/me/finance'], ['GET', '/me/hubs'], ['POST', '/me/leases'], ['POST', '/me/club-rental']] as const) {
    assert.equal((await h.call(m, `${V1}${u}`, {})).status, 401, u);
  }
  const o = await offerFor(h, a.token, 'DHC6');
  const sign = await h.call('POST', `${V1}/me/leases`, { token: a.token, body: leaseBody(o, 24) });
  const id = sign.body.aircraft.contract.id;
  assert.equal((await h.call('POST', `${V1}/me/leases/${id}/terminate`, { token: b.token })).status, 404);
  assert.equal((await h.call('GET', `${V1}/me/finance`, { token: b.token })).body.contracts.length, 0);
  assert.equal((await h.call('POST', `${V1}/me/leases/abc/terminate`, { token: a.token })).status, 404);
});

test('planMonth: the insurance rise multiplies the premiums and nothing else, facilities included', () => {
  const start = Date.UTC(2026, 11, 1);
  const fleet = [{ id: 1, registration: 'F-TEST', base: null, ownership: 'owned' as const, value: 1_000_000, category: 'turboprop-airliner' as const, acquired_at: 1, busy: false }];
  const building = { id: 1, label: 'LFMN MX1', kind: 'lease' as const, started_at: 1, months: 36, months_paid: 0, monthly: 5000, upkeep: 0, principal: 0, income: 0 };
  const base = planMonth(start, [], fleet, [], [building]);
  const risen = planMonth(start, [], fleet, [], [building], 0.12);
  const by = (p: typeof base, kind: string) => p.charges.filter((c) => c.kind === kind);
  assert.equal(by(base, 'insurance').length, 1);
  assert.equal(by(risen, 'insurance')[0]!.amount, Math.round(by(base, 'insurance')[0]!.amount * 1.12));
  assert.match(by(risen, 'insurance')[0]!.memo, /\+12 %$/);
  assert.deepEqual(by(risen, 'facility_rent'), by(base, 'facility_rent'));
  assert.equal(by(risen, 'facility_rent')[0]!.amount, -5000);
});
