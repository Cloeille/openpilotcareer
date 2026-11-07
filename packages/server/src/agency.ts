// Lot AGENCY (v4): the recruiter mission (docs/v4-plan.md A.4, B.3, B.8). A mission is a hire made through an agency, not a second way to employ people: the shortlist is a pool of
// already-qualified pilots, signing one is `engage` of staff-people.ts (the market's own path), so the people signed have a normal notice and `starts_at`, and the commission goes through `pay` -> `post`.
// Domain operations: callers wrap them in `tx`. Nothing is paid until the signature.
import {
  AGENCY_MAX_COUNT, AGENCY_NOTICE_DAYS, AGENCY_PREMIUM_PCT, AGENCY_COMMISSION_PCT, AGENCY_SEARCH_DAYS, AGENCY_SPARE, DAY_MS, DEFAULT_NOTICE_DAYS, TRAINING_COURSE, agencyCommission, agencySalary, agencySavings, dayNo,
  experienceFactor, optionsOf, quoteOf, salaryFor,
  type AgencyCandidate, type AgencyGap, type AgencyView, type MissionView, type SignResult,
} from '@opc/shared';
import { hashSeed, mulberry32 } from './board.ts';
import { all, get, run, type Db } from './db.ts';
import { balanceOf } from './game.ts';
import { HttpError } from './http.ts';
import { stoppageCostPerDay } from './lines-manage.ts';
import type { LineRow } from './lines.ts';
import { basesOf, categoryOf, engage, fleetTypes, lineBase, lineShortage, market, memberRow, nameFrom, openOf, roleOf } from './staff-people.ts';
import { memberView } from './staff-views.ts';

type MissionRow = { id: number; company_id: number; base: string; qual: string; count: number; started_at: number; ready_at: number; commission: number; premium_pct: number; status: 'searching' | 'signed' | 'cancelled' };
type Position = { base: string; qual: string; count: number };

// ---------------------------------------------------------------- the shortlist

/** The agency's pilots for a position on a day: deterministic per company, position and day (the market's approach), so the price shown before the mission is the price of the people it finds.
 *  Ids start with a letter, so the market's `hire` never mistakes them for its own. People this company already signed are skipped, which makes a later mission find new ones. */
function shortlistOf(db: Db, companyId: number, p: Position, day: number, premiumPct: number): AgencyCandidate[] {
  const taken = new Set(all<{ candidate_id: string }>(db, "SELECT candidate_id FROM staff WHERE company_id = ? AND candidate_id LIKE 'a%'", companyId).map((r) => r.candidate_id));
  const category = categoryOf(db, companyId, p.qual);
  const out: AgencyCandidate[] = [];
  for (let i = 0; out.length < p.count + AGENCY_SPARE; i++) {
    const id = `a${day}.${p.base}.${p.qual}.${i}`;
    if (taken.has(id)) continue;
    const rand = mulberry32(hashSeed(`agency:${companyId}:${day}:${p.base}:${p.qual}:${i}`));
    const experience = Math.round(1_500 + rand() * 7_500);
    const role = roleOf('pilot', experience);
    const grid = salaryFor('pilot', role, experienceFactor('pilot', experience), category);
    const askingSalary = agencySalary(grid, premiumPct);
    out.push({ id, family: 'pilot', role, name: nameFrom(rand), base: p.base, qual: p.qual, experience, reliability: 75 + Math.floor(rand() * 20), morale: 60 + Math.floor(rand() * 30), grid, askingSalary, noticeDays: AGENCY_NOTICE_DAYS, premium: agencyCommission(askingSalary) });
  }
  return out;
}
const shortlistOfMission = (db: Db, m: MissionRow): AgencyCandidate[] => shortlistOf(db, m.company_id, m, dayNo(m.started_at), m.premium_pct);

// ---------------------------------------------------------------- what is short

