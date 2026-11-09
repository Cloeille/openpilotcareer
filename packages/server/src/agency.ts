// Lot AGENCY (v4): the recruiter mission (docs/v4-plan.md A.4, B.3, B.8). A mission is a hire made through an agency, not a second way to employ people: the shortlist is a pool of already-qualified people of one
// post (family, role, base, and the type rating of a pilot), signing one is `engage` of staff-people.ts (the market's own path), so the people signed have a normal notice and `starts_at`, are paid the company's grid,
// and the commission goes through `pay` -> `post`. Domain operations: callers wrap them in `tx`. Nothing is paid until the signature.
import {
  AGENCY_NOTICE_DAYS, AGENCY_SEARCH_DAYS, AGENCY_SPARE, AGENCY_MAX_COUNT, DAY_MS, DEFAULT_NOTICE_DAYS, TRAINING_COURSE, STAFF_FAMILIES, agencyCommission, agencySavings, crewNeeded, dayNo, isPost, optionsOf, quoteOf, requestForGap,
  type AgencyGap, type AgencyPost, type AgencyRequest, type AgencyView, type Candidate, type MissionView, type SignResult, type StaffFamily, type StaffRole,
} from '@opc/shared';
import { hashSeed, mulberry32 } from './board.ts';
import { all, get, run, type Db } from './db.ts';
import { balanceOf, typeFor } from './game.ts';
import { HttpError } from './http.ts';
import { stoppageCostPerDay } from './lines-manage.ts';
import { lineAircraft, type LineRow } from './lines.ts';
import { FLIES_SQL } from './staff.ts';
import { CANDIDATE_CAP, basesOf, candidateFrom, categoryOf, engage, fleetTypes, market, memberRow } from './staff-people.ts';
import { coverOf, memberView, type Cover } from './staff-views.ts';

type MissionRow = { id: number; company_id: number; family: StaffFamily; role: StaffRole; base: string; qual: string | null; count: number; started_at: number; ready_at: number; commission: number; status: 'searching' | 'signed' | 'cancelled' };
const requestOf = (m: MissionRow): AgencyRequest => ({ family: m.family, role: m.role, base: m.base, qual: m.qual, count: m.count });

// ---------------------------------------------------------------- the shortlist

/** The agency's people for a post on a day: deterministic per company, post and day (the market's approach), so the price shown before the mission is the price of the people it finds.
 *  Each is drawn by the market's own generator (`candidateFrom`: the family's experience, reliability and morale, a name from the base's country) and kept when they hold the role asked (a pilot is a captain or a first officer by his hours).
 *  They are paid the company's grid; the commission is the whole price. Ids start with a letter, so the market's `hire` never mistakes them for its own. People this company already signed are skipped, which makes a later mission find new ones. */
function shortlistOf(db: Db, companyId: number, p: AgencyRequest, day: number): Candidate[] {
  const taken = new Set(all<{ candidate_id: string }>(db, "SELECT candidate_id FROM staff WHERE company_id = ? AND candidate_id LIKE 'a%'", companyId).map((r) => r.candidate_id));
  const post = `${p.base}.${p.family}.${p.role}.${p.qual ?? '-'}`;
  const out: Candidate[] = [];
  for (let i = 0; i < CANDIDATE_CAP && out.length < p.count + AGENCY_SPARE; i++) {
    const id = `a${day}.${post}.${i}`;
    if (taken.has(id)) continue;
    const c = candidateFrom(db, companyId, mulberry32(hashSeed(`agency:${companyId}:${day}:${post}:${i}`)), id, p.base, p.family, p.qual);
    if (c.role === p.role) out.push({ ...c, noticeDays: AGENCY_NOTICE_DAYS, premium: agencyCommission(c.askingSalary) });
  }
  return out;
}
const shortlistOfMission = (db: Db, m: MissionRow): Candidate[] => shortlistOf(db, m.company_id, requestOf(m), dayNo(m.started_at));

// ---------------------------------------------------------------- what is short

/** The posts the company's timetable lacks, every family, per base and type: the open posts of `coverOf`, the staffing screen's own need (crews for the rotation, duty limits and rest included, the fixed posts of ground, maintenance and administration)
 *  less the people working or in notice. A deck that exists is not enough: a line cancelled for duty limits has pilots, just too few crews. The most costly first, pilots before the other families on a tie (the same lines lose the same revenue to both).
 *  `perDay` is what the lines needing this post earn a day (pilots of the type and cabin crew of an aircraft with cabin seats, from the base), in proportion to the share of the posts nobody works yet; the other families stop no line (lot LINES). */
