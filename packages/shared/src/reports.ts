// Lot REPORTS (v4): cash flow, statement, profitability and forecast. Pure rules and wire types; the server reads the ledger (server/src/reports*.ts), the web only shows what it returns.
// Runtime-imports nothing from ./index.ts (index re-exports this file).
import { z } from 'zod';

// ---------------------------------------------------------------- categories

export const CATEGORIES = ['tickets', 'jobs', 'freight', 'service', 'fuel', 'payroll', 'maintenance', 'fees', 'credits', 'leasing', 'rent', 'insurance', 'investment', 'capital', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];

/** The ledger `kind` of every posting the server makes -> the category the reports file it under. `payout` is split by the kind of the flight (see `categoryOf`). An unknown kind is `other`. */
const CATEGORY_OF_KIND: Readonly<Record<string, Category>> = {
  line_revenue: 'tickets', payout: 'jobs', service_sales: 'service', service_cost: 'service',
  line_fuel: 'fuel', fuel: 'fuel', club_hours: 'fuel',
  payroll: 'payroll', hire_premium: 'payroll', severance: 'payroll', training: 'payroll', interim: 'payroll', start_now: 'payroll',
  line_maintenance: 'maintenance', maintenance: 'maintenance', refurbish: 'maintenance', parts_order: 'maintenance', parts_emergency: 'maintenance', parts_sale: 'maintenance',
  line_fee: 'fees', landing_fee: 'fees', ferry: 'fees',
  loan_installment: 'credits', facility_loan: 'credits',
  lease_rent: 'leasing', deposit: 'leasing', deposit_refund: 'leasing',
  facility_rent: 'rent', facility_upkeep: 'rent', facility_deposit: 'rent', facility_deposit_refund: 'rent', facility_income: 'rent', parking: 'rent',
  insurance: 'insurance', incident: 'insurance',
  purchase_aircraft: 'investment', purchase_hub: 'investment', facility_purchase: 'investment', facility_works: 'investment', facility_sale: 'investment',
  grant: 'capital', bailout: 'capital',
};
export const KNOWN_KINDS: readonly string[] = Object.keys(CATEGORY_OF_KIND);

/** `flightKind` is the kind of the flight a `payout` posting paid (`flights.kind`): a cargo flight is freight, anything else a job. */
export function categoryOf(kind: string, flightKind?: string | null): Category {
  if (kind === 'payout' && flightKind === 'cargo') return 'freight';
  return CATEGORY_OF_KIND[kind] ?? 'other';
}
/** The ledger kinds filed under a category (`other`: none, it is every kind not listed). */
export const kindsOf = (category: Category): string[] => KNOWN_KINDS.filter((k) => CATEGORY_OF_KIND[k] === category);

/** What the company earns by flying: the categories that make up a month's revenue (credit ceilings and debt ratios read this, never a grant or a refund). */
export const OPERATING_INCOME: readonly Category[] = ['tickets', 'jobs', 'freight', 'service'];

/** A month's revenue: what the company earned by flying, out of its totals per category. The one definition every report, the credit ceiling and the debt ratio share. */
export const revenueOf = (byCategory: readonly CategoryTotal[]): number => byCategory.filter((c) => OPERATING_INCOME.includes(c.category)).reduce((t, c) => t + c.in, 0);

/** The ledger kinds each money figure of the profitability report is made of. Crew and the fixed costs are not postings of a leg: crew comes from the duty ledger, `fixed` is what an aircraft costs a month
 *  whatever it flies (leasing, hull insurance, parking), allocated to the lines it flew by block hours. Credits and buildings stay out of a line's margin (the mockup: "hors crédits et loyers"). */
export const PROFIT_KINDS = {
  revenue: ['line_revenue', 'payout', 'service_sales'],
  fuel: ['line_fuel', 'fuel', 'club_hours'],
  fees: ['line_fee', 'landing_fee'],
  maintenance: ['line_maintenance', 'maintenance'],
  service: ['service_cost'],
  fixed: ['lease_rent', 'insurance', 'parking'],
} as const;

