import type { CatererOption, KitchenView, MealTier, QualityPreview, ServiceView } from './api-service.ts';

/** The mockup's Nice, as S6's routes are asked to answer it (B.7). Used by the view-model tests and to look at the screens before S6 is merged; never shipped to the UI. */

export const TIERS: MealTier[] = [
  { quality: 'economy', price: 9, cost: 3.1, margin: 1 - 3.1 / 9, satisfaction: 3.6, prepMinutes: 4, team: 4, maxOutput: 980 },
  { quality: 'soigne', price: 14, cost: 6.4, margin: 1 - 6.4 / 14, satisfaction: 4.2, prepMinutes: 9, team: 6, maxOutput: 620 },
  { quality: 'gastronomique', price: 23, cost: 14.8, margin: 1 - 14.8 / 23, satisfaction: 4.7, prepMinutes: 18, team: 9, maxOutput: 310 },
];

const cells = (o: Partial<ServiceView['hauls'][number]['cells']> = {}): ServiceView['hauls'][number]['cells'] => ({
  drinks: { mode: 'free', price: null }, snack: { mode: 'free', price: null }, hotMeal: { mode: 'none', price: null }, alcohol: { mode: 'none', price: null },
  films: { mode: 'free', price: null }, wifi: { mode: 'unavailable', price: null }, comfort: { mode: 'none', price: null }, dutyFree: { mode: 'none', price: null }, ...o,
});

export const SERVICE: ServiceView = {
  satisfaction: 4.2, satisfactionTrend: 0.3, salesPerDay: 1_920, costPerDay: 6_480, lines: 4, flightsPerDay: 38,
  hauls: [
    { haul: 'short', flightsPerDay: 24, aircraft: ['ATR 72-600'], satisfaction: 2.4, cells: cells({ snack: { mode: 'paid', price: 4 }, films: { mode: 'unavailable', price: null } }) },
    { haul: 'medium', flightsPerDay: 14, aircraft: ['A220-300'], satisfaction: 3.9, cells: cells({ hotMeal: { mode: 'paid', price: 14 }, alcohol: { mode: 'paid', price: 7 }, wifi: { mode: 'paid', price: 8 }, comfort: { mode: 'paid', price: 6 }, dutyFree: { mode: 'paid', price: null } }) },
    { haul: 'long', flightsPerDay: 0, aircraft: [], satisfaction: 4.8, cells: cells({ hotMeal: { mode: 'free', price: null }, alcohol: { mode: 'free', price: null }, wifi: { mode: 'paid', price: 15 }, comfort: { mode: 'free', price: null }, dutyFree: { mode: 'paid', price: null } }) },
  ],
  mealQuality: 'soigne', tiers: TIERS,
};

/** Soigné -> gastronomique on the tiers above: satisfaction 4.2 -> 4.7, margin 54 % -> 36 % (C14), 620 -> 310 meals a day, 6 -> 9 cooks. */
export const PREVIEW_GASTRO: QualityPreview = { quality: 'gastronomique', satisfaction: 0.5, marginPts: -18, mealsPerDay: { from: 620, to: 310 }, cooks: { from: 6, to: 9 } };

export const CATERER: CatererOption = { name: 'Riviera Traiteur Aviation', costPerMeal: 8.1, margin: 1 - 8.1 / 14, qualities: ['economy', 'soigne'] };

const NOON = Date.UTC(2026, 10, 6, 0, 0, 0);
const at = (h: number, m: number): number => NOON + (h * 60 + m) * 60_000;

export const KITCHEN: KitchenView = {
  hub: 'LFMN', provider: 'own', quality: 'soigne', day: '2026-11-06',
  demand: { snacks: 312, hot: 236 }, capacity: 620, capacityNow: 515, margin: 0.54, marginDay: 2_300,
  cooks: { onDuty: 5, headcount: 6, needed: 6 }, tiers: TIERS, caterer: CATERER,
  departures: [
    { flightNo: 'AZR 1641', dep: at(18, 10), origin: 'LFMN', dest: 'LFKJ', aircraft: 'ATR 72-600', kind: 'snack', meals: 68, status: 'loaded', lateMin: 0, readyAt: at(17, 20) },
    { flightNo: 'AZR 1137', dep: at(18, 46), origin: 'LFMN', dest: 'LFLL', aircraft: 'ATR 72-600', kind: 'snack', meals: 70, status: 'ready', lateMin: 0, readyAt: at(18, 5) },
    { flightNo: 'AZR 4131', dep: at(19, 40), origin: 'LFMN', dest: 'LFPG', aircraft: 'A220-300', kind: 'hot', meals: 136, status: 'ready', lateMin: 12, readyAt: at(19, 22) },
    { flightNo: 'AZR 4135', dep: at(21, 5), origin: 'LFMN', dest: 'LFPG', aircraft: 'A220-300', kind: 'hot', meals: 100, status: 'preparing', lateMin: 0, readyAt: null },
  ],
};
