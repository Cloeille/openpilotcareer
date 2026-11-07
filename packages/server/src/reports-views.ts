// Lot REPORTS (v4), the two reports that need the line and fleet engines: profitability per line or aircraft over a closed month, and the 12-month forecast. Read-only.
// Profitability is the month's postings plus what the ledger does not carry per leg (crew from the duty ledger, an aircraft's fixed costs allocated by block hours). The forecast is
// `planMonth` through `projectCharges` (what billing will post) plus `expectedPerDay` (what the line engine says a day of each line earns), walked day by day.
import {
  COST_PARTS, DAY_MS, DECISIONS, FLIGHT_NO_BLOCK, PROFIT_KINDS, SCENARIOS, SCENARIO_FACTORS, SEASONALITY, FORECAST_MONTHS, aircraftValue, blockHours, dayStart, maskToDays, walkBalance,
  type CostBreakdown, type DecisionId, type DecisionResult, type DecisionView, type ForecastView, type ProfitBy, type ProfitMoney, type ProfitRow, type ProfitView, type Scenario, type ScenarioSummary,
} from '@opc/shared';
import { all, get, type Db } from './db.ts';
import { HttpError } from './http.ts';
import { planInputs, projectCharges, monthKey, type PlanInputs } from './finance.ts';
import { addMonths, balanceOf, typeFor } from './game.ts';
import { dayOf, leaseOffer } from './leasing.ts';
import { blockMinutes, lineAircraft, lineDistance, type LineRow } from './lines.ts';
import { expectedPerDay } from './lines-manage.ts';
import { dutyCostByFlight } from './staff.ts';

const monthStart = (key: string): number => Date.parse(`${key}-01T00:00:00Z`);
const list = (kinds: readonly string[]): string => kinds.map((k) => `'${k}'`).join(',');

// ---------------------------------------------------------------- profitability

/** Everything one aircraft flew on one line (or on the player's own jobs: `lineId` null) in the month. */
type Cell = { lineId: number | null; aircraftId: number | null; flights: number; revenue: number; fuel: number; fees: number; maintenance: number; service: number; crew: number; fixed: number; weight: number };
const emptyCell = (lineId: number | null, aircraftId: number | null): Cell => ({ lineId, aircraftId, flights: 0, revenue: 0, fuel: 0, fees: 0, maintenance: 0, service: 0, crew: 0, fixed: 0, weight: 0 });

/** `total` shared among `cells` in proportion to their weight (evenly when nobody has any), the remainder to the last so the parts add up to the total. */
function share(total: number, cells: readonly Cell[], put: (c: Cell, v: number) => void): void {
  const sum = cells.reduce((t, c) => t + c.weight, 0);
  let left = total;
  cells.forEach((c, i) => {
    const v = i === cells.length - 1 ? left : Math.round((total * (sum > 0 ? c.weight : 1)) / (sum > 0 ? sum : cells.length));
    put(c, v);
    left -= v;
  });
}

const costsOf = (b: CostBreakdown): number => COST_PARTS.reduce((t, p) => t + b[p], 0);
const moneyOf = (cells: readonly Cell[]): ProfitMoney => {
  const breakdown: CostBreakdown = { crew: 0, fuel: 0, fees: 0, maintenance: 0, service: 0, fixed: 0 };
  let revenue = 0, flights = 0;
  for (const c of cells) { revenue += c.revenue; flights += c.flights; for (const p of COST_PARTS) breakdown[p] += c[p]; }
  const costs = costsOf(breakdown);
  return { flights, revenue, costs, margin: revenue - costs, marginPct: revenue > 0 ? (revenue - costs) / revenue : null, breakdown };
};

/** The month the report opens on: the last full month once the company has one, else the current month. */
export function defaultProfitMonth(db: Db, companyId: number, now: number): string {
  return get(db, 'SELECT 1 AS x FROM transactions WHERE company_id = ? AND at < ? LIMIT 1', companyId, monthStart(monthKey(now))) ? monthKey(addMonths(now, -1)) : monthKey(now);
}

