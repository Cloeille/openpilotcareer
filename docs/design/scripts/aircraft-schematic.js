/**
 * @schema 2.11
 * @input category: enum("turboprop", "regional-jet", "narrowbody", "widebody", "bizjet", "piston-single", "piston-twin", "helicopter") = "turboprop"
 * @input engines: number = 0
 * @input engineMount: enum("auto", "wing", "rear") = "auto"
 * @input tail: enum("auto", "T", "conventional") = "auto"
 * @input seats: number = 70
 * @input style: enum("dots", "mesh", "both") = "dots"
 * @input highlight: enum("none", "cockpit", "cabin", "cargo", "fuel", "engines") = "none"
 * @input yaw: number = 24
 * @input pitch: number = 14
 * @input density: number = 1
 * @input dotColor: color = #9A9DA1
 * @input accentColor: color = #ECEAE5
 * @input labels: boolean = true
 * @input cockpitText: string = "2 pilotes"
 * @input cabinText: string = "68 passagers · 2 PNC"
 * @input cargoText: string = "640 kg de fret"
 * @input enginesText: string = "2 en service"
 */

// Generic, data-driven aircraft schematic rendered as a 3D point cloud (or wire mesh).
// Geometry is built from a per-category preset so it works for any aircraft type.

const W = pencil.width;
const H = pencil.height;
const IN = pencil.input;

const PRESETS = {
  "turboprop":     { L: 27.2, R: 1.40, span: 27.1, wingX: 0.40, chord: 0.10, taper: 0.55, sweep: 3,  wing: "high", eng: "prop-wing", n: 2, engY: [0.15],       tail: "T",    abreast: 4, cockpit: 0.11 },
  "regional-jet":  { L: 31.7, R: 1.50, span: 26.0, wingX: 0.42, chord: 0.13, taper: 0.35, sweep: 24, wing: "low",  eng: "jet-wing",  n: 2, engY: [0.2],        tail: "conv", abreast: 4, cockpit: 0.10 },
  "narrowbody":    { L: 37.6, R: 1.98, span: 35.8, wingX: 0.36, chord: 0.16, taper: 0.25, sweep: 25, wing: "low",  eng: "jet-wing",  n: 2, engY: [0.16],       tail: "conv", abreast: 6, cockpit: 0.08 },
  "widebody":      { L: 66.8, R: 3.00, span: 64.8, wingX: 0.36, chord: 0.16, taper: 0.22, sweep: 31, wing: "low",  eng: "jet-wing",  n: 2, engY: [0.16, 0.3],  tail: "conv", abreast: 9, cockpit: 0.06 },
  "bizjet":        { L: 20.0, R: 1.00, span: 19.0, wingX: 0.48, chord: 0.13, taper: 0.40, sweep: 26, wing: "low",  eng: "jet-tail",  n: 2, engY: [0],          tail: "T",    abreast: 2, cockpit: 0.14 },
  "piston-single": { L: 8.3,  R: 0.60, span: 11.0, wingX: 0.26, chord: 0.18, taper: 0.75, sweep: 0,  wing: "high", eng: "prop-nose", n: 1, engY: [0],          tail: "conv", abreast: 2, cockpit: 0.35 },
  "piston-twin":   { L: 9.1,  R: 0.65, span: 11.5, wingX: 0.30, chord: 0.17, taper: 0.60, sweep: 0,  wing: "low",  eng: "prop-wing", n: 2, engY: [0.2],        tail: "conv", abreast: 2, cockpit: 0.30 },
  "helicopter":    { L: 10.2, R: 0.90, span: 10.2, wingX: 0,    chord: 0,    taper: 1,    sweep: 0,  wing: "none", eng: "rotor",     n: 1, engY: [0],          tail: "heli", abreast: 2, cockpit: 0.20 },
};

