import { fetchIncidents, fetchSafety, type Lever, type SafetyView } from '../api-safety.ts';
import { icon, panel, signLocation, titleBlock } from '../components.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import type { IconName } from '../icons.ts';
import type { Key } from '../messages.ts';
import type { Ctx, Screen, ScreenFn } from '../screen.ts';
import { CHART, chartOf, headline, leverHash, leversTotal, newestFirst, pathOf, pointsLost, registrationOf, scoreFill, scoreTone, type ChartModel } from '../safety-view.ts';
import { factorText, incidentRow, pct1, safetyOff, signed } from '../safety-ui.ts';
import { svg } from '../svg.ts';
import { h } from '../ui.ts';
import { safetyJournal } from './safety-journal.ts';

/** The incidents the side panel lists; the rest is a key press away in the journal. */
const SIDE_INCIDENTS = 4;
const LEVER_ICON: Record<Lever['action'], IconName> = { crew: 'user', maintenance: 'plane', leave: 'calendar' };
const LEVER_BTN_ICON: Record<Lever['action'], IconName> = { crew: 'user', maintenance: 'wrench', leave: 'calendar' };

/** The lever on show and the open calculation survive a redraw (a poll or a language change), not a new visit. */
let picked = 0;
let explain = false;

/** `#safety` and `#safety/journal` are one route name with a different argument (B.10): this picks the screen. */
export const safetyRoute: ScreenFn = (ctx) => (ctx.arg === 'journal' ? safetyJournal(ctx) : safety(ctx));

