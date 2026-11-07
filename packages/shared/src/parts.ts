// Lot PARTS (v3): per-component wear, spare parts and the refurbishment of an aircraft. Pure rules, constants, request schemas and wire types (docs/v3-plan.md B.6, B.8).
// Runtime-imports only sibling leaf files (never ./index.ts), so there is no module cycle.
import { z } from 'zod';
import { WEAR_PCT_PER_HOUR } from './finance.ts';
import { AUTONOMY_FACTOR, DAY_MS } from './lines.ts';
import type { AircraftCategory } from './index.ts';

const round = (n: number, step = 1): number => Math.round(n / step) * step;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

// ---------------------------------------------------------------- components and their wear

export const COMPONENTS = ['engines', 'gear', 'propellers', 'avionics', 'interior', 'paint'] as const;
export type Component = (typeof COMPONENTS)[number];
/** The ones that can break down and ground the aircraft; the interior and the paint only wear (and cost passengers). */
export const MECHANICAL = ['engines', 'gear', 'propellers', 'avionics'] as const;
export type Mechanical = (typeof MECHANICAL)[number];
export const isMechanical = (c: Component): c is Mechanical => (MECHANICAL as readonly string[]).includes(c);

/** B.6: the share of the aircraft's wear each component takes. Propellers (rotors) exist on turboprops and helicopters only. */
export const COMPONENT_WEIGHT: Record<Component, number> = { engines: 0.35, gear: 0.2, propellers: 0.1, avionics: 0.1, interior: 0.15, paint: 0.1 };
/** A component wears `WEAR_PCT_PER_HOUR[category] * weight * COMPONENT_WEAR_SCALE` percent per block hour. The scale is tuned so a mechanical component fails every 700 to 2 000 block hours. */
export const COMPONENT_WEAR_SCALE = 0.35;
const PROPELLED: readonly AircraftCategory[] = ['turboprop-single', 'turboprop-multi', 'turboprop-airliner', 'helicopter'];
export const componentsOf = (category: AircraftCategory): Component[] => COMPONENTS.filter((c) => c !== 'propellers' || PROPELLED.includes(category));
/** Percent of wear per block hour. */
export const componentRate = (c: Component, category: AircraftCategory): number => WEAR_PCT_PER_HOUR[category] * COMPONENT_WEIGHT[c] * COMPONENT_WEAR_SCALE;
export const componentWearAfter = (wear: number, c: Component, category: AircraftCategory, hours: number): number =>
  Math.min(100, Math.round((wear + componentRate(c, category) * hours) * 100) / 100);

/** A mechanical component at this wear has failed: the part is replaced (a breakdown), and the component starts again from RENEWED_WEAR_PCT. */
export const FAILURE_WEAR_PCT = 90;
export const RENEWED_WEAR_PCT = 10;
/** An overhaul brings a component back to this wear, a replacement to new. */
export const OVERHAUL_WEAR_PCT = 15;
export const REPLACED_WEAR_PCT = 0;
/** Seeded wear of an aircraft that comes with airframe hours (a lease offer): deterministic from the hours, somewhere in the component's life cycle (it has been overhauled or replaced along the way),
 *  never above SEED_WEAR_MAX_PCT. A new aircraft (no hours) starts at 0. */
export const SEED_WEAR_MAX_PCT = FAILURE_WEAR_PCT - 5;
export function seedWear(c: Component, category: AircraftCategory, airframeHours: number): number {
  if (airframeHours <= 0) return 0;
  const span = SEED_WEAR_MAX_PCT - RENEWED_WEAR_PCT;
  return Math.round((RENEWED_WEAR_PCT + ((airframeHours * componentRate(c, category)) % span)) * 10) / 10;
}

// ---------------------------------------------------------------- effects of wear (B.6) and what they cost

