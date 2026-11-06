import { aircraftPrice, type AircraftType } from '@opc/shared';
import { api } from '../api.ts';
import { GROUPS, inGroup, isIcaoType, stepGroup, type Group } from '../catalogue.ts';
import { badge, button, dataTable, icon, keycap, panel, segments } from '../components.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import { hashFor } from '../keys.ts';
import type { Key } from '../messages.ts';
import type { Ctx, Screen } from '../screen.ts';
import { debounce, h } from '../ui.ts';
import { categoryName } from './fleet.ts';

/** Types most players look for first, shown before they type anything; the catalogue itself is searched by the server. */
const SHORTLIST = ['C172', 'SR22', 'BE58', 'C208', 'PC12', 'TBM9', 'B350', 'AT76', 'DH8D', 'E170', 'A320', 'B738', 'B788', 'R44'];

let query = '';
let group: Group = 'all';

export async function catalogue(ctx: Ctx): Promise<Screen> {
  const { snap, go } = ctx;
  const { me } = snap;
  const fm = fmt();
  const results = h('div', { class: 'panel-fill', 'aria-live': 'polite' });
  const count = h('span', { class: 'muted' });
  const search = h('input', { id: 'cat-search', type: 'search', name: 'type-search', autocomplete: 'off', spellcheck: 'false', 'aria-label': t('cat.search'), placeholder: t('cat.searchScope'), value: query });

  async function fetchTypes(): Promise<AircraftType[]> {
    const q = query.trim();
    if (q === '') return (await Promise.all(SHORTLIST.map((icao) => api<AircraftType>(`/aircraft-types/${icao}`).catch(() => null)))).filter((x): x is AircraftType => x !== null);
    return api<AircraftType[]>(`/aircraft-types?q=${encodeURIComponent(q)}`).catch(() => []);
  }
  let seq = 0;
  async function draw(): Promise<void> {
    const my = ++seq;
    const all = await fetchTypes();
    if (my !== seq) return;
    const types = all.filter((x) => inGroup(x, group));
    count.textContent = tp('cat.summary', types.length);
    const rows = types.map((x) => ({
      label: `${x.name} (${x.icao})`,
      onOpen: () => go(hashFor('buy', x.icao)),
      cells: [
        h('div', { class: 'col tight' }, h('div', { class: 'row tight' }, h('span', { class: 'strong' }, x.name), h('span', { class: 'icao-chip' }, x.icao), x.derived ? badge('estimated', t('badge.estimated'), null) : null)),
        categoryName(x.category), String(x.seats), fm.num(x.rangeNm), h('span', { class: 'strong' }, fm.money(aircraftPrice(x))),
      ],
    }));
    const empty = h('div', { class: 'col', style: 'padding:22px' }, h('p', { class: 'muted' }, t('cat.noMatch', { q: query })), h('p', { class: 'dim small' }, t('cat.exact')),
      isIcaoType(query) ? button(`${t('hint.buy')} ${query.trim().toUpperCase()}`, { variant: 'secondary', onclick: () => go(hashFor('buy', query.trim().toUpperCase())) }) : null);
    results.replaceChildren(dataTable(t('cat.panel'), [{ label: t('cat.col.type') }, { label: t('cat.col.category') }, { label: t('cat.col.seats') }, { label: t('cat.col.range') }, { label: t('cat.col.price'), align: 'end' }], rows, empty));
  }
  const groupBar = h('div', { class: 'category-row' }, keycap('Z'), h('div', { class: 'seg-host' }), keycap('C'));
  const drawGroups = (): void => groupBar.querySelector('.seg-host')!.replaceChildren(segments(t('cat.groups'), GROUPS.map((g) => ({ value: g, label: t(`cat.group.${g}` as Key) })), group, setGroup));
  function setGroup(g: Group): void { group = g; drawGroups(); void draw(); }
  drawGroups();
  search.addEventListener('input', debounce(() => { query = (search as HTMLInputElement).value; void draw(); }, 200));
  await draw();

  const view = h('div', { class: 'catalogue-column' },
    h('div', { class: 'title-row' }, h('div', { class: 'title-block' }, h('div', { class: 'status-line' }, t('cat.status')), h('h1', { class: 'title' }, t('cat.title'))), query.trim() === '' ? h('span', { class: 'dim small' }, t('cat.shortlist')) : null),
    h('section', { class: 'panel grow', 'aria-label': t('cat.panel') },
      h('div', { class: 'toolbar' },
        h('div', { class: 'search-row' }, h('div', { class: 'input-field' }, icon('search', 16), search, count, keycap('/'))),
        groupBar),
      results));
  return {
    title: t('cat.title'), scene: 'catalogue', tab: 'fleet', view, back: '#fleet',
    hints: [{ key: t('key.esc'), label: t('hint.fleet') }, { key: '/', label: t('hint.search') }, { key: 'Z C', label: t('hint.category') }, { key: t('key.enter'), label: t('hint.select') }],
    keys: { '/': () => { document.getElementById('cat-search')?.focus(); }, z: () => setGroup(stepGroup(group, -1)), c: () => setGroup(stepGroup(group, 1)) },
  };
}
