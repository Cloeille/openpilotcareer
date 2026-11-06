import type { AircraftType, CompanyProfile, Leaderboard } from '@opc/shared';
import { api } from './api.ts';
import { airportInfo, cityOf } from './airports.ts';
import { previousSeason, withGain, type Standing } from './standings.ts';

/** A season's standings with each company's season gain (net worth against the end of the season before). */
export type Season = { season: string; seasons: string[]; standings: Standing[]; raw: Leaderboard; before: Leaderboard | null };

export async function loadSeason(season?: string): Promise<Season> {
  const lb = await api<Leaderboard>(`/leaderboard${season ? `?season=${season}` : ''}`);
  const prev = previousSeason(lb, lb.season);
  const before = prev ? await api<Leaderboard>(`/leaderboard?season=${prev}`).catch(() => null) : null;
  return { season: lb.season, seasons: lb.seasons, standings: withGain(lb.rows, before?.rows ?? null), raw: lb, before };
}

export const loadProfile = (companyId: number): Promise<CompanyProfile | null> => api<CompanyProfile>(`/companies/${companyId}`).catch(() => null);

const types = new Map<string, Promise<AircraftType | null>>();
/** Aircraft types by ICAO code, cached; the server's name ("DHC-8 Q400") is the label, the code itself when unknown. */
export async function typesOf(icaos: string[]): Promise<Map<string, AircraftType>> {
  const found = await Promise.all(icaos.map((icao) => {
    let p = types.get(icao);
    if (!p) { p = api<AircraftType>(`/aircraft-types/${icao}`).catch(() => null); types.set(icao, p); }
    return p;
  }));
  return new Map(found.filter((x): x is AircraftType => x !== null).map((x) => [x.icao, x]));
}

export async function cityName(icao: string): Promise<string> {
  const a = await airportInfo(icao);
  return a ? cityOf(a) : icao;
}