export type Effects = {
  /** Fraction of speed lost: the aircraft burns and wears more for the same stage. */
  performance: number;
  /** Points of reliability lost (delays and cancellations). */
  reliability: number;
  /** Points of passenger satisfaction lost (out of 5). */
  satisfaction: number;
  /** Fraction of passengers lost. */
  load: number;
};
export const NO_EFFECTS: Effects = { performance: 0, reliability: 0, satisfaction: 0, load: 0 };
/** What each component costs at 80 % wear (B.6: engines -3 % performance and +3 % fuel; gear -2 pts of reliability; avionics -3 pts; interior -0.5 satisfaction and -4 % load; paint -0.2). Linear in the wear. */
const EFFECTS_AT_80: Record<Component, Partial<Effects>> = {
  engines: { performance: 0.03 }, gear: { reliability: 2 }, propellers: { performance: 0.0125 }, avionics: { reliability: 3 },
  interior: { satisfaction: 0.6, load: 0.04 }, paint: { satisfaction: 0.28 },
};
export const WEAR_REFERENCE_PCT = 80;
export function wearEffects(c: Component, wear: number): Effects {
  const k = clamp(wear, 0, 100) / WEAR_REFERENCE_PCT, e = EFFECTS_AT_80[c];
  return { performance: (e.performance ?? 0) * k, reliability: (e.reliability ?? 0) * k, satisfaction: (e.satisfaction ?? 0) * k, load: (e.load ?? 0) * k };
}
export const addEffects = (list: readonly Effects[]): Effects =>
  list.reduce((t, e) => ({ performance: t.performance + e.performance, reliability: t.reliability + e.reliability, satisfaction: t.satisfaction + e.satisfaction, load: t.load + e.load }), NO_EFFECTS);

/** The best an aircraft can be once every component is new (the mockup: 91 % now, 96 % with the gear and the avionics put right; 3.4/5 now, 3.9 with the interior). */
export const BASE_RELIABILITY_PCT = 96;
export const BASE_SATISFACTION = 4.1;
/** Each reliability point lost raises the risk of an incident roll by this share (B.6: reliability feeds the incident roll); the mockup's 91 % against 96 % is +25 %. */
export const RELIABILITY_RISK_PER_PT = 0.05;
export const reliabilityRiskFactor = (reliabilityLost: number): number => 1 + RELIABILITY_RISK_PER_PT * reliabilityLost;
/** Money: one reliability point is 1.2 % of the revenue (delays, missed connections), one satisfaction point 4 % (the load-factor term of B.7), a lost passenger share is the same share of revenue, lost speed raises fuel and maintenance by 1/(1-p). */
export const REVENUE_PER_RELIABILITY_PT = 0.012;
export const REVENUE_PER_SATISFACTION_PT = 0.04;
/** Multipliers of a flight's money: `revenue` on the revenue, `cost` on its fuel and maintenance. */
export function moneyFactors(e: Effects): { revenue: number; cost: number } {
  return {
    revenue: Math.max(0, (1 - REVENUE_PER_RELIABILITY_PT * e.reliability) * (1 - REVENUE_PER_SATISFACTION_PT * e.satisfaction) * (1 - e.load)),
    cost: 1 / (1 - Math.min(0.5, e.performance)),
  };
}

export type Kpi = { performance: number; reliability: number; satisfaction: number; load: number };
/** What the aircraft is like with these effects: performance and load as fractions (-0.04), reliability in percent, satisfaction out of 5. */
export const kpiOf = (e: Effects): Kpi => ({ performance: -e.performance, reliability: BASE_RELIABILITY_PCT - e.reliability, satisfaction: BASE_SATISFACTION - e.satisfaction, load: -e.load });

/** The stage used to price an hour of the aircraft's work: a 200 NM leg (or four fifths of the range if shorter) at the mockup's 78 % load, earning what a line pays (AUTONOMY_FACTOR, B.8: a ground day is a day of line revenue). */
export const REFERENCE_STAGE_NM = 200;
export const REFERENCE_LOAD = 0.78;
/** What one block hour of the aircraft earns and what its fuel and maintenance cost, at the reference stage (a flown leg: the server computes it with `settle`). */
export type Economics = { revenuePerHour: number; costPerHour: number };
/** The mockup's assumption: 80 flight hours a month. */
export const HOURS_PER_MONTH = 80;
export const HOURS_PER_YEAR = HOURS_PER_MONTH * 12;
export const FLY_HOURS_PER_DAY = HOURS_PER_MONTH / 30;
/** Euros a month that wear takes off the aircraft: B.8 `effectSize * hoursPerMonth * revenuePerHour`. */
export function monthlyLoss(e: Effects, econ: Economics): number {
  const f = moneyFactors(e);
  return Math.round(HOURS_PER_MONTH * (econ.revenuePerHour * (1 - f.revenue) + econ.costPerHour * (f.cost - 1)));
}
/** B.8: one ground day is one day of the type's line revenue (a line earns AUTONOMY_FACTOR of what a flown job pays, for the HOURS_PER_MONTH the mockup assumes). */
export const groundDayValue = (econ: Economics): number => Math.round(econ.revenuePerHour * AUTONOMY_FACTOR * FLY_HOURS_PER_DAY);

