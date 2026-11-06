import { MANUAL_PAY_FACTOR, PAX_KG, RANKS, capacityKg, jobPayout, type AircraftType } from '@opc/shared';
import {
  REALISM_TOGGLES, type FleetQuote, type LeaseOffer, type LoanQuote, type Onboarding, type OnboardingStep, type Realism, type RealismPreset, type RealismToggle, type StartMode,
} from './onboarding-types.ts';

// Pure view-model of the onboarding: everything computed on screen lives here so it can be tested with fixtures.

export const STEPS = ['depart', 'company', 'aircraft', 'realism', 'bridge', 'go'] as const;
export const clampStep = (n: number): OnboardingStep => Math.min(6, Math.max(1, Math.round(n))) as OnboardingStep;

// ---------------------------------------------------------------- start modes (mirrors START_MODES of lot START)

export const START_FACTS: Record<StartMode, { capital: number; demand: 2 | 5; preset: RealismPreset; hubSize: 'large' | 'small'; types: readonly string[] }> = {
  airliner: { capital: 2_500_000, demand: 2, preset: 'balanced', hubSize: 'large', types: ['A20N', 'B738', 'E295'] },
  hardcore: { capital: 45_000, demand: 5, preset: 'hardcore', hubSize: 'small', types: ['C172', 'C152'] },
};
export const otherMode = (m: StartMode): StartMode => (m === 'airliner' ? 'hardcore' : 'airliner');

// ---------------------------------------------------------------- realism: toggles, presets, modifiers

/** What each toggle adds to pay and reputation, in % (frame "Onboarding · 4": the six rows). Mirrors REALISM_TOGGLES of lot START; the server's numbers win when it answers. */
export const TOGGLE_FX: Record<RealismToggle, { pay: number; rep: number }> = {
  wearAndFailures: { pay: 10, rep: 10 },
  realFuelPrice: { pay: 8, rep: 5 },
  delayPenalties: { pay: 5, rep: 10 },
  realWeatherRequired: { pay: 7, rep: 5 },
  bankruptcyBailout: { pay: 0, rep: -10 },
  pauseTolerance: { pay: -5, rep: 0 },
};

export const PRESETS: readonly RealismPreset[] = ['relaxed', 'balanced', 'hardcore'];
const on = (...keys: RealismToggle[]): Record<RealismToggle, boolean> => Object.fromEntries(REALISM_TOGGLES.map((k) => [k, keys.includes(k)])) as Record<RealismToggle, boolean>;
export const PRESET_TOGGLES: Record<RealismPreset, Record<RealismToggle, boolean>> = {
  relaxed: on('bankruptcyBailout', 'pauseTolerance'),
  balanced: on('wearAndFailures', 'delayPenalties', 'bankruptcyBailout', 'pauseTolerance'),
  hardcore: on('wearAndFailures', 'realFuelPrice', 'delayPenalties', 'realWeatherRequired'),
};

export const modifiersOf = (toggles: Record<RealismToggle, boolean>): { pay: number; rep: number } =>
  REALISM_TOGGLES.reduce((sum, k) => (toggles[k] ? { pay: sum.pay + TOGGLE_FX[k].pay, rep: sum.rep + TOGGLE_FX[k].rep } : sum), { pay: 0, rep: 0 });

/** The realism of a preset, as the server would return it before knowing which toggles it can enforce. */
export function presetRealism(preset: RealismPreset, enforced?: Realism['enforced']): Realism {
  const toggles = { ...PRESET_TOGGLES[preset] };
  const m = modifiersOf(toggles);
  return { preset, toggles, payModifierPct: m.pay, repModifierPct: m.rep, enforced: enforced ?? (Object.fromEntries(REALISM_TOGGLES.map((k) => [k, true])) as Realism['enforced']) };
}

/** Changing one toggle moves the preset to "custom"; the modifiers are the sum of the active toggles. */
export function withToggle(r: Realism, key: RealismToggle, value: boolean): Realism {
  if (r.toggles[key] === value) return r;
  const toggles = { ...r.toggles, [key]: value };
  const m = modifiersOf(toggles);
  return { ...r, preset: 'custom', toggles, payModifierPct: m.pay, repModifierPct: m.rep };
}
export const activeToggles = (r: Pick<Realism, 'toggles'>): number => REALISM_TOGGLES.filter((k) => r.toggles[k]).length;
export const stepPreset = (cur: Realism['preset'], dir: 1 | -1): RealismPreset => {
  const i = cur === 'custom' ? (dir === 1 ? -1 : PRESETS.length) : PRESETS.indexOf(cur);
  return PRESETS[Math.min(PRESETS.length - 1, Math.max(0, i + dir))]!;
};

