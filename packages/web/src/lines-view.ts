import { blockHours, type AircraftType, type LineBridgeSlot } from '@opc/shared';
import type { CancelCause, LineProblemView, ProjectionStatus, ResolveOption, ScheduledFlightStatus, FlyingRow, Line, NetworkView, OpsRow, LineBody, ScheduledFlight } from './api-lines.ts';
import type { MapAirport, MapFlight, MapLine } from './network-map.ts';
import type { Key } from './messages.ts';
import type { Screen } from './screen.ts';

/**
 * Pure view-models of the LINES screens: everything a screen derives from the API's answers, so it can be tested without a DOM.
 * Strings are not made here: a view-model returns kinds and numbers, the screen translates them.
 */

/** Lot R1 adds `network` to TABS; until it is merged the cast keeps the screens typed. */
export const NETWORK_TAB = 'network' as Screen['tab'];

export const MINUTES_PER_DAY = 1440;
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------- lines on the map and in the list

/** What a line looks like: `delayed` when an aircraft flying it is late right now. */
export type LineVisual = 'ok' | 'delayed' | 'interrupted' | 'paused';
export function lineVisual(line: Pick<Line, 'id' | 'status'>, flying: readonly Pick<FlyingRow, 'lineId' | 'delayMin'>[]): LineVisual {
  if (line.status === 'interrupted') return 'interrupted';
  if (line.status === 'paused') return 'paused';
  return flying.some((f) => f.lineId === line.id && f.delayMin > 0) ? 'delayed' : 'ok';
}

/** The delay of the worst late aircraft on a line, 0 when none. */
export const lineDelay = (line: Pick<Line, 'id'>, flying: readonly Pick<FlyingRow, 'lineId' | 'delayMin'>[]): number =>
  Math.max(0, ...flying.filter((f) => f.lineId === line.id).map((f) => f.delayMin));

/** The id of a pair of airports, whichever way round it is given: `LFLL-LFMN`. A line is its pair, so two companies' lines on it share this id. */
export const pairId = (l: Pick<Line, 'a' | 'b'>): string => (l.a < l.b ? `${l.a}-${l.b}` : `${l.b}-${l.a}`);

/** AI networks in the order the player cares about: those that share most pairs with hers first, then by name. */
export function rivalOrder<T extends { name: string; lines: readonly Pick<Line, 'a' | 'b'>[] }>(own: readonly Pick<Line, 'a' | 'b'>[], rivals: readonly T[]): T[] {
  const mine = new Set(own.map(pairId));
  const shared = (r: T): number => r.lines.filter((l) => mine.has(pairId(l))).length;
  return [...rivals].sort((x, y) => shared(y) - shared(x) || x.name.localeCompare(y.name));
}

/** Spacing of the departures from A: the programme window shared by the day's departures (the line list says "toutes les 2 h"). */
export function everyHours(l: Pick<Line, 'freqPerDay' | 'windowStart' | 'windowEnd'>): number {
  const span = minutesOf(l.windowEnd) - minutesOf(l.windowStart);
  return l.freqPerDay > 1 ? Math.max(1, Math.round(span / 60 / l.freqPerDay)) : Math.max(1, Math.round(span / 60));
}

export const flightsPerDay = (l: Pick<Line, 'freqPerDay'>): number => l.freqPerDay * 2;

/** Aircraft of a line as the list shows them: `F-HAZA · ATR 72-600`, one per distinct aircraft. */
export const aircraftOfLine = (l: Line, typeName: (icao: string) => string): string[] => l.aircraft.map((a) => `${a.registration} · ${typeName(a.icao)}`);

/** Map lines of one network. `owner` says whose network it is; in the rival view the player's own lines are drawn dimmed behind it. */
export function mapLines(own: NetworkView, rival: NetworkView | null): MapLine[] {
  const ownPairs = new Set(own.lines.map(pairId));
  const mine = own.lines.map((l): MapLine => ({ id: pairId(l), a: l.a, b: l.b, owner: 'player', state: stateOf(lineVisual(l, own.flying)), ...(rival ? { dim: true } : {}) }));
  if (!rival) return mine;
  const theirs = rival.lines.map((l): MapLine => ({ id: pairId(l), a: l.a, b: l.b, owner: 'rival', state: 'ok', ...(ownPairs.has(pairId(l)) ? { contested: true } : {}) }));
  return [...mine, ...theirs];
}
const stateOf = (v: LineVisual): MapLine['state'] => (v === 'paused' ? 'interrupted' : v);

