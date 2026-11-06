import { fallbackAircraft, type Flight } from '@opc/shared';
import { airportInfo } from '../airports.ts';
import { api } from '../api.ts';
import { bridgeStatus, fetchLive, type BridgeStatus } from '../api-live.ts';
import { button, icon } from '../components.ts';
import { flightBadge } from '../flight-view.ts';
import { fmt } from '../format.ts';
import { t } from '../i18n.ts';
import { pollWhileShown } from '../live-poll.ts';
import { LIVE_VIEWS, aircraftExtras, callsignLabel, companyExtras, liveFacts, nextView, zuluSeconds, type Body, type LiveCtx, type LiveFacts, type LiveViewId } from '../live-view.ts';
import type { Ctx, Hint, Screen } from '../screen.ts';
import { h } from '../ui.ts';
import { cabinBody } from './live-cabin.ts';
import { cutawayBody } from './live-cutaway.ts';
import { systemsBody } from './live-systems.ts';

/** The player hid the "bridge lost" alert (Esc). It comes back by itself once the bridge has been heard again and is lost again. */
let alertHidden = false;

const BODIES: Record<LiveViewId, (c: LiveCtx) => Body> = { cutaway: cutawayBody, cabin: cabinBody, systems: systemsBody };
const viewOf = (arg: string | null): LiveViewId => (LIVE_VIEWS.find((v) => v === arg) ?? 'cutaway');
const redraw = (): void => { window.dispatchEvent(new Event('opc:redraw')); };

/** The flight this screen follows: the oldest open one, as the dashboard does. */
async function activeFlight(): Promise<Flight | null> {
  const open = await api<Flight[]>('/me/flights?status=active&limit=50');
  open.sort((a, b) => a.acceptedAt - b.acceptedAt);
  return open[0] ?? null;
}

function noFlight(ctx: Ctx): Screen {
  const view = h('div', { class: 'live-view' },
    h('div', { class: 'live-empty panel' },
      h('h1', { class: 'live-empty-title' }, t('live.no.title')),
      h('p', { class: 'muted' }, t('live.no.body')),
      button(t('live.no.jobs'), { variant: 'primary', key: t('key.enter'), onclick: () => ctx.go('#jobs') })));
  return { title: t('tab.live'), scene: 'plain', tab: 'live', back: null, hints: [{ key: t('key.esc'), label: t('hint.dashboard') }], view };
}

function bridgeAlert(f: LiveFacts, onCheck: () => void): { el: HTMLElement; update: (f: LiveFacts) => void; diag: () => void } {
  const fm = fmt();
  const since = h('span', { class: 'alert-since' });
  const last = h('span', { class: 'alert-val' });
  const diagBox = h('div', { class: 'alert-diag', 'aria-live': 'polite', hidden: true });
  const row = (iconName: 'timer' | 'refresh-cw', label: string, value: Node | string): HTMLElement =>
    h('div', { class: 'alert-row' }, icon(iconName, 15), h('span', { class: 'alert-label' }, label), value instanceof Node ? value : h('span', { class: 'alert-val' }, value));
  const update = (n: LiveFacts): void => {
    since.textContent = n.silentMs === null ? t('live.lost.never') : t('live.lost.since', { time: fm.elapsed(n.silentMs) });
    last.textContent = n.receivedAt === null ? '–' : zuluSeconds(n.receivedAt);
  };
  const show = (b: BridgeStatus | null): void => {
    const line = (label: string, value: string): HTMLElement => h('div', { class: 'alert-row' }, h('span', { class: 'alert-label' }, label), h('span', { class: 'alert-val' }, value));
    diagBox.hidden = false;
    diagBox.replaceChildren(...(b === null ? [line(t('live.diag.bridge'), t('live.diag.noAnswer'))] : [
      line(t('live.diag.bridge'), b.version ?? '–'),
      line(t('live.diag.sim'), b.sim === null ? '–' : t(`live.sim.${b.sim}` as 'live.sim.connected')),
      line(t('live.diag.phase'), b.phase ?? '–'),
      line(t('live.diag.flags'), b.flags.length > 0 ? b.flags.join(', ') : t('live.diag.none'))]));
  };
  const diag = (): void => {
    diagBox.hidden = false;
    diagBox.replaceChildren(h('span', { class: 'dim small' }, t('live.lost.checking')));
    void bridgeStatus().then(show);
  };
  update(f);
  const el = h('section', { class: 'bridge-alert', role: 'alert', 'aria-labelledby': 'bridge-alert-title' },
    h('div', { class: 'alert-head' },
      h('span', { class: 'alert-icon' }, icon('unplug', 22)),
      h('div', { class: 'col tight' }, h('h2', { id: 'bridge-alert-title', class: 'alert-title' }, t('live.lost.title')), since)),
    h('p', { class: 'alert-body' }, t('live.lost.body')),
    h('div', { class: 'alert-list' },
      row('timer', t('live.lost.lastPacket'), last),
      row('refresh-cw', t('live.lost.polling'), t('live.lost.pollingV', { s: 2 }))),
    diagBox,
    h('div', { class: 'row' },
      button(t('live.lost.check'), { variant: 'primary', key: t('key.enter'), onclick: () => { onCheck(); diag(); } }),
      button(t('live.lost.diag'), { variant: 'secondary', icon: 'stethoscope', key: 'D', onclick: diag })));
  return { el, update, diag };
}

