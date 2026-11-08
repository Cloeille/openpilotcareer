import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLIANCE_MAX_MEMBERS, type AllianceView, type MemberView, type VoteView } from '@opc/shared';
import { canBallot, foundRequest, inviteRequest, proposeRefusal, totalsOf } from './alliance-view.ts';

const member = (name: string, o: Partial<MemberView> = {}): MemberView => ({ name, username: name.toLowerCase(), fleet: 2, reputation: 50, online: false, ...o });
const vote = (o: Partial<VoteView> = {}): VoteView => ({ id: 1, candidate: 'Cy Air', status: 'open', yes: 1, no: 0, members: 2, mine: null, ...o });
const alliance = (o: Partial<AllianceView> = {}): AllianceView => ({ name: 'Club', members: [member('Amy Air', { online: true, fleet: 3 }), member('Ben Air')], votes: [], leavesAt: null, dues: { revenue: 100_000, amount: 2000 }, ...o });

test('a ballot can be cast on an open vote the company has not answered, and only by a member who has not given notice', () => {
  const a = alliance();
  assert.equal(canBallot(vote(), a), true);
  assert.equal(canBallot(vote({ mine: 'yes' }), a), false, 'one ballot per company');
  assert.equal(canBallot(vote({ status: 'refused' }), a), false);
  assert.equal(canBallot(vote({ status: 'accepted' }), a), false);
  assert.equal(canBallot(vote(), alliance({ leavesAt: 1 })), false, 'a notice takes the vote away');
});

test('no company can be proposed while the notice runs or the alliance is full', () => {
  assert.equal(proposeRefusal(alliance()), null);
  assert.equal(proposeRefusal(alliance({ leavesAt: 1 })), 'leaving');
  const full = alliance({ members: Array.from({ length: ALLIANCE_MAX_MEMBERS }, (_, i) => member(`Co ${i}`)) });
  assert.equal(proposeRefusal(full), 'full');
});

test('the fleet and the online count are sums of what the members show', () => {
  assert.deepEqual(totalsOf(alliance()), { fleet: 5, online: 1 });
});

test('the forms build the request the server\'s own schema accepts, and nothing before', () => {
  assert.deepEqual(foundRequest('  Skyline Club '), { name: 'Skyline Club' });
  assert.equal(foundRequest('ab'), null);
  assert.deepEqual(inviteRequest('Ben Air'), { name: 'Ben Air' });
  assert.equal(inviteRequest(''), null);
});
