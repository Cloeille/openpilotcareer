import { act } from '../actions.ts';
import { fetchMember, fetchStaff, hireInterim, restMember, trainMember, transferMember, type StaffDetail } from '../api-staff.ts';
import { typesOf } from '../competition-data.ts';
import { button, icon, panel, signLocation, stat, titleBlock } from '../components.ts';
import { locale } from '../finance-ui.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import { hashFor } from '../keys.ts';
import type { Key } from '../messages.ts';
import type { Ctx, Screen } from '../screen.ts';
import { famLabel, meterBar, roleFull, shortDate, staffOff } from '../staff-ui.ts';
import {
  chartDay, dayBars, dutyDays, dutyFacts, dutyPeriods, ganttOf, interimPrice, isoDay, limitMeters, medicalState, membersOf, monthsSince, plannedHours, reliabilityTone, RULES, service7dMin, restDays, stepMember, trainingOffers,
  type DutyPeriod,
} from '../staff-view.ts';
import { h } from '../ui.ts';

const HOUR = 3_600_000;
/** The day of the duty chart, kept while the sheet redraws. */
let chartOf: { id: number; day: string } | null = null;

const hoursText = (min: number): string => { const m = Math.max(0, Math.round(min)); return `${Math.floor(m / 60)}${'\u00a0'}h ${String(m % 60).padStart(2, '0')}`; };

/** `#staff/<id>`: one person's duty, limits, qualifications and contract. */
export async function staffMember(ctx: Ctx): Promise<Screen> {
  const { snap, go } = ctx;
  const { me } = snap;
  const fm = fmt();
  const loc = locale();
  const id = ctx.arg === null ? NaN : Number(ctx.arg);
  const back = '#staff';
  const gone = (key: Key): Screen => ({ title: t(key), scene: 'login', tab: 'hubs', back, hints: [{ key: t('key.esc'), label: t('st.hint.staffShort') }], view: h('p', { class: 'error-text', role: 'alert' }, t(key)) });
  if (!Number.isInteger(id)) return gone('st.m.notFound');
  const [detail, overview] = await Promise.all([fetchMember(id), fetchStaff().catch(() => null)]);
  if (!detail) return gone('st.m.notFound');
  return sheet(ctx, detail, overview, { fm, loc, me, go, back });
}

type Env = { fm: ReturnType<typeof fmt>; loc: string; me: Ctx['snap']['me']; go: Ctx['go']; back: string };

