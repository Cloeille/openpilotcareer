/**
 * @schema 2.11
 * @input view: enum("player", "rival") = "player"
 * @input selected: string = "LFMN-LFLL"
 * @input azimuth: number = 50
 * @input elevation: number = 40
 * @input distance: number = 30
 * @input fitLeft: number = 60
 * @input fitTop: number = 170
 * @input fitRight: number = 1120
 * @input fitBottom: number = 640
 * @input plateSide: number = 7
 * @input plateNear: number = 4
 * @input plateFar: number = 6
 */

// Network map: a tilted, perspective plate of the region with each line drawn as a 3D arc
// between its airports and the aircraft flying it right now.

const W = pencil.width;
const H = pencil.height;
const IN = pencil.input;
const view = IN.view || "player";
const sel = IN.selected || "";
const rad = (d) => (d * Math.PI) / 180;
const el = rad(IN.elevation === undefined ? 48 : IN.elevation);
const az = rad(IN.azimuth === undefined ? 40 : IN.azimuth);
const DC = IN.distance || 16;

const AP = {
  LFMN: { city: "Nice", lat: 43.665, lon: 7.215 },
  LFLL: { city: "Lyon", lat: 45.726, lon: 5.091 },
  LFPG: { city: "Paris-CDG", lat: 49.01, lon: 2.548 },
  LFKJ: { city: "Ajaccio", lat: 41.924, lon: 8.802 },
  LFML: { city: "Marseille", lat: 43.439, lon: 5.221 },
  LEBL: { city: "Barcelone", lat: 41.297, lon: 2.078 },
  LIMC: { city: "Milan", lat: 45.63, lon: 8.723 },
};

// Lines of the player (Azur Régional) and of the AI company (Méridia Cargo).
// k is the arc height relative to the line length, so lines sharing a city pair stay apart.
const PLAYER = [
  { id: "LFMN-LFLL", a: "LFMN", b: "LFLL", state: "delayed", k: 0.16 },
  { id: "LFMN-LFPG", a: "LFMN", b: "LFPG", state: "ok", k: 0.12 },
  { id: "LFMN-LFKJ", a: "LFMN", b: "LFKJ", state: "ok", k: 0.2 },
  { id: "LFLL-LFML", a: "LFLL", b: "LFML", state: "interrupted", k: 0.16 },
];
const RIVAL = [
  { id: "LFML-LFLL", a: "LFML", b: "LFLL", contested: true, k: 0.32, tagT: 0.5, tagSide: "above" },
  { id: "LFMN-LFPG", a: "LFMN", b: "LFPG", contested: true, k: 0.22, tagT: 0.5, tagSide: "right" },
  { id: "LFML-LFKJ", a: "LFML", b: "LFKJ", k: 0.08 },
  { id: "LFML-LEBL", a: "LFML", b: "LEBL", k: 0.2 },
  { id: "LFML-LIMC", a: "LFML", b: "LIMC", k: 0.2 },
];
// Aircraft in the air at 17:58Z. t is the progress from `from` to `to`.
const FLIGHTS = [
  { owner: "player", line: "LFMN-LFLL", from: "LFLL", to: "LFMN", t: 0.82, reg: "F-HAZA", info: "AZR 1136 → LFMN", late: "+14 min", tag: "above" },
  { owner: "player", line: "LFMN-LFPG", from: "LFPG", to: "LFMN", t: 0.4, reg: "F-HAZD", info: "AZR 2214 → LFMN", tag: "below" },
  { owner: "me", from: "LFMN", to: "LFPG", k: 0.24, t: 0.55, reg: "F-HAZR", info: "Ton vol · AZR 4127", tag: "above" },
  { owner: "rival", line: "LFML-LFLL", from: "LFLL", to: "LFML", t: 0.62, reg: "F-HMRA", info: "MRD 220 → LFML", tag: "below" },
  { owner: "rival", line: "LFML-LIMC", from: "LFML", to: "LIMC", t: 0.38, reg: "F-HMRC", info: "MRD 412 → LIMC", tag: "right" },
  { owner: "rival", line: "LFML-LEBL", from: "LFML", to: "LEBL", t: 0.48, reg: "F-HMRE", info: "MRD 731 → LEBL", tag: "below" },
];
const LABEL_SIDE = { LFMN: "below", LFLL: "left", LFPG: "left", LFKJ: "right", LFML: "below", LEBL: "left", LIMC: "above" };
if (view === "rival") LABEL_SIDE.LFML = "left";

// Plane coordinates in degrees of latitude, centred on the region; then a camera orbiting at
// azimuth `az` (bearing it looks towards) and looking down at `el`.
const KX = Math.cos(rad(45));
const LON0 = 5.4;
const LAT0 = 45.2;
const toRF = (lon, lat) => {
  const X = (lon - LON0) * KX;
  const Y = lat - LAT0;
  return [X * Math.cos(az) - Y * Math.sin(az), X * Math.sin(az) + Y * Math.cos(az)];
};
const camRF = (r, f, z) => {
  const fr = f + DC * Math.cos(el);
  const zr = (z || 0) - DC * Math.sin(el);
  const yc = fr * Math.sin(el) + zr * Math.cos(el);
  const zc = fr * Math.cos(el) - zr * Math.sin(el);
  return { x: r / zc, y: -yc / zc };
};

// Arcs: straight on the ground, lifted by a sine in height.
const arcPoint = (a, b, k, t) => {
  const A = toRF(AP[a].lon, AP[a].lat);
  const B = toRF(AP[b].lon, AP[b].lat);
  const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
  return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, k * len * Math.sin(Math.PI * t)];
};

