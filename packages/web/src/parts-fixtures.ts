import type { ChoiceOption, ChoiceTable, ComponentId, StockLine, TypePolicy, WarehouseView, WearView } from './api-parts.ts';

/** The mockup's Nice warehouse and its leased Twin Otter, as S5's routes answer them (B.6). Used by the view-model tests and to look at the screens before S5 is merged; never shipped to the UI. */

const opts = (none: number, critical: [number, number], full: [number, number]): TypePolicy['options'] => ({
  none: { capital: 0, groundDays: none }, critical: { capital: critical[0], groundDays: critical[1] }, full: { capital: full[0], groundDays: full[1] },
});

export const POLICIES: TypePolicy[] = [
  { icao: 'AT76', typeName: 'ATR 72-600', registrations: ['F-HAZA', 'F-HAZB', 'F-HAZR'], policy: 'full', groundDayValue: 9_800, options: opts(14, [301_000, 7], [382_500, 4]) },
  { icao: 'BCS3', typeName: 'A220-300', registrations: ['F-HAZD'], policy: 'critical', groundDayValue: 14_200, options: opts(13, [65_000, 5], [118_000, 3]) },
  { icao: 'CRJ7', typeName: 'CRJ700', registrations: ['F-HAZC'], policy: 'critical', groundDayValue: 8_600, options: opts(11, [33_900, 4], [71_000, 3]) },
  { icao: 'C208', typeName: 'Grand Caravan', registrations: ['F-HAZF'], policy: 'none', groundDayValue: 3_400, options: opts(11, [18_400, 3], [27_000, 2]) },
];

const line = (icao: string, partId: string, name: string, qty: number, value: number): StockLine => ({ icao, partId, name, qty, value });
export const INVENTORY: StockLine[] = [
  line('AT76', 'engine-module', 'Module moteur PW127M · échange standard', 1, 245_000), line('AT76', 'prop-blade', 'Pale d’hélice', 2, 37_000),
  line('AT76', 'avionics-unit', 'Calculateurs avionique ADC et VHF', 2, 36_500), line('AT76', 'starter-generator', 'Démarreur-génératrice', 1, 32_000),
  line('AT76', 'carbon-brake', 'Frein carbone', 2, 19_600), line('AT76', 'main-wheel', 'Roue et pneu de train principal', 4, 12_400),
  line('BCS3', 'mau', 'Module avionique MAU', 1, 30_800), line('BCS3', 'carbon-brake', 'Frein carbone', 1, 24_600), line('BCS3', 'main-wheel', 'Roue et pneu de train principal', 2, 9_600),
  line('CRJ7', 'starter', 'Démarreur moteur', 1, 31_000), line('CRJ7', 'main-wheel', 'Roue et pneu de train principal', 1, 2_900),
];

const FAILED = Date.UTC(2026, 10, 3, 18, 40);
export const NOW = Date.UTC(2026, 10, 6, 17, 58);
export const WAREHOUSE: WarehouseView = {
  facility: { name: 'Zone fret Ouest', areaM2: 380, monthly: 4_200 },
  capital: 481_400, capitalShare: 0.37, expectedGroundDays: 24, covered: { count: 5, of: 6 },
  aog: { registration: 'F-HAZF', icao: 'C208', failedAt: FAILED, failure: 'Panne moteur', partName: 'régulateur carburant PT6A', eta: Date.UTC(2026, 10, 7, 14), expressCost: 2_900 },
  policies: POLICIES, inventory: INVENTORY,
};

// ---------------------------------------------------------------- the leased DHC-6

const o = (cost: number, monthlyGain: number, paybackMonths: number | null, netReturn: number, netBuy: number, downDays = 6): ChoiceOption => ({ cost, monthlyGain, paybackMonths, downDays, netReturn, netBuy });
const leave: ChoiceOption = { cost: 0, monthlyGain: 0, paybackMonths: null, downDays: 0, netReturn: 0, netBuy: 0 };
const row = (overhaul: ChoiceOption, replace: ChoiceOption): ChoiceTable[ComponentId] => ({ leave, overhaul, replace });

export const CHOICES: ChoiceTable = {
  engines: row(o(64_000, 0, null, -64_000, -64_000, 14), o(1_180_000, 0, null, -1_180_000, -1_180_000, 30)),
  gear: row(o(18_500, 2_600, 8, 43_900, 52_900), o(96_000, 2_600, 37, -33_600, 0, 9)),
  propellers: row(o(14_000, 1_400, 10, 19_600, 27_600), o(116_000, 1_400, 83, -82_400, 0, 9)),
  avionics: row(o(42_000, 2_800, 15, 25_200, 45_200), o(310_000, 2_800, null, -242_800, -50_000, 9)),
  interior: row(o(36_000, 4_100, 9, 62_400, 76_400), o(128_000, 4_100, 32, -29_600, 0, 9)),
  paint: row(o(9_000, 500, 18, 3_000, 9_000), o(48_000, 500, null, -36_000, 0, 9)),
};

export const WEAR: WearView = {
  aircraft: { id: 12, registration: 'F-HAZG', typeName: 'DHC-6 Twin Otter 400', hub: 'LFMN', year: 2015, airframeHours: 6_840, lessor: 'Viking Air Leasing', monthsLeft: 24, endsAt: Date.UTC(2028, 9, 31), purchaseOptionPrice: 2_650_000, hoursPerMonth: 80 },
  components: [
    { component: 'engines', wearPct: 81, effect: { kind: 'performance', value: 3, fuelPct: 3 }, refurbUntil: null, suggested: 'leave', detail: '2 910 h depuis révision, sur 3 600' },
    { component: 'gear', wearPct: 76, effect: { kind: 'reliability', value: 2 }, refurbUntil: null, suggested: 'overhaul' },
    { component: 'propellers', wearPct: 64, effect: { kind: 'performance', value: 1 }, refurbUntil: null, suggested: 'overhaul' },
    { component: 'avionics', wearPct: 70, effect: { kind: 'reliability', value: 3 }, refurbUntil: null, suggested: 'overhaul' },
    { component: 'interior', wearPct: 68, effect: { kind: 'satisfaction', value: 0.5, loadPct: 4 }, refurbUntil: null, suggested: 'overhaul' },
    { component: 'paint', wearPct: 58, effect: { kind: 'satisfaction', value: 0.2 }, refurbUntil: null, suggested: 'leave' },
  ],
  effects: { reliability: 91, satisfaction: 3.4 },
  choices: CHOICES,
  totals: { give: 151_100, buy: 202_100, cashCurve: [] },
  balanceAfter: 1_174_060,
};
