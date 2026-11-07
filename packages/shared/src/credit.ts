// Lot CREDIT (v4): consumer credit, early repayment, the overdraft and the unpaid rules (docs/v4-plan.md A.2, B.3, B.8, C18 to C22).
// Pure rules, constants, request schemas and wire types; the server owns the money (server/src/credit*.ts), the web only shows what it returns.
// Runtime-imports only finance.ts (the annuity), never ./index.ts (index re-exports this file).
import { z } from 'zod';
import { loanPayment, loanStep } from './finance.ts';

// ---------------------------------------------------------------- constants (C18 to C22)

/** C19: how far below zero a purchase or a bill may take the balance, and what that costs a year, on the lowest negative balance of the month. */
export const OVERDRAFT_LIMIT = 250_000;
export const OVERDRAFT_RATE = 0.115;
/** C18: at most this many consumer credits at once; the ceiling is this share of the last full month's revenue, floored to a step. Tuned: the step is 50 000 (the slider of the frame). */
export const CREDIT_MAX_ACTIVE = 2;
export const CREDIT_CEILING_PCT = 30;
export const CREDIT_STEP = 50_000;
export const CREDIT_MIN = CREDIT_STEP;
export const CREDIT_AMOUNT_MAX = 10_000_000;
export const CREDIT_MONTHS = [12, 24, 36, 48, 60] as const;
/** C20: an instalment the bank takes with the account already past the overdraft limit costs this share of it and this much reputation (a stoppage day). Nothing is seized. */
export const UNPAID_FEE_PCT = 5;
export const CREDIT_LATE_REPUTATION = 2;
/** The ledger kind of an instalment: billing reads it to apply the late rule right after the instalment is taken. */
export const CREDIT_INSTALMENT = 'credit_installment';

/** The three banks: fixed rate, one-off fee held back from the payout, flat monthly insurance, early-repayment penalty on the amount repaid (B.8). Tuned: the frame says Alpes repays free after 6 months; here free from day one. */
export const CREDIT_BANK_IDS = ['alpes', 'meridional', 'aerofinance'] as const;
export type CreditBankId = (typeof CREDIT_BANK_IDS)[number];
export const CREDIT_BANKS: Readonly<Record<CreditBankId, { rate: number; fee: number; insurance: number; earlyPenaltyPct: number }>> = {
  alpes: { rate: 0.072, fee: 3_500, insurance: 112, earlyPenaltyPct: 0 },
  meridional: { rate: 0.079, fee: 1_200, insurance: 135, earlyPenaltyPct: 1 },
  aerofinance: { rate: 0.096, fee: 0, insurance: 0, earlyPenaltyPct: 0 },
};

/** The rating is read from the debt ratio (instalments over last month's revenue); `[rating, highest ratio it covers]`. B+ goes up to 9 % and covers the 6.1 to 7.1 % of the frame; the list frame's A- at 6.1 % is the inconsistency B.8 names, the credit-new frame wins. Above the last row the rating is E and no credit is granted. */
export const CREDIT_MAX_RATIO = 0.35;
export const CREDIT_RATINGS = [['A', 0.02], ['A-', 0.05], ['B+', 0.09], ['B', 0.15], ['C', 0.25], ['D', CREDIT_MAX_RATIO]] as const;
export type CreditRating = (typeof CREDIT_RATINGS)[number][0] | 'E';

// ---------------------------------------------------------------- pure rules

/** Instalments over revenue; null when there is no revenue to measure against and something is owed (0 when nothing is owed). */
export const debtRatio = (monthly: number, revenue: number): number | null => (monthly <= 0 ? 0 : revenue > 0 ? monthly / revenue : null);
export const ratingOf = (ratio: number | null): CreditRating => (ratio === null ? 'E' : CREDIT_RATINGS.find(([, upTo]) => ratio <= upTo)?.[0] ?? 'E');
/** What the bank lends at most in all, on last month's revenue: 30 % of it, floored to the step (614 880 -> 600 000). */
export const creditCeiling = (revenue: number): number => Math.floor((Math.max(0, revenue) * CREDIT_CEILING_PCT) / 100 / CREDIT_STEP) * CREDIT_STEP;
/** The interest of a month on the lowest negative balance `low` (0 when the balance never went below zero). */
export const overdraftInterest = (low: number): number => (low < 0 ? Math.round((-low * OVERDRAFT_RATE) / 12) : 0);
export const lateFee = (instalment: number): number => Math.round((instalment * UNPAID_FEE_PCT) / 100);