// Fit every airport and arc of both views into the fit box, so both screens share one framing.
const probe = [];
for (const c of Object.keys(AP)) { const p = toRF(AP[c].lon, AP[c].lat); probe.push(camRF(p[0], p[1], 0)); }
for (const l of PLAYER.concat(RIVAL)) for (let i = 0; i <= 10; i++) { const p = arcPoint(l.a, l.b, l.k, i / 10); probe.push(camRF(p[0], p[1], p[2])); }
let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
for (const p of probe) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
const fL = IN.fitLeft, fR = IN.fitRight, fT = IN.fitTop, fB = IN.fitBottom;
const sc = Math.min((fR - fL) / (x1 - x0), (fB - fT) / (y1 - y0));
const ox = (fL + fR) / 2 - ((x0 + x1) / 2) * sc;
const oy = (fT + fB) / 2 - ((y0 + y1) / 2) * sc;
const SR = (r, f, z) => { const p = camRF(r, f, z); return { x: ox + p.x * sc, y: oy + p.y * sc }; };
const S = (lon, lat, z) => { const p = toRF(lon, lat); return SR(p[0], p[1], z); };
const r1 = (n) => Math.round(n * 10) / 10;
const pathOf = (pts, close) => pts.map((p, i) => (i ? "L" : "M") + r1(p.x) + " " + r1(p.y)).join("") + (close ? "Z" : "");
const node = (name, geometry, extra) => Object.assign({ type: "path", name, x: 0, y: 0, width: W, height: H, viewBox: [0, 0, W, H], geometry }, extra);

