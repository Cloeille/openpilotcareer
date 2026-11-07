import type { AogCase, Choice, ChoiceView, Component, ComponentWear, Effects, Kpi, Mechanical, PartClass, PartKind, PartsPolicy, PartsPolicyOption, PolicyResult, RefurbAction, RefurbishResult, Selection, StockLine, Totals, TypePolicy, WarehouseView, WearView } from '@opc/shared';
import { api } from './api.ts';
import { ApiError } from './errors.ts';

/**
 * Typed client for the PARTS section of docs/v3-plan.md (B.6).
 * The wire types are S5's, from `@opc/shared` (`shared/src/parts.ts`); `.ts` here is only the client.
 * A route the server does not have answers 404/405: `null` means "feature off", any other failure still throws.
 * Money is euros, instants are epoch milliseconds, ICAO codes are upper case, a share is a fraction (0.37 is 37 %).
 */

export type { AogCase, Choice, ChoiceView, Component, ComponentWear, Effects, Kpi, Mechanical, PartClass, PartKind, PartsPolicy, PartsPolicyOption, PolicyResult, RefurbAction, RefurbishResult, Selection, StockLine, Totals, TypePolicy, WarehouseView, WearView };

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
