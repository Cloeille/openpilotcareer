import { api } from './api.ts';
import { ApiError } from './errors.ts';

/**
 * Typed client for the PARTS section of docs/v3-plan.md (B.6).
 * The wire types are S5's `shared/src/parts.ts`, field for field (read from `feature/v3-s5-parts` at 5f671d7). That branch is not merged into this one's base,
 * so a copy keeps this branch building alone; once S5 is merged, replace the type block by `import type { ... } from '@opc/shared'` (see "Implementation notes (F5)").
 * A route the server does not have answers 404/405: `null` means "feature off", any other failure still throws.
 * Money is euros, instants are epoch milliseconds, ICAO codes are upper case, a share is a fraction (0.37 is 37 %).
 */

// ---------------------------------------------------------------- components and what their wear costs

export type Component = 'engines' | 'gear' | 'propellers' | 'avionics' | 'interior' | 'paint';
export type Mechanical = 'engines' | 'gear' | 'propellers' | 'avionics';
export type RefurbAction = 'overhaul' | 'replace';
export type Choice = 'leave' | RefurbAction;
/** What a component costs at its wear: a fraction of speed (0.03 is -3 %), points of reliability, points of satisfaction (out of 5), a fraction of passengers. */
export type Effects = { performance: number; reliability: number; satisfaction: number; load: number };
/** The aircraft as it is or would be: performance and load as fractions (-0.04), reliability in percent, satisfaction out of 5. */
export type Kpi = { performance: number; reliability: number; satisfaction: number; load: number };
export type ChoiceView = {
  action: Choice; cost: number; wearAfter: number;
  /** What the component's wear takes a month once this choice is made. */
  monthlyLoss: number;
  /** Months to earn the cost back; null when it never does. */
  paybackMonths: number | null;
  /** Over the months left: gained minus spent. On a lease: handing the aircraft back (the new parts stay with the lessor). */
  net: number;
  /** The same when the aircraft is bought at the end of the lease; equals `net` when the aircraft is not on a lease. */
  netIfBought: number;
  days: number;
};
export type Selection = { component: Component; action: Choice }[];
export type Totals = {
  cost: number; itemDays: number;
  give: number; buy: number;
  /** Cumulative cash at the end of each month (month 1 first). */
  cashCurve: number[]; breakEvenMonth: number | null;
};
export type ComponentWear = { component: Component; wearPct: number; effects: Effects; worksUntil: number | null; choices: Record<Choice, ChoiceView> };
export type WearView = {
  aircraft: { id: number; registration: string; icao: string; typeName: string; ownership: string; value: number; wearPct: number };
  /** False when the company plays without wear and failures: nothing wears, and the works are refused. */
  active: boolean;
  /** The company can send it to the workshop: it is hers (owned, financed or leased) and wear is on. */
  refurbishable: boolean;
  lease: { endsAt: number | null; monthsLeft: number; purchaseOptionPrice: number; maintenanceIncluded: boolean; lessor: string | null } | null;
  /** The months the gains are counted over: the months left on a lease, else 24. */
  months: number;
  hoursPerMonth: number;
  components: ComponentWear[];
  kpi: { now: Kpi; after: Kpi };
  recommended: Selection;
  /** The selection asked by `?pick=`, else the recommended one. Everything below it follows it. */
  selection: Selection;
  totals: Totals;
  works: { days: number; downtimeFactor: number; heavyHangar: boolean; ferry: boolean; ferryCost: number };
  /** Cash after the works (the selection's cost and the ferry). */
  balanceAfter: number;
};
export type RefurbishResult = { cost: number; ferry: number; downUntil: number; balanceAfter: number; items: { component: Component; action: RefurbAction; cost: number }[] };

// ---------------------------------------------------------------- spare parts

export type PartClass = 'piston' | 'turboprop' | 'regional' | 'jet';
export type PartKind = 'engine' | 'starter' | 'propeller' | 'avionics' | 'brake' | 'wheel';
export type PartsPolicy = 'none' | 'critical' | 'full';
/** A part on the hub's shelf. One shelf serves every type of the part's class. */
export type StockLine = { part: string; name: string; cls: PartClass; kind: PartKind; unitPrice: number; qty: number; inTransit: number; value: number; target: number };
export type PartsPolicyOption = { policy: PartsPolicy; capital: number; groundDays: number };
export type TypePolicy = {
  icao: string; name: string; cls: PartClass; aircraft: { id: number; registration: string }[];
  policy: PartsPolicy;
  /** What one day on the ground costs: a day of the type's line revenue (B.8). */
  dayValue: number;
  failuresPerYear: number;
  /** What each policy ties up and the ground days a year it leaves, for the whole type. */
  options: PartsPolicyOption[];
  /** The ground days a year of the whole type with what is on the shelf now (a kit still on its way does not count). */
  expectedGroundDays: number;
  /** The shelf holds the type's critical kit. */
  covered: boolean;
};
export type AogCase = {
  aircraftId: number; registration: string; icao: string; typeName: string; component: Mechanical;
  part: string; partName: string; failedAt: number; eta: number;
  /** The aircraft flies again at this instant. `fromStock`: the part was on the shelf, so this is the hours of the repair. */
  readyAt: number; fromStock: boolean;
  /** Euros of flying lost from the failure to `readyAt`, and the euros a day. */
  lost: number; dayValue: number;
  /** What the part cost with the freight. */
  paid: number;
  /** With the part on the shelf the aircraft would be back at this instant. */
  withPartBackAt: number;
  /** The critical kit of the type: what it ties up. */
  criticalKit: number;
};
export type WarehouseView = {
  hub: string;
  /** The shelf needs no building: always null. */
  facility: null;
  /** False when the company plays without wear and failures: nothing breaks down. */
  active: boolean;
  /** Value of the shelf, its share of the balance (a fraction), and what is on its way (paid, not yet immobilised). */
  capital: number; capitalShare: number; onOrder: number; balance: number;
  expectedGroundDays: number;
  covered: { count: number; of: number };
  aog: AogCase | null;
  policies: TypePolicy[];
  inventory: StockLine[];
};
export type PolicyResult = { icao: string; policy: PartsPolicy; capital: number; deltaGroundDays: number; annualSaving: number; ordered: number; refund: number; balanceAfter: number };

async function optional<T>(path: string): Promise<T | null> {
  try {
    return await api<T>(path);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return null;
    throw e;
  }
}

export const fetchWarehouse = (hub: string): Promise<WarehouseView | null> => optional<WarehouseView>(`/warehouse/${encodeURIComponent(hub)}`);
export const setPolicy = (hub: string, icao: string, policy: PartsPolicy): Promise<PolicyResult> =>
  api<PolicyResult>(`/warehouse/${encodeURIComponent(hub)}/policy`, { method: 'PUT', body: { icao, policy } });
/** `pick` is the player's selection as `gear:overhaul,avionics:leave` (see `pickOf`): the server answers with everything below it (kpi, totals, works, balance) for that selection. */
export const fetchWear = (aircraftId: number, pick?: string): Promise<WearView | null> =>
  optional<WearView>(`/me/fleet/${aircraftId}/wear${pick ? `?pick=${encodeURIComponent(pick)}` : ''}`);
export const refurbish = (aircraftId: number, items: { component: Component; action: RefurbAction }[]): Promise<RefurbishResult> =>
  api<RefurbishResult>(`/me/fleet/${aircraftId}/refurbish`, { method: 'POST', body: { items } });
