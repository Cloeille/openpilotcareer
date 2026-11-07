import type { GroupCreated, GroupTransferRequest, GroupView, SubsidiaryRequest } from '@opc/shared';
import { api } from './api.ts';
import { ApiError } from './errors.ts';

/** Typed client for the GROUP section of docs/v4-plan.md (B.3). The wire types are `@opc/shared`'s (`shared/src/group.ts`). A route the server does not have answers 404/405: `null` means "feature off".
 *  Money is euros and computed by the server (the answer of a transfer is the refreshed group). */
export async function fetchGroup(): Promise<GroupView | null> {
  try {
    return await api<GroupView>('/group');
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return null;
    throw e;
  }
}
export const createSubsidiary = (body: SubsidiaryRequest): Promise<GroupCreated> => api<GroupCreated>('/group/subsidiaries', { method: 'POST', body });
export const transferGroup = (body: GroupTransferRequest): Promise<GroupView> => api<GroupView>('/group/transfers', { method: 'POST', body });