/** Aircraft in the air: the player's own flight is `me`, the rest are autonomous; a rival view shows the rival's aircraft only. */
export function mapFlights(own: NetworkView, rival: NetworkView | null, text: (f: FlyingRow, mine: boolean) => string): MapFlight[] {
  const source = rival ?? own;
  const ownerOf = (f: FlyingRow): MapFlight['owner'] => (rival ? 'rival' : f.own ? 'me' : 'player');
  return source.flying.map((f): MapFlight => ({
    reg: f.reg, info: text(f, f.own && !rival), from: f.from, to: f.to, t: f.progress, owner: ownerOf(f),
    line: f.lineId === null ? null : lineId(source.lines, f.lineId),
    ...(f.delayMin > 0 ? { late: `+${f.delayMin} min` } : {}),
  }));
}
const lineId = (lines: readonly Line[], id: number): string | null => { const l = lines.find((x) => x.id === id); return l ? pairId(l) : null; };

/** Every airport the map must place: the ends of every line, every flight and the hubs. */
/** The airports of the network being looked at: what the camera frames. */
export function networkAirports(n: NetworkView): string[] { return [...new Set([...n.lines.flatMap((l) => [l.a, l.b]), ...n.flying.flatMap((f) => [f.from, f.to])])]; }

export function mapAirportCodes(own: NetworkView, rival: NetworkView | null, hubs: readonly string[]): string[] {
  const set = new Set<string>(hubs);
  for (const n of rival ? [own, rival] : [own]) {
    for (const l of n.lines) { set.add(l.a); set.add(l.b); }
    for (const f of n.flying) { set.add(f.from); set.add(f.to); }
  }
  return [...set];
}

export type AirportFact = { icao: string; city: string; lat: number; lon: number };
export function mapAirports(facts: readonly AirportFact[], playerHubs: readonly string[], rivalHubs: readonly string[]): MapAirport[] {
  return facts.map((a) => ({ ...a, ...(playerHubs.includes(a.icao) ? { hub: 'player' as const } : rivalHubs.includes(a.icao) ? { hub: 'rival' as const } : {}) }));
}

// ---------------------------------------------------------------- face to face (rival network)

export type FaceToFace = { pair: string; own: Line; rival: Line };
/** Lines both companies fly on the same pair of airports, and the rival's lines nobody else flies. */
export function faceToFace(own: readonly Line[], rival: readonly Line[]): { shared: FaceToFace[]; alone: Line[] } {
  const mine = new Map(own.map((l) => [pairId(l), l]));
  const shared: FaceToFace[] = [];
  const alone: Line[] = [];
  for (const r of rival) { const o = mine.get(pairId(r)); if (o) shared.push({ pair: pairId(r), own: o, rival: r }); else alone.push(r); }
  return { shared, alone };
}

/** The shared line the player should reopen first: one that is down while the rival flies. */
export const reopenTarget = (shared: readonly FaceToFace[]): FaceToFace | null => shared.find((s) => s.own.status !== 'active') ?? null;

// ---------------------------------------------------------------- clocks and days

export const minutesOf = (hhmm: string): number => { const [h = '0', m = '0'] = hhmm.split(':'); return Number(h) * 60 + Number(m); };
export const hhmm = (minutes: number): string => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
/** `YYYY-MM-DD` of an instant, UTC. */
export const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
/** Minutes since 00:00 UTC of the day the instant falls in. */
export const minuteOfDay = (ms: number): number => Math.floor((ms % DAY_MS) / 60_000);
/** When something started, for a row: the time alone if it was today (UTC), the date and time otherwise. */
export const sinceToday = (ms: number, now: number): boolean => isoDay(ms) === isoDay(now);

/** The shown clock: the server's `now` plus the time spent since the answer arrived, so the clock keeps going between polls. */
export const clockNow = (serverNow: number, fetchedAt: number, now: number): number => serverNow + Math.max(0, now - fetchedAt);

