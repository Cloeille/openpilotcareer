import { MANUAL_PAY_FACTOR, REJECT_REPUTATION_PENALTY, minFlightHours, seasonOf, settle, type AircraftType, type AirportSize, type CancelCause, type Flight, type FlightStatus, type HistoryEntry, type HistorySource, type LineLeg, type Settlement } from '@opc/shared';
import { hashFor } from './keys.ts';

/** A tab of the log: the verification of a flown flight, or whether a line leg happened (`done`: it left, so its money is posted, even if it is still in the air). */
export type StatusFilter = 'all' | Exclude<FlightStatus, 'active'> | 'done';
export const STATUS_FILTERS: readonly StatusFilter[] = ['all', 'verified', 'unverified', 'rejected', 'done', 'cancelled'];
export type FlightFilter = { source: HistorySource; status: StatusFilter; aircraftId: number | null; season: string | null };
export const NO_FILTER: FlightFilter = { source: 'all', status: 'all', aircraftId: null, season: null };

/** The tabs that can match something from `source`: verification tabs for flights the player flew, `done` for line legs. */
export const tabsOf = (source: HistorySource): readonly StatusFilter[] =>
  STATUS_FILTERS.filter((s) => s === 'all' || s === 'cancelled' || (s === 'done' ? source !== 'flown' : source !== 'lines'));

/** When a flight was closed (or accepted, while it is still open). */
export const closedAt = (f: Pick<Flight, 'completedAt' | 'acceptedAt'>): number => f.completedAt ?? f.acceptedAt;
export const seasonOfFlight = (f: Pick<Flight, 'completedAt' | 'acceptedAt'>): string => seasonOf(closedAt(f));

export const entryStatus = (e: HistoryEntry): FlightStatus | 'done' => (e.source === 'flown' ? e.flight.status : e.leg.status === 'cancelled' ? 'cancelled' : 'done');
export const entryAircraft = (e: HistoryEntry): number => (e.source === 'flown' ? e.flight.aircraftId : e.leg.aircraftId);

const matchesNonStatus = (e: HistoryEntry, flt: FlightFilter): boolean =>
  (flt.source === 'all' || (flt.source === 'lines') === (e.source === 'line')) && (flt.aircraftId === null || entryAircraft(e) === flt.aircraftId) && (flt.season === null || seasonOf(e.at) === flt.season);

/** The log entries matching the filter, in the order the server gave them (newest first: both sources share one date order). */
export const filterEntries = (entries: HistoryEntry[], flt: FlightFilter): HistoryEntry[] =>
  entries.filter((e) => matchesNonStatus(e, flt) && (flt.status === 'all' || entryStatus(e) === flt.status));

/** How many entries each status tab would show under the other filters. */
export function statusCounts(entries: HistoryEntry[], flt: FlightFilter): Record<StatusFilter, number> {
  const base = entries.filter((e) => matchesNonStatus(e, flt));
  return Object.fromEntries(STATUS_FILTERS.map((s) => [s, s === 'all' ? base.length : base.filter((e) => entryStatus(e) === s).length])) as Record<StatusFilter, number>;
}

/** Seasons that have at least one entry, newest first. */
export const seasonsOf = (entries: HistoryEntry[]): string[] => [...new Set(entries.map((e) => seasonOf(e.at)))].sort().reverse();

export type SeasonTotals = {
  /** Flown flights net plus line legs net: what both sources earned in the season. */
  net: number; flownNet: number; linesNet: number;
  /** Flown flights that went through verification (verified, manual, rejected), and how many of them were verified. */
  flown: number; verified: number;
  /** Line legs that left (money posted) and legs that did not. */
  legs: number; cancelledLegs: number;
};
/** The totals of a season over both sources. A flown flight's net counts when paid (verified + manual: the others are 0); a leg's net is `revenue - fuel - landing fees - maintenance` (crews and cabin service are posted apart). */
export function seasonTotals(entries: HistoryEntry[], season: string): SeasonTotals {
  const inSeason = entries.filter((e) => seasonOf(e.at) === season);
  const flights = inSeason.flatMap((e) => (e.source === 'flown' ? [e.flight] : []));
  const legs = inSeason.flatMap((e) => (e.source === 'line' ? [e.leg] : []));
  const checked = flights.filter((f) => f.status === 'verified' || f.status === 'unverified' || f.status === 'rejected');
  const flownNet = flights.reduce((n, f) => n + f.net, 0), linesNet = legs.reduce((n, l) => n + l.net, 0);
  const cancelledLegs = legs.filter((l) => l.status === 'cancelled').length;
  return { net: flownNet + linesNet, flownNet, linesNet, flown: checked.length, verified: checked.filter((f) => f.status === 'verified').length, legs: legs.length - cancelledLegs, cancelledLegs };
}

