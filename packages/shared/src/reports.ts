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

/** Ledger kinds an aircraft's fixed cost is made of (profitability allocates them to the lines it flew). */
export const FIXED_COST_KINDS = ['lease_rent', 'insurance', 'parking'] as const;

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
  upcoming: UpcomingDebit[];
};
export const CASH_MONTHS_MAX = 24;
export const cashQuerySchema = z.object({ months: z.coerce.number().int().min(1).max(CASH_MONTHS_MAX).default(12) });

// ---------------------------------------------------------------- statement

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
  /** The biggest debit of the next billing date. */
  scheduled: UpcomingDebit | null;
};
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const statementQuerySchema = z.object({
  from: isoDate.optional(), to: isoDate.optional(), category: z.enum(CATEGORIES).optional(), line: z.coerce.number().int().positive().optional(),
  before: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(200).default(50),
});

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
  month: string; by: ProfitBy; rows: ProfitRow[];
  totals: { margin: number; profitable: { count: number; margin: number }; losing: { count: number; margin: number } };
};
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const profitQuerySchema = z.object({ month: month.optional(), by: z.enum(PROFIT_BY).default('line') });

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
export type DecisionResult = { decision: DecisionId; points: ForecastPoint[]; summary: Record<Scenario, ScenarioSummary> };