/** Step through the week strip: clamped, so ←→ stop at its ends. */
export const stepDay = (week: readonly { date: string }[], current: string, dir: 1 | -1): string => {
  const i = week.findIndex((d) => d.date === current);
  if (i === -1) return week[0]?.date ?? current;
  return week[Math.min(week.length - 1, Math.max(0, i + dir))]!.date;
};

/** How the week strip labels a day, relative to today. */
export type DayKind = 'past' | 'today' | 'future';
export const dayKind = (date: string, today: string): DayKind => (date === today ? 'today' : date < today ? 'past' : 'future');

// ---------------------------------------------------------------- the day's timetable (line detail)

export type SegmentKind = 'done' | 'flying' | 'scheduled' | 'delayed' | 'cancelled';
/** `left` / `width` are percents of the 24 h track; `delay` is the width of the late part before the flight actually leaves (the flight itself is drawn from `dep + delay`). */
export type Segment = { id: number; flightNo: string; to: string; left: number; width: number; delayLeft: number; delay: number; kind: SegmentKind; takenByPlayer: boolean; status: ScheduledFlightStatus; delayMin: number };
export type Lane = { aircraftId: number; segments: Segment[]; rotations: number };

const round2 = (n: number): number => Math.round(n * 100) / 100;
const pct = (minutes: number): number => Math.round((Math.min(MINUTES_PER_DAY, Math.max(0, minutes)) / MINUTES_PER_DAY) * 10_000) / 100;
const flightKind = (f: Pick<ScheduledFlight, 'status'>): SegmentKind => f.status;

/** One lane per aircraft: the flights of `date` as positions (percent of the 24 h track). A flight that starts the day before or ends after midnight is cut at the track's ends. */
export function ganttLanes(flights: readonly ScheduledFlight[], aircraftIds: readonly number[], date: string): Lane[] {
  const dayStart = Date.parse(`${date}T00:00:00Z`);
  const onDay = flights.filter((f) => f.dep < dayStart + DAY_MS && f.arr > dayStart);
  return aircraftIds.map((id) => {
    const mine = onDay.filter((f) => f.aircraftId === id).sort((a, b) => a.dep - b.dep);
    const segments = mine.map((f): Segment => {
      const late = f.status === 'cancelled' ? 0 : f.delayMin;
      const planned = (f.dep - dayStart) / 60_000, from = planned + late, to = (f.arr - dayStart) / 60_000 + late;
      const left = pct(from);
      const delayLeft = pct(planned);
      return { id: f.id, flightNo: f.flightNo.split(' ').pop() ?? f.flightNo, to: f.dest, left, width: Math.max(0.6, round2(pct(to) - left)), delayLeft, delay: late > 0 ? round2(left - delayLeft) : 0, kind: flightKind(f), takenByPlayer: f.takenByPlayer, status: f.status, delayMin: f.delayMin };
    });
    return { aircraftId: id, segments, rotations: Math.ceil(mine.length / 2) };
  });
}

/** The fill of a dependency meter from the server's text (`84 %`, `4 sur 4`, `4 of 4`), 0..1; null when the text is not a measure. */
export function meterFraction(value: string): number | null {
  const percent = /^\s*(\d+(?:[.,]\d+)?)\s*%\s*$/.exec(value);
  if (percent) return Math.min(1, Number(percent[1]!.replace(',', '.')) / 100);
  const ratio = /^\s*(\d+)\s*(?:sur|of)\s*(\d+)\s*$/.exec(value);
  if (ratio && Number(ratio[2]) > 0) return Math.min(1, Number(ratio[1]) / Number(ratio[2]));
  return null;
}

/** Ticks of the hour ruler: every 2 h, as the mockup. */
export const RULER_HOURS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22] as const;

/** The parts of a day's revenue bar: costs, then margin. Widths are shares of the total (revenue); a loss shows costs only. */
export type Part = 'fuel' | 'fees' | 'crews' | 'maintenance' | 'margin';
export function pnlParts(p: { fuel: number; fees: number; crews: number; maintenance: number; margin: number }): { part: Part; value: number; share: number }[] {
  const costs: [Part, number][] = [['fuel', p.fuel], ['fees', p.fees], ['crews', p.crews], ['maintenance', p.maintenance]];
  const total = costs.reduce((s, [, v]) => s + v, 0) + Math.max(0, p.margin);
  const all: [Part, number][] = [...costs, ['margin', p.margin]];
  return all.map(([part, value]) => ({ part, value, share: total > 0 ? Math.round((Math.max(0, value) / total) * 1000) / 10 : 0 }));
}

