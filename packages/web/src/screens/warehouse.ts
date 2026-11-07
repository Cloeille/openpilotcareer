import { fetchWarehouse, setPolicy, type PartsPolicy, type TypePolicy, type WarehouseView } from '../api-parts.ts';
import { airportInfo, cityOf } from '../airports.ts';
import { button, panel, signLocation, stat, titleBlock } from '../components.ts';
import { perform } from '../finance-ui.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import { aogTimeline, currentOption, defaultType, kitFacts, kitTarget, optionOf, partCount, policyBars, stepPolicy, stockGroups, uncovered, worstType, type AogTimeline } from '../parts-view.ts';
import { dayOf, kEuro, partsOff, whenOf } from '../parts-ui.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h } from '../ui.ts';

/** The type on show survives a redraw (a policy change, a language change), not a visit to another hub. */
const memo: { hub: string | null; type: string | null } = { hub: null, type: null };
let busy = false;
/** Length of the longest bar of the policy rows, in px: each side of the axis is 230 px wide with its figure beside the bar. */
const BAR_PX = 143;
/** What a policy change sells back of the parts no kit asks for any more (S5's `PARTS_RESALE_FACTOR`, shown in the confirmation). */
const RESALE_PCT = 80;
const POLICIES: readonly PartsPolicy[] = ['none', 'critical', 'full'];

