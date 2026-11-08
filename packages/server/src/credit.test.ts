import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CREDIT_AMOUNT_MAX, CREDIT_BANKS, CREDIT_FLOOR, CREDIT_LATE_REPUTATION, CREDIT_STEP, CREDIT_MAX_ACTIVE, OVERDRAFT_LIMIT, UNPAID_FEE_PCT, categoryOf, creditCeiling, creditRequestSchema, creditSchedule, creditTerms, lateFee, loanPayment, overdraftInterest, planCreditMonth, prepayPlan, ratingOf,
  type CreditQuote, type CreditSheet, type CreditsView, type CreditState,
} from '@opc/shared';
import { all, get, MIGRATIONS, run } from './db.ts';
import { insertAircraft } from './fleet-extras.ts';
import { runBilling } from './finance.ts';
import { post } from './ledger.ts';
import { overdraftLow } from './credit.ts';
import { debtOf } from './reports.ts';
import { companyView } from './game.ts';
import { harness } from './harness.ts';

const V1 = '/api/v1';
const DAY = 86_400_000;
const OCT = Date.UTC(2026, 9, 15);

/** A player whose last full month (October) earned `revenue`, with the balance set to exactly `balance` by a posting (so the ledger and the balance agree). */
async function world(o: { revenue?: number; balance?: number } = {}) {
  const h = await harness();
  const u = await h.register('amy', 'LFPG');
  const cid = u.me.company.id as number;
  if (o.revenue) post(h.db, cid, OCT, 'line_revenue', o.revenue, 'seed');
  const setBalance = (b: number) => post(h.db, cid, h.clock.t, 'grant', b - balance(), 'adjust');
  const balance = () => get<{ balance: number }>(h.db, 'SELECT balance FROM companies WHERE id = ?', cid)!.balance;
  if (o.balance !== undefined) setBalance(o.balance);
  const call = async <T>(method: 'GET' | 'POST', url: string, body?: unknown, extra: { company?: number; token?: string } = {}) =>
    h.call(method, `${V1}${url}`, { token: extra.token ?? u.token, ...(body === undefined ? {} : { body }), ...(extra.company === undefined ? {} : { company: extra.company }) }) as Promise<{ status: number; body: T & { error?: string }; text: string }>;
  const advance = (days: number) => { h.clock.t += days * DAY; run(h.db, 'UPDATE sessions SET expires_at = ?', h.clock.t + 1e10); };
  const sign = (amount: number, months = 24, bank = 'alpes') => call<{ credit: { id: number }; net: number; balanceAfter: number }>('POST', '/credits', { amount, months, bank });
  const txs = (kind: string) => all<{ at: number; amount: number; memo: string }>(h.db, 'SELECT at, amount, memo FROM transactions WHERE company_id = ? AND kind = ? ORDER BY id', cid, kind);
  const credit = (id: number) => get<{ principal: number; months_paid: number; status: string; monthly: number }>(h.db, 'SELECT * FROM credits WHERE id = ?', id)!;
  return { h, u, cid, call, advance, sign, txs, balance, setBalance, credit };
}

// ---------------------------------------------------------------- pure rules

