import { icon, inputField } from './components.ts';
import { airportInfo, cityOf } from './airports.ts';
import { isIcaoAirport } from './catalogue.ts';
import { t } from './i18n.ts';
import { debounce, h } from './ui.ts';

/** An airport-code input that tells which airport the code is (name, city, size) as soon as four letters are typed. */
export function airportField(label: string, props: Record<string, unknown> = {}): { root: HTMLElement; input: HTMLInputElement; valid: () => boolean } {
  const found = h('div', { class: 'airport-found', 'aria-live': 'polite' });
  const { root, control } = inputField({ label, icon: 'map-pin' }, { type: 'text', name: 'airport', maxlength: 4, autocomplete: 'off', spellcheck: 'false', required: true, pattern: '[A-Za-z]{4}', class: 'upper', ...props });
  let ok = false;
  const look = debounce(async () => {
    const code = control.value.trim().toUpperCase();
    ok = false;
    if (!isIcaoAirport(code)) { found.replaceChildren(); return; }
    const a = await airportInfo(code);
    if (control.value.trim().toUpperCase() !== code) return;
    ok = a !== null;
    found.replaceChildren(a ? h('span', { class: 'ok-line' }, icon('circle-check', 14), `${a.name}, ${cityOf(a)}`) : h('span', { class: 'bad-line' }, icon('circle-alert', 14), t('hub.unknown')));
  }, 200);
  control.addEventListener('input', look);
  root.append(found);
  return { root, input: control, valid: () => ok };
}
