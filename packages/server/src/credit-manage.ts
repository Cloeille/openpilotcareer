// Lot CREDIT (v4): sign a consumer credit, repay it early, and the views of the credits screens. Callers wrap the writes in `tx` and settle the month first (routes-credit.ts).
// The ceiling reads `lastMonthRevenue` (reports.ts), the debt ratio and the schedule read `debtLines` (reports.ts), the money moves through `post` and the spending guard of game.ts.
import {
  CREDIT_BANKS, CREDIT_BANK_IDS, CREDIT_MAX_ACTIVE, CREDIT_MAX_RATIO, CREDIT_MONTHS, LOAN_RATE, OVERDRAFT_LIMIT, OVERDRAFT_RATE, creditCeiling, creditSchedule, creditTerms, debtRatio, overdraftInterest, prepayPlan, ratingOf,
  type CreditQuote, type CreditRefusal, type CreditRequest, type CreditSheet, type CreditView, type CreditsView, type LoanLine, type PrepayQuote, type PrepayRequest,
} from '@opc/shared';
import { overdraftLow, type CreditRow } from './credit.ts';
import { all, get, run, type Db } from './db.ts';
import { addMonths, balanceOf, post, snapshot, spendable } from './game.ts';
import { HttpError } from './http.ts';
import { monthKey } from './finance.ts';
import { debtLines, debtOf, lastMonthRevenue } from './reports.ts';

const REFUSAL_TEXT: Record<CreditRefusal, string> = {
  too_many: `at most ${CREDIT_MAX_ACTIVE} credits at once`,
  over_ceiling: 'the credits would exceed what your last month of revenue allows',
  debt_ratio: `the instalments would exceed ${Math.round(CREDIT_MAX_RATIO * 100)} % of your last month of revenue`,
};
const short = (needed: number, db: Db, companyId: number): HttpError => new HttpError(409, 'insufficient_funds', `needs ${needed - spendable(db, companyId)} more`, { needed, balance: balanceOf(db, companyId), missing: needed - spendable(db, companyId) });
const rows = (db: Db, companyId: number): CreditRow[] => all<CreditRow>(db, "SELECT * FROM credits WHERE company_id = ? AND status = 'active' ORDER BY id", companyId);

const viewOf = (c: CreditRow): CreditView => ({
  id: c.id, bank: c.bank as CreditView['bank'], rate: c.rate, borrowed: c.principal0, principal: c.principal, monthly: c.monthly + c.insurance, insurance: c.insurance,
  months: c.months, monthsPaid: c.months_paid, startedAt: c.started_at, endsAt: addMonths(c.started_at, c.months), earlyPenaltyPct: c.early_penalty_pct,
});
const annuity = (c: CreditRow) => ({ principal: c.principal, monthly: c.monthly, insurance: c.insurance, monthsPaid: c.months_paid, months: c.months, rate: c.rate, earlyPenaltyPct: c.early_penalty_pct });

/** The standing of the company against the bank: what it earned last month, what it owes and pays, and so what it may still borrow. */
function standing(db: Db, companyId: number, now: number) {
  const revenue = lastMonthRevenue(db, companyId, now);
  const debt = debtOf(db, companyId);
  const held = rows(db, companyId);
  const ceiling = creditCeiling(revenue);
  return { revenue, debt, held, ceiling, room: Math.max(0, ceiling - held.reduce((t, c) => t + c.principal, 0)), ratio: debtRatio(debt.monthly, revenue) };
}

// ---------------------------------------------------------------- quote and sign

function quoteOf(db: Db, companyId: number, r: CreditRequest, now: number): CreditQuote {
  const s = standing(db, companyId, now);
  const terms = creditTerms(r.amount, r.months, r.bank);
  const after = debtRatio(s.debt.monthly + terms.monthly, s.revenue);
  const refusal: CreditRefusal | null = s.held.length >= CREDIT_MAX_ACTIVE ? 'too_many' : r.amount > s.room ? 'over_ceiling' : after === null || after > CREDIT_MAX_RATIO ? 'debt_ratio' : null;
  return {
    ...terms, amount: r.amount, earlyPenaltyPct: CREDIT_BANKS[r.bank].earlyPenaltyPct, net: r.amount - terms.fee, firstDebit: addMonths(now, 1),
    ratio: { before: s.ratio, after }, rating: { before: ratingOf(s.ratio), after: ratingOf(after) }, balanceAfter: balanceOf(db, companyId) + r.amount - terms.fee, refusal,
  };
}

/** The credit asked for, and the same amount over every duration of its bank and every bank over its duration, for the comparison the screen draws. Books nothing. */
export const quoteCredit = (db: Db, companyId: number, r: CreditRequest, now: number): CreditSheet => ({
  quote: quoteOf(db, companyId, r, now),
  durations: CREDIT_MONTHS.map((months) => creditTerms(r.amount, months, r.bank)),
  banks: CREDIT_BANK_IDS.map((bank) => creditTerms(r.amount, r.months, bank)),
});

