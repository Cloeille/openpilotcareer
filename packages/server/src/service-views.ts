// Lot SERVICE (v3), server side, part 2: the read models of the service and kitchen screens, and the caterer's quote (docs/v3-plan.md B.7). Nothing here books money: the money of a leg is
// booked by the line engine (service.ts `planLeg`), these functions only read the same rules over today's timetable.
import {
  CREW_SALES_BONUS, DAY_MS, HAULS, ITEMS, MEALS, MEAL_QUALITIES, SERVICE_ITEMS, SNACK_INGREDIENTS, catererPrice, catererQuality, cooksFor, crewNeeded, dayIso, dayNo, dayStart, hasCabin, haulOf,
  itemAvailable, kitchenCapacity, mealCost, mealIngredients, mealMargin, mealsAsked, modeAllowed, cabinMinimum, salaryFor, unitOf, weekdayOf,
  type AircraftCategory, type AircraftType, type CatererQuote, type HaulClass, type HaulView, type HubKitchen, type KitchenDeparture, type KitchenView, type MealQuality, type PolicyCell,
  type QualityCard, type ServicePreview, type ServiceView,
} from '@opc/shared';
import { airports } from './catalog.ts';
import { all, get, type Db } from './db.ts';
import { ensureSlots, assertHub } from './facilities.ts';
import { typeFor, type AircraftRow } from './game.ts';
import { blockMinutes, companyCode, lineAircraft, lineDistance, loadFactorOf, type LegRow, type LineRow } from './lines.ts';
import {
  applyFrom, configAt, cooksAvailable, cooksEmployed, effectiveQuality, hallHeld, hallSlot, madeToday, measuredSatisfaction, offerAt, pendingOf, pendingProvider, planLeg, providerAt, satisfactionTerms,
} from './service.ts';

const round2 = (n: number): number => Math.round(n * 100) / 100;
const hubsOf = (db: Db, companyId: number): string[] => all<{ icao: string }>(db, 'SELECT icao FROM hubs WHERE company_id = ? ORDER BY rowid', companyId).map((h) => h.icao);
const hubName = (hub: string): string => airports.get(hub)?.name ?? hub;

// ---------------------------------------------------------------- today's timetable, as the kitchen sees it

type DayLeg = { leg: LegRow; type: AircraftType; pax: number; snacks: number; hot: number };

/** The flights of today that carry a cabin and have not been cancelled, with the passengers they carry (booked, or the line's expected load for those still to fly) and the meals those passengers take. */
function dayLegs(db: Db, companyId: number, now: number): DayLeg[] {
  const from = dayStart(now);
  const loads = new Map<number, number>();
  const out: DayLeg[] = [];
  for (const leg of all<LegRow>(db, "SELECT * FROM scheduled_flights WHERE company_id = ? AND dep_at >= ? AND dep_at < ? AND status IN ('scheduled','done') ORDER BY dep_at, id", companyId, from, from + DAY_MS)) {
    const ac = get<AircraftRow>(db, 'SELECT * FROM aircraft WHERE id = ?', leg.aircraft_id);
    if (!ac) continue;
    const type = typeFor(db, companyId, ac.icao);
    if (!hasCabin(type.seats)) continue;
    let pax = leg.pax;
    if (pax === null) {
      let lf = loads.get(leg.line_id);
      if (lf === undefined) {
        const l = get<LineRow>(db, 'SELECT * FROM lines WHERE id = ?', leg.line_id)!;
        lf = loadFactorOf(db, { companyId, a: l.a, b: l.b, freqPerDay: l.freq_per_day, days: l.days, fleet: lineAircraft(db, l.id).filter((x) => x.returned_at === null), excludeLineId: l.id, at: leg.dep_at });
        loads.set(leg.line_id, lf);
      }
      pax = Math.min(type.seats, Math.round(type.seats * lf));
    }
    const { offer } = offerAt(db, { companyId, category: type.category, origin: leg.origin, blockMin: (leg.arr_at - leg.dep_at) / 60_000, at: leg.dep_at });
    out.push({ leg, type, pax, ...mealsAsked(offer, pax) });
  }
  return out;
}

