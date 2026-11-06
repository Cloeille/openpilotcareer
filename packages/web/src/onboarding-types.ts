import type { RealismPresetId } from '@opc/shared';

// The wire types of the onboarding live in @opc/shared (career.ts, finance.ts); this file re-exports what the wizard uses
// and adds the two shapes that never cross the server: the bridge's own status and the new-company form body.
export { REALISM_TOGGLES } from '@opc/shared';
export type {
  FirstJob, FleetQuote, HubSuggestion, LeaseOffer, LoanOption, Me, Onboarding, OnboardingStep, Realism, RealismToggle, StartMode,
} from '@opc/shared';

/** The three named presets (`custom` is what any hand-set toggle turns the preset into). */
export type RealismPreset = Exclude<RealismPresetId, 'custom'>;

export type NewCompanyBody = { name: string; hub: string; code: string; callsign: string; liveryColor?: string; startMode: 'airliner' | 'hardcore' };

/** GET http://127.0.0.1:7878/status of the bridge on the player's PC (`sim` and `version` come with lot LIVE; older bridges lack them). */
export type BridgeStatus = { version?: string; sim?: 'connected' | 'waiting' | 'unavailable'; phase?: string; flight?: unknown; serverUrl?: string };
