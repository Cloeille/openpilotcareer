import { act } from '../actions.ts';
import { fetchKitchen, requestQuote, setKitchen, type CatererQuote, type KitchenDeparture, type KitchenProvider, type KitchenView, type MealQuality } from '../api-service.ts';
import { airportInfo, cityOf } from '../airports.ts';
import { button, icon, panel, signLocation, stat } from '../components.ts';
import { fmt } from '../format.ts';
import { locale } from '../finance-ui.ts';
import { t, tp } from '../i18n.ts';
import type { IconName } from '../icons.ts';
import type { Ctx, Screen } from '../screen.ts';
import { absentCooks, changeOf, configured, hallState, headline, mealEconomics, METRICS, noPending, quoteFor, selection, stepQuality, tierTable, type Cell, type MetricId, type Pending } from '../kitchen-view.ts';
import { MEAL_QUALITIES } from '../service-view.ts';
import { kitchenOff, kitchenTrail, money2, qualityName, signed } from '../service-ui.ts';
import { hireFilter, longDay } from '../staff-ui.ts';
import { h } from '../ui.ts';

/** The level and provider the player picked and has not applied yet. They survive the screen's own redraws and reset for another hub. */
let pending: Pending = noPending('');
/** The last quote asked for, kept while the player looks at the same base and level. */
let quoted: { hub: string; quote: CatererQuote } | null = null;

const DEP_ICON: Record<KitchenDeparture['status'], IconName> = { done: 'check-check', scheduled: 'chef-hat' };

