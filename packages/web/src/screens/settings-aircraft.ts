// Settings › Simulator aircraft: what the bridge found in MSFS (official and add-ons), what the catalogue offers from it, and a per-aircraft hide/show.
import { act } from '../actions.ts';
import { getSimAircraft, hideSimAircraft } from '../api-simair.ts';
import { badge, button, dataTable, panel } from '../components.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import type { Ctx } from '../screen.ts';
import { rowsOf, summaryOf, type SimRow } from '../simair-view.ts';
import { h } from '../ui.ts';

const redraw = (): void => { window.dispatchEvent(new Event('opc:redraw')); };

function rowCells(r: SimRow, i: number): HTMLElement[] {
  const hide = r.state !== 'hidden';
  const action = button(hide ? t('sa.hide') : t('sa.show'), {
    variant: 'ghost', label: hide ? t('sa.hideLabel', { title: r.title }) : t('sa.showLabel', { title: r.title }),
    onclick: () => void act(hide ? t('sa.hiddenDone') : t('sa.shownDone'), () => hideSimAircraft(r.title, hide), async () => redraw()),
  });
  action.id = `sa-row-${i}`;
  return [
    h('div', { class: 'col', style: 'gap:2px' }, h('span', { class: 'strong' }, r.title),
      h('span', { class: 'dim small' }, [r.detail, t(r.source === 'official' ? 'sa.source.official' : 'sa.source.community'), tp('sa.liveries', r.liveries)].filter((x) => x !== '').join(' · '))),
    r.type
      ? h('div', { class: 'row tight' }, h('span', { class: 'model' }, r.type.name), h('span', { class: 'icao-chip' }, r.type.icao), r.estimated ? badge('estimated', t('badge.estimated'), null) : null)
      : h('span', { class: 'dim' }, t('sa.noType')),
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
  const table = dataTable(t('sa.list'), [{ label: t('sa.col.sim') }, { label: t('sa.col.type') }, { label: t('sa.col.state') }, { label: t('sa.col.action'), align: 'end' }],
    rows.map((r, i) => ({ cells: rowCells(r, i), label: r.title })));
  return { panel: panel({ title: t('sa.title'), id: 'sim-aircraft-panel', class: 'settings-aircraft', action: h('span', { class: 'dim' }, tp('sa.count', sum.total)) },
    h('p', { class: 'muted intro-text' }, t('sa.intro')),
    h('p', { class: 'dim small', role: 'status' }, t('sa.scanned', { when: list.scannedAt === null ? '–' : fm.dateTime(list.scannedAt), count: tp('sa.count', sum.total) }), ' · ', t('sa.summary', { offered: sum.offered, hidden: sum.hidden, official: sum.official, community: sum.community })),
    h('div', { class: 'sim-aircraft-list' }, table),
    rescan) };
}