// ---------------------------------------------------------------- cash flow

export type CategoryTotal = { category: Category; in: number; out: number };
export type CashMonth = {
  month: string;
  closed: boolean;
  /** Operating income (`OPERATING_INCOME`). */
  revenue: number;
  /** Every outflow. */
  spend: number;
  /** Inflows that are not operating income: refunds, resales, starting capital, bailout. `net = revenue + other - spend`. */
  other: number;
  net: number;
  /** Net minus the previous shown month's net; null for the first month shown. */
  netVsPrevious: number | null;
  /** The balance on the last day of the month (the running sum of the postings dated up to it; for the current month, today). */
  endBalance: number;
  byCategory: CategoryTotal[];
};
export type UpcomingDebit = { at: number; kind: string; category: Category; amount: number };
export type CashView = {
  balance: number;
  /** Days the balance lasts at the last closed month's spend; null until a month has closed. */
  runwayDays: number | null;
  debt: { total: number; monthly: number; credits: number };
  months: CashMonth[];
  /** The debits of the next billing date, biggest first, and their sum. */
  upcoming: UpcomingDebit[];
  upcomingTotal: number;
};
export const CASH_MONTHS_MAX = 24;
export const cashQuerySchema = z.object({ months: z.coerce.number().int().min(1).max(CASH_MONTHS_MAX).default(12) });

// ---------------------------------------------------------------- statement

