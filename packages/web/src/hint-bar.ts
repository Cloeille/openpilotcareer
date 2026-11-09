import { keycap } from './components.ts';
import { t } from './i18n.ts';
import type { Hint } from './screen.ts';
import { h } from './ui.ts';

/** One key a hint legend stands for: `legend` is what the keycap shows, `key` and `code` are the fields of the KeyboardEvent a real press carries. */
type Press = { legend: string; key: string; code: string };

const named = (legend: string, key: string, code = key): Press => ({ legend, key, code });
const letter = (c: string): Press => named(c, c.toLowerCase(), `Key${c.toUpperCase()}`);
const digit = (c: string): Press => named(c, c, `Digit${c}`);

/** The key presses a hint legend stands for, one per keycap; null when the legend is not a key (the mouse). */
function pressesOf(legend: string): Press[] | null {
  if (legend === t('key.esc')) return [named(legend, 'Escape')];
  if (legend === t('key.enter')) return [named(legend, 'Enter')];
  if (legend === t('key.space')) return [named(legend, ' ', 'Space')];
  if (legend === '← →') return [named('←', 'ArrowLeft'), named('→', 'ArrowRight')];
  if (legend === '↑ ↓') return [named('↑', 'ArrowUp'), named('↓', 'ArrowDown')];
  if (legend === '/') return [named('/', '/', 'Slash')];
  if (/^[a-z]$/i.test(legend)) return [letter(legend)];
  if (/^\d$/.test(legend)) return [digit(legend)];
  const range = /^(\d) – (\d)$/.exec(legend);
  if (range) {
    const [from, to] = [Number(range[1]), Number(range[2])];
    return Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => digit(String(from + i)));
  }
  return null;
}

const CLICKABLE = 'data-hint-key';

/** What Enter and Space do natively on a focused control; a script-made keydown does not trigger it, so `pressKey` does. */
const NATIVE_ACTIVATION: Readonly<Record<string, string>> = { Enter: 'button, a[href], summary', ' ': 'button, summary' };

/**
 * Press `p` as if typed: a keydown on the element that had the focus (the body when nothing, or the hint itself after Tab and Enter, did), so a screen's own
 * handlers and the global input layer see exactly what a real key press gives them. Never dispatched on the hint button, which is not clicked again by it.
 * When nothing claimed an Enter or Space on a focused button or link, it presses it, as the browser does for a real key.
 */
function pressKey(p: Press): void {
  const active = document.activeElement;
  const target = active instanceof HTMLElement && !active.hasAttribute(CLICKABLE) ? active : document.body;
  const unclaimed = target.dispatchEvent(new KeyboardEvent('keydown', { key: p.key, code: p.code, bubbles: true, cancelable: true }));
  const native = NATIVE_ACTIVATION[p.key];
  if (unclaimed && native && target.matches(native)) target.click();
}

/** Keeps a pointer press from taking the focus: the focused row stays focused, so Enter opens it and the arrows step from it. */
const keepFocus = (e: MouseEvent): void => e.preventDefault();

const clickProps = (p: Press, label: string) =>
  ({ type: 'button', [CLICKABLE]: '', 'aria-label': `${label} (${p.legend})`, onmousedown: keepFocus, onclick: () => pressKey(p) });

/** The Q / E keycaps next to the tabs, and any lone keycap acting as a key. */
export function keyButton(legend: string, label: string): HTMLElement {
  const [p] = pressesOf(legend) ?? [];
  if (!p) return keycap(legend);
  return h('button', { ...clickProps(p, label), class: 'keycap hint-key', title: label }, legend);
}

/**
 * A hint of the bottom bar. A single key makes the whole hint one button (keycap and label), a composite legend ('← →', '1 – 4') one keycap button per key
 * beside the label; what is not a key (the mouse) stays plain text. Every button does what pressing its key does.
 */
export function hintItem({ key, label }: Hint): HTMLElement {
  const presses = pressesOf(key);
  if (!presses) return h('span', { class: 'hint' }, keycap(key), label);
  const [only] = presses;
  if (presses.length === 1 && only) return h('button', { ...clickProps(only, label), class: 'hint hint-btn' }, keycap(key), label);
  return h('span', { class: 'hint' }, h('span', { class: 'hint-keys' }, presses.map((p) => h('button', { ...clickProps(p, label), class: 'keycap hint-key' }, p.legend))), label);
}
