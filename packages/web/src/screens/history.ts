import type { HistorySource } from '@opc/shared';
import { NO_FILTER, entryAircraft, filterEntries, rowOf, seasonTotals, seasonsOf, statusCounts, tabsOf, type FlightFilter, type LegState, type StatusFilter } from '../history.ts';
import { badge, button, dataTable, icon, keycap, segments, unknownValue } from '../components.ts';
import { aircraftName } from '../finance-view.ts';
import { loadHistory, loadLedger } from '../flights-data.ts';
import { flightBadge } from '../flight-view.ts';
import { fmt } from '../format.ts';
import { codeLabel, t, tp } from '../i18n.ts';
import { loadLabel } from '../job-view.ts';
import { CAUSE_KEYS } from '../lines-view.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h } from '../ui.ts';

let filter: FlightFilter = { ...NO_FILTER };
let view: 'flights' | 'ledger' = 'flights';
let pages = 1;

/** Open the log on the lines (the dashboard's card links here). */
export const showLineLegs = (): void => { filter = { ...NO_FILTER, source: 'lines' }; view = 'flights'; };

const LEG_ICON = { done: 'circle-check', late: 'clock', flying: 'plane', cancelled: 'circle-x' } as const;
/** The status of a line leg: icon and label carry it (done, delayed N min, in flight, cancelled), colour only reinforces; the cause of a cancellation goes below. */
function legBadge(state: LegState): HTMLElement {
  const label = state.kind === 'late' ? t('ln.ops.b.delayed', { n: state.delayMin }) : state.kind === 'cancelled' ? t('ln.fs.cancelled') : state.kind === 'flying' ? t('ln.fs.flying') : t('ln.fs.done');
  const cls = state.kind === 'late' ? 'delayed' : state.kind === 'cancelled' ? 'cancelled' : 'ontime';
  return h('div', { class: 'col tight start' }, h('span', { class: `ln-badge ${cls}` }, icon(LEG_ICON[state.kind], 12), label),
    state.kind === 'cancelled' && state.cause ? h('span', { class: 'dim small' }, t(CAUSE_KEYS[state.cause])) : null);
}

