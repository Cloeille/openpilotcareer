// Lot STAFF (v3): read models of the staff screens (docs/v3-plan.md B.3). Nothing here writes except `syncLeaveRequests`, which materialises the leave requests
// people file (deterministically per person and month) so the player has something to decide.
import {
  DAY_MS, DUTY_MAX_MIN, FIRING_MONTHS, FLIGHT_MAX_28D_MIN, LEAVE_ASK_RATE, LEAVE_DAYS_PER_YEAR, REST_POLICIES, REST_POLICY_NAMES, STAFF_FAMILIES, coverageOf, dayIso, dayNo,
  ROLE_INSTRUCTOR, ageAt, dutyViolation, flies, isoDayNo, paidSalary, retirementAt, yearOfDay,
  type Arrival, type Blocker, type Candidate, type CandidatesView, type Coverage, type DutyBlock, type FamilyRow, type LeaveRequest, type LeaveView, type PolicyOption, type Qualification,
  type StaffDetail, type StaffFamily, type StaffMember, type StaffOverview, type WatchItem,
  type SORTS,
} from '@opc/shared';

type Sort = (typeof SORTS)[number];
import { hashSeed, mulberry32 } from './board.ts';
import { all, get, run, type Db } from './db.ts';
import { typeFor } from './game.ts';
import { HttpError } from './http.ts';
import { payAt } from './hr.ts';
import { companyCode } from './lines.ts';
import { companyDemand, countOf } from './staff-needs.ts';
import { market } from './staff-people.ts';
import { dutyFacts, dutyInput, policyOf, positionOf, rosterOf, rulesOf, stateOf, type StaffRow } from './staff.ts';

const FAMILY_LABEL: Record<StaffFamily, string> = { pilot: 'Pilots', cabin: 'Cabin crew', ground: 'Ground staff', admin: 'Administration', maintenance: 'Maintenance', kitchen: 'Kitchen' };

const qualsOf = (db: Db, id: number): { type_icao: string; valid_from: number; valid_until: number | null }[] =>
  all(db, 'SELECT type_icao, valid_from, valid_until FROM staff_quals WHERE staff_id = ? ORDER BY type_icao', id);

export function memberView(db: Db, s: StaffRow, now: number): StaffMember {
  return {
    id: s.id, family: s.family, name: s.name, role: s.role, base: s.base, hiredAt: s.hired_at, startsAt: s.starts_at, endsAt: s.ends_at, salary: s.salary, reliability: s.reliability, morale: s.morale,
    experience: s.experience, contract: s.contract, noticeDays: s.notice_days, state: stateOf(db, s, now, rulesOf(db, s.company_id)), quals: qualsOf(db, s.id).map((q) => q.type_icao),
    age: ageAt(s.birth_year, now), retiresAt: retirementAt(s.birth_year, s.role),
  };
}

// ---------------------------------------------------------------- overview

const emptyAvailability = () => ({ onDuty: 0, resting: 0, leave: 0, training: 0, free: 0, pending: 0, vacant: 0 });