export function gapsOf(db: Db, companyId: number, cover: readonly Cover[], now: number): AgencyGap[] {
  const bases = basesOf(db, companyId);
  const lines = all<LineRow>(db, "SELECT * FROM lines WHERE company_id = ? AND status != 'paused' ORDER BY id", companyId);
  const needs = (c: Cover, x: { icao: string }): boolean => (c.family === 'pilot' ? x.icao === c.type : c.family === 'cabin' && crewNeeded(typeFor(db, companyId, x.icao).seats).cabin > 0);
  return cover.filter((c) => c.open > 0 && bases.includes(c.base)) // nobody can be employed at an airport that is neither a hub nor a base
    .map((c): AgencyGap => {
      const flown = lines.filter((l) => lineAircraft(db, l.id).some((x) => x.returned_at === null && x.home === c.base && needs(c, x)));
      const unstaffed = 1 - c.working / c.count;
      return { family: c.family, base: c.base, qual: c.type, have: c.working, need: c.count, open: c.open, perDay: flown.reduce((t, l) => t + stoppageCostPerDay(db, l, now), 0) * unstaffed, lines: flown.map((l) => ({ id: l.id, a: l.a, b: l.b })) };
    })
    .sort((p, q) => q.perDay - p.perDay || p.base.localeCompare(q.base) || STAFF_FAMILIES.indexOf(p.family) - STAFF_FAMILIES.indexOf(q.family) || (p.qual ?? '').localeCompare(q.qual ?? ''));
}

/** Only posts that exist and that the market itself lists: a role of the family (a pilot a captain or a first officer), a type rating for a pilot and for nobody else, at a hub or base of the company, on a type it flies.
 *  The one guard of every way in (a mission, the options); a candidate is never taken from the caller, so nothing else can forge a family, role or rating. */
function assertPosition(db: Db, companyId: number, p: AgencyPost): void {
  if (!isPost(p)) throw new HttpError(422, 'invalid_post', `there is no ${p.role} post in ${p.family}${p.qual ? ` rated on ${p.qual}` : p.family === 'pilot' ? ' without a type rating' : ''}`);
  if (!basesOf(db, companyId).includes(p.base)) throw new HttpError(422, 'not_a_base', `${p.base} is not one of your hubs or bases`);
  if (p.qual !== null && !fleetTypes(db, companyId).includes(p.qual)) throw new HttpError(422, 'not_a_fleet_type', `you do not fly ${p.qual}`);
}

// ---------------------------------------------------------------- missions

const openMissions = (db: Db, companyId: number): MissionRow[] => all<MissionRow>(db, "SELECT * FROM recruit_missions WHERE company_id = ? AND status = 'searching' ORDER BY id", companyId);
const openMissionAt = (db: Db, companyId: number, p: AgencyPost): MissionRow | undefined =>
  get<MissionRow>(db, "SELECT * FROM recruit_missions WHERE company_id = ? AND family = ? AND role = ? AND base = ? AND qual IS ? AND status = 'searching'", companyId, p.family, p.role, p.base, p.qual);

function ownedMission(db: Db, companyId: number, id: number): MissionRow {
  const m = get<MissionRow>(db, 'SELECT * FROM recruit_missions WHERE id = ? AND company_id = ?', id, companyId);
  if (!m) throw new HttpError(404, 'mission_not_found', 'no such mission');
  return m;
}

