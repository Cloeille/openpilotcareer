// Lot LINES (v3): read models for the network map, the line page and the operations board. Nothing here writes.
import {
  DAY_MS, ON_TIME_LIMIT_MIN, blockHours, dayStart, maskToDays, weekdayOf,
  type CancelCause, type FlyingRow, type LineDay, type LineDetail, type NetworkView, type OpsRow, type OpsView, type ScheduledFlight,
} from '@opc/shared';
import { all, get, type Db } from './db.ts';
import type { AircraftRow, FlightRow } from './game.ts';
import { typeFor } from './game.ts';
import { expectedPerDay } from './lines-manage.ts';
import { companyCode, legStatus, legView, lineAircraft, lineView, loadFactorOf, networkOf, type LegRow, type LineRow } from './lines.ts';

const NOTE: Record<CancelCause, string> = {
  aircraft_unavailable: 'aircraft unavailable', no_crew: 'no crew available', duty_limit: 'crew duty limit', line_paused: 'line paused',
};
const shiftOf = (l: LegRow): number => l.delay_min * 60_000;
const registrationOf = (db: Db, id: number): string => get<{ registration: string | null }>(db, 'SELECT registration FROM aircraft WHERE id = ?', id)?.registration ?? `#${id}`;
const isFlying = (l: LegRow, now: number): boolean => l.status === 'done' && l.dep_at + shiftOf(l) <= now && now < l.arr_at + shiftOf(l);
const legProgress = (l: LegRow, now: number): number => Math.min(1, Math.max(0, (now - (l.dep_at + shiftOf(l))) / (l.arr_at - l.dep_at)));

/** The company's own flight in the air (a flown job): its position comes from the accept time over the block time. */
function handFlights(db: Db, companyId: number, now: number): (FlightRow & { reg: string })[] {
  return all<FlightRow & { reg: string | null }>(db, `SELECT f.*, a.registration AS reg FROM flights f JOIN aircraft a ON a.id = f.aircraft_id WHERE f.company_id = ? AND f.status = 'active' ORDER BY f.id`, companyId)
    .map((f) => ({ ...f, reg: f.reg ?? `#${f.aircraft_id}` })).filter((f) => f.accepted_at <= now);
}
const handProgress = (db: Db, f: FlightRow, now: number): number => {
  const h = blockHours(typeFor(db, f.company_id, f.aircraft_icao), f.distance_nm);
  return Math.min(1, Math.max(0, (now - f.accepted_at) / (h * 3_600_000)));
};

const legsOfDay = (db: Db, companyId: number, from: number): LegRow[] =>
  all<LegRow>(db, 'SELECT * FROM scheduled_flights WHERE company_id = ? AND dep_at >= ? AND dep_at < ? ORDER BY dep_at, id', companyId, from, from + DAY_MS);

// ---------------------------------------------------------------- network

/** `viewer` is the player's company; `target` the network shown (the viewer's own, or an AI company's). Only the viewer's own hand-flown flight is `own`. */
export function networkView(db: Db, viewer: number, target: number, now: number): NetworkView {
  const code = companyCode(db, target);
  const n = networkOf(db, target);
  const lines = all<LineRow>(db, 'SELECT * FROM lines WHERE company_id = ? ORDER BY id', target).map((l) => lineView(db, l));
  const flying: FlyingRow[] = all<LegRow>(db, "SELECT * FROM scheduled_flights WHERE company_id = ? AND status = 'done' AND dep_at <= ? AND arr_at + delay_min * 60000 > ? ORDER BY dep_at", target, now, now)
    .filter((l) => isFlying(l, now))
    .map((l) => ({ flightId: l.id, flightNo: `${code} ${l.flight_no}`, lineId: l.line_id, from: l.origin, to: l.dest, progress: legProgress(l, now), delayMin: l.delay_min, reg: registrationOf(db, l.aircraft_id), own: false }));
  if (viewer === target) {
    for (const f of handFlights(db, target, now)) flying.push({ flightId: f.id, flightNo: `${code} F${f.id}`, lineId: null, from: f.origin, to: f.destination, progress: handProgress(db, f, now), delayMin: 0, reg: f.reg, own: true });
  }
  const today = legsOfDay(db, target, dayStart(now));
  const departed = today.filter((l) => l.status === 'done');
  const next = get<LegRow>(db, "SELECT * FROM scheduled_flights WHERE company_id = ? AND status = 'scheduled' AND dep_at > ? ORDER BY dep_at, id LIMIT 1", target, now);
  return {
    now, enabled: (n?.enabled ?? 1) === 1, lapsedAt: n?.lapsed_at ?? null, lines, flying,
    today: {
      done: departed.filter((l) => l.arr_at + shiftOf(l) <= now).length,
      cancelled: today.filter((l) => l.status === 'cancelled' && l.taken_job === null).length,
      onTimePct: departed.length === 0 ? null : Math.round((100 * departed.filter((l) => l.delay_min <= ON_TIME_LIMIT_MIN).length) / departed.length),
      nextDeparture: next ? legView(next, code, now) : null,
    },
  };
}