/** The roster is everyone employed or in notice. `headcount` is who works now (what the crew check can use); a hire in notice already fills a post, so it leaves `vacant` and is listed in `arriving`. */
export function overview(db: Db, companyId: number, now: number, base?: string, family?: StaffFamily): StaffOverview {
  const rules = rulesOf(db, companyId);
  const demand = companyDemand(db, companyId, rules).filter((d) => !base || d.base === base);
  const roster = rosterOf(db, companyId, now).filter((s) => !base || s.base === base).filter((s) => !family || s.family === family);
  const states = new Map(roster.map((s) => [s.id, stateOf(db, s, now, rules)]));
  const hereNow = roster.filter((s) => states.get(s.id) !== 'pending');
  const row = (fam: StaffFamily, people: StaffRow[], need: number, type?: string): FamilyRow => {
    const availability = emptyAvailability();
    for (const s of people) { const st = states.get(s.id)!; if (st !== 'left') availability[st]++; }
    const headcount = people.length - availability.pending;
    availability.vacant = Math.max(0, need - headcount - availability.pending);
    const arriving = people.filter((s) => states.get(s.id) === 'pending').sort((a, b) => a.starts_at - b.starts_at || a.id - b.id).map((s): Arrival => ({ id: s.id, name: s.name, role: s.role, startsAt: s.starts_at }));
    return {
      family: fam, label: type ?? FAMILY_LABEL[fam], ...(type ? { type } : {}), headcount, need, availability, arriving, salaries: people.filter((s) => states.get(s.id) !== 'pending').reduce((t, s) => t + s.salary, 0),
      note: availability.vacant > 0 ? `${availability.vacant} vacant` : null,
    };
  };
  const families: FamilyRow[] = [];
  for (const fam of STAFF_FAMILIES) {
    if (family && fam !== family) continue;
    const people = roster.filter((s) => s.family === fam && (fam !== 'pilot' || s.role !== ROLE_INSTRUCTOR));
    const need = countOf(demand, fam);
    if (people.length === 0 && need === 0) continue;
    const r = row(fam, people, need);
    if (fam === 'pilot') {
      const types = [...new Set([...demand.filter((d) => d.family === 'pilot').map((d) => d.type!), ...people.flatMap((s) => qualsOf(db, s.id).map((q) => q.type_icao))])].sort();
      r.children = types.map((t) => row(fam, people.filter((s) => qualsOf(db, s.id).some((q) => q.type_icao === t)), countOf(demand, 'pilot', t), t));
    }
    families.push(r);
  }
  return {
    people: hereNow.length, pending: roster.length - hereNow.length, positions: demand.reduce((n, d) => n + d.count, 0), payroll: hereNow.filter((s) => s.contract === 'cdi').reduce((t, s) => t + paidSalary(s.salary, payAt(db, companyId)), 0), policy: policyOf(db, companyId),
    families, blockers: blockersToday(db, companyId, now), watch: watchList(db, hereNow, now),
  };
}

/** Today's flights the engine cancelled for want of crew, by what ran short and the aircraft type. */
function blockersToday(db: Db, companyId: number, now: number): Blocker[] {
  return all<{ cancel_cause: 'no_crew' | 'duty_limit'; crew_family: 'pilot' | 'cabin' | null; icao: string; n: number }>(db,
    `SELECT f.cancel_cause, f.crew_family, a.icao, COUNT(*) AS n FROM scheduled_flights f JOIN aircraft a ON a.id = f.aircraft_id
     WHERE f.company_id = ? AND f.status = 'cancelled' AND f.cancel_cause IN ('no_crew','duty_limit') AND f.dep_at >= ? AND f.dep_at < ? GROUP BY f.cancel_cause, f.crew_family, a.icao ORDER BY n DESC, a.icao`,
    companyId, Math.floor(now / DAY_MS) * DAY_MS, Math.floor(now / DAY_MS) * DAY_MS + DAY_MS).map((r) => ({ kind: r.cancel_cause, family: r.crew_family, type: r.icao, flights: r.n }));
}

const FATIGUE_WATCH = 50;
function watchList(db: Db, people: StaffRow[], now: number): WatchItem[] {
  const out: WatchItem[] = [];
  for (const s of people) {
    if (!flies(s)) continue;
    const f = dutyFacts(db, s, now);
    if (f.fatigue >= FATIGUE_WATCH) out.push({ staffId: s.id, name: s.name, family: s.family, reason: 'fatigue', value: f.fatigue, detail: `fatigue ${f.fatigue}%` });
    else if (f.flight28Min > FLIGHT_MAX_28D_MIN * 0.85) out.push({ staffId: s.id, name: s.name, family: s.family, reason: 'duty', value: Math.round(f.flight28Min / 60), detail: `${Math.round(f.flight28Min / 60)} h of 100 h in 28 days` });
  }
  return out.sort((a, b) => b.value - a.value).slice(0, 8);
}

// ---------------------------------------------------------------- one person

