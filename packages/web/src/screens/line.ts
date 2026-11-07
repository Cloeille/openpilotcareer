import type { FleetAircraft } from '@opc/shared';
import { act } from '../actions.ts';
import { fetchLine, fetchProblem, pauseLine, resolveLine, resumeLine, takeRotation, type LineDetail, type ProblemView, type ResolveOption, type ScheduledFlight } from '../api-lines.ts';
import { button, icon, panel, signLocation, stat, unknownValue } from '../components.ts';
import { fmt } from '../format.ts';
import { t } from '../i18n.ts';
import { dayMedium, dayShort, dayTime, fill, typeNames } from '../lines-ui.ts';
import {
  causeKey, causesOf, dayKind, daysBetween, ganttLanes, isoDay, minuteOfDay, MINUTES_PER_DAY, NETWORK_TAB, pnlParts, progressPct, projectionKind, RULER_HOURS, stepDay, type Lane, type Segment,
} from '../lines-view.ts';
import type { Key } from '../messages.ts';
import { pollWhileShown } from '../live-poll.ts';
import type { Ctx, Hint, Screen } from '../screen.ts';
import { h } from '../ui.ts';

const POLL_LINE_MS = 10_000;
/** The day of the strip the player looks at, kept while the screen redraws. */
let day: { line: number; date: string } | null = null;
let option: ResolveOption = 'reassign';

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
      f.status === 'cancelled' && f.cancelCause ? h('span', { class: 'ln-down' }, t(`ln.cause.${causeKey(f.cancelCause)}` as Key)) : null,
      f.status === 'flying' ? h('span', { class: 'muted' }, t('ln.rot.progress', { pct: progressPct(f, Date.now()) })) : null,
      canTake(f) ? button(t('ln.rot.take'), { variant: 'secondary', key: t('key.enter'), onclick: () => take(f) }) : null);
  };
  const seg = (s: Segment): HTMLElement => {
    const f = d.day.find((x) => x.id === s.id)!;
    return h('button', { type: 'button', class: `ln-seg ${s.kind}${s.takenByPlayer ? ' mine' : ''}${f === rotation.selected ? ' picked' : ''}`, style: `left:${s.left}%;width:${s.width}%`, 'data-row': '', 'data-flight': s.id,
      'aria-label': t('ln.seg.label', { no: s.flightNo, to: s.to, status: t(`ln.fs.${s.status}` as Key) }),
      onclick: () => pickRotation(f), onfocus: () => pickRotation(f), onmouseenter: () => pickRotation(f),
      onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' && canTake(f)) { e.preventDefault(); take(f); } } },
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
        h('span', { class: 'dim small' }, wear === undefined ? t('ln.lane.rot', { n: lane.rotations }) : t('ln.lane.rotWear', { n: lane.rotations, wear: Math.round(100 - wear) }))),
      h('div', { class: 'ln-track' }, nowPct === null ? null : h('span', { class: 'ln-now-line', style: `left:${nowPct}%` }), lane.segments.map(seg),
        lane.segments.length === 0 ? h('span', { class: 'ln-track-empty dim small' }, t('ln.lane.idle')) : null));
  };
  const legend = h('div', { class: 'ln-gantt-legend' }, (['done', 'flying', 'scheduled', 'delayed', 'cancelled'] as const).map((k) => h('span', { class: 'ln-legend-item' }, h('span', { class: `ln-legend-seg ${k}`, 'aria-hidden': 'true' }), t(`ln.fs.${k}` as Key))));

  const timeline = h('div', { class: 'ln-timeline' },
    h('div', { class: 'ln-ruler-row' }, h('span', { class: 'ln-lane-caption dim small' }, t('ln.hourUtc')), ruler), lanes.map(laneRow), legend);

  const weekRow = h('div', { class: 'ln-week-row' }, week, h('span', { class: 'dim small' }, dayMedium(Date.parse(`${selectedDate}T12:00:00Z`))));

  // ------------------------------------------------------------ economics and dependencies
  const parts = pnlParts(d.pnl);
  const econ = h('div', { class: 'ln-econ' },
    h('div', { class: 'ln-econ-head' }, h('h3', { class: 'ln-sub-title' }, t('ln.econ.title')), h('span', { class: 'dim small' }, t('ln.econ.note', { flights: d.pnl.flights, pax: fm.num(d.pnl.pax) }))),
    h('div', { class: 'ln-econ-bar', role: 'img', 'aria-label': t('ln.econ.title') }, parts.map((p) => h('span', { class: `ln-part ${p.part}`, style: `width:${p.share}%` }))),
    h('div', { class: 'ln-econ-legend' }, parts.map((p) => h('div', { class: 'ln-econ-item' }, h('span', { class: 'dim small' }, t(`ln.part.${p.part}` as Key)), h('span', { class: p.part === 'margin' ? 'strong' : 'muted' }, fm.money(p.value))))));
  const deps = h('div', { class: 'ln-deps' },
    h('div', { class: 'ln-econ-head' }, h('h3', { class: 'ln-sub-title' }, t('ln.deps.title')), h('span', { class: 'dim small' }, t('ln.deps.note'))),
    d.depends.length ? h('ul', { class: 'plain ln-meters' }, d.depends.map((m) => h('li', { class: `ln-meter${m.ok ? '' : ' bad'}` }, icon(m.ok ? 'circle-check' : 'triangle-alert', 14), h('span', { class: 'muted' }, m.label), h('span', { class: 'strong' }, m.value)))) : unknownValue());

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

