import type { FacilityDetail, FacilityRow, HubOverview, HubPlan, HubsOverview } from './api-facilities.ts';

/** The mockup's Nice and Lyon, as the B.4 routes would answer them. Used by the view-model tests and to look at the screens before S3 is merged; never shipped to the UI. */

const T0 = Date.parse('2026-11-06T18:00:00Z');
const row = (o: Partial<FacilityRow> & Pick<FacilityRow, 'id' | 'slot' | 'name' | 'kind'>): FacilityRow => ({
  owner: 'available', level: 1, areaM2: 4_200, hold: null, monthly: null, offerMonthly: null, understaffed: false, worksTo: null, ...o,
});

export const LFMN_FACILITIES: FacilityRow[] = [
  row({ id: 1, slot: 'T1', name: 'Terminal 1', kind: 'terminal', owner: 'airport', monthly: 11_300 }),
  row({ id: 2, slot: 'T2', name: 'Terminal 2', kind: 'terminal', owner: 'airport' }),
  row({ id: 3, slot: 'VIP', name: "Terminal aviation d'affaires", kind: 'terminal', offerMonthly: 7_800 }),
  row({ id: 4, slot: 'MX1', name: 'Hangar de maintenance 1', kind: 'maintenance', owner: 'player', hold: 'purchase', monthly: 2_400 }),
  row({ id: 5, slot: 'MX2', name: 'Hangar de maintenance 2', kind: 'maintenance', areaM2: 6_200, offerMonthly: 18_500 }),
  row({ id: 6, slot: 'CG1', name: 'Fret & stockage', kind: 'cargo', owner: 'ai', ownerName: 'Méridia Cargo', areaM2: 3_200 }),
  row({ id: 7, slot: 'AD', name: 'Bureaux administratifs', kind: 'office', owner: 'player', hold: 'lease', monthly: 6_200, areaM2: 1_400 }),
  row({ id: 8, slot: 'OPS', name: "Centre d'opérations", kind: 'office', offerMonthly: 5_400 }),
  row({ id: 9, slot: 'TWR', name: 'Tour de contrôle', kind: 'airport', owner: 'airport' }),
  row({ id: 10, slot: 'FUEL', name: 'Dépôt carburant', kind: 'airport', owner: 'airport' }),
];

export const LFMN: HubOverview = {
  icao: 'LFMN', name: "Nice Côte d'Azur", role: 'main', facilities: LFMN_FACILITIES, monthlyCost: 19_900,
  team: { total: 37, byFamily: { pilot: 14, cabin: 9, maintenance: 7, ground: 4, admin: 3 }, chief: { name: 'Sophie Marchetti', since: Date.parse('2025-09-06T00:00:00Z') } },
  aircraft: [
    { id: 1, reg: 'F-HAZR', typeName: 'ATR 72-600', status: 'flying', note: 'Ton vol' },
    { id: 2, reg: 'F-HAZA', typeName: 'ATR 72-600', status: 'flying', note: 'Retard +14 min' },
    { id: 3, reg: 'F-HAZB', typeName: 'ATR 72-600', status: 'available', note: 'Départ 18:10Z' },
    { id: 4, reg: 'F-HAZT', typeName: 'ATR 42-600', status: 'available', note: 'Au sol · PK3' },
  ],
  renewals: [{ text: 'Bail des postes PK1 à PK4', before: Date.parse('2027-01-31T00:00:00Z') }],
};
export const LFLL: HubOverview = {
  icao: 'LFLL', name: 'Lyon-Saint-Exupéry', role: 'secondary', monthlyCost: 8_600,
  facilities: [row({ id: 20, slot: 'AG', name: "Bureau d'escale", kind: 'office', owner: 'player', hold: 'lease', monthly: 8_600 })],
  team: { total: 7, byFamily: { ground: 4, pilot: 3 }, chief: { name: 'Karim Benali', since: T0 } },
  aircraft: [{ id: 5, reg: 'F-HAZC', typeName: 'CRJ700', status: 'maintenance', note: 'En inspection' }],
  renewals: [],
};
export const OVERVIEW: HubsOverview = {
  company: { name: 'Azur Régional' }, monthlyCost: 28_500, hubs: [LFMN, LFLL],
  suggestion: { icao: 'LFKJ', flightsPerWeek: 12, fromMonthly: 5_400, text: "Tu opères déjà 12 vols par semaine vers Ajaccio. Un bureau d'escale et 2 postes y sont libres : tes équipages pourraient y passer la nuit au lieu de rentrer à vide." },
};

export const PLAN: HubPlan = {
  airport: 'LFMN', layout: 'LFMN', filters: ['maintenance', 'terminal', 'cargo', 'office', 'parking'], summary: { yours: 2, available: 4, ai: 1 },
  buildings: LFMN_FACILITIES.map(({ id, slot, name, kind, owner, ownerName }) => ({ id, slot, name, kind, owner, ...(ownerName ? { ownerName } : {}) })),
};

/** MX2 as the mockup's contract screen shows it. */
export const MX2: FacilityDetail = {
  facility: { ...LFMN_FACILITIES[4]!, hub: 'LFMN', contract: null },
  offer: {
    lease: { monthly: 18_500, months: 36, deposit: 37_000, noticeMonths: 3 },
    purchase: { price: 2_350_000, monthsOfRent: 127, upkeep: 2_400, resalePct: 0.75, creditPct: 80 },
  },
  levels: [
    { level: 1, works: null, staff: [{ family: 'maintenance', role: 'technician', need: 6 }, { family: 'maintenance', role: 'chief', need: 1 }], salaries: 27_600, locked: null },
    { level: 2, works: { weeks: 3, cost: 420_000 }, staff: [{ family: 'maintenance', role: 'technician', need: 10 }, { family: 'maintenance', role: 'chief', need: 1 }], salaries: 46_200, locked: null },
    { level: 3, works: { weeks: 8, cost: 1_150_000 }, staff: [{ family: 'maintenance', role: 'technician', need: 16 }, { family: 'maintenance', role: 'chief', need: 2 }], salaries: 74_000, locked: { months: 6 } },
  ],
  required: [{ family: 'maintenance', role: 'technician', need: 10, have: 0, candidates: 23 }, { family: 'maintenance', role: 'chief', need: 1, have: 0, candidates: 3 }],
  due: { today: 37_000, monthly: 18_500 + 27_600, balanceAfter: 1_247_560 },
};
