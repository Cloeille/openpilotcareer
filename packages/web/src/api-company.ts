import type { CompanyImpact, Me, StartMode } from '@opc/shared';
import { api } from './api.ts';

/** `GET /companies/:id/impact`: what a delete or reset would erase. */
export const companyImpact = (id: number): Promise<CompanyImpact> => api<CompanyImpact>(`/companies/${id}/impact`);
/** `DELETE /companies/:id`: the password is checked again by the server. */
export const deleteCompany = (id: number, password: string): Promise<void> => api<void>(`/companies/${id}`, { method: 'DELETE', body: { password } });
/** `POST /companies/:id/reset`: same company, new career from `startMode`; the onboarding then waits at the first aircraft. */
export const resetCompany = (id: number, password: string, startMode: StartMode): Promise<Me> => api<Me>(`/companies/${id}/reset`, { method: 'POST', body: { password, startMode } });