const cat = PRESETS[IN.category] ? IN.category : "turboprop";
const p = Object.assign({}, PRESETS[cat]);
// Per-aircraft overrides so one category covers its variants (CRJ vs E175, Twin Otter vs ATR...).
if (IN.engineMount === "rear" && p.eng === "jet-wing") p.eng = "jet-tail";
if (IN.engineMount === "wing" && p.eng === "jet-tail") { p.eng = "jet-wing"; p.engY = [0.18]; }
if (IN.tail === "T") p.tail = "T";
if (IN.tail === "conventional") p.tail = "conv";
const L = p.L;
const R = p.R;
const dens = Math.max(0.4, Math.min(2.5, IN.density || 1));
const s = L / (80 * dens);
const nEng = IN.engines > 0 ? Math.round(IN.engines) : p.n;
const isHeli = p.eng === "rotor";
const style = IN.style || "dots";

// Fuselage profile: radius and centreline height along the normalised length t.
const nf = isHeli ? 0 : Math.min(0.24, (1.6 * 2 * R) / L);
const tf = isHeli ? 0.5 : Math.max(0.6, Math.min(0.8, 1 - (2.8 * 2 * R) / L));
function prof(t) {
  if (isHeli) {
    if (t < 0.5) {
      const u = (t - 0.25) / 0.25;
      return { r: R * Math.sqrt(Math.max(0, 1 - u * u)), zc: 0 };
    }
    const u = (t - 0.5) / 0.5;
    return { r: R * (0.16 - 0.08 * u), zc: R * (0.15 + 0.25 * u) };
  }
  if (t < nf) {
    const u = 1 - t / nf;
    return { r: R * Math.sqrt(Math.max(0, 1 - u * u)), zc: -0.12 * R * u };
  }
  if (t > tf) {
    const u = (t - tf) / (1 - tf);
    return { r: R * (1 - 0.84 * u), zc: R * 0.6 * u };
  }
  return { r: R, zc: 0 };
}

// Functional zones along the fuselage.
let noseEngineEnd = 0;
let cockpitEnd = p.cockpit;
if (p.eng === "prop-nose") noseEngineEnd = 0.14;
let cabinStart = cockpitEnd + 0.01;
let cabinEnd = tf - 0.02;
if (isHeli) {
  cockpitEnd = 0.2;
  cabinStart = 0.2;
  cabinEnd = 0.45;
}
const hasCargo = R >= 1.2;
function zoneOf(t, z, zc, r) {
  if (t < noseEngineEnd) return "engines";
  if (t < cockpitEnd) return "cockpit";
  if (t <= cabinEnd) return hasCargo && z < zc - 0.32 * r ? "cargo" : "cabin";
  return "body";
}

const pts = [];
const rings = [];
const outlines = [];
const add = (x, y, z, zone) => pts.push({ x, y, z, zone });

// Fuselage rings.
const nAround = Math.round(26 * Math.sqrt(dens));
const steps = Math.round(L / s);
for (let i = 0; i <= steps; i++) {
  const t = i / steps;
  const pr = prof(t);
  if (pr.r < 0.03 * R) continue;
  const n = Math.max(6, Math.round(nAround * Math.max(0.35, pr.r / R)));
  const ring = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const z = pr.zc + pr.r * Math.sin(a);
    ring.push(pts.length);
    add(t * L, pr.r * Math.cos(a), z, zoneOf(t, z, pr.zc, pr.r));
  }
  if (i % 2 === 0) rings.push(ring);
}

// Fuselage stringers (mesh only).
if (style !== "dots") {
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const line = [];
    for (let i = 0; i <= steps; i += 2) {
      const t = i / steps;
      const pr = prof(t);
      line.push({ x: t * L, y: pr.r * Math.cos(a), z: pr.zc + pr.r * Math.sin(a) });
    }
    outlines.push(line);
  }
}

