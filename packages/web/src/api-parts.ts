import { api } from './api.ts';
import { ApiError } from './errors.ts';

/**
 * Typed client for the PARTS section of docs/v3-plan.md (B.6).
 * The wire types are declared here because lot S5's `shared/src/parts.ts` is not merged yet (see "Implementation notes (F5)"); switching is an import change.
 * A route the server does not have answers 404/405: `null` means "feature off", any other failure still throws.
 * Money is euros, instants are epoch milliseconds, ICAO codes are upper case, a share is a fraction (0.37 is 37 %).
 */

// ---------------------------------------------------------------- warehouse

export const STOCK_POLICIES = ['none', 'critical', 'full'] as const;
export type StockPolicy = (typeof STOCK_POLICIES)[number];
/** What one policy immobilises and the ground days a year it leaves, for a type. */
export type PolicyOption = { capital: number; groundDays: number };
export type TypePolicy = {
  icao: string; typeName: string; registrations: string[]; policy: StockPolicy;
  /** What one day on the ground costs: a day of the type's expected line revenue (B.8). */
  groundDayValue: number;
  options: Record<StockPolicy, PolicyOption>;
};
/** One part in stock at the hub, for the aircraft type it serves. */
export type StockLine = { icao: string; partId: string; name: string; qty: number; value: number };
/** An aircraft down for want of a part. `eta` is when the part arrives; `expressCost` the freight on top. */
export type AogCase = { registration: string; icao: string; failedAt: number; failure: string; partName: string; eta: number; expressCost: number };
export type WarehouseView = {
  facility: { name: string; areaM2: number; monthly: number } | null;
  capital: number; capitalShare: number; expectedGroundDays: number;
  covered: { count: number; of: number };
  aog: AogCase | null;
  policies: TypePolicy[];
  inventory: StockLine[];
};
export type PolicyResult = { capital: number; deltaGroundDays: number; annualSaving: number };

// ---------------------------------------------------------------- lease wear

export const COMPONENTS = ['engines', 'gear', 'propellers', 'avionics', 'interior', 'paint'] as const;
export type ComponentId = (typeof COMPONENTS)[number];
export const WEAR_ACTIONS = ['leave', 'overhaul', 'replace'] as const;
export type WearAction = (typeof WEAR_ACTIONS)[number];
/** What a worn component costs: `value` is a magnitude, in points of performance (%), of reliability (points) or of satisfaction (stars); `fuelPct` (more fuel) and `loadPct` (fewer passengers) are the side effects. */
export type WearEffect = { kind: 'performance' | 'reliability' | 'satisfaction'; value: number; fuelPct?: number; loadPct?: number };
/** `detail` is the server's own line on the component ("2 910 h since overhaul, of 3 600"), shown as sent when there is one (asked of S5, optional). */
export type ComponentWear = { component: ComponentId; wearPct: number; effect: WearEffect; refurbUntil: number | null; suggested: WearAction; detail?: string };
/** One choice for one component. `monthlyGain` is what it earns a month against leaving the component as it is; `netReturn` and `netBuy` are over the months left, handing the aircraft back or taking the purchase option. */
export type ChoiceOption = { cost: number; monthlyGain: number; paybackMonths: number | null; downDays: number; netReturn: number; netBuy: number };
export type ChoiceTable = Record<ComponentId, Record<WearAction, ChoiceOption>>;
export type WearView = {
  aircraft: { id: number; registration: string; typeName: string; hub: string; year: number; airframeHours: number; lessor: string; monthsLeft: number; endsAt: number; purchaseOptionPrice: number; hoursPerMonth: number };
  components: ComponentWear[];
  /** Reliability (%) and satisfaction (out of 5) with every component as new; performance starts at 0. */
  effects: { reliability: number; satisfaction: number };
  choices: ChoiceTable;
  /** The server's own total for its suggested choices; the screen sums the player's choices itself. */
  totals: { give: number; buy: number; cashCurve: number[] };
  balanceAfter: number;
};
export type RefurbishItem = { component: ComponentId; action: Exclude<WearAction, 'leave'> };
export type RefurbishResult = { cost: number; downUntil: number; balanceAfter: number };

async function optional<T>(path: string): Promise<T | null> {
  try {
    return await api<T>(path);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return null;
    throw e;
  }
}

export const fetchWarehouse = (hub: string): Promise<WarehouseView | null> => optional<WarehouseView>(`/warehouse/${encodeURIComponent(hub)}`);
export const setPolicy = (hub: string, icao: string, policy: StockPolicy): Promise<PolicyResult> =>
  api<PolicyResult>(`/warehouse/${encodeURIComponent(hub)}/policy`, { method: 'PUT', body: { icao, policy } });
export const fetchWear = (aircraftId: number): Promise<WearView | null> => optional<WearView>(`/me/fleet/${aircraftId}/wear`);
export const refurbish = (aircraftId: number, items: RefurbishItem[]): Promise<RefurbishResult> =>
  api<RefurbishResult>(`/me/fleet/${aircraftId}/refurbish`, { method: 'POST', body: { items } });
