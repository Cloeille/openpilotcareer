import type { AircraftType } from '@opc/shared';

// Generic aircraft cutaway as a 3D point cloud, ported from docs/design/scripts/aircraft-schematic.js.
// Pure geometry: buildModel() makes the 3D points once per aircraft, project() turns them into 2D dots for a view box and rotation.

export const SCHEMATIC_CATEGORIES = ['turboprop', 'regional-jet', 'narrowbody', 'widebody', 'bizjet', 'piston-single', 'piston-twin', 'helicopter'] as const;
export type SchematicCategory = (typeof SCHEMATIC_CATEGORIES)[number];

type Preset = {
  L: number; R: number; span: number; wingX: number; chord: number; taper: number; sweep: number; wing: 'high' | 'low' | 'none';
  eng: 'prop-wing' | 'jet-wing' | 'jet-tail' | 'prop-nose' | 'rotor'; n: number; engY: number[]; tail: 'T' | 'conv' | 'heli'; abreast: number; cockpit: number;
};

const PRESETS: Record<SchematicCategory, Preset> = {
  'turboprop':     { L: 27.2, R: 1.40, span: 27.1, wingX: 0.40, chord: 0.10, taper: 0.55, sweep: 3,  wing: 'high', eng: 'prop-wing', n: 2, engY: [0.15],      tail: 'T',    abreast: 4, cockpit: 0.11 },
  'regional-jet':  { L: 31.7, R: 1.50, span: 26.0, wingX: 0.42, chord: 0.13, taper: 0.35, sweep: 24, wing: 'low',  eng: 'jet-wing',  n: 2, engY: [0.2],       tail: 'conv', abreast: 4, cockpit: 0.10 },
  'narrowbody':    { L: 37.6, R: 1.98, span: 35.8, wingX: 0.36, chord: 0.16, taper: 0.25, sweep: 25, wing: 'low',  eng: 'jet-wing',  n: 2, engY: [0.16],      tail: 'conv', abreast: 6, cockpit: 0.08 },
  'widebody':      { L: 66.8, R: 3.00, span: 64.8, wingX: 0.36, chord: 0.16, taper: 0.22, sweep: 31, wing: 'low',  eng: 'jet-wing',  n: 2, engY: [0.16, 0.3], tail: 'conv', abreast: 9, cockpit: 0.06 },
  'bizjet':        { L: 20.0, R: 1.00, span: 19.0, wingX: 0.48, chord: 0.13, taper: 0.40, sweep: 26, wing: 'low',  eng: 'jet-tail',  n: 2, engY: [0],         tail: 'T',    abreast: 2, cockpit: 0.14 },
  'piston-single': { L: 8.3,  R: 0.60, span: 11.0, wingX: 0.26, chord: 0.18, taper: 0.75, sweep: 0,  wing: 'high', eng: 'prop-nose', n: 1, engY: [0],         tail: 'conv', abreast: 2, cockpit: 0.35 },
  'piston-twin':   { L: 9.1,  R: 0.65, span: 11.5, wingX: 0.30, chord: 0.17, taper: 0.60, sweep: 0,  wing: 'low',  eng: 'prop-wing', n: 2, engY: [0.2],       tail: 'conv', abreast: 2, cockpit: 0.30 },
  'helicopter':    { L: 10.2, R: 0.90, span: 10.2, wingX: 0,    chord: 0,    taper: 1,    sweep: 0,  wing: 'none', eng: 'rotor',     n: 1, engY: [0],         tail: 'heli', abreast: 2, cockpit: 0.20 },
};

/** Regional jets seat up to this many; bigger single-aisle jets draw as narrowbodies. */
const REGIONAL_JET_MAX_SEATS = 110;

/** Which drawing stands for a catalogue type. */
export function schematicCategory(a: Pick<AircraftType, 'category' | 'seats' | 'engines'>): SchematicCategory {
  switch (a.category) {
    case 'piston-single': case 'turboprop-single': return 'piston-single';
    case 'piston-multi': case 'turboprop-multi': return 'piston-twin';
    case 'turboprop-airliner': return 'turboprop';
    case 'jet-business': return 'bizjet';
    case 'jet-airliner': return a.seats <= REGIONAL_JET_MAX_SEATS ? 'regional-jet' : 'narrowbody';
    case 'jet-widebody': return 'widebody';
    case 'helicopter': return 'helicopter';
    default: return a.engines > 1 ? 'piston-twin' : 'piston-single';
  }
}