export function profitView(db: Db, companyId: number, now: number, q: { month?: string | undefined; by: ProfitBy }): ProfitView {
  const month = q.month ?? defaultProfitMonth(db, companyId, now);
  const from = monthStart(month), to = addMonths(from, 1);
  const cells = new Map<string, Cell>();
  const cell = (lineId: number | null, aircraftId: number | null): Cell => {
    const key = `${lineId}:${aircraftId}`;
    let c = cells.get(key);
    if (!c) { c = emptyCell(lineId, aircraftId); cells.set(key, c); }
    return c;
  };

  const own: Record<string, Exclude<keyof Cell, 'lineId' | 'aircraftId' | 'flights' | 'crew' | 'fixed' | 'weight'>> = {};
  for (const [part, kinds] of [['revenue', PROFIT_KINDS.revenue], ['fuel', PROFIT_KINDS.fuel], ['fees', PROFIT_KINDS.fees], ['maintenance', PROFIT_KINDS.maintenance], ['service', PROFIT_KINDS.service]] as const) {
    for (const k of kinds) own[k] = part;
  }
  for (const r of all<{ lineId: number | null; aircraftId: number | null; kind: string; amount: number; legs: number }>(db,
    `SELECT line_id AS lineId, aircraft_id AS aircraftId, kind, SUM(amount) AS amount, SUM(legs) AS legs FROM transactions
     WHERE company_id = ? AND at >= ? AND at < ? AND kind IN (${list(Object.keys(own))}) AND (line_id IS NOT NULL OR aircraft_id IS NOT NULL) GROUP BY line_id, aircraft_id, kind`, companyId, from, to)) {
    const c = cell(r.lineId, r.aircraftId);
    c.flights += r.legs;
    c[own[r.kind]!] += own[r.kind] === 'revenue' ? r.amount : -r.amount;
  }

  const lines = new Map(all<LineRow>(db, 'SELECT * FROM lines WHERE company_id = ?', companyId).map((l) => [l.id, l]));
  const aircraft = new Map(all<{ id: number; icao: string; registration: string | null }>(db, 'SELECT id, icao, registration FROM aircraft WHERE company_id = ?', companyId).map((a) => [a.id, a]));

  // the share of an aircraft's month that a cell used: its flown block minutes (the engine's own block time for a line, the flight's for a job)
  const jobMinutes = new Map<number, number>();
  for (const f of all<{ aircraft_id: number; aircraft_icao: string; distance_nm: number }>(db,
    "SELECT aircraft_id, aircraft_icao, distance_nm FROM flights WHERE company_id = ? AND completed_at >= ? AND completed_at < ? AND status IN ('verified','unverified')", companyId, from, to)) {
    jobMinutes.set(f.aircraft_id, (jobMinutes.get(f.aircraft_id) ?? 0) + blockHours(typeFor(db, companyId, f.aircraft_icao), f.distance_nm) * 60);
  }
  for (const c of cells.values()) {
    const line = c.lineId === null ? null : lines.get(c.lineId), ac = c.aircraftId === null ? null : aircraft.get(c.aircraftId);
    c.weight = !line ? (jobMinutes.get(c.aircraftId ?? -1) ?? 0) : c.flights * (ac ? blockMinutes(typeFor(db, companyId, ac.icao), lineDistance(line.a, line.b)) : 60);
  }

  // the crew's pay: each duty row belongs to the line whose flight-number block holds it (and which existed by then), then goes to that line's aircraft by minutes flown
  const crewByLine = new Map<number, number>();
  for (const d of dutyCostByFlight(db, companyId, from, to)) {
    const line = [...lines.values()].find((l) => d.flightNo >= l.flight_base && d.flightNo < l.flight_base + FLIGHT_NO_BLOCK && l.created_at <= d.at);
    if (line) crewByLine.set(line.id, (crewByLine.get(line.id) ?? 0) + d.cost);
  }
  for (const [lineId, total] of crewByLine) {
    const mine = [...cells.values()].filter((c) => c.lineId === lineId);
    if (mine.length > 0) share(Math.round(total), mine, (c, v) => { c.crew += v; });
  }

  // an aircraft's fixed costs (leasing, hull insurance, parking) are its own whatever it flew: by aircraft they stay whole, by line they follow the minutes each line used
  for (const r of all<{ aircraftId: number; cost: number }>(db,
    `SELECT aircraft_id AS aircraftId, -SUM(amount) AS cost FROM transactions WHERE company_id = ? AND at >= ? AND at < ? AND kind IN (${list(PROFIT_KINDS.fixed)}) AND aircraft_id IS NOT NULL GROUP BY aircraft_id`, companyId, from, to)) {
    const mine = [...cells.values()].filter((c) => c.aircraftId === r.aircraftId);
    if (mine.length === 0) cell(null, r.aircraftId).fixed = r.cost;
    else share(r.cost, mine, (c, v) => { c.fixed += v; });
  }

  const group = (key: (c: Cell) => number | null): Map<number, Cell[]> => {
    const out = new Map<number, Cell[]>();
    for (const c of cells.values()) { const k = key(c); if (k !== null) out.set(k, [...(out.get(k) ?? []), c]); }
    return out;
  };
  const pair = (id: number): string => { const l = lines.get(id); return l ? `${l.a}-${l.b}` : ''; };
  const rows: ProfitRow[] = (q.by === 'line' ? [...group((c) => c.lineId)].flatMap(([id, mine]): ProfitRow[] => {
    const l = lines.get(id);
    return l ? [{ by: 'line', id, a: l.a, b: l.b, aircraft: [...new Set(mine.flatMap((c) => aircraft.get(c.aircraftId ?? -1)?.registration ?? []))].sort(), ...moneyOf(mine) }] : [];
  }) : [...group((c) => c.aircraftId)].flatMap(([id, mine]): ProfitRow[] => {
    const a = aircraft.get(id);
    return a ? [{ by: 'aircraft', id, registration: a.registration ?? `#${id}`, icao: a.icao, lines: [...new Set(mine.flatMap((c) => (c.lineId === null ? [] : [pair(c.lineId)])))].sort(), ...moneyOf(mine) }] : [];
  })).filter((r) => r.revenue !== 0 || r.costs !== 0);

  rows.sort((x, y) => (y.marginPct ?? -Infinity) - (x.marginPct ?? -Infinity) || y.margin - x.margin || x.id - y.id);
  const winners = rows.filter((r) => r.margin >= 0), losers = rows.filter((r) => r.margin < 0);
  const margin = (rs: readonly ProfitRow[]): number => rs.reduce((t, r) => t + r.margin, 0);
  return { month, by: q.by, closed: month < monthKey(now), rows, totals: { margin: margin(rows), profitable: { count: winners.length, margin: margin(winners) }, losing: { count: losers.length, margin: margin(losers) } } };
}

