import type { HrFamily, HrOption, HrView, PayLevel } from '@opc/shared';
import { api } from './api.ts';
import { ApiError } from './errors.ts';

/**
 * Typed client for the HR lot of docs/v4-plan.md (B.3, C27, C30, C31): the pay level and the morale it sets. The wire types are the server's, from `@opc/shared` (`shared/src/hr.ts`).
 * A route the server does not have answers 404/405: `null` means "feature off", any other failure still throws. Money is euros and computed by the server; instants are epoch milliseconds.
 */
export type { HrFamily, HrOption, HrView, PayLevel };

export async function fetchHr(): Promise<HrView | null> {
  try {
    return await api<HrView>('/hr');
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return null;
    throw e;
  }
}
/** The change applies from the next UTC midnight (`applyFrom` of the answer). */
export const setHrPay = (payPct: PayLevel): Promise<HrView> => api<HrView>('/hr/policy', { method: 'PUT', body: { payPct } });
