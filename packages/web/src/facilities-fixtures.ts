import type { Building, FacilityDetail, FacilityLevelInfo, FacilityView, HubOverview, HubPlan, HubsOverview } from './api-facilities.ts';

/** The mockup's Nice and Lyon, as S3's routes answer them (B.4). Used by the view-model tests and to look at the screens before S3 is merged; never shipped to the UI. */

const view = (o: Partial<FacilityView> & Pick<FacilityView, 'id' | 'slot' | 'name' | 'kind'>): FacilityView => ({
  hub: 'LFMN', effect: 'none', areaM2: 4_200, owner: 'available', ownerName: null, rent: 0, level: 1, maxLevel: 1, contract: null, works: null, nextLevelAt: null, understaffed: false, monthly: 0, ...o,
});
const lease = (monthly: number, startedAt = Date.parse('2026-02-06T00:00:00Z')) => ({ id: 1, kind: 'lease' as const, startedAt, months: 36, monthsPaid: 9, monthly, upkeep: 0, deposit: monthly * 2, price: 0, principal: 0, noticeMonths: 3, levelSince: startedAt });
const bought = { id: 2, kind: 'purchase' as const, startedAt: Date.parse('2025-09-06T00:00:00Z'), months: null, monthsPaid: 0, monthly: 0, upkeep: 2_400, deposit: 0, price: 2_350_000, principal: 0, noticeMonths: 0, levelSince: Date.parse('2025-09-06T00:00:00Z') };

export const LFMN_FACILITIES: FacilityView[] = [
  view({ id: 1, slot: 'T1', name: 'Terminal 1', kind: 'terminal', owner: 'airport', areaM2: 9_300 }),
  view({ id: 2, slot: 'T2', name: 'Terminal 2', kind: 'terminal', owner: 'airport', areaM2: 11_200 }),
  view({ id: 3, slot: 'VIP', name: "Terminal aviation d'affaires", kind: 'terminal', owner: 'airport', areaM2: 2_000 }),
  view({ id: 4, slot: 'MX1', name: 'Hangar de maintenance 1', kind: 'maintenance', effect: 'hangar', owner: 'player', contract: bought, monthly: 2_400, maxLevel: 3, areaM2: 4_400, rent: 18_500 }),
  view({ id: 5, slot: 'MX2', name: 'Hangar de maintenance 2', kind: 'maintenance', effect: 'hangar', areaM2: 6_200, rent: 18_500, maxLevel: 3 }),
  view({ id: 6, slot: 'CG1', name: 'Fret & stockage', kind: 'cargo', owner: 'ai', ownerName: 'Méridia Cargo', areaM2: 3_200 }),
  view({ id: 7, slot: 'AD', name: 'Bureaux administratifs', kind: 'office', effect: 'desks', owner: 'player', contract: lease(6_200), monthly: 6_200, areaM2: 1_400, rent: 6_200, maxLevel: 3 }),
  view({ id: 8, slot: 'OPS', name: "Centre d'opérations", kind: 'office', effect: 'ops', rent: 9_800, areaM2: 1_100 }),
  view({ id: 9, slot: 'TWR', name: 'Tour de contrôle', kind: 'airport', owner: 'airport', areaM2: 100 }),
  view({ id: 10, slot: 'FUEL', name: 'Dépôt carburant', kind: 'airport', owner: 'airport', areaM2: 1_300 }),
];

