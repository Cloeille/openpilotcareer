// Lot SERVICE (v3): cabin service and catering. The policy table (what is offered, free or paid, per haul class), the meal quality levels, the central kitchen, what a leg
// earns and costs in service, the satisfaction that results and how it moves the load factor (docs/v3-plan.md B.7). Pure rules, constants, request schemas and wire types.
// Runtime-imports only sibling leaf files (never ./index.ts), so there is no module cycle.
//
// Nothing here is copied from the mockup's margins (its two screens disagree, C14). Money is derived from what the economy already has: a cook's pay (`BASE_SALARY.kitchen`)
// over what a cook makes in a day gives the labour of a meal, a food-cost share of the menu price gives the ingredients, a caterer charges its cost over (1 - its margin).
import { z } from 'zod';
import type { AircraftCategory, AirportSize } from './index.ts';
import { LOAD_FACTOR_MAX, LOAD_FACTOR_MIN } from './lines.ts';
import { BASE_SALARY, crewNeeded } from './staff.ts';

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const cents = (n: number): number => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- haul classes

export const HAULS = ['short', 'medium', 'long'] as const;
export type HaulClass = (typeof HAULS)[number];
/** Short: under 1 h 30 of block time. Medium: 1 h 30 to 4 h. Long: over 4 h. */
export const HAUL_SHORT_MAX_MIN = 90;
export const HAUL_MEDIUM_MAX_MIN = 240;
export const haulOf = (blockMin: number): HaulClass => (blockMin < HAUL_SHORT_MAX_MIN ? 'short' : blockMin <= HAUL_MEDIUM_MAX_MIN ? 'medium' : 'long');

/** Service is for aircraft that fly with a cabin crew (the crew check books one from 20 seats): a C172 serves nothing and costs nothing. */
export const hasCabin = (seats: number): boolean => crewNeeded(seats).cabin > 0;
/** The legal minimum of cabin crew (B.3: one per 50 seats), against the one per 40 a company employs. */
export const cabinMinimum = (seats: number): number => (hasCabin(seats) ? Math.ceil(seats / 50) : 0);

// ---------------------------------------------------------------- meal quality and the kitchen

export const MEAL_QUALITIES = ['economy', 'soigne', 'gastronomique'] as const;
export type MealQuality = (typeof MEAL_QUALITIES)[number];
export type KitchenProvider = 'own' | 'caterer';

/** `price`: what a paying passenger pays for a hot meal. `rating`: how passengers rate the meal service (B.7: 3.6, 4.2, 4.7). `prepMin`, `team` (cooks at full output) and `maxOutput`
 *  (meals a day) are the Cuisine screen's: one cook makes `maxOutput / team` meals a day, so the cooks of the day set the capacity (the mockup's 515 meals with one cook of six away). */
export type MealSpec = { price: number; rating: number; prepMin: number; team: number; maxOutput: number; foodShare: number };
export const MEALS: Record<MealQuality, MealSpec> = {
  economy: { price: 9, rating: 3.6, prepMin: 4, team: 4, maxOutput: 980, foodShare: 0.3 },
  soigne: { price: 14, rating: 4.2, prepMin: 9, team: 6, maxOutput: 620, foodShare: 0.39 },
  gastronomique: { price: 23, rating: 4.7, prepMin: 18, team: 9, maxOutput: 310, foodShare: 0.52 },
};
export const DEFAULT_QUALITY: MealQuality = 'soigne';
/** A caterer cannot do the chef's menu (the Cuisine screen: "sans plafond de volume, pas de Gastronomique"). */
export const CATERER_MAX_QUALITY: MealQuality = 'soigne';
export const catererQuality = (q: MealQuality): MealQuality => (MEAL_QUALITIES.indexOf(q) > MEAL_QUALITIES.indexOf(CATERER_MAX_QUALITY) ? CATERER_MAX_QUALITY : q);
/** A hot meal given free is worth `(rating - MEAL_RATING_BASE) x MEAL_BONUS_SHARE` points of satisfaction (soigne 0.96): tuned so the mockup's medium-haul offer comes to its 4.2. */
export const MEAL_RATING_BASE = 3;
export const MEAL_BONUS_SHARE = 0.8;

