import { FINANCE_SCREENS, type FinanceScreen } from '@opc/shared';
import type { CashView } from '@opc/shared';
import { icon, keycap, panel } from './components.ts';
import { doorCard } from './facilities-ui.ts';
import { fmt } from './format.ts';
import { t } from './i18n.ts';
import type { Hint } from './screen.ts';
import { SCREEN_HASH, SCREEN_KEY, screenKey } from './reports-view.ts';
import { h } from './ui.ts';

/** Where Esc leads from the first report: the company screen, where the door to the finances is. */
export const FINANCE_HOME = '#hubs';

/** Shown when the server has no finance reports routes (404): the screen says so instead of failing. */
export const reportsOff = (): HTMLElement => h('div', { class: 'ln-off panel' }, h('div', { class: 'panel-body' }, icon('wallet', 20), h('h1', { class: 'ln-off-title' }, t('rp.off.title')), h('p', { class: 'muted' }, t('rp.off.body'))));

/** The four report screens as one row of buttons; the digit on each is its key. */
export const reportNav = (current: FinanceScreen, go: (hash: string) => void): HTMLElement =>
  h('div', { class: 'segments rp-nav', role: 'group', 'aria-label': t('rp.nav.label') }, FINANCE_SCREENS.map((s) =>
    h('button', { type: 'button', class: 'seg', 'aria-pressed': String(s === current), onclick: () => { if (s !== current) go(SCREEN_HASH[s]); } }, h('span', null, t(SCREEN_KEY[s])), keycap(screenKey(s)))));

/** The digit keys that jump between the four reports. */
export const reportKeys = (current: FinanceScreen, go: (hash: string) => void): Record<string, () => void> =>
  Object.fromEntries(FINANCE_SCREENS.filter((s) => s !== current).map((s) => [screenKey(s), () => go(SCREEN_HASH[s])]));

/** The hints at the bottom of every report: Esc leads back (to the company from the cash screen, to the cash screen from the others), the digits to the other reports. */
export const reportHints = (current: FinanceScreen, ...own: Hint[]): Hint[] => [{ key: t('key.esc'), label: current === 'cash' ? t('st.hint.company') : t('rp.nav.cash') }, ...own, { key: '1 – 4', label: t('rp.hint.reports') }];

/** A signed amount that reads green or red. */
export const signedMoney = (n: number): HTMLElement => h('span', { class: n > 0 ? 'rp-pos' : n < 0 ? 'rp-neg' : '' }, fmt().signedMoney(n));

/** One figure of the header: label, big value, a line under it. */
export const figure = (label: string, value: string | HTMLElement, sub: string | HTMLElement | null, tone: 'warn' | null = null): HTMLElement =>
  h('div', { class: `rp-figure${tone ? ` ${tone}` : ''}` }, h('span', { class: 'rp-label' }, label), h('span', { class: 'rp-value' }, value), sub ? h('span', { class: 'rp-sub' }, sub) : null);

/** A bar with a share of a whole (categories, cost parts). */
export const shareBar = (label: string, amount: string, share: number, tone: 'in' | 'out' | 'warn' = 'out'): HTMLElement =>
  h('li', { class: 'rp-share' }, h('span', { class: 'rp-share-label' }, label), h('span', { class: 'rp-share-amount mono' }, amount),
    h('span', { class: `rp-share-bar ${tone}`, role: 'presentation' }, h('i', { style: `width:${Math.round(Math.min(1, Math.max(0, share)) * 100)}%` })));

/** The next debits, shared by the cash screen and the statement (its "next scheduled posting"). */
export function upcomingPanel(cash: Pick<CashView, 'upcoming' | 'upcomingTotal'>, categoryLabel: (c: CashView['upcoming'][number]) => string): HTMLElement {
  const fm = fmt();
  return panel({ title: t('rp.c.upcoming'), action: cash.upcoming.length > 0 ? signedMoney(cash.upcomingTotal) : null, id: 'rp-upcoming' },
    cash.upcoming.length === 0 ? h('p', { class: 'dim' }, t('rp.c.upcoming.none'))
      : h('ul', { class: 'plain rp-upcoming' }, cash.upcoming.map((u) => h('li', { class: 'line' },
        h('span', { class: 'line-label' }, h('span', { class: 'rp-date mono dim' }, fm.date(u.at)), ' ', categoryLabel(u)), h('span', { class: 'line-value strong' }, signedMoney(u.amount))))));
}

/** The door to the finance reports on the company screen (`C`); no card when the server has none. */
export function financeEntry(cash: Pick<CashView, 'balance'> | null, go: (hash: string) => void): HTMLElement | null {
  if (!cash) return null;
  return doorCard({ id: 'rp-entry', title: t('rp.entry.title'), tag: t('rp.entry.tag'), body: t('rp.entry.body', { balance: fmt().money(cash.balance) }), open: t('rp.entry.open'), icon: 'wallet', key: 'C', onopen: () => go('#finance') });
}