/** `#warehouse/<hub>`: what the spare-parts shelf of a hub ties up against the ground days it saves, the breakdown waiting for a part, the policy per aircraft type and the stock itself. */
export async function warehouse(ctx: Ctx): Promise<Screen> {
  const { snap } = ctx;
  const hub = (ctx.arg ?? snap.me.hubs[0] ?? '').toUpperCase();
  const back = hub ? `#hub/${hub}` : '#hubs';
  const hints = [{ key: t('key.esc'), label: t('pt.hint.plan') }];
  const view = hub ? await fetchWarehouse(hub) : null;
  if (!view) return { title: t('pt.w.title'), scene: 'bridge', tab: 'hubs', back, hints, view: partsOff() };

  const fm = fmt();
  const now = Date.now();
  if (memo.hub !== hub) Object.assign(memo, { hub, type: null });
  if (!view.policies.some((p) => p.icao === memo.type)) memo.type = defaultType(view);
  const info = await airportInfo(hub);
  const bars = policyBars(view.policies);
  const aog = view.aog;

  // ------------------------------------------------------------ header
  const stocked = view.policies.filter((p) => p.policy !== 'none').length;
  const stockText = view.policies.length > 0 ? t('pt.w.subStock', { parts: tp('pt.w.parts', partCount(view)), types: stocked, total: view.policies.length }) : '';
  const worst = worstType(view);
  const down = uncovered(view);
  const dim = (text: string): HTMLElement => h('span', { class: 'dim' }, text);
  const identity = titleBlock(
    h('span', { class: 'row tight' }, signLocation(hub), h('span', { class: 'pt-crumb' }, t('pt.w.crumb', { city: info ? cityOf(info) : hub }))),
    t('pt.w.title'), h('p', { class: 'muted pt-sub' }, view.active ? t('pt.w.sub', { hub, stock: stockText }) : t('pt.w.inactive')));
  const share = t('pt.w.capitalShare', { n: fm.num(Math.round(view.capitalShare * 100)) });
  const stats = h('div', { class: 'pt-stats' },
    stat(t('pt.w.capital'), fm.money(view.capital), dim(view.onOrder > 0 ? `${share} · ${t('pt.w.stock.onOrder', { amount: fm.money(view.onOrder) })}` : share)),
    stat(t('pt.w.ground'), t('pt.w.groundValue', { n: fm.num(Math.round(view.expectedGroundDays)) }),
      dim(worst && view.policies.length > 1 && worst.days > 0.5 ? t('pt.w.groundSub', { n: fm.num(Math.round(worst.days)), type: worst.name }) : t('pt.w.groundSubAll'))),
    stat(t('pt.w.covered'), view.covered.of === 0 ? '–' : t('pt.w.coveredValue', { n: view.covered.count, of: view.covered.of }),
      down.length > 0 ? h('span', { class: 'pt-danger' }, t('pt.w.uncovered', { list: down.join(', ') })) : view.covered.of === 0 ? null : dim(t('pt.w.coveredAll'))));
  const header = h('div', { class: 'pt-head' }, identity, stats);

  // ------------------------------------------------------------ the case: a breakdown waiting for a part, and the kit that would have saved it
  const caseHost = h('div', { class: 'pt-case' });
  const polHost = h('ul', { class: 'plain pt-pols' });
  const order = (p: TypePolicy): void => apply(p, 'critical');
  const paintCase = (): void => {
    const target = kitTarget(view, memo.type);
    const tl = aog ? aogTimeline(aog, now) : null;
    const facts = target ? kitFacts(target) : null;
    caseHost.replaceChildren(
      h('div', { class: 'pt-case-line' },
        h('div', { class: 'pt-case-main' },
          aog && tl ? timeline(aog, tl, now) : h('div', { class: 'col tight' }, h('span', { class: 'pt-case-title' }, t('pt.w.noCase')), h('p', { class: 'dim small' }, t('pt.w.noCaseBody'))),
          target && facts ? h('p', { class: 'muted pt-trade' }, t('pt.w.trade', { type: target.name, capital: kEuro(facts.capital), days: fm.num(facts.daysAvoided, 1), saved: fm.money(facts.saved) })) : null),
        aog || (target && facts) ? h('div', { class: 'pt-verdict' },
          aog && tl ? h('div', { class: 'pt-fig' }, h('span', { class: 'dim' }, t('pt.w.lost')), h('span', { class: 'pt-fig-value bad' }, fm.money(aog.lost)),
            h('span', { class: 'dim small' }, tp('pt.w.lostDetail', Math.max(1, Math.round(tl.lostDays)), { n: fm.num(tl.lostDays, 1), value: fm.money(aog.dayValue) }))) : null,
          target && facts ? h('div', { class: 'pt-fig' }, h('span', { class: 'dim' }, t('pt.w.kitTies', { type: target.name })), h('span', { class: 'pt-fig-value' }, fm.money(facts.capital)), h('span', { class: 'dim small' }, t('pt.w.kitDays', { n: fm.num(facts.daysAvoided, 1) }))) : null,
          target ? button(t('pt.w.order'), { variant: 'primary', key: t('key.enter'), onclick: () => order(target) }) : null) : null));
  };

  /** One policy change. It always asks first: more stock orders parts and ties up money, less sells parts back at a loss. */
  function apply(p: TypePolicy, next: PartsPolicy): void {
    if (busy || next === p.policy) return;
    const label = t(`pt.w.pol.${next}`).toLowerCase();
    const to = optionOf(p, next), cur = currentOption(p);
    const vars = { type: p.name, policy: label, capital: fm.money(to.capital), now: fm.money(cur.capital), days: fm.num(Math.round(to.groundDays)), pct: RESALE_PCT };
    if (!confirm(t(to.capital >= cur.capital ? 'pt.w.pol.ask' : 'pt.w.pol.askDown', vars))) return;
    busy = true;
    void perform(() => setPolicy(hub, p.icao, next),
      (r) => t('pt.w.pol.set', { type: p.name, policy: label, capital: fm.money(r.capital) })
        + (r.ordered > 0 ? t('pt.w.pol.ordered', { amount: fm.money(r.ordered) }) : '') + (r.refund > 0 ? t('pt.w.pol.refund', { amount: fm.money(r.refund) }) : '')
        + (r.annualSaving > 0 ? t('pt.w.pol.saving', { amount: fm.money(r.annualSaving) }) : r.annualSaving < 0 ? t('pt.w.pol.cost', { amount: fm.money(-r.annualSaving) }) : ''),
      ctx.refresh).finally(() => { busy = false; });
  }

  // ------------------------------------------------------------ the policy per type
  const rows: HTMLElement[] = [];
  const select = (icao: string): void => {
    if (memo.type === icao) return;
    memo.type = icao;
    rows.forEach((r) => { const on = r.dataset.icao === icao; r.classList.toggle('sel', on); if (on) r.setAttribute('aria-current', 'true'); else r.removeAttribute('aria-current'); });
    paintCase();
  };
  view.policies.forEach((p) => {
    const cur = currentOption(p);
    const b = bars.get(p.icao)!;
    const isDown = aog?.icao === p.icao;
    const choice = h('div', { class: 'pt-choice', role: 'radiogroup', 'aria-label': t('pt.w.pol.group', { type: p.name }) },
      POLICIES.map((o) => h('button', { type: 'button', role: 'radio', class: 'pt-opt', 'aria-checked': String(p.policy === o), onclick: (e: Event) => { e.stopPropagation(); select(p.icao); apply(p, o); } }, t(`pt.w.pol.${o}`))));
    const regs = p.aircraft.map((a) => a.registration).join(', ');
    const meta = [p.aircraft.length > 1 ? `×${p.aircraft.length}` : null, regs + (isDown ? t('pt.w.pol.down') : ''), t('pt.w.pol.day', { value: fm.money(p.dayValue) })].filter(Boolean).join(' · ');
    const days = t('pt.w.groundValue', { n: fm.num(Math.round(p.expectedGroundDays)) });
    const row = h('li', {
      class: `pt-pol${isDown ? ' down' : ''}${memo.type === p.icao ? ' sel' : ''}`, 'data-row': '', 'data-icao': p.icao, tabindex: 0,
      'aria-current': memo.type === p.icao ? 'true' : null,
      'aria-label': `${p.name}, ${t(`pt.w.pol.${p.policy}`)}, ${fm.money(cur.capital)}, ${days}`,
      onfocus: () => select(p.icao), onclick: () => select(p.icao),
      onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' && e.target === row) { const target = kitTarget(view, p.icao); if (target) { e.preventDefault(); order(target); } } },
    },
      h('div', { class: 'pt-pol-type' }, h('span', { class: 'pt-pol-name' }, p.name), h('span', { class: `pt-pol-meta${isDown ? ' bad' : ''}` }, meta)),
      choice,
      h('div', { class: 'pt-trade-off' },
        h('div', { class: 'pt-side cap' }, h('span', { class: 'pt-val' }, kEuro(cur.capital)), b.capital > 0 ? h('i', { class: 'pt-bar cap', style: `width:${Math.max(3, Math.round(b.capital * BAR_PX))}px`, 'aria-hidden': 'true' }) : null),
        h('i', { class: 'pt-axis', 'aria-hidden': 'true' }),
        h('div', { class: 'pt-side gnd' }, h('i', { class: `pt-bar gnd${isDown ? ' hot' : ''}`, style: `width:${Math.max(3, Math.round(b.ground * BAR_PX))}px`, 'aria-hidden': 'true' }), h('span', { class: `pt-val${isDown ? ' bad' : ''}` }, days))));
    rows.push(row);
  });
  polHost.append(...rows);
  paintCase();

  const policyBlock = h('section', { class: 'pt-policy', 'aria-labelledby': 'pt-pol-title' },
    h('div', { class: 'pt-pol-head' },
      h('div', { class: 'col tight' }, h('h3', { id: 'pt-pol-title', class: 'pt-pol-title' }, t('pt.w.pol.title')), h('span', { class: 'dim small' }, t('pt.w.pol.hint'))),
      h('div', { class: 'pt-cols dim small' }, h('span', null, t('pt.w.pol.capital')), h('span', null, t('pt.w.pol.days')))),
    view.policies.length === 0 ? h('p', { class: 'dim pt-none' }, t('pt.w.pol.empty')) : polHost);
  const left = panel({ title: t('pt.w.case.title'), action: h('span', { class: 'pt-how', title: t('pt.w.case.howBody') }, t('pt.w.case.how')), id: 'pt-left', class: 'pt-main' }, caseHost, h('hr', { class: 'pt-rule' }), policyBlock);

  // ------------------------------------------------------------ the shelf, by class of parts (one shelf serves every type of a class)
  const right = panel({ title: t('pt.w.stock.title', { hub }), id: 'pt-right', class: 'pt-side-panel' },
    stockGroups(view).map((g) => h('section', { class: 'pt-group', 'aria-label': t(`pt.cls.${g.cls}`) },
      h('div', { class: 'pt-group-head' },
        h('span', { class: 'pt-group-name' }, g.types.length === 1 ? g.types[0]!.name : t(`pt.cls.${g.cls}`)),
        h('span', { class: `pt-group-regs${g.lines.length === 0 ? ' bad' : ''}` }, [g.types.length > 1 ? g.types.map((x) => x.name).join(' · ') : g.types.flatMap((x) => x.aircraft.map((a) => a.registration)).join(' · '), g.lines.length === 0 ? t('pt.w.stock.none') : null].filter(Boolean).join(' · ')),
        h('span', { class: 'pt-group-sum' }, fm.money(g.subtotal))),
      g.lines.length > 0 ? h('ul', { class: 'plain pt-items' }, g.lines.map((l) => h('li', { class: 'pt-item' },
        h('span', { class: 'pt-item-name' }, l.name), h('span', { class: 'dim' }, l.inTransit > 0 ? `×${l.qty} ${t('pt.w.stock.transit', { n: l.inTransit })}` : `×${l.qty}`), h('span', { class: 'pt-item-val' }, fm.money(l.value))))) : null,
      aog && !aog.fromStock && aog.eta > now && g.types.some((x) => x.icao === aog.icao)
        ? h('p', { class: 'dim small pt-express' }, t('pt.w.stock.paid', { reg: aog.registration, part: aog.partName, day: dayOf(aog.eta), amount: fm.money(aog.paid) })) : null)));

  const screen = h('div', { class: 'pt-screen' }, header, h('div', { class: 'pt-body' }, left, right));
  const move = (dir: 1 | -1) => (): void => { const p = view.policies.find((x) => x.icao === memo.type); if (p) apply(p, stepPolicy(p.policy, dir)); };
  return {
    title: t('pt.w.title'), scene: 'bridge', tab: 'hubs', view: screen, back,
    hints: [...hints, ...(view.policies.length > 0 ? [{ key: '← →', label: t('pt.hint.policy') }] : []), ...(kitTarget(view, memo.type) ? [{ key: t('key.enter'), label: t('pt.hint.kit') }] : [])],
    keys: { left: move(-1), right: move(1) },
  };
}

