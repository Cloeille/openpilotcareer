import type { AircraftCategory, AircraftType } from '@opc/shared';
import type {
  Blocker, Candidate, Coverage, CoverageRow, DutyBlock, DutyState, FamilyRow, LeaveRequest, MemberRef, PolicyOption, Qualification, RestPolicy, StaffDetail, StaffOverview,
} from './api-staff.ts';

/**
 * Pure view-models of the STAFF screens: what a screen derives from the API's answers, testable without a DOM.
 * Strings are not made here: a view-model returns kinds and numbers, the screen translates them.
 */

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

/**
 * Mirrors of the constants of lot S2's `shared/src/staff.ts`, which this branch does not have yet. Once S2 is merged, replace this block by imports from '@opc/shared'
 * (the names are the same); what the server sends (the limit of the duty in progress, the rest hours of a policy) always wins.
 */
export const RULES = {
  dutyMaxMin: 13 * 60, flight28Min: 100 * 60, flight12Min: 900 * 60, duty7Min: 60 * 60,
  /** A duty period starts this long before the first departure and ends this long after the last landing. */
  reportMin: 45, releaseMin: 15,
  /** Two legs less than this apart belong to the same duty period. */
  breakMin: 6 * 60,
  maxStreakDays: 6, weeklyRestH: 36,
} as const;
/** Type rating course by aircraft category: days off the roster and price (S2's TRAINING_COURSE). */
export const TRAINING_COURSE: Record<AircraftCategory, { days: number; cost: number }> = {
  'piston-single': { days: 7, cost: 3_500 }, 'piston-multi': { days: 10, cost: 6_000 }, 'turboprop-single': { days: 14, cost: 9_000 }, 'turboprop-multi': { days: 14, cost: 12_000 },
  'turboprop-airliner': { days: 21, cost: 18_000 }, 'jet-business': { days: 21, cost: 20_000 }, 'jet-airliner': { days: 21, cost: 24_000 }, 'jet-widebody': { days: 28, cost: 36_000 },
  helicopter: { days: 14, cost: 12_000 }, other: { days: 14, cost: 8_000 },
};
/** What a temp costs for `days` (S2's `interimPrice`): 1.2 x the daily salary x 1.5. */
export const interimPrice = (monthlySalary: number, days: number): number => Math.round((monthlySalary / 30) * 1.2 * 1.5 * days);

export type Tone = 'ok' | 'warn' | 'bad';

/** A load counts as close to its limit from this share of it (the mockup colours 11,2 h of 13 and 812 h of 900, not 9,2 h of 13, 46 h of 60 or 74 h of 100). */
export const NEAR_LIMIT = 0.85;
/** Morale at or above `high` reads "Haut", below `medium` reads "Bas" (the mockup shows the three words, the server a number). */
export const MORALE_LEVELS = { high: 75, medium: 50 } as const;
/** Reliability under this reads as a risk (the mockup's 64 % is orange, its 76 % is not). */
export const RELIABILITY_RISK = 70;
/** A gap between two flights of one duty period at least this long is drawn as a break (the shorter ones are turnarounds). */
export const PAUSE_MIN = 90;
/** Medical validity turns amber under this many days. */
export const MEDICAL_WARN_DAYS = 30;

/** How full a limit is: the fraction of the bar and its tone (over the limit is `bad`). */
export function loadMeter(used: number, limit: number): { fraction: number; tone: Tone } {
  const fraction = limit > 0 ? Math.min(1, Math.max(0, used / limit)) : 0;
  return { fraction, tone: used > limit ? 'bad' : fraction >= NEAR_LIMIT ? 'warn' : 'ok' };
}

// ---------------------------------------------------------------- overview (effectifs)

export const rowKey = (r: Pick<FamilyRow, 'family' | 'type'>): string => (r.type ? `${r.family}:${r.type}` : r.family);

/** A blocker names a family and a pilot type: a family row is blocked by any blocker of its family, a type row only by its own type. */
export const blocksRow = (b: Pick<Blocker, 'family' | 'type'>, row: Pick<FamilyRow, 'family' | 'type'>): boolean => b.family === row.family && (row.type === undefined || b.type === row.type);
export const blockerOf = (blockers: readonly Blocker[], row: Pick<FamilyRow, 'family' | 'type'>): Blocker | null => blockers.find((b) => blocksRow(b, row)) ?? null;

