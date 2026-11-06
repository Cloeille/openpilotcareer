// Shared contract of OpenPilotCareer: domain types, zod schemas (trust boundary) and economy rules.
// Everything the server, the AI companies and the web UI must agree on lives here.
import { z } from 'zod';

export const API_VERSION = 1;
export const EXPORT_SCHEMA_VERSION = 2;
/** Companies one player may own. Not a defence against farming starting capital (registration is open): a speed bump. */
export const MAX_COMPANIES_PER_USER = 5;
/** Fallback "global" server for clients; deployments override it (web: VITE_OPC_GLOBAL_URL). */
export const OPC_GLOBAL_URL = 'https://global.openpilotcareer.org';

// ---------------------------------------------------------------- aircraft

export const AIRCRAFT_CATEGORIES = [
  'piston-single', 'piston-multi', 'turboprop-single', 'turboprop-multi', 'turboprop-airliner',
  'jet-business', 'jet-airliner', 'jet-widebody', 'helicopter', 'other',
] as const;
export type AircraftCategory = (typeof AIRCRAFT_CATEGORIES)[number];

export const WTCS = ['L', 'M', 'H', 'J'] as const;
export type Wtc = (typeof WTCS)[number];

export const icaoTypeSchema = z.string().regex(/^[A-Z0-9]{2,4}$/, 'ICAO type designator: 2-4 chars A-Z/0-9');
export const icaoAirportSchema = z.string().regex(/^[A-Z]{4}$/, 'ICAO airport code: 4 letters A-Z');

/** Aircraft type as used by all payload/revenue maths. `derived` = performance from category defaults, not curated. */
export const aircraftTypeSchema = z.object({
  icao: icaoTypeSchema,
  name: z.string().trim().min(1).max(80),
  category: z.enum(AIRCRAFT_CATEGORIES),
  engines: z.int().min(1).max(8),
  wtc: z.enum(WTCS),
  seats: z.int().min(0).max(1000),
  cargoKg: z.int().min(0).max(500_000),
  cruiseKts: z.int().min(20).max(700),
  rangeNm: z.int().min(20).max(9000),
  derived: z.boolean(),
});
export type AircraftType = z.infer<typeof aircraftTypeSchema>;

export const customAircraftSchema = aircraftTypeSchema
  .omit({ derived: true })
  .refine((a) => a.seats + a.cargoKg > 0, { message: 'aircraft needs seats or cargo capacity' });
export type CustomAircraftInput = z.infer<typeof customAircraftSchema>;

/** One row of data/aircraft-types.json (FAA Order JO 7360.1K). `perf` exists only for curated types. */
export type CatalogEntry = {
  icao: string; name: string; category: AircraftCategory; engines: number; wtc: Wtc;
  perf?: { seats: number; cargoKg: number; cruiseKts: number; rangeNm: number };
};

// Per-category defaults. burn/maint are per tonne of capacity (see capacityKg).
const CATEGORY_DEFAULTS: Record<AircraftCategory, {
  engines: number; seats: number; cargoKg: number; cruiseKts: number; rangeNm: number;
  burnKgNmPerTonne: number; maintPerHourPerTonne: number;
}> = {
  'piston-single':      { engines: 1, seats: 4,   cargoKg: 150,    cruiseKts: 115, rangeNm: 550,  burnKgNmPerTonne: 0.6,  maintPerHourPerTonne: 90 },
  'piston-multi':       { engines: 2, seats: 6,   cargoKg: 250,    cruiseKts: 170, rangeNm: 900,  burnKgNmPerTonne: 0.9,  maintPerHourPerTonne: 130 },
  'turboprop-single':   { engines: 1, seats: 8,   cargoKg: 800,    cruiseKts: 260, rangeNm: 1000, burnKgNmPerTonne: 1.0,  maintPerHourPerTonne: 150 },
  'turboprop-multi':    { engines: 2, seats: 10,  cargoKg: 900,    cruiseKts: 280, rangeNm: 1200, burnKgNmPerTonne: 1.1,  maintPerHourPerTonne: 180 },
  'turboprop-airliner': { engines: 2, seats: 60,  cargoKg: 1_500,  cruiseKts: 270, rangeNm: 800,  burnKgNmPerTonne: 0.35, maintPerHourPerTonne: 55 },
  'jet-business':       { engines: 2, seats: 8,   cargoKg: 700,    cruiseKts: 440, rangeNm: 2800, burnKgNmPerTonne: 1.8,  maintPerHourPerTonne: 330 },
  'jet-airliner':       { engines: 2, seats: 150, cargoKg: 3_000,  cruiseKts: 450, rangeNm: 2800, burnKgNmPerTonne: 0.3,  maintPerHourPerTonne: 55 },
  'jet-widebody':       { engines: 2, seats: 280, cargoKg: 15_000, cruiseKts: 490, rangeNm: 6500, burnKgNmPerTonne: 0.43, maintPerHourPerTonne: 75 },
  'helicopter':         { engines: 1, seats: 4,   cargoKg: 300,    cruiseKts: 120, rangeNm: 300,  burnKgNmPerTonne: 1.5,  maintPerHourPerTonne: 300 },
  'other':              { engines: 1, seats: 4,   cargoKg: 400,    cruiseKts: 150, rangeNm: 600,  burnKgNmPerTonne: 1.0,  maintPerHourPerTonne: 150 },
};