// ---------------------------------------------------------------- forecast

/** What a day of one active line earns by the line engine's own maths, with the fuel apart (the scenarios move it). */
type Flying = { id: number; a: string; b: string; days: boolean[]; revenue: number; fuel: number; other: number };

function flyingOf(db: Db, companyId: number, now: number): Flying[] {
  return all<LineRow>(db, "SELECT * FROM lines WHERE company_id = ? AND status = 'active' ORDER BY id", companyId).map((l): Flying => {
    const e = expectedPerDay(db, l, lineAircraft(db, l.id), now);
    return { id: l.id, a: l.a, b: l.b, days: maskToDays(l.days), revenue: e.revenue, fuel: e.fuel, other: e.revenue - e.margin - e.fuel };
  });
}
const weeklyMargin = (f: Flying): number => (f.revenue - f.fuel - f.other) * f.days.filter(Boolean).length;
const dayNet = (f: Flying, day: number, s: Scenario): number => {
  if (!f.days[(new Date(day).getUTCDay() + 6) % 7]) return 0;
  const k = SCENARIO_FACTORS[s];
  return Math.round(f.revenue * k.revenue * SEASONALITY[new Date(day).getUTCMonth()]! - (f.fuel * k.fuel + f.other));
};

/** The aircraft the lease decision adds: one more of the type she flies most, on the shortest term its offer allows, signed tomorrow. */
function leaseCandidate(db: Db, companyId: number, inputs: PlanInputs, now: number): { icao: string; upfront: number; extra: PlanInputs; signed: number } | null {
  const counts = new Map<string, number>();
  for (const a of all<{ icao: string }>(db, 'SELECT icao FROM aircraft WHERE company_id = ? AND returned_at IS NULL', companyId)) counts.set(a.icao, (counts.get(a.icao) ?? 0) + 1);
  const icao = [...counts].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0];
  const hub = get<{ icao: string }>(db, 'SELECT icao FROM hubs WHERE company_id = ? ORDER BY rowid LIMIT 1', companyId)?.icao;
  if (!icao || !hub) return null;
  const type = typeFor(db, companyId, icao), offer = leaseOffer(type, dayOf(now)), term = offer.durations[0];
  if (!term) return null;
  const signed = dayStart(now) + DAY_MS;
  const id = -1;
  return {
    icao, signed, upfront: term.monthlyRent + offer.deposit + offer.ferryFee,
    extra: {
      ...inputs,
      contracts: [...inputs.contracts, { id, aircraft_id: id, kind: 'lease', started_at: signed, ends_at: addMonths(signed, term.months), months: term.months, months_paid: 1, monthly: term.monthlyRent, insurance: offer.insuranceMonthly ?? 0, deposit: offer.deposit, principal: 0 }],
      fleet: [...inputs.fleet, { id, registration: icao, base: hub, ownership: 'leased', value: aircraftValue(type), category: type.category, acquired_at: signed, busy: false }],
    },
  };
}

