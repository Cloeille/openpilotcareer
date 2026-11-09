import { GEO_BORDERS, GEO_LAND } from './network-geo.ts';
import { svg } from './svg.ts';

/**
 * The network map: a tilted, perspective view of the region with each line drawn as a 3D arc between its airports and the aircraft flying it right now.
 * Port of docs/design/scripts/network-map.js. `buildNetworkMap` is pure (data in, drawing primitives out, so it is unit-tested); `drawNetworkMap` turns the primitives into SVG with `svg()`.
 * What changed from the script: airports, lines and flights come from the API instead of constants; the map centre, the arc heights, the label sides and the aircraft tags are derived instead of written by hand.
 */

/** `sub`: a hub of one of the player's subsidiaries (a group view). */
export type MapAirport = { icao: string; city: string; lat: number; lon: number; hub?: 'player' | 'rival' | 'sub' };
export type MapLine = {
  /** `sub`: a line of one of the player's subsidiaries (a group view): drawn like the player's, dimmer. */
  id: string; a: string; b: string; owner: 'player' | 'sub' | 'rival'; state: 'ok' | 'delayed' | 'interrupted';
  /** A rival line on a pair the player flies too. */
  contested?: boolean;
  /** The player's lines while the rival network is shown. */
  dim?: boolean;
};
export type MapFlight = {
  reg: string; info: string; late?: string; from: string; to: string; t: number;
  /** `me` is the player's own flight; `player` and `rival` are autonomous. */
  owner: 'player' | 'sub' | 'me' | 'rival';
  /** Id of the line it flies; null for a flight that follows no line (the player's own job). */
  line: string | null;
};
export type MapCamera = { azimuth: number; elevation: number; distance: number };
export type MapBox = { left: number; top: number; right: number; bottom: number };
export type MapInput = {
  airports: MapAirport[]; lines: MapLine[]; flights: MapFlight[]; selected?: string | null;
  /** Airports that frame the map (the network being looked at). Lines of the other network are drawn only when both their ends land inside the picture; default: every airport. */
  focus?: readonly string[];
  camera?: MapCamera; fit: MapBox; size: { w: number; h: number };
  text: { interrupted: string; contested: string };
};

/** The mockup's framing (the Pen frame's inputs). */
export const DEFAULT_CAMERA: MapCamera = { azimuth: 50, elevation: 40, distance: 30 };
const PLATE = { side: 7, near: 4, far: 6 };
/** Smallest framed span (projected units), so a map of one airport does not blow up. */
const MIN_SPAN = 0.1;

type Pt = { x: number; y: number };
type Side = 'above' | 'below' | 'left' | 'right';
const rad = (d: number): number => (d * Math.PI) / 180;
const r1 = (n: number): number => Math.round(n * 10) / 10;
export const pathOf = (pts: Pt[], close = false): string => pts.map((p, i) => `${i ? 'L' : 'M'}${r1(p.x)} ${r1(p.y)}`).join('') + (close ? 'Z' : '');

/** The arc height of a line relative to its length; `slot` is its rank in the list. */
export const arcHeight = (slot: number, contested = false): number => 0.12 + 0.04 * (slot % 3) + (contested ? 0.1 : 0);
/** Height of an arc of relative height `k` over a ground length `len`, at `t` of the way along it: a sine. */
export const arcLift = (len: number, k: number, t: number): number => k * len * Math.sin(Math.PI * t);

/** Dash a polyline into `on` / `off` pixel runs. */
export function dashed(pts: Pt[], on: number, off: number): string {
  let g = '';
  let acc = 0;
  let drawing = true;
  let seg: Pt[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1]!;
    const b = pts[i]!;
    let d = Math.hypot(b.x - a.x, b.y - a.y);
    while (d > 0) {
      const room = (drawing ? on : off) - acc;
      if (d <= room) { acc += d; if (drawing) seg.push(b); d = 0; }
      else {
        const t = room / d;
        const m = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        if (drawing) { seg.push(m); g += pathOf(seg); }
        drawing = !drawing;
        acc = 0;
        seg = [m];
        a = m;
        d = Math.hypot(b.x - a.x, b.y - a.y);
      }
    }
  }
  if (drawing && seg.length > 1) g += pathOf(seg);
  return g;
}

