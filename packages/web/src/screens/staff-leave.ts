import { act } from '../actions.ts';
import { decideLeave } from '../api-staff.ts';
import { fetchLeave, fetchStaff, hireInterim, setRestPolicy, type CoverageRow, type LeaveView, type PolicyOption, type RestPolicy } from '../api-staff.ts';
import { button, icon, panel, stat, titleBlock } from '../components.ts';
import { locale } from '../finance-ui.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import type { Ctx, Screen } from '../screen.ts';
import { famShort, longDay, shortDate, staffOff } from '../staff-ui.ts';
import {
  absentOn, dayColumns, emptyRows, firstProblem, interimPrice, meanSalary, monthSpan, moveCell, pendingRequests, policyPreview, requestImpact, shortDays, worst, type Cell,
} from '../staff-view.ts';
import { fill } from '../lines-ui.ts';
import { h } from '../ui.ts';

/** The calendar covers four weeks from today; the rest-policy figures and the requests come with it. */
const PERIOD_DAYS = 28;
let cell: Cell | null = null;

/** `#staff/leave`: who is away and when, what that leaves to run the lines, the pending requests and the rest policy. */
export async function staffLeave(ctx: Ctx): Promise<Screen> {
  const { go } = ctx;
  const fm = fmt();
  const loc = locale();
  const redraw = (): void => { window.dispatchEvent(new Event('opc:redraw')); };
  const back = '#staff';
  const [data, overview] = await Promise.all([fetchLeave(undefined, PERIOD_DAYS), fetchStaff().catch(() => null)]);
  if (!data) return { title: t('st.l.title'), scene: 'login', tab: 'hubs', back, hints: [{ key: t('key.esc'), label: t('st.hint.staffShort') }], view: staffOff() };

  const cols = dayColumns(data.from, PERIOD_DAYS, loc);
  const rows = data.coverage;
  const problem = firstProblem(rows);
  const at: Cell = cell && cell.row < rows.length && cell.day < cols.length ? cell : problem;
  cell = at;

  // ------------------------------------------------------------ header
  const missing = shortDays(rows), none = emptyRows(rows);
  const status = missing > 0 || none.length > 0
    ? h('span', { class: 'row tight' }, h('span', { class: 'dot warn' }), [missing > 0 ? tp('st.l.short', missing, { date: shortDate(cols.at(-1)!.iso, loc) }) : null, none.length > 0 ? t('st.l.nobody', { names: none.join(', ') }) : null].filter(Boolean).join(', '))
    : h('span', { class: 'row tight' }, h('span', { class: 'dot' }), t('st.l.allCovered'));
  const header = h('div', { class: 'ln-header' },
    titleBlock(status, t('st.l.title'), h('p', { class: 'muted', style: 'font-size:14px' }, t('st.l.sub'))),
    h('div', { class: 'ln-kpis st-kpis' },
      stat(t('st.l.balance'), t('st.l.balanceVal', { n: fm.num(data.balance) }), t('st.l.balanceSub')),
      stat(t('st.l.resting'), fm.num(data.resting), t('st.l.restingSub', { n: data.restingPilots })),
      stat(t('st.l.fatigue'), fm.percent(data.avgFatigue / 100))));

  // ------------------------------------------------------------ the calendar
  const dayBox = h('div', { class: 'st-day', 'aria-live': 'polite' });
  const rowLabel = (r: CoverageRow): string => (r.family === 'pilot' ? r.label : famShort(r.family));
  const cellEl = (r: CoverageRow, ri: number, di: number): HTMLElement => {
    const state = r.days[di] ?? 'ok';
    const iso = cols[di]!.iso;
    return h('button', { type: 'button', class: `st-cell ${state}${at.row === ri && at.day === di ? ' on' : ''}${cols[di]!.weekend ? ' we' : ''}`, 'data-cell': `${ri}:${di}`, tabindex: at.row === ri && at.day === di ? 0 : -1,
      'aria-label': `${rowLabel(r)}, ${longDay(iso, loc)}: ${t(`st.l.c.${state}`)}`, 'aria-pressed': String(at.row === ri && at.day === di), onclick: () => select({ row: ri, day: di }) },
    state === 'short' ? h('span', null, '−1') : null);
  };
  const dayHead = h('div', { class: 'st-grid-row st-grid-head', 'aria-hidden': 'true' }, h('span', { class: 'dim small st-grid-span' }, monthSpan(cols, loc)),
    h('div', { class: 'st-cells' }, cols.map((c) => h('span', { class: `st-dh${c.weekend ? ' we' : ''}` }, h('i', null, c.weekday), h('b', null, String(c.date))))));
  const grid = h('div', { class: 'st-grid', role: 'group', 'aria-label': t('st.l.grid') }, dayHead,
    rows.map((r, ri) => h('div', { class: 'st-grid-row' },
      h('div', { class: 'st-grid-label' }, h('span', { class: 'strong' }, rowLabel(r)), h('span', { class: 'dim small' }, r.days.every((d) => d === 'none') ? t('st.l.rowNone', { n: r.headcount }) : t('st.l.rowSub', { n: r.headcount, per: r.perDay }))),
      h('div', { class: 'st-cells' }, cols.map((_, di) => cellEl(r, ri, di))))));
  const legend = h('div', { class: 'st-legend' }, (['ok', 'tight', 'short', 'none'] as const).map((k) => h('span', { class: 'ln-legend-item' }, h('i', { class: `st-cell sw ${k}`, 'aria-hidden': 'true' }), t(`st.l.c.${k}`))));

  const meanPay = (r: CoverageRow): number | null => (overview ? meanSalary(overview.families.flatMap((f) => (f.family === r.family ? [f] : [])), r.family) : null);
  const paintDay = (): void => {
    const r = rows[at.row], col = cols[at.day];
    if (!r || !col) { dayBox.replaceChildren(); return; }
    const state = r.days[at.day] ?? 'ok';
    const alert = data.alerts.find((a) => a.family === r.family && a.day === col.iso);
    const away = absentOn(data.requests, r.family, col.iso);
    const price = meanPay(r);
    const doInterim = (): void => {
      if (price === null) return;
      const cost = interimPrice(price, 1);
      if (!confirm(t('st.l.interimConfirm', { qual: rowLabel(r), days: 1, cost: fm.money(cost) }))) return;
      void act(t('st.l.interimDone'), () => hireInterim({ family: r.family, days: 1, ...(r.type ? { qual: r.type } : {}) }), async () => { redraw(); });
    };
    fill(dayBox,
      h('h3', { class: 'st-day-title' }, t('st.l.dayTitle', { day: longDay(col.iso, loc), family: rowLabel(r) })),
      h('p', { class: state === 'ok' ? 'muted' : state === 'tight' ? 'st-warn' : 'ln-down' }, t(`st.l.d.${state}`)),
      alert || away.length > 0 ? h('p', { class: 'muted small' }, away.length > 0 ? t('st.l.d.away', { names: away.map((a) => a.name).join(', ') }) : '') : null,
      state === 'short' || state === 'none' ? h('div', { class: 'row' },
        button(t('st.l.shift'), { variant: 'secondary', icon: 'calendar-clock', onclick: () => { document.getElementById('st-requests')?.scrollIntoView({ block: 'nearest' }); document.querySelector<HTMLElement>('#st-requests button')?.focus(); } }),
        price !== null && r.family !== 'kitchen' ? button(t('st.l.interim', { cost: fm.money(interimPrice(price, 1)) }), { variant: 'ghost', onclick: doInterim }) : null) : null);
  };
  const select = (to: Cell): void => {
    cell = to; Object.assign(at, to);
    for (const el of document.querySelectorAll<HTMLElement>('.st-cell[data-cell]')) { const on = el.dataset.cell === `${to.row}:${to.day}`; el.classList.toggle('on', on); el.setAttribute('aria-pressed', String(on)); el.tabIndex = on ? 0 : -1; }
    paintDay();
  };
  paintDay();
  const calendar = panel({ title: t('st.l.cover'), action: t('st.l.byFamily'), id: 'st-cover', class: 'st-panel st-cover' }, grid, legend, dayBox);

  // ------------------------------------------------------------ requests and policy
  const pending = pendingRequests(data.requests);
  const decide = (id: number, d: 'grant' | 'refuse'): void => { void act(t(d === 'grant' ? 'st.r.granted' : 'st.r.refused'), () => decideLeave(id, d), async () => { redraw(); }); };
  const requests = panel({ title: t('st.r.title'), action: tp('st.r.pending', pending.length), id: 'st-requests', class: 'st-requests' },
    pending.length === 0 ? h('p', { class: 'dim small' }, t('st.r.none'))
      : h('ul', { class: 'plain st-reqs' }, pending.map((r) => {
        const impact = requestImpact(r);
        return h('li', { class: 'st-req' },
          h('div', { class: 'row st-req-head' }, h('div', { class: 'col tight' }, h('span', { class: 'strong' }, r.family === 'pilot' ? r.name : `${r.name} · ${famShort(r.family)}`), h('span', { class: 'dim small' }, t('st.r.period', { from: shortDate(r.from, loc), to: shortDate(r.to, loc), n: r.days }))),
            h('div', { class: 'row tight' }, button(t('st.r.refuse'), { variant: 'ghost', label: t('st.r.of', { what: t('st.r.refuse'), name: r.name }), onclick: () => decide(r.id, 'refuse') }), button(t('st.r.accept'), { variant: 'primary', label: t('st.r.of', { what: t('st.r.accept'), name: r.name }), onclick: () => decide(r.id, 'grant') }))),
          impact.kind === 'worse' ? h('p', { class: 'st-warn small' }, icon('triangle-alert', 12), t('st.r.worse', { day: shortDate(impact.day, loc), family: famShort(r.family) })) : h('p', { class: 'ln-ok small' }, icon('circle-check', 12), t('st.r.fine')));
      })));

  const policy = policyPanel(data, redraw);
  const view = h('div', { class: 'st-screen st-leave' }, h('div', { class: 'st-main' }, header, calendar), h('div', { class: 'st-side-host' }, requests, policy));

  const stepDay = (by: number): void => select(moveCell(cell ?? at, rows.length, cols.length, { day: by }));
  const stepRow = (by: number): void => select(moveCell(cell ?? at, rows.length, cols.length, { row: by }));
  return {
    title: t('st.l.title'), scene: 'login', tab: 'hubs', view, back,
    hints: [{ key: t('key.esc'), label: t('st.hint.staffShort') }, { key: '← →', label: t('st.hint.day') }, { key: t('key.enter'), label: t('st.hint.seeDay') }],
    keys: { left: () => stepDay(-1), right: () => stepDay(1), w: () => stepRow(-1), s: () => stepRow(1) },
  };
}