export function detail(db: Db, s: StaffRow, now: number): StaffDetail {
  const rules = rulesOf(db, s.company_id);
  const code = companyCode(db, s.company_id);
  const f = dutyFacts(db, s, now);
  const state = stateOf(db, s, now, rules);
  const dutyEndsAt = f.dutyStart !== null && state === 'onDuty' ? f.dutyStart + DUTY_MAX_MIN * 60_000 : null;
  const today = dayNo(now);
  const week = all<{ flight_no: number; dep_at: number; arr_at: number; origin: string; dest: string }>(db, 'SELECT flight_no, dep_at, arr_at, origin, dest FROM staff_duty WHERE staff_id = ? AND dep_at >= ? AND dep_at < ? ORDER BY dep_at',
    s.id, (today - 3) * DAY_MS, (today + 4) * DAY_MS).map((r): DutyBlock => ({ flightNo: `${code} ${r.flight_no}`, dep: r.dep_at, arr: r.arr_at, origin: r.origin, dest: r.dest }));
  const dutyByDay = new Map(all<{ day: number; m: number }>(db, 'SELECT day, SUM(duty_min) AS m FROM staff_duty WHERE staff_id = ? AND day > ? AND day <= ? GROUP BY day', s.id, today - 7, today).map((r) => [r.day, r.m]));
  const nextLeave = get<{ from_day: number; to_day: number }>(db, "SELECT from_day, to_day FROM staff_leave WHERE staff_id = ? AND status = 'granted' AND kind = 'leave' AND to_day >= ? ORDER BY from_day LIMIT 1", s.id, today);
  const released = f.lastEnd === null ? null : f.lastEnd + 15 * 60_000;
  const quals: Qualification[] = qualsOf(db, s.id).map((q) => ({ type: q.type_icao, name: typeFor(db, s.company_id, q.type_icao).name, validFrom: q.valid_from, validUntil: q.valid_until, inTraining: q.valid_from > now }));
  const started = Math.max(s.starts_at, s.hired_at);
  return {
    member: memberView(db, s, now),
    duty: {
      dutyMin: state === 'onDuty' && f.dutyStart !== null ? Math.round((now - f.dutyStart) / 60_000) : 0, limitMin: DUTY_MAX_MIN, endsAt: dutyEndsAt,
      restHours: released !== null && state !== 'onDuty' ? Math.round(((now - released) / 3_600_000) * 10) / 10 : 0,
      flight28d: Math.round((f.flight28Min / 60) * 10) / 10, flight12m: Math.round((f.flight12Min / 60) * 10) / 10, fatigue: f.fatigue,
      // medical certificates last 12 months from the start and are renewed on their anniversary at no cost: this is the time to the next renewal
      medicalDays: Math.ceil((started + (Math.floor(Math.max(0, now - started) / (365 * DAY_MS)) + 1) * 365 * DAY_MS - now) / DAY_MS),
    },
    week,
    last7d: Array.from({ length: 7 }, (_, i) => {
      const day = today - 6 + i, m = dutyByDay.get(day);
      return { day: dayIso(day), hours: m === undefined ? null : Math.round((m / 60) * 10) / 10, kind: m === undefined ? 'rest' as const : 'duty' as const };
    }),
    quals,
    contract: { kind: s.contract, salary: s.salary, noticeDays: s.notice_days, firingCost: s.starts_at > now ? 0 : s.salary * FIRING_MONTHS, endsAt: s.ends_at },
    nextLeave: nextLeave ? { from: dayIso(nextLeave.from_day), to: dayIso(nextLeave.to_day) } : null,
    alert: alertFor(db, s, now),
  };
}