const demandAt = (legs: readonly DayLeg[], hub: string): { snacks: number; hot: number } =>
  legs.filter((d) => d.leg.origin === hub).reduce((t, d) => ({ snacks: t.snacks + d.snacks, hot: t.hot + d.hot }), { snacks: 0, hot: 0 });

// ---------------------------------------------------------------- the service screen

const qualityCard = (q: MealQuality): QualityCard => ({
  quality: q, price: MEALS[q].price, ingredients: mealIngredients(q), cost: mealCost(q), margin: mealMargin(q), rating: MEALS[q].rating, prepMin: MEALS[q].prepMin, team: MEALS[q].team, maxOutput: MEALS[q].maxOutput,
  catererAvailable: catererQuality(q) === q,
});

type Flown = { type: AircraftType; blockMin: number };
/** The aircraft types the company flies on its lines, by haul class (a paused line flies nothing). */
function flownLines(db: Db, companyId: number): { line: LineRow; flown: Flown[] }[] {
  return all<LineRow>(db, "SELECT * FROM lines WHERE company_id = ? AND status != 'paused' ORDER BY id", companyId).map((line) => {
    const dist = lineDistance(line.a, line.b);
    return { line, flown: lineAircraft(db, line.id).filter((x) => x.returned_at === null).map((x) => { const type = typeFor(db, companyId, x.icao); return { type, blockMin: blockMinutes(type, dist) }; }) };
  });
}

/** A typical airliner of the class, for a column nobody flies yet: its cells then show what the policy would give. */
const TYPICAL: Record<HaulClass, AircraftCategory> = { short: 'turboprop-airliner', medium: 'jet-airliner', long: 'jet-airliner' };

