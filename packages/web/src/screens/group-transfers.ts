import type { GroupCompany } from '@opc/shared';
import { act } from '../actions.ts';
import { fetchGroup, transferGroup } from '../api-group.ts';
import { badge, button, icon, inputField, panel, titleBlock } from '../components.ts';
import { fmt } from '../format.ts';
import { FUNDING_STEP, ROLE_KEY, cleanTransfer, emptyTransfer, nextSub, sides, stepCash, subsidiariesOf, toggleId, transferRequest, type TransferDraft } from '../group-view.ts';
import { aircraftPicker, companyTag, groupOff, needSubsidiary } from '../group-ui.ts';
import { t } from '../i18n.ts';
import { figure } from '../reports-ui.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h } from '../ui.ts';

/** The draft survives a redraw (a language change, a poll), not a new visit. */
let draft: TransferDraft = emptyTransfer();
const redraw = (): void => { window.dispatchEvent(new Event('opc:redraw')); };

/** `#group/transfers`: cash and aircraft from a parent to its subsidiary or back, validated together (one transaction on the server: all or nothing). Each company shows the server's own figures. */
export async function groupTransfers(ctx: Ctx): Promise<Screen> {
  const { go } = ctx;
  const back = '#group';
  const data = await fetchGroup();
  if (!data) return { title: t('gr.t.title'), scene: 'hubs', tab: 'hubs', back, hints: [{ key: t('key.esc'), label: t('gr.title') }], view: groupOff() };
  const hints = [{ key: t('key.esc'), label: t('gr.title') }];
  if (subsidiariesOf(data).length === 0) return { title: t('gr.t.title'), scene: 'hubs', tab: 'hubs', back, hints, view: h('div', { class: 'rp-screen gp-screen' }, needSubsidiary()) };

  draft = cleanTransfer(data, draft);
  const d = draft;
  const s = sides(data, d)!;
  const request = transferRequest(data, d);
  const fm = fmt();
  const subs = subsidiariesOf(data);

  const submit = (): void => {
    if (!request) return;
    void act(t('gr.t.done', { from: s.from.name, to: s.to.name }), () => transferGroup(request), ctx.refresh).then((ok) => { if (ok) { draft = { ...d, cash: 0, aircraft: [] }; redraw(); } });
  };
  const reverse = (): void => { draft = { ...d, reversed: !d.reversed, aircraft: [] }; redraw(); };
  const other = (): void => { const sub = nextSub(data, d.sub); if (sub !== null && sub !== d.sub) { draft = { ...d, sub, aircraft: [] }; redraw(); } };

  const side = (c: GroupCompany, gives: boolean): HTMLElement => panel({ title: companyTag(c), action: badge(c.role === 'parent' ? 'info' : 'neutral', t(ROLE_KEY[c.role]), null), id: `gr-side-${gives ? 'from' : 'to'}`, class: 'gp-side' },
    h('p', { class: 'dim small' }, gives ? t('gr.t.gives') : t('gr.t.receives')),
    h('div', { class: 'rp-figures' }, figure(t('gr.card.balance'), fm.money(c.balance), null), figure(t('gr.card.aircraft'), fm.num(c.aircraft), null), figure(t('gr.card.staff'), fm.num(c.staff), null)));

  const cash = inputField({ label: t('gr.t.cash'), hint: t('gr.t.cashHint', { name: s.from.name }) },
    { type: 'number', name: 'transfer-cash', min: 0, step: FUNDING_STEP, inputmode: 'numeric', value: String(d.cash), oninput: (e: Event) => { d.cash = Math.max(0, Math.round(Number((e.target as HTMLInputElement).value) || 0)); }, onchange: () => redraw() });
  const money = panel({ title: t('gr.t.money'), id: 'gr-money' }, cash.root, h('p', { class: 'dim small' }, t('gr.t.moneyNote')));

  const aircraft = panel({ title: t('gr.t.aircraft'), action: t('gr.new.aircraftSub', { n: d.aircraft.length }), id: 'gr-t-aircraft' },
    s.from.fleet.length === 0 ? h('p', { class: 'dim' }, t('gr.t.noAircraft', { name: s.from.name })) : aircraftPicker(t('gr.t.aircraft'), s.from.fleet, d.aircraft, (id) => { draft = { ...d, aircraft: toggleId(d.aircraft, id) }; redraw(); }),
    h('p', { class: 'dim small' }, t('gr.t.aircraftNote')));

  const validate = panel({ title: t('gr.t.validate'), id: 'gr-validate' },
    h('p', { class: 'muted' }, t('gr.t.summary', { from: s.from.name, to: s.to.name, amount: fm.money(d.cash), n: d.aircraft.length })),
    h('div', { class: 'row' },
      button(t('gr.t.confirm'), { variant: 'primary', icon: 'arrow-right', key: t('key.enter'), disabled: request === null, onclick: submit }),
      button(t('gr.t.reverse'), { variant: 'secondary', icon: 'arrow-left', key: 'R', onclick: reverse }),
      subs.length > 1 ? button(t('gr.t.other'), { variant: 'secondary', key: 'S', onclick: other }) : null));

  const header = h('div', { class: 'ln-header rp-header' }, titleBlock(h('span', { class: 'row tight' }, h('span', { class: 'dot' }), h('span', null, `${t('gr.crumb')} · ${t('gr.t.crumb')}`)), t('gr.t.title'), h('p', { class: 'muted', style: 'font-size:14px' }, t('gr.t.sub'))));
  const step = (dir: 1 | -1) => (): void => { d.cash = stepCash(d.cash, dir); redraw(); };
  return {
    title: t('gr.t.title'), scene: 'hubs', tab: 'hubs', back, wide: false,
    view: h('div', { class: 'rp-screen gp-screen' }, header, h('div', { class: 'gp-sides' }, side(s.from, true), h('span', { class: 'gp-arrow', 'aria-hidden': 'true' }, icon('arrow-right', 20)), side(s.to, false)), h('div', { class: 'rp-body' }, h('div', { class: 'col rp-main' }, money, aircraft), h('div', { class: 'rp-side' }, validate))),
    hints: [...hints, { key: 'R', label: t('gr.t.hint.reverse') }, { key: '← →', label: t('gr.t.hint.cash') }, { key: t('key.enter'), label: t('gr.t.hint.confirm') }],
    keys: { r: reverse, left: step(-1), right: step(1), ...(subs.length > 1 ? { s: other } : {}) },
  };
}
