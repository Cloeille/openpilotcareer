import { act } from '../actions.ts';
import { fetchKitchen, requestQuote, setKitchen, type CatererOption, type KitchenDeparture, type KitchenProvider, type KitchenView, type MealQuality, type MealTier } from '../api-service.ts';
import { airportInfo, cityOf } from '../airports.ts';
import { badge, button, icon, panel, signLocation, stat } from '../components.ts';
import { fmt } from '../format.ts';
import { locale } from '../finance-ui.ts';
import { t, tp } from '../i18n.ts';
import type { IconName } from '../icons.ts';
import type { Key } from '../messages.ts';
import type { Ctx, Screen } from '../screen.ts';
import { absentCooks, canPickCaterer, capacityCut, changeOf, headline, isLate, METRICS, missingAt, noPending, selection, stepQuality, tierTable, type Cell, type MetricId, type Pending } from '../kitchen-view.ts';
import { MEAL_QUALITIES } from '../service-view.ts';
import { kitchenOff, kitchenTrail, money2, qualityName, signed } from '../service-ui.ts';
import { hireFilter, longDay } from '../staff-ui.ts';
import { h } from '../ui.ts';

/** The levels and provider the player picked and has not applied yet. They survive the screen's own redraws and reset for another hub. */
let pending: Pending = noPending('');
/** A quote asked for in this visit, for a server whose `GET /kitchen/:hub` does not carry one. */
let quoted: { hub: string; offer: CatererOption } | null = null;

const DEP_ICON: Record<KitchenDeparture['status'], IconName> = { loaded: 'check-check', ready: 'circle-check', preparing: 'chef-hat' };

