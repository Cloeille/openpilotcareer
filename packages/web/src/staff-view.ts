import type {
  Availability, Blocker, Candidate, Coverage, CoverageAlert, CoverageRow, DutyBlock, DutyDay, FamilyRow, PolicyOption, RestPolicy, StaffOverview, StaffRef,
} from './api-staff.ts';

/**
 * Pure view-models of the STAFF screens: what a screen derives from the API's answers, testable without a DOM.
 * Strings are not made here: a view-model returns kinds and numbers, the screen translates them.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export type Tone = 'ok' | 'warn' | 'bad';

/** A load counts as close to its limit from this share of it (the mockup colours 11,2 h of 13 and 812 h of 900, not 9,2 h of 13, 46 h of 60 or 74 h of 100). */
export const NEAR_LIMIT = 0.85;
/** The hiring premium of B.3: one month of the asking salary. */
export const HIRE_PREMIUM_MONTHS = 1;
/** Morale at or above `high` reads "Haut", below `medium` reads "Bas" (the mockup shows the three words, the server a number). */
export const MORALE_LEVELS = { high: 75, medium: 50 } as const;
/** Reliability under this reads as a risk (the mockup's 64 % is orange, its 76 % is not). */
export const RELIABILITY_RISK = 70;

/** How full a limit is: the fraction of the bar and its tone (over the limit is `bad`). */
export function loadMeter(used: number, limit: number): { fraction: number; tone: Tone } {
  const fraction = limit > 0 ? Math.min(1, Math.max(0, used / limit)) : 0;
  return { fraction, tone: used > limit ? 'bad' : fraction >= NEAR_LIMIT ? 'warn' : 'ok' };
}

// ---------------------------------------------------------------- overview (effectifs)

export const rowKey = (r: Pick<FamilyRow, 'family' | 'type'>): string => (r.type ? `${r.family}:${r.type}` : r.family);

/** A blocker names a family and maybe a type: a family row (no type) is blocked by any of its blockers, a type row only by its own. */
export const blocksRow = (b: Pick<Blocker, 'family' | 'type'>, row: Pick<FamilyRow, 'family' | 'type'>): boolean =>
  b.family === row.family && (row.type === undefined || b.type === row.type);

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
    const flights = blocking.reduce((n, b) => n + b.flights.length, 0);
    return row.type !== undefined && row.availability.onDuty === 0 ? { tone: 'bad', kind: 'none' } : { tone: 'bad', kind: 'blocks', flights };
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

export type AvailabilityKind = 'duty' | 'rest' | 'leave' | 'training' | 'vacant';
export type AvailabilitySegment = { kind: AvailabilityKind; count: number };
/** The bar of "Disponibilité maintenant": one segment per state that has people; each is as wide as its count. */
export function availabilitySegments(a: Availability): AvailabilitySegment[] {
  const all: AvailabilitySegment[] = [{ kind: 'duty', count: a.onDuty }, { kind: 'rest', count: a.resting }, { kind: 'leave', count: a.leave }, { kind: 'training', count: a.training }, { kind: 'vacant', count: a.vacant }];
  return all.filter((s) => s.count > 0);
}

/** The panel on the right follows the focused row: its blocker if it has one, else the row's own figures. */
export const panelFor = (row: FamilyRow | null, blockers: readonly Blocker[]): { blocker: Blocker } | { row: FamilyRow | null } => {
  const b = row ? blockerOf(blockers, row) : (blockers[0] ?? null);
  return b ? { blocker: b } : { row };
};

/** What the recruit button and the `R` key open: the family of the row, and the type of a pilot row or of the blocker. */
export type HireFilters = { family: string; base: string | null; qual: string | null };
export const presetFor = (row: FamilyRow | null, blocker: Blocker | null): Partial<HireFilters> => ({
  family: (row?.family ?? blocker?.family) ?? 'pilot', qual: row?.type ?? blocker?.type ?? null,
});