const decodeRings = (s: string): [number, number][][] => s.split(';').map((ring) => ring.split(' ').map((q) => { const [lon, lat] = q.split(',').map(Number); return [lon!, lat!] as [number, number]; }));
const LAND = decodeRings(GEO_LAND);
const BORDERS = decodeRings(GEO_BORDERS);

export type Prim =
  | { kind: 'fade'; id: string; color: string; hold: number; cx: number; cy: number; rx: number; ry: number }
  | { kind: 'path'; name: string; d: string; stroke?: string; fill?: string; width?: number; opacity?: number; round?: boolean; glow?: string }
  | { kind: 'ellipse'; name: string; cx: number; cy: number; rx: number; ry: number; fill?: string; stroke?: string; opacity?: number }
  | { kind: 'plane'; name: string; x: number; y: number; size: number; heading: number; color: string }
  | { kind: 'label'; name: string; x: number; y: number; side: Side; lines: { text: string; cls: 'code' | 'code-hub' | 'city' | 'flag-danger' | 'flag-warn' }[]; flagIcon?: 'circle-x' | 'swords' }
  | { kind: 'tag'; name: string; x: number; y: number; side: Side; reg: string; info: string; late?: string; mine: boolean };

export type MapScene = { w: number; h: number; prims: Prim[]; /** Screen position of each airport, for tests and hit areas. */ airports: Map<string, Pt>; focus: Pt };

const COL = { line: '#ECEAE5', sub: 'var(--text-secondary)', rival: '#9A9DA2', danger: 'var(--danger)', warning: 'var(--warning)', route: 'var(--route)' } as const;

