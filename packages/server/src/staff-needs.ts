// Lot STAFF (v3): how many people a timetable keeps busy. One pure-ish function turns lines into "slots" (family, aircraft type, base, count) that the starter crew,
// the staff overview, the leave coverage and the line forecast all read, so the need is defined once (docs/v3-plan.md B.3, "positions needed").
import {
  AIRCRAFT_PER_TECHNICIAN, DAY_MS, DUTY_RELEASE_MIN, DUTY_REPORT_MIN, GROUND_PER_AIRPORT, PEOPLE_PER_ADMIN, crewNeeded, crewTeams, layoutDay, positionsFor,
  type PlannedAircraft, type Programme, type RestPolicyRules, type StaffFamily,
} from '@opc/shared';
import type { Db } from './db.ts';
import { typeFor } from './game.ts';
import { blockMinutes, lineAircraft, lineDistance, programmeOf, type LineRow } from './lines.ts';

/** A line as the demand model sees it: its programme and the aircraft that fly it. */
export type DemandLine = { prog: Programme; aircraft: (PlannedAircraft & { icao: string })[] };
export type Slot = { family: StaffFamily; type: string | null; base: string; count: number };

/** Monday 5 Jan 2026: any week would do, the programme repeats weekly. */
const REF_MONDAY = Date.UTC(2026, 0, 5);

export function demandLine(db: Db, l: LineRow): DemandLine {
  const dist = lineDistance(l.a, l.b);
  return {
    prog: programmeOf(l),
    aircraft: lineAircraft(db, l.id).filter((x) => x.returned_at === null).map((x) => ({ id: x.id, icao: x.icao, home: x.home, blockMin: blockMinutes(typeFor(db, l.company_id, x.icao), dist) })),
  };
}

/** Crews (fractional) one aircraft of the line keeps busy: its busiest day sets the duty span, its flying per operating day the 28-day and yearly limits. */
function aircraftTeams(line: DemandLine, aircraftId: number, rules: RestPolicyRules): number {
  let days = 0, span = 0, flight = 0;
  for (let d = 0; d < 7; d++) {
    const legs = layoutDay(line.prog, line.aircraft, REF_MONDAY + d * DAY_MS).filter((l) => l.aircraftId === aircraftId);
    if (legs.length === 0) continue;
    days++;
    span = Math.max(span, DUTY_REPORT_MIN + DUTY_RELEASE_MIN + (Math.max(...legs.map((l) => l.arr)) - Math.min(...legs.map((l) => l.dep))) / 60_000);
    flight += legs.reduce((s, l) => s + (l.arr - l.dep) / 60_000, 0);
  }
  return days === 0 ? 0 : crewTeams(span, flight / days, days, rules.restBaseH);
}

/** The people `lines` need, by family, aircraft type and base. Pilots and cabin crew follow the duty rules of shared/staff.ts and the rest policy; ground, maintenance and
 *  administration are the constants of shared/staff.ts. Aircraft of one type with the same home share their crews. */
export function demandOf(db: Db, companyId: number, lines: readonly DemandLine[], rules: RestPolicyRules): Slot[] {
  const pilots = new Map<string, number>(), cabin = new Map<string, number>();
  const airports = new Set<string>(), fleet = new Set<number>();
  const add = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);
  let firstHome: string | null = null;
  for (const line of lines) {
    airports.add(line.prog.a); airports.add(line.prog.b);
    for (const ac of line.aircraft) {
      firstHome ??= ac.home;
      fleet.add(ac.id);
      const teams = aircraftTeams(line, ac.id, rules);
      const need = crewNeeded(typeFor(db, companyId, ac.icao).seats);
      add(pilots, `${ac.home}|${ac.icao}`, teams * need.pilots);
      add(cabin, ac.home, teams * need.cabin);
    }
  }
  const slots: Slot[] = [];
  for (const [k, people] of pilots) { const [base, type] = k.split('|') as [string, string]; slots.push({ family: 'pilot', type, base, count: positionsFor(people, rules) }); }
  for (const [base, people] of cabin) slots.push({ family: 'cabin', type: null, base, count: positionsFor(people, rules) });
  for (const base of [...airports].sort()) slots.push({ family: 'ground', type: null, base, count: GROUND_PER_AIRPORT });
  if (firstHome) {
    slots.push({ family: 'maintenance', type: null, base: firstHome, count: Math.ceil(fleet.size / AIRCRAFT_PER_TECHNICIAN) });
    slots.push({ family: 'admin', type: null, base: firstHome, count: Math.max(1, Math.ceil(slots.reduce((s, x) => s + x.count, 0) / PEOPLE_PER_ADMIN)) });
  }
  return slots.filter((s) => s.count > 0);
}

/** The company's whole timetable (paused lines fly nothing). `onlyBase`: only the lines that touch that airport. */
export function companyDemand(db: Db, companyId: number, rules: RestPolicyRules, onlyBase?: string): Slot[] {
  const lines = (db.prepare("SELECT * FROM lines WHERE company_id = ? AND status != 'paused' ORDER BY id").all(companyId) as LineRow[])
    .filter((l) => !onlyBase || l.a === onlyBase || l.b === onlyBase);
  return demandOf(db, companyId, lines.map((l) => demandLine(db, l)), rules);
}

export const countOf = (slots: readonly Slot[], family: StaffFamily, type?: string | null): number =>
  slots.filter((s) => s.family === family && (type === undefined || s.type === type)).reduce((n, s) => n + s.count, 0);