// Wing (fuel tanks).
const semi = p.span / 2;
const cr = p.chord * L;
const ct = cr * p.taper;
const zw = p.wing === "high" ? R * 0.88 : -R * 0.62;
const tanS = Math.tan((p.sweep * Math.PI) / 180);
const dih = p.wing === "low" ? 0.07 : 0.02;
function wingAt(y) {
  const a = Math.abs(y);
  const f = Math.min(1, a / semi);
  return { xle: p.wingX * L + a * tanS, c: cr + (ct - cr) * f, z: zw + a * dih };
}
if (p.wing !== "none") {
  for (let y = R * 0.55; y <= semi + 1e-6; y += s) {
    const w = wingAt(y);
    for (let x = 0; x <= w.c + 1e-6; x += s) {
      add(w.xle + x, -y, w.z, "fuel");
      add(w.xle + x, y, w.z, "fuel");
    }
  }
  for (const sg of [-1, 1]) {
    const root = wingAt(R * 0.55);
    const tip = wingAt(semi);
    outlines.push([
      { x: root.xle, y: sg * R * 0.55, z: root.z },
      { x: tip.xle, y: sg * semi, z: tip.z },
      { x: tip.xle + tip.c, y: sg * semi, z: tip.z },
      { x: root.xle + root.c, y: sg * R * 0.55, z: root.z },
    ]);
  }
}

// Empennage.
if (!isHeli) {
  const fh = 0.15 * L * (cat === "widebody" ? 0.95 : 1);
  const fcr = 0.15 * L;
  const fct = fcr * 0.55;
  const fsw = Math.tan((38 * Math.PI) / 180);
  const fx0 = L * 0.8;
  const pb = prof(Math.min(0.99, fx0 / L + 0.05));
  const zb = pb.zc + pb.r * 0.9;
  for (let h = 0; h <= fh + 1e-6; h += s) {
    const f = h / fh;
    const c = fcr + (fct - fcr) * f;
    const xle = fx0 + h * fsw;
    for (let x = 0; x <= c + 1e-6; x += s) add(xle + x, 0, zb + h, "body");
  }
  outlines.push([
    { x: fx0, y: 0, z: zb },
    { x: fx0 + fh * fsw, y: 0, z: zb + fh },
    { x: fx0 + fh * fsw + fct, y: 0, z: zb + fh },
    { x: fx0 + fcr, y: 0, z: zb },
  ]);
  const tTail = p.tail === "T";
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
    for (let x = 0; x <= c + 1e-6; x += s) {
      add(xle + x, -y, hz, "body");
      if (y > 0) add(xle + x, y, hz, "body");
    }
  }
}

// Engines and rotors.
const nacelle = (x0, len, yc, zc, rn) => {
  const st = Math.max(3, Math.round(len / s));
  const n = Math.max(8, Math.round(14 * Math.sqrt(dens)));
  for (let i = 0; i <= st; i++) {
    const t = i / st;
    const rr = rn * (t < 0.15 ? 0.85 + t : t > 0.75 ? 1 - (t - 0.75) * 1.6 : 1);
    const ring = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      ring.push(pts.length);
      add(x0 + t * len, yc + rr * Math.cos(a), zc + rr * Math.sin(a), "engines");
    }
    if (i % 2 === 0) rings.push(ring);
  }
};
const disc = (xc, yc, zc, rad, plane, count) => {
  for (const f of [1, 0.55]) {
    const n = Math.round(count * f);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const u = rad * f * Math.cos(a);
      const v = rad * f * Math.sin(a);
      if (plane === "yz") add(xc, yc + u, zc + v, "engines");
      else if (plane === "xy") add(xc + u, yc + v, zc, "engines");
      else add(xc + u, yc, zc + v, "engines");
    }
  }
};

