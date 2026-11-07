import type { CreditRequest, CreditSheet, CreditSigned, CreditsView, PrepayDone, PrepayQuote, PrepayRequest } from '@opc/shared';
import { api } from './api.ts';
import { ApiError } from './errors.ts';

/** Typed client for the CREDIT section of docs/v4-plan.md (B.3). The wire types are `@opc/shared`'s (`shared/src/credit.ts`). A route the server does not have answers 404/405: `null` means "feature off".
 *  Money is euros and computed by the server (a quote carries the balance after it), instants are epoch milliseconds, months `YYYY-MM`. */
export async function fetchCredits(): Promise<CreditsView | null> {
  try {
    return await api<CreditsView>('/credits');
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return null;
    throw e;
  }
}
export const quoteCredit = (body: CreditRequest): Promise<CreditSheet> => api<CreditSheet>('/credits/quote', { method: 'POST', body });
export const signCredit = (body: CreditRequest): Promise<CreditSigned> => api<CreditSigned>('/credits', { method: 'POST', body });
export const quotePrepay = (id: number, body: PrepayRequest): Promise<PrepayQuote> => api<PrepayQuote>(`/credits/${id}/prepay/quote`, { method: 'POST', body });
export const prepayCredit = (id: number, body: PrepayRequest): Promise<PrepayDone> => api<PrepayDone>(`/credits/${id}/prepay`, { method: 'POST', body });
