import { SCOPES, type Scope } from '@opc/shared';
import { segments } from './components.ts';
import { t } from './i18n.ts';

/** The scope a screen reads, from the hash query (`#finance/ledger?scope=group`): the company on its own unless the address says the group. */
export const scopeOf = (query: URLSearchParams): Scope => SCOPES.find((s) => s === query.get('scope')) ?? 'company';

/** Keep `scope` in the address (replacing the entry: the toggle is not a page to go back to) and redraw the screen on it. */
export function setScope(scope: Scope): void {
  const [route = ''] = location.hash.split('?', 1);
  history.replaceState(null, '', scope === 'group' ? `${route}?scope=group` : route || '#');
  window.dispatchEvent(new Event('opc:redraw'));
}

/** `This company / Including subsidiaries`: the app's segmented control. Shown only for a company that has subsidiaries. `before` runs ahead of the redraw (a screen resets its paging there). */
export const scopeToggle = (scope: Scope, before?: () => void): HTMLElement =>
  segments(t('scope.label'), SCOPES.map((value) => ({ value, label: t(`scope.${value}`) })), scope, (value) => { before?.(); setScope(value); });
