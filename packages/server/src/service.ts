// Lot SERVICE (v3), server side, part 1: the leaf. What a company serves on board (the policy table, the meal quality, who makes the meals), what one leg of a line earns and costs in
// service, and the satisfaction log. The line engine calls `planLeg` / `bookLeg` for every leg it resolves and `lineSatisfaction` when it values a line, so this file imports the
// database, the facilities leaf and the staff leaf only, never lines.ts. Read models and routes are in service-views.ts and routes-service.ts. docs/v3-plan.md B.7.
//
// Changes apply the next UTC day: a change is a new row whose `since` is the next midnight, and the configuration at instant `t` is the rows with `since <= t`, later ones winning.
// Nothing is swept by a hook, so replaying a tick or jumping the injected clock always sees the configuration of its own time.
import {
  DAY_MS, DEFAULT_POLICY, DEFAULT_QUALITY, HAULS, LOW_SATISFACTION_REPUTATION, SATISFACTION_FLOOR, SATISFACTION_STREAK_DAYS, SATISFACTION_WINDOW_DAYS, SERVICE_ITEMS, SERVICE_MODES,
  MEAL_QUALITIES, catererQuality, dayNo, dayStart, foodCost, hasCabin, haulOf, kitchenCapacity, legSatisfaction, legService, mealsAsked, offerFor,
  type AircraftCategory, type HaulClass, type KitchenProvider, type MealQuality, type Offer, type Policy, type ServiceItem, type ServiceMode,
} from '@opc/shared';
import { airports } from './catalog.ts';
import { all, get, run, type Db } from './db.ts';
import { effectOf, heldBy } from './facilities.ts';
import { isHuman } from './fleet-extras.ts';

/** The instant after the last one: "the configuration as it will be". */
const LATEST = Number.MAX_SAFE_INTEGER;
/** A change made now takes effect at the next UTC midnight. */
export const applyFrom = (now: number): number => dayStart(now) + DAY_MS;

// ---------------------------------------------------------------- policy and meal quality

export type Config = { policy: Record<HaulClass, Policy>; quality: MealQuality };
type Row = { haul: string; item: string; mode: string; since: number };

/** The meal quality is a row of the same table (`haul = 'all'`, `item = 'meal_quality'`, the quality in `mode`): one history, one rule for "next day". */
const QUALITY_HAUL = 'all', QUALITY_ITEM = 'meal_quality';

const apply = (c: Config, r: Row): void => {
  if (r.haul === QUALITY_HAUL && r.item === QUALITY_ITEM) { if ((MEAL_QUALITIES as readonly string[]).includes(r.mode)) c.quality = r.mode as MealQuality; return; }
  if ((HAULS as readonly string[]).includes(r.haul) && (SERVICE_ITEMS as readonly string[]).includes(r.item) && (SERVICE_MODES as readonly string[]).includes(r.mode)) c.policy[r.haul as HaulClass][r.item as ServiceItem] = r.mode as ServiceMode;
};
const fresh = (): Config => ({ policy: { short: { ...DEFAULT_POLICY.short }, medium: { ...DEFAULT_POLICY.medium }, long: { ...DEFAULT_POLICY.long } }, quality: DEFAULT_QUALITY });

/** The company's configuration at instant `at` (default: as it will be once every pending change is in force). Defaults are code: a company that never touched the table has the mockup's. */
export function configAt(db: Db, companyId: number, at: number = LATEST): Config {
  const c = fresh();
  for (const r of all<Row>(db, 'SELECT haul, item, mode, since FROM service_policy WHERE company_id = ? AND since <= ? ORDER BY since', companyId, at)) apply(c, r);
  return c;
}
/** What is decided but not in force at `now`: the configuration of tomorrow, as a list of the cells that differ from today's. */
export function pendingOf(db: Db, companyId: number, now: number): { cells: { haul: HaulClass; item: ServiceItem; mode: ServiceMode }[]; quality: MealQuality | null } {
  const today = configAt(db, companyId, now), next = configAt(db, companyId);
  const cells = HAULS.flatMap((haul) => SERVICE_ITEMS.filter((item) => next.policy[haul][item] !== today.policy[haul][item]).map((item) => ({ haul, item, mode: next.policy[haul][item] })));
  return { cells, quality: next.quality !== today.quality ? next.quality : null };
}

export function setPolicy(db: Db, companyId: number, o: { haul: HaulClass; item: ServiceItem; mode: ServiceMode }, now: number): void {
  run(db, 'INSERT INTO service_policy (company_id, haul, item, mode, since) VALUES (?, ?, ?, ?, ?) ON CONFLICT (company_id, haul, item, since) DO UPDATE SET mode = excluded.mode', companyId, o.haul, o.item, o.mode, applyFrom(now));
}
export function setQuality(db: Db, companyId: number, quality: MealQuality, now: number): void {
  run(db, 'INSERT INTO service_policy (company_id, haul, item, mode, since) VALUES (?, ?, ?, ?, ?) ON CONFLICT (company_id, haul, item, since) DO UPDATE SET mode = excluded.mode', companyId, QUALITY_HAUL, QUALITY_ITEM, quality, applyFrom(now));
}