export type RowBadge =
  | { tone: 'bad'; kind: 'blocks'; flights: number }
  | { tone: 'bad'; kind: 'none' }
  | { tone: 'warn'; kind: 'note'; note: string }
  | { tone: 'warn'; kind: 'missing'; n: number }
  | { tone: 'ok'; kind: 'complete' };

/** The state of a row, said once: a blocker (red), a note or a missing person (amber), or complete. */
export function rowBadge(row: FamilyRow, blockers: readonly Blocker[]): RowBadge {
  const blocking = blockers.filter((b) => blocksRow(b, row));
  if (blocking.length > 0) {
    if (row.type !== undefined && blocking.some((b) => b.kind === 'no_crew')) return { tone: 'bad', kind: 'none' };
    return { tone: 'bad', kind: 'blocks', flights: blocking.reduce((n, b) => n + b.flights, 0) };
  }
  if (row.note) return { tone: 'warn', kind: 'note', note: row.note };
  if (row.headcount < row.need) return { tone: 'warn', kind: 'missing', n: row.need - row.headcount };
  return { tone: 'ok', kind: 'complete' };
}

export type VisibleRow = { row: FamilyRow; key: string; depth: 0 | 1; expandable: boolean; expanded: boolean };
/** The rows on screen, in reading order: a family, then its types when it is expanded. */
export function visibleRows(families: readonly FamilyRow[], expanded: ReadonlySet<string>): VisibleRow[] {
  return families.flatMap((row): VisibleRow[] => {
    const key = rowKey(row);
    const kids = row.children ?? [];
    const open = kids.length > 0 && expanded.has(key);
    return [{ row, key, depth: 0, expandable: kids.length > 0, expanded: open }, ...(open ? kids.map((c): VisibleRow => ({ row: c, key: rowKey(c), depth: 1, expandable: false, expanded: false })) : [])];
  });
}
export const expandableKeys = (families: readonly FamilyRow[]): string[] => families.filter((f) => (f.children?.length ?? 0) > 0).map(rowKey);
/** Families with children open on arrival when something in them needs attention (the mockup opens the pilots, who have a blocker). */
export const defaultExpanded = (families: readonly FamilyRow[], blockers: readonly Blocker[]): Set<string> =>
  new Set(families.filter((f) => (f.children?.length ?? 0) > 0 && rowBadge(f, blockers).tone !== 'ok').map(rowKey));
/** "Tout dérouler" opens everything; with everything open it closes everything. */
export const toggleAll = (families: readonly FamilyRow[], expanded: ReadonlySet<string>): Set<string> => {
  const all = expandableKeys(families);
  return all.every((k) => expanded.has(k)) ? new Set() : new Set(all);
};

export type AvailabilityKind = 'duty' | 'free' | 'rest' | 'leave' | 'training' | 'vacant';
export type AvailabilitySegment = { kind: AvailabilityKind; count: number };
/** The bar of "Disponibilité maintenant": one segment per state that has people; each is as wide as its count. */
export function availabilitySegments(a: FamilyRow['availability']): AvailabilitySegment[] {
  const all: AvailabilitySegment[] = [{ kind: 'duty', count: a.onDuty }, { kind: 'free', count: a.free }, { kind: 'rest', count: a.resting }, { kind: 'leave', count: a.leave }, { kind: 'training', count: a.training }, { kind: 'vacant', count: a.vacant }];
  return all.filter((s) => s.count > 0);
}

/** The row the side panel opens on: the first type or family that blocks flights (types first, they say which), else the first row. */
export function defaultRow(rows: readonly VisibleRow[], blockers: readonly Blocker[]): string | null {
  const blocked = rows.filter((r) => blockerOf(blockers, r.row));
  return (blocked.find((r) => r.depth === 1) ?? blocked[0] ?? rows[0])?.key ?? null;
}

/** What the recruit button and the `R` key open: the family of the row, and the type of a pilot row. */
export const presetFor = (row: Pick<FamilyRow, 'family' | 'type'> | null, blocker: Pick<Blocker, 'family' | 'type'> | null): { family: Candidate['family']; qual: string | null } => ({
  family: (row?.family ?? blocker?.family) ?? 'pilot', qual: row?.type ?? (blocker?.type || null),
});

