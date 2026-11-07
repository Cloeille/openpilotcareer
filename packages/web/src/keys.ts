/** Keyboard and gamepad vocabulary of the mockup (Q / E tabs, Esc back, Enter primary, arrows in lists), as pure functions. */
export type Action = 'prev' | 'next' | 'back' | 'blur' | 'confirm' | 'up' | 'down';

type KeyLike = { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; repeat?: boolean };

/** A key held down fires again and again; only the arrows (stepping through a list or days) are meant to repeat. Everything else, Space (pause) and Enter included, acts once per press. */
const held = (e: KeyLike): boolean => e.repeat === true && !e.key.startsWith('Arrow');

/** The action a key press stands for. While the player types in a field letters and arrows reach the field, and Esc only leaves it ('blur'): a second Esc goes back. */
export function keyAction(e: KeyLike, typing: boolean): Action | null {
  if (e.ctrlKey || e.metaKey || e.altKey || held(e)) return null;
  if (e.key === 'Escape') return typing ? 'blur' : 'back';
  if (typing) return null;
  switch (e.key) {
    case 'q': case 'Q': return 'prev';
    case 'e': case 'E': return 'next';
    case 'ArrowUp': return 'up';
    case 'ArrowDown': return 'down';
    case 'Enter': return 'confirm';
    default: return null;
  }
}

/**
 * The screen-specific shortcut a key press stands for, outside a field: a bare letter or digit, `/`, ← → ('left' / 'right'), `F1` ('f1') and Space ('space'). Lower-cased; Q and E stay with the tab cycle unless a screen claims them.
 * `Tab` is never bound: it stays the browser's focus key, so each `Tab` action of the mockup is a letter instead (B.10 of docs/v3-plan.md).
 * Space is left alone when `onControl` (focus is on a button, link or switch), because those use it natively.
 */
export function shortcutOf(e: KeyLike, typing: boolean, onControl = false): string | null {
  if (typing || e.ctrlKey || e.metaKey || e.altKey || held(e)) return null;
  switch (e.key) {
    case 'ArrowLeft': return 'left';
    case 'ArrowRight': return 'right';
    case 'F1': return 'f1';
    case ' ': return onControl ? null : 'space';
    default: return /^[a-z0-9/]$/i.test(e.key) ? e.key.toLowerCase() : null;
  }
}

/** Standard-mapping gamepad: A = Enter, B = Esc, LB / RB = Q / E, d-pad = arrows. */
export const PAD_BUTTONS: Readonly<Record<number, Action>> = { 0: 'confirm', 1: 'back', 4: 'prev', 5: 'next', 12: 'up', 13: 'down' };
/** Pad buttons that trigger a screen shortcut (see `shortcutOf`): d-pad left / right. */
export const PAD_SHORTCUTS: Readonly<Record<number, string>> = { 14: 'left', 15: 'right' };

/** The tab `dir` steps away from `current`, wrapping around; from a screen outside the cycle, the first (next) or last (prev) tab. */
export function cycleTab(tabs: readonly string[], current: string | null, dir: 1 | -1): string {
  const i = current === null ? -1 : tabs.indexOf(current);
  if (i === -1) return tabs[dir === 1 ? 0 : tabs.length - 1]!;
  return tabs[(i + dir + tabs.length) % tabs.length]!;
}

/** Index of the row to focus after an arrow press; clamps at both ends and starts at the first row when none is focused. */
export function stepRow(count: number, focused: number, dir: 1 | -1): number {
  if (count === 0) return -1;
  if (focused < 0) return 0;
  return Math.min(count - 1, Math.max(0, focused + dir));
}

/** `#job/J-1` -> { name: 'job', arg: 'J-1' }; the argument is URL-decoded. */
export function parseHash(hash: string): { name: string; arg: string | null } {
  const [name = '', ...rest] = hash.replace(/^#/, '').split('/');
  const raw = rest.join('/');
  let arg: string | null = null;
  try { arg = raw === '' ? null : decodeURIComponent(raw); } catch { arg = null; }
  return { name, arg };
}

export const hashFor = (name: string, arg?: string | number): string => `#${name}${arg === undefined ? '' : `/${encodeURIComponent(String(arg))}`}`;