test('the offers: Alpes 24 months reproduces the frame (20 300 a month, 3 500 fee, about 40 700 of cost), the ceiling is 30 % of a month floored to 10 000 and never under 10 M, the rating follows the debt ratio', () => {
  const alpes = creditTerms(450_000, 24, 'alpes');
  assert.equal(alpes.monthly, 20_300);
  assert.equal(alpes.fee, 3_500);
  assert.equal(alpes.cost, alpes.interest + 3_500 + 112 * 24);
  assert.ok(Math.abs(alpes.cost - 40_700) < 50, `cost ${alpes.cost}`);
  assert.deepEqual([creditTerms(450_000, 24, 'meridional').monthly, creditTerms(450_000, 24, 'aerofinance').monthly], [20_467, 20_682]);
  assert.equal(creditTerms(450_000, 24, 'aerofinance').fee, 0);
  assert.equal(creditCeiling(100_000_000), 30_000_000, '30 % of a big month, above the floor');
  assert.equal(creditCeiling(41_234_567), 12_370_000, 'floored to 10 000');
  assert.equal(creditCeiling(1_000_000_000), CREDIT_AMOUNT_MAX, '30 % would be 300 M: capped at 100 M');
  assert.deepEqual([0, 100_000, 33_000_000, -5].map(creditCeiling), [CREDIT_FLOOR, CREDIT_FLOOR, CREDIT_FLOOR, CREDIT_FLOOR], 'no revenue, a small one or none: the guaranteed floor');
  assert.deepEqual([0, 0.02, 0.0201, 0.05, 0.061, 0.071, 0.09, 0.0901, 0.35, 0.36, null].map(ratingOf), ['A', 'A', 'A-', 'A-', 'B+', 'B+', 'B+', 'B', 'D', 'E', 'B'], 'no revenue to measure against: B, a new company');
});

test('early repayment maths: the term stays, the instalment falls, and what is saved is exactly the interest and insurance no longer paid; the penalty is on the amount repaid', () => {
  const principal = 300_000, months = 24, rate = CREDIT_BANKS.meridional.rate, monthly = loanPayment(principal, months, rate), insurance = 135;
  const paid = 6;
  let left = principal;
  for (const m of creditSchedule({ principal, monthly, insurance, monthsPaid: 0, months, rate }).slice(0, paid)) left -= m.capital;
  const c = { principal: left, monthly, insurance, monthsPaid: paid, months, rate, earlyPenaltyPct: 1 };
  const before = creditSchedule(c);
  const partial = prepayPlan(c, { amount: 100_000 });
  assert.equal(partial.penalty, 1_000);
  assert.equal(partial.total, 101_000);
  assert.equal(partial.principalAfter, left - 100_000);
  assert.equal(partial.monthsLeft, months - paid);
  assert.equal(partial.annuityAfter, loanPayment(left - 100_000, months - paid, rate));
  assert.equal(partial.monthlyAfter, partial.annuityAfter + insurance, 'the whole instalment, insurance included, is what the screen shows');
  assert.ok(partial.annuityAfter < monthly);
  const after = creditSchedule({ ...c, principal: partial.principalAfter, monthly: partial.annuityAfter });
  assert.equal(after.length, before.length, 'same number of instalments');
  const total = (s: typeof before) => s.reduce((t, m) => t + m.pay, 0);
  assert.equal(total(before) - (total(after) + partial.amount), partial.saved, 'what was saved is the difference of what is paid in all');
  assert.ok(partial.saved > 0);
  const full = prepayPlan(c, { full: true });
  assert.deepEqual([full.amount, full.principalAfter, full.monthlyAfter, full.closes], [left, 0, 0, true]);
  assert.equal(full.saved, before.reduce((t, m) => t + m.interest + m.insurance, 0));
  const free = prepayPlan({ ...c, earlyPenaltyPct: 0 }, { full: true });
  assert.equal(free.total, left);
});

