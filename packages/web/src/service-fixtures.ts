import type { CatererQuote, HaulView, KitchenQualityRow, KitchenView, PolicyCell, QualityCard, ServiceItem, ServicePreview, ServiceView } from './api-service.ts';

/** The mockup's Nice, in the shapes S6's routes answer (B.7, `shared/src/service.ts`). Used by the view-model tests and to look at the screens before S6 is merged; never shipped to the UI.
 *  The qualities carry S6's numbers (cost and margin from price and cost, C14), not the mockup's two disagreeing sets. */

const card = (quality: QualityCard['quality'], price: number, cost: number, rating: number, prepMin: number, team: number, maxOutput: number, ingredients: number): QualityCard =>
  ({ quality, price, ingredients, cost, margin: Math.round((1 - cost / price) * 100) / 100, rating, prepMin, team, maxOutput, catererAvailable: quality !== 'gastronomique' });
export const QUALITIES: QualityCard[] = [
  card('economy', 9, 3.1, 3.6, 4, 4, 980, 2.7),
  card('soigne', 14, 6.4, 4.2, 9, 6, 620, 5.46),
  card('gastronomique', 23, 14.8, 4.7, 18, 9, 310, 11.96),
];
const kitchenRows = (demand: number): KitchenQualityRow[] => QUALITIES.map((q) => ({ ...q, cooksForDemand: Math.ceil((demand * q.team) / q.maxOutput), fitsDemand: q.maxOutput >= demand }));

const cell = (item: ServiceItem, mode: PolicyCell['mode'], price: number, o: Partial<PolicyCell> = {}): PolicyCell =>
  ({ item, mode, next: null, unavailable: false, allowed: item === 'duty_free' ? ['none', 'paid'] : ['none', 'free', 'paid'], price, ...o });
const cells = (m: Record<ServiceItem, PolicyCell['mode']>, price: Record<HaulView['haul'], number>, wifi: number, no: ServiceItem[] = []): PolicyCell[] =>
  (['drinks', 'snack', 'hot_meal', 'alcohol', 'films', 'wifi', 'comfort', 'duty_free'] as const).map((i) => cell(i, m[i], i === 'wifi' ? wifi : i === 'hot_meal' ? 14 : ({ drinks: 2.5, snack: 4, alcohol: 7, films: 5, comfort: 6, duty_free: price.short } as Record<string, number>)[i] ?? 0, { unavailable: no.includes(i) }));

export const SERVICE: ServiceView = {
  now: Date.UTC(2026, 10, 6, 15), applyFrom: Date.UTC(2026, 10, 7),
  network: { lines: 4, flightsPerDay: 38 },
  quality: { current: 'soigne', next: null },
  satisfaction: { value: 4.2, trend: 0.3, estimated: false },
  perDay: { sales: 1_920, cost: 6_480 },
  hauls: [
    { haul: 'short', operated: [{ icao: 'AT76', name: 'ATR 72-600' }], satisfaction: 2.4,
      cells: cells({ drinks: 'free', snack: 'paid', hot_meal: 'none', alcohol: 'none', films: 'none', wifi: 'none', comfort: 'none', duty_free: 'none' }, { short: 10, medium: 18, long: 30 }, 4, ['films', 'wifi']) },
    { haul: 'medium', operated: [{ icao: 'BCS3', name: 'A220-300' }], satisfaction: 3.9,
      cells: cells({ drinks: 'free', snack: 'free', hot_meal: 'paid', alcohol: 'paid', films: 'free', wifi: 'paid', comfort: 'paid', duty_free: 'paid' }, { short: 18, medium: 18, long: 30 }, 8) },
    { haul: 'long', operated: [], satisfaction: 4.8,
      cells: cells({ drinks: 'free', snack: 'free', hot_meal: 'free', alcohol: 'free', films: 'free', wifi: 'paid', comfort: 'free', duty_free: 'paid' }, { short: 30, medium: 30, long: 30 }, 15) },
  ],
  qualities: QUALITIES,
  kitchens: [{ hub: 'LFMN', name: "Nice Côte d'Azur", hall: true, hallOffered: true, provider: 'own', nextProvider: null, effectiveQuality: 'soigne' }],
  crew: [
    { icao: 'AT76', name: 'ATR 72-600', seats: 70, cabin: 2, legalMinimum: 2 },
    { icao: 'BCS3', name: 'A220-300', seats: 130, cabin: 4, legalMinimum: 3 },
  ],
  crewBonusPct: 5,
};

/** Soigné -> gastronomique on the qualities above: rating 4.2 -> 4.7, margin 54 % -> 36 % (C14), 548 meals asked, 310 makeable. */
export const PREVIEW_GASTRO: ServicePreview = {
  quality: 'gastronomique', current: 'soigne', satisfaction: { from: 4.2, to: 4.7 }, mealMargin: { from: 0.54, to: 0.36 },
  meals: { demand: 548, from: 548, to: 310 }, cooks: { from: 6, to: 9, employed: 6 },
};

const NOV6 = Date.UTC(2026, 10, 6);
const at = (h: number, m: number): number => NOV6 + (h * 60 + m) * 60_000;

export const KITCHEN: KitchenView = {
  hub: 'LFMN', name: "Nice Côte d'Azur", hall: { facilityId: 11, held: true, rent: 8_500 },
  provider: 'own', nextProvider: null, quality: { current: 'soigne', next: null }, effectiveQuality: 'soigne', applyFrom: Date.UTC(2026, 10, 7),
  day: { date: '2026-11-06', snacks: 312, hot: 236, demand: 548, made: 138, unserved: 0, capacity: 515 },
  cooks: { employed: 6, onDuty: 5, needed: 6 },
  qualities: kitchenRows(548),
  caterer: { snack: 1.45, economy: 5.45, soigne: 8.1 },
  departures: [
    { flightNo: 'AZR 1641', dep: at(18, 10), dest: 'LFKJ', aircraft: 'ATR 72-600', snacks: 68, hot: 0, status: 'done' },
    { flightNo: 'AZR 1137', dep: at(18, 46), dest: 'LFLL', aircraft: 'ATR 72-600', snacks: 70, hot: 0, status: 'done' },
    { flightNo: 'AZR 4131', dep: at(19, 40), dest: 'LFPG', aircraft: 'A220-300', snacks: 0, hot: 136, status: 'scheduled' },
    { flightNo: 'AZR 4135', dep: at(21, 5), dest: 'LFPG', aircraft: 'A220-300', snacks: 0, hot: 100, status: 'scheduled' },
  ],
};

export const QUOTE: CatererQuote = {
  hub: 'LFMN', quality: 'soigne', effectiveQuality: 'soigne', perMeal: 8.1, snack: 1.45, mealsPerDay: { snacks: 312, hot: 236 },
  monthly: Math.round(30 * (312 * 1.45 + 236 * 8.1)), own: { monthly: 30 * 3000, cooks: 6, hallRent: 0 },
};
