import login from './design/scenes/generated.webp';
import settings from './design/scenes/generated-1.webp';
import dashboard from './design/scenes/generated-2.webp';
import jobs from './design/scenes/generated-3.webp';
import job from './design/scenes/generated-4.webp';
import catalogue from './design/scenes/generated-5.webp';
import fleet from './design/scenes/generated-6.webp';
import history from './design/scenes/generated-7.webp';
import flight from './design/scenes/generated-8.webp';
import leaderboard from './design/scenes/generated-9.webp';
import ai from './design/scenes/generated-10.webp';
import bridge from './design/scenes/generated-13.webp';

/** Static backdrops standing in for the mockup's real-time 3D scene; the file each screen uses is the one the mockup frame uses. */
export const SCENES = { login, settings, dashboard, jobs, job, catalogue, fleet, history, flight, leaderboard, ai, bridge } as const;
export type SceneId = keyof typeof SCENES;

/** Kept alive so the browser holds on to the decoded pixels of every backdrop. */
const images = new Map<SceneId, { img: HTMLImageElement; ready: Promise<void> }>();

/** Fetch and decode a backdrop ahead of use, so showing it never waits on the image. Resolves (never rejects) once decoded or failed: a missing backdrop must not block a screen. */
export function decodeScene(id: SceneId): Promise<void> {
  let entry = images.get(id);
  if (!entry) {
    const img = new Image();
    img.src = SCENES[id];
    entry = { img, ready: img.decode().then(() => undefined, () => undefined) };
    images.set(id, entry);
  }
  return entry.ready;
}

export const preloadScenes = (): Promise<void> => Promise.all((Object.keys(SCENES) as SceneId[]).map(decodeScene)).then(() => undefined);
