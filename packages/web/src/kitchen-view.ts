import type { CatererQuote, KitchenProvider, KitchenQualityRow, KitchenView, MealQuality } from './api-service.ts';
import { MEAL_QUALITIES, type Tone } from './service-view.ts';

/** Pure rules of the kitchen screen (B.7): the tier comparison and its bars, what is chosen but not applied, what the hall and the caterer allow. The DOM is in screens/kitchen.ts. */

/** The rows of the comparison, in the mockup's order. */
export const METRICS = [
  { id: 'prep', of: (x: KitchenQualityRow) => x.prepMin },
  { id: 'team', of: (x: KitchenQualityRow) => x.team },
  { id: 'output', of: (x: KitchenQualityRow) => x.maxOutput },
  { id: 'cost', of: (x: KitchenQualityRow) => x.cost },
  { id: 'margin', of: (x: KitchenQualityRow) => x.margin },
  { id: 'sat', of: (x: KitchenQualityRow) => x.rating },
] as const;
export type MetricId = (typeof METRICS)[number]['id'];

/** `recruit`: more cooks than employed (`n` to recruit). `demand`: it cannot make the day's meals (`n` is the demand). */
export type Problem = { kind: 'recruit'; n: number } | { kind: 'demand'; n: number };
export type Cell = {
  metric: MetricId; quality: MealQuality; value: number;
  /** The width of the bar as a fraction: the value against the largest of the three levels (the mockup draws 4, 6 and 9 cooks as 80, 120 and 180 px of 180). */
  bar: number;
  /** Against the current level, shown on the other two; null on the current one and when equal. */
  delta: number | null;
  problem: Problem | null;
};

/** The comparison as a table of cells, one row per metric and one cell per level (in ladder order, whatever order the server sent). `employed` is the cooks at this base (null: a caterer serves, so no team to recruit), `demand` the meals the day asks. */
export function tierTable(qualities: readonly KitchenQualityRow[], current: MealQuality, ctx: { employed: number | null; demand: number }): Cell[][] {
  const ordered = MEAL_QUALITIES.map((q) => qualities.find((x) => x.quality === q)).filter((x): x is KitchenQualityRow => x !== undefined);
  const now = ordered.find((x) => x.quality === current) ?? null;
  return METRICS.map((m) => {
    const max = Math.max(...ordered.map((x) => m.of(x)), 0);
    return ordered.map((x): Cell => {
      const value = m.of(x);
      const diff = now === null || x.quality === current ? 0 : value - m.of(now);
      const problem: Problem | null =
        m.id === 'team' && ctx.employed !== null && x.team > ctx.employed ? { kind: 'recruit', n: x.team - ctx.employed }
        : m.id === 'output' && !x.fitsDemand ? { kind: 'demand', n: ctx.demand }
        : null;
      return { metric: m.id, quality: x.quality, value, bar: max > 0 ? value / max : 0, delta: Math.abs(diff) < 1e-9 ? null : diff, problem };
    });
  });
}

/** What the player has chosen on the screen and not applied yet. */
export type Pending = { hub: string; quality: MealQuality | null; provider: KitchenProvider | null };
export const noPending = (hub: string): Pending => ({ hub, quality: null, provider: null });

type Setting = Pick<KitchenView, 'quality' | 'provider' | 'nextProvider' | 'qualities'>;
/** What the kitchen is set to for tomorrow: a change made earlier and not in force yet wins over what runs today. */
export const configured = (k: Pick<KitchenView, 'quality' | 'provider' | 'nextProvider'>): { quality: MealQuality; provider: KitchenProvider } => ({ quality: k.quality.next ?? k.quality.current, provider: k.nextProvider ?? k.provider });

/** The levels a provider can make: all of them in her own kitchen, the ones a caterer can make otherwise (it has no chef's menu). */
export const servedBy = (provider: KitchenProvider, qualities: readonly Pick<KitchenQualityRow, 'quality' | 'catererAvailable'>[]): MealQuality[] =>
  MEAL_QUALITIES.filter((q) => qualities.some((x) => x.quality === q && (provider === 'own' || x.catererAvailable)));

export type Selection = { quality: MealQuality; provider: KitchenProvider };
/** The choice on show: what is chosen, else what is set. A quality the chosen provider cannot make is shown as the nearest one it can (a caterer has no chef's menu); the company's own setting is not touched by that. */
export function selection(k: Setting, p: Pick<Pending, 'quality' | 'provider'>): Selection {
  const set = configured(k);
  const provider = p.provider ?? set.provider;
  const wanted = p.quality ?? set.quality;
  const served = servedBy(provider, k.qualities);
  if (served.length === 0 || served.includes(wanted)) return { quality: wanted, provider };
  const rank = (q: MealQuality): number => MEAL_QUALITIES.indexOf(q);
  const nearest = [...served].sort((a, b) => Math.abs(rank(a) - rank(wanted)) - Math.abs(rank(b) - rank(wanted)) || rank(a) - rank(b))[0]!;
  return { quality: nearest, provider };
}