function interrupted(ctx: Ctx, d: LineDetail, p: ProblemView): Screen {
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
      h('div', { class: 'col tight' }, h('span', { class: 'strong' }, t(`ln.why.${kind}` as Key)), h('span', { class: 'muted small' }, item?.detail ?? ''),
        left !== null && !item?.ready ? h('span', { class: 'dim small' }, t('ln.why.left', { n: left })) : item?.ready ? h('span', { class: 'ln-ok small' }, t('ln.why.ready')) : null));
  };
  const cost = p.cost;
  const costs = h('div', { class: 'ln-costs' },
    fact(t('ln.cost.cancelled'), String(cost.cancelled), t('ln.cost.cancelledSub')),
    fact(t('ln.cost.lost'), fm.money(cost.lostRevenue), t('ln.cost.perDay', { amount: fm.money(cost.perDay) })),
    fact(t('ln.cost.rep'), fm.num(cost.reputation, 1).replace('-', '−'), t('ln.cost.repSub')));

  // ------------------------------------------------------------ the three ways out
  const reassign = p.options.reassign;
  const candidate = reassign?.aircraft[0] ?? null;
  const choices: { id: ResolveOption; title: string; sub: string; date: string; impact: string; note?: string; disabled: boolean }[] = [
    { id: 'reassign', title: candidate ? t('ln.opt.reassign', { reg: candidate.registration, type: candidate.icao }) : t('ln.opt.reassignNone'), sub: candidate ? t('ln.opt.reassignSub', { at: dayMedium(candidate.freeAt) }) : t('ln.opt.reassignNoneSub'),
      date: candidate ? dayMedium(candidate.freeAt) : '–', impact: reassign ? t('ln.opt.perDay', { amount: fm.signedMoney(reassign.deltaPerDay) }) : '–', note: reassign ? t('ln.opt.reassignNote', { n: reassign.flightsPerDay / 2 }) : undefined, disabled: !candidate },
    { id: 'recruit', title: t('ln.opt.recruit'), sub: p.options.recruit ? t('ln.opt.recruitSub', { n: p.options.recruit.candidates, amount: fm.money(p.options.recruit.monthly) }) : t('ln.opt.recruitNone'),
      date: p.options.recruit?.readyAt ? dayMedium(p.options.recruit.readyAt) : '–', impact: p.options.recruit ? t('ln.opt.recruitImpact') : '–', disabled: !p.options.recruit },
    { id: 'pause', title: t('ln.opt.pause'), sub: t('ln.opt.pauseSub'), date: t('ln.opt.pauseDate'), impact: p.options.pause.fixedCostPerDay > 0 ? t('ln.opt.pauseFixed', { amount: fm.money(p.options.pause.fixedCostPerDay) }) : t('ln.opt.pauseFree'), note: t('ln.opt.pauseNote'), disabled: false },
  ];
  if (choices.find((c) => c.id === option)?.disabled) option = choices.find((c) => !c.disabled)?.id ?? 'pause';
  const chosen = (): (typeof choices)[number] => choices.find((c) => c.id === option)!;

  const primary = h('div', { class: 'ln-apply' });
  const paintApply = (): void => {
    const c = chosen();
    fill(primary, button(applyLabel(c.id, candidate?.registration), { variant: 'primary', key: t('key.enter'), disabled: c.disabled, onclick: () => void apply() }),
      option === 'recruit' ? null : p.options.recruit ? button(t('ln.opt.candidates'), { variant: 'ghost', onclick: () => go('#staff/hire') }) : null);
  };
  const applyLabel = (id: ResolveOption, reg?: string): string => (id === 'reassign' ? t('ln.apply.reassign', { reg: reg ?? '' }) : id === 'recruit' ? t('ln.apply.recruit') : t('ln.apply.pause'));
  async function apply(): Promise<void> {
    const c = chosen();
    if (c.disabled) return;
    const ok = await act(t(`ln.applied.${c.id}` as Key), () => resolveLine(line.id, c.id, c.id === 'reassign' ? candidate?.id : undefined), async () => { redraw(); });
    if (ok && c.id === 'recruit') go('#staff/hire');
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
      h('span', { class: 'ln-choice-text' }, h('span', { class: 'strong' }, c.title), h('span', { class: 'muted small' }, c.sub), c.note ? h('span', { class: 'dim small' }, c.note) : null),
      h('span', { class: 'ln-choice-effect' }, h('span', { class: 'strong' }, c.date), h('span', { class: c.impact.startsWith('−') ? 'ln-down small' : 'ln-ok small' }, c.impact)));
  });

  const projectionHost = h('div', { class: 'ln-projection' });
  const paintProjection = (): void => {
    const flying = p.projection.filter((x) => projectionKind(x.status) === 'flying').length;
    projectionHost.replaceChildren(
      h('div', { class: 'ln-econ-head' }, h('h3', { class: 'ln-sub-title' }, t('ln.proj.title')), h('span', { class: 'strong' }, t('ln.proj.assured', { n: flying, total: p.projection.length }))),
      h('div', { class: 'ln-proj-days' }, p.projection.map((x) => {
        const kind = projectionKind(x.status);
        return h('div', { class: `ln-proj ${kind}` }, h('span', { class: 'muted small' }, dayShort(x.date)), h('span', { class: 'ln-proj-bar' }), h('span', { class: kind === 'cancelled' ? 'ln-down small' : 'dim small' }, kind === 'cancelled' ? t('ln.fs.cancelled') : x.status));
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