/** Vol en cours: the three live views of the open flight (cutaway, cabin & load, systems), polled every 2 s while shown. The hash picks the view: #live, #live/cabin, #live/systems. */
export async function live(ctx: Ctx): Promise<Screen> {
  const flight = await activeFlight();
  if (!flight) return noFlight(ctx);
  const id = viewOf(ctx.arg);
  const fm = fmt();
  const aircraft = ctx.snap.me.fleet.find((a) => a.id === flight.aircraftId);
  const type = aircraft?.type ?? fallbackAircraft(flight.aircraftIcao);
  const [from, to, first] = await Promise.all([airportInfo(flight.job.origin), airportInfo(flight.job.destination), fetchLive(flight.id).catch(() => null)]);
  const extras = aircraftExtras(aircraft);
  const c: LiveCtx = {
    flight, type, aircraft, registration: extras.registration ?? null, wearPct: extras.wearPct ?? null,
    flightLabel: callsignLabel(companyExtras(ctx.snap.me.company).callsign, flight.id) ?? t('live.flightNo', { n: flight.id }),
    from: from?.name ?? flight.job.origin, to: to?.name ?? flight.job.destination,
  };

  let facts = liveFacts(first, Date.now());
  if (!facts.lost) alertHidden = false;
  const lostShown = facts.lost && !alertHidden;

  const body = BODIES[id](c);
  body.update(facts);
  const dot = h('span', { class: facts.lost ? 'dot warn' : 'dot route' });
  const status = h('span', null);
  const setStatus = (f: LiveFacts): void => {
    status.textContent = f.lost ? t('live.statusLost', { flight: c.flightLabel }) : t('live.status', { flight: c.flightLabel, phase: t(`live.phase.${f.phase}` as 'live.phase.cruise') });
    dot.className = f.lost ? 'dot warn' : 'dot route';
  };
  const title = id === 'cabin' ? t('live.cabin.title') : id === 'systems' ? t('live.sys.title') : `${c.from} → ${c.to}`;
  const sub = id === 'cabin' ? t('live.cabin.status', { flight: c.flightLabel, time: fm.zulu(flight.acceptedAt) })
    : id === 'systems' ? `${c.registration ?? t('dash.flightMeta', { id: flight.id, aircraft: flight.aircraftIcao, aircraftId: flight.aircraftId })} · ${type.name}` : null;
  const setStatusAll = (f: LiveFacts): void => { if (sub === null) setStatus(f); };
  if (sub === null) setStatus(facts); else status.textContent = sub;

  const switcher = h('div', { class: 'view-switcher', role: 'group', 'aria-label': t('live.views') },
    LIVE_VIEWS.map((v) => h('button', { type: 'button', class: 'view-opt', 'aria-pressed': String(v === id), onclick: () => ctx.go(`#live/${v}`) }, t(`live.view.${v}` as 'live.view.cutaway'))));

  const alert = lostShown ? bridgeAlert(facts, () => void tick()) : null;
  const root = h('div', { class: `live-view view-${id}${facts.lost ? ' lost' : ''}` },
    h('div', { class: 'live-header' },
      h('div', { class: 'title-block' },
        h('div', { class: 'status-line' }, dot, status, flightBadge(flight)),
        h('h1', { class: 'title' }, title)),
      switcher),
    body.el, alert?.el ?? null);

  async function tick(): Promise<void> {
    const f = liveFacts(await fetchLive(flight!.id).catch(() => null), Date.now());
    facts = f;
    if (f.lost !== (root.classList.contains('lost'))) return redraw();
    body.update(f);
    setStatusAll(f);
    alert?.update(f);
  }
  pollWhileShown('live', root, tick);

  const hints: Hint[] = [
    { key: t('key.esc'), label: lostShown ? t('live.hint.hideAlert') : t('hint.dashboard') },
    ...(lostShown ? [{ key: t('key.enter'), label: t('live.hint.checkBridge') }, { key: 'D', label: t('live.hint.diag') }] : [{ key: 'V', label: t('live.hint.switchView') }]),
    ...(id === 'cutaway' && !lostShown ? [{ key: t('key.mouse'), label: t('live.hint.rotate') }] : []),
  ];
  return {
    title: t('tab.live'), scene: 'plain', tab: 'live', view: root, hints,
    back: () => { if (lostShown) { alertHidden = true; redraw(); } else ctx.go('#dashboard'); },
    keys: { v: () => ctx.go(`#live/${nextView(id)}`), d: () => alert?.diag() },
  };
}