/** A snack is a packed tray: made at the economy rate of the kitchen, with this much food in it. */
export const SNACK_QUALITY: MealQuality = 'economy';
export const SNACK_INGREDIENTS = 1;
/** A caterer prices its cost with this margin; a smaller airport has fewer caterers. */
export const CATERER_MARGIN = 1 / 3;
export const CATERER_SIZE_FACTOR: Record<AirportSize, number> = { large: 1, medium: 1.1, small: 1.25 };

/** Cooks needed to make `meals` a day at `q` (integer maths: 620 soigne meals are exactly 6 cooks). */
export const cooksFor = (q: MealQuality, meals: number): number => Math.ceil((Math.max(0, meals) * MEALS[q].team) / MEALS[q].maxOutput);
/** Meals a day that `cooks` make at `q`, within the hall's `maxOutput`. */
export const kitchenCapacity = (q: MealQuality, cooks: number): number => Math.min(MEALS[q].maxOutput, Math.floor((Math.max(0, cooks) * MEALS[q].maxOutput) / MEALS[q].team));

const labourPerMeal = (q: MealQuality): number => BASE_SALARY.kitchen / 30 / (MEALS[q].maxOutput / MEALS[q].team);
export const mealIngredients = (q: MealQuality): number => cents(MEALS[q].price * MEALS[q].foodShare);
/** What a hot meal costs to make, ingredients and labour (the Cuisine table's row). */
export const mealCost = (q: MealQuality): number => cents(mealIngredients(q) + labourPerMeal(q));
/** Margin of the hot meal on its menu price: 1 - cost / price. */
export const mealMargin = (q: MealQuality): number => cents(1 - mealCost(q) / MEALS[q].price);
const roundUp5 = (n: number): number => Math.ceil(n * 20 - 1e-9) / 20;
/** What a caterer charges for one unit at an airport of this size: its cost over (1 - its margin). `snack` is the packed tray. */
export const catererPrice = (what: 'snack' | MealQuality, size: AirportSize): number => {
  const cost = what === 'snack' ? SNACK_INGREDIENTS + labourPerMeal(SNACK_QUALITY) : mealCost(what);
  return roundUp5((cost / (1 - CATERER_MARGIN)) * CATERER_SIZE_FACTOR[size]);
};
export type FoodCost = { snack: number; hot: number };
/** What one snack and one hot meal cost the airline: an own kitchen buys the ingredients only (its cooks are on the payroll already), a caterer's price is all in. */
export const foodCost = (provider: KitchenProvider, quality: MealQuality, size: AirportSize): FoodCost =>
  provider === 'own' ? { snack: SNACK_INGREDIENTS, hot: mealIngredients(quality) } : { snack: catererPrice('snack', size), hot: catererPrice(catererQuality(quality), size) };

// ---------------------------------------------------------------- the policy table

export const SERVICE_ITEMS = ['drinks', 'snack', 'hot_meal', 'alcohol', 'films', 'wifi', 'comfort', 'duty_free'] as const;
export type ServiceItem = (typeof SERVICE_ITEMS)[number];
export const SERVICE_MODES = ['none', 'free', 'paid'] as const;
export type ServiceMode = (typeof SERVICE_MODES)[number];

/** A paying passenger is pleased by the option half as much as by a gift. */
export const PAID_BONUS_SHARE = 0.5;
/** The cabin crew gets this share of what it sells on board (the mockup's "primes sur les ventes"). It is a cost of the service. */
export const CREW_SALES_BONUS = 0.05;

const flat = (n: number): Record<HaulClass, number> => ({ short: n, medium: n, long: n });
/** `take`: share of the passengers who take the item when it is free; `paidTake` when they must pay (a small share: the game's fares are low, on-board sales stay under 6 % of
 *  line revenue at the default policy, C12). `bonus`: satisfaction points of the item when free. `price`: what a paying passenger pays, `cost`: what a unit costs the airline
 *  (snack and hot meal cost what the kitchen says, `foodCost`). `infotainment`: needs a screen or a Wi-Fi unit, so only jets have it. */