/** `balanceAfter` is the balance after this posting in date order (the order the statement is read in), so a backdated line leg sits where it happened. */
export type StatementRow = {
  id: number; at: number; kind: string; category: Category; memo: string; amount: number; balanceAfter: number; flightId: number | null;
  line: { id: number; a: string; b: string } | null; aircraft: { id: number; registration: string } | null;
};
export type StatementDay = { day: string; net: number; rows: StatementRow[] };
export type StatementView = {
  days: StatementDay[];
  summary: { net: number; in: number; out: number; count: number; byCategory: CategoryTotal[] };
  /** Cursor for the next (older) page: pass it as `before`; null at the end. */
  next: number | null;
  /** The biggest debit of the next billing date (the mockup's "next scheduled posting"). */
  scheduled: UpcomingDebit | null;
};
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s, 'not a calendar date');
export const statementQuerySchema = z.object({
  from: isoDate.optional(), to: isoDate.optional(), category: z.enum(CATEGORIES).optional(), line: z.coerce.number().int().positive().optional(),
  before: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type StatementQuery = z.infer<typeof statementQuerySchema>;

// ---------------------------------------------------------------- profitability

export const PROFIT_BY = ['line', 'aircraft'] as const;
export type ProfitBy = (typeof PROFIT_BY)[number];
export const COST_PARTS = ['crew', 'fuel', 'fees', 'maintenance', 'service', 'fixed'] as const;
export type CostPart = (typeof COST_PARTS)[number];
export type CostBreakdown = Record<CostPart, number>;
export type ProfitMoney = { flights: number; revenue: number; costs: number; margin: number; marginPct: number | null; breakdown: CostBreakdown };
export type ProfitRow = ProfitMoney & (
  { by: 'line'; id: number; a: string; b: string; aircraft: string[] } | { by: 'aircraft'; id: number; registration: string; icao: string; lines: string[] });
export type ProfitView = {
  month: string; by: ProfitBy;
  /** The month is over: its figures are final. */
  closed: boolean;
  rows: ProfitRow[];
  totals: { margin: number; profitable: { count: number; margin: number }; losing: { count: number; margin: number } };
};
const monthKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const profitQuerySchema = z.object({ month: monthKeySchema.optional(), by: z.enum(PROFIT_BY).default('line') });

// ---------------------------------------------------------------- forecast

export const SCENARIOS = ['central', 'prudent', 'optimistic'] as const;
export type Scenario = (typeof SCENARIOS)[number];
/** [NO MODEL] in the mockup: the engine has no seasons, so the factors average 1 over the year (the forecast moves money between months, it does not invent any). Index = UTC month, 0 = January. */
export const SEASONALITY: readonly number[] = [0.78, 0.78, 0.9, 1, 1.05, 1.18, 1.3, 1.3, 1.08, 1, 0.85, 0.78];
/** Revenue and fuel factors of the scenarios (`fill -8 %, fuel +12 %` / `fill +6 %, fuel stable` in the mockup). */
export const SCENARIO_FACTORS: Readonly<Record<Scenario, { revenue: number; fuel: number }>> = {
  central: { revenue: 1, fuel: 1 }, prudent: { revenue: 0.92, fuel: 1.12 }, optimistic: { revenue: 1.06, fuel: 1 },
};
export const FORECAST_MONTHS = 12;
export const DECISIONS = ['pause_line', 'lease_aircraft'] as const;
export type DecisionId = (typeof DECISIONS)[number];

/** The lowest balance of a month, per scenario. */
export type ForecastPoint = Record<Scenario, number> & { month: string };
export type ScenarioSummary = {
  /** Lowest balance of the horizon, the day it happens and the month it falls in. */
  lowest: { balance: number; at: number };
  /** Balance on the last day of the horizon. */
  end: number;
  overdraft: { days: number; from: number | null; to: number | null };
};
export type DecisionEffect = { lowDelta: number; overdraftDays: { before: number; after: number } };
export type DecisionView = {
  id: DecisionId; available: boolean;
  /** The line it pauses / the aircraft type it leases, so the screen can say what it does. */
  line: { id: number; a: string; b: string } | null; icao: string | null;
  /** What it costs on the day it takes effect (lease: deposit, convoy and first rent). */
  upfront: number;
  /** Per scenario. */
  effect: Record<Scenario, DecisionEffect> | null;
};
export type ForecastView = {
  now: number; balance: number;
  points: ForecastPoint[];
  summary: Record<Scenario, ScenarioSummary>;
  decisions: DecisionView[];
};
export const decisionBodySchema = z.object({ decision: z.enum(DECISIONS) });
/** The forecast with a decision applied: the new curve and its summary, next to the base. */
export type DecisionResult = { decision: DecisionId; points: ForecastPoint[]; summary: Record<Scenario, ScenarioSummary>; effect: Record<Scenario, DecisionEffect> };

const DAY = 86_400_000;
/** The balance day by day (UTC day starts) from `from` (its balance is `balance`) to `to`: each day adds that day's `charges` (billing, on the 1st) and `net` (the flying that day). Pure: the server feeds it the
 *  charges `planMonth` projects and the line forecast, this only walks the days. Returns the lowest balance of every month it touches (the month of `from` included) and the horizon summary. */
export function walkBalance(o: { from: number; to: number; balance: number; charges: (day: number) => number; net: (day: number) => number }): { lowByMonth: Map<string, number>; summary: ScenarioSummary } {
  const key = (day: number): string => new Date(day).toISOString().slice(0, 7);
  let balance = o.balance;
  const lowByMonth = new Map<string, number>([[key(o.from), balance]]);
  let lowest = { balance, at: o.from };
  const overdraft = { days: 0, from: null as number | null, to: null as number | null };
  const note = (day: number): void => {
    if (balance < lowest.balance) lowest = { balance, at: day };
    if (balance < (lowByMonth.get(key(day)) ?? Infinity)) lowByMonth.set(key(day), balance);
    if (balance < 0) { overdraft.days++; overdraft.from ??= day; overdraft.to = day; }
  };
  if (balance < 0) { overdraft.days++; overdraft.from = o.from; overdraft.to = o.from; }
  for (let day = o.from + DAY; day <= o.to; day += DAY) {
    balance += o.charges(day) + o.net(day);
    note(day);
  }
  for (const [m, v] of lowByMonth) lowByMonth.set(m, Math.round(v));
  return { lowByMonth, summary: { lowest: { balance: Math.round(lowest.balance), at: lowest.at }, end: Math.round(balance), overdraft } };
}
