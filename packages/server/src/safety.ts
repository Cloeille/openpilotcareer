// Lot SAFETY (v3): the incident roll (docs/v3-plan.md B.5). One roll per resolved flight, a pure function of the crew's duty time, the aircraft's wear and the rest policy,
// seeded by the roll's reference (`flight:<id>` for a flight the player flew, `leg:<line>:<departure>:<number>` for a line leg): the same flight always gets the same answer.
// A leaf of game.ts and lines.ts (database, ledger, fleet and realism only): both call `rollIncident` after settling, so it imports neither. The read models are in safety-views.ts.
import {
  DAY_MS, DUTY_RELEASE_MIN, INCIDENT_DOWNTIME_DAYS, INCIDENT_REPUTATION, drawIncident, incidentCost, incidentRisk, insuranceSurcharge, isInsured, seasonOf,
  type IncidentKind, type Severity,
} from '@opc/shared';
import { hashSeed, mulberry32 } from './board.ts';
import { all, get, run, type Db } from './db.ts';
import { isHuman } from './fleet-extras.ts';
import { post } from './ledger.ts';
import { reliabilityRisk } from './parts.ts';
import { wearEnabled } from './realism.ts';

export type IncidentRow = {
  id: number; company_id: number; ref: string; at: number; season: string; aircraft_id: number; airport: string; flight_id: number | null; flight_no: number | null;
  severity: Severity; kind: IncidentKind; duty_min: number; wear_pct: number; risk: number; cost: number; covered: number; downtime_until: number; reputation_delta: number;
};

export type Roll = {
  /** The roll's identity and seed; unique per company, so a roll that is played twice is recorded once. */
  ref: string; companyId: number; aircraftId: number; at: number; airport: string; flightId: number | null; flightNo: number | null;
  /** The longest duty period of the crew at the landing, in minutes (a flight the player flew: `flightDutyMin`). */
  dutyMin: number;
  /** The rest policy's factor for a crewed flight; 1 for a flight the player flew (the player is not crew, C4). */
  riskFactor: number;
  /** The aircraft's wear when the flight was flown, before the flight's own wear was added. */
  wearPct: number;
  /** When the aircraft is on the ground again: the repair is counted from here. */
  landedAt: number;
};

/** Do incidents happen to this company? Player companies with "wear and failures" on (the same gate as wear itself). */
export const incidentsOn = (db: Db, companyId: number): boolean => isHuman(db, companyId) && wearEnabled(db, companyId);

/** The longest duty period, in minutes, among the people booked on a line leg: from the report to the release after the landing (just the release when nobody is booked on it). */
export const crewDutyMin = (db: Db, legId: number): number =>
  (get<{ m: number | null }>(db, 'SELECT MAX(arr_at - duty_start) AS m FROM staff_duty WHERE leg_id = ?', legId)?.m ?? 0) / 60_000 + DUTY_RELEASE_MIN;

/** Roll the flight. When it ends in an incident: the journal row, the bill (what the insurance does not pay), the reputation and the workshop. Null when nothing happened
 *  or when the roll was already recorded (so the money and the reputation are never charged twice). */
export function rollIncident(db: Db, r: Roll): IncidentRow | null {
  if (!incidentsOn(db, r.companyId)) return null;
  // v3 parts (B.6): worn gear and avionics lower the aircraft's reliability, which raises the risk
  const risk = incidentRisk(r.dutyMin / 60, r.wearPct, r.riskFactor * reliabilityRisk(db, r.aircraftId));
  const draw = drawIncident(risk, mulberry32(hashSeed(`incident:${r.ref}`)));
  if (!draw) return null;
  const ac = get<{ value: number; registration: string | null }>(db, 'SELECT value, registration FROM aircraft WHERE id = ?', r.aircraftId);
  if (!ac) return null;
  const cost = incidentCost(draw.severity, draw.costUnit, ac.value);
  const covered = isInsured(draw.kind) ? cost : 0;
  const downtimeUntil = r.landedAt + INCIDENT_DOWNTIME_DAYS[draw.severity] * DAY_MS;
  const reputationDelta = INCIDENT_REPUTATION[draw.severity];
  const row = get<IncidentRow>(db, `INSERT INTO incidents (company_id, ref, at, season, aircraft_id, airport, flight_id, flight_no, severity, kind, duty_min, wear_pct, risk, cost, covered, downtime_until, reputation_delta)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (company_id, ref) DO NOTHING RETURNING *`,
  r.companyId, r.ref, r.at, seasonOf(r.at), r.aircraftId, r.airport, r.flightId, r.flightNo, draw.severity, draw.kind, Math.round(r.dutyMin), r.wearPct, risk, cost, covered, downtimeUntil, reputationDelta);
  if (!row) return null;
  if (cost > covered) post(db, r.companyId, r.at, 'incident', -(cost - covered), `${draw.kind} ${ac.registration ?? `#${r.aircraftId}`}`, r.flightId, { aircraftId: r.aircraftId });
  if (reputationDelta !== 0) run(db, 'UPDATE companies SET reputation = MIN(100, MAX(0, reputation + ?)) WHERE id = ?', reputationDelta, r.companyId);
  // The workshop keeps the aircraft until the repair is over (the later of this and any visit already booked); releaseMaintenance then hands it back as serviced.
  run(db, "UPDATE aircraft SET status = 'maintenance', maintenance_until = MAX(COALESCE(maintenance_until, 0), ?) WHERE id = ?", downtimeUntil, r.aircraftId);
  return row;
}

// ---------------------------------------------------------------- the journal and the insurance

export const incidentsOf = (db: Db, companyId: number, season: string): (IncidentRow & { registration: string | null })[] =>
  all<IncidentRow & { registration: string | null }>(db, 'SELECT i.*, a.registration FROM incidents i JOIN aircraft a ON a.id = i.aircraft_id WHERE i.company_id = ? AND i.season = ? ORDER BY i.at DESC, i.id DESC', companyId, season);

/** The premium rise the billing of `billingMonth` (`YYYY-MM`) applies to every insurance charge: the company's own incidents of the month before. */
export const insuranceRise = (db: Db, companyId: number, billingMonth: string): number =>
  insuranceSurcharge(incidentsOf(db, companyId, seasonOf(Date.parse(`${billingMonth}-01T00:00:00Z`) - 1)));
