import { svg } from './svg.ts';

/**
 * The airport chart: a tilted 3D plan of one airport with its runways, aprons, parking stands and selectable buildings.
 * Port of docs/design/scripts/airport-chart.js. `buildAirportChart` is pure (data in, drawing primitives out, so it is unit-tested); `drawAirportChart` turns the primitives into SVG with `svg()`.
 * What changed from the script: the buildings' names, kinds and owners come from the API (the layout only places a slot), the parking stands are as many as the hub has spaces and are coloured from the spaces in use, and the chart reports what was clicked.
 * The geometry of the airports is client data, as AIRCRAFT is in schematic.ts: an airport the table below does not know has no chart and the screen falls back to its list.
 */

export type ChartOwner = 'airport' | 'player' | 'ai' | 'available';
export type ChartFilter = string;
export type Rect = { x: number; y: number; w: number; d: number };
type Slot = Rect & { slot: string; h: number };
export type Layout = {
  /** The land outline, metres. X runs along the runways, Y goes inland (the sea is at negative Y). */
  land: [number, number][];
  runways: (Rect & { ends: [string, string] })[];
  taxiways: Rect[];
  aprons: Rect[];
  /** Where the parking stands go: one row, `n` stands sharing `width`. */
  stands: { x: number; y: number; width: number; d: number; maxPitch: number };
  buildings: Slot[];
};

const LFMN: Layout = {
  land: [[-250, -330], [3350, -330], [3350, 900], [-250, 900]],
  runways: [
    { x: 100, y: -190, w: 2960, d: 45, ends: ['04R', '22L'] },
    { x: 350, y: 40, w: 2570, d: 45, ends: ['04L', '22R'] },
  ],
  taxiways: [
    { x: 200, y: 150, w: 2800, d: 23 },
    ...[400, 1000, 1700, 2400, 2900].map((x) => ({ x, y: -145, w: 23, d: 295 })),
  ],
  aprons: [
    { x: 280, y: 190, w: 400, d: 180 },
    { x: 700, y: 190, w: 750, d: 210 },
    { x: 1500, y: 190, w: 550, d: 180 },
    { x: 2100, y: 190, w: 750, d: 220 },
    { x: 2900, y: 190, w: 250, d: 130 },
  ],
  stands: { x: 725, y: 230, width: 700, d: 90, maxPitch: 105 },
  buildings: [
    { slot: 'T1', x: 760, y: 410, w: 620, d: 150, h: 22 },
    { slot: 'T2', x: 2150, y: 420, w: 660, d: 170, h: 26 },
    { slot: 'VIP', x: 2920, y: 330, w: 200, d: 100, h: 12 },
    { slot: 'MX1', x: 1540, y: 380, w: 230, d: 140, h: 32 },
    { slot: 'MX2', x: 1800, y: 380, w: 220, d: 140, h: 32 },
    { slot: 'CG1', x: 300, y: 380, w: 320, d: 150, h: 18 },
    { slot: 'AD', x: 1480, y: 610, w: 160, d: 90, h: 36 },
    { slot: 'OPS', x: 1680, y: 610, w: 120, d: 90, h: 20 },
    { slot: 'TWR', x: 1380, y: 560, w: 36, d: 36, h: 64 },
    { slot: 'FUEL', x: 620, y: 650, w: 140, d: 90, h: 10 },
  ],
};

/** The drawn airports, by the `layout` key the server answers with. */
export const LAYOUTS: Record<string, Layout> = { LFMN };

export type ChartBuilding = { slot: string; name: string; kind: string; owner: ChartOwner; ownerName?: string };
export type ChartInput = {
  layout: Layout; buildings: ChartBuilding[];
  /** Parking spaces of the hub and how many the player uses; null draws none. */
  stands: { spots: number; used: number } | null;
  selected: string | null;
  /** `all`, or the kind of building that stays lit. */
  filter: ChartFilter;
  size: { w: number; h: number };
  /** The status words of the tags. */
  text: { yours: string; available: string };
  yaw?: number; elevation?: number; heightScale?: number; labels?: boolean;
};

