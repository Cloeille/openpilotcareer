// OpenHangar v2, lot START: start modes, company identity, realism & difficulty, onboarding state.
// Pure and runtime-free apart from zod: the server enforces these rules, the web renders the same numbers.
import { z } from 'zod';
import type { AirportSize, Job } from './index.ts';

// ---------------------------------------------------------------- start modes

export const START_MODE_IDS = ['airliner', 'hardcore'] as const;
export type StartMode = (typeof START_MODE_IDS)[number];

export type StartModeSpec = {
  /** Starting capital in euros. */
  capital: number;
  /** Size of the airports a company of this mode may be based at. */
  hubSize: AirportSize;
  suggestedRealism: Exclude<RealismPresetId, 'custom'>;
  /** Aircraft types offered at the "first aircraft" step (leased or rented). */
  starterTypes: readonly string[];
};

export const START_MODES: Record<StartMode, StartModeSpec> = {
  airliner: { capital: 2_500_000, hubSize: 'large', suggestedRealism: 'balanced', starterTypes: ['A20N', 'B738', 'E295'] },
  hardcore: { capital: 45_000, hubSize: 'small', suggestedRealism: 'hardcore', starterTypes: ['C172', 'C152'] },
};

/** Airport sizes a company of each mode may search for as its main hub. Suggestions use `hubSize` only. */
export const START_MODE_HUB_SIZES: Record<StartMode, readonly AirportSize[]> = { airliner: ['large'], hardcore: ['small', 'medium'] };

/** Parking per aircraft and month by hub size, shown on the hub-choice step. Mirrors the finance lot's PARKING_FEE_BY_SIZE. */
export const HUB_PARKING_MONTHLY: Record<AirportSize, number> = { large: 3_900, medium: 1_800, small: 450 };

// ---------------------------------------------------------------- realism

export const REALISM_TOGGLES = ['wearAndFailures', 'realFuelPrice', 'delayPenalties', 'realWeatherRequired', 'bankruptcyBailout', 'pauseTolerance'] as const;
export type RealismToggle = (typeof REALISM_TOGGLES)[number];
export type RealismPresetId = 'relaxed' | 'balanced' | 'hardcore' | 'custom';
export const REALISM_PRESET_IDS = ['relaxed', 'balanced', 'hardcore', 'custom'] as const;

/** What turning a toggle ON does to pay and reputation gains (frame "Onboarding · 4 réalisme & difficulté").
 *  `enforced` is false when the server stores the choice but cannot apply it yet (jobs have no schedule, there is no weather data). */
export const REALISM_TOGGLE_INFO: Record<RealismToggle, { payPct: number; repPct: number; enforced: boolean }> = {
  wearAndFailures: { payPct: 10, repPct: 10, enforced: true },
  realFuelPrice: { payPct: 8, repPct: 5, enforced: true },
  delayPenalties: { payPct: 5, repPct: 10, enforced: false },
  realWeatherRequired: { payPct: 7, repPct: 5, enforced: false },
  bankruptcyBailout: { payPct: 0, repPct: -10, enforced: true },
  pauseTolerance: { payPct: -5, repPct: 0, enforced: true },
};

export type RealismToggles = Record<RealismToggle, boolean>;
const toggles = (on: readonly RealismToggle[]): RealismToggles => Object.fromEntries(REALISM_TOGGLES.map((t) => [t, on.includes(t)])) as RealismToggles;

export const REALISM_PRESETS: Record<Exclude<RealismPresetId, 'custom'>, { payPct: number; repPct: number; toggles: RealismToggles }> = {
  relaxed: { payPct: -5, repPct: -10, toggles: toggles(['bankruptcyBailout', 'pauseTolerance']) },
  balanced: { payPct: 10, repPct: 10, toggles: toggles(['wearAndFailures', 'delayPenalties', 'bankruptcyBailout', 'pauseTolerance']) },
  hardcore: { payPct: 30, repPct: 30, toggles: toggles(['wearAndFailures', 'realFuelPrice', 'delayPenalties', 'realWeatherRequired']) },
};

/** What is stored per company. The modifiers are always derived from the toggles, so they cannot drift from them. */
export type RealismSetting = { preset: RealismPresetId; toggles: RealismToggles };
export type Realism = RealismSetting & { payModifierPct: number; repModifierPct: number; enforced: Record<RealismToggle, boolean> };

/** A company that predates realism (or an AI company): no modifier, nothing extra enforced. */
export const NEUTRAL_REALISM: RealismSetting = { preset: 'custom', toggles: toggles([]) };

export const realismModifiers = (t: RealismToggles): { payModifierPct: number; repModifierPct: number } => ({
  payModifierPct: REALISM_TOGGLES.reduce((s, k) => s + (t[k] ? REALISM_TOGGLE_INFO[k].payPct : 0), 0),
  repModifierPct: REALISM_TOGGLES.reduce((s, k) => s + (t[k] ? REALISM_TOGGLE_INFO[k].repPct : 0), 0),
});

