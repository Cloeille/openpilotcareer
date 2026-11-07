import type { AogCase, Choice, Component, ComponentWear, Effects, PartClass, PartsPolicy, PartsPolicyOption, StockLine, TypePolicy, WarehouseView, WearView } from './api-parts.ts';

/**
 * Pure view-models of the PARTS screens: what a screen derives from the API's answers, testable without a DOM.
 * Money is never computed here: S5 prices every selection (`?pick=`), the screens only lay its answer out.
 * Strings are not made here: a view-model returns kinds and numbers, the screen translates them.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------- warehouse

const POLICY_ORDER: readonly PartsPolicy[] = ['none', 'critical', 'full'];
const CHOICE_ORDER: readonly Choice[] = ['leave', 'overhaul', 'replace'];
const step = <T>(list: readonly T[], current: T, dir: 1 | -1): T => list[Math.min(list.length - 1, Math.max(0, list.indexOf(current) + dir))]!;
/** The policy one step to the left (-1) or right (+1); the row stops at both ends. */
export const stepPolicy = (p: PartsPolicy, dir: 1 | -1): PartsPolicy => step(POLICY_ORDER, p, dir);

const EMPTY: PartsPolicyOption = { policy: 'none', capital: 0, groundDays: 0 };
/** What a policy ties up and the ground days a year it leaves, for a type. */
export const optionOf = (p: Pick<TypePolicy, 'options'>, policy: PartsPolicy): PartsPolicyOption => p.options.find((o) => o.policy === policy) ?? { ...EMPTY, policy };
/** What the type ties up under the policy chosen. */
export const currentOption = (p: Pick<TypePolicy, 'options' | 'policy'>): PartsPolicyOption => optionOf(p, p.policy);

/** The row the screen opens on: the type with an aircraft down, else the first type without its critical kit, else the first. */
export function defaultType(v: Pick<WarehouseView, 'policies' | 'aog'>): string | null {
  const down = v.aog ? v.policies.find((p) => p.icao === v.aog!.icao) : undefined;
  return (down ?? v.policies.find((p) => !p.covered) ?? v.policies[0])?.icao ?? null;
}

/** The type "order the critical kit" is about: the one with the aircraft down, else the selected one; only while its policy asks for no stock. */
export function kitTarget(v: Pick<WarehouseView, 'policies' | 'aog'>, selected: string | null): TypePolicy | null {
  const down = v.aog ? v.policies.find((p) => p.icao === v.aog!.icao) : undefined;
  const picked = v.policies.find((p) => p.icao === selected);
  return [down, picked].find((p) => p !== undefined && p.policy === 'none') ?? null;
}

export type KitFacts = { capital: number; daysAvoided: number; saved: number };
/** What the critical kit of a type ties up, and what it buys back against holding nothing: ground days a year, and the revenue of those days. */
export function kitFacts(p: Pick<TypePolicy, 'options' | 'dayValue'>): KitFacts {
  const daysAvoided = Math.max(0, optionOf(p, 'none').groundDays - optionOf(p, 'critical').groundDays);
  return { capital: optionOf(p, 'critical').capital, daysAvoided, saved: Math.round(daysAvoided * p.dayValue) };
}

export type PolicyBars = { capital: number; ground: number };
/** Bar lengths 0..1 for each row: money against the biggest full kit, ground days against the worst "nothing in stock". */
export function policyBars(policies: readonly TypePolicy[]): Map<string, PolicyBars> {
  const maxCapital = Math.max(1, ...policies.map((p) => optionOf(p, 'full').capital));
  const maxDays = Math.max(1, ...policies.flatMap((p) => [optionOf(p, 'none').groundDays, p.expectedGroundDays]));
  return new Map(policies.map((p) => [p.icao, { capital: currentOption(p).capital / maxCapital, ground: Math.min(1, p.expectedGroundDays / maxDays) }]));
}

/** Registrations of the aircraft whose type's shelf lacks the critical kit. */
export const uncovered = (v: Pick<WarehouseView, 'policies'>): string[] => v.policies.filter((p) => !p.covered).flatMap((p) => p.aircraft.map((a) => a.registration));
export const partCount = (v: Pick<WarehouseView, 'inventory'>): number => v.inventory.reduce((n, l) => n + l.qty, 0);
/** The type that grounds the company for the most days a year. */
export function worstType(v: Pick<WarehouseView, 'policies'>): { name: string; days: number } | null {
  const worst = [...v.policies].sort((a, b) => b.expectedGroundDays - a.expectedGroundDays)[0];
  return worst ? { name: worst.name, days: worst.expectedGroundDays } : null;
}

export type StockGroup = { cls: PartClass; types: TypePolicy[]; lines: StockLine[]; subtotal: number };
/** The shelf by part class (one shelf serves every type of a class): the classes of the policy list first, in its order, then any class that holds stock without a type. A class with types and nothing on the shelf still has its group. */
export function stockGroups(v: Pick<WarehouseView, 'policies' | 'inventory'>): StockGroup[] {
  const classes = [...new Set([...v.policies.map((p) => p.cls), ...v.inventory.map((l) => l.cls)])];
  return classes.map((cls) => {
    const lines = v.inventory.filter((l) => l.cls === cls);
    return { cls, types: v.policies.filter((p) => p.cls === cls), lines, subtotal: lines.reduce((s, l) => s + l.value, 0) };
  });
}

