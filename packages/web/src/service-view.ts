import { crewNeeded } from '@opc/shared';
import type { AircraftType } from '@opc/shared';
import type { HaulClass, HaulView, MealQuality, MealTier, QualityPreview, ServiceCell, ServiceItem, ServiceMode, SettableMode } from './api-service.ts';

/** Pure rules of the on-board service screen (B.7): what a press does, how a haul class reads, what the quality panel compares. The DOM is in screens/service.ts. */

export type Tone = 'ok' | 'warn' | 'bad' | 'plain';

/** The haul classes in column order and the meal levels in ladder order (cheapest first). */
export const HAULS: readonly HaulClass[] = ['short', 'medium', 'long'];
export const MEAL_QUALITIES: readonly MealQuality[] = ['economy', 'soigne', 'gastronomique'];

/** The rows of the matrix in the order the mockup lists them, under its three headings. */
export const GROUPS = [
  { id: 'food', items: ['drinks', 'snack', 'hotMeal', 'alcohol'] },
  { id: 'info', items: ['films', 'wifi'] },
  { id: 'comfort', items: ['comfort', 'dutyFree'] },
] as const satisfies readonly { id: string; items: readonly ServiceItem[] }[];

/** What Enter does to a cell: not offered -> paid -> free -> not offered. An item the aircraft cannot carry cannot be set (null). */
export function nextMode(mode: ServiceMode): SettableMode | null {
  switch (mode) {
    case 'none': return 'paid';
    case 'paid': return 'free';
    case 'free': return 'none';
    case 'unavailable': return null;
  }
}

export type Comfort = { steps: 1 | 2 | 3 | 4 | 5; level: 'basic' | 'comfort' | 'premium' };
/** The comfort bar of a column is the class's own satisfaction (0..5) rounded to five steps; the word follows the steps. There is no separate comfort setting in the model: the offer is the policy table. */
export function comfortOf(satisfaction: number): Comfort {
  const steps = Math.min(5, Math.max(1, Math.round(satisfaction))) as Comfort['steps'];
  return { steps, level: steps <= 2 ? 'basic' : steps <= 4 ? 'comfort' : 'premium' };
}

/** A class with no flight is shown as not operated (dimmed), but its policy can still be set for when it is. */
export const operated = (h: Pick<HaulView, 'flightsPerDay'>): boolean => h.flightsPerDay > 0;

/** The column the cursor starts on: the class with most flights (the first on a tie), the short one while nothing flies. */
export function defaultHaul(hauls: readonly Pick<HaulView, 'haul' | 'flightsPerDay'>[]): HaulClass {
  let best: Pick<HaulView, 'haul' | 'flightsPerDay'> | null = null;
  for (const h of hauls) if (h.flightsPerDay > 0 && (best === null || h.flightsPerDay > best.flightsPerDay)) best = h;
  return best?.haul ?? 'short';
}

/** What the cell of an item says besides its mode: the price of a paid item (per flight for Wi-Fi), the meal level of a served hot meal. Null parts are not shown. */
export type CellFacts = { mode: ServiceMode; price: number | null; perFlight: boolean; quality: MealQuality | null };
export function cellFacts(item: ServiceItem, cell: ServiceCell, quality: MealQuality): CellFacts {
  const served = cell.mode === 'free' || cell.mode === 'paid';
  return {
    mode: cell.mode,
    price: cell.mode === 'paid' && cell.price !== null && cell.price > 0 ? cell.price : null,
    perFlight: item === 'wifi',
    quality: item === 'hotMeal' && served ? quality : null,
  };
}

export const cellOf = (hauls: readonly HaulView[], haul: HaulClass, item: ServiceItem): ServiceCell | null => hauls.find((h) => h.haul === haul)?.cells[item] ?? null;

/** The level the trade-off panel compares against by default: the next one up, or the one below when already at the top. */
export function candidateOf(tiers: readonly Pick<MealTier, 'quality'>[], current: MealQuality): MealQuality | null {
  const i = tiers.findIndex((x) => x.quality === current);
  if (i === -1) return tiers[0]?.quality ?? null;
  return (tiers[i + 1] ?? tiers[i - 1])?.quality ?? null;
}

export type Effect = { label: 'sat' | 'margin' | 'meals' | 'cooks'; tone: Tone; value: { kind: 'delta'; n: number; unit: 'sat' | 'pts' } | { kind: 'move'; from: number; to: number } };
/** The four effects of switching quality, in the mockup's order. Satisfaction and margin are good or bad by their sign, a drop in meals a day is a warning. */
export function effectsOf(p: QualityPreview): Effect[] {
  const sign = (n: number): Tone => (n > 0 ? 'ok' : n < 0 ? 'bad' : 'plain');
  return [
    { label: 'sat', tone: sign(p.satisfaction), value: { kind: 'delta', n: p.satisfaction, unit: 'sat' } },
    { label: 'margin', tone: sign(p.marginPts), value: { kind: 'delta', n: p.marginPts, unit: 'pts' } },
    { label: 'meals', tone: p.mealsPerDay.to < p.mealsPerDay.from ? 'warn' : 'plain', value: { kind: 'move', from: p.mealsPerDay.from, to: p.mealsPerDay.to } },
    { label: 'cooks', tone: 'plain', value: { kind: 'move', from: p.cooks.from, to: p.cooks.to } },
  ];
}

/** Cabin crew a flight needs, per aircraft type of the fleet with a cabin (the rule the line engine checks: `crewNeeded`), the biggest first. */
export function cabinRows(fleet: readonly { type: Pick<AircraftType, 'icao' | 'name' | 'seats'> }[]): { icao: string; name: string; crew: number }[] {
  const seen = new Map<string, { icao: string; name: string; seats: number }>();
  for (const a of fleet) if (!seen.has(a.type.icao)) seen.set(a.type.icao, { icao: a.type.icao, name: a.type.name, seats: a.type.seats });
  return [...seen.values()]
    .map((x) => ({ icao: x.icao, name: x.name, crew: crewNeeded(x.seats).cabin, seats: x.seats }))
    .filter((x) => x.crew > 0)
    .sort((a, b) => a.seats - b.seats || a.icao.localeCompare(b.icao))
    .map(({ icao, name, crew }) => ({ icao, name, crew }));
}
