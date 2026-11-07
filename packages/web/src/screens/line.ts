import { DEFAULT_NOTICE_DAYS, type FleetAircraft } from '@opc/shared';
import { act } from '../actions.ts';
import { fetchLine, fetchProblem, pauseLine, resolveLine, resumeLine, takeRotation, type LineDetail, type LineProblemView, type ResolveOption, type ScheduledFlight } from '../api-lines.ts';
import { button, icon, panel, signLocation, stat, unknownValue } from '../components.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import { dayMedium, dayShort, dayTime, fill, typeNames } from '../lines-ui.ts';
import {
  APPLIED_KEYS, CAUSE_KEYS, causesOf, cheaperRemedy, dayKind, defaultRemedy, meterFraction, daysBetween, ganttLanes, groupSlots, isoDay, minuteOfDay, MINUTES_PER_DAY, NETWORK_TAB, pnlParts, progressPct, assuredDays, RULER_HOURS, stepDay, type Lane, type Segment, type SlotGroup,
} from '../lines-view.ts';
import type { Key } from '../messages.ts';
import { pollWhileShown } from '../live-poll.ts';
import type { Ctx, Hint, Screen } from '../screen.ts';
import { h } from '../ui.ts';

const POLL_LINE_MS = 10_000;
/** The day of the strip the player looks at, kept while the screen redraws. */
let day: { line: number; date: string } | null = null;
/** The remedy picked in the panel (null until the player picks: the cheapest way to fly now is then offered) and whether recruiting also books the interim bridge (on by default). */
let option: ResolveOption | null = null;
let withBridge = true;

/** `#line/<id>`: the line's planning, or, when the line is interrupted, what is blocking it and how to get it going again. */
export async function lineScreen(ctx: Ctx): Promise<Screen> {
  const { snap } = ctx;
  const id = ctx.arg === null ? NaN : Number(ctx.arg);
  const back = '#network';
  const gone = (key: Key): Screen => ({ title: t(key), scene: 'job', tab: NETWORK_TAB, back, hints: [{ key: t('key.esc'), label: t('hint.back') }], view: h('p', { class: 'error-text', role: 'alert' }, t(key)) });
  if (!Number.isInteger(id)) return gone('ln.line.notFound');
  const date = day?.line === id ? day.date : undefined;
  const detail = await fetchLine(id, date);
  if (!detail) return gone('ln.line.notFound');
  if (detail.line.status === 'interrupted') {
    const problem = await fetchProblem(id);
    if (problem) return interrupted(ctx, detail, problem);
  }
  return planning(detail, snap.me.fleet, snap.me.company.code ?? '');
}

// ====================================================================== detail & planning

