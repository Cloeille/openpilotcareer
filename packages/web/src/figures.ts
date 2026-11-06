import { RANKS, type Flight, type Me } from '@opc/shared';
import { flightBadge } from './flight-view.ts';
import { fmt } from './format.ts';
import { t } from './i18n.ts';
import type { Key } from './messages.ts';
import { rankProgress } from './pilot.ts';
import { h } from './ui.ts';

const figure = (label: string, value: string, sub?: Node | string | null): HTMLElement =>
  h('div', { class: 'figure' }, h('span', { class: 'figure-label' }, label), h('span', { class: 'figure-value' }, value), sub ?? null);

export const rankName = (index: number): string => t(`rank.${index}` as Key);

/** The side panel of the dashboard and of the offline screen: balance, reputation, rank, last flight. Balance has no weekly delta and reputation no "out of 5" because the API provides neither. */
export function keyFigures(me: Me, lastFlight: Flight | null, now = Date.now()): HTMLElement {
  const f = fmt();
  const prog = rankProgress(me.pilot);
  const next = RANKS[prog.index + 1];
  const last = lastFlight;
  return h('aside', { class: 'panel figures', 'aria-label': t('fig.keyFigures') },
    figure(t('fig.balance'), f.money(me.company.balance)),
    figure(t('fig.reputation'), `${f.num(me.company.reputation, 1)} / 100`),
    figure(t('fig.rank'), rankName(prog.index),
      h('div', { class: 'rank-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(prog.fraction * 100), 'aria-label': t('fig.rank') },
        h('span', { style: `width:${Math.round(prog.fraction * 100)}%` })),
      ),
    h('span', { class: 'figure-sub' }, next ? t('fig.rankProgress', { pct: f.percent(prog.fraction), next: rankName(prog.index + 1) }) : t('fig.rankTop')),
    h('hr', { class: 'divider' }),
    last
      ? h('div', { class: 'figure last' },
        h('span', { class: 'figure-label' }, t('fig.lastFlightAt', { when: f.ago(last.completedAt ?? last.acceptedAt, now) })),
        h('div', { class: 'last-row' }, h('span', { class: 'mono strong' }, `${last.job.origin} → ${last.job.destination}`), h('span', { class: 'strong' }, f.signedMoney(last.net))),
        flightBadge(last))
      : h('div', { class: 'figure' }, h('span', { class: 'figure-label' }, t('fig.lastFlight')), h('span', { class: 'figure-sub' }, t('fig.noFlightYet'))));
}
