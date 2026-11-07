import type { AogCase, Choice, ChoiceView, Component, ComponentWear, Effects, PartsPolicy, StockLine, TypePolicy, WarehouseView, WearView } from './api-parts.ts';

/** Near the mockup's Nice warehouse and leased Twin Otter, in the shapes S5's routes answer (B.6, `shared/src/parts.ts`). Used by the view-model tests and to look at the screens before S5 is merged; never shipped to the UI. */

const opts = (none: number, critical: [number, number], full: [number, number]): TypePolicy['options'] => [
  { policy: 'none', capital: 0, groundDays: none }, { policy: 'critical', capital: critical[0], groundDays: critical[1] }, { policy: 'full', capital: full[0], groundDays: full[1] },
];
const type = (icao: string, name: string, cls: TypePolicy['cls'], regs: string[], policy: PartsPolicy, dayValue: number, options: TypePolicy['options'], expectedGroundDays: number, covered: boolean): TypePolicy =>
  ({ icao, name, cls, aircraft: regs.map((registration, i) => ({ id: i + 1, registration })), policy, dayValue, failuresPerYear: 2, options, expectedGroundDays, covered });

export const POLICIES: TypePolicy[] = [
  type('AT76', 'ATR 72-600', 'regional', ['F-HAZA', 'F-HAZB', 'F-HAZR'], 'full', 9_800, opts(14, [301_000, 7], [382_500, 4]), 4, true),
  type('BCS3', 'A220-300', 'jet', ['F-HAZD'], 'critical', 14_200, opts(13, [65_000, 5], [118_000, 3]), 5, true),
  type('CRJ7', 'CRJ700', 'jet', ['F-HAZC'], 'critical', 8_600, opts(11, [65_000, 4], [118_000, 3]), 4, true),
  type('C208', 'Grand Caravan', 'turboprop', ['F-HAZF'], 'none', 3_400, opts(11, [18_400, 3], [27_000, 2]), 11, false),
];

const line = (part: string, name: string, cls: StockLine['cls'], kind: StockLine['kind'], unitPrice: number, qty: number, inTransit = 0): StockLine =>
  ({ part, name, cls, kind, unitPrice, qty, inTransit, value: unitPrice * qty, target: qty });
export const INVENTORY: StockLine[] = [
  line('regional.engine', 'Module moteur PW127M · échange standard', 'regional', 'engine', 245_000, 1), line('regional.propeller', 'Pale d’hélice', 'regional', 'propeller', 18_500, 2),
  line('regional.avionics', 'Calculateur avionique ADC et VHF', 'regional', 'avionics', 18_250, 2), line('regional.starter', 'Démarreur-génératrice', 'regional', 'starter', 32_000, 1),
  line('regional.brake', 'Frein carbone', 'regional', 'brake', 9_800, 2), line('regional.wheel', 'Roue et pneu de train principal', 'regional', 'wheel', 3_100, 4),
  line('jet.avionics', 'Module avionique MAU', 'jet', 'avionics', 30_800, 1), line('jet.brake', 'Frein carbone', 'jet', 'brake', 24_600, 1), line('jet.wheel', 'Roue et pneu de train principal', 'jet', 'wheel', 4_800, 2, 1),
];

const FAILED = Date.UTC(2026, 10, 3, 18, 40);
export const NOW = Date.UTC(2026, 10, 6, 17, 58);
const ETA = Date.UTC(2026, 10, 7, 14);
export const AOG: AogCase = {
  aircraftId: 6, registration: 'F-HAZF', icao: 'C208', typeName: 'Grand Caravan', component: 'engines', part: 'turboprop.starter', partName: 'régulateur carburant PT6A',
  failedAt: FAILED, eta: ETA, readyAt: ETA + 6 * 3_600_000, fromStock: false, lost: 14_076, dayValue: 3_400, paid: 21_300, withPartBackAt: FAILED + 6 * 3_600_000, criticalKit: 18_400,
};
const shelf = INVENTORY.reduce((s, l) => s + l.value, 0);
export const WAREHOUSE: WarehouseView = {
  hub: 'LFMN', facility: null, active: true, capital: shelf, capitalShare: 0.35, onOrder: 4_800, balance: 1_284_560,
  expectedGroundDays: 24, covered: { count: 5, of: 6 }, aog: AOG, policies: POLICIES, inventory: INVENTORY, orders: [],
};

