import { type AgencyCandidate, type AgencyGap, type AgencyOption, type AgencyRequest, type AgencyView, type MissionView, cancelMission, fetchAgency, openMission, signMission } from '../api-agency.ts';
import { fetchStaff } from '../api-staff.ts';
import { act } from '../actions.ts';
import { OPTION_HASH, OPTION_NOTE, OPTION_PHASES, OPTION_SUB, OPTION_TITLE, OPTION_UNAVAILABLE, SAVED_AGAINST, barWidths, canSign, requestFor, stepCount, toggle } from '../agency-view.ts';
import { button, icon, panel, signLocation, stat, titleBlock } from '../components.ts';
import { ApiError } from '../errors.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import type { Ctx, Screen } from '../screen.ts';
import { hireFilter, roleShort, viewSwitch } from '../staff-ui.ts';
import { h } from '../ui.ts';

/** The post the player is looking at and the candidates she holds survive a redraw (a toggle, a language change), not a new visit. */
let requested: AgencyRequest | null = null;
let held: { mission: number; ids: string[] } | null = null;

const same = (a: Pick<AgencyRequest, 'base' | 'qual'>, b: Pick<AgencyRequest, 'base' | 'qual'>): boolean => a.base === b.base && a.qual === b.qual;

/** The server answers 422 for a post the company no longer has (a base closed, a type sold): the screen falls back to the post that costs the most. */
async function load(): Promise<AgencyView | null> {
  try {
    const view = await fetchAgency(requested, held?.ids);
    if (view?.mission && held && held.mission !== view.mission.id) { held = null; return await fetchAgency(requested); }
    return view;
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 422 && requested)) throw e;
    requested = null; held = null;
    return fetchAgency();
  }
}

const off = (): HTMLElement => h('div', { class: 'ln-off st-off panel' }, h('div', { class: 'panel-body' }, icon('users', 20), h('h1', { class: 'ln-off-title' }, t('ag.off.title')), h('p', { class: 'muted' }, t('ag.off.body'))));