/** The first of the next scheduled flights this person could fly (at their position, rated) that they could NOT fly legally: which rule and by how much. */
function alertFor(db: Db, s: StaffRow, now: number): StaffDetail['alert'] {
  if (s.starts_at > now || (s.ends_at !== null && s.ends_at <= now) || !flies(s)) return null;
  const rules = rulesOf(db, s.company_id), code = companyCode(db, s.company_id);
  const rated = new Set(qualsOf(db, s.id).map((q) => q.type_icao));
  const legs = all<{ flight_no: number; dep_at: number; arr_at: number; origin: string; dest: string; icao: string }>(db,
    `SELECT f.flight_no, f.dep_at, f.arr_at, f.origin, f.dest, a.icao FROM scheduled_flights f JOIN aircraft a ON a.id = f.aircraft_id
     WHERE f.company_id = ? AND f.status = 'scheduled' AND f.dep_at > ? AND f.dep_at < ? ORDER BY f.dep_at LIMIT 12`, s.company_id, now, now + DAY_MS);
  const i = dutyInput(db, s, now);
  for (const l of legs) {
    if (s.family === 'pilot' && !rated.has(l.icao)) continue;
    if (positionOf(s, i, l.dep_at) !== l.origin) continue;
    const v = dutyViolation(i, { dep: l.dep_at, arr: l.arr_at }, rules);
    if (v) return { flightNo: `${code} ${l.flight_no}`, overBy: Math.round(v.overBy), rule: v.rule };
  }
  return null;
}

// ---------------------------------------------------------------- recruitment

const SORT_KEY: Record<Sort, (c: Candidate) => number> = {
  experience: (c) => -c.experience, reliability: (c) => -c.reliability, morale: (c) => -c.morale, salary: (c) => c.askingSalary,
};
const MAX_LISTED = 60;

export function candidates(db: Db, companyId: number, now: number, f: { family?: StaffFamily | undefined; base?: string | undefined; qual?: string | undefined; sort?: Sort | undefined }): CandidatesView {
  const all_ = market(db, companyId, now, f);
  const list = [...all_].sort((a, b) => SORT_KEY[f.sort ?? 'experience'](a) - SORT_KEY[f.sort ?? 'experience'](b) || a.id.localeCompare(b.id));
  return { market: all_.length, candidates: list.slice(0, MAX_LISTED), suggestion: vacancy(db, companyId, now) };
}

/** The biggest vacancy of the company, as "N x label" for the recruitment panel; null when everything is staffed. */
export function vacancy(db: Db, companyId: number, now: number): { count: number; label: string } | null {
  const roster = rosterOf(db, companyId, now);
  let best: { count: number; label: string } | null = null;
  for (const sl of companyDemand(db, companyId, rulesOf(db, companyId))) {
    const have = roster.filter((r) => r.family === sl.family && r.role !== ROLE_INSTRUCTOR && r.base === sl.base && (sl.type === null || qualsOf(db, r.id).some((q) => q.type_icao === sl.type))).length;
    if (sl.count - have > (best?.count ?? 0)) best = { count: sl.count - have, label: `${sl.family}${sl.type ? ` ${sl.type}` : ''} ${sl.base}` };
  }
  return best;
}

// ---------------------------------------------------------------- leave and rest

const monthStartDay = (y: number, m: number): number => dayNo(Date.UTC(y, m, 1));

/** Materialise the leave requests people file: each employee asks in a given month with probability LEAVE_ASK_RATE (a fixed draw per person and month), for 3 to 10 days
 *  starting between the 4th and the 25th. Only for the current month and the next two; days already past expire as refused. Idempotent by the unique key. */
export function syncLeaveRequests(db: Db, companyId: number, now: number): void {
  const today = dayNo(now);
  run(db, "UPDATE staff_leave SET status = 'refused' WHERE status = 'pending' AND from_day <= ? AND staff_id IN (SELECT id FROM staff WHERE company_id = ?)", today, companyId);
  const d = new Date(now);
  for (const s of rosterOf(db, companyId, now)) {
    if (s.contract !== 'cdi' || s.starts_at > now) continue;
    for (let k = 0; k < 3; k++) {
      const y = d.getUTCFullYear(), m = d.getUTCMonth() + k;
      const rand = mulberry32(hashSeed(`leave:${s.id}:${y}:${m}`));
      if (rand() >= LEAVE_ASK_RATE) continue;
      const days = 3 + Math.floor(rand() * 8);
      const from = monthStartDay(y, m) + 3 + Math.floor(rand() * 22);
      if (from <= today) continue;
      run(db, "INSERT INTO staff_leave (staff_id, from_day, to_day, status, kind) VALUES (?, ?, ?, 'pending', 'leave') ON CONFLICT DO NOTHING", s.id, from, from + days - 1);
    }
  }
}

