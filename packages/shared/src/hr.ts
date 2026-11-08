// Lot HR (v4): the pay level and the morale it sets (docs/v4-plan.md A.4, B.3, B.8, C27, C30, C31). Pure rules, constants, the request schema and wire types.
// What is modelled, and nothing more:
//   - the PAY LEVEL, a percentage over or under the grid salary, moves the payroll (`paidSalary`, applied to the staff inputs of the one payroll code, finance.ts `planMonth`);
//   - the REST POLICY, which the staff lot owns and `crewLeg` enforces, is the other thing morale reads (`REST_MORALE`): HR keeps no second rest setting;
//   - every month the billing run moves the morale of each person on the payroll a fixed share of the way to the TARGET those two set (`driftMorale`);
//   - ONE effect: a person whose morale is under `QUIT_BELOW` may give notice (`quits`, a roll the server seeds with the person and the month).
// No strike, no inspection, no fine and no compliance axis (C27): the duty limits stay what `crewLeg` enforces. Every figure marked [tuned] is ours: the mockup's effects have no model (B.8).
// Imports only types from staff.ts, so there is no runtime cycle.
import { z } from 'zod';
import type { RestPolicy, StaffFamily } from './staff.ts';

// ---------------------------------------------------------------- the pay level

/** Pay against the grid, in percent: under the market, at it, over it. 0 is the grid salary each person was hired at. A contract's salary is never rewritten: the payroll applies the level. [Tuned.] */
export const PAY_LEVELS = [-10, -5, 0, 5, 10] as const;
export type PayLevel = (typeof PAY_LEVELS)[number];
export const PAY_PCT_DEFAULT: PayLevel = 0;

/** Who the payroll of the month starting at `start` pays: whoever started before the 1st and has not left by it (the hiring premium covered the month they joined). One rule: the billing
 *  (finance.ts `planMonth`) and the monthly morale step both read it, so the people HR moves are the people the payroll pays. `since` is the later of the start and the day of the hire. */
export const onPayroll = (p: { since: number; ends_at: number | null }, start: number): boolean => p.since < start && (p.ends_at === null || p.ends_at > start);

/** What the payroll pays one person at pay level `payPct`: the grid salary moved by that percentage, to the euro. */
export const paidSalary = (salary: number, payPct: number): number => Math.round((salary * (100 + payPct)) / 100);

/** The body of `PUT /hr/policy`. Strict: there is no other axis (no compliance setting, C27), so a body that names one is refused instead of silently ignored. */
export const hrPolicySchema = z.strictObject({ payPct: z.literal(PAY_LEVELS) });

/** The payroll inputs at pay level `payPct`: every grid salary moved by the level (a copy; market pay is the same list). Billing, the projections and the staff overview all go through this one function. */
export const paidStaff = <T extends { salary: number }>(staff: readonly T[], payPct: number): T[] => (payPct === 0 ? [...staff] : staff.map((s) => ({ ...s, salary: paidSalary(s.salary, payPct) })));

// ---------------------------------------------------------------- morale

/** Morale is 0 to 100. Under this, a person may give notice. */
export const QUIT_BELOW = 50;
/** Where a team settles at market pay and the standard rest policy. A new hire arrives at 50 to 95. [Tuned.] */
export const MORALE_BASE = 60;
/** Points of target morale per percent of pay over (or under) the market: a 5 % step is 12.5 points. [Tuned.] */
export const MORALE_PER_PAY_PCT = 2.5;
/** Points of target morale for the staff lot's rest policy: generous rest holds a 5 % pay cut (52.5) but not a 10 % one (40); the legal minimum alone is no reason to leave at market pay (55). [Tuned.] */
export const REST_MORALE: Readonly<Record<RestPolicy, number>> = { legal: -5, standard: 0, generous: 5 };
/** Share of the distance to the target that morale covers each month. [Tuned.] */
export const MORALE_DRIFT = 0.25;

/** The morale a team moves towards, from the pay level and the rest policy: 30 to 90. A company that never opens the HR screen (market pay, standard rest) is at 60, so nobody leaves. */
export const moraleTarget = (payPct: number, rest: RestPolicy): number => MORALE_BASE + payPct * MORALE_PER_PAY_PCT + REST_MORALE[rest];
/** One month's step of one person's morale, kept to a hundredth so the stored value is the same on every machine. */
export const driftMorale = (morale: number, target: number): number => Math.round((morale + (target - morale) * MORALE_DRIFT) * 100) / 100;

// ---------------------------------------------------------------- the one effect: leaving

/** The chance, each month, that a person under `QUIT_BELOW` gives notice. [Tuned.] */
export const QUIT_CHANCE = 0.05;
/** Does a person of this morale give notice this month? `roll` is their draw of the month in [0, 1): the server seeds it with the person and the month, so a replay gives the same answer. */
export const quits = (morale: number, roll: number): boolean => morale < QUIT_BELOW && roll < QUIT_CHANCE;

// ---------------------------------------------------------------- wire types

/** One pay level as the preview shows it: the monthly payroll the next billing would charge at it (`payrollDelta` against the level in `pay.next`), where morale settles, and whether people start to leave there. */
export type HrOption = { payPct: PayLevel; payroll: number; payrollDelta: number; target: number; leaves: boolean };
export type HrFamily = { family: StaffFamily; people: number; morale: number };
/** `GET /hr`. `pay.current` is in force now, `pay.next` once a change made today applies (`applyFrom`, the next UTC midnight); `payroll` is the next billing at `pay.next`; `rest` is the staff lot's rest policy.
 *  HR covers the people on a permanent contract: `people` are the ones not on notice, with their mean `morale.average` (null for nobody) and `atRisk` of them under `rule.below` now; `leaving` have given notice and still work. */
export type HrView = {
  now: number; applyFrom: number;
  pay: { current: PayLevel; next: PayLevel };
  rest: RestPolicy;
  people: number; leaving: number; payroll: number;
  morale: { average: number | null; target: number; families: HrFamily[] };
  rule: { below: number; chance: number; drift: number; atRisk: number };
  options: HrOption[];
};