/** The mockup's framing (the Pen frame's inputs for the hub plan). */
export const DEFAULT_VIEW = { yaw: -24, elevation: 44, heightScale: 3 };
const CENTRE = { x: 1550, y: 280 };
const TAG_ROWS = 3;
const TAG_ROW_H = 52;
const TAG_H = 44;
const PAD_TOP_LABELS = 150;
const DIM = 0.25;
const TAG_GAP = 10;
const SHIFT_MAX = 60;

type Pt = { x: number; y: number };
const r1 = (n: number): number => Math.round(n * 10) / 10;
const poly = (pts: Pt[]): string => pts.map((p, i) => `${i ? 'L' : 'M'}${r1(p.x)} ${r1(p.y)}`).join('') + 'Z';
const PAL: Record<ChartOwner, { top: string; front: string; side: string; stroke: string }> = {
  airport: { top: '#2E333B', front: '#24282F', side: '#1C2026', stroke: '#FFFFFF14' },
  player: { top: '#ECEAE5', front: '#B9B7B2', side: '#8E8C88', stroke: '#FFFFFF40' },
  ai: { top: '#5A5F66', front: '#474B51', side: '#383B40', stroke: '#FFFFFF1F' },
  available: { top: '#E6BE4C40', front: '#E6BE4C2B', side: '#E6BE4C1F', stroke: '#E6BE4C' },
};
const SELECTED = 'var(--text-primary)';

export type ChartPrim =
  | { kind: 'path'; name: string; d: string; fill?: string; stroke?: string; width?: number; opacity?: number }
  | { kind: 'stand'; id: string; d: string; owner: 'player' | 'available'; opacity: number }
  | { kind: 'solid'; slot: string; name: string; faces: { d: string; fill: string }[]; roof: string; roofFill: string; stroke: string; width: number; opacity: number }
  | { kind: 'runway'; name: string; x: number; y: number; text: string }
  | { kind: 'quiet'; slot: string; x: number; y: number; text: string; opacity: number }
  | { kind: 'tag'; slot: string; x: number; y: number; w: number; h: number; name: string; status: string; tone: 'yours' | 'available' | 'ai'; selected: boolean; opacity: number; anchor: Pt };

export type ChartScene = {
  w: number; h: number; prims: ChartPrim[];
  /** The slots drawn, left to right on the screen: the order the arrow keys step through. */
  order: string[];
};

type Placed = { x: number; w: number; row: number };
/**
 * Where a tag of width `w` that would like to sit at `want` goes: the first row (top down) where it fits without moving more than SHIFT_MAX,
 * else the (row, x) that moves it least. On a row a tag that collides is pushed to the right of what it hits, left of the right edge.
 * Never overlaps a tag already placed on the same row (a tag that fits nowhere on any row would be dropped by the caller's three-row band, which the buildings of one airport do not fill).
 */
export function slotFor(placed: readonly Placed[], want: number, w: number, W: number): { x: number; row: number } {
  let best: { x: number; row: number; shift: number } | null = null;
  for (let row = 0; row < TAG_ROWS; row++) {
    const mine = placed.filter((q) => q.row === row).sort((p, q) => p.x - q.x);
    let x = want;
    for (const q of mine) if (x < q.x + q.w + TAG_GAP && q.x < x + w + TAG_GAP) x = q.x + q.w + TAG_GAP;
    if (x + w > W) {
      // No room to the right: try to the left of the first tag it hits.
      x = want;
      for (const q of [...mine].reverse()) if (x < q.x + q.w + TAG_GAP && q.x < x + w + TAG_GAP) x = q.x - w - TAG_GAP;
      if (x < 0 || mine.some((q) => x < q.x + q.w + TAG_GAP && q.x < x + w + TAG_GAP)) continue;
    }
    const shift = Math.abs(x - want);
    if (shift <= SHIFT_MAX) return { x, row };
    if (!best || shift < best.shift) best = { x, row, shift };
  }
  return best ?? { x: want, row: TAG_ROWS - 1 };
}