// ---------------------------------------------------------------- creation: the programme and its preview

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export const ALL_DAYS = [true, true, true, true, true, true, true];
/** The server's `MAX_FREQ_PER_DAY`. */
export const MAX_FREQ = 48;
/** Turnaround the server applies when the body names none (`DEFAULT_TURNAROUND_MIN`); the preview lays out with it. */
export const DEFAULT_TURNAROUND_MIN = 30;

export type Draft = { a: string; b: string; freqPerDay: number; days: boolean[]; windowStart: string; windowEnd: string; aircraftIds: number[] };
export const DEFAULT_DRAFT: Draft = { a: '', b: '', freqPerDay: 4, days: ALL_DAYS, windowStart: '06:00', windowEnd: '22:00', aircraftIds: [] };

export const asProgramme = (d: Draft): LineBody => ({ a: d.a, b: d.b, freqPerDay: d.freqPerDay, days: d.days, windowStart: d.windowStart, windowEnd: d.windowEnd, aircraftIds: d.aircraftIds });
export const fromLine = (l: Line): Draft => ({ a: l.a, b: l.b, freqPerDay: l.freqPerDay, days: l.days, windowStart: l.windowStart, windowEnd: l.windowEnd, aircraftIds: l.aircraft.map((a) => a.id) });

/** Why the draft cannot be created yet; null when it can. The server stays the judge (hub, range, duplicates). */
export type DraftProblem = 'airports' | 'same' | 'aircraft' | 'days' | 'window' | 'freq';
export function draftProblem(d: Draft, known: { a: boolean; b: boolean }): DraftProblem | null {
  if (!known.a || !known.b) return 'airports';
  if (d.a === d.b) return 'same';
  if (d.aircraftIds.length === 0) return 'aircraft';
  if (!d.days.some(Boolean)) return 'days';
  if (!(minutesOf(d.windowEnd) > minutesOf(d.windowStart))) return 'window';
  if (!Number.isInteger(d.freqPerDay) || d.freqPerDay < 1 || d.freqPerDay > MAX_FREQ) return 'freq';
  return null;
}

/** Hours of the operating window (the unit of "per hour" frequencies). */
export const windowHours = (d: Pick<Draft, 'windowStart' | 'windowEnd'>): number => Math.max(1, Math.floor((minutesOf(d.windowEnd) - minutesOf(d.windowStart)) / 60));
/** The "par heure" view of a frequency: round trips per hour of the window, at least 1. */
export const perHour = (d: Pick<Draft, 'freqPerDay' | 'windowStart' | 'windowEnd'>): number => Math.max(1, Math.round(d.freqPerDay / windowHours(d)));
/** Round trips per day for `n` per hour over the window, capped at MAX_FREQ. */
export const freqFromPerHour = (n: number, d: Pick<Draft, 'windowStart' | 'windowEnd'>): number => Math.min(MAX_FREQ, Math.max(1, n) * windowHours(d));
/** The whole-day window ("24 h sur 24"): 23:59 closes it, since the contract's times are HH:MM within one day. */
export const ROUND_THE_CLOCK = { windowStart: '00:00', windowEnd: '23:59' } as const;
export const isRoundTheClock = (d: Pick<Draft, 'windowStart' | 'windowEnd'>): boolean => d.windowStart === ROUND_THE_CLOCK.windowStart && d.windowEnd === ROUND_THE_CLOCK.windowEnd;

/** Block time of a leg, in minutes, with the aircraft that flies it: the same `blockHours` the server settles with. */
export const blockMinutesFor = (type: Pick<AircraftType, 'cruiseKts'>, distanceNm: number): number => Math.round(blockHours(type as AircraftType, distanceNm) * 60);

