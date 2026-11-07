import type { HaulClass, HaulView, MealQuality, PolicyCell, QualityCard, ServiceItem, ServiceMode, ServicePreview } from './api-service.ts';

/** Pure rules of the on-board service screen (B.7): what a press does, how a haul class reads, what the quality panel compares. The DOM is in screens/service.ts. */

export type Tone = 'ok' | 'warn' | 'bad' | 'plain';

/** The haul classes in column order and the meal levels in ladder order (cheapest first). */
export const HAULS: readonly HaulClass[] = ['short', 'medium', 'long'];
export const MEAL_QUALITIES: readonly MealQuality[] = ['economy', 'soigne', 'gastronomique'];

/** The rows of the matrix in the order the mockup lists them, under its three headings. */
export const GROUPS = [
  { id: 'food', items: ['drinks', 'snack', 'hot_meal', 'alcohol'] },
  { id: 'info', items: ['films', 'wifi'] },
  { id: 'comfort', items: ['comfort', 'duty_free'] },
] as const satisfies readonly { id: string; items: readonly ServiceItem[] }[];

const STEPS: readonly ServiceMode[] = ['none', 'paid', 'free'];

/** What Enter does to a cell: not offered -> paid -> free -> not offered, skipping what the item cannot be (a duty-free basket is never given: not offered <-> paid). It starts from what is decided for tomorrow (`next`) when something is pending, so a second press goes on from the first. Null when nothing can change: the aircraft cannot carry the item, or it has one way only. */
export function nextMode(cell: Pick<PolicyCell, 'mode' | 'next' | 'unavailable'> & { allowed: readonly ServiceMode[] }): ServiceMode | null {
  if (cell.unavailable) return null;
  const ring = STEPS.filter((m) => cell.allowed.includes(m));
  if (ring.length < 2) return null;
  return ring[(ring.indexOf(cell.next ?? cell.mode) + 1) % ring.length]!;
}

export type Comfort = { steps: 1 | 2 | 3 | 4 | 5; level: 'basic' | 'comfort' | 'premium' };
/** The comfort bar of a column is the class's own satisfaction (1 to 5) rounded to five steps; the word follows the steps. There is no separate comfort setting in the model: the offer is the policy table. */
export function comfortOf(satisfaction: number): Comfort {
  const steps = Math.min(5, Math.max(1, Math.round(satisfaction))) as Comfort['steps'];
  return { steps, level: steps <= 2 ? 'basic' : steps <= 4 ? 'comfort' : 'premium' };
}

/** A class no line flies is shown as not operated (dimmed), but its policy can still be set for when it is. */
export const operated = (h: Pick<HaulView, 'operated'>): boolean => h.operated.length > 0;

/** The column the cursor starts on: the first class a line flies, the short one while nothing flies. */
export const defaultHaul = (hauls: readonly Pick<HaulView, 'haul' | 'operated'>[]): HaulClass => hauls.find(operated)?.haul ?? 'short';

/** What the cell of an item says besides its state: the price of a paid item (per flight for Wi-Fi), the meal level of a served hot meal, which duty-free catalogue, what is decided for tomorrow. Null parts are not shown. */
export type CellFacts = { state: ServiceMode | 'unavailable'; price: number | null; perFlight: boolean; quality: MealQuality | null; catalogue: 'reduced' | 'full' | null; next: ServiceMode | null };
export function cellFacts(item: ServiceItem, haul: HaulClass, cell: PolicyCell, quality: MealQuality): CellFacts {
  const state = cell.unavailable ? 'unavailable' : cell.mode;
  const served = state === 'free' || state === 'paid';
  return {
    state,
    price: state === 'paid' && item !== 'duty_free' && cell.price > 0 ? cell.price : null,
    perFlight: item === 'wifi',
    quality: item === 'hot_meal' && served ? quality : null,
    catalogue: item === 'duty_free' && state === 'paid' ? (haul === 'long' ? 'full' : 'reduced') : null,
    next: !cell.unavailable && cell.next !== null && cell.next !== cell.mode ? cell.next : null,
  };
}

export const cellOf = (hauls: readonly HaulView[], haul: HaulClass, item: ServiceItem): PolicyCell | null => hauls.find((h) => h.haul === haul)?.cells.find((c) => c.item === item) ?? null;

/** The level the trade-off panel compares against by default: the next one up, or the one below when already at the top. */
export function candidateOf(qualities: readonly Pick<QualityCard, 'quality'>[], current: MealQuality): MealQuality | null {
  const i = qualities.findIndex((x) => x.quality === current);
  if (i === -1) return qualities[0]?.quality ?? null;
  return (qualities[i + 1] ?? qualities[i - 1])?.quality ?? null;
}

export type Effect = { label: 'sat' | 'margin' | 'meals' | 'cooks'; tone: Tone; value: { kind: 'delta'; n: number; unit: 'sat' | 'pts' } | { kind: 'move'; from: number; to: number } };
const toneOf = (n: number): Tone => (n > 0 ? 'ok' : n < 0 ? 'bad' : 'plain');
/** The four effects of switching quality, in the mockup's order. Satisfaction and margin are good or bad by their sign, a drop in meals made a day is a warning. Satisfaction is left out while no cabin flies (the server has no figure then). */
export function effectsOf(p: ServicePreview): Effect[] {
  const sat = p.satisfaction.from !== null && p.satisfaction.to !== null ? Math.round((p.satisfaction.to - p.satisfaction.from) * 100) / 100 : null;
  const pts = Math.round((p.mealMargin.to - p.mealMargin.from) * 100);
  return [
    ...(sat === null ? [] : [{ label: 'sat', tone: toneOf(sat), value: { kind: 'delta', n: sat, unit: 'sat' } } as const]),
    { label: 'margin', tone: toneOf(pts), value: { kind: 'delta', n: pts, unit: 'pts' } },
    { label: 'meals', tone: p.meals.to < p.meals.from ? 'warn' : 'plain', value: { kind: 'move', from: p.meals.from, to: p.meals.to } },
    { label: 'cooks', tone: 'plain', value: { kind: 'move', from: p.cooks.from, to: p.cooks.to } },
  ];
}