// Plate: a camera-aligned rectangle of ground around the network.
const net = Object.keys(AP).map((c) => toRF(AP[c].lon, AP[c].lat));
const PL = {
  r0: Math.min(...net.map((p) => p[0])) - (IN.plateSide || 4),
  r1: Math.max(...net.map((p) => p[0])) + (IN.plateSide || 4),
  f0: Math.min(...net.map((p) => p[1])) - (IN.plateNear || 2.2),
  f1: Math.max(...net.map((p) => p[1])) + (IN.plateFar || 3.2),
};
const inPlate = (p) => p[0] >= PL.r0 && p[0] <= PL.r1 && p[1] >= PL.f0 && p[1] <= PL.f1;
const clipEdge = (poly, axis, val, keepGreater) => {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ia = keepGreater ? a[axis] >= val : a[axis] <= val;
    const ib = keepGreater ? b[axis] >= val : b[axis] <= val;
    if (ia) out.push(a);
    if (ia !== ib) {
      const t = (val - a[axis]) / (b[axis] - a[axis]);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
};
const clipPlate = (poly) => {
  let p = poly;
  for (const [axis, val, g] of [[0, PL.r0, true], [0, PL.r1, false], [1, PL.f0, true], [1, PL.f1, false]]) {
    if (p.length < 3) return [];
    p = clipEdge(p, axis, val, g);
  }
  return p;
};
const splitInside = (pts) => {
  const runs = [];
  let cur = [];
  for (const p of pts) {
    if (inPlate(p)) cur.push(p);
    else { if (cur.length > 1) runs.push(cur); cur = []; }
  }
  if (cur.length > 1) runs.push(cur);
  return runs;
};
const decode = (s) => s.split(";").map((ring) => ring.split(" ").map((q) => { const [lon, lat] = q.split(",").map(Number); return toRF(lon, lat); }));

// Coastlines and borders: Natural Earth 1:50m, clipped to Western Europe and simplified.
const GEO = {"land": "3.15,39.79 3.4,39.78 3.46,39.7 3.15,39.33 3.07,39.3 2.8,39.39 2.7,39.54 2.5,39.48 2.37,39.61 2.78,39.85 3.16,39.97 3.2,39.89;9.63,40.88 9.81,40.5 9.64,40.27 9.71,40.02 9.56,39.17 9.49,39.14 9.06,39.24 8.97,38.96 8.88,38.91 8.65,38.93 8.42,39.21 8.4,39.48 8.45,39.72 8.54,39.77 8.55,39.84 8.41,39.92 8.4,39.98 8.47,40.13 8.47,40.29 8.35,40.5 8.19,40.65 8.22,40.91 8.36,40.85 8.57,40.85 8.82,40.95 9.23,41.26 9.62,41.02 9.55,40.93;9.48,42.81 9.45,42.66 9.53,42.55 9.55,42.13 9.4,41.93 9.37,41.68 9.19,41.38 8.81,41.59 8.89,41.7 8.72,41.76 8.74,41.93 8.62,41.96 8.7,42.04 8.57,42.22 8.68,42.28 8.57,42.36 8.71,42.55 9.14,42.73 9.29,42.69 9.36,43.02 9.46,42.98;15.58,38.22 15.23,37.78 15.1,37.46 15.12,37.33 15.23,37.24 15.17,37.21 15.3,37.06 15.12,36.84 15.11,36.69 14.56,36.78 14.37,36.97 14.14,37.1 13.8,37.14 13.17,37.48 12.87,37.58 12.64,37.59 12.44,37.82 12.55,38.05 12.73,38.18 12.9,38.03 13.16,38.19 13.29,38.19 13.79,37.98 14.05,38.04 14.51,38.05 14.79,38.17 15.12,38.15 15.5,38.29 15.63,38.27;0.17,53 0.05,52.91 0.28,52.81 0.38,52.83 0.56,52.97 1.06,52.96 1.38,52.89 1.72,52.68 1.75,52.47 1.56,52.09 1.32,51.96 1.23,51.97 1.27,51.85 1.19,51.8 0.96,51.81 0.75,51.73 0.9,51.69 0.89,51.57 0.42,51.47 0.53,51.48 0.69,51.39 0.89,51.36 1.41,51.36 1.37,51.16 1.04,51.05 0.96,50.93 0.77,50.93 0.3,50.78 -0.2,50.81 -0.79,50.77 -1.42,50.9 -1.33,50.82 -1.52,50.75 -2.03,50.73 -1.96,50.63 -2,50.61 -2.35,50.64 -2.43,50.6 -2.9,50.72 -3.4,50.63 -3.68,50.24 -3.79,50.23 -4.17,50.39 -4.73,50.29 -5.01,50.16 -5.12,50.04 -5.23,50.02 -5.43,50.1 -5.62,50.05 -5.66,50.13 -5.34,50.25 -4.89,50.53 -4.58,50.78 -4.52,50.98 -4.3,51.03 -4.19,51.19 -3.84,51.23 -3.14,51.21 -2.43,51.74 -3.29,51.39 -3.56,51.41 -3.89,51.59 -4.23,51.57 -4.09,51.66 -4.39,51.74 -4.6,51.74 -4.9,51.63 -5.12,51.71 -5.2,51.86 -5.26,51.88 -5.18,51.95 -4.22,52.28 -3.98,52.54 -4.08,52.61 -4.04,52.7 -4.12,52.82 -4.1,52.92 -4.68,52.81 -4.64,52.89 -4.44,53;-6.04,53 -6.22,52.54 -6.46,52.35 -6.33,52.25 -6.89,52.16 -6.97,52.25 -7,52.17 -7,53;16.65,43 17.09,42.96 17.19,42.92 17.09,42.91 16.74,42.91;17.19,43.13 16.68,43.12 16.38,43.21;16.79,43.27 16.49,43.29 16.42,43.32 16.45,43.39 16.83,43.35 16.89,43.31;-2.02,49.23 -2.01,49.18 -2.17,49.19 -2.24,49.18 -2.22,49.27;-1.18,45.9 -1.21,45.82 -1.37,45.97 -1.39,46.05;-1.07,50.69 -1.25,50.59 -1.52,50.67 -1.31,50.77;10.4,42.86 10.42,42.71 10.34,42.76 10.21,42.74 10.13,42.74 10.13,42.81;4.29,39.84 3.87,39.96 3.85,40.04 4.06,40.08 4.23,40.03 4.32,39.92;1.45,38.92 1.41,38.86 1.22,38.9 1.3,39.03 1.56,39.12 1.61,39.09 1.62,39.04;14.81,44.98 14.69,44.96 14.44,45.1 14.57,45.22;15.19,44.34 15.16,44.31 14.91,44.49 14.74,44.7 15.24,44.35;14.49,44.66 14.48,44.62 14.42,44.67 14.31,44.9 14.34,45.02 14.29,45.14 14.36,45.17 14.47,44.97;3.95,51.74 4.08,51.65 3.95,51.63 3.82,51.69 3.73,51.68 3.7,51.73;18,53 18,36 0.11,36 0.31,36.16 0.97,36.44 1.26,36.52 2.59,36.6 2.97,36.78 3.52,36.8 3.78,36.9 4.76,36.9 5.3,36.65 6.06,36.86 6.25,36.94 6.33,37.05 6.49,37.09 6.58,37 6.93,36.92 7.24,36.97 7.2,37.09 7.43,37.06 7.91,36.86 8.82,37 9.14,37.19 9.69,37.34 9.84,37.31 9.78,37.21 9.83,37.14 9.9,37.18 9.88,37.25 10.2,37.21 10.19,37.03 10.33,36.87 10.29,36.78 10.41,36.73 10.57,36.88 11.05,37.07 11.13,36.87 10.97,36.74 10.8,36.49 10.53,36.32 10.48,36.18 10.52,36 18,36 18,42.71 17.05,43.01 17.22,43.03 17.72,42.85 16.9,43.39 16.39,43.54 15.99,43.52 15.94,43.66 15.5,43.91 15.19,44.17 15.12,44.26 15.47,44.27 14.98,44.6 14.9,44.71 14.91,44.97 14.85,45.08 14.55,45.3 14.31,45.34 14.24,45.16 13.97,44.84 13.9,44.83 13.63,45.11 13.52,45.48 13.78,45.63 13.63,45.77 13.47,45.71 13.21,45.77 13.03,45.64 12.76,45.54 12.5,45.46 12.43,45.47 12.54,45.54 12.35,45.49 12.27,45.45 12.23,45.24 12.39,45.04 12.52,44.97 12.38,44.8 12.28,44.83 12.25,44.72 12.4,44.22 12.69,43.99 13.56,43.57 13.8,43.18 14.01,42.69 14.54,42.24 15.17,41.93 15.96,41.94 16.16,41.9 16.15,41.76 15.91,41.62 15.9,41.51 17.1,41.06 18,40.61 18,40.06 17.87,40.28 17.4,40.34 17.26,40.4 17.18,40.5 17.03,40.51 16.81,40.33 16.53,39.86 16.52,39.75 16.6,39.64 16.82,39.58 17.11,39.38 17.17,39 17.1,38.92 16.95,38.94 16.62,38.8 16.56,38.71 16.55,38.41 16.28,38.25 16.06,37.94 15.72,37.94 15.65,38.03 15.64,38.18 15.7,38.26 15.82,38.3 15.9,38.48 15.88,38.61 15.97,38.71 16.2,38.76 16.21,38.94 16.11,39.02 16.02,39.35 15.69,39.99 15.59,40.05 15.29,40.07 14.95,40.24 14.93,40.31 14.99,40.38 14.95,40.47 14.77,40.67 14.34,40.6 14.46,40.73 14.31,40.81 14.04,40.81 13.86,41.13 13.73,41.24 13.25,41.29 13.09,41.24 12.85,41.41 12.63,41.47 12.08,41.94 11.81,42.08 11.64,42.29 11.3,42.42 11.1,42.42 11.18,42.46 11.17,42.54 10.8,42.8 10.71,42.94 10.51,42.97 10.52,43.2 10.32,43.51 10.25,43.85 10.19,43.95 10.05,44.02 9.73,44.1 9.29,44.32 8.77,44.42 8.55,44.35 8,43.88 7.26,43.7 6.72,43.37 6.57,43.2 6.12,43.07 5.81,43.1 5.41,43.23 5.32,43.34 5.07,43.37 5.06,43.44 4.71,43.37 4.22,43.48 4.05,43.59 3.91,43.56 3.78,43.46 3.26,43.19 3.05,42.92 3.09,42.59 3.31,42.29 3.17,42.26 3.15,42.16 3.24,42.08 3.25,41.94 3,41.77 2.31,41.47 2.08,41.29 1.03,41.06 0.71,40.82 0.89,40.72 0.86,40.69 0.6,40.61 -0.08,39.88 -0.33,39.52 -0.33,39.42 -0.13,38.97 0.2,38.76 -0.52,38.32 -0.81,37.77 -0.82,37.71 -0.72,37.63 -0.82,37.58 -1.33,37.56 -1.64,37.39 -1.8,37.23 -1.94,36.95 -2.19,36.75 -2.45,36.83 -2.79,36.71 -3.15,36.76 -3.43,36.71 -3.83,36.76 -4.37,36.72 -4.67,36.51 -4.94,36.5 -5.17,36.42 -5.36,36.13 -5.44,36.15 -5.46,36.07 -5.55,36.04 -6.04,36.19 -6.23,36.43 -6.27,36.6 -6.38,36.64 -6.41,36.73 -6.22,36.91 -6.32,36.91 -6.4,36.83 -6.49,36.95 -6.88,37.19 -6.86,37.28 -7,37.2 -7,43.57 -5.85,43.65 -4.52,43.42 -3.6,43.52 -3.05,43.37 -2.88,43.45 -2.34,43.33 -1.99,43.35 -1.63,43.44 -1.48,43.56 -1.25,44.56 -1.17,44.66 -1.08,44.69 -1.15,44.76 -1.25,44.67 -1.19,45.16 -1.08,45.53 -0.83,45.38 -0.69,45.09 -0.55,45 -0.64,45.09 -0.79,45.47 -1.2,45.71 -1.21,45.77 -1.03,45.74 -1.15,46.31 -1.39,46.35 -1.79,46.51 -2.09,46.87 -2.02,47.04 -2.2,47.16 -2.15,47.22 -2.03,47.27 -1.74,47.22 -1.98,47.31 -2.5,47.31 -2.53,47.38 -2.43,47.47 -2.55,47.53 -2.77,47.51 -2.73,47.6 -2.79,47.63 -2.96,47.6 -3.16,47.69 -3.44,47.71 -3.9,47.84 -4.31,47.82 -4.43,47.97 -4.68,48.04 -4.33,48.17 -4.58,48.29 -4.24,48.3 -4.39,48.37 -4.72,48.36 -4.76,48.45 -4.72,48.54 -4.53,48.62 -3.71,48.71 -3.47,48.81 -3.23,48.84 -3,48.79 -2.69,48.54 -2.45,48.65 -2.08,48.65 -2,48.58 -1.91,48.7 -1.82,48.63 -1.38,48.65 -1.57,48.81 -1.58,49.2 -1.81,49.49 -1.86,49.68 -1.26,49.68 -1.23,49.49 -1.14,49.39 -0.16,49.3 0.42,49.45 0.13,49.51 0.19,49.7 0.62,49.86 1.25,50 1.41,50.09 1.59,50.25 1.55,50.29 1.58,50.74 1.77,50.94 2.45,51.07 3.43,51.39 4.23,51.39 3.59,51.45 3.45,51.54 3.74,51.6 4.14,51.46 4.27,51.47 4,51.6 4.18,51.61 3.95,51.81 4.08,51.99 4.48,52.31 4.77,52.94 4.89,52.91 5.15,53", "borders": "13.81,48.77 13.55,48.96 13.4,48.98 12.92,49.33 12.81,49.33 12.68,49.41 12.39,49.74 12.51,49.9 12.21,50.1 12.09,50.3 12.28,50.18 12.55,50.39 12.94,50.41 13.02,50.49 13.18,50.51 13.37,50.62 13.44,50.6 13.56,50.7 14.37,50.9 14.26,51 14.32,51.04 14.55,50.99 14.66,50.83 14.81,50.86;6.34,49.45 6.49,49.8 6.2,49.92 6.11,50.03 6.12,50.12;2.52,51.1 2.6,50.88 2.76,50.75 2.84,50.71 3.11,50.78 3.23,50.66 3.27,50.53 3.6,50.48 3.69,50.31 3.95,50.34 4.17,50.25 4.15,49.97 4.55,49.96 4.82,50.15 4.86,50.14 4.79,49.96 4.87,49.79 5.28,49.68 5.51,49.51 5.79,49.54;6.12,50.12 5.98,50.17 5.74,49.92 5.72,49.81 5.88,49.64 5.79,49.54;17.98,50 17.83,49.98 17.6,50.14 17.74,50.23 17.7,50.31 17.42,50.25 17.15,50.38 16.88,50.43 16.99,50.24 16.64,50.1 16.21,50.42 16.42,50.57 16.28,50.66 16.01,50.61 15.73,50.74 15.35,50.81 15.26,50.96 14.99,51.01 14.98,50.89 14.81,50.86;13.81,48.77 13.99,48.69 14.05,48.6 14.69,48.6 14.79,48.75 14.92,48.77 14.97,48.98 15.07,49 15.83,48.86 16.06,48.75 16.37,48.74 16.54,48.8 16.88,48.7 16.95,48.6;16.09,46.86 16.25,46.97 16.45,47.01 16.49,47.12 16.42,47.22 16.46,47.27 16.44,47.4 16.62,47.45 16.68,47.54 16.64,47.61 16.42,47.67 16.59,47.75 16.79,47.68 17.07,47.71 17.03,47.84 17.15,48.01;7.02,45.93 7.13,45.88 7.54,45.98 7.79,45.92 7.99,46.02 8.13,46.16 8.1,46.27 8.42,46.45 8.46,46.25 8.64,46.11 8.82,46.08 8.78,46 8.95,45.83 9.02,45.85 9,46.01 9.25,46.29 9.26,46.48 9.43,46.48 9.53,46.31 9.94,46.36 10.04,46.24 10.13,46.24 10.04,46.48 10.09,46.6 10.2,46.62 10.43,46.55 10.4,46.67 10.45,46.86;10.45,46.86 10.41,46.96 10.35,46.98 10.13,46.85 9.88,46.94 9.85,47.01 9.58,47.06;7.19,53 7.01,52.63 6.71,52.62 6.69,52.53 6.75,52.46 6.97,52.44 7.04,52.38 6.98,52.21 6.72,52.08 6.8,51.98 6.78,51.94 6.36,51.82 6.17,51.88 5.95,51.8 6.2,51.45 6.08,51.22 6.13,51.15 5.86,51.03 6.05,50.9 5.99,50.75;9.58,47.06 9.61,47.11 9.53,47.27;7.49,43.77 7.48,43.86 7.68,44.08 7.64,44.16 7.32,44.14 6.9,44.34 6.84,44.51 7.03,44.72 6.99,44.83 6.74,44.92 6.63,45.07 6.63,45.12 6.69,45.14 6.84,45.14 7.08,45.24 7.15,45.38 6.79,45.74 6.8,45.81 7.02,45.93;16.52,46.5 16.32,46.53 16.24,46.48 16.23,46.37 16.07,46.37 15.93,46.28 15.64,46.2 15.59,46.14 15.67,46.05 15.65,45.86 15.28,45.73 15.35,45.66 15.28,45.58 15.34,45.47 14.79,45.48 14.57,45.66 14.37,45.48 13.99,45.51 13.88,45.43 13.58,45.52;17.96,45.77 17.31,46 16.87,46.34 16.52,46.5;16.52,46.5 16.38,46.64 16.28,46.86 16.09,46.86;5.99,50.75 6.24,50.6 6.17,50.55 6.2,50.5 6.34,50.45 6.36,50.32 6.18,50.23 6.12,50.12;10.45,46.86 10.99,46.78 11.13,46.94 11.24,46.98 11.78,46.99 12.17,47.08 12.15,46.94 12.39,46.7 13.7,46.52;13.7,46.52 13.38,46.26 13.63,46.18 13.48,46.01 13.61,45.96 13.58,45.81 13.72,45.76 13.87,45.61 13.72,45.59;1.43,42.6 1.29,42.71 0.7,42.85 0.63,42.69 -0.04,42.69 -0.3,42.83 -0.59,42.8 -0.76,42.94 -1.18,43.02 -1.3,43.1 -1.37,43.04 -1.46,43.05 -1.41,43.24 -1.71,43.31 -1.79,43.41;1.43,42.6 1.5,42.64 1.71,42.6 1.71,42.5;1.71,42.5 2.03,42.35 2.2,42.42 2.65,42.34 2.7,42.41 2.89,42.46 3.21,42.43;1.43,42.6 1.45,42.44 1.71,42.5;17.92,42.81 17.8,42.9 17.67,42.9;4.23,51.39 4.17,51.31 3.9,51.21 3.58,51.29 3.43,51.25 3.35,51.38;5.99,50.75 5.75,50.76 5.64,50.84 5.75,50.95 5.82,51.09 5.8,51.15 5.48,51.29 5.21,51.28 5.1,51.35 5.03,51.47 4.85,51.4 4.76,51.49 4.63,51.42 4.5,51.47 4.38,51.43 4.37,51.36 4.23,51.39;6.34,49.45 6.53,49.39 6.74,49.16 6.89,49.21 7,49.18 7.04,49.11 7.45,49.15 7.61,49.06 8.13,48.97 8.14,48.89 7.84,48.64 7.62,48.16 7.53,47.67 7.62,47.59;9.52,47.52 9.18,47.67 8.88,47.66 8.57,47.78 8.4,47.69 8.57,47.65 8.45,47.6 7.62,47.59;9.53,47.27 9.63,47.47 9.52,47.52;9.58,47.06 9.49,47.06 9.53,47.27;7.02,45.93 6.77,46.17 6.82,46.28 6.76,46.42 6.43,46.43 6.23,46.33 6.27,46.25 6.2,46.19 6.01,46.14 5.97,46.21 6.1,46.28 6.12,46.38 6.07,46.46 6.16,46.61 6.41,46.76 6.46,46.95 6.67,47.03 7,47.32 6.9,47.39 6.97,47.45 7.14,47.49 7.2,47.43 7.34,47.43 7.62,47.59;-6.98,38.12 -6.97,38.19;-6.98,39.8 -6.92,40.06;-6.95,40.25 -6.81,40.34 -6.85,40.44 -6.84,40.78 -6.92,41.04 -6.21,41.53 -6.31,41.64 -6.54,41.67 -6.56,41.87 -6.62,41.94 -6.87,41.95;13.81,48.77 13.79,48.59 13.72,48.54 13.49,48.58 13.37,48.36 12.9,48.2 12.76,48.11 12.95,47.89 12.9,47.72 13.05,47.66 13.01,47.48 12.81,47.54 12.77,47.64 12.69,47.67 12.48,47.64 12.21,47.72 12.19,47.62 11.72,47.58 11.3,47.42 11.04,47.39 10.87,47.52 10.44,47.55 10.37,47.37 10.18,47.28 10.2,47.36 10.07,47.39 9.97,47.51 9.75,47.58 9.52,47.52;16.09,46.86 15.98,46.8 15.96,46.68 15.77,46.71 15.44,46.63 14.89,46.61 14.55,46.4 13.7,46.52;18,45.14 17.81,45.08 17.65,45.16 17.5,45.12 17.13,45.17 16.92,45.28 16.79,45.2 16.53,45.22 16.29,45.01 16.03,45.19 15.79,45.18 15.74,44.77 16.1,44.52 16.21,44.22 16.3,44.12 17.08,43.52 17.27,43.45 17.29,43.31 17.65,43.01 17.59,42.94;16.95,48.6 17.14,48.84 17.63,48.84 17.94,49.01;17.15,48.01 16.87,48.39 16.95,48.6;17.15,48.01 17.32,47.99 17.76,47.77 17.95,47.77;14.81,50.86 15.02,51.25 14.91,51.46 14.72,51.52 14.74,51.63 14.6,51.83 14.75,52.08 14.68,52.25 14.55,52.36 14.62,52.53 14.13,52.88 14.19,52.98;8.28,36.05 8.35,36.37 8.21,36.52 8.37,36.63 8.44,36.76 8.6,36.83 8.58,36.94;5.79,49.54 6.01,49.45 6.18,49.5 6.34,49.45;12.44,43.98 12.44,43.98;7.44,43.75 7.38,43.73;12.43,41.91 12.43,41.91"};

const nodes = [];
// No hard plate: a dark pool under the network and land that fades out into the 3D scene.
const fc = { x: (fL + fR) / 2 / W, y: (fT + fB) / 2 / H };
const fade = (color, hold, sw, sh) => ({
  type: "gradient", gradientType: "radial", center: fc, size: { width: ((fR - fL) * (sw || 1.7)) / W, height: ((fB - fT) * (sh || 2.3)) / H },
  colors: [{ color: color, position: 0 }, { color: color, position: hold }, { color: color.slice(0, 7) + "00", position: 1 }],
});
nodes.push(node("Bassin sombre", "M0 0L" + W + " 0L" + W + " " + H + "L0 " + H + "Z", { fill: fade("#06080BF2", 0.5, 2.1, 2.9) }));

// Graticule every 2°.
let grat = "";
for (let lon = -6; lon <= 18; lon += 2) {
  const pts = [];
  for (let lat = 35; lat <= 54; lat += 0.25) pts.push(toRF(lon, lat));
  for (const run of splitInside(pts)) grat += pathOf(run.map((p) => SR(p[0], p[1], 0)));
}
for (let lat = 36; lat <= 54; lat += 2) {
  const pts = [];
  for (let lon = -7; lon <= 18; lon += 0.25) pts.push(toRF(lon, lat));
  for (const run of splitInside(pts)) grat += pathOf(run.map((p) => SR(p[0], p[1], 0)));
}
nodes.push(node("Graticule", grat, { stroke: fade("#FFFFFF0F", 0.4), strokeWidth: 1 }));

let land = "";
for (const ring of decode(GEO.land)) {
  const c = clipPlate(ring);
  if (c.length > 2) land += pathOf(c.map((p) => SR(p[0], p[1], 0)), true);
}
nodes.push(node("Terres", land, { fill: fade("#242A31FF", 0.5), stroke: fade("#FFFFFF52", 0.45), strokeWidth: 1, strokeLinejoin: "round" }));
let borders = "";
for (const line of decode(GEO.borders)) for (const run of splitInside(line)) borders += pathOf(run.map((p) => SR(p[0], p[1], 0)));
nodes.push(node("Frontières", borders, { stroke: fade("#FFFFFF21", 0.4), strokeWidth: 1, strokeLinejoin: "round" }));

// Lines.
const COL = { line: "#ECEAE5", rival: "#9A9DA2", danger: "$danger", warning: "$warning", route: "$route" };
const arcPts = (a, b, k, t0, t1) => {
  const n = 48;
  const out = [];
  for (let i = 0; i <= n; i++) { const p = arcPoint(a, b, k, t0 + ((t1 - t0) * i) / n); out.push(SR(p[0], p[1], p[2])); }
  return out;
};
const ground = (a, b) => pathOf([S(AP[a].lon, AP[a].lat, 0), S(AP[b].lon, AP[b].lat, 0)]);
const dashed = (pts, on, off) => {
  let g = "";
  let acc = 0;
  let drawing = true;
  let seg = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1];
    const b = pts[i];
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
};
const apex = (l) => { const p = arcPoint(l.a, l.b, l.k, 0.5); return SR(p[0], p[1], p[2]); };
const textLabel = (name, x, y, w, align, children) => ({ type: "frame", name, x, y, width: w, gap: 6, justifyContent: align, alignItems: "center", children });
const labels = [];