test('overdraft interest is on the lowest balance of the month a year at 11.5 % a twelfth; the late fee is 5 % of the instalment; the credit month bills the instalment once per credit signed before it and ends the credit on the last', () => {
  assert.equal(overdraftInterest(-100_000), 958);
  assert.equal(overdraftInterest(0), 0);
  assert.equal(overdraftInterest(1_000), 0);
  assert.equal(lateFee(10_000), 500);
  assert.equal(UNPAID_FEE_PCT, 5);
  const start = Date.UTC(2026, 11, 1);
  const credit = (over: Partial<CreditState>): CreditState => ({ id: 1, principal: 10_000, rate: 0.072, months: 2, months_paid: 1, monthly: 5_100, insurance: 10, started_at: start - DAY, status: 'active', ...over });
  const last = planCreditMonth(start, { credits: [credit({}), credit({ id: 2, started_at: start })], overdraftLow: -100_000 });
  assert.deepEqual(last.charges.map((c) => c.kind), ['overdraft_interest', 'credit_installment'], 'the credit signed this month pays nothing yet');
  assert.equal(last.credits[0]!.status, 'repaid');
  assert.equal(last.credits[0]!.principal, 0);
  assert.equal(last.credits[1]!.months_paid, 1, 'the one signed this month is untouched');
  assert.equal(last.charges[1]!.amount, -(10_000 + Math.round((10_000 * 0.072) / 12) + 10), 'the last instalment clears the principal');
  for (const k of ['credit', 'credit_fee', 'credit_installment', 'credit_prepay', 'credit_late_fee', 'overdraft_interest']) assert.equal(categoryOf(k), 'credits', k);
});

test('overdraftLow reads the ledger in date order: the opening balance, then every posting; 0 when the account never went below zero', async () => {
  const w = await world();
  const m = (d: number) => Date.UTC(2026, 11, d);
  const base = get<{ s: number }>(w.h.db, 'SELECT SUM(amount) AS s FROM transactions WHERE company_id = ?', w.cid)!.s;
  post(w.h.db, w.cid, m(2), 'fuel', -(base + 80_000), 'x');
  post(w.h.db, w.cid, m(9), 'fuel', -40_000, 'x');
  post(w.h.db, w.cid, m(5), 'payout', 200_000, 'backdated');
  assert.equal(overdraftLow(w.h.db, w.cid, m(1), m(31)), -80_000, 'the dip is the lowest point in date order, not the stored running balance');
  assert.equal(overdraftLow(w.h.db, w.cid, m(1), m(2)), 0);
});

// ---------------------------------------------------------------- the ceiling and the cap

test('the ceiling is 30 % of last month revenue (10 M at least) across all the credits, the cap is two at once, and a refusal books nothing', async () => {
  const w = await world({ revenue: 100_000_000 });
  const view = (await w.call<CreditsView>('GET', '/credits')).body;
  assert.deepEqual([view.ceiling, view.room, view.active, view.maxActive, view.revenue, view.revenueMonth], [30_000_000, 30_000_000, 0, CREDIT_MAX_ACTIVE, 100_000_000, '2026-10']);
  const before = w.balance();
  const over = await w.sign(30_010_000);
  assert.deepEqual([over.status, over.body.error], [409, 'over_ceiling']);
  assert.equal(w.balance(), before);
  const first = await w.sign(20_000_000, 24, 'alpes');
  assert.equal(first.status, 201, first.text);
  assert.equal(first.body.net, 20_000_000 - 3_500);
  assert.equal(w.balance(), before + 20_000_000 - 3_500, 'the amount less the fee reaches the account');
  assert.deepEqual([w.txs('credit').length, w.txs('credit_fee')[0]!.amount], [1, -3_500]);
  assert.equal((await w.call<CreditsView>('GET', '/credits')).body.room, 10_000_000);
  const second = await w.sign(15_000_000, 12, 'aerofinance');
  assert.deepEqual([second.status, second.body.error], [409, 'over_ceiling'], 'the second credit counts the first against the same ceiling');
  assert.equal((await w.sign(10_000_000, 12, 'aerofinance')).status, 201);
  const third = await w.sign(10_000);
  assert.deepEqual([third.status, third.body.error], [409, 'too_many'], 'at most two active');
  assert.equal(all(w.h.db, 'SELECT 1 FROM credits').length, 2);
});

