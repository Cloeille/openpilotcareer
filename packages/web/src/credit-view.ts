import { CREDIT_BANK_IDS, CREDIT_MIN, CREDIT_MONTHS, CREDIT_REFUSALS, CREDIT_STEP, type CreditBankId, type CreditRefusal, type CreditsView } from '@opc/shared';
import type { Key } from './messages.ts';

/** Pure view-model of the two credit screens (docs/v4-plan.md CREDIT). The server computes every figure; this only picks, steps and positions what it returned. */

// ---------------------------------------------------------------- the words of each closed set (typed keys, no built strings)

export const BANK_KEY: Record<CreditBankId, Key> = { alpes: 'cr.bank.alpes', meridional: 'cr.bank.meridional', aerofinance: 'cr.bank.aerofinance' };
export const REFUSAL_KEY: Record<CreditRefusal, Key> = { too_many: 'cr.refusal.too_many', over_ceiling: 'cr.refusal.over_ceiling', debt_ratio: 'cr.refusal.debt_ratio' };
export { CREDIT_BANK_IDS, CREDIT_MONTHS, CREDIT_REFUSALS };

// ---------------------------------------------------------------- the new credit

export type Draft = { amount: number; months: number; bank: CreditBankId };

/** The amount the slider may take: from the smallest credit to what the ceiling still leaves, in whole steps (the smallest when nothing is left: the server then says why). */
export const clampAmount = (amount: number, room: number): number => Math.min(Math.max(CREDIT_MIN, Math.floor(room / CREDIT_STEP) * CREDIT_STEP), Math.max(CREDIT_MIN, Math.round(amount / CREDIT_STEP) * CREDIT_STEP));
/** An arrow key moves by a tenth of the amount's order of magnitude (10 000 below 100 000, 100 000 below a million, 1 M below 10 M...), so the 10 000 to 100 M range takes under 300 presses (an arrow repeats when held), not 10 000. Reading the order of the amount just below when going down makes ← undo →. */
export const stepAmount = (amount: number, dir: 1 | -1, room: number): number => {
  const step = Math.max(CREDIT_STEP, 10 ** (Math.floor(Math.log10(dir === 1 ? amount : amount - 1)) - 1));
  return clampAmount(amount + dir * step, room);
};
/** The first draft of a visit: half of what can be borrowed, 24 months, the first bank. */
export const firstDraft = (room: number): Draft => ({ amount: clampAmount(room / 2, room), months: 24, bank: CREDIT_BANK_IDS[0] });
/** The next value of a closed list, wrapping around. */
export function cycle<T>(list: readonly T[], current: T, dir: 1 | -1): T {
  const i = list.indexOf(current);
  return list[(Math.max(0, i) + dir + list.length) % list.length]!;
}

// ---------------------------------------------------------------- the credits screen

/** The month `dir` steps from `current` inside the schedule, stopping at both ends. */
export function stepScheduleMonth(schedule: CreditsView['schedule'], current: string | null, dir: 1 | -1): string | null {
  if (schedule.length === 0) return null;
  const i = schedule.findIndex((m) => m.month === current);
  return schedule[Math.min(schedule.length - 1, Math.max(0, (i < 0 ? 0 : i) + dir))]!.month;
}

/** Each segment of a schedule bar as a share (0..1) of the tallest bar of the chart. */
export function barShares(schedule: CreditsView['schedule']): { month: string; capital: number; interest: number; insurance: number }[] {
  const top = Math.max(0, ...schedule.map((m) => m.capital + m.interest + m.insurance));
  const share = (v: number): number => (top > 0 ? v / top : 0);
  return schedule.map((m) => ({ month: m.month, capital: share(m.capital), interest: share(m.interest), insurance: share(m.insurance) }));
}

/** How much of a credit is repaid, as a share (0..1) of what was borrowed. */
export const repaidShare = (borrowed: number, principal: number): number => (borrowed > 0 ? Math.min(1, Math.max(0, 1 - principal / borrowed)) : 0);

/** The partial amount of the simulator: kept inside what is left to repay (at least 1). */
export const clampPrepay = (amount: number, principal: number): number => Math.min(Math.max(1, principal), Math.max(1, Math.round(amount)));

/** `0.061` -> `6.1 %` with one decimal, in the language's own form. */
export const percent1 = (fraction: number, locale: string): string => `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(fraction * 100)}\u00a0%`;
