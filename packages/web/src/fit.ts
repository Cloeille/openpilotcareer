export const STAGE_W = 1600;
export const STAGE_H = 900;

/** Scale factor that fits the fixed 1600x900 game viewport into a window (letterboxed, never cropped). */
export const fitScale = (w: number, h: number): number => Math.min(w / STAGE_W, h / STAGE_H);