let engAnchor = null;
let engSide = "top";
if (p.eng === "prop-wing" || p.eng === "jet-wing") {
  let fracs = nEng >= 4 ? [p.engY[0], p.engY[1] || p.engY[0] * 1.9] : [p.engY[0]];
  const ys = [];
  if (nEng >= 2) for (const e of fracs) ys.push(-e * p.span, e * p.span);
  for (const y of ys) {
    const w = wingAt(y);
    if (p.eng === "prop-wing") {
      const rn = R * 0.3;
      const len = w.c * 1.6;
      const x0 = w.xle - w.c * 0.45;
      const zc = p.wing === "high" ? w.z - rn * 0.5 : w.z + rn * 0.3;
      nacelle(x0, len, y, zc, rn);
      disc(x0 - s * 0.5, y, zc, 0.072 * p.span * (cat === "piston-twin" ? 0.8 : 1), "yz", 44);
      if (!engAnchor || y < engAnchor.y) engAnchor = { x: x0 + len * 0.35, y, z: zc + rn };
    } else {
      const rn = R * (cat === "widebody" ? 0.55 : 0.5);
      const len = 0.12 * L;
      const x0 = w.xle - len * 0.45;
      const zc = w.z - rn * 1.15;
      nacelle(x0, len, y, zc, rn);
      if (!engAnchor || y < engAnchor.y) engAnchor = { x: x0 + len * 0.4, y, z: zc - rn };
      engSide = "bottom";
    }
  }
} else if (p.eng === "jet-tail") {
  const rn = 0.42 * R;
  const len = 0.15 * L;
  for (const sg of [-1, 1]) nacelle(0.66 * L, len, sg * (R + rn * 1.25), R * 0.35, rn);
  engAnchor = { x: 0.7 * L, y: -(R + rn * 1.25), z: R * 0.35 + rn };
} else if (p.eng === "prop-nose") {
  disc(-s, 0, -0.05 * R, 0.086 * p.span, "yz", 44);
  const pr = prof(0.06);
  engAnchor = { x: 0.06 * L, y: 0, z: pr.zc + pr.r };
} else if (p.eng === "rotor") {
  const hx = 0.3 * L;
  const hz = R * 1.45;
  const rad = p.span / 2;
  disc(hx, 0, hz, rad, "xy", 90);
  for (const deg of [20, 110, 200, 290]) {
    const a = (deg * Math.PI) / 180;
    for (let d = 0; d <= rad; d += s) add(hx + d * Math.cos(a), d * Math.sin(a), hz, "engines");
  }
  for (let z = R * 0.9; z <= hz; z += s) add(hx, 0, z, "engines");
  const pt = prof(0.97);
  disc(L * 0.97, -0.25 * R, pt.zc + 0.35 * R, 0.09 * p.span, "xz", 26);
  for (let h = 0; h <= 0.12 * L; h += s) add(L * 0.93 + h * 0.4, 0, pt.zc + h, "body");
  for (const sg of [-1, 1]) {
    for (let x = 0.08 * L; x <= 0.48 * L; x += s) add(x, sg * 0.75 * R, -1.4 * R, "body");
    for (const xs of [0.17 * L, 0.38 * L]) for (let z = -1.4 * R; z <= -0.6 * R; z += s) add(xs, sg * 0.7 * R, z, "body");
  }
  engAnchor = { x: hx, y: 0, z: hz };
}

// Cabin seats (interior of the cutaway).
const seats = [];
const nSeats = Math.max(0, Math.round(IN.seats || 0));
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
      if (ab >= 7) {
        if (j >= 3) y += aisle;
        if (j >= ab - 3) y += aisle;
      } else if (j >= ab / 2) y += aisle;
      seats.push({ x: x0 + pitchX * (r + 0.5), y, z: -0.3 * R, zone: "cabin" });
      placed++;
    }
  }
}

// Projection: 3/4 view from the left, slightly above.
const yaw = ((IN.yaw === undefined ? 24 : IN.yaw) * Math.PI) / 180;
const pit = ((IN.pitch === undefined ? 14 : IN.pitch) * Math.PI) / 180;
const xc = L / 2;
const proj = (q) => {
  const x = q.x - xc;
  const xr = x * Math.cos(yaw) - q.y * Math.sin(yaw);
  const yr = x * Math.sin(yaw) + q.y * Math.cos(yaw);
  return { u: xr, v: q.z * Math.cos(pit) + yr * Math.sin(pit), d: yr * Math.cos(pit) - q.z * Math.sin(pit) };
};