type Curve = { points: ForecastView['points']; summary: Record<Scenario, ScenarioSummary> };

function curve(db: Db, companyId: number, now: number, o: { flying: Flying[]; inputs: PlanInputs; oneOff?: { at: number; amount: number } }): Curve {
  const today = dayStart(now), months = Array.from({ length: FORECAST_MONTHS }, (_, i) => monthKey(addMonths(now, i)));
  const charges = new Map<number, number>();
  for (const c of projectCharges(db, companyId, now, FORECAST_MONTHS - 1, o.inputs)) charges.set(c.at, (charges.get(c.at) ?? 0) + c.amount);
  if (o.oneOff) charges.set(o.oneOff.at, (charges.get(o.oneOff.at) ?? 0) + o.oneOff.amount);
  const balance = balanceOf(db, companyId);
  const walks = Object.fromEntries(SCENARIOS.map((s) => [s, walkBalance({ from: today, to: addMonths(now, FORECAST_MONTHS) - DAY_MS, balance, charges: (d) => charges.get(d) ?? 0, net: (d) => o.flying.reduce((t, f) => t + dayNet(f, d, s), 0) })])) as Record<Scenario, ReturnType<typeof walkBalance>>;
  return {
    points: months.map((month) => ({ month, central: walks.central.lowByMonth.get(month) ?? balance, prudent: walks.prudent.lowByMonth.get(month) ?? balance, optimistic: walks.optimistic.lowByMonth.get(month) ?? balance })),
    summary: { central: walks.central.summary, prudent: walks.prudent.summary, optimistic: walks.optimistic.summary },
  };
}

type Setup = { flying: Flying[]; inputs: PlanInputs; base: Curve; worst: Flying | null; lease: ReturnType<typeof leaseCandidate> };
function setup(db: Db, companyId: number, now: number): Setup {
  const flying = flyingOf(db, companyId, now), inputs = planInputs(db, companyId, now);
  return { flying, inputs, base: curve(db, companyId, now, { flying, inputs }), worst: [...flying].sort((x, y) => weeklyMargin(x) - weeklyMargin(y) || x.id - y.id)[0] ?? null, lease: leaseCandidate(db, companyId, inputs, now) };
}

function decided(db: Db, companyId: number, now: number, s: Setup, id: DecisionId): Curve | null {
  if (id === 'pause_line') return s.worst ? curve(db, companyId, now, { flying: s.flying.filter((f) => f.id !== s.worst!.id), inputs: s.inputs }) : null;
  return s.lease ? curve(db, companyId, now, { flying: s.flying, inputs: s.lease.extra, oneOff: { at: s.lease.signed, amount: -s.lease.upfront } }) : null;
}

const effectOf = (base: Curve, after: Curve): NonNullable<DecisionView['effect']> => Object.fromEntries(SCENARIOS.map((s) => [s, {
  lowDelta: after.summary[s].lowest.balance - base.summary[s].lowest.balance, overdraftDays: { before: base.summary[s].overdraft.days, after: after.summary[s].overdraft.days },
}])) as NonNullable<DecisionView['effect']>;

export function forecastView(db: Db, companyId: number, now: number): ForecastView {
  const s = setup(db, companyId, now);
  const decisions = DECISIONS.map((id): DecisionView => {
    const after = decided(db, companyId, now, s, id);
    const line = id === 'pause_line' && s.worst ? { id: s.worst.id, a: s.worst.a, b: s.worst.b } : null;
    return { id, available: after !== null, line, icao: id === 'lease_aircraft' ? s.lease?.icao ?? null : null, upfront: id === 'lease_aircraft' ? s.lease?.upfront ?? 0 : 0, effect: after ? effectOf(s.base, after) : null };
  });
  return { now, balance: balanceOf(db, companyId), points: s.base.points, summary: s.base.summary, decisions };
}

export function testDecision(db: Db, companyId: number, now: number, id: DecisionId): DecisionResult {
  const s = setup(db, companyId, now);
  const after = decided(db, companyId, now, s, id);
  if (!after) throw new HttpError(409, 'decision_unavailable', id === 'pause_line' ? 'you have no active line to pause' : 'you have no aircraft to lease another one like');
  return { decision: id, points: after.points, summary: after.summary, effect: effectOf(s.base, after) };
}