test('with no revenue last month a company can still borrow the guaranteed 10 M, or 10 k, but not a step more; the rating is B and signing books the credit', async () => {
  const w = await world();
  const view = (await w.call<CreditsView>('GET', '/credits')).body;
  assert.deepEqual([view.revenue, view.ratio, view.rating, view.ceiling, view.room], [0, 0, 'A', CREDIT_FLOOR, CREDIT_FLOOR]);
  const over = await w.sign(CREDIT_FLOOR + 10_000);
  assert.deepEqual([over.status, over.body.error], [409, 'over_ceiling']);
  const before = w.balance();
  const all10m = await w.sign(CREDIT_FLOOR);
  assert.equal(all10m.status, 201, all10m.text);
  assert.equal(w.balance(), before + CREDIT_FLOOR - 3_500);
  const after = (await w.call<CreditsView>('GET', '/credits')).body;
  assert.deepEqual([after.room, after.ratio, after.rating], [0, null, 'B'], 'instalments owed against no revenue: no ratio, rated B');
  assert.equal((await w.sign(10_000)).body.error, 'over_ceiling', 'the floor is for all the credits together');
  const small = await world();
  assert.equal((await small.sign(10_000)).status, 201, 'the smallest credit is 10 k');
});

test('a heavy existing debt refuses on the debt ratio above the guaranteed floor, not inside it; the quote says why, and signing needs a valid body', async () => {
  const w = await world({ revenue: 100_000_000 });
  const ac = insertAircraft(w.h.db, { companyId: w.cid, icao: 'AT76', hub: 'LFPG', value: 1_000_000, ownership: 'financed', at: w.h.clock.t });
  run(w.h.db, "INSERT INTO contracts (company_id, aircraft_id, kind, started_at, months, monthly, principal) VALUES (?, ?, 'loan', ?, 36, 40000000, 900000000)", w.cid, ac, w.h.clock.t - 40 * DAY);
  const ask = (amount: number) => ({ amount, months: 24, bank: 'alpes' });
  const above = (await w.call<CreditSheet>('POST', '/credits/quote', ask(CREDIT_FLOOR + CREDIT_STEP))).body;
  assert.equal(above.quote.refusal, 'debt_ratio');
  assert.deepEqual([above.quote.ratio.before, above.quote.rating.before], [0.4, 'E']);
  assert.equal((await w.sign(CREDIT_FLOOR + CREDIT_STEP)).body.error, 'debt_ratio');
  assert.equal((await w.call<CreditSheet>('POST', '/credits/quote', ask(CREDIT_FLOOR))).body.quote.refusal, null, 'inside the floor the ratio is not read');
  assert.equal((await w.sign(CREDIT_FLOOR)).status, 201);
  for (const bad of [{ amount: 100_000, months: 25, bank: 'alpes' }, { amount: 100_000, months: 24, bank: 'nope' }, { amount: 10, months: 24, bank: 'alpes' }, { amount: 100_000.5, months: 24, bank: 'alpes' }, { amount: 15_000, months: 24, bank: 'alpes' }, {}]) {
    assert.equal((await w.call('POST', '/credits', bad)).status, 400, JSON.stringify(bad));
  }
});

test('the request schema takes 10 000 up to 100 M in steps of 10 000: 100 M passes, 100 M plus a step and anything off the step fail', () => {
  const ok = (amount: number) => creditRequestSchema.safeParse({ amount, months: 24, bank: 'alpes' }).success;
  assert.deepEqual([10_000, 20_000, CREDIT_FLOOR, CREDIT_AMOUNT_MAX].map(ok), [true, true, true, true]);
  assert.deepEqual([CREDIT_AMOUNT_MAX + CREDIT_STEP, 9_999, 0, 15_000, 10_000.5].map(ok), [false, false, false, false, false]);
});