// ---------------------------------------------------------------- refurbish, replace, and what it pays back

export const REFURB_ACTIONS = ['overhaul', 'replace'] as const;
export type RefurbAction = (typeof REFURB_ACTIONS)[number];
export type Choice = 'leave' | RefurbAction;
/** Cost as a share of what the aircraft is worth. */
const COST_SHARE: Record<RefurbAction, Record<Component, number>> = {
  overhaul: { engines: 0.1, gear: 0.03, propellers: 0.02, avionics: 0.04, interior: 0.04, paint: 0.01 },
  replace: { engines: 0.45, gear: 0.1, propellers: 0.12, avionics: 0.3, interior: 0.14, paint: 0.05 },
};
/** Days in the workshop; a visit takes the longest of its items (the mockup: six days for the gear, propellers, avionics and seats). */
export const REFURB_DAYS: Record<RefurbAction, Record<Component, number>> = {
  overhaul: { engines: 10, gear: 4, propellers: 3, avionics: 3, interior: 6, paint: 5 },
  replace: { engines: 21, gear: 8, propellers: 6, avionics: 7, interior: 10, paint: 8 },
};
export const refurbCost = (action: RefurbAction, c: Component, aircraftValue: number): number => round(aircraftValue * COST_SHARE[action][c], 50);
export const wearAfterAction = (action: Choice, current: number): number => (action === 'leave' ? current : action === 'overhaul' ? Math.min(current, OVERHAUL_WEAR_PCT) : REPLACED_WEAR_PCT);
/** The new parts that stay with whoever has the aircraft when the lease ends: handing it back leaves them to the lessor, buying it keeps them (the mockup: 51 000 of 110 500). */
export const KEEP_VALUE_SHARE = 0.46;
/** The horizon of an aircraft that is not on a lease, and the payback beyond which the screen says it never pays. */
export const HORIZON_MONTHS = 24;
export const NEVER_PAYBACK_MONTHS = 100;
/** B.4 (level 2 hangar: heavy checks without ferry): a visit longer than this is a heavy check, done at the base only if a staffed hangar of level 2 stands there; otherwise the aircraft is ferried to a
 *  workshop, which costs the convoy fee and FERRY_DAYS more. Shorter visits are done wherever the aircraft is: only an engine replacement is a heavy check; the mockup's six days for the gear, propellers, avionics and seats are not. */
export const HEAVY_CHECK_DAYS = 14;
export const FERRY_DAYS = 2;
export const isHeavyCheck = (itemDays: number): boolean => itemDays > HEAVY_CHECK_DAYS;
/** Days the aircraft is in the workshop: the longest item times the hangar's downtime factor (B.4: any staffed hangar halves it), plus the ferry of a heavy check without a level-2 hangar. */
export const worksDays = (itemDays: number, downtimeFactor: number, heavyHangar: boolean): number =>
  itemDays === 0 ? 0 : Math.ceil(itemDays * downtimeFactor) + (isHeavyCheck(itemDays) && !heavyHangar ? FERRY_DAYS : 0);

export type ChoiceView = {
  action: Choice; cost: number; wearAfter: number;
  /** What the component's wear takes a month once this choice is made. */
  monthlyLoss: number;
  /** Months to earn the cost back; null when it never does (no gain, or more than NEVER_PAYBACK_MONTHS). */
  paybackMonths: number | null;
  /** Over the months left: what is gained minus what is spent. On a lease this is the figure for handing the aircraft back (the new parts stay with the lessor). */
  net: number;
  /** The same when the aircraft is bought at the end of the lease: the new parts stay with the company (KEEP_VALUE_SHARE of what they cost). Equals `net` when the aircraft is not on a lease. */
  netIfBought: number;
  days: number;
};
/** `leased`: the aircraft is on a lease, so the new parts are only worth something to the company if it buys the aircraft at the end. */
export function choiceView(action: Choice, c: Component, wear: number, aircraftValue: number, econ: Economics, months: number, leased: boolean): ChoiceView {
  const cost = action === 'leave' ? 0 : refurbCost(action, c, aircraftValue), after = wearAfterAction(action, wear);
  const loss = monthlyLoss(wearEffects(c, after), econ), now = monthlyLoss(wearEffects(c, wear), econ), gain = now - loss;
  const payback = action === 'leave' || gain <= 0 ? null : Math.ceil(cost / gain);
  const base = action === 'leave' ? 0 : gain * months - cost, kept = action === 'leave' ? 0 : Math.round(cost * KEEP_VALUE_SHARE);
  return {
    action, cost, wearAfter: after, monthlyLoss: loss, paybackMonths: payback !== null && payback <= NEVER_PAYBACK_MONTHS ? payback : null,
    net: base, netIfBought: leased ? base + kept : base, days: action === 'leave' ? 0 : REFURB_DAYS[action][c],
  };
}
/** The recommended choice of a component: the one with the best net over the months left, and only if it is positive. */
export const bestChoice = (choices: Record<Choice, ChoiceView>): Choice =>
  (['overhaul', 'replace'] as const).reduce<Choice>((b, a) => (choices[a].net > choices[b].net ? a : b), 'leave');

