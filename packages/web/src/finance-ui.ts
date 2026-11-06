import type { Airport } from '@opc/shared';
import { cityOf } from './airports.ts';
import { ApiError } from './errors.ts';
import { errorText } from './error-text.ts';
import { getLang, t, tp } from './i18n.ts';
import { messageFor } from './messages.ts';
import { h, notify } from './ui.ts';

/** Small DOM pieces shared by the finance screens (lease, purchase, starter list). */

export const locale = (): string => (getLang() === 'fr' ? 'fr-FR' : 'en-GB');

export type HubChoice = { icao: string; airport: Airport | null; free: number | null; main: boolean };

/** "Base d'attache": one radio per hub; a hub without a free parking space is listed but cannot be picked. */
export function hubPicker(name: string, label: string, hubs: HubChoice[], selected: string, onChange: (icao: string) => void): HTMLElement {
  return h('div', { class: 'hub-pick', role: 'radiogroup', 'aria-label': label }, hubs.map((hub) => {
    const full = hub.free === 0;
    const parts: string[] = [];
    if (hub.main) parts.push(t('fin.buy.mainHub'));
    if (full) parts.push(t('fin.buy.hubFull'));
    else if (hub.free !== null) parts.push(tp('fin.buy.hubSpots', hub.free));
    const id = `${name}-${hub.icao}`;
    return h('label', { class: full ? 'full' : '', for: id },
      h('input', { type: 'radio', name, id, value: hub.icao, checked: hub.icao === selected, disabled: full, onchange: () => onChange(hub.icao) }),
      h('span', { class: 'code' }, hub.icao),
      h('span', { class: 'stack' }, h('span', { class: 'name' }, hub.airport ? hub.airport.name : hub.icao), parts.length ? h('span', { class: 'sub' }, parts.join(' · ')) : null));
  }));
}

export const hubCity = (a: Airport | null, icao: string): string => (a ? cityOf(a) : icao);

/** Localised label of a ledger kind, falling back to the raw kind. */
export function chargeKind(kind: string): string {
  const key = messageFor(`fin.kind.${kind}`);
  return key ? t(key) : kind;
}

const RELOAD_ON = new Set(['hub_full', 'insufficient_funds', 'aircraft_busy']);
/** Run a finance action: announce the outcome, reload the shell on success or when the screen showed something that is no longer true (a hub that filled up, a balance that changed). */
export async function perform<T>(fn: () => Promise<T>, done: (r: T) => string, after: () => Promise<void>): Promise<boolean> {
  try {
    const r = await fn();
    notify(done(r));
    await after();
    return true;
  } catch (e) {
    notify(errorText(e), 'error');
    if (e instanceof ApiError && RELOAD_ON.has(e.code)) await after().catch(() => undefined);
    return false;
  }
}

/** Enter on a focused radio confirms the screen (the global handler leaves Enter on controls alone, the mockup's key hint promises it). */
export function enterConfirms(root: HTMLElement, confirm: () => void): void {
  root.addEventListener('keydown', (e) => {
    const target = e.target as Element | null;
    if (e.key === 'Enter' && target instanceof HTMLInputElement && target.type === 'radio') { e.preventDefault(); confirm(); }
  });
}

/** Redraw with `fn` and put the focus back on the element that had it (matched by id). */
export function keepFocus(fn: () => void): void {
  const id = document.activeElement?.id;
  fn();
  if (id) document.getElementById(id)?.focus();
}

export const dateLong = (ms: number): string => new Intl.DateTimeFormat(locale(), { timeZone: 'UTC', day: 'numeric', month: 'long' }).format(ms);