/** Pilots in the order the member sheet steps through them. Empty while the server does not send `members`. */
export function membersOf(o: Pick<StaffOverview, 'families'>): MemberRef[] {
  return o.families.flatMap((f) => (f.children?.length ? f.children.flatMap((c) => c.members ?? []) : (f.members ?? [])));
}
/** The member `dir` steps away; null at the ends (←→ stop there) or when the member is not in the list. */
export function stepMember(members: readonly MemberRef[], id: number, dir: 1 | -1): MemberRef | null {
  const i = members.findIndex((m) => m.id === id);
  return i === -1 ? null : (members[i + dir] ?? null);
}

// ---------------------------------------------------------------- recruitment

export type Level = 'high' | 'medium' | 'low';
export const moraleLevel = (morale: number): Level => (morale >= MORALE_LEVELS.high ? 'high' : morale >= MORALE_LEVELS.medium ? 'medium' : 'low');
export const reliabilityTone = (reliability: number): Tone => (reliability < RELIABILITY_RISK ? 'warn' : 'ok');
/** The candidate to show selected: the one the player had, else the first of the list. */
export const keepSelection = (list: readonly Pick<Candidate, 'id'>[], id: string | null): string | null => (list.some((c) => c.id === id) ? id : (list[0]?.id ?? null));
/** The day a candidate can start: today plus the notice. */
export const startsAt = (now: number, c: Pick<Candidate, 'noticeDays'>): number => now + c.noticeDays * DAY_MS;
/** Flights that stay cancelled for want of this family (and, for a pilot, this type): what hiring the candidate may unblock. 0 when nothing is blocked. */
export const unblocks = (blockers: readonly Blocker[], c: Pick<Candidate, 'family' | 'qual'>): number =>
  blockers.filter((b) => b.family === c.family && (c.family !== 'pilot' || c.qual === b.type)).reduce((n, b) => n + b.flights, 0);

// ---------------------------------------------------------------- member sheet

export const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export type ViewBlock = { kind: 'brief' | 'flight' | 'pause'; flightNo: string | null; origin: string | null; dest: string | null; start: number; end: number; status: 'done' | 'flying' | 'planned'; over: { from: number } | null };
export type DutyPeriod = { start: number; limitAt: number; blocks: ViewBlock[] };

const statusAt = (b: { dep: number; arr: number }, now: number): ViewBlock['status'] => (b.arr <= now ? 'done' : b.dep <= now ? 'flying' : 'planned');

/**
 * Duty periods of the week from the member's flights: legs less than `breakMin` apart share a period, which starts `reportMin` before its first departure, can last `dutyMaxMin`, and is drawn with a brief
 * and a break wherever two legs are `PAUSE_MIN` or more apart. A leg is `over` when its landing plus the release would pass the limit; the part flown after the limit itself is what the chart paints red. `endsAt` (the server's limit of the period in progress) wins over the computed one.
 */
export function dutyPeriods(week: readonly DutyBlock[], now: number, endsAt: number | null): DutyPeriod[] {
  const legs = [...week].sort((a, b) => a.dep - b.dep);
  const groups: DutyBlock[][] = [];
  for (const leg of legs) {
    const last = groups.at(-1);
    if (last && leg.dep - last.at(-1)!.arr < RULES.breakMin * MINUTE_MS) last.push(leg); else groups.push([leg]);
  }
  return groups.map((g): DutyPeriod => {
    const start = g[0]!.dep - RULES.reportMin * MINUTE_MS;
    const computed = start + RULES.dutyMaxMin * MINUTE_MS;
    const current = endsAt !== null && start <= now && now <= computed + HOUR_MS;
    const limitAt = current ? endsAt : computed;
    const blocks: ViewBlock[] = [{ kind: 'brief', flightNo: null, origin: null, dest: null, start, end: g[0]!.dep, status: statusAt({ dep: start, arr: g[0]!.dep }, now), over: null }];
    g.forEach((leg, i) => {
      const prev = g[i - 1];
      if (prev && leg.dep - prev.arr >= PAUSE_MIN * MINUTE_MS) blocks.push({ kind: 'pause', flightNo: null, origin: null, dest: null, start: prev.arr, end: leg.dep, status: statusAt({ dep: prev.arr, arr: leg.dep }, now), over: null });
      // The release after landing counts in the duty (S2's rule), so a leg landing inside the last 15 minutes breaches too; the red part is what flies past the limit itself.
      const breach = leg.arr + RULES.releaseMin * MINUTE_MS > limitAt;
      blocks.push({ kind: 'flight', flightNo: leg.flightNo, origin: leg.origin, dest: leg.dest, start: leg.dep, end: leg.arr, status: statusAt(leg, now), over: breach ? { from: Math.min(leg.arr, Math.max(leg.dep, limitAt)) } : null });
    });
    return { start, limitAt, blocks };
  });
}

