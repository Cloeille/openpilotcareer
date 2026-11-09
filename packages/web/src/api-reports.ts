import type { CashView, DecisionId, DecisionResult, ForecastView, ProfitBy, ProfitView, Scope, StatementView } from '@opc/shared';
import { api } from './api.ts';
import { ApiError } from './errors.ts';

/** Typed client for the REPORTS section of docs/v4-plan.md (B.3). The wire types are `@opc/shared`'s (`shared/src/reports.ts`). A route the server does not have answers 404/405: `null` means "feature off". Money is euros, instants epoch milliseconds, months `YYYY-MM`, days `YYYY-MM-DD` (UTC). */

async function optional<T>(path: string): Promise<T | null> {
  try {
    return await api<T>(path);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return null;
    throw e;
  }
}

const qs = (o: Record<string, string | number | undefined>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export type StatementFilter = { from?: string; to?: string; category?: string; line?: number; before?: number; limit?: number; scope?: Scope };

export const fetchCash = (months: number): Promise<CashView | null> => optional<CashView>(`/finance/cash${qs({ months })}`);
export const fetchProfit = (by: ProfitBy, month?: string): Promise<ProfitView | null> => optional<ProfitView>(`/finance/lines${qs({ by, month })}`);
export const fetchStatement = (f: StatementFilter): Promise<StatementView | null> => optional<StatementView>(`/finance/ledger${qs(f)}`);
export const fetchForecast = (): Promise<ForecastView | null> => optional<ForecastView>('/finance/forecast');
export const testDecision = (decision: DecisionId): Promise<DecisionResult> => api<DecisionResult>('/finance/forecast/decision', { method: 'POST', body: { decision } });
