import { button, dataTable, panel, titleBlock } from '../components.ts';
import { loadSeason } from '../competition-data.ts';
import { fmt } from '../format.ts';
import { t } from '../i18n.ts';
import { hashFor } from '../keys.ts';
import type { Ctx, Screen } from '../screen.ts';
import { recapOf } from '../standings.ts';
import { h } from '../ui.ts';

/** The season that just ended, from the player's company's viewpoint. `#recap/<YYYY-MM>`; without an argument, the latest finished season. */
export async function recap(ctx: Ctx): Promise<Screen> {
  const { snap, arg, go } = ctx;
  const { me } = snap;
  const fm = fmt();
  const back = '#leaderboard';
  const first = await loadSeason();
  const finished = first.seasons.slice(1);
  const id = arg ?? finished[0];
  const empty = (msg: string): Screen => ({ title: t('lb.recap'), scene: 'leaderboard', tab: 'leaderboard', back, hints: [{ key: t('key.esc'), label: t('hint.leaderboard') }], view: h('p', { class: 'dim' }, msg) });
  if (!id || !finished.includes(id)) return empty(t('recap.none'));
  const data = await loadSeason(id);
  const r = recapOf(data.raw, data.before, me.company.id);
  if (!r) return empty(t('recap.notFlown'));

  const month = fm.seasonMonth(id);
  const podium = data.standings.slice(0, 3);
  const mine = data.standings.find((s) => s.companyId === me.company.id)!;
  const shown = podium.some((s) => s.companyId === mine.companyId) ? podium : [...podium, mine];
  const fact = (label: string, value: string, sub?: string): HTMLElement => h('div', { class: 'fact' }, h('span', { class: 'fact-label' }, label), h('span', { class: 'fact-value' }, value), sub ? h('span', { class: 'fact-sub' }, sub) : null);
  const view = h('div', { class: 'recap-layout' },
    h('div', { class: 'recap-column' },
      titleBlock(t('recap.status', { date: fm.seasonEnd(id) }), t('recap.title', { month })),
      h('div', { class: 'final-rank' }, h('span', { class: 'rank-number' }, fm.ordinal(r.rank)), h('span', { class: 'rank-of' }, t('recap.of', { n: r.of }))),
      h('p', { class: 'muted intro' }, t('recap.reset')),
      h('div', { class: 'facts-grid' },
        fact(t('recap.gain'), r.gain === null ? '–' : fm.signedMoney(r.gain), t('recap.careerWorth', { v: fm.moneyShort(r.worth) })),
        fact(t('recap.flights'), fm.num(r.flights)),
        fact(t('recap.reputation'), t('recap.repOf', { v: fm.num(r.reputation, 1) }), r.reputationDelta === null ? undefined : t('recap.repDelta', { d: `${r.reputationDelta > 0 ? '+' : ''}${fm.num(r.reputationDelta, 1)}` }))),
      h('p', { class: 'dim small note' }, t('lb.gap'), ' ', t('recap.gap'))),
    h('div', { class: 'recap-outcome' },
      panel({ title: t('recap.podium', { month }), action: t('lb.col.gain') },
        dataTable(t('recap.podium', { month }), [{ label: t('lb.col.rank') }, { label: t('lb.col.company') }, { label: t('lb.col.gain'), align: 'end' }],
          shown.map((s) => ({ label: s.name, cells: [String(s.rank), h('div', { class: 'col tight' }, h('span', { class: 'strong' }, s.name), h('span', { class: 'dim small' }, s.companyId === me.company.id ? t('lb.kind.you') : s.isAI ? t('lb.kind.ai') : t('lb.kind.pilot'))), s.gain === null ? '–' : fm.signedMoney(s.gain)] })))),
      h('div', { class: 'row' }, button(t('recap.start'), { variant: 'primary', key: t('key.enter'), onclick: () => go('#dashboard') }), button(t('recap.seeFinal'), { variant: 'secondary', key: 'Tab', onclick: () => go(hashFor('leaderboard')) }))));
  return { title: t('lb.recap'), scene: 'leaderboard', tab: 'leaderboard', view, back: '#dashboard', hints: [{ key: t('key.esc'), label: t('hint.dashboard') }, { key: t('key.enter'), label: t('recap.start') }] };
}
