import type { CashView } from '@opc/shared';
import { button, panel } from './components.ts';
import { fmt } from './format.ts';
import { t, tp } from './i18n.ts';
import { h } from './ui.ts';

/** The door from the cash screen to the credits: what is owed, what it costs a month, and the way in (`C`). */
export function creditsEntry(debt: CashView['debt'], go: (hash: string) => void): HTMLElement {
  const fm = fmt();
  return panel({ title: t('cr.entry.title'), action: tp('cr.entry.count', debt.credits), id: 'cr-entry' },
    h('p', { class: 'muted' }, debt.credits === 0 ? t('cr.entry.none') : t('cr.entry.body', { total: fm.money(debt.total), monthly: fm.money(debt.monthly) })),
    h('div', { class: 'row' }, button(t('cr.entry.open'), { variant: 'secondary', icon: 'wallet', key: 'C', onclick: () => go('#finance/credits') })));
}
