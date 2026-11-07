import type { CatererOption, KitchenDeparture, KitchenProvider, KitchenView, MealQuality, MealTier } from './api-service.ts';
import { MEAL_QUALITIES, type Tone } from './service-view.ts';

/** Pure rules of the kitchen screen (B.7): the tier comparison and its bars, what is pending, what a late departure says. The DOM is in screens/kitchen.ts. */

/** The rows of the comparison, in the mockup's order. `better` says which way is good (less prep time, fewer cooks and a lower cost are good; the rest more). */
export const METRICS = [
  { id: 'prep', of: (x: MealTier) => x.prepMinutes, better: 'lower' },
  { id: 'team', of: (x: MealTier) => x.team, better: 'lower' },
  { id: 'output', of: (x: MealTier) => x.maxOutput, better: 'higher' },
  { id: 'cost', of: (x: MealTier) => x.cost, better: 'lower' },
  { id: 'margin', of: (x: MealTier) => x.margin, better: 'higher' },
  { id: 'sat', of: (x: MealTier) => x.satisfaction, better: 'higher' },
] as const;
export type MetricId = (typeof METRICS)[number]['id'];

export type Cell = {
  metric: MetricId; quality: MealQuality; value: number;
  /** The width of the bar as a fraction: the value against the largest of the three levels (the mockup draws 4, 6 and 9 cooks as 80, 120 and 180 px of 180). */
  bar: number;
  /** Against the current level, shown on the other two; null on the current one and when equal. */
  delta: number | null;
  /** A problem the level has for this company, in words (see `Problem`); null when none. */
  problem: Problem | null;
};
/** `recruit`: more cooks than employed (`n` to recruit). `demand`: it cannot make the day's meals (`n` is the demand). */
export type Problem = { kind: 'recruit'; n: number } | { kind: 'demand'; n: number };

/** The comparison as a table of cells, one row per metric and one cell per level (in the order of `MEAL_QUALITIES`, whatever order the server sent). */
export function tierTable(tiers: readonly MealTier[], current: MealQuality, kitchen: Pick<KitchenView, 'cooks' | 'demand'>): Cell[][] {
  const ordered = MEAL_QUALITIES.map((q) => tiers.find((x) => x.quality === q)).filter((x): x is MealTier => x !== undefined);
  const now = ordered.find((x) => x.quality === current) ?? null;
  const demand = kitchen.demand.snacks + kitchen.demand.hot;
  return METRICS.map((m) => {
    const max = Math.max(...ordered.map((x) => m.of(x)), 0);
    return ordered.map((x): Cell => {
      const value = m.of(x);
      const diff = now === null || x.quality === current ? 0 : value - m.of(now);
      const problem: Problem | null =
        m.id === 'team' && x.team > kitchen.cooks.headcount ? { kind: 'recruit', n: x.team - kitchen.cooks.headcount }
        : m.id === 'output' && x.maxOutput < demand ? { kind: 'demand', n: demand }
        : null;
      return { metric: m.id, quality: x.quality, value, bar: max > 0 ? value / max : 0, delta: Math.abs(diff) < 1e-9 ? null : diff, problem };
    });
  });
}

/** What the player has set but not applied yet. */
export type Pending = { hub: string; quality: MealQuality | null; provider: KitchenProvider | null };
export const noPending = (hub: string): Pending => ({ hub, quality: null, provider: null });

/** The levels a provider can serve: all three in her own kitchen; the caterer's list when it is known, else none of them is promised. */
export const servedBy = (provider: KitchenProvider, caterer: Pick<CatererOption, 'qualities'> | null): readonly MealQuality[] => (provider === 'own' ? MEAL_QUALITIES : caterer?.qualities ?? []);

