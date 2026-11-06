import type { Me } from '@opc/shared';
import type { SceneId } from './scenes.ts';

/** The tabs of the Q / E cycle, in HUD order. Settings is reached from the gear and is outside the cycle. */
export const TABS = ['dashboard', 'jobs', 'fleet', 'history', 'leaderboard'] as const;
export type Tab = (typeof TABS)[number];

export type Hint = { key: string; label: string };

/** What a route renders: the content plus the chrome around it (backdrop, highlighted tab, key hints, where Esc leads). */
export type Screen = {
  title: string;
  scene: SceneId;
  /** Highlighted HUD tab; 'settings' lights the gear. */
  tab: Tab | 'settings' | null;
  hints: Hint[];
  /** Hash that Esc navigates to; null = Esc does nothing here. */
  back: string | null;
  view: HTMLElement;
};

export type Ctx = {
  me: Me;
  /** Route argument: `#job/J-1` -> 'J-1'. */
  arg: string | null;
  /** Reload `me` and redraw the current screen. */
  refresh: () => Promise<void>;
  go: (hash: string) => void;
};
export type ScreenFn = (ctx: Ctx) => Promise<Screen> | Screen;