/** People of the family on the payroll on `day` and not away on granted leave, rest or training. */
function availableOn(db: Db, companyId: number, family: StaffFamily, day: number, now: number): number {
  const at = Math.max(now, day * DAY_MS);
  return get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM staff s WHERE s.company_id = ? AND s.family = ? AND s.starts_at <= ? AND (s.ends_at IS NULL OR s.ends_at > ?)
    AND NOT EXISTS (SELECT 1 FROM staff_leave l WHERE l.staff_id = s.id AND l.status = 'granted' AND l.from_day <= ? AND l.to_day >= ?)`, companyId, family, at, at, day, day)!.n;
}

const daysBetween = (a: number, b: number): number => b - a + 1;

function impactOf(db: Db, companyId: number, family: StaffFamily, req: { id: number; staff_id: number; from_day: number; to_day: number }, positions: number, now: number): LeaveRequest['impact'] {
  let worst: { before: Coverage; after: Coverage; day: number } | null = null;
  const rank: Record<Coverage, number> = { ok: 0, tight: 1, short: 2, none: 3 };
  for (let day = req.from_day; day <= req.to_day; day++) {
    const have = availableOn(db, companyId, family, day, now);
    const before = coverageOf(have, positions), after = coverageOf(have - 1, positions);
    if (!worst || rank[after] > rank[worst.after]) worst = { before, after, day };
  }
  return worst ? { before: worst.before, after: worst.after, worstDay: dayIso(worst.day) } : null;
}

export function leaveView(db: Db, companyId: number, now: number, fromIso?: string, span = 60): LeaveView {
  syncLeaveRequests(db, companyId, now);
  const rules = rulesOf(db, companyId), policy = policyOf(db, companyId);
  const roster = rosterOf(db, companyId, now).filter((s) => s.starts_at <= now);
  const demand = companyDemand(db, companyId, rules);
  const from = fromIso ? isoDayNo(fromIso) : dayNo(now);
  const year = yearOfDay(dayNo(now));
  const usedLeave = (id: number): number => all<{ from_day: number; to_day: number }>(db, "SELECT from_day, to_day FROM staff_leave WHERE staff_id = ? AND status = 'granted' AND kind = 'leave'", id)
    .filter((l) => yearOfDay(l.from_day) === year).reduce((n, l) => n + daysBetween(l.from_day, l.to_day), 0);
  const coverage = STAFF_FAMILIES.filter((fam) => roster.some((s) => s.family === fam) || countOf(demand, fam) > 0).map((fam) => {
    const positions = countOf(demand, fam);
    return { family: fam, label: FAMILY_LABEL[fam], headcount: roster.filter((s) => s.family === fam).length, perDay: positions, days: Array.from({ length: span }, (_, i) => coverageOf(availableOn(db, companyId, fam, from + i, now), positions)) };
  });
  const states = roster.map((s) => ({ s, st: stateOf(db, s, now, rules) }));
  const flyers = roster.filter(flies);
  const fatigues = flyers.map((s) => dutyFacts(db, s, now).fatigue);
  const names = new Map(roster.map((s) => [s.id, s]));
  const requests = all<{ id: number; staff_id: number; from_day: number; to_day: number; status: 'pending' | 'granted' | 'refused'; kind: 'leave' | 'rest' | 'training' }>(db,
    "SELECT l.* FROM staff_leave l JOIN staff s ON s.id = l.staff_id WHERE s.company_id = ? AND l.kind = 'leave' AND l.to_day >= ? ORDER BY l.from_day, l.id", companyId, dayNo(now))
    .map((r): LeaveRequest => {
      const p = names.get(r.staff_id) ?? get<StaffRow>(db, 'SELECT * FROM staff WHERE id = ?', r.staff_id)!;
      return { id: r.id, staffId: r.staff_id, name: p.name, family: p.family, from: dayIso(r.from_day), to: dayIso(r.to_day), days: daysBetween(r.from_day, r.to_day), status: r.status, kind: r.kind,
        impact: r.status === 'pending' ? impactOf(db, companyId, p.family, r, countOf(demand, p.family), now) : null };
    });
  return {
    balance: roster.filter((s) => s.contract === 'cdi').reduce((n, s) => n + Math.max(0, LEAVE_DAYS_PER_YEAR - usedLeave(s.id)), 0),
    resting: states.filter((x) => x.st === 'resting' || x.st === 'leave').length, restingPilots: states.filter((x) => x.s.family === 'pilot' && (x.st === 'resting' || x.st === 'leave')).length,
    avgFatigue: fatigues.length === 0 ? 0 : Math.round(fatigues.reduce((a, b) => a + b, 0) / fatigues.length),
    coverage, alerts: coverage.flatMap((c) => { const i = c.days.findIndex((d) => d === 'short' || d === 'none'); return i < 0 ? [] : [{ family: c.family, day: dayIso(from + i), coverage: c.days[i]! }]; }),
    from: dayIso(from), requests, policy, policies: policyOptions(db, companyId, roster),
  };
}

function policyOptions(db: Db, companyId: number, roster: StaffRow[]): PolicyOption[] {
  const people = (fam: StaffFamily) => roster.filter((s) => s.family === fam);
  const mean = (fam: StaffFamily) => (people(fam).length === 0 ? 0 : people(fam).reduce((t, s) => t + s.salary, 0) / people(fam).length);
  const base = (policy: keyof typeof REST_POLICIES) => {
    const demand = companyDemand(db, companyId, REST_POLICIES[policy]);
    return { pilots: countOf(demand, 'pilot'), cabin: countOf(demand, 'cabin') };
  };
  const legal = base('legal');
  return REST_POLICY_NAMES.map((policy) => {
    const r = REST_POLICIES[policy], b = base(policy);
    return { policy, restBaseH: r.restBaseH, restAwayH: r.restAwayH, extraHeadcount: b.pilots - legal.pilots + b.cabin - legal.cabin,
      payrollDelta: Math.round((b.pilots - legal.pilots) * mean('pilot') + (b.cabin - legal.cabin) * mean('cabin')), riskFactor: r.riskFactor };
  });
}

/** Grant or refuse a request (the requests of the player's own people only). A grant is checked against the person's leave balance for the year. */
export function decideLeave(db: Db, companyId: number, id: number, decision: 'grant' | 'refuse', now: number): void {
  const r = get<{ id: number; staff_id: number; from_day: number; to_day: number; status: string; kind: string }>(db,
    'SELECT l.* FROM staff_leave l JOIN staff s ON s.id = l.staff_id WHERE l.id = ? AND s.company_id = ?', id, companyId);
  if (!r || r.kind !== 'leave') throw new HttpError(404, 'request_not_found', 'no such leave request');
  if (r.status !== 'pending') throw new HttpError(409, 'already_decided', `this request is already ${r.status}`);
  if (r.from_day <= dayNo(now)) throw new HttpError(409, 'request_expired', 'this request starts today or earlier');
  if (decision === 'grant') {
    const year = yearOfDay(r.from_day);
    const used = all<{ from_day: number; to_day: number }>(db, "SELECT from_day, to_day FROM staff_leave WHERE staff_id = ? AND status = 'granted' AND kind = 'leave'", r.staff_id)
      .filter((l) => yearOfDay(l.from_day) === year).reduce((n, l) => n + daysBetween(l.from_day, l.to_day), 0);
    if (used + daysBetween(r.from_day, r.to_day) > LEAVE_DAYS_PER_YEAR) throw new HttpError(409, 'leave_balance', `${LEAVE_DAYS_PER_YEAR - used} days of leave left this year`);
  }
  run(db, 'UPDATE staff_leave SET status = ? WHERE id = ?', decision === 'grant' ? 'granted' : 'refused', id);
}
