import { PAD_BUTTONS, PAD_SHORTCUTS, cycleTab, keyAction, shortcutOf, stepRow, type Action } from './keys.ts';
import { TABS, type Screen, type Tab } from './screen.ts';

/** What the input layer needs to know about the screen on display. `null` = no HUD (login, loading). */
export type NavState = (Pick<Screen, 'back' | 'keys'> & { tab: Tab | 'settings' | null }) | null;
export type Nav = { state: () => NavState; go: (hash: string) => void };

/** Elements that act on Enter and Space themselves; a screen's shortcut or primary action must not steal those keys from them. */
const CONTROL = 'button, a, summary, input, select, textarea';
const TYPING = 'input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea, select, [contenteditable=true]';

function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-row]')];
}

/** Run one action; returns true when it did something (so the caller can cancel the browser's default). */
function run(action: Action, nav: Nav, target: Element | null): boolean {
  const state = nav.state();
  switch (action) {
    case 'blur':
      (target as HTMLElement | null)?.blur();
      return true;
    case 'prev': case 'next': {
      if (!state) return false;
      nav.go(`#${cycleTab(TABS, TABS.includes(state.tab as Tab) ? state.tab : null, action === 'next' ? 1 : -1)}`);
      return true;
    }
    case 'back': {
      if (!state) return false;
      if (typeof state.back === 'function') { state.back(); return true; }
      const to = state.back ?? (state.tab !== 'dashboard' ? '#dashboard' : null);
      if (to === null) return false;
      nav.go(to);
      return true;
    }
    case 'up': case 'down': {
      const list = rows();
      if (list.length === 0) return false;
      const i = list.indexOf(target?.closest<HTMLElement>('[data-row]') as HTMLElement);
      list[stepRow(list.length, i, action === 'down' ? 1 : -1)]!.focus();
      return true;
    }
    case 'confirm': {
      // Enter on a control keeps its native meaning; on a focused row it opens it; elsewhere it presses the screen's primary button.
      if (target?.closest(CONTROL)) return false;
      const row = target?.closest<HTMLElement>('[data-row]');
      const press = row ?? document.querySelector<HTMLButtonElement>('[data-primary]:not(:disabled)');
      if (!press) return false;
      press.click();
      return true;
    }
  }
}

/** Keyboard and gamepad drive the same actions: Q / E tabs, Esc back, Enter primary, arrows in lists. */
export function installInput(nav: Nav): void {
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    const target = e.target instanceof Element ? e.target : null;
    const typing = !!target?.matches(TYPING);
    const shortcut = nav.state()?.keys?.[shortcutOf(e, typing, !!target?.closest(CONTROL)) ?? ''];
    if (shortcut) { e.preventDefault(); shortcut(); return; }
    const action = keyAction(e, typing);
    if (action && run(action, nav, target)) e.preventDefault();
  });

  // Standard-mapping pads only, polled while one is connected; a button fires on press, not while held.
  const held = new Set<number>();
  let polling = false;
  const poll = (): void => {
    const pad = [...navigator.getGamepads()].find((p) => p?.connected);
    if (!pad) { polling = false; held.clear(); return; }
    pad.buttons.forEach((b, i) => {
      const action = PAD_BUTTONS[i];
      const shortcut = PAD_SHORTCUTS[i];
      if (!action && !shortcut) return;
      if (b.pressed && !held.has(i)) {
        held.add(i);
        if (action) run(action, nav, document.activeElement);
        else nav.state()?.keys?.[shortcut!]?.();
      }
      else if (!b.pressed) held.delete(i);
    });
    requestAnimationFrame(poll);
  };
  window.addEventListener('gamepadconnected', () => { if (!polling) { polling = true; requestAnimationFrame(poll); } });
}
