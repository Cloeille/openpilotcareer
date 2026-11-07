import { aircraftPrice, type AircraftType, type LeaseMonths } from '@opc/shared';
import { api } from '../api.ts';
import { fleetQuote, leaseOffers, signLease, buyAircraftWith } from '../api-finance.ts';
import { airportInfo } from '../airports.ts';
import { button, line, panel, titleBlock } from '../components.ts';
import { inBudget, newestOf, purchaseFees, starterRow, starterSummary, type StarterRow } from '../finance-view.ts';
import { enterConfirms, hubCity, perform, tidyCity } from '../finance-ui.ts';
import { fmt } from '../format.ts';
import { t } from '../i18n.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h } from '../ui.ts';

type Mode = 'lease' | 'buy';

/** The fleet screen of a company without aircraft ("Flotte · nouvelle compagnie"): lease-first starter list, home base, summary. */
export async function starter(ctx: Ctx): Promise<Screen> {
  const { snap, go } = ctx;
  const { me } = snap;
  const fm = fmt();
  const balance = me.company.balance;
  const code = (me.company as { code?: string | null }).code;
  const back = '#dashboard';
  const hints = [{ key: t('key.esc'), label: t('hint.dashboard') }];

  const offers = (await leaseOffers().catch(() => null)) ?? [];
  const types = await Promise.all(offers.map((o) => api<AircraftType>(`/aircraft-types/${o.icao}`).catch(() => null)));
  const defaultHub = me.hubs[0]!;
  const quotes = await Promise.all(offers.map((o) => fleetQuote(o.icao, defaultHub).catch(() => null)));
  const rows: StarterRow[] = offers.map((o, i) => {
    const ty = types[i] ?? null;
    const price = ty ? aircraftPrice(ty) : null;
    return starterRow(o, ty, price, balance, purchaseFees(price ?? 0, quotes[i] ?? null));
  });
  const head = titleBlock(t('fin.start.status', { company: code ? `${me.company.name} · ${code}` : me.company.name }), t('fin.start.title'), h('p', { class: 'muted' }, t('fin.start.sub', { capital: fm.money(balance) })));

  if (rows.length === 0) {
    const view = h('div', { class: 'starter-layout' }, h('div', { class: 'starter-column' }, head,
      panel({ title: t('fin.start.panel') }, h('p', { class: 'muted' }, t('fin.start.none')),
        h('div', { class: 'row' }, button(t('fin.start.browse'), { variant: 'primary', onclick: () => go('#catalogue') })))));
    return { title: t('fin.start.title'), scene: 'fleet', tab: 'fleet', view, back, hints, keys: { a: () => go('#catalogue') } };
  }

  const hubs = await Promise.all(me.hubs.map(async (icao) => ({ icao, airport: await airportInfo(icao) })));
  let hub = me.hubs[0]!;
  const first = rows.find((r) => r.leaseAffordable) ?? rows.find((r) => r.buyAffordable) ?? rows[0]!;
  let pick: { icao: string; mode: Mode } = { icao: first.icao, mode: first.leaseAffordable ? 'lease' : 'buy' };
  const fees = new Map<string, number>();
  rows.forEach((r) => fees.set(`${r.icao}|${defaultHub}`, r.buyFees));

  const summaryHost = h('div', { class: 'sum-host' });
  const goBtn = (): HTMLButtonElement => summaryHost.querySelector<HTMLButtonElement>('[data-primary]')!;

  const sign = (): void => {
    const row = rows.find((r) => r.icao === pick.icao);
    if (!row) return;
    const done = (reg: string): string => t('fin.start.started', { reg });
    if (pick.mode === 'lease') {
      const d = row.offer.durations.find((x) => x.months === row.months);
      if (!d) return;
      void perform(() => signLease(row.offer.id, row.months as LeaseMonths, hub), (r) => done(r.aircraft.registration), ctx.refresh).then((ok) => { if (ok) go('#fleet'); });
    } else {
      void perform(() => buyAircraftWith(row.icao, hub), (m) => done(newestOf(m.fleet, row.icao)), ctx.refresh).then((ok) => { if (ok) go('#fleet'); });
    }
  };

  const drawSummary = (): void => {
    const row = rows.find((r) => r.icao === pick.icao);
    const extra = row ? fees.get(`${row.icao}|${hub}`) ?? row.buyFees : 0;
    const sum = row ? starterSummary(row, pick.mode, balance, extra) : null;
    if (!row || !sum) { summaryHost.replaceChildren(); return; }
    const city = hubCity(hubs.find((x) => x.icao === hub)?.airport ?? null, hub);
    const lease = pick.mode === 'lease';
    const after = sum.balanceAfter;
    const lines = lease
      ? [line(t('fin.start.capital'), fm.money(balance)), line(t('fin.sum.deposit'), fm.money(-row.deposit)), line(t('fin.start.firstRent'), fm.money(-(row.rent ?? 0))),
        line(t('fin.start.ferryTo', { city }), fm.money(-row.ferry)), line(t('fin.start.hubLine', { icao: hub }), t('fin.start.free'))]
      : [line(t('fin.start.capital'), fm.money(balance)), line(row.offer.typeName, fm.money(-(row.price ?? 0))), extra > 0 ? line(t('fin.start.ferryTo', { city }), fm.money(-extra)) : null,
        line(t('fin.start.hubLine', { icao: hub }), t('fin.start.free'))];
    const arrival = Date.now() + row.offer.deliveryHours * 3_600_000;
    summaryHost.replaceChildren(
      h('div', { class: 'lines col', style: 'gap:12px' }, lines),
      h('hr', { class: 'divider' }),
      h('div', { class: 'pay-today' }, h('span', { class: 'label' }, t(lease ? 'fin.start.afterSign' : 'fin.start.afterBuy')), h('span', { class: 'pay-big' }, fm.money(after))),
      lease
        ? h('div', { class: 'col', style: 'gap:8px' },
          line(t('fin.start.rent'), t('fin.cat.perMonth', { amount: fm.money(row.rent ?? 0) })),
          line(t('fin.start.commit'), t('fin.start.commitV', { n: row.months, m: row.offer.minMonths })),
          line(t('fin.start.deliveryTo', { city }), fm.dateTime(arrival)),
          sum.saved ? h('p', { class: 'pay-note' }, t('fin.start.moreCash', { amount: fm.money(sum.saved) })) : null)
        : h('div', { class: 'col', style: 'gap:8px' }, row.price === null ? null : h('p', { class: 'pay-note' }, t('fin.start.buyWhyText'))),
      h('div', { class: 'fin-actions-row' },
        button(t('fin.start.later'), { variant: 'secondary', onclick: () => go(back) }),
        button(t(lease ? 'fin.start.go' : 'fin.start.goBuy'), { variant: 'primary', key: t('key.enter'), onclick: sign })));
  };
  const needFees = (): void => {
    const row = rows.find((r) => r.icao === pick.icao);
    if (!row || pick.mode !== 'buy' || row.price === null) return;
    const k = `${row.icao}|${hub}`;
    if (fees.has(k)) return;
    void fleetQuote(row.icao, hub).catch(() => null).then((q) => { fees.set(k, q && row.price !== null && q.cash > row.price ? q.cash - row.price : 0); if (`${pick.icao}|${hub}` === k && pick.mode === 'buy') drawSummary(); });
  };

  const radioId = (icao: string, mode: Mode): string => `starter-${icao}-${mode}`;
  const select = (icao: string, mode: Mode): void => {
    pick = { icao, mode };
    list.querySelectorAll('.starter-row').forEach((el) => el.classList.toggle('sel', (el as HTMLElement).dataset.icao === icao));
    needFees();
    drawSummary();
  };
  const card = (row: StarterRow, mode: Mode): HTMLElement => {
    const lease = mode === 'lease';
    const ok = lease ? row.leaseAffordable : row.buyAffordable;
    const id = radioId(row.icao, mode);
    const value = lease ? (row.rent === null ? null : t('fin.cat.perMonth', { amount: fm.money(row.rent) })) : (row.price === null ? null : fm.money(row.price));
    const sub = lease ? t('fin.start.deposit', { amount: fm.money(row.deposit) }) : row.buyBalanceAfter === null ? null : ok ? t('fin.start.balanceAfter', { amount: fm.money(row.buyBalanceAfter) }) : t('fin.start.overBudget');
    return h('label', { class: `opt-card${ok ? '' : ' off'}`, for: id },
      h('input', { type: 'radio', name: 'starter-pick', id, value: `${row.icao}:${mode}`, checked: pick.icao === row.icao && pick.mode === mode, disabled: !ok, 'aria-label': `${row.offer.typeName}: ${t(lease ? 'fin.start.colLease' : 'fin.start.colBuy')}`, onchange: () => select(row.icao, mode) }),
      h('span', { class: 'tx' }, h('span', { class: 'v' }, value ?? '–'), sub ? h('span', { class: 's' }, sub) : null));
  };
  const rowEl = (row: StarterRow): HTMLElement => {
    const ty = row.type;
    const sub = ty ? [t(`cat.${ty.category}`), `${ty.seats} ${t('fin.cat.seats').toLowerCase()}`, fm.nm(ty.rangeNm)].join(' · ') : '';
    return h('div', { class: `starter-row${row.icao === pick.icao ? ' sel' : ''}`, 'data-icao': row.icao },
      h('span', { class: 'code' }, row.icao),
      h('div', { class: 'name' }, h('span', { class: 'n' }, row.offer.typeName), sub ? h('span', { class: 's' }, sub) : null),
      h('div', { class: 'opts' }, card(row, 'lease'), card(row, 'buy')));
  };
  const list = h('div', { class: 'col starter-list', style: 'gap:0' },
    h('div', { class: 'starter-head' }, h('span', { class: 'grow' }, t('fin.start.colPlane')), h('span', { class: 'opt' }, t('fin.start.colLease')), h('span', { class: 'opt' }, t('fin.start.colBuy'))),
    rows.map(rowEl),
    h('div', { class: 'explain' },
      h('div', null, h('span', { class: 't' }, t('fin.start.leaseWhy')), h('span', { class: 'd' }, t('fin.start.leaseWhyText'))),
      h('div', null, h('span', { class: 't' }, t('fin.start.buyWhy')), h('span', { class: 'd' }, t('fin.start.buyWhyText')))));

  const hubCards = h('div', { class: 'hub-cards', role: 'radiogroup', 'aria-label': t('fin.start.hub') }, hubs.map(({ icao, airport }) => {
    const id = `start-hub-${icao}`;
    return h('label', { class: 'hub-card', for: id },
      h('span', { class: 'head' }, h('input', { type: 'radio', name: 'start-hub', id, value: icao, checked: icao === hub, onchange: () => { hub = icao; needFees(); drawSummary(); } }), icao),
      h('span', { class: 'n' }, airport ? airport.name : icao),
      airport ? h('span', { class: 's' }, `${tidyCity(airport)} · ${t(`hub.size.${airport.size}`)}`) : null);
  }));

  select(pick.icao, pick.mode);
  const column = h('div', { class: 'starter-column' }, head,
    panel({ title: t('fin.start.panel'), action: t('fin.start.inBudget', { n: inBudget(rows) }), id: 'starter-panel', class: 'flush' }, list),
    panel({ title: t('fin.start.hub'), action: t('fin.start.hubFree'), id: 'starter-hub', class: 'flush' }, hubCards));
  const view = h('div', { class: 'starter-layout' }, column,
    panel({ title: t('buy.summary'), action: t('fin.start.sumSub'), class: 'summary fin-summary' }, summaryHost));

  // arrows: up/down change aircraft, left/right switch lease/buy; Enter on a radio confirms
  const order = rows.map((r) => r.icao);
  const enabled = (icao: string, mode: Mode): boolean => { const r = rows.find((x) => x.icao === icao)!; return mode === 'lease' ? r.leaseAffordable : r.buyAffordable; };
  view.addEventListener('keydown', (e) => {
    const target = e.target as HTMLInputElement | null;
    if (!(target instanceof HTMLInputElement) || target.name !== 'starter-pick') return;
    let { icao, mode } = pick;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') mode = e.key === 'ArrowLeft' ? 'lease' : 'buy';
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { icao = order[Math.min(order.length - 1, Math.max(0, order.indexOf(icao) + (e.key === 'ArrowDown' ? 1 : -1)))]!; if (!enabled(icao, mode)) mode = mode === 'lease' ? 'buy' : 'lease'; }
    else return;
    e.preventDefault();
    if (!enabled(icao, mode)) return;
    const input = document.getElementById(radioId(icao, mode)) as HTMLInputElement | null;
    if (input) { input.checked = true; input.focus(); select(icao, mode); }
  });
  enterConfirms(view, () => goBtn()?.click());

  return {
    title: t('fin.start.title'), scene: 'fleet', tab: 'fleet', view, back,
    hints: [{ key: t('key.esc'), label: t('hint.dashboard') }, { key: '↑ ↓', label: t('fin.hint.pickPlane') }, { key: '← →', label: t('fin.hint.leaseOrBuy') }, { key: t('key.enter'), label: t('fin.hint.startLease') }],
    keys: { a: () => go('#catalogue') },
  };
}