test('the quote prices the credit, the three banks and the five durations, and shows the ratio and the balance after; it books nothing', async () => {
  const w = await world({ revenue: 2_000_000 });
  const before = w.balance();
  const sheet = (await w.call<CreditSheet>('POST', '/credits/quote', { amount: 450_000, months: 24, bank: 'alpes' })).body;
  const q: CreditQuote = sheet.quote;
  assert.deepEqual([q.monthly, q.fee, q.net, q.balanceAfter, q.refusal, q.earlyPenaltyPct], [20_300, 3_500, 446_500, before + 446_500, null, 0]);
  assert.deepEqual([sheet.banks.map((b) => b.bank), sheet.durations.map((d) => d.months)], [['alpes', 'meridional', 'aerofinance'], [12, 24, 36, 48, 60]]);
  assert.ok(sheet.durations[0]!.monthly > sheet.durations[4]!.monthly && sheet.durations[0]!.cost < sheet.durations[4]!.cost, 'longer: lower instalment, higher cost');
  assert.equal(q.ratio.before, 0);
  assert.equal(q.ratio.after, 20_300 / 2_000_000);
  assert.equal(w.balance(), before);
  assert.equal(all(w.h.db, 'SELECT 1 FROM credits').length, 0);
});

// ---------------------------------------------------------------- billing: once a month, replay-safe

test('the instalment is billed once on the 1st of each month; asking again or replaying the run changes nothing; a missed stretch is caught up month by month; the last instalment ends the credit', async () => {
  const w = await world({ revenue: 1_000_000 });
  const signed = await w.sign(100_000, 12, 'alpes');
  assert.equal(signed.status, 201, signed.text);
  const id = signed.body.credit.id;
  assert.equal(w.txs('credit_installment').length, 0, 'nothing in the month of signing');
  w.advance(30); // 4 Dec
  assert.equal((await w.call('GET', '/credits')).status, 200);
  const dec = w.txs('credit_installment');
  assert.deepEqual([dec.length, dec[0]!.at, dec[0]!.memo], [1, Date.UTC(2026, 11, 1), `credit #${id} instalment 1/12`]);
  const paid = -dec[0]!.amount;
  assert.equal(paid, loanPayment(100_000, 12, 0.072) + 112);
  const balance = w.balance();
  for (let i = 0; i < 3; i++) await w.call('GET', '/credits');
  assert.equal(runBilling(w.h.db, w.cid, w.h.clock.t), 0, 'the month is already billed');
  assert.deepEqual([w.txs('credit_installment').length, w.credit(id).months_paid, w.balance()], [1, 1, balance]);
  w.advance(75); // into February: January and February are caught up in one run
  await w.call('GET', '/credits');
  assert.equal(w.txs('credit_installment').length, 3);
  assert.deepEqual(w.txs('credit_installment').map((t) => t.at), [Date.UTC(2026, 11, 1), Date.UTC(2027, 0, 1), Date.UTC(2027, 1, 1)]);
  assert.equal(w.credit(id).months_paid, 3);
  w.advance(300);
  await w.call('GET', '/credits');
  assert.equal(w.txs('credit_installment').length, 12);
  assert.deepEqual([w.credit(id).status, w.credit(id).principal], ['repaid', 0]);
  w.advance(60);
  await w.call('GET', '/credits');
  assert.equal(w.txs('credit_installment').length, 12, 'a repaid credit is never billed again');
  assert.deepEqual((await w.call<CreditsView>('GET', '/credits')).body.credits, []);
});

