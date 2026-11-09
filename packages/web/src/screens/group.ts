import type { GroupCompany } from '@opc/shared';
import { fetchGroup } from '../api-group.ts';
import { session } from '../api.ts';
import { badge, button, panel, signLocation, titleBlock } from '../components.ts';
import { errorText } from '../error-text.ts';
import { locale } from '../finance-ui.ts';
import { fmt } from '../format.ts';
import { ACTIVITY_KEY, CREATE_REFUSAL_KEY, ROLE_KEY, parentOf, subsidiariesOf } from '../group-view.ts';
import { groupOff } from '../group-ui.ts';
import { t, tp } from '../i18n.ts';
import { figure, signedMoney } from '../reports-ui.ts';
import { monthName } from '../reports-view.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h, notify } from '../ui.ts';
import { pickSubsidiary } from './group-transfers.ts';

type Sums = { balance: number; result: number; aircraft: number; staff: number; lines: number };

/** `#group`: the parent, its subsidiaries under it, and the group added up at the bottom. One row of figures per company; Enter on a row switches to that company. */
export async function group(ctx: Ctx): Promise<Screen> {
  const { go } = ctx;
  const back = '#hubs';
  const data = await fetchGroup();
  if (!data) return { title: t('gr.title'), scene: 'hubs', tab: 'hubs', back, hints: [{ key: t('key.esc'), label: t('st.hint.company') }], view: groupOff() };

  const fm = fmt();
  const active = ctx.snap.me.company.id;
  const subs = subsidiariesOf(data);
  const canNew = data.createRefusal === null, canTransfer = subs.length > 0;

  const open = (c: GroupCompany): void => {
    if (c.id === active) return;
    session.company = c.id;
    void ctx.refresh().catch((e) => notify(errorText(e), 'error'));
  };
  const toNew = (): void => { if (canNew) go('#group/new'); };
  const toTransfers = (): void => { if (canTransfer) go('#group/transfers'); };
  const transferWith = (c: GroupCompany): void => { pickSubsidiary(c.id); go('#group/transfers'); };

  const labels = [t('gr.card.balance'), t('gr.stat.result', { month: monthName(data.month, locale(), false) }), t('gr.card.aircraft'), t('gr.card.staff'), t('gr.card.lines')];
  const figures = (s: Sums): HTMLElement => h('div', { class: 'gp-figs' },
    [fm.money(s.balance), signedMoney(s.result), fm.num(s.aircraft), fm.num(s.staff), fm.num(s.lines)].map((v, i) => figure(labels[i]!, v, null)));
  const sums = (c: GroupCompany): Sums => ({ balance: c.balance, result: c.month.result, aircraft: c.aircraft, staff: c.staff, lines: c.lines });

  const row = (c: GroupCompany): HTMLElement => {
    const isSub = c.role === 'subsidiary', on = c.id === active;
    const detail = [c.code, c.iata, c.activity ? t(ACTIVITY_KEY[c.activity]) : null].filter((x) => x !== null).join(' · ');
    return h('div', {
      class: `gp-row${isSub ? '' : ' gp-parent'}${on ? ' on' : ''}`, role: 'group', 'data-row': '', tabindex: 0, 'aria-current': on ? 'true' : null,
      'aria-label': t('gr.card.label', { name: c.name, role: t(ROLE_KEY[c.role]), balance: fm.money(c.balance) }),
      onclick: (e: MouseEvent) => { if (!(e.target as Element).closest('button')) open(c); },
    },
    h('div', { class: 'gp-id' },
      h('div', { class: 'row tight' }, h('h3', { class: 'gp-name' }, c.name), badge(isSub ? 'neutral' : 'info', t(ROLE_KEY[c.role]), isSub ? null : 'building-2')),
      h('p', { class: 'dim small row tight' }, c.hub ? signLocation(c.hub) : null, h('span', null, detail))),
    figures(sums(c)),
    h('div', { class: 'gp-actions' },
      on ? badge('verified', t('gr.card.active'), 'circle-check') : button(t('gr.btn.open'), { onclick: () => open(c) }),
      isSub ? button(t('gr.btn.transfer'), { variant: 'ghost', icon: 'arrow-right', onclick: () => transferWith(c) }) : null));
  };

  const tree = h('ul', { class: 'gp-tree', role: 'list' },
    h('li', null, row(parentOf(data)),
      canTransfer ? h('ul', { class: 'gp-subs', role: 'list' }, subs.map((c) => h('li', { class: 'gp-sub' }, row(c)))) : null));
  const heading = h('div', { class: 'gp-row gp-head', 'aria-hidden': 'true' }, h('span'), labels.map((l) => h('span', null, l)));
  const total = canTransfer
    ? h('div', { class: 'gp-row gp-total' }, h('div', { class: 'gp-id' }, h('h3', { class: 'gp-name' }, t('gr.total')), h('p', { class: 'dim small' }, t('gr.total.sub'))), figures(data.total), h('div', { class: 'gp-actions' }))
    : null;

  const newWhy = data.createRefusal ? t(CREATE_REFUSAL_KEY[data.createRefusal]) : undefined, transferWhy = canTransfer ? undefined : t('gr.empty.body');
  const header = h('div', { class: 'ln-header rp-header' },
    titleBlock(h('span', { class: 'row tight' }, h('span', { class: 'dot' }), h('span', null, `${t('gr.crumb')} · ${tp('gr.entry.count', subs.length)}`)), t('gr.title'), h('p', { class: 'muted', style: 'font-size:14px' }, t('gr.sub'))),
    h('div', { class: 'gp-top' },
      h('div', { class: 'row' },
        button(t('gr.btn.transfers'), { variant: 'secondary', icon: 'arrow-right', key: 'T', disabled: !canTransfer, title: transferWhy, onclick: toTransfers }),
        button(t('gr.btn.new'), { variant: 'primary', icon: 'building-2', key: 'N', disabled: !canNew, title: newWhy, onclick: toNew })),
      [newWhy, transferWhy].map((r) => (r ? h('p', { class: 'gp-note' }, r) : null))));

  return {
    title: t('gr.title'), scene: 'hubs', tab: 'hubs', back, wide: false,
    view: h('div', { class: 'rp-screen gp-screen' }, header, panel({ title: t('gr.structure'), id: 'gr-structure', class: 'gp-panel' }, h('div', { class: 'gp-scroll' }, heading, tree, total))),
    hints: [{ key: t('key.esc'), label: t('st.hint.company') }, { key: '↑ ↓', label: t('gr.hint.company') }, { key: t('key.enter'), label: t('gr.hint.open') }, { key: 'N', label: t('gr.btn.new') }, ...(canTransfer ? [{ key: 'T', label: t('gr.btn.transfers') }] : [])],
    keys: { n: toNew, t: toTransfers },
  };
}
