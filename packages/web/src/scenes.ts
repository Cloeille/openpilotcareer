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
import facility from './design/scenes/generated-14.webp';
import hubs from './design/scenes/generated-15.webp';
import finance from './design/scenes/generated-11.webp';

/** The plain dark backdrop of the live-flight screens (the mockup draws them on a radial gradient, not a photo). */
const plain = `data:image/svg+xml,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1600 900'><defs><radialGradient id='g' cx='50%' cy='58%' r='70%'><stop offset='0' stop-color='#18202B'/><stop offset='1' stop-color='#0B0F15' stop-opacity='0'/></radialGradient></defs><rect width='1600' height='900' fill='#07090C'/><rect width='1600' height='900' fill='url(#g)'/></svg>")}`;

/** Static backdrops standing in for the mockup's real-time 3D scene; the file each screen uses is the one the mockup frame uses. */
export const SCENES = { login, settings, dashboard, jobs, job, catalogue, fleet, history, flight, leaderboard, ai, bridge, facility, hubs, plain, finance } as const;
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