export type Selection = { component: Component; action: Choice }[];
export type Totals = {
  /** The items' price and the longest item, in days, before the hangar's factor (`WearView.works` has the real days). */
  cost: number; itemDays: number;
  /** Net over the months left if the aircraft is handed back / bought (equal when it is owned). */
  give: number; buy: number;
  /** Cumulative cash at the end of each month (month 1 first): what the works cost, then what they save. */
  cashCurve: number[]; breakEvenMonth: number | null;
};
export function refurbTotals(rows: readonly { component: Component; choices: Record<Choice, ChoiceView> }[], selection: Selection, months: number): Totals {
  let cost = 0, itemDays = 0, give = 0, buy = 0, gain = 0;
  for (const s of selection) {
    const row = rows.find((r) => r.component === s.component);
    if (!row || s.action === 'leave') continue;
    const c = row.choices[s.action];
    cost += c.cost; itemDays = Math.max(itemDays, c.days); give += c.net; buy += c.netIfBought; gain += row.choices.leave.monthlyLoss - c.monthlyLoss;
  }
  const cashCurve = Array.from({ length: Math.max(0, months) }, (_, i) => gain * (i + 1) - cost);
  const first = cashCurve.findIndex((v) => v >= 0);
  return { cost, itemDays, give, buy, cashCurve, breakEvenMonth: cost === 0 || first < 0 ? null : first + 1 };
}

// ---------------------------------------------------------------- spare parts

/** Catalogue classes by the size of the machine: B.6 sketched piston, ATR-class and jet; the mockup also has a Caravan, whose parts cost a twentieth of an ATR's. */
export const PART_CLASSES = ['piston', 'turboprop', 'regional', 'jet'] as const;
export type PartClass = (typeof PART_CLASSES)[number];
export const partClassOf = (category: AircraftCategory): PartClass =>
  category === 'turboprop-airliner' ? 'regional' : category.startsWith('jet') ? 'jet' : category.startsWith('turboprop') || category === 'helicopter' ? 'turboprop' : 'piston';
export const PART_KINDS = ['engine', 'starter', 'propeller', 'avionics', 'brake', 'wheel'] as const;
export type PartKind = (typeof PART_KINDS)[number];
/** The parts whose failure is a failure of this component; a breakdown picks one of them (seeded). */
export const PARTS_OF_COMPONENT: Record<Mechanical, readonly PartKind[]> = { engines: ['engine', 'starter'], gear: ['brake', 'wheel'], propellers: ['propeller'], avionics: ['avionics'] };

export type CatalogPart = { id: string; cls: PartClass; kind: PartKind; name: string; price: number; critical: number; full: number };
const part = (cls: PartClass, kind: PartKind, name: string, price: number, critical: number, full: number): CatalogPart => ({ id: `${cls}.${kind}`, cls, kind, name, price, critical, full });
/** Unit prices and kit quantities. The regional class is the mockup's ATR (full kit 382 500: engine module 245 000, 2 blades 37 000, 2 computers 36 500, starter-generator 32 000, 2 brakes 19 600, 4 wheels 12 400);
 *  the jet class its A220 (critical kit 65 000: MAU 30 800, brake 24 600, 2 wheels 9 600) and CRJ (starter 31 000); the turboprop class its Caravan (critical kit: the 18 400 fuel regulator). The rest is estimated. */