test('an unpaid instalment is still taken, costs the late fee and reputation, and seizes nothing; the credit goes on', async () => {
  const w = await world({ revenue: 1_000_000 });
  const id = (await w.sign(100_000, 12, 'alpes')).body.credit.id;
  const instalment = loanPayment(100_000, 12, 0.072) + 112;
  w.setBalance(-(OVERDRAFT_LIMIT - 1_000));
  const reputation = () => get<{ reputation: number }>(w.h.db, 'SELECT reputation FROM companies WHERE id = ?', w.cid)!.reputation;
  const rep = reputation();
  w.advance(30);
  await w.call('GET', '/credits');
  assert.equal(-w.txs('credit_installment')[0]!.amount, instalment, 'the instalment is taken in full');
  const fee = w.txs('credit_late_fee');
  assert.equal(fee.length, 1);
  assert.equal(fee[0]!.amount, -Math.round((instalment * UNPAID_FEE_PCT) / 100));
  assert.equal(reputation(), rep - CREDIT_LATE_REPUTATION);
  assert.deepEqual([w.credit(id).status, w.credit(id).months_paid], ['active', 1]);
  assert.equal(all(w.h.db, 'SELECT 1 FROM aircraft WHERE company_id = ? AND returned_at IS NOT NULL', w.cid).length, 0, 'no seizure');
  for (let i = 0; i < 2; i++) await w.call('GET', '/credits');
  assert.deepEqual([w.txs('credit_late_fee').length, reputation()], [1, rep - CREDIT_LATE_REPUTATION], 'a replay does not charge the fee or the reputation twice');
});

test('an instalment that fits inside the overdraft costs no fee and no reputation', async () => {
  const w = await world({ revenue: 1_000_000 });
  await w.sign(100_000, 12, 'alpes');
  w.setBalance(-100_000);
  const rep = get<{ reputation: number }>(w.h.db, 'SELECT reputation FROM companies WHERE id = ?', w.cid)!.reputation;
  w.advance(30);
  await w.call('GET', '/credits');
  assert.deepEqual([w.txs('credit_installment').length, w.txs('credit_late_fee').length], [1, 0]);
  assert.equal(get<{ reputation: number }>(w.h.db, 'SELECT reputation FROM companies WHERE id = ?', w.cid)!.reputation, rep);
});

// ---------------------------------------------------------------- the overdraft

test('a purchase may take the balance below zero down to the limit and no further; every spend path answers insufficient_funds beyond it', async () => {
  const w = await world({ balance: 10_000 });
  const hub = (icao: string) => w.call('POST', '/me/hubs', { icao });
  assert.equal((await hub('LFLL')).status, 201, 'the hub costs 50 000: the balance goes to -40 000');
  assert.equal(w.balance(), -40_000);
  w.setBalance(-(OVERDRAFT_LIMIT - 49_999));
  const refused = await hub('LFBO');
  assert.deepEqual([refused.status, refused.body.error], [402, 'insufficient_funds']);
  assert.equal(w.balance(), -(OVERDRAFT_LIMIT - 49_999), 'a refused purchase changes nothing');
  w.setBalance(-OVERDRAFT_LIMIT + 50_000);
  assert.equal((await hub('LFBO')).status, 201, 'exactly to the limit is allowed');
  assert.equal(w.balance(), -OVERDRAFT_LIMIT);
  const aircraft = await w.call<{ error?: string }>('POST', '/me/fleet', { icao: 'C172', hub: 'LFPG' });
  assert.deepEqual([aircraft.status, aircraft.body.error], [409, 'insufficient_funds'], 'the aircraft purchase is guarded by the same limit');
});

test('the overdraft costs 11.5 % a year on the lowest balance of the month, billed once on the 1st; a month never overdrawn costs nothing', async () => {
  const w = await world();
  w.setBalance(-100_000);
  w.advance(30); // 4 Dec: November was overdrawn from the 4th
  await w.call('GET', '/credits');
  const interest = w.txs('overdraft_interest');
  assert.deepEqual([interest.length, interest[0]!.amount, interest[0]!.at], [1, -958, Date.UTC(2026, 11, 1)]);
  for (let i = 0; i < 2; i++) await w.call('GET', '/credits');
  assert.equal(w.txs('overdraft_interest').length, 1, 'replay-safe');
  const view = (await w.call<CreditsView>('GET', '/credits')).body;
  assert.equal(view.overdraft.limit, OVERDRAFT_LIMIT);
  assert.ok(view.overdraft.low < -100_000, 'December so far is lower still, the interest of the month is announced');
  assert.equal(view.overdraft.interest, overdraftInterest(view.overdraft.low));
  const healthy = await world({ balance: 500_000 });
  healthy.advance(30);
  await healthy.call('GET', '/credits');
  assert.equal(healthy.txs('overdraft_interest').length, 0);
});