// ---------------------------------------------------------------- the timeline of the breakdown

/** Two tracks over a ruler of whole days: with no part the aircraft stays down until the delivery and the repair; with the part on the shelf it is back after the repair alone. */
function timeline(aog: NonNullable<WarehouseView['aog']>, tl: AogTimeline, now: number): HTMLElement {
  const fm = fmt();
  const pc = (x: number): string => `${(x * 100).toFixed(2)}%`;
  const span = (a: { from: number; to: number }): string => `left:${pc(a.from)};width:${pc(a.to - a.from)}`;
  return h('div', { class: 'pt-tl' },
    h('div', { class: 'col tight' },
      h('div', { class: 'row tight' }, h('i', { class: 'dot off', 'aria-hidden': 'true' }), h('span', { class: 'pt-case-title' }, t('pt.w.aog.title', { reg: aog.registration, type: aog.typeName, since: tp('pt.w.aog.since', tl.elapsedDays) }))),
      h('p', { class: 'muted small' }, t('pt.w.aog.detail', { failure: t(`pt.w.aog.fail.${aog.component}`), failed: whenOf(aog.failedAt), part: aog.partName, eta: whenOf(aog.eta) })),
      aog.fromStock ? h('p', { class: 'dim small' }, t('pt.w.aog.stock', { when: whenOf(aog.withPartBackAt) })) : null),
    h('div', { class: 'pt-chart', role: 'group', 'aria-label': t('pt.w.tl.alt', { reg: aog.registration }) },
      h('div', { class: 'pt-tl-row' }, h('span', { class: 'pt-tl-label' }), h('div', { class: 'pt-ruler' }, tl.days.map((d, i) => h('span', { class: 'pt-tick', style: `left:${pc(i / tl.days.length)}` }, dayOf(d))), h('i', { class: 'pt-cursor', style: `left:${pc(tl.nowPct)}`, 'aria-hidden': 'true' }))),
      h('div', { class: 'pt-tl-row' }, h('span', { class: 'pt-tl-label strong' }, t('pt.w.tl.without')),
        h('div', { class: 'pt-track' },
          h('div', { class: 'pt-seg grounded', style: span(tl.grounded) }, tp('pt.w.tl.elapsed', tl.elapsedDays)),
          tl.planned ? h('div', { class: 'pt-seg planned', style: span(tl.planned) }, tp('pt.w.tl.planned', tl.plannedDays)) : null,
          h('i', { class: 'pt-now', style: `left:${pc(tl.nowPct)}`, 'aria-hidden': 'true' }))),
      h('div', { class: 'pt-tl-row' }, h('span', { class: 'pt-tl-label muted' }, t('pt.w.tl.with')),
        h('div', { class: 'pt-track' },
          h('div', { class: 'pt-seg fixed', style: span(tl.fixed) }),
          h('div', { class: 'pt-seg online', style: `left:${pc(tl.fixed.to)};right:0` }, t('pt.w.tl.fixed', { h: tl.fixHours, when: whenOf(aog.withPartBackAt) })),
          h('i', { class: 'pt-now soft', style: `left:${pc(tl.nowPct)}`, 'aria-hidden': 'true' }))),
      h('div', { class: 'pt-tl-row' }, h('span', { class: 'pt-tl-label' }),
        h('div', { class: 'pt-marks' },
          h('span', { class: 'pt-mark now', style: `right:${pc(1 - tl.nowPct)}` }, t('pt.w.tl.now', { when: `${dayOf(now)} ${fm.zulu(now)}` })),
          aog.eta > now ? h('span', { class: 'pt-mark eta', style: `left:${pc(tl.etaPct)};right:auto` }, t('pt.w.tl.expected', { day: dayOf(aog.eta) })) : null))));
}