export function buildNetworkMap(input: MapInput): MapScene {
  const { airports, lines, flights, fit, size } = input;
  const cam = input.camera ?? DEFAULT_CAMERA;
  const el = rad(cam.elevation), az = rad(cam.azimuth), DC = cam.distance;
  const ap = new Map(airports.map((a) => [a.icao, a]));
  const known = (code: string): boolean => ap.has(code);

  // Plane coordinates in degrees of latitude, centred on the network; then a camera orbiting at azimuth `az` and looking down at `el`.
  const focus = input.focus ? airports.filter((a) => input.focus!.includes(a.icao)) : airports;
  const lons = focus.map((a) => a.lon), lats = focus.map((a) => a.lat);
  const LON0 = lons.length ? (Math.min(...lons) + Math.max(...lons)) / 2 : 0;
  const LAT0 = lats.length ? (Math.min(...lats) + Math.max(...lats)) / 2 : 0;
  const KX = Math.cos(rad(LAT0));
  const toRF = (lon: number, lat: number): [number, number] => {
    const X = (lon - LON0) * KX, Y = lat - LAT0;
    return [X * Math.cos(az) - Y * Math.sin(az), X * Math.sin(az) + Y * Math.cos(az)];
  };
  const camRF = (r: number, f: number, z: number): Pt => {
    const fr = f + DC * Math.cos(el), zr = z - DC * Math.sin(el);
    const yc = fr * Math.sin(el) + zr * Math.cos(el), zc = fr * Math.cos(el) - zr * Math.sin(el);
    return { x: r / zc, y: -yc / zc };
  };
  const apRF = (code: string): [number, number] => toRF(ap.get(code)!.lon, ap.get(code)!.lat);
  const arcPoint = (a: string, b: string, k: number, t: number): [number, number, number] => {
    const A = apRF(a), B = apRF(b);
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, arcLift(len, k, t)];
  };

  // Arc heights come from the line's rank in the list, so lines that share a city pair (yours and a rival's) never coincide.
  const framed = (l: { a: string; b: string }): boolean => !input.focus || (input.focus.includes(l.a) && input.focus.includes(l.b));
  const placed = lines.filter((l) => known(l.a) && known(l.b)).map((l, i) => ({ ...l, k: arcHeight(i, l.contested) }));

  // Fit the airports and arcs of the framed network into the fit box.
  const probe: Pt[] = [];
  for (const a of focus) { const p = toRF(a.lon, a.lat); probe.push(camRF(p[0], p[1], 0)); }
  for (const l of placed) if (framed(l)) for (let i = 0; i <= 10; i++) { const p = arcPoint(l.a, l.b, l.k, i / 10); probe.push(camRF(p[0], p[1], p[2])); }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of probe) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  if (!probe.length) { x0 = y0 = -MIN_SPAN / 2; x1 = y1 = MIN_SPAN / 2; }
  const spanX = Math.max(x1 - x0, MIN_SPAN), spanY = Math.max(y1 - y0, MIN_SPAN);
  const sc = Math.min((fit.right - fit.left) / spanX, (fit.bottom - fit.top) / spanY);
  const ox = (fit.left + fit.right) / 2 - ((x0 + x1) / 2) * sc;
  const oy = (fit.top + fit.bottom) / 2 - ((y0 + y1) / 2) * sc;
  const SR = (r: number, f: number, z: number): Pt => { const p = camRF(r, f, z); return { x: ox + p.x * sc, y: oy + p.y * sc }; };
  const S = (lon: number, lat: number, z = 0): Pt => { const p = toRF(lon, lat); return SR(p[0], p[1], z); };
  const onGround = (code: string): Pt => S(ap.get(code)!.lon, ap.get(code)!.lat);

  // Lines of the other network are kept only when they fall inside the picture: a far-away line would draw an arc to nowhere.
  const inside = (code: string): boolean => { const p = onGround(code); return p.x >= 0 && p.x <= size.w && p.y >= 0 && p.y <= size.h; };
  const drawn = placed.filter((l) => framed(l) || (inside(l.a) && inside(l.b)));
  const byId = new Map(drawn.map((l) => [l.id, l]));

  // Plate: a camera-aligned rectangle of ground around the network.
  const net = focus.map((a) => toRF(a.lon, a.lat));
  const PL = net.length
    ? { r0: Math.min(...net.map((p) => p[0])) - PLATE.side, r1: Math.max(...net.map((p) => p[0])) + PLATE.side, f0: Math.min(...net.map((p) => p[1])) - PLATE.near, f1: Math.max(...net.map((p) => p[1])) + PLATE.far }
    : { r0: -PLATE.side, r1: PLATE.side, f0: -PLATE.near, f1: PLATE.far };
  const inPlate = (p: [number, number]): boolean => p[0] >= PL.r0 && p[0] <= PL.r1 && p[1] >= PL.f0 && p[1] <= PL.f1;
  const clipEdge = (poly: [number, number][], axis: 0 | 1, val: number, keepGreater: boolean): [number, number][] => {
    const out: [number, number][] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
      const ia = keepGreater ? a[axis] >= val : a[axis] <= val;
      const ib = keepGreater ? b[axis] >= val : b[axis] <= val;
      if (ia) out.push(a);
      if (ia !== ib) { const t = (val - a[axis]) / (b[axis] - a[axis]); out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]); }
    }
    return out;
  };
  const clipPlate = (poly: [number, number][]): [number, number][] => {
    let p = poly;
    for (const [axis, val, g] of [[0, PL.r0, true], [0, PL.r1, false], [1, PL.f0, true], [1, PL.f1, false]] as const) {
      if (p.length < 3) return [];
      p = clipEdge(p, axis, val, g);
    }
    return p;
  };
  const splitInside = (pts: [number, number][]): [number, number][][] => {
    const runs: [number, number][][] = [];
    let cur: [number, number][] = [];
    for (const p of pts) { if (inPlate(p)) cur.push(p); else { if (cur.length > 1) runs.push(cur); cur = []; } }
    if (cur.length > 1) runs.push(cur);
    return runs;
  };
  const flat = (run: [number, number][]): Pt[] => run.map((p) => SR(p[0], p[1], 0));

  const prims: Prim[] = [];
  const fc = { x: (fit.left + fit.right) / 2, y: (fit.top + fit.bottom) / 2 };
  const fade = (id: string, color: string, hold: number, sw: number, sh: number): Prim => ({ kind: 'fade', id, color, hold, cx: fc.x, cy: fc.y, rx: ((fit.right - fit.left) * sw) / 2, ry: ((fit.bottom - fit.top) * sh) / 2 });
  prims.push(fade('pool', '#06080B', 0.5, 2.1, 2.9));
  prims.push({ kind: 'path', name: 'pool', d: `M0 0L${size.w} 0L${size.w} ${size.h}L0 ${size.h}Z`, fill: 'url(#nm-pool)', opacity: 0.95 });

  // Graticule every 2 degrees.
  let grat = '';
  for (let lon = Math.floor(LON0 / 2) * 2 - 24; lon <= LON0 + 24; lon += 2) {
    const pts: [number, number][] = [];
    for (let lat = LAT0 - 20; lat <= LAT0 + 20; lat += 0.25) pts.push(toRF(lon, lat));
    for (const run of splitInside(pts)) grat += pathOf(flat(run));
  }
  for (let lat = Math.floor(LAT0 / 2) * 2 - 20; lat <= LAT0 + 20; lat += 2) {
    const pts: [number, number][] = [];
    for (let lon = LON0 - 25; lon <= LON0 + 25; lon += 0.25) pts.push(toRF(lon, lat));
    for (const run of splitInside(pts)) grat += pathOf(flat(run));
  }
  prims.push(fade('grat', '#FFFFFF0F', 0.4, 1.7, 2.3));
  prims.push({ kind: 'path', name: 'graticule', d: grat, stroke: 'url(#nm-grat)', width: 1 });

  let land = '';
  for (const ring of LAND) { const c = clipPlate(ring.map(([lon, lat]) => toRF(lon, lat))); if (c.length > 2) land += pathOf(flat(c), true); }
  prims.push(fade('landfill', '#242A31', 0.5, 1.7, 2.3));
  prims.push(fade('landline', '#FFFFFF52', 0.45, 1.7, 2.3));
  prims.push({ kind: 'path', name: 'land', d: land, fill: 'url(#nm-landfill)', stroke: 'url(#nm-landline)', width: 1 });
  let borders = '';
  for (const line of BORDERS) for (const run of splitInside(line.map(([lon, lat]) => toRF(lon, lat)))) borders += pathOf(flat(run));
  prims.push(fade('border', '#FFFFFF21', 0.4, 1.7, 2.3));
  prims.push({ kind: 'path', name: 'borders', d: borders, stroke: 'url(#nm-border)', width: 1 });

  // Ground traces under the arcs.
  let tracks = '';
  for (const l of drawn) tracks += pathOf([onGround(l.a), onGround(l.b)]);
  prims.push({ kind: 'path', name: 'tracks', d: tracks, stroke: '#FFFFFF17', width: 1 });

  const arcPts = (a: string, b: string, k: number, t0: number, t1: number, n = 48): Pt[] => {
    const out: Pt[] = [];
    for (let i = 0; i <= n; i++) { const p = arcPoint(a, b, k, t0 + ((t1 - t0) * i) / n); out.push(SR(p[0], p[1], p[2])); }
    return out;
  };
  const labels: Prim[] = [];
  for (const l of drawn) {
    const pts = arcPts(l.a, l.b, l.k, 0, 1);
    const mine = l.owner !== 'rival';
    const sel = mine && l.id === input.selected && !l.dim;
    const name = `${l.owner === 'rival' ? 'rival' : l.owner === 'sub' ? 'subsidiary line' : 'line'} ${l.a}-${l.b}`;
    if (mine && l.state === 'interrupted') prims.push({ kind: 'path', name, d: dashed(pts, 7, 6), stroke: COL.danger, width: 2, round: true, opacity: l.dim ? 0.55 : l.owner === 'sub' ? 0.6 : 0.9 });
    else if (mine) prims.push({ kind: 'path', name, d: pathOf(pts), stroke: l.owner === 'sub' ? COL.sub : COL.line, width: sel ? 2.5 : 2, round: true, opacity: l.dim ? 0.3 : sel ? 0.75 : l.owner === 'sub' ? 0.3 : 0.42, ...(sel ? { glow: '#ECEAE5' } : {}) });
    else prims.push({ kind: 'path', name, d: pathOf(pts), stroke: l.contested ? COL.warning : COL.rival, width: 2, round: true, opacity: l.contested ? 0.95 : 0.8 });
    if (!l.dim && mine && l.state === 'interrupted') {
      const q = arcPoint(l.a, l.b, l.k, 0.62), p = SR(q[0], q[1], q[2]);
      labels.push({ kind: 'label', name: `flag ${l.id}`, x: p.x - 12, y: p.y, side: 'left', lines: [{ text: input.text.interrupted, cls: 'flag-danger' }], flagIcon: 'circle-x' });
    }
    if (l.owner === 'rival' && l.contested) {
      const q = arcPoint(l.a, l.b, l.k, 0.5), p = SR(q[0], q[1], q[2]);
      labels.push({ kind: 'label', name: `flag ${l.id}`, x: p.x, y: p.y - 14, side: 'above', lines: [{ text: input.text.contested, cls: 'flag-warn' }], flagIcon: 'swords' });
    }
  }

  // Aircraft in flight: a bright trail over the flown part, a drop line to the ground and a tag.
  type Plane = { f: MapFlight; p: Pt; gp: Pt; col: string; heading: number };
  const planes: Plane[] = [];
  let drops = '';
  for (const f of flights) {
    if (!known(f.from) || !known(f.to)) continue;
    const l = f.line === null ? undefined : byId.get(f.line);
    const mine = f.owner === 'me';
    const k = mine ? 0.24 : l?.k ?? 0.16;
    const reversed = !!l && l.a !== f.from;
    const col = mine ? COL.route : f.owner === 'rival' ? (l?.contested ? COL.warning : '#C4C6C9') : f.owner === 'sub' ? COL.sub : COL.line;
    const at = (t: number): Pt => { const p = reversed ? arcPoint(l!.a, l!.b, k, 1 - t) : arcPoint(f.from, f.to, k, t); return SR(p[0], p[1], p[2]); };
    if (mine) prims.push({ kind: 'path', name: 'own trajectory', d: pathOf(arcPts(f.from, f.to, k, 0, 1)), stroke: COL.route, width: 2, round: true, opacity: 0.4 });
    const t = Math.min(1, Math.max(0, f.t));
    const trail: Pt[] = [];
    for (let i = 0; i <= 40; i++) trail.push(at((t * i) / 40));
    prims.push({ kind: 'path', name: `flown ${f.reg}`, d: pathOf(trail), stroke: col, width: 2.5, round: true, opacity: f.owner === 'rival' ? 0.9 : 1 });
    const p = at(t), q = at(Math.min(1, t + 0.02));
    const g = reversed ? arcPoint(l!.a, l!.b, 0, 1 - t) : arcPoint(f.from, f.to, 0, t);
    const gp = SR(g[0], g[1], 0);
    drops += pathOf([p, gp]);
    planes.push({ f, p, gp, col, heading: Math.atan2(q.x - p.x, -(q.y - p.y)) });
  }
  prims.push({ kind: 'path', name: 'drops', d: drops, stroke: '#FFFFFF33', width: 1 });
  for (const pl of planes) prims.push({ kind: 'ellipse', name: `shadow ${pl.f.reg}`, cx: pl.gp.x, cy: pl.gp.y, rx: 3, ry: 1.5, fill: '#FFFFFF40' });

  // Airports, with the label on the side away from the other airports.
  const shown = new Set<string>();
  for (const l of drawn) { shown.add(l.a); shown.add(l.b); }
  for (const a of focus) if (a.hub) shown.add(a.icao);
  const where = new Map<string, Pt>();
  for (const c of shown) where.set(c, onGround(c));
  for (const c of shown) {
    const p = where.get(c)!, a = ap.get(c)!;
    prims.push({ kind: 'ellipse', name: `halo ${c}`, cx: p.x, cy: p.y, rx: 9, ry: 5, stroke: a.hub ? '#FFFFFF4D' : '#FFFFFF26' });
    prims.push({ kind: 'ellipse', name: `airport ${c}`, cx: p.x, cy: p.y, rx: 3.5, ry: 3.5, fill: a.hub === 'player' ? 'var(--accent)' : a.hub === 'sub' ? 'var(--text-secondary)' : 'var(--text-primary)' });
    const others = [...where].filter(([k]) => k !== c).map(([, q]) => q);
    const mx = others.length ? others.reduce((s, q) => s + q.x, 0) / others.length - p.x : 0, my = others.length ? others.reduce((s, q) => s + q.y, 0) / others.length - p.y : 0;
    const side: Side = Math.abs(my) * 1.4 > Math.abs(mx) ? (my > 0 ? 'above' : 'below') : mx > 0 ? 'left' : 'right';
    labels.push({ kind: 'label', name: `label ${c}`, x: p.x, y: p.y, side, lines: [{ text: c, cls: a.hub && a.hub !== 'sub' ? 'code-hub' : 'code' }, { text: a.city, cls: 'city' }] });
  }

  // Tags: the player's own flight first, then the others; each takes the first side that does not cover a tag already placed.
  const taken: Rect[] = [];
  [...planes].sort((a, b) => Number(b.f.owner === 'me') - Number(a.f.owner === 'me')).forEach((pl) => {
    prims.push({ kind: 'plane', name: pl.f.reg, x: pl.p.x, y: pl.p.y, size: pl.f.owner === 'me' ? 22 : 18, heading: pl.heading, color: pl.col });
    const w = tagWidth(pl.f.reg, pl.f.info, pl.f.late);
    const side = freeSide(pl.p, w, taken, ['above', 'below', 'right', 'left']);
    taken.push(tagBox(pl.p, side, w));
    labels.push({ kind: 'tag', name: pl.f.reg, x: pl.p.x, y: pl.p.y, side, reg: pl.f.reg, info: pl.f.info, ...(pl.f.late ? { late: pl.f.late } : {}), mine: pl.f.owner === 'me' });
  });
  prims.push(...labels);
  return { w: size.w, h: size.h, prims, airports: where, focus: fc };
}