/** UTC days that have a duty period starting on them, oldest first. */
export const dutyDays = (periods: readonly DutyPeriod[]): string[] => [...new Set(periods.map((p) => isoDay(p.start)))].sort();
/** The day the duty chart opens on: today if it has duty, else the next day that does, else the latest before. */
export function chartDay(days: readonly string[], now: number): string | null {
  const today = isoDay(now);
  return days.includes(today) ? today : (days.find((d) => d > today) ?? days.at(-1) ?? null);
}

export type GanttBar = { block: ViewBlock; left: number; width: number; over: { left: number; width: number } | null };
export type Gantt = { startMs: number; endMs: number; ticks: { label: string; pct: number }[]; bars: GanttBar[]; nowPct: number | null; limitPct: number | null };

/** The chart of one day's periods: an axis in whole even hours that holds every block and the limit, bars in percent of it, the part of a flight past the limit apart, and the "now" and "limit" markers when they fall inside. */
export function ganttOf(periods: readonly DutyPeriod[], now: number, minHours = 6): Gantt {
  const blocks = periods.flatMap((p) => p.blocks);
  if (blocks.length === 0) return { startMs: now, endMs: now + minHours * HOUR_MS, ticks: [], bars: [], nowPct: null, limitPct: null };
  const limitAt = (periods.find((p) => p.start <= now && now <= p.limitAt) ?? periods[0]!).limitAt;
  const first = Math.min(...blocks.map((b) => b.start));
  const last = Math.max(...blocks.map((b) => b.end), limitAt);
  const startMs = Math.floor(first / (2 * HOUR_MS)) * 2 * HOUR_MS;
  const endMs = Math.max(Math.ceil(last / (2 * HOUR_MS)) * 2 * HOUR_MS, startMs + minHours * HOUR_MS);
  const pct = (ms: number): number => Math.min(100, Math.max(0, ((ms - startMs) / (endMs - startMs)) * 100));
  const ticks: Gantt['ticks'] = [];
  for (let at = startMs; at <= endMs; at += 2 * HOUR_MS) ticks.push({ label: `${String(new Date(at).getUTCHours()).padStart(2, '0')}:00`, pct: pct(at) });
  const bars = blocks.map((block): GanttBar => ({ block, left: pct(block.start), width: pct(block.end) - pct(block.start), over: block.over ? { left: pct(block.over.from), width: pct(block.end) - pct(block.over.from) } : null }));
  const inside = (ms: number): number | null => (ms >= startMs && ms <= endMs ? pct(ms) : null);
  return { startMs, endMs, ticks, bars, nowPct: inside(now), limitPct: inside(limitAt) };
}

export type DutyFacts = { onDuty: boolean; startedAt: number | null; limitAt: number | null; remaining: { flights: number; minutes: number } };
/** Today's duty in progress: when it started, when it must end, and what is still to fly in it. */
export function dutyFacts(duty: Pick<DutyState, 'endsAt' | 'dutyMin'>, periods: readonly DutyPeriod[], now: number): DutyFacts {
  const current = duty.endsAt === null ? null : (periods.find((p) => p.start <= now && now <= p.limitAt) ?? null);
  const ahead = (current?.blocks ?? []).filter((b) => b.kind === 'flight' && b.end > now);
  return {
    onDuty: current !== null, startedAt: current ? now - duty.dutyMin * MINUTE_MS : null, limitAt: current ? duty.endsAt : null,
    remaining: { flights: ahead.length, minutes: Math.round(ahead.reduce((n, b) => n + (b.end - Math.max(b.start, now)) / MINUTE_MS, 0)) },
  };
}