export const PARTS: readonly CatalogPart[] = [
  part('piston', 'engine', 'Engine overhaul exchange', 12_000, 0, 1), part('piston', 'starter', 'Starter and alternator', 650, 1, 1), part('piston', 'propeller', 'Propeller', 3_600, 0, 1),
  part('piston', 'avionics', 'Avionics unit', 2_400, 0, 1), part('piston', 'brake', 'Brake set', 280, 1, 2), part('piston', 'wheel', 'Wheel and tyre', 150, 2, 3),
  part('turboprop', 'engine', 'PT6A engine module, exchange', 280_000, 0, 1), part('turboprop', 'starter', 'Fuel regulator', 18_400, 1, 1), part('turboprop', 'propeller', 'Propeller', 9_800, 0, 1),
  part('turboprop', 'avionics', 'Avionics unit', 7_400, 0, 1), part('turboprop', 'brake', 'Brake set', 2_300, 0, 2), part('turboprop', 'wheel', 'Wheel and tyre', 650, 0, 4),
  part('regional', 'engine', 'PW127M engine module, exchange', 245_000, 0, 1), part('regional', 'starter', 'Starter-generator', 32_000, 1, 1), part('regional', 'propeller', 'Propeller blade', 18_500, 0, 2),
  part('regional', 'avionics', 'ADC and VHF computer', 18_250, 1, 2), part('regional', 'brake', 'Carbon brake', 9_800, 1, 2), part('regional', 'wheel', 'Main wheel and tyre', 3_100, 2, 4),
  part('jet', 'engine', 'Engine module, exchange', 900_000, 0, 1), part('jet', 'starter', 'Engine starter', 31_000, 0, 1), part('jet', 'avionics', 'MAU avionics module', 30_800, 1, 2),
  part('jet', 'brake', 'Carbon brake', 24_600, 1, 2), part('jet', 'wheel', 'Main wheel and tyre', 4_800, 2, 4),
];
export const partById = (id: string): CatalogPart | undefined => PARTS.find((p) => p.id === id);
export const partFor = (cls: PartClass, kind: PartKind): CatalogPart | undefined => PARTS.find((p) => p.cls === cls && p.kind === kind);

export const PARTS_POLICIES = ['none', 'critical', 'full'] as const;
export type PartsPolicy = (typeof PARTS_POLICIES)[number];
export type KitLine = { part: CatalogPart; qty: number };
export const kitOf = (cls: PartClass, policy: PartsPolicy): KitLine[] =>
  policy === 'none' ? [] : PARTS.filter((p) => p.cls === cls && p[policy] > 0).map((p) => ({ part: p, qty: p[policy] }));
export const kitCapital = (cls: PartClass, policy: PartsPolicy): number => kitOf(cls, policy).reduce((t, l) => t + l.part.price * l.qty, 0);

// ---------------------------------------------------------------- breakdowns: with the part on the shelf, or days of waiting

/** B.6: with the part in stock the repair takes six hours (four in a hangar of level 2 that is fully staffed, B.4), without it the aircraft waits for the delivery. */
export const FIX_HOURS_WITH_PART = 6;
export const HANGAR_FIX_HOURS = 4;
export const DELIVERY_DAYS = [2, 3, 4, 5] as const;
export const MEAN_DELIVERY_DAYS = DELIVERY_DAYS.reduce((a, b) => a + b, 0) / DELIVERY_DAYS.length;
export const EXPRESS_DAYS = 1;
/** Freight on a part ordered in a hurry (the mockup: 2 900 euros of express freight for a Caravan regulator); a part for a grounded aircraft always pays at least the normal rate. */
export const TRANSPORT_COST: Record<PartClass, { normal: number; express: number }> = {
  piston: { normal: 80, express: 400 }, turboprop: { normal: 450, express: 2_900 }, regional: { normal: 1_200, express: 6_500 }, jet: { normal: 2_000, express: 9_000 },
};
/** Surplus stock sells for this share of its price (the mockup: "revendable 80 %"). */
export const PARTS_RESALE_FACTOR = 0.8;
export const MAX_ORDER_QTY = 20;
/** `unit` is a draw in [0, 1). */
export const deliveryDays = (unit: number): number => DELIVERY_DAYS[Math.min(DELIVERY_DAYS.length - 1, Math.floor(unit * DELIVERY_DAYS.length))]!;
export function failedPart(cls: PartClass, c: Mechanical, unit: number): CatalogPart {
  const kinds = PARTS_OF_COMPONENT[c];
  return partFor(cls, kinds[Math.min(kinds.length - 1, Math.floor(unit * kinds.length))]!)!;
}
/** B.4, hangar level 2: a fully staffed hangar of at least this level at the aircraft's base fixes an AOG in four hours and does heavy checks without a ferry. */
export const HEAVY_HANGAR_LEVEL = 2;
/** `heavyHangar`: such a hangar stands at the aircraft's base. */
export const fixHours = (heavyHangar: boolean): number => (heavyHangar ? HANGAR_FIX_HOURS : FIX_HOURS_WITH_PART);