/** Category/engine/WTC defaults for a type without curated performance (derived=true). */
export function deriveAircraft(e: Pick<CatalogEntry, 'icao' | 'name' | 'category' | 'engines' | 'wtc'>): AircraftType {
  const d = CATEGORY_DEFAULTS[e.category];
  const scale = Math.max(0.5, 1 + 0.25 * (e.engines - d.engines)) * (e.wtc === 'J' ? 1.5 : 1);
  return {
    icao: e.icao, name: e.name, category: e.category, engines: e.engines, wtc: e.wtc,
    seats: Math.max(1, Math.round(d.seats * scale)), cargoKg: Math.round(d.cargoKg * scale),
    cruiseKts: d.cruiseKts, rangeNm: d.rangeNm, derived: true,
  };
}

export function resolveCatalogEntry(e: CatalogEntry): AircraftType {
  const { icao, name, category, engines, wtc } = e;
  return e.perf ? { icao, name, category, engines, wtc, ...e.perf, derived: false } : deriveAircraft(e);
}

/** Unknown ICAO designators still work: generic 'other' category defaults. */
export function fallbackAircraft(icao: string): AircraftType {
  return deriveAircraft({ icao, name: icao, category: 'other', engines: 1, wtc: 'L' });
}

// ---------------------------------------------------------------- economy

export const PAX_KG = 100;
export const FUEL_PRICE_PER_KG = 0.9;
export const MANUAL_PAY_FACTOR = 0.6;
export const STARTING_BALANCE = 400_000;
export const STARTER_AIRCRAFT = 'C172';
export const HUB_PRICE = 50_000;
export const RESALE_FACTOR = 0.8;
export const HARD_LANDING_FPM = 600;
export const START_REPUTATION = 50;
export const REJECT_REPUTATION_PENALTY = 2;
const PRICE_PER_KG_KT = 1.0;
const TAXI_HOURS = 0.3;

export type JobKind = 'pax' | 'cargo';
export type AirportSize = 'large' | 'medium' | 'small';
/** `verified`/`unverified` flights are completed and paid; `rejected` and `cancelled` are closed unpaid. */
export type FlightStatus = 'active' | 'verified' | 'unverified' | 'rejected' | 'cancelled';

export const capacityKg = (a: AircraftType): number => Math.max(a.seats * PAX_KG, a.cargoKg);
/** Price follows earning power (capacity x speed), so every type pays back in a comparable number of flight hours. */
export const aircraftPrice = (a: AircraftType): number => Math.round(PRICE_PER_KG_KT * capacityKg(a) * a.cruiseKts);
export const aircraftValue = (a: AircraftType): number => Math.round(aircraftPrice(a) * RESALE_FACTOR);

export function distanceNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const h = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Rate per kg*nm; small loads pay a premium so light aircraft stay viable. */
export function jobRate(kind: JobKind, payloadKg: number): number {
  const base = kind === 'pax' ? 0.004 : 0.003;
  return base * (1 + (3 * 300) / (300 + payloadKg));
}
export const jobPayout = (kind: JobKind, dist: number, payloadKg: number): number => Math.round(dist * payloadKg * jobRate(kind, payloadKg));

export type JobShape = { kind: JobKind; pax: number; payloadKg: number; distanceNm: number; requiredAircraft?: string };

