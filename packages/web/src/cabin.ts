import type { AircraftType } from '@opc/shared';

// Cabin plan of the "Cabine & charge" view, in the spirit of docs/design/scripts/cabin-layout.js (single deck, one class).
// The API gives seats and a category, not a seat map: the configuration is derived from the type, and the screen says so ("estimé").

export type CabinConfig = {
  seats: number;
  /** Seats per group across the aircraft, `2-2`, `3-3`, `3-4-3`; a lone number has no aisle. */
  pattern: string;
  rows: number;
  /** Seats in the last row (the rest are full rows). */
  lastRow: number;
  lavs: number;
  galleys: number;
  doors: number;
  /** Cabin crew drawn at the doors. */
  crew: number;
  cockpit: boolean;
};

const SMALL_CABIN_SEATS = 10;
const SERVICE_MIN_SEATS = 30;
const REGIONAL_MAX_SEATS = 110;

const sum = (pattern: string): number => pattern.split('-').reduce((a, n) => a + Number(n), 0);

function patternOf(a: Pick<AircraftType, 'category' | 'seats'>): string {
  if (a.seats <= SMALL_CABIN_SEATS) return a.category === 'jet-business' || a.category === 'turboprop-multi' ? '1-1' : '2';
  switch (a.category) {
    case 'jet-widebody': return a.seats >= 250 ? '3-4-3' : '2-4-2';
    case 'jet-airliner': return a.seats <= REGIONAL_MAX_SEATS ? '2-2' : '3-3';
    case 'jet-business': return '1-1';
    default: return '2-2';
  }
}

export function deriveCabin(a: Pick<AircraftType, 'category' | 'seats'>): CabinConfig {
  const seats = Math.max(0, a.seats);
  const pattern = patternOf(a);
  const perRow = sum(pattern);
  const rows = Math.max(1, Math.ceil(seats / perRow));
  const service = seats >= SERVICE_MIN_SEATS;
  return {
    seats, pattern, rows, lastRow: seats - (rows - 1) * perRow,
    lavs: service ? Math.max(1, Math.round(seats / 70)) : 0,
    galleys: service ? (seats <= 120 ? 1 : seats <= 220 ? 2 : 3) : 0,
    doors: !service ? 1 : seats <= 100 ? 2 : seats <= 250 ? 4 : 6,
    crew: service ? Math.min(2, Math.ceil(seats / 60)) : 0,
    cockpit: service,
  };
}

/** Which seats are taken, spread over the cabin the same way every time for one flight (a seeded shuffle, not Math.random). */
export function occupiedSeats(total: number, taken: number, seed: number): boolean[] {
  const order = Array.from({ length: total }, (_, i) => i);
  let state = (seed * 2654435761) >>> 0 || 1;
  const next = (): number => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state / 4294967296; };
  for (let i = total - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [order[i], order[j]] = [order[j]!, order[i]!]; }
  const flags = new Array<boolean>(total).fill(false);
  for (const i of order.slice(0, Math.max(0, Math.min(total, taken)))) flags[i] = true;
  return flags;
}

// ------------------------------------------------------------------ geometry (metres, then fitted to pixels)

const SEAT_W = 1.0;
const SEAT_PITCH = 1.25;
const AISLE = 0.9;
const WALL = 0.8;

export type Rect = { x: number; y: number; w: number; h: number };
export type CabinSeat = Rect & { taken: boolean };
export type CabinService = Rect & { kind: 'lav' | 'galley' };
export type CabinLayout = {
  width: number; height: number;
  /** Closed outline of the fuselage as an SVG path. */
  hull: string;
  seats: CabinSeat[]; services: CabinService[];
  doors: { x: number; w: number; top: number; bottom: number }[];
  pilots: Rect[]; crew: Rect[];
  /** Cargo zone (a freight job): where the load is. */
  hold: Rect | null;
  wallPx: number;
};

type Item =
  | { t: 'cockpit' } | { t: 'door' } | { t: 'crew'; n: number } | { t: 'hold' }
  | { t: 'service'; lav: boolean; galley: boolean } | { t: 'seats'; rows: number; lastRow?: number };

/** The order of things along the cabin: cockpit, front door, crew, seat blocks interleaved with galleys and lavatories, rear door. */
export function cabinItems(c: CabinConfig, freight: boolean): Item[] {
  const items: Item[] = [];
  if (c.cockpit) items.push({ t: 'cockpit' });
  if (freight) items.push({ t: 'hold' });
  if (c.doors > 0) items.push({ t: 'door' });
  if (c.crew > 0) items.push({ t: 'crew', n: c.crew });
  if (c.galleys > 0 || c.lavs > 0) items.push({ t: 'service', lav: c.lavs > 0, galley: c.galleys > 0 });
  const blocks = Math.max(1, Math.min(c.doors - 1, 3));
  let left = c.rows;
  for (let b = 0; b < blocks; b++) {
    const take = b === blocks - 1 ? left : Math.ceil(left / (blocks - b));
    const isLast = b === blocks - 1;
    items.push({ t: 'seats', rows: take, ...(isLast && c.lastRow < sum(c.pattern) ? { lastRow: c.lastRow } : {}) });
    left -= take;
    if (!isLast) items.push({ t: 'door' });
  }
  const extra = Math.max(0, c.lavs - 1);
  if (extra > 0 || c.galleys > 1) items.push({ t: 'service', lav: extra > 0, galley: c.galleys > 1 });
  if (c.doors > 1) items.push({ t: 'door' });
  return items;
}

