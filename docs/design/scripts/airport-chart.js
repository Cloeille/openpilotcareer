/**
 * @schema 2.11
 * @input airport: enum("LFMN") = "LFMN"
 * @input selected: string = "MX2"
 * @input yaw: number = -16
 * @input elevation: number = 36
 * @input labels: boolean = true
 * @input filter: enum("all", "maintenance", "terminal", "cargo", "office", "parking") = "all"
 * @input heightScale: number = 3
 * @input focus: boolean = true
 */

// Airport chart in 3D (oblique projection) with selectable facilities.
// Each building has an owner: "airport" (not for sale), "player", "ai" or "available".

const W = pencil.width;
const H = pencil.height;
const IN = pencil.input;

// World units are metres. X runs along the runways, Y goes inland (sea at negative Y).
const AIRPORTS = {
  LFMN: {
    land: [[-250, -330], [3350, -330], [3350, 900], [-250, 900]],
    runways: [
      { id: "04R/22L", x: 100, y: -190, w: 2960, d: 45, ends: ["04R", "22L"] },
      { id: "04L/22R", x: 350, y: 40, w: 2570, d: 45, ends: ["04L", "22R"] },
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
    stands: [0, 1, 2, 3, 4, 5].map((i) => ({ id: "PK" + (i + 1), x: 780 + i * 105, y: 230, w: 70, d: 90, owner: i < 4 ? "player" : "available", kind: "parking" })),
    buildings: [
      { id: "T1", name: "Terminal 1", kind: "terminal", x: 760, y: 410, w: 620, d: 150, h: 22, owner: "airport" },
      { id: "T2", name: "Terminal 2", kind: "terminal", x: 2150, y: 420, w: 660, d: 170, h: 26, owner: "airport" },
      { id: "VIP", name: "Terminal aviation d'affaires", kind: "terminal", x: 2920, y: 330, w: 200, d: 100, h: 12, owner: "available" },
      { id: "MX1", name: "Hangar de maintenance 1", kind: "maintenance", x: 1540, y: 380, w: 230, d: 140, h: 32, owner: "player" },
      { id: "MX2", name: "Hangar de maintenance 2", kind: "maintenance", x: 1800, y: 380, w: 220, d: 140, h: 32, owner: "available" },
      { id: "CG1", name: "Fret & stockage", kind: "cargo", x: 300, y: 380, w: 320, d: 150, h: 18, owner: "ai", ownerName: "Méridia Cargo" },
      { id: "AD", name: "Bureaux administratifs", kind: "office", x: 1480, y: 610, w: 160, d: 90, h: 36, owner: "player" },
      { id: "OPS", name: "Centre d'opérations", kind: "office", x: 1680, y: 610, w: 120, d: 90, h: 20, owner: "available" },
      { id: "TWR", name: "Tour de contrôle", kind: "airport", x: 1380, y: 560, w: 36, d: 36, h: 64, owner: "airport" },
      { id: "FUEL", name: "Dépôt carburant", kind: "airport", x: 620, y: 650, w: 140, d: 90, h: 10, owner: "airport" },
    ],
  },
};

const A = AIRPORTS[IN.airport] || AIRPORTS.LFMN;
const sel = IN.selected || "";
const filter = IN.filter || "all";

// Oblique projection: rotate around Z (yaw), then look down at `elevation` degrees.
const yaw = ((IN.yaw === undefined ? -16 : IN.yaw) * Math.PI) / 180;
const el = ((IN.elevation === undefined ? 36 : IN.elevation) * Math.PI) / 180;
// Vertical exaggeration so buildings read at airport scale.
const hs = Math.max(1, IN.heightScale || 3);
for (const b of A.buildings) b.h = b.h * hs;
const cx = 1550;
const cy = 280;
const proj = (x, y, z) => {
  const dx = x - cx;
  const dy = y - cy;
  const xr = dx * Math.cos(yaw) - dy * Math.sin(yaw);
  const yr = dx * Math.sin(yaw) + dy * Math.cos(yaw);
  return { u: xr, v: yr * Math.sin(el) - (z || 0) * Math.cos(el), d: yr };
};

// Fit everything into the node, keeping room above for labels.
const probe = [];
if (IN.focus === false) for (const p of A.land) probe.push(proj(p[0], p[1], 0));
for (const b of A.buildings) for (const [x, y] of [[b.x - 80, b.y - 60], [b.x + b.w + 80, b.y - 60], [b.x + b.w + 80, b.y + b.d + 60], [b.x - 80, b.y + b.d + 60]]) probe.push(proj(x, y, 0), proj(x, y, b.h));
for (const a of A.aprons) probe.push(proj(a.x, a.y, 0), proj(a.x + a.w, a.y + a.d, 0));
let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
for (const p of probe) { umin = Math.min(umin, p.u); umax = Math.max(umax, p.u); vmin = Math.min(vmin, p.v); vmax = Math.max(vmax, p.v); }
const padTop = IN.labels === false ? 10 : 150;
const pad = 10;
const sc = Math.min((W - 2 * pad) / (umax - umin), (H - padTop - pad) / (vmax - vmin));
const ox = pad + (W - 2 * pad - (umax - umin) * sc) / 2 - umin * sc;
const oy = padTop + (H - padTop - pad - (vmax - vmin) * sc) / 2 - vmin * sc;
const S = (x, y, z) => { const p = proj(x, y, z); return { x: ox + p.u * sc, y: oy + p.v * sc, d: p.d }; };
const r1 = (n) => Math.round(n * 10) / 10;
const poly = (pts) => pts.map((p, i) => (i ? "L" : "M") + r1(p.x) + " " + r1(p.y)).join("") + "Z";
const rectPoly = (x, y, w, d, z) => poly([S(x, y, z), S(x + w, y, z), S(x + w, y + d, z), S(x, y + d, z)]);
const path = (name, geometry, extra) => Object.assign({ type: "path", name, x: 0, y: 0, width: W, height: H, viewBox: [0, 0, W, H], geometry }, extra);

const nodes = [];

// Ground: sea, land, aprons, taxiways, runways.
nodes.push(path("Sol", poly(A.land.map((p) => S(p[0], p[1], 0))), { fill: "#10151C" }));
nodes.push(path("Aires de trafic", A.aprons.map((a) => rectPoly(a.x, a.y, a.w, a.d, 0)).join(""), { fill: "#1A2029" }));
nodes.push(path("Taxiways", A.taxiways.map((t) => rectPoly(t.x, t.y, t.w, t.d, 0)).join(""), { fill: "#1C222A" }));
let tcl = "";
for (const t of A.taxiways) {
  if (t.w > t.d) tcl += poly([S(t.x, t.y + t.d / 2 - 0.8, 0), S(t.x + t.w, t.y + t.d / 2 - 0.8, 0), S(t.x + t.w, t.y + t.d / 2 + 0.8, 0), S(t.x, t.y + t.d / 2 + 0.8, 0)]);
  else tcl += poly([S(t.x + t.w / 2 - 0.8, t.y, 0), S(t.x + t.w / 2 + 0.8, t.y, 0), S(t.x + t.w / 2 + 0.8, t.y + t.d, 0), S(t.x + t.w / 2 - 0.8, t.y + t.d, 0)]);
}
nodes.push(path("Axes taxiways", tcl, { fill: "#E6BE4C", opacity: 0.45 }));
nodes.push(path("Pistes", A.runways.map((r) => rectPoly(r.x, r.y, r.w, r.d, 0)).join(""), { fill: "#262B33" }));
let marks = "";
for (const r of A.runways) {
  for (let x = r.x + 120; x < r.x + r.w - 120; x += 90) marks += rectPoly(x, r.y + r.d / 2 - 0.9, 45, 1.8, 0);
  for (const end of [r.x + 12, r.x + r.w - 42]) for (let k = 0; k < 6; k++) marks += rectPoly(end, r.y + 4 + k * 6.6, 30, 3, 0);
}
nodes.push(path("Marquages", marks, { fill: "#C9CBCE", opacity: 0.55 }));

// Owner palettes for extruded volumes.
const PAL = {
  airport: { top: "#2E333B", front: "#24282F", side: "#1C2026", stroke: "#FFFFFF14" },
  player: { top: "#ECEAE5", front: "#B9B7B2", side: "#8E8C88", stroke: "#FFFFFF40" },
  ai: { top: "#5A5F66", front: "#474B51", side: "#383B40", stroke: "#FFFFFF1F" },
  available: { top: "#E6BE4C40", front: "#E6BE4C2B", side: "#E6BE4C1F", stroke: "#E6BE4C" },
};
const dim = (b) => filter !== "all" && b.kind !== filter;

// Parking stands drawn flat on the apron.
for (const s of A.stands) {
  const p = PAL[s.owner];
  const isSel = s.id === sel;
  nodes.push(path("Poste " + s.id, rectPoly(s.x, s.y, s.w, s.d, 0), { fill: s.owner === "available" ? "#E6BE4C1A" : "#ECEAE51A", stroke: isSel ? "$text-primary" : s.owner === "available" ? "#E6BE4C" : "#ECEAE566", strokeWidth: isSel ? 2 : 1, opacity: dim(s) ? 0.25 : 1 }));
}

// Buildings, far to near.
const blds = A.buildings.slice().sort((a, b) => S(a.x + a.w / 2, a.y + a.d / 2, 0).d - S(b.x + b.w / 2, b.y + b.d / 2, 0).d);
const anchors = [];
for (const b of blds) {
  const p = PAL[b.owner];
  const isSel = b.id === sel;
  const o = dim(b) ? 0.25 : 1;
  const c = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.d], [b.x, b.y + b.d]];
  const faces = [];
  for (let i = 0; i < 4; i++) {
    const a0 = c[i];
    const a1 = c[(i + 1) % 4];
    const ex = a1[0] - a0[0];
    const ey = a1[1] - a0[1];
    const nx = ey;
    const ny = -ex;
    const nyr = nx * Math.sin(yaw) + ny * Math.cos(yaw);
    if (nyr > 0) {
      const facing = Math.abs(ny) > Math.abs(nx) ? "front" : "side";
      faces.push({ geo: poly([S(a0[0], a0[1], 0), S(a1[0], a1[1], 0), S(a1[0], a1[1], b.h), S(a0[0], a0[1], b.h)]), facing });
    }
  }
  for (const f of faces) nodes.push(path(b.name + " · " + (f.facing === "front" ? "façade" : "côté"), f.geo, { fill: f.facing === "front" ? p.front : p.side, stroke: isSel ? "$text-primary" : p.stroke, strokeWidth: isSel ? 2 : 1, opacity: o }));
  nodes.push(path(b.name + " · toit", poly(c.map((q) => S(q[0], q[1], b.h))), { fill: p.top, stroke: isSel ? "$text-primary" : p.stroke, strokeWidth: isSel ? 2 : 1, opacity: o }));
  const top = S(b.x + b.w / 2, b.y + b.d / 2, b.h);
  anchors.push({ b, x: top.x, y: top.y, isSel, o });
}