export type DayBar = { day: string; kind: 'duty' | 'rest'; hours: number; planned: number; height: number; plannedHeight: number; tone: Tone };
/** The seven-day bars: heights against the daily duty limit; the heaviest closed days go amber. `planned` is the hours still to fly on a day. */
export function dayBars(days: readonly StaffDetail['last7d'][number][], planned: ReadonlyMap<string, number>, limitHours: number): DayBar[] {
  const h = (hours: number): number => (limitHours > 0 ? Math.min(1, Math.max(0, hours / limitHours)) : 0);
  return days.map((d) => {
    const hours = d.hours ?? 0, more = planned.get(d.day) ?? 0;
    return { day: d.day, kind: d.kind, hours, planned: more, height: h(hours), plannedHeight: h(more), tone: d.kind === 'duty' && more === 0 && h(hours) >= NEAR_LIMIT ? 'warn' : 'ok' };
  });
}
/** Hours of flight still to come on each day, from the week's flights. */
export function plannedHours(week: readonly DutyBlock[], now: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const leg of week) if (leg.arr > now) out.set(isoDay(leg.dep), (out.get(isoDay(leg.dep)) ?? 0) + (leg.arr - Math.max(leg.dep, now)) / HOUR_MS);
  return out;
}
export const restDays = (days: readonly { kind: 'duty' | 'rest' }[]): number => days.filter((d) => d.kind === 'rest').length;
/** Minutes of duty over the seven days the sheet lists (the "service, last 7 days" meter). */
export const service7dMin = (days: readonly { hours: number | null }[]): number => Math.round(days.reduce((n, d) => n + (d.hours ?? 0), 0) * 60);

export type Meter = { key: '28' | '7' | '12'; usedMin: number; limitMin: number; fraction: number; tone: Tone };
/** The three limit bars of the sheet. */
export function limitMeters(duty: Pick<DutyState, 'flight28d' | 'flight12m'>, serviceMin: number): Meter[] {
  const m = (key: Meter['key'], usedMin: number, limitMin: number): Meter => ({ key, usedMin, limitMin, ...loadMeter(usedMin, limitMin) });
  return [m('28', duty.flight28d, RULES.flight28Min), m('7', serviceMin, RULES.duty7Min), m('12', duty.flight12m, RULES.flight12Min)];
}

export const medicalState = (days: number): { tone: Tone; days: number } => ({ days, tone: days < 0 ? 'bad' : days < MEDICAL_WARN_DAYS ? 'warn' : 'ok' });

export type TrainingOffer = { type: string; name: string; days: number; cost: number };
/** Types of the fleet the pilot holds no qualification for yet, each with the course S2 will bill. */
export function trainingOffers(quals: readonly Pick<Qualification, 'type'>[], fleetTypes: readonly Pick<AircraftType, 'icao' | 'name' | 'category'>[]): TrainingOffer[] {
  const known = new Set(quals.map((q) => q.type));
  return fleetTypes.filter((t) => !known.has(t.icao)).map((t) => ({ type: t.icao, name: t.name, ...TRAINING_COURSE[t.category] }));
}

/** Whole calendar months between two instants, UTC (for "chez X depuis 14 mois"). */
export function monthsSince(from: number, now: number): number {
  const a = new Date(from), b = new Date(now);
  const months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth() - (b.getUTCDate() < a.getUTCDate() ? 1 : 0);
  return Math.max(0, months);
}

// ---------------------------------------------------------------- leave and rest

export type DayColumn = { iso: string; weekday: string; date: number; weekend: boolean };
/** The calendar header: `n` days from `from` (`YYYY-MM-DD`), weekday initial above the day of the month. */
export function dayColumns(from: string, n: number, locale: string): DayColumn[] {
  const start = Date.parse(`${from}T12:00:00Z`);
  const initial = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'narrow' });
  return Array.from({ length: n }, (_, i) => {
    const ms = start + i * DAY_MS;
    const dow = new Date(ms).getUTCDay();
    return { iso: isoDay(ms), weekday: initial.format(ms), date: new Date(ms).getUTCDate(), weekend: dow === 0 || dow === 6 };
  });
}
/** `novembre → décembre`, or the one month. */
export function monthSpan(cols: readonly DayColumn[], locale: string): string {
  if (cols.length === 0) return '';
  const f = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'long' });
  const a = f.format(Date.parse(`${cols[0]!.iso}T12:00:00Z`)), b = f.format(Date.parse(`${cols.at(-1)!.iso}T12:00:00Z`));
  return a === b ? a : `${a} → ${b}`;
}

