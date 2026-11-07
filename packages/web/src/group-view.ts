import { CESSION_REFUSALS, GROUP_ACTIVITIES, GROUP_ROLES, subsidiarySchema, type CessionRefusal, type GroupActivity, type GroupCompany, type GroupCreateRefusal, type GroupRole, type GroupTransferRequest, type GroupView, type SubsidiaryRequest } from '@opc/shared';
import type { Key } from './messages.ts';

/** What the group screens decide without asking the server: which side of a transfer is which, which aircraft can be ticked, what the request is. The money is always the server's. */

export const ACTIVITY_KEY: Record<GroupActivity, Key> = { passengers: 'gr.activity.passengers', cargo: 'gr.activity.cargo', charter: 'gr.activity.charter' };
export const ROLE_KEY: Record<GroupRole, Key> = { parent: 'gr.role.parent', subsidiary: 'gr.role.subsidiary' };
/** Why an aircraft cannot be ceded now. */
export const CESSION_KEY: Record<CessionRefusal, Key> = {
  leased_aircraft: 'gr.cession.leased_aircraft', aircraft_busy: 'gr.cession.aircraft_busy', in_maintenance: 'gr.cession.in_maintenance', aircraft_on_line: 'gr.cession.aircraft_on_line',
};
/** Why no subsidiary can be founded from the company on show. */
export const CREATE_REFUSAL_KEY: Record<GroupCreateRefusal, Key> = { is_subsidiary: 'gr.refusal.is_subsidiary', limit_reached: 'gr.refusal.limit_reached' };
export { CESSION_REFUSALS, GROUP_ACTIVITIES, GROUP_ROLES };

export const FUNDING_STEP = 10_000;

export const parentOf = (g: GroupView): GroupCompany => g.companies[0]!;
export const subsidiariesOf = (g: GroupView): GroupCompany[] => g.companies.slice(1);
const byId = (g: GroupView, id: number | null): GroupCompany | null => g.companies.find((c) => c.id === id) ?? null;

/** One more or one fewer step of cash, never below zero. */
export const stepCash = (cash: number, dir: 1 | -1): number => Math.max(0, (Math.round(cash / FUNDING_STEP) + dir) * FUNDING_STEP);

/** Tick or untick one id. */
export const toggleId = (ids: readonly number[], id: number): number[] => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

// ---------------------------------------------------------------- founding

export type NewDraft = { name: string; code: string; iata: string; hub: string; activity: GroupActivity; funding: number; aircraft: number[] };
export const emptyDraft = (hub: string): NewDraft => ({ name: '', code: '', iata: '', hub, activity: 'passengers', funding: 0, aircraft: [] });

/** The request the draft stands for, or null while the shared schema (the server's own) would refuse it. */
export function requestOf(d: NewDraft): SubsidiaryRequest | null {
  const r = subsidiarySchema.safeParse({ name: d.name, hub: d.hub.trim().toUpperCase(), code: d.code, ...(d.iata.trim() ? { iata: d.iata } : {}), activity: d.activity, funding: d.funding, aircraftIds: d.aircraft });
  return r.success ? r.data : null;
}

// ---------------------------------------------------------------- transfers

/** `sub`: the subsidiary on the other end; `reversed`: the subsidiary gives and the parent receives. */
export type TransferDraft = { sub: number | null; reversed: boolean; cash: number; aircraft: number[] };
export const emptyTransfer = (): TransferDraft => ({ sub: null, reversed: false, cash: 0, aircraft: [] });

/** The draft with only what is still true of the group: a subsidiary that exists (the first when none is chosen) and aircraft the giver still holds. */
export function cleanTransfer(g: GroupView, d: TransferDraft): TransferDraft {
  const subs = subsidiariesOf(g);
  const sub = subs.find((s) => s.id === d.sub) ?? subs[0] ?? null;
  const giver = sub ? (d.reversed ? sub : parentOf(g)) : null;
  return { ...d, sub: sub?.id ?? null, aircraft: d.aircraft.filter((id) => giver?.fleet.some((a) => a.id === id && a.cession === null)) };
}

/** Who gives and who receives. Null while the group has no subsidiary. */
export function sides(g: GroupView, d: TransferDraft): { from: GroupCompany; to: GroupCompany } | null {
  const sub = byId(g, d.sub);
  if (!sub || sub.role !== 'subsidiary') return null;
  return d.reversed ? { from: sub, to: parentOf(g) } : { from: parentOf(g), to: sub };
}

/** The request of the draft, or null while it moves nothing. The server decides the rest (funds, aircraft). */
export function transferRequest(g: GroupView, d: TransferDraft): GroupTransferRequest | null {
  const s = sides(g, d);
  return s && (d.cash > 0 || d.aircraft.length > 0) ? { from: s.from.id, to: s.to.id, cash: d.cash, aircraftIds: d.aircraft } : null;
}

/** The next subsidiary after `id`, wrapping; the first when `id` is none of them. */
export function nextSub(g: GroupView, id: number | null): number | null {
  const subs = subsidiariesOf(g);
  if (subs.length === 0) return null;
  const i = subs.findIndex((s) => s.id === id);
  return subs[(i + 1) % subs.length]!.id;
}
