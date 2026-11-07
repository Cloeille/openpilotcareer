// Lot REPORTS (v4) read models over the ledger: cash flow, the statement, debt, and the revenue helper other lots read. Nothing here writes: the money was posted by `post()` and
// every figure below is a sum of postings, so a report can never disagree with the balance. The category of a posting is code (shared/reports.ts), applied in SQL from the same table.
import {
  CATEGORIES, DAY_MS, KNOWN_KINDS, categoryOf, isoDay, revenueOf,
  type CashMonth, type CashView, type Category, type CategoryTotal, type StatementQuery, type StatementRow, type StatementView, type UpcomingDebit,
} from '@opc/shared';
import { all, get, type Db } from './db.ts';
import { monthKey, projectCharges } from './finance.ts';
import { addMonths, balanceOf } from './game.ts';

const UPCOMING_MAX = 6;
/** One-off purchases are not what a company burns: they stay out of the runway (an aircraft bought last month must not read as "two days of cash"). */
const NOT_BURN: readonly Category[] = ['investment'];

const monthStart = (key: string): number => Date.parse(`${key}-01T00:00:00Z`);
const sumOf = <T>(rows: readonly T[], pick: (r: T) => number): number => rows.reduce((t, r) => t + pick(r), 0);

/** The category of a posting as SQL, built from `categoryOf` so the filter, the grouping and the code can not drift. Needs `transactions t` and `flights f` (LEFT JOIN on flight_id) in scope. */
const CATEGORY_SQL = `(CASE WHEN t.kind = 'payout' AND f.kind = 'cargo' THEN 'freight' ${KNOWN_KINDS.map((k) => `WHEN t.kind = '${k}' THEN '${categoryOf(k)}'`).join(' ')} ELSE 'other' END)`;
const LEDGER = 'FROM transactions t LEFT JOIN flights f ON f.id = t.flight_id';
const SIGNED = 'SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END) AS inflow, SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END) AS outflow';

type Totals = { category: string; inflow: number; outflow: number; month?: string };
const totalOf = (r: Totals): CategoryTotal => ({ category: r.category as Category, in: r.inflow, out: r.outflow });

/** Per UTC month (`YYYY-MM`) and category: what came in and what went out, for postings dated in [from, to). */
function monthlyTotals(db: Db, companyId: number, from: number, to: number): Map<string, CategoryTotal[]> {
  const rows = all<Totals>(db, `SELECT strftime('%Y-%m', t.at / 1000, 'unixepoch') AS month, ${CATEGORY_SQL} AS category, ${SIGNED} ${LEDGER}
    WHERE t.company_id = ? AND t.at >= ? AND t.at < ? GROUP BY month, category`, companyId, from, to);
  const out = new Map<string, CategoryTotal[]>();
  for (const r of rows) out.set(r.month!, [...(out.get(r.month!) ?? []), totalOf(r)]);
  return out;
}

// ---------------------------------------------------------------- revenue (read by lot CREDIT)

/** What the company earned by flying in the UTC month `YYYY-MM`: tickets, jobs, freight and on-board sales (never a grant, a refund or a resale). */
export function monthRevenue(db: Db, companyId: number, month: string): number {
  const from = monthStart(month);
  return revenueOf(monthlyTotals(db, companyId, from, addMonths(from, 1)).get(month) ?? []);
}
/** Revenue of the last full UTC month before `now`: what the credit ceiling and the debt ratio are read against. 0 for a company that did not exist yet. */
export const lastMonthRevenue = (db: Db, companyId: number, now: number): number => monthRevenue(db, companyId, monthKey(addMonths(now, -1)));

// ---------------------------------------------------------------- debt