/** Breakdowns a year for one aircraft flown `hoursPerYear`: each mechanical component fails every (FAILURE - RENEWED) / rate hours. */
const failuresOf = (c: Mechanical, category: AircraftCategory, hoursPerYear: number): number => (componentRate(c, category) * hoursPerYear) / (FAILURE_WEAR_PCT - RENEWED_WEAR_PCT);
const mechanicalOf = (category: AircraftCategory): Mechanical[] => componentsOf(category).filter(isMechanical);
export const failuresPerYear = (category: AircraftCategory, hoursPerYear = HOURS_PER_YEAR): number => mechanicalOf(category).reduce((t, c) => t + failuresOf(c, category, hoursPerYear), 0);
/** B.6: expected ground days a year `≈ failuresPerYear * downtime`. A breakdown of a component picks one of its parts with equal odds; the downtime is the fix when that part is on the shelf
 *  (`covers(kind)`), the mean delivery plus the fix otherwise. */
export function groundDaysPerYear(category: AircraftCategory, covers: (kind: PartKind) => boolean, hoursPerYear = HOURS_PER_YEAR): number {
  const fix = FIX_HOURS_WITH_PART / 24;
  return mechanicalOf(category).reduce((t, c) => {
    const kinds = PARTS_OF_COMPONENT[c];
    return t + failuresOf(c, category, hoursPerYear) * (kinds.reduce((d, k) => d + (covers(k) ? fix : MEAN_DELIVERY_DAYS + fix), 0) / kinds.length);
  }, 0);
}
/** The kinds a kit holds. */
export const kitCovers = (cls: PartClass, policy: PartsPolicy): ((kind: PartKind) => boolean) => {
  const kinds = new Set(kitOf(cls, policy).map((l) => l.part.kind));
  return (k) => kinds.has(k);
};

// ---------------------------------------------------------------- request schemas

const typeCode = z.string().regex(/^[A-Z0-9]{2,4}$/, 'ICAO type designator: 2-4 chars A-Z/0-9');
export const policyBodySchema = z.object({ icao: typeCode, policy: z.enum(PARTS_POLICIES) });
export const orderBodySchema = z.object({ partId: z.string().regex(/^[a-z]+\.[a-z]+$/), qty: z.int().min(1).max(MAX_ORDER_QTY), express: z.boolean().optional() });
/** `?pick=gear:overhaul,avionics:replace` previews a selection of the wear screen. */
export const wearQuerySchema = z.object({
  pick: z.string().max(200).optional().transform((v, ctx) => {
    if (v === undefined || v === '') return undefined;
    const out: Selection = [];
    for (const part of v.split(',')) {
      const [component, action] = part.split(':');
      if (!(COMPONENTS as readonly string[]).includes(component ?? '') || !['leave', ...REFURB_ACTIONS].includes(action ?? '') || out.some((s) => s.component === component)) {
        ctx.addIssue({ code: 'custom', message: `bad pick "${part}": component:leave|overhaul|replace, once per component` });
        return z.NEVER;
      }
      out.push({ component: component as Component, action: action as Choice });
    }
    return out;
  }),
});
export const refurbishBodySchema = z.object({
  items: z.array(z.object({ component: z.enum(COMPONENTS), action: z.enum(REFURB_ACTIONS) })).min(1).max(COMPONENTS.length),
}).refine((b) => new Set(b.items.map((i) => i.component)).size === b.items.length, { message: 'one action per component' });

// ---------------------------------------------------------------- wire types

