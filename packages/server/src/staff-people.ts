// Lot STAFF (v3): what the player does with her people: recruit, let go, train, transfer, rest, interim, the rest policy and the starter crew (C11).
// Domain operations: callers wrap them in `tx`. Money goes through game.ts `post`; a payment the balance cannot cover is 409 insufficient_funds (like finance.ts).
import {
  CAPTAIN_FROM_HOURS, DAY_MS, DEFAULT_NOTICE_DAYS, FIRING_MONTHS, HIRING_PREMIUM_MONTHS, MAX_INTERIM_DAYS, START_NOW_FEE, STAFF_FAMILIES, TRAINING_COURSE, ROLE_OF, dayNo, experienceFactor, interimPrice, salaryFor,
  type AircraftCategory, type Candidate, type FireResult, type InterimResult, type LineBridge, type LineStartNow, type RestPolicy, type StaffFamily, type StaffRole, type TrainResult,
} from '@opc/shared';
import { hashSeed, mulberry32 } from './board.ts';
import { assertSeat } from './facilities.ts';
import { all, get, run, type Db } from './db.ts';
import { balanceOf, post, snapshot, spend, spendable, typeFor } from './game.ts';
import { HttpError } from './http.ts';
import { companyDemand, demandOf, type DemandLine, type Slot } from './staff-needs.ts';
import { crewShortage, pendingHires, rosterOf, rulesOf, stateOf, type Shortage, type StaffRow } from './staff.ts';
import type { LineRow } from './lines.ts';

// ---------------------------------------------------------------- names

const FIRST = ['Camille', 'Lucas', 'Léa', 'Hugo', 'Manon', 'Louis', 'Chloé', 'Jules', 'Inès', 'Arthur', 'Sarah', 'Nathan', 'Emma', 'Théo', 'Julie', 'Antoine', 'Clara', 'Paul', 'Zoé', 'Maxime', 'Alice', 'Romain', 'Lina', 'Victor', 'Yasmine', 'Mathis', 'Éloïse', 'Samuel'];
const LAST = ['Lefèvre', 'Martin', 'Bernard', 'Dubois', 'Moreau', 'Laurent', 'Simon', 'Michel', 'Garcia', 'Roux', 'Fournier', 'Girard', 'Bonnet', 'Mercier', 'Blanc', 'Guérin', 'Faure', 'Rousseau', 'Perrin', 'Morel', 'Giraud', 'Andre', 'Lemoine', 'Chevalier', 'Marchand', 'Colin', 'Benoit', 'Renard'];
export const nameFrom = (rand: () => number): string => `${FIRST[Math.floor(rand() * FIRST.length)]} ${LAST[Math.floor(rand() * LAST.length)]}`;

// ---------------------------------------------------------------- shared helpers

/** Pay `amount` now or refuse with 409 insufficient_funds. */
export function pay(db: Db, companyId: number, at: number, kind: string, amount: number, memo: string): void {
  if (amount === 0) return;
  const available = spendable(db, companyId);
  if (available < amount) throw new HttpError(409, 'insufficient_funds', `needs ${amount - available} more`, { needed: amount, balance: balanceOf(db, companyId) });
  post(db, companyId, at, kind, -amount, memo);
  snapshot(db, companyId, at);
}

/** The airports where the company may employ people: its hubs and the bases of its aircraft. */
export const basesOf = (db: Db, companyId: number): string[] =>
  all<{ icao: string }>(db, `SELECT icao FROM hubs WHERE company_id = ? UNION SELECT base FROM aircraft WHERE company_id = ? AND returned_at IS NULL AND base IS NOT NULL ORDER BY 1`, companyId, companyId).map((r) => r.icao);

/** Aircraft types the company flies (candidates are listed for them). */
export const fleetTypes = (db: Db, companyId: number): string[] =>
  all<{ icao: string }>(db, 'SELECT DISTINCT icao FROM aircraft WHERE company_id = ? AND returned_at IS NULL ORDER BY icao', companyId).map((r) => r.icao);