export function serviceView(db: Db, companyId: number, now: number): ServiceView {
  const cfgNow = configAt(db, companyId, now), cfgNext = configAt(db, companyId), pending = pendingOf(db, companyId, now);
  const lines = flownLines(db, companyId);
  const byHaul = new Map<HaulClass, Map<string, AircraftType>>(HAULS.map((h) => [h, new Map()]));
  for (const { flown } of lines) for (const f of flown) byHaul.get(haulOf(f.blockMin))!.set(f.type.icao, f.type);

  const hauls: HaulView[] = HAULS.map((haul) => {
    const types = [...byHaul.get(haul)!.values()];
    const category = types[0]?.category ?? TYPICAL[haul];
    const cells: PolicyCell[] = SERVICE_ITEMS.map((item) => {
      const next = pending.cells.find((c) => c.haul === haul && c.item === item)?.mode ?? null;
      return {
        item, mode: cfgNow.policy[haul][item], next, unavailable: types.length > 0 && types.every((t) => !itemAvailable(item, t.category)),
        allowed: ITEMS[item].modes.filter((m) => modeAllowed(item, m)), price: unitOf(item, haul, cfgNow.quality).price,
      };
    });
    return {
      haul, operated: types.map((t) => ({ icao: t.icao, name: t.name })),
      satisfaction: offerAt(db, { companyId, category, origin: hubsOf(db, companyId)[0] ?? '', blockMin: haul === 'short' ? 60 : haul === 'medium' ? 120 : 300, at: now }).offer.satisfaction, cells,
    };
  });

  const measured = measuredSatisfaction(db, companyId, now);
  const terms = lines.reduce((t, { line, flown }) => {
    const x = satisfactionTerms(db, companyId, flown.map((f) => ({ category: f.type.category, seats: f.type.seats, blockMin: f.blockMin })), [line.a, line.b], now);
    return { sum: t.sum + x.sum, weight: t.weight + x.weight };
  }, { sum: 0, weight: 0 });
  const satisfaction = measured ? { value: measured.value, trend: measured.trend, estimated: false } : { value: terms.weight === 0 ? null : round2(terms.sum / terms.weight), trend: null, estimated: true };

  // sales and cost of today: what the flown legs booked, plus what the legs still to fly are expected to (kitchen capacity used up as the day goes)
  const booked = get<{ sales: number | null; cost: number | null }>(db, 'SELECT SUM(sales) AS sales, SUM(cost) AS cost FROM service_days WHERE company_id = ? AND day = ?', companyId, dayNo(now))!;
  const made = new Map<string, number>();
  let sales = booked.sales ?? 0, cost = booked.cost ?? 0;
  for (const d of dayLegs(db, companyId, now)) {
    if (d.leg.status !== 'scheduled') continue;
    const p = planLeg(db, { companyId, category: d.type.category, seats: d.type.seats, origin: d.leg.origin, dep: d.leg.dep_at, blockMin: (d.leg.arr_at - d.leg.dep_at) / 60_000, pax: d.pax }, made.get(d.leg.origin) ?? madeToday(db, companyId, d.leg.origin, d.leg.dep_at));
    if (!p) continue;
    made.set(d.leg.origin, (made.get(d.leg.origin) ?? madeToday(db, companyId, d.leg.origin, d.leg.dep_at)) + p.snacks + p.hot);
    sales += p.sales; cost += p.cost;
  }

  const kitchens: HubKitchen[] = hubsOf(db, companyId).map((hub) => {
    const provider = providerAt(db, companyId, hub, now);
    return { hub, name: hubName(hub), hall: hallHeld(db, companyId, hub, now), hallOffered: hallSlot(hub) !== null, provider, nextProvider: pendingProvider(db, companyId, hub, now), effectiveQuality: effectiveQuality(provider, cfgNow.quality) };
  });
  const types = new Map<string, AircraftType>();
  for (const { flown } of lines) for (const f of flown) if (hasCabin(f.type.seats)) types.set(f.type.icao, f.type);
  const today = dayStart(now), weekday = weekdayOf(today);
  return {
    now, applyFrom: applyFrom(now),
    network: { lines: lines.length, flightsPerDay: lines.filter(({ line }) => (line.days & (1 << weekday)) !== 0).reduce((n, { line }) => n + 2 * line.freq_per_day, 0) },
    quality: { current: cfgNow.quality, next: pending.quality ?? (cfgNext.quality !== cfgNow.quality ? cfgNext.quality : null) },
    satisfaction, perDay: { sales, cost }, hauls, qualities: MEAL_QUALITIES.map(qualityCard), kitchens,
    crew: [...types.values()].sort((a, b) => a.seats - b.seats).map((t) => ({ icao: t.icao, name: t.name, seats: t.seats, cabin: crewNeeded(t.seats).cabin, legalMinimum: cabinMinimum(t.seats) })),
    crewBonusPct: Math.round(CREW_SALES_BONUS * 100),
  };
}

/** "Passer en gastronomique": what changing the meal quality would do, from the policy and the timetable of today. Reads only. */
export function servicePreview(db: Db, companyId: number, quality: MealQuality, now: number): ServicePreview {
  const current = configAt(db, companyId, now).quality;
  const lines = flownLines(db, companyId);
  const sat = (q: MealQuality): number | null => {
    const t = lines.reduce((acc, { line, flown }) => {
      const x = satisfactionTerms(db, companyId, flown.map((f) => ({ category: f.type.category, seats: f.type.seats, blockMin: f.blockMin })), [line.a, line.b], now, q);
      return { sum: acc.sum + x.sum, weight: acc.weight + x.weight };
    }, { sum: 0, weight: 0 });
    return t.weight === 0 ? null : round2(t.sum / t.weight);
  };
  const legs = dayLegs(db, companyId, now);
  let demand = 0, from = 0, to = 0, cooksFrom = 0, cooksTo = 0, employed = 0;
  for (const hub of new Set(legs.map((d) => d.leg.origin))) {
    const d = demandAt(legs, hub), n = d.snacks + d.hot, cooks = cooksEmployed(db, companyId, hub, now);
    demand += n; employed += cooks;
    from += kitchenCapacity(current, cooks); to += kitchenCapacity(quality, cooks);
    cooksFrom += cooksFor(current, n); cooksTo += cooksFor(quality, n);
  }
  return {
    quality, current, satisfaction: { from: sat(current), to: sat(quality) }, mealMargin: { from: mealMargin(current), to: mealMargin(quality) },
    meals: { demand, from: Math.min(from, demand), to: Math.min(to, demand) }, cooks: { from: cooksFrom, to: cooksTo, employed },
  };
}