export function buildAirportChart(input: ChartInput): ChartScene {
  const { layout: A, size, filter } = input;
  const W = size.w, H = size.h;
  const yaw = (((input.yaw ?? DEFAULT_VIEW.yaw)) * Math.PI) / 180;
  const el = (((input.elevation ?? DEFAULT_VIEW.elevation)) * Math.PI) / 180;
  const hs = Math.max(1, input.heightScale ?? DEFAULT_VIEW.heightScale);
  const labels = input.labels !== false;
  const sel = input.selected ?? '';
  const info = new Map(input.buildings.map((b) => [b.slot, b]));
  // Only the slots the server knows are drawn: the layout places them, the server says what they are.
  const blds = A.buildings.filter((b) => info.has(b.slot)).map((b) => ({ ...b, h: b.h * hs, info: info.get(b.slot)! }));

  // Oblique projection: rotate around Z (yaw), then look down at `elevation` degrees.
  const proj = (x: number, y: number, z: number): { u: number; v: number; d: number } => {
    const dx = x - CENTRE.x, dy = y - CENTRE.y;
    const yr = dx * Math.sin(yaw) + dy * Math.cos(yaw);
    return { u: dx * Math.cos(yaw) - dy * Math.sin(yaw), v: yr * Math.sin(el) - z * Math.cos(el), d: yr };
  };

  // Fit everything, leaving room above for the tags.
  const probe: { u: number; v: number }[] = [];
  for (const b of blds) for (const [x, y] of [[b.x - 80, b.y - 60], [b.x + b.w + 80, b.y - 60], [b.x + b.w + 80, b.y + b.d + 60], [b.x - 80, b.y + b.d + 60]] as const) probe.push(proj(x, y, 0), proj(x, y, b.h));
  for (const a of A.aprons) probe.push(proj(a.x, a.y, 0), proj(a.x + a.w, a.y + a.d, 0));
  const us = probe.map((p) => p.u), vs = probe.map((p) => p.v);
  const umin = Math.min(...us), umax = Math.max(...us), vmin = Math.min(...vs), vmax = Math.max(...vs);
  const pad = 10, padTop = labels ? PAD_TOP_LABELS : 10;
  const sc = Math.min((W - 2 * pad) / (umax - umin), (H - padTop - pad) / (vmax - vmin));
  const ox = pad + (W - 2 * pad - (umax - umin) * sc) / 2 - umin * sc;
  const oy = padTop + (H - padTop - pad - (vmax - vmin) * sc) / 2 - vmin * sc;
  const S = (x: number, y: number, z = 0): Pt & { d: number } => { const p = proj(x, y, z); return { x: ox + p.u * sc, y: oy + p.v * sc, d: p.d }; };
  const rect = (x: number, y: number, w: number, d: number, z = 0): string => poly([S(x, y, z), S(x + w, y, z), S(x + w, y + d, z), S(x, y + d, z)]);

  const prims: ChartPrim[] = [];
  const path = (name: string, d: string, o: Omit<Extract<ChartPrim, { kind: 'path' }>, 'kind' | 'name' | 'd'>): void => { prims.push({ kind: 'path', name, d, ...o }); };

  // Ground: land, aprons, taxiways, runways.
  path('ground', poly(A.land.map((p) => S(p[0], p[1]))), { fill: '#10151C' });
  path('aprons', A.aprons.map((a) => rect(a.x, a.y, a.w, a.d)).join(''), { fill: '#1A2029' });
  path('taxiways', A.taxiways.map((q) => rect(q.x, q.y, q.w, q.d)).join(''), { fill: '#1C222A' });
  let centre = '';
  for (const q of A.taxiways) centre += q.w > q.d ? rect(q.x, q.y + q.d / 2 - 0.8, q.w, 1.6) : rect(q.x + q.w / 2 - 0.8, q.y, 1.6, q.d);
  path('taxiway lines', centre, { fill: '#E6BE4C', opacity: 0.45 });
  path('runways', A.runways.map((r) => rect(r.x, r.y, r.w, r.d)).join(''), { fill: '#262B33' });
  let marks = '';
  for (const r of A.runways) {
    for (let x = r.x + 120; x < r.x + r.w - 120; x += 90) marks += rect(x, r.y + r.d / 2 - 0.9, 45, 1.8);
    for (const end of [r.x + 12, r.x + r.w - 42]) for (let k = 0; k < 6; k++) marks += rect(end, r.y + 4 + k * 6.6, 30, 3);
  }
  path('markings', marks, { fill: '#C9CBCE', opacity: 0.55 });

  const dim = (kind: string): number => (filter !== 'all' && kind !== filter ? DIM : 1);

  // Parking stands, drawn flat on the apron.
  if (input.stands && input.stands.spots > 0) {
    const { spots, used } = input.stands;
    const g = A.stands;
    const pitch = Math.min(g.maxPitch, g.width / spots);
    for (let i = 0; i < spots; i++) {
      prims.push({ kind: 'stand', id: `PK${i + 1}`, d: rect(g.x + i * pitch, g.y, pitch * 0.67, g.d), owner: i < used ? 'player' : 'available', opacity: dim('parking') });
    }
  }

  // Buildings, far to near.
  const anchors: { b: (typeof blds)[number]; x: number; y: number }[] = [];
  for (const b of [...blds].sort((p, q) => S(p.x + p.w / 2, p.y + p.d / 2).d - S(q.x + q.w / 2, q.y + q.d / 2).d)) {
    const owner = b.info.owner, p = PAL[owner], isSel = b.slot === sel;
    const c: [number, number][] = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.d], [b.x, b.y + b.d]];
    const faces: { d: string; fill: string }[] = [];
    for (let i = 0; i < 4; i++) {
      const a0 = c[i]!, a1 = c[(i + 1) % 4]!;
      const nx = a1[1] - a0[1], ny = -(a1[0] - a0[0]);
      if (nx * Math.sin(yaw) + ny * Math.cos(yaw) > 0) faces.push({ d: poly([S(a0[0], a0[1]), S(a1[0], a1[1]), S(a1[0], a1[1], b.h), S(a0[0], a0[1], b.h)]), fill: Math.abs(ny) > Math.abs(nx) ? p.front : p.side });
    }
    prims.push({ kind: 'solid', slot: b.slot, name: b.info.name, faces, roof: poly(c.map((q) => S(q[0], q[1], b.h))), roofFill: p.top, stroke: isSel ? SELECTED : p.stroke, width: isSel ? 2 : 1, opacity: dim(b.info.kind) });
    const top = S(b.x + b.w / 2, b.y + b.d / 2, b.h);
    anchors.push({ b, x: top.x, y: top.y });
  }

  if (labels) {
    for (const r of A.runways) {
      const a = S(r.x - 60, r.y + r.d / 2), z = S(r.x + r.w + 25, r.y + r.d / 2);
      prims.push({ kind: 'runway', name: `runway ${r.ends[0]}`, x: a.x - 14, y: a.y - 8, text: r.ends[0] }, { kind: 'runway', name: `runway ${r.ends[1]}`, x: z.x - 4, y: z.y - 8, text: r.ends[1] });
    }
    // Tags for what matters to the player, quiet text for the airport's own buildings. Tags live in a band above the chart, on up to three rows, each tied to its roof by a vertical leader.
    const placed: Placed[] = [];
    let leaders = '';
    const tags: ChartPrim[] = [];
    for (const a of [...anchors].sort((p, q) => p.x - q.x)) {
      const { info: bi } = a.b, o = dim(bi.kind);
      if (bi.owner === 'airport') { prims.push({ kind: 'quiet', slot: a.b.slot, x: a.x - bi.name.length * 3.1, y: a.y - 22, text: bi.name, opacity: o }); continue; }
      const status = bi.owner === 'ai' ? (bi.ownerName ?? '') : bi.owner === 'player' ? input.text.yours : input.text.available;
      const w = Math.max(bi.name.length * 7.1, status.length * 6.4) + 24;
      const want = Math.max(0, Math.min(W - w, Math.round(a.x - 16)));
      const { x, row } = slotFor(placed, want, w, W);
      const y = row * TAG_ROW_H;
      placed.push({ x, w, row });
      // The leader runs from the roof to the nearest point of the tag's bottom edge, so a tag pushed aside by its neighbours stays tied to its building.
      leaders += `M${r1(a.x)} ${r1(a.y)}L${r1(Math.max(x + 8, Math.min(x + w - 8, a.x)))} ${r1(y + TAG_H)}`;
      tags.push({ kind: 'tag', slot: a.b.slot, x, y, w, h: TAG_H, name: bi.name, status, tone: bi.owner === 'ai' ? 'ai' : bi.owner === 'player' ? 'yours' : 'available', selected: a.b.slot === sel, opacity: o, anchor: { x: a.x, y: a.y } });
    }
    if (leaders) path('leaders', leaders, { stroke: '#FFFFFF59', width: 1 });
    prims.push(...tags);
  }
  return { w: W, h: H, prims, order: [...anchors].sort((p, q) => p.x - q.x).map((a) => a.b.slot) };
}

