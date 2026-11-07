// The SimBrief block of a player's active flight (dashboard card): generate the plan on SimBrief, then fetch it back.
import type { Flight, SimbriefLink } from '@opc/shared';
import { fetchPlan } from './api-simbrief.ts';
import { ApiError } from './errors.ts';
import { errorText } from './error-text.ts';
import { button, icon } from './components.ts';
import { fmt } from './format.ts';
import { t } from './i18n.ts';
import type { Ctx } from './screen.ts';
import { dispatchFor, isConnected, planState } from './simbrief-view.ts';
import { h, notify } from './ui.ts';

/** `open()` is what key B does: the SimBrief dispatch page in a new tab, or the SimBrief settings when nothing is connected. Null when this flight has no SimBrief id (not a player's flight). */
export function simbriefBlock(f: Flight, link: SimbriefLink, ctx: Ctx, registration: string | undefined): { node: HTMLElement; open: () => void } | null {
  const { company } = ctx.snap.me;
  const url = dispatchFor(f, company, registration);
  if (url === null) return null;
  const connected = isConnected(link);
  const plan = planState(f);
  const open = connected ? (): void => { window.open(url, '_blank', 'noopener,noreferrer'); } : (): void => ctx.go('#settings/simbrief');

  const generate = button(connected ? t('sb.generate') : t('sb.connectFirst'), { variant: 'secondary', icon: connected ? 'plane-takeoff' : 'link', key: 'B', onclick: open });
  const fetchBtn = button(plan.kind === 'fetched' ? t('sb.refetchPlan') : t('sb.fetchPlan'), { variant: 'ghost', icon: 'refresh-cw', onclick: async () => {
    fetchBtn.disabled = true;
    try {
      await fetchPlan(f.id);
      notify(t('sb.planFetched'));
      await ctx.refresh();
    } catch (e) {
      notify(e instanceof ApiError && e.code === 'ofp_mismatch' ? t('sb.mismatch', { detail: e.message }) : errorText(e), 'error');
    } finally {
      fetchBtn.disabled = false;
    }
  } });

  const fm = fmt();
  const status = !connected ? t('sb.card.notConnected')
    : plan.kind === 'fetched' ? [t('sb.card.fetched', { id: plan.ofpId }), plan.fuelKg === null ? null : t('sb.card.fuel', { fuel: fm.kg(plan.fuelKg) })].filter((x) => x !== null).join(' · ')
      : t('sb.card.none');
  const node = h('div', { class: 'sb-card', role: 'group', 'aria-label': t('sb.card.title') },
    h('div', { class: 'row tight' }, icon('file-text', 14), h('span', { class: 'fact-label' }, t('sb.card.title'))),
    h('p', { class: plan.kind === 'fetched' ? 'small' : 'dim small', role: 'status' }, status),
    connected && plan.kind === 'none' ? h('p', { class: 'dim small' }, t('sb.card.signin')) : null,
    h('div', { class: 'row' }, generate, connected ? fetchBtn : null));
  return { node, open };
}