/** Pilots in the order the member sheet steps through them (the types in the overview's order, captains first as the server lists them). */
export function membersOf(o: Pick<StaffOverview, 'families'>): StaffRef[] {
  return o.families.flatMap((f) => (f.children?.length ? f.children.flatMap((c) => c.members ?? []) : (f.members ?? [])));
}
/** The member `dir` steps away; clamped like the day strip, so ← → stop at the ends. */
export function stepMember(members: readonly StaffRef[], id: number, dir: 1 | -1): StaffRef | null {
  const i = members.findIndex((m) => m.id === id);
  if (i === -1) return null;
  const to = members[i + dir];
  return to ?? null;
}

// ---------------------------------------------------------------- recruitment

export type Level = 'high' | 'medium' | 'low';
export const moraleLevel = (morale: number): Level => (morale >= MORALE_LEVELS.high ? 'high' : morale >= MORALE_LEVELS.medium ? 'medium' : 'low');
export const reliabilityTone = (reliability: number): Tone => (reliability < RELIABILITY_RISK ? 'warn' : 'ok');
/** The candidate to show selected: the one the player had, else the first of the list. */
export const keepSelection = (list: readonly Pick<Candidate, 'id'>[], id: string | null): string | null => (list.some((c) => c.id === id) ? id : (list[0]?.id ?? null));
/** What the player owes on signing: one month of the asking salary (B.3). */
export const hirePremium = (c: Pick<Candidate, 'salary'>): number => c.salary * HIRE_PREMIUM_MONTHS;
/** Candidates asking for a base other than the one filtered say so ("préfère Nice"). */
export const prefersElsewhere = (c: Pick<Candidate, 'base' | 'prefersBase'>): string | null => (c.prefersBase && c.prefersBase !== c.base ? c.prefersBase : null);

// ---------------------------------------------------------------- member sheet

export type Role = 'captain' | 'fo' | 'other';
export const roleOf = (role: string): Role => (role === 'captain' || role === 'fo' ? role : 'other');

export const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
/** UTC days that have duty blocks, oldest first. */
export const dutyDays = (blocks: readonly DutyBlock[]): string[] => [...new Set(blocks.map((b) => isoDay(b.start)))].sort();
/** The day the duty chart opens on: today if it has duty, else the first day that does. */
export const chartDay = (days: readonly string[], now: number): string | null => (days.includes(isoDay(now)) ? isoDay(now) : (days[0] ?? null));

export type GanttBar = { block: DutyBlock; left: number; width: number; over: { left: number; width: number } | null };
export type Gantt = { startMs: number; endMs: number; ticks: { label: string; pct: number }[]; bars: GanttBar[]; nowPct: number | null; limitPct: number | null };

const pct = (ms: number, g: { startMs: number; endMs: number }): number => ((ms - g.startMs) / (g.endMs - g.startMs)) * 100;
const clampPct = (n: number): number => Math.min(100, Math.max(0, n));

/**
 * The duty chart of one day: an axis in whole even hours that holds every block and the limit, bars in percent of it, the part of a flight past the limit apart (it is drawn red), and the "now" and "limit" markers when they fall inside.
 * `limitAt` is the latest end of duty; null when the member is not on duty.
 */
export function ganttOf(blocks: readonly DutyBlock[], limitAt: number | null, now: number, minHours = 6): Gantt {
  const first = Math.min(...blocks.map((b) => b.start));
  const last = Math.max(...blocks.map((b) => b.end), limitAt ?? 0);
  if (blocks.length === 0) return { startMs: now, endMs: now + minHours * HOUR_MS, ticks: [], bars: [], nowPct: null, limitPct: null };
  const startMs = Math.floor(first / (2 * HOUR_MS)) * 2 * HOUR_MS;
  const endMs = Math.max(Math.ceil(last / (2 * HOUR_MS)) * 2 * HOUR_MS, startMs + minHours * HOUR_MS);
  const g = { startMs, endMs };
  const ticks: Gantt['ticks'] = [];
  for (let at = startMs; at <= endMs; at += 2 * HOUR_MS) ticks.push({ label: `${String(new Date(at).getUTCHours()).padStart(2, '0')}:00`, pct: pct(at, g) });
  const bars = [...blocks].sort((a, b) => a.start - b.start).map((block): GanttBar => {
    const overFrom = limitAt !== null && block.kind === 'flight' && block.end > limitAt ? Math.max(block.start, limitAt) : null;
    return { block, left: clampPct(pct(block.start, g)), width: clampPct(pct(block.end, g)) - clampPct(pct(block.start, g)), over: overFrom === null ? null : { left: clampPct(pct(overFrom, g)), width: clampPct(pct(block.end, g)) - clampPct(pct(overFrom, g)) } };
  });
  const inside = (ms: number | null): number | null => (ms !== null && ms >= startMs && ms <= endMs ? pct(ms, g) : null);
  return { startMs, endMs, ticks, bars, nowPct: inside(now), limitPct: inside(limitAt) };
}