/** What is left to pay on an annuity: `monthsPaid` of `months` instalments are behind it. The last one clears the rounding residue (`loanStep`). `insurance` is paid with every instalment. */
export type Annuity = { principal: number; monthly: number; insurance: number; monthsPaid: number; months: number; rate: number };
export type ScheduleMonth = { pay: number; capital: number; interest: number; insurance: number };
export function creditSchedule(a: Annuity): ScheduleMonth[] {
  const out: ScheduleMonth[] = [];
  let principal = a.principal;
  for (let paid = a.monthsPaid; paid < a.months; paid++) {
    const step = loanStep(principal, a.monthly, paid, a.months, a.rate);
    out.push({ pay: step.pay + a.insurance, capital: principal - step.principal, interest: step.interest, insurance: a.insurance });
    principal = step.principal;
  }
  return out;
}
const sum = (rows: readonly ScheduleMonth[], pick: (r: ScheduleMonth) => number): number => rows.reduce((t, r) => t + pick(r), 0);

export type CreditTerms = { bank: CreditBankId; months: number; rate: number; earlyPenaltyPct: number; /** The payment of every month, insurance included. */ monthly: number; fee: number; interest: number; /** All the insurance of the term. */ insurance: number; /** Interest + fee + insurance: what the credit costs over its term. */ cost: number };
export function creditTerms(amount: number, months: number, bank: CreditBankId): CreditTerms {
  const b = CREDIT_BANKS[bank];
  const annuity = loanPayment(amount, months, b.rate);
  const interest = sum(creditSchedule({ principal: amount, monthly: annuity, insurance: 0, monthsPaid: 0, months, rate: b.rate }), (m) => m.interest);
  return { bank, months, rate: b.rate, earlyPenaltyPct: b.earlyPenaltyPct, monthly: annuity + b.insurance, fee: b.fee, interest, insurance: b.insurance * months, cost: interest + b.fee + b.insurance * months };
}

/** Repaying `amount` of the principal now (all of it for `full`), the term unchanged: the instalment falls, the interest still to come shrinks. The penalty is on the amount repaid. */
export type PrepayPlan = { amount: number; penalty: number; /** Cash leaving the account. */ total: number; principalAfter: number; /** The annuity that is stored (insurance apart) and the whole instalment of every month from now on (0 when the credit is closed). */ annuityAfter: number; monthlyAfter: number; monthsLeft: number; closes: boolean; /** Interest and insurance no longer paid. */ saved: number };
export function prepayPlan(c: Annuity & { earlyPenaltyPct: number }, request: PrepayRequest): PrepayPlan {
  const amount = 'full' in request ? c.principal : request.amount;
  const principalAfter = c.principal - amount;
  const monthsLeft = c.months - c.monthsPaid;
  const annuityAfter = principalAfter === 0 ? 0 : loanPayment(principalAfter, monthsLeft, c.rate);
  const before = creditSchedule(c);
  const after = principalAfter === 0 ? [] : creditSchedule({ ...c, principal: principalAfter, monthly: annuityAfter });
  const penalty = Math.round((amount * c.earlyPenaltyPct) / 100);
  return {
    amount, penalty, total: amount + penalty, principalAfter, annuityAfter, monthlyAfter: principalAfter === 0 ? 0 : annuityAfter + c.insurance, monthsLeft, closes: principalAfter === 0,
    saved: sum(before, (m) => m.interest) + c.insurance * before.length - (sum(after, (m) => m.interest) + c.insurance * after.length),
  };
}

// ---------------------------------------------------------------- the monthly plan (lent to finance.ts `planMonth` as its 7th argument)

export type CreditState = { id: number; principal: number; rate: number; months: number; months_paid: number; monthly: number; insurance: number; started_at: number; status: 'active' | 'repaid' };
/** `overdraftLow`: the lowest balance of the month being billed (0 or below). */
export type CreditInputs = { credits: readonly CreditState[]; overdraftLow: number };
export const NO_CREDIT: CreditInputs = { credits: [], overdraftLow: 0 };
export type CreditCharge = { kind: string; amount: number; memo: string };

