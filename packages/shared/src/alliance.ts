// Lot ALLIANCE (v4): alliances of players, the admission vote, the monthly dues (docs/v4-plan.md A.3, B.1, B.3, C23 to C25).
// Pure rules, request schemas and wire types; the server owns the money and the membership (server/src/alliance.ts, routes-alliance.ts), the web only shows what it returns.
// Runtime-imports only lines.ts (DAY_MS), never ./index.ts (index re-exports this file).
import { z } from 'zod';
import { DAY_MS } from './lines.ts';

// ---------------------------------------------------------------- rules
/** C23: a player-only club of at most this many companies. AI companies are never members (C24). */
export const ALLIANCE_MAX_MEMBERS = 6;
/** The monthly dues, as a share of the member's revenue of the month before (the credit ceiling reads the same revenue). Billed with the month, like rent. */
export const ALLIANCE_DUES_PCT = 2;
/** Leaving takes this long from the day the notice is given; the dues stay due until it ends. */
export const ALLIANCE_NOTICE_DAYS = 30;
export const ALLIANCE_NOTICE_MS = ALLIANCE_NOTICE_DAYS * DAY_MS;
/** A member whose presence signal is younger than this is online. */
export const ALLIANCE_ONLINE_MS = 5 * 60_000;
/** The ledger kind of the dues posting. */
export const ALLIANCE_DUES_KIND = 'alliance_dues';

export const duesFor = (revenue: number): number => Math.round((revenue * ALLIANCE_DUES_PCT) / 100);

// ---------------------------------------------------------------- requests
export const foundAllianceSchema = z.object({ name: z.string().trim().min(3).max(40) });
export type FoundAllianceRequest = z.infer<typeof foundAllianceSchema>;

/** `POST /alliance/invite`: a member proposes a player's company by its name; that opens the admission vote (the proposer's own ballot is a yes), and the company joins when it has accepted a unanimous yes. */
export const inviteSchema = z.object({ name: z.string().trim().min(2).max(40) });
export type InviteRequest = z.infer<typeof inviteSchema>;

export const BALLOT_CHOICES = ['yes', 'no'] as const;
export type BallotChoice = (typeof BALLOT_CHOICES)[number];
export const ballotSchema = z.object({ choice: z.enum(BALLOT_CHOICES) });
export type BallotRequest = z.infer<typeof ballotSchema>;

// ---------------------------------------------------------------- wire types
/** What one member shows another (C23): these five fields and nothing else. The server builds it field by field in one function (alliance.ts `memberView`); a field added here is a decision. */
export type MemberView = { name: string; username: string; fleet: number; reputation: number; online: boolean };

/** `open`: waiting for ballots; `accepted`: every member said yes, the company may now join; `refused`: a member said no. */
export const VOTE_STATUSES = ['open', 'accepted', 'refused'] as const;
export type VoteStatus = (typeof VOTE_STATUSES)[number];
export type VoteView = { id: number; candidate: string; status: VoteStatus; yes: number; no: number; members: number; mine: BallotChoice | null };

/** `leavesAt`: when the notice runs out (epoch ms), null while no notice was given. `dues`: the caller's own: ALLIANCE_DUES_PCT of `revenue` (last full month's, its own ledger) is `amount`, what the 1st of this month billed. */
export type AllianceView = { name: string; members: MemberView[]; votes: VoteView[]; leavesAt: number | null; dues: { revenue: number; amount: number } };
/** What a company that is not a member sees of the alliances that want it: nothing but the name. */
export type Invitation = { id: number; alliance: string };