/** null when the aircraft can fly the job, otherwise the reason it cannot. Uses only the aircraft record. */
export function cannotFly(a: AircraftType, j: JobShape): string | null {
  if (j.requiredAircraft && j.requiredAircraft !== a.icao) return `job requires a ${j.requiredAircraft}`;
  if (j.kind === 'pax' && j.pax > a.seats) return `needs ${j.pax} seats, ${a.icao} has ${a.seats}`;
  if (j.kind === 'cargo' && j.payloadKg > a.cargoKg) return `needs ${j.payloadKg} kg cargo capacity, ${a.icao} has ${a.cargoKg}`;
  if (j.distanceNm > a.rangeNm) return `${Math.round(j.distanceNm)} nm exceeds the ${a.rangeNm} nm range of ${a.icao}`;
  return null;
}

export const blockHours = (a: AircraftType, dist: number): number => dist / a.cruiseKts + TAXI_HOURS;
/** Fastest believable flight time: 25% above cruise speed (tailwind). Telemetry and manual completion both honour it. */
export const minFlightHours = (a: AircraftType, dist: number): number => dist / (a.cruiseKts * 1.25);
export const fuelBurnKg = (a: AircraftType, dist: number): number => CATEGORY_DEFAULTS[a.category].burnKgNmPerTonne * (capacityKg(a) / 1000) * dist;
const LANDING_BASE: Record<Wtc, number> = { L: 40, M: 450, H: 1500, J: 3000 };
const SIZE_FACTOR: Record<AirportSize, number> = { large: 1.5, medium: 1, small: 0.4 };
export const landingFee = (a: AircraftType, size: AirportSize, isHub: boolean): number => Math.round(LANDING_BASE[a.wtc] * SIZE_FACTOR[size] * (isHub ? 0.5 : 1));
const maintenancePerHour = (a: AircraftType): number => CATEGORY_DEFAULTS[a.category].maintPerHourPerTonne * (capacityKg(a) / 1000);

export type SettleInput = {
  payout: number; distanceNm: number; aircraft: AircraftType; destSize: AirportSize; destIsHub: boolean;
  status: 'verified' | 'unverified';
  /** Measured values (telemetry); estimated from the aircraft type when absent. */
  fuelUsedKg?: number; blockHours?: number; landingFpm?: number;
};
export type Settlement = { revenue: number; fuelCost: number; landingFee: number; maintenance: number; net: number; reputationDelta: number };

/** The one profit formula, used for players, AI companies and AI decision scoring. */
export function settle(i: SettleInput): Settlement {
  const hard = i.landingFpm !== undefined && Math.abs(i.landingFpm) >= HARD_LANDING_FPM;
  const revenue = Math.round(i.payout * (i.status === 'verified' ? 1 : MANUAL_PAY_FACTOR));
  const fuelCost = Math.round((i.fuelUsedKg ?? fuelBurnKg(i.aircraft, i.distanceNm)) * FUEL_PRICE_PER_KG);
  const fee = landingFee(i.aircraft, i.destSize, i.destIsHub);
  const maintenance = Math.round((i.blockHours ?? blockHours(i.aircraft, i.distanceNm)) * maintenancePerHour(i.aircraft) * (hard ? 2 : 1));
  const reputationDelta = (i.status === 'verified' ? 0.1 : 0.02) - (hard ? 1.5 : 0);
  return { revenue, fuelCost, landingFee: fee, maintenance, net: revenue - fuelCost - fee - maintenance, reputationDelta };
}

export const clampReputation = (r: number): number => Math.min(100, Math.max(0, r));

// ---------------------------------------------------------------- pilot rank & seasons

export const RANKS = [
  { name: 'Student Pilot', hours: 0, flights: 0 },
  { name: 'Private Pilot', hours: 5, flights: 3 },
  { name: 'Commercial Pilot', hours: 50, flights: 25 },
  { name: 'First Officer', hours: 150, flights: 60 },
  { name: 'Captain', hours: 500, flights: 200 },
  { name: 'Senior Captain', hours: 1500, flights: 600 },
] as const;

/** Highest rank whose hour AND flight thresholds are both met. */
export function rankFor(hours: number, flights: number): string {
  let best: string = RANKS[0].name;
  for (const r of RANKS) if (hours >= r.hours && flights >= r.flights) best = r.name;
  return best;
}

export const seasonOf = (ms: number): string => new Date(ms).toISOString().slice(0, 7);

// ---------------------------------------------------------------- telemetry verification