export const realismView = (s: RealismSetting): Realism => ({
  preset: s.preset,
  toggles: { ...s.toggles },
  ...realismModifiers(s.toggles),
  enforced: Object.fromEntries(REALISM_TOGGLES.map((t) => [t, REALISM_TOGGLE_INFO[t].enforced])) as Record<RealismToggle, boolean>,
});

export const presetSetting = (preset: Exclude<RealismPresetId, 'custom'>): RealismSetting => ({ preset, toggles: { ...REALISM_PRESETS[preset].toggles } });

/** Flip toggles. Any real change makes the preset `custom`; sending the values it already has changes nothing. */
export function withToggles(cur: RealismSetting, patch: Partial<RealismToggles>): RealismSetting {
  const next = { ...cur.toggles, ...patch };
  const same = REALISM_TOGGLES.every((t) => next[t] === cur.toggles[t]);
  return same ? cur : { preset: 'custom', toggles: next };
}

export const realismUpdateSchema = z.union([
  z.object({ preset: z.enum(['relaxed', 'balanced', 'hardcore']) }).strict(),
  z.object({ toggles: z.object(Object.fromEntries(REALISM_TOGGLES.map((t) => [t, z.boolean().optional()])) as Record<RealismToggle, z.ZodOptional<z.ZodBoolean>>).strict() }).strict(),
]);

// ---------------------------------------------------------------- fuel price

/** Deterministic fuel price multiplier of an airport on a UTC day, within +-25 % (multiplies FUEL_PRICE_PER_KG). */
export function fuelPriceFactor(icao: string, atMs: number): number {
  const key = `${icao}:${Math.floor(atMs / 86_400_000)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; // murmur3 finalizer: neighbouring days and airports decorrelate
  return 1 + ((h >>> 0) / 4294967296 * 2 - 1) * 0.25;
}

// ---------------------------------------------------------------- company identity

export const airlineCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, '3 letters A-Z');
export const callsignSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{3,12}$/, '3 to 12 letters A-Z');
export const liveryColorSchema = z.string().trim().toUpperCase().regex(/^#[0-9A-F]{6}$/, '#RRGGBB');

/** `POST /me/companies`: the legacy `{ name, hub }`, plus identity and start mode. With `startMode`, code and callsign are required. */
export const createCompanyStartSchema = z.object({
  name: z.string().trim().min(2).max(40),
  hub: z.string().regex(/^[A-Z]{4}$/, 'ICAO airport code: 4 letters A-Z'),
  code: airlineCodeSchema.optional(),
  callsign: callsignSchema.optional(),
  liveryColor: liveryColorSchema.nullish(),
  startMode: z.enum(START_MODE_IDS).optional(),
}).refine((b) => !b.startMode || (b.code !== undefined && b.callsign !== undefined), { message: 'code and callsign are required with startMode', path: ['code'] });
export type CreateCompanyStart = z.infer<typeof createCompanyStartSchema>;

// ---------------------------------------------------------------- onboarding

export const ONBOARDING_STEPS = [1, 2, 3, 4, 5, 6] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export const ONBOARDING_DRAFT_MAX_BYTES = 8 * 1024;

export type Onboarding = {
  completed: boolean;
  step: OnboardingStep;
  startMode: StartMode | null;
  companyId: number | null;
  /** Client-owned JSON (at most 8 KB) for "Enregistrer et quitter". */
  draft: Record<string, unknown>;
};

export const onboardingUpdateSchema = z.object({
  step: z.int().min(1).max(6).optional(),
  startMode: z.enum(START_MODE_IDS).optional(),
  draft: z.record(z.string(), z.unknown()).refine((d) => new TextEncoder().encode(JSON.stringify(d)).length <= ONBOARDING_DRAFT_MAX_BYTES, { message: `draft is at most ${ONBOARDING_DRAFT_MAX_BYTES} bytes of JSON` }).optional(),
});
export type OnboardingUpdate = z.infer<typeof onboardingUpdateSchema>;

export const hubQuerySchema = z.object({ mode: z.enum(START_MODE_IDS), q: z.string().trim().max(60).optional() });

/** Why a hub is suggested: a stable tag the client can translate, next to a plain English `note`. */
export const HUB_NOTE_KEYS = ['most_jobs', 'least_competition', 'balanced', 'match'] as const;
export type HubNoteKey = (typeof HUB_NOTE_KEYS)[number];

export type HubSuggestion = {
  icao: string; name: string; city: string; size: AirportSize;
  /** Euros per aircraft and month. */
  parkingMonthly: number;
  /** Departures within 300 nm on the boards of the current UTC day. */
  jobsNearby: number;
  aiCompaniesBased: number;
  note: string;
  noteKey: HubNoteKey;
};

export type AirlineCodeAvailability = { available: boolean };
export type FirstJob = { job: Job; reservedUntil: number };
/** Reservation length of the first job. */
export const FIRST_JOB_RESERVATION_MS = 2 * 3_600_000;