/** The month starting at `start`: the overdraft interest of the month just over, then one instalment per credit signed before `start` (the one signed this month was paid at signing). The charges come last in the bill so the late rule reads the balance after the other bills. */
export function planCreditMonth(start: number, input: CreditInputs): { charges: CreditCharge[]; credits: CreditState[] } {
  const charges: CreditCharge[] = [];
  const interest = overdraftInterest(input.overdraftLow);
  if (interest > 0) charges.push({ kind: 'overdraft_interest', amount: -interest, memo: `overdraft interest on ${-input.overdraftLow}` });
  const credits = input.credits.map((c): CreditState => {
    if (c.status !== 'active' || c.started_at >= start) return { ...c };
    const step = loanStep(c.principal, c.monthly, c.months_paid, c.months, c.rate);
    const next: CreditState = { ...c, principal: step.principal, months_paid: c.months_paid + 1, status: step.last ? 'repaid' : 'active' };
    charges.push({ kind: CREDIT_INSTALMENT, amount: -(step.pay + c.insurance), memo: `credit #${c.id} instalment ${next.months_paid}/${c.months}` });
    return next;
  });
  return { charges, credits };
}

// ---------------------------------------------------------------- requests

const bankSchema = z.enum(CREDIT_BANK_IDS);
const monthsSchema = z.number().int().refine((m) => (CREDIT_MONTHS as readonly number[]).includes(m), `months must be one of ${CREDIT_MONTHS.join(', ')}`);
export const creditRequestSchema = z.object({ amount: z.number().int().min(CREDIT_MIN).max(CREDIT_AMOUNT_MAX), months: monthsSchema, bank: bankSchema });
export type CreditRequest = z.infer<typeof creditRequestSchema>;
export const prepayRequestSchema = z.union([z.object({ full: z.literal(true) }).strict(), z.object({ amount: z.number().int().min(1).max(CREDIT_AMOUNT_MAX) }).strict()]);
export type PrepayRequest = z.infer<typeof prepayRequestSchema>;

// ---------------------------------------------------------------- wire types

export const CREDIT_REFUSALS = ['too_many', 'over_ceiling', 'debt_ratio'] as const;
export type CreditRefusal = (typeof CREDIT_REFUSALS)[number];
export type CreditQuote = CreditTerms & {
  amount: number;
  /** What reaches the account: the amount less the fee. */
  net: number;
  /** The first instalment is taken on the 1st of the next month. */
  firstDebit: number;
  ratio: { before: number | null; after: number | null };
  rating: { before: CreditRating; after: CreditRating };
  balanceAfter: number;
  /** Why signing would be refused (the same codes `POST /credits` answers 409 with), else null. */
  refusal: CreditRefusal | null;
};
/** The chosen quote, and the two ways to compare it: every duration at this bank, every bank at this duration. */
export type CreditSheet = { quote: CreditQuote; durations: CreditTerms[]; banks: CreditTerms[] };

export type CreditView = {
  id: number; bank: CreditBankId; rate: number; borrowed: number; principal: number; monthly: number; insurance: number;
  months: number; monthsPaid: number; startedAt: number; /** The 1st of the month of the last instalment. */ endsAt: number; earlyPenaltyPct: number;
};
/** An aircraft loan, shown with the credits because it counts in the debt ratio. Read-only: renegotiating and repaying it early are not modelled. */
export type LoanLine = { id: number; registration: string; principal: number; monthly: number; rate: number; months: number; monthsPaid: number };
export type CreditsView = {
  credits: CreditView[]; loans: LoanLine[];
  /** All the principal owed (credits, loans, financed buildings) and what is paid a month on it. */
  debt: number; instalments: number;
  /** The last full month's revenue the ceiling and the ratio are read against (`YYYY-MM`). */
  revenue: number; revenueMonth: string;
  ratio: number | null; rating: CreditRating;
  ceiling: number; /** What can still be borrowed: the ceiling less the principal of the credits. */ room: number; active: number; maxActive: number;
  overdraft: { limit: number; rate: number; balance: number; /** The lowest balance of this month so far, and the interest it will cost on the 1st. */ low: number; interest: number; over: boolean };
  /** The instalments still to come from next month on, by month (`YYYY-MM`), credits and loans together. */
  schedule: { month: string; capital: number; interest: number; insurance: number }[];
};
export type PrepayQuote = PrepayPlan & { balanceAfter: number; /** Null when the account can pay it. */ refusal: 'insufficient_funds' | null };
export type CreditSigned = { credit: CreditView; net: number; balanceAfter: number };
/** `credit` is null when the repayment closed it. */
export type PrepayDone = { plan: PrepayQuote; credit: CreditView | null; balanceAfter: number };