export const TELEMETRY_SOURCES = ['simconnect', 'manual'] as const;
export const telemetrySchema = z.object({
  takeoffAt: z.iso.datetime({ offset: true }),
  landedAt: z.iso.datetime({ offset: true }),
  departureIcao: icaoAirportSchema,
  arrivalIcao: icaoAirportSchema,
  aircraftIcao: icaoTypeSchema,
  payloadKg: z.number().min(0).max(1_000_000),
  fuelUsedKg: z.number().min(0).max(1_000_000),
  landingFpm: z.number().min(-10_000).max(10_000),
  distanceNm: z.number().min(0).max(20_000),
  source: z.enum(TELEMETRY_SOURCES),
  /** Anti-cheat flags raised by the client (slew, time acceleration, teleport...). Any flag fails the check, unless the server has anti-cheat off. */
  flags: z.array(z.string().regex(/^[a-z0-9_]{1,40}$/)).max(16).optional(),
});
export type Telemetry = z.infer<typeof telemetrySchema>;

const CLOCK_SKEW_MS = 5 * 60_000;
const MAX_LANDING_FPM = 1500;

export type TelemetryCheck = { ok: true; blockHours: number } | { ok: false; reason: string };

/** Checks a telemetry report against the accepted flight. Pure: the server supplies the facts.
 *  Job integrity (the report is about this job, this aircraft, a landing between acceptance and now) always applies.
 *  With `antiCheat` the report must also be physically plausible and free of client flags; a server that turns it off takes the numbers as reported. */
export function checkTelemetry(t: Telemetry, f: {
  origin: string; destination: string; distanceNm: number; payloadKg: number;
  aircraftIcao: string; aircraft: AircraftType; acceptedAt: number; now: number; antiCheat: boolean;
}): TelemetryCheck {
  const no = (reason: string): TelemetryCheck => ({ ok: false, reason });
  if (f.antiCheat && t.flags && t.flags.length > 0) return no(`the simulator client flagged this flight: ${t.flags.join(', ')}`);
  if (t.departureIcao !== f.origin) return no(`departure ${t.departureIcao} does not match job origin ${f.origin}`);
  if (t.arrivalIcao !== f.destination) return no(`arrival ${t.arrivalIcao} does not match job destination ${f.destination}`);
  if (t.aircraftIcao !== f.aircraftIcao) return no(`aircraft ${t.aircraftIcao} does not match the assigned ${f.aircraftIcao}`);
  const takeoff = Date.parse(t.takeoffAt), landed = Date.parse(t.landedAt);
  if (landed <= takeoff) return no('landing is not after takeoff');
  if (landed > f.now + CLOCK_SKEW_MS) return no('landing is in the future');
  if (takeoff < f.acceptedAt - CLOCK_SKEW_MS) return no('takeoff predates the acceptance of this job');
  const hours = (landed - takeoff) / 3_600_000;
  if (!f.antiCheat) return { ok: true, blockHours: hours };
  const minHours = minFlightHours(f.aircraft, f.distanceNm);
  const maxHours = 1 + f.distanceNm / (f.aircraft.cruiseKts * 0.4);
  if (hours < minHours) return no(`flight too short: ${hours.toFixed(2)} h for ${Math.round(f.distanceNm)} nm at ${f.aircraft.cruiseKts} kts`);
  if (hours > maxHours) return no(`flight too long: ${hours.toFixed(2)} h for ${Math.round(f.distanceNm)} nm`);
  if (t.distanceNm < f.distanceNm * 0.85 || t.distanceNm > f.distanceNm * 2 + 20) return no(`flown distance ${Math.round(t.distanceNm)} nm is implausible for a ${Math.round(f.distanceNm)} nm job`);
  if (t.payloadKg < f.payloadKg * 0.9) return no(`payload ${Math.round(t.payloadKg)} kg is below the job payload ${f.payloadKg} kg`);
  const expected = fuelBurnKg(f.aircraft, f.distanceNm);
  if (t.fuelUsedKg < expected * 0.25 || t.fuelUsedKg > expected * 3) return no(`fuel used ${Math.round(t.fuelUsedKg)} kg is implausible for this aircraft (expected about ${Math.round(expected)} kg)`);
  if (Math.abs(t.landingFpm) > MAX_LANDING_FPM) return no(`landing rate ${Math.round(t.landingFpm)} fpm exceeds structural limits`);
  return { ok: true, blockHours: hours };
}