export type AogTimeline = {
  /** Start of each day on the ruler (UTC midnight). */
  days: number[]; nowPct: number; etaPct: number;
  grounded: { from: number; to: number };
  planned: { from: number; to: number } | null;
  /** The track "with the part in stock". */
  fixed: { from: number; to: number };
  elapsedDays: number; plannedDays: number; lostDays: number; fixHours: number;
};
/** The two tracks of the AOG case, as shares (0..1) of a ruler of whole UTC days from the failure to the aircraft flying again (or to now, when that is late). */
export function aogTimeline(aog: Pick<AogCase, 'failedAt' | 'eta' | 'readyAt' | 'withPartBackAt' | 'lost' | 'dayValue'>, now: number): AogTimeline {
  const first = Math.floor(aog.failedAt / DAY_MS) * DAY_MS;
  const end = Math.max(aog.readyAt, aog.eta, now);
  const count = Math.max(2, Math.ceil((end - first) / DAY_MS));
  const span = count * DAY_MS;
  const pct = (ms: number): number => Math.min(1, Math.max(0, (ms - first) / span));
  return {
    days: Array.from({ length: count }, (_, i) => first + i * DAY_MS),
    nowPct: pct(now), etaPct: pct(aog.eta),
    grounded: { from: pct(aog.failedAt), to: pct(Math.min(now, aog.readyAt)) },
    planned: aog.readyAt > now ? { from: pct(now), to: pct(aog.readyAt) } : null,
    fixed: { from: pct(aog.failedAt), to: pct(aog.withPartBackAt) },
    elapsedDays: Math.max(0, Math.round((now - aog.failedAt) / DAY_MS)),
    plannedDays: Math.max(0, Math.round((aog.readyAt - now) / DAY_MS)),
    lostDays: aog.dayValue > 0 ? aog.lost / aog.dayValue : (aog.readyAt - aog.failedAt) / DAY_MS,
    fixHours: Math.max(1, Math.round((aog.withPartBackAt - aog.failedAt) / HOUR_MS)),
  };
}

// ---------------------------------------------------------------- wear screen

/** What to do with each component. A component the aircraft does not have is not in it. */
export type Choices = Partial<Record<Component, Choice>>;
/** A wear of this much or more is drawn amber: the component is near the point where it costs. */
export const WEAR_WARN = 75;
export const wearTone = (pct: number): 'warn' | 'ok' => (pct >= WEAR_WARN ? 'warn' : 'ok');

/** The player's choices from the server's selection; a component it does not name is left. */
export const choicesOf = (v: Pick<WearView, 'components' | 'selection'>): Choices =>
  Object.fromEntries(v.components.map((c) => [c.component, v.selection.find((s) => s.component === c.component)?.action ?? 'leave'])) as Choices;
export const leaveAll = (v: Pick<WearView, 'components'>): Choices => Object.fromEntries(v.components.map((c) => [c.component, 'leave' as const])) as Choices;
/** The choice one step to the left (toward "leave") or right (toward "replace"). */
export const stepChoice = (a: Choice, dir: 1 | -1): Choice => step(CHOICE_ORDER, a, dir);
/** `?pick=` for the selection: `gear:overhaul,avionics:leave`. */
export const pickOf = (c: Choices): string => Object.entries(c).map(([component, action]) => `${component}:${action}`).join(',');
export const itemsOf = (c: Choices): { component: Component; action: 'overhaul' | 'replace' }[] =>
  (Object.entries(c) as [Component, Choice][]).filter((e): e is [Component, 'overhaul' | 'replace'] => e[1] !== 'leave').map(([component, action]) => ({ component, action }));

export type EffectLines = { main: { kind: 'performance' | 'reliability' | 'satisfaction'; value: number } | null; fuelPct: number; loadPct: number };
/** What a worn component costs, in the words of the screen: the main loss, then its side effects (more fuel for lost speed, fewer passengers). Percentages are whole numbers. */
export function effectLines(e: Effects): EffectLines {
  const main = e.performance > 0.0005 ? { kind: 'performance' as const, value: Math.round(e.performance * 100) }
    : e.reliability > 0.05 ? { kind: 'reliability' as const, value: Math.round(e.reliability) }
    : e.satisfaction > 0.05 ? { kind: 'satisfaction' as const, value: Math.round(e.satisfaction * 10) / 10 } : null;
  const fuelPct = e.performance > 0.0005 ? Math.round((1 / (1 - Math.min(0.5, e.performance)) - 1) * 100) : 0;
  const loadPct = e.load > 0.0005 ? Math.round(e.load * 100) : 0;
  return { main: main && main.value > 0 ? main : null, fuelPct, loadPct };
}

export type Scenarios = { give: number; buy: number; gross: number; kept: number };
/** What the works earn before the aircraft goes back (`gross`: the net plus what they cost), and the value of the new parts the lessor keeps if the aircraft is handed back (`kept`). */
export const scenariosOf = (t: Pick<WearView['totals'], 'cost' | 'give' | 'buy'>): Scenarios => ({ give: t.give, buy: t.buy, gross: t.give + t.cost, kept: t.buy - t.give });

export type ChartBar = { up: number; down: number };
/** Bar heights 0..1 above and below the zero line, each side scaled to its own extreme. */
export function chartBars(curve: readonly number[]): ChartBar[] {
  const top = Math.max(0, ...curve), bottom = Math.max(0, ...curve.map((x) => -x));
  return curve.map((x) => ({ up: top > 0 && x > 0 ? x / top : 0, down: bottom > 0 && x < 0 ? -x / bottom : 0 }));
}

/** When the works under way end, if they do. */
export const worksUntil = (components: readonly Pick<ComponentWear, 'worksUntil'>[], now: number): number | null => {
  const ends = components.map((c) => c.worksUntil ?? 0).filter((t) => t > now);
  return ends.length === 0 ? null : Math.max(...ends);
};
