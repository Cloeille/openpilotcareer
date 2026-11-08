// Lot HR (v4), server side, part 1: the leaf finance.ts reads (so it imports no finance). The read model is in hr-views.ts, the routes in routes-hr.ts (docs/v4-plan.md A.4, C27, C30, C31). The company's pay level against the grid, the monthly morale step and the one thing morale does: a person under QUIT_BELOW may
// give notice. The pay level is a history like `service_policy`: a change is a row whose `since` is the next UTC midnight and the level at instant `t` is the row with the latest `since <= t`,
// so a replayed billing month always sees the level of its own time. The payroll itself is the existing one (finance.ts `planMonth`, fed the staff inputs through shared `paidStaff`).
// The morale step runs inside `runBilling`, behind its billing_runs guard, so each company and month is stepped once whatever the number of requests or replays.
import { DAY_MS, PAY_PCT_DEFAULT, driftMorale, moraleTarget, onPayroll, quits, type PayLevel } from '@opc/shared';
import { hashSeed, mulberry32 } from './board.ts';
import { get, run, type Db } from './db.ts';
import { applyFrom } from './service.ts';
import { payrollRows, policyOf } from './staff.ts';

/** The instant after the last one: "the level as it will be". */
const LATEST = Number.MAX_SAFE_INTEGER;

/** The company's pay level at instant `at` (default: as it will be once a pending change is in force). No row: market pay. */
export const payAt = (db: Db, companyId: number, at: number = LATEST): PayLevel =>
  get<{ pay_pct: PayLevel }>(db, 'SELECT pay_pct FROM hr_policy WHERE company_id = ? AND since <= ? ORDER BY since DESC LIMIT 1', companyId, at)?.pay_pct ?? PAY_PCT_DEFAULT;

/** Set the pay level; it applies from the next UTC midnight (a second change the same day replaces the first). */
export function setPay(db: Db, companyId: number, payPct: PayLevel, now: number): void {
  run(db, 'INSERT INTO hr_policy (company_id, pay_pct, since) VALUES (?, ?, ?) ON CONFLICT (company_id, since) DO UPDATE SET pay_pct = excluded.pay_pct', companyId, payPct, applyFrom(now));
}

/** The step billing makes for `month` (`YYYY-MM`, `at` its 1st): everybody the payroll pays that month and who has not given notice moves a share of the way to the morale the pay level and the rest policy
 *  set (C30); then, on the morale they now have, a person under QUIT_BELOW gives notice on a roll seeded by their id and the month. The morale, the roll and the date are functions of the stored state and of
 *  `month` alone, never of when the request that ran the billing arrived: the same history gives the same morale and the same leavers, to the day (the notice runs from the 1st; they are paid until they go,
 *  no severance). The rest policy is not a history (the staff lot keeps one setting), so a catch-up of several months steps them all with the one in force. */
export function stepMorale(db: Db, companyId: number, month: string, at: number): void {
  const target = moraleTarget(payAt(db, companyId, at), policyOf(db, companyId));
  for (const p of payrollRows(db, companyId)) {
    if (!onPayroll(p, at) || p.ends_at !== null) continue;
    const morale = driftMorale(p.morale, target);
    if (morale !== p.morale) run(db, 'UPDATE staff SET morale = ? WHERE id = ?', morale, p.id);
    if (quits(morale, mulberry32(hashSeed(`hr-quit:${p.id}:${month}`))())) run(db, 'UPDATE staff SET ends_at = ? WHERE id = ?', at + p.notice_days * DAY_MS, p.id);
  }
}