type ItemSpec = { price: Record<HaulClass, number>; cost: Record<HaulClass, number>; take: number; paidTake: number; bonus: number; modes: readonly ServiceMode[]; infotainment: boolean };
export const ITEMS: Record<ServiceItem, ItemSpec> = {
  drinks: { price: flat(2.5), cost: flat(0.6), take: 1, paidTake: 0.3, bonus: 0.4, modes: SERVICE_MODES, infotainment: false },
  snack: { price: flat(4), cost: flat(0), take: 0.9, paidTake: 0.2, bonus: 0.2, modes: SERVICE_MODES, infotainment: false },
  hot_meal: { price: flat(0), cost: flat(0), take: 0.85, paidTake: 0.12, bonus: 0, modes: SERVICE_MODES, infotainment: false },
  alcohol: { price: flat(7), cost: flat(1.8), take: 0.35, paidTake: 0.05, bonus: 0.1, modes: SERVICE_MODES, infotainment: false },
  films: { price: flat(5), cost: flat(0.15), take: 0.5, paidTake: 0.1, bonus: 0.3, modes: SERVICE_MODES, infotainment: true },
  wifi: { price: { short: 4, medium: 8, long: 15 }, cost: flat(0.5), take: 0.4, paidTake: 0.06, bonus: 0.2, modes: SERVICE_MODES, infotainment: true },
  comfort: { price: flat(6), cost: flat(0.8), take: 0.3, paidTake: 0.04, bonus: 0.2, modes: SERVICE_MODES, infotainment: false },
  // a duty-free basket is sold, never given: the reduced (short, medium) or the full catalogue (long), at 60 % cost of goods
  duty_free: { price: { short: 10, medium: 18, long: 30 }, cost: { short: 6, medium: 10.8, long: 18 }, take: 0, paidTake: 0.04, bonus: 0.1, modes: ['none', 'paid'], infotainment: false },
};
export const INFOTAINMENT_CATEGORIES: readonly AircraftCategory[] = ['jet-business', 'jet-airliner', 'jet-widebody'];
export const itemAvailable = (item: ServiceItem, category: AircraftCategory): boolean => !ITEMS[item].infotainment || INFOTAINMENT_CATEGORIES.includes(category);
export const modeAllowed = (item: ServiceItem, mode: ServiceMode): boolean => ITEMS[item].modes.includes(mode);

export type Policy = Record<ServiceItem, ServiceMode>;
const policy = (m: Partial<Policy>): Policy => ({ drinks: 'none', snack: 'none', hot_meal: 'none', alcohol: 'none', films: 'none', wifi: 'none', comfort: 'none', duty_free: 'none', ...m });
/** What a company serves until it decides otherwise: the mockup's three columns. */
export const DEFAULT_POLICY: Record<HaulClass, Policy> = {
  short: policy({ drinks: 'free', snack: 'paid' }),
  medium: policy({ drinks: 'free', snack: 'free', hot_meal: 'paid', alcohol: 'paid', films: 'free', wifi: 'paid', comfort: 'paid', duty_free: 'paid' }),
  long: policy({ drinks: 'free', snack: 'free', hot_meal: 'free', alcohol: 'free', films: 'free', wifi: 'paid', comfort: 'free', duty_free: 'paid' }),
};

/** Price and satisfaction bonus of an item on this haul class (the hot meal takes both from the quality). */
export const unitOf = (item: ServiceItem, haul: HaulClass, quality: MealQuality): { price: number; bonus: number } =>
  item === 'hot_meal' ? { price: MEALS[quality].price, bonus: (MEALS[quality].rating - MEAL_RATING_BASE) * MEAL_BONUS_SHARE } : { price: ITEMS[item].price[haul], bonus: ITEMS[item].bonus };

// ---------------------------------------------------------------- what a leg offers, earns and costs

/** Satisfaction runs 1 to 5. A flight with nothing on board is 2.5. */
export const SAT_BASE = 2.5;
export const SAT_MIN = 1;
export const SAT_MAX = 5;
export type OfferLine = { item: ServiceItem; mode: 'free' | 'paid'; take: number; price: number; cost: number; bonus: number; food: 'snack' | 'hot' | null };
export type Offer = { satisfaction: number; lines: OfferLine[] };

