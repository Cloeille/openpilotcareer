// Ferry flights: an empty, paid repositioning leg of one aircraft to another airport. It costs what an empty leg of the flight model costs (`settle` with no payout:
// fuel, landing fee and maintenance of the distance, run through `flightCosts` like every flown leg), books one `ferry_flight` ledger line, wears the aircraft by the block hours,
// and keeps it busy until it lands (`aircraft.available_at`, which `assertFlyable` and the fleet view respect). Like a line leg, the aircraft stands at its destination from departure.
import { blockHours, fuelPriceFactor, settle, type AircraftType, type FerryBooked, type FerryPreview } from '@opc/shared';
import { airports } from './catalog.ts';
import { get, run, type Db } from './db.ts';
import { accrueWear, assertFlyable, flightCosts } from './fleet-extras.ts';
import { assertFunds, hasHub, snapshot, typeFor, type AircraftRow } from './game.ts';
import { HttpError } from './http.ts';
import { post } from './ledger.ts';
import { lineDistance, sizeOf } from './lines.ts';
import { ownAircraft } from './parts.ts';
import { realismSettingOf } from './realism.ts';

const HOUR = 3_600_000;

type Plan = { aircraft: AircraftRow; type: AircraftType; preview: FerryPreview; refusal: HttpError | null };

const refusalOf = (check: () => void): HttpError | null => {
  try { check(); return null; } catch (e) { if (e instanceof HttpError) return e; throw e; }
};

/** Cost of an empty leg of `distanceNm` for this aircraft, by the flight model: what finishFlight would charge a flight that paid nothing. */
function emptyLegCost(db: Db, a: AircraftRow, type: AircraftType, to: string, distanceNm: number, hours: number, now: number): number {
  const realism = realismSettingOf(db, a.company_id);
  const { settlement: s } = flightCosts(db, a.id, hours, settle({
    payout: 0, distanceNm, aircraft: type, status: 'verified', destSize: sizeOf(to), destIsHub: hasHub(db, a.company_id, to),
    ...(realism.toggles.realFuelPrice ? { fuelPriceFactor: fuelPriceFactor(a.location, now) } : {}),
  }), type.category, now);
  return s.fuelCost + s.landingFee + s.maintenance;
}

/** Everything about sending `aircraftId` to `to` now, and the first reason it would be refused (an HttpError, never thrown here). 404 only for an aircraft that is not the company's. */
function plan(db: Db, companyId: number, aircraftId: number, to: string, now: number): Plan {
  const aircraft = ownAircraft(db, companyId, aircraftId);
  const type = typeFor(db, companyId, aircraft.icao);
  const known = airports.has(to) && to !== aircraft.location;
  const distanceNm = known ? lineDistance(aircraft.location, to) : 0;
  const hours = known ? blockHours(type, distanceNm) : 0;
  const arrivesAt = now + Math.round(hours * HOUR);
  const cost = known ? emptyLegCost(db, aircraft, type, to, distanceNm, hours, now) : 0;
  const refusal =
    (!airports.has(to) ? new HttpError(422, 'unknown_airport', `airport ${to} is not in the airport database`) : null)
    ?? (to === aircraft.location ? new HttpError(422, 'same_airport', `${aircraft.icao} is already at ${to}`) : null)
    ?? refusalOf(() => assertFlyable(db, aircraft.id, now))
    ?? (get(db, "SELECT 1 AS x FROM flights WHERE aircraft_id = ? AND status = 'active'", aircraft.id) ? new HttpError(409, 'aircraft_busy', `aircraft ${aircraft.id} is on a flight`) : null)
    ?? (get(db, 'SELECT 1 AS x FROM line_aircraft WHERE aircraft_id = ?', aircraft.id) ? new HttpError(409, 'aircraft_on_line', 'this aircraft flies a line: take it off the line first') : null)
    ?? (distanceNm > type.rangeNm ? new HttpError(422, 'out_of_range', `${distanceNm} nm exceeds the ${type.rangeNm} nm range of ${aircraft.icao}`) : null)
    ?? refusalOf(() => assertFunds(db, companyId, cost));
  return { aircraft, type, refusal, preview: { distanceNm, cost, hours, arrivesAt, ok: refusal === null, ...(refusal ? { reason: refusal.code } : {}) } };
}

/** What a ferry would cost and take; books nothing. */
export const ferryPreview = (db: Db, companyId: number, aircraftId: number, to: string, now: number): FerryPreview => plan(db, companyId, aircraftId, to, now).preview;

/** Send the aircraft to `to`: pays the empty leg, wears the aircraft, and keeps it busy until it lands. The caller wraps this in a transaction. */
export function ferry(db: Db, companyId: number, aircraftId: number, to: string, now: number): FerryBooked {
  const { aircraft, type, preview, refusal } = plan(db, companyId, aircraftId, to, now);
  if (refusal) throw refusal;
  post(db, companyId, now, 'ferry_flight', -preview.cost, `${aircraft.registration ?? `#${aircraft.id}`} ${aircraft.location}-${to}`); // plan() has checked the funds in this transaction
  run(db, 'UPDATE aircraft SET location = ?, available_at = ? WHERE id = ?', to, preview.arrivesAt, aircraft.id);
  accrueWear(db, companyId, aircraft.id, type.category, preview.hours, now);
  snapshot(db, companyId, now);
  return { ...preview, balanceAfter: get<{ balance: number }>(db, 'SELECT balance FROM companies WHERE id = ?', companyId)!.balance };
}