// Runway designators.
if (IN.labels !== false) {
  for (const r of A.runways) {
    const a = S(r.x - 60, r.y + r.d / 2, 0);
    const z = S(r.x + r.w + 25, r.y + r.d / 2, 0);
    nodes.push({ type: "text", name: "Piste " + r.ends[0], x: a.x - 14, y: a.y - 8, content: r.ends[0], fontFamily: "$font-mono", fontSize: 11, fill: "$text-tertiary" });
    nodes.push({ type: "text", name: "Piste " + r.ends[1], x: z.x - 4, y: z.y - 8, content: r.ends[1], fontFamily: "$font-mono", fontSize: 11, fill: "$text-tertiary" });
  }
}

// Labels: tags for facilities that matter to the player, quiet text for airport infrastructure.
if (IN.labels !== false) {
  const STATUS = { player: ["À toi", "$text-secondary"], available: ["Disponible", "$accent"], ai: [null, "$text-tertiary"] };
  const placed = [];
  const tags = [];
  let leaders = "";
  const order = anchors.slice().sort((a, b) => a.x - b.x);
  for (const a of order) {
    if (a.b.owner === "airport") {
      nodes.push({ type: "text", name: "Label · " + a.b.name, x: a.x - a.b.name.length * 3.1, y: a.y - 22, content: a.b.name, fontFamily: "$font-ui", fontSize: 11, fill: "$text-tertiary", opacity: a.o });
      continue;
    }
    const st = STATUS[a.b.owner];
    const status = a.b.owner === "ai" ? a.b.ownerName : st[0];
    const w = Math.max(a.b.name.length * 7.1, status.length * 6.4) + 24;
    // Tags live in a band above the chart, on up to three rows, each one tied to its roof by a vertical leader.
    let x = Math.max(0, Math.min(W - w, Math.round(a.x - 16)));
    let row = 0;
    while (row < 3 && placed.some((p) => p.row === row && x < p.x + p.w + 10 && p.x < x + w + 10)) row++;
    const y = row * 52;
    placed.push({ x, w, row });
    leaders += "M" + r1(a.x) + " " + r1(a.y) + "L" + r1(a.x) + " " + r1(y + 44);
    tags.push({
      type: "frame", name: "Tag · " + a.b.name, x, y, layout: "vertical", gap: 2, padding: [6, 10], cornerRadius: 4,
      fill: "$surface", stroke: a.isSel ? "$text-primary" : "$border", strokeWidth: a.isSel ? 1.5 : 1, opacity: a.o,
      effect: { type: "background_blur", radius: 12 },
      children: [
        { type: "text", name: "Name", content: a.b.name, fontFamily: "$font-ui", fontSize: 13, fontWeight: "600", fill: "$text-primary" },
        { type: "text", name: "Status", content: status, fontFamily: "$font-ui", fontSize: 11, fontWeight: "500", fill: st[1] },
      ],
    });
    tags.push({ type: "ellipse", name: "Anchor · " + a.b.name, x: a.x - 3, y: a.y - 3, width: 6, height: 6, fill: a.isSel ? "$text-primary" : "#FFFFFF99", opacity: a.o });
  }
  if (leaders) nodes.push(path("Repères", leaders, { stroke: "#FFFFFF59", strokeWidth: 1 }));
  for (const t of tags) nodes.push(t);
}

return nodes;