/** What a flight of this haul class and aircraft category offers under `policy`, with hot meals of `quality`. An item the aircraft cannot carry, or that is not allowed in that mode, is not offered. */
export function offerFor(policyOf: Readonly<Policy>, haul: HaulClass, category: AircraftCategory, quality: MealQuality): Offer {
  let satisfaction = SAT_BASE;
  const lines: OfferLine[] = [];
  for (const item of SERVICE_ITEMS) {
    const mode = policyOf[item];
    if (mode === 'none' || !itemAvailable(item, category) || !modeAllowed(item, mode)) continue;
    const u = unitOf(item, haul, quality), paid = mode === 'paid';
    const bonus = u.bonus * (paid ? PAID_BONUS_SHARE : 1);
    satisfaction += bonus;
    lines.push({ item, mode, take: paid ? ITEMS[item].paidTake : ITEMS[item].take, price: u.price, cost: ITEMS[item].cost[haul], bonus, food: item === 'snack' ? 'snack' : item === 'hot_meal' ? 'hot' : null });
  }
  return { satisfaction: cents(clamp(satisfaction, SAT_MIN, SAT_MAX)), lines };
}

/** Meals the kitchen must make for `pax` passengers (snacks and hot meals taken). */
export const mealsAsked = (o: Offer, pax: number): { snacks: number; hot: number } => ({
  snacks: Math.round(pax * (o.lines.find((l) => l.food === 'snack')?.take ?? 0)), hot: Math.round(pax * (o.lines.find((l) => l.food === 'hot')?.take ?? 0)),
});

/** What the service of one leg sells and costs, whole euros. `share` is the part of the meals the kitchen could make (1: all of them); a meal not made is neither sold nor paid for.
 *  The cost includes the cabin crew's share of the sales. */
export function legService(o: Offer, pax: number, kitchen: { share: number; food: FoodCost }): { sales: number; cost: number; snacks: number; hot: number } {
  let sales = 0, cost = 0, snacks = 0, hot = 0;
  for (const l of o.lines) {
    const asked = Math.round(pax * l.take);
    const units = l.food ? Math.round(asked * kitchen.share) : asked;
    if (l.food === 'snack') snacks = units;
    if (l.food === 'hot') hot = units;
    if (l.mode === 'paid') sales += units * l.price;
    cost += units * (l.food ? kitchen.food[l.food] : l.cost);
  }
  return { sales: Math.round(sales), cost: Math.round(cost + sales * CREW_SALES_BONUS), snacks, hot };
}

/** B.7: a meal not made gives none of its bonus and costs the leg one point of satisfaction, in proportion to the meals missing (so a kitchen cannot buy satisfaction with a menu it cannot cook). */
export const UNSERVED_PENALTY = 1;
export const legSatisfaction = (o: Offer, share: number): number =>
  cents(clamp(o.satisfaction - o.lines.reduce((t, l) => (l.food ? t + l.bonus * (1 - share) : t), 0) - UNSERVED_PENALTY * (1 - share), SAT_MIN, SAT_MAX));

// ---------------------------------------------------------------- satisfaction and the load factor

/** B.7: the load factor is multiplied by 1 + 0.04 x (satisfaction - 3.5), by at most 6 % either way (decision C12), and stays inside the line engine's bounds. */
export const SAT_NEUTRAL = 3.5;
export const SAT_LOAD_SLOPE = 0.04;
export const SAT_LOAD_CAP = 0.06;
export const satisfactionFactor = (s: number): number => 1 + clamp(SAT_LOAD_SLOPE * (s - SAT_NEUTRAL), -SAT_LOAD_CAP, SAT_LOAD_CAP);
/** A load factor of 0 (no seats) stays 0. */
export const withSatisfaction = (lf: number, satisfaction: number): number => (lf <= 0 ? 0 : clamp(lf * satisfactionFactor(satisfaction), LOAD_FACTOR_MIN, LOAD_FACTOR_MAX));

