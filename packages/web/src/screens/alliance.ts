import { ALLIANCE_DUES_PCT, ALLIANCE_MAX_MEMBERS, ALLIANCE_NOTICE_DAYS, type AllianceView, type BallotChoice } from '@opc/shared';
import { act } from '../actions.ts';
import { allianceOff, memberRow, voteRow } from '../alliance-ui.ts';
import { PROPOSE_KEY, foundRequest, inviteRequest, proposeRefusal, totalsOf } from '../alliance-view.ts';
import { castBallot, fetchAlliance, foundAlliance, inviteCompany, joinAlliance, leaveAlliance } from '../api-alliance.ts';
import { badge, button, icon, inputField, panel, titleBlock } from '../components.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import { figure } from '../reports-ui.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h } from '../ui.ts';

/** Typed names survive a redraw (a language change), not a new visit. */
const drafts = { found: '', invite: '' };

/** `#alliance`: the members (five fields each, C23: the server sends nothing else), the admission votes, the dues and the notice. A company that is in none founds one or answers the invitations it has. */
export async function alliance(ctx: Ctx): Promise<Screen> {
  const back = '#hubs';
  const data = await fetchAlliance();
  const hints = [{ key: t('key.esc'), label: t('st.hint.company') }];
  if (!data) return { title: t('al.title'), scene: 'hubs', tab: 'hubs', back, hints, view: allianceOff() };
  const refresh = ctx.refresh;
  const header = (status: string, extra?: HTMLElement): HTMLElement => h('div', { class: 'ln-header rp-header' },
    titleBlock(h('span', { class: 'row tight' }, h('span', { class: 'dot' }), h('span', null, status)), t('al.title'), h('p', { class: 'muted', style: 'font-size:14px' }, t('al.sub'))), extra);

  if (!data.view) {
    const found = inputField({ label: t('al.found.name') }, { type: 'text', name: 'alliance-name', minlength: 3, maxlength: 40, autocomplete: 'off', required: true, value: drafts.found, oninput: (e: Event) => { drafts.found = (e.target as HTMLInputElement).value; } });
    const create = (): void => {
      const req = foundRequest(drafts.found);
      if (req) void act(t('al.found.done', { name: req.name }), () => foundAlliance(req), refresh).then((ok) => { if (ok) drafts.found = ''; });
    };
    const invitations = panel({ title: t('al.inv.title'), id: 'al-invitations', class: 'rp-main' },
      data.invitations.length === 0 ? h('p', { class: 'dim' }, t('al.inv.none')) : h('ul', { class: 'al-list', role: 'list' }, data.invitations.map((i) => h('li', { class: 'al-row', 'data-row': '', tabindex: 0 },
        h('span', { class: 'strong' }, t('al.inv.row', { alliance: i.alliance })),
        button(t('al.inv.join'), { variant: 'primary', icon: 'users', onclick: () => void act(t('al.inv.joined', { name: i.alliance }), () => joinAlliance(i.id), refresh) })))));
    const side = panel({ title: t('al.found.title'), id: 'al-found' },
      h('p', { class: 'muted' }, t('al.found.body', { max: ALLIANCE_MAX_MEMBERS, days: ALLIANCE_NOTICE_DAYS })), found.root,
      h('div', { class: 'row' }, button(t('al.found.btn'), { variant: data.invitations.length === 0 ? 'primary' : 'secondary', icon: 'users', onclick: create })));
    return {
      title: t('al.title'), scene: 'hubs', tab: 'hubs', back, wide: false,
      view: h('div', { class: 'rp-screen al-screen' }, header(t('al.crumb')), h('div', { class: 'rp-body' }, invitations, h('div', { class: 'rp-side' }, side))),
      hints: [...hints, { key: '↑ ↓', label: t('al.hint.member') }, { key: t('key.enter'), label: t('al.hint.act') }],
    };
  }

  const a: AllianceView = data.view;
  const fm = fmt();
  const you = ctx.snap.me.company.name;
  const totals = totalsOf(a);
  const cast = (id: number, choice: BallotChoice): void => {
    const v = a.votes.find((x) => x.id === id);
    void act(t('al.vote.said', { name: v?.candidate ?? '' }), () => castBallot(id, choice), refresh);
  };
  const refusal = proposeRefusal(a);
  const name = inputField({ label: t('al.invite.name') }, { type: 'text', name: 'invite-name', minlength: 2, maxlength: 40, autocomplete: 'off', value: drafts.invite, disabled: refusal !== null, oninput: (e: Event) => { drafts.invite = (e.target as HTMLInputElement).value; } });
  const propose = (): void => {
    const req = inviteRequest(drafts.invite);
    if (req && refusal === null) void act(t('al.invite.done', { name: req.name }), () => inviteCompany(req), refresh).then((ok) => { if (ok) drafts.invite = ''; });
  };
  const leave = (): void => {
    if (a.leavesAt === null && confirm(t('al.leave.ask', { days: ALLIANCE_NOTICE_DAYS }))) void act(t('al.leave.done'), () => leaveAlliance(), refresh);
  };

  const head = header(`${t('al.crumb')} · ${a.name}`, h('div', { class: 'rp-figures' },
    figure(t('al.members.title'), tp('al.entry.count', a.members.length), t('al.members.sub', { n: a.members.length, max: ALLIANCE_MAX_MEMBERS })),
    figure(t('al.row.fleet'), fm.num(totals.fleet), null),
    figure(t('al.online'), fm.num(totals.online), null)));

  const members = panel({ title: t('al.members.title'), action: t('al.members.sub', { n: a.members.length, max: ALLIANCE_MAX_MEMBERS }), id: 'al-members', class: 'rp-main' },
    h('ul', { class: 'al-list', role: 'list' }, a.members.map((m) => memberRow(m, m.name === you))));
  const votes = panel({ title: t('al.votes.title'), id: 'al-votes', class: 'rp-main' },
    a.votes.length === 0 ? h('p', { class: 'dim' }, t('al.votes.none')) : h('ul', { class: 'al-list', role: 'list' }, a.votes.map((v) => voteRow(v, a, cast))));

  const invite = panel({ title: t('al.invite.title'), id: 'al-invite' },
    h('p', { class: 'muted' }, t('al.invite.body')), name.root,
    refusal ? h('p', { class: 'cr-refusal', role: 'alert' }, icon('triangle-alert', 14), ' ', t(PROPOSE_KEY[refusal])) : null,
    h('div', { class: 'row' }, button(t('al.invite.btn'), { variant: 'primary', icon: 'users', disabled: refusal !== null, onclick: propose })));
  const dues = panel({ title: t('al.dues.title'), id: 'al-dues' },
    h('p', { class: 'muted' }, t('al.dues.body', { pct: ALLIANCE_DUES_PCT, revenue: fm.money(a.dues.revenue), amount: fm.money(a.dues.amount) })));
  const exit = panel({ title: t('al.leave.title'), id: 'al-leave' },
    h('p', { class: 'muted' }, a.leavesAt === null ? t('al.leave.body', { days: ALLIANCE_NOTICE_DAYS }) : t('al.leave.running', { date: fm.date(a.leavesAt) })),
    a.leavesAt === null ? h('div', { class: 'row' }, button(t('al.leave.btn'), { variant: 'danger', icon: 'log-out', onclick: leave })) : h('div', { class: 'row' }, badge('unverified', t('al.leave.running', { date: fm.date(a.leavesAt) }), 'calendar-clock')));

  return {
    title: t('al.title'), scene: 'hubs', tab: 'hubs', back, wide: false,
    view: h('div', { class: 'rp-screen al-screen' }, head, h('div', { class: 'rp-body' }, h('div', { class: 'col', style: 'flex:1;min-width:0' }, members, votes), h('div', { class: 'rp-side' }, invite, dues, exit))),
    hints: [...hints, { key: '↑ ↓', label: t('al.hint.member') }, { key: t('key.enter'), label: t('al.hint.act') }],
  };
}
