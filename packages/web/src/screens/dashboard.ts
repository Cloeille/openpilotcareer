import { blockHours, type Flight, type Job } from '@opc/shared';
import { api } from '../api.ts';
import { button, icon, signDirection, signLocation, unknownValue } from '../components.ts';
import { errorText } from '../error-text.ts';
import { companyTitle, keyFigures } from '../figures.ts';
import { fmt } from '../format.ts';
import { jobsAtIdleAirports, flyable } from '../board.ts';
import { t, tp } from '../i18n.ts';
import { loadLabel } from '../job-view.ts';
import { hashFor } from '../keys.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h, notify } from '../ui.ts';

async function act(label: string, fn: () => Promise<unknown>, refresh: () => Promise<void>): Promise<void> {
  try {
    await fn();
    notify(label);
    await refresh();
  } catch (e) {
    notify(errorText(e), 'error');
  }
}

function flightActions(f: Flight, refresh: () => Promise<void>): HTMLElement {
  return h('div', { class: 'row' },
    button(t('dash.completeManually'), { variant: 'secondary', onclick: () => void act(t('dash.completed'), () => api(`/flights/${f.id}/complete`, { method: 'POST' }), refresh) }),
    button(t('dash.cancel'), { variant: 'ghost', icon: 'x', onclick: () => { if (confirm(t('dash.cancelConfirm'))) void act(t('dash.cancelled'), () => api(`/flights/${f.id}/cancel`, { method: 'POST' }), refresh); } }));
}

function currentFlight(f: Flight, ctx: Ctx, others: Flight[]): HTMLElement {
  const { snap, refresh } = ctx;
  const fm = fmt();
  const aircraft = snap.me.fleet.find((a) => a.id === f.aircraftId);
  const fact = (label: string, value: string | Node): HTMLElement => h('div', { class: 'fact' }, h('span', { class: 'fact-label' }, label), h('span', { class: 'fact-value' }, value));
  return h('section', { class: 'panel current-flight', 'aria-labelledby': 'flight-title' },
    h('div', { class: 'flight-head' },
      h('span', { class: 'status-line' }, h('span', { class: 'dot route' }), t('dash.liveSince', { time: fm.zulu(f.acceptedAt) })),
      h('span', { class: 'verif' }, icon('scan-line', 14), t('dash.awaiting'))),
    h('div', { class: 'col tight' },
      h('h2', { id: 'flight-title', class: 'flight-title' }, `${f.job.origin} → ${f.job.destination}`),
      h('span', { class: 'mono dim small' }, t('dash.flightMeta', { id: f.id, aircraft: f.aircraftIcao, aircraftId: f.aircraftId }), ' · ', loadLabel(f.job))),
    h('div', { class: 'route-line' }, signLocation(f.job.origin), h('div', { class: 'track', 'aria-hidden': 'true' }, h('span', { class: 'remaining' })), signDirection(f.job.destination)),
    f.job.route ? h('span', { class: 'mono dim small route-text' }, f.job.route) : null,
    h('div', { class: 'facts' },
      fact(t('dash.distance'), fm.nm(f.job.distanceNm)),
      fact(t('dash.blockTime'), aircraft ? fm.duration(blockHours(aircraft.type, f.job.distanceNm)) : unknownValue()),
      fact(t('dash.payout'), fm.money(f.job.payout))),
    flightActions(f, refresh),
    others.length > 0 ? h('div', { class: 'others' },
      h('span', { class: 'dim small' }, t('dash.others')),
      h('ul', { class: 'plain' }, others.slice(0, 2).map((o) => h('li', { class: 'other' }, h('span', { class: 'mono strong' }, `${o.job.origin} → ${o.job.destination}`), h('span', { class: 'dim small' }, `${o.aircraftIcao} #${o.aircraftId}`), flightActions(o, refresh)))),
      others.length > 2 ? h('a', { class: 'btn ghost', href: '#history' }, h('span', null, t('dash.seeAll', { n: others.length })), icon('chevron-right')) : null) : null);
}

function nextDeparture(ctx: Ctx): HTMLElement {
  const { snap, go } = ctx;
  const { me, board } = snap;
  const fm = fmt();
  const idle = me.fleet.filter((a) => !a.busy);
  const where = [...new Set(idle.map((a) => a.location))];
  const suggestions = jobsAtIdleAirports(me, board).filter((j) => flyable(me, j)).slice(0, 3);
  const suggestion = (j: Job): HTMLElement => h('a', { class: 'suggest', href: hashFor('job', j.id), 'data-row': '' },
    signLocation(j.origin), icon('arrow-right', 16), signDirection(j.destination),
    h('span', { class: 'suggest-type' }, loadLabel(j)), h('span', { class: 'dim' }, fm.nm(j.distanceNm)), h('span', { class: 'suggest-gain' }, fm.money(j.payout)));
  return h('section', { class: 'panel current-flight', 'aria-labelledby': 'idle-title' },
    h('div', { class: 'flight-head' }, h('span', { class: 'status-line' }, h('span', { class: 'dot idle' }), t('dash.idle'))),
    h('div', { class: 'col tight' },
      h('h2', { id: 'idle-title', class: 'flight-title' }, t('dash.ready')),
      h('span', { class: 'muted' }, idle.length > 0 ? tp('dash.fleetIdle', idle.length, { where: where.join(', ') }) : t('dash.allBusy'))),
    idle.length > 0 ? h('div', { class: 'col tight' },
      h('span', { class: 'dim small' }, t('dash.suggested', { airports: where.join(', ') })),
      suggestions.length === 0 ? h('span', { class: 'muted' }, t('dash.noSuggested')) : h('div', { class: 'suggested' }, suggestions.map(suggestion))) : null,
    h('div', { class: 'row' },
      button(t('dash.openJobs'), { variant: 'primary', key: t('key.enter'), onclick: () => go('#jobs') }),
      button(t('dash.importSimbrief'), { variant: 'secondary', icon: 'file-down', key: 'I', onclick: () => go('#simbrief') })));
}

export async function dashboard(ctx: Ctx): Promise<Screen> {
  const { snap } = ctx;
  const active = await api<Flight[]>('/me/flights?status=active&limit=50');
  const oldestFirst = [...active].sort((a, b) => a.acceptedAt - b.acceptedAt);
  const main = oldestFirst[0];
  const view = h('div', { class: 'wide-layout' }, companyTitle(snap),
    h('div', { class: 'offline-row' }, main ? currentFlight(main, ctx, oldestFirst.slice(1)) : nextDeparture(ctx), keyFigures(snap.me, snap.lastFlight)));
  return {
    title: t('tab.dashboard'), scene: 'dashboard', tab: 'dashboard', wide: true, view, back: null,
    hints: main ? [] : [{ key: t('key.enter'), label: t('hint.openJobs') }, { key: 'I', label: t('hint.simbrief') }],
    keys: main ? undefined : { i: () => ctx.go('#simbrief') },
  };
}