function planning(d: LineDetail, fleet: FleetAircraft[], code: string): Screen {
  const { line } = d;
  const fm = fmt();
  const today = isoDay(Date.now());
  const selectedDate = day?.line === line.id ? day.date : (d.week.find((x) => dayKind(x.date, today) === 'today')?.date ?? d.week[0]?.date ?? today);
  day = { line: line.id, date: selectedDate };
  const redraw = (): void => { window.dispatchEvent(new Event('opc:redraw')); };
  const setDay = (date: string): void => { if (day && day.date !== date) { day = { line: line.id, date }; redraw(); } };

  const names = new Map(fleet.map((f) => [f.id, f]));
  const lanes = ganttLanes(d.day, line.aircraft.map((a) => a.id), selectedDate);
  const rotation = { selected: d.day.find((f) => f.status === 'flying') ?? d.day.find((f) => f.status === 'scheduled' || f.status === 'delayed') ?? null };
  const typeCells = new Map<number, HTMLElement>();
  void typeNames(line.aircraft.map((a) => a.icao)).then((nameOf) => { for (const a of line.aircraft) typeCells.get(a.id)!.textContent = nameOf(a.icao); });

  const paused = line.status === 'paused';
  const statusLine = paused ? t('ln.line.statusPaused') : t('ln.line.statusActive');
  const header = h('div', { class: 'ln-line-header' },
    h('div', { class: 'col tight' },
      h('div', { class: 'row' }, signLocation(line.a), h('span', { class: 'ln-pair' }, '⇄'), signLocation(line.b), h('span', { class: 'dim small' }, t('ln.line.crumb'))),
      h('div', { class: 'status-line' }, h('span', { class: `dot${paused ? ' idle' : ''}` }), statusLine),
      h('h1', { class: 'title ln-line-title', id: 'ln-line-title' }, h('span', { class: 'ln-city', 'data-icao': line.a }, line.a), ' ⇄ ', h('span', { class: 'ln-city', 'data-icao': line.b }, line.b)),
      h('p', { class: 'muted' }, t('ln.line.sub', { code, first: line.flightNos[0], last: line.flightNos[1], nm: fm.nm(Math.round(line.distanceNm)), time: fm.duration(line.blockMinutes / 60), type: [...new Set(line.aircraft.map((a) => a.icao))].join(' · ') || '–' }))),
    h('div', { class: 'ln-kpis' },
      stat(t('ln.kpi.aircraft'), String(d.kpis.aircraft), line.aircraft.map((a) => a.registration).join(' · ')),
      stat(t('ln.kpi.freq'), d.kpis.freq, t('ln.kpi.freqSub', { n: line.freqPerDay })),
      stat(t('ln.kpi.load'), fm.percent(d.kpis.loadFactor), t('ln.kpi.loadTrend', { pts: `${d.kpis.loadTrend7d > 0 ? '+' : d.kpis.loadTrend7d < 0 ? '−' : ''}${fm.num(Math.abs(Math.round(d.kpis.loadTrend7d * 100)))}` })),
      stat(t('ln.kpi.revenue'), fm.money(d.kpis.revenuePerDay), t('ln.kpi.margin', { amount: fm.money(d.kpis.marginPerDay) }))));
  void fillCities(header);

  // ------------------------------------------------------------ the week strip and the 24 h planning
  const week = h('div', { class: 'ln-week', role: 'group', 'aria-label': t('ln.week') }, d.week.map((w) => {
    const kind = dayKind(w.date, today);
    const summary = kind === 'today' ? t('ln.day.today', { pct: fm.percent(w.loadFactor) }) : kind === 'past' ? t('ln.day.past', { n: w.rotations, pct: fm.percent(w.loadFactor) }) : t('ln.day.planned', { n: w.rotations });
    return h('button', { type: 'button', class: `ln-day ${kind}`, 'aria-pressed': String(w.date === selectedDate), onclick: () => setDay(w.date), 'data-date': w.date },
      h('span', { class: 'ln-day-name' }, dayShort(w.date)), h('span', { class: 'ln-day-sum' }, summary));
  }));

  const nowPct = selectedDate === today ? (minuteOfDay(Date.now()) / MINUTES_PER_DAY) * 100 : null;
  const ruler = h('div', { class: 'ln-ruler', 'aria-hidden': 'true' }, RULER_HOURS.map((hr) => h('span', { class: 'ln-tick', style: `left:${(hr / 24) * 100}%` }, `${String(hr).padStart(2, '0')}:00`)),
    nowPct === null ? null : h('span', { class: 'ln-now-label', style: `left:${nowPct}%` }, t('ln.now', { at: fm.zulu(Date.now()) })));

  const detailPanel = h('div', { class: 'ln-rot', 'aria-live': 'polite' });
  const canTake = (f: ScheduledFlight): boolean => f.status === 'scheduled' && !f.takenByPlayer && f.dep > Date.now();
  const take = (f: ScheduledFlight): void => { void act(t('ln.rot.took', { no: f.flightNo }), () => takeRotation(line.id, f.id), async () => { redraw(); }); };
  const paintRotation = (): void => {
    const f = rotation.selected;
    if (!f) { detailPanel.replaceChildren(h('span', { class: 'dim small' }, t('ln.rot.none'))); return; }
    fill(detailPanel,
      h('span', { class: 'strong' }, f.flightNo), h('span', { class: 'mono' }, `${f.origin} → ${f.dest}`), h('span', { class: 'muted' }, `${fm.zulu(f.dep)} – ${fm.zulu(f.arr)}`),
      f.delayMin > 0 ? h('span', { class: 'ln-late' }, t('ln.state.delayed', { n: f.delayMin })) : null,
      f.takenByPlayer ? h('span', { class: 'ln-mine' }, icon('user', 12), t('ln.rot.taken')) : null,
      f.status === 'cancelled' && f.cancelCause ? h('span', { class: 'ln-down' }, t(CAUSE_KEYS[f.cancelCause])) : null,
      f.status === 'flying' ? h('span', { class: 'muted' }, t('ln.rot.progress', { pct: progressPct(f, Date.now()) })) : null,
      canTake(f) ? button(t('ln.rot.take'), { variant: 'secondary', onclick: () => take(f) }) : null);
  };
  const seg = (s: Segment): HTMLElement => {
    const f = d.day.find((x) => x.id === s.id)!;
    return h('button', { type: 'button', class: `ln-seg ${s.kind}${s.takenByPlayer ? ' mine' : ''}${f === rotation.selected ? ' picked' : ''}`, style: `left:${s.left}%;width:${s.width}%`, 'data-row': '', 'data-flight': s.id,
      'aria-label': t('ln.seg.label', { no: s.flightNo, to: s.to, status: t(`ln.fs.${s.status}`) }),
      // Enter on a segment selects it and moves to the button that takes it: taking cancels a scheduled flight, so it takes a second press.
      onclick: (e: MouseEvent) => { pickRotation(f); if (e.detail === 0) detailPanel.querySelector<HTMLElement>('button')?.focus(); }, onfocus: () => pickRotation(f), onmouseenter: () => pickRotation(f) },
    h('span', { class: 'ln-seg-no' }, s.flightNo), h('span', { class: 'ln-seg-to' }, `→ ${s.to}`));
  };
  const pickRotation = (f: ScheduledFlight): void => {
    if (rotation.selected === f) return;
    rotation.selected = f;
    for (const el of document.querySelectorAll<HTMLElement>('.ln-seg')) el.classList.toggle('picked', el.dataset.flight === String(f.id));
    paintRotation();
  };
  const laneRow = (lane: Lane): HTMLElement => {
    const a = line.aircraft.find((x) => x.id === lane.aircraftId)!;
    const wear = names.get(a.id)?.wearPct;
    const type = h('span', { class: 'dim small' }, a.icao);
    typeCells.set(a.id, type);
    return h('div', { class: 'ln-lane' },
      h('div', { class: 'ln-lane-label' }, h('div', { class: 'row tight' }, h('span', { class: 'mono' }, a.registration), type),
        h('span', { class: 'dim small' }, wear === undefined ? tp('ln.lane.rot', lane.rotations) : tp('ln.lane.rotWear', lane.rotations, { wear: Math.round(100 - wear) }))),
      h('div', { class: 'ln-track' }, nowPct === null ? null : h('span', { class: 'ln-now-line', style: `left:${nowPct}%` }), lane.segments.flatMap((s) => [s.delay > 0 ? h('span', { class: 'ln-delay', style: `left:${s.delayLeft}%;width:${s.delay}%`, 'aria-hidden': 'true' }) : null, seg(s)]),
        lane.segments.length === 0 ? h('span', { class: 'ln-track-empty dim small' }, t('ln.lane.idle')) : null));
  };
  const legend = h('div', { class: 'ln-gantt-legend' }, (['done', 'flying', 'scheduled', 'delayed', 'cancelled'] as const).map((k) => h('span', { class: 'ln-legend-item' }, h('span', { class: `ln-legend-seg ${k}`, 'aria-hidden': 'true' }), t(`ln.fs.${k}`))));

  const timeline = h('div', { class: 'ln-timeline' },
    h('div', { class: 'ln-ruler-row' }, h('span', { class: 'ln-lane-caption dim small' }, t('ln.hourUtc')), ruler), lanes.map(laneRow), legend);

  const weekRow = h('div', { class: 'ln-week-row' }, week, h('span', { class: 'dim small' }, dayMedium(Date.parse(`${selectedDate}T12:00:00Z`))));

  // ------------------------------------------------------------ economics and dependencies
  const parts = pnlParts(d.pnl);
  const econ = h('div', { class: 'ln-econ' },
    h('div', { class: 'ln-econ-head' }, h('h3', { class: 'ln-sub-title' }, t('ln.econ.title')), h('span', { class: 'dim small' }, t('ln.econ.note', { flights: d.pnl.flights, pax: fm.num(d.pnl.pax) }))),
    h('div', { class: 'ln-econ-bar', role: 'img', 'aria-label': t('ln.econ.title') }, parts.map((p) => h('span', { class: `ln-part ${p.part}`, style: `width:${p.share}%` }))),
    h('div', { class: 'ln-econ-legend' }, parts.map((p) => h('div', { class: 'ln-econ-item' }, h('span', { class: 'dim small' }, t(`ln.part.${p.part}`)), h('span', { class: p.part === 'margin' ? 'strong' : 'muted' }, fm.money(p.value))))));
  const deps = h('div', { class: 'ln-deps' },
    h('div', { class: 'ln-econ-head' }, h('h3', { class: 'ln-sub-title' }, t('ln.deps.title')), h('span', { class: 'dim small' }, t('ln.deps.note'))),
    d.depends.length ? h('ul', { class: 'plain ln-meters' }, d.depends.map((m) => {
      const fraction = meterFraction(m.value);
      return h('li', { class: `ln-meter${m.ok ? '' : ' bad'}` },
        h('div', { class: 'ln-meter-head' }, h('span', { class: 'muted' }, m.label), h('span', { class: 'strong' }, m.value)),
        fraction === null ? null : h('div', { class: 'ln-meter-bar', role: 'presentation' }, h('span', { style: `width:${Math.round(fraction * 100)}%` })),
        m.ok ? null : h('span', { class: 'ln-meter-warn' }, icon('triangle-alert', 12), t('ln.deps.risk')));
    })) : unknownValue());

  const pauseBtn = paused
    ? button(t('ln.resume'), { variant: 'primary', key: t('key.space'), onclick: () => void act(t('ln.resumed'), () => resumeLine(line.id), async () => { redraw(); }) })
    : button(t('ln.pause'), { variant: 'secondary', key: t('key.space'), onclick: () => void act(t('ln.paused'), () => pauseLine(line.id), async () => { redraw(); }) });
  const view = h('div', { class: 'ln-line' }, header,
    panel({ title: t('ln.plan.title'), action: pauseBtn, class: 'ln-plan', id: 'ln-plan' }, weekRow, timeline, detailPanel, h('div', { class: 'ln-footer' }, econ, deps)));
  paintRotation();

  pollWhileShown('ln-line', view, async () => {
    const fresh = await fetchLine(line.id, selectedDate);
    if (!fresh) return;
    if (fresh.line.status !== line.status || fresh.day.map((f) => `${f.id}${f.status}${f.delayMin}`).join() !== d.day.map((f) => `${f.id}${f.status}${f.delayMin}`).join()) redraw();
  }, POLL_LINE_MS);

  const hints: Hint[] = [{ key: t('key.esc'), label: t('ln.hint.network') }, { key: '← →', label: t('ln.hint.day') }, { key: t('key.enter'), label: t('ln.hint.take') }, { key: t('key.space'), label: paused ? t('ln.hint.resume') : t('ln.hint.pause') }];
  const toggle = (): void => { void act(paused ? t('ln.resumed') : t('ln.paused'), () => (paused ? resumeLine(line.id) : pauseLine(line.id)), async () => { redraw(); }); };
  return {
    title: `${line.a} ⇄ ${line.b}`, scene: 'job', tab: NETWORK_TAB, view, back: '#network', hints,
    keys: { left: () => setDay(stepDay(d.week, selectedDate, -1)), right: () => setDay(stepDay(d.week, selectedDate, 1)), space: toggle },
  };
}

