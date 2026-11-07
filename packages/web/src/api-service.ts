import type { CatererQuote, CrewRow, HaulClass, HaulView, HubKitchen, KitchenDeparture, KitchenProvider, KitchenQualityRow, KitchenView, MealQuality, PolicyCell, QualityCard, ServiceItem, ServiceMode, ServicePreview, ServiceView } from '@opc/shared';
import { api } from './api.ts';
import { ApiError } from './errors.ts';

/**
 * Typed client for the SERVICE section of docs/v3-plan.md (B.7).
 * The wire types are S6's, from `@opc/shared` (`shared/src/service.ts`); only the client's own `PolicyBody` and `KitchenBody` are declared here.
 * A route the server does not have answers 404/405: `null` means "feature off", any other failure still throws.
 * Money is euros, a rate is a fraction (0.54 is 54 %), satisfaction runs 1 to 5, instants are epoch milliseconds, days are ISO dates (UTC).
 * Every change applies from the next UTC midnight (`applyFrom`): a `next` field says what is pending.
 */

export type { CatererQuote, CrewRow, HaulClass, HaulView, HubKitchen, KitchenDeparture, KitchenProvider, KitchenQualityRow, KitchenView, MealQuality, PolicyCell, QualityCard, ServiceItem, ServiceMode, ServicePreview, ServiceView };

export type PolicyBody = { haul: HaulClass; item: ServiceItem; mode: ServiceMode };
export type KitchenBody = { quality?: MealQuality; provider?: KitchenProvider };

async function optional<T>(path: string): Promise<T | null> {
  try {
    return await api<T>(path);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return null;
    throw e;
  }
}

export const fetchService = (): Promise<ServiceView | null> => optional<ServiceView>('/service');
export const fetchQualityPreview = (quality: MealQuality): Promise<ServicePreview | null> => optional<ServicePreview>(`/service/preview?quality=${quality}`);
export const fetchKitchen = (hub: string): Promise<KitchenView | null> => optional<KitchenView>(`/kitchen/${encodeURIComponent(hub)}`);

export const setPolicy = (body: PolicyBody): Promise<ServiceView> => api<ServiceView>('/service/policy', { method: 'PUT', body });
export const setMealQuality = (quality: MealQuality): Promise<ServiceView> => api<ServiceView>('/service/meal-quality', { method: 'PUT', body: { quality } });
export const setKitchen = (hub: string, body: KitchenBody): Promise<KitchenView> => api<KitchenView>(`/kitchen/${encodeURIComponent(hub)}`, { method: 'PUT', body });
export const requestQuote = (hub: string, quality?: MealQuality): Promise<CatererQuote> => api<CatererQuote>(`/kitchen/${encodeURIComponent(hub)}/quote`, { method: 'POST', body: quality ? { quality } : {} });
