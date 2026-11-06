import { MANUAL_PAY_FACTOR, type Flight } from '@opc/shared';
import { act } from '../actions.ts';
import { api } from '../api.ts';
import { airportInfo } from '../airports.ts';
import { badge, button, panel, signDirection, signLocation, titleBlock } from '../components.ts';
import { fmt } from '../format.ts';
import { manualEstimate, manualWaitMs } from '../history.ts';
import { t } from '../i18n.ts';
import { loadLabel } from '../job-view.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h } from '../ui.ts';

/** Manual entry: closing an accepted job without telemetry. The server only supports completing an accepted job (unverified, 60 % pay); a free-form flight cannot be declared. */
export async function manual(ctx: Ctx): Promise<Screen> {
  const { snap, go } = ctx;
  const { me, antiCheat } = snap;
  const fm = fmt();
  const active = (await api<Flight[]>('/me/flights?status=active&limit=50')).sort((a, b) => a.acceptedAt - b.acceptedAt);
  const now = Date.now();

  const cards = await Promise.all(active.map(async (f) => {
    const aircraft = me.fleet.find((a) => a.id === f.aircraftId);
    const dest = await airportInfo(f.job.destination);
    const est = aircraft && dest ? manualEstimate(f, aircraft.type, dest.size, me.hubs.includes(f.job.destination)) : null;
    const wait = aircraft ? manualWaitMs(f, aircraft.type, now, antiCheat) : 0;
    const complete = (): void => {
      if (!confirm(t('man.confirm', { pct: fm.percent(MANUAL_PAY_FACTOR) }))) return;
      void act(t('man.done'), () => api(`/flights/${f.id}/complete`, { method: 'POST' }), ctx.refresh).then((ok) => { if (ok) go('#history'); });
    };
    return h('div', { class: 'manual-card' },
      h('div', { class: 'row' }, signLocation(f.job.origin), signDirection(f.job.destination), h('span', { class: 'dim' }, `${f.aircraftIcao} #${f.aircraftId} · ${fm.nm(f.job.distanceNm)} · ${loadLabel(f.job)}`)),
      h('div', { class: 'facts' },
        h('div', { class: 'fact' }, h('span', { class: 'fact-label' }, t('job.pay')), h('span', { class: 'fact-value' }, fm.money(Math.round(f.job.payout * MANUAL_PAY_FACTOR)))),
        est ? h('div', { class: 'fact' }, h('span', { class: 'fact-label' }, t('man.estimate')), h('span', { class: 'fact-value' }, fm.signedMoney(est.net)), h('span', { class: 'fact-sub' }, t('man.estimateSub', { revenue: fm.money(est.revenue), costs: fm.money(est.fuelCost + est.landingFee + est.maintenance) }))) : null),
      h('div', { class: 'row' },
        button(t('man.complete'), { variant: 'primary', disabled: wait > 0, onclick: complete }),
        wait > 0 ? h('span', { class: 'dim small' }, t('man.wait', { time: fm.elapsed(wait) }), ' · ', t('man.waitWhy')) : null));
  }));

  const view = h('div', { class: 'briefing-column' },
    h('div', { class: 'col' },
      titleBlock(t('man.status'), t('man.title'), null),
      h('div', { class: 'row' }, badge('unverified', t('man.verdict'))),
      h('p', { class: 'muted intro' }, t('man.intro', { pct: fm.percent(MANUAL_PAY_FACTOR) }))),
    panel({ title: t('man.panel'), action: t('man.panelSub') }, cards.length > 0 ? cards : h('p', { class: 'dim' }, t('man.none')), h('p', { class: 'dim small' }, t('man.gap'))));
  return { title: t('man.title'), scene: 'history', tab: 'history', view, back: '#history', hints: [{ key: t('key.esc'), label: t('hint.back') }, { key: t('key.enter'), label: t('man.complete') }] };
}
