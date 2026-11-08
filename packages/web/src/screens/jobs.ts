import type { Job } from '@opc/shared';
import { act } from '../actions.ts';
import { api } from '../api.ts';
import { DEFAULT_FILTERS, boardRows, candidates, matchesFilters, nextBoardWave, noAircraftReason, type JobFilters } from '../board.ts';
import { badge, button, dataTable, keycap, segments } from '../components.ts';
import { contestedIds } from '../competition.ts';
import { fillCity } from '../airports.ts';
import { distanceLookup, reasonLine } from '../ferry-ui.ts';
import { fmt } from '../format.ts';
import { t } from '../i18n.ts';
import { loadLabel } from '../job-view.ts';
import { hashFor } from '../keys.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h } from '../ui.ts';

/** Filters survive navigating to a job and back, but not a reload. */
let filters: JobFilters = { ...DEFAULT_FILTERS };

const select = <V extends string>(label: string, current: V, options: [V, string][], onChange: (v: V) => void): HTMLElement => {
  const id = `f-${label}`;
  return h('label', { class: 'filter', for: id }, h('span', { class: 'filter-label' }, label),
    h('select', { id, onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value as V) }, options.map(([v, text]) => h('option', { value: v, selected: v === current }, text))));
};

export async function jobs(ctx: Ctx): Promise<Screen> {
  const { snap, go } = ctx;
  const { me, board } = snap;
  const fm = fmt();
  const idle = me.fleet.filter((a) => !a.busy);
  const idleAirports = [...new Set(idle.map((a) => a.location))].sort();
  const all = boardRows(me, board);
  if (filters.from !== '' && !idleAirports.includes(filters.from) && !all.some((j) => j.origin === filters.from)) filters = { ...filters, from: '' };
  const fleetBoard = all.filter((j) => j.source === 'simbrief' || idleAirports.includes(j.origin));
  const counts = (kind: JobFilters['kind']): number => fleetBoard.filter((j) => matchesFilters(me, j, { ...filters, kind }, false)).length;
  const shown = fleetBoard.filter((j) => matchesFilters(me, j, filters));
  const unserved = shown.filter((j) => candidates(me, j).length === 0);
  const [contested, dist] = await Promise.all([contestedIds(shown), unserved.length > 0 ? distanceLookup([...me.fleet.map((a) => a.location), ...unserved.map((j) => j.origin)]) : undefined]);

  const host = h('div', { class: 'panel-fill' });
  const set = (patch: Partial<JobFilters>): void => { filters = { ...filters, ...patch }; window.dispatchEvent(new Event('opc:redraw')); };

  const row = (j: Job): Parameters<typeof dataTable>[2][number] => {
    const city = h('span', { class: 'city' }, j.destination);
    fillCity(city, j.destination);
    const options = candidates(me, j);
    return {
      label: `${j.origin} → ${j.destination}`,
      onOpen: () => go(hashFor('job', j.id)),
      cells: [
        h('div', { class: 'col tight' },
          h('div', { class: 'row tight' }, h('span', { class: 'mono strong' }, `${j.origin} → ${j.destination}`),
            contested.has(j.id) ? badge('contested', t('job.contested')) : null, j.source === 'simbrief' ? badge('info', t('jobs.imported'), 'file-down') : null),
          city),
        fm.nm(j.distanceNm), loadLabel(j), j.requiredAircraft ?? t('jobs.anyAircraft'),
        h('span', { class: 'strong pay' }, fm.money(j.payout)),
        options.length > 0
          ? button(t('jobs.accept'), { variant: 'secondary', label: `${t('jobs.accept')} ${j.origin} → ${j.destination}`, onclick: () => void accept(j, options[0]!.id) })
          : h('span', { class: 'dim small' }, reasonLine(noAircraftReason(me, j, dist) ?? { kind: 'busy' }, j.origin)),
      ],
    };
  };
  async function accept(j: Job, aircraftId: number): Promise<void> {
    await act(t('jobs.accepted', { route: `${j.origin} → ${j.destination}` }), () => api(`/jobs/${j.id}/accept`, { method: 'POST', body: { aircraftId } }), ctx.refresh).then((ok) => { if (ok) go('#dashboard'); });
  }

  const status = idleAirports.length > 0 ? t('jobs.status', { n: fleetBoard.length, airports: idleAirports.join(', '), time: fm.zulu(nextBoardWave(Date.now())) }) : t('jobs.statusNone');
  const fromOptions: [string, string][] = [['', t('jobs.fromAny')], ...[...new Set(fleetBoard.map((j) => j.origin))].sort().map((c): [string, string] => [c, c])];
  const filterBar = h('div', { class: 'filter-bar' },
    segments(t('jobs.kind'), [{ value: 'all', label: t('jobs.seg.all'), count: counts('all') }, { value: 'pax', label: t('jobs.seg.pax'), count: counts('pax') }, { value: 'cargo', label: t('jobs.seg.cargo'), count: counts('cargo') }], filters.kind, (kind) => set({ kind })),
    h('div', { class: 'filters' },
      select(t('jobs.from'), filters.from, fromOptions, (from) => set({ from })),
      select(t('jobs.distance'), filters.distance, [['any', t('jobs.distAny')], ['short', t('jobs.distShort')], ['mid', t('jobs.distMid')], ['long', t('jobs.distLong')]], (distance) => set({ distance })),
      select(t('jobs.gain'), filters.gain, [['any', t('jobs.gainAny')], ['3000', t('jobs.gain3000')], ['10000', t('jobs.gain10000')]], (gain) => set({ gain })),
      select(t('jobs.aircraft'), filters.fleetOnly ? 'fleet' : 'all', [['fleet', t('jobs.myFleet')], ['all', t('jobs.allTypes')]], (v) => set({ fleetOnly: v === 'fleet' }))));

  const empty = (): HTMLElement => {
    const noAircraft = idle.length === 0;
    const card = (title: string, sub: string, action: HTMLElement): HTMLElement => h('div', { class: 'next-action' }, h('div', { class: 'col tight' }, h('span', { class: 'strong' }, title), h('span', { class: 'dim small' }, sub)), action);
    const noneFit = !noAircraft && fleetBoard.length === 0;
    return h('div', { class: 'empty-state' },
      h('div', { class: 'col tight' }, h('h2', { class: 'empty-title' }, noAircraft ? t('jobs.empty.noAircraft.title') : noneFit ? t('jobs.empty.noFit.title', { airports: idleAirports.join(', ') }) : t('jobs.empty.title')),
        h('p', { class: 'muted' }, noAircraft ? t('jobs.empty.noAircraft.reason') : noneFit ? t('jobs.empty.noFit.reason') : t('jobs.empty.reason', { total: fleetBoard.length, hidden: fleetBoard.length - shown.length }))),
      h('div', { class: 'col tight' },
        noneFit ? card(t('jobs.empty.move'), t('jobs.empty.moveSub'), button(t('jobs.empty.move'), { variant: 'secondary', icon: 'route', onclick: () => go('#fleet') })) : null,
        noAircraft || noneFit ? null : card(t('jobs.empty.reset'), t('jobs.empty.resetSub'), button(t('jobs.empty.reset'), { variant: 'secondary', onclick: () => set({ ...DEFAULT_FILTERS, fleetOnly: false }) })),
        card(t('jobs.empty.buy'), t('jobs.empty.buySub'), button(t('jobs.empty.buy'), { variant: 'secondary', icon: 'plus', onclick: () => go('#catalogue') })),
        card(t('jobs.empty.simbrief'), t('jobs.empty.simbriefSub'), button(t('jobs.simbrief'), { variant: 'secondary', icon: 'file-down', onclick: () => go('#simbrief') }))),
      h('p', { class: 'dim small' }, t('jobs.empty.wave', { time: fm.zulu(nextBoardWave(Date.now())), left: fm.elapsed(nextBoardWave(Date.now()) - Date.now()) })));
  };

  host.append(shown.length === 0 ? empty() : dataTable(t('jobs.panel'), [
    { label: t('jobs.col.route') }, { label: t('jobs.col.distance') }, { label: t('jobs.col.load') }, { label: t('jobs.col.aircraft') }, { label: t('jobs.col.pay'), align: 'end' }, { label: '' },
  ], shown.map(row)));

  const view = h('div', { class: 'jobs-view' },
    h('div', { class: 'title-row' },
      h('div', { class: 'title-block' }, h('div', { class: 'status-line' }, status), h('h1', { class: 'title' }, t('jobs.available'))),
      h('div', { class: 'row tight' }, keycap('I'), button(t('jobs.simbrief'), { variant: 'ghost', icon: 'file-down', onclick: () => go('#simbrief') }))),
    h('section', { class: 'panel jobs-panel', 'aria-label': t('jobs.panel') },
      h('div', { class: 'panel-head' }, h('h2', null, t('jobs.panel')), h('div', { class: 'panel-action' }, t('jobs.sort'))),
      filterBar, host,
      shown.length > 0 ? h('p', { class: 'list-footer' }, t('jobs.count', { shown: shown.length, total: fleetBoard.length })) : null));
  return {
    title: t('tab.jobs'), scene: 'jobs', tab: 'jobs', view, back: '#dashboard',
    hints: [{ key: t('key.esc'), label: t('hint.dashboard') }, { key: '↑ ↓', label: t('hint.browse') }, { key: t('key.enter'), label: t('hint.select') }, { key: 'I', label: t('hint.simbrief') }],
    keys: { i: () => go('#simbrief') },
  };
}