// ---------------------------------------------------------------- who makes the meals at an airport

/** The kitchen hall of the hub (S3's facility with the `kitchen` effect) is held by the company at `at`. */
export const hallHeld = (db: Db, companyId: number, hub: string, at: number): boolean => heldBy(db, companyId, hub).some((h) => effectOf(h) === 'kitchen' && h.started_at <= at);

/** A caterer serves unless the company chose its own kitchen AND holds the hall at that instant (a hall given up puts the caterer back, nobody makes meals in a building they do not have). */
export function providerAt(db: Db, companyId: number, hub: string, at: number = LATEST): KitchenProvider {
  const r = get<{ provider: KitchenProvider }>(db, 'SELECT provider FROM kitchen WHERE company_id = ? AND hub = ? AND since <= ? ORDER BY since DESC LIMIT 1', companyId, hub, at);
  return r?.provider === 'own' && hallHeld(db, companyId, hub, at) ? 'own' : 'caterer';
}
export function pendingProvider(db: Db, companyId: number, hub: string, now: number): KitchenProvider | null {
  const next = providerAt(db, companyId, hub), cur = providerAt(db, companyId, hub, now);
  return next !== cur ? next : null;
}
export function setProvider(db: Db, companyId: number, hub: string, provider: KitchenProvider, now: number): void {
  run(db, 'INSERT INTO kitchen (company_id, hub, provider, since) VALUES (?, ?, ?, ?) ON CONFLICT (company_id, hub, since) DO UPDATE SET provider = excluded.provider', companyId, hub, provider, applyFrom(now));
}
/** The quality the passengers actually get at the airport: a caterer does not do the chef's menu. */
export const effectiveQuality = (provider: KitchenProvider, quality: MealQuality): MealQuality => (provider === 'own' ? quality : catererQuality(quality));

/** Cooks employed at the hub at `at`. */
export const cooksEmployed = (db: Db, companyId: number, hub: string, at: number): number =>
  get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM staff WHERE company_id = ? AND family = 'kitchen' AND base = ? AND starts_at <= ? AND (ends_at IS NULL OR ends_at > ?)", companyId, hub, at, at)!.n;
