// Lot ALLIANCE (v4): alliances of players, the admission vote, the members' view of each other and the monthly dues (docs/v4-plan.md A.3, B.1, C23 to C25).
// Routes live in routes-alliance.ts and wrap the writes in `tx`; the dues are a charge of the month's billing (finance.ts `planInputs` reads `allianceDues`, `runBilling` posts it through `post()` inside its billing_runs guard).
// Trust boundary (B.1): the first data one player shows another. Everything a member learns of another company goes through `memberView`, a field-by-field allowlist; a non-member gets 404 `not_in_alliance` on every route, never a 403.
// Membership is a row with `since` and `left_at`: a company is a member while `left_at` is NULL or ahead (the 30 days of notice), so billing can ask who was a member on the 1st of any month it catches up. A vote is the admission
// of one candidate: its status is derived from the ballots of the members of the day (unanimous), so a member who leaves never blocks it. AI companies are never members (C24) and a subsidiary never joins on its own (the parent represents the group).
import {
  ALLIANCE_DUES_KIND, ALLIANCE_DUES_PCT, ALLIANCE_MAX_MEMBERS, ALLIANCE_NOTICE_MS, ALLIANCE_ONLINE_MS, duesFor,
  type AllianceView, type BallotChoice, type FoundAllianceRequest, type Invitation, type InviteRequest, type MemberView, type VoteStatus, type VoteView,
} from '@opc/shared';
import { all, get, run, type Db } from './db.ts';
import type { Charge } from './finance.ts';
import { HttpError } from './http.ts';
import { lastMonthRevenue } from './ledger-totals.ts';
import { ensureNetwork } from './lines.ts';

type Membership = { id: number; alliance_id: number; company_id: number; since: number; left_at: number | null; name: string };
type VoteRow = { id: number; alliance_id: number; candidate_id: number; created_at: number; closed_at: number | null };

const notInAlliance = (): HttpError => new HttpError(404, 'not_in_alliance', 'not found');

// ---------------------------------------------------------------- membership

/** The alliance the company belongs to at `at`: while the notice runs it still does. */
function membershipAt(db: Db, companyId: number, at: number): Membership | undefined {
  return get<Membership>(db, `SELECT m.*, a.name FROM alliance_members m JOIN alliances a ON a.id = m.alliance_id WHERE m.company_id = ?1 AND m.since <= ?2 AND (m.left_at IS NULL OR m.left_at > ?2)`, companyId, at);
}
const membersOf = (db: Db, allianceId: number, at: number): number[] =>
  all<{ company_id: number }>(db, 'SELECT company_id FROM alliance_members WHERE alliance_id = ?1 AND since <= ?2 AND (left_at IS NULL OR left_at > ?2) ORDER BY since, id', allianceId, at).map((m) => m.company_id);
/** Who votes: the members who have not given notice. */
const votersOf = (db: Db, allianceId: number, at: number): number[] =>
  all<{ company_id: number }>(db, 'SELECT company_id FROM alliance_members WHERE alliance_id = ?1 AND since <= ?2 AND left_at IS NULL', allianceId, at).map((m) => m.company_id);

/** The caller's membership, or the 404 a stranger gets. */
function memberOf(db: Db, companyId: number, now: number): Membership {
  const m = membershipAt(db, companyId, now);
  if (!m) throw notInAlliance();
  return m;
}
/** A member who has not given notice (one in notice proposes and votes no more). */
function stayingMemberOf(db: Db, companyId: number, now: number): Membership {
  const m = memberOf(db, companyId, now);
  if (m.left_at !== null) throw new HttpError(409, 'leaving', 'you have given notice: you no longer propose or vote');
  return m;
}

/** Why a company cannot belong to an alliance now, or null. Only a player's own company (C24), a parent or a stand-alone one (never a subsidiary: the parent represents the group), in no alliance yet. */
const cannotBelong = (db: Db, companyId: number, now: number): HttpError | null => {
  const c = get<{ user_id: number | null; parent_id: number | null }>(db, 'SELECT user_id, parent_id FROM companies WHERE id = ?', companyId);
  if (!c || c.user_id === null) return new HttpError(409, 'not_a_player', 'only a player\'s company can be a member');
  if (c.parent_id !== null) return new HttpError(409, 'is_subsidiary', 'a subsidiary cannot join on its own: the parent company represents the group');
  if (membershipAt(db, companyId, now)) return new HttpError(409, 'already_member', 'that company is already in an alliance');
  return null;
};
function assertCanBelong(db: Db, companyId: number, now: number): void {
  const refusal = cannotBelong(db, companyId, now);
  if (refusal) throw refusal;
}

