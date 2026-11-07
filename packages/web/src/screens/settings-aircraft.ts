// Settings › Simulator aircraft: what the bridge found in MSFS (official and add-ons), what the catalogue offers from it, a per-aircraft hide/show,
// and the type picker for the aircraft the scan could not type (the player's choice survives a new scan).
import { act } from '../actions.ts';
import { getSimAircraft, hideSimAircraft, searchPickableTypes, setSimAircraftType } from '../api-simair.ts';
import { isIcaoType } from '../catalogue.ts';
import { badge, button, dataTable, panel, segments } from '../components.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import type { Ctx } from '../screen.ts';
import { filterRows, rowsOf, summaryOf, type RowFilter, type SimRow } from '../simair-view.ts';
import { debounce, h } from '../ui.ts';

const redraw = (): void => { window.dispatchEvent(new Event('opc:redraw')); };

/** The filter outlives a redraw: assigning a type reloads the screen and the player stays on the list they were working through.
 *  A row's type control keeps one id (`sa-type-<row>`) whether it is the picker or the clear button, so the focus a redraw restores lands on the control that replaced it. */
let filter: RowFilter = 'all';
const TYPES_ID = 'sa-types';

/** Type search of the picker: the curated catalogue types matching what is typed, offered as the options of the shared datalist. */
function typePicker(r: SimRow, i: number, options: HTMLElement): HTMLElement {
  const input = h('input', { type: 'search', id: `sa-type-${i}`, list: TYPES_ID, name: 'type-search', autocomplete: 'off', spellcheck: 'false', 'aria-label': t('sa.pickLabel', { title: r.title }), placeholder: t('sa.pick') });
  const assign = button(t('sa.assign'), { type: 'submit', variant: 'secondary', label: t('sa.assignLabel', { title: r.title }), disabled: true });
  let seq = 0;
  const look = debounce(() => {
    const q = input.value.trim(), my = ++seq;
    void (q === '' ? Promise.resolve([]) : searchPickableTypes(q)).then((types) => { if (my === seq) options.replaceChildren(...types.map((x) => h('option', { value: x.icao, label: x.name }))); });
  }, 200);
  input.addEventListener('input', () => { assign.disabled = !isIcaoType(input.value); look(); });
  return h('form', { class: 'row tight', onsubmit: (e: Event) => {
    e.preventDefault();
    const icao = input.value.trim().toUpperCase();
    input.focus();
    if (isIcaoType(icao)) void act(t('sa.assignedDone'), () => setSimAircraftType(r.title, icao), async () => redraw());
  } }, h('div', { class: 'input-field inline' }, input), assign);
}

function typeCell(r: SimRow, i: number, options: HTMLElement): HTMLElement {
  if (!r.type) return typePicker(r, i, options);
  const clear = h('button', { type: 'button', class: 'link-btn', id: `sa-type-${i}`, 'aria-label': t('sa.clearLabel', { title: r.title }),
    onclick: () => void act(t('sa.clearedDone'), () => setSimAircraftType(r.title, null), async () => redraw()) }, t('sa.clear'));
  return h('div', { class: 'row tight' }, h('span', { class: 'model' }, r.type.name), h('span', { class: 'icao-chip' }, r.type.icao), r.estimated ? badge('estimated', t('badge.estimated'), null) : null,
    r.manual ? badge('neutral', t('sa.manual'), null) : null, r.manual ? clear : null);
}

function rowCells(r: SimRow, i: number, options: HTMLElement): HTMLElement[] {
  const hide = r.state !== 'hidden';
  const action = button(hide ? t('sa.hide') : t('sa.show'), {
    variant: 'ghost', label: hide ? t('sa.hideLabel', { title: r.title }) : t('sa.showLabel', { title: r.title }),
    onclick: () => void act(hide ? t('sa.hiddenDone') : t('sa.shownDone'), () => hideSimAircraft(r.title, hide), async () => redraw()),
  });
  action.id = `sa-row-${i}`;
  return [
    h('div', { class: 'col', style: 'gap:2px' }, h('span', { class: 'strong' }, r.title),
      h('span', { class: 'dim small' }, [r.detail, t(r.source === 'official' ? 'sa.source.official' : 'sa.source.community'), tp('sa.liveries', r.liveries)].filter((x) => x !== '').join(' · '))),
    typeCell(r, i, options),
    h('span', { class: r.state === 'offered' ? '' : 'dim' }, r.state === 'offered' ? t('sa.state.offered') : r.state === 'hidden' ? t('sa.state.hidden') : t('sa.state.noType')),
    action,
  ];
}

export async function simairSection(ctx: Ctx): Promise<{ panel: HTMLElement }> {
  const list = await getSimAircraft().catch(() => null);
  const rows = list ? rowsOf(list, ctx.snap.me.customAircraft) : [];
  const fm = fmt();
  const rescan = h('div', { class: 'privacy-note' }, h('p', { class: 'strong' }, t('sa.rescanTitle')), h('p', { class: 'muted small' }, t('sa.rescan')),
    h('code', { class: 'key-box', tabindex: 0, 'aria-label': t('sa.rescanCommand') }, 'opc-bridge scan-aircraft'));

  if (list === null) return { panel: panel({ title: t('sa.title'), id: 'sim-aircraft-panel', class: 'settings-aircraft' }, h('p', { class: 'error-text', role: 'alert' }, t('sa.unavailable')), rescan) };
  if (rows.length === 0) {
    return { panel: panel({ title: t('sa.title'), id: 'sim-aircraft-panel', class: 'settings-aircraft' }, h('p', { class: 'muted intro-text' }, t('sa.intro')), h('p', { class: 'strong' }, t('sa.emptyTitle')), h('p', { class: 'muted' }, t('sa.empty')), rescan) };
  }
  const sum = summaryOf(rows);
  if (filter === 'noType' && sum.noType === 0) filter = 'all';
  const options = h('datalist', { id: TYPES_ID });
  const listHost = h('div', { class: 'sim-aircraft-list' });
  const filterHost = h('div', { class: 'row wrap' });
  const draw = (): void => {
    const shown = filterRows(rows, filter);
    filterHost.replaceChildren(segments(t('sa.filter'), [{ value: 'all', label: t('sa.filter.all', { n: sum.total }) }, { value: 'noType', label: t('sa.filter.noType', { n: sum.noType }) }], filter, (v) => { filter = v; draw(); filterHost.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus(); }),
      ...(sum.noType > 0 ? [h('span', { class: 'dim small' }, t('sa.noTypeHint'))] : []));
    listHost.replaceChildren(dataTable(t('sa.list'), [{ label: t('sa.col.sim') }, { label: t('sa.col.type') }, { label: t('sa.col.state') }, { label: t('sa.col.action'), align: 'end' }],
      shown.map((r) => ({ cells: rowCells(r, rows.indexOf(r), options), label: r.title }))));
  };
  draw();
  return { panel: panel({ title: t('sa.title'), id: 'sim-aircraft-panel', class: 'settings-aircraft', action: h('span', { class: 'dim' }, tp('sa.count', sum.total)) },
    h('p', { class: 'muted intro-text' }, t('sa.intro')),
    h('p', { class: 'dim small', role: 'status' }, t('sa.scanned', { when: list.scannedAt === null ? '–' : fm.dateTime(list.scannedAt), count: tp('sa.count', sum.total) }), ' · ', t('sa.summary', { offered: sum.offered, hidden: sum.hidden, official: sum.official, community: sum.community })),
    filterHost, listHost, options,
    rescan) };
}