// ---------------------------------------------------------------- line page

const loadOf = (l: LegRow, seats: number): number => (l.pax !== null && seats > 0 ? l.pax / seats : 0);

/** The page of one line for `date` (default today): the week of that date, its timetable, the KPIs of the last 7 days and the day's P&L. */
export function lineDetail(db: Db, l: LineRow, now: number, date?: string): LineDetail {
  const code = companyCode(db, l.company_id);
  const fleet = lineAircraft(db, l.id);
  const seatsOf = new Map(fleet.map((a) => [a.id, typeFor(db, l.company_id, a.icao).seats]));
  const day = dayStart(date ? Date.parse(`${date}T00:00:00Z`) : now);
  const expected = loadFactorOf(db, { companyId: l.company_id, a: l.a, b: l.b, freqPerDay: l.freq_per_day, days: l.days, fleet: fleet.filter((x) => x.returned_at === null), excludeLineId: l.id });
  const mask = maskToDays(l.days);

  const legsFrom = (from: number, to: number): LegRow[] => all<LegRow>(db, 'SELECT * FROM scheduled_flights WHERE line_id = ? AND dep_at >= ? AND dep_at < ? ORDER BY dep_at, id', l.id, from, to);
  const monday = day - weekdayOf(day) * DAY_MS;
  const week: LineDay[] = Array.from({ length: 7 }, (_, i): LineDay => {
    const d = monday + i * DAY_MS;
    const legs = legsFrom(d, d + DAY_MS);
    const flown = legs.filter((x) => x.status === 'done');
    const planned = d + DAY_MS > now;
    if (legs.length > 0) {
      return { date: new Date(d).toISOString().slice(0, 10), rotations: legs.filter((x) => x.origin === l.a).length, planned, loadFactor: flown.length > 0 ? flown.reduce((s, x) => s + loadOf(x, seatsOf.get(x.aircraft_id) ?? 0), 0) / flown.length : expected };
    }
    // beyond the laid horizon: what the programme would fly (nothing for a paused line, a day off or a day before the line existed)
    const runs = planned && l.status !== 'paused' && mask[weekdayOf(d)] && d + DAY_MS > l.live_from && fleet.length > 0;
    return { date: new Date(d).toISOString().slice(0, 10), rotations: runs ? l.freq_per_day : 0, planned, loadFactor: runs ? expected : 0 };
  });

  const dayLegs = legsFrom(day, day + DAY_MS);
  const flownDay = dayLegs.filter((x) => x.status === 'done');
  const sum = (k: 'revenue' | 'fuel_cost' | 'landing_fee' | 'maintenance' | 'pax') => flownDay.reduce((s, x) => s + (x[k] ?? 0), 0);
  const pnl = { revenue: sum('revenue'), fuel: sum('fuel_cost'), fees: sum('landing_fee'), crews: 0, maintenance: sum('maintenance'), margin: 0, flights: flownDay.length, pax: sum('pax') };
  pnl.margin = pnl.revenue - pnl.fuel - pnl.fees - pnl.crews - pnl.maintenance;

  const window = (from: number, to: number) => legsFrom(from, to).filter((x) => x.status === 'done');
  const last7 = window(now - 7 * DAY_MS, now + 1), prev7 = window(now - 14 * DAY_MS, now - 7 * DAY_MS);
  const loadAvg = (legs: LegRow[]): number => (legs.length === 0 ? 0 : legs.reduce((s, x) => s + loadOf(x, seatsOf.get(x.aircraft_id) ?? 0), 0) / legs.length);
  const activeDays = new Set(last7.map((x) => dayStart(x.dep_at))).size;
  const measured = last7.length > 0;
  const exp = measured ? null : expectedPerDay(db, l, fleet, now);
  const revenue7 = last7.reduce((s, x) => s + (x.revenue ?? 0), 0);
  const margin7 = last7.reduce((s, x) => s + (x.revenue ?? 0) - (x.fuel_cost ?? 0) - (x.landing_fee ?? 0) - (x.maintenance ?? 0), 0);

  const usable = fleet.filter((x) => x.returned_at === null);
  const worst = usable.reduce((m, x) => Math.max(m, x.wear_pct), 0);
  const n = networkOf(db, l.company_id);
  return {
    line: lineView(db, l), week, day: dayLegs.map((x) => legView(x, code, now)),
    kpis: {
      aircraft: usable.length, freq: `${l.freq_per_day}/day`, loadFactor: measured ? loadAvg(last7) : expected,
      loadTrend7d: measured && prev7.length > 0 ? loadAvg(last7) - loadAvg(prev7) : 0,
      revenuePerDay: exp ? exp.revenue : Math.round(revenue7 / Math.max(1, activeDays)), marginPerDay: exp ? exp.margin : Math.round(margin7 / Math.max(1, activeDays)), estimated: !measured,
    },
    pnl,
    depends: [
      { key: 'aircraft', label: 'aircraft', value: `${usable.filter((x) => x.status === 'available').length}/${usable.length}`, ok: usable.some((x) => x.status === 'available') },
      { key: 'maintenance', label: 'wear', value: `${Math.round(worst)}%`, ok: worst < 70 },
      { key: 'network', label: 'network', value: (n?.enabled ?? 1) === 1 ? 'on' : 'off', ok: (n?.enabled ?? 1) === 1 },
    ],
  };
}