const all = pts.map(proj);
let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity, dmin = Infinity, dmax = -Infinity;
for (const a of all) {
  umin = Math.min(umin, a.u); umax = Math.max(umax, a.u);
  vmin = Math.min(vmin, a.v); vmax = Math.max(vmax, a.v);
  dmin = Math.min(dmin, a.d); dmax = Math.max(dmax, a.d);
}
const labels = IN.labels !== false;
const padX = W * 0.03;
const padTop = labels ? 84 : H * 0.05;
const padBottom = labels ? 84 : H * 0.05;
const availW = W - 2 * padX;
const availH = H - padTop - padBottom;
const scale = Math.min(availW / (umax - umin), availH / (vmax - vmin));
const ox = padX + (availW - (umax - umin) * scale) / 2 - umin * scale;
const oy = padTop + (availH - (vmax - vmin) * scale) / 2 + vmax * scale;
const toScreen = (q) => {
  const a = proj(q);
  return { x: ox + a.u * scale, y: oy - a.v * scale, d: a.d };
};
const scr = all.map((a) => ({ x: ox + a.u * scale, y: oy - a.v * scale, d: a.d }));

const r1 = (n) => Math.round(n * 10) / 10;
const nodes = [];

// Mesh lines.
if (style !== "dots") {
  let geo = "";
  for (const ring of rings) {
    ring.forEach((idx, k) => { geo += (k === 0 ? "M" : "L") + r1(scr[idx].x) + " " + r1(scr[idx].y); });
    geo += "Z";
  }
  for (const line of outlines) {
    line.forEach((q, k) => { const sp = toScreen(q); geo += (k === 0 ? "M" : "L") + r1(sp.x) + " " + r1(sp.y); });
  }
  nodes.push({ type: "path", name: "Mesh", x: 0, y: 0, width: W, height: H, viewBox: [0, 0, W, H], geometry: geo, stroke: IN.dotColor, strokeWidth: 0.7, opacity: style === "both" ? 0.22 : 0.5 });
}

// Point cloud, bucketed by depth so near points read brighter and larger.
if (style !== "mesh") {
  const pxS = s * scale;
  const base = Math.max(0.7, Math.min(2.4, pxS * 0.2));
  const SIZE = [1.25, 1.08, 0.92, 0.78];
  const OP = [0.95, 0.68, 0.44, 0.26];
  const buckets = {};
  const span = Math.max(1e-6, dmax - dmin);
  pts.forEach((q, i) => {
    const a = scr[i];
    const lvl = Math.min(3, Math.floor(((a.d - dmin) / span) * 4));
    const hl = IN.highlight && IN.highlight !== "none" && q.zone === IN.highlight;
    const key = (hl ? "hl" : "base") + lvl;
    const r = base * SIZE[lvl];
    buckets[key] = (buckets[key] || "") + "M" + r1(a.x - r) + " " + r1(a.y) + "a" + r1(r) + " " + r1(r) + " 0 1 0 " + r1(2 * r) + " 0a" + r1(r) + " " + r1(r) + " 0 1 0 " + r1(-2 * r) + " 0";
  });
  Object.keys(buckets)
    .sort((a, b) => Number(b.slice(-1)) - Number(a.slice(-1)))
    .forEach((key) => {
      const hl = key.startsWith("hl");
      const lvl = Number(key.slice(-1));
      nodes.push({ type: "path", name: (hl ? "Highlight" : "Points") + " · plan " + (lvl + 1), x: 0, y: 0, width: W, height: H, viewBox: [0, 0, W, H], geometry: buckets[key], fill: hl ? IN.accentColor : IN.dotColor, opacity: OP[lvl] });
    });

  if (seats.length) {
    const sz = Math.max(1.6, base * 2.4);
    let geo = "";
    for (const q of seats) {
      const a = toScreen(q);
      geo += "M" + r1(a.x - sz / 2) + " " + r1(a.y - sz / 2) + "h" + r1(sz) + "v" + r1(sz) + "h" + r1(-sz) + "Z";
    }
    const hl = IN.highlight === "cabin";
    nodes.push({ type: "path", name: "Sièges", x: 0, y: 0, width: W, height: H, viewBox: [0, 0, W, H], geometry: geo, fill: hl ? IN.accentColor : IN.dotColor, opacity: hl ? 0.95 : 0.7 });
  }
}