/** `#safety`: the safety index, the risk of a flight by crew duty time, what weighs today and the season's incidents. */
export async function safety(ctx: Ctx): Promise<Screen> {
  const { snap, go } = ctx;
  const { me } = snap;
  const back = '#hubs';
  const [view, incidents] = await Promise.all([fetchSafety(), fetchIncidents()]);
  if (!view) return { title: t('sf.title'), scene: 'bridge', tab: 'hubs', back, hints: [{ key: t('key.esc'), label: t('st.hint.company') }], view: safetyOff() };

  const fm = fmt();
  const levers = view.levers;
  picked = Math.min(picked, Math.max(0, levers.length - 1));

  // ------------------------------------------------------------ header: breadcrumb, status, title, the index and its three parts
  const head = headline(view);
  const statusText = head.kind === 'steady' ? t('sf.status.steady') : tp(`sf.status.${head.kind}`, head.n);
  const identity = titleBlock(
    h('div', { class: 'col tight' },
      h('div', { class: 'row tight' }, me.hubs[0] ? signLocation(me.hubs[0]) : null, h('span', { class: 'sf-crumb' }, t('sf.crumb'))),
      h('div', { class: 'row tight' }, h('span', { class: `dot ${head.tone === 'warn' ? 'warn' : ''}`.trim() }), h('span', { class: 'sf-status' }, statusText))),
    t('sf.title'));

  const delta = Math.round(view.delta7d);
  const indexBlock = h('div', { class: 'sf-index' },
    h('span', { class: 'sf-label' }, t('sf.index')),
    h('span', { class: 'sf-index-value' }, fm.num(Math.round(view.index)), h('span', { class: 'sf-index-of' }, ` ${t('sf.index.of')}`)),
    h('span', { class: `sf-delta${delta < 0 ? ' warn' : ''}` }, delta === 0 ? t('sf.delta.zero') : t('sf.delta', { n: signed(delta) })));

  const part = (key: Key, s: { points: number; max: number }): HTMLElement => {
    const lost = pointsLost(s);
    return h('div', { class: 'sf-part' },
      h('span', { class: 'sf-label' }, t(key)),
      h('span', { class: 'sf-part-value' }, `${fm.num(Math.round(s.points))} / ${fm.num(s.max)}`),
      h('span', { class: `sf-delta${scoreTone(s) === 'warn' ? ' warn' : ''}` }, lost > 0 ? tp('sf.part.lost', lost) : t('sf.part.full')),
      h('div', { class: `sf-bar ${scoreTone(s)}`, role: 'progressbar', 'aria-label': t(key), 'aria-valuemin': 0, 'aria-valuemax': s.max, 'aria-valuenow': Math.round(s.points) },
        h('span', { style: `width:${Math.round(scoreFill(s) * 100)}%` })));
  };
  const header = h('div', { class: 'ln-header' }, identity,
    h('div', { class: 'sf-stats' }, indexBlock, h('i', { class: 'sf-divider', 'aria-hidden': 'true' }),
      part('sf.part.fatigue', view.parts.fatigue), part('sf.part.aircraft', view.parts.aircraft), part('sf.part.training', view.parts.training)));

  // ------------------------------------------------------------ the risk chart
  const chart = chartOf(view);
  const top = chart.top?.flight ?? [...view.today].sort((a, b) => b.factor - a.factor)[0] ?? null;
  const caption = h('p', { class: 'sf-caption', id: 'sf-caption' }, explain ? t('sf.risk.detailBody') : t('sf.risk.caption'));
  const detailBtn = h('button', { type: 'button', class: 'link-btn sf-detail-btn', 'aria-expanded': String(explain), 'aria-controls': 'sf-caption',
    onclick: () => { explain = !explain; caption.textContent = explain ? t('sf.risk.detailBody') : t('sf.risk.caption'); detailBtn.setAttribute('aria-expanded', String(explain)); } }, t('sf.risk.detail'));
  const riskPanel = panel({ title: t('sf.risk.title'), action: detailBtn, id: 'sf-risk', class: 'sf-main' },
    h('div', { class: 'sf-intro' }, caption, chart.curve.length < 2 ? null : h('div', { class: 'sf-legend' },
      h('span', { class: 'ln-legend-item' }, h('i', { class: 'sf-swatch', 'aria-hidden': 'true' }), t('sf.risk.curve')),
      chart.flights.length > 0 ? h('span', { class: 'ln-legend-item' }, h('i', { class: 'sf-swatch dot', 'aria-hidden': 'true' }), t('sf.risk.flights')) : null)),
    chartBox(view, chart, top),
    leverList(view, go));

  // ------------------------------------------------------------ the season's incidents
  const season = view.season;
  const shown = newestFirst(incidents ?? []).slice(0, SIDE_INCIDENTS);
  const more = (incidents?.length ?? 0) - shown.length;
  const insMonth = season.insuranceFrom ? /^(\d{4})-(\d{2})/.exec(season.insuranceFrom) : null;
  const rise = Math.round(season.insuranceDelta * 100);
  const incidentPanel = panel({ title: t('sf.inc.title'), action: h('button', { type: 'button', class: 'link-btn sf-journal-btn', onclick: () => go('#safety/journal') }, t('sf.inc.journal'), h('kbd', { class: 'keycap' }, 'J')), id: 'sf-inc', class: 'sf-side' },
    shown.length === 0 ? h('p', { class: 'dim sf-none' }, t('sf.inc.none')) : h('ul', { class: 'plain sf-incs' }, shown.map((i) => incidentRow(i, registrationOf(me.fleet, i.aircraftId)))),
    more > 0 ? h('p', { class: 'dim small' }, tp('sf.inc.more', more)) : null,
    h('div', { class: 'sf-season' },
      h('div', { class: 'line' }, h('span', { class: 'line-label dim' }, t('sf.season.total', { covered: fm.money(season.covered) })), h('span', { class: 'line-value muted' }, fm.money(season.total))),
      h('div', { class: 'line' }, h('span', { class: 'line-label muted' }, t('sf.season.borne')), h('span', { class: 'line-value strong' }, fm.money(season.borne))),
      h('div', { class: 'line' },
        h('span', { class: 'line-label muted' }, insMonth ? t('sf.season.premiumFrom', { month: fm.seasonMonth(`${insMonth[1]}-${insMonth[2]}`) }) : t('sf.season.premium')),
        h('span', { class: `line-value${rise > 0 ? ' sf-warn' : ' muted'}` }, rise > 0 ? t('sf.season.rise', { n: fm.num(rise) }) : t('sf.season.noRise')))));

  const viewEl = h('div', { class: 'sf-screen' }, header, h('div', { class: 'sf-body' }, riskPanel, incidentPanel));
  return {
    title: t('sf.title'), scene: 'bridge', tab: 'hubs', view: viewEl, back, wide: false,
    hints: [{ key: t('key.esc'), label: t('st.hint.company') }, ...(levers.length > 0 ? [{ key: '↑ ↓', label: t('sf.hint.factors') }, { key: t('key.enter'), label: t('sf.hint.act') }] : []), { key: 'J', label: t('sf.hint.journal') }],
    keys: { j: () => go('#safety/journal') },
  };
}

// ---------------------------------------------------------------- the chart

function chartBox(view: SafetyView, c: ChartModel, top: SafetyView['today'][number] | null): HTMLElement {
  if (c.curve.length < 2) return h('p', { class: 'dim sf-none' }, t('sf.risk.none'));
  const first = view.riskCurve[0]!;
  const last = view.riskCurve[view.riskCurve.length - 1]!;
  const label = t('sf.risk.alt', { from: pct1(first.risk), to: pct1(last.risk), h: fmt().num(last.dutyHours) });
  const plotH = CHART.bottom - CHART.top;
  const dot = c.flights.find((f) => f.flight === top) ?? null;
  const g = svg('svg', { class: 'sf-svg', viewBox: `0 0 ${CHART.width} ${CHART.height}`, width: CHART.width, height: CHART.height, role: 'img', 'aria-label': label, focusable: 'false' },
    ...c.yTicks.flatMap((y) => [
      svg('line', { class: y.pct === 0 ? 'sf-grid base' : 'sf-grid', x1: CHART.left, x2: CHART.right, y1: y.y, y2: y.y }),
      svg('text', { class: 'sf-tick', x: CHART.left - 10, y: y.y + 4, 'text-anchor': 'end' }, y.pct === 0 ? '0' : `${y.pct} %`),
    ]),
    svg('rect', { class: 'sf-over', x: c.limitX, y: CHART.top, width: CHART.right - c.limitX, height: plotH }),
    svg('line', { class: 'sf-limit', x1: c.limitX, x2: c.limitX, y1: CHART.top, y2: CHART.bottom }),
    svg('text', { class: 'sf-limit-label', x: c.limitX - 8, y: CHART.top + 14, 'text-anchor': 'end' }, t('sf.risk.limit', { h: 13 })),
    svg('path', { class: 'sf-curve', d: pathOf(c.curve) }),
    ...c.flights.map((f) => {
      const name = svg('title', {}, `${f.flight.flightNo} · ${f.flight.crew} · ${pct1(f.flight.risk)} · ${factorText(f.flight.factor)}`);
      return f === dot
        ? svg('g', { class: 'sf-dot top' }, name, svg('circle', { class: 'halo', cx: f.x, cy: f.y, r: 12 }), svg('circle', { cx: f.x, cy: f.y, r: 5 }))
        : svg('circle', { class: 'sf-dot', cx: f.x, cy: f.y, r: 3.5 }, name);
    }),
    ...c.xTicks.map((x) => svg('text', { class: 'sf-tick', x: x.x, y: CHART.bottom + 22, 'text-anchor': 'middle' }, t('sf.axis.h', { n: x.hours }))));
  return h('div', { class: 'sf-chart' }, g, top && dot ? flightLabel(top, dot) : null);
}