const NBSP = '\u00a0';
/** `+10 %`, `−5 %`, `0 %` with the typographic minus of the mockup. */
export const signedPct = (n: number): string => `${n > 0 ? '+' : n < 0 ? '\u2212' : ''}${Math.abs(n)}${NBSP}%`;

// ---------------------------------------------------------------- company identity

const strip = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
export const normalizeCode = (s: string): string => strip(s).replace(/[^A-Z]/g, '').slice(0, 3);
export const normalizeCallsign = (s: string): string => strip(s).replace(/[^A-Z]/g, '').slice(0, 12);
export const isValidCode = (s: string): boolean => /^[A-Z]{3}$/.test(s);
export const isValidCallsign = (s: string): boolean => /^[A-Z]{3,12}$/.test(s);
export const isValidName = (s: string): boolean => s.trim().length >= 2 && s.trim().length <= 40;

/** `Azur Régional` -> `AZR`: first letter, then the next consonants (vowels when the name runs short). */
export function suggestCode(name: string): string {
  const letters = strip(name).replace(/[^A-Z ]/g, '').replace(/\s+/g, '');
  if (letters.length === 0) return '';
  const rest = [...letters.slice(1)];
  const picked = [...rest.filter((c) => !'AEIOUY'.includes(c)), ...rest.filter((c) => 'AEIOUY'.includes(c))].slice(0, 2);
  return (letters[0]! + picked.join('')).slice(0, 3);
}
/** `Azur Régional` -> `AZUR`: the first word. */
export const suggestCallsign = (name: string): string => normalizeCallsign(strip(name).split(/\s+/)[0] ?? '');

/** The livery swatches of the mockup; the value is what the API stores (`#RRGGBB`). */
export const LIVERY_COLORS = [
  { id: 'azure', hex: '#6FB4D4' }, { id: 'amber', hex: '#E6BE4C' }, { id: 'magenta', hex: '#D27AE4' },
  { id: 'orange', hex: '#E9A046' }, { id: 'green', hex: '#5CC98A' }, { id: 'white', hex: '#ECEAE5' },
] as const;
export type LiveryId = (typeof LIVERY_COLORS)[number]['id'];
export const liveryIdOf = (hex: string | null): LiveryId | null => LIVERY_COLORS.find((c) => c.hex.toLowerCase() === hex?.toLowerCase())?.id ?? null;

// ---------------------------------------------------------------- 3a: lease recap

/** The rent shown in the offers table: the one for the minimum term (or the first longer one). */
export function listedTerm(o: Pick<LeaseOffer, 'minMonths' | 'durations'>): { months: number; monthlyRent: number } {
  const sorted = [...o.durations].sort((a, b) => a.months - b.months);
  const hit = sorted.find((d) => d.months >= o.minMonths) ?? sorted[sorted.length - 1];
  return hit ?? { months: o.minMonths, monthlyRent: 0 };
}

/** A typical paid flight of this type, from the game's own pay formula: 80 % of the seats, half the range (at most 600 NM). Gross, before fuel and fees. */
export function typicalGain(t: Pick<AircraftType, 'seats' | 'cargoKg' | 'rangeNm' | 'category' | 'engines' | 'wtc' | 'cruiseKts' | 'icao' | 'name' | 'derived'>): number {
  const dist = Math.max(50, Math.min(600, Math.round(t.rangeNm * 0.5)));
  const payload = t.seats > 0 ? Math.round(t.seats * 0.8) * PAX_KG : Math.round(t.cargoKg * 0.8);
  return jobPayout(t.seats > 0 ? 'pax' : 'cargo', dist, payload);
}