// ---------------------------------------------------------------- the leased DHC-6

const fx = (e: Partial<Effects>): Effects => ({ performance: 0, reliability: 0, satisfaction: 0, load: 0, ...e });
const choices = (loss: number, overhaul: [number, number | null, number, number, number], replace: [number, number | null, number, number, number]): Record<Choice, ChoiceView> => {
  const c = (action: Choice, cost: number, monthlyLoss: number, paybackMonths: number | null, net: number, netIfBought: number, days: number): ChoiceView => ({ action, cost, wearAfter: 0, monthlyLoss, paybackMonths, net, netIfBought, days });
  return {
    leave: c('leave', 0, loss, null, 0, 0, 0),
    overhaul: c('overhaul', overhaul[0], 0, overhaul[1], overhaul[2], overhaul[3], overhaul[4]),
    replace: c('replace', replace[0], 0, replace[1], replace[2], replace[3], replace[4]),
  };
};
const part = (component: Component, wearPct: number, effects: Effects, loss: number, overhaul: Parameters<typeof choices>[1], replace: Parameters<typeof choices>[2]): ComponentWear =>
  ({ component, wearPct, effects, worksUntil: null, choices: choices(loss, overhaul, replace) });

const COMPONENTS: ComponentWear[] = [
  part('engines', 81, fx({ performance: 0.03 }), 0, [64_000, null, -64_000, -64_000, 10], [1_180_000, null, -1_180_000, -1_180_000, 21]),
  part('gear', 76, fx({ reliability: 2 }), 2_600, [18_500, 8, 43_900, 52_900, 4], [96_000, 37, -33_600, 0, 8]),
  part('propellers', 64, fx({ performance: 0.01 }), 1_400, [14_000, 10, 19_600, 27_600, 3], [116_000, 83, -82_400, 0, 6]),
  part('avionics', 70, fx({ reliability: 3 }), 2_800, [42_000, 15, 25_200, 45_200, 3], [310_000, null, -242_800, -50_000, 7]),
  part('interior', 68, fx({ satisfaction: 0.5, load: 0.04 }), 4_100, [36_000, 9, 62_400, 76_400, 6], [128_000, 32, -29_600, 0, 10]),
  part('paint', 58, fx({ satisfaction: 0.2 }), 500, [9_000, 18, 3_000, 9_000, 5], [48_000, null, -36_000, 0, 8]),
];
const RECOMMENDED = [{ component: 'gear', action: 'overhaul' }, { component: 'propellers', action: 'overhaul' }, { component: 'avionics', action: 'overhaul' }, { component: 'interior', action: 'overhaul' }] as const;
const GAIN = 10_900;

export const WEAR: WearView = {
  aircraft: { id: 12, registration: 'F-HAZG', icao: 'DHC6', typeName: 'DHC-6 Twin Otter 400', ownership: 'leased', value: 1_850_000, wearPct: 70 },
  active: true, refurbishable: true,
  lease: { endsAt: Date.UTC(2028, 9, 31), monthsLeft: 24, purchaseOptionPrice: 2_650_000, maintenanceIncluded: true, lessor: 'Viking Air Leasing' },
  months: 24, hoursPerMonth: 80, components: COMPONENTS,
  kpi: { now: { performance: -0.04, reliability: 91, satisfaction: 3.4, load: -0.04 }, after: { performance: -0.03, reliability: 96, satisfaction: 3.9, load: 0 } },
  recommended: [...RECOMMENDED], selection: [...RECOMMENDED],
  totals: { cost: 110_500, itemDays: 6, give: 151_100, buy: 202_100, cashCurve: Array.from({ length: 24 }, (_, i) => GAIN * (i + 1) - 110_500), breakEvenMonth: 11 },
  works: { days: 3, downtimeFactor: 0.5, heavyHangar: false, ferry: false, ferryCost: 0 },
  balanceAfter: 1_174_060,
};