const lines = [];
if (view === "player") {
  for (const l of PLAYER) lines.push(Object.assign({ owner: "player" }, l));
} else {
  for (const l of PLAYER) lines.push(Object.assign({ owner: "player", dim: true }, l));
  for (const l of RIVAL) lines.push(Object.assign({ owner: "rival" }, l));
}
let tracks = "";
for (const l of lines) tracks += ground(l.a, l.b);
nodes.push(node("Traces au sol", tracks, { stroke: "#FFFFFF17", strokeWidth: 1 }));

for (const l of lines) {
  const pts = arcPts(l.a, l.b, l.k, 0, 1);
  const isSel = l.owner === "player" && l.id === sel && !l.dim;
  const name = (l.owner === "rival" ? "Ligne Méridia · " : "Ligne · ") + l.a + "–" + l.b;
  if (l.owner === "player" && l.state === "interrupted") {
    nodes.push(node(name, dashed(pts, 7, 6), { stroke: COL.danger, strokeWidth: 2, strokeLinecap: "round", opacity: l.dim ? 0.55 : 0.9 }));
  } else if (l.owner === "player") {
    nodes.push(node(name, pathOf(pts), { stroke: COL.line, strokeWidth: isSel ? 2.5 : 2, strokeLinecap: "round", opacity: l.dim ? 0.3 : isSel ? 0.75 : 0.42, effect: isSel ? { type: "shadow", offset: { x: 0, y: 0 }, blur: 10, color: "#ECEAE559" } : undefined }));
  } else {
    nodes.push(node(name, pathOf(pts), { stroke: l.contested ? COL.warning : COL.rival, strokeWidth: 2, strokeLinecap: "round", opacity: l.contested ? 0.95 : 0.8 }));
  }
  if (!l.dim && l.owner === "player" && l.state === "interrupted") {
    const q = arcPoint(l.a, l.b, l.k, 0.62);
    const p = SR(q[0], q[1], q[2]);
    labels.push(textLabel("Repère · " + l.id, p.x - 182, p.y - 9, 170, "end", [
      { type: "icon", name: "Icon", width: 13, height: 13, icon: "circle-x", library: "lucide", fill: "$danger" },
      { type: "text", name: "Label", content: "Interrompue", fontFamily: "$font-ui", fontSize: 12, fontWeight: "500", fill: "$danger" },
    ]));
  }
  if (l.owner === "rival" && l.contested) {
    const q = arcPoint(l.a, l.b, l.k, l.tagT);
    const p = SR(q[0], q[1], q[2]);
    const side = l.tagSide;
    const lx = side === "left" ? p.x - 182 : side === "above" ? p.x - 85 : p.x + 10;
    labels.push(textLabel("Repère · " + l.id, lx, side === "above" ? p.y - 30 : p.y - 22, 170, side === "left" ? "end" : side === "above" ? "center" : "start", [
      { type: "icon", name: "Icon", width: 13, height: 13, icon: "swords", library: "lucide", fill: "$warning" },
      { type: "text", name: "Label", content: "Contestée", fontFamily: "$font-ui", fontSize: 12, fontWeight: "500", fill: "$warning" },
    ]));
  }
}

