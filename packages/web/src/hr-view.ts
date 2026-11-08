import { PAY_LEVELS, type HrOption, type HrView, type PayLevel } from '@opc/shared';
import type { Key } from './messages.ts';
import type { Tone } from './staff-view.ts';

/** What the HR screen decides without asking the server: how the pay levels read and step, and what colour a figure gets. The money, the morale and the departures are always the server's. */

/** The name of each pay level (the percentage itself is `payLabel`). A typed Record: a level added to the union breaks the typecheck until it has its message. */
export const LEVEL_KEY: Record<PayLevel, Key> = { '-10': 'hr.lv.m10', '-5': 'hr.lv.m5', 0: 'hr.lv.0', 5: 'hr.lv.p5', 10: 'hr.lv.p10' };

/** `+5 %`, `−5 %`, `0 %` (a true minus sign, like the money). */
export const payLabel = (payPct: number): string => (payPct === 0 ? '0 %' : `${payPct > 0 ? '+' : '\u2212'}${Math.abs(payPct)} %`);

/** The pay level `dir` steps away (← →), stopping at the two ends. */
export const stepLevel = (current: PayLevel, dir: 1 | -1): PayLevel => PAY_LEVELS[Math.min(PAY_LEVELS.length - 1, Math.max(0, PAY_LEVELS.indexOf(current) + dir))]!;

/** The server's preview row for a level (the list always holds every level; the first row is a type-only fallback). */
export const optionOf = (v: Pick<HrView, 'options'>, level: PayLevel): HrOption => v.options.find((o) => o.payPct === level) ?? v.options[0]!;

/** A level is pending when the one set is not the one in force yet (it applies from the next UTC midnight). */
export const isPending = (v: Pick<HrView, 'pay'>): boolean => v.pay.next !== v.pay.current;

/** Morale under the server's line (`rule.below`) is red, anything else is not coloured: 60 is where an untouched company sits and is no warning. */
export const moraleTone = (morale: number, below: number): Tone => (morale < below ? 'bad' : 'ok');
export const moraleFraction = (morale: number): number => Math.min(1, Math.max(0, morale / 100));

/** A payroll that grows is an amber cost, one that shrinks is green. */
export const deltaClass = (delta: number): string => (delta > 0 ? 'st-warn' : delta < 0 ? 'ln-ok' : '');