/** B.7: a company whose passengers are below SATISFACTION_FLOOR on each of the last SATISFACTION_STREAK_DAYS days loses this much reputation (stored points, C17) for each further day. */
export const SATISFACTION_FLOOR = 3;
export const SATISFACTION_STREAK_DAYS = 14;
export const LOW_SATISFACTION_REPUTATION = 0.02;
/** The satisfaction shown is the passenger-weighted mean of this many days, its trend the difference with the window before. The log is kept for two windows. */
export const SATISFACTION_WINDOW_DAYS = 30;
export const SERVICE_KEEP_DAYS = 2 * SATISFACTION_WINDOW_DAYS;

// ---------------------------------------------------------------- request schemas

export const servicePolicyBodySchema = z.object({ haul: z.enum(HAULS), item: z.enum(SERVICE_ITEMS), mode: z.enum(SERVICE_MODES) })
  .refine((b) => modeAllowed(b.item, b.mode), { message: 'this item cannot be offered that way', path: ['mode'] });
export const mealQualityBodySchema = z.object({ quality: z.enum(MEAL_QUALITIES) });
export const mealQualityQuerySchema = mealQualityBodySchema;
export const kitchenBodySchema = z.object({ quality: z.enum(MEAL_QUALITIES), provider: z.enum(['own', 'caterer']) }).partial()
  .refine((b) => b.quality !== undefined || b.provider !== undefined, { message: 'nothing to change' });
export const quoteBodySchema = z.object({ quality: z.enum(MEAL_QUALITIES).optional() });

// ---------------------------------------------------------------- wire types

/** `mode` is in force now, `next` takes effect at `applyFrom`. `unavailable`: every aircraft of the company in this class lacks the item (an ATR has no screens). */
export type PolicyCell = { item: ServiceItem; mode: ServiceMode; next: ServiceMode | null; unavailable: boolean; allowed: ServiceMode[]; price: number };
export type HaulView = {
  haul: HaulClass;
  /** The aircraft types that fly this class on a line of the company (empty: not operated yet). */
  operated: { icao: string; name: string }[];
  /** What this class's policy gives a passenger, on the aircraft flown (a typical airliner of the class when none is). */
  satisfaction: number;
  cells: PolicyCell[];
};
export type QualityCard = { quality: MealQuality; price: number; ingredients: number; cost: number; margin: number; rating: number; prepMin: number; team: number; maxOutput: number; catererAvailable: boolean };
export type HubKitchen = { hub: string; name: string; hall: boolean; hallOffered: boolean; provider: KitchenProvider; nextProvider: KitchenProvider | null; effectiveQuality: MealQuality };
export type CrewRow = { icao: string; name: string; seats: number; cabin: number; legalMinimum: number };
export type ServiceView = {
  now: number;
  /** When a change made now takes effect. */
  applyFrom: number;
  network: { lines: number; flightsPerDay: number };
  /** The meal quality of the company: `next` takes effect at `applyFrom`. */
  quality: { current: MealQuality; next: MealQuality | null };
  /** Passenger-weighted over the last SATISFACTION_WINDOW_DAYS, `trend` against the window before. `estimated`: nothing served yet, `value` is what the policy gives (null: no cabin flies). */
  satisfaction: { value: number | null; trend: number | null; estimated: boolean };
  /** On-board sales and the cost of the service of today's timetable: flights done (as booked) and flights still to fly (as expected). */
  perDay: { sales: number; cost: number };
  hauls: HaulView[];
  qualities: QualityCard[];
  kitchens: HubKitchen[];
  crew: CrewRow[];
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
  quality: { current: MealQuality; next: MealQuality | null }; effectiveQuality: MealQuality;
  applyFrom: number;
  /** Today's meals from this airport: asked by the flights, made so far, left unmade. `capacity`: meals the own kitchen can make today (null: a caterer has no cap). */
  day: { date: string; snacks: number; hot: number; demand: number; made: number; unserved: number; capacity: number | null };
  cooks: { employed: number; onDuty: number; needed: number };
  qualities: KitchenQualityRow[];
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