const SEVERITY: Record<Coverage, number> = { ok: 0, tight: 1, short: 2, none: 3 };
export const worst = (cells: readonly Coverage[]): Coverage => cells.reduce<Coverage>((w, c) => (SEVERITY[c] > SEVERITY[w] ? c : w), 'ok');
export type Cell = { row: number; day: number };
/** The cell the calendar opens on: the first day somebody is missing (`short`), reading days left to right and rows top to bottom; else the first day of the first row. A row that is `none` all along is a standing fact, not a day to look at. */
export function firstProblem(rows: readonly Pick<CoverageRow, 'days'>[]): Cell {
  const n = Math.max(0, ...rows.map((r) => r.days.length));
  for (let day = 0; day < n; day++) {
    const row = rows.findIndex((r) => r.days[day] === 'short');
    if (row !== -1) return { row, day };
  }
  return { row: 0, day: 0 };
}
/** Move the selection; clamped to the grid, so ← → stop at the ends of the period. */
export const moveCell = (cell: Cell, rows: number, days: number, by: { row?: number; day?: number }): Cell => ({
  row: Math.min(Math.max(0, rows - 1), Math.max(0, cell.row + (by.row ?? 0))),
  day: Math.min(Math.max(0, days - 1), Math.max(0, cell.day + (by.day ?? 0))),
});
/** Days (of the period) on which somebody is missing, in any family: the banner "2 jours en sous-effectif". */
export const shortDays = (rows: readonly Pick<CoverageRow, 'days'>[]): number => {
  const n = Math.max(0, ...rows.map((r) => r.days.length));
  return Array.from({ length: n }, (_, i) => i).filter((i) => rows.some((r) => r.days[i] === 'short')).length;
};
/** Rows with nobody qualified at all (every day `none`): "aucun pilote CRJ". */
export const emptyRows = (rows: readonly Pick<CoverageRow, 'label' | 'days'>[]): string[] => rows.filter((r) => r.days.length > 0 && r.days.every((c) => c === 'none')).map((r) => r.label);

/** People of the family away on `iso`, by granted or pending request (a refused one does not count). */
export const absentOn = (requests: readonly LeaveRequest[], family: CoverageRow['family'], iso: string): LeaveRequest[] =>
  requests.filter((r) => r.family === family && r.status !== 'refused' && r.from <= iso && iso <= r.to);

export type RequestImpact = { kind: 'none' } | { kind: 'worse'; after: Coverage; day: string };
/** What granting a pending request does: nothing worse than "tight", or a day with someone missing. */
export function requestImpact(r: Pick<LeaveRequest, 'impact'>): RequestImpact {
  const i = r.impact;
  return i && SEVERITY[i.after] >= SEVERITY.short && SEVERITY[i.after] > SEVERITY[i.before] ? { kind: 'worse', after: i.after, day: i.worstDay } : { kind: 'none' };
}
/** Only pending requests show buttons. */
export const pendingRequests = <T extends { status: string }>(requests: readonly T[]): T[] => requests.filter((r) => r.status === 'pending');

export type PolicyPreview = { extraHeadcount: number; payrollDelta: number; fatigueFrom: number; fatigueTo: number; riskPct: number };
/** What switching to `chosen` promises (S2's figures: the policy's fatigue factor applied to today's mean, its incident-risk change); null when it is the policy in force. */
export function policyPreview(current: RestPolicy, chosen: PolicyOption, avgFatigue: number): PolicyPreview | null {
  if (chosen.policy === current) return null;
  return { extraHeadcount: chosen.extraHeadcount, payrollDelta: chosen.payrollDelta, fatigueFrom: Math.round(avgFatigue), fatigueTo: Math.round(avgFatigue * chosen.fatigueFactor), riskPct: Math.round(chosen.riskPct) };
}

/** The mean monthly salary of a family, for pricing a temp. Null when the family has nobody. */
export const meanSalary = (rows: readonly Pick<FamilyRow, 'family' | 'headcount' | 'salaries'>[], family: FamilyRow['family']): number | null => {
  const r = rows.filter((x) => x.family === family);
  const heads = r.reduce((n, x) => n + x.headcount, 0);
  return heads > 0 ? r.reduce((n, x) => n + x.salaries, 0) / heads : null;
};