/** `#kitchen/<icao>`: the central kitchen of one base: what the day's timetable asks for, the quality levels side by side, the day's departures and the choice of making the meals in-house or buying them. A change applies from the next UTC day. */
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
  const k: KitchenView = fetched;

  const fm = fmt();
  const info = await airportInfo(icao);
  const city = info ? cityOf(info) : icao;
  const redraw = async (): Promise<void> => { window.dispatchEvent(new Event('opc:redraw')); };
  const reset = (): void => { pending = noPending(icao); };
  const set = configured(k);
  const hall = hallState(k);
  const cur = k.effectiveQuality;
  const absent = absentCooks(k);

  // ------------------------------------------------------------ header
  const head = headline(k);
  const statusText = head.kind === 'unserved' ? tp('kt.status.unserved', head.n)
    : head.kind === 'short' ? t('kt.status.short', { demand: fm.num(head.demand), capacity: fm.num(head.capacity) })
    : head.kind === 'idle' ? t('kt.status.idle') : t('kt.status.ok');
  const eco = mealEconomics(k, k.provider, cur);
  const hubChips = me.hubs.length > 1 ? h('div', { class: 'sv-chips', role: 'group', 'aria-label': t('hub.title') },
    me.hubs.map((x) => h('button', { type: 'button', class: 'st-chip mono', 'aria-pressed': String(x === icao), onclick: () => go(`#kitchen/${x}`) }, x))) : null;
  const header = h('div', { class: 'ln-header sv-header' },
    h('div', { class: 'title-block' },
      h('div', { class: 'row tight' }, signLocation(icao), h('span', { class: 'sv-crumb' }, t('kt.crumb')), hubChips),
      h('div', { class: 'status-line sv-status' }, h('span', { class: `dot${head.tone === 'warn' ? ' warn' : ''}` }), h('span', null, statusText)),
      h('h1', { class: 'title sv-title' }, t('kt.title', { city })),
      h('p', { class: 'sv-sub' }, `${k.provider === 'own' ? t('kt.role.own') : t('kt.role.caterer')} · ${t('kt.role.day', { day: longDay(k.day.date, locale()) })}`)),
    h('div', { class: 'sv-stats' },
      stat(t('kt.stat.meals'), fm.num(k.day.demand), h('span', { class: 'dim' }, `${tp('kt.snacks', k.day.snacks)} · ${tp('kt.hot', k.day.hot)}`)),
      stat(t('kt.stat.capacity'), k.day.capacity === null ? t('kt.stat.noCap') : fm.num(k.day.capacity),
        k.day.capacity === null ? h('span', { class: 'dim' }, t('kt.stat.caterer')) : absent > 0 ? h('span', { class: 'sv-warn' }, tp('kt.stat.absent', absent)) : h('span', { class: 'dim' }, t('kt.stat.cooksOn'))),
      stat(t('kt.stat.margin'), fm.percent(eco.margin), h('span', { class: 'dim' }, t('kt.stat.marginSub', { cost: money2(eco.cost), price: money2(eco.price) })))));

  // ------------------------------------------------------------ the comparison of the quality levels
  const valueText = (id: MetricId, v: number): string => id === 'prep' ? t('kt.min', { n: fm.num(v) }) : id === 'cost' ? money2(v) : id === 'margin' ? fm.percent(v) : id === 'sat' ? t('sv.stat.of5', { n: fm.num(v, 1) }) : fm.num(v);
  const deltaText = (id: MetricId, d: number): string => id === 'prep' ? t('kt.min', { n: signed(d) }) : id === 'cost' ? `${d > 0 ? '+' : ''}${money2(d)}` : id === 'margin' ? t('kt.pts', { n: signed(Math.round(d * 100)) }) : id === 'sat' ? signed(d, 1) : signed(d);
  const problemText = (c: Cell): string | null => (c.problem === null ? null : c.problem.kind === 'recruit' ? t('kt.problem.recruit', { n: fm.num(c.problem.n) }) : t('kt.problem.demand', { n: fm.num(c.problem.n) }));

  const tierHost = h('div', { class: 'sv-tier-host' });
  const provHost = h('div', { class: 'sv-prov-host' });
  const quoteHost = h('div', { class: 'kt-quote', 'aria-live': 'polite' });

  const paint = (): void => {
    const sel = selection(k, pending);
    const change = changeOf(k, pending);
    const table = tierTable(k.qualities, cur, { employed: sel.provider === 'own' ? k.cooks.employed : null, demand: k.day.demand });
    const pick = (q: MealQuality): void => { pending = { ...pending, hub: icao, quality: q }; paint(); };
    const mark = (q: MealQuality): string | null => (q === cur ? t('kt.tier.current') : change && q === sel.quality ? t('kt.tier.picked') : q === set.quality ? t('kt.tier.tomorrow') : null);
    const th = (q: MealQuality): HTMLElement => {
      const m = mark(q);
      return h('th', { scope: 'col', class: `kt-th${q === cur ? ' cur' : ''}${change && q === sel.quality ? ' pick' : ''}` },
        h('button', { type: 'button', class: 'kt-tier', 'aria-pressed': String(q === sel.quality), onclick: () => pick(q) },
          h('span', { class: 'kt-tier-name' }, qualityName(q), m ? h('span', { class: 'kt-current' }, q === cur ? icon('check', 14) : null, m) : null),
          h('span', { class: 'kt-tier-desc' }, t(`kt.q.${q}.desc`))));
    };
    const cell = (c: Cell): HTMLElement => {
      const problem = problemText(c);
      return h('td', { class: `kt-cell${c.quality === cur ? ' cur' : ''}${change && c.quality === sel.quality ? ' pick' : ''}` },
        h('div', { class: 'kt-value-row' }, h('span', { class: 'kt-value' }, valueText(c.metric, c.value)),
          problem ? h('span', { class: `kt-delta${c.problem?.kind === 'demand' ? ' warn' : ''}` }, problem) : c.delta === null ? null : h('span', { class: 'kt-delta' }, deltaText(c.metric, c.delta))),
        h('span', { class: 'kt-track', 'aria-hidden': 'true' }, h('span', { class: 'kt-bar', style: `width:${Math.round(c.bar * 100)}%` })));
    };
    const rows = METRICS.map((m, i) => h('tr', { class: 'kt-row' },
      h('th', { scope: 'row', class: 'kt-label' }, h('span', { class: 'kt-label-name' }, t(`kt.m.${m.id}`)), h('span', { class: 'kt-label-sub' }, t(`kt.m.${m.id}.sub`))),
      table[i]!.map(cell)));
    const comparison = h('table', { class: 'kt-table' },
      h('caption', { class: 'sr' }, t('kt.tiers.title')),
      h('thead', null, h('tr', null, h('td', { class: 'kt-corner' }), MEAL_QUALITIES.filter((q) => k.qualities.some((x) => x.quality === q)).map(th))),
      h('tbody', null, rows));
    /** With nothing chosen the button starts a change (it picks the next level up, or the one below at the top); with a choice it applies it. */
    const apply = button(change ? t('kt.apply') : t('kt.change'), { variant: change ? 'primary' : 'secondary', icon: 'chef-hat', key: change ? t('key.enter') : undefined,
      onclick: () => { if (change) void act(t('kt.saved'), () => setKitchen(icao, change), async () => { reset(); await redraw(); }); else pick(stepQuality(k, pending, 1) === sel.quality ? stepQuality(k, pending, -1) : stepQuality(k, pending, 1)); } });
    tierHost.replaceChildren(comparison, h('div', { class: 'kt-foot' }, h('p', { class: 'kt-note' }, t('kt.note')), apply));

    // ---- in-house or caterer
    const own = mealEconomics(k, 'own', sel.quality);
    const cat = mealEconomics(k, 'caterer', sel.quality);
    const option = (id: KitchenProvider, name: string, body: (HTMLElement | null)[], disabled = false): HTMLElement => {
      const on = sel.provider === id;
      return h('button', { type: 'button', class: `kt-opt${on ? ' sel' : ''}`, 'aria-pressed': String(on), disabled, onclick: () => { pending = { ...pending, hub: icao, provider: id }; paint(); } },
        h('span', { class: 'kt-opt-head' }, h('span', { class: 'kt-opt-name' }, name), on ? icon('check', 14) : null, id === k.provider && sel.provider !== k.provider ? h('span', { class: 'kt-opt-cur' }, t('kt.prov.current')) : null), body);
    };
    const ownRow = k.qualities.find((x) => x.quality === sel.quality);
    const ownCard = option('own', t('kt.prov.own'), [
      h('span', { class: 'kt-opt-econ' }, t('kt.prov.econ', { cost: money2(own.cost), pct: fm.percent(own.margin) })),
      h('span', { class: 'kt-opt-trade' }, hall === 'held' ? t('kt.prov.ownTrade', { cap: fm.num(ownRow?.maxOutput ?? 0), people: tp('kt.prov.cooks', k.cooks.employed) })
        : hall === 'rentable' ? t('kt.prov.needHall') : t('kt.prov.hallNone'))], hall !== 'held');
    const catCard = option('caterer', t('kt.prov.caterer'), [
      h('span', { class: 'kt-opt-econ' }, t('kt.prov.econ', { cost: money2(cat.cost), pct: fm.percent(cat.margin) })),
      h('span', { class: 'kt-opt-trade' }, t('kt.prov.catTrade'))]);
    provHost.replaceChildren(ownCard, catCard);

    // ---- the quote, when one was asked for this base and level
    const q = quoteFor(quoted, icao, sel.quality);
    quoteHost.replaceChildren();
    if (q === null) return;
    const line = (label: string, amount: number): HTMLElement => h('div', { class: 'line' }, h('span', { class: 'line-label' }, label), h('span', { class: 'line-value strong' }, t('kt.quote.perMonth', { amount: fm.money(amount) })));
    quoteHost.append(h('h3', { class: 'kt-quote-title' }, t('kt.quote.title')), line(t('kt.quote.caterer'), q.monthly));
    if (q.own === null) quoteHost.append(h('p', { class: 'dim small' }, t('kt.quote.ownNone')));
    else {
      quoteHost.append(line(t('kt.quote.own', { cooks: tp('kt.prov.cooks', q.own.cooks) }), q.own.monthly + q.own.hallRent));
      if (q.own.hallRent > 0) quoteHost.append(h('p', { class: 'dim small' }, t('kt.quote.rent', { rent: fm.money(q.own.hallRent) })));
    }
  };

  const askQuote = (): void => {
    const sel = selection(k, pending);
    void act(t('kt.prov.quoted'), async () => { quoted = { hub: icao, quote: await requestQuote(icao, sel.quality) }; }, async () => { paint(); });
  };

  const tiersPanel = panel({ title: t('kt.tiers.title'), id: 'kt-tiers', class: 'sv-main' }, tierHost);
  paint();

  // ------------------------------------------------------------ the day's departures and who is cooking
  const depRow = (d: KitchenDeparture): HTMLElement => {
    const load = [d.snacks > 0 ? tp('kt.dep.snacks', d.snacks) : null, d.hot > 0 ? tp('kt.dep.hot', d.hot) : null, d.aircraft].filter((x): x is string => x !== null).join(' · ');
    return h('li', { class: `kt-dep${d.status === 'done' ? ' past' : ''}` },
      h('time', { class: 'kt-dep-time', datetime: new Date(d.dep).toISOString() }, fm.zulu(d.dep)),
      h('div', { class: 'kt-dep-block' }, h('span', { class: 'kt-dep-line' }, h('span', null, d.flightNo), h('span', null, `${icao} → ${d.dest}`)), h('span', { class: 'kt-dep-load' }, load)),
      h('span', { class: `kt-dep-status ${d.status}` }, icon(DEP_ICON[d.status], 14), t(`kt.dep.${d.status}`)));
  };
  const short = k.cooks.employed < k.cooks.needed;
  const shift = h('div', { class: 'kt-shift' },
    h('div', { class: 'kt-shift-head' }, h('h3', null, t('kt.shift.title'))),
    k.cooks.employed === 0 && k.provider === 'own'
      ? h('p', { class: 'kt-shift-note sv-warn' }, t('kt.shift.none'))
      : h('div', { class: 'kt-crew' }, h('span', { class: `kt-crew-n${absent > 0 ? ' warn' : ''}` }, t('kt.shift.of', { on: fm.num(k.cooks.onDuty), all: fm.num(k.cooks.employed) })), h('span', { class: 'kt-crew-role' }, t('kt.shift.cooks'))),
    k.provider === 'own' && short && k.cooks.employed > 0 ? h('p', { class: 'kt-shift-note' }, t('kt.shift.need', { n: fm.num(k.cooks.needed) })) : null,
    k.provider === 'own' && short ? button(t('kt.shift.recruit'), { variant: 'ghost', onclick: () => { Object.assign(hireFilter, { family: 'kitchen', base: icao, qual: null }); go('#staff/hire'); } }) : null,
    hall === 'rentable' && k.hall ? button(t('kt.prov.hallRent', { rent: fm.money(k.hall.rent) }), { variant: 'ghost', onclick: () => go(`#facility/${k.hall!.facilityId}`) }) : null);
  const departures = panel({ title: t('kt.dep.title'), id: 'kt-deps', class: 'sv-side' },
    k.departures.length === 0 ? h('p', { class: 'dim small' }, t('kt.dep.none')) : h('ul', { class: 'plain kt-deps', role: 'region', tabindex: 0, 'aria-label': t('kt.dep.title') }, k.departures.map(depRow)),
    shift);

  const providers = panel({ title: t('kt.prov.title'), id: 'kt-prov', class: 'sv-side',
    action: h('button', { type: 'button', class: 'link-btn sv-link', onclick: askQuote }, t('kt.prov.quote')) },
    h('div', { class: 'kt-opts', role: 'group', 'aria-label': t('kt.prov.title') }, provHost), quoteHost);

  const viewEl = h('div', { class: 'sv-screen kt-screen' }, header, h('div', { class: 'sv-body' }, tiersPanel, h('div', { class: 'sv-col kt-col' }, departures, providers)));
  const toggleProvider = (): void => {
    const sel = selection(k, pending);
    const next: KitchenProvider = sel.provider === 'own' ? 'caterer' : 'own';
    if (next === 'own' && hall !== 'held') { askQuote(); return; }
    pending = { ...pending, hub: icao, provider: next };
    paint();
  };
  const step = (dir: 1 | -1) => (): void => { pending = { ...pending, hub: icao, quality: stepQuality(k, pending, dir) }; paint(); };
  return {
    title: t('kt.title', { city }), scene: 'bridge', tab: 'hubs', view: viewEl, back, wide: false,
    hints: [{ key: t('key.esc'), label: backHint }, { key: '← →', label: t('kt.hint.level') }, { key: 'T', label: t('kt.hint.provider') }, { key: t('key.enter'), label: t('kt.hint.apply') }],
    keys: { left: step(-1), right: step(1), t: toggleProvider },
  };
}
