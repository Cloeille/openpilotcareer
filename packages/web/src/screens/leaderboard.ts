import type { CompanyProfile, LeaderboardSubsidiary } from '@opc/shared';
import { button, dataTable, icon, keycap, panel, segments, titleBlock, type Row } from '../components.ts';
import { loadProfile, loadSeason } from '../competition-data.ts';
import { aiRivals } from '../competition.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import { hashFor } from '../keys.ts';
import type { Ctx, Screen } from '../screen.ts';
import { SORT_KEYS, hubOf, isFreshSeason, kindOf, seasonDay, sortStandings, type Kind, type SortKey, type Standing } from '../standings.ts';
import { h } from '../ui.ts';

type Scope = 'season' | 'career';
let sort: SortKey = 'worth';
let scope: Scope = 'season';
let season: string | undefined;
let selected: number | null = null;
/** The parents whose subsidiaries are open under their row; kept across redraws like the other choices of the screen. */
const open = new Set<number>();

const kindLabel = (kind: Kind | null): string => (kind === null ? t('lb.kind.ai') : t(`lb.kind.${kind}`));

export async function leaderboard(ctx: Ctx): Promise<Screen> {
  const { snap, go } = ctx;
  const { me } = snap;
  const fm = fmt();
  const [data, rivals] = await Promise.all([loadSeason(season), aiRivals()]);
  season = data.season;
  const profiles = new Map<number, Pick<CompanyProfile, 'personality'>>(rivals.profiles.map((p) => [p.id, p]));
  const redraw = (): void => { window.dispatchEvent(new Event('opc:redraw')); };

  const current = data.raw.seasons[0] === data.season;
  const fresh = current && isFreshSeason(data.raw.rows);
  const career = scope === 'career' || fresh;
  const rows = sortStandings(data.standings, career ? 'worth' : sort);
  if (selected === null || !rows.some((r) => r.companyId === selected)) selected = rows.find((r) => r.companyId !== me.company.id)?.companyId ?? me.company.id;

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
        h('span', { class: 'muted' }, t('lb.sel.kindHub', { kind: kindLabel(kind), hub: hubOf(s) })),
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

  const worthOf = (netWorth: number, gain: number | null): string | HTMLElement => (!career && sort === 'gain' ? (gain === null ? '–' : fm.signedMoney(gain)) : fm.moneyShort(netWorth));
  /** A subsidiary under its parent's row: no rank (C21), its own figures, and its worth is already inside the parent's. */
  const subRow = (s: LeaderboardSubsidiary, parent: string): Row => ({
    nested: true, label: t('lb.sub.row', { name: s.name, parent }),
    cells: [h('span', { class: 'dim' }, '–'), h('div', { class: 'col tight lb-sub-name' }, h('span', null, s.name), h('span', { class: 'dim small' }, t('lb.sub.of', { parent }))), h('span', { class: 'mono' }, s.hub ?? '–'), fm.num(s.flights), '', !career && sort === 'gain' ? '–' : fm.moneyShort(s.netWorth)],
  });
  const owners: { id: number; nested: boolean }[] = [];
  const tableRows: Row[] = rows.flatMap((r) => {
    const kind = kindOf(r, me.company.id, profiles.get(r.companyId));
    const subs = r.subsidiaries ?? [];
    owners.push({ id: r.companyId, nested: false }, ...subs.map(() => ({ id: r.companyId, nested: true })));
    const parent: Row = {
      label: subs.length > 0 ? t('lb.sub.parent', { name: r.name, n: subs.length }) : r.name,
      selected: r.companyId === selected,
      ...(subs.length > 0 ? { expanded: open.has(r.companyId) } : {}),
      onFocus: () => showSelection(r),
      onOpen: () => { showSelection(r); if (subs.length > 0) setOpen(r.companyId, !open.has(r.companyId)); else if (r.isAI) go(hashFor('company-sheet', r.companyId)); },
      cells: [
        h('span', { class: `rank ${r.companyId === me.company.id ? 'me' : ''}`.trim() }, String(r.rank)),
        h('div', { class: 'col tight' }, h('span', { class: 'strong row tight' }, subs.length > 0 ? h('span', { class: 'lb-chevron', 'aria-hidden': 'true' }, icon('chevron-right')) : null, r.name), h('span', { class: 'dim small' }, subs.length > 0 ? `${kindLabel(kind)} · ${tp('lb.sub.count', subs.length)}` : kindLabel(kind))),
        h('span', { class: 'mono' }, hubOf(r)),
        fm.num(r.flights), fm.num(r.reputation, 1),
        h('span', { class: 'strong' }, worthOf(r.netWorth, r.gain)),
      ],
    };
    return [parent, ...subs.map((s) => subRow(s, r.name))];
  });
  const table = dataTable(t('lb.panel'), [
    { label: t('lb.col.rank') }, { label: t('lb.col.company') }, { label: t('lb.col.hub') }, { label: t('lb.col.flights'), align: 'end' }, { label: t('lb.col.reputation'), align: 'end' },
    { label: career ? t('lb.col.worth') : sort === 'gain' ? t('lb.col.gain') : t('lb.col.worth'), align: 'end' },
  ], tableRows, h('p', { class: 'dim', style: 'padding:22px' }, t('lb.empty')));
  // Opening or closing the subsidiaries changes the DOM in place (no redraw), so the focus stays on the row the keys were pressed on.
  const trs = [...table.querySelectorAll<HTMLElement>('tbody tr')];
  function setOpen(id: number, on: boolean): void {
    if (on) open.add(id); else open.delete(id);
    trs.forEach((tr, i) => { const o = owners[i]; if (o?.id !== id) return; if (o.nested) tr.hidden = !on; else tr.setAttribute('aria-expanded', String(on)); });
  }
  trs.forEach((tr, i) => { if (owners[i]!.nested) tr.hidden = !open.has(owners[i]!.id); });

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
  /** → opens, ← closes, Space toggles the subsidiaries of the row the focus is on (Enter does too, as the row's own action). */
  const onRow = (on: (id: number) => void) => (): void => {
    const id = selected;
    if (id !== null && document.activeElement?.closest('[data-row]') && rows.find((r) => r.companyId === id)?.subsidiaries?.length) on(id);
  };
  return {
    title: t('lb.title'), scene: 'leaderboard', tab: 'leaderboard', view, back: '#dashboard',
    hints: [{ key: t('key.esc'), label: t('hint.dashboard') }, { key: '↑ ↓', label: t('hint.browse') }, ...(rows.some((r) => r.subsidiaries?.length) ? [{ key: '→', label: t('lb.hint.subs') }] : []), { key: 'T', label: t('hint.career') }, { key: 'C', label: t('hint.compare') }],
    keys: { right: onRow((id) => setOpen(id, true)), left: onRow((id) => setOpen(id, false)), space: onRow((id) => setOpen(id, !open.has(id))), c: duelTarget, t: cycleScope, 1: () => { sort = 'worth'; redraw(); }, 2: () => { sort = 'gain'; redraw(); }, 3: () => { sort = 'flights'; redraw(); }, 4: () => { sort = 'reputation'; redraw(); } },
  };
}