/** Text width estimates for the label boxes (the map is drawn without measuring the DOM so it can be built anywhere). */
const MONO_W = 7.4, UI_W = 6.2;
export const tagWidth = (reg: string, info: string, late?: string): number => Math.max(reg.length * MONO_W, info.length * UI_W + (late ? late.length * UI_W + 6 : 0)) + 18;
const TAG_H = 36;
export type Rect = { x: number; y: number; w: number; h: number };
/** The box of a tag whose aircraft is at `p`, on the given side of it. */
export const tagBox = (p: Pt, side: Side, w: number): Rect => ({
  x: side === 'right' ? p.x + 16 : side === 'left' ? p.x - 16 - w : p.x - w / 2,
  y: side === 'above' ? p.y - 16 - TAG_H - 8 : side === 'below' ? p.y + 16 : p.y - 22,
  w, h: TAG_H,
});
export const overlaps = (a: Rect, b: Rect, pad = 4): boolean => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
/** The first side whose box clears every box already placed; the first choice when none does. */
export function freeSide(p: Pt, w: number, taken: readonly Rect[], order: readonly Side[]): Side {
  return order.find((s) => !taken.some((r) => overlaps(tagBox(p, s, w), r))) ?? order[0]!;
}

export function drawNetworkMap(scene: MapScene, label: string): SVGSVGElement {
  const root = svg('svg', { viewBox: `0 0 ${scene.w} ${scene.h}`, width: scene.w, height: scene.h, class: 'network-map', role: 'img', 'aria-label': label });
  const defs = svg('defs');
  root.append(defs);
  for (const p of scene.prims) {
    if (p.kind !== 'fade') continue;
    const rgb = p.color.slice(0, 7), a = alpha(p.color);
    defs.append(svg('radialGradient', { id: `nm-${p.id}`, gradientUnits: 'userSpaceOnUse', cx: 0, cy: 0, r: 1, gradientTransform: `translate(${r1(p.cx)} ${r1(p.cy)}) scale(${r1(p.rx)} ${r1(p.ry)})` },
      svg('stop', { offset: 0, 'stop-color': rgb, 'stop-opacity': a }), svg('stop', { offset: p.hold, 'stop-color': rgb, 'stop-opacity': a }), svg('stop', { offset: 1, 'stop-color': rgb, 'stop-opacity': 0 })));
  }
  const glowId = 'nm-glow';
  defs.append(svg('filter', { id: glowId, x: '-20%', y: '-20%', width: '140%', height: '140%' }, svg('feGaussianBlur', { stdDeviation: 4, result: 'b' }), svg('feMerge', {}, svg('feMergeNode', { in: 'b' }), svg('feMergeNode', { in: 'SourceGraphic' }))));
  for (const p of scene.prims) {
    switch (p.kind) {
      case 'fade': break;
      case 'path':
        if (p.d) root.append(svg('path', { d: p.d, fill: p.fill ?? 'none', stroke: p.stroke ?? 'none', 'stroke-width': p.width, 'stroke-linecap': p.round ? 'round' : null, 'stroke-linejoin': 'round', opacity: p.opacity, filter: p.glow ? `url(#${glowId})` : null }));
        break;
      case 'ellipse':
        root.append(svg('ellipse', { cx: r1(p.cx), cy: r1(p.cy), rx: p.rx, ry: p.ry, fill: p.fill ?? 'none', stroke: p.stroke ?? null, 'stroke-width': p.stroke ? 1 : null, opacity: p.opacity }));
        break;
      case 'plane':
        root.append(svg('path', { d: PLANE_PATH, fill: p.color, transform: `translate(${r1(p.x)} ${r1(p.y)}) rotate(${r1((p.heading * 180) / Math.PI)}) scale(${p.size / 24}) translate(-12 -12)`, class: 'nm-plane' }, svg('title', {}, p.name)));
        break;
      case 'label': root.append(drawLabel(p)); break;
      case 'tag': root.append(drawTag(p)); break;
    }
  }
  return root;
}