export const LFMN: HubOverview = {
  icao: 'LFMN', name: "Nice Côte d'Azur", city: 'Nice', role: 'main', layout: 'LFMN', facilities: LFMN_FACILITIES.filter((f) => f.owner === 'player' || f.owner === 'available'), monthlyCost: 24_200,
  team: { total: 37, byFamily: { pilot: 14, cabin: 9, maintenance: 7, ground: 4, admin: 3 } },
  aircraft: [
    { id: 1, reg: 'F-HAZR', icao: 'AT76', typeName: 'ATR 72-600', status: 'flying', location: 'LFMN', maintenanceUntil: null },
    { id: 2, reg: 'F-HAZB', icao: 'AT76', typeName: 'ATR 72-600', status: 'available', location: 'LFMN', maintenanceUntil: null },
    { id: 4, reg: 'F-HAZT', icao: 'AT46', typeName: 'ATR 42-600', status: 'available', location: 'LFMN', maintenanceUntil: null },
  ],
  renewals: [{ facilityId: 7, name: 'Bureaux administratifs', before: Date.parse('2027-01-31T00:00:00Z') }],
  parking: { spots: 6, used: 4, monthly: 15_600 },
};
export const LFLL: HubOverview = {
  icao: 'LFLL', name: 'Lyon-Saint-Exupéry', city: 'Lyon', role: 'secondary', layout: null, monthlyCost: 8_600,
  facilities: [view({ id: 20, hub: 'LFLL', slot: 'AG', name: "Bureau d'escale", kind: 'office', effect: 'desks', owner: 'player', contract: lease(6_800), monthly: 6_800, rent: 6_800 })],
  team: { total: 7, byFamily: { ground: 4, pilot: 3 } },
  aircraft: [{ id: 5, reg: 'F-HAZC', icao: 'CRJ7', typeName: 'CRJ700', status: 'maintenance', location: 'LFLL', maintenanceUntil: Date.parse('2026-11-08T00:00:00Z') }],
  renewals: [], parking: { spots: 2, used: 1, monthly: 1_800 },
};
export const OVERVIEW: HubsOverview = {
  company: { name: 'Azur Régional', hubs: 2, aircraft: 4, employees: 44 }, monthlyCost: 32_800, hubs: [LFMN, LFLL],
  suggestion: { icao: 'LFKJ', flightsPerWeek: 12, fromMonthly: 5_400 },
};

const building = (f: FacilityView): Building => ({ slot: f.slot, facilityId: f.id, name: f.name, kind: f.kind, effect: f.effect, areaM2: f.areaM2, owner: f.owner, ownerName: f.ownerName, rent: f.rent, level: f.level, monthly: f.monthly });
export const PLAN: HubPlan = {
  airport: 'LFMN', layout: 'LFMN', filters: ['maintenance', 'terminal', 'cargo', 'office', 'parking'], summary: { yours: 2, available: 2, ai: 1 },
  buildings: LFMN_FACILITIES.map(building), parking: { spots: 6, used: 4, monthly: 15_600 },
};

const LEVELS: FacilityLevelInfo[] = [
  { level: 1, cost: 0, worksDays: 0, opensAfterDays: null, technicians: 6, aircraft: 2, widebody: false, sellsMaintenance: false, desks: 0 },
  { level: 2, cost: 420_000, worksDays: 21, opensAfterDays: null, technicians: 10, aircraft: 3, widebody: false, sellsMaintenance: false, desks: 0 },
  { level: 3, cost: 1_150_000, worksDays: 56, opensAfterDays: 180, technicians: 16, aircraft: 4, widebody: true, sellsMaintenance: true, desks: 0 },
];
/** MX2 as the mockup's contract screen shows it (previewed at level 2, rented). */
export const MX2: FacilityDetail = {
  facility: LFMN_FACILITIES[4]!,
  offer: {
    lease: { monthly: 18_500, months: 36, deposit: 37_000, noticeMonths: 3, totalOverTerm: 666_000 },
    purchase: { price: 2_350_000, rentMonths: 127, upkeep: 2_400, resalePct: 75, resale: 1_762_500, creditPct: 80, loans: [{ downPct: 20, months: 120, monthly: 21_400, total: 3_000_000, down: 470_000, dueToday: 470_000 }] },
  },
  levels: LEVELS,
  required: [{ family: 'maintenance', role: 'technician', need: 10, have: 0, candidates: 23 }],
  due: { today: 457_000, monthly: 18_500, staffMonthly: 46_200, balanceAfter: 827_560 },
};
