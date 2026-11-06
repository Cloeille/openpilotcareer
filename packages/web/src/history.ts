import { MANUAL_PAY_FACTOR, REJECT_REPUTATION_PENALTY, minFlightHours, seasonOf, settle, type AircraftType, type AirportSize, type Flight, type FlightStatus, type Settlement } from '@opc/shared';

export type StatusFilter = 'all' | Exclude<FlightStatus, 'active'>;
export const STATUS_FILTERS: readonly StatusFilter[] = ['all', 'verified', 'unverified', 'rejected', 'cancelled'];
export type FlightFilter = { status: StatusFilter; aircraftId: number | null; season: string | null };
export const NO_FILTER: FlightFilter = { status: 'all', aircraftId: null, season: null };

/** When a flight was closed (or accepted, while it is still open). */
export const closedAt = (f: Pick<Flight, 'completedAt' | 'acceptedAt'>): number => f.completedAt ?? f.acceptedAt;
export const seasonOfFlight = (f: Pick<Flight, 'completedAt' | 'acceptedAt'>): string => seasonOf(closedAt(f));

const matchesNonStatus = (f: Flight, flt: FlightFilter): boolean =>
  f.status !== 'active' && (flt.aircraftId === null || f.aircraftId === flt.aircraftId) && (flt.season === null || seasonOfFlight(f) === flt.season);

/** Closed flights matching the filter, newest first. Open flights live on the dashboard, not in the log. */
export function filterFlights(flights: Flight[], flt: FlightFilter): Flight[] {
  return flights.filter((f) => matchesNonStatus(f, flt) && (flt.status === 'all' || f.status === flt.status)).sort((a, b) => closedAt(b) - closedAt(a) || b.id - a.id);
}

/** How many flights each status tab would show under the other filters. */
export function statusCounts(flights: Flight[], flt: FlightFilter): Record<StatusFilter, number> {
  const base = flights.filter((f) => matchesNonStatus(f, flt));
  return { all: base.length, verified: base.filter((f) => f.status === 'verified').length, unverified: base.filter((f) => f.status === 'unverified').length, rejected: base.filter((f) => f.status === 'rejected').length, cancelled: base.filter((f) => f.status === 'cancelled').length };
}

/** Seasons that have at least one closed flight, newest first. */
export const seasonsOf = (flights: Flight[]): string[] => [...new Set(flights.filter((f) => f.status !== 'active').map(seasonOfFlight))].sort().reverse();

/** Net result of a season (paid flights: verified + manual) and how many of the flights that went through verification (verified, manual, rejected) were verified. */
export function seasonTotals(flights: Flight[], season: string): { net: number; flown: number; verified: number } {
  const inSeason = flights.filter((f) => seasonOfFlight(f) === season);
  const flown = inSeason.filter((f) => f.status === 'verified' || f.status === 'unverified' || f.status === 'rejected');
  return { net: inSeason.reduce((n, f) => n + f.net, 0), flown: flown.length, verified: flown.filter((f) => f.status === 'verified').length };
}

/** Share of the job's payout the flight earned: full when verified, MANUAL_PAY_FACTOR when entered by hand, nothing otherwise. */
export const payFactor = (status: FlightStatus): number => (status === 'verified' ? 1 : status === 'unverified' ? MANUAL_PAY_FACTOR : 0);

export type Statement = { payout: number; factor: number; revenue: number; fuel: number; landing: number; maintenance: number; charges: number; net: number; reputation: number | null };
/** The earnings statement of a closed flight, from the amounts the server recorded. Reputation: only the rejection penalty is known exactly (landing quality, which adjusts the rest, is not exposed). */
export function statement(f: Flight): Statement {
  return {
    payout: f.job.payout, factor: payFactor(f.status), revenue: f.revenue, fuel: f.fuelCost, landing: f.landingFee, maintenance: f.maintenance,
    charges: f.fuelCost + f.landingFee + f.maintenance, net: f.net, reputation: f.status === 'rejected' ? -REJECT_REPUTATION_PENALTY : null,
  };
}

/** What completing an open flight without telemetry will settle to (the server runs the same formula; fuel and block time are estimated from the type). */
export function manualEstimate(f: Pick<Flight, 'job'>, aircraft: AircraftType, destSize: AirportSize, destIsHub: boolean): Settlement {
  return settle({ payout: f.job.payout, distanceNm: f.job.distanceNm, aircraft, destSize, destIsHub, status: 'unverified' });
}

/** Milliseconds until a manual completion is allowed (0 = now). The server enforces this only while anti-cheat is on. */
export function manualWaitMs(f: Pick<Flight, 'acceptedAt' | 'job'>, aircraft: AircraftType, now: number, antiCheat: boolean): number {
  if (!antiCheat) return 0;
  return Math.max(0, f.acceptedAt + minFlightHours(aircraft, f.job.distanceNm) * 3_600_000 - now);
}
