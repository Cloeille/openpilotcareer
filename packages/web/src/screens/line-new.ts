import { createLine, forecastLine, type LineForecastView } from '../api-lines.ts';
import { act } from '../actions.ts';
import { airportInfo, cityOf } from '../airports.ts';
import { airportField } from '../airport-field.ts';
import { button, icon, panel, switchControl, unknownValue } from '../components.ts';
import { ApiError } from '../errors.ts';
import { errorText } from '../error-text.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import { hashFor } from '../keys.ts';
import {
  asProgramme, blockMinutesFor, candidateAircraft, DEFAULT_DRAFT, DEFAULT_TURNAROUND_MIN, draftProblem, forecastShare, freqFromPerHour, hhmm, isRoundTheClock, MAX_FREQ, minutesOf, NETWORK_TAB, perHour,
  previewProgramme, ROUND_THE_CLOCK, WEEKDAYS, type Draft, type DraftProblem, type Preview,
} from '../lines-view.ts';
import { fill } from '../lines-ui.ts';
import { debounce, h, notify } from '../ui.ts';
import type { Key } from '../messages.ts';
import type { Ctx, Screen } from '../screen.ts';
import { distanceNm } from '@opc/shared';

/** The draft survives a redraw (language change, refresh) so a half-made line is not lost. */
let draft: Draft = { ...DEFAULT_DRAFT };
let unit: 'day' | 'hour' = 'day';

/** Why the server would refuse the programme (codes of `POST /lines` errors), in the player's words; an unknown code is shown as it is. */
const REFUSAL_KEY: Record<string, Key> = { hub_missing: 'ln.err.hub_missing', aircraft_busy: 'ln.err.aircraft_busy', duplicate_line: 'ln.err.duplicate_line', distance_exceeds_range: 'ln.err.distance_exceeds_range' };
const refusalText = (code: string): string => (REFUSAL_KEY[code] ? t(REFUSAL_KEY[code]!) : code);
const PROBLEM_KEY: Record<DraftProblem, Key> = { airports: 'ln.new.p.airports', same: 'ln.new.p.same', aircraft: 'ln.new.p.aircraft', days: 'ln.new.p.days', window: 'ln.new.p.window', freq: 'ln.new.p.freq' };

