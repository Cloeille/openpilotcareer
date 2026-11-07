import { POLL_MS } from './live-view.ts';

const stops = new Map<string, () => void>();
/** The element is built before the shell attaches it: give it this many beats to appear before giving up. */
const ATTACH_BEATS = 3;

/** Run `tick` every `everyMs` (POLL_MS by default) while `el` is on screen and the page is visible. One poller per key: starting it again stops the previous one, and it stops by itself once `el` has left the page. A failed tick is retried at the next beat (a lost connection is the shell's business). */
export function pollWhileShown(key: string, el: HTMLElement, tick: () => Promise<void>, everyMs = POLL_MS): void {
  stops.get(key)?.();
  let seen = false;
  let waited = 0;
  let busy = false;
  const stop = (): void => { window.clearInterval(id); document.removeEventListener('visibilitychange', wake); if (stops.get(key) === stop) stops.delete(key); };
  const run = async (): Promise<void> => {
    if (!el.isConnected) {
      if (seen || ++waited > ATTACH_BEATS) stop();
      return;
    }
    seen = true;
    if (document.hidden || busy) return;
    busy = true;
    try { await tick(); } catch { /* next beat */ } finally { busy = false; }
  };
  const wake = (): void => { if (!document.hidden) void run(); };
  const id = window.setInterval(() => void run(), everyMs);
  stops.set(key, stop);
  document.addEventListener('visibilitychange', wake);
}