async function sheet(ctx: Ctx, d: StaffDetail, overview: Awaited<ReturnType<typeof fetchStaff>>, env: Env): Promise<Screen> {
  const { fm, loc, me, go, back } = env;
  const m = d.member;
  const now = Date.now();
  const redraw = (): void => { window.dispatchEvent(new Event('opc:redraw')); };
  const isPilot = m.family === 'pilot';
  const types = await typesOf([...new Set([...m.quals, ...me.fleet.map((a) => a.icao)])]);
  const typeName = (icao: string): string => types.get(icao)?.name ?? icao;
  const base = me.hubs.find((b) => b === m.base) ?? m.base;

  // ------------------------------------------------------------ duty: periods, chart day, today's figures
  const periods: DutyPeriod[] = dutyPeriods(d.week, now, d.duty.endsAt);
  const days = dutyDays(periods);
  const day = chartOf?.id === m.id && days.includes(chartOf.day) ? chartOf.day : chartDay(days, now);
  chartOf = day ? { id: m.id, day } : null;
  const facts = dutyFacts(d.duty, periods, now);
  const dayPeriods = periods.filter((p) => isoDay(p.start) === day);
  const gantt = ganttOf(dayPeriods, now);
  const nearLimit = d.duty.endsAt !== null && d.duty.dutyMin / d.duty.limitMin >= 0.7;

  // ------------------------------------------------------------ header
  const names = m.quals.map(typeName).join(' · ');
  const tenure = monthsSince(m.hiredAt, now);
  const stateLine = m.endsAt !== null ? t('st.m.leaving') : facts.onDuty ? `${t('st.m.onDuty', { at: fm.zulu(facts.startedAt!) })}${nearLimit ? ` · ${t('st.m.nearLimit')}` : ''}` : t(`st.m.state.${m.state}` as Key);
  const header = h('div', { class: 'st-sheet-head' },
    h('div', { class: 'col tight' },
      h('div', { class: 'row' }, signLocation(base), h('span', { class: 'dim small' }, t('st.m.crumb', { family: famLabel(m.family), city: base }))),
      h('div', { class: 'status-line' }, h('span', { class: `dot${facts.onDuty && nearLimit ? ' warn' : m.state === 'free' || facts.onDuty ? '' : ' idle'}` }), stateLine),
      h('h1', { class: 'title' }, m.name),
      h('p', { class: 'muted' }, tp('st.m.sub', tenure, { role: roleFull(m.role), types: names ? t('st.m.types', { types: names }) : '', company: me.company.name }))),
    h('div', { class: 'ln-kpis st-kpis' },
      isPilot ? stat(t('st.k.hours'), `${fm.num(m.experience)} h`) : stat(t('st.k.years'), fm.num(m.experience)),
      stat(t('st.k.rel'), fm.percent(m.reliability / 100), h('span', { class: reliabilityTone(m.reliability) === 'warn' ? 'st-warn' : 'dim' }, m.reliability < 100 ? '' : '')),
      stat(t('st.k.morale'), fm.percent(m.morale / 100)),
      stat(t('st.k.salary'), fm.money(m.salary), t('st.k.salarySub', { contract: t(`st.contract.${m.contract}` as Key) }))));

  // ------------------------------------------------------------ the duty panel
  const dutyHead = facts.onDuty
    ? h('div', { class: 'st-duty-facts' },
      h('div', { class: 'col tight' }, h('span', { class: 'dim small' }, t('st.du.since', { at: fm.zulu(facts.startedAt!) })), h('span', { class: 'st-big' }, hoursText(d.duty.dutyMin)), h('span', { class: 'dim small' }, t('st.du.of', { limit: hoursText(RULES.dutyMaxMin) }))),
      h('div', { class: 'col tight' }, h('span', { class: 'dim small' }, t('st.du.endBy')), h('span', { class: 'st-mid warn' }, fm.zulu(facts.limitAt!))),
      h('div', { class: 'col tight' }, h('span', { class: 'dim small' }, t('st.du.left')), h('span', { class: 'st-mid' }, tp('st.du.leftVal', facts.remaining.flights, { time: hoursText(facts.remaining.minutes) }))),
      h('div', { class: 'col tight' }, h('span', { class: 'dim small' }, t('st.du.rest')), h('span', { class: 'st-mid' }, t('st.du.restVal', { h: fm.num(d.duty.restHours) }))))
    : h('p', { class: 'muted' }, periods.length === 0 ? t('st.du.none') : t('st.du.idle'));
  const barLabel = (b: (typeof gantt.bars)[number]): string => (b.block.kind === 'brief' ? t('st.du.brief') : b.block.kind === 'pause' ? t('st.du.pause', { time: hoursText((b.block.end - b.block.start) / 60_000) }) : `${b.block.flightNo ?? ''} ${b.block.origin ?? ''} → ${b.block.dest ?? ''}`);
  const chart = gantt.bars.length === 0 ? null : h('div', { class: 'st-gantt', role: 'img', 'aria-label': t('st.du.chart', { day: day ? shortDate(day, loc) : '' }) },
    h('div', { class: 'st-ruler', 'aria-hidden': 'true' }, gantt.ticks.map((tk) => h('span', { style: `left:${tk.pct}%` }, tk.label)),
      gantt.nowPct === null ? null : h('span', { class: 'st-mark now', style: `left:${gantt.nowPct}%` }, t('st.du.now', { at: fm.zulu(now) })),
      gantt.limitPct === null ? null : h('span', { class: 'st-mark limit', style: `left:${gantt.limitPct}%` }, t('st.du.limit', { at: fm.zulu(periods.find((p) => isoDay(p.start) === day)!.limitAt) }))),
    h('div', { class: 'st-track' }, gantt.nowPct === null ? null : h('i', { class: 'st-vline now', style: `left:${gantt.nowPct}%` }), gantt.limitPct === null ? null : h('i', { class: 'st-vline limit', style: `left:${gantt.limitPct}%` }),
      gantt.bars.map((b) => h('span', { class: `st-block ${b.block.kind} ${b.block.status}${b.over ? ' has-over' : ''}`, style: `left:${b.left}%;width:${b.width}%`, title: barLabel(b) },
        h('span', { class: 'st-block-no' }, b.block.kind === 'flight' ? (b.block.flightNo ?? '') : b.block.kind === 'pause' ? t('st.du.pause', { time: hoursText((b.block.end - b.block.start) / 60_000) }) : t('st.du.brief')),
        b.block.kind === 'flight' ? h('span', { class: 'st-block-route' }, `${b.block.origin ?? ''} → ${b.block.dest ?? ''}`) : null,
        b.over ? h('i', { class: 'st-over', style: `left:${((b.over.left - b.left) / (b.width || 1)) * 100}%;width:${(b.over.width / (b.width || 1)) * 100}%` }) : null))),
    h('div', { class: 'st-legend' }, (['done', 'flying', 'planned', 'over'] as const).map((k) => h('span', { class: 'ln-legend-item' }, h('i', { class: `st-lg ${k}`, 'aria-hidden': 'true' }), t(`st.du.l.${k}` as Key)))));
  const dayStrip = days.length > 1 ? h('div', { class: 'segments st-days', role: 'group', 'aria-label': t('st.du.week') }, days.map((x) =>
    h('button', { type: 'button', class: 'seg', 'aria-pressed': String(x === day), onclick: () => { chartOf = { id: m.id, day: x }; redraw(); } }, shortDate(x, loc)))) : null;

  const al = d.alert;
  const alertBox = al ? h('div', { class: 'st-alert', role: 'status' }, icon('triangle-alert', 18),
    h('div', { class: 'col tight' }, h('span', { class: 'strong' }, al.detail.rule === 'streak' ? t('st.al.streak', { no: al.flightNo }) : t('st.al.title', { no: al.flightNo, n: Math.round(al.overBy) })), h('span', { class: 'muted small' }, t(`st.al.rule.${al.detail.rule}` as Key))),
    h('div', { class: 'row tight' }, button(t('st.al.find'), { variant: 'secondary', icon: 'user', key: t('key.enter'), onclick: () => void replacement() }))) : null;
  async function replacement(): Promise<void> {
    const price = overview ? (overview.families.find((f) => f.family === m.family)?.salaries ?? 0) / Math.max(1, overview.families.find((f) => f.family === m.family)?.headcount ?? 1) : m.salary;
    if (!confirm(t('st.al.confirm', { no: al?.flightNo ?? '', cost: fm.money(interimPrice(price, 1)) }))) return;
    await act(t('st.al.done'), () => hireInterim({ family: m.family, days: 1, ...(isPilot && m.quals[0] ? { qual: m.quals[0] } : {}), base: m.base }), async () => { redraw(); });
  }

  const plan = plannedHours(d.week, now);
  const bars = dayBars(d.last7d, plan, RULES.dutyMaxMin / 60);
  const rests = restDays(d.last7d);
  const week = h('div', { class: 'st-week' },
    h('div', { class: 'ln-econ-head' }, h('h3', { class: 'ln-sub-title' }, t('st.7.title')), h('span', { class: 'dim small' }, tp('st.7.rest', rests))),
    h('div', { class: 'st-days7', role: 'list' }, bars.map((b) => {
      const label = b.kind === 'rest' ? t('st.7.rest') : b.planned > 0 ? t('st.7.planned', { h: fm.num(b.hours, 1), p: fm.num(b.planned) }) : `${fm.num(b.hours, 1)} h`;
      return h('div', { class: `st-d7 ${b.kind} ${b.tone}`, role: 'listitem', 'aria-label': t('st.7.day', { day: shortDate(b.day, loc), what: label }) },
        h('span', { class: 'st-d7-bar', 'aria-hidden': 'true' }, b.planned > 0 ? h('i', { class: 'plan', style: `height:${b.plannedHeight * 100}%` }) : null, b.kind === 'duty' ? h('i', { class: 'done', style: `height:${b.height * 100}%` }) : null),
        h('span', { class: 'st-d7-val' }, label), h('span', { class: 'dim small' }, shortDate(b.day, loc)));
    })));
  const meters = h('div', { class: 'st-meters' }, limitMeters(d.duty, service7dMin(d.last7d)).map((x) =>
    h('div', { class: 'st-meter-row' }, h('div', { class: 'ln-meter-head' }, h('span', { class: 'muted' }, t(`st.lim.${x.key}` as Key)), h('span', { class: x.tone === 'ok' ? 'strong' : 'strong st-warn' }, t('st.lim.of', { used: fm.hours(x.usedMin / 60), limit: fm.hours(x.limitMin / 60) }))),
      meterBar(x.fraction, x.tone, t('st.lim.of', { used: fm.hours(x.usedMin / 60), limit: fm.hours(x.limitMin / 60) })))));

  const dutyPanel = panel({ title: t('st.du.title'), action: dayStrip, id: 'st-duty', class: 'st-panel' }, dutyHead, chart, alertBox, h('div', { class: 'st-lower' }, week, meters));

  // ------------------------------------------------------------ qualifications and contract
  const medical = medicalState(d.duty.medicalDays);
  const offers = isPilot ? trainingOffers(d.quals, me.fleet.reduce<{ icao: string; name: string; category: NonNullable<ReturnType<typeof types.get>>['category'] }[]>((acc, a) => {
    const ty = types.get(a.icao);
    return ty && !acc.some((x) => x.icao === a.icao) ? [...acc, { icao: ty.icao, name: ty.name, category: ty.category }] : acc;
  }, [])) : [];
  const train = (o: { type: string; name: string; days: number; cost: number }): void => {
    if (!confirm(t('st.q.trainConfirm', { name: m.name, type: o.name, days: o.days, cost: fm.money(o.cost) }))) return;
    void act(t('st.trained', { name: m.name }), () => trainMember(m.id, o.type), async () => { await ctx.refresh(); });
  };
  const qualRow = (icon_: 'circle-check' | 'circle-dashed' | 'clock', title: string, sub: string, tone = ''): HTMLElement =>
    h('li', { class: `st-qual ${tone}` }, icon(icon_, 16), h('div', { class: 'col tight' }, h('span', { class: 'strong' }, title), h('span', { class: 'muted small' }, sub)));
  const quals = panel({ title: t('st.q.title'), id: 'st-quals', class: 'st-panel' },
    h('ul', { class: 'plain st-quals' },
      d.quals.map((q) => qualRow(q.inTraining ? 'clock' : 'circle-check', q.name || typeName(q.type), q.inTraining ? t('st.q.inTraining') : q.validUntil ? t('st.q.held', { date: fm.date(q.validUntil) }) : t('st.q.heldNoDate'))),
      offers.map((o) => h('li', { class: 'st-qual' }, icon('circle-dashed', 16), h('div', { class: 'col tight' }, h('span', { class: 'strong' }, o.name), h('span', { class: 'muted small' }, t('st.q.train', { days: o.days, cost: fm.money(o.cost) }))),
        button(t('st.q.trainBtn'), { variant: 'ghost', label: t('st.q.trainBtnFor', { type: o.name }), onclick: () => train(o) }))),
      isPilot ? h('li', { class: `st-qual ${medical.tone}` }, icon(medical.tone === 'ok' ? 'circle-check' : 'clock', 16), h('div', { class: 'col tight' }, h('span', { class: 'strong' }, t('st.q.medical')),
        h('span', { class: medical.tone === 'ok' ? 'muted small' : 'st-warn small' }, medical.days < 0 ? t('st.q.medicalLapsed', { n: -medical.days }) : tp('st.q.medicalIn', medical.days)))) : null));

  const line = (label: string, value: string): HTMLElement => h('div', { class: 'ln-fact' }, h('span', { class: 'muted' }, label), h('span', { class: 'ln-fact-value' }, value));
  const otherBases = me.hubs.filter((b) => b !== m.base);
  const transfer = h('div', { class: 'st-transfer', hidden: true }, h('label', { class: 'dim small', for: 'st-transfer-to' }, t('st.c.transferTo')),
    h('select', { id: 'st-transfer-to', class: 'st-select' }, otherBases.map((b) => h('option', { value: b }, b))),
    button(t('st.c.confirm'), { variant: 'secondary', onclick: () => { const to = (document.getElementById('st-transfer-to') as HTMLSelectElement).value; void act(t('st.c.transferred', { name: m.name, base: to }), () => transferMember(m.id, to), async () => { redraw(); }); } }));
  const rest = (): void => {
    if (!confirm(t('st.c.restConfirm', { name: m.name }))) return;
    void act(t('st.c.rested', { name: m.name }), () => restMember(m.id), async () => { redraw(); });
  };
  const contract = panel({ title: t('st.c.title'), id: 'st-contract', class: 'st-panel' },
    h('div', { class: 'col tight st-facts-list' },
      line(t('st.c.base'), `${base}`),
      line(t('st.c.contract'), t('st.c.contractVal', { kind: t(`st.contract.${d.contract.kind}` as Key), n: d.contract.noticeDays })),
      line(t('st.c.salary'), t('st.d.hirePay', { amount: fm.money(d.contract.salary) })),
      line(t('st.c.firing'), fm.money(d.contract.firingCost)),
      line(t('st.c.nextLeave'), d.nextLeave ? t('st.c.nextLeaveVal', { from: shortDate(d.nextLeave.from, loc), to: shortDate(d.nextLeave.to, loc) }) : t('st.c.none'))),
    h('div', { class: 'row' }, isPilot ? button(t('st.c.rest'), { variant: 'secondary', icon: 'clock', onclick: rest }) : null,
      otherBases.length > 0 ? button(t('st.c.transfer'), { variant: 'secondary', onclick: (e: MouseEvent) => { transfer.hidden = !transfer.hidden; if (!transfer.hidden) (e.currentTarget as HTMLElement).blur(); } }) : null), transfer);

  const view = h('div', { class: 'st-screen st-sheet' }, h('div', { class: 'st-main' }, header, dutyPanel), h('div', { class: 'st-side-host' }, quals, contract));

  // ← → step through the members of the overview; null at the ends
  const list = overview ? membersOf(overview) : [];
  const step = (dir: 1 | -1): void => { const to = stepMember(list, m.id, dir); if (to) go(hashFor('staff', to.id)); };
  const hints = [{ key: t('key.esc'), label: t('st.hint.staff') }, ...(list.length > 1 ? [{ key: '← →', label: t('st.hint.member') }] : []), ...(al ? [{ key: t('key.enter'), label: t('st.hint.replace') }] : [])];
  return { title: m.name, scene: 'login', tab: 'hubs', view, back, hints, keys: { left: () => step(-1), right: () => step(1) } };
}
