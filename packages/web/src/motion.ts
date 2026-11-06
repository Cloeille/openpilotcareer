/** Timing and direction rules of the UI motion, as pure functions (the CSS in motion.css owns the visuals). */

/** How a screen enters: null = no animation (same-screen redraw), 0 = rises 8 px, -1 / 1 = slides in from the left / right. */
export type Slide = -1 | 0 | 1;

/** A route that takes longer than this to load shows the skeleton; a faster one never flashes it. */
export const LOADING_DELAY_MS = 150;
/** HUD figures (balance, reputation) count up over this long. */
export const COUNT_MS = 400;
/** Panels and rows beyond this many per screen enter together with their panel instead of one by one. */
export const STAGGER_MAX = 8;

/** True unless the player asked for reduced motion. */
export const motionOK = (): boolean => window.matchMedia('(prefers-reduced-motion: no-preference)').matches;

/** Which way a tab change slides: the next tab (E) comes from the right, the previous (Q) from the left, wrapping around the cycle. Anything outside the cycle just rises. */
export function slideDirection(from: string | null, to: string | null, tabs: readonly string[]): Slide {
  const a = from === null ? -1 : tabs.indexOf(from);
  const b = to === null ? -1 : tabs.indexOf(to);
  if (a === -1 || b === -1 || a === b) return 0;
  const n = tabs.length;
  const step = (b - a + n) % n;
  if (step === 1) return 1;
  if (step === n - 1) return -1;
  return b > a ? 1 : -1;
}

/** The value `elapsedMs` into a count from `from` to `to`: eased out, exactly `to` once `durationMs` has passed. */
export function countValue(from: number, to: number, elapsedMs: number, durationMs = COUNT_MS): number {
  if (elapsedMs >= durationMs) return to;
  const p = Math.max(0, elapsedMs) / durationMs;
  return from + (to - from) * (1 - (1 - p) ** 3);
}
