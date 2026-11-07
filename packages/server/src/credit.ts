// Lot CREDIT (v4), the billing side: the consumer credits a company holds, the lowest balance of a month (what the overdraft costs) and the unpaid-instalment rule (C20).
// A leaf like facilities.ts: finance.ts `runBilling` reads and saves through here, the rules themselves are pure and live in shared/credit.ts. Signing, repaying and the views: credit-manage.ts.
import { CREDIT_LATE_REPUTATION, OVERDRAFT_LIMIT, lateFee, type CreditState } from '@opc/shared';
import { all, get, run, type Db } from './db.ts';
import { balanceOf } from './game.ts';
import { post } from './ledger.ts';

export type CreditRow = CreditState & { company_id: number; bank: string; principal0: number; fee: number; early_penalty_pct: number };

/** The credits still being repaid, oldest first. */
export const activeCredits = (db: Db, companyId: number): CreditRow[] => all<CreditRow>(db, "SELECT * FROM credits WHERE company_id = ? AND status = 'active' ORDER BY id", companyId);

/** Write back what `planCreditMonth` changed. */
export function saveCredits(db: Db, before: readonly CreditState[], after: readonly CreditState[]): void {
  for (const c of after) {
    const was = before.find((x) => x.id === c.id)!;
    if (c.principal !== was.principal || c.months_paid !== was.months_paid || c.status !== was.status) run(db, 'UPDATE credits SET principal = ?, months_paid = ?, status = ? WHERE id = ?', c.principal, c.months_paid, c.status, c.id);
  }
}

/** The lowest the balance went in [from, to), 0 when it never went below zero: the balance at `from` (the sum of the postings before it), then each posting in date order, as the statement reads it. */
export function overdraftLow(db: Db, companyId: number, from: number, to: number): number {
  const opening = get<{ s: number }>(db, 'SELECT COALESCE(SUM(amount), 0) AS s FROM transactions WHERE company_id = ? AND at < ?', companyId, from)!.s;
  const inside = get<{ m: number | null }>(db, 'SELECT MIN(running) AS m FROM (SELECT SUM(amount) OVER (ORDER BY at, id) AS running FROM transactions WHERE company_id = ? AND at >= ? AND at < ?)', companyId, from, to)!.m;
  return Math.min(0, opening, opening + (inside ?? 0));
}

/** C20, called by billing right after a credit instalment was taken: when that left the account below what the overdraft allows, the bank adds the late fee and the company loses reputation.
 *  The instalment stays taken and nothing is seized. Billing runs once per company and month, so this does too. */
export function settleLate(db: Db, companyId: number, at: number, instalment: number, memo: string): void {
  if (balanceOf(db, companyId) >= -OVERDRAFT_LIMIT) return;
  post(db, companyId, at, 'credit_late_fee', -lateFee(instalment), `late fee, ${memo}`);
  run(db, 'UPDATE companies SET reputation = MAX(0, reputation - ?) WHERE id = ?', CREDIT_LATE_REPUTATION, companyId);
}
