import { aircraftPrice, deriveAircraft, type AircraftType } from '@opc/shared';
import { act } from '../actions.ts';
import { api } from '../api.ts';
import type { LeaseOffer } from '@opc/shared';
import { catalogueStats, leaseOffers, type CatalogueStats } from '../api-finance.ts';
import { GROUPS, inGroup, isIcaoType, stepGroup, type Group } from '../catalogue.ts';
import { badge, button, dataTable, icon, keycap, panel, segments, unknownValue } from '../components.ts';
import { ADDON_CATEGORY, defaultDuration, type AddonCategory } from '../finance-view.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import { hashFor } from '../keys.ts';
import type { Ctx, Screen } from '../screen.ts';
import { debounce, h } from '../ui.ts';
import { categoryName } from './fleet.ts';

/** Types most players look for first, shown before they type anything; the catalogue itself is searched by the server. */
const SHORTLIST = ['C172', 'SR22', 'BE58', 'C208', 'PC12', 'TBM9', 'B350', 'AT76', 'DH8D', 'E170', 'A320', 'B738', 'B788', 'R44'];
const ADDON_GROUPS: AddonCategory[] = ['piston', 'turboprop', 'jet', 'helicopter'];

let query = '';
let group: Group = 'all';
let selectedIcao: string | null = null;
let addonCategory: AddonCategory = 'turboprop';
const offerCache = new Map<string, Promise<LeaseOffer[]>>();
const offersFor = (icao: string): Promise<LeaseOffer[]> => {
  let p = offerCache.get(icao);
  if (!p) offerCache.set(icao, (p = leaseOffers({ icao }).then((o) => o ?? []).catch(() => [])));
  return p;
};

