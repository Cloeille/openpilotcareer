// Lot SIMBRIEF-LINK: the saved SimBrief connection (a public identifier, never a secret) and the SimBrief dispatch redirect.
import { z } from 'zod';

/** SimBrief's "Dispatch Redirect": opens the dispatch options page with the given fields filled in. The player must be signed in to SimBrief in their browser. */
export const SIMBRIEF_DISPATCH_URL = 'https://dispatch.simbrief.com/options/custom';

const username = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._ -]+$/, 'invalid SimBrief username');
const pilotId = z.int().min(1).max(9_999_999);
const exactlyOne = (a: unknown, b: unknown): boolean => (a === undefined) !== (b === undefined);
const ONE_OF = { message: 'give either a SimBrief username or a Pilot ID' };

/** `PUT /me/simbrief`: the account's SimBrief username or its numeric Pilot ID (SimBrief → Account Settings), one of them. */
export const simbriefConnectSchema = z.object({ username: username.optional(), pilotId: pilotId.optional() }).refine((b) => exactlyOne(b.username, b.pilotId), ONE_OF);
/** `POST /jobs/import-simbrief`: whose latest plan to import. `simbriefUsername` is the original field; `pilotId` is the alternative. */
export const simbriefImportSchema = z.object({ simbriefUsername: username.optional(), pilotId: pilotId.optional() }).refine((b) => exactlyOne(b.simbriefUsername, b.pilotId), ONE_OF);

/** What is saved for an account. Both fields can be set: a username lookup also learns the Pilot ID. `verifiedAt` is when SimBrief last confirmed the account exists. */
export type SimbriefLink = { username: string | null; pilotId: number | null; verifiedAt: number | null };
/** The SimBrief side of a flight: the id that finds exactly this plan again, and the plan that was fetched for it (if any). */
export type FlightSimbrief = { staticId: string; ofpId: string | null };

/** What a player typed in one field: only digits (at most 7) is a Pilot ID, anything else a username. Null for empty or invalid input. */
export function simbriefIdentifier(input: string): { username: string } | { pilotId: number } | null {
  const text = input.trim();
  if (/^\d{1,7}$/.test(text) && Number(text) > 0) return { pilotId: Number(text) };
  const u = username.safeParse(text);
  return u.success ? { username: u.data } : null;
}

export type DispatchParams = {
  /** Aircraft ICAO type. */
  type: string;
  orig: string;
  dest: string;
  airline?: string | undefined;
  fltnum?: string | undefined;
  callsign?: string | undefined;
  reg?: string | undefined;
  /** Passengers; when above 0 it wins over `cargoKg`. */
  pax?: number | undefined;
  cargoKg?: number | undefined;
  staticId?: string | undefined;
};

/** The dispatch redirect URL for a flight. Only SimBrief's documented fields are ever written, values are percent-encoded, and weights are metric (`units=KGS`; `cargo` is in thousands of units). */
export function dispatchUrl(p: DispatchParams): string {
  const url = new URL(SIMBRIEF_DISPATCH_URL);
  const q = url.searchParams;
  q.set('type', p.type);
  q.set('orig', p.orig);
  q.set('dest', p.dest);
  const set = (key: string, value: string | undefined): void => { if (value) q.set(key, value); };
  set('airline', p.airline);
  set('fltnum', p.fltnum);
  set('callsign', p.callsign);
  set('reg', p.reg);
  if (p.pax !== undefined && p.pax > 0) q.set('pax', String(Math.round(p.pax)));
  else if (p.cargoKg !== undefined && p.cargoKg > 0) q.set('cargo', String(Math.round(p.cargoKg) / 1000));
  q.set('units', 'KGS');
  set('static_id', p.staticId);
  return url.href;
}