type P3 = { x: number; y: number; z: number };
export type AnchorKey = 'cockpit' | 'cabin' | 'cargo' | 'engines';
export type Anchor = { key: AnchorKey; q: P3; side: 'top' | 'bottom' };
export type Model = { category: SchematicCategory; length: number; pts: P3[]; seats: P3[]; anchors: Anchor[]; step: number };

export function buildModel(category: SchematicCategory, o: { engines?: number; seats?: number; density?: number } = {}): Model {
  const p = PRESETS[category];
  const { L, R } = p;
  const dens = Math.max(0.4, Math.min(2.5, o.density ?? 1));
  const s = L / (80 * dens);
  const nEng = o.engines && o.engines > 0 ? Math.round(o.engines) : p.n;
  const isHeli = p.eng === 'rotor';
  const nf = isHeli ? 0 : Math.min(0.24, (1.6 * 2 * R) / L);
  const tf = isHeli ? 0.5 : Math.max(0.6, Math.min(0.8, 1 - (2.8 * 2 * R) / L));
  const prof = (t: number): { r: number; zc: number } => {
    if (isHeli) {
      if (t < 0.5) { const u = (t - 0.25) / 0.25; return { r: R * Math.sqrt(Math.max(0, 1 - u * u)), zc: 0 }; }
      const u = (t - 0.5) / 0.5;
      return { r: R * (0.16 - 0.08 * u), zc: R * (0.15 + 0.25 * u) };
    }
    if (t < nf) { const u = 1 - t / nf; return { r: R * Math.sqrt(Math.max(0, 1 - u * u)), zc: -0.12 * R * u }; }
    if (t > tf) { const u = (t - tf) / (1 - tf); return { r: R * (1 - 0.84 * u), zc: R * 0.6 * u }; }
    return { r: R, zc: 0 };
  };

  const noseEngineEnd = p.eng === 'prop-nose' ? 0.14 : 0;
  let cockpitEnd = p.cockpit;
  let cabinStart = cockpitEnd + 0.01;
  let cabinEnd = tf - 0.02;
  if (isHeli) { cockpitEnd = 0.2; cabinStart = 0.2; cabinEnd = 0.45; }
  const hasCargo = R >= 1.2;

  const pts: P3[] = [];
  const add = (x: number, y: number, z: number): void => { pts.push({ x, y, z }); };

  // Fuselage rings.
  const nAround = Math.round(26 * Math.sqrt(dens));
  const steps = Math.round(L / s);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const pr = prof(t);
    if (pr.r < 0.03 * R) continue;
    const n = Math.max(6, Math.round(nAround * Math.max(0.35, pr.r / R)));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const z = pr.zc + pr.r * Math.sin(a);
      add(t * L, pr.r * Math.cos(a), z);
    }
  }

  // Wing (the fuel tanks).
  const semi = p.span / 2;
  const cr = p.chord * L;
  const ct = cr * p.taper;
  const zw = p.wing === 'high' ? R * 0.88 : -R * 0.62;
  const tanS = Math.tan((p.sweep * Math.PI) / 180);
  const dih = p.wing === 'low' ? 0.07 : 0.02;
  const wingAt = (y: number): { xle: number; c: number; z: number } => {
    const a = Math.abs(y);
    const f = Math.min(1, a / semi);
    return { xle: p.wingX * L + a * tanS, c: cr + (ct - cr) * f, z: zw + a * dih };
  };
  if (p.wing !== 'none') {
    for (let y = R * 0.55; y <= semi + 1e-6; y += s) {
      const w = wingAt(y);
      for (let x = 0; x <= w.c + 1e-6; x += s) { add(w.xle + x, -y, w.z); add(w.xle + x, y, w.z); }
    }
  }

  // Empennage.
  if (!isHeli) {
    const fh = 0.15 * L * (category === 'widebody' ? 0.95 : 1);
    const fcr = 0.15 * L;
    const fct = fcr * 0.55;
    const fsw = Math.tan((38 * Math.PI) / 180);
    const fx0 = L * 0.8;
    const pb = prof(Math.min(0.99, fx0 / L + 0.05));
    const zb = pb.zc + pb.r * 0.9;
    for (let hh = 0; hh <= fh + 1e-6; hh += s) {
      const f = hh / fh;
      const c = fcr + (fct - fcr) * f;
      const xle = fx0 + hh * fsw;
      for (let x = 0; x <= c + 1e-6; x += s) add(xle + x, 0, zb + hh);
    }
    const tTail = p.tail === 'T';
    const hsSemi = p.span * (tTail ? 0.15 : 0.18);
    const hcr = 0.1 * L;
    const hct = hcr * 0.5;
    const hsw = Math.tan((30 * Math.PI) / 180);
    const hx = tTail ? fx0 + fh * fsw : L * 0.86;
    const p88 = prof(0.88);
    const hz = tTail ? zb + fh : p88.zc + p88.r * 0.2;
    for (let y = 0; y <= hsSemi + 1e-6; y += s) {
      const f = y / hsSemi;
      const c = hcr + (hct - hcr) * f;
      const xle = hx + y * hsw;
      for (let x = 0; x <= c + 1e-6; x += s) { add(xle + x, -y, hz); if (y > 0) add(xle + x, y, hz); }
    }
  }

  // Engines and rotors.
  const nacelle = (x0: number, len: number, yc: number, zc: number, rn: number): void => {
    const st = Math.max(3, Math.round(len / s));
    const n = Math.max(8, Math.round(14 * Math.sqrt(dens)));
    for (let i = 0; i <= st; i++) {
      const t = i / st;
      const rr = rn * (t < 0.15 ? 0.85 + t : t > 0.75 ? 1 - (t - 0.75) * 1.6 : 1);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        add(x0 + t * len, yc + rr * Math.cos(a), zc + rr * Math.sin(a));
      }
    }
  };
  const disc = (xc: number, yc: number, zc: number, rad: number, plane: 'yz' | 'xy' | 'xz', count: number): void => {
    for (const f of [1, 0.55]) {
      const n = Math.round(count * f);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const u = rad * f * Math.cos(a);
        const v = rad * f * Math.sin(a);
        if (plane === 'yz') add(xc, yc + u, zc + v);
        else if (plane === 'xy') add(xc + u, yc + v, zc);
        else add(xc + u, yc, zc + v);
      }
    }
  };

  let engAnchor: P3 | null = null;
  let engSide: 'top' | 'bottom' = 'top';
  if (p.eng === 'prop-wing' || p.eng === 'jet-wing') {
    const fracs = nEng >= 4 ? [p.engY[0]!, p.engY[1] ?? p.engY[0]! * 1.9] : [p.engY[0]!];
    const ys: number[] = [];
    if (nEng >= 2) for (const e of fracs) ys.push(-e * p.span, e * p.span);
    for (const y of ys) {
      const w = wingAt(y);
      if (p.eng === 'prop-wing') {
        const rn = R * 0.3;
        const len = w.c * 1.6;
        const x0 = w.xle - w.c * 0.45;
        const zc = p.wing === 'high' ? w.z - rn * 0.5 : w.z + rn * 0.3;
        nacelle(x0, len, y, zc, rn);
        disc(x0 - s * 0.5, y, zc, 0.072 * p.span * (category === 'piston-twin' ? 0.8 : 1), 'yz', 44);
        if (!engAnchor || y < engAnchor.y) engAnchor = { x: x0 + len * 0.35, y, z: zc + rn };
      } else {
        const rn = R * (category === 'widebody' ? 0.55 : 0.5);
        const len = 0.12 * L;
        const x0 = w.xle - len * 0.45;
        const zc = w.z - rn * 1.15;
        nacelle(x0, len, y, zc, rn);
        if (!engAnchor || y < engAnchor.y) engAnchor = { x: x0 + len * 0.4, y, z: zc - rn };
        engSide = 'bottom';
      }
    }
  } else if (p.eng === 'jet-tail') {
    const rn = 0.42 * R;
    const len = 0.15 * L;
    for (const sg of [-1, 1]) nacelle(0.66 * L, len, sg * (R + rn * 1.25), R * 0.35, rn);
    engAnchor = { x: 0.7 * L, y: -(R + rn * 1.25), z: R * 0.35 + rn };
  } else if (p.eng === 'prop-nose') {
    disc(-s, 0, -0.05 * R, 0.086 * p.span, 'yz', 44);
    const pr = prof(0.06);
    engAnchor = { x: 0.06 * L, y: 0, z: pr.zc + pr.r };
  } else {
    const hx = 0.3 * L;
    const hz = R * 1.45;
    const rad = p.span / 2;
    disc(hx, 0, hz, rad, 'xy', 90);
    for (const deg of [20, 110, 200, 290]) {
      const a = (deg * Math.PI) / 180;
      for (let d = 0; d <= rad; d += s) add(hx + d * Math.cos(a), d * Math.sin(a), hz);
    }
    for (let z = R * 0.9; z <= hz; z += s) add(hx, 0, z);
    const pt = prof(0.97);
    disc(L * 0.97, -0.25 * R, pt.zc + 0.35 * R, 0.09 * p.span, 'xz', 26);
    for (let hh = 0; hh <= 0.12 * L; hh += s) add(L * 0.93 + hh * 0.4, 0, pt.zc + hh);
    for (const sg of [-1, 1]) {
      for (let x = 0.08 * L; x <= 0.48 * L; x += s) add(x, sg * 0.75 * R, -1.4 * R);
      for (const xs of [0.17 * L, 0.38 * L]) for (let z = -1.4 * R; z <= -0.6 * R; z += s) add(xs, sg * 0.7 * R, z);
    }
    engAnchor = { x: hx, y: 0, z: hz };
  }

  // Cabin seats, inside the cutaway.
  const seats: P3[] = [];
  const nSeats = Math.max(0, Math.round(o.seats ?? 0));
  if (nSeats > 0) {
    const ab = p.abreast;
    const rows = Math.ceil(nSeats / ab);
    const x0 = cabinStart * L + s;
    const x1 = cabinEnd * L - s;
    const pitchX = (x1 - x0) / Math.max(1, rows);
    const halfW = R * 0.72;
    const aisle = ab >= 4 ? R * 0.22 : R * 0.15;
    const seatW = (2 * halfW - aisle * (ab >= 7 ? 2 : 1)) / ab;
    let placed = 0;
    for (let r = 0; r < rows; r++) {
      for (let j = 0; j < ab && placed < nSeats; j++) {
        let y = -halfW + seatW * (j + 0.5);
        if (ab >= 7) { if (j >= 3) y += aisle; if (j >= ab - 3) y += aisle; } else if (j >= ab / 2) y += aisle;
        seats.push({ x: x0 + pitchX * (r + 0.5), y, z: -0.3 * R });
        placed++;
      }
    }
  }

  const top = (t: number): P3 => { const pr = prof(t); return { x: t * L, y: 0, z: pr.zc + pr.r }; };
  const bottom = (t: number): P3 => { const pr = prof(t); return { x: t * L, y: 0, z: pr.zc - pr.r }; };
  const anchors: Anchor[] = [
    { key: 'cockpit', q: top(isHeli ? 0.12 : Math.max(nf * 0.75, noseEngineEnd + (cockpitEnd - noseEngineEnd) * 0.5)), side: 'top' },
    { key: 'cabin', q: top((cabinStart + cabinEnd) / 2), side: 'top' },
  ];
  if (hasCargo) anchors.push({ key: 'cargo', q: bottom(cabinStart + (cabinEnd - cabinStart) * 0.22), side: 'bottom' });
  if (engAnchor) anchors.push({ key: 'engines', q: engAnchor, side: engSide });
  return { category, length: L, pts, seats, anchors, step: s };
}

