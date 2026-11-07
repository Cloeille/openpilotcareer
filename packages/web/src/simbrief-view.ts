/** Pure logic of the SimBrief link in the UI: who is connected, and the dispatch address of a flight. No DOM, no network. */
import { dispatchUrl, type Company, type Flight, type SimbriefLink } from '@opc/shared';

export const isConnected = (link: SimbriefLink | null): link is SimbriefLink => link !== null && (link.username !== null || link.pilotId !== null);

/** The SimBrief dispatch page for an accepted flight, filled in from it; null for a flight that has no SimBrief id (not a player's flight).
 *  Passengers for a passenger job, else the cargo weight. `code` and `callsign` come from the company when it has them. */
export function dispatchFor(f: Flight, company: Pick<Company, 'code' | 'callsign'>, registration: string | null | undefined): string | null {
  if (!f.simbrief) return null;
  const pax = f.job.kind === 'pax';
  return dispatchUrl({
    type: f.aircraftIcao, orig: f.job.origin, dest: f.job.destination,
    airline: company.code ?? undefined, callsign: company.callsign ?? undefined, reg: registration ?? undefined,
    ...(pax ? { pax: f.job.pax } : { cargoKg: f.job.payloadKg }),
    staticId: f.simbrief.staticId,
  });
}

/** What the flight card says about the plan: nothing fetched yet, or the plan id with its fuel and route. */
export type PlanState = { kind: 'none' } | { kind: 'fetched'; ofpId: string; fuelKg: number | null; route: string | null };
export function planState(f: Flight): PlanState {
  const ofpId = f.simbrief?.ofpId;
  return ofpId ? { kind: 'fetched', ofpId, fuelKg: f.job.plannedFuelKg ?? null, route: f.job.route ?? null } : { kind: 'none' };
}
