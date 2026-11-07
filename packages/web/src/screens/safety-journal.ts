import { fetchIncidents } from '../api-safety.ts';
import { panel, signLocation, titleBlock } from '../components.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import type { Ctx, Screen } from '../screen.ts';
import { newestFirst, recentSeasons, registrationOf, seasonTotals, stepSeason } from '../safety-view.ts';
import { incidentRow, safetyOff } from '../safety-ui.ts';
import { h } from '../ui.ts';

/** The month on show survives a redraw (a poll or a language change), not a new visit. */
let month: string | null = null;

/** `#safety/journal`: every incident of one season (a UTC month), newest first. */
export async function safetyJournal(ctx: Ctx): Promise<Screen> {
  const { snap, go } = ctx;
  const { me } = snap;
  const back = '#safety';
  const chips = recentSeasons(Date.now());
  const current = chips[chips.length - 1]!;
  if (month === null || !chips.includes(month)) month = current;
  const shown = month;
  const incidents = await fetchIncidents(shown);
  if (!incidents) return { title: t('sf.j.title'), scene: 'bridge', tab: 'hubs', back, hints: [{ key: t('key.esc'), label: t('sf.hint.back') }], view: safetyOff() };

  const fm = fmt();
  const list = newestFirst(incidents);
  const totals = seasonTotals(list);
  const move = (dir: 1 | -1): void => {
    const next = stepSeason(chips, shown, dir);
    if (next !== shown) { month = next; window.dispatchEvent(new Event('opc:redraw')); }
  };

  const chipsEl = h('div', { class: 'segments sf-months', role: 'group', 'aria-label': t('sf.j.months') }, chips.map((m) =>
    h('button', { type: 'button', class: 'seg st-chip', 'aria-pressed': String(m === shown), onclick: () => { month = m; window.dispatchEvent(new Event('opc:redraw')); } }, fm.seasonMonth(m))));

  const header = h('div', { class: 'ln-header' },
    titleBlock(h('div', { class: 'row tight' }, me.hubs[0] ? signLocation(me.hubs[0]) : null, h('span', { class: 'sf-crumb' }, t('sf.j.crumb'))), t('sf.j.title')),
    chipsEl);

  const body = list.length === 0
    ? h('p', { class: 'dim sf-none' }, t('sf.j.none', { month: fm.seasonMonth(shown) }))
    : h('ul', { class: 'plain sf-incs journal' }, list.map((i) => incidentRow(i, registrationOf(me.fleet, i.aircraftId))));
  const summary = h('div', { class: 'sf-season' },
    h('div', { class: 'line' }, h('span', { class: 'line-label dim' }, t('sf.season.total', { covered: fm.money(totals.covered) })), h('span', { class: 'line-value muted' }, fm.money(totals.total))),
    h('div', { class: 'line' }, h('span', { class: 'line-label muted' }, t('sf.season.borne')), h('span', { class: 'line-value strong' }, fm.money(totals.borne))));
  const journal = panel({ title: t('sf.inc.title'), action: tp('sf.j.count', list.length), id: 'sf-journal', class: 'sf-journal' }, body, summary);

  return {
    title: t('sf.j.title'), scene: 'bridge', tab: 'hubs', view: h('div', { class: 'sf-screen' }, header, journal), back, wide: false,
    hints: [{ key: t('key.esc'), label: t('sf.hint.back') }, { key: '← →', label: t('sf.hint.month') }],
    keys: { left: () => move(-1), right: () => move(1) },
  };
}