export async function history(ctx: Ctx): Promise<Screen> {
  const { snap, go } = ctx;
  const { me } = snap;
  const fm = fmt();
  const monthStart = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1);
  const { entries, more } = await loadHistory(pages, monthStart);
  const seasons = seasonsOf(entries);
  if (filter.season !== null && !seasons.includes(filter.season)) filter = { ...filter, season: null };
  if (filter.aircraftId !== null && !entries.some((e) => entryAircraft(e) === filter.aircraftId)) filter = { ...filter, aircraftId: null };
  if (!tabsOf(filter.source).includes(filter.status)) filter = { ...filter, status: 'all' };
  const current = filter.season ?? seasons[0] ?? new Date().toISOString().slice(0, 7);
  const totals = seasonTotals(entries, current);
  const shown = filterEntries(entries, filter);
  const counts = statusCounts(entries, filter);
  const set = (patch: Partial<FlightFilter>): void => { filter = { ...filter, ...patch }; window.dispatchEvent(new Event('opc:redraw')); };

  const regOf = (id: number): string | null => me.fleet.find((x) => x.id === id)?.registration || null;
  const fleetIds = [...new Set(entries.map(entryAircraft))].sort((a, b) => a - b);
  const aircraftLabel = (id: number): string => { const a = me.fleet.find((x) => x.id === id); return a ? aircraftName(a) : regOf(id) ?? `#${id}`; };
  const select = (label: string, id: string, options: [string, string][], current: string, onChange: (v: string) => void): HTMLElement =>
    h('label', { class: 'filter', for: id }, h('span', { class: 'sr' }, label),
      h('select', { id, onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value) }, options.map(([v, text]) => h('option', { value: v, selected: v === current }, text))));

  const rows = shown.map((e) => {
    const r = rowOf(e, regOf);
    const route = `${r.origin} → ${r.dest}`;
    const leg = r.source === 'line';
    return {
      label: leg ? `${t('hist.tag.line')} ${r.flightNo} ${route}` : route,
      onOpen: () => go(r.href),
      cells: [
        h('div', { class: 'col tight' }, h('span', null, fm.date(r.at)), h('span', { class: 'dim small mono' }, fm.zulu(r.at))),
        h('div', { class: 'col tight' }, h('span', { class: 'mono strong' }, route),
          leg ? h('span', { class: 'row tight small' }, badge('route', t('hist.tag.line')), h('a', { class: 'dim mono', href: r.href, tabindex: -1 }, r.flightNo))
            : h('span', { class: 'dim small' }, fm.nm(r.flight.job.distanceNm))),
        h('div', { class: 'col tight' }, h('span', null, r.reg ?? `#${r.aircraftId}`), h('span', { class: 'dim small' }, r.icao)),
        leg ? (r.pax === null ? unknownValue() : tp('job.pax', r.pax)) : loadLabel(r.flight.job),
        h('div', { class: 'col tight end' }, h('span', { class: 'strong' }, r.net === null ? '–' : fm.signedMoney(r.net)),
          leg && r.state.kind !== 'cancelled' ? h('span', { class: 'dim small' }, t('hist.legMoney', { revenue: fm.money(r.revenue), costs: fm.money(r.costs) })) : null),
        leg ? legBadge(r.state) : flightBadge(r.flight),
      ],
    };
  });

  const flightLog = (): HTMLElement => dataTable(t('hist.title'), [
    { label: t('hist.col.date') }, { label: t('hist.col.route') }, { label: t('hist.col.aircraft') }, { label: t('hist.col.load') }, { label: t('hist.col.result'), align: 'end' }, { label: t('hist.col.verification') },
  ], rows, h('p', { class: 'dim', style: 'padding:22px' }, entries.length === 0 ? t('hist.empty') : filter.source === 'lines' && !entries.some((e) => e.source === 'line') ? t('hist.emptyLines') : t('hist.emptyFiltered')));

  const body = h('div', { class: 'panel-fill' });
  if (view === 'flights') body.append(flightLog());
  else void loadLedger().then((ledger) => body.replaceChildren(dataTable(t('hist.ledger'), [
    { label: t('hist.ledger.col.date') }, { label: t('hist.ledger.col.type') }, { label: t('hist.ledger.col.memo') }, { label: t('hist.ledger.col.amount'), align: 'end' }, { label: t('hist.ledger.col.balance'), align: 'end' },
  ], ledger.map((x) => ({ cells: [fm.dateTime(x.at), codeLabel(x.kind, 'tx.kind', 'fin.kind'), x.memo, h('span', { class: 'strong' }, fm.signedMoney(x.amount)), fm.money(x.balanceAfter)] })),
    h('p', { class: 'dim', style: 'padding:22px' }, t('hist.ledgerEmpty')))));

  const fact = (label: string, value: string, sub?: string): HTMLElement => h('div', { class: 'fact' }, h('span', { class: 'fact-label' }, label), h('span', { class: 'fact-value' }, value), sub ? h('span', { class: 'dim small' }, sub) : null);
  const sources = (['all', 'flown', 'lines'] as const).map((value) => ({ value, label: t(`hist.src.${value}`) }));
  const tabs = tabsOf(filter.source);
  const content = h('div', { class: 'history-view' },
    h('div', { class: 'title-row' },
      h('div', { class: 'title-block' }, h('div', { class: 'status-line' }, t('hist.status', { company: me.company.name })), h('h1', { class: 'title' }, t('hist.title'))),
      h('div', { class: 'facts' },
        fact(t('hist.factNet', { season: fm.seasonMonth(current) }), fm.money(totals.net), t('hist.factNetSplit', { flown: fm.money(totals.flownNet), lines: fm.money(totals.linesNet) })),
        fact(t('hist.factLegs'), tp('hist.factLegsV', totals.legs), totals.cancelledLegs > 0 ? t('hist.factLegsCancelled', { n: totals.cancelledLegs }) : undefined),
        fact(t('hist.factVerified'), t('hist.factVerifiedV', { v: totals.verified, n: totals.flown })))),
    h('section', { class: 'panel jobs-panel', 'aria-label': t('hist.title') },
      h('div', { class: 'filter-bar' },
        view === 'flights'
          ? h('div', { class: 'row' },
            segments(t('hist.sources'), sources, filter.source, (source: HistorySource) => set({ source })),
            segments(t('hist.title'), tabs.map((s) => ({ value: s, label: t(`hist.tab.${s}`), count: counts[s] })), filter.status, (status: StatusFilter) => set({ status })))
          : h('span', { class: 'strong' }, t('hist.ledger')),
        h('div', { class: 'filters' },
          segments(t('hist.views'), [{ value: 'flights', label: t('hist.view.flights') }, { value: 'ledger', label: t('hist.view.ledger') }], view, (v) => { view = v; window.dispatchEvent(new Event('opc:redraw')); }),
          view === 'flights' ? select(t('hist.col.aircraft'), 'f-aircraft', [['', t('hist.allFleet')], ...fleetIds.map((id): [string, string] => [String(id), aircraftLabel(id)])], filter.aircraftId === null ? '' : String(filter.aircraftId), (v) => set({ aircraftId: v === '' ? null : Number(v) })) : null,
          view === 'flights' ? select(t('hist.season', { month: '' }), 'f-season', [['', t('hist.allSeasons')], ...seasons.map((s): [string, string] => [s, t('hist.season', { month: fm.seasonMonth(s) })])], filter.season ?? '', (v) => set({ season: v === '' ? null : v })) : null)),
      body,
      view === 'flights' && shown.length > 0 ? h('p', { class: 'list-footer' }, tp('hist.count', shown.length), entries.some((e) => e.source === 'line') ? ` · ${t('hist.legNote')}` : '') : null,
      view === 'flights' && more ? h('div', { class: 'list-footer' }, button(t('hist.more'), { variant: 'secondary', onclick: () => { pages += 1; window.dispatchEvent(new Event('opc:redraw')); } })) : null),
    h('div', { class: 'row' }, keycap('N'), button(t('hist.manual'), { variant: 'ghost', icon: 'plus', onclick: () => go('#manual') })));
  return {
    title: t('tab.history'), scene: 'history', tab: 'history', view: content, back: '#dashboard',
    hints: [{ key: t('key.esc'), label: t('hint.dashboard') }, { key: '↑ ↓', label: t('hint.browse') }, { key: t('key.enter'), label: t('hint.open') }, { key: 'N', label: t('hint.manual') }],
    keys: { n: () => go('#manual') },
  };
}
