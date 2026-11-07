import type { CompanyProfile } from '@opc/shared';
import { button, dataTable, keycap, panel, segments, titleBlock } from '../components.ts';
import { loadProfile, loadSeason } from '../competition-data.ts';
import { aiRivals } from '../competition.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import { hashFor } from '../keys.ts';
import type { Ctx, Screen } from '../screen.ts';
import { SORT_KEYS, isFreshSeason, kindOf, seasonDay, sortStandings, type Kind, type SortKey, type Standing } from '../standings.ts';
import { h } from '../ui.ts';

type Scope = 'season' | 'career';
let sort: SortKey = 'worth';
let scope: Scope = 'season';
let season: string | undefined;
let selected: number | null = null;

const kindLabel = (kind: Kind | null): string => (kind === null ? t('lb.kind.ai') : t(`lb.kind.${kind}`));

export async function leaderboard(ctx: Ctx): Promise<Screen> {
  const { snap, go } = ctx;
  const { me } = snap;
  const fm = fmt();
  const [data, rivals] = await Promise.all([loadSeason(season), aiRivals()]);
  season = data.season;
  const profiles = new Map<number, Pick<CompanyProfile, 'personality' | 'hubs'>>(rivals.profiles.map((p) => [p.id, p]));
  const redraw = (): void => { window.dispatchEvent(new Event('opc:redraw')); };

  const current = data.raw.seasons[0] === data.season;
  const fresh = current && isFreshSeason(data.raw.rows);
  const career = scope === 'career' || fresh;
  const rows = sortStandings(data.standings, career ? 'worth' : sort);
  if (selected === null || !rows.some((r) => r.companyId === selected)) selected = rows.find((r) => r.companyId !== me.company.id)?.companyId ?? me.company.id;

  const hubOf = (id: number): string => (id === me.company.id ? me.hubs[0] : profiles.get(id)?.hubs[0]) ?? '–';
  const pick = rows.find((r) => r.companyId === selected);
  const panelHost = h('div', { class: 'selection' });
  const showSelection = (s: Standing | undefined): void => {
    if (!s) { panelHost.replaceChildren(panel({ title: t('lb.panel') }, h('p', { class: 'dim' }, t('lb.sel.none')))); return; }
    selected = s.companyId;
    const prof = profiles.get(s.companyId);
    const kind = kindOf(s, me.company.id, prof);
    const mine = data.standings.find((x) => x.companyId === me.company.id);
    const delta = mine && s.companyId !== me.company.id ? s.netWorth - mine.netWorth : null;
    const isMe = s.companyId === me.company.id;
    const canSheet = !isMe && s.isAI;
    panelHost.replaceChildren(panel({ title: s.name, action: fm.ordinal(s.rank), tick: isMe, class: 'selected-company' },
      h('div', { class: 'col' },
        h('span', { class: 'muted' }, t('lb.sel.kindHub', { kind: kindLabel(kind), hub: hubOf(s.companyId) })),
        h('div', { class: 'fact big' }, h('span', { class: 'fact-label' }, t('lb.col.worth')), h('span', { class: 'fact-value' }, fm.moneyShort(s.netWorth)),
          h('span', { class: 'fact-sub' }, delta === null ? t('lb.sel.you') : t(delta >= 0 ? 'lb.sel.ahead' : 'lb.sel.behind', { amount: fm.moneyShort(Math.abs(delta)) }))),
        h('div', { class: 'facts' },
          h('div', { class: 'fact' }, h('span', { class: 'fact-label' }, t('lb.col.gain')), h('span', { class: 'fact-value small-value' }, s.gain === null ? '–' : fm.signedMoney(s.gain))),
          h('div', { class: 'fact' }, h('span', { class: 'fact-label' }, t('lb.col.flights')), h('span', { class: 'fact-value small-value' }, fm.num(s.flights))),
          h('div', { class: 'fact' }, h('span', { class: 'fact-label' }, t('lb.col.reputation')), h('span', { class: 'fact-value small-value' }, fm.num(s.reputation, 1)))),
        canSheet ? button(t('lb.sel.profile'), { variant: 'secondary', key: t('key.enter'), onclick: () => go(hashFor('company-sheet', s.companyId)) }) : null,
        !isMe && current ? button(t('lb.sel.compare'), { variant: 'ghost', key: 'C', onclick: () => go(hashFor('duel', s.companyId)) }) : null)));
  };
  showSelection(pick);

  const table = dataTable(t('lb.panel'), [
    { label: t('lb.col.rank') }, { label: t('lb.col.company') }, { label: t('lb.col.hub') }, { label: t('lb.col.flights'), align: 'end' }, { label: t('lb.col.reputation'), align: 'end' },
    { label: career ? t('lb.col.worth') : sort === 'gain' ? t('lb.col.gain') : t('lb.col.worth'), align: 'end' },
  ], rows.map((r) => {
    const kind = kindOf(r, me.company.id, profiles.get(r.companyId));
    return {
      label: r.name,
      selected: r.companyId === selected,
      onFocus: () => showSelection(r),
      onOpen: () => { showSelection(r); if (r.isAI) go(hashFor('company-sheet', r.companyId)); },
      cells: [
        h('span', { class: `rank ${r.companyId === me.company.id ? 'me' : ''}`.trim() }, String(r.rank)),
        h('div', { class: 'col tight' }, h('span', { class: 'strong' }, r.name), h('span', { class: 'dim small' }, kindLabel(kind))),
        h('span', { class: 'mono' }, hubOf(r.companyId)),
        fm.num(r.flights), fm.num(r.reputation, 1),
        h('span', { class: 'strong' }, !career && sort === 'gain' ? (r.gain === null ? '–' : fm.signedMoney(r.gain)) : fm.moneyShort(r.netWorth)),
      ],
    };
  }), h('p', { class: 'dim', style: 'padding:22px' }, t('lb.empty')));

  const sorts = h('div', { class: 'segments', role: 'group', 'aria-label': t('lb.title') }, SORT_KEYS.map((k, i) =>
    h('button', { type: 'button', class: 'seg', 'aria-pressed': String(!career && sort === k), disabled: career, onclick: () => { sort = k; redraw(); } }, keycap(String(i + 1)), h('span', null, t(`lb.sort.${k}`)))));
  const monthLabel = fm.seasonMonth(data.season);
  const now = Date.now();
  const day = seasonDay(now);

  const status = current
    ? t('lb.status', { month: monthLabel, day: day.day, length: day.length })
    : t('lb.statusPast', { month: monthLabel });
  const seasonSelect = h('label', { class: 'filter', for: 'lb-season' }, h('span', { class: 'sr' }, t('lb.season')),
    h('select', { id: 'lb-season', onchange: (e: Event) => { season = (e.target as HTMLSelectElement).value; selected = null; redraw(); } },
      data.seasons.map((s) => h('option', { value: s, selected: s === data.season }, t('hist.season', { month: fm.seasonMonth(s) })))));

  const cycleScope = (): void => { scope = scope === 'season' ? 'career' : 'season'; redraw(); };
  const toolbar = h('div', { class: 'lb-toolbar' }, sorts,
    h('div', { class: 'row' }, seasonSelect, keycap('T'), segments(t('lb.title'), [{ value: 'season', label: t('lb.scope.season') }, { value: 'career', label: t('lb.scope.career') }], scope, (v) => { scope = v; redraw(); })));

  const view = h('div', { class: 'lb-layout' },
    h('div', { class: 'lb-column' },
      h('div', { class: 'col' }, titleBlock(status, t('lb.title')), !current ? h('p', { class: 'dim small' }, t('lb.pastNote')) : null),
      h('div', { class: 'col lb-table-group' }, toolbar,
        panel({ title: fresh ? t('lb.panelFresh') : t('lb.panel'), action: fresh ? t('lb.panelFreshSub') : tp('lb.count', rows.length), class: 'lb-panel' }, table),
        h('p', { class: 'dim small note' }, t('lb.gap')))),
    h('aside', { class: 'lb-selection', 'aria-live': 'polite' }, panelHost));

  const duelTarget = (): void => { const s = rows.find((r) => r.companyId === selected); if (s && s.companyId !== me.company.id && current) go(hashFor('duel', s.companyId)); };
  return {
    title: t('lb.title'), scene: 'leaderboard', tab: 'leaderboard', view, back: '#dashboard',
    hints: [{ key: t('key.esc'), label: t('hint.dashboard') }, { key: '↑ ↓', label: t('hint.browse') }, { key: 'T', label: t('hint.career') }, { key: 'C', label: t('hint.compare') }],
    keys: { c: duelTarget, t: cycleScope, 1: () => { sort = 'worth'; redraw(); }, 2: () => { sort = 'gain'; redraw(); }, 3: () => { sort = 'flights'; redraw(); }, 4: () => { sort = 'reputation'; redraw(); } },
  };
}