export async function catalogue(ctx: Ctx): Promise<Screen> {
  const { go } = ctx;
  const fm = fmt();
  const results = h('div', { class: 'panel-fill', 'aria-live': 'polite' });
  const count = h('span', { class: 'muted' });
  const footer = h('div', { class: 'list-footer row' });
  const search = h('input', { id: 'cat-search', type: 'search', name: 'type-search', autocomplete: 'off', spellcheck: 'false', 'aria-label': t('cat.search'), placeholder: t('cat.searchScope'), value: query });
  const stats: CatalogueStats | null = await catalogueStats().catch(() => null);
  let shown: AircraftType[] = [];
  let lastInput: 'keyboard' | 'pointer' = 'pointer';
  results.addEventListener('keydown', () => { lastInput = 'keyboard'; });
  results.addEventListener('pointerdown', () => { lastInput = 'pointer'; });

  async function fetchTypes(): Promise<AircraftType[]> {
    const q = query.trim();
    if (q === '') return (await Promise.all(SHORTLIST.map((icao) => api<AircraftType>(`/aircraft-types/${icao}`).catch(() => null)))).filter((x): x is AircraftType => x !== null);
    return api<AircraftType[]>(`/aircraft-types?q=${encodeURIComponent(q)}`).catch(() => []);
  }

  // ---- right column: the selected type
  const sheet = h('div', { class: 'fin-sheet' });
  const typeOf = (icao: string | null): AircraftType | undefined => shown.find((x) => x.icao === icao);
  let sheetSeq = 0;
  function drawSheet(): void {
    const x = typeOf(selectedIcao);
    if (!x) { sheet.replaceChildren(h('p', { class: 'dim' }, t('fin.cat.pickRow'))); return; }
    const my = ++sheetSeq;
    const leaseValue = h('span', { class: 'fin-price-lease' }, unknownValue());
    const leaseBtn = button(t('fin.cat.lease'), { variant: 'secondary', key: 'L', disabled: true, onclick: () => go(hashFor('lease', x.icao)) });
    void offersFor(x.icao).then((offers) => {
      if (my !== sheetSeq) return;
      const rents = offers.map((o) => defaultDuration(o)?.monthlyRent).filter((r): r is number => typeof r === 'number');
      if (rents.length > 0) { leaseValue.replaceChildren(t('fin.cat.perMonth', { amount: fm.money(Math.min(...rents)) })); leaseBtn.disabled = false; leaseBtn.title = ''; }
      else leaseBtn.title = t('fin.lease.noOffer');
    });
    sheet.replaceChildren(
      h('div', { class: 'col', style: 'gap:6px' },
        h('div', { class: 'fin-model-row' }, h('h2', { class: 'fin-model' }, x.name), h('span', { class: 'icao-chip' }, x.icao), x.derived ? badge('estimated', t('badge.estimated'), null) : null),
        h('p', { class: 'muted' }, categoryName(x.category))),
      h('div', { class: 'fin-facts' },
        fact(t('fin.cat.seats'), String(x.seats)), fact(t('fin.cat.cargo'), fm.kg(x.cargoKg)), fact(t('fin.cat.cruise'), fm.kt(x.cruiseKts)), fact(t('fin.cat.range'), fm.nm(x.rangeNm))),
      h('div', { class: 'fin-totals' },
        h('div', { class: 'col' }, h('span', { class: 'fin-label' }, t('fin.cat.price')), h('span', { class: 'fin-price' }, fm.money(aircraftPrice(x)))),
        h('div', { class: 'col end' }, h('span', { class: 'fin-label' }, t('fin.cat.leaseFrom')), leaseValue)),
      h('div', { class: 'fin-actions' }, leaseBtn, button(t('fin.cat.buyThis'), { variant: 'primary', key: t('key.enter'), onclick: () => go(hashFor('buy', x.icao)) })));
  }
  const fact = (label: string, value: string): HTMLElement => h('div', { class: 'fin-fact' }, h('span', null, label), h('span', null, value));

  let seq = 0;
  async function draw(): Promise<void> {
    const my = ++seq;
    const all = await fetchTypes();
    if (my !== seq) return;
    const types = all.filter((x) => inGroup(x, group));
    shown = types;
    if (!types.some((x) => x.icao === selectedIcao)) selectedIcao = types[0]?.icao ?? null;
    count.textContent = tp('cat.summary', types.length);
    const rows = types.map((x) => ({
      label: `${x.name} (${x.icao})`,
      selected: x.icao === selectedIcao,
      onFocus: () => { selectedIcao = x.icao; markSelected(); drawSheet(); },
      onOpen: () => { if (lastInput === 'keyboard') go(hashFor('buy', x.icao)); },
      cells: [
        h('div', { class: 'fin-row-ident' }, h('div', { class: 'row tight' }, h('span', { class: 'model' }, x.name), h('span', { class: 'icao-chip' }, x.icao), x.derived ? badge('estimated', t('badge.estimated'), null) : null)),
        categoryName(x.category), String(x.seats), fm.num(x.rangeNm), h('span', { class: 'strong' }, fm.money(aircraftPrice(x))),
      ],
    }));
    const empty = h('div', { class: 'col', style: 'padding:22px' }, h('p', { class: 'muted' }, t('cat.noMatch', { q: query })), h('p', { class: 'dim small' }, t('cat.exact')),
      isIcaoType(query) ? button(`${t('hint.buy')} ${query.trim().toUpperCase()}`, { variant: 'secondary', onclick: () => go(hashFor('buy', query.trim().toUpperCase())) }) : null);
    const table = dataTable(t('cat.panel'), [{ label: t('cat.col.type') }, { label: t('cat.col.category') }, { label: t('cat.col.seats'), align: 'end' }, { label: t('cat.col.range'), align: 'end' }, { label: t('cat.col.price'), align: 'end' }], rows, empty);
    table.querySelectorAll('tbody tr').forEach((tr, i) => { tr.setAttribute('data-icao', types[i]!.icao); tr.classList.toggle('est', types[i]!.derived); });
    results.replaceChildren(table);
    footer.replaceChildren(h('span', null, t('fin.cat.shown', { n: types.length, total: stats ? stats.total : types.length })), h('span', { class: 'spacer' }), badge('estimated', t('badge.estimated'), null), h('span', null, t('fin.cat.legend')));
    drawSheet();
  }
  function markSelected(): void {
    results.querySelectorAll('tbody tr').forEach((tr) => tr.setAttribute('aria-selected', String((tr as HTMLElement).dataset.icao === selectedIcao)));
  }
  const groupBar = h('div', { class: 'category-row' }, keycap('Z'), h('div', { class: 'seg-host' }), keycap('C'));
  const drawGroups = (): void => groupBar.querySelector('.seg-host')!.replaceChildren(segments(t('cat.groups'), GROUPS.map((g) => ({ value: g, label: t(`cat.group.${g}`) })), group, setGroup));
  function setGroup(g: Group): void { group = g; drawGroups(); void draw(); }
  drawGroups();
  search.addEventListener('input', debounce(() => { query = (search as HTMLInputElement).value; void draw(); }, 200));
  await draw();

  const view = h('div', { class: 'fin-split' },
    h('div', { class: 'fin-catalogue' },
      h('div', { class: 'title-row' },
        h('div', { class: 'title-block' }, h('div', { class: 'status-line' }, t('cat.status')), h('h1', { class: 'title' }, t('cat.title'))),
        h('span', { class: 'muted' }, stats ? t('fin.cat.summary', { total: fm.num(stats.total), curated: fm.num(stats.curated) }) : (query.trim() === '' ? t('cat.shortlist') : ''))),
      h('section', { class: 'panel grow', 'aria-label': t('cat.panel') },
        h('div', { class: 'panel-head' }, h('h2', null, t('cat.panel')), h('div', { class: 'panel-action' }, t('fin.cat.sort'))),
        h('div', { class: 'toolbar' },
          h('div', { class: 'search-row' }, h('div', { class: 'input-field' }, icon('search', 16), search, count, keycap('/'))),
          groupBar),
        results, footer)),
    h('div', { class: 'fin-purchase' },
      h('section', { class: 'panel', 'aria-label': t('fin.cat.panelLabel') }, h('div', { class: 'panel-body' }, sheet)),
      addonPanel(ctx)));
  return {
    title: t('cat.title'), scene: 'catalogue', tab: 'fleet', view, back: '#fleet',
    hints: [{ key: t('key.esc'), label: t('hint.fleet') }, { key: '/', label: t('hint.search') }, { key: 'L', label: t('fin.hint.lease') }, { key: t('key.enter'), label: t('hint.buy') }],
    keys: {
      '/': () => { document.getElementById('cat-search')?.focus(); },
      z: () => setGroup(stepGroup(group, -1)), c: () => setGroup(stepGroup(group, 1)),
      l: () => { if (selectedIcao) go(hashFor('lease', selectedIcao)); },
    },
  };
}