export type ComponentWear = {
  component: Component; wearPct: number; effects: Effects;
  /** The workshop is working on it until this instant. */
  worksUntil: number | null;
  choices: Record<Choice, ChoiceView>;
};
export type WearView = {
  aircraft: { id: number; registration: string; icao: string; typeName: string; ownership: string; value: number; wearPct: number };
  /** False when the company plays without wear and failures: nothing wears, nothing breaks down, and the works are refused. */
  active: boolean;
  /** The company can send it to the workshop: it is hers (owned, financed or leased) and wear is on. */
  refurbishable: boolean;
  lease: { endsAt: number | null; monthsLeft: number; purchaseOptionPrice: number; maintenanceIncluded: boolean; lessor: string | null } | null;
  /** The months the gains are counted over: the months left on a lease, else HORIZON_MONTHS. */
  months: number;
  hoursPerMonth: number;
  components: ComponentWear[];
  /** The aircraft as it is, and as it would be after `selection` (the recommended choices unless `?pick=` asks for others). */
  kpi: { now: Kpi; after: Kpi };
  recommended: Selection;
  selection: Selection;
  totals: Totals;
  /** The works of the selection where the aircraft is based: the hangar's factor, and the ferry of a heavy check when no staffed level-2 hangar stands at its base. */
  works: { days: number; downtimeFactor: number; heavyHangar: boolean; ferry: boolean; ferryCost: number };
  /** Cash after the works (the selection's cost and the ferry). */
  balanceAfter: number;
};
/** `cost` is the items and the ferry together. */
export type RefurbishResult = { cost: number; ferry: number; downUntil: number; balanceAfter: number; items: { component: Component; action: RefurbAction; cost: number }[] };

export type StockLine = {
  part: string; name: string; cls: PartClass; kind: PartKind; unitPrice: number;
  qty: number; inTransit: number; value: number;
  /** What the policies of the hub's types ask the shelf to hold. */
  target: number;
};
export type OrderLine = { id: number; part: string; name: string; qty: number; orderedAt: number; eta: number; cost: number; express: boolean };
export type PartsPolicyOption = { policy: PartsPolicy; capital: number; groundDays: number };
export type TypePolicy = {
  icao: string; name: string; cls: PartClass; aircraft: { id: number; registration: string }[];
  policy: PartsPolicy; dayValue: number;
  /** Per aircraft of the type: breakdowns a year, and the ground days a year with each policy. */
  failuresPerYear: number;
  options: PartsPolicyOption[];
  /** The ground days a year of the whole type with what is on the shelf now (not with what the policy asks: the shelf can be short of it). */
  expectedGroundDays: number;
  /** The shelf holds the type's critical kit. */
  covered: boolean;
};
export type AogCase = {
  aircraftId: number; registration: string; icao: string; typeName: string; component: Mechanical;
  part: string; partName: string; failedAt: number; eta: number;
  /** The aircraft flies again at this instant (the delivery and the fix). `fromStock`: the part was on the shelf, so this is the six hours (or four) of the repair. */
  readyAt: number; fromStock: boolean;
  /** Euros of flying lost by this breakdown from the failure to `readyAt`, and the euros a day. */
  lost: number; dayValue: number;
  /** What the part cost with the freight. */
  paid: number;
  /** With the part on the shelf the aircraft would be back at this instant. */
  withPartBackAt: number;
  /** The critical kit of the type: what it ties up. */
  criticalKit: number;
};
export type WarehouseView = {
  hub: string;
  /** The shelf needs no building (S3's catalogue has no cargo hall to rent): always null, kept for the B.6 contract. */
  facility: null;
  active: boolean;
  /** Value of the shelf, its share of the balance (a fraction), and what is on its way (paid, not yet immobilised). */
  capital: number; capitalShare: number; onOrder: number; balance: number;
  expectedGroundDays: number;
  covered: { count: number; of: number };
  aog: AogCase | null;
  policies: TypePolicy[];
  inventory: StockLine[];
  orders: OrderLine[];
};
/** `capital` is what the type's kit ties up under the new policy, `ordered` what the change bought (kits come without freight, delivered in 2 to 5 days), `refund` what the parts of the class that no policy asks for any more sold for; `deltaGroundDays` the change in expected ground days a year of the hub (negative: fewer), `annualSaving` what those days are worth. */
export type PolicyResult = { icao: string; policy: PartsPolicy; capital: number; deltaGroundDays: number; annualSaving: number; ordered: number; refund: number; balanceAfter: number };
export type OrderResult = { order: OrderLine; cost: number; balanceAfter: number };

export const MONTH_MS = 30.4375 * DAY_MS;
