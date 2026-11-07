import { HUB_PRICE, PARKING_FEE_BY_SIZE, type AirportSize } from '@opc/shared';
import { act } from '../actions.ts';
import { api } from '../api.ts';
import { airportField } from '../airport-field.ts';
import { fetchHubsOverview, type FacilityRow, type HubOverview, type HubsOverview } from '../api-facilities.ts';
import { fetchStaff } from '../api-staff.ts';
import { hubUsage } from '../api-finance.ts';
import { airportInfo, cityOf } from '../airports.ts';
import { button, icon, panel, signDirection, signLocation, stat, titleBlock } from '../components.ts';
import { facilitiesOff, holdingText, planFocus } from '../facilities-ui.ts';
import { contractsOf, hubTotal, HOLDING_TONE, holdingOf, KIND_ICON, monthsBetween, parkingCost, shown, stepOf, teamRows } from '../facilities-view.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import type { Key } from '../messages.ts';
import type { Ctx, Screen } from '../screen.ts';
import { famLabel, staffEntry } from '../staff-ui.ts';
import { h } from '../ui.ts';

/** The base on the big card. Kept across redraws (a language change, an action), not across visits to another tab: it resets to the main hub when the hub list changes. */
let chosen: string | null = null;

type Parking = { spots: number; used: number; fee: number };

