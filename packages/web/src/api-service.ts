import { api } from './api.ts';
import { ApiError } from './errors.ts';

/**
 * Typed client for the SERVICE section of docs/v3-plan.md (B.7).
 * The wire types are declared here until lot S6's `shared/src/service.ts` is merged; they are that file's types field for field (read from `feature/v3-s6-service`), so switching is an import change.
 * A route the server does not have answers 404/405: `null` means "feature off", any other failure still throws.
 * Money is euros, a rate is a fraction (0.54 is 54 %), satisfaction runs 1 to 5, instants are epoch milliseconds, days are ISO dates (UTC).
 * Every change applies from the next UTC midnight (`applyFrom`): a `next` field says what is pending.
 */

/** Short: under 1 h 30 of block time. Medium: 1 h 30 to 4 h. Long: over 4 h. */
export type HaulClass = 'short' | 'medium' | 'long';
export type ServiceItem = 'drinks' | 'snack' | 'hot_meal' | 'alcohol' | 'films' | 'wifi' | 'comfort' | 'duty_free';
export type ServiceMode = 'none' | 'free' | 'paid';
export type MealQuality = 'economy' | 'soigne' | 'gastronomique';
export type KitchenProvider = 'own' | 'caterer';

/** `mode` is in force now, `next` takes effect at `applyFrom`. `unavailable`: every aircraft flown in this class lacks the item (an ATR has no screens). `allowed`: the modes the item can be set to. `price`: what a paying passenger pays. */
export type PolicyCell = { item: ServiceItem; mode: ServiceMode; next: ServiceMode | null; unavailable: boolean; allowed: ServiceMode[]; price: number };
export type HaulView = {
  haul: HaulClass;
  /** The aircraft types that fly this class on a line of the company (empty: not operated yet). */
  operated: { icao: string; name: string }[];
  /** What this class's policy gives a passenger (1 to 5). */
  satisfaction: number;
  cells: PolicyCell[];
};
/** A meal quality level. `price` is what a paying passenger pays for the hot meal, `cost` what it costs to make, `margin` is `1 - cost / price` (C14), `rating` the passengers' score (1 to 5), `team` the cooks at full output and `maxOutput` the meals a day. `catererAvailable`: a caterer can make this level. */
export type QualityCard = { quality: MealQuality; price: number; ingredients: number; cost: number; margin: number; rating: number; prepMin: number; team: number; maxOutput: number; catererAvailable: boolean };
export type HubKitchen = { hub: string; name: string; hall: boolean; hallOffered: boolean; provider: KitchenProvider; nextProvider: KitchenProvider | null; effectiveQuality: MealQuality };
/** `cabin`: cabin crew the company puts on a flight of this type; `legalMinimum` is the least the rules allow. */
export type CrewRow = { icao: string; name: string; seats: number; cabin: number; legalMinimum: number };
export type ServiceView = {
  now: number;
  /** When a change made now takes effect. */
  applyFrom: number;
  network: { lines: number; flightsPerDay: number };
  /** The meal quality of the company: `next` takes effect at `applyFrom`. */
  quality: { current: MealQuality; next: MealQuality | null };
  /** Passenger-weighted over the last 30 days, `trend` against the window before. `estimated`: nothing served yet, `value` is what the policy gives (null: no cabin flies). */
  satisfaction: { value: number | null; trend: number | null; estimated: boolean };
  /** On-board sales and the cost of the service of today's timetable. */
  perDay: { sales: number; cost: number };
  hauls: HaulView[];
  qualities: QualityCard[];
  kitchens: HubKitchen[];
  crew: CrewRow[];
  /** The cabin crew's share of what it sells, in percent. */
  crewBonusPct: number;
};
export type ServicePreview = {
  quality: MealQuality; current: MealQuality;
  /** What the policy gives on the company's lines, now and with the new quality (null: no cabin flies). */
  satisfaction: { from: number | null; to: number | null };
  /** Margin of the hot meal on its menu price. */
  mealMargin: { from: number; to: number };
  /** Meals a day the timetable asks, and how many the kitchens could make with the cooks employed today. */
  meals: { demand: number; from: number; to: number };
  /** Cooks the own kitchens need for the demand, and the cooks employed there. */
  cooks: { from: number; to: number; employed: number };
};
export type KitchenQualityRow = QualityCard & { cooksForDemand: number; fitsDemand: boolean };
export type KitchenDeparture = { flightNo: string; dep: number; dest: string; aircraft: string; snacks: number; hot: number; status: 'scheduled' | 'done' };
export type KitchenView = {
  hub: string; name: string;
  /** The kitchen building of the hub (a facility: lease or buy it from `#facility/<id>`). Null: the airport has none, a caterer serves. */
  hall: { facilityId: number; held: boolean; rent: number } | null;
  provider: KitchenProvider; nextProvider: KitchenProvider | null;
  /** The company's meal quality; `effectiveQuality` is what this hub makes with its provider (a caterer has no chef's menu). */
  quality: { current: MealQuality; next: MealQuality | null }; effectiveQuality: MealQuality;
  applyFrom: number;
  /** Today's meals from this airport: asked by the flights, made so far, left unmade. `capacity`: meals the own kitchen can make today with the cooks available (null: a caterer has no cap). */
  day: { date: string; snacks: number; hot: number; demand: number; made: number; unserved: number; capacity: number | null };
  cooks: { employed: number; onDuty: number; needed: number };
  qualities: KitchenQualityRow[];
  /** What a caterer charges per unit here. It has no chef's menu. */
  caterer: { snack: number; economy: number; soigne: number };
  departures: KitchenDeparture[];
};
export type CatererQuote = {
  hub: string; quality: MealQuality; effectiveQuality: MealQuality; perMeal: number; snack: number;
  mealsPerDay: { snacks: number; hot: number };
  /** What the meals of a day (as the timetable asks them today) cost a month with the caterer, and with an own kitchen (ingredients, the cooks it needs, the hall's rent when not held yet). Null: no hall to rent here. */
  monthly: number;
  own: { monthly: number; cooks: number; hallRent: number } | null;
};

export type PolicyBody = { haul: HaulClass; item: ServiceItem; mode: ServiceMode };
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
export const fetchQualityPreview = (quality: MealQuality): Promise<ServicePreview | null> => optional<ServicePreview>(`/service/preview?quality=${quality}`);
export const fetchKitchen = (hub: string): Promise<KitchenView | null> => optional<KitchenView>(`/kitchen/${encodeURIComponent(hub)}`);

export const setPolicy = (body: PolicyBody): Promise<ServiceView> => api<ServiceView>('/service/policy', { method: 'PUT', body });
export const setMealQuality = (quality: MealQuality): Promise<ServiceView> => api<ServiceView>('/service/meal-quality', { method: 'PUT', body: { quality } });
export const setKitchen = (hub: string, body: KitchenBody): Promise<KitchenView> => api<KitchenView>(`/kitchen/${encodeURIComponent(hub)}`, { method: 'PUT', body });
export const requestQuote = (hub: string, quality?: MealQuality): Promise<CatererQuote> => api<CatererQuote>(`/kitchen/${encodeURIComponent(hub)}/quote`, { method: 'POST', body: quality ? { quality } : {} });