/** What the choice functions read: the current provider and quality, and the caterer's offer once quoted (the screen merges the quote it asked for into `caterer`). */
type Offer = Pick<KitchenView, 'quality' | 'provider' | 'caterer'>;
export type Selection = { quality: MealQuality; provider: KitchenProvider };
/** The choice on show: what is pending, else what is current; a quality the chosen provider cannot serve falls to the nearest one it can. */
export function selection(k: Offer, p: Pick<Pending, 'quality' | 'provider'>): Selection {
  const provider = p.provider ?? k.provider;
  const wanted = p.quality ?? k.quality;
  const served = servedBy(provider, k.caterer);
  if (served.length === 0 || served.includes(wanted)) return { quality: wanted, provider };
  const rank = (q: MealQuality): number => MEAL_QUALITIES.indexOf(q);
  const nearest = [...served].sort((a, b) => Math.abs(rank(a) - rank(wanted)) - Math.abs(rank(b) - rank(wanted)) || rank(a) - rank(b))[0]!;
  return { quality: nearest, provider };
}

/** The level `dir` steps from the selection among those the chosen provider serves; stays put at the ends (the quality is a ladder, not a loop). */
export function stepQuality(k: Offer, p: Pending, dir: 1 | -1): MealQuality {
  const sel = selection(k, p);
  const served = servedBy(sel.provider, k.caterer);
  const i = served.indexOf(sel.quality);
  return served[Math.min(served.length - 1, Math.max(0, i + dir))] ?? sel.quality;
}

/** The body of `PUT /kitchen/:hub`: only what differs from what is current; null when nothing does. */
export function changeOf(k: Offer, p: Pending): { quality?: MealQuality; provider?: KitchenProvider } | null {
  const sel = selection(k, p);
  const body: { quality?: MealQuality; provider?: KitchenProvider } = {};
  if (sel.quality !== k.quality) body.quality = sel.quality;
  if (sel.provider !== k.provider) body.provider = sel.provider;
  return Object.keys(body).length === 0 ? null : body;
}

/** A caterer that is not quoted cannot be picked: its cost and margin are not known. */
export const canPickCaterer = (k: Pick<Offer, 'caterer'>): boolean => k.caterer !== null && k.caterer.qualities.length > 0;

/** The tonight list: the order the server sent is the departure order; a departure is late when its meals are behind plan. */
export const isLate = (d: Pick<KitchenDeparture, 'lateMin'>): boolean => d.lateMin > 0;

export type Headline = { kind: 'late'; departure: KitchenDeparture; tone: Tone } | { kind: 'short'; demand: number; capacity: number; tone: Tone } | { kind: 'ok'; tone: Tone };
/** The status line under the breadcrumb: the latest-running meal first, then a day the kitchen cannot make, else on schedule. */
export function headline(k: Pick<KitchenView, 'departures' | 'demand' | 'capacity' | 'capacityNow'>): Headline {
  const late = [...k.departures].filter(isLate).sort((a, b) => b.lateMin - a.lateMin)[0];
  if (late) return { kind: 'late', departure: late, tone: 'warn' };
  const demand = k.demand.snacks + k.demand.hot;
  const cap = k.capacityNow ?? k.capacity;
  if (cap !== null && demand > cap) return { kind: 'short', demand, capacity: cap, tone: 'warn' };
  return { kind: 'ok', tone: 'ok' };
}

/** Cooks missing on duty against the people employed: the absence the capacity note explains. */
export const absentCooks = (k: Pick<KitchenView, 'cooks'>): number => Math.max(0, k.cooks.headcount - k.cooks.onDuty);

/** Whether the capacity of the day is cut by absences (shown in warning colour). */
export const capacityCut = (k: Pick<KitchenView, 'capacity' | 'capacityNow'>): boolean => k.capacity !== null && k.capacityNow !== null && k.capacityNow < k.capacity;

/** The levels the caterer does not serve (the mockup: "pas de Gastronomique"). */
export const missingAt = (c: Pick<CatererOption, 'qualities'>): MealQuality[] => MEAL_QUALITIES.filter((q) => !c.qualities.includes(q));