/** The principal the company still owes and what it pays a month for it: aircraft loans and the building purchases it financed. Lot CREDIT adds its credits here. */
export function debtOf(db: Db, companyId: number): CashView['debt'] {
  const rows = all<{ principal: number; monthly: number; months: number | null; months_paid: number }>(db,
    `SELECT principal, monthly, months, months_paid FROM contracts WHERE company_id = ? AND status = 'active' AND kind = 'loan' AND principal > 0
     UNION ALL SELECT principal, monthly, months, months_paid FROM facility_contracts WHERE company_id = ? AND status = 'active' AND kind = 'purchase' AND principal > 0`, companyId, companyId);
  return { total: sumOf(rows, (r) => r.principal), monthly: sumOf(rows, (r) => (r.months_paid < (r.months ?? 0) ? r.monthly : 0)), credits: rows.length };
}

// ---------------------------------------------------------------- upcoming

/** The debits of the next billing date, biggest first: what `planMonth` will charge on the 1st (the rules billing itself uses). */
export function upcomingDebits(db: Db, companyId: number, now: number): UpcomingDebit[] {
  const at = addMonths(now, 1);
  const byKind = new Map<string, number>();
  for (const c of projectCharges(db, companyId, now, 1)) if (c.amount < 0) byKind.set(c.kind, (byKind.get(c.kind) ?? 0) + c.amount);
  return [...byKind].map(([kind, amount]): UpcomingDebit => ({ at, kind, category: categoryOf(kind), amount })).sort((x, y) => x.amount - y.amount).slice(0, UPCOMING_MAX);
}

// ---------------------------------------------------------------- cash flow

export function cashView(db: Db, companyId: number, now: number, months: number): CashView {
  const cur = monthKey(now);
  const first = get<{ at: number | null }>(db, 'SELECT MIN(at) AS at FROM transactions WHERE company_id = ?', companyId)?.at;
  const shown: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const key = monthKey(addMonths(now, -i));
    if (first !== null && first !== undefined && key >= monthKey(first)) shown.push(key);
  }
  // the previous month is read even when not shown: the runway is measured on the last closed month
  const earliest = monthStart(shown[0] ?? cur);
  const from = Math.min(earliest, addMonths(now, -1));
  const totals = monthlyTotals(db, companyId, from, addMonths(now, 1));
  // the balance at a date is the sum of the postings dated before it (the stored balance_after follows insertion order, which backdated line legs and the 1st-of-month billing can interleave)
  let running = get<{ s: number | null }>(db, 'SELECT SUM(amount) AS s FROM transactions WHERE company_id = ? AND at < ?', companyId, earliest)?.s ?? 0;
  const out: CashMonth[] = [];
  for (const month of shown) {
    const by = totals.get(month) ?? [];
    const revenue = revenueOf(by), spend = sumOf(by, (c) => c.out);
    const net = sumOf(by, (c) => c.in) - spend;
    running += net;
    const prev = out[out.length - 1];
    out.push({ month, closed: month < cur, revenue, spend, other: net - revenue + spend, net, netVsPrevious: prev ? net - prev.net : null, endBalance: running, byCategory: [...by].sort((x, y) => y.in + y.out - x.in - x.out) });
  }
  const balance = balanceOf(db, companyId);
  const lastClosed = totals.get(monthKey(addMonths(now, -1))) ?? [];
  const burn = sumOf(lastClosed.filter((c) => !NOT_BURN.includes(c.category)), (c) => c.out);
  const upcoming = upcomingDebits(db, companyId, now);
  return {
    balance,
    runwayDays: burn > 0 ? Math.round((Math.max(0, balance) / (burn / 30)) * 10) / 10 : null,
    debt: debtOf(db, companyId), months: out, upcoming, upcomingTotal: sumOf(upcoming, (u) => u.amount),
  };
}

// ---------------------------------------------------------------- statement

