import type { CompanyProfile } from '@opc/shared';
import { act } from '../actions.ts';
import { fetchNetwork, setNetworkEnabled, type Network } from '../api-lines.ts';
import { button, icon, panel, titleBlock, unknownValue } from '../components.ts';
import { aiRivals } from '../competition.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import { hashFor } from '../keys.ts';
import { airportFacts, clockGroup, featureOff, pairLabel, stateLabel, swatch, typeNames } from '../lines-ui.ts';
import {
  aircraftOfLine, clockNow, everyHours, faceToFace, flightsPerDay, inService, lineDelay, lineVisual, mapAirportCodes, mapAirports, mapFlights, mapLines, NETWORK_TAB, pairId, reopenTarget,
  type FaceToFace,
} from '../lines-view.ts';
import { pollWhileShown } from '../live-poll.ts';
import type { Key } from '../messages.ts';
import { buildNetworkMap, drawNetworkMap } from '../network-map.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h } from '../ui.ts';

const POLL_NETWORK_MS = 5000;
const POLL_CLOCK_MS = 1000;
const MAP_SIZE = { w: 1600, h: 778 };
const MAP_FIT = { left: 110, top: 215, right: 1100, bottom: 680 };

/** The line the keyboard has selected. Kept across redraws so the list does not jump back to the first line. */
let selected: string | null = null;

type Rival = { profile: CompanyProfile; net: Network };
/** The AI companies that fly lines. A server without the route, or a company without lines, is left out. */
async function loadRivals(): Promise<Rival[]> {
  const { profiles } = await aiRivals();
  const nets = await Promise.all(profiles.map((p) => fetchNetwork(p.id).catch(() => null)));
  return profiles.flatMap((profile, i) => (nets[i]?.lines.length ? [{ profile, net: nets[i]! }] : []));
}

const fact = (label: string, value: Node | string): HTMLElement => h('div', { class: 'ln-fact' }, h('span', { class: 'muted' }, label), h('span', { class: 'ln-fact-value' }, value));