export type RotationBlock = { leg: 'out' | 'back'; dep: number; arr: number; conflict: boolean };
export type PreviewLane = { aircraftId: number; blocks: RotationBlock[] };
export type Preview = { fromA: number[]; fromB: number[]; lanes: PreviewLane[]; roundTripsPerWeek: number; weekHours: number };

/**
 * The timetable the draft would fly, as an estimate for the creation screen (the server's forecast is the judge of money and conflicts):
 * `freq` round trips spread over the window so the last one lands back before it closes, each returning after the block time plus the turnaround,
 * aircraft taking the round trips in turn (docs/v3-plan.md B.2, "Generate").
 */
export function previewProgramme(d: Pick<Draft, 'freqPerDay' | 'days' | 'windowStart' | 'windowEnd' | 'aircraftIds'>, blockMin: number, turnaroundMin: number, conflicts: readonly { aircraftId: number; at: number }[] = []): Preview {
  const start = minutesOf(d.windowStart), end = minutesOf(d.windowEnd);
  const roundTrip = 2 * blockMin + turnaroundMin;
  const n = Math.max(0, d.freqPerDay);
  const step = n > 1 ? Math.max(blockMin + turnaroundMin, (end - start - roundTrip) / (n - 1)) : 0;
  const fromA = Array.from({ length: n }, (_, i) => start + Math.round(i * step));
  const fromB = fromA.map((m) => m + blockMin + turnaroundMin);
  const ids = d.aircraftIds;
  const lanes: PreviewLane[] = ids.map((aircraftId) => ({ aircraftId, blocks: [] }));
  const clash = (aircraftId: number, from: number, to: number): boolean => conflicts.some((c) => c.aircraftId === aircraftId && minuteOfDay(c.at) >= from && minuteOfDay(c.at) <= to);
  if (lanes.length) fromA.forEach((dep, i) => {
    const lane = lanes[i % lanes.length]!;
    const back = fromB[i]!;
    lane.blocks.push({ leg: 'out', dep, arr: dep + blockMin, conflict: clash(lane.aircraftId, dep, dep + blockMin) }, { leg: 'back', dep: back, arr: back + blockMin, conflict: clash(lane.aircraftId, back, back + blockMin) });
  });
  const dayCount = d.days.filter(Boolean).length;
  return { fromA, fromB, lanes, roundTripsPerWeek: n * dayCount, weekHours: Math.round(((n * dayCount * 2 * blockMin) / 60) * 10) / 10 };
}

/** The aircraft that can be put on a line starting at `a`: free ones, listed first when they stand at `a`. */
export function candidateAircraft<T extends { id: number; location: string; busy: boolean; status?: string }>(fleet: readonly T[], a: string): T[] {
  return fleet.filter((x) => x.status !== 'maintenance').sort((x, y) => Number(y.location === a) - Number(x.location === a) || Number(x.busy) - Number(y.busy));
}

/** The weekly bar of the forecast (income against costs), as widths. */
export const forecastShare = (f: { revenue: number; costs: number }): { costs: number; margin: number } => {
  const total = Math.max(f.revenue, f.costs, 1);
  return { costs: Math.round((f.costs / total) * 100), margin: Math.max(0, Math.round(((f.revenue - f.costs) / total) * 100)) };
};

// ---------------------------------------------------------------- interrupted line

export type Cause = 'aircraft' | 'crew';
export const causesOf = (l: Pick<Line, 'interruptCause'>): Cause[] => (l.interruptCause === 'both' ? ['aircraft', 'crew'] : l.interruptCause ? [l.interruptCause] : []);

/** Whole days between two instants, UTC calendar days. */
export const daysBetween = (from: number, to: number): number => Math.floor(to / DAY_MS) - Math.floor(from / DAY_MS);

/** Days of the projection that fly: `assured` ones (`stopped` and `off` days do not). */
export const assuredDays = (projection: readonly { status: ProjectionStatus }[]): number => projection.filter((x) => x.status === 'assured').length;

