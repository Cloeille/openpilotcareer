import type { AogCase, ChoiceOption, ComponentId, RefurbishItem, StockLine, StockPolicy, TypePolicy, WarehouseView, WearAction, WearView } from './api-parts.ts';

/**
 * Pure view-models of the PARTS screens: what a screen derives from the API's answers, testable without a DOM.
 * Strings are not made here: a view-model returns kinds and numbers, the screen translates them.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------- warehouse

/** With the part in stock a breakdown costs this many hours (B.6). Mirrors S5's constant until `@opc/shared` has it. */
export const REPAIR_WITH_PART_H = 6;

const POLICY_ORDER: readonly StockPolicy[] = ['none', 'critical', 'full'];
const ACTION_ORDER: readonly WearAction[] = ['leave', 'overhaul', 'replace'];
const clampStep = <T>(list: readonly T[], current: T, dir: 1 | -1): T => list[Math.min(list.length - 1, Math.max(0, list.indexOf(current) + dir))]!;
/** The policy one step to the left (-1) or right (+1); the row stops at both ends. */
export const stepPolicy = (p: StockPolicy, dir: 1 | -1): StockPolicy => clampStep(POLICY_ORDER, p, dir);

/** What a type costs and leaves under its current policy. */
export const currentOption = (p: TypePolicy): TypePolicy['options'][StockPolicy] => p.options[p.policy];

/** The row the screen opens on: the type with an aircraft down, else the first type with no stock, else the first. */
export function defaultType(v: Pick<WarehouseView, 'policies' | 'aog'>): string | null {
  const down = v.aog ? v.policies.find((p) => p.icao === v.aog!.icao) : undefined;
  return (down ?? v.policies.find((p) => p.policy === 'none') ?? v.policies[0])?.icao ?? null;
}

/** The type "order the critical kit" is about: the one with the aircraft down, else the selected one; only when it has no stock yet. */
export function kitTarget(v: Pick<WarehouseView, 'policies' | 'aog'>, selected: string | null): TypePolicy | null {
  const down = v.aog ? v.policies.find((p) => p.icao === v.aog!.icao) : undefined;
  const picked = v.policies.find((p) => p.icao === selected);
  return [down, picked].find((p) => p !== undefined && p.policy === 'none') ?? null;
}

export type KitFacts = { capital: number; daysAvoided: number; saved: number };
/** What the critical kit of a type ties up, and what it buys back against holding nothing: ground days a year, and the revenue of those days. */
export function kitFacts(p: TypePolicy): KitFacts {
  const daysAvoided = Math.max(0, p.options.none.groundDays - p.options.critical.groundDays);
  return { capital: p.options.critical.capital, daysAvoided, saved: Math.round(daysAvoided * p.groundDayValue) };
}

export type PolicyBars = { capital: number; ground: number };
/** Bar lengths 0..1 for each row: money against the biggest full kit, ground days against the worst "nothing in stock". */
export function policyBars(policies: readonly TypePolicy[]): Map<string, PolicyBars> {
  const maxCapital = Math.max(1, ...policies.map((p) => p.options.full.capital));
  const maxDays = Math.max(1, ...policies.map((p) => p.options.none.groundDays));
  return new Map(policies.map((p) => [p.icao, { capital: currentOption(p).capital / maxCapital, ground: currentOption(p).groundDays / maxDays }]));
}

/** Registrations of the aircraft whose type has no stock at all. */
export const uncovered = (v: Pick<WarehouseView, 'policies'>): string[] => v.policies.filter((p) => p.policy === 'none').flatMap((p) => p.registrations);
export const partCount = (v: Pick<WarehouseView, 'inventory'>): number => v.inventory.reduce((n, l) => n + l.qty, 0);
/** The type that grounds the company for the most days a year under its policy. */
export function worstType(v: Pick<WarehouseView, 'policies'>): { typeName: string; days: number } | null {
  const worst = [...v.policies].sort((a, b) => currentOption(b).groundDays - currentOption(a).groundDays)[0];
  return worst ? { typeName: worst.typeName, days: currentOption(worst).groundDays } : null;
}

export type StockGroup = { policy: TypePolicy; lines: StockLine[]; subtotal: number };
/** The inventory by aircraft type, in the order of the policy list; a type with nothing in stock still has its group. */
export const stockGroups = (v: Pick<WarehouseView, 'policies' | 'inventory'>): StockGroup[] =>
  v.policies.map((policy) => {
    const lines = v.inventory.filter((l) => l.icao === policy.icao);
    return { policy, lines, subtotal: lines.reduce((s, l) => s + l.value, 0) };
  });

export type AogTimeline = {
  /** Start of each day on the ruler (UTC midnight). */
  days: number[]; nowPct: number;
  grounded: { from: number; to: number };
  planned: { from: number; to: number } | null;
  fixed: { from: number; to: number };
  elapsedDays: number; plannedDays: number; lostDays: number; onlineAt: number;
};
/** The two tracks of the AOG case, as shares (0..1) of a ruler of whole UTC days from the failure to the part (or to now, when the part is late). */
export function aogTimeline(aog: Pick<AogCase, 'failedAt' | 'eta'>, now: number): AogTimeline {
  const first = Math.floor(aog.failedAt / DAY_MS) * DAY_MS;
  const end = Math.max(aog.eta, now);
  const count = Math.max(2, Math.ceil((end - first) / DAY_MS));
  const span = count * DAY_MS;
  const pct = (ms: number): number => Math.min(1, Math.max(0, (ms - first) / span));
  const onlineAt = aog.failedAt + REPAIR_WITH_PART_H * HOUR_MS;
  return {
    days: Array.from({ length: count }, (_, i) => first + i * DAY_MS),
    nowPct: pct(now),
    grounded: { from: pct(aog.failedAt), to: pct(Math.min(now, end)) },
    planned: aog.eta > now ? { from: pct(now), to: pct(aog.eta) } : null,
    fixed: { from: pct(aog.failedAt), to: pct(onlineAt) },
    elapsedDays: Math.max(0, Math.round((now - aog.failedAt) / DAY_MS)),
    plannedDays: Math.max(0, Math.round((aog.eta - now) / DAY_MS)),
    lostDays: Math.max(1, Math.round((aog.eta - aog.failedAt) / DAY_MS)),
    onlineAt,
  };
}

