import { ALLIANCE_MAX_MEMBERS, BALLOT_CHOICES, VOTE_STATUSES, foundAllianceSchema, inviteSchema, type AllianceView, type BallotChoice, type FoundAllianceRequest, type InviteRequest, type VoteStatus, type VoteView } from '@opc/shared';
import type { Key } from './messages.ts';

/** What the alliance screens decide without asking the server: which ballot buttons show, whether a proposal can be made, the request a form stands for. The money and the votes are always the server's. */

/** The state of an admission vote. */
export const STATUS_KEY: Record<VoteStatus, Key> = { open: 'al.vote.open', accepted: 'al.vote.accepted', refused: 'al.vote.refused' };
/** The word of a ballot, in a sentence ("you voted yes") and on its button. */
export const CHOICE_KEY: Record<BallotChoice, Key> = { yes: 'al.choice.yes', no: 'al.choice.no' };
export const BALLOT_KEY: Record<BallotChoice, Key> = { yes: 'al.vote.yes', no: 'al.vote.no' };
export { BALLOT_CHOICES, VOTE_STATUSES };

/** A ballot can be cast on an open vote the company has not answered, by a member who has not given notice. */
export const canBallot = (v: VoteView, a: AllianceView): boolean => v.status === 'open' && v.mine === null && a.leavesAt === null;

/** Why no company can be proposed right now: the notice runs, or the alliance is full. */
export type ProposeRefusal = 'leaving' | 'full';
export const PROPOSE_KEY: Record<ProposeRefusal, Key> = { leaving: 'al.invite.leaving', full: 'al.invite.full' };
export const proposeRefusal = (a: AllianceView): ProposeRefusal | null => (a.leavesAt !== null ? 'leaving' : a.members.length >= ALLIANCE_MAX_MEMBERS ? 'full' : null);

/** What the members add up to, from the five fields they show. */
export const totalsOf = (a: AllianceView): { fleet: number; online: number } => ({ fleet: a.members.reduce((t, m) => t + m.fleet, 0), online: a.members.filter((m) => m.online).length });

/** The requests the typed names stand for, or null while the shared schema (the server's own) would refuse them. */
export const foundRequest = (name: string): FoundAllianceRequest | null => { const r = foundAllianceSchema.safeParse({ name }); return r.success ? r.data : null; };
export const inviteRequest = (name: string): InviteRequest | null => { const r = inviteSchema.safeParse({ name }); return r.success ? r.data : null; };
