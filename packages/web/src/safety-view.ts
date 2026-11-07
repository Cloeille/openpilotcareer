import { DUTY_MAX_MIN } from '@opc/shared';
import type { Incident, IncidentSeverity, Lever, SafetyScore, SafetyView, TodayFlight } from './api-safety.ts';
import { hashFor, stepRow } from './keys.ts';

/**
 * Pure view-models of the SAFETY screens: what a screen derives from the API's answers, testable without a DOM.
 * Strings are not made here: a view-model returns kinds and numbers, the screen translates them.
 */

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------- the index

/** A part of the index scoring under this share of its maximum is drawn amber (the mockup colours the fatigue part, 27 of 40, and not the aircraft's 29 of 40). */
export const WARN_BELOW = 0.7;
export type Tone = 'ok' | 'warn';

export const scoreTone = (s: SafetyScore): Tone => (s.max > 0 && s.points / s.max < WARN_BELOW ? 'warn' : 'ok');
/** Fill of a part's bar, 0..1. */
export const scoreFill = (s: SafetyScore): number => (s.max > 0 ? Math.min(1, Math.max(0, s.points / s.max)) : 0);
export const pointsLost = (s: SafetyScore): number => Math.max(0, Math.round(s.max - s.points));

export const overDutyLimit = (f: Pick<TodayFlight, 'dutyHours'>): boolean => f.dutyHours !== undefined && f.dutyHours * 60 > DUTY_MAX_MIN;

/** A flight carrying at least this many times the average risk is flagged in the status line (the duty factor alone reaches 2 at 11 h). */
export const RISKY_FACTOR = 2;
export type Headline = { kind: 'risky' | 'down' | 'up' | 'steady'; n: number; tone: Tone };
/** The status line under the breadcrumb: flights of tonight well above the average risk first, then where the index went in 7 days. */
export function headline(v: Pick<SafetyView, 'today' | 'delta7d'>): Headline {
  const risky = v.today.filter((f) => f.factor >= RISKY_FACTOR).length;
  if (risky > 0) return { kind: 'risky', n: risky, tone: 'warn' };
  const d = Math.round(v.delta7d);
  return d < 0 ? { kind: 'down', n: -d, tone: 'warn' } : d > 0 ? { kind: 'up', n: d, tone: 'ok' } : { kind: 'steady', n: 0, tone: 'ok' };
}

// ---------------------------------------------------------------- the risk curve

/** The chart's frame in SVG units (the mockup's 1032 x 250 chart: 972 px of plot from x = 40, 218 px high). */
export const CHART = { width: 1032, height: 250, left: 40, right: 1012, top: 6, bottom: 224, minHours: 14, minPct: 4 } as const;
/** A flight at or above this many times the average risk gets its label on the chart. */
export const NOTABLE_FACTOR = 1.5;
export const DUTY_LIMIT_HOURS = DUTY_MAX_MIN / 60;

export type ChartFlight = { x: number; y: number; flight: TodayFlight; over: boolean };
export type ChartModel = {
  xMax: number; yMaxPct: number;
  xTicks: { hours: number; x: number }[]; yTicks: { pct: number; y: number }[];
  limitX: number; curve: { x: number; y: number }[]; flights: ChartFlight[];
  /** The flight to annotate: the highest factor with duty hours known, when it is notable. */
  top: ChartFlight | null;
};

const finite = (n: number): boolean => Number.isFinite(n);

/** Maps hours of duty and a risk (a fraction) to the SVG plot. The axes grow with the data: 0..14 h and 0..4 % at least. */
export function chartOf(v: Pick<SafetyView, 'riskCurve' | 'today'>): ChartModel {
  const curve = v.riskCurve.filter((p) => finite(p.dutyHours) && finite(p.risk)).sort((a, b) => a.dutyHours - b.dutyHours);
  const flights = v.today.filter((f): f is TodayFlight & { dutyHours: number } => f.dutyHours !== undefined && finite(f.dutyHours) && finite(f.risk));
  const hoursMax = Math.max(CHART.minHours, ...curve.map((p) => p.dutyHours), ...flights.map((f) => f.dutyHours));
  const xMax = Math.ceil(hoursMax / 2) * 2;
  const rawPct = Math.max(CHART.minPct, Math.ceil(Math.max(0, ...curve.map((p) => p.risk), ...flights.map((f) => f.risk)) * 100 - 1e-9));
  const step = rawPct <= 6 ? 1 : rawPct <= 12 ? 2 : 5;
  const yMaxPct = Math.ceil(rawPct / step) * step;
  const x = (hours: number): number => CHART.left + (hours / xMax) * (CHART.right - CHART.left);
  const y = (risk: number): number => CHART.bottom - ((risk * 100) / yMaxPct) * (CHART.bottom - CHART.top);
  const dots: ChartFlight[] = flights.map((f) => ({ x: x(f.dutyHours), y: y(f.risk), flight: f, over: overDutyLimit(f) }));
  const worst = [...dots].sort((a, b) => b.flight.factor - a.flight.factor || b.flight.risk - a.flight.risk)[0] ?? null;
  return {
    xMax, yMaxPct,
    xTicks: Array.from({ length: xMax / 2 + 1 }, (_, i) => ({ hours: i * 2, x: x(i * 2) })),
    yTicks: Array.from({ length: yMaxPct / step + 1 }, (_, i) => ({ pct: i * step, y: y((i * step) / 100) })),
    limitX: x(DUTY_LIMIT_HOURS),
    curve: curve.map((p) => ({ x: x(p.dutyHours), y: y(p.risk) })),
    flights: dots,
    top: worst && worst.flight.factor >= NOTABLE_FACTOR ? worst : null,
  };
}

