// Lot HR (v4), server side, part 2: the read model of `GET /hr`. The preview prices every pay level with the payroll code billing itself uses (finance.ts `planMonth` fed through shared `paidStaff`),
// so what the screen promises is what the 1st charges.
import { MORALE_DRIFT, PAY_LEVELS, QUIT_BELOW, QUIT_CHANCE, STAFF_FAMILIES, moraleTarget, onPayroll, paidStaff, type HrFamily, type HrOption, type HrView, type PayLevel } from '@opc/shared';
import type { Db } from './db.ts';
import { planMonth } from './finance.ts';
import { addMonths } from './game.ts';
import { applyFrom } from './service.ts';
import { payAt } from './hr.ts';
import { payrollRows, policyOf } from './staff.ts';

const round1 = (n: number): number => Math.round(n * 10) / 10;
const mean = (xs: readonly number[]): number | null => (xs.length === 0 ? null : round1(xs.reduce((a, b) => a + b, 0) / xs.length));

/** `GET /hr`: the pay level, where morale is and where it is heading, and what each level would cost and do (the preview: one row per level, computed by the same payroll code billing uses). */
export function hrView(db: Db, companyId: number, now: number): HrView {
  const rest = policyOf(db, companyId), pay = { current: payAt(db, companyId, now), next: payAt(db, companyId) };
  const rows = payrollRows(db, companyId);
  const nextBilling = addMonths(now, 1);
  const staying = rows.filter((p) => p.ends_at === null && onPayroll(p, nextBilling));
  const leaving = rows.filter((p) => p.ends_at !== null && p.ends_at > now && p.since <= now);
  const payrollAt = (level: PayLevel): number => -(planMonth(nextBilling, [], [], paidStaff(rows, level)).charges.find((c) => c.kind === 'payroll')?.amount ?? 0);
  const saved = payrollAt(pay.next);
  const families = STAFF_FAMILIES.flatMap((family): HrFamily[] => {
    const m = mean(staying.filter((p) => p.family === family).map((p) => p.morale));
    return m === null ? [] : [{ family, people: staying.filter((p) => p.family === family).length, morale: m }];
  });
  const options = PAY_LEVELS.map((payPct): HrOption => {
    const payroll = payrollAt(payPct), target = moraleTarget(payPct, rest);
    return { payPct, payroll, payrollDelta: payroll - saved, target, leaves: target < QUIT_BELOW };
  });
  return {
    now, applyFrom: applyFrom(now), pay, rest, people: staying.length, leaving: leaving.length, payroll: saved,
    morale: { average: mean(staying.map((p) => p.morale)), target: moraleTarget(pay.next, rest), families },
    rule: { below: QUIT_BELOW, chance: QUIT_CHANCE, drift: MORALE_DRIFT, atRisk: staying.filter((p) => p.morale < QUIT_BELOW).length },
    options,
  };
}