export function ownedStaff(db: Db, companyId: number, id: number): StaffRow {
  const s = get<StaffRow>(db, 'SELECT * FROM staff WHERE id = ? AND company_id = ?', id, companyId);
  if (!s) throw new HttpError(404, 'staff_not_found', 'no such employee');
  return s;
}

export const categoryOf = (db: Db, companyId: number, qual: string | null): AircraftCategory | null => (qual ? typeFor(db, companyId, qual).category : null);
export const roleOf = (family: StaffFamily, experience: number): StaffRole => (family === 'pilot' ? (experience >= CAPTAIN_FROM_HOURS ? 'captain' : 'fo') : ROLE_OF[family]);

function insertStaff(db: Db, o: { companyId: number; family: StaffFamily; name: string; base: string; experience: number; reliability: number; morale: number; salary: number; hiredAt: number; startsAt: number;
  endsAt?: number | null; contract?: 'cdi' | 'cdd'; noticeDays?: number; candidateId?: string | null; qual?: string | null; qualUntil?: number | null }): number {
  const id = run(db, `INSERT INTO staff (company_id, family, name, role, base, hired_at, starts_at, ends_at, salary, experience, reliability, morale, contract, notice_days, candidate_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, o.companyId, o.family, o.name, roleOf(o.family, o.experience), o.base, o.hiredAt, o.startsAt, o.endsAt ?? null, o.salary, o.experience, o.reliability, o.morale,
    o.contract ?? 'cdi', o.noticeDays ?? DEFAULT_NOTICE_DAYS, o.candidateId ?? null).id;
  if (o.qual) run(db, 'INSERT INTO staff_quals (staff_id, type_icao, valid_from, valid_until) VALUES (?, ?, ?, ?)', id, o.qual, o.startsAt, o.qualUntil ?? null);
  return id;
}

// ---------------------------------------------------------------- the market: deterministic per company, per day, per base

const ID_RE = /^(\d+)\.([A-Z]{4})\.([a-z]+)\.([A-Z0-9]{2,4}|-)\.(\d+)$/;

/** 6 to 10 candidates for one (base, family, qualification) on one day. The same call always returns the same people (the `board.ts` approach). */
export function candidatesFor(db: Db, companyId: number, day: number, base: string, family: StaffFamily, qual: string | null): Candidate[] {
  const rand = mulberry32(hashSeed(`cand:${companyId}:${day}:${base}:${family}:${qual ?? '-'}`));
  const n = 6 + Math.floor(rand() * 5);
  const category = categoryOf(db, companyId, qual);
  const out: Candidate[] = [];
  for (let i = 0; i < n; i++) {
    const experience = family === 'pilot' ? Math.round(500 + rand() ** 2 * 11_500) : Math.round(rand() * 20);
    const role = roleOf(family, experience);
    const salary = salaryFor(family, role, experienceFactor(family, experience), category);
    out.push({
      id: `${day}.${base}.${family}.${qual ?? '-'}.${i}`, family, role, name: nameFrom(rand), base, qual, experience, reliability: 60 + Math.floor(rand() * 39), morale: 50 + Math.floor(rand() * 46),
      askingSalary: salary, noticeDays: DEFAULT_NOTICE_DAYS, premium: salary * HIRING_PREMIUM_MONTHS,
    });
  }
  return out;
}

/** Everyone on the market today at the company's bases (or `base`), for the filters given, minus those already hired. */
export function market(db: Db, companyId: number, now: number, f: { family?: StaffFamily | undefined; base?: string | undefined; qual?: string | undefined }): Candidate[] {
  const day = dayNo(now);
  const hired = new Set(all<{ candidate_id: string }>(db, 'SELECT candidate_id FROM staff WHERE company_id = ? AND candidate_id IS NOT NULL', companyId).map((r) => r.candidate_id));
  const bases = f.base ? [f.base] : basesOf(db, companyId);
  const types = f.qual ? [f.qual] : fleetTypes(db, companyId);
  const out: Candidate[] = [];
  for (const base of bases) {
    for (const family of f.family ? [f.family] : STAFF_FAMILIES) {
      for (const qual of family === 'pilot' ? types : [null]) out.push(...candidatesFor(db, companyId, day, base, family, qual));
    }
  }
  return out.filter((c) => !hired.has(c.id));
}

export const memberRow = (db: Db, id: number): StaffRow => get<StaffRow>(db, 'SELECT * FROM staff WHERE id = ?', id)!;

/** The one way a candidate becomes an employee, whoever found them (the market, the recruiter agency): a seat at the base, the fee paid now through `pay` (`fee.kind` on the ledger),
 *  then the person is on the roster and starts after their own notice. A pilot's qualification starts with him. */
export function engage(db: Db, companyId: number, c: Candidate, now: number, fee: { kind: string; amount: number; memo: string }): number {
  assertSeat(db, companyId, c.family, c.base, now);
  pay(db, companyId, now, fee.kind, fee.amount, fee.memo);
  return insertStaff(db, {
    companyId, family: c.family, name: c.name, base: c.base, experience: c.experience, reliability: c.reliability, morale: c.morale, salary: c.askingSalary, hiredAt: now, startsAt: now + c.noticeDays * DAY_MS,
    noticeDays: c.noticeDays, candidateId: c.id, qual: c.qual,
  });
}

/** Hire a candidate listed today or yesterday: one month's salary now as the hiring premium (C7), on the payroll from the first month after they start.
 *  `startAtOnce` also pays START_NOW_FEE: the person starts now instead of after the notice (one transaction, so a refused fee leaves no hire behind). */
export function hire(db: Db, companyId: number, candidateId: string, now: number, startAtOnce = false): { staffId: number; startsAt: number; premium: number } {
  const m = ID_RE.exec(candidateId);
  const day = m ? Number(m[1]) : NaN, today = dayNo(now);
  if (!m || day > today || day < today - 1 || !basesOf(db, companyId).includes(m[2]!)) throw new HttpError(404, 'candidate_not_found', 'this candidate is no longer on the market');
  const c = candidatesFor(db, companyId, day, m[2]!, m[3] as StaffFamily, m[4] === '-' ? null : m[4]!).find((x) => x.id === candidateId);
  // only what the market lists: a pilot for a type the company flies, nobody else with a type rating
  const listed = c && (STAFF_FAMILIES as readonly string[]).includes(c.family) && (c.family === 'pilot' ? c.qual !== null && fleetTypes(db, companyId).includes(c.qual) : c.qual === null);
  if (!c || !listed) throw new HttpError(404, 'candidate_not_found', 'this candidate is no longer on the market');
  if (get(db, 'SELECT 1 AS x FROM staff WHERE company_id = ? AND candidate_id = ?', companyId, c.id)) throw new HttpError(409, 'candidate_taken', 'you already hired this candidate');
  const staffId = engage(db, companyId, c, now, { kind: 'hire_premium', amount: c.premium, memo: `hiring premium ${c.name}` });
  if (startAtOnce) startNow(db, companyId, staffId, now);
  return { staffId, startsAt: startAtOnce ? now : now + c.noticeDays * DAY_MS, premium: c.premium };
}

/** Pay START_NOW_FEE and a hire still in notice starts now. His qualifications start with him (`valid_from` follows `starts_at`), so the crew check counts him on the very next leg.
 *  409 already_started / already_left; 402 insufficient_funds (the spending check of game.ts). */
export function startNow(db: Db, companyId: number, id: number, now: number): { staffId: number; fee: number; balanceAfter: number } {
  const s = ownedStaff(db, companyId, id);
  if (s.ends_at !== null && s.ends_at <= now) throw new HttpError(409, 'already_left', 'this person has already left');
  if (s.starts_at <= now) throw new HttpError(409, 'already_started', 'this person has already started');
  spend(db, companyId, now, 'start_now', START_NOW_FEE, `start now ${s.name}`);
  snapshot(db, companyId, now);
  run(db, 'UPDATE staff_quals SET valid_from = ? WHERE staff_id = ? AND valid_from = ?', now, id, s.starts_at);
  run(db, 'UPDATE staff SET starts_at = ? WHERE id = ?', now, id);
  return { staffId: id, fee: START_NOW_FEE, balanceAfter: balanceOf(db, companyId) };
}

// ---------------------------------------------------------------- letting go, training, transfer, rest, interim

/** C7: firing costs three months of salary, paid now, and takes the person off the payroll at once. A hire that has not started yet is cancelled for free (the premium is lost). */
export function fire(db: Db, companyId: number, id: number, now: number): FireResult {
  const s = ownedStaff(db, companyId, id);
  if (s.ends_at !== null && s.ends_at <= now) throw new HttpError(409, 'already_left', 'this person has already left');
  if (s.contract === 'cdd') throw new HttpError(409, 'temporary_contract', 'a temporary contract ends by itself');
  const severance = s.starts_at > now ? 0 : s.salary * FIRING_MONTHS;
  pay(db, companyId, now, 'severance', severance, `severance ${s.name}`);
  run(db, 'UPDATE staff SET ends_at = ? WHERE id = ?', now, id);
  return { severance, balanceAfter: balanceOf(db, companyId) };
}

const employedNow = (s: StaffRow, now: number): boolean => s.starts_at <= now && (s.ends_at === null || s.ends_at > now);

/** A type rating: the pilot is off the roster for the course (21 days and 24 000 euros for a jet airliner) and can fly the type from the day after. */
export function train(db: Db, companyId: number, id: number, type: string, now: number): TrainResult {
  const s = ownedStaff(db, companyId, id);
  if (s.family !== 'pilot') throw new HttpError(422, 'not_a_pilot', 'only pilots hold type ratings');
  if (!employedNow(s, now)) throw new HttpError(409, 'not_employed', 'this person is not on your payroll yet');
  if (get(db, 'SELECT 1 AS x FROM staff_quals WHERE staff_id = ? AND type_icao = ?', id, type)) throw new HttpError(409, 'already_qualified', `${s.name} already holds or is training for ${type}`);
  const course = TRAINING_COURSE[typeFor(db, companyId, type).category];
  pay(db, companyId, now, 'training', course.cost, `${type} type rating ${s.name}`);
  const until = now + course.days * DAY_MS;
  run(db, 'INSERT INTO staff_quals (staff_id, type_icao, valid_from, valid_until) VALUES (?, ?, ?, NULL)', id, type, until);
  run(db, "INSERT INTO staff_leave (staff_id, from_day, to_day, status, kind) VALUES (?, ?, ?, 'granted', 'training') ON CONFLICT DO NOTHING", id, dayNo(now), dayNo(until) - 1);
  return { member: null as never, cost: course.cost, days: course.days, until, balanceAfter: balanceOf(db, companyId) };
}

/** A new base: free, but the person is off for the day and the next one (travel and settling in), so a transfer cannot teleport a crew onto a flight. */
export function transfer(db: Db, companyId: number, id: number, base: string, now: number): StaffRow {
  const s = ownedStaff(db, companyId, id);
  if (!basesOf(db, companyId).includes(base)) throw new HttpError(422, 'not_a_base', `${base} is not one of your hubs or bases`);
  if (s.base === base) throw new HttpError(409, 'already_there', 'this person is already based there');
  assertSeat(db, companyId, s.family, base, now);
  if (!employedNow(s, now) && s.starts_at <= now) throw new HttpError(409, 'already_left', 'this person has left');
  if (stateOf(db, s, now, rulesOf(db, companyId)) === 'onDuty') throw new HttpError(409, 'on_duty', 'this person is flying now');
  run(db, 'UPDATE staff SET base = ? WHERE id = ?', base, id);
  run(db, "INSERT INTO staff_leave (staff_id, from_day, to_day, status, kind) VALUES (?, ?, ?, 'granted', 'rest') ON CONFLICT DO NOTHING", id, dayNo(now), dayNo(now) + 1);
  return memberRow(db, id);
}

/** Send the person home for the rest of today: they take no leg that touches today. */
export function rest(db: Db, companyId: number, id: number, now: number): StaffRow {
  const s = ownedStaff(db, companyId, id);
  if (!employedNow(s, now)) throw new HttpError(409, 'not_employed', 'this person is not on your payroll');
  run(db, "INSERT INTO staff_leave (staff_id, from_day, to_day, status, kind) VALUES (?, ?, ?, 'granted', 'rest') ON CONFLICT DO NOTHING", id, dayNo(now), dayNo(now));
  return memberRow(db, id);
}

/** A temporary hire who starts now, paid up front for the days booked; off the payroll when the contract ends. */
export function interim(db: Db, companyId: number, o: { family: StaffFamily; qual?: string | undefined; base?: string | undefined; days: number }, now: number): InterimResult & { staffId: number } {
  const bases = basesOf(db, companyId);
  const base = o.base ?? bases[0];
  if (!base || !bases.includes(base)) throw new HttpError(422, 'not_a_base', `${base ?? 'no airport'} is not one of your hubs or bases`);
  return bookInterim(db, companyId, { family: o.family, qual: o.qual ?? null, base, until: now + o.days * DAY_MS }, now);
}

/** What an interim of `family` (rated on `qual` for a pilot) costs until `until`: the days started are paid, at the price of `interimPrice`. */
function interimQuote(db: Db, companyId: number, family: StaffFamily, qual: string | null, until: number, now: number): { salary: number; experience: number; days: number; cost: number } {
  const experience = family === 'pilot' ? 3_500 : 8;
  const salary = salaryFor(family, roleOf(family, experience), experienceFactor(family, experience), categoryOf(db, companyId, qual));
  const days = Math.ceil((until - now) / DAY_MS);
  return { salary, experience, days, cost: interimPrice(salary, days) };
}

/** `index` tells the people of one booking apart (their names come from the same seed). The contract ends at `until` exactly: no gap with whoever replaces him, no day paid twice. */
function bookInterim(db: Db, companyId: number, o: { family: StaffFamily; qual: string | null; base: string; until: number; index?: number }, now: number): InterimResult & { staffId: number } {
  assertSeat(db, companyId, o.family, o.base, now);
  const { salary, experience, days, cost } = interimQuote(db, companyId, o.family, o.qual, o.until, now);
  const name = `${nameFrom(mulberry32(hashSeed(`interim:${companyId}:${now}:${o.family}:${o.qual ?? '-'}:${o.index ?? 0}`)))} (interim)`;
  pay(db, companyId, now, 'interim', cost, `${days} days of interim ${o.family}${o.qual ? ` ${o.qual}` : ''}`);
  const staffId = insertStaff(db, { companyId, family: o.family, name, base: o.base, experience, reliability: 75, morale: 70, salary, hiredAt: now, startsAt: now, endsAt: o.until, contract: 'cdd', noticeDays: 0, qual: o.family === 'pilot' ? o.qual : null, qualUntil: o.until });
  return { staffId, member: null as never, cost, endsAt: o.until, balanceAfter: balanceOf(db, companyId) };
}

export function setPolicy(db: Db, companyId: number, policy: RestPolicy): void {
  run(db, 'INSERT INTO staff_company (company_id, policy) VALUES (?, ?) ON CONFLICT (company_id) DO UPDATE SET policy = excluded.policy', companyId, policy);
}

// ---------------------------------------------------------------- a stopped line: recruit, interim bridge, start now (B.2 item 6)

const lineIcaos = (db: Db, lineId: number): string[] => all<{ icao: string }>(db, 'SELECT DISTINCT a.icao FROM line_aircraft la JOIN aircraft a ON a.id = la.aircraft_id WHERE la.line_id = ? AND a.returned_at IS NULL', lineId).map((r) => r.icao);
/** What the line lacks to fly now: the positions the three remedies below fill. Empty when the crew is complete. */
export const lineShortage = (db: Db, l: Pick<LineRow, 'id' | 'company_id' | 'a' | 'b'>, now: number): Shortage[] => crewShortage(db, l.company_id, lineIcaos(db, l.id), [l.a, l.b], now);
/** Where a line's people are employed: the line end that is one of the company's hubs or bases (else the first). */
export const lineBase = (db: Db, l: Pick<LineRow, 'company_id' | 'a' | 'b'>): string => [l.a, l.b].find((x) => basesOf(db, l.company_id).includes(x)) ?? l.a;

/** Positions of each shortage that no hire in notice is going to fill (hiring on top of them would pay premiums for nobody's seat). */
export const openOf = (db: Db, l: Pick<LineRow, 'company_id' | 'a' | 'b'>, x: Shortage, now: number): number =>
  Math.max(0, x.need - x.have - pendingHires(db, l.company_id, x.family, x.type, [l.a, l.b], now).length);

/** The cheapest candidates at the line's base that fill the open positions of each shortage. */
export function recruitPlan(db: Db, l: Pick<LineRow, 'company_id' | 'a' | 'b'>, short: readonly Shortage[], now: number): Candidate[] {
  const base = lineBase(db, l);
  const taken = new Set(all<{ candidate_id: string }>(db, 'SELECT candidate_id FROM staff WHERE company_id = ? AND candidate_id IS NOT NULL', l.company_id).map((r) => r.candidate_id));
  const day = dayNo(now);
  return short.flatMap((x) => candidatesFor(db, l.company_id, day, base, x.family, x.type).filter((c) => !taken.has(c.id)).sort((p, q) => p.askingSalary - q.askingSalary || p.id.localeCompare(q.id)).slice(0, openOf(db, l, x, now)));
}

/** A person who will fill positions of `family` (rated on `type`) when he starts. */
type Arrival = { family: StaffFamily; type: string | null; at: number };
/** The hires in notice who fill the shortage, from the staff table. */
const pendingArrivals = (db: Db, l: Pick<LineRow, 'company_id' | 'a' | 'b'>, short: readonly Shortage[], now: number): Arrival[] =>
  short.flatMap((x) => pendingHires(db, l.company_id, x.family, x.type, [l.a, l.b], now).map((p) => ({ family: x.family, type: x.type, at: p.starts_at })));

type BridgeSlot = LineBridge['perSlot'][number] & { base: string };
/** One interim per missing position. Each leaves when the earliest hire in notice for his family and type arrives (the arrivals are consumed one slot at a time, soonest first);
 *  a position nobody is coming for gets DEFAULT_NOTICE_DAYS. No end goes past MAX_INTERIM_DAYS. This one function is both the preview and what gets booked. */
function bridgePlan(db: Db, l: Pick<LineRow, 'company_id' | 'a' | 'b'>, short: readonly Shortage[], arrivals: readonly Arrival[], now: number): BridgeSlot[] {
  const base = lineBase(db, l);
  return short.flatMap((x) => {
    const coming = arrivals.filter((a) => a.family === x.family && a.type === x.type).map((a) => a.at).sort((p, q) => p - q);
    return Array.from({ length: x.need - x.have }, (_, i): BridgeSlot => {
      const at = coming[i];
      const until = Math.min(at ?? now + DEFAULT_NOTICE_DAYS * DAY_MS, now + MAX_INTERIM_DAYS * DAY_MS);
      return { family: x.family, type: x.type, base, until, defaulted: at === undefined, cost: interimQuote(db, l.company_id, x.family, x.type, until, now).cost };
    });
  });
}
const bridgeView = (slots: readonly BridgeSlot[]): LineBridge | null =>
  slots.length === 0 ? null : { people: slots.length, until: Math.max(...slots.map((s) => s.until)), cost: slots.reduce((t, s) => t + s.cost, 0), perSlot: slots.map(({ base: _base, ...s }) => s) };
const bookBridge = (db: Db, l: Pick<LineRow, 'company_id' | 'a' | 'b'>, short: readonly Shortage[], arrivals: readonly Arrival[], now: number): void => {
  bridgePlan(db, l, short, arrivals, now).forEach((s, index) => bookInterim(db, l.company_id, { family: s.family, qual: s.type, base: s.base, until: s.until, index }, now));
};

/** The hires in notice that, started now, fill every missing position (the soonest ones first); null when some position has nobody coming: a part-way start would not put the line back in service. */
function startNowPlan(db: Db, l: Pick<LineRow, 'company_id' | 'a' | 'b'>, short: readonly Shortage[], now: number): { ids: number[]; slots: { family: 'pilot' | 'cabin'; type: string | null; people: number }[] } | null {
  const ids: number[] = [], slots: { family: 'pilot' | 'cabin'; type: string | null; people: number }[] = [];
  for (const x of short) {
    const people = pendingHires(db, l.company_id, x.family, x.type, [l.a, l.b], now).slice(0, x.need - x.have);
    if (people.length < x.need - x.have) return null;
    ids.push(...people.map((p) => p.id));
    slots.push({ family: x.family, type: x.type, people: people.length });
  }
  return ids.length === 0 ? null : { ids: [...new Set(ids)], slots };
}
export function startNowOffer(db: Db, l: Pick<LineRow, 'company_id' | 'a' | 'b'>, short: readonly Shortage[], now: number): LineStartNow | null {
  const plan = startNowPlan(db, l, short, now);
  return plan && { people: plan.ids.length, cost: plan.ids.length * START_NOW_FEE, perSlot: plan.slots.map((s) => ({ ...s, cost: s.people * START_NOW_FEE })) };
}

/** The interim `resolve {option: 'interim'}` would book, for the problem screen. */
export const interimOffer = (db: Db, l: Pick<LineRow, 'company_id' | 'a' | 'b'>, short: readonly Shortage[], now: number): LineBridge | null =>
  bridgeView(bridgePlan(db, l, short, pendingArrivals(db, l, short, now), now));

/** What `resolve {option: 'recruit'}` would do, for the problem screen: how many people, the premiums paid now, what they cost a month, when they start,
 *  and the interim that `withInterim` adds (it ends when the people hired now arrive, or when the hires already in notice do, whichever is soonest per position). */
export function recruitOffer(db: Db, l: Pick<LineRow, 'id' | 'company_id' | 'a' | 'b'>, short: readonly Shortage[], now: number): { candidates: number; monthly: number; readyAt: number | null; premium: number; bridge: LineBridge | null } {
  const plan = recruitPlan(db, l, short, now);
  const arrivals = [...pendingArrivals(db, l, short, now), ...plan.map((c): Arrival => ({ family: c.family, type: c.qual, at: now + c.noticeDays * DAY_MS }))];
  return {
    candidates: plan.length, monthly: plan.reduce((t, c) => t + c.askingSalary, 0), readyAt: plan.length === 0 ? null : now + DEFAULT_NOTICE_DAYS * DAY_MS,
    premium: plan.reduce((t, c) => t + c.premium, 0), bridge: plan.length === 0 ? null : bridgeView(bridgePlan(db, l, short, arrivals, now)),
  };
}

const nothingToCover = (short: readonly Shortage[]): void => { if (short.length === 0) throw new HttpError(409, 'nothing_to_cover', 'the line has all the crew it needs'); };

/** Hire the plan above (the premiums are paid now). The line resumes by itself when they have started: the next tick finds a crew.
 *  `withInterim` books the bridge in the same transaction: the line flies at once and the interims leave as the hires arrive. */
export function recruitForLine(db: Db, l: LineRow, now: number, withInterim = false): number {
  const short = lineShortage(db, l, now);
  const plan = recruitPlan(db, l, short, now);
  if (plan.length === 0) {
    if (short.every((x) => openOf(db, l, x, now) === 0)) throw new HttpError(409, 'already_recruited', 'hires already in notice fill every position: bridge with an interim or start them now');
    throw new HttpError(409, 'no_candidates', 'nobody is on the market for this position today');
  }
  for (const c of plan) hire(db, l.company_id, c.id, now);
  if (withInterim) bookBridge(db, l, short, pendingArrivals(db, l, short, now), now);
  return plan.length;
}

/** Book every interim the line needs to fly now. Idempotent: once the crew is complete there is nothing to cover (409). */
export function interimForLine(db: Db, l: LineRow, now: number): void {
  const short = lineShortage(db, l, now);
  nothingToCover(short);
  bookBridge(db, l, short, pendingArrivals(db, l, short, now), now);
}

/** Start now the hires in notice who fill the line's positions. */
export function startNowForLine(db: Db, l: LineRow, now: number): void {
  const short = lineShortage(db, l, now);
  nothingToCover(short);
  const plan = startNowPlan(db, l, short, now);
  if (!plan) throw new HttpError(409, 'start_now_unavailable', 'not every missing position has a hire in notice');
  for (const id of plan.ids) startNow(db, l.company_id, id, now);
}

// ---------------------------------------------------------------- the starter crew (C11)

/** Top up the company's people to what its timetable needs, at no cost, employed from the beginning of time so that no leg of a catch-up is ever cancelled for want of a crew they would have had.
 *  They are paid like everybody from the next month (the payroll starts the month after `hired_at`). Idempotent: it only adds what is missing. */
export function grantStarterCrew(db: Db, companyId: number, now: number, lines?: readonly DemandLine[]): number {
  const rules = rulesOf(db, companyId);
  const need: Slot[] = lines ? demandOf(db, companyId, lines, rules) : companyDemand(db, companyId, rules);
  const roster = rosterOf(db, companyId, now);
  const holders = (sl: Slot): number => roster.filter((r) => r.family === sl.family && r.base === sl.base).filter((r) => sl.type === null || get(db, 'SELECT 1 AS x FROM staff_quals WHERE staff_id = ? AND type_icao = ?', r.id, sl.type)).length;
  let made = 0;
  for (const sl of need) {
    for (let i = holders(sl); i < sl.count; i++) {
      const rand = mulberry32(hashSeed(`starter:${companyId}:${sl.family}:${sl.type ?? '-'}:${sl.base}:${i}`));
      const experience = sl.family === 'pilot' ? Math.round(1_500 + rand() * 6_000) : Math.round(2 + rand() * 12);
      const role = roleOf(sl.family, experience);
      insertStaff(db, {
        companyId, family: sl.family, name: nameFrom(rand), base: sl.base, experience, reliability: 70 + Math.floor(rand() * 25), morale: 65 + Math.floor(rand() * 25),
        salary: salaryFor(sl.family, role, experienceFactor(sl.family, experience), categoryOf(db, companyId, sl.type)), hiredAt: now, startsAt: 0, qual: sl.type,
      });
      made++;
    }
  }
  return made;
}

/** Companies whose upgrade left them a crew to receive (SCHEMA_V8 marks them): grant it once, at the first request after the upgrade. Must run before the line ticks. */
export function grantPendingStarters(db: Db, now: number): void {
  for (const r of all<{ company_id: number }>(db, 'SELECT company_id FROM staff_company WHERE starter_pending = 1')) {
    grantStarterCrew(db, r.company_id, now);
    run(db, 'UPDATE staff_company SET starter_pending = 0 WHERE company_id = ?', r.company_id);
  }
}

