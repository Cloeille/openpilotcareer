import { act } from '../actions.ts';
import { fetchQualityPreview, fetchService, setMealQuality, setPolicy, type HaulClass, type HaulView, type MealQuality, type ServiceItem, type ServicePreview } from '../api-service.ts';
import { button, icon, panel, signLocation, stat, unknownValue } from '../components.ts';
import { stepOf } from '../facilities-view.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import type { Key } from '../messages.ts';
import type { Ctx, Screen } from '../screen.ts';
import { candidateOf, cellFacts, cellOf, comfortOf, defaultHaul, effectsOf, GROUPS, HAULS, MEAL_QUALITIES, nextMode, operated } from '../service-view.ts';
import { kitchenTrail, outOf5, priceLine, qualityName, serviceOff, signed } from '../service-ui.ts';
import { h, notify } from '../ui.ts';

/** What the screen remembers across its own redraws (an action, a language change): the column and the row the cursor is on, the meal level looked at. A new visit starts from the data again. */
let col: HaulClass | null = null;
let cursor: ServiceItem | null = null;
let looked: MealQuality | null = null;

const redraw = async (): Promise<void> => { window.dispatchEvent(new Event('opc:redraw')); };

/** `#service`: what is free or paid on board by haul class, the quality of the meals and the cabin crew they need. A change applies from the next UTC day, as the server says. */
export async function service(ctx: Ctx): Promise<Screen> {
  const { snap, go } = ctx;
  const { me } = snap;
  const back = '#hubs';
  const view = await fetchService();
  if (!view) return { title: t('sv.title'), scene: 'bridge', tab: 'hubs', back, hints: [{ key: t('key.esc'), label: t('st.hint.company') }], view: serviceOff() };

  const fm = fmt();
  kitchenTrail.fromService = false;
  if (col === null || !HAULS.includes(col)) col = defaultHaul(view.hauls);
  const current = view.quality.current;
  if (looked === current) looked = null;
  const rowItems = GROUPS.flatMap((g) => g.items.filter((i) => view.hauls.some((v) => v.cells.some((c) => c.item === i))));
  if (cursor === null || !rowItems.includes(cursor)) cursor = rowItems[0] ?? null;
  const hub = view.kitchens[0]?.hub ?? me.hubs[0] ?? null;
  const kitchenHash = hub ? `#kitchen/${hub}` : null;
  const toKitchen = (): void => { if (kitchenHash) { kitchenTrail.fromService = true; go(kitchenHash); } };

  // ------------------------------------------------------------ header
  const { lines, flightsPerDay } = view.network;
  const statusText = lines === 0 ? t('sv.status.none') : `${tp('sv.status.lines', lines)} · ${tp('sv.status.flights', flightsPerDay)}`;
  const sat = view.satisfaction;
  const satCaption = sat.value === null ? h('span', { class: 'dim' }, t('sv.stat.noCabin')) : sat.estimated ? h('span', { class: 'dim' }, t('sv.stat.estimated')) : sat.trend === null ? null : h('span', { class: sat.trend < 0 ? 'sv-neg' : sat.trend === 0 ? 'dim' : '' }, t('sv.stat.trend', { n: signed(sat.trend, 1) }));
  const header = h('div', { class: 'ln-header sv-header' },
    h('div', { class: 'title-block' },
      h('div', { class: 'row tight' }, hub ? signLocation(hub) : null, h('span', { class: 'sv-crumb' }, t('sv.crumb'))),
      h('div', { class: 'status-line sv-status' }, h('span', { class: `dot${lines === 0 ? ' warn' : ''}` }), h('span', null, statusText)),
      h('h1', { class: 'title sv-title' }, t('sv.title')),
      h('p', { class: 'sv-sub' }, t('sv.sub'))),
    h('div', { class: 'sv-stats' },
      stat(t('sv.stat.sat'), sat.value === null ? unknownValue() : outOf5(sat.value), satCaption),
      stat(t('sv.stat.sales'), fm.money(view.perDay.sales), h('span', { class: 'dim' }, t('sv.stat.perDay'))),
      stat(t('sv.stat.cost'), fm.money(view.perDay.cost), h('span', { class: 'dim' }, t('sv.stat.cost.sub')))));

  // ------------------------------------------------------------ the matrix
  const haulName = (c: HaulClass): string => t(`sv.haul.${c}` as Key);
  const markColumn = (): void => {
    document.querySelectorAll<HTMLElement>('.sv-table .sv-head[data-haul], .sv-table .sv-cell-in[data-haul]').forEach((el) => {
      const on = el.dataset.haul === col;
      el.classList.toggle('on', on);
      if (el.matches('button')) el.setAttribute('aria-pressed', String(on));
    });
  };
  const pickColumn = (c: HaulClass): void => { col = c; markColumn(); };
  /** The cursor row is what Enter acts on when no row has the focus (it carries `data-primary`), and it keeps the outlined cell of the mockup. */
  const moveCursor = (item: ServiceItem): void => {
    cursor = item;
    document.querySelectorAll<HTMLElement>('.sv-row').forEach((r) => { const on = r.dataset.item === item; r.classList.toggle('cur', on); if (on) r.setAttribute('data-primary', ''); else r.removeAttribute('data-primary'); });
  };

  const modeName = (m: string): string => t(`sv.mode.${m}` as Key);
  const cellText = (item: ServiceItem, haul: HaulClass): { state: string; detail: string | null; mode: string } => {
    const cell = cellOf(view.hauls, haul, item);
    if (!cell) return { state: modeName('none'), detail: null, mode: 'none' };
    const f = cellFacts(item, haul, cell, current);
    const parts = [
      f.price === null ? null : f.perFlight ? t('sv.cell.perFlight', { price: fm.money(f.price) }) : fm.money(f.price),
      f.quality ? qualityName(f.quality).toLowerCase() : null,
      f.catalogue ? t(`sv.cell.catalogue.${f.catalogue}` as Key) : null,
      f.state === 'unavailable' ? t('sv.cell.noEquip') : null,
      f.next ? t('sv.cell.next', { mode: modeName(f.next).toLowerCase() }) : null,
    ].filter((x): x is string => x !== null);
    return { state: modeName(f.state), detail: parts.length === 0 ? null : `· ${parts.join(' · ')}`, mode: f.state };
  };

  const cycle = (item: ServiceItem, haul: HaulClass): void => {
    const cell = cellOf(view.hauls, haul, item);
    const next = cell ? nextMode(cell) : null;
    const names = { item: t(`sv.item.${item}` as Key), haul: t(`sv.haul.on.${haul}` as Key) };
    if (next === null) { notify(t(cell?.unavailable ? 'sv.unavailable' : 'sv.fixed', names), 'error'); return; }
    void act(t('sv.saved', { ...names, mode: modeName(next).toLowerCase() }), () => setPolicy({ haul, item, mode: next }), redraw);
  };

  const head = (v: HaulView): HTMLElement => {
    const c = comfortOf(v.satisfaction);
    const word = t(`sv.comfort.${c.level}` as Key);
    const sub = `${t(`sv.haul.sub.${v.haul}` as Key)} · ${operated(v) ? v.operated.map((x) => x.name).join(', ') : t('sv.haul.notOperated')}`;
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
    return h('tr', {
      class: `sv-row${item === cursor ? ' cur' : ''}`, id: `sv-row-${item}`, 'data-row': '', tabindex: 0, 'data-item': item, 'data-primary': item === cursor ? '' : null, onfocus: () => moveCursor(item),
      'aria-label': t('sv.row.label', { item: label, cells: texts.map((x) => `${haulName(x.c)} ${x.state}${x.detail ? ` ${x.detail.replace(/^· /, '')}` : ''}`).join(', ') }),
      onclick: (e: MouseEvent) => { const td = (e.target as Element).closest<HTMLElement>('td[data-haul]'); const c = (td?.dataset.haul as HaulClass | undefined) ?? col!; pickColumn(c); cycle(item, c); },
    }, h('th', { scope: 'row', class: 'sv-label' }, label),
      texts.map((x) => h('td', { class: `sv-cell${operated(view.hauls.find((v) => v.haul === x.c)!) ? '' : ' idle'}`, 'data-haul': x.c },
        h('div', { class: `sv-cell-in${x.c === col ? ' on' : ''}`, 'data-haul': x.c }, h('span', { class: `sv-state ${x.mode}` }, x.state), x.detail ? h('span', { class: 'sv-detail' }, x.detail) : null))));
  };

  const rows = GROUPS.flatMap((g) => [
    h('tr', { class: 'sv-group' }, h('th', { scope: 'rowgroup', colspan: 4 }, t(`sv.group.${g.id}` as Key))),
    ...g.items.filter((i) => rowItems.includes(i)).map(itemRow),
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
    if (q === current) { tradeHost.replaceChildren(h('p', { class: 'dim small' }, t(view.quality.next ? 'sv.trade.pending' : 'sv.trade.same', view.quality.next ? { quality: qualityName(view.quality.next).toLowerCase() } : undefined))); return; }
    const preview: ServicePreview | null = await fetchQualityPreview(q).catch(() => null);
    if (seq !== tradeSeq) return;
    const effect = (e: ReturnType<typeof effectsOf>[number]): HTMLElement => h('div', { class: 'line' }, h('span', { class: 'line-label' }, t(`sv.trade.${e.label}` as Key)),
      h('span', { class: `sv-effect ${e.tone}` }, e.value.kind === 'move' ? t('sv.trade.move', { from: fm.num(e.value.from), to: fm.num(e.value.to) }) : e.value.unit === 'sat' ? signed(e.value.n, 1) : tp('sv.trade.points', Math.abs(e.value.n), { n: signed(e.value.n) })));
    tradeHost.replaceChildren(
      h('div', { class: 'sv-trade-head' },
        h('h3', { class: 'sv-trade-title' }, t('sv.trade.title', { quality: qualityName(q).toLowerCase() })),
        button(t('sv.trade.apply'), { variant: 'secondary', icon: 'chef-hat', onclick: () => void act(t('sv.meals.saved', { quality: qualityName(q).toLowerCase() }), () => setMealQuality(q), async () => { looked = null; await redraw(); }) })),
      ...(preview ? effectsOf(preview).map(effect) : []));
  };
  const shownQuality = looked ?? candidateOf(view.qualities, current) ?? current;
  const tierCard = (q: MealQuality): HTMLElement | null => {
    const x = view.qualities.find((y) => y.quality === q);
    if (!x) return null;
    const now = q === current;
    const tomorrow = q === view.quality.next;
    return h('button', { type: 'button', class: `sv-tier${now ? ' sel' : ''}${q === shownQuality ? ' look' : ''}`, 'aria-pressed': String(q === shownQuality), 'data-q': q,
      onclick: () => { looked = q; document.querySelectorAll<HTMLElement>('.sv-tier').forEach((el) => { const on = el.dataset.q === q; el.classList.toggle('look', on); el.setAttribute('aria-pressed', String(on)); }); void paintTrade(q); } },
      h('span', { class: 'sv-tier-name' }, qualityName(q),
        now ? h('span', { class: 'sv-now', title: t('sv.meals.current') }, icon('check', 13), h('span', { class: 'sr' }, t('sv.meals.current'))) : null,
        tomorrow ? h('span', { class: 'sv-soon' }, t('sv.meals.tomorrow')) : null),
      h('span', { class: 'sv-tier-cost' }, priceLine(x.price)),
      h('span', { class: 'sv-tier-fact' }, icon('smile', 12), outOf5(x.rating)),
      h('span', { class: 'sv-tier-fact' }, icon('percent', 12), t('sv.meals.margin', { pct: fm.percent(x.margin) })));
  };
  const mealsPanel = panel({ title: t('sv.meals.title'), id: 'sv-meals', class: 'sv-side',
    action: kitchenHash ? h('button', { type: 'button', class: 'link-btn sv-link', onclick: toKitchen }, t('sv.meals.kitchen')) : null },
    h('div', { class: 'sv-tiers' }, MEAL_QUALITIES.map(tierCard)),
    tradeHost);
  void paintTrade(shownQuality);

  // ------------------------------------------------------------ cabin crew
  const term = (label: string, value: string): HTMLElement => h('div', { class: 'line' }, h('span', { class: 'line-label' }, label), h('span', { class: 'line-value strong' }, value));
  const cabinPanel = panel({ title: t('sv.cabin.title'), id: 'sv-cabin', class: 'sv-side' },
    view.crew.length === 0 ? h('p', { class: 'dim small' }, t('sv.cabin.none')) : view.crew.map((x) => term(t('sv.cabin.perFlight', { type: x.name }), t('sv.cabin.minimum', { n: fm.num(x.cabin), min: fm.num(x.legalMinimum) }))),
    term(t('sv.cabin.bonus'), t('sv.cabin.bonusValue', { pct: fm.percent(view.crewBonusPct / 100) })));

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
