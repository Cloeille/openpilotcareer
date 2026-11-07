import { act } from '../actions.ts';
import type { Building, FacilityContractKind, FacilityDetail } from '@opc/shared';
import { buyFacility, fetchFacility, fetchHubPlan, leaseFacility } from '../api-facilities.ts';
import { airportInfo } from '../airports.ts';
import { buildAirportChart, drawAirportChart, LAYOUTS, type ChartBuilding, type ChartScene } from '../airport-chart.ts';
import { button, dataTable, icon, signLocation, titleBlock } from '../components.ts';
import { facilitiesOff, kindLabel, ownerSwatch, planFocus, statusText } from '../facilities-ui.ts';
import { aiNames, effectOf, filtersOf, keepSlot, keyOrder, KIND_ICON, matchesFilter, stepOf } from '../facilities-view.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h } from '../ui.ts';

/** What the plan remembers across its own redraws (a purchase, a language change); a different airport starts again. */
const memo: { icao: string | null; slot: string | null; filter: string; view: 'plan' | 'list'; mode: FacilityContractKind } = { icao: null, slot: null, filter: 'all', view: 'plan', mode: 'lease' };

const CHART = { w: 1100, h: 560 };

/** `#hub/<icao>`: the tilted plan of one hub with its buildings and the panel of the one selected, or the list when the airport has no drawn plan. */
export async function hubPlan(ctx: Ctx): Promise<Screen> {
  const icao = (ctx.arg ?? '').toUpperCase();
  const back = '#hubs';
  const off = (view: HTMLElement): Screen => ({ title: t('hub.title'), scene: 'hubs', tab: 'hubs', view, back, hints: [{ key: t('key.esc'), label: t('fc.hint.hubs') }] });
  const plan = await fetchHubPlan(icao);
  if (!plan) return off(facilitiesOff());
  const fm = fmt();
  const info = await airportInfo(icao);
  const company = ctx.snap.me.company.name;
  const main = ctx.snap.me.hubs[0] === icao;

  if (memo.icao !== icao) Object.assign(memo, { icao, slot: null, filter: 'all', view: 'plan', mode: 'lease' });
  const layout = plan.layout ? LAYOUTS[plan.layout] ?? null : null;
  const hasStands = plan.parking.spots > 0;
  const chips = filtersOf(plan.buildings, hasStands);
  if (!chips.includes(memo.filter)) memo.filter = 'all';
  if (!layout) memo.view = 'list';

  const chartOf = (selected: string | null): ChartScene | null => layout && buildAirportChart({
    layout, size: CHART, selected, filter: memo.filter, stands: hasStands ? { spots: plan.parking.spots, used: plan.parking.used } : null,
    buildings: plan.buildings.map((b): ChartBuilding => ({ slot: b.slot, name: b.name, kind: b.kind, owner: b.owner, ...(b.ownerName ? { ownerName: b.ownerName } : {}) })),
    text: { yours: t('fc.pl.yours'), available: t('fc.pl.available') },
  });
  const order = keyOrder(plan.buildings, chartOf(null)?.order ?? []);
  memo.slot = keepSlot(plan.buildings, order, planFocus.slot ?? memo.slot);
  planFocus.slot = null;
  const bySlot = (slot: string | null): Building | null => plan.buildings.find((b) => b.slot === slot) ?? null;

  // ------------------------------------------------------------ the pieces that repaint on their own
  const details = new Map<number, FacilityDetail | null>();
  const chartHost = h('div', { class: 'fc-chart' });
  const sideHost = h('aside', { class: 'fc-sel panel', 'aria-label': t('fc.pl.panel'), 'aria-live': 'polite' });
  const chipHost = h('div', { class: 'fc-chips', role: 'group', 'aria-label': t('fc.pl.filters') });

  const ownerText = (b: Building): string => (b.owner === 'ai' && b.ownerName ? b.ownerName : t(({ player: 'fc.pl.yours', available: 'fc.pl.available', ai: 'fc.pl.ai', airport: 'fc.pl.airport' } as const)[b.owner]));
  const select = (slot: string): void => { memo.slot = slot; paint(); };
  const paintChart = (): void => {
    if (memo.view === 'plan' && layout) {
      const scene = chartOf(memo.slot)!;
      chartHost.replaceChildren(drawAirportChart(scene, t('fc.pl.chart', { airport: icao, n: plan.buildings.length, yours: plan.summary.yours }), { onSelect: select }));
      return;
    }
    const rows = plan.buildings.filter((b) => matchesFilter(b.kind, memo.filter));
    chartHost.replaceChildren(h('div', { class: 'fc-list' },
      layout ? null : h('p', { class: 'dim small' }, t('fc.pl.noLayout')),
      rows.length === 0 ? h('p', { class: 'dim' }, t('fc.pl.empty')) : dataTable(t('fc.pl.list', { airport: icao }),
        [{ label: t('fc.pl.col.name') }, { label: t('fc.pl.col.kind') }, { label: t('fc.pl.col.owner') }, { label: t('fc.pl.col.cost'), align: 'end' }],
        rows.map((b) => ({
          cells: [h('span', { class: 'row tight' }, icon(KIND_ICON[b.kind], 16), b.name), kindLabel(b.kind), ownerText(b),
            b.monthly > 0 ? fm.money(b.monthly) : b.owner === 'available' && b.rent > 0 ? t('fc.hub.from', { amount: fm.money(b.rent) }) : '—'],
          onFocus: () => { if (memo.slot !== b.slot) { memo.slot = b.slot; paintSide(); } }, selected: b.slot === memo.slot, label: `${b.name}, ${ownerText(b)}`,
        })))));
  };

  const sign = async (b: Building, d: FacilityDetail, hold: FacilityContractKind): Promise<void> => {
    const o = d.offer!;
    const balance = d.due?.balanceAfter ?? ctx.snap.me.company.balance;
    const ask = hold === 'lease'
      ? t('fc.confirm.lease', { name: b.name, rent: fm.money(o.lease.monthly), deposit: fm.money(o.lease.deposit), balance: fm.money(balance) })
      : t('fc.confirm.buy', { name: b.name, price: fm.money(o.purchase.price), balance: fm.money(balance) });
    if (!confirm(ask)) return;
    const done = await act(t(hold === 'lease' ? 'fc.done.lease' : 'fc.done.buy', { name: b.name }), () => (hold === 'lease' ? leaseFacility : buyFacility)(b.facilityId, { level: 1 }), ctx.refresh);
    if (done) details.delete(b.facilityId);
  };

  function paintSide(): void {
    const b = bySlot(memo.slot);
    if (!b) { sideHost.replaceChildren(h('div', { class: 'panel-body' }, h('p', { class: 'dim' }, t('fc.sel.none')))); return; }
    const d = details.get(b.facilityId);
    if (d === undefined && (b.owner === 'available' || b.owner === 'player')) {
      void fetchFacility(b.facilityId).then((x) => { details.set(b.facilityId, x); if (memo.slot === b.slot) paintSide(); }).catch(() => { details.set(b.facilityId, null); });
    }
    const effect = effectOf(b);
    const owned = d?.facility.contract?.kind === 'purchase';
    const status = b.owner === 'player' ? (d ? statusText(owned ? 'owned' : 'leased') : t('fc.sel.yours')) : statusText(b.owner === 'available' ? 'available' : b.owner === 'ai' ? 'ai' : 'airport', b.ownerName);
    const offer = b.owner === 'available' ? d?.offer ?? null : null;
    const fact = (label: string, value: string): HTMLElement => h('div', { class: 'line' }, h('span', { class: 'line-label' }, label), h('span', { class: 'line-value strong' }, value));
    const optionCard = (hold: FacilityContractKind): HTMLElement => {
      const lease = hold === 'lease';
      const price = lease ? (offer?.lease.monthly ?? b.rent) : offer?.purchase.price ?? null;
      const sub = lease ? (offer ? t('fc.opt.leaseSub', { deposit: fm.money(offer.lease.deposit), months: offer.lease.months }) : '') : t('fc.opt.buySub');
      return h('button', { type: 'button', class: `fc-opt${memo.mode === hold ? ' on' : ''}`, role: 'radio', 'aria-checked': String(memo.mode === hold), onclick: () => { memo.mode = hold; paintSide(); } },
        h('span', { class: 'fc-radio', 'aria-hidden': 'true' }),
        h('span', { class: 'col tight fc-opt-text' }, h('span', { class: 'strong' }, t(lease ? 'fc.opt.lease' : 'fc.opt.buy')), h('span', { class: 'dim small' }, sub)),
        h('span', { class: 'fc-opt-price' }, price === null ? '…' : lease ? t('fc.opt.perMonth', { amount: fm.money(price) }) : fm.money(price)));
    };
    const canSign = !!offer && !!d;
    sideHost.replaceChildren(h('div', { class: 'panel-body' },
      h('div', { class: `fc-status ${b.owner}` }, ownerSwatch(b.owner), h('span', null, status)),
      h('h2', { class: 'fc-sel-name' }, b.name),
      h('p', { class: 'muted' }, t('fc.sel.kindArea', { kind: kindLabel(b.kind), area: fm.num(b.areaM2) })),
      h('div', { class: 'col tight fc-facts-list' },
        fact(t('fc.fact.area'), `${fm.num(b.areaM2)} m²`),
        b.effect === 'hangar' || b.effect === 'desks' ? fact(t('fc.fact.level'), t('fc.fact.levelVal', { level: b.level, max: d?.facility.maxLevel ?? b.level })) : null,
        b.monthly > 0 ? fact(t('fc.fact.monthly'), fm.money(b.monthly)) : null),
      b.owner === 'airport' ? null : h('div', { class: 'col tight' }, h('h3', { class: 'dim small' }, t('fc.effect')), h('p', { class: 'muted' }, t(effect.key, { ...effect.vars, icao }))),
      b.owner === 'available' ? h('div', { class: 'col tight', role: 'radiogroup', 'aria-label': t('fc.opt.group') }, optionCard('lease'), optionCard('purchase')) : null,
      h('div', { class: 'fc-sel-actions' },
        b.owner === 'available'
          ? button(t(memo.mode === 'lease' ? 'fc.act.lease' : 'fc.act.buy'), { variant: 'primary', key: t('key.enter'), disabled: !canSign, onclick: () => { if (canSign) void sign(b, d!, memo.mode); } })
          : b.owner === 'player' ? button(t('fc.act.manage'), { variant: 'primary', key: t('key.enter'), onclick: () => ctx.go(`#facility/${b.facilityId}`) }) : null,
        b.owner === 'available' ? button(t('fc.act.contract'), { variant: 'ghost', onclick: () => ctx.go(`#facility/${b.facilityId}`) }) : null)));
  }

  function paint(): void { paintChart(); paintSide(); }

  const paintChips = (): void => chipHost.replaceChildren(...chips.map((k) =>
    h('button', { type: 'button', class: 'st-chip', 'aria-pressed': String(memo.filter === k), onclick: () => { memo.filter = k; paintChips(); paintChart(); } }, kindLabel(k as Parameters<typeof kindLabel>[0]))));
  paintChips();
  paint();

  // ------------------------------------------------------------ the frame
  const ai = aiNames(plan.buildings);
  const aiText = plan.summary.ai > 0 ? tp('fc.pl.ai', plan.summary.ai, { names: ai.join(', ') || t('fc.h.ai').toLowerCase() }) : '';
  const views = h('div', { class: 'view-switcher', role: 'group', 'aria-label': t('fc.pl.views') },
    (['plan', 'list'] as const).map((v) => h('button', { type: 'button', class: 'view-opt', 'aria-pressed': String(memo.view === v), disabled: v === 'plan' && !layout, onclick: () => { memo.view = v; window.dispatchEvent(new Event('opc:redraw')); } }, t(v === 'plan' ? 'fc.pl.view3d' : 'fc.pl.viewList'))));
  const legend = h('div', { class: 'fc-legend', role: 'group', 'aria-label': t('fc.pl.legend') },
    (['player', 'available', 'ai', 'airport'] as const).map((o) => h('span', { class: 'row tight' }, ownerSwatch(o), t(({ player: 'fc.pl.yours', available: 'fc.pl.available', ai: 'fc.pl.ai', airport: 'fc.pl.airport' } as const)[o]))));
  const title = info?.name ?? icao;
  const view = h('div', { class: 'fc-plan' },
    h('div', { class: 'fc-plan-main' },
      h('div', { class: 'fc-plan-head' },
        titleBlock(h('span', { class: 'row' }, signLocation(icao), h('span', null, t(main ? 'fc.pl.main' : 'fc.pl.secondary', { company }))), title,
          h('p', { class: 'dim fc-plan-sub' }, t('fc.pl.sub', { yours: plan.summary.yours, available: plan.summary.available, ai: aiText }))),
        layout ? views : null),
      chartHost,
      h('div', { class: 'fc-plan-foot' }, legend, chipHost)),
    sideHost);

  const step = (dir: 1 | -1) => (): void => { const next = stepOf(order, memo.slot, dir); if (next) select(next); };
  const pick = bySlot(memo.slot);
  return {
    title: t('hub.title'), scene: 'hubs', tab: 'hubs', view, back,
    hints: [{ key: t('key.esc'), label: t('fc.hint.hubs') }, { key: t('key.mouse'), label: t('fc.hint.pick') }, { key: '← →', label: t('fc.hint.nextBuilding') }, ...(pick?.owner === 'available' ? [{ key: t('key.enter'), label: t('fc.hint.rent') }] : [])],
    keys: { left: step(-1), right: step(1), t: () => { memo.mode = memo.mode === 'lease' ? 'purchase' : 'lease'; paintSide(); }, v: () => { if (layout) { memo.view = memo.view === 'plan' ? 'list' : 'plan'; window.dispatchEvent(new Event('opc:redraw')); } } },
  };
}