/** `#hubs` (the Compagnie tab): every base with its facilities, team and aircraft, and the way to open another one. */
export async function hubsOverview(ctx: Ctx): Promise<Screen> {
  const { snap, go } = ctx;
  const { me } = snap;
  const fm = fmt();
  const [data, usage, people] = await Promise.all([fetchHubsOverview(), hubUsage().catch(() => null), fetchStaff().catch(() => null)]);
  const infos = new Map(await Promise.all(me.hubs.map(async (icao) => [icao, await airportInfo(icao)] as const)));
  const staffCard = staffEntry(people, go);
  const staffKeys: Record<string, () => void> = staffCard ? { s: () => go('#staff') } : {};
  const staffHint = staffCard ? [{ key: 'S', label: t('st.hint.openStaff') }] : [];

  const parkingOf = (icao: string): Parking => {
    const u = usage?.find((x) => x.icao === icao);
    const size: AirportSize = infos.get(icao)?.size ?? 'small';
    return { spots: u?.spots ?? 0, used: u?.used ?? 0, fee: PARKING_FEE_BY_SIZE[size] };
  };

  const openForm = (): HTMLElement => {
    const canAfford = me.company.balance >= HUB_PRICE;
    const field = airportField(t('hub.code'));
    const submit = button(t('fleet.buyHub'), { variant: 'secondary', type: 'submit', disabled: !canAfford });
    return panel({ title: t('hub.open'), action: t('hub.openSub', { price: fm.money(HUB_PRICE) }), class: 'fc-open' },
      h('form', { class: 'col', onsubmit: (e: Event) => {
        e.preventDefault();
        const icao = field.input.value.trim().toUpperCase();
        void act(t('hub.opened', { icao }), () => api('/me/hubs', { method: 'POST', body: { icao } }), ctx.refresh);
      } }, field.root, h('p', { class: 'dim small' }, t('hub.after', { balance: fm.money(me.company.balance - HUB_PRICE) })), h('div', { class: 'row' }, submit)));
  };

  // ------------------------------------------------------------ the server has no facilities: the hub list and the form
  if (!data) {
    const list = panel({ title: t('hub.list'), action: t('hub.listSub') }, h('ul', { class: 'plain hub-rows' }, me.hubs.map((code, i) => {
      const info = infos.get(code);
      return h('li', { class: 'hub-row' }, h('span', { class: 'mono strong' }, code), h('span', { class: 'col tight' }, h('span', null, info?.name ?? code), h('span', { class: 'dim small' }, info ? `${cityOf(info)} · ${t(`hub.size.${info.size}`)}` : '')), i === 0 ? h('span', { class: 'dim small' }, t('hub.main')) : null);
    })));
    const view = h('div', { class: 'briefing-column' }, titleBlock(t('hub.status', { company: me.company.name }), t('hub.title')), facilitiesOff(), list, openForm(), staffCard);
    return { title: t('hub.title'), scene: 'hubs', tab: 'hubs', view, back: '#dashboard', hints: [{ key: t('key.esc'), label: t('hint.dashboard') }, ...staffHint], keys: staffKeys };
  }

  // ------------------------------------------------------------ the overview
  const hubs = data.hubs;
  if (chosen === null || !hubs.some((x) => x.icao === chosen)) chosen = hubs[0]?.icao ?? null;
  const main = hubs.find((x) => x.icao === chosen) ?? null;
  const totalOf = (x: HubOverview): number => hubTotal(x.monthlyCost, parkingCost(parkingOf(x.icao).used, parkingOf(x.icao).fee));
  const all = hubs.reduce((n, x) => n + totalOf(x), 0);
  const aircraft = hubs.reduce((n, x) => n + x.aircraft.length, 0);
  const employees = hubs.reduce((n, x) => n + x.team.total, 0);
  const choose = (icao: string): void => { chosen = icao; window.dispatchEvent(new Event('opc:redraw')); };
  const openPlan = (icao: string, slot: string | null = null): void => { planFocus.slot = slot; go(`#hub/${icao}`); };

  const sub = [tp('fc.ov.bases', hubs.length), tp('fc.ov.aircraft', aircraft), tp('fc.ov.people', employees)].join(' · ');
  const header = h('div', { class: 'fc-head' },
    titleBlock(`${data.company.name} · ${sub}`, t('fc.ov.title')),
    stat(t('fc.ov.cost'), t('fc.ov.perMonth', { amount: fm.money(all) }), hubs.length > 1 ? h('span', { class: 'dim' }, hubs.map((x) => `${x.icao} ${fm.money(totalOf(x))}`).join(' · ')) : null));

  const aircraftRow = (a: HubOverview['aircraft'][number]): HTMLElement => h('li', { class: 'fc-ac' },
    h('span', { class: 'mono strong' }, a.reg), h('span', { class: 'fc-ac-type dim small' }, a.typeName),
    h('span', { class: `fc-ac-status ${a.status}` }, a.note ?? t(`fc.ac.${a.status}` as Key)));

  const facilityRow = (hub: HubOverview, f: FacilityRow): HTMLElement => {
    const hold = holdingOf(f);
    const detail = [t('fc.hub.detail', { area: fm.num(f.areaM2), level: f.level }), f.worksTo ? t('fc.hub.works', { date: fm.date(f.worksTo) }) : null, f.understaffed ? t('fc.hub.understaffed') : null].filter(Boolean).join(' · ');
    const cost = f.monthly !== null ? (hold === 'fee' ? t('fc.hub.approx', { amount: fm.money(f.monthly) }) : fm.money(f.monthly)) : f.offerMonthly !== null ? t('fc.hub.from', { amount: fm.money(f.offerMonthly) }) : '—';
    return h('li', { class: `fc-fac ${HOLDING_TONE[hold]}`, 'data-row': '', tabindex: 0, 'aria-label': `${f.name}, ${holdingText(f)}, ${cost}`, onclick: () => openPlan(hub.icao, f.slot) },
      icon(KIND_ICON[f.kind], 16),
      h('span', { class: 'col tight fc-fac-name' }, h('span', { class: 'fc-fac-title' }, f.name), h('span', { class: 'dim small' }, detail)),
      h('span', { class: 'fc-fac-status' }, hold === 'ai' && f.ownerName ? f.ownerName : holdingText(f)),
      h('span', { class: 'fc-fac-cost' }, cost));
  };
  const parkingRow = (hub: HubOverview): HTMLElement | null => {
    const p = parkingOf(hub.icao);
    if (p.spots === 0) return null;
    return h('li', { class: 'fc-fac plain', 'data-row': '', tabindex: 0, 'aria-label': t('fc.hub.parking'), onclick: () => openPlan(hub.icao) },
      icon('square-parking', 16),
      h('span', { class: 'col tight fc-fac-name' }, h('span', { class: 'fc-fac-title' }, t('fc.hub.parking')), h('span', { class: 'dim small' }, t('fc.hub.parkingDetail', { n: p.spots, fee: fm.money(p.fee) }))),
      h('span', { class: 'fc-fac-status' }, t('fc.hub.parkingUsed', { used: p.used, spots: p.spots })),
      h('span', { class: 'fc-fac-cost' }, fm.money(parkingCost(p.used, p.fee))));
  };

  const bigCard = (hub: HubOverview): HTMLElement => {
    const info = infos.get(hub.icao);
    const { rows, more } = shown(hub.facilities);
    const parking = parkingRow(hub);
    const chief = hub.team.chief;
    const months = chief ? monthsBetween(chief.since, snap.at) : 0;
    const renewals = hub.renewals[0];
    const costHere = totalOf(hub);
    return h('section', { class: 'panel fc-hub', 'aria-label': `${hub.icao} ${hub.name}` }, h('div', { class: 'fc-hub-body' },
      h('div', { class: 'fc-hub-head' },
        h('div', { class: 'col tight' }, h('div', { class: 'row' }, signLocation(hub.icao), h('span', { class: 'muted' }, t(hub.role === 'main' ? 'fc.hub.main' : 'fc.hub.secondary'))), h('h2', { class: 'fc-hub-name' }, hub.name || info?.name || hub.icao)),
        button(t('fc.hub.plan'), { variant: 'primary', key: t('key.enter'), onclick: () => openPlan(hub.icao) })),
      h('div', { class: 'fc-hub-cols' },
        h('div', { class: 'fc-col-main' },
          h('div', { class: 'fc-sec' }, h('h3', null, t('fc.hub.facilities')), h('span', { class: 'muted' }, t('fc.ov.perMonth', { amount: fm.money(costHere) }))),
          rows.length === 0 && !parking ? h('p', { class: 'dim', style: 'padding:12px 0' }, t('fc.hub.none')) : h('ul', { class: 'plain fc-facs' }, rows.map((f) => facilityRow(hub, f)), parking),
          more.length > 0 ? h('p', { class: 'dim small fc-also' }, t('fc.hub.also', { names: more.map((f) => f.name).join(', ') })) : null),
        h('div', { class: 'fc-col-side' },
          h('div', { class: 'col' },
            h('div', { class: 'fc-sec' }, h('h3', null, t('fc.hub.team')), h('span', { class: 'muted' }, tp('fc.hub.people', hub.team.total))),
            chief ? h('div', { class: 'fc-chief' }, h('span', { class: 'fc-avatar', 'aria-hidden': 'true' }, chief.name.split(' ').map((w) => w[0]).join('').slice(0, 2)), h('span', { class: 'col tight' }, h('span', { class: 'fc-fac-title' }, chief.name), h('span', { class: 'dim small' }, tp('fc.hub.chief', months)))) : h('p', { class: 'dim small' }, t('fc.hub.noChief')),
            h('ul', { class: 'plain col tight' }, teamRows(hub.team.byFamily).map((r) => h('li', { class: 'line' }, h('span', { class: 'line-label' }, famLabel(r.family)), h('span', { class: 'line-value strong' }, String(r.n)))))),
          h('div', { class: 'col tight' },
            h('div', { class: 'fc-sec' }, h('h3', null, t('fc.hub.fleet')), h('span', { class: 'muted' }, String(hub.aircraft.length))),
            hub.aircraft.length === 0 ? h('p', { class: 'dim small' }, t('fc.hub.noFleet')) : h('ul', { class: 'plain col tight' }, hub.aircraft.map(aircraftRow))))),
      h('div', { class: 'fc-hub-foot' },
        h('span', { class: 'row tight muted' }, renewals ? [icon('calendar-clock', 16), t('fc.hub.renew', { text: renewals.text, date: fm.date(renewals.before) })] : null),
        people ? button(t('fc.hub.team.link'), { variant: 'ghost', onclick: () => go('#staff') }) : null)));
  };

  const smallCard = (hub: HubOverview): HTMLElement => {
    const info = infos.get(hub.icao);
    const mine = hub.facilities.filter((f) => f.owner === 'player');
    const chief = hub.team.chief;
    const fact = (label: string, value: string): HTMLElement => h('div', { class: 'line' }, h('span', { class: 'line-label' }, label), h('span', { class: 'line-value strong' }, value));
    return h('section', { class: 'panel fc-base', 'aria-label': `${hub.icao} ${hub.name}` }, h('div', { class: 'fc-base-body' },
      h('div', { class: 'col tight' }, h('div', { class: 'row' }, signLocation(hub.icao), h('span', { class: 'muted' }, t(hub.role === 'main' ? 'fc.hub.main' : 'fc.hub.secondary'))), h('h2', { class: 'fc-base-name' }, hub.name || info?.name || hub.icao)),
      h('div', { class: 'col tight fc-facts' },
        fact(t('fc.f.facilities'), mine.length === 0 ? t('fc.f.noContract') : tp('fc.f.count', mine.length)),
        fact(t('fc.f.contracts'), t(({ none: 'fc.f.noContract', leased: 'fc.f.allLeased', owned: 'fc.f.allOwned', mixed: 'fc.f.mixed' } as const)[contractsOf(hub.facilities)])),
        fact(t('fc.f.cost'), fm.money(totalOf(hub))),
        chief ? fact(t('fc.f.chief'), chief.name) : null,
        fact(t('fc.f.team'), tp('fc.hub.people', hub.team.total))),
      hub.aircraft.length > 0 ? h('ul', { class: 'plain col tight fc-base-fleet' }, hub.aircraft.map(aircraftRow)) : null,
      h('div', { class: 'row' }, button(t('fc.hub.plan'), { variant: 'ghost', onclick: () => openPlan(hub.icao) }))));
  };

  const suggestion = (s: NonNullable<HubsOverview['suggestion']>): HTMLElement => {
    const title = h('h3', null, t('fc.sug.title', { city: s.icao }));
    void airportInfo(s.icao).then((a) => { if (a) title.textContent = t('fc.sug.title', { city: cityOf(a).replace(/\s*\(.*$/, '') }); });
    return h('section', { class: 'fc-sug', 'aria-label': t('fc.sug.fromLabel') },
      h('div', { class: 'row' }, signDirection(s.icao), title),
      h('p', { class: 'muted' }, s.text),
      h('div', { class: 'fc-sug-foot' }, h('span', { class: 'muted' }, t('fc.sug.from', { amount: fm.money(s.fromMonthly) })), button(t('fc.sug.open'), { variant: 'ghost', onclick: () => document.querySelector<HTMLInputElement>('.fc-open input')?.focus() })));
  };

  const side = h('div', { class: 'fc-side' },
    hubs.filter((x) => x.icao !== main?.icao).map(smallCard),
    data.suggestion ? suggestion(data.suggestion) : null,
    openForm(), staffCard);

  const view = h('div', { class: 'fc-ov' }, header, h('div', { class: 'fc-hubs' }, main ? bigCard(main) : null, side));
  const step = (dir: 1 | -1) => (): void => { const next = stepOf(hubs.map((x) => x.icao), chosen, dir); if (next && next !== chosen) choose(next); };
  return {
    title: t('hub.title'), scene: 'hubs', tab: 'hubs', view, back: '#dashboard',
    hints: [{ key: t('key.esc'), label: t('hint.dashboard') }, ...(hubs.length > 1 ? [{ key: '← →', label: t('fc.hint.base') }] : []), { key: t('key.enter'), label: t('fc.hint.plan') }, ...staffHint],
    keys: { left: step(-1), right: step(1), ...staffKeys },
  };
}
