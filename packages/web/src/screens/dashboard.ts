import { blockHours, type Flight, type Job, type SimbriefLink } from '@opc/shared';
import { act } from '../actions.ts';
import { api } from '../api.ts';
import { fetchLive } from '../api-live.ts';
import { getLink } from '../api-simbrief.ts';
import { button, icon, signDirection, signLocation, unknownValue } from '../components.ts';
import { companyTitle, keyFigures } from '../figures.ts';
import { fmt } from '../format.ts';
import { jobsAtIdleAirports, flyable } from '../board.ts';
import { t, tp } from '../i18n.ts';
import { loadLabel } from '../job-view.ts';
import { pollWhileShown } from '../live-poll.ts';
import { liveFacts, progressOf, type LiveFacts } from '../live-view.ts';
import { simbriefBlock } from '../simbrief-card.ts';
import { hashFor } from '../keys.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h } from '../ui.ts';

function flightActions(f: Flight, refresh: () => Promise<void>): HTMLElement {
  return h('div', { class: 'row' },
    button(t('dash.completeManually'), { variant: 'secondary', onclick: () => void act(t('dash.completed'), () => api(`/flights/${f.id}/complete`, { method: 'POST' }), refresh) }),
    button(t('dash.cancel'), { variant: 'ghost', icon: 'x', onclick: () => { if (confirm(t('dash.cancelConfirm'))) void act(t('dash.cancelled'), () => api(`/flights/${f.id}/cancel`, { method: 'POST' }), refresh); } }));
}

/** `sb` is the SimBrief block of this flight (null when SimBrief cannot be asked, or the flight has no SimBrief id). */
function currentFlight(f: Flight, ctx: Ctx, others: Flight[], first: LiveFacts, sb: HTMLElement | null): HTMLElement {
  const { snap, refresh } = ctx;
  const fm = fmt();
  const aircraft = snap.me.fleet.find((a) => a.id === f.aircraftId);
  const fact = (label: string, value: string | Node): HTMLElement => h('div', { class: 'fact' }, h('span', { class: 'fact-label' }, label), h('span', { class: 'fact-value' }, value));
  const dot = h('span', { class: 'dot route' });
  const phase = h('span', null);
  const verif = h('span', { class: 'verif' });
  const eta = h('span', { class: 'fact-value' });
  const remaining = h('span', { class: 'fact-value' });
  const done = h('span', { class: 'remaining' });
  const plane = h('span', { class: 'plane-dot', 'aria-hidden': 'true' });
  const track = h('div', { class: 'track', 'aria-hidden': 'true' }, done, plane);
  const show = (l: LiveFacts): void => {
    dot.className = l.lost ? 'dot warn' : 'dot route';
    phase.textContent = l.sample === null && !l.lost ? t('dash.liveSince', { time: fm.zulu(f.acceptedAt) }) : t('dash.liveStatus', { phase: t(`live.phase.${l.phase}` as 'live.phase.cruise') });
    verif.className = l.lost ? 'verif live-chip warn' : 'verif';
    verif.replaceChildren(icon(l.lost ? 'pause' : 'scan-line', 14), l.lost ? t('dash.verifPaused') : l.sample === null ? t('dash.awaiting') : t('dash.verifRunning'));
    eta.replaceChildren(l.etaAt !== null ? fm.zulu(l.etaAt) : unknownValue());
    remaining.replaceChildren(l.remainingNm !== null ? fm.nm(Math.round(l.remainingNm)) : unknownValue());
    const p = progressOf(f.job.distanceNm, l.remainingNm);
    done.style.width = `${Math.round((p ?? 0) * 100)}%`;
    plane.hidden = p === null;
    plane.style.left = `${Math.round((p ?? 0) * 100)}%`;
  };
  show(first);
  const card = h('section', { class: 'panel current-flight', 'aria-labelledby': 'flight-title' },
    h('div', { class: 'flight-head' }, h('span', { class: 'status-line' }, dot, phase), verif),
    h('div', { class: 'col tight' },
      h('h2', { id: 'flight-title', class: 'flight-title' }, `${f.job.origin} → ${f.job.destination}`),
      h('span', { class: 'mono dim small' }, t('dash.flightMeta', { id: f.id, aircraft: f.aircraftIcao, aircraftId: f.aircraftId }), ' · ', loadLabel(f.job), ' · ', fm.nm(f.job.distanceNm), aircraft ? ` · ${fm.duration(blockHours(aircraft.type, f.job.distanceNm))}` : '')),
    h('div', { class: 'route-line' }, signLocation(f.job.origin), track, signDirection(f.job.destination)),
    f.job.route ? h('span', { class: 'mono dim small route-text' }, f.job.route) : null,
    sb,
    h('div', { class: 'facts' },
      fact(t('dash.eta'), eta), fact(t('dash.remaining'), remaining), fact(t('dash.payout'), fm.money(f.job.payout))),
    h('div', { class: 'row' },
      button(t('dash.follow'), { variant: 'primary', key: t('key.enter'), onclick: () => ctx.go('#live') }),
      button(t('dash.cutaway'), { variant: 'secondary', icon: 'scan-eye', key: 'C', onclick: () => ctx.go('#live/cutaway') })),
    flightActions(f, refresh),
    others.length > 0 ? h('div', { class: 'others' },
      h('span', { class: 'dim small' }, t('dash.others')),
      h('ul', { class: 'plain' }, others.slice(0, 2).map((o) => h('li', { class: 'other' }, h('span', { class: 'mono strong' }, `${o.job.origin} → ${o.job.destination}`), h('span', { class: 'dim small' }, `${o.aircraftIcao} #${o.aircraftId}`), flightActions(o, refresh)))),
      others.length > 2 ? h('a', { class: 'btn ghost', href: '#history' }, h('span', null, t('dash.seeAll', { n: others.length })), icon('chevron-right')) : null) : null);
  pollWhileShown('dash', card, async () => {
    const facts = liveFacts(await fetchLive(f.id).catch(() => null), Date.now());
    if (facts.settled) return refresh(); // settled while this card was open: reload the account, the dashboard re-renders without the flight
    show(facts);
  });
  return card;
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
  const [active, link] = await Promise.all([api<Flight[]>('/me/flights?status=active&limit=50'), getLink().catch((): SimbriefLink | null => null)]);
  const oldestFirst = [...active].sort((a, b) => a.acceptedAt - b.acceptedAt);
  const main = oldestFirst[0];
  const first = main ? liveFacts(await fetchLive(main.id).catch(() => null), Date.now()) : null;
  const sb = main && link ? simbriefBlock(main, link, ctx, snap.me.fleet.find((a) => a.id === main.aircraftId)?.registration) : null;
  const view = h('div', { class: 'wide-layout' }, companyTitle(snap),
    h('div', { class: 'offline-row' }, main && first ? currentFlight(main, ctx, oldestFirst.slice(1), first, sb?.node ?? null) : nextDeparture(ctx), keyFigures(snap.me, snap.lastFlight)));
  return {
    title: t('tab.dashboard'), scene: 'dashboard', tab: 'dashboard', wide: true, view, back: null,
    hints: main ? [{ key: t('key.enter'), label: t('hint.follow') }, { key: 'C', label: t('hint.cutaway') }, ...(sb ? [{ key: 'B', label: t('sb.hint.generate') }] : [])] : [{ key: t('key.enter'), label: t('hint.openJobs') }, { key: 'I', label: t('hint.simbrief') }],
    keys: main ? { c: () => ctx.go('#live/cutaway'), ...(sb ? { b: sb.open } : {}) } : { i: () => ctx.go('#simbrief') },
  };
}