/** Put the city names in the title once the airports are known (the codes stand in meanwhile). */
async function fillCities(root: HTMLElement): Promise<void> {
  const { airportInfo, cityOf } = await import('../airports.ts');
  for (const el of root.querySelectorAll<HTMLElement>('.ln-city')) { const a = await airportInfo(el.dataset.icao!); if (a) el.textContent = cityOf(a).replace(/\s*\(.*$/, ''); }
}

// ====================================================================== interrupted

function interrupted(ctx: Ctx, d: LineDetail, p: LineProblemView): Screen {
  const { go } = ctx;
  const { line } = d;
  const fm = fmt();
  const now = Date.now();
  const redraw = (): void => { window.dispatchEvent(new Event('opc:redraw')); };
  const causes = causesOf(line);
  const since = line.interruptedSince;

  const problemCard = (kind: 'aircraft' | 'crew'): HTMLElement => {
    const item = p.problem.find((x) => x.kind === kind);
    const left = item?.until != null ? Math.max(0, daysBetween(now, item.until)) : null;
    return h('div', { class: 'ln-cause' }, icon(kind === 'aircraft' ? 'wrench' : 'user', 18),
      h('div', { class: 'col tight' }, h('span', { class: 'strong' }, t(`ln.why.${kind}`)), h('span', { class: 'muted small' }, item?.detail ?? ''),
        left !== null && !item?.ready ? h('span', { class: 'dim small' }, t('ln.why.left', { n: left })) : item?.ready ? h('span', { class: 'ln-ok small' }, t('ln.why.ready')) : null));
  };
  const cost = p.cost;
  const costs = h('div', { class: 'ln-costs' },
    fact(t('ln.cost.cancelled'), String(cost.cancelled), t('ln.cost.cancelledSub')),
    fact(t('ln.cost.lost'), fm.money(cost.lostRevenue), t('ln.cost.perDay', { amount: fm.money(cost.perDay) })),
    fact(t('ln.cost.rep'), fm.num(cost.reputation, 1).replace('-', '−'), cost.slotsLostAt === null ? t('ln.cost.repSub') : t('ln.cost.slots', { at: dayMedium(cost.slotsLostAt) })));

  // ------------------------------------------------------------ the ways out
  const opts = p.options;
  const reassign = opts.reassign;
  const candidate = reassign?.aircraft[0] ?? null;
  const balance = ctx.snap.me.company.balance;
  const cheaper = cheaperRemedy(opts);
  const who = (g: Pick<SlotGroup, 'family' | 'type'>): string => (g.family === 'pilot' ? t('ln.slot.pilot', { type: g.type ?? '' }) : t('ln.slot.cabin'));
  const bridgeLines = (slots: SlotGroup[]): string[] => slots.map((g) => t('ln.slot', {
    n: g.people, who: g.defaulted ? `${who(g)} (${t('ln.slot.default', { days: DEFAULT_NOTICE_DAYS })})` : who(g), date: dayMedium(g.until), amount: fm.money(g.cost),
  }));
  const recruit = opts.recruit && opts.recruit.candidates > 0 ? opts.recruit : null;
  type Choice = { id: ResolveOption; title: string; sub: string; lines?: string[]; badge?: string; date: string; impact: string; note?: string; disabled: boolean };
  const choices: Choice[] = [
    ...(opts.interim ? [{ id: 'interim' as const, title: t('ln.opt.interim'), sub: t('ln.opt.interimSub', { n: opts.interim.people, date: dayMedium(opts.interim.until) }), lines: bridgeLines(groupSlots(opts.interim.perSlot)),
      ...(cheaper === 'interim' ? { badge: t('ln.opt.cheapest') } : {}), date: t('ln.opt.now'), impact: t('ln.opt.cost', { amount: fm.money(opts.interim.cost) }), disabled: false }] : []),
    ...(opts.startNow ? [{ id: 'start_now' as const, title: t('ln.opt.startNow', { n: opts.startNow.people, fee: fm.money(opts.startNow.cost / opts.startNow.people) }), sub: t('ln.opt.startNowSub'),
      lines: opts.startNow.perSlot.map((x) => t('ln.slot.start', { n: x.people, who: who(x), amount: fm.money(x.cost) })), ...(cheaper === 'start_now' ? { badge: t('ln.opt.cheapest') } : {}),
      date: t('ln.opt.now'), impact: t('ln.opt.cost', { amount: fm.money(opts.startNow.cost) }), disabled: false }] : []),
    { id: 'reassign', title: candidate ? t('ln.opt.reassign', { reg: candidate.registration, type: candidate.icao }) : t('ln.opt.reassignNone'), sub: candidate ? t('ln.opt.reassignSub', { at: dayMedium(candidate.freeAt) }) : t('ln.opt.reassignNoneSub'),
      date: candidate ? dayMedium(candidate.freeAt) : '–', impact: reassign ? t('ln.opt.perDay', { amount: fm.signedMoney(reassign.deltaPerDay) }) : '–', note: reassign ? t('ln.opt.reassignNote', { n: reassign.flightsPerDay / 2 }) : undefined, disabled: !candidate },
    { id: 'recruit', title: t('ln.opt.recruit'), sub: recruit ? t('ln.opt.recruitSub', { n: recruit.candidates, amount: fm.money(recruit.monthly) }) : opts.recruit ? t('ln.opt.recruitCovered') : t('ln.opt.recruitNone'),
      date: recruit?.readyAt ? dayMedium(recruit.readyAt) : '–', impact: recruit ? t('ln.opt.recruitImpact') : '–', disabled: !recruit },
    { id: 'pause', title: t('ln.opt.pause'), sub: t('ln.opt.pauseSub'), date: t('ln.opt.pauseDate'), impact: opts.pause.fixedCostPerDay > 0 ? t('ln.opt.pauseFixed', { amount: fm.money(opts.pause.fixedCostPerDay) }) : t('ln.opt.pauseFree'), note: t('ln.opt.pauseNote'), disabled: false },
  ];
  if (!option || !choices.some((c) => c.id === option && !c.disabled)) option = defaultRemedy(opts);
  const chosen = (): Choice => choices.find((c) => c.id === option)!;
  /** Euros the chosen remedy takes now, as the server priced it. */
  const bridged = (): boolean => withBridge && !!recruit?.bridge;
  const price = (id: ResolveOption): number => (id === 'interim' ? opts.interim?.cost ?? 0 : id === 'start_now' ? opts.startNow?.cost ?? 0 : id === 'recruit' && recruit ? recruit.premium + (bridged() ? recruit.bridge!.cost : 0) : 0);

  const primary = h('div', { class: 'ln-apply' });
  const applyLabel = (id: ResolveOption, reg?: string): string => {
    const amount = fm.money(price(id));
    return id === 'reassign' ? t('ln.apply.reassign', { reg: reg ?? '' }) : id === 'interim' ? t('ln.apply.interim', { amount }) : id === 'start_now' ? t('ln.apply.startNow', { amount })
      : id === 'recruit' ? (bridged() ? t('ln.apply.recruitBridge', { amount }) : t('ln.apply.recruit')) : t('ln.apply.pause');
  };
  const bridgeBox = (): HTMLElement | null => (option === 'recruit' && recruit?.bridge
    ? h('label', { class: 'ln-bridge' }, h('input', { type: 'checkbox', id: 'ln-bridge', checked: withBridge, onchange: (e: Event) => { withBridge = (e.target as HTMLInputElement).checked; paintApply(); } }),
      h('span', { class: 'col tight' }, h('span', { class: 'strong' }, t('ln.bridge.check')), h('span', { class: 'muted small' }, t('ln.bridge.sub', { amount: fm.money(recruit.bridge.cost), date: dayMedium(recruit.bridge.until) })),
        ...bridgeLines(groupSlots(recruit.bridge.perSlot)).map((l) => h('span', { class: 'dim small' }, l))))
    : null);
  const costNote = (c: Choice): HTMLElement | null => {
    const total = price(c.id);
    if (total === 0) return null;
    const sum = c.id === 'recruit' && bridged() ? t('ln.pay.sum', { premium: fm.money(recruit!.premium), bridge: fm.money(recruit!.bridge!.cost), total: fm.money(total) }) : null;
    return h('div', { class: 'col tight' }, sum ? h('span', { class: 'muted small' }, sum) : null,
      h('span', { class: balance < total ? 'ln-down small' : 'dim small' }, balance < total ? t('ln.pay.short') : t('ln.pay.after', { amount: fm.money(balance - total) })));
  };
  const paintApply = (): void => {
    const c = chosen();
    fill(primary, bridgeBox(), costNote(c), button(applyLabel(c.id, candidate?.registration), { variant: 'primary', key: t('key.enter'), disabled: c.disabled || balance < price(c.id), onclick: () => void apply() }),
      option === 'recruit' || !recruit ? null : button(t('ln.opt.candidates'), { variant: 'ghost', onclick: () => go('#staff/hire') }));
  };
  async function apply(): Promise<void> {
    const c = chosen();
    if (c.disabled) return;
    const bridge = c.id === 'recruit' && bridged();
    const extra = c.id === 'reassign' ? (candidate ? { aircraftId: candidate.id } : {}) : c.id === 'recruit' ? { withInterim: bridge } : {};
    const done = bridge ? t('ln.applied.recruitBridge') : t(APPLIED_KEYS[c.id]);
    // the money options change the balance on screen: reload the shell, not just this screen
    const ok = await act(done, () => resolveLine(line.id, c.id, extra), ctx.refresh);
    if (ok && c.id === 'recruit' && !bridge) go('#staff/hire');
  }
  const select = (id: ResolveOption): void => {
    option = id;
    for (const el of document.querySelectorAll<HTMLInputElement>('.ln-choice input')) el.checked = el.value === id;
    paintApply();
    paintProjection();
  };
  const choiceEls = choices.map((c) => {
    const inputId = `ln-opt-${c.id}`;
    return h('label', { class: `ln-choice${c.disabled ? ' disabled' : ''}`, for: inputId },
      h('input', { type: 'radio', name: 'ln-option', id: inputId, value: c.id, checked: c.id === option, disabled: c.disabled, 'data-row': c.disabled ? null : '', onfocus: () => select(c.id), onchange: () => select(c.id) }),
      h('span', { class: 'ln-choice-text' }, h('span', { class: 'strong' }, c.title), h('span', { class: 'muted small' }, c.sub), c.lines?.map((l) => h('span', { class: 'dim small' }, l)), c.note ? h('span', { class: 'dim small' }, c.note) : null),
      h('span', { class: 'ln-choice-effect' }, c.badge ? h('span', { class: 'ln-ok small' }, c.badge) : null, h('span', { class: 'strong' }, c.date), h('span', { class: c.impact.startsWith('−') ? 'ln-down small' : 'ln-ok small' }, c.impact)));
  });

  const projectionHost = h('div', { class: 'ln-projection' });
  const paintProjection = (): void => {
    const flying = assuredDays(p.projection);
    projectionHost.replaceChildren(
      h('div', { class: 'ln-econ-head' }, h('h3', { class: 'ln-sub-title' }, t('ln.proj.title')), h('span', { class: 'strong' }, t('ln.proj.assured', { n: flying, total: p.projection.length }))),
      h('div', { class: 'ln-proj-days' }, p.projection.map((x) => {
        return h('div', { class: `ln-proj ${x.status}` }, h('span', { class: 'muted small' }, dayShort(x.date)), h('span', { class: 'ln-proj-bar' }), h('span', { class: x.status === 'stopped' ? 'ln-down small' : 'dim small' }, t(`ln.proj.day.${x.status}`)));
      })));
  };
  paintApply();
  paintProjection();

  const left = h('div', { class: 'ln-int-left' },
    h('div', { class: 'col tight' },
      h('div', { class: 'row' }, signLocation(line.a), h('span', { class: 'ln-pair' }, '⇄'), signLocation(line.b), h('span', { class: 'dim small' }, t('ln.line.crumb'))),
      h('div', { class: 'status-line danger' }, h('span', { class: 'dot off' }), since === null ? t('ln.int.status') : t('ln.int.since', { at: dayTime(since) })),
      h('h1', { class: 'title ln-line-title' }, h('span', { class: 'ln-city', 'data-icao': line.a }, line.a), ' ⇄ ', h('span', { class: 'ln-city', 'data-icao': line.b }, line.b)),
      h('p', { class: 'muted' }, t('ln.int.sub', { code: ctx.snap.me.company.code ?? '', first: line.flightNos[0], last: line.flightNos[1], nm: fm.nm(Math.round(line.distanceNm)), n: line.freqPerDay, type: [...new Set(line.aircraft.map((a) => a.icao))].join(' · ') || '–' }))),
    h('section', { class: 'ln-block', 'aria-labelledby': 'ln-why' }, h('h2', { class: 'ln-block-title', id: 'ln-why' }, t('ln.why.title')),
      causes.map(problemCard), causes.length > 1 ? h('p', { class: 'dim small' }, t('ln.why.both')) : null),
    h('section', { class: 'ln-block', 'aria-labelledby': 'ln-cost' }, h('h2', { class: 'ln-block-title', id: 'ln-cost' }, t('ln.cost.title')), costs));
  void fillCities(left);

  const right = panel({ title: t('ln.fix.title'), class: 'ln-fix', id: 'ln-fix' },
    h('p', { class: 'muted small' }, t('ln.fix.sub')),
    h('div', { class: 'ln-choices', role: 'radiogroup', 'aria-label': t('ln.fix.title') }, choiceEls), projectionHost,
    h('p', { class: 'dim small' }, t('ln.fix.combine')), primary);
  const view = h('div', { class: 'ln-int' }, left, right);
  view.addEventListener('keydown', (e) => {
    const target = e.target as Element | null;
    if (e.key === 'Enter' && target instanceof HTMLInputElement && target.type === 'radio') { e.preventDefault(); void apply(); }
  });
  pollWhileShown('ln-line', view, async () => {
    const fresh = await fetchLine(line.id);
    if (fresh && fresh.line.status !== 'interrupted') redraw();
  }, POLL_LINE_MS);

  return {
    title: `${line.a} ⇄ ${line.b}`, scene: 'fleet', tab: NETWORK_TAB, view, back: '#network',
    hints: [{ key: t('key.esc'), label: t('ln.hint.network') }, { key: '↑ ↓', label: t('ln.hint.solution') }, { key: t('key.enter'), label: t('ln.hint.apply') }],
  };
}

const fact = (label: string, value: string, sub: string): HTMLElement => h('div', { class: 'fact big' }, h('span', { class: 'fact-label' }, label), h('span', { class: 'fact-value' }, value), h('span', { class: 'fact-sub' }, sub));
