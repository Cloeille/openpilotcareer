import type { Flight } from '@opc/shared';
import { NO_FILTER, STATUS_FILTERS, filterFlights, seasonTotals, seasonsOf, statusCounts, type FlightFilter, type StatusFilter } from '../history.ts';
import { button, dataTable, keycap, segments } from '../components.ts';
import { loadFlights, loadLedger } from '../flights-data.ts';
import { flightBadge } from '../flight-view.ts';
import { fmt } from '../format.ts';
import { codeLabel, t, tp } from '../i18n.ts';
import { loadLabel } from '../job-view.ts';
import { hashFor } from '../keys.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h } from '../ui.ts';

let filter: FlightFilter = { ...NO_FILTER };
let view: 'flights' | 'ledger' = 'flights';

export async function history(ctx: Ctx): Promise<Screen> {
  const { snap, go } = ctx;
  const { me } = snap;
  const fm = fmt();
  const flights = await loadFlights();
  const seasons = seasonsOf(flights);
  if (filter.season !== null && !seasons.includes(filter.season)) filter = { ...filter, season: null };
  if (filter.aircraftId !== null && !flights.some((f) => f.aircraftId === filter.aircraftId)) filter = { ...filter, aircraftId: null };
  const current = filter.season ?? seasons[0] ?? new Date().toISOString().slice(0, 7);
  const totals = seasonTotals(flights, current);
  const closed = flights.filter((f) => f.status !== 'active');
  const shown = filterFlights(flights, filter);
  const counts = statusCounts(flights, filter);
  const set = (patch: Partial<FlightFilter>): void => { filter = { ...filter, ...patch }; window.dispatchEvent(new Event('opc:redraw')); };

  const fleetIds = [...new Set(closed.map((f) => f.aircraftId))].sort((a, b) => a - b);
  const aircraftLabel = (id: number): string => { const a = me.fleet.find((x) => x.id === id); return a ? `${a.icao} #${a.id}` : `#${id}`; };
  const select = (label: string, id: string, options: [string, string][], current: string, onChange: (v: string) => void): HTMLElement =>
    h('label', { class: 'filter', for: id }, h('span', { class: 'sr' }, label),
      h('select', { id, onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value) }, options.map(([v, text]) => h('option', { value: v, selected: v === current }, text))));

  const rows = shown.map((f: Flight) => {
    const at = f.completedAt ?? f.acceptedAt;
    return {
      label: `${f.job.origin} → ${f.job.destination}`,
      onOpen: () => go(hashFor('flight', f.id)),
      cells: [
        h('div', { class: 'col tight' }, h('span', null, fm.date(at)), h('span', { class: 'dim small mono' }, fm.zulu(at))),
        h('div', { class: 'col tight' }, h('span', { class: 'mono strong' }, `${f.job.origin} → ${f.job.destination}`), h('span', { class: 'dim small' }, `${fm.nm(f.job.distanceNm)}`)),
        h('div', { class: 'col tight' }, h('span', null, f.aircraftIcao), h('span', { class: 'dim small' }, `#${f.aircraftId}`)),
        loadLabel(f.job),
        h('span', { class: 'strong' }, f.status === 'verified' || f.status === 'unverified' ? fm.signedMoney(f.net) : '–'),
        flightBadge(f),
      ],
    };
  });

  const flightLog = (): HTMLElement => dataTable(t('hist.title'), [
    { label: t('hist.col.date') }, { label: t('hist.col.route') }, { label: t('hist.col.aircraft') }, { label: t('hist.col.load') }, { label: t('hist.col.result'), align: 'end' }, { label: t('hist.col.verification') },
  ], rows, h('p', { class: 'dim', style: 'padding:22px' }, closed.length === 0 ? t('hist.empty') : t('hist.emptyFiltered')));

  const body = h('div', { class: 'panel-fill' });
  if (view === 'flights') body.append(flightLog());
  else void loadLedger().then((ledger) => body.replaceChildren(dataTable(t('hist.ledger'), [
    { label: t('hist.ledger.col.date') }, { label: t('hist.ledger.col.type') }, { label: t('hist.ledger.col.memo') }, { label: t('hist.ledger.col.amount'), align: 'end' }, { label: t('hist.ledger.col.balance'), align: 'end' },
  ], ledger.map((x) => ({ cells: [fm.dateTime(x.at), codeLabel(x.kind, 'tx.kind', 'fin.kind'), x.memo, h('span', { class: 'strong' }, fm.signedMoney(x.amount)), fm.money(x.balanceAfter)] })),
    h('p', { class: 'dim', style: 'padding:22px' }, t('hist.ledgerEmpty')))));

  const fact = (label: string, value: string): HTMLElement => h('div', { class: 'fact' }, h('span', { class: 'fact-label' }, label), h('span', { class: 'fact-value' }, value));
  const content = h('div', { class: 'history-view' },
    h('div', { class: 'title-row' },
      h('div', { class: 'title-block' }, h('div', { class: 'status-line' }, t('hist.status', { company: me.company.name })), h('h1', { class: 'title' }, t('hist.title'))),
      h('div', { class: 'facts' },
        fact(t('hist.factNet', { season: fm.seasonMonth(current) }), fm.money(totals.net)),
        fact(t('hist.factVerified'), t('hist.factVerifiedV', { v: totals.verified, n: totals.flown })))),
    h('section', { class: 'panel jobs-panel', 'aria-label': t('hist.title') },
      h('div', { class: 'filter-bar' },
        view === 'flights'
          ? segments(t('hist.title'), STATUS_FILTERS.map((s) => ({ value: s, label: t(`hist.tab.${s}`), count: counts[s] })), filter.status, (status: StatusFilter) => set({ status }))
          : h('span', { class: 'strong' }, t('hist.ledger')),
        h('div', { class: 'filters' },
          segments(t('hist.views'), [{ value: 'flights', label: t('hist.view.flights') }, { value: 'ledger', label: t('hist.view.ledger') }], view, (v) => { view = v; window.dispatchEvent(new Event('opc:redraw')); }),
          view === 'flights' ? select(t('hist.col.aircraft'), 'f-aircraft', [['', t('hist.allFleet')], ...fleetIds.map((id): [string, string] => [String(id), aircraftLabel(id)])], filter.aircraftId === null ? '' : String(filter.aircraftId), (v) => set({ aircraftId: v === '' ? null : Number(v) })) : null,
          view === 'flights' ? select(t('hist.season', { month: '' }), 'f-season', [['', t('hist.allSeasons')], ...seasons.map((s): [string, string] => [s, t('hist.season', { month: fm.seasonMonth(s) })])], filter.season ?? '', (v) => set({ season: v === '' ? null : v })) : null)),
      body,
      view === 'flights' && shown.length > 0 ? h('p', { class: 'list-footer' }, tp('hist.count', shown.length)) : null),
    h('div', { class: 'row' }, keycap('N'), button(t('hist.manual'), { variant: 'ghost', icon: 'plus', onclick: () => go('#manual') })));
  return {
    title: t('tab.history'), scene: 'history', tab: 'history', view: content, back: '#dashboard',
    hints: [{ key: t('key.esc'), label: t('hint.dashboard') }, { key: '↑ ↓', label: t('hint.browse') }, { key: t('key.enter'), label: t('hint.open') }, { key: 'N', label: t('hint.manual') }],
    keys: { n: () => go('#manual') },
  };
}