// ---------------------------------------------------------------- the kitchen screen

export function kitchenView(db: Db, companyId: number, hub: string, now: number): KitchenView {
  assertHub(db, companyId, hub);
  const size = airports.get(hub)?.size ?? 'small';
  const cfgNow = configAt(db, companyId, now), pending = pendingOf(db, companyId, now);
  const provider = providerAt(db, companyId, hub, now), quality = effectiveQuality(provider, cfgNow.quality);
  const slot = hallSlot(hub);
  const row = slot ? ensureSlots(db, hub).find((f) => f.slot === slot.slot) : undefined;
  const legs = dayLegs(db, companyId, now), here = legs.filter((d) => d.leg.origin === hub), asked = demandAt(legs, hub), demand = asked.snacks + asked.hot;
  const log = get<{ made: number | null; unserved: number | null }>(db, 'SELECT SUM(snacks + hot) AS made, SUM(unserved) AS unserved FROM service_days WHERE company_id = ? AND day = ? AND hub = ?', companyId, dayNo(now), hub)!;
  const employed = cooksEmployed(db, companyId, hub, now), available = cooksAvailable(db, companyId, hub, now);
  const code = companyCode(db, companyId);
  const departures: KitchenDeparture[] = here.map((d) => ({
    flightNo: `${code} ${d.leg.flight_no}`, dep: d.leg.dep_at, dest: d.leg.dest, aircraft: d.type.name, snacks: d.snacks, hot: d.hot, status: d.leg.status === 'done' ? 'done' : 'scheduled',
  }));
  return {
    hub, name: hubName(hub), hall: row && slot ? { facilityId: row.id, held: hallHeld(db, companyId, hub, now), rent: slot.rent } : null,
    provider, nextProvider: pendingProvider(db, companyId, hub, now), quality: { current: cfgNow.quality, next: pending.quality }, effectiveQuality: quality, applyFrom: applyFrom(now),
    day: { date: dayIso(dayNo(now)), snacks: asked.snacks, hot: asked.hot, demand, made: log.made ?? 0, unserved: log.unserved ?? 0, capacity: provider === 'own' ? kitchenCapacity(quality, available) : null },
    cooks: { employed, onDuty: available, needed: cooksFor(quality, demand) },
    qualities: MEAL_QUALITIES.map((q) => ({ ...qualityCard(q), cooksForDemand: cooksFor(q, demand), fitsDemand: MEALS[q].maxOutput >= demand })),
    caterer: { snack: catererPrice('snack', size), economy: catererPrice('economy', size), soigne: catererPrice('soigne', size) },
    departures,
  };
}

/** What the meals of a day cost a month with the caterer and with an own kitchen at this airport (30 days of today's timetable). Deterministic: the same prices every time. */
export function catererQuote(db: Db, companyId: number, hub: string, want: MealQuality | undefined, now: number): CatererQuote {
  assertHub(db, companyId, hub);
  const size = airports.get(hub)?.size ?? 'small', q = want ?? configAt(db, companyId, now).quality, eq = catererQuality(q);
  const legs = dayLegs(db, companyId, now), asked = demandAt(legs, hub), slot = hallSlot(hub);
  const perMeal = catererPrice(eq, size), snack = catererPrice('snack', size), demand = asked.snacks + asked.hot;
  const cooks = cooksFor(q, demand), cook = salaryFor('kitchen', 'cook', 0.5, null);
  return {
    hub, quality: q, effectiveQuality: eq, perMeal, snack, mealsPerDay: asked, monthly: Math.round(30 * (asked.snacks * snack + asked.hot * perMeal)),
    own: slot ? { monthly: Math.round(30 * (asked.snacks * SNACK_INGREDIENTS + asked.hot * mealIngredients(q))) + cooks * cook, cooks, hallRent: hallHeld(db, companyId, hub, now) ? 0 : slot.rent } : null,
  };
}