// Zone callouts, placed from the same geometry so they follow any aircraft type.
if (labels) {
  const top = (t) => { const pr = prof(t); return { x: t * L, y: 0, z: pr.zc + pr.r }; };
  const bottom = (t) => { const pr = prof(t); return { x: t * L, y: 0, z: pr.zc - pr.r }; };
  const items = [];
  const cockpitT = isHeli ? 0.12 : Math.max(nf * 0.75, noseEngineEnd + (cockpitEnd - noseEngineEnd) * 0.5);
  items.push({ label: "Cockpit", text: IN.cockpitText, q: top(cockpitT), side: "top" });
  items.push({ label: "Cabine", text: IN.cabinText, q: top((cabinStart + cabinEnd) / 2), side: "top" });
  if (hasCargo) items.push({ label: "Soute", text: IN.cargoText, q: bottom(cabinStart + (cabinEnd - cabinStart) * 0.22), side: "bottom" });
  if (engAnchor) items.push({ label: isHeli ? "Rotor & turbine" : "Moteurs", text: IN.enginesText, q: engAnchor, side: engSide });

  const tagH = 54;
  let leaders = "";
  const placed = { top: [], bottom: [] };
  const sized = items
    .filter((it) => it.text)
    .map((it) => {
      const a = toScreen(it.q);
      const w = Math.max(it.label.length * 6.8, it.text.length * 7.9) + 30;
      return Object.assign({}, it, { ax: a.x, ay: a.y, w });
    })
    .sort((a, b) => a.ax - b.ax);
  for (const it of sized) {
    const row = placed[it.side];
    let x = Math.max(0, it.ax - 14);
    const prev = row[row.length - 1];
    if (prev) x = Math.max(x, prev.x + prev.w + 14);
    x = Math.min(x, W - it.w);
    const y = it.side === "top" ? 0 : H - tagH;
    row.push({ x, w: it.w });
    const lx = x + 14;
    const ly = it.side === "top" ? tagH : H - tagH;
    leaders += "M" + r1(lx) + " " + r1(ly) + "L" + r1(it.ax) + " " + r1(it.ay);
    nodes.push({
      type: "frame", name: "Tag · " + it.label, x, y, layout: "vertical", gap: 3, padding: [9, 14], cornerRadius: 4,
      fill: "$surface", stroke: "$border", strokeWidth: 1, effect: { type: "background_blur", radius: 16 },
      children: [
        { type: "text", name: "Label", content: it.label, fontFamily: "$font-ui", fontSize: 13, fill: "$text-secondary" },
        { type: "text", name: "Value", content: it.text, fontFamily: "$font-ui", fontSize: 15, fontWeight: "500", fill: "$text-primary" },
      ],
    });
    nodes.push({ type: "ellipse", name: "Anchor · " + it.label, x: it.ax - 3.5, y: it.ay - 3.5, width: 7, height: 7, fill: "$text-primary" });
  }
  if (leaders) nodes.unshift({ type: "path", name: "Leaders", x: 0, y: 0, width: W, height: H, viewBox: [0, 0, W, H], geometry: leaders, stroke: "#FFFFFF59", strokeWidth: 1 });
}

return nodes;