export type ChartHandlers = { onSelect: (id: string) => void };

/** The scene as SVG. A building is clickable for the mouse; the keyboard goes through the screen (←→ and the list view), so the drawing itself is one labelled image. Stands are drawn, not selectable: they are the hub's parking spaces, not buildings. */
export function drawAirportChart(scene: ChartScene, label: string, on: ChartHandlers): SVGSVGElement {
  const root = svg('svg', { viewBox: `0 0 ${scene.w} ${scene.h}`, class: 'airport-chart', role: 'img', 'aria-label': label, preserveAspectRatio: 'xMidYMid meet' });
  const pick = (id: string) => (): void => on.onSelect(id);
  for (const p of scene.prims) {
    switch (p.kind) {
      case 'path':
        root.append(svg('path', { d: p.d, fill: p.fill ?? 'none', stroke: p.stroke ?? 'none', 'stroke-width': p.width, opacity: p.opacity, 'stroke-linejoin': 'round' }));
        break;
      case 'stand': {
        const free = p.owner === 'available';
        root.append(svg('path', { d: p.d, fill: free ? '#E6BE4C1A' : '#ECEAE51A', stroke: free ? '#E6BE4C' : '#ECEAE566', 'stroke-width': 1, opacity: p.opacity }));
        break;
      }
      case 'solid': {
        const g = svg('g', { class: 'ac-hit', opacity: p.opacity, 'data-slot': p.slot });
        for (const f of p.faces) g.append(svg('path', { d: f.d, fill: f.fill, stroke: p.stroke, 'stroke-width': p.width, 'stroke-linejoin': 'round' }));
        g.append(svg('path', { d: p.roof, fill: p.roofFill, stroke: p.stroke, 'stroke-width': p.width, 'stroke-linejoin': 'round' }));
        g.addEventListener('click', pick(p.slot));
        root.append(g);
        break;
      }
      case 'runway':
        root.append(svg('text', { x: r1(p.x), y: r1(p.y) + 11, class: 'ac-text runway' }, p.text));
        break;
      case 'quiet':
        root.append(svg('text', { x: r1(p.x), y: r1(p.y) + 11, class: 'ac-text quiet', opacity: p.opacity }, p.text));
        break;
      case 'tag': {
        const g = svg('g', { class: `ac-tag ac-hit ${p.tone}${p.selected ? ' selected' : ''}`, opacity: p.opacity, 'data-slot': p.slot });
        g.append(
          svg('rect', { x: p.x, y: p.y, width: p.w, height: p.h, rx: 4, class: 'ac-tag-box' }),
          svg('text', { x: p.x + 10, y: p.y + 20, class: 'ac-text name' }, p.name),
          svg('text', { x: p.x + 10, y: p.y + 36, class: 'ac-text status' }, p.status),
          svg('circle', { cx: r1(p.anchor.x), cy: r1(p.anchor.y), r: 3, class: 'ac-anchor' }));
        g.addEventListener('click', pick(p.slot));
        root.append(g);
        break;
      }
    }
  }
  return root;
}