const alpha = (hex: string): number => (hex.length === 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1);

/** Material Symbols "flight": an aircraft pointing up in a 24 x 24 box. */
const PLANE_PATH = 'M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z';
const FLAG_ICON: Record<'circle-x' | 'swords', string[]> = {
  'circle-x': ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'm15 9-6 6', 'm9 9 6 6'],
  swords: ['m13 19 6-6', 'M14.5 17.5 3.586 6.5', 'M3 3v5l12 12 2-2', 'm16 16 4 4', 'm19 21 2-2'],
};

function drawLabel(p: Extract<Prim, { kind: 'label' }>): SVGElement {
  const g = svg('g', { class: `nm-label nm-${p.side}`, transform: `translate(${r1(p.x)} ${r1(p.y)})` });
  const textAnchor = p.side === 'left' ? 'end' : p.side === 'right' ? 'start' : 'middle';
  const dx = p.side === 'left' ? -14 : p.side === 'right' ? 14 : 0;
  const rows = p.lines.length;
  const first = p.side === 'above' ? -10 - (rows - 1) * 16 : p.side === 'below' ? 22 : 4 - ((rows - 1) * 16) / 2;
  if (p.flagIcon) {
    const w = p.lines[0]!.text.length * 6.6 + 19;
    const x0 = p.side === 'left' ? -w : p.side === 'above' ? -w / 2 : 0;
    const icon = svg('g', { transform: `translate(${r1(x0)} ${r1(first - 11)}) scale(${13 / 24})`, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: p.lines[0]!.cls });
    for (const d of FLAG_ICON[p.flagIcon]) icon.append(svg('path', { d }));
    g.append(icon, svg('text', { x: r1(x0 + 19), y: first, class: `nm-text ${p.lines[0]!.cls}` }, p.lines[0]!.text));
    return g;
  }
  p.lines.forEach((l, i) => g.append(svg('text', { x: dx, y: first + i * 16, 'text-anchor': textAnchor, class: `nm-text ${l.cls}` }, l.text)));
  return g;
}

function drawTag(p: Extract<Prim, { kind: 'tag' }>): SVGElement {
  const w = tagWidth(p.reg, p.info, p.late);
  const { x, y } = tagBox({ x: 0, y: 0 }, p.side, w);
  const g = svg('g', { class: `nm-tag${p.mine ? ' mine' : ''}`, transform: `translate(${r1(p.x)} ${r1(p.y)})` });
  g.append(svg('rect', { x: r1(x), y: r1(y), width: r1(w), height: TAG_H, rx: 3, class: 'nm-tag-box' }),
    svg('text', { x: r1(x + 9), y: r1(y + 15), class: 'nm-text reg' }, p.reg),
    svg('text', { x: r1(x + 9), y: r1(y + 30), class: 'nm-text info' }, p.info, p.late ? svg('tspan', { dx: 6, class: 'late' }, p.late) : null));
  return g;
}
