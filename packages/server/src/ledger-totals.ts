// The ledger summed per UTC month and category: the read model every report, the credit ceiling and the alliance dues share. A leaf (database, game's calendar and the shared category map only), so monthly billing
// (finance.ts) can read last month's revenue without importing the reports, which import billing. Nothing here writes: a figure is a sum of postings, so it can never disagree with the balance.
import { KNOWN_KINDS, categoryOf, revenueOf, type Category, type CategoryTotal } from '@opc/shared';
import { all, type Db } from './db.ts';
import { addMonths } from './game.ts';

export const monthStart = (key: string): number => Date.parse(`${key}-01T00:00:00Z`);

/** The category of a posting as SQL, built from `categoryOf` so the filter, the grouping and the code can not drift. Needs `transactions t` and `flights f` (LEFT JOIN on flight_id) in scope. */
export const CATEGORY_SQL = `(CASE WHEN t.kind = 'payout' AND f.kind = 'cargo' THEN 'freight' ${KNOWN_KINDS.map((k) => `WHEN t.kind = '${k}' THEN '${categoryOf(k)}'`).join(' ')} ELSE 'other' END)`;
export const LEDGER = 'FROM transactions t LEFT JOIN flights f ON f.id = t.flight_id';
export const SIGNED = 'SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END) AS inflow, SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END) AS outflow';

export type Totals = { category: string; inflow: number; outflow: number; month?: string };
export const totalOf = (r: Totals): CategoryTotal => ({ category: r.category as Category, in: r.inflow, out: r.outflow });

/** Per UTC month (`YYYY-MM`) and category: what came in and what went out, for postings dated in [from, to). */
export function monthlyTotals(db: Db, companyId: number, from: number, to: number): Map<string, CategoryTotal[]> {
  const rows = all<Totals>(db, `SELECT strftime('%Y-%m', t.at / 1000, 'unixepoch') AS month, ${CATEGORY_SQL} AS category, ${SIGNED} ${LEDGER}
    WHERE t.company_id = ? AND t.at >= ? AND t.at < ? GROUP BY month, category`, companyId, from, to);
  const out = new Map<string, CategoryTotal[]>();
  for (const r of rows) out.set(r.month!, [...(out.get(r.month!) ?? []), totalOf(r)]);
  return out;
}

/** What the company earned by flying in [from, to): tickets, jobs, freight and on-board sales (never a grant, a refund or a resale). */
export const revenueBetween = (db: Db, companyId: number, from: number, to: number): number => revenueOf([...monthlyTotals(db, companyId, from, to).values()].flat());

/** What the company earned by flying in the UTC month `YYYY-MM`. */
export const monthRevenue = (db: Db, companyId: number, month: string): number => revenueBetween(db, companyId, monthStart(month), addMonths(monthStart(month), 1));
/** Revenue of the last full UTC month before `now`: what the credit ceiling, the debt ratio and the alliance dues are read against. 0 for a company that did not exist yet. */
export const lastMonthRevenue = (db: Db, companyId: number, now: number): number => revenueBetween(db, companyId, addMonths(now, -1), addMonths(now, 0));
