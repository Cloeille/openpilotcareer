import type { FleetAircraft } from '@opc/shared';
import { fleetSummary } from '../catalogue.ts';
import { badge, button, dataTable, line, panel } from '../components.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import type { Key } from '../messages.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h } from '../ui.ts';

let selected: number | null = null;

const status = (a: FleetAircraft): HTMLElement => h('span', { class: 'status-line' }, h('span', { class: a.busy ? 'dot route' : 'dot' }), a.busy ? t('fleet.inFlight') : t('fleet.available'));
export const categoryName = (c: string): string => t(`cat.${c}` as Key);

export function fleet(ctx: Ctx): Screen {
  const { snap, go } = ctx;
  const { me } = snap;
  const fm = fmt();
  if (me.fleet.length === 0) go('#catalogue');
  const { total, available } = fleetSummary(me.fleet);
  const sorted = [...me.fleet].sort((a, b) => Number(a.busy) - Number(b.busy) || a.icao.localeCompare(b.icao) || a.id - b.id);
  if (selected === null || !sorted.some((a) => a.id === selected)) selected = sorted[0]?.id ?? null;

  const detail = h('div', { class: 'detail-host' });
  const showDetail = (a: FleetAircraft | undefined): void => {
    if (!a) { detail.replaceChildren(h('p', { class: 'dim' }, t('fleet.pick'))); return; }
    selected = a.id;
    detail.replaceChildren(
      h('div', { class: 'col tight' },
        h('h2', { class: 'reg' }, `${a.icao} #${a.id}`),
        h('span', { class: 'muted' }, `${a.type.name} · ${categoryName(a.type.category)}`),
        h('div', { class: 'row tight' }, status(a), a.type.derived ? badge('estimated', t('badge.estimated'), null) : null)),
      h('div', { class: 'col' },
        line(t('fleet.position'), h('span', { class: 'mono' }, a.location)),
        line(t('fleet.capacity'), t('fleet.capacityV', { seats: a.type.seats, cargo: fm.kg(a.type.cargoKg) })),
        line(t('fleet.perf'), `${fm.kt(a.type.cruiseKts)} / ${fm.nm(a.type.rangeNm)}`),
        line(t('fleet.value'), fm.money(a.value))));
  };
  showDetail(me.fleet.find((a) => a.id === selected));

  const rows = sorted.map((a) => ({
    label: `${a.icao} #${a.id}`,
    selected: a.id === selected,
    onFocus: () => showDetail(a),
    onOpen: () => { showDetail(a); },
    cells: [
      h('div', { class: 'col tight' }, h('span', { class: 'reg-sm' }, `${a.icao} #${a.id}`), h('span', { class: 'dim small' }, `${a.type.name} · ${categoryName(a.type.category)}`)),
      h('span', { class: 'mono dim' }, a.location), status(a), fm.money(a.value),
    ],
  }));

  const view = h('div', { class: 'fleet-layout' },
    h('div', { class: 'fleet-left' },
      h('div', { class: 'title-row' },
        h('div', { class: 'title-block' }, h('div', { class: 'status-line' }, t('fleet.status', { company: me.company.name })), h('h1', { class: 'title' }, t('fleet.title'))),
        h('span', { class: 'muted' }, tp('fleet.summary', total, { free: available }))),
      panel({ title: t('fleet.panel'), action: t('fleet.sort'), class: 'grow' },
        dataTable(t('fleet.panel'), [{ label: t('fleet.col.aircraft') }, { label: t('fleet.col.base') }, { label: t('fleet.col.status') }, { label: t('fleet.col.value'), align: 'end' }], rows, h('p', { class: 'dim' }, t('fleet.empty')))),
      h('div', { class: 'row' },
        button(t('fleet.buy'), { variant: 'primary', icon: 'plus', key: 'A', onclick: () => go('#catalogue') }),
        button(t('fleet.buyHub'), { variant: 'secondary', onclick: () => go('#hubs') }),
        button(t('fleet.custom'), { variant: 'ghost', onclick: () => go('#custom') }),
        h('span', { class: 'spacer' }), h('span', { class: 'dim small' }, t('fleet.hubs', { list: me.hubs.join(', ') })))),
    h('aside', { class: 'panel detail-panel', 'aria-label': t('fleet.detail') },
      h('div', { class: 'panel-head' }, h('h2', null, t('fleet.detail')), h('div', { class: 'panel-action' }, t('fleet.sheet'))), h('div', { class: 'panel-body' }, detail)));
  return {
    title: t('tab.fleet'), scene: 'fleet', tab: 'fleet', view, back: '#dashboard',
    hints: [{ key: t('key.esc'), label: t('hint.dashboard') }, { key: '↑ ↓', label: t('hint.browse') }, { key: 'A', label: t('fleet.buy') }],
    keys: { a: () => go('#catalogue') },
  };
}