export async function network(ctx: Ctx): Promise<Screen> {
  const { snap, go } = ctx;
  const { me } = snap;
  const fm = fmt();
  const asked = ctx.arg === null ? NaN : Number(ctx.arg);
  const [own, rivals] = await Promise.all([fetchNetwork(), loadRivals()]);
  if (!own) return { title: t('ln.net.title', { company: me.company.name }), scene: 'jobs', tab: NETWORK_TAB, back: '#dashboard', hints: [{ key: t('key.esc'), label: t('hint.back') }], view: featureOff('ln.off.title') };

  const rival = rivals.find((r) => r.profile.id === asked) ?? null;
  /** What is on screen, replaced by each poll. */
  const data = { own, rival: rival?.net ?? null, at: Date.now() };
  const shown = (): Network => data.rival ?? data.own;
  const lines = shown().lines;
  const [facts, nameOf] = await Promise.all([
    airportFacts(mapAirportCodes(own, rival?.net ?? null, [...me.hubs, ...(rival?.profile.hubs ?? [])])),
    typeNames([...lines.flatMap((l) => l.aircraft.map((a) => a.icao)), ...me.fleet.map((a) => a.icao)]),
  ]);
  const city = new Map(facts.map((f) => [f.icao, f.city]));
  const airports = mapAirports(facts, me.hubs, rival?.profile.hubs ?? []);
  const redraw = (): void => { window.dispatchEvent(new Event('opc:redraw')); };
  if (!rival && (selected === null || !lines.some((l) => pairId(l) === selected))) selected = lines[0] ? pairId(lines[0]) : null;

  // ------------------------------------------------------------ the map
  const mapHost = h('div', { class: 'ln-map' });
  const paintMap = (): void => {
    const net = shown();
    const flights = mapFlights(data.own, data.rival, (f, mine) => (mine ? t('ln.map.yours', { no: f.flightNo }) : t('ln.map.flight', { no: f.flightNo, to: f.to })));
    const scene = buildNetworkMap({ airports, lines: mapLines(data.own, data.rival), flights, selected: rival ? null : selected, fit: MAP_FIT, size: MAP_SIZE, text: { interrupted: t('ln.state.interrupted', { n: 0 }), contested: t('ln.contested') } });
    mapHost.replaceChildren(drawNetworkMap(scene, t('ln.map.label', { n: net.lines.length })));
  };

  // ------------------------------------------------------------ header
  const dot = h('span', { class: 'dot' });
  const status = h('span');
  const paintStatus = (): void => {
    const n = shown();
    const { running, total } = inService(me.fleet);
    dot.className = `dot${n.enabled ? '' : ' idle'}`;
    status.textContent = rival ? t('ln.net.rivalStatus') : n.enabled ? t('ln.net.status', { running, total }) : t('ln.net.statusOff');
  };
  const clock = clockGroup(own.enabled, (on) => void act(t(on ? 'ln.auto.on' : 'ln.auto.off'), () => setNetworkEnabled(on), async () => redraw()));
  const paintClock = (): void => clock.set(clockNow(data.own.now, data.at, Date.now()), data.own.enabled);
  const fleetSize = rival ? rival.profile.fleet.reduce((s, f) => s + f.count, 0) : 0;
  const sub = rival
    ? t('ln.net.rivalSub', { hub: city.get(rival.profile.hubs[0] ?? '') ?? rival.profile.hubs[0] ?? '–', lines: rival.net.lines.length, aircraft: fleetSize, flying: rival.net.flying.length })
    : t('ln.net.sub');
  const title = rival ? t('ln.net.rivalTitle', { company: rival.profile.name }) : t('ln.net.title', { company: me.company.name });
  const header = h('div', { class: 'ln-header' }, titleBlock(h('span', { class: 'row tight' }, dot, status), title, h('p', { class: 'dim ln-sub' }, sub)), clock.root);

  // ------------------------------------------------------------ my lines
  const states = new Map<number, HTMLElement>();
  const inspection = new Set(me.fleet.filter((a) => a.status === 'maintenance').map((a) => a.registration));
  const paintStates = (): void => { for (const l of shown().lines) states.get(l.id)?.replaceChildren(stateLabel(lineVisual(l, shown().flying), lineDelay(l, shown().flying))); };
  const select = (id: string): void => {
    if (selected === id) return;
    selected = id;
    for (const r of document.querySelectorAll<HTMLElement>('.ln-row')) r.classList.toggle('selected', r.dataset.line === id);
    paintMap();
    paintPrimary();
  };
  const lineRow = (l: Network['lines'][number]): HTMLElement => {
    const visual = lineVisual(l, own.flying);
    const id = pairId(l);
    const state = h('span', { class: 'ln-state-host' }, stateLabel(visual, lineDelay(l, own.flying)));
    states.set(l.id, state);
    const when = visual === 'interrupted' && l.interruptedSince !== null ? t('ln.row.suspended', { at: fm.zulu(l.interruptedSince) })
      : visual === 'paused' ? t('ln.row.paused') : t('ln.row.cadence', { every: everyHours(l), perDay: flightsPerDay(l) });
    const [first = '', ...rest] = aircraftOfLine(l, nameOf);
    const down = l.aircraft.some((a) => inspection.has(a.registration)) ? ` · ${t('ln.row.inspection')}` : '';
    return h('li', null, h('button', {
      type: 'button', id: `ln-row-${l.id}`, class: `ln-row${id === selected ? ' selected' : ''}`, 'data-row': '', 'data-line': id,
      onfocus: () => select(id), onmouseenter: () => select(id), onclick: () => go(hashFor('line', l.id)),
    },
    h('span', { class: 'ln-row-top' }, swatch(visual, id === selected), h('span', { class: 'mono strong ln-code' }, pairLabel(l.a, l.b)), state),
    h('span', { class: 'ln-row-details' },
      h('span', { class: 'muted small' }, `${city.get(l.a) ?? l.a} – ${city.get(l.b) ?? l.b} · ${when}`),
      h('span', { class: 'dim small' }, `${first}${rest.length ? ` +${rest.length}` : ''}${down}`))));
  };

  const today = h('div', { class: 'ln-today' });
  const paintToday = (): void => {
    const { done, cancelled, onTimePct, nextDeparture: next } = data.own.today;
    today.replaceChildren(
      fact(t('ln.today.flights'), t('ln.today.counts', { done, cancelled })),
      fact(t('ln.today.next'), next ? t('ln.today.nextValue', { at: fm.zulu(next.dep), from: next.origin, to: next.dest }) : unknownValue()),
      fact(t('ln.today.onTime'), done + cancelled === 0 ? unknownValue() : `${fm.num(onTimePct)}\u00a0%`));
  };

  const actions = h('div', { class: 'ln-actions' });
  const shared = rival ? faceToFace(own.lines, rival.net.lines) : null;
  const reopen = shared ? reopenTarget(shared.shared) : null;
  function paintPrimary(): void {
    if (rival) {
      actions.replaceChildren(
        ...(reopen ? [button(t('ln.reopen', { pair: pairLabel(reopen.own.a, reopen.own.b) }), { variant: 'primary', key: t('key.enter'), onclick: () => go(hashFor('line', reopen.own.id)) })] : []),
        button(t('ln.sheet', { company: rival.profile.name }), { variant: 'ghost', key: 'F', onclick: () => go(hashFor('company-sheet', rival.profile.id)) }));
      return;
    }
    const l = data.own.lines.find((x) => pairId(x) === selected);
    actions.replaceChildren(
      ...(l ? [button(t('ln.open', { pair: pairLabel(l.a, l.b) }), { variant: 'primary', key: t('key.enter'), onclick: () => go(hashFor('line', l.id)) })] : []),
      button(t('ln.new'), { variant: 'ghost', key: 'N', onclick: () => go('#line-new') }));
  }

  // ------------------------------------------------------------ the right-hand panel
  const faceRow = (s: FaceToFace, name: string): HTMLElement => {
    const down = s.own.status !== 'active';
    const youState = down ? `${t(`ln.state.${s.own.status}` as Key, { n: 0 })}${s.own.interruptedSince === null ? '' : ` · ${t('ln.row.since', { at: fm.zulu(s.own.interruptedSince) })}`}` : t('ln.row.every', { every: everyHours(s.own) });
    return h('li', null, h('button', { type: 'button', class: 'ln-face-row', 'data-row': '', 'aria-label': pairLabel(s.own.a, s.own.b), onclick: () => go(hashFor('line', s.own.id)) },
      h('span', { class: 'ln-face-head' }, h('span', { class: 'mono strong' }, pairLabel(s.own.a, s.own.b)), h('span', { class: 'dim small' }, `${city.get(s.own.a) ?? s.own.a} – ${city.get(s.own.b) ?? s.own.b}`)),
      h('span', { class: 'ln-face-line' }, h('span', { class: 'ln-face-who' }, t('ln.face.you')), h('span', { class: down ? 'ln-down' : 'muted' }, youState)),
      h('span', { class: 'ln-face-line' }, h('span', { class: 'ln-face-who' }, name), h('span', { class: 'muted' }, t('ln.row.every', { every: everyHours(s.rival) })))));
  };
  const aloneRow = (l: Network['lines'][number]): HTMLElement =>
    h('li', null, h('button', { type: 'button', class: 'ln-alone', 'data-row': '', 'aria-label': pairLabel(l.a, l.b) }, h('span', { class: 'mono strong' }, pairLabel(l.a, l.b)), h('span', { class: 'dim small' }, t('ln.row.every', { every: everyHours(l) }))));

  let side: HTMLElement;
  if (rival && shared) {
    side = panel({ title: t('ln.face.title'), action: tp('ln.face.common', shared.shared.length), id: 'ln-side', class: 'ln-panel' },
      h('ul', { class: 'plain ln-rows' }, shared.shared.map((s) => faceRow(s, rival.profile.name))),
      h('h3', { class: 'ln-sub-title' }, t('ln.face.alone')),
      shared.alone.length ? h('ul', { class: 'plain ln-rows' }, shared.alone.map(aloneRow)) : h('p', { class: 'dim small' }, t('ln.face.noneAlone')),
      actions);
  } else if (lines.length === 0) {
    side = panel({ title: t('ln.panel'), action: tp('ln.count', 0), id: 'ln-side', class: 'ln-panel' }, h('div', { class: 'ln-empty' }, icon('route', 20), h('p', { class: 'muted' }, t('ln.empty')), h('p', { class: 'dim small' }, t('ln.empty.hint'))), today, actions);
  } else {
    side = panel({ title: t('ln.panel'), action: tp('ln.count', lines.length), id: 'ln-side', class: 'ln-panel' }, h('ul', { class: 'plain ln-rows', 'aria-label': t('ln.list') }, lines.map(lineRow)), today, actions);
  }

  // ------------------------------------------------------------ footer: network tabs and legend
  const tabs = [{ id: null as number | null, name: t('ln.tabs.mine') }, ...rivals.map((r) => ({ id: r.profile.id, name: r.profile.name }))];
  const current = rival ? rival.profile.id : null;
  const hashOf = (id: number | null): string => (id === null ? '#network' : hashFor('network', id));
  const switcher = h('div', { class: 'ln-tabs segments', role: 'group', 'aria-label': t('ln.tabs') }, tabs.map((tab) => h('button', { type: 'button', class: 'seg', 'aria-pressed': String(tab.id === current), onclick: () => go(hashOf(tab.id)) }, tab.name)));
  const legendItems: [string, string][] = rival
    ? [['rival', rival.profile.name], ['mine', t('ln.legend.yours')], ['contested', t('ln.contested')], ['plane', t('ln.legend.flying')]]
    : [['mine', t('ln.legend.service')], ['route', t('ln.legend.own')], ['down', t('ln.state.interrupted', { n: 0 })], ['plane', t('ln.legend.flying')]];
  const legend = h('div', { class: 'ln-legend' }, legendItems.map(([kind, label]) =>
    h('span', { class: 'ln-legend-item' }, kind === 'plane' ? icon('plane', 16) : h('span', { class: `ln-legend-swatch ${kind}`, 'aria-hidden': 'true' }, kind === 'down' ? [h('i'), h('i'), h('i')] : null), label)));

  paintStatus(); paintClock(); paintToday(); paintPrimary(); paintMap();
  const view = h('div', { class: 'ln-net' }, mapHost, header, h('div', { class: 'ln-body' }, h('div', { class: 'ln-map-col' }, h('div', { class: 'ln-map-foot' }, switcher, legend)), side));

  // ------------------------------------------------------------ live: the clock runs, the network refreshes
  const signature = (n: Network): string => n.lines.map((l) => `${l.id}:${l.status}:${lineDelay(l, n.flying)}`).join();
  pollWhileShown('ln-clock', view, async () => paintClock(), POLL_CLOCK_MS);
  pollWhileShown('ln-network', view, async () => {
    const [fresh, freshRival] = await Promise.all([fetchNetwork(), rival ? fetchNetwork(rival.profile.id) : Promise.resolve(null)]);
    if (!fresh || (rival && !freshRival)) return;
    const before = signature(shown());
    data.own = fresh; data.rival = freshRival; data.at = Date.now();
    if (signature(shown()) !== before) { redraw(); return; }
    paintStatus(); paintClock(); paintToday(); paintMap();
  }, POLL_NETWORK_MS);

  const cycle = (): void => go(hashOf(tabs[(tabs.findIndex((x) => x.id === current) + 1) % tabs.length]!.id));
  const hints = [{ key: t('key.esc'), label: rival ? t('ln.hint.mine') : t('hint.back') }, { key: '↑ ↓', label: t('ln.hint.next') }];
  if (tabs.length > 1) hints.push({ key: 'T', label: t('ln.hint.other') });
  hints.push(...(rival ? [{ key: 'F', label: t('ln.hint.sheet') }] : [{ key: t('key.enter'), label: t('ln.hint.open') }, { key: 'N', label: t('ln.hint.new') }, { key: 'O', label: t('ln.hint.ops') }]));
  return {
    title, scene: rival ? 'leaderboard' : 'jobs', tab: NETWORK_TAB, view, back: rival ? '#network' : '#dashboard', hints,
    keys: { ...(tabs.length > 1 ? { t: cycle } : {}), ...(rival ? { f: () => go(hashFor('company-sheet', rival.profile.id)) } : { n: () => go('#line-new'), o: () => go('#ops') }) },
  };
}
