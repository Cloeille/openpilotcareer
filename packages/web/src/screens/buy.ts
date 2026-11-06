import type { AircraftType } from '@opc/shared';
import { act } from '../actions.ts';
import { api } from '../api.ts';
import { airportInfo, cityOf } from '../airports.ts';
import { quote } from '../catalogue.ts';
import { badge, button, line, panel, titleBlock } from '../components.ts';
import { fmt } from '../format.ts';
import { t } from '../i18n.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h } from '../ui.ts';
import { categoryName } from './fleet.ts';

/** Purchase of one aircraft type: choose the hub it is delivered to, see what it does to the balance, confirm. With too little money the same route turns into the "insufficient funds" explanation. */
export async function buy(ctx: Ctx): Promise<Screen> {
  const { snap, go, arg } = ctx;
  const { me } = snap;
  const back = '#catalogue';
  const type = arg ? await api<AircraftType>(`/aircraft-types/${encodeURIComponent(arg)}`).catch(() => null) : null;
  const custom = me.customAircraft.find((c) => c.icao === arg);
  const chosen = custom ?? type;
  if (!chosen) return { title: t('buy.unknown'), scene: 'catalogue', tab: 'fleet', back, hints: [{ key: t('key.esc'), label: t('hint.catalogue') }], view: h('p', { class: 'error-text', role: 'alert' }, t('buy.unknown')) };
  const fm = fmt();
  const q = quote(chosen, me.company.balance);
  const sub = t('buy.sub', { cat: categoryName(chosen.category), seats: chosen.seats, cargo: fm.kg(chosen.cargoKg), kt: fm.kt(chosen.cruiseKts), nm: fm.nm(chosen.rangeNm) });
  const titleExtra = h('div', { class: 'row tight' }, h('p', { class: 'route-line-text' }, sub), chosen.derived ? badge('estimated', t('badge.estimated'), null) : null);

  if (!q.affordable) {
    const view = h('div', { class: 'checkout' },
      h('div', { class: 'col-wide' },
        titleBlock(h('span', { class: 'status-line warn' }, h('span', { class: 'dot warn' }), t('buy.broke.status')), chosen.name, titleExtra),
        panel({ title: t('buy.broke.panel') },
          h('div', { class: 'next-action' }, h('div', { class: 'col tight' }, h('span', { class: 'strong' }, t('buy.broke.fly')), h('span', { class: 'dim small' }, t('buy.broke.flySub', { missing: fm.money(q.missing) }))),
            button(t('buy.broke.jobs'), { variant: 'secondary', onclick: () => go('#jobs') })),
          h('div', { class: 'next-action' }, h('div', { class: 'col tight' }, h('span', { class: 'strong' }, t('buy.broke.cheaper')), h('span', { class: 'dim small' }, t('buy.broke.cheaperSub'))),
            button(t('buy.broke.catalogue'), { variant: 'secondary', onclick: () => go(back) })))),
      panel({ title: t('buy.summary'), class: 'summary' },
        line(t('buy.price'), fm.money(q.price)),
        h('hr', { class: 'divider' }),
        h('div', { class: 'missing' }, h('span', { class: 'line-label' }, t('buy.broke.missing')), h('span', { class: 'big-money' }, fm.money(q.missing))),
        line(t('buy.balance'), fm.money(me.company.balance)),
        h('div', { class: 'coverage', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(q.coverage * 100), 'aria-label': t('buy.broke.cover', { pct: fm.percent(q.coverage) }) }, h('span', { style: `width:${Math.round(q.coverage * 100)}%` })),
        h('p', { class: 'dim small' }, t('buy.broke.cover', { pct: fm.percent(q.coverage) })),
        button(t('buy.broke.back'), { variant: 'secondary', onclick: () => go(back) })));
    return { title: chosen.name, scene: 'catalogue', tab: 'fleet', view, back, hints: [{ key: t('key.esc'), label: t('hint.catalogue') }] };
  }

  const hubs = await Promise.all(me.hubs.map(async (code) => ({ code, info: await airportInfo(code) })));
  let hub = me.hubs[0]!;
  const hubRadios = hubs.map(({ code, info }, i) => {
    const input = h('input', { type: 'radio', name: 'hub', id: `hub-${code}`, value: code, checked: i === 0, onchange: () => { hub = code; } });
    return h('label', { class: 'hub-option', for: `hub-${code}` }, input, h('span', { class: 'mono strong' }, code), h('span', { class: 'col tight' }, h('span', null, info ? `${info.name}` : code), h('span', { class: 'dim small' }, info ? `${cityOf(info)} · ${t(`hub.size.${info.size}`)}` : '')));
  });
  const confirm = (): void => void act(t('buy.done', { aircraft: chosen.name }), () => api('/me/fleet', { method: 'POST', body: { icao: chosen.icao, hub } }), ctx.refresh).then((ok) => { if (ok) go('#fleet'); });
  const view = h('div', { class: 'checkout' },
    h('div', { class: 'col-wide' },
      titleBlock(t('buy.status'), chosen.name, titleExtra),
      panel({ title: t('buy.hub'), action: t('buy.hubSub') }, h('div', { class: 'hub-list', role: 'radiogroup', 'aria-label': t('buy.hub') }, hubRadios), h('p', { class: 'dim small' }, t('buy.hubNote')))),
    panel({ title: t('buy.summary'), action: t('buy.step'), class: 'summary' },
      line(t('buy.price'), fm.money(q.price)),
      line(t('buy.balance'), fm.money(me.company.balance)),
      h('hr', { class: 'divider' }),
      h('div', { class: 'missing' }, h('span', { class: 'line-label' }, t('buy.after')), h('span', { class: 'big-money' }, fm.money(q.balanceAfter))),
      h('div', { class: 'row' }, button(t('buy.cancel'), { variant: 'secondary', onclick: () => go(back) }), button(t('buy.confirm'), { variant: 'primary', key: t('key.enter'), onclick: confirm }))));
  return {
    title: chosen.name, scene: 'catalogue', tab: 'fleet', view, back,
    hints: [{ key: t('key.esc'), label: t('hint.cancel') }, { key: t('key.enter'), label: t('hint.confirm') }],
  };
}
