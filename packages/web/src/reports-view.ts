import { CATEGORIES, COST_PARTS, FINANCE_SCREENS, SCENARIOS, type CashMonth, type Category, type CostBreakdown, type CostPart, type DecisionId, type FinanceScreen, type ForecastPoint, type ProfitBy, type ProfitRow, type Scenario, type ScenarioSummary } from '@opc/shared';
import { DAY_MS } from '@opc/shared';
import type { Key } from './messages.ts';

/** Pure view-model of the four finance report screens (docs/v4-plan.md REPORTS). The server computes every figure; this only picks, orders and positions what it returned. */

// ---------------------------------------------------------------- the words of each closed set (typed keys, no built strings)

export const CATEGORY_KEY: Record<Category, Key> = {
  tickets: 'rp.cat.tickets', jobs: 'rp.cat.jobs', freight: 'rp.cat.freight', service: 'rp.cat.service', fuel: 'rp.cat.fuel', payroll: 'rp.cat.payroll', maintenance: 'rp.cat.maintenance',
  fees: 'rp.cat.fees', credits: 'rp.cat.credits', leasing: 'rp.cat.leasing', rent: 'rp.cat.rent', insurance: 'rp.cat.insurance', investment: 'rp.cat.investment', capital: 'rp.cat.capital', other: 'rp.cat.other',
};
export const COST_PART_KEY: Record<CostPart, Key> = {
  crew: 'rp.part.crew', fuel: 'rp.part.fuel', fees: 'rp.part.fees', maintenance: 'rp.part.maintenance', service: 'rp.part.service', fixed: 'rp.part.fixed',
};
export const SCENARIO_KEY: Record<Scenario, Key> = { central: 'rp.sc.central', prudent: 'rp.sc.prudent', optimistic: 'rp.sc.optimistic' };
export const SCENARIO_NOTE_KEY: Record<Scenario, Key> = { central: 'rp.sc.central.note', prudent: 'rp.sc.prudent.note', optimistic: 'rp.sc.optimistic.note' };
export const DECISION_KEY: Record<DecisionId, Key> = { pause_line: 'rp.f.d.pause_line', lease_aircraft: 'rp.f.d.lease_aircraft' };
export const DECISION_NOTE_KEY: Record<DecisionId, Key> = { pause_line: 'rp.f.d.pause_line.note', lease_aircraft: 'rp.f.d.lease_aircraft.note' };
export const SCREEN_KEY: Record<FinanceScreen, Key> = { cash: 'rp.nav.cash', lines: 'rp.nav.lines', ledger: 'rp.nav.ledger', forecast: 'rp.nav.forecast' };
export const PROFIT_BY_KEY: Record<ProfitBy, Key> = { line: 'rp.l.by.line', aircraft: 'rp.l.by.aircraft' };
export { CATEGORIES, COST_PARTS, FINANCE_SCREENS, SCENARIOS };

/** The hash of each report screen and the digit that jumps to it from any of them. */
export const SCREEN_HASH: Record<FinanceScreen, string> = { cash: '#finance', lines: '#finance/lines', ledger: '#finance/ledger', forecast: '#finance/forecast' };
export const screenKey = (s: FinanceScreen): string => String(FINANCE_SCREENS.indexOf(s) + 1);

// ---------------------------------------------------------------- cash flow

/** Months the cash screen asks for (the streak reads all of them) and months its chart draws. */
export const CASH_FETCH = 24;
export const CHART_MONTHS = 12;

export const chartMonths = (months: readonly CashMonth[]): CashMonth[] => months.slice(-CHART_MONTHS);

/** The month the screen opens on: the last month that is over, else the one in progress. */
export function defaultMonth(months: readonly CashMonth[]): string | null {
  return [...months].reverse().find((m) => m.closed)?.month ?? months.at(-1)?.month ?? null;
}

/** The month `dir` steps from `current` inside `months`, stopping at both ends. */
export function stepMonth(months: readonly { month: string }[], current: string | null, dir: 1 | -1): string | null {
  if (months.length === 0) return null;
  const i = months.findIndex((m) => m.month === current);
  return months[Math.min(months.length - 1, Math.max(0, (i < 0 ? months.length - 1 : i) + dir))]!.month;
}