export function statement(db: Db, companyId: number, now: number, q: StatementQuery): StatementView {
  const where = ['t.company_id = ?'];
  const params: (string | number)[] = [companyId];
  if (q.from) { where.push('t.at >= ?'); params.push(Date.parse(`${q.from}T00:00:00Z`)); }
  if (q.to) { where.push('t.at < ?'); params.push(Date.parse(`${q.to}T00:00:00Z`) + DAY_MS); }
  if (q.category) { where.push(`${CATEGORY_SQL} = ?`); params.push(q.category); }
  if (q.line) { where.push('t.line_id = ?'); params.push(q.line); }
  const filters = where.join(' AND ');

  // the running balance follows the dates shown (the order of the page), computed over the whole ledger before any filter
  const page = all<{ id: number; at: number; kind: string; category: string; memo: string; amount: number; running: number; flightId: number | null;
    lineId: number | null; a: string | null; b: string | null; aircraftId: number | null; registration: string | null }>(db,
    `WITH t AS (SELECT id, company_id, at, kind, amount, memo, flight_id, line_id, aircraft_id, SUM(amount) OVER (ORDER BY at, id) AS running FROM transactions WHERE company_id = ?)
     SELECT t.id, t.at, t.kind, ${CATEGORY_SQL} AS category, t.memo, t.amount, t.running, t.flight_id AS flightId, t.line_id AS lineId, l.a, l.b, t.aircraft_id AS aircraftId, ac.registration
     FROM t LEFT JOIN flights f ON f.id = t.flight_id LEFT JOIN lines l ON l.id = t.line_id AND l.company_id = t.company_id LEFT JOIN aircraft ac ON ac.id = t.aircraft_id AND ac.company_id = t.company_id
     WHERE ${filters}${q.before ? ' AND (t.at, t.id) < (SELECT at, id FROM transactions WHERE id = ? AND company_id = ?)' : ''}
     ORDER BY t.at DESC, t.id DESC LIMIT ?`,
    companyId, ...params, ...(q.before ? [q.before, companyId] : []), q.limit + 1);
  const rows = page.slice(0, q.limit);

  const days: StatementView['days'] = [];
  if (rows.length > 0) {
    const nets = new Map(all<{ day: string; net: number }>(db, `SELECT strftime('%Y-%m-%d', t.at / 1000, 'unixepoch') AS day, SUM(t.amount) AS net ${LEDGER}
      WHERE ${filters} AND t.at >= ? AND t.at < ? GROUP BY day`, ...params, Date.parse(`${isoDay(rows.at(-1)!.at)}T00:00:00Z`), Date.parse(`${isoDay(rows[0]!.at)}T00:00:00Z`) + DAY_MS).map((r) => [r.day, r.net]));
    for (const r of rows) {
      const day = isoDay(r.at);
      if (days.at(-1)?.day !== day) days.push({ day, net: nets.get(day) ?? 0, rows: [] });
      days.at(-1)!.rows.push({
        id: r.id, at: r.at, kind: r.kind, category: r.category as Category, memo: r.memo, amount: r.amount, balanceAfter: r.running, flightId: r.flightId,
        line: r.lineId !== null && r.a !== null && r.b !== null ? { id: r.lineId, a: r.a, b: r.b } : null,
        aircraft: r.aircraftId !== null && r.registration !== null ? { id: r.aircraftId, registration: r.registration } : null,
      } satisfies StatementRow);
    }
  }

  const byCategory = all<Totals & { n: number }>(db, `SELECT ${CATEGORY_SQL} AS category, ${SIGNED}, COUNT(*) AS n ${LEDGER} WHERE ${filters} GROUP BY category`, ...params);
  const inflow = sumOf(byCategory, (c) => c.inflow), outflow = sumOf(byCategory, (c) => c.outflow);
  return {
    days, next: page.length > q.limit ? rows.at(-1)!.id : null,
    summary: { net: inflow - outflow, in: inflow, out: outflow, count: sumOf(byCategory, (c) => c.n), byCategory: byCategory.map(totalOf).sort((x, y) => CATEGORIES.indexOf(x.category) - CATEGORIES.indexOf(y.category)) },
    scheduled: upcomingDebits(db, companyId, now)[0] ?? null,
  };
}
