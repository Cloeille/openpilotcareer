import { MORALE_BASE, MORALE_PER_PAY_PCT, PAY_LEVELS } from '@opc/shared';
import { act } from '../actions.ts';
import { fetchHr, setHrPay, type HrFamily, type HrView, type PayLevel } from '../api-hr.ts';
import { button, icon, panel, signLocation, stat, titleBlock } from '../components.ts';
import { fmt } from '../format.ts';
import { LEVEL_KEY, deltaClass, isPending, moraleFraction, moraleTone, optionOf, payLabel, stepLevel } from '../hr-view.ts';
import { t } from '../i18n.ts';
import type { Ctx, Screen } from '../screen.ts';
import { famLabel, meterBar, viewSwitch } from '../staff-ui.ts';
import { h } from '../ui.ts';

/** The level being looked at survives a language change and a redraw, not a new visit (it starts from the one the server holds). */
const memo: { draft: PayLevel | null } = { draft: null };

const off = (): HTMLElement => h('div', { class: 'ln-off st-off panel' }, h('div', { class: 'panel-body' }, icon('users', 20), h('h1', { class: 'ln-off-title' }, t('hr.off.title')), h('p', { class: 'muted' }, t('hr.off.body'))));

/** `#staff/hr`: the pay level against the market and the morale it sets. One lever (C27: no compliance axis, no strike or fine), the rest policy it also reads is the staff lot's own. */
export async function staffHr(ctx: Ctx): Promise<Screen> {
  const { snap, go } = ctx;
  const fm = fmt();
  const back = '#staff';
  const hints = [{ key: t('key.esc'), label: t('hr.hint.staff') }, { key: '← →', label: t('hr.hint.level') }, { key: t('key.enter'), label: t('hr.hint.apply') }];
  const fetched = await fetchHr();
  if (!fetched) return { title: t('hr.title'), scene: 'login', tab: 'hubs', back, hints: hints.slice(0, 1), view: off() };
  const data: HrView = fetched;
  if (memo.draft === data.pay.next) memo.draft = null;

  // ------------------------------------------------------------ header
  const header = h('div', { class: 'ln-header' },
    titleBlock(h('span', { class: 'row tight' }, signLocation(snap.me.hubs[0] ?? '—'), h('span', { class: 'dim' }, t('hr.crumb'))), t('hr.title'), h('p', { class: 'muted', style: 'font-size:14px' }, t('hr.sub'))),
    viewSwitch('hr', go));
  const kpis = h('div', { class: 'ln-kpis st-kpis' },
    stat(t('hr.stat.people'), fm.num(data.people), t('hr.stat.people.sub', { n: data.leaving })),
    stat(t('hr.stat.morale'), data.morale.average === null ? '—' : fm.percent(data.morale.average / 100), t('hr.stat.morale.sub', { target: fm.num(data.morale.target) })),
    stat(t('hr.stat.payroll'), fm.money(data.payroll), t('hr.stat.payroll.sub')),
    stat(t('hr.stat.risk'), fm.num(data.rule.atRisk), t('hr.stat.risk.sub', { below: data.rule.below })));

  // ------------------------------------------------------------ the pay level
  const preview = h('div', { class: 'col', 'aria-live': 'polite' });
  const seg = h('div', { class: 'segments st-policy', role: 'group', 'aria-label': t('hr.pay.title') });
  const draft = (): PayLevel => memo.draft ?? data.pay.next;
  const choose = (level: PayLevel): void => { memo.draft = level === data.pay.next ? null : level; paint(); };
  const apply = (level: PayLevel): void => {
    void act(t('hr.applied', { date: fm.date(data.applyFrom) }), () => setHrPay(level), async () => { memo.draft = null; await ctx.refresh(); });
  };
  const line = (label: string, value: string, tone = ''): HTMLElement => h('div', { class: 'ln-fact' }, h('span', { class: 'muted' }, label), h('span', { class: `ln-fact-value ${tone}` }, value));
  function paint(): void {
    const level = draft(), o = optionOf(data, level), same = level === data.pay.next;
    seg.replaceChildren(...PAY_LEVELS.map((l) => h('button', { type: 'button', class: 'seg', 'aria-pressed': String(l === level), 'aria-label': `${payLabel(l)} · ${t(LEVEL_KEY[l])}`, onclick: () => choose(l) }, payLabel(l))));
    preview.replaceChildren(
      h('p', { class: 'strong' }, `${payLabel(level)} · ${t(LEVEL_KEY[level])}`),
      h('div', { class: 'col tight st-preview' },
        line(t('hr.pre.payroll'), `${fm.money(o.payroll)}${o.payrollDelta === 0 ? '' : ` (${fm.signedMoney(o.payrollDelta)})`}`, deltaClass(o.payrollDelta)),
        line(t('hr.pre.target'), fm.percent(o.target / 100)),
        line(t('hr.pre.leaves'), t(o.leaves ? 'hr.pre.leaves.yes' : 'hr.pre.leaves.no'), o.leaves ? 'st-warn' : 'ln-ok')),
      same ? h('p', { class: 'dim small' }, isPending(data) ? t('hr.pay.pending', { date: fm.date(data.applyFrom), level: payLabel(data.pay.next) }) : t('hr.pay.same')) : h('p', { class: 'dim small' }, t('hr.pay.from', { date: fm.date(data.applyFrom) })),
      button(t('hr.apply'), { variant: 'primary', key: t('key.enter'), icon: 'circle-check', disabled: same, onclick: () => apply(level) }));
  }
  paint();
  const payPanel = panel({ title: t('hr.pay.title'), action: t('hr.pay.sub'), id: 'hr-pay', class: 'st-panel' },
    h('p', { class: 'dim small' }, t('hr.pay.current', { level: payLabel(data.pay.current), name: t(LEVEL_KEY[data.pay.current]) })), seg, preview);

  // ------------------------------------------------------------ morale by family
  const familyRow = (f: HrFamily): HTMLElement => {
    const label = t('hr.fam.row', { family: famLabel(f.family), morale: fm.percent(f.morale / 100) });
    return h('li', { class: 'hr-family', 'aria-label': label },
      h('span', { class: 'strong' }, famLabel(f.family)), meterBar(moraleFraction(f.morale), moraleTone(f.morale, data.rule.below), label), h('span', { class: 'end mono' }, fm.percent(f.morale / 100)));
  };
  const families = panel({ title: t('hr.fam.title'), action: t('hr.fam.sub', { target: fm.num(data.morale.target) }), id: 'hr-families', class: 'st-panel' },
    data.morale.families.length === 0 ? h('p', { class: 'dim st-empty' }, t('hr.fam.empty')) : h('ul', { class: 'plain hr-families' }, data.morale.families.map(familyRow)));

  // ------------------------------------------------------------ how it works, and the rest policy it reads
  const rule = panel({ title: t('hr.rule.title'), id: 'hr-rule', class: 'ag-side-panel' },
    h('ul', { class: 'plain hr-rules' },
      h('li', { class: 'dim small' }, t('hr.rule.drift', { drift: fm.num(Math.round(data.rule.drift * 100)) })),
      h('li', { class: 'dim small' }, t('hr.rule.target', { base: MORALE_BASE, per: fm.num(MORALE_PER_PAY_PCT, 1) })),
      h('li', { class: 'dim small' }, t('hr.rule.quit', { below: data.rule.below, chance: fm.num(Math.round(data.rule.chance * 100)) })),
      h('li', { class: 'dim small' }, t('hr.rule.none'))));
  const rest = panel({ title: t('hr.rest.title'), id: 'hr-rest', class: 'ag-side-panel' },
    h('p', { class: 'dim small' }, t('hr.rest.body', { policy: t(`st.p.${data.rest}`) })),
    button(t('hr.rest.open'), { variant: 'secondary', icon: 'users', onclick: () => go('#staff/leave') }));

  const view = h('div', { class: 'ag-screen' }, h('div', { class: 'ag-main' }, header, kpis, payPanel, families), h('div', { class: 'ag-side' }, rule, rest));
  const step = (dir: 1 | -1): void => choose(stepLevel(draft(), dir));
  return { title: t('hr.title'), scene: 'login', tab: 'hubs', view, back, hints, keys: { left: () => step(-1), right: () => step(1) } };
}