/** The annotation of the flight at most risk tonight, above and left of its dot: the curve rises to the right, so that side of the plot is empty. A flight whose duty hours the server did not send has no dot and so no label. */
function flightLabel(f: SafetyView['today'][number], at: { x: number; y: number }): HTMLElement {
  const fm = fmt();
  const duty = f.dutyHours === undefined ? null : fm.duration(f.dutyHours);
  const place = `right:${((CHART.width - at.x + 22) / CHART.width * 100).toFixed(2)}%;top:${(Math.max(0, at.y - 30) / CHART.height * 100).toFixed(2)}%`;
  return h('div', { class: 'sf-flabel', style: place },
    h('span', { class: 'sf-flabel-title' }, t('sf.risk.fTitle', { flight: f.flightNo, crew: f.crew })),
    h('span', { class: 'sf-flabel-detail' }, duty ? t('sf.risk.fDetail', { duty, risk: pct1(f.risk), factor: factorText(f.factor) }) : t('sf.risk.fDetailNoDuty', { risk: pct1(f.risk), factor: factorText(f.factor) })));
}

// ---------------------------------------------------------------- "ce qui pèse aujourd'hui"

function leverList(view: SafetyView, go: (hash: string) => void): HTMLElement {
  const levers = view.levers;
  const total = leversTotal(levers, view.index);
  const rows: HTMLElement[] = [];
  /** The selected lever's button is the screen's primary action (what Enter presses), drawn as in the mockup: filled, no icon, with the key. The others are secondary. */
  const paint = (btn: HTMLButtonElement, l: Lever, primary: boolean): void => {
    btn.className = `btn ${primary ? 'primary' : 'secondary'}`;
    if (primary) btn.setAttribute('data-primary', ''); else btn.removeAttribute('data-primary');
    btn.replaceChildren(...(primary ? [] : [icon(LEVER_BTN_ICON[l.action], 16)]), h('span', null, t(`sf.act.${l.action}` as const)), ...(primary ? [h('span', { class: 'btn-key' }, t('key.enter'))] : []));
  };
  const select = (i: number): void => {
    picked = i;
    rows.forEach((r, k) => { r.classList.toggle('sel', k === i); if (k === i) r.setAttribute('aria-current', 'true'); else r.removeAttribute('aria-current'); paint(r.querySelector('button')!, levers[k]!, k === i); });
  };
  levers.forEach((l, i) => {
    const btn = h('button', { type: 'button', onfocus: () => select(i) });
    rows.push(h('li', { class: 'sf-lever', 'data-row': '', tabindex: -1, 'aria-label': `${l.label}, ${tp('sf.lev.pts', Math.round(l.points))}`, onfocus: () => select(i), onclick: () => go(leverHash(l)) },
      icon(LEVER_ICON[l.action], 18),
      h('div', { class: 'sf-lever-text' }, h('span', { class: 'sf-lever-title' }, l.label), h('span', { class: 'sf-lever-detail' }, l.detail)),
      h('span', { class: 'sf-lever-pts' }, tp('sf.lev.pts', Math.round(l.points))),
      h('div', { class: 'sf-lever-act' }, btn)));
  });
  if (levers.length > 0) select(picked);
  return h('section', { class: 'sf-levers', 'aria-labelledby': 'sf-lev-title' },
    h('div', { class: 'sf-lev-head' }, h('h3', { class: 'sf-lev-title', id: 'sf-lev-title' }, t('sf.lev.title')),
      levers.length > 0 ? h('span', { class: 'sf-lev-summary' }, tp('sf.lev.summary', levers.length, { points: fmt().num(total) })) : null),
    levers.length === 0 ? h('p', { class: 'dim sf-none' }, t('sf.lev.none')) : h('ul', { class: 'plain sf-lever-list' }, rows));
}
