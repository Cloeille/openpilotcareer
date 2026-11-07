import { act } from '../actions.ts';
import { fetchQualityPreview, fetchService, setMealQuality, setPolicy, type HaulClass, type MealQuality, type QualityPreview, type ServiceItem, type ServiceView } from '../api-service.ts';
import { fetchStaff } from '../api-staff.ts';
import { button, icon, panel, signLocation, stat } from '../components.ts';
import { stepOf } from '../facilities-view.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import type { Key } from '../messages.ts';
import type { Ctx, Screen } from '../screen.ts';
import { cabinRows, candidateOf, cellFacts, cellOf, comfortOf, defaultHaul, effectsOf, GROUPS, HAULS, MEAL_QUALITIES, nextMode, operated } from '../service-view.ts';
import { kitchenTrail, outOf5, priceLine, qualityName, serviceOff, signed } from '../service-ui.ts';
import { h, notify } from '../ui.ts';

/** What the screen remembers across its own redraws (an action, a language change): the column and the row the cursor is on, the meal level looked at. A new visit starts from the data again. */
let col: HaulClass | null = null;
let looked: MealQuality | null = null;

const redraw = async (): Promise<void> => { window.dispatchEvent(new Event('opc:redraw')); };

/** `#service`: what is free or paid on board by haul class, the quality of the meals and the cabin crew they need. */
export async function service(ctx: Ctx): Promise<Screen> {
  const { snap, go } = ctx;
  const { me } = snap;
  const back = '#hubs';
  const [view, people] = await Promise.all([fetchService(), fetchStaff().catch(() => null)]);
  if (!view) return { title: t('sv.title'), scene: 'bridge', tab: 'hubs', back, hints: [{ key: t('key.esc'), label: t('st.hint.company') }], view: serviceOff() };

  const fm = fmt();
  kitchenTrail.fromService = false;
  if (col === null || !HAULS.includes(col)) col = defaultHaul(view.hauls);
  if (looked === view.mealQuality) looked = null;
  const hub = me.hubs[0] ?? null;
  const kitchenHash = hub ? `#kitchen/${hub}` : null;
  const toKitchen = (): void => { if (kitchenHash) { kitchenTrail.fromService = true; go(kitchenHash); } };

  // ------------------------------------------------------------ header
  const statusText = view.lines === 0 ? t('sv.status.none') : `${tp('sv.status.lines', view.lines)} · ${tp('sv.status.flights', view.flightsPerDay)}`;
  const trend = view.satisfactionTrend;
  const header = h('div', { class: 'ln-header sv-header' },
    h('div', { class: 'title-block' },
      h('div', { class: 'row tight' }, hub ? signLocation(hub) : null, h('span', { class: 'sv-crumb' }, t('sv.crumb'))),
      h('div', { class: 'status-line sv-status' }, h('span', { class: `dot${view.lines === 0 ? ' warn' : ''}` }), h('span', null, statusText)),
      h('h1', { class: 'title sv-title' }, t('sv.title')),
      h('p', { class: 'sv-sub' }, t('sv.sub'))),
    h('div', { class: 'sv-stats' },
      stat(t('sv.stat.sat'), outOf5(view.satisfaction), trend === null ? null : h('span', { class: trend < 0 ? 'sv-neg' : trend === 0 ? 'dim' : '' }, t('sv.stat.trend', { n: signed(trend, 1) }))),
      stat(t('sv.stat.sales'), fm.money(view.salesPerDay), h('span', { class: 'dim' }, t('sv.stat.perDay'))),
      stat(t('sv.stat.cost'), fm.money(view.costPerDay), h('span', { class: 'dim' }, t('sv.stat.perDay')))));

  // ------------------------------------------------------------ the matrix
  const haulName = (c: HaulClass): string => t(`sv.haul.${c}` as Key);
  const markColumn = (): void => {
    document.querySelectorAll<HTMLElement>('.sv-table [data-haul]').forEach((el) => {
      const on = el.dataset.haul === col;
      el.classList.toggle('on', on);
      if (el.matches('button')) el.setAttribute('aria-pressed', String(on));
    });
  };
  const pickColumn = (c: HaulClass): void => { col = c; markColumn(); };

  const cellText = (item: ServiceItem, haul: HaulClass): { state: string; detail: string | null; mode: string } => {
    const cell = cellOf(view.hauls, haul, item);
    if (!cell) return { state: t('sv.mode.none'), detail: null, mode: 'none' };
    const f = cellFacts(item, cell, view.mealQuality);
    const parts = [
      f.price === null ? null : f.perFlight ? t('sv.cell.perFlight', { price: fm.money(f.price) }) : fm.money(f.price),
      f.quality ? qualityName(f.quality).toLowerCase() : null,
      f.mode === 'unavailable' ? t('sv.cell.noEquip') : null,
    ].filter((x): x is string => x !== null);
    return { state: t(`sv.mode.${f.mode}` as Key), detail: parts.length === 0 ? null : `· ${parts.join(' · ')}`, mode: f.mode };
  };

  const cycle = (item: ServiceItem, haul: HaulClass): void => {
    const cell = cellOf(view.hauls, haul, item);
    const next = cell ? nextMode(cell.mode) : null;
    const names = { item: t(`sv.item.${item}` as Key), haul: t(`sv.haul.on.${haul}` as Key) };
    if (next === null) { notify(t('sv.unavailable', names), 'error'); return; }
    void act(t('sv.saved', { ...names, mode: t(`sv.mode.${next}` as Key).toLowerCase() }), () => setPolicy({ haul, item, mode: next }), redraw);
  };

  const head = (v: ServiceView['hauls'][number]): HTMLElement => {
    const c = comfortOf(v.satisfaction);
    const word = t(`sv.comfort.${c.level}` as Key);
    const sub = operated(v) ? `${t(`sv.haul.sub.${v.haul}` as Key)}${v.aircraft.length > 0 ? ` · ${v.aircraft.join(', ')}` : ''}` : `${t(`sv.haul.sub.${v.haul}` as Key)} · ${t('sv.haul.notOperated')}`;
    return h('th', { scope: 'col', class: `sv-th${operated(v) ? '' : ' idle'}`, 'data-haul': v.haul },
      h('button', { type: 'button', class: 'sv-head', 'data-haul': v.haul, 'aria-pressed': String(v.haul === col), onclick: () => pickColumn(v.haul) },
        h('span', { class: 'sv-head-name' }, haulName(v.haul)),
        h('span', { class: 'sv-head-sub', title: sub }, sub),
        h('span', { class: 'sv-comfort' },
          h('span', { class: 'sv-comfort-row' }, h('span', { class: 'sv-comfort-label' }, t('sv.comfort')), h('span', { class: 'sv-comfort-level' }, word)),
          h('span', { class: 'sv-segments', role: 'img', 'aria-label': t('sv.comfort.alt', { level: word, n: c.steps }) },
            [1, 2, 3, 4, 5].map((n) => h('i', { class: n <= c.steps ? 'on' : '' }))))));
  };

  const itemRow = (item: ServiceItem): HTMLElement => {
    const label = t(`sv.item.${item}` as Key);
    const texts = HAULS.map((c) => ({ c, ...cellText(item, c) }));
    const row = h('tr', {
      class: 'sv-row', id: `sv-row-${item}`, 'data-row': '', tabindex: 0,
      'aria-label': t('sv.row.label', { item: label, cells: texts.map((x) => `${haulName(x.c)} ${x.state}${x.detail ? ` ${x.detail.replace(/^· /, '')}` : ''}`).join(', ') }),
      onclick: (e: MouseEvent) => { const td = (e.target as Element).closest<HTMLElement>('td[data-haul]'); const c = (td?.dataset.haul as HaulClass | undefined) ?? col!; pickColumn(c); cycle(item, c); },
    }, h('th', { scope: 'row', class: 'sv-label' }, label),
      texts.map((x) => h('td', { class: `sv-cell${operated(view.hauls.find((v) => v.haul === x.c)!) ? '' : ' idle'}${x.c === col ? ' on' : ''}`, 'data-haul': x.c },
        h('span', { class: `sv-state ${x.mode}` }, x.state), x.detail ? h('span', { class: 'sv-detail' }, x.detail) : null)));
    return row;
  };

  const rows = GROUPS.flatMap((g) => [
    h('tr', { class: 'sv-group' }, h('th', { scope: 'rowgroup', colspan: 4 }, t(`sv.group.${g.id}` as Key))),
    ...g.items.filter((i) => view.hauls.some((v) => v.cells[i] !== undefined)).map(itemRow),
  ]);
  const matrix = h('table', { class: 'sv-table' },
    h('caption', { class: 'sr' }, t('sv.offer.title')),
    h('thead', null, h('tr', null, h('td', { class: 'sv-corner' }), view.hauls.map(head))),
    h('tbody', null, rows));
  const offer = panel({ title: t('sv.offer.title'), id: 'sv-offer', class: 'sv-main' }, h('div', { class: 'sv-scroll' }, matrix));

  // ------------------------------------------------------------ meal quality and its trade-off
  const tradeHost = h('div', { class: 'sv-trade', 'aria-live': 'polite' });
  let tradeSeq = 0;
  const paintTrade = async (q: MealQuality): Promise<void> => {
    const seq = ++tradeSeq;
    if (q === view.mealQuality) { tradeHost.replaceChildren(h('p', { class: 'dim small' }, t('sv.trade.same'))); return; }
    const preview: QualityPreview | null = await fetchQualityPreview(q).catch(() => null);
    if (seq !== tradeSeq) return;
    const effect = (e: ReturnType<typeof effectsOf>[number]): HTMLElement => h('div', { class: 'line' }, h('span', { class: 'line-label' }, t(`sv.trade.${e.label}` as Key)),
      h('span', { class: `sv-effect ${e.tone}` }, e.value.kind === 'move' ? t('sv.trade.move', { from: fm.num(e.value.from), to: fm.num(e.value.to) }) : e.value.unit === 'sat' ? signed(e.value.n, 1) : tp('sv.trade.points', Math.abs(e.value.n), { n: signed(e.value.n) })));
    tradeHost.replaceChildren(
      h('h3', { class: 'sv-trade-title' }, t('sv.trade.title', { quality: qualityName(q).toLowerCase() })),
      ...(preview ? effectsOf(preview).map(effect) : []),
      h('div', { class: 'row sv-apply' }, button(t('sv.trade.apply'), { variant: 'secondary', icon: 'chef-hat', onclick: () => void act(t('sv.meals.saved', { quality: qualityName(q).toLowerCase() }), () => setMealQuality(q), async () => { looked = null; await redraw(); }) })));
  };
  const shownQuality = looked ?? candidateOf(view.tiers, view.mealQuality) ?? view.mealQuality;
  const tierCard = (q: MealQuality): HTMLElement | null => {
    const x = view.tiers.find((y) => y.quality === q);
    if (!x) return null;
    const now = q === view.mealQuality;
    return h('button', { type: 'button', class: `sv-tier${q === shownQuality ? ' sel' : ''}`, 'aria-pressed': String(q === shownQuality),
      onclick: () => { looked = q; document.querySelectorAll<HTMLElement>('.sv-tier').forEach((el) => { const on = el.dataset.q === q; el.classList.toggle('sel', on); el.setAttribute('aria-pressed', String(on)); }); void paintTrade(q); }, 'data-q': q },
      h('span', { class: 'sv-tier-name' }, qualityName(q), now ? h('span', { class: 'sv-now', title: t('sv.meals.current') }, icon('check', 13), h('span', { class: 'sr' }, t('sv.meals.current'))) : null),
      h('span', { class: 'sv-tier-cost' }, priceLine(x.price)),
      h('span', { class: 'sv-tier-fact' }, icon('smile', 12), outOf5(x.satisfaction)),
      h('span', { class: 'sv-tier-fact' }, icon('percent', 12), t('sv.meals.margin', { pct: fm.percent(x.margin) })));
  };
  const mealsPanel = panel({ title: t('sv.meals.title'), id: 'sv-meals', class: 'sv-side',
    action: kitchenHash ? h('button', { type: 'button', class: 'link-btn sv-link', onclick: toKitchen }, t('sv.meals.kitchen'), h('kbd', { class: 'keycap' }, 'K')) : null },
    h('div', { class: 'sv-tiers' }, MEAL_QUALITIES.map(tierCard)),
    tradeHost);
  void paintTrade(shownQuality);

  // ------------------------------------------------------------ cabin crew
  const cabin = people?.families.find((f) => f.family === 'cabin') ?? null;
  const types = cabinRows(me.fleet);
  const term = (label: string, value: string, warn = false): HTMLElement => h('div', { class: 'line' }, h('span', { class: 'line-label' }, label), h('span', { class: `line-value strong${warn ? ' sv-neg' : ''}` }, value));
  const cabinPanel = panel({ title: t('sv.cabin.title'), id: 'sv-cabin', class: 'sv-side' },
    types.length === 0 ? h('p', { class: 'dim small' }, t('sv.cabin.none')) : types.map((x) => term(t('sv.cabin.perFlight', { type: x.name }), fm.num(x.crew))),
    cabin ? term(t('sv.cabin.employed'), t('sv.cabin.of', { n: fm.num(cabin.headcount), need: fm.num(cabin.need) }), cabin.headcount < cabin.need) : null,
    h('p', { class: 'dim small' }, t('sv.cabin.rule')));

  const viewEl = h('div', { class: 'sv-screen' }, header, h('div', { class: 'sv-body' }, offer, h('div', { class: 'sv-col' }, mealsPanel, cabinPanel)));
  return {
    title: t('sv.title'), scene: 'bridge', tab: 'hubs', view: viewEl, back, wide: false,
    hints: [{ key: t('key.esc'), label: t('st.hint.company') }, { key: '← →', label: t('sv.hint.level') }, { key: '↑ ↓', label: t('sv.hint.item') }, { key: t('key.enter'), label: t('sv.hint.toggle') }, ...(kitchenHash ? [{ key: 'K', label: t('sv.hint.kitchen') }] : [])],
    keys: {
      left: () => pickColumn(stepOf(HAULS, col, -1) ?? col!),
      right: () => pickColumn(stepOf(HAULS, col, 1) ?? col!),
      ...(kitchenHash ? { k: toKitchen } : {}),
    },
  };
}