export type DayBar = { day: string; kind: DutyDay['kind']; hours: number; planned: number; height: number; plannedHeight: number; tone: Tone };
/** The seven-day bars: heights against the daily duty limit; the heaviest closed days go amber. */
export function dayBars(days: readonly DutyDay[], limitHours: number): DayBar[] {
  const h = (hours: number): number => (limitHours > 0 ? Math.min(1, Math.max(0, hours / limitHours)) : 0);
  return days.map((d) => {
    const hours = d.hours ?? 0, planned = d.plannedHours ?? 0;
    return { day: d.day, kind: d.kind, hours, planned, height: h(hours), plannedHeight: h(planned), tone: d.kind === 'duty' && hours / limitHours >= NEAR_LIMIT ? 'warn' : 'ok' };
  });
}
export const restDays = (days: readonly DutyDay[]): number => days.filter((d) => d.kind === 'rest').length;

export type MedicalState = { tone: Tone; days: number };
/** Medical validity: amber under 30 days, red when it has lapsed. */
export const MEDICAL_WARN_DAYS = 30;
export const medicalState = (days: number): MedicalState => ({ days, tone: days < 0 ? 'bad' : days < MEDICAL_WARN_DAYS ? 'warn' : 'ok' });

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
  const a = f.format(Date.parse(`${cols[0]!.iso}T12:00:00Z`)), b = f.format(Date.parse(`${cols[cols.length - 1]!.iso}T12:00:00Z`));
  return a === b ? a : `${a} → ${b}`;
}

const SEVERITY: Record<Coverage, number> = { ok: 0, tight: 1, short: 2, none: 3 };
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
/** Families that have nobody qualified at all (every day `none`): "aucun pilote CRJ". */
export const emptyFamilies = (rows: readonly Pick<CoverageRow, 'label' | 'days'>[]): string[] => rows.filter((r) => r.days.length > 0 && r.days.every((c) => c === 'none')).map((r) => r.label);
export const worst = (cells: readonly Coverage[]): Coverage => cells.reduce<Coverage>((w, c) => (SEVERITY[c] > SEVERITY[w] ? c : w), 'ok');

/** The alert the server wrote for a cell, if it did. */
export const alertAt = (alerts: readonly CoverageAlert[], row: Pick<CoverageRow, 'family'>, iso: string): CoverageAlert | null => alerts.find((a) => a.family === row.family && a.day === iso) ?? null;

export type PolicyPreview = { extraHeadcount: number; payrollDelta: number; fatigueFrom: number; fatigueTo: number; riskPct: number };
/** What switching to `chosen` would change; null when it is the policy in force (nothing to preview). */
export function policyPreview(current: RestPolicy, chosen: PolicyOption, avgFatigue: number): PolicyPreview | null {
  if (chosen.id === current) return null;
  return { extraHeadcount: chosen.extraHeadcount, payrollDelta: chosen.payrollDelta, fatigueFrom: Math.round(avgFatigue), fatigueTo: Math.round(chosen.fatigueAfter), riskPct: Math.round(chosen.riskDelta * 100) };
}

/** A request is decided when it is no longer pending; only pending ones show buttons. */
export const pendingRequests = <T extends { status: string }>(requests: readonly T[]): T[] => requests.filter((r) => r.status === 'pending');