// ---------------------------------------------------------------- lease wear

export type Choices = Record<ComponentId, WearAction>;
/** A wear of this much or more is drawn amber: the component is near the point where it costs. */
export const WEAR_WARN = 75;
export const wearTone = (pct: number): 'warn' | 'ok' => (pct >= WEAR_WARN ? 'warn' : 'ok');

/** Choices as the server suggests them; a component the aircraft does not have is not in the table. */
export const defaultChoices = (v: Pick<WearView, 'components'>): Choices =>
  Object.fromEntries(v.components.map((c) => [c.component, c.suggested])) as Choices;
export const leaveAll = (v: Pick<WearView, 'components'>): Choices => Object.fromEntries(v.components.map((c) => [c.component, 'leave' as const])) as Choices;
/** The choice one step to the left (toward "leave") or right (toward "replace"). */
export const stepAction = (a: WearAction, dir: 1 | -1): WearAction => clampStep(ACTION_ORDER, a, dir);

const optionOf = (v: Pick<WearView, 'choices'>, c: ComponentId, a: WearAction): ChoiceOption => v.choices[c][a];

export type WearTotals = { works: number; cost: number; monthlyGain: number; netReturn: number; netBuy: number; gross: number; residual: number; downDays: number };
/** What the player's choices add up to. `gross` is what the works earn before the aircraft goes back; `residual` is the value of the new parts left to the lessor if the aircraft is handed back. */
export function totalsOf(v: Pick<WearView, 'components' | 'choices'>, choices: Choices): WearTotals {
  const picked = v.components.filter((c) => choices[c.component] !== 'leave').map((c) => optionOf(v, c.component, choices[c.component]));
  const sum = (f: (o: ChoiceOption) => number): number => picked.reduce((s, o) => s + f(o), 0);
  const cost = sum((o) => o.cost), netReturn = sum((o) => o.netReturn), netBuy = sum((o) => o.netBuy);
  return { works: picked.length, cost, monthlyGain: sum((o) => o.monthlyGain), netReturn, netBuy, gross: netReturn + cost, residual: netBuy - netReturn, downDays: Math.max(0, ...picked.map((o) => o.downDays)) };
}

export type Gauge = { now: number; after: number };
/** The three figures of the header with what the choices would make of them. A performance loss is a magnitude (3 is "−3 %"); reliability and satisfaction are the levels, and a component that is overhauled or replaced gives its effect back. */
export function gaugesOf(v: Pick<WearView, 'components' | 'effects'>, choices: Choices): { performance: Gauge; reliability: Gauge; satisfaction: Gauge } {
  const of = (kind: 'performance' | 'reliability' | 'satisfaction', only?: (c: ComponentId) => boolean): number =>
    v.components.filter((c) => c.effect.kind === kind && (only?.(c.component) ?? true)).reduce((s, c) => s + c.effect.value, 0);
  const fixed = (kind: 'reliability' | 'satisfaction'): number => of(kind, (c) => choices[c] !== 'leave');
  const performance = of('performance');
  return {
    performance: { now: performance, after: of('performance', (c) => choices[c] === 'leave') },
    reliability: { now: v.effects.reliability, after: v.effects.reliability + fixed('reliability') },
    satisfaction: { now: v.effects.satisfaction, after: v.effects.satisfaction + fixed('satisfaction') },
  };
}

/** Cumulative cash of the works month by month until the aircraft goes back: the cost up front, then what the works earn each month. */
export const cashCurve = (t: Pick<WearTotals, 'cost' | 'monthlyGain'>, months: number): number[] =>
  Array.from({ length: Math.max(0, months) }, (_, i) => -t.cost + t.monthlyGain * (i + 1));
/** The month (1-based) the cumulative cash first reaches zero, or null when it never does before the end. */
export const breakEven = (curve: readonly number[]): number | null => {
  const i = curve.findIndex((x) => x >= 0);
  return i < 0 ? null : i + 1;
};
export type ChartBar = { up: number; down: number };
/** Bar heights 0..1 above and below the zero line, each side scaled to its own extreme. */
export function chartBars(curve: readonly number[]): ChartBar[] {
  const top = Math.max(0, ...curve), bottom = Math.max(0, ...curve.map((x) => -x));
  return curve.map((x) => ({ up: top > 0 && x > 0 ? x / top : 0, down: bottom > 0 && x < 0 ? -x / bottom : 0 }));
}

export const itemsOf = (choices: Choices): RefurbishItem[] =>
  (Object.entries(choices) as [ComponentId, WearAction][]).filter((e): e is [ComponentId, 'overhaul' | 'replace'] => e[1] !== 'leave').map(([component, action]) => ({ component, action }));

/** When the works under way end, if they do. */
export const worksUntil = (v: Pick<WearView, 'components'>, now: number): number | null => {
  const ends = v.components.map((c) => c.refurbUntil ?? 0).filter((t) => t > now);
  return ends.length === 0 ? null : Math.max(...ends);
};