// Aircraft in flight: a bright trail over the flown part, a drop line to the ground and a tag.
const flights = FLIGHTS.filter((f) => (view === "player" ? f.owner !== "rival" : f.owner === "rival"));
const lineOf = (f) => (f.owner === "rival" ? RIVAL : PLAYER).find((l) => l.id === f.line);
let drops = "";
const planes = [];
for (const f of flights) {
  const l = lineOf(f);
  const k = f.k || l.k;
  const reversed = l && l.a !== f.from;
  const a = f.from;
  const b = f.to;
  const col = f.owner === "me" ? COL.route : f.owner === "rival" ? (l.contested ? COL.warning : "#C4C6C9") : COL.line;
  if (f.owner === "me") nodes.push(node("Ton vol · trajectoire", pathOf(arcPts(a, b, k, 0, 1)), { stroke: COL.route, strokeWidth: 2, strokeLinecap: "round", opacity: 0.4 }));
  // Same arc as the line, walked from the departure side.
  const at = (t) => { const p = reversed ? arcPoint(l.a, l.b, k, 1 - t) : arcPoint(a, b, k, t); return SR(p[0], p[1], p[2]); };
  const trail = [];
  for (let i = 0; i <= 40; i++) trail.push(at((f.t * i) / 40));
  nodes.push(node("Parcouru · " + f.reg, pathOf(trail), { stroke: col, strokeWidth: 2.5, strokeLinecap: "round", opacity: f.owner === "rival" ? 0.9 : 1 }));
  const p = at(f.t);
  const q = at(Math.min(1, f.t + 0.02));
  const g = reversed ? arcPoint(l.a, l.b, 0, 1 - f.t) : arcPoint(a, b, 0, f.t);
  const gp = SR(g[0], g[1], 0);
  drops += pathOf([p, gp]);
  planes.push({ f, p, gp, col, heading: Math.atan2(-(q.x - p.x), -(q.y - p.y)) });
}
nodes.push(node("Aplombs", drops, { stroke: "#FFFFFF33", strokeWidth: 1 }));
for (const pl of planes) nodes.push({ type: "ellipse", name: "Ombre · " + pl.f.reg, x: pl.gp.x - 3, y: pl.gp.y - 1.5, width: 6, height: 3, fill: "#FFFFFF40" });

