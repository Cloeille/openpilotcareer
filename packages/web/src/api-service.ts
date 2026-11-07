import { api } from './api.ts';
import { ApiError } from './errors.ts';

/**
 * Typed client for the SERVICE section of docs/v3-plan.md (B.7).
 * The wire types are declared here until lot S6's `shared/src/service.ts` is merged; they are the shapes this lot asks of S6 (see "Implementation notes (F6)"), so switching is an import change.
 * A route the server does not have answers 404/405: `null` means "feature off", any other failure still throws.
 * Money is euros, a rate is a fraction (0.54 is 54 %), satisfaction is on the 0..5 scale, instants are epoch milliseconds, days are ISO dates (UTC).
 */

/** Haul class from block time: short under 1 h 30, medium up to 4 h, long above. */
export type HaulClass = 'short' | 'medium' | 'long';
export type ServiceItem = 'drinks' | 'snack' | 'hotMeal' | 'alcohol' | 'films' | 'wifi' | 'comfort' | 'dutyFree';

/** `unavailable` is derived by the server from the aircraft's category and cannot be set. */
export type ServiceMode = 'none' | 'free' | 'paid' | 'unavailable';
export type SettableMode = Exclude<ServiceMode, 'unavailable'>;

export type MealQuality = 'economy' | 'soigne' | 'gastronomique';

/** One item on one haul class. `price`: euros per passenger when the item is paid (null while it has no fixed price, like the duty-free shop). */
export type ServiceCell = { mode: ServiceMode; price: number | null };

export type HaulView = {
  haul: HaulClass;
  /** Flights of this class a day on the company's lines; 0 means the class is not operated (yet). */
  flightsPerDay: number;
  /** Names of the aircraft types flown on this class. */
  aircraft: string[];
  /** The class's own satisfaction on the 0..5 scale, which the comfort slider reads out. */
  satisfaction: number;
  cells: Record<ServiceItem, ServiceCell>;
};

/** A meal quality level of the own kitchen, as both screens show it. `price` is what a hot meal of that level is worth to the passenger, `cost` what it costs to make, `margin` is `1 - cost / price` (C14); `team` is cooks needed and `maxOutput` meals a day. */
export type MealTier = { quality: MealQuality; price: number; cost: number; margin: number; satisfaction: number; prepMinutes: number; team: number; maxOutput: number };

export type ServiceView = {
  satisfaction: number;
  /** Against the last month-end; null before there are two. */
  satisfactionTrend: number | null;
  /** Euros a day. */
  salesPerDay: number;
  costPerDay: number;
  lines: number;
  flightsPerDay: number;
  hauls: HaulView[];
  mealQuality: MealQuality;
  tiers: MealTier[];
};

/** What switching to `quality` changes: `satisfaction` in points of the 0..5 scale, `marginPts` in points of margin, the others as from -> to. */
export type QualityPreview = { quality: MealQuality; satisfaction: number; marginPts: number; mealsPerDay: { from: number; to: number }; cooks: { from: number; to: number } };

export type KitchenProvider = 'own' | 'caterer';
export type DepartureStatus = 'preparing' | 'ready' | 'loaded';
/** A flight of the day that carries meals from this kitchen. `lateMin`: how far behind plan its meals are (0 when on time); `readyAt`: when they were or will be ready (null while unknown). */
export type KitchenDeparture = {
  flightNo: string; dep: number; origin: string; dest: string; aircraft: string;
  kind: 'snack' | 'hot'; meals: number; status: DepartureStatus; lateMin: number; readyAt: number | null;
};

/** The caterer's offer at the current quality: `costPerMeal` and `margin` on it, and the levels it can serve (not every one: the mockup's caterer has no gastronomique). */
export type CatererOption = { name: string; costPerMeal: number; margin: number; qualities: MealQuality[] };

export type KitchenView = {
  hub: string;
  provider: KitchenProvider;
  quality: MealQuality;
  /** The production day (ISO date, UTC). */
  day: string;
  demand: { snacks: number; hot: number };
  /** Meals a day at full staff, and with the cooks on duty now; null without a cap (the caterer). */
  capacity: number | null;
  capacityNow: number | null;
  /** Gross margin on the meal share, as a fraction, and over the day in euros. */
  margin: number;
  marginDay: number;
  /** `needed` is the chosen quality's team; `onDuty` those at work now; `headcount` those employed at this hub. */
  cooks: { onDuty: number; headcount: number; needed: number };
  /** The own kitchen's levels, whoever supplies the meals today. */
  tiers: MealTier[];
  /** Null until a quote was asked (`POST /kitchen/:hub/quote` answers the same shape). */
  caterer: CatererOption | null;
  departures: KitchenDeparture[];
};

export type PolicyBody = { haul: HaulClass; item: ServiceItem; mode: SettableMode };
export type KitchenBody = { quality?: MealQuality; provider?: KitchenProvider };

async function optional<T>(path: string): Promise<T | null> {
  try {
    return await api<T>(path);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return null;
    throw e;
  }
}

export const fetchService = (): Promise<ServiceView | null> => optional<ServiceView>('/service');
export const fetchQualityPreview = (quality: MealQuality): Promise<QualityPreview | null> => optional<QualityPreview>(`/service/preview?quality=${quality}`);
export const fetchKitchen = (hub: string): Promise<KitchenView | null> => optional<KitchenView>(`/kitchen/${encodeURIComponent(hub)}`);

export const setPolicy = (body: PolicyBody): Promise<unknown> => api('/service/policy', { method: 'PUT', body });
export const setMealQuality = (quality: MealQuality): Promise<unknown> => api('/service/meal-quality', { method: 'PUT', body: { quality } });
export const setKitchen = (hub: string, body: KitchenBody): Promise<unknown> => api(`/kitchen/${encodeURIComponent(hub)}`, { method: 'PUT', body });
export const requestQuote = (hub: string): Promise<CatererOption> => api<CatererOption>(`/kitchen/${encodeURIComponent(hub)}/quote`, { method: 'POST', body: {} });