// ---------------------------------------------------------------- early repayment, over HTTP

test('early repayment: the quote and the repayment agree, the bank penalty is on the amount, a partial one lowers the instalment, a full one closes the credit; too much or too little cash is refused', async () => {
  const w = await world({ revenue: 2_000_000 });
  const id = (await w.sign(300_000, 24, 'meridional')).body.credit.id;
  w.advance(95); // three instalments paid
  await w.call('GET', '/credits');
  const row = w.credit(id);
  assert.equal(row.months_paid, 3);
  const quote = (await w.call<{ amount: number; penalty: number; total: number; principalAfter: number; annuityAfter: number; monthlyAfter: number; saved: number; balanceAfter: number; refusal: null }>('POST', `/credits/${id}/prepay/quote`, { amount: 100_000 })).body;
  assert.deepEqual([quote.amount, quote.penalty, quote.total, quote.principalAfter, quote.refusal], [100_000, 1_000, 101_000, row.principal - 100_000, null]);
  const balance = w.balance();
  assert.equal(w.balance(), balance, 'quoting books nothing');
  const done = await w.call<{ balanceAfter: number; credit: { principal: number; monthly: number } }>('POST', `/credits/${id}/prepay`, { amount: 100_000 });
  assert.equal(done.status, 200, done.text);
  assert.equal(w.balance(), balance - 101_000);
  assert.equal(done.body.balanceAfter, balance - 101_000);
  assert.deepEqual([w.credit(id).principal, w.credit(id).monthly, w.credit(id).months_paid], [quote.principalAfter, quote.annuityAfter, 3]);
  assert.equal(quote.monthlyAfter, quote.annuityAfter + CREDIT_BANKS.meridional.insurance);
  assert.ok(quote.annuityAfter < row.monthly);
  assert.equal(w.txs('credit_prepay').length, 2, 'the repaid amount and the penalty are two lines');
  const tooMuch = await w.call('POST', `/credits/${id}/prepay`, { amount: w.credit(id).principal + 1 });
  assert.deepEqual([tooMuch.status, tooMuch.body.error], [422, 'invalid_amount']);
  w.setBalance(-OVERDRAFT_LIMIT + 1_000);
  const broke = await w.call('POST', `/credits/${id}/prepay`, { full: true });
  assert.deepEqual([broke.status, broke.body.error], [409, 'insufficient_funds']);
  assert.equal(w.credit(id).status, 'active');
  w.setBalance(1_000_000);
  const full = await w.call<{ credit: null }>('POST', `/credits/${id}/prepay`, { full: true });
  assert.deepEqual([full.status, full.body.credit], [200, null]);
  assert.deepEqual([w.credit(id).status, w.credit(id).principal], ['repaid', 0]);
  const after = w.txs('credit_installment').length;
  w.advance(60);
  await w.call('GET', '/credits');
  assert.equal(w.txs('credit_installment').length, after, 'a repaid credit is never billed again');
  assert.equal((await w.call('POST', `/credits/${id}/prepay`, { full: true })).status, 404);
});

// ---------------------------------------------------------------- debt and net worth