// ---------------------------------------------------------------- API request schemas

export const usernameSchema = z.string().regex(/^[A-Za-z0-9_-]{3,24}$/, '3-24 chars: letters, digits, _ or -');
export const companyNameSchema = z.string().trim().min(2).max(40);
export const registerSchema = z.object({
  username: usernameSchema,
  password: z.string().min(8).max(128),
  companyName: companyNameSchema.optional(),
  hub: icaoAirportSchema.optional(),
});
export const createCompanySchema = z.object({ name: companyNameSchema, hub: icaoAirportSchema });
export const renameCompanySchema = z.object({ name: companyNameSchema });
export const loginSchema = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(128) });
export const deleteAccountSchema = z.object({ password: z.string().min(1).max(128) });
export const buyAircraftSchema = z.object({ icao: icaoTypeSchema, hub: icaoAirportSchema });
export const buyHubSchema = z.object({ icao: icaoAirportSchema });
export const acceptJobSchema = z.object({ aircraftId: z.int().positive() });
export const FLIGHT_STATUSES = ['active', 'verified', 'unverified', 'rejected', 'cancelled'] as const;
export const listQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), before: z.coerce.number().int().positive().optional() });
export const flightListQuerySchema = listQuerySchema.extend({ status: z.enum(FLIGHT_STATUSES).optional() });
export const apiKeyCreateSchema = z.object({ label: z.string().trim().min(1).max(40) });
export const simbriefImportSchema = z.object({ simbriefUsername: z.string().regex(/^[A-Za-z0-9._ -]{1,64}$/, 'invalid SimBrief username') });

export const infoSchema = z.object({
  name: z.string(), version: z.string(), apiVersion: z.number(), registrationOpen: z.boolean(),
  /** Whether the server verifies flights (OPC_ANTICHEAT). Servers that predate the setting omit it: they always verify. */
  antiCheat: z.boolean().default(true),
});
export type ServerInfo = z.infer<typeof infoSchema>;

// ---------------------------------------------------------------- API response shapes (used by the web client)

/** Body of every non-2xx API response. */
export type ApiError = { error: string; message: string };

export type Airport = { icao: string; name: string; lat: number; lon: number; size: AirportSize; country: string; city: string; iata: string };

export type Job = {
  id: string; source: 'board' | 'simbrief'; kind: JobKind; origin: string; destination: string;
  distanceNm: number; payloadKg: number; pax: number; payout: number;
  requiredAircraft?: string; plannedFuelKg?: number; route?: string;
};

export type Company = {
  id: number; name: string; balance: number; reputation: number; flights: number; hours: number; revenue: number;
  netWorth: number; isAI: boolean;
};
export type FleetAircraft = { id: number; icao: string; type: AircraftType; location: string; busy: boolean; value: number };
export type Flight = {
  id: number; companyId: number; job: Job; aircraftId: number; aircraftIcao: string; status: FlightStatus; rejectReason: string | null;
  acceptedAt: number; completedAt: number | null;
  revenue: number; fuelCost: number; landingFee: number; maintenance: number; net: number;
};
export type Transaction = { id: number; at: number; kind: string; amount: number; balanceAfter: number; flightId: number | null; memo: string };
export type ApiKeyInfo = { id: number; label: string; createdAt: number; lastUsedAt: number | null };
/** The pilot (the account), whose rank counts hours and flights over all their companies. */
export type Pilot = { rank: string; hours: number; flights: number };
/** The signed-in account seen through one company: `company` and everything below it is the ACTIVE company (X-OPC-Company); `companies` lists all of them. */
export type Me = { username: string; pilot: Pilot; company: Company; companies: Company[]; hubs: string[]; fleet: FleetAircraft[]; customAircraft: AircraftType[] };
export type LeaderboardRow = { rank: number; companyId: number; name: string; isAI: boolean; netWorth: number; flights: number; reputation: number };
export type Leaderboard = { season: string; seasons: string[]; rows: LeaderboardRow[] };
export type Personality = { style: 'aggressive' | 'cautious'; preferred: string[] };
export type CompanyProfile = Company & {
  hubs: string[]; fleet: { icao: string; count: number }[]; personality: Personality | null;
  seasons: { season: string; netWorth: number; flights: number; reputation: number }[];
};

// ---- lot live
export * from './live.ts';
