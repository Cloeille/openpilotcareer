import type { Company, FleetAircraft, Job, Me } from '@opc/shared';

// Shapes of docs/v2-contract.md (START + FINANCE sections), mirrored here so this lot builds before the backend lots are merged. No runtime dependency: the view-model and its tests import this file.

export type StartMode = 'airliner' | 'hardcore';
export type RealismPreset = 'relaxed' | 'balanced' | 'hardcore';
export const REALISM_TOGGLES = ['wearAndFailures', 'realFuelPrice', 'delayPenalties', 'realWeatherRequired', 'bankruptcyBailout', 'pauseTolerance'] as const;
export type RealismToggle = (typeof REALISM_TOGGLES)[number];
export type Realism = {
  preset: RealismPreset | 'custom';
  toggles: Record<RealismToggle, boolean>;
  payModifierPct: number;
  repModifierPct: number;
  /** false = the server stores the toggle but cannot apply it yet. */
  enforced: Record<RealismToggle, boolean>;
};
export type OnboardingStep = 1 | 2 | 3 | 4 | 5 | 6;
export type Onboarding = { completed: boolean; step: OnboardingStep; startMode: StartMode | null; companyId: number | null; draft: Record<string, unknown> };
export type HubSuggestion = {
  icao: string; name: string; city: string; size: 'large' | 'medium' | 'small';
  parkingMonthly: number; jobsNearby: number; aiCompaniesBased: number; note: string; noteKey?: 'most_jobs' | 'cheapest' | 'least_competition' | 'balanced';
};
export type LeaseOffer = {
  id: number | string; lessor: string; icao: string; typeName: string; year: number; airframeHours: number; maintenanceIncluded: boolean;
  insuranceMonthly: number | null; deposit: number; ferryFee: number; deliveryHours: number; minMonths: number;
  durations: { months: 12 | 24 | 36; monthlyRent: number }[]; purchaseOptionPrice: number;
  earlyExit: { afterMonths: number; penaltyRents: number };
};
export type LoanQuote = { downPct: number; months: number; monthly: number; total: number };
export type FleetQuote = { cash: number; loans: LoanQuote[]; leaseOffers: number };
export type FirstJob = { job: Job; reservedUntil: number };
export type CompanyV2 = Company & Partial<{ code: string | null; callsign: string | null; liveryColor: string | null; startMode: StartMode | null; realism: Realism }>;
export type FleetAircraftV2 = FleetAircraft & Partial<{ registration: string; ownership: 'owned' | 'leased' | 'financed' | 'club' | 'rented' }>;
export type MeV2 = Omit<Me, 'company' | 'companies' | 'fleet'> & { company: CompanyV2; companies: CompanyV2[]; fleet: FleetAircraftV2[] };


export type NewCompanyBody = { name: string; hub: string; code: string; callsign: string; liveryColor?: string; startMode: StartMode };

/** GET http://127.0.0.1:7878/status of the bridge on the player's PC (`sim` and `version` come with lot LIVE; older bridges lack them). */
export type BridgeStatus = { version?: string; sim?: 'connected' | 'waiting' | 'unavailable'; phase?: string; flight?: unknown; serverUrl?: string };
