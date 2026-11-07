import { HUB_PRICE } from '@opc/shared';
import { act } from '../actions.ts';
import { api } from '../api.ts';
import { airportField } from '../airport-field.ts';
import { airportInfo, cityOf } from '../airports.ts';
import { button, panel, titleBlock } from '../components.ts';
import { fmt } from '../format.ts';
import { t } from '../i18n.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h } from '../ui.ts';

export async function hubs(ctx: Ctx): Promise<Screen> {
  const { me } = ctx.snap;
  const fm = fmt();
  const infos = await Promise.all(me.hubs.map(async (code) => ({ code, info: await airportInfo(code) })));
  const field = airportField(t('hub.code'));
  const canAfford = me.company.balance >= HUB_PRICE;
  const submit = button(t('fleet.buyHub'), { variant: 'primary', type: 'submit', disabled: !canAfford, key: canAfford ? t('key.enter') : undefined });
  const after = h('p', { class: 'dim small' }, t('hub.after', { balance: fm.money(me.company.balance - HUB_PRICE) }));
  const form = h('form', { class: 'col', onsubmit: (e: Event) => {
    e.preventDefault();
    const icao = field.input.value.trim().toUpperCase();
    void act(t('hub.opened', { icao }), () => api('/me/hubs', { method: 'POST', body: { icao } }), ctx.refresh);
  } }, field.root, after, h('div', { class: 'row' }, submit));
  const view = h('div', { class: 'briefing-column' },
    titleBlock(t('hub.status', { company: me.company.name }), t('hub.title')),
    panel({ title: t('hub.list'), action: t('hub.listSub') }, h('ul', { class: 'plain hub-rows' }, infos.map(({ code, info }, i) =>
      h('li', { class: 'hub-row' }, h('span', { class: 'mono strong' }, code), h('span', { class: 'col tight' }, h('span', null, info?.name ?? code), h('span', { class: 'dim small' }, info ? `${cityOf(info)} · ${t(`hub.size.${info.size}`)}` : '')), i === 0 ? h('span', { class: 'dim small' }, t('hub.main')) : null)))),
    panel({ title: t('hub.open'), action: t('hub.openSub', { price: fm.money(HUB_PRICE) }) }, form));
  return { title: t('hub.title'), scene: 'hubs', tab: 'hubs', view, back: '#dashboard', hints: [{ key: t('key.esc'), label: t('hint.dashboard') }, { key: t('key.enter'), label: t('hint.create') }] };
}