/** What the panel lists for a bridge: the slots that leave together, counted and priced as one row. */
export type SlotGroup = { family: 'pilot' | 'cabin'; type: string | null; until: number; defaulted: boolean; people: number; cost: number };
export function groupSlots(slots: readonly LineBridgeSlot[]): SlotGroup[] {
  const out = new Map<string, SlotGroup>();
  for (const s of slots) {
    const key = `${s.family}:${s.type ?? ''}:${s.until}:${s.defaulted}`;
    const g = out.get(key) ?? { family: s.family, type: s.type, until: s.until, defaulted: s.defaulted, people: 0, cost: 0 };
    g.people++; g.cost += s.cost;
    out.set(key, g);
  }
  return [...out.values()];
}

/** The cheaper way to be back in service now, as the server priced them; null when only one is on offer or they cost the same. */
export const cheaperRemedy = (o: Pick<LineProblemView['options'], 'interim' | 'startNow'>): 'interim' | 'start_now' | null =>
  !o.interim || !o.startNow || o.interim.cost === o.startNow.cost ? null : o.interim.cost < o.startNow.cost ? 'interim' : 'start_now';

/** The remedy selected when the panel opens: the cheapest way to fly now when the crew is short, else the first one that can be applied. */
export const defaultRemedy = (o: LineProblemView['options']): ResolveOption =>
  cheaperRemedy(o) ?? (o.interim ? 'interim' : o.startNow ? 'start_now' : o.reassign ? 'reassign' : o.recruit ? 'recruit' : 'pause');

// ---------------------------------------------------------------- operations board

export type OpsFilter = 'all' | 'delayed' | 'cancelled' | 'mine';
export const OPS_FILTERS: readonly OpsFilter[] = ['all', 'delayed', 'cancelled', 'mine'];
export const nextFilter = (f: OpsFilter): OpsFilter => OPS_FILTERS[(OPS_FILTERS.indexOf(f) + 1) % OPS_FILTERS.length]!;
export function filterOps(rows: readonly OpsRow[], f: OpsFilter): OpsRow[] {
  switch (f) {
    case 'all': return [...rows];
    case 'delayed': return rows.filter((r) => r.delayMin > 0 && r.status !== 'cancelled');
    case 'cancelled': return rows.filter((r) => r.status === 'cancelled');
    case 'mine': return rows.filter((r) => r.own);
  }
}

export type OpsBadge = 'ontime' | 'delayed' | 'cancelled' | 'mine';
export const opsBadge = (r: Pick<OpsRow, 'status' | 'delayMin' | 'own'>): OpsBadge => (r.own ? 'mine' : r.status === 'cancelled' ? 'cancelled' : r.delayMin > 0 || r.status === 'delayed' ? 'delayed' : 'ontime');

/** The message of a cancellation cause; `note` from the server is plain words and only a fallback. */
export const APPLIED_KEYS: Record<ResolveOption, Key> = { reassign: 'ln.applied.reassign', recruit: 'ln.applied.recruit', pause: 'ln.applied.pause', interim: 'ln.applied.interim', start_now: 'ln.applied.start_now' };
export const CAUSE_KEYS: Record<CancelCause, Key> = { aircraft_unavailable: 'ln.cause.aircraft', no_crew: 'ln.cause.crew', duty_limit: 'ln.cause.duty', line_paused: 'ln.cause.paused' };

/** The phase an in-flight row shows when the server gives no distance: derived from the progress. */
export type Phase = 'climb' | 'cruise' | 'descent';
export const phaseOf = (progress: number): Phase => (progress < 0.15 ? 'climb' : progress > 0.8 ? 'descent' : 'cruise');

/** Where an in-flight row is along its flight, as a percentage. */
export const progressPct = (f: Pick<ScheduledFlight, 'dep' | 'arr'> & { delayMin?: number }, now: number): number => {
  const late = (f.delayMin ?? 0) * 60_000;
  return Math.round(Math.min(1, Math.max(0, (now - f.dep - late) / Math.max(1, f.arr - f.dep))) * 100);
};

/** "Enter treats the alert": the first cancelled flight of the board, whose line the player should open. */
export const firstAlert = (rows: readonly OpsRow[]): OpsRow | null => rows.find((r) => r.status === 'cancelled') ?? null;

/** Fleet in service: aircraft that are not in the workshop. */
export const inService = (fleet: readonly { status: string }[]): { running: number; total: number } => ({ running: fleet.filter((a) => a.status !== 'maintenance').length, total: fleet.length });
