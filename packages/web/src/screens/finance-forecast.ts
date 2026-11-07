import { SCENARIOS, type DecisionResult, type DecisionView, type ForecastView, type Scenario } from '@opc/shared';
import { fetchForecast, testDecision } from '../api-reports.ts';
import { act } from '../actions.ts';
import { button, icon, panel, titleBlock } from '../components.ts';
import { locale } from '../finance-ui.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import { reportHints, reportKeys, reportNav, reportsOff, figure, signedMoney } from '../reports-ui.ts';
import { DECISION_KEY, DECISION_NOTE_KEY, PLOT, SCENARIO_KEY, SCENARIO_NOTE_KEY, bandOf, compact, monthName, monthShort, overdraftHeadline, pathOf, scaleOf, stepScenario } from '../reports-view.ts';
import type { Ctx, Screen } from '../screen.ts';
import { svg } from '../svg.ts';
import { h } from '../ui.ts';

/** The scenario read in the figures, and the decision being tried, survive a redraw, not a new visit. */
const state: { scenario: Scenario; tried: DecisionResult | null } = { scenario: 'central', tried: null };

/** `#finance/forecast`: the lowest balance of each of the next twelve months in three scenarios, the days it would be overdrawn, and what four decisions would change. Built from the monthly billing plan and the line engine, never a new model. */
export async function financeForecast(ctx: Ctx): Promise<Screen> {
  const { go } = ctx;
  const back = '#finance';
  const data = await fetchForecast();
  if (!data) return { title: t('rp.f.title'), scene: 'finance', tab: 'hubs', back, hints: [{ key: t('key.esc'), label: t('st.hint.company') }], view: reportsOff() };

  const fm = fmt(), loc = locale();
  const redraw = (): void => { window.dispatchEvent(new Event('opc:redraw')); };
  const pick = (s: Scenario): void => { if (s !== state.scenario) { state.scenario = s; redraw(); } };
  const tried = state.tried;
  const summary = data.summary[state.scenario];
  const trial = tried ? tried.summary[state.scenario] : null;

  const alert = overdraftHeadline(data.summary);
  const status = alert
    ? t('rp.f.status.overdraft', { scenario: t(SCENARIO_KEY[alert.scenario]).toLowerCase(), from: fm.date(alert.from), to: fm.date(alert.to) })
    : t('rp.f.status.ok');
  const header = h('div', { class: 'ln-header rp-header' },
    titleBlock(h('span', { class: 'row tight' }, h('span', { class: `dot${alert ? ' warn' : ''}` }), h('span', null, status)), t('rp.f.title')),
    h('div', { class: 'rp-figures' },
      figure(t('rp.f.today'), fm.money(data.balance), fm.date(data.now)),
      figure(t('rp.f.low'), fm.money(summary.lowest.balance), t('rp.f.lowAt', { date: fm.date(summary.lowest.at) }), summary.lowest.balance < 0 ? 'warn' : null),
      figure(t('rp.f.end'), fm.money(summary.end), t('rp.f.endAt', { month: monthName(data.points.at(-1)?.month ?? '', loc) })),
      figure(t('rp.f.overdraft'), tp('rp.c.days', summary.overdraft.days), summary.overdraft.days > 0 && summary.overdraft.from !== null ? t('rp.f.overdraftFrom', { date: fm.date(summary.overdraft.from) }) : t('rp.f.overdraft.none'), summary.overdraft.days > 0 ? 'warn' : null)));

  // ------------------------------------------------------------ the chart: lowest balance per month, prudent-optimistic band around the central line
  const points = data.points;
  const scale = scaleOf(points, tried ? tried.points.flatMap((p) => SCENARIOS.map((s) => p[s])) : []);
  const labelAt = (i: number): boolean => i === 0 || i === points.length - 1 || i % 2 === 0;
  const chartSvg = svg('svg', { class: 'rp-chart', viewBox: `0 0 ${PLOT.width} ${PLOT.height}`, role: 'img', 'aria-label': t('rp.f.chart.label') },
    ...scale.ticks.map((v) => svg('g', {},
      svg('line', { x1: PLOT.left, x2: PLOT.width - PLOT.right, y1: scale.y(v), y2: scale.y(v), class: v === 0 ? 'zero' : 'grid' }),
      svg('text', { x: PLOT.left - 8, y: scale.y(v) + 4, class: 'tick', 'text-anchor': 'end' }, compact(v, loc)))),
    svg('rect', { x: PLOT.left, y: scale.zero, width: PLOT.width - PLOT.left - PLOT.right, height: Math.max(0, PLOT.height - PLOT.bottom - scale.zero), class: 'overdraft' }),
    svg('path', { d: bandOf(points, (p) => p.prudent, (p) => p.optimistic, scale), class: 'band' }),
    svg('path', { d: pathOf(points, (p) => p.prudent, scale), class: `line prudent${state.scenario === 'prudent' ? ' on' : ''}` }),
    svg('path', { d: pathOf(points, (p) => p.optimistic, scale), class: `line optimistic${state.scenario === 'optimistic' ? ' on' : ''}` }),
    svg('path', { d: pathOf(points, (p) => p.central, scale), class: `line central${state.scenario === 'central' ? ' on' : ''}` }),
    tried ? svg('path', { d: pathOf(tried.points, (p) => p[state.scenario], scale), class: 'line trial' }) : null,
    ...points.map((p, i) => labelAt(i) ? svg('text', { x: scale.x(i), y: PLOT.height - 8, class: 'tick', 'text-anchor': 'middle' }, monthShort(p.month, loc)) : null),
    svg('circle', { cx: scale.x(Math.max(0, points.findIndex((p) => p.month === new Date(summary.lowest.at).toISOString().slice(0, 7)))), cy: scale.y(summary.lowest.balance), r: 4, class: 'low' }));
  const legend = h('div', { class: 'rp-scenarios', role: 'radiogroup', 'aria-label': t('rp.f.scenario.label') }, (['prudent', 'central', 'optimistic'] as const).map((s) =>
    h('button', { type: 'button', class: `rp-scenario ${s}`, role: 'radio', 'aria-checked': String(s === state.scenario), onclick: () => pick(s) },
      h('i', { class: s, 'aria-hidden': 'true' }), h('span', { class: 'col tight' }, h('strong', null, t(SCENARIO_KEY[s])), h('span', { class: 'dim small' }, t(SCENARIO_NOTE_KEY[s]))),
      h('span', { class: 'mono rp-scenario-end' }, fm.moneyShort(data.summary[s].end)))));
  const main = panel({ title: t('rp.f.chart'), action: t('rp.f.chart.sub'), id: 'rp-chart', class: 'rp-main' },
    chartSvg, legend, h('p', { class: 'dim small' }, t('rp.f.basis')));

  // ------------------------------------------------------------ decisions: tried against the same forecast
  const effectLine = (d: DecisionView): HTMLElement | null => {
    const e = d.effect?.[state.scenario];
    if (!e) return null;
    return h('span', { class: 'rp-effect' }, h('span', { class: 'dim' }, t('rp.f.d.low')), ' ', signedMoney(e.lowDelta), ' · ', h('span', { class: 'dim' }, t('rp.f.d.overdraft')), ' ',
      e.overdraftDays.before === e.overdraftDays.after ? tp('rp.c.days', e.overdraftDays.after) : t('rp.f.d.days', { before: e.overdraftDays.before, after: e.overdraftDays.after }));
  };
  const decide = (d: DecisionView): void => {
    void act(t('rp.f.d.tried'), async () => { state.tried = await testDecision(d.id); }, async () => { redraw(); });
  };
  const decision = (d: DecisionView): HTMLElement => {
    const what = d.id === 'pause_line' && d.line ? `${d.line.a} – ${d.line.b}` : d.icao ?? '';
    const on = tried?.decision === d.id;
    return h('li', { class: `rp-decision${on ? ' on' : ''}` },
      h('div', { class: 'col tight' }, h('strong', null, t(DECISION_KEY[d.id], { what })), h('span', { class: 'dim small' }, t(DECISION_NOTE_KEY[d.id], { amount: fm.money(d.upfront) })), effectLine(d)),
      d.available ? button(on ? t('rp.f.d.clear') : t('rp.f.d.try'), { variant: 'secondary', onclick: () => { if (on) { state.tried = null; redraw(); } else decide(d); }, label: `${t(DECISION_KEY[d.id], { what })}: ${on ? t('rp.f.d.clear') : t('rp.f.d.try')}` })
        : h('span', { class: 'dim small' }, t('rp.f.d.unavailable')));
  };
  const trialNote = tried && trial ? h('p', { class: 'rp-trial' }, icon('info', 16), ' ', t('rp.f.d.result', { low: fm.money(trial.lowest.balance), end: fm.money(trial.end) })) : null;
  const side = panel({ title: t('rp.f.decisions'), action: t('rp.f.decisions.sub'), id: 'rp-decisions' }, h('ul', { class: 'plain rp-decisions' }, data.decisions.map(decision)), trialNote);

  const view = h('div', { class: 'rp-screen' }, header, reportNav('forecast', go), h('div', { class: 'rp-body' }, main, h('div', { class: 'rp-side' }, side)));
  return {
    title: t('rp.f.title'), scene: 'finance', tab: 'hubs', view, back, wide: false,
    hints: reportHints({ key: '← →', label: t('rp.f.hint.scenario') }, { key: t('key.enter'), label: t('rp.f.hint.try') }),
    keys: { left: () => pick(stepScenario(state.scenario, -1)), right: () => pick(stepScenario(state.scenario, 1)), ...reportKeys('forecast', go) },
  };
}
