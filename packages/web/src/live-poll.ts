import { POLL_MS } from './live-view.ts';

const stops = new Map<string, () => void>();

/** Run `tick` every POLL_MS while `el` is on screen and the page is visible. One poller per key: starting it again stops the previous one, and it stops by itself once `el` has left the page. A failed tick is retried at the next beat (a lost connection is the shell's business). */
export function pollWhileShown(key: string, el: HTMLElement, tick: () => Promise<void>): void {
  stops.get(key)?.();
  let seen = false;
  let waited = 0;
  let busy = false;
  const stop = (): void => { window.clearInterval(id); document.removeEventListener('visibilitychange', wake); if (stops.get(key) === stop) stops.delete(key); };
  const run = async (): Promise<void> => {
    if (el.isConnected) seen = true;
    else if (seen || ++waited > 3) return stop();
    if (document.hidden || busy) return;
    busy = true;
    try { await tick(); } catch { /* next beat */ } finally { busy = false; }
  };
  const wake = (): void => { if (!document.hidden) void run(); };
  const id = window.setInterval(() => void run(), POLL_MS);
  stops.set(key, stop);
  document.addEventListener('visibilitychange', wake);
}