/** Cooks at work on the day of `at`: employed and not on granted leave (the kitchen has no duty ledger: nobody is booked on a leg). */
export const cooksAvailable = (db: Db, companyId: number, hub: string, at: number): number =>
  get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM staff s WHERE s.company_id = ? AND s.family = 'kitchen' AND s.base = ? AND s.starts_at <= ? AND (s.ends_at IS NULL OR s.ends_at > ?)
    AND NOT EXISTS (SELECT 1 FROM staff_leave l WHERE l.staff_id = s.id AND l.status = 'granted' AND l.from_day <= ? AND l.to_day >= ?)`, companyId, hub, at, at, dayNo(at), dayNo(at))!.n;

const sizeAt = (hub: string) => airports.get(hub)?.size ?? 'small';

// ---------------------------------------------------------------- one leg

/** What the passengers of a flight leaving `origin` are offered: the policy of its haul class, the hot meal at the quality the airport's provider can make (`quality` asks "what if"). */
export function offerAt(db: Db, o: { companyId: number; category: AircraftCategory; origin: string; blockMin: number; at?: number; quality?: MealQuality }): { offer: Offer; haul: HaulClass; provider: KitchenProvider; quality: MealQuality } {
  const cfg = configAt(db, o.companyId, o.at), provider = providerAt(db, o.companyId, o.origin, o.at), haul = haulOf(o.blockMin), quality = effectiveQuality(provider, o.quality ?? cfg.quality);
  return { offer: offerFor(cfg.policy[haul], haul, o.category, quality), haul, provider, quality };
}

export type LegInput = { companyId: number; category: AircraftCategory; seats: number; origin: string; dep: number; blockMin: number; pax: number };
export type LegPlan = {
  companyId: number; day: number; hub: string; pax: number; satisfaction: number; sales: number; cost: number; snacks: number; hot: number;
  /** Meals the passengers took against the ones the kitchen made. */
  asked: number; share: number; provider: KitchenProvider;
};

/** Meals made at `hub` on the day of `at`, by the legs already booked. */
export const madeToday = (db: Db, companyId: number, hub: string, at: number): number =>
  get<{ n: number }>(db, 'SELECT COALESCE(SUM(snacks + hot), 0) AS n FROM service_days WHERE company_id = ? AND day = ? AND hub = ?', companyId, dayNo(at), hub)!.n;

/** What the service of one leg sells and costs, and the satisfaction it leaves. Reads only. `made`: meals already made at the airport that day (default: what the booked legs made);
 *  an own kitchen makes what its cooks of the day can make, the rest of the meals are not made (neither sold nor paid). Null for an AI company and for an aircraft without a cabin crew. */
export function planLeg(db: Db, o: LegInput, made?: number): LegPlan | null {
  if (!hasCabin(o.seats) || !isHuman(db, o.companyId)) return null;
  const { offer, provider, quality } = offerAt(db, { ...o, at: o.dep });
  const asked = mealsAsked(offer, o.pax), total = asked.snacks + asked.hot;
  const left = provider === 'own' ? Math.max(0, kitchenCapacity(quality, cooksAvailable(db, o.companyId, o.origin, o.dep)) - (made ?? madeToday(db, o.companyId, o.origin, o.dep))) : total;
  const share = total === 0 ? 1 : Math.min(1, left / total);
  const s = legService(offer, o.pax, { share, food: foodCost(provider, quality, sizeAt(o.origin)) });
  return { companyId: o.companyId, day: dayNo(o.dep), hub: o.origin, pax: o.pax, satisfaction: legSatisfaction(offer, share), sales: s.sales, cost: s.cost, snacks: s.snacks, hot: s.hot, asked: total, share, provider };
}

/** Record a planned leg in the day's log (the satisfaction figures and the kitchen read it). The first leg of a day also checks the low-satisfaction rule (B.7), once. */
export function bookLeg(db: Db, p: LegPlan): void {
  const first = !get(db, 'SELECT 1 AS x FROM service_days WHERE company_id = ? AND day = ?', p.companyId, p.day);
  run(db, `INSERT INTO service_days (company_id, day, hub, pax, sat_pax, sales, cost, snacks, hot, unserved) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (company_id, day, hub) DO UPDATE SET pax = pax + excluded.pax, sat_pax = sat_pax + excluded.sat_pax, sales = sales + excluded.sales, cost = cost + excluded.cost,
      snacks = snacks + excluded.snacks, hot = hot + excluded.hot, unserved = unserved + excluded.unserved`,
  p.companyId, p.day, p.hub, p.pax, p.pax * p.satisfaction, p.sales, p.cost, p.snacks, p.hot, p.asked - p.snacks - p.hot);
  if (first) lowSatisfaction(db, p.companyId, p.day);
}

/** B.7: below SATISFACTION_FLOOR on each of the last SATISFACTION_STREAK_DAYS days of service costs reputation for every further day (checked once, by the first leg of the day). */
function lowSatisfaction(db: Db, companyId: number, day: number): void {
  const days = all<{ m: number }>(db, 'SELECT SUM(sat_pax) / SUM(pax) AS m FROM service_days WHERE company_id = ? AND day < ? AND pax > 0 GROUP BY day ORDER BY day DESC LIMIT ?', companyId, day, SATISFACTION_STREAK_DAYS);
  if (days.length === SATISFACTION_STREAK_DAYS && days.every((d) => d.m < SATISFACTION_FLOOR)) run(db, 'UPDATE companies SET reputation = MAX(0, reputation - ?) WHERE id = ?', LOW_SATISFACTION_REPUTATION, companyId);
}

/** The satisfaction the policy promises, as a seat-weighted sum so that lines can be pooled: each aircraft with a cabin flies both directions of the pair, and the meals come from the airport
 *  it leaves. Weight 0: nothing is served (an AI company, aircraft without a cabin crew), so the load factor has no satisfaction term. `at` as for `configAt`; `quality` asks "what if". */
export function satisfactionTerms(db: Db, companyId: number, aircraft: readonly { category: AircraftCategory; seats: number; blockMin: number }[], ends: readonly [string, string], at?: number, quality?: MealQuality): { sum: number; weight: number } {
  let weight = 0, sum = 0;
  if (!isHuman(db, companyId)) return { sum, weight };
  for (const a of aircraft) {
    if (!hasCabin(a.seats)) continue;
    for (const origin of ends) { sum += a.seats * offerAt(db, { companyId, category: a.category, origin, blockMin: a.blockMin, ...(at === undefined ? {} : { at }), ...(quality ? { quality } : {}) }).offer.satisfaction; weight += a.seats; }
  }
  return { sum, weight };
}
export function lineSatisfaction(db: Db, companyId: number, aircraft: readonly { category: AircraftCategory; seats: number; blockMin: number }[], ends: readonly [string, string], at?: number): number | null {
  const t = satisfactionTerms(db, companyId, aircraft, ends, at);
  return t.weight === 0 ? null : t.sum / t.weight;
}

/** Passenger-weighted satisfaction of the last SATISFACTION_WINDOW_DAYS ending today, and the difference with the window before. Null while nothing was served. */
export function measuredSatisfaction(db: Db, companyId: number, now: number): { value: number; trend: number | null } | null {
  const today = dayNo(now);
  const window = (from: number, to: number): number | null => {
    const r = get<{ pax: number | null; sat: number | null }>(db, 'SELECT SUM(pax) AS pax, SUM(sat_pax) AS sat FROM service_days WHERE company_id = ? AND day > ? AND day <= ?', companyId, from, to)!;
    return r.pax ? r.sat! / r.pax : null;
  };
  const cur = window(today - SATISFACTION_WINDOW_DAYS, today), before = window(today - 2 * SATISFACTION_WINDOW_DAYS, today - SATISFACTION_WINDOW_DAYS);
  return cur === null ? null : { value: Math.round(cur * 100) / 100, trend: before === null ? null : Math.round((cur - before) * 100) / 100 };
}