function addMember(db: Db, allianceId: number, companyId: number, now: number): void {
  if (membersOf(db, allianceId, now).length >= ALLIANCE_MAX_MEMBERS) throw new HttpError(409, 'alliance_full', `an alliance has at most ${ALLIANCE_MAX_MEMBERS} members`);
  run(db, 'INSERT INTO alliance_members (alliance_id, company_id, since) VALUES (?, ?, ?)', allianceId, companyId, now);
  run(db, 'UPDATE alliance_votes SET closed_at = ? WHERE candidate_id = ? AND closed_at IS NULL', now, companyId); // every pending admission of the company is answered by joining one
  ensureNetwork(db, companyId, now); // the presence signal ("online") is kept on the company's network row
}

export function foundAlliance(db: Db, companyId: number, b: FoundAllianceRequest, now: number): AllianceView {
  assertCanBelong(db, companyId, now);
  if (get(db, 'SELECT 1 AS x FROM alliances a WHERE a.name = ? AND EXISTS (SELECT 1 FROM alliance_members m WHERE m.alliance_id = a.id AND (m.left_at IS NULL OR m.left_at > ?))', b.name, now)) {
    throw new HttpError(409, 'alliance_name_taken', `an alliance named ${b.name} already exists`);
  }
  const id = run(db, 'INSERT INTO alliances (name, founded_at) VALUES (?, ?)', b.name, now).id;
  addMember(db, id, companyId, now);
  return allianceView(db, companyId, now);
}

/** `POST /alliance/leave`: the notice starts today and the membership ends in ALLIANCE_NOTICE_DAYS; the dues stay due until then. */
export function leaveAlliance(db: Db, companyId: number, now: number): AllianceView {
  const m = memberOf(db, companyId, now);
  if (m.left_at !== null) throw new HttpError(409, 'already_leaving', 'the notice is already running');
  run(db, 'UPDATE alliance_members SET left_at = ? WHERE id = ?', now + ALLIANCE_NOTICE_MS, m.id);
  return allianceView(db, companyId, now);
}

// ---------------------------------------------------------------- admission vote

const liveVotes = (db: Db, allianceId: number): VoteRow[] => all<VoteRow>(db, 'SELECT * FROM alliance_votes WHERE alliance_id = ? AND closed_at IS NULL ORDER BY id', allianceId);

/** The vote as the members of the day make it: one refusal refuses it, every voter saying yes accepts it. */
function tally(db: Db, v: VoteRow, now: number): { status: VoteStatus; yes: number; no: number; voters: number[]; choices: Map<number, BallotChoice> } {
  const voters = votersOf(db, v.alliance_id, now);
  const choices = new Map(all<{ company_id: number; choice: BallotChoice }>(db, 'SELECT company_id, choice FROM alliance_ballots WHERE vote_id = ?', v.id).filter((b) => voters.includes(b.company_id)).map((b) => [b.company_id, b.choice]));
  const yes = [...choices.values()].filter((c) => c === 'yes').length, no = choices.size - yes;
  return { status: no > 0 ? 'refused' : voters.length > 0 && yes === voters.length ? 'accepted' : 'open', yes, no, voters, choices };
}

/** `POST /alliance/invite`: a member proposes a player's company by name. The proposer's own ballot is a yes. */
export function invite(db: Db, companyId: number, b: InviteRequest, now: number): AllianceView {
  const m = stayingMemberOf(db, companyId, now);
  const cand = get<{ id: number }>(db, 'SELECT id FROM companies WHERE name = ?', b.name);
  if (!cand) throw new HttpError(404, 'company_not_found', 'company not found');
  // What a member learns of a company that is not in the alliance is that it can or cannot be invited, never why (a subsidiary, a member elsewhere, an AI company): that would be data of someone who consented to nothing.
  if (cannotBelong(db, cand.id, now)) throw new HttpError(409, 'not_invitable', 'that company cannot be invited');
  if (membersOf(db, m.alliance_id, now).length >= ALLIANCE_MAX_MEMBERS) throw new HttpError(409, 'alliance_full', `an alliance has at most ${ALLIANCE_MAX_MEMBERS} members`);
  const open = liveVotes(db, m.alliance_id).find((v) => v.candidate_id === cand.id);
  if (open && tally(db, open, now).status !== 'refused') throw new HttpError(409, 'already_invited', 'that company is already being voted on');
  if (open) run(db, 'UPDATE alliance_votes SET closed_at = ? WHERE id = ?', now, open.id); // a refused candidate can be proposed again
  const voteId = run(db, 'INSERT INTO alliance_votes (alliance_id, candidate_id, created_at) VALUES (?, ?, ?)', m.alliance_id, cand.id, now).id;
  run(db, "INSERT INTO alliance_ballots (vote_id, company_id, choice) VALUES (?, ?, 'yes')", voteId, companyId);
  return allianceView(db, companyId, now);
}