/** The pilot positions the company's running lines lack, per base and type: only those no hire in notice fills. The most costly first. `perDay` is the sum over the short lines of what they lose a day (lot LINES). */
export function gapsOf(db: Db, companyId: number, now: number): AgencyGap[] {
  const gaps = new Map<string, AgencyGap>(), bases = basesOf(db, companyId);
  for (const l of all<LineRow>(db, "SELECT * FROM lines WHERE company_id = ? AND status IN ('active','interrupted') ORDER BY id", companyId)) {
    const base = lineBase(db, l);
    if (!bases.includes(base)) continue; // nobody can be employed at an airport that is neither a hub nor a base
    for (const x of lineShortage(db, l, now)) {
      if (x.family !== 'pilot' || x.type === null) continue;
      const open = openOf(db, l, x, now);
      if (open === 0) continue;
      const g = gaps.get(`${base}.${x.type}`) ?? { base, qual: x.type, have: x.have, need: x.need, open: 0, perDay: 0, lines: [] };
      g.open = Math.max(g.open, open);
      g.perDay += stoppageCostPerDay(db, l, now);
      g.lines.push({ id: l.id, a: l.a, b: l.b });
      gaps.set(`${base}.${x.type}`, g);
    }
  }
  return [...gaps.values()].sort((p, q) => q.perDay - p.perDay || p.base.localeCompare(q.base) || p.qual.localeCompare(q.qual));
}

/** Only positions the market itself lists: a hub or base of the company, a type it flies. */
function assertPosition(db: Db, companyId: number, base: string, qual: string): void {
  if (!basesOf(db, companyId).includes(base)) throw new HttpError(422, 'not_a_base', `${base} is not one of your hubs or bases`);
  if (!fleetTypes(db, companyId).includes(qual)) throw new HttpError(422, 'not_a_fleet_type', `you do not fly ${qual}`);
}

// ---------------------------------------------------------------- missions

const openMissions = (db: Db, companyId: number): MissionRow[] => all<MissionRow>(db, "SELECT * FROM recruit_missions WHERE company_id = ? AND status = 'searching' ORDER BY id", companyId);
const openMissionAt = (db: Db, companyId: number, base: string, qual: string): MissionRow | undefined =>
  get<MissionRow>(db, "SELECT * FROM recruit_missions WHERE company_id = ? AND base = ? AND qual = ? AND status = 'searching'", companyId, base, qual);

function ownedMission(db: Db, companyId: number, id: number): MissionRow {
  const m = get<MissionRow>(db, 'SELECT * FROM recruit_missions WHERE id = ? AND company_id = ?', id, companyId);
  if (!m) throw new HttpError(404, 'mission_not_found', 'no such mission');
  return m;
}

/** Entrust the search for `count` pilots rated on `qual` at `base`. Free: the commission is paid at the signature. One open mission per position. */
export function openMission(db: Db, companyId: number, p: Position, now: number): MissionView {
  assertPosition(db, companyId, p.base, p.qual);
  if (openMissionAt(db, companyId, p.base, p.qual)) throw new HttpError(409, 'mission_open', 'a mission is already searching for this position');
  const id = run(db, 'INSERT INTO recruit_missions (company_id, base, qual, count, started_at, ready_at, premium_pct) VALUES (?, ?, ?, ?, ?, ?, ?)',
    companyId, p.base, p.qual, p.count, now, now + AGENCY_SEARCH_DAYS * DAY_MS, AGENCY_PREMIUM_PCT).id;
  return missionView(db, ownedMission(db, companyId, id), undefined, now);
}

/** Drop an open mission: nothing was paid, nothing is owed. */
export function cancelMission(db: Db, companyId: number, id: number): void {
  const m = ownedMission(db, companyId, id);
  if (m.status !== 'searching') throw new HttpError(409, 'mission_closed', `this mission is already ${m.status}`);
  run(db, "UPDATE recruit_missions SET status = 'cancelled' WHERE id = ?", id);
}

/** Sign up to `count` people of the shortlist: each is a normal hire (`engage`) paying their commission now, who starts after their notice. Closes the mission. */
export function signMission(db: Db, companyId: number, id: number, candidateIds: readonly string[], now: number): SignResult {
  const m = ownedMission(db, companyId, id);
  if (m.status !== 'searching') throw new HttpError(409, 'mission_closed', `this mission is already ${m.status}`);
  if (now < m.ready_at) throw new HttpError(409, 'mission_not_ready', 'the agency is still searching', { readyAt: m.ready_at });
  if (candidateIds.length > m.count) throw new HttpError(409, 'too_many_candidates', `this mission is for ${m.count} people`, { count: m.count });
  assertPosition(db, companyId, m.base, m.qual);
  const list = shortlistOfMission(db, m);
  const picked = candidateIds.map((cid) => list.find((c) => c.id === cid) ?? (() => { throw new HttpError(404, 'candidate_not_found', 'this candidate is not on the shortlist'); })());
  const quote = quoteOf(picked, balanceOf(db, companyId));
  const members = picked.map((c) => memberRow(db, engage(db, companyId, c, now, { kind: 'agency_fee', amount: c.premium, memo: `agency commission ${c.name}` })));
  run(db, "UPDATE recruit_missions SET status = 'signed', commission = ? WHERE id = ?", quote.commission, id);
  return { members: members.map((s) => memberView(db, s, now)), commission: quote.commission, surchargeMonthly: quote.surchargeMonthly, balanceAfter: balanceOf(db, companyId) };
}