function policyPanel(data: LeaveView, redraw: () => void): HTMLElement {
  const fm = fmt();
  let chosen: RestPolicy = data.policy;
  const optionOf = (p: RestPolicy): PolicyOption => data.policies.find((o) => o.policy === p) ?? data.policies[0]!;
  const body = h('div', { class: 'col' });
  const seg = h('div', { class: 'segments st-policy', role: 'group', 'aria-label': t('st.p.title') });
  const paint = (): void => {
    const o = optionOf(chosen);
    const preview = policyPreview(optionOf(data.policy), o, data.avgFatigue);
    seg.replaceChildren(...data.policies.map((p) => h('button', { type: 'button', class: 'seg', 'aria-pressed': String(p.policy === chosen), onclick: () => { chosen = p.policy; paint(); } }, t(`st.p.${p.policy}`))));
    const line = (label: string, value: string, tone = ''): HTMLElement => h('div', { class: 'ln-fact' }, h('span', { class: 'muted' }, label), h('span', { class: `ln-fact-value ${tone}` }, value));
    fill(body,
      h('div', { class: 'col tight' }, line(t('st.p.base'), t('st.p.hours', { h: o.restBaseH })), line(t('st.p.away'), t('st.p.hours', { h: o.restAwayH }))),
      preview ? h('div', { class: 'col tight st-preview' },
        line(t('st.p.extra'), `+${preview.extraHeadcount}`), line(t('st.p.payroll'), t('st.p.payVal', { amount: fm.signedMoney(preview.payrollDelta) }), preview.payrollDelta > 0 ? 'st-warn' : 'ln-ok'),
        line(t('st.p.fatigue'), `${preview.fatigueFrom} % → ${preview.fatigueTo} %`, 'ln-ok'), line(t('st.p.risk'), `${preview.riskPct > 0 ? '+' : preview.riskPct < 0 ? '−' : ''}${Math.abs(preview.riskPct)} %`, preview.riskPct <= 0 ? 'ln-ok' : 'ln-down'))
        : h('p', { class: 'dim small' }, t('st.p.current')),
      preview ? button(t(`st.p.btn.${chosen}`), { variant: 'secondary', onclick: () => void act(t('st.p.done'), () => setRestPolicy(chosen), async () => { redraw(); }) }) : null);
  };
  paint();
  return panel({ title: t('st.p.title'), id: 'st-policy', class: 'st-policy-panel' }, seg, body);
}