test('credits count in the debt, in the instalments and in the net worth; the bailout clears the balance, never the credit', async () => {
  const w = await world({ revenue: 1_000_000 });
  const worth = () => companyView(w.h.db, w.cid).netWorth;
  const before = worth();
  const id = (await w.sign(200_000, 24, 'alpes')).body.credit.id;
  assert.equal(worth(), before - 3_500, 'the cash that came in is owed back: only the fee is lost');
  const debt = debtOf(w.h.db, w.cid);
  assert.deepEqual([debt.total, debt.credits, debt.monthly], [200_000, 1, loanPayment(200_000, 24, 0.072) + 112]);
  const view = (await w.call<CreditsView>('GET', '/credits')).body;
  assert.deepEqual([view.debt, view.instalments, view.ratio, view.rating, view.credits.length, view.schedule.length], [200_000, debt.monthly, debt.monthly / 1_000_000, 'A', 1, 24]);
  assert.equal(view.schedule.reduce((t, m) => t + m.capital, 0), 200_000);
  run(w.h.db, 'UPDATE companies SET realism = ? WHERE id = ?', JSON.stringify({ preset: 'balanced', toggles: { bankruptcyBailout: true } }), w.cid);
  w.setBalance(-300_000);
  w.advance(30);
  await w.call('GET', '/credits');
  assert.equal(w.txs('bailout').length, 1, 'the bank bailed the balance out');
  assert.ok(w.credit(id).principal > 0 && w.credit(id).status === 'active', 'and the credit is still owed');
});

// ---------------------------------------------------------------- auth

test('credits are session-only and scoped to the company: no token 401, an API key 401, someone else\'s company 403, someone else\'s credit 404', async () => {
  const w = await world({ revenue: 1_000_000 });
  const id = (await w.sign(100_000)).body.credit.id;
  const key = await w.h.apiKey(w.u.token);
  const routes: ['GET' | 'POST', string, unknown?][] = [['GET', '/credits'], ['POST', '/credits/quote', { amount: 50_000, months: 12, bank: 'alpes' }], ['POST', '/credits', { amount: 50_000, months: 12, bank: 'alpes' }],
    ['POST', `/credits/${id}/prepay/quote`, { full: true }], ['POST', `/credits/${id}/prepay`, { full: true }]];
  const other = await w.h.register('bob', 'LFPG');
  for (const [method, url, body] of routes) {
    const anon = await w.h.call(method, `${V1}${url}`, body === undefined ? {} : { body });
    assert.equal(anon.status, 401, `anonymous ${url}`);
    assert.equal((await w.call(method, url, body, { token: key })).status, 401, `API key ${url}`);
    const foreign = await w.call(method, url, body, { company: other.me.company.id });
    assert.equal(foreign.status, 403, `a company that is not hers ${url}: ${foreign.text}`);
    assert.equal(foreign.body.error, 'not_your_company');
  }
  const stranger = await w.h.call('POST', `${V1}/credits/${id}/prepay`, { token: other.token, body: { full: true } });
  assert.deepEqual([stranger.status, stranger.body.error], [404, 'credit_not_found']);
  assert.equal((await w.call('POST', '/credits/abc/prepay', { full: true })).status, 404);
  assert.equal(w.credit(id).status, 'active', 'nothing was repaid');
  assert.equal((await w.h.call('GET', `${V1}/credits`, { token: other.token })).body.credits.length, 0, 'bob sees none of her credits');
});

test('the migration adds the credits table, found by its content: one row per credit, followed on company deletion, status checked', async () => {
  const at = MIGRATIONS.findIndex((m) => m.includes('CREATE TABLE credits'));
  assert.ok(at > 0, 'found by content, not by position');
  const w = await world();
  run(w.h.db, "INSERT INTO credits (company_id, bank, principal0, principal, rate, months, monthly, fee, insurance, early_penalty_pct, started_at) VALUES (?, 'alpes', 1, 1, 0.072, 12, 1, 0, 0, 0, 1)", w.cid);
  assert.throws(() => run(w.h.db, "INSERT INTO credits (company_id, bank, principal0, principal, rate, months, monthly, fee, insurance, early_penalty_pct, started_at, status) VALUES (?, 'alpes', 1, 1, 0.072, 12, 1, 0, 0, 0, 1, 'lost')", w.cid), /CHECK/);
  run(w.h.db, 'DELETE FROM companies WHERE id = ?', w.cid);
  assert.equal(get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM credits')!.n, 0);
});