/** How many closed months in a row, ending with the last one, the company ended with money in (net above zero). 0: the last closed month lost money, or none is over yet. */
export function positiveStreak(months: readonly CashMonth[]): number {
  const closed = months.filter((m) => m.closed);
  let n = 0;
  for (let i = closed.length - 1; i >= 0 && closed[i]!.net > 0; i--) n++;
  return n;
}

/** Bar heights as a share of the tallest bar of the chart (0..1). */
export function barScale(months: readonly CashMonth[]): (value: number) => number {
  const top = Math.max(0, ...months.flatMap((m) => [m.revenue, m.spend]));
  return (value) => (top > 0 ? Math.min(1, Math.max(0, value) / top) : 0);
}

/** The categories of one side of a month, biggest first, each with its share of the side's total. */
export function sideOf(month: CashMonth | null, side: 'in' | 'out'): { category: Category; amount: number; share: number }[] {
  const rows = (month?.byCategory ?? []).filter((c) => c[side] > 0).sort((x, y) => y[side] - x[side]);
  const total = rows.reduce((t, c) => t + c[side], 0);
  return rows.map((c) => ({ category: c.category, amount: c[side], share: total > 0 ? c[side] / total : 0 }));
}

/** `2026-10` -> `Oct 2026` in the language's own form; the day of the middle of the month avoids any zone edge. */
export const monthName = (key: string, locale: string, withYear = true): string =>
  new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'long', ...(withYear ? { year: 'numeric' } : {}) }).format(Date.parse(`${key}-15T12:00:00Z`));
/** `Monday 2 November`, from an ISO day. */
export const dayName = (iso: string, locale: string): string => new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(Date.parse(`${iso}T12:00:00Z`));
/** `541 k` / `1,3 M`: a balance in a chart label. */
export const compact = (n: number, locale: string): string => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n).replace(/^-/, '\u2212');
export const monthShort = (key: string, locale: string): string => new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'short' }).format(Date.parse(`${key}-15T12:00:00Z`));

// ---------------------------------------------------------------- profitability

/** How far back the profitability month can be stepped: a year, like the cash chart. */
export const PROFIT_MONTHS_BACK = 12;

/** The month `dir` away from `month`, never after `current` (the month in progress) nor before a year back. */
export function profitMonth(month: string, dir: 1 | -1, current: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const next = new Date(Date.UTC(y, m - 1 + dir, 1)).toISOString().slice(0, 7);
  const [cy, cm] = current.split('-').map(Number) as [number, number];
  const floor = new Date(Date.UTC(cy, cm - 1 - PROFIT_MONTHS_BACK, 1)).toISOString().slice(0, 7);
  return next > current || next < floor ? month : next;
}

export const profitName = (r: ProfitRow): string => (r.by === 'line' ? `${r.a} – ${r.b}` : r.registration);

/** The rows that earn and the rows that lose, in the order the server ranked them (best margin first). */
export function profitGroups(rows: readonly ProfitRow[]): { profitable: ProfitRow[]; losing: ProfitRow[] } {
  return { profitable: rows.filter((r) => r.margin >= 0), losing: rows.filter((r) => r.margin < 0) };
}

/** The parts of a cost breakdown that are not zero, biggest first, with their share of the costs. */
export function breakdownRows(b: CostBreakdown): { part: CostPart; amount: number; share: number }[] {
  const total = COST_PARTS.reduce((t, p) => t + b[p], 0);
  return COST_PARTS.filter((p) => b[p] !== 0).map((part) => ({ part, amount: b[part], share: total > 0 ? b[part] / total : 0 })).sort((x, y) => y.amount - x.amount);
}

// ---------------------------------------------------------------- statement

export const PERIODS = ['week', 'month', 'previous'] as const;
export type Period = (typeof PERIODS)[number];
export const PERIOD_KEY: Record<Period, Key> = { week: 'rp.l.period.week', month: 'rp.l.period.month', previous: 'rp.l.period.previous' };

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
/** The `from` / `to` days (UTC, both included) of a period at `now`: the last seven days, this month so far, or the whole of last month. */
export function periodRange(period: Period, now: number): { from: string; to: string } {
  const d = new Date(now);
  const first = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  if (period === 'week') return { from: isoDay(now - 6 * DAY_MS), to: isoDay(now) };
  if (period === 'month') return { from: isoDay(first), to: isoDay(now) };
  return { from: isoDay(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)), to: isoDay(first - DAY_MS) };
}