/** `#line-new`: pick two airports, a programme and aircraft; see the timetable it makes, what it needs and a week's forecast; open the line. */
export async function lineNew(ctx: Ctx): Promise<Screen> {
  const { snap, go } = ctx;
  const { me } = snap;
  const fm = fmt();
  const aircraft = me.fleet;
  if (!draft.a) draft = { ...draft, a: me.hubs[0] ?? '' };
  const redraw = (): void => { window.dispatchEvent(new Event('opc:redraw')); };

  const known = { a: false, b: false };
  const info = { a: null as Awaited<ReturnType<typeof airportInfo>>, b: null as Awaited<ReturnType<typeof airportInfo>> };
  [info.a, info.b] = await Promise.all([draft.a ? airportInfo(draft.a) : null, draft.b ? airportInfo(draft.b) : null]);
  known.a = info.a !== null; known.b = info.b !== null;
  const types = new Map(me.fleet.map((a) => [a.id, a.type]));
  const distance = info.a && info.b ? distanceNm(info.a.lat, info.a.lon, info.b.lat, info.b.lon) : null;
  const slowest = draft.aircraftIds.map((id) => types.get(id)).filter((x): x is NonNullable<typeof x> => !!x).sort((x, y) => x.cruiseKts - y.cruiseKts)[0] ?? null;
  const block = distance !== null && slowest ? blockMinutesFor(slowest, distance) : null;

  // ------------------------------------------------------------ the route
  const field = (label: string, which: 'a' | 'b'): { root: HTMLElement; input: HTMLInputElement } => {
    const f = airportField(label, { value: draft[which], name: `ln-${which}`, id: `ln-${which}-input` });
    f.input.addEventListener('input', debounce(() => {
      const code = f.input.value.trim().toUpperCase();
      if (/^[A-Z]{4}$/.test(code) && code !== draft[which]) { draft = { ...draft, [which]: code }; redraw(); }
    }, 350));
    return f;
  };
  const depart = field(t('ln.new.from'), 'a');
  const arrive = field(t('ln.new.to'), 'b');
  const swap = h('button', { type: 'button', class: 'ln-swap', 'aria-label': t('ln.new.swap'), onclick: () => { draft = { ...draft, a: draft.b, b: draft.a }; redraw(); } }, icon('refresh-cw', 18));
  const cities = (a: typeof info.a): string => (a ? cityOf(a).replace(/\s*\(.*$/, '') : '');
  const title = known.a && known.b ? `${cities(info.a)} → ${cities(info.b)}` : t('ln.new.titleEmpty');
  const sub = distance !== null
    ? t('ln.new.sub', { nm: fm.nm(Math.round(distance)), time: block ? fm.duration(block / 60) : '–' })
    : t('ln.new.subEmpty');
  const header = h('div', { class: 'ln-new-header' },
    h('div', { class: 'col tight' }, h('p', { class: 'muted' }, t('ln.new.kicker', { company: me.company.name })), h('h1', { class: 'title ln-new-title' }, title), h('p', { class: 'dim' }, sub)),
    h('div', { class: 'ln-route' }, depart.root, swap, arrive.root));

  // ------------------------------------------------------------ the programme controls
  const set = (patch: Partial<Draft>): void => { draft = { ...draft, ...patch }; redraw(); };
  const stepper = (label: string, text: string, onMinus: () => void, onPlus: () => void, canMinus: boolean, canPlus: boolean, id: string): HTMLElement =>
    h('div', { class: 'ln-stepper', role: 'group', 'aria-label': label },
      h('button', { type: 'button', id: `${id}-minus`, 'aria-label': t('ln.new.less', { what: label }), disabled: !canMinus, onclick: onMinus }, icon('minus', 16)),
      h('output', { class: 'ln-stepper-value', 'aria-live': 'polite' }, text),
      h('button', { type: 'button', id: `${id}-plus`, 'aria-label': t('ln.new.more', { what: label }), disabled: !canPlus, onclick: onPlus }, icon('plus', 16)));
  const perH = unit === 'hour';
  const freqNow = perH ? perHour(draft) : draft.freqPerDay;
  const freqMax = perH ? Math.max(1, Math.floor(MAX_FREQ / Math.max(1, freqFromPerHour(1, draft)))) : MAX_FREQ;
  const setFreq = (n: number): void => set({ freqPerDay: perH ? freqFromPerHour(n, draft) : n });
  const freq = h('div', { class: 'ln-control' }, h('span', { class: 'ln-control-label', id: 'ln-freq-label' }, t('ln.new.freq')),
    h('div', { class: 'row' },
      stepper(t('ln.new.freq'), perH ? tp('ln.new.perHourN', freqNow) : tp('ln.new.roundTrips', freqNow), () => setFreq(freqNow - 1), () => setFreq(freqNow + 1), freqNow > 1, freqNow < freqMax, 'ln-freq'),
      h('div', { class: 'ln-unit segments', role: 'group', 'aria-label': t('ln.new.unit') }, (['day', 'hour'] as const).map((u) =>
        h('button', { type: 'button', class: 'seg', 'aria-pressed': String(unit === u), onclick: () => { unit = u; redraw(); } }, t(u === 'day' ? 'ln.new.perDay' : 'ln.new.perHour'))))));
  const chosen = draft.aircraftIds.length;
  const planes = h('div', { class: 'ln-control' }, h('span', { class: 'ln-control-label' }, t('ln.new.aircraft')),
    stepper(t('ln.new.aircraft'), tp('ln.new.planes', chosen), () => set({ aircraftIds: draft.aircraftIds.slice(0, -1) }),
      () => { const next = candidateAircraft(aircraft, draft.a).find((x) => !draft.aircraftIds.includes(x.id)); if (next) set({ aircraftIds: [...draft.aircraftIds, next.id] }); },
      chosen > 0, aircraft.some((x) => !draft.aircraftIds.includes(x.id) && x.status !== 'maintenance'), 'ln-planes'));
  const days = h('div', { class: 'ln-control' }, h('span', { class: 'ln-control-label' }, t('ln.new.days')),
    h('div', { class: 'ln-days', role: 'group', 'aria-label': t('ln.new.days') }, WEEKDAYS.map((d, i) =>
      h('button', { type: 'button', class: 'ln-daybtn', 'aria-pressed': String(draft.days[i]), 'aria-label': t(`ln.wd.${d}`), onclick: () => set({ days: draft.days.map((v, j) => (j === i ? !v : v)) }) }, t(`ln.wd.${d}`).slice(0, 1).toUpperCase()))));
  const around = isRoundTheClock(draft);
  const hours = h('div', { class: 'ln-control' }, h('span', { class: 'ln-control-label', id: 'ln-around-label' }, t('ln.new.operation')),
    h('div', { class: 'row' }, switchControl({ checked: around, labelledBy: 'ln-around-label', id: 'ln-around', onchange: (on) => set(on ? { ...ROUND_THE_CLOCK } : { windowStart: DEFAULT_DRAFT.windowStart, windowEnd: DEFAULT_DRAFT.windowEnd }) }), h('span', { class: 'muted' }, t('ln.new.allDay'))));
  const timeInput = (label: string, key: 'windowStart' | 'windowEnd'): HTMLElement =>
    h('label', { class: 'ln-time' }, h('span', { class: 'dim small' }, label),
      h('input', { type: 'time', value: draft[key], disabled: around, step: 1800, onchange: (e: Event) => { const v = (e.target as HTMLInputElement).value; if (/^\d\d:\d\d$/.test(v)) set({ [key]: v }); } }));
  const controls = h('div', { class: 'ln-controls' }, planes, freq, days, hours);

  // ------------------------------------------------------------ the timetable the programme makes
  const turnaround = DEFAULT_TURNAROUND_MIN;
  let forecast: LineForecastView | null = null;
  const preview = (): Preview | null => (block ? previewProgramme(draft, block, turnaround, forecast?.conflicts ?? []) : null);
  const tableHost = h('div', { class: 'ln-schedule' });
  const sideHost = h('div', { class: 'ln-need-col' });
  const paintTable = (): void => {
    const pv = preview();
    const axis = h('div', { class: 'ln-axis', 'aria-hidden': 'true' }, [0, 3, 6, 9, 12, 15, 18, 21].map((hr) => h('span', { style: `left:${(hr / 24) * 100}%` }, `${String(hr).padStart(2, '0')}Z`)));
    const track = (cls: string, content: Node[]): HTMLElement => h('div', { class: `ln-track ${cls}` }, content);
    const windowBar = h('span', { class: 'ln-window', style: `left:${(minutesOf(draft.windowStart) / 1440) * 100}%;width:${((minutesOf(draft.windowEnd) - minutesOf(draft.windowStart)) / 1440) * 100}%` }, around ? t('ln.new.allDay') : `${draft.windowStart}Z – ${draft.windowEnd}Z`);
    const ticks = (mins: number[]): Node[] => mins.map((m) => h('span', { class: 'ln-dep', style: `left:${(m / 1440) * 100}%` }, hhmm(m)));
    const rowOf = (label: string, content: Node[]): HTMLElement => h('div', { class: 'ln-row-grid' }, h('span', { class: 'ln-row-label' }, label), content.length === 1 ? content[0]! : h('div', null, content));
    const lanes = (pv?.lanes ?? []).map((lane) => {
      const a = aircraft.find((x) => x.id === lane.aircraftId)!;
      const free = a.location === draft.a;
      return rowOf('', [h('div', { class: 'ln-lane-new' },
        h('div', { class: 'ln-lane-id' }, h('span', { class: 'mono' }, a.registration), h('span', { class: 'dim small' }, `${a.type.name} · ${free ? t('ln.new.freeAt', { city: cities(info.a) || draft.a }) : t('ln.new.at', { at: a.location })}`)),
        track('', lane.blocks.map((b) => h('span', { class: `ln-block-new ${b.leg}${b.conflict ? ' conflict' : ''}`, style: `left:${(b.dep / 1440) * 100}%;width:${((b.arr - b.dep) / 1440) * 100}%`, title: `${hhmm(b.dep)} → ${hhmm(b.arr)}` }, b.leg === 'out' ? draft.b : draft.a))))]);
    });
    fill(tableHost,
      rowOf(t('ln.new.time'), [axis]),
      rowOf(t('ln.new.window'), [track('', [windowBar])]),
      rowOf(t('ln.new.depFrom', { city: cities(info.a) || draft.a }), [track('ticks', pv ? ticks(pv.fromA) : [])]),
      rowOf(t('ln.new.depFrom', { city: cities(info.b) || draft.b }), [track('ticks', pv ? ticks(pv.fromB) : [])]),
      ...lanes,
      pv && draft.aircraftIds.length === 0 ? h('p', { class: 'dim small ln-hint' }, t('ln.new.assignHint')) : null,
      h('div', { class: 'ln-gantt-legend' }, [['out', t('ln.new.legend.out', { city: cities(info.b) || draft.b })], ['back', t('ln.new.legend.back', { city: cities(info.a) || draft.a })], ['conflict', t('ln.new.legend.conflict')]].map(([k, l]) => h('span', { class: 'ln-legend-item' }, h('span', { class: `ln-legend-seg ${k}`, 'aria-hidden': 'true' }), l))),
      pv ? h('p', { class: 'dim small ln-totals' }, t('ln.new.totals', { trips: pv.roundTripsPerWeek, hours: fm.num(pv.weekHours, 0), turn: turnaround, city: cities(info.b) || draft.b })) : null);
  };

  const left = panel({ title: t('ln.new.programme'), id: 'ln-programme', class: 'ln-programme', action: undefined }, controls, h('div', { class: 'ln-times' }, timeInput(t('ln.new.opens'), 'windowStart'), timeInput(t('ln.new.closes'), 'windowEnd')), tableHost);

  // ------------------------------------------------------------ what it needs, the forecast, and the button
  const problem = draftProblem(draft, known);
  const need = (label: string, n: { required: number; available: number } | null, text?: string): HTMLElement => {
    const short = n !== null && n.available < n.required;
    return h('div', { class: `ln-need${short ? ' short' : ''}` }, h('span', { class: 'muted' }, label), h('span', { class: 'ln-need-value' }, text ?? (n ? t('ln.need.value', { required: n.required, available: n.available }) : '–')));
  };
  const paintSide = (): void => {
    const f = forecast;
    const share = f ? forecastShare(f.forecast) : null;
    const conflicts = f?.conflicts ?? [];
    const crewShort = f !== null && f.crewModelled && f.needs.pilots.available < f.needs.pilots.required;
    const crewNeed = (n: { required: number; available: number }): { text?: string } => (f!.crewModelled ? {} : { text: t('ln.need.requiredOnly', { required: n.required }) });
    const refusal = f && !f.valid ? f.problems[0] ?? null : null;
    const primary = button(t('ln.new.open'), { variant: 'primary', key: t('key.enter'), disabled: problem !== null || (f !== null && !f.valid), onclick: () => void create() });
    sideHost.replaceChildren(
      panel({ title: t('ln.need.title'), class: 'ln-needs', id: 'ln-needs' },
        f ? [need(t('ln.need.pilots'), f.needs.pilots, crewNeed(f.needs.pilots).text), need(t('ln.need.cabin'), f.needs.cabin, crewNeed(f.needs.cabin).text), need(t('ln.need.ground', { city: cities(info.b) || draft.b }), f.needs.ground, f.needs.ground.missingAt.length ? t('ln.need.groundMissing', { n: f.needs.ground.required - f.needs.ground.available }) : t('ln.need.groundOk')), need(t('ln.need.maintenance'), null, f.needs.maintenance)] : h('p', { class: 'dim small' }, problem ? t(PROBLEM_KEY[problem]) : t('ln.need.loading')),
        crewShort ? h('div', { class: 'ln-warn' }, icon('triangle-alert', 16), h('div', { class: 'col tight' }, h('span', null, t('ln.warn.crew', { n: f!.needs.pilots.required - f!.needs.pilots.available })), h('button', { type: 'button', class: 'link-btn', onclick: () => go('#staff/hire') }, t('ln.warn.recruit', { n: f!.needs.pilots.required - f!.needs.pilots.available })))) : null,
        refusal ? h('div', { class: 'ln-warn', role: 'alert' }, icon('circle-x', 16), h('span', null, refusalText(refusal))) : null,
        conflicts.length ? h('div', { class: 'ln-warn' }, icon('triangle-alert', 16), h('span', null, t('ln.warn.conflict', { reg: aircraft.find((x) => x.id === conflicts[0]!.aircraftId)?.registration ?? '', no: `${me.company.code ?? ''} ${conflicts[0]!.flightNo}`.trim(), at: fm.zulu(conflicts[0]!.at) }))) : null),
      panel({ title: t('ln.fc.title'), action: h('span', { class: 'badge estimated' }, t('ln.fc.estimated')), class: 'ln-forecast', id: 'ln-forecast' },
        f ? [h('div', { class: 'col tight' }, h('span', { class: 'muted small' }, t('ln.fc.profit')), h('span', { class: `ln-profit${f.forecast.profit < 0 ? ' loss' : ''}` }, fm.signedMoney(f.forecast.profit)), h('span', { class: 'dim small' }, t('ln.fc.split', { revenue: fm.money(f.forecast.revenue), costs: fm.money(f.forecast.costs) }))),
          share ? h('div', { class: 'ln-fc-bar', role: 'img', 'aria-label': t('ln.fc.split', { revenue: fm.money(f.forecast.revenue), costs: fm.money(f.forecast.costs) }) }, h('span', { class: 'cost', style: `width:${share.costs}%` }), h('span', { class: 'margin', style: `width:${share.margin}%` })) : null,
          need(t('ln.fc.demand'), null, tp('ln.fc.pax', f.forecast.weeklyDemand, { n: fm.num(f.forecast.weeklyDemand) })),
          need(t('ln.fc.load'), null, t('ln.fc.loadValue', { pct: fm.percent(f.forecast.loadFactor), pax: fm.num(Math.round(f.forecast.loadFactor * f.forecast.seatsPerWeek)), seats: fm.num(f.forecast.seatsPerWeek) })),
          need(t('ln.fc.competition'), null, f.forecast.competition ? t('ln.fc.rival', { company: f.forecast.competition.company, n: f.forecast.competition.flightsPerDay }) : t('ln.fc.none'))] : unknownValue()),
      primary);
  };

  let seq = 0;
  const refreshForecast = debounce(async () => {
    const mine = ++seq;
    if (problem !== null) { forecast = null; paintSide(); paintTable(); return; }
    try {
      const f = await forecastLine(asProgramme(draft));
      if (mine !== seq) return;
      forecast = f;
    } catch (e) {
      if (mine !== seq) return;
      forecast = null;
      if (e instanceof ApiError && e.status !== 404) notify(errorText(e), 'error');
    }
    paintSide(); paintTable();
  }, 250);

  async function create(): Promise<void> {
    if (problem !== null) { notify(t(PROBLEM_KEY[problem]), 'error'); return; }
    let line: { id: number } | null = null;
    const ok = await act(t('ln.new.created'), async () => { line = await createLine(asProgramme(draft)); }, ctx.refresh);
    if (ok && line) { draft = { ...DEFAULT_DRAFT }; unit = 'day'; go(hashFor('line', (line as { id: number }).id)); }
  }

  paintTable(); paintSide();
  if (problem === null) refreshForecast();
  const view = h('div', { class: 'ln-new' }, header, h('div', { class: 'ln-new-body' }, left, sideHost));
  return {
    title: t('ln.new.title'), scene: 'jobs', tab: NETWORK_TAB, view, back: '#network',
    hints: [{ key: t('key.esc'), label: t('ln.hint.cancel') }, { key: t('key.enter'), label: t('ln.hint.openLine') }],
  };
}

