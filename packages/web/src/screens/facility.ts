import { act } from '../actions.ts';
import type { FacilityContractKind, FacilityDetail } from '@opc/shared';
import { buyFacility, fetchFacility, leaseFacility, terminateFacility, upgradeFacility, type Preview } from '../api-facilities.ts';
import { button, icon, panel, signLocation, titleBlock } from '../components.ts';
import { facilitiesOff, kindLabel } from '../facilities-ui.ts';
import { creditLoans, effectOf, firstLevel, MAINTENANCE_DISCOUNT_PCT, leaseMonthsLeft, levelState, opensAfterMonths, staffLine, stepLevel, type LevelState } from '../facilities-view.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import { messageFor } from '../messages.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h } from '../ui.ts';

/** `#facility/<id>`: rent or buy one building, pick the level it starts at, see the staff it needs and what signing costs. A building she holds shows her contract and the upgrade instead. */
export async function facilityScreen(ctx: Ctx): Promise<Screen> {
  const id = Number(ctx.arg);
  const fm = fmt();
  const out = (view: HTMLElement, back = '#hubs'): Screen => ({ title: t('hub.title'), scene: 'facility', tab: 'hubs', view, back, hints: [{ key: t('key.esc'), label: t('fc.hint.hubs') }] });
  if (!Number.isInteger(id) || id <= 0) return out(h('div', { class: 'panel fc-off' }, h('div', { class: 'panel-body' }, h('p', { class: 'muted' }, t('fc.fa.notFound')))));
  const first = await fetchFacility(id).catch((): null => null);
  if (!first) return out(facilitiesOff());

  const f0 = first.facility;
  const back = `#hub/${f0.hub}`;
  const held = f0.owner === 'player';
  const states = (d: FacilityDetail): Map<number, LevelState> => new Map(d.levels.map((l) => [l.level, levelState(l, d.facility, ctx.snap.at)]));
  const s0 = states(first);
  const state = { mode: (f0.contract?.kind ?? 'lease') as FacilityContractKind, level: held ? Math.min(f0.maxLevel, f0.level + 1) : firstLevel(first.levels, s0), credit: false, months: 0 };
  const creditTerm = (d: FacilityDetail): number => { const loans = d.offer ? creditLoans(d.offer.purchase) : []; return loans.find((l) => l.months === state.months)?.months ?? loans[Math.floor(loans.length / 2)]?.months ?? 0; };
  let d = first;

  const host = h('div', { class: 'fc-fa' });
  const preview = (): Preview => ({ mode: state.mode, level: Math.min(state.level, 2), credit: state.mode === 'purchase' && state.credit ? { downPct: 100 - (d.offer?.purchase.creditPct ?? 80), months: creditTerm(d) } : null });
  const reload = async (): Promise<void> => {
    const next = await fetchFacility(id, preview()).catch((): null => null);
    if (next) { d = next; paint(); }
  };
  const set = (patch: Partial<typeof state>): void => { Object.assign(state, patch); paint(); void reload(); };

  const taken = d.facility.owner === 'ai' || d.facility.owner === 'airport';
  const sign = async (): Promise<void> => {
    const o = d.offer, due = d.due;
    if (!o || !due) return;
    if (due.balanceAfter < 0) return;
    const ask = state.mode === 'lease'
      ? t('fc.confirm.lease', { name: d.facility.name, rent: fm.money(o.lease.monthly), deposit: fm.money(o.lease.deposit), balance: fm.money(due.balanceAfter) })
      : t('fc.confirm.buy', { name: d.facility.name, price: fm.money(o.purchase.price), balance: fm.money(due.balanceAfter) });
    if (!confirm(ask)) return;
    const body = { level: Math.min(state.level, 2), ...(preview().credit ? { financing: preview().credit! } : {}) };
    const ok = await act(t(state.mode === 'lease' ? 'fc.done.lease' : 'fc.done.buy', { name: d.facility.name }), () => (state.mode === 'lease' ? leaseFacility : buyFacility)(id, body), ctx.refresh);
    if (ok) ctx.go(back);
  };
  const upgrade = async (to: number): Promise<void> => {
    const l = d.levels.find((x) => x.level === to);
    if (!l || !confirm(t('fc.ct.upgradeAsk', { n: to, cost: fm.money(l.cost) }))) return;
    if (await act(t('fc.done.upgrade', { name: d.facility.name }), () => upgradeFacility(id, to), ctx.refresh)) { d = (await fetchFacility(id)) ?? d; paint(); }
  };
  const terminate = async (): Promise<void> => {
    const c = d.facility.contract;
    if (!c || !confirm(c.kind === 'lease' ? t('fc.ct.terminateAskLease') : t('fc.ct.terminateAskBuy', { price: fm.money(d.offer?.purchase.resale ?? c.price) }))) return;
    if (await act(t('fc.done.terminate', { name: d.facility.name }), () => terminateFacility(id), ctx.refresh)) ctx.go(back);
  };

  const radio = (on: boolean): HTMLElement => h('span', { class: `fc-radio${on ? ' on' : ''}`, 'aria-hidden': 'true' });
  const row = (label: string, value: string): HTMLElement => h('div', { class: 'line' }, h('span', { class: 'line-label' }, label), h('span', { class: 'line-value' }, value));

  function choice(): HTMLElement {
    const o = d.offer!;
    const l = o.lease, p = o.purchase;
    const card = (hold: FacilityContractKind, ...kids: (HTMLElement | null)[]): HTMLElement => h('button', { type: 'button', class: `fc-card${state.mode === hold ? ' on' : ''}`, role: 'radio', 'aria-checked': String(state.mode === hold), onclick: () => set({ mode: hold }) }, ...kids);
    const loans = creditLoans(p);
    const term = creditTerm(d);
    const loan = loans.find((x) => x.months === term);
    return panel({ title: t('fc.ch.title'), action: t('fc.ch.action'), id: 'fc-ch', class: 'fc-choice' },
      h('div', { class: 'fc-cards', role: 'radiogroup', 'aria-label': t('fc.ch.title') },
        card('lease', h('div', { class: 'row' }, radio(state.mode === 'lease'), h('span', { class: 'strong' }, t('fc.opt.lease'))),
          h('div', { class: 'fc-price' }, t('fc.opt.perMonth', { amount: fm.money(l.monthly) })), h('div', { class: 'dim small' }, t('fc.ch.leaseTotal', { amount: fm.money(l.totalOverTerm), n: l.months })),
          h('div', { class: 'col tight fc-terms' }, row(t('fc.ch.duration'), t('fc.ch.durationLease', { n: l.months })), row(t('fc.ch.deposit'), fm.money(l.deposit)), row(t('fc.ch.notice'), t('fc.ch.noticeVal', { n: l.noticeMonths })), row(t('fc.ch.upkeep'), t('fc.ch.included')))),
        card('purchase', h('div', { class: 'row' }, radio(state.mode === 'purchase'), h('span', { class: 'strong' }, t('fc.opt.buy'))),
          h('div', { class: 'fc-price' }, fm.money(p.price)), h('div', { class: 'dim small' }, t('fc.ch.buyNote', { n: p.rentMonths })),
          h('div', { class: 'col tight fc-terms' }, row(t('fc.ch.duration'), t('fc.ch.durationBuy')), row(t('fc.ch.financing'), t('fc.ch.financingVal', { pct: p.creditPct })), row(t('fc.ch.resale'), t('fc.ch.resaleVal', { pct: p.resalePct })), row(t('fc.ch.upkeep'), t('fc.ch.upkeepVal', { amount: fm.money(p.upkeep) }))))),
      state.mode === 'purchase' && loans.length > 0 ? h('label', { class: 'fc-credit' },
        h('input', { type: 'checkbox', checked: state.credit, onchange: (e: Event) => set({ credit: (e.target as HTMLInputElement).checked, months: term }) }),
        h('span', null, t('fc.ch.credit', { pct: p.creditPct })),
        state.credit && loan ? h('span', { class: 'dim small' }, t('fc.ch.creditLine', { monthly: fm.money(loan.monthly), n: loan.months })) : null,
        state.credit ? h('select', { 'aria-label': t('fc.ch.creditMonths'), onchange: (e: Event) => set({ months: Number((e.target as HTMLSelectElement).value) }) }, loans.map((x) => h('option', { value: String(x.months), selected: x.months === term }, t('fc.ch.creditMonthsVal', { n: x.months })))) : null) : null);
  }

  function staffPanel(): HTMLElement | null {
    const line = staffLine(d, state.level);
    if (!line) return null;
    return panel({ title: t('fc.st.title'), action: t('fc.st.action', { level: state.level }), id: 'fc-st', class: 'fc-staff' },
      h('div', { class: 'fc-staff-row' }, icon('wrench', 18),
        h('div', { class: 'col tight' }, h('span', { class: 'strong' }, t('fc.r.technicians')), h('span', { class: 'dim small' }, t('fc.st.line', { need: line.need, have: line.have }) + ' · ' + tp('fc.st.candidates', line.candidates))),
        line.missing > 0 ? h('span', { class: 'fc-missing' }, t('fc.st.missing', { n: line.missing })) : h('span', { class: 'dim' }, t('fc.st.complete')),
        button(t('fc.st.recruit'), { variant: 'ghost', onclick: () => ctx.go('#staff/hire') })),
      d.due && d.due.staffMonthly > 0 ? h('p', { class: 'dim small fc-note' }, icon('info', 14), t('fc.st.note', { amount: fm.money(d.due.staffMonthly) })) : null);
  }

  function levelsPanel(): HTMLElement {
    const st = states(d);
    const fx = d.facility.effect;
    const eff = effectOf(d.facility);
    return panel({ title: t('fc.lv.title'), action: t('fc.lv.action'), id: 'fc-lv', class: 'fc-levels' },
      h('div', { class: 'fc-lvs', role: 'radiogroup', 'aria-label': t('fc.lv.group') }, d.levels.map((l) => {
        const s = st.get(l.level)!;
        const on = state.level === l.level;
        const named = fx === 'hangar';
        return h('button', { type: 'button', class: `fc-lv${on ? ' on' : ''}${s === 'locked' ? ' locked' : ''}`, role: 'radio', 'aria-checked': String(on), 'aria-disabled': s === 'pickable' ? null : 'true', onclick: () => { if (s === 'pickable') set({ level: l.level }); } },
          h('div', { class: 'row' }, radio(on), h('span', { class: 'strong' }, t('fc.lv.n', { n: l.level })), s === 'locked' ? icon('lock', 14) : null, s === 'done' && l.level === d.facility.level ? h('span', { class: 'dim small' }, t('fc.lv.current')) : null),
          named ? h('div', { class: 'fc-lv-name' }, t(`fc.lv.maintenance.${l.level}` as 'fc.lv.maintenance.1')) : null,
          l.opensAfterDays !== null ? h('div', { class: 'dim small' }, t('fc.lv.locked', { n: opensAfterMonths(l.opensAfterDays) })) : null,
          named ? h('ul', { class: 'plain fc-checks' }, (['a', 'b', 'c'] as const).flatMap((k) => { const key = messageFor(`fc.lv.maintenance.${l.level}.${k}`); return key ? [h('li', null, icon('check', 14), t(key, { pct: MAINTENANCE_DISCOUNT_PCT }))] : []; })) : h('p', { class: 'dim small' }, t(eff.key, { ...eff.vars, icao: d.facility.hub })),
          h('div', { class: 'fc-lv-stats' },
            l.technicians > 0 ? row(t('fc.lv.staff'), `${l.technicians}`) : l.desks > 0 ? row(t('fc.lv.desks'), `${l.desks}`) : null,
            row(t('fc.lv.works'), l.worksDays === 0 ? t('fc.lv.worksNone') : tp('fc.lv.worksVal', Math.round(l.worksDays / 7))),
            row(t('fc.lv.cost'), l.cost === 0 ? t('fc.lv.costNone') : fm.money(l.cost))));
      })));
  }

  function summary(): HTMLElement {
    const due = d.due;
    const lvl = d.levels.find((x) => x.level === state.level);
    const works = lvl?.cost ?? 0;
    const short = due ? Math.max(0, -due.balanceAfter) : 0;
    const lease = state.mode === 'lease';
    const label = lease ? (state.level > 1 ? t('fc.cf.leaseGo', { n: state.level }) : t('fc.cf.leaseAt', { n: 1 })) : (state.level > 1 ? t('fc.cf.buyGo', { n: state.level }) : t('fc.cf.buyAt', { n: 1 }));
    return panel({ title: t('fc.cf.today'), id: 'fc-sum', class: 'fc-sum', headless: true },
      h('div', { class: 'fc-sum-cols' },
        h('div', { class: 'col tight' }, h('span', { class: 'dim small' }, t('fc.cf.today')), h('span', { class: 'fc-big' }, due ? fm.money(due.today) : '…'), h('span', { class: 'dim small' }, lease ? t('fc.cf.todayLease', { deposit: fm.money(d.offer!.lease.deposit), works: fm.money(works) }) : t('fc.cf.todayBuy', { down: fm.money(Math.max(0, (due?.today ?? 0) - works)), works: fm.money(works) }))),
        h('div', { class: 'col tight' }, h('span', { class: 'dim small' }, t('fc.cf.monthly')), h('span', { class: 'fc-big' }, due ? fm.money(due.monthly + due.staffMonthly) : '…'), h('span', { class: 'dim small' }, due ? t(lease ? 'fc.cf.monthlyLease' : 'fc.cf.monthlyHeld', lease ? { rent: fm.money(due.monthly), salaries: fm.money(due.staffMonthly) } : { contract: fm.money(due.monthly), salaries: fm.money(due.staffMonthly) }) : '')),
        h('div', { class: 'col tight end' }, h('span', { class: 'dim small' }, t('fc.cf.after')), h('span', { class: `fc-big${short > 0 ? ' bad' : ''}` }, due ? fm.money(due.balanceAfter) : '…'), short > 0 ? h('span', { class: 'fc-short' }, t('fc.cf.short', { amount: fm.money(short) })) : null)),
      h('div', { class: 'row fc-sum-actions' },
        button(label, { variant: 'primary', key: t('key.enter'), disabled: !due || short > 0, onclick: () => void sign() }),
        state.level > 1 ? button(lease ? t('fc.cf.leaseAt', { n: 1 }) : t('fc.cf.buyAt', { n: 1 }), { variant: 'secondary', onclick: () => set({ level: 1 }) }) : null));
  }

  function contract(): HTMLElement {
    const c = d.facility.contract!;
    const left = c.months !== null && c.kind === 'lease' ? leaseMonthsLeft(c.startedAt, c.months, ctx.snap.at) : null;
    const st = states(d);
    const nextLv = d.levels.find((l) => st.get(l.level) === 'pickable');
    return panel({ title: t('fc.ct.title'), action: t('fc.ct.action', { date: fm.date(c.startedAt) }), id: 'fc-ct', class: 'fc-contract' },
      h('div', { class: 'col tight' },
        row(t('fc.ct.kind'), t(c.kind === 'lease' ? 'fc.opt.lease' : 'fc.opt.buy')),
        row(t('fc.ct.monthly'), fm.money(d.facility.monthly)),
        left !== null ? row(t('fc.ct.left'), left > 0 ? tp('fc.ct.leftVal', left) : t('fc.ct.leftDone')) : null,
        c.kind === 'lease' ? row(t('fc.ct.notice'), t('fc.ch.noticeVal', { n: c.noticeMonths })) : null,
        d.facility.works ? h('p', { class: 'muted' }, t('fc.ct.works', { n: d.facility.works.toLevel, date: fm.date(d.facility.works.until) })) : null),
      h('div', { class: 'row wrap' },
        nextLv ? button(t('fc.ct.upgrade', { n: nextLv.level }), { variant: 'primary', key: t('key.enter'), onclick: () => void upgrade(nextLv.level) }) : null,
        nextLv ? h('span', { class: 'dim small' }, t('fc.ct.upgradeCost', { cost: fm.money(nextLv.cost), weeks: Math.round(nextLv.worksDays / 7) })) : null,
        button(t('fc.ct.terminate'), { variant: 'danger', onclick: () => void terminate() })));
  }

  function paint(): void {
    const f = d.facility;
    const takenNow = f.owner === 'ai' || f.owner === 'airport';
    const lead = takenNow ? h('div', { class: 'panel fc-off' }, h('div', { class: 'panel-body' }, h('p', { class: 'muted' }, f.owner === 'airport' ? t('fc.fa.airport') : f.ownerName ? t('fc.fa.taken', { name: f.ownerName }) : t('fc.fa.takenAnon')))) : null;
    const offered = !takenNow && d.offer;
    const mine = f.owner === 'player' && f.contract;
    const sub = [kindLabel(f.kind), `${fm.num(f.areaM2)} m²`].join(' · ');
    host.replaceChildren(
      h('div', { class: 'fc-fa-head' }, titleBlock(h('span', { class: 'row' }, signLocation(f.hub), h('span', null, t('fc.fa.main'))), f.name, h('p', { class: 'dim' }, sub))),
      ...(lead ? [lead] : []),
      ...(offered || mine ? [h('div', { class: 'fc-fa-cols' },
        h('div', { class: 'fc-fa-left' }, offered && !mine ? choice() : null, mine ? contract() : null, staffPanel()),
        h('div', { class: 'fc-fa-right' }, d.levels.length > 1 || mine ? levelsPanel() : null, offered && !mine ? summary() : null))] : []));
  }
  paint();
  if (!held && d.offer) void reload();

  const flip = (): void => { if (d.offer && !taken && !held) set({ mode: state.mode === 'lease' ? 'purchase' : 'lease' }); };
  const stepL = (dir: 1 | -1) => (): void => { const n = stepLevel(d.levels, states(d), state.level, dir); if (n !== state.level) set({ level: n }); };
  return {
    title: t('hub.title'), scene: 'facility', tab: 'hubs', view: host, back,
    hints: [{ key: t('key.esc'), label: t('fc.hint.toPlan') }, ...(held ? [] : [{ key: 'T', label: t('fc.hint.mode') }]), { key: '← →', label: t('fc.hint.level') }, { key: t('key.enter'), label: t('fc.hint.sign') }],
    keys: { t: flip, left: stepL(-1), right: stepL(1) },
  };
}