export type LeaseRecap = {
  deposit: number; firstRent: number; ferryFee: number; remaining: number; affordable: boolean;
  autonomyMonths: number | null; flightsPerMonth: number | null;
  /** Share of the capital (0..1) taken by the deposit, the first rent (with ferry) and what is left. */
  shares: { deposit: number; first: number; rest: number };
};
export function leaseRecap(capital: number, offer: Pick<LeaseOffer, 'deposit' | 'ferryFee'>, monthlyRent: number, gainPerFlight: number | null): LeaseRecap {
  const first = monthlyRent + offer.ferryFee;
  const remaining = capital - offer.deposit - first;
  const share = (n: number): number => (capital > 0 ? Math.min(1, Math.max(0, n / capital)) : 0);
  return {
    deposit: offer.deposit, firstRent: monthlyRent, ferryFee: offer.ferryFee, remaining, affordable: remaining >= 0,
    autonomyMonths: monthlyRent > 0 ? Math.round((remaining / monthlyRent) * 10) / 10 : null,
    flightsPerMonth: gainPerFlight && gainPerFlight > 0 && monthlyRent > 0 ? Math.ceil(monthlyRent / gainPerFlight) : null,
    shares: { deposit: share(offer.deposit), first: share(first), rest: share(Math.max(0, remaining)) },
  };
}

// ---------------------------------------------------------------- 3b: hardcore comparison

export type HardcoreId = 'club' | 'monthly' | 'credit';
export type HardcoreOption = { id: HardcoreId; icao: string; upfront: number; monthly: number; hourly: number; loan?: LoanQuote; price?: number };

/** Contract constants of lot FINANCE (club rental and monthly rental of the C172); replaced by the shared ones once merged. */
export const CLUB = { icao: 'C172', hourly: 210 } as const;
export const MONTHLY_RENTAL = { icao: 'C172', deposit: 5_000, monthly: 1_900, hourly: 110, minMonths: 6 } as const;
export const LOAN_RATE = 0.069;
export const CREDIT_ICAO = 'C152';

/** Fuel per flight hour of the credit-bought C152, scaled from the C172's 110 EUR/h by fuel burn per hour (capacity x cruise speed). */
export function fuelPerHour(t: Pick<AircraftType, 'seats' | 'cargoKg' | 'cruiseKts'>, ref: Pick<AircraftType, 'seats' | 'cargoKg' | 'cruiseKts'>, refHourly = MONTHLY_RENTAL.hourly): number {
  const burn = (a: Pick<AircraftType, 'seats' | 'cargoKg' | 'cruiseKts'>): number => capacityKg(a as AircraftType) * a.cruiseKts;
  return Math.round(refHourly * (burn(t) / burn(ref)));
}

/** Picks the loan of the quote closest to "a quarter down, 5 years", the shape of the mockup's third option. */
export function pickLoan(loans: LoanQuote[]): LoanQuote | null {
  return [...loans].sort((a, b) => Math.abs(a.months - 60) - Math.abs(b.months - 60) || Math.abs(a.downPct - 25) - Math.abs(b.downPct - 25))[0] ?? null;
}

export function hardcoreOptions(quote: FleetQuote | null, creditHourly: number | null): HardcoreOption[] {
  const out: HardcoreOption[] = [
    { id: 'club', icao: CLUB.icao, upfront: 0, monthly: 0, hourly: CLUB.hourly },
    { id: 'monthly', icao: MONTHLY_RENTAL.icao, upfront: MONTHLY_RENTAL.deposit, monthly: MONTHLY_RENTAL.monthly, hourly: MONTHLY_RENTAL.hourly },
  ];
  const loan = quote ? pickLoan(quote.loans) : null;
  if (quote && loan && creditHourly !== null) out.push({ id: 'credit', icao: CREDIT_ICAO, upfront: Math.round((quote.cash * loan.downPct) / 100), monthly: loan.monthly, hourly: creditHourly, loan, price: quote.cash });
  return out;
}
/** The "Pour 20 h par mois" column. */
export const monthlyCost = (o: Pick<HardcoreOption, 'monthly' | 'hourly'>, hours = 20): number => o.monthly + hours * o.hourly;

/** Flight hours per month below which `chosen` is the cheapest of the options (the mockup's "sous 13 h de vol par mois"), or null when it never is the cheapest then. */
export function cheapestBelow(chosen: HardcoreOption, others: HardcoreOption[]): number | null {
  let limit = Infinity;
  for (const o of others) {
    if (o.hourly >= chosen.hourly) { if (o.monthly <= chosen.monthly) return null; continue; }
    const crossing = (o.monthly - chosen.monthly) / (chosen.hourly - o.hourly);
    limit = Math.min(limit, crossing);
  }
  return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : null;
}

/** Rank thresholds of the progression preview (frame 3b): real values of the game's rank ladder. */
export const LADDER = [
  { id: 'single', rank: 0 }, { id: 'twin', rank: 1 }, { id: 'turboprop', rank: 2 }, { id: 'regional', rank: 3 },
] as const;
export const ladderRank = (rank: number): { name: string; hours: number; flights: number } => RANKS[Math.min(rank, RANKS.length - 1)]!;