// Airports.
const shown = new Set();
for (const l of lines) { shown.add(l.a); shown.add(l.b); }
const hubs = view === "player" ? { LFMN: "player" } : { LFMN: "player", LFML: "rival" };
for (const c of shown) {
  const p = S(AP[c].lon, AP[c].lat, 0);
  const hub = hubs[c];
  nodes.push({ type: "ellipse", name: "Halo · " + c, x: p.x - 9, y: p.y - 5, width: 18, height: 10, stroke: hub ? "#FFFFFF4D" : "#FFFFFF26", strokeWidth: 1 });
  nodes.push({ type: "ellipse", name: "Aéroport · " + c, x: p.x - 3.5, y: p.y - 3.5, width: 7, height: 7, fill: hub === "player" ? "$accent" : "$text-primary" });
  const side = LABEL_SIDE[c];
  const kids = [];
  if (hub) {
    kids.push({ type: "ref", ref: "pirBQ", name: "Sign · " + c, descendants: hub === "rival" ? { OYKAu: { content: c, fontSize: 12, fill: "$text-secondary" } } : { OYKAu: { content: c, fontSize: 12 } } });
    if (hub === "rival") kids[0].stroke = "$text-tertiary";
  } else {
    kids.push({ type: "text", name: "Code", content: c, fontFamily: "$font-mono", fontSize: 12, fontWeight: "700", fill: "$text-primary" });
  }
  kids.push({ type: "text", name: "City", content: AP[c].city, fontFamily: "$font-ui", fontSize: 13, fill: "$text-secondary" });
  const w = 200;
  if (side === "right") labels.push(textLabel("Label · " + c, p.x + 14, p.y - 13, w, "start", kids));
  else if (side === "left") labels.push(textLabel("Label · " + c, p.x - 14 - w, p.y - 13, w, "end", kids.reverse()));
  else if (side === "above") labels.push(textLabel("Label · " + c, p.x - w / 2, p.y - 38, w, "center", kids));
  else labels.push(textLabel("Label · " + c, p.x - w / 2, p.y + 12, w, "center", kids));
}