/** "Ajouter un avion d'addon": a type the catalogue does not know gets the performance of its category and joins the company's own catalogue. */
function addonPanel(ctx: Ctx): HTMLElement {
  const fm = fmt();
  const icao = h('input', { id: 'addon-icao', type: 'text', name: 'addon-icao', maxlength: 4, autocomplete: 'off', spellcheck: 'false', class: 'upper', 'aria-label': t('fin.addon.enter'), placeholder: t('fin.addon.icao') });
  const model = h('input', { id: 'addon-name', type: 'text', name: 'addon-name', maxlength: 80, autocomplete: 'off', 'aria-label': t('fin.addon.name'), placeholder: t('fin.addon.name') });
  const status = h('div', { class: 'status-line', 'aria-live': 'polite' });
  const estimate = h('p', { class: 'fin-estimate' });
  const segHost = h('div');
  const add = button(t('fin.addon.add'), { variant: 'secondary', disabled: true });
  let known: AircraftType | null = null;
  let seq = 0;

  const code = (): string => (icao as HTMLInputElement).value.trim().toUpperCase();
  const derived = (): AircraftType => deriveAircraft({ icao: code() || 'XXXX', name: (model as HTMLInputElement).value.trim() || code() || 'XXXX', category: ADDON_CATEGORY[addonCategory], engines: addonCategory === 'jet' ? 2 : 1, wtc: 'L' });
  function refresh(): void {
    const d = derived();
    estimate.textContent = t('fin.addon.estimate', { seats: d.seats, cargo: fm.kg(d.cargoKg), kt: fm.kt(d.cruiseKts), nm: fm.nm(d.rangeNm) });
    const c = code();
    if (!isIcaoType(c)) status.replaceChildren(h('span', { class: 'dim' }, t('fin.addon.waiting')));
    else if (known) status.replaceChildren(h('span', { class: 'dot' }), t('fin.addon.known', { name: known.name }));
    else status.replaceChildren(h('span', { class: 'dot warn' }), t('fin.addon.unknown'));
    (add as HTMLButtonElement).disabled = !isIcaoType(c) || known !== null;
    segHost.replaceChildren(segments(t('fin.addon.pick'), ADDON_GROUPS.map((g) => ({ value: g, label: t(`cat.group.${g}`) })), addonCategory, (g) => { addonCategory = g; refresh(); }));
  }
  const lookup = debounce(() => {
    const c = code();
    const my = ++seq;
    if (!isIcaoType(c)) { known = null; refresh(); return; }
    void api<AircraftType[]>(`/aircraft-types?q=${encodeURIComponent(c)}`).catch((): AircraftType[] => []).then((list) => {
      if (my !== seq) return;
      known = list.find((x) => x.icao === c) ?? ctx.snap.me.customAircraft.find((x) => x.icao === c) ?? null;
      refresh();
    });
  }, 200);
  icao.addEventListener('input', () => { known = null; refresh(); lookup(); });
  model.addEventListener('input', refresh);
  add.addEventListener('click', () => {
    const d = derived();
    void act(t('fin.addon.added', { icao: d.icao }), () => api('/me/custom-aircraft', { method: 'POST', body: {
      icao: d.icao, name: d.name, category: d.category, engines: d.engines, wtc: d.wtc, seats: d.seats, cargoKg: d.cargoKg, cruiseKts: d.cruiseKts, rangeNm: d.rangeNm } }), ctx.refresh);
  });
  refresh();
  const body = panel({ title: t('fin.addon.title'), id: 'addon' },
    h('div', { class: 'addon-ids' }, h('div', { class: 'input-field', style: 'height:42px' }, icao), h('div', { class: 'input-field', style: 'height:42px' }, model)), status,
    h('div', { class: 'fin-pick' }, h('span', { class: 'fin-label' }, t('fin.addon.pick')), h('span', { class: 'hint' }, t('fin.addon.pickHint')), segHost),
    estimate, add);
  body.querySelector('.panel-body')?.classList.add('addon');
  return body;
}