/** `M x y L x y ...` for a polyline of chart points (empty for fewer than two). */
export const pathOf = (pts: readonly { x: number; y: number }[]): string => (pts.length < 2 ? '' : pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '));

// ---------------------------------------------------------------- levers ("ce qui pèse aujourd'hui")

/**
 * Where a lever's button leads. `crew`: the member's sheet, which holds the replacement; `leave`: the leave planner;
 * `maintenance`: the fleet (nothing in v3 before lot PARTS can book a service; its `#wear/<aircraftId>` becomes the target then).
 */
export function leverHash(l: Pick<Lever, 'action' | 'ref'>): string {
  switch (l.action) {
    case 'crew': return hashFor('staff', l.ref);
    case 'leave': return '#staff/leave';
    case 'maintenance': return hashFor('wear', l.ref);
  }
}

/** The "up to +10 points" of the mockup: what every lever together would add, never past 100. */
export const leversTotal = (levers: readonly Pick<Lever, 'points'>[], index: number): number =>
  Math.min(Math.max(0, 100 - Math.round(index)), levers.reduce((n, l) => n + Math.max(0, l.points), 0));

// ---------------------------------------------------------------- incidents

export const SEVERITIES: readonly IncidentSeverity[] = ['minor', 'serious', 'grave'];

/** Newest first. */
export const newestFirst = (incidents: readonly Incident[]): Incident[] => [...incidents].sort((a, b) => b.at - a.at || b.id - a.id);

/** Money of a list of incidents, as the season block of `GET /safety` defines it: borne = total - covered. */
export const seasonTotals = (incidents: readonly Incident[]): { total: number; covered: number; borne: number } => {
  const total = incidents.reduce((n, i) => n + i.cost, 0);
  const covered = incidents.reduce((n, i) => n + Math.min(i.covered, i.cost), 0);
  return { total, covered, borne: total - covered };
};

export type IncidentFacts = {
  cost: number; insured: 'none' | 'part' | 'all'; covered: number;
  /** Whole days the aircraft stays in the workshop; null when it does not. */
  downtimeDays: number | null;
  /** A grave incident with no end date: the aircraft stays on the ground until the player decides. */
  grounded: boolean;
  reputation: number;
};
export function incidentFacts(i: Incident): IncidentFacts {
  const days = i.downtimeUntil === null ? 0 : Math.max(0, Math.ceil((i.downtimeUntil - i.at) / DAY_MS));
  return {
    cost: i.cost, covered: i.covered, insured: i.covered <= 0 || i.cost <= 0 ? 'none' : i.covered >= i.cost ? 'all' : 'part',
    downtimeDays: days > 0 ? days : null, grounded: i.downtimeUntil === null && i.severity === 'grave', reputation: i.reputationDelta,
  };
}

/** The registration of an aircraft, `#12` for one the company has since sold or handed back. */
export const registrationOf = (fleet: readonly { id: number; registration: string }[], aircraftId: number): string => fleet.find((a) => a.id === aircraftId)?.registration ?? `#${aircraftId}`;

/** `2026-12` from `2026-12`, `2026-12-01` or an ISO instant; null for anything else. */
export const insuranceMonth = (from: string | null): string | null => {
  const m = from === null ? null : /^(\d{4})-(\d{2})/.exec(from);
  return m ? `${m[1]}-${m[2]}` : null;
};

// ---------------------------------------------------------------- the journal's seasons

/** Seasons are UTC calendar months (`2026-11`). The journal offers the latest six, oldest to newest left to right, so the arrow keys read as earlier / later. */
export const SEASON_CHIPS = 6;
export function recentSeasons(now: number, n = SEASON_CHIPS): string[] {
  const d = new Date(now);
  let y = d.getUTCFullYear();
  let m = d.getUTCMonth();
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.unshift(`${y}-${String(m + 1).padStart(2, '0')}`);
    if (--m < 0) { m = 11; y--; }
  }
  return out;
}
/** The season an arrow key leads to; stays on the same one at the ends. */
export function stepSeason(chips: readonly string[], current: string, dir: 1 | -1): string {
  const i = stepRow(chips.length, chips.indexOf(current), dir);
  return chips[i] ?? current;
}