for (const pl of planes) {
  const s = pl.f.owner === "me" ? 22 : 18;
  const th = pl.heading;
  const cx = (s / 2) * Math.cos(th) + (s / 2) * Math.sin(th);
  const cy = -(s / 2) * Math.sin(th) + (s / 2) * Math.cos(th);
  nodes.push({ type: "icon", name: "Avion · " + pl.f.reg, x: pl.p.x - cx, y: pl.p.y - cy, width: s, height: s, icon: "flight", library: "Material Symbols Rounded", fill: pl.col, rotation: (th * 180) / Math.PI, effect: { type: "shadow", offset: { x: 0, y: 2 }, blur: 6, color: "#000000B3" } });
  const f = pl.f;
  const infoFill = f.owner === "me" ? "$route" : "$text-secondary";
  const info = [{ type: "text", name: "Info", content: f.info, fontFamily: "$font-ui", fontSize: 12, fill: infoFill }];
  if (f.late) info.push({ type: "text", name: "Late", content: f.late, fontFamily: "$font-ui", fontSize: 12, fontWeight: "500", fill: "$warning" });
  const tag = {
    type: "frame", name: "Étiquette · " + f.reg, layout: "vertical", gap: 1, padding: [5, 9], cornerRadius: 3, fill: "$surface", stroke: f.owner === "me" ? "#D27AE466" : "$border", strokeWidth: 1, effect: { type: "background_blur", radius: 12 },
    children: [
      { type: "text", name: "Reg", content: f.reg, fontFamily: "$font-mono", fontSize: 12, fontWeight: "700", fill: f.owner === "me" ? "$route" : "$text-primary" },
      { type: "frame", name: "Info Row", gap: 6, children: info },
    ],
  };
  const tw = 220;
  if (f.tag === "right") labels.push(textLabel("Tag · " + f.reg, pl.p.x + 16, pl.p.y - 22, tw, "start", [tag]));
  else if (f.tag === "left") labels.push(textLabel("Tag · " + f.reg, pl.p.x - 16 - tw, pl.p.y - 22, tw, "end", [tag]));
  else if (f.tag === "above") labels.push(textLabel("Tag · " + f.reg, pl.p.x - tw / 2, pl.p.y - 64, tw, "center", [tag]));
  else labels.push(textLabel("Tag · " + f.reg, pl.p.x - tw / 2, pl.p.y + 16, tw, "center", [tag]));
}

for (const l of labels) nodes.push(l);
return nodes.map((n) => { if (n.effect === undefined) delete n.effect; return n; });