/** Sign: 409 too_many / over_ceiling / debt_ratio. The amount less the bank's fee reaches the account now; the first instalment is billed on the 1st of next month. */
export function signCredit(db: Db, companyId: number, r: CreditRequest, now: number): { credit: CreditView; net: number; balanceAfter: number } {
  const q = quoteOf(db, companyId, r, now);
  if (q.refusal) {
    const s = standing(db, companyId, now);
    throw new HttpError(409, q.refusal, REFUSAL_TEXT[q.refusal], { ceiling: s.ceiling, room: s.room, active: s.held.length, ratio: q.ratio.after });
  }
  const b = CREDIT_BANKS[r.bank];
  const annuityOnly = q.monthly - b.insurance;
  const id = run(db, `INSERT INTO credits (company_id, bank, principal0, principal, rate, months, monthly, fee, insurance, early_penalty_pct, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    companyId, r.bank, r.amount, r.amount, b.rate, r.months, annuityOnly, b.fee, b.insurance, b.earlyPenaltyPct, now).id;
  post(db, companyId, now, 'credit', r.amount, `credit #${id} ${r.bank}`);
  if (b.fee > 0) post(db, companyId, now, 'credit_fee', -b.fee, `credit #${id} arrangement fee`);
  snapshot(db, companyId, now);
  return { credit: viewOf(get<CreditRow>(db, 'SELECT * FROM credits WHERE id = ?', id)!), net: q.net, balanceAfter: balanceOf(db, companyId) };
}

// ---------------------------------------------------------------- early repayment

function creditOf(db: Db, companyId: number, id: number): CreditRow {
  const c = get<CreditRow>(db, "SELECT * FROM credits WHERE id = ? AND company_id = ? AND status = 'active'", id, companyId);
  if (!c) throw new HttpError(404, 'credit_not_found', 'no such credit');
  return c;
}

function planOf(db: Db, c: CreditRow, request: PrepayRequest) {
  if ('amount' in request && request.amount > c.principal) throw new HttpError(422, 'invalid_amount', `only ${c.principal} is left to repay`, { principal: c.principal });
  return prepayPlan(annuity(c), request);
}

/** What repaying `request` now would cost and save; books nothing. The term stays, the instalment falls. */
export function prepayQuote(db: Db, companyId: number, id: number, request: PrepayRequest): PrepayQuote {
  const plan = planOf(db, creditOf(db, companyId, id), request);
  return { ...plan, balanceAfter: balanceOf(db, companyId) - plan.total, refusal: spendable(db, companyId) < plan.total ? 'insufficient_funds' : null };
}

/** Repay: the amount (and the bank's penalty on it) leaves the account, the instalment is recomputed over the months left, a full repayment closes the credit. 409 insufficient_funds. */
export function prepayCredit(db: Db, companyId: number, id: number, request: PrepayRequest, now: number): { plan: PrepayQuote; credit: CreditView | null; balanceAfter: number } {
  const c = creditOf(db, companyId, id);
  const plan = planOf(db, c, request);
  if (spendable(db, companyId) < plan.total) throw short(plan.total, db, companyId);
  post(db, companyId, now, 'credit_prepay', -plan.amount, `credit #${c.id} early repayment`);
  if (plan.penalty > 0) post(db, companyId, now, 'credit_prepay', -plan.penalty, `credit #${c.id} early repayment penalty`);
  run(db, 'UPDATE credits SET principal = ?, monthly = ?, status = ? WHERE id = ?', plan.principalAfter, plan.monthlyAfter, plan.closes ? 'repaid' : 'active', c.id);
  snapshot(db, companyId, now);
  const balanceAfter = balanceOf(db, companyId);
  return { plan: { ...plan, balanceAfter, refusal: null }, credit: plan.closes ? null : viewOf(get<CreditRow>(db, 'SELECT * FROM credits WHERE id = ?', c.id)!), balanceAfter };
}

// ---------------------------------------------------------------- the credits screen

export function creditsView(db: Db, companyId: number, now: number): CreditsView {
  const s = standing(db, companyId, now);
  const loans = all<{ id: number; registration: string | null; principal: number; monthly: number; months: number; months_paid: number }>(db,
    `SELECT c.id, a.registration, c.principal, c.monthly, c.months, c.months_paid FROM contracts c JOIN aircraft a ON a.id = c.aircraft_id
     WHERE c.company_id = ? AND c.status = 'active' AND c.kind = 'loan' AND c.principal > 0 ORDER BY c.id`, companyId)
    .map((l): LoanLine => ({ id: l.id, registration: l.registration ?? `#${l.id}`, principal: l.principal, monthly: l.monthly, rate: LOAN_RATE, months: l.months, monthsPaid: l.months_paid }));
  const schedule = new Map<string, { capital: number; interest: number; insurance: number }>();
  for (const line of debtLines(db, companyId)) {
    creditSchedule(line).forEach((m, i) => {
      const key = monthKey(addMonths(now, i + 1)), at = schedule.get(key) ?? { capital: 0, interest: 0, insurance: 0 };
      schedule.set(key, { capital: at.capital + m.capital, interest: at.interest + m.interest, insurance: at.insurance + m.insurance });
    });
  }
  const balance = balanceOf(db, companyId), low = overdraftLow(db, companyId, addMonths(now, 0), now + 1);
  return {
    credits: s.held.map(viewOf), loans, debt: s.debt.total, instalments: s.debt.monthly, revenue: s.revenue, revenueMonth: monthKey(addMonths(now, -1)),
    ratio: s.ratio, rating: ratingOf(s.ratio), ceiling: s.ceiling, room: s.room, active: s.held.length, maxActive: CREDIT_MAX_ACTIVE,
    overdraft: { limit: OVERDRAFT_LIMIT, rate: OVERDRAFT_RATE, balance, low, interest: overdraftInterest(low), over: balance < -OVERDRAFT_LIMIT },
    schedule: [...schedule].sort(([a], [b]) => (a < b ? -1 : 1)).map(([month, v]) => ({ month, ...v })),
  };
}
