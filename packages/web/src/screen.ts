import type { Snapshot } from './snapshot.ts';
import type { SceneId } from './scenes.ts';

/** The tabs of the Q / E cycle, in HUD order. A tab id is also its route name (the HUD links to `#<tab>`). Settings is reached from the gear and is outside the cycle. */
export const TABS = ['dashboard', 'live', 'jobs', 'network', 'fleet', 'hubs', 'history', 'leaderboard'] as const;
export type Tab = (typeof TABS)[number];

export type Hint = { key: string; label: string };

/** What a route renders: the content plus the chrome around it (backdrop, highlighted tab, key hints, where Esc leads). */
export type Screen = {
  title: string;
  scene: SceneId;
  /** Highlighted HUD tab; 'settings' lights the gear. */
  tab: Tab | 'settings' | null;
  hints: Hint[];
  /** Where Esc leads: a hash, an action, or null (a tab: Esc returns to the dashboard). */
  back: string | (() => void) | null;
  /** Single-key shortcuts of this screen (lower-case letter -> action), matching the key hints. They win over Q / E. */
  keys?: Record<string, () => void>;
  /** Full-width layout with the generous margins of the dashboard (64 px) instead of the 32 px content margins. */
  wide?: boolean;
  view: HTMLElement;
};

export type Ctx = {
  /** Everything loaded at the last refresh: the account (`snap.me`), the job board and the last flight. */
  snap: Snapshot;
  /** Route argument: `#job/J-1` -> 'J-1'. */
  arg: string | null;
  /** Reload `me` and redraw the current screen. */
  refresh: () => Promise<void>;
  go: (hash: string) => void;
};
export type ScreenFn = (ctx: Ctx) => Promise<Screen> | Screen;