export type View = { w: number; h: number; yaw: number; pitch: number; labels: boolean };
export const DEFAULT_YAW = 24;
export const DEFAULT_PITCH = 14;
export const TAG_HEIGHT = 54;
export const DEPTH_LEVELS = 4;

export type Dot = { x: number; y: number; level: number };
export type Projection = { dots: Dot[]; seats: { x: number; y: number }[]; anchors: { key: AnchorKey; x: number; y: number; side: 'top' | 'bottom' }[]; dotRadius: number; seatSize: number };

/** 3/4 view from the left, slightly above: yaw and pitch in degrees. The drawing is fitted and centred in the view box. */
export function project(m: Model, v: View): Projection {
  const yaw = (v.yaw * Math.PI) / 180;
  const pit = (v.pitch * Math.PI) / 180;
  const xc = m.length / 2;
  const proj = (q: P3): { u: number; v: number; d: number } => {
    const x = q.x - xc;
    const xr = x * Math.cos(yaw) - q.y * Math.sin(yaw);
    const yr = x * Math.sin(yaw) + q.y * Math.cos(yaw);
    return { u: xr, v: q.z * Math.cos(pit) + yr * Math.sin(pit), d: yr * Math.cos(pit) - q.z * Math.sin(pit) };
  };
  const all = m.pts.map(proj);
  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity, dmin = Infinity, dmax = -Infinity;
  for (const a of all) {
    umin = Math.min(umin, a.u); umax = Math.max(umax, a.u);
    vmin = Math.min(vmin, a.v); vmax = Math.max(vmax, a.v);
    dmin = Math.min(dmin, a.d); dmax = Math.max(dmax, a.d);
  }
  const padX = v.w * 0.03;
  const padY = v.labels ? 84 : v.h * 0.05;
  const availW = v.w - 2 * padX;
  const availH = v.h - 2 * padY;
  const scale = Math.min(availW / (umax - umin), availH / (vmax - vmin));
  const ox = padX + (availW - (umax - umin) * scale) / 2 - umin * scale;
  const oy = padY + (availH - (vmax - vmin) * scale) / 2 + vmax * scale;
  const toScreen = (q: P3): { x: number; y: number } => { const a = proj(q); return { x: ox + a.u * scale, y: oy - a.v * scale }; };
  const span = Math.max(1e-6, dmax - dmin);
  const dots = all.map((a): Dot => ({ x: ox + a.u * scale, y: oy - a.v * scale, level: Math.min(DEPTH_LEVELS - 1, Math.floor(((a.d - dmin) / span) * DEPTH_LEVELS)) }));
  const base = Math.max(0.7, Math.min(2.4, m.step * scale * 0.2));
  return {
    dots, seats: m.seats.map(toScreen), anchors: m.anchors.map((a) => ({ key: a.key, side: a.side, ...toScreen(a.q) })),
    dotRadius: base, seatSize: Math.max(1.6, base * 2.4),
  };
}

export type TagBox = { key: AnchorKey; x: number; y: number; w: number; ax: number; ay: number; lx: number; ly: number; side: 'top' | 'bottom' };
/** Callout boxes in a row along the top or the bottom edge, left to right in anchor order, never overlapping and kept inside the view box; `lx, ly` is where the leader line leaves the box. */
export function placeTags(items: { key: AnchorKey; ax: number; ay: number; side: 'top' | 'bottom'; w: number }[], w: number, h: number): TagBox[] {
  const rows: Record<'top' | 'bottom', { x: number; w: number }[]> = { top: [], bottom: [] };
  return [...items].sort((a, b) => a.ax - b.ax).map((it) => {
    const row = rows[it.side];
    let x = Math.max(0, it.ax - 14);
    const prev = row[row.length - 1];
    if (prev) x = Math.max(x, prev.x + prev.w + 14);
    x = Math.min(x, w - it.w);
    row.push({ x, w: it.w });
    return { ...it, x, y: it.side === 'top' ? 0 : h - TAG_HEIGHT, lx: x + 14, ly: it.side === 'top' ? TAG_HEIGHT : h - TAG_HEIGHT };
  });
}