/** `POST /alliance/votes/:id/ballot`: one ballot per company and vote (the primary key), final. A vote of another alliance does not exist for the caller. */
export function castBallot(db: Db, companyId: number, voteId: number, choice: BallotChoice, now: number): AllianceView {
  const m = stayingMemberOf(db, companyId, now);
  const v = get<VoteRow>(db, 'SELECT * FROM alliance_votes WHERE id = ? AND alliance_id = ?', voteId, m.alliance_id);
  if (!v) throw new HttpError(404, 'vote_not_found', 'no such vote');
  if (get(db, 'SELECT 1 AS x FROM alliance_ballots WHERE vote_id = ? AND company_id = ?', voteId, companyId)) throw new HttpError(409, 'already_voted', 'you have already voted');
  if (v.closed_at !== null || tally(db, v, now).status !== 'open') throw new HttpError(409, 'vote_closed', 'that vote is over');
  run(db, 'INSERT INTO alliance_ballots (vote_id, company_id, choice) VALUES (?, ?, ?)', voteId, companyId, choice); // the primary key (vote, company) is the guard: one ballot, final
  return allianceView(db, companyId, now);
}

/** The alliances that voted the company in and wait for its answer: their name and nothing else. */
export function invitationsOf(db: Db, companyId: number, now: number): Invitation[] {
  return all<VoteRow & { name: string }>(db, 'SELECT v.*, a.name FROM alliance_votes v JOIN alliances a ON a.id = v.alliance_id WHERE v.candidate_id = ? AND v.closed_at IS NULL ORDER BY v.id', companyId)
    .filter((v) => tally(db, v, now).status === 'accepted').map((v) => ({ id: v.id, alliance: v.name }));
}

/** `POST /alliance/invitations/:id/join`: joining is consent (C23). Only the candidate of an accepted vote can answer it. */
export function joinAlliance(db: Db, companyId: number, voteId: number, now: number): AllianceView {
  const v = get<VoteRow>(db, 'SELECT * FROM alliance_votes WHERE id = ? AND candidate_id = ? AND closed_at IS NULL', voteId, companyId);
  if (!v || tally(db, v, now).status !== 'accepted') throw new HttpError(404, 'invitation_not_found', 'no such invitation');
  assertCanBelong(db, companyId, now);
  addMember(db, v.alliance_id, companyId, now);
  return allianceView(db, companyId, now);
}

// ---------------------------------------------------------------- what a member sees

/** C23, the one allowlist: what a member shows another member. Five fields, each read by name below; nothing is spread from a row, so a column added to `companies` or `users` can never leak through here. */
export function memberView(db: Db, companyId: number, now: number): MemberView {
  const r = get<{ name: string; username: string; reputation: number; fleet: number; seen_at: number | null }>(db,
    `SELECT c.name AS name, u.username AS username, c.reputation AS reputation,
       (SELECT COUNT(*) FROM aircraft a WHERE a.company_id = c.id AND a.returned_at IS NULL) AS fleet,
       (SELECT n.seen_at FROM line_networks n WHERE n.company_id = c.id) AS seen_at
     FROM companies c JOIN users u ON u.id = c.user_id WHERE c.id = ?`, companyId)!;
  return { name: r.name, username: r.username, fleet: r.fleet, reputation: Math.round(r.reputation * 10) / 10, online: r.seen_at !== null && now - r.seen_at < ALLIANCE_ONLINE_MS };
}

const name = (db: Db, companyId: number): string => get<{ name: string }>(db, 'SELECT name FROM companies WHERE id = ?', companyId)!.name;

/** `GET /alliance`: the caller's alliance, a 404 for anyone else. */
export function allianceView(db: Db, companyId: number, now: number): AllianceView {
  const m = memberOf(db, companyId, now);
  const votes = liveVotes(db, m.alliance_id).map((v): VoteView => {
    const t = tally(db, v, now);
    return { id: v.id, candidate: name(db, v.candidate_id), status: t.status, yes: t.yes, no: t.no, members: t.voters.length, mine: t.choices.get(companyId) ?? null };
  });
  const revenue = lastMonthRevenue(db, companyId, now);
  return { name: m.name, members: membersOf(db, m.alliance_id, now).map((id) => memberView(db, id, now)), votes, leavesAt: m.left_at, dues: { revenue, amount: duesFor(revenue) } };
}

// ---------------------------------------------------------------- dues (billing)

/** The dues of the month starting at `at` (UTC, the 1st): ALLIANCE_DUES_PCT of last month's revenue, for a company that was a member before the 1st and has not left by it (a notice still running counts).
 *  A charge for `planMonth`, which `runBilling` posts through `post()` once per company and month (its billing_runs guard): the dues cannot be taken twice, and a company that joined after the 1st pays from the next. */
export function allianceDues(db: Db, companyId: number, at: number): Charge[] {
  const m = get<{ name: string }>(db, `SELECT a.name FROM alliance_members m JOIN alliances a ON a.id = m.alliance_id WHERE m.company_id = ?1 AND m.since < ?2 AND (m.left_at IS NULL OR m.left_at > ?2)`, companyId, at);
  const dues = m ? duesFor(lastMonthRevenue(db, companyId, at)) : 0;
  return m && dues > 0 ? [{ kind: ALLIANCE_DUES_KIND, amount: -dues, memo: `${m.name} alliance dues ${ALLIANCE_DUES_PCT} %` }] : [];
}