/** Entrust the search for `count` people of a post (a family, a role, a base, a pilot's type rating). Free: the commission is paid at the signature. One open mission per post. */
export function openMission(db: Db, companyId: number, p: AgencyRequest, now: number): MissionView {
  assertPosition(db, companyId, p);
  if (openMissionAt(db, companyId, p)) throw new HttpError(409, 'mission_open', 'a mission is already searching for this post');
  const id = run(db, 'INSERT INTO recruit_missions (company_id, family, role, base, qual, count, started_at, ready_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    companyId, p.family, p.role, p.base, p.qual, p.count, now, now + AGENCY_SEARCH_DAYS * DAY_MS).id;
  return missionView(db, ownedMission(db, companyId, id), undefined, now);
}

/** Drop an open mission: nothing was paid, nothing is owed. */
export function cancelMission(db: Db, companyId: number, id: number): void {
  const m = ownedMission(db, companyId, id);
  if (m.status !== 'searching') throw new HttpError(409, 'mission_closed', `this mission is already ${m.status}`);
  run(db, "UPDATE recruit_missions SET status = 'cancelled' WHERE id = ?", id);
}

/** Sign up to `count` people of the shortlist: each is a normal hire (`engage`) paying their commission now, who starts after their notice. Closes the mission.
 *  The people come from the shortlist rebuilt from the mission's own post, never from the caller: an id that is not on it is a 404, so no family, role or rating can be forged. */
export function signMission(db: Db, companyId: number, id: number, candidateIds: readonly string[], now: number): SignResult {
  const m = ownedMission(db, companyId, id);
  if (m.status !== 'searching') throw new HttpError(409, 'mission_closed', `this mission is already ${m.status}`);
  if (now < m.ready_at) throw new HttpError(409, 'mission_not_ready', 'the agency is still searching', { readyAt: m.ready_at });
  if (candidateIds.length > m.count) throw new HttpError(409, 'too_many_candidates', `this mission is for ${m.count} people`, { count: m.count });
  assertPosition(db, companyId, m);
  const list = shortlistOfMission(db, m);
  const picked = candidateIds.map((cid) => list.find((c) => c.id === cid) ?? (() => { throw new HttpError(404, 'candidate_not_found', 'this candidate is not on the shortlist'); })());
  const quote = quoteOf(picked, balanceOf(db, companyId));
  const members = picked.map((c) => memberRow(db, engage(db, companyId, c, now, { kind: 'agency_fee', amount: c.premium, memo: `agency commission ${c.name}` })));
  run(db, "UPDATE recruit_missions SET status = 'signed', commission = ? WHERE id = ?", quote.commission, id);
  return { members: members.map((s) => memberView(db, s, now)), commission: quote.commission, balanceAfter: balanceOf(db, companyId) };
}

/** `pick`: the ids to price (the first `count` when absent). Hidden until the search is over. */
function missionView(db: Db, m: MissionRow, pick: readonly string[] | undefined, now: number): MissionView {
  const ready = now >= m.ready_at;
  const shortlist = ready ? shortlistOfMission(db, m) : null;
  const chosen = shortlist && (pick ? shortlist.filter((c) => pick.includes(c.id)).slice(0, m.count) : shortlist.slice(0, m.count));
  return { ...requestOf(m), id: m.id, startedAt: m.started_at, readyAt: m.ready_at, ready, shortlist, quote: chosen && quoteOf(chosen, balanceOf(db, m.company_id)) };
}

// ---------------------------------------------------------------- the ways to fill a post

export type AgencyQuery = { family?: StaffFamily | undefined; role?: StaffRole | undefined; base?: string | undefined; qual?: string | null | undefined; count?: number | undefined; pick?: string | undefined };

/** The comparison for one post: the agency, training the company's own pilots on the type (`train` of staff-people.ts, price and days of TRAINING_COURSE; pilots only), or the market (`hire`, one month's salary
 *  and the market's notice), each priced with the revenue the short lines lose a day. The post asked for, else the open mission's, else the gap that costs the most. */
export function agencyView(db: Db, companyId: number, q: AgencyQuery, now: number): AgencyView {
  const gaps = gapsOf(db, companyId, coverOf(db, companyId, now), now);
  const mission0 = q.family === undefined ? openMissions(db, companyId)[0] : undefined;
  const asked: AgencyRequest | null = q.family !== undefined ? { family: q.family, role: q.role!, base: q.base!, qual: q.qual ?? null, count: q.count! }
    : mission0 ? requestOf(mission0)
      : gaps[0] ? requestForGap(gaps[0]) : null;
  if (!asked) return { gaps, request: null, perDay: 0, options: [], savings: null, mission: null };
  if (q.family !== undefined) assertPosition(db, companyId, asked);

  const m = openMissionAt(db, companyId, asked);
  const request: AgencyRequest = m ? requestOf(m) : asked; // an open mission is for the people it was opened for
  const perDay = gaps.find((g) => g.family === request.family && g.base === request.base && g.qual === request.qual)?.perDay ?? 0;
  const pilot = request.family === 'pilot';
  const course = pilot ? TRAINING_COURSE[categoryOf(db, companyId, request.qual)!] : null;
  const trainable = !pilot ? 0 : get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM staff s WHERE s.company_id = ? AND s.family = 'pilot' AND s.base = ? AND s.starts_at <= ? AND (s.ends_at IS NULL OR s.ends_at > ?) AND ${FLIES_SQL}
    AND NOT EXISTS (SELECT 1 FROM staff_quals x WHERE x.staff_id = s.id AND x.type_icao = ?)`, companyId, request.base, now, now, request.qual)!.n;
  const options = optionsOf({
    count: request.count, perDay, now, searchDays: m ? Math.max(0, Math.ceil((m.ready_at - now) / DAY_MS)) : AGENCY_SEARCH_DAYS,
    agency: quoteOf(shortlistOf(db, companyId, request, dayNo(m?.started_at ?? now)).slice(0, request.count), balanceOf(db, companyId)),
    course, trainable,
    market: market(db, companyId, now, { family: request.family, base: request.base, ...(request.qual ? { qual: request.qual } : {}) }).filter((c) => c.role === request.role).map((c) => c.premium).sort((a, b) => a - b), marketNotice: DEFAULT_NOTICE_DAYS,
  });
  return { gaps, request, perDay, options, savings: agencySavings(options), mission: m ? missionView(db, m, q.pick === undefined ? undefined : q.pick.split(',').filter(Boolean), now) : null };
}
