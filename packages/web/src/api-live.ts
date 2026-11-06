import { api } from './api.ts';
import { ApiError } from './errors.ts';

// Client of the LIVE lot of docs/v2-contract.md. Types mirror the contract until the lot's shared types are merged.

export type LiveEngine = { torquePct?: number; n1Pct?: number; ittC?: number; oilPsi?: number };
export type LiveSample = {
  t: number; lat: number; lon: number; altFt: number; gsKts: number; vsFpm: number; headingDeg: number; fuelKg: number;
  phase: string; paused: boolean; simRate: number; flags: string[]; engines: LiveEngine[];
};
export type LiveResponse = { sample: LiveSample | null; receivedAt: number | null; bridgeLost: boolean; remainingNm: number | null; etaAt: number | null };

/** Latest live state of an active flight; null when the server does not offer the route (older server) or does not know the flight. */
export async function fetchLive(flightId: number): Promise<LiveResponse | null> {
  try {
    return await api<LiveResponse>(`/flights/${flightId}/live`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return null;
    throw e;
  }
}

export type BridgeStatus = { sim: string | null; version: string | null; phase: string | null; flags: string[] };
const BRIDGE_URL = 'http://127.0.0.1:7878/status';

/** The bridge's status as seen from the player's PC (CORS is open on that endpoint); null when nothing answers. */
export async function bridgeStatus(): Promise<BridgeStatus | null> {
  try {
    const res = await fetch(BRIDGE_URL, { signal: AbortSignal.timeout(2000), cache: 'no-store' });
    if (!res.ok) return null;
    const b = (await res.json()) as Record<string, unknown>;
    const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
    return { sim: str(b.sim), version: str(b.version), phase: str(b.phase), flags: Array.isArray(b.flags) ? b.flags.filter((f): f is string => typeof f === 'string') : [] };
  } catch {
    return null;
  }
}