/** `pick`: the ids to price (the first `count` when absent). Hidden until the search is over. */
function missionView(db: Db, m: MissionRow, pick: readonly string[] | undefined, now: number): MissionView {
  const ready = now >= m.ready_at;
  const shortlist = ready ? shortlistOfMission(db, m) : null;
  const chosen = shortlist && (pick ? shortlist.filter((c) => pick.includes(c.id)).slice(0, m.count) : shortlist.slice(0, m.count));
  return {
    id: m.id, base: m.base, qual: m.qual, count: m.count, startedAt: m.started_at, readyAt: m.ready_at, ready, premiumPct: m.premium_pct, shortlist,
    quote: chosen && quoteOf(chosen, balanceOf(db, m.company_id)),
  };
}

// ---------------------------------------------------------------- the three options

export type AgencyQuery = { base?: string | undefined; qual?: string | undefined; count?: number | undefined; pick?: string | undefined };

/** The comparison for one position: the agency, training the company's own pilots on the type (`train` of staff-people.ts, price and days of TRAINING_COURSE), or the market (`hire`, one month's salary
 *  and the market's notice), each priced with the revenue the short lines lose a day. The position asked for, else the open mission's, else the line gap that costs the most. */
export function agencyView(db: Db, companyId: number, q: AgencyQuery, now: number): AgencyView {
  const gaps = gapsOf(db, companyId, now);
  const mission0 = q.base === undefined ? openMissions(db, companyId)[0] : undefined;
  const asked: Position | null = q.base !== undefined ? { base: q.base, qual: q.qual!, count: q.count! }
    : mission0 ? { base: mission0.base, qual: mission0.qual, count: mission0.count }
      : gaps[0] ? { base: gaps[0].base, qual: gaps[0].qual, count: Math.min(gaps[0].open, AGENCY_MAX_COUNT) } : null;
  const view = { gaps, commissionPct: AGENCY_COMMISSION_PCT, premiumPct: AGENCY_PREMIUM_PCT };
  if (!asked) return { ...view, request: null, perDay: 0, options: [], savings: null, mission: null };
  if (q.base !== undefined) assertPosition(db, companyId, asked.base, asked.qual);

  const m = openMissionAt(db, companyId, asked.base, asked.qual);
  const request: Position = m ? { ...asked, count: m.count } : asked; // an open mission is for the people it was opened for
  const perDay = gaps.find((g) => g.base === request.base && g.qual === request.qual)?.perDay ?? 0;
  const course = TRAINING_COURSE[categoryOf(db, companyId, request.qual)!];
  const trainable = get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM staff s WHERE s.company_id = ? AND s.family = 'pilot' AND s.base = ? AND s.starts_at <= ? AND (s.ends_at IS NULL OR s.ends_at > ?)
    AND NOT EXISTS (SELECT 1 FROM staff_quals x WHERE x.staff_id = s.id AND x.type_icao = ?)`, companyId, request.base, now, now, request.qual)!.n;
  const options = optionsOf({
    count: request.count, perDay, now, searchDays: m ? Math.max(0, Math.ceil((m.ready_at - now) / DAY_MS)) : AGENCY_SEARCH_DAYS,
    agency: quoteOf(shortlistOf(db, companyId, request, dayNo(m?.started_at ?? now), m?.premium_pct ?? AGENCY_PREMIUM_PCT).slice(0, request.count), balanceOf(db, companyId)),
    course, trainable,
    market: market(db, companyId, now, { family: 'pilot', base: request.base, qual: request.qual }).map((c) => c.premium).sort((a, b) => a - b), marketNotice: DEFAULT_NOTICE_DAYS,
  });
  return { ...view, request, perDay, options, savings: agencySavings(options), mission: m ? missionView(db, m, q.pick === undefined ? undefined : q.pick.split(',').filter(Boolean), now) : null };
}