// ---------------------------------------------------------------- forecast

/** The chart box: the plot is `width` x `height` inside a margin, balances map to y with zero in view, months to x evenly. */
export type Plot = { width: number; height: number; left: number; right: number; top: number; bottom: number };
export const PLOT: Plot = { width: 920, height: 300, left: 64, right: 16, top: 16, bottom: 28 };

export function scaleOf(points: readonly ForecastPoint[], extra: readonly number[] = [], plot: Plot = PLOT): { x: (i: number) => number; y: (v: number) => number; ticks: number[]; zero: number } {
  const values = [0, ...points.flatMap((p) => SCENARIOS.map((s) => p[s])), ...extra];
  const lo = Math.min(...values), hi = Math.max(...values);
  const step = niceStep((hi - lo) / 4 || 1);
  const min = Math.floor(lo / step) * step, max = Math.ceil(hi / step) * step;
  const inner = { w: plot.width - plot.left - plot.right, h: plot.height - plot.top - plot.bottom };
  const x = (i: number): number => plot.left + (points.length > 1 ? (i * inner.w) / (points.length - 1) : inner.w / 2);
  const y = (v: number): number => plot.top + inner.h - ((v - min) / (max - min || 1)) * inner.h;
  const ticks: number[] = [];
  for (let v = min; v <= max; v += step) ticks.push(v);
  return { x, y, ticks, zero: y(0) };
}
/** 1, 2 or 5 times a power of ten, at least `raw`. */
function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((k) => k * p).find((s) => s >= raw) ?? 10 * p;
}

/** A polyline path through one scenario's lowest balances. */
export const pathOf = (points: readonly ForecastPoint[], pick: (p: ForecastPoint) => number, scale: Pick<ReturnType<typeof scaleOf>, 'x' | 'y'>): string =>
  points.map((p, i) => `${i === 0 ? 'M' : 'L'}${scale.x(i).toFixed(1)} ${scale.y(pick(p)).toFixed(1)}`).join(' ');

/** The band between two scenarios, as a closed path. */
export function bandOf(points: readonly ForecastPoint[], low: (p: ForecastPoint) => number, high: (p: ForecastPoint) => number, scale: Pick<ReturnType<typeof scaleOf>, 'x' | 'y'>): string {
  if (points.length === 0) return '';
  const up = points.map((p, i) => `${scale.x(i).toFixed(1)} ${scale.y(high(p)).toFixed(1)}`);
  const down = points.map((p, i) => `${scale.x(i).toFixed(1)} ${scale.y(low(p)).toFixed(1)}`).reverse();
  return `M${up.join(' L')} L${down.join(' L')} Z`;
}

/** The headline of the forecast: where the worst scenario runs out of money, or that none does. */
export function overdraftHeadline(summary: Record<Scenario, ScenarioSummary>): { scenario: Scenario; days: number; from: number; to: number } | null {
  for (const scenario of ['prudent', 'central', 'optimistic'] as const) {
    const o = summary[scenario].overdraft;
    if (o.days > 0 && o.from !== null && o.to !== null) return { scenario, days: o.days, from: o.from, to: o.to };
  }
  return null;
}

/** The scenario `dir` steps from `current`, stopping at both ends (the order of the legend: prudent, central, optimistic). */
export function stepScenario(current: Scenario, dir: 1 | -1): Scenario {
  const order: readonly Scenario[] = ['prudent', 'central', 'optimistic'];
  return order[Math.min(order.length - 1, Math.max(0, order.indexOf(current) + dir))]!;
}

/** `-8 %` / `+12 %` / `0 %` from a factor of 1. */
export const factorPct = (factor: number): string => {
  const n = Math.round((factor - 1) * 100);
  return `${n > 0 ? '+' : n < 0 ? '\u2212' : ''}${Math.abs(n)}\u00a0%`;
};