/** `#staff/agency`: three ways to get the pilots a line lacks, priced by the server, and the recruiter mission that is the first of them. */
export async function staffAgency(ctx: Ctx): Promise<Screen> {
  const { go } = ctx;
  const fm = fmt();
  const redraw = (): void => { window.dispatchEvent(new Event('opc:redraw')); };
  const back = '#staff';
  const hints = [{ key: t('key.esc'), label: t('ag.hint.staff') }, { key: '↑ ↓', label: t('ag.hint.option') }, { key: t('key.space'), label: t('ag.hint.hold') }];
  const [view, overview] = await Promise.all([load(), fetchStaff().catch(() => null)]);
  if (!view) return { title: t('ag.title'), scene: 'login', tab: 'hubs', back, hints: hints.slice(0, 1), view: off() };

  const { request, mission } = view;
  const gap: AgencyGap | undefined = request ? view.gaps.find((g) => same(g, request)) : undefined;
  const agency = view.options.find((o) => o.id === 'agency');
  const vacant = overview ? overview.families.reduce((n, f) => n + f.availability.vacant, 0) : null;
  const widths = barWidths(view.options);

  // ------------------------------------------------------------ header
  const status = gap
    ? h('p', { class: 'ag-status' }, h('span', { class: 'dot' }), t('ag.status.short', { lines: gap.lines.map((l) => `${l.a} ⇄ ${l.b}`).join(', '), have: gap.have, need: gap.need, qual: gap.qual }))
    : h('p', { class: 'ag-status ok' }, icon('circle-check', 14), t('ag.status.none'));
  const header = h('div', { class: 'ln-header' },
    titleBlock(h('span', { class: 'row tight' }, request ? signLocation(request.base) : null, h('span', { class: 'dim' }, t('ag.crumb'))), t('ag.title'),
      h('div', { class: 'col tight' }, status, h('p', { class: 'muted', style: 'font-size:14px' }, t('ag.sub')))),
    viewSwitch('agency', go));
  const kpis = h('div', { class: 'ln-kpis st-kpis' },
    gap ? stat(t('ag.stat.pilots', { qual: gap.qual }), `${gap.have} / ${gap.need}`, t('ag.stat.pilots.sub')) : null,
    request ? stat(t('ag.stat.perDay'), fm.money(view.perDay), t('ag.stat.perDay.sub')) : null,
    overview && vacant !== null ? stat(t('ag.stat.staff'), `${fm.num(overview.people)} / ${fm.num(overview.positions)}`, tp('ag.stat.staff.sub', vacant)) : null);

  if (!request) {
    const empty = panel({ title: t('ag.empty.title'), id: 'ag-empty', class: 'st-panel' }, h('p', { class: 'dim st-empty' }, t('ag.empty.body')));
    return { title: t('ag.title'), scene: 'login', tab: 'hubs', back, hints: hints.slice(0, 1), view: h('div', { class: 'ag-screen' }, h('div', { class: 'ag-main' }, header, kpis, empty)) };
  }

  // ------------------------------------------------------------ the three options
  const pickOption = (o: AgencyOption): void => {
    if (o.id === 'agency') { document.querySelector<HTMLElement>('[data-primary]:not(:disabled)')?.focus(); return; }
    if (o.id === 'classic') Object.assign(hireFilter, { family: 'pilot', base: request.base, qual: request.qual });
    go(OPTION_HASH[o.id]);
  };
  const optionRow = (o: AgencyOption): HTMLElement => {
    const [w1, w2] = widths[o.id];
    const title = t(OPTION_TITLE[o.id]);
    const note = !o.available ? [icon('ban', 13), t(OPTION_UNAVAILABLE[o.id])]
      : [icon(o.id === 'agency' ? 'info' : 'triangle-alert', 13), t(OPTION_NOTE[o.id], { pct: fm.percent(view.premiumPct / 100) })];
    return h('li', { class: `ag-opt${o.id === 'agency' ? ' best' : ''}${o.available ? '' : ' off'}`, 'data-row': '', tabindex: 0, 'aria-label': t('ag.opt.row', { title, date: fm.date(o.resumeAt), amount: fm.money(o.total) }), onclick: () => pickOption(o) },
      h('div', { class: 'ag-opt-label' }, h('h3', { class: 'ag-opt-title' }, title), h('p', { class: 'muted small' }, t(OPTION_SUB[o.id])), h('p', { class: 'ag-opt-note dim small' }, note)),
      h('div', { class: 'ag-opt-time' },
        h('div', { class: 'ag-bar', role: 'img', 'aria-label': t(OPTION_PHASES[o.id], { a: o.phases[0], b: o.phases[1] }) }, h('i', { class: 'ph1', style: `width:${w1}%` }), h('i', { class: 'ph2', style: `width:${w2}%` })),
        h('p', { class: 'ag-opt-end' }, h('span', { class: 'strong' }, t('ag.opt.resume', { date: fm.date(o.resumeAt) })), h('span', { class: 'dim small' }, t(OPTION_PHASES[o.id], { a: o.phases[0], b: o.phases[1] })))),
      h('div', { class: 'ag-opt-cost' }, h('span', { class: 'ag-opt-total' }, fm.money(o.total)), h('span', { class: 'dim small' }, t('ag.opt.fees', { amount: fm.money(o.fees) })), h('span', { class: 'dim small' }, t('ag.opt.stopped', { amount: fm.money(o.stopped) }))));
  };
  const sv = view.savings;
  const savedBlocks = sv ? [
    sv.days > 0 ? h('div', { class: 'ag-saved' }, h('span', { class: 'ag-saved-value' }, tp('ag.saved.days', sv.days)), h('span', { class: 'strong small' }, t('ag.saved.days.sub')), h('span', { class: 'dim small' }, t(SAVED_AGAINST[sv.against]))) : null,
    h('div', { class: 'ag-saved' }, h('span', { class: 'ag-saved-value' }, fm.money(sv.amount)), h('span', { class: 'strong small' }, t('ag.saved.amount.sub')), h('span', { class: 'dim small' }, t(SAVED_AGAINST[sv.against])))] : [];

  const launch = async (): Promise<void> => {
    const ok = await act(t('ag.pos.launched', { n: agency?.phases[0] ?? 0 }), () => openMission(request), ctx.refresh);
    if (ok) redraw();
  };
  const options = panel({ title: tp('ag.opts.title', request.count, { qual: request.qual, count: request.count }), action: t('ag.opts.asOf', { date: fm.date(Date.now()) }), id: 'ag-options', class: 'st-panel ag-options' },
    h('ul', { class: 'plain ag-opts', 'aria-label': t('ag.opts.cols.option') }, view.options.map(optionRow)),
    h('div', { class: 'ag-foot' }, h('div', { class: 'ag-saveds' }, savedBlocks),
      mission ? null : button(t('ag.pos.launch'), { variant: 'primary', key: t('key.enter'), disabled: !agency?.available, onclick: () => void launch() })));

  // ------------------------------------------------------------ the mission
  const chip = (label: string, on: boolean, pick: () => void, id: string): HTMLElement => h('button', { type: 'button', id, class: 'st-chip mono', 'aria-pressed': String(on), onclick: pick }, label);
  const gapPicker = !mission && view.gaps.length > 1
    ? h('div', { class: 'st-fgroup', role: 'group', 'aria-label': t('ag.pos.gap') }, view.gaps.map((g, i) => chip(`${g.base} · ${g.qual} (${g.open})`, same(g, request), () => { requested = requestFor(g); held = null; redraw(); }, `ag-gap-${i}`)))
    : null;
  const countRow = !mission
    ? h('div', { class: 'ln-fact' }, h('span', { class: 'muted' }, t('ag.pos.count')),
      h('span', { class: 'ag-count' },
        h('button', { type: 'button', id: 'ag-fewer', class: 'st-chip', 'aria-label': t('ag.pos.fewer'), disabled: request.count <= 1, onclick: () => { requested = { ...request, count: stepCount(request.count, -1) }; redraw(); } }, icon('minus', 14)),
        h('span', { class: 'ln-fact-value' }, request.count),
        h('button', { type: 'button', id: 'ag-more', class: 'st-chip', 'aria-label': t('ag.pos.more'), onclick: () => { requested = { ...request, count: stepCount(request.count, 1) }; redraw(); } }, icon('plus', 14))))
    : null;
  const fact = (label: string, value: string): HTMLElement => h('div', { class: 'ln-fact' }, h('span', { class: 'muted' }, label), h('span', { class: 'ln-fact-value' }, value));
  const cancel = async (m: MissionView): Promise<void> => {
    const ok = await act(t('ag.pos.cancelled'), () => cancelMission(m.id), ctx.refresh);
    if (ok) { held = null; redraw(); }
  };
  const missionPanel = panel({ title: t('ag.pos.title'), id: 'ag-mission', class: 'ag-side-panel' },
    gapPicker,
    h('div', { class: 'col tight st-facts-list' },
      fact(t('ag.pos.post'), tp('ag.pos.postVal', request.count, { qual: request.qual })), fact(t('ag.pos.base'), request.base), fact(t('ag.pos.qual'), request.qual),
      agency ? fact(t('ag.pos.start'), t('ag.pos.startVal', { date: fm.date(agency.resumeAt) })) : null, countRow),
    mission ? button(t('ag.pos.cancel'), { variant: 'ghost', icon: 'x', onclick: () => void cancel(mission) }) : h('p', { class: 'dim small' }, t('ag.pos.free')));

  // ------------------------------------------------------------ the shortlist
  const sign = async (m: MissionView): Promise<void> => {
    const ok = await act(tp('ag.signed', m.quote!.picked.length, { date: fm.date(agency?.resumeAt ?? Date.now()), amount: fm.money(m.quote!.commission) }), () => signMission(m.id, m.quote!.picked), ctx.refresh);
    if (ok) { requested = null; held = null; redraw(); }
  };
  const candidate = (c: AgencyCandidate, i: number, m: MissionView): HTMLElement => {
    const on = m.quote!.picked.includes(c.id);
    return h('button', { type: 'button', id: `ag-cand-${i}`, class: 'ag-cand', 'aria-pressed': String(on), 'aria-label': t('ag.cand.hold', { name: c.name }),
      onclick: () => { held = { mission: m.id, ids: toggle(m.quote!.picked, c.id, m.count) }; redraw(); } },
      icon(on ? 'circle-check' : 'circle-dashed', 16),
      h('span', { class: 'ag-cand-who' },
        h('span', { class: 'ag-cand-head' }, h('span', { class: 'strong' }, `${c.name} · ${roleShort(c.role)}`), h('span', { class: 'strong' }, `${fm.money(c.askingSalary)} ${t('st.perMonth')}`)),
        h('span', { class: 'ag-cand-detail dim small' }, h('span', null, `${t('ag.cand.exp', { hours: fm.num(c.experience) })} · ${t('ag.cand.rel', { pct: fm.percent(c.reliability / 100) })} · ${t('ag.cand.notice', { n: c.noticeDays })}`), h('span', null, t('ag.cand.grid', { amount: fm.money(c.grid) })))));
  };
  const shortlist = (m: MissionView): Node[] => {
    if (!m.ready || !m.shortlist || !m.quote) return [h('p', { class: 'dim' }, t('ag.list.searching', { date: fm.date(m.readyAt) }))];
    const q = m.quote;
    return [
      h('div', { class: 'ag-cands', role: 'group', 'aria-label': t('ag.list.title') }, m.shortlist.map((c, i) => candidate(c, i, m))),
      h('div', { class: 'ag-fee' },
        h('div', { class: 'ln-fact' }, h('span', { class: 'muted' }, t('ag.fee.commission', { pct: fm.percent(view.commissionPct / 100) })), h('span', { class: 'ln-fact-value' }, fm.money(q.commission))),
        h('div', { class: 'ln-fact' }, h('span', { class: 'muted' }, t('ag.fee.surcharge')), h('span', { class: 'ln-fact-value warn' }, t('ag.fee.surchargeVal', { amount: fm.money(q.surchargeMonthly) }))),
        h('div', { class: 'ln-fact' }, h('span', { class: 'muted' }, t('ag.fee.payable')), h('span', { class: 'ln-fact-value' }, t('ag.fee.atSigning'))),
        h('p', { class: q.balanceAfter < 0 ? 'st-warn small' : 'dim small' }, q.balanceAfter < 0 ? t('ag.fee.short') : t('ag.fee.after', { amount: fm.money(q.balanceAfter) }))),
      button(q.picked.length === 0 ? t('ag.sign.none') : tp('ag.sign', q.picked.length), { variant: 'primary', key: t('key.enter'), disabled: !canSign(m), onclick: () => void sign(m) })];
  };
  const listPanel = panel({ title: t('ag.list.title'), action: mission?.quote ? t('ag.list.ready', { held: mission.quote.picked.length, n: mission.count }) : undefined, id: 'ag-list', class: 'ag-side-panel' },
    ...(mission ? shortlist(mission) : [h('p', { class: 'dim small' }, t('ag.pos.free'))]));

  const screen = h('div', { class: 'ag-screen' }, h('div', { class: 'ag-main' }, header, kpis, options), h('div', { class: 'ag-side' }, missionPanel, listPanel));
  return { title: t('ag.title'), scene: 'login', tab: 'hubs', view: screen, back, hints: [...hints, { key: t('key.enter'), label: mission?.ready ? t('ag.hint.sign') : t('ag.hint.launch') }] };
}
