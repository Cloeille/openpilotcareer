import { SEATS_PER_INSTRUCTOR } from '@opc/shared';
import { act } from '../actions.ts';
import { fetchRetrain, retrainMember, type RetrainView } from '../api-training.ts';
import { button, panel, signLocation, stat, titleBlock } from '../components.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import { hashFor } from '../keys.ts';
import type { Ctx, Screen } from '../screen.ts';
import { roleFull, toneIcon } from '../staff-ui.ts';
import { RETRAIN_WHY, gapTone } from '../training-view.ts';
import { h } from '../ui.ts';

/** `#retrain/<id>`: a captain becomes an instructor (C26). One option: the mockup's other three (chief pilot, early retirement bonus, a medical refusal) have no model behind them, so the screen does not show them. */
export async function retrain(ctx: Ctx): Promise<Screen> {
  const { go } = ctx;
  const fm = fmt();
  const id = ctx.arg === null ? NaN : Number(ctx.arg);
  const training = '#staff/training';
  const gone = (): Screen => ({ title: t('rt.title'), scene: 'login', tab: 'hubs', back: training, hints: [{ key: t('key.esc'), label: t('rt.hint.training') }],
    view: h('p', { class: 'error-text', role: 'alert' }, t('st.m.notFound')) });
  if (!Number.isInteger(id)) return gone();
  const v = await fetchRetrain(id);
  if (!v) return gone();
  const back = hashFor('staff', id);
  const m = v.member;
  const hints = [{ key: t('key.esc'), label: t('rt.hint.sheet') }, ...(v.offer ? [{ key: '1', label: t('rt.hint.option') }, { key: t('key.enter'), label: t('rt.hint.confirm') }] : [])];

  const header = h('div', { class: 'ln-header' },
    titleBlock(h('span', { class: 'row tight' }, signLocation(m.base), h('span', { class: 'dim' }, t('rt.crumb', { name: m.name }))), t('rt.title', { name: m.name }),
      h('div', { class: 'col tight' },
        v.retiresAt !== null ? h('p', { class: v.inWindow ? 'ag-status' : 'muted', style: 'font-size:14px' }, v.inWindow ? h('span', { class: 'dot' }) : null, t(v.inWindow ? 'rt.retires.soon' : 'rt.retires', { date: fm.date(v.retiresAt) })) : null,
        h('p', { class: 'muted', style: 'font-size:14px' }, t('rt.sub', { role: roleFull(m.role), age: v.age === null ? '—' : v.age, types: m.quals.join(', ') || '—' })))));
  const kpis = h('div', { class: 'ln-kpis st-kpis' },
    stat(t('rt.stat.hours'), `${fm.num(m.experience)} h`, t('rt.stat.hours.sub')),
    stat(t('rt.stat.salary'), fm.money(m.salary), t('rt.stat.salary.sub')),
    v.age !== null ? stat(t('rt.stat.age'), String(v.age), v.retiresAt !== null ? t('rt.stat.age.sub', { date: fm.date(v.retiresAt) }) : undefined) : null);

  // ------------------------------------------------------------ the option
  const confirmIt = async (offer: NonNullable<RetrainView['offer']>): Promise<void> => {
    if (!confirm(t('rt.confirm', { name: m.name, salary: fm.money(offer.salary) }))) return;
    const ok = await act(t('rt.done', { name: m.name }), () => retrainMember(id), async () => { await ctx.refresh(); });
    if (ok) go(hashFor('staff', id));
  };
  const optionCard = (offer: NonNullable<RetrainView['offer']>): HTMLElement => h('article', { class: 'rt-option', 'data-row': '', tabindex: 0, 'aria-label': t('rt.opt.label', { salary: fm.money(offer.salary) }),
    onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); void confirmIt(offer); } } },
    h('span', { class: 'rt-opt-no' }, '1'),
    h('div', { class: 'col tight' }, h('h3', { class: 'rt-opt-title' }, t('rt.opt.title')), h('p', { class: 'muted small' }, t('rt.opt.sub'))),
    h('dl', { class: 'rt-facts' },
      h('div', null, h('dt', { class: 'dim small' }, t('rt.opt.salary')), h('dd', { class: 'strong' }, t('st.d.hirePay', { amount: fm.money(offer.salary) })), h('dd', { class: 'dim small' }, t('rt.opt.delta', { amount: fm.money(offer.salary - m.salary) }))),
      h('div', null, h('dt', { class: 'dim small' }, t('rt.opt.teaches')), h('dd', { class: 'strong' }, offer.types.join(', ')), h('dd', { class: 'dim small' }, tp('rt.opt.seats', offer.seats, { seats: offer.seats }))),
      h('div', null, h('dt', { class: 'dim small' }, t('rt.opt.centre')), h('dd', { class: offer.centre ? 'strong' : 'strong st-warn' }, t(offer.centre ? 'rt.opt.centre.yes' : 'rt.opt.centre.no')), h('dd', { class: 'dim small' }, t(offer.centre ? 'rt.opt.centre.yes.sub' : 'rt.opt.centre.no.sub'))),
      h('div', null, h('dt', { class: 'dim small' }, t('rt.opt.retires')), h('dd', { class: 'strong' }, offer.retiresAt === null ? '—' : fm.date(offer.retiresAt)), h('dd', { class: 'dim small' }, t('rt.opt.retires.sub')))));
  const options = panel({ title: t('rt.opts.title'), id: 'rt-options', class: 'st-panel' },
    v.offer ? optionCard(v.offer) : h('p', { class: 'dim st-empty' }, v.why ? t(RETRAIN_WHY[v.why]) : ''),
    v.offer ? h('div', { class: 'ag-foot' }, h('p', { class: 'dim small' }, t('rt.opts.note', { seats: SEATS_PER_INSTRUCTOR })),
      button(t('rt.confirm.btn'), { variant: 'primary', key: t('key.enter'), icon: 'check-check', onclick: () => void confirmIt(v.offer!) })) : null);

  // ------------------------------------------------------------ the gap on the line
  const gap = panel({ title: t('rt.gap.title'), id: 'rt-gap', class: 'ag-side-panel' },
    v.gap.length === 0 ? h('p', { class: 'dim small' }, t('rt.gap.none'))
      : h('ul', { class: 'plain rt-gaps' }, v.gap.map((g) => {
        const tone = gapTone(g);
        return h('li', { class: `rt-gap ${tone}` }, toneIcon(tone), h('span', { class: 'col tight' }, h('span', { class: 'strong' }, t('rt.gap.row', { type: g.type, base: m.base })),
          h('span', { class: tone === 'ok' ? 'dim small' : 'st-warn small' }, t('rt.gap.left', { have: Math.max(0, g.have - 1), need: g.need }))));
      })),
    h('p', { class: 'dim small' }, t('rt.gap.note')));

  const view = h('div', { class: 'ag-screen' }, h('div', { class: 'ag-main' }, header, kpis, options), h('div', { class: 'ag-side' }, gap));
  return { title: t('rt.title', { name: m.name }), scene: 'login', tab: 'hubs', view, back, hints, keys: v.offer ? { '1': () => { document.querySelector<HTMLElement>('.rt-option')?.focus(); } } : {} };
}
