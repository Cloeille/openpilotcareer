import type { GroupCompany } from '@opc/shared';
import { fetchGroup } from '../api-group.ts';
import { session } from '../api.ts';
import { badge, button, icon, panel, signLocation, titleBlock } from '../components.ts';
import { errorText } from '../error-text.ts';
import { locale } from '../finance-ui.ts';
import { fmt } from '../format.ts';
import { ACTIVITY_KEY, CREATE_REFUSAL_KEY, ROLE_KEY, subsidiariesOf } from '../group-view.ts';
import { groupOff, needSubsidiary } from '../group-ui.ts';
import { t, tp } from '../i18n.ts';
import { figure, signedMoney } from '../reports-ui.ts';
import { monthName } from '../reports-view.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h, notify } from '../ui.ts';

/** `#group`: the companies added up (cash, the last closed month's result, aircraft, people, lines: the sums of each company's own figures) and one card per company. Enter on a card switches to that company. */
export async function group(ctx: Ctx): Promise<Screen> {
  const { go } = ctx;
  const back = '#hubs';
  const data = await fetchGroup();
  if (!data) return { title: t('gr.title'), scene: 'hubs', tab: 'hubs', back, hints: [{ key: t('key.esc'), label: t('st.hint.company') }], view: groupOff() };

  const fm = fmt(), loc = locale();
  const active = ctx.snap.me.company.id;
  const subs = subsidiariesOf(data);
  const total = data.total;

  const open = (c: GroupCompany): void => {
    if (c.id === active) return;
    session.company = c.id;
    void ctx.refresh().catch((e) => notify(errorText(e), 'error'));
  };
  const canNew = data.createRefusal === null, canTransfer = subs.length > 0;
  const toNew = (): void => { if (canNew) go('#group/new'); };
  const toTransfers = (): void => { if (canTransfer) go('#group/transfers'); };

  const header = h('div', { class: 'ln-header rp-header' },
    titleBlock(h('span', { class: 'row tight' }, h('span', { class: 'dot' }), h('span', null, `${t('gr.crumb')} · ${tp('gr.entry.count', subs.length)}`)), t('gr.title'), h('p', { class: 'muted', style: 'font-size:14px' }, t('gr.sub'))),
    h('div', { class: 'rp-figures' },
      figure(t('gr.stat.balance'), fm.money(total.balance), t('gr.stat.balance.sub')),
      figure(t('gr.stat.result', { month: monthName(data.month, loc, false) }), signedMoney(total.result), t('gr.stat.result.sub')),
      figure(t('gr.stat.aircraft'), fm.num(total.aircraft), null),
      figure(t('gr.stat.staff'), fm.num(total.staff), null),
      figure(t('gr.stat.lines'), fm.num(total.lines), null)));

  const card = (c: GroupCompany): HTMLElement => h('li', {
    class: `gp-card${c.id === active ? ' on' : ''}`, 'data-row': '', tabindex: 0, 'aria-current': c.id === active ? 'true' : null,
    'aria-label': t('gr.card.label', { name: c.name, role: t(ROLE_KEY[c.role]), balance: fm.money(c.balance) }), onclick: () => open(c),
  },
  h('div', { class: 'gp-card-head' },
    h('div', { class: 'col tight' }, h('h3', { class: 'gp-name' }, c.name),
      h('p', { class: 'dim small row tight' }, c.hub ? signLocation(c.hub) : null, h('span', null, [c.code, c.iata, c.activity ? t(ACTIVITY_KEY[c.activity]) : null].filter((x) => x !== null).join(' · ')))),
    h('div', { class: 'row tight' }, badge(c.role === 'parent' ? 'info' : 'neutral', t(ROLE_KEY[c.role]), c.role === 'parent' ? 'building-2' : null), c.id === active ? badge('verified', t('gr.card.active'), 'circle-check') : null)),
  h('div', { class: 'gp-figs' },
    figure(t('gr.card.balance'), fm.money(c.balance), null),
    figure(t('gr.card.result'), signedMoney(c.month.result), null),
    figure(t('gr.card.aircraft'), fm.num(c.aircraft), null),
    figure(t('gr.card.staff'), fm.num(c.staff), null),
    figure(t('gr.card.lines'), fm.num(c.lines), null)));

  const cards = panel({ title: t('gr.structure'), action: t('gr.structure.sub', { month: monthName(data.month, loc, false) }), id: 'gr-cards', class: 'rp-main' }, h('ul', { class: 'gp-cards', role: 'list' }, data.companies.map(card)));
  const side = h('div', { class: 'rp-side' },
    panel({ title: t('gr.btn.new'), id: 'gr-new' },
      h('p', { class: 'muted' }, t('gr.new.body')),
      data.createRefusal ? h('p', { class: 'cr-refusal', role: 'alert' }, icon('triangle-alert', 14), ' ', t(CREATE_REFUSAL_KEY[data.createRefusal])) : null,
      h('div', { class: 'row' }, button(t('gr.btn.new'), { variant: 'primary', icon: 'building-2', key: 'N', disabled: !canNew, onclick: toNew }))),
    canTransfer
      ? panel({ title: t('gr.btn.transfers'), id: 'gr-transfers' }, h('p', { class: 'muted' }, t('gr.transfers.body')), h('div', { class: 'row' }, button(t('gr.btn.transfers'), { variant: 'secondary', icon: 'arrow-right', key: 'T', onclick: toTransfers })))
      : needSubsidiary());

  return {
    title: t('gr.title'), scene: 'hubs', tab: 'hubs', back, wide: false,
    view: h('div', { class: 'rp-screen gp-screen' }, header, h('div', { class: 'rp-body' }, cards, side)),
    hints: [{ key: t('key.esc'), label: t('st.hint.company') }, { key: '↑ ↓', label: t('gr.hint.company') }, { key: t('key.enter'), label: t('gr.hint.open') }, { key: 'N', label: t('gr.hint.new') }, ...(canTransfer ? [{ key: 'T', label: t('gr.hint.transfers') }] : [])],
    keys: { n: toNew, t: toTransfers },
  };
}