/** `#kitchen/<icao>`: the central kitchen of one base: what the day's timetable asks for, the quality levels side by side, tonight's departures and the choice of making the meals in-house or buying them. */
export async function kitchen(ctx: Ctx): Promise<Screen> {
  const { snap, go } = ctx;
  const { me } = snap;
  const icao = (ctx.arg ?? me.hubs[0] ?? '').toUpperCase();
  const fromService = kitchenTrail.fromService;
  const back = fromService ? '#service' : `#hub/${icao}`;
  const backHint = t(fromService ? 'sv.hint.open' : 'kt.hint.hub');
  const bare = (view: HTMLElement): Screen => ({ title: t('kt.title', { city: icao }), scene: 'bridge', tab: 'hubs', back, hints: [{ key: t('key.esc'), label: backHint }], view });

  if (!me.hubs.includes(icao)) return bare(h('div', { class: 'ln-off sv-off panel' }, h('div', { class: 'panel-body' }, icon('chef-hat', 20), h('h1', { class: 'ln-off-title' }, t('kt.notHub.title', { icao: icao || '—' })), h('p', { class: 'muted' }, t('kt.notHub.body')))));
  const fetched = await fetchKitchen(icao);
  if (!fetched) return bare(kitchenOff());
  if (pending.hub !== icao) pending = noPending(icao);
  let k: KitchenView = fetched.caterer === null && quoted?.hub === icao ? { ...fetched, caterer: quoted.offer } : fetched;

  const fm = fmt();
  const info = await airportInfo(icao);
  const city = info ? cityOf(info) : icao;
  const redraw = async (): Promise<void> => { window.dispatchEvent(new Event('opc:redraw')); };
  const reset = (): void => { pending = noPending(icao); };

  // ------------------------------------------------------------ header
  const head = headline(k);
  const statusText = head.kind === 'late' ? t('kt.status.late', { flight: head.departure.flightNo, dest: head.departure.dest, n: head.departure.lateMin })
    : head.kind === 'short' ? t('kt.status.short', { demand: fm.num(head.demand), capacity: fm.num(head.capacity) })
    : head.kind === 'idle' ? t('kt.status.idle') : t('kt.status.ok');
  const supplier = k.provider === 'own' ? t('kt.role.own') : k.caterer ? t('kt.role.caterer', { name: k.caterer.name }) : t('kt.role.catererAnon');
  const demand = k.demand.snacks + k.demand.hot;
  const cut = capacityCut(k);
  const absent = absentCooks(k);
  const hubChips = me.hubs.length > 1 ? h('div', { class: 'sv-chips', role: 'group', 'aria-label': t('hub.title') },
    me.hubs.map((x) => h('button', { type: 'button', class: 'st-chip mono', 'aria-pressed': String(x === icao), onclick: () => go(`#kitchen/${x}`) }, x))) : null;
  const header = h('div', { class: 'ln-header sv-header' },
    h('div', { class: 'title-block' },
      h('div', { class: 'row tight' }, signLocation(icao), h('span', { class: 'sv-crumb' }, t('kt.crumb')), hubChips),
      h('div', { class: 'status-line sv-status' }, h('span', { class: `dot${head.tone === 'warn' ? ' warn' : ''}` }), h('span', null, statusText)),
      h('h1', { class: 'title sv-title' }, t('kt.title', { city })),
      h('p', { class: 'sv-sub' }, `${supplier} · ${t('kt.role.day', { day: longDay(k.day, locale()) })}`)),
    h('div', { class: 'sv-stats' },
      stat(t('kt.stat.meals'), fm.num(demand), h('span', { class: 'dim' }, `${tp('kt.snacks', k.demand.snacks)} · ${tp('kt.hot', k.demand.hot)}`)),
      stat(t('kt.stat.capacity'), k.capacity === null ? t('kt.stat.noCap') : fm.num(k.capacity),
        k.capacity === null ? h('span', { class: 'dim' }, t('kt.stat.caterer')) : cut ? h('span', { class: 'sv-warn' }, `${t('kt.stat.now', { n: fm.num(k.capacityNow ?? 0) })} · ${tp('kt.stat.absent', absent)}`) : h('span', { class: 'dim' }, t('kt.stat.full'))),
      stat(t('kt.stat.margin'), fm.percent(k.margin), h('span', { class: 'dim' }, t('kt.stat.marginDay', { amount: fm.money(k.marginDay) })))));

  // ------------------------------------------------------------ the comparison of the quality levels
  const metricName = (id: MetricId): Key => `kt.m.${id}` as Key;
  const valueText = (id: MetricId, v: number): string => id === 'prep' ? t('kt.min', { n: fm.num(v) }) : id === 'cost' ? money2(v) : id === 'margin' ? fm.percent(v) : id === 'sat' ? t('sv.stat.of5', { n: fm.num(v, 1) }) : fm.num(v);
  const deltaText = (id: MetricId, d: number): string => id === 'prep' ? t('kt.min', { n: signed(d) }) : id === 'cost' ? `${d > 0 ? '+' : ''}${money2(d)}` : id === 'margin' ? t('kt.pts', { n: signed(Math.round(d * 100)) }) : id === 'sat' ? signed(d, 1) : signed(d);
  const problemText = (c: Cell): string | null => (c.problem === null ? null : c.problem.kind === 'recruit' ? t('kt.problem.recruit', { n: fm.num(c.problem.n) }) : t('kt.problem.demand', { n: fm.num(c.problem.n) }));

  const tierHost = h('div', { class: 'sv-tier-host' });
  const provHost = h('div', { class: 'sv-prov-host' });
  const own = (q: MealQuality): MealTier | undefined => k.tiers.find((x) => x.quality === q);

  const paint = (): void => {
    const sel = selection(k, pending);
    const change = changeOf(k, pending);
    const table = tierTable(k.tiers, k.quality, k);
    const tiers = MEAL_QUALITIES.filter((q) => own(q));
    const pick = (q: MealQuality): void => { pending = { ...pending, hub: icao, quality: q }; paint(); };
    const th = (q: MealQuality): HTMLElement => {
      const cur = q === k.quality;
      const picked = q === sel.quality && change !== null;
      return h('th', { scope: 'col', class: `kt-th${cur ? ' cur' : ''}${picked ? ' pick' : ''}` },
        h('button', { type: 'button', class: 'kt-tier', 'aria-pressed': String(q === sel.quality), onclick: () => pick(q) },
          h('span', { class: 'kt-tier-name' }, qualityName(q), cur ? h('span', { class: 'kt-current' }, icon('check', 14), t('kt.tier.current')) : picked ? h('span', { class: 'kt-current' }, t('kt.tier.picked')) : null),
          h('span', { class: 'kt-tier-desc' }, t(`kt.q.${q}.desc` as Key))));
    };
    const cell = (c: Cell): HTMLElement => {
      const cur = c.quality === k.quality;
      const problem = problemText(c);
      return h('td', { class: `kt-cell${cur ? ' cur' : ''}${c.quality === sel.quality && change !== null ? ' pick' : ''}` },
        h('div', { class: 'kt-value-row' }, h('span', { class: 'kt-value' }, valueText(c.metric, c.value)),
          problem ? h('span', { class: 'kt-delta warn' }, problem) : c.delta === null ? null : h('span', { class: 'kt-delta' }, deltaText(c.metric, c.delta))),
        h('span', { class: 'kt-track', 'aria-hidden': 'true' }, h('span', { class: 'kt-bar', style: `width:${Math.round(c.bar * 100)}%` })));
    };
    const rows = METRICS.map((m, i) => h('tr', { class: 'kt-row' },
      h('th', { scope: 'row', class: 'kt-label' }, h('span', { class: 'kt-label-name' }, t(metricName(m.id))), h('span', { class: 'kt-label-sub' }, t(`${metricName(m.id)}.sub` as Key))),
      table[i]!.map(cell)));
    const comparison = h('table', { class: 'kt-table' },
      h('caption', { class: 'sr' }, t('kt.tiers.title')),
      h('thead', null, h('tr', null, h('td', { class: 'kt-corner' }), tiers.map(th))),
      h('tbody', null, rows));
    const apply = button(change ? t('kt.apply') : t('kt.change'), { variant: change ? 'primary' : 'secondary', icon: 'chef-hat', key: change ? t('key.enter') : undefined, disabled: change === null,
      onclick: () => { if (change) void act(t('kt.saved'), () => setKitchen(icao, change), async () => { reset(); await redraw(); }); } });
    tierHost.replaceChildren(comparison, h('div', { class: 'kt-foot' }, h('p', { class: 'kt-note' }, t('kt.note')), apply));

    // ---- in-house or caterer
    const ownTier = own(sel.quality);
    const cat = k.caterer;
    const optionCard = (id: KitchenProvider, body: (HTMLElement | null)[], disabled = false): HTMLElement => {
      const on = sel.provider === id;
      return h('button', { type: 'button', class: `kt-opt${on ? ' sel' : ''}`, 'aria-pressed': String(on), disabled, onclick: () => { pending = { ...pending, hub: icao, provider: id }; paint(); } },
        h('span', { class: 'kt-opt-head' }, h('span', { class: 'kt-opt-name' }, id === 'own' ? t('kt.prov.own') : cat?.name ?? t('kt.role.catererAnon')),
          on ? icon('check', 14) : null, id === k.provider ? h('span', { class: 'kt-opt-cur' }, t('kt.prov.current')) : null), body);
    };
    const ownCard = optionCard('own', [
      ownTier ? h('span', { class: 'kt-opt-econ' }, t('kt.prov.econ', { cost: money2(ownTier.cost), pct: fm.percent(ownTier.margin) })) : null,
      h('span', { class: 'kt-opt-trade' }, t('kt.prov.ownTrade', { cap: fm.num(ownTier?.maxOutput ?? k.capacity ?? 0), people: tp('kt.prov.cooks', k.cooks.headcount) }))]);
    const catCard = optionCard('caterer', cat ? [
      h('span', { class: 'kt-opt-econ' }, t('kt.prov.econ', { cost: money2(cat.costPerMeal), pct: fm.percent(cat.margin) })),
      h('span', { class: 'kt-opt-trade' }, [t('kt.prov.catTrade'), ...missingAt(cat).map((q) => t('kt.prov.catNo', { quality: qualityName(q) }))].join(', '))]
      : [h('span', { class: 'kt-opt-trade' }, t('kt.prov.noQuote'))], !canPickCaterer(k));
    provHost.replaceChildren(ownCard, catCard);
  };

  const askQuote = (): void => {
    void act(t('kt.prov.quoted'), async () => { quoted = { hub: icao, offer: await requestQuote(icao) }; }, async () => { if (quoted) k = { ...k, caterer: quoted.offer }; paint(); });
  };

  const tiersPanel = panel({ title: t('kt.tiers.title'), id: 'kt-tiers', class: 'sv-main' }, tierHost);
  paint();

  // ------------------------------------------------------------ tonight's departures and who is cooking
  const timeOf = (d: KitchenDeparture): string => fm.zulu(d.dep);
  const depRow = (d: KitchenDeparture): HTMLElement => {
    const load = [d.kind === 'hot' ? tp('kt.dep.hot', d.meals) : tp('kt.dep.snacks', d.meals), d.aircraft].join(' · ');
    const status = isLate(d)
      ? badge('contested', d.readyAt === null ? t('kt.dep.lateNoTime', { n: d.lateMin }) : t('kt.dep.late', { time: fm.zulu(d.readyAt), n: d.lateMin }), 'clock-alert')
      : h('span', { class: `kt-dep-status ${d.status}` }, icon(DEP_ICON[d.status], 14), t(`kt.dep.${d.status}` as Key));
    return h('li', { class: `kt-dep${d.status === 'loaded' ? ' past' : ''}` },
      h('time', { class: 'kt-dep-time', datetime: new Date(d.dep).toISOString() }, timeOf(d)),
      h('div', { class: 'kt-dep-block' }, h('span', { class: 'kt-dep-line' }, h('span', null, d.flightNo), h('span', null, `${d.origin} → ${d.dest}`)), h('span', { class: 'kt-dep-load' }, load)),
      status);
  };
  const shift = h('div', { class: 'kt-shift' },
    h('div', { class: 'kt-shift-head' }, h('h3', null, t('kt.shift.title'))),
    k.cooks.headcount === 0
      ? h('p', { class: 'kt-shift-note sv-warn' }, t('kt.shift.none'))
      : h('div', { class: 'kt-crew' }, h('span', { class: `kt-crew-n${absent > 0 ? ' warn' : ''}` }, t('kt.shift.of', { on: fm.num(k.cooks.onDuty), all: fm.num(k.cooks.headcount) })), h('span', { class: 'kt-crew-role' }, t('kt.shift.cooks'))),
    absent > 0 && k.capacityNow !== null ? h('p', { class: 'kt-shift-note' }, tp('kt.shift.absent', absent, { cap: fm.num(k.capacityNow) })) : null,
    k.provider === 'own' && k.cooks.headcount < k.cooks.needed ? button(t('kt.shift.recruit'), { variant: 'ghost', onclick: () => { Object.assign(hireFilter, { family: 'kitchen', base: icao, qual: null }); go('#staff/hire'); } }) : null);
  const departures = panel({ title: t('kt.dep.title'), id: 'kt-deps', class: 'sv-side' },
    k.departures.length === 0 ? h('p', { class: 'dim small' }, t('kt.dep.none')) : h('ul', { class: 'plain kt-deps' }, k.departures.map(depRow)),
    shift);

  const providers = panel({ title: t('kt.prov.title'), id: 'kt-prov', class: 'sv-side',
    action: h('button', { type: 'button', class: 'link-btn sv-link', onclick: askQuote }, t('kt.prov.quote')) },
    h('div', { class: 'kt-opts', role: 'group', 'aria-label': t('kt.prov.title') }, provHost));

  const viewEl = h('div', { class: 'sv-screen kt-screen' }, header, h('div', { class: 'sv-body' }, tiersPanel, h('div', { class: 'sv-col kt-col' }, departures, providers)));
  const toggleProvider = (): void => {
    const sel = selection(k, pending);
    if (sel.provider === 'own' && !canPickCaterer(k)) { askQuote(); return; }
    pending = { ...pending, hub: icao, provider: sel.provider === 'own' ? 'caterer' : 'own' };
    paint();
  };
  const step = (dir: 1 | -1) => (): void => { pending = { ...pending, hub: icao, quality: stepQuality(k, pending, dir) }; paint(); };
  return {
    title: t('kt.title', { city }), scene: 'bridge', tab: 'hubs', view: viewEl, back, wide: false,
    hints: [{ key: t('key.esc'), label: backHint }, { key: '← →', label: t('kt.hint.level') }, { key: 'T', label: t('kt.hint.provider') }, { key: t('key.enter'), label: t('kt.hint.apply') }],
    keys: { left: step(-1), right: step(1), t: toggleProvider },
  };
}