// ---------------------------------------------------------------- operations board

/** Every flight of the company today: what is in the air, what leaves next, what was cancelled and why. The player's own flight is the `own` row. */
export function opsView(db: Db, companyId: number, now: number): OpsView {
  const code = companyCode(db, companyId);
  const n = networkOf(db, companyId);
  const today = dayStart(now);
  const rows = all<LegRow>(db, 'SELECT * FROM scheduled_flights WHERE company_id = ? AND ((dep_at >= ? AND dep_at < ?) OR (status = \'done\' AND dep_at < ? AND arr_at + delay_min * 60000 > ?)) ORDER BY dep_at, id', companyId, today, today + DAY_MS, today, now);
  const aircraft = new Map(all<AircraftRow>(db, 'SELECT * FROM aircraft WHERE company_id = ?', companyId).map((a) => [a.id, a]));
  const row = (l: LegRow): OpsRow => {
    const a = aircraft.get(l.aircraft_id);
    const view: ScheduledFlight = legView(l, code, now);
    return { ...view, reg: a?.registration ?? `#${l.aircraft_id}`, typeName: a ? typeFor(db, companyId, a.icao).name : '', crew: null, note: l.cancel_cause ? NOTE[l.cancel_cause] : l.delay_cause === 'wear' ? 'aircraft wear' : l.delay_cause === 'late_inbound' ? 'late inbound aircraft' : null, own: false };
  };
  const flying = rows.filter((l) => isFlying(l, now)).map(row);
  for (const f of handFlights(db, companyId, now)) {
    const t = typeFor(db, companyId, f.aircraft_icao);
    flying.unshift({
      id: f.id, lineId: null, flightNo: `${code} F${f.id}`, dep: f.accepted_at, arr: f.accepted_at + Math.round(blockHours(t, f.distance_nm) * 3_600_000), origin: f.origin, dest: f.destination, aircraftId: f.aircraft_id,
      status: 'flying', delayMin: 0, delayCause: null, cancelCause: null, pax: f.pax, takenByPlayer: true, reg: f.reg, typeName: t.name, crew: null, note: null, own: true,
    });
  }
  const upcoming = rows.filter((l) => !isFlying(l, now) && (l.status === 'scheduled' || l.status === 'cancelled' && l.taken_job === null || l.status === 'done' && now < l.dep_at + shiftOf(l))).map(row);
  const flat = [...flying, ...upcoming];
  return {
    now, enabled: (n?.enabled ?? 1) === 1,
    counts: {
      flying: flying.length, upcoming: upcoming.filter((r) => r.status === 'scheduled' || r.status === 'delayed').length,
      cancelled: upcoming.filter((r) => r.status === 'cancelled').length, delayed: flat.filter((r) => r.status === 'delayed' || r.delayMin > 0 && r.status !== 'cancelled').length,
    },
    flying, upcoming,
  };
}

export { legStatus };
