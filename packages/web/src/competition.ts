import type { AircraftType, CompanyProfile, Job, Leaderboard } from '@opc/shared';
import { api, session } from './api.ts';
import { aiCanTake } from './board.ts';

type Rivals = { profiles: CompanyProfile[]; types: Map<string, AircraftType> };
const cache = new Map<string, Promise<Rivals>>();

async function load(): Promise<Rivals> {
  const lb = await api<Leaderboard>('/leaderboard');
  const profiles = (await Promise.all(lb.rows.filter((r) => r.isAI).map((r) => api<CompanyProfile>(`/companies/${r.companyId}`).catch(() => null)))).filter((p): p is CompanyProfile => p !== null);
  const icaos = [...new Set(profiles.flatMap((p) => p.fleet.map((f) => f.icao)))];
  const types = new Map<string, AircraftType>();
  await Promise.all(icaos.map(async (icao) => { const t = await api<AircraftType>(`/aircraft-types/${icao}`).catch(() => null); if (t) types.set(icao, t); }));
  return { profiles, types };
}

/** The AI companies' profiles and the aircraft types they own (loaded once per server, shared with the contested badges). */
export async function aiRivals(): Promise<Rivals> {
  let p = cache.get(session.server);
  if (!p) { p = load(); cache.set(session.server, p); }
  try { return await p; } catch { cache.delete(session.server); return { profiles: [], types: new Map() }; }
}

/** Ids of the given jobs that an AI company could take. Loaded once per server and session; a failure means "unknown", shown as nothing. */
export async function contestedIds(jobs: Job[]): Promise<Set<string>> {
  let p = cache.get(session.server);
  if (!p) { p = load(); cache.set(session.server, p); }
  try {
    const { profiles, types } = await p;
    return new Set(jobs.filter((j) => profiles.some((ai) => aiCanTake(ai, types, j))).map((j) => j.id));
  } catch {
    cache.delete(session.server);
    return new Set();
  }
}

/** The AI company names that could take `job`. */
export async function rivalsFor(job: Job): Promise<string[]> {
  try {
    const { profiles, types } = await (cache.get(session.server) ?? (() => { const p = load(); cache.set(session.server, p); return p; })());
    return profiles.filter((ai) => aiCanTake(ai, types, job)).map((ai) => ai.name);
  } catch {
    return [];
  }
}
