import type { AllianceView, MemberView, VoteView } from '@opc/shared';
import type { AllianceData } from './api-alliance.ts';
import { BALLOT_CHOICES, BALLOT_KEY, CHOICE_KEY, STATUS_KEY, canBallot, totalsOf } from './alliance-view.ts';
import { badge, button, icon } from './components.ts';
import { doorCard } from './facilities-ui.ts';
import { fmt } from './format.ts';
import { t, tp } from './i18n.ts';
import { h } from './ui.ts';
import type { BallotChoice } from '@opc/shared';

/** Shown when the server has no alliance routes (404): the screen says so instead of failing. */
export const allianceOff = (): HTMLElement => h('div', { class: 'ln-off panel' }, h('div', { class: 'panel-body' }, icon('users', 20), h('h1', { class: 'ln-off-title' }, t('al.off.title')), h('p', { class: 'muted' }, t('al.off.body'))));

/** The door from the Compagnie tab to the alliance (`L`): how many members and who is online, or the invitations waiting, and the way in. Null when the server has no alliance routes. */
export function allianceEntry(data: AllianceData | null, go: (hash: string) => void): HTMLElement | null {
  if (!data) return null;
  const { view, invitations } = data;
  return doorCard({
    id: 'al-entry', title: t('al.entry.title'), tag: view ? tp('al.entry.count', view.members.length) : t('al.entry.tagNone'),
    body: view ? t('al.entry.body', { name: view.name, online: totalsOf(view).online, n: view.members.length }) : invitations.length > 0 ? tp('al.entry.invited', invitations.length) : t('al.entry.none'),
    open: t('al.entry.open'), icon: 'users', key: 'L', onopen: () => go('#alliance'),
  });
}

/** A member as one row: the five fields C23 allows and nothing else. `you` marks the player's own company. */
export function memberRow(m: MemberView, you: boolean): HTMLElement {
  const fm = fmt();
  const status = m.online ? t('al.online') : t('al.offline');
  return h('li', {
    class: `al-row${you ? ' on' : ''}`, 'data-row': '', tabindex: 0,
    'aria-label': t('al.row.label', { name: m.name, username: m.username, fleet: m.fleet, rep: fm.num(m.reputation, 1), status }),
  },
  h('div', { class: 'col tight al-who' }, h('span', { class: 'strong' }, m.name), h('span', { class: 'dim small' }, t('al.row.pilot', { username: m.username }))),
  h('div', { class: 'al-figs' },
    h('span', { class: 'col tight' }, h('span', { class: 'dim small' }, t('al.row.fleet')), h('span', { class: 'mono' }, fm.num(m.fleet))),
    h('span', { class: 'col tight' }, h('span', { class: 'dim small' }, t('al.row.reputation')), h('span', { class: 'mono row tight' }, icon('star', 13), `${fm.num(m.reputation, 1)} / 100`))),
  h('div', { class: 'row tight' }, you ? badge('info', t('al.row.you'), null) : null, badge(m.online ? 'verified' : 'neutral', status, m.online ? 'wifi' : 'wifi-off')));
}

/** An admission vote as one row: who, how it stands, and the two ballots while the caller may still cast one. `cast` redraws. */
export function voteRow(v: VoteView, a: AllianceView, cast: (id: number, choice: BallotChoice) => void): HTMLElement {
  const status = t(STATUS_KEY[v.status]);
  return h('li', { class: 'al-row al-vote', 'data-row': '', tabindex: 0, 'aria-label': `${t('al.vote.row', { name: v.candidate, status })}. ${t('al.vote.tally', { yes: v.yes, no: v.no, members: v.members })}` },
    h('div', { class: 'col tight al-who' }, h('span', { class: 'strong' }, v.candidate), h('span', { class: 'dim small' }, t('al.vote.tally', { yes: v.yes, no: v.no, members: v.members }))),
    h('div', { class: 'row tight' },
      badge(v.status === 'accepted' ? 'verified' : v.status === 'refused' ? 'rejected' : 'unverified', status),
      canBallot(v, a)
        ? BALLOT_CHOICES.map((c) => button(t(BALLOT_KEY[c]), { variant: 'secondary', icon: c === 'yes' ? 'check' : 'x', onclick: () => cast(v.id, c) }))
        : v.mine ? h('span', { class: 'dim small' }, t('al.vote.mine', { choice: t(CHOICE_KEY[v.mine]) })) : null));
}