// ---------------------------------------------------------------- 5: bridge test

export type BridgeProbe = { reachable: boolean; version?: string; sim?: 'connected' | 'waiting' | 'unavailable'; hasFlight?: boolean };
export type CheckState = 'ok' | 'wait' | 'idle' | 'unknown';
export type BridgeVerdict = {
  overall: 'waiting' | 'connected' | 'failed';
  bridge: CheckState; key: CheckState; sim: CheckState; data: CheckState;
};
export const BRIDGE_TIMEOUT_MS = 60_000;

export function bridgeVerdict(probe: BridgeProbe | null, keyUsed: boolean, elapsedMs: number): BridgeVerdict {
  const reachable = !!probe?.reachable;
  const bridge: CheckState = reachable ? 'ok' : 'wait';
  const key: CheckState = keyUsed ? 'ok' : 'wait';
  const sim: CheckState = !reachable ? 'idle' : probe?.sim === undefined ? 'unknown' : probe.sim === 'connected' ? 'ok' : 'wait';
  const data: CheckState = reachable && probe?.hasFlight ? 'ok' : 'idle';
  const connected = bridge === 'ok' && key === 'ok' && (sim === 'ok' || sim === 'unknown');
  const failed = !connected && !reachable && elapsedMs >= BRIDGE_TIMEOUT_MS;
  return { overall: connected ? 'connected' : failed ? 'failed' : 'waiting', bridge, key, sim, data };
}
/** Share of a flight's net an unverified flight pays (the "60 %" of the skip note). */
export const UNVERIFIED_PAY_PCT = Math.round(MANUAL_PAY_FACTOR * 100);

/** The key to follow for "was it used": the newest key with this label. */
export function keyUsed(keys: { id: number; label: string; lastUsedAt: number | null }[], id: number | null): boolean {
  if (id === null) return false;
  return keys.some((k) => k.id === id && k.lastUsedAt !== null);
}

// ---------------------------------------------------------------- draft (client-owned JSON, 8 KB max)

export type Form = { name: string; code: string; callsign: string; color: string | null; hub: string | null; hubQuery: string; codeEdited: boolean; callsignEdited: boolean };
export type Draft = { form: Form; bridge: 'unknown' | 'skipped' | 'connected' };
export const emptyForm = (): Form => ({ name: '', code: '', callsign: '', color: null, hub: null, hubQuery: '', codeEdited: false, callsignEdited: false });
export const DRAFT_MAX_BYTES = 8 * 1024;

export function toDraft(d: Draft): Record<string, unknown> {
  const out: Record<string, unknown> = JSON.parse(JSON.stringify(d));
  while (new TextEncoder().encode(JSON.stringify(out)).length > DRAFT_MAX_BYTES) {
    const f = out.form as Record<string, unknown>;
    if (typeof f.hubQuery === 'string' && f.hubQuery) f.hubQuery = '';
    else if (typeof f.name === 'string' && f.name.length > 40) f.name = f.name.slice(0, 40);
    else { delete out.form; break; }
  }
  return out;
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
export function readDraft(raw: Record<string, unknown> | undefined | null): Draft {
  const f = (raw?.form ?? {}) as Record<string, unknown>;
  const bridge = raw?.bridge === 'skipped' || raw?.bridge === 'connected' ? raw.bridge : 'unknown';
  return {
    bridge,
    form: {
      name: str(f.name, 40), code: normalizeCode(str(f.code, 8)), callsign: normalizeCallsign(str(f.callsign, 20)),
      color: typeof f.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(f.color) ? f.color : null,
      hub: typeof f.hub === 'string' && /^[A-Z]{4}$/.test(f.hub) ? f.hub : null,
      hubQuery: str(f.hubQuery, 60), codeEdited: f.codeEdited === true, callsignEdited: f.callsignEdited === true,
    },
  };
}

/** Where the wizard opens: the saved step, but never past what the saved state allows (steps 3+ need a company). */
export function resumeStep(ob: Pick<Onboarding, 'step' | 'startMode' | 'companyId'>): OnboardingStep {
  if (ob.startMode === null) return 1;
  if (ob.companyId === null) return ob.step >= 2 ? 2 : 1;
  return ob.step < 3 ? 3 : ob.step;
}