export function layoutCabin(c: CabinConfig, taken: boolean[], freight: boolean, width: number, height: number): CabinLayout {
  const groups = c.pattern.split('-').map(Number);
  const perRow = sum(c.pattern);
  const secW = perRow * SEAT_W + AISLE * (groups.length - 1);
  const D = Math.max(3.4, secW) + 2 * WALL;
  const seats: CabinSeat[] = [];
  const services: CabinService[] = [];
  const doors: { x: number; w: number }[] = [];
  const pilots: Rect[] = [];
  const crew: Rect[] = [];
  let hold: Rect | null = null;
  const noseLen = 1.2 * D;
  let x = c.cockpit ? noseLen * 0.5 : noseLen * 0.95;
  let seatIndex = 0;
  for (const el of cabinItems(c, freight)) {
    switch (el.t) {
      case 'cockpit':
        pilots.push({ x: x + 1.0, y: D / 2 - 1.05, w: 1.0, h: 1.0 }, { x: x + 1.0, y: D / 2 + 0.05, w: 1.0, h: 1.0 });
        x += 2.8;
        break;
      case 'hold':
        hold = { x: x + 0.2, y: WALL + 0.1, w: 2.8, h: D - 2 * WALL - 0.2 };
        x += 3.2;
        break;
      case 'crew':
        crew.push({ x: x + 0.15, y: WALL * 0.45, w: 0.7, h: 0.7 });
        if (el.n > 1) crew.push({ x: x + 0.15, y: D - WALL * 0.45 - 0.7, w: 0.7, h: 0.7 });
        x += 1.0;
        break;
      case 'door':
        doors.push({ x: x + 0.2, w: 1.0 });
        x += 1.4;
        break;
      case 'service': {
        if (el.galley) services.push({ kind: 'galley', x: x + 0.2, y: WALL, w: 2.0, h: 2.6 });
        if (el.lav) services.push({ kind: 'lav', x: x + 0.2, y: D - WALL - 1.9, w: 1.9, h: 1.9 });
        x += 2.4;
        break;
      }
      case 'seats': {
        const y0 = (D - secW) / 2;
        for (let r = 0; r < el.rows; r++) {
          const inRow = r === el.rows - 1 && el.lastRow ? el.lastRow : perRow;
          let y = y0;
          let idx = 0;
          for (const g of groups) {
            for (let s = 0; s < g; s++) {
              if (idx < inRow) seats.push({ x: x + 0.2 + r * SEAT_PITCH, y: y + SEAT_W * 0.09, w: SEAT_PITCH * 0.62, h: SEAT_W * 0.82, taken: taken[seatIndex++] ?? false });
              y += SEAT_W;
              idx++;
            }
            y += AISLE;
          }
        }
        x += el.rows * SEAT_PITCH + 0.4;
        break;
      }
    }
  }
  const tailStart = Math.max(noseLen, x + 0.3);
  const length = tailStart + 1.6 * D;
  const sc = Math.min(44, (width * 0.97) / length, height / D);
  const ox = (width - length * sc) / 2;
  const oy = (height - D * sc) / 2;
  const r1 = (n: number): number => Math.round(n * 10) / 10;
  const P = (u: number, v: number): string => `${r1(ox + u * sc)} ${r1(oy + v * sc)}`;
  const hw = D / 2;
  const th = D * 0.06;
  const hull = `M${P(0, hw)}C${P(0, hw * 0.42)} ${P(noseLen * 0.36, 0)} ${P(noseLen, 0)}L${P(tailStart, 0)}`
    + `C${P(tailStart + (length - tailStart) * 0.5, 0)} ${P(length - (length - tailStart) * 0.1, hw - th * 1.6)} ${P(length, hw - th)}L${P(length, hw + th)}`
    + `C${P(length - (length - tailStart) * 0.1, hw + th * 1.6)} ${P(tailStart + (length - tailStart) * 0.5, D)} ${P(tailStart, D)}L${P(noseLen, D)}C${P(noseLen * 0.36, D)} ${P(0, hw * 1.58)} ${P(0, hw)}Z`;
  const px = (r: Rect): Rect => ({ x: r1(ox + r.x * sc), y: r1(oy + r.y * sc), w: r1(r.w * sc), h: r1(r.h * sc) });
  return {
    width, height, hull, wallPx: r1(WALL * sc),
    seats: seats.map((s) => ({ ...px(s), taken: s.taken })),
    services: services.map((s) => ({ ...px(s), kind: s.kind })),
    doors: doors.map((d) => ({ x: r1(ox + d.x * sc), w: r1(d.w * sc), top: r1(oy), bottom: r1(oy + D * sc) })),
    pilots: pilots.map(px), crew: crew.map(px), hold: hold ? px(hold) : null,
  };
}