/** What happened to a line leg, for its badge: `late` is a delay in minutes (still waiting to leave, in the air late, or landed late). */
export type LegState = { kind: 'cancelled'; cause: CancelCause | null } | { kind: 'flying' } | { kind: 'late'; delayMin: number } | { kind: 'done' };
export const legState = (l: Pick<LineLeg, 'status' | 'delayMin' | 'cancelCause'>): LegState =>
  l.status === 'cancelled' ? { kind: 'cancelled', cause: l.cancelCause } : l.status === 'flying' ? { kind: 'flying' } : l.delayMin > 0 ? { kind: 'late', delayMin: l.delayMin } : { kind: 'done' };

/** One row of the log, whichever source it comes from. `net` is null when nothing was earned. `href` is where the row leads: the flight's page, or the page of its line. */
export type LogRow = { key: string; at: number; origin: string; dest: string; aircraftId: number; icao: string; reg: string | null; net: number | null; href: string } & (
  | { source: 'flown'; flight: Flight }
  | { source: 'line'; flightNo: string; pax: number | null; revenue: number; costs: number; state: LegState });

/** `regOf`: the registration of an aircraft of the fleet (null when it is gone). */
export function rowOf(e: HistoryEntry, regOf: (aircraftId: number) => string | null): LogRow {
  if (e.source === 'flown') {
    const f = e.flight;
    return { key: e.cursor, at: e.at, origin: f.job.origin, dest: f.job.destination, aircraftId: f.aircraftId, icao: f.aircraftIcao, reg: regOf(f.aircraftId), net: f.status === 'verified' || f.status === 'unverified' ? f.net : null, href: hashFor('flight', f.id), source: 'flown', flight: f };
  }
  const l = e.leg;
  const state = legState(l);
  return {
    key: e.cursor, at: e.at, origin: l.origin, dest: l.dest, aircraftId: l.aircraftId, icao: l.icao, reg: l.reg, net: state.kind === 'cancelled' ? null : l.net, href: l.lineId === null ? '#network' : hashFor('line', l.lineId),
    source: 'line', flightNo: l.flightNo, pax: l.pax, revenue: l.revenue, costs: l.fuelCost + l.landingFee + l.maintenance, state,
  };
}

/** The last `n` legs of lines that have landed, newest first (the log is already in that order): what the dashboard shows of the lines. */
export const landedLegs = (entries: HistoryEntry[], n: number): LineLeg[] =>
  entries.flatMap((e) => (e.source === 'line' && e.leg.status === 'done' ? [e.leg] : [])).slice(0, n);

/** The flights of the log (closed ones) newest first: what the flight pages step through. */
const logOrder = (flights: Flight[]): Flight[] => flights.filter((f) => f.status !== 'active').sort((a, b) => closedAt(b) - closedAt(a) || b.id - a.id);

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

/** The closed flights either side of `id` in the log (newest first). Null at the ends, and for a flight the list does not hold (an open one, or older than the page the list was loaded with). */
export function flightNeighbours(flights: Flight[], id: number): { older: Flight | null; newer: Flight | null } {
  const log = logOrder(flights);
  const i = log.findIndex((f) => f.id === id);
  return i === -1 ? { older: null, newer: null } : { older: log[i + 1] ?? null, newer: log[i - 1] ?? null };
}

/** The earnings statement of a flight as a two-column CSV (stable English item names, plain numbers in euros, the coefficient as a fraction), for a spreadsheet. */
export function statementCsv(f: Flight): string {
  const s = statement(f);
  const rows: [string, number][] = [['payout', s.payout], ['coefficient', s.factor], ['revenue', s.revenue], ['fuel', -s.fuel], ['landing_fee', -s.landing], ['maintenance', -s.maintenance], ['net', s.net]];
  return ['item,amount', ...rows.map(([item, amount]) => `${item},${amount}`)].join('\r\n') + '\r\n';
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