/** The level `dir` steps from the selection among those the chosen provider makes; stays put at the ends (the quality is a ladder, not a loop). */
export function stepQuality(k: Setting, p: Pending, dir: 1 | -1): MealQuality {
  const sel = selection(k, p);
  const served = servedBy(sel.provider, k.qualities);
  const i = served.indexOf(sel.quality);
  return served[Math.min(served.length - 1, Math.max(0, i + dir))] ?? sel.quality;
}

/** The body of `PUT /kitchen/:hub`: only what the player picked and that differs from what is set; null when nothing does. Nothing picked sends nothing, so a company whose chef's-menu setting a caterer cannot honour is not downgraded by looking at this screen. */
export function changeOf(k: Pick<KitchenView, 'quality' | 'provider' | 'nextProvider'>, p: Pending): { quality?: MealQuality; provider?: KitchenProvider } | null {
  const set = configured(k);
  const body: { quality?: MealQuality; provider?: KitchenProvider } = {};
  if (p.quality !== null && p.quality !== set.quality) body.quality = p.quality;
  if (p.provider !== null && p.provider !== set.provider) body.provider = p.provider;
  return Object.keys(body).length === 0 ? null : body;
}

/** Her own kitchen needs the kitchen hall of the airport: held, to rent, or none at this airport (a caterer serves it). */
export const hallState = (k: Pick<KitchenView, 'hall'>): 'held' | 'rentable' | 'none' => (k.hall === null ? 'none' : k.hall.held ? 'held' : 'rentable');

/** What a caterer would make and charge for a meal when the wanted level is `q`: the nearest level it can make (never the chef's menu), at its unit price, and the margin on that level's menu price (`1 - cost / price`, the caterer's price standing for the cost). */
export function catererOffer(k: Pick<KitchenView, 'caterer' | 'qualities'>, q: MealQuality): { quality: MealQuality; perMeal: number; margin: number } {
  const quality: MealQuality = q === 'gastronomique' ? 'soigne' : q;
  const perMeal = quality === 'economy' ? k.caterer.economy : k.caterer.soigne;
  const price = k.qualities.find((x) => x.quality === quality)?.price ?? 0;
  return { quality, perMeal, margin: price > 0 ? 1 - perMeal / price : 0 };
}

/** What a hot meal costs the company, sells for and leaves as margin with a provider at a level: the own kitchen's row, or the caterer's unit price against the same menu price. */
export function mealEconomics(k: Pick<KitchenView, 'caterer' | 'qualities'>, provider: KitchenProvider, q: MealQuality): { quality: MealQuality; cost: number; price: number; margin: number } {
  if (provider === 'caterer') { const c = catererOffer(k, q); return { quality: c.quality, cost: c.perMeal, price: k.qualities.find((x) => x.quality === c.quality)?.price ?? 0, margin: c.margin }; }
  const row = k.qualities.find((x) => x.quality === q);
  return { quality: q, cost: row?.cost ?? 0, price: row?.price ?? 0, margin: row?.margin ?? 0 };
}

/** The quote on show is the one asked for this base and the level now selected. */
export const quoteFor = (q: { hub: string; quote: CatererQuote } | null, hub: string, quality: MealQuality): CatererQuote | null => (q && q.hub === hub && q.quote.quality === quality ? q.quote : null);

export type Headline = { kind: 'unserved'; n: number; tone: Tone } | { kind: 'short'; demand: number; capacity: number; tone: Tone } | { kind: 'idle' | 'ok'; tone: Tone };
/** The status line under the breadcrumb: meals left unmade today first, then a day the kitchen cannot make, then a day with no meal at all, else on schedule. */
export function headline(k: Pick<KitchenView, 'day'>): Headline {
  const { demand, capacity, unserved } = k.day;
  if (unserved > 0) return { kind: 'unserved', n: unserved, tone: 'warn' };
  if (capacity !== null && demand > capacity) return { kind: 'short', demand, capacity, tone: 'warn' };
  return demand === 0 ? { kind: 'idle', tone: 'ok' } : { kind: 'ok', tone: 'ok' };
}

/** Cooks employed at the base and away today (leave): the absence that cuts the capacity of the day. */
export const absentCooks = (k: Pick<KitchenView, 'cooks'>): number => Math.max(0, k.cooks.employed - k.cooks.onDuty);
