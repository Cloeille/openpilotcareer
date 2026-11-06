/**
 * @schema 2.11
 * @input preset: enum("atr72", "a320", "b777", "a380", "b747") = "atr72"
 * @input deck: enum("auto", "main", "upper") = "auto"
 * @input occupancy: number = 0.97
 * @input highlight: enum("none", "first", "business", "premium", "economy", "lav", "galley") = "none"
 * @input labels: boolean = true
 * @input legend: boolean = true
 * @input layout: string = ""
 * @input accentColor: color = #ECEAE5
 */

// Top-down cabin plan generated from a deck layout: classes, doors, lavatories,
// galleys, stairs, crew seats. Supports single and double-deck aircraft.
// A custom layout can be passed as JSON in `layout` ({"main": [...], "upper": [...]}).

const W = pencil.width;
const H = pencil.height;
const IN = pencil.input;

const CLS = {
  first:    { name: "Première",   w: 2.0,  pitch: 3.0,  fill: "#DDDAD3" },
  business: { name: "Affaires",   w: 1.5,  pitch: 2.3,  fill: "#C4C6C9" },
  premium:  { name: "Premium",    w: 1.15, pitch: 1.5,  fill: "#A9ABAE" },
  economy:  { name: "Économique", w: 1.0,  pitch: 1.25, fill: "#8E9196" },
};
const AISLE = 0.9;
const WALL = 0.8;

const C = { t: "cockpit" };
const DOOR = { t: "door" };
const EXIT = { t: "exit" };
const seats = (cls, rows, pattern, extra) => Object.assign({ t: "seats", cls, rows, pattern }, extra || {});
const svc = (...items) => ({ t: "service", items });
const lav = (id, side, wear) => ({ k: "lav", id, side, wear });
const gal = (id, side, wear) => ({ k: "galley", id, side, wear });
const crew = (n) => ({ t: "crew", n });
const block = (label, value) => ({ t: "block", label, value });
const stairs = (side) => ({ t: "stairs", side: side || "C" });

const PRESETS = {
  atr72: {
    main: { nose: "cockpit", tail: "cone", items: [C, block("Soute", "640 kg"), crew(1), seats("economy", 18, "2-2", { lastRow: 2 }), svc(gal("G1", "L", 0.18), lav("L1", "R", 0.31)), DOOR, crew(1), block("Bagages", "600 kg")] },
  },
  a320: {
    main: { nose: "cockpit", tail: "cone", items: [C, DOOR, svc(gal("G1", "L", 0.22), lav("L1", "R", 0.4)), crew(2), seats("business", 3, "2-2"), seats("economy", 9, "3-3", { startRow: 4 }), EXIT, seats("economy", 15, "3-3"), svc(lav("L2", "L", 0.52), gal("G2", "C", 0.3), lav("L3", "R", 0.71)), DOOR, crew(2)] },
  },
  b777: {
    main: { nose: "cockpit", tail: "cone", items: [C, DOOR, svc(lav("L1", "L", 0.2), gal("G1", "C", 0.25), lav("L2", "R", 0.3)), crew(2), seats("business", 10, "1-2-1"), DOOR, svc(lav("L3", "L", 0.35), gal("G2", "C", 0.4), lav("L4", "R", 0.28)), seats("premium", 3, "2-4-2"), seats("economy", 10, "3-4-3"), DOOR, svc(lav("L5", "L", 0.62), lav("L6", "R", 0.45)), seats("economy", 13, "3-4-3"), DOOR, svc(lav("L7", "L", 0.5), lav("L8", "R", 0.55)), seats("economy", 8, "3-4-3"), DOOR, svc(gal("G3", "C", 0.33)), crew(2)] },
  },
  a380: {
    upperX: 0.05,
    upperMinWidth: 0.88,
    main: { nose: "cockpit", tail: "cone", items: [C, DOOR, stairs("C"), svc(lav("L1", "L", 0.3), gal("G1", "C", 0.28), lav("L2", "R", 0.33)), crew(2), seats("economy", 12, "3-4-3"), DOOR, svc(lav("L3", "L", 0.4), lav("L4", "R", 0.37)), seats("economy", 14, "3-4-3"), DOOR, svc(lav("L5", "L", 0.66), gal("G2", "C", 0.35), lav("L6", "R", 0.48)), seats("economy", 14, "3-4-3"), DOOR, svc(lav("L7", "L", 0.52), lav("L8", "R", 0.88)), seats("economy", 8, "3-4-3"), DOOR, stairs("C"), svc(gal("G3", "C", 0.3)), crew(2)] },
    upper: { nose: "blunt", tail: "round", items: [stairs("C"), crew(2), seats("first", 4, "1-1-1"), svc(lav("U1", "L", 0.15), gal("UG1", "C", 0.2), lav("U2", "R", 0.12)), DOOR, seats("business", 12, "1-2-1"), svc(lav("U3", "L", 0.3), lav("U4", "R", 0.27)), seats("business", 7, "1-2-1"), DOOR, svc(gal("UG2", "C", 0.22)), block("Bar", ""), stairs("C"), crew(1)] },
  },
  b747: {
    upperX: 0.0,
    upperMinWidth: 0.62,
    main: { nose: "plain", tail: "cone", items: [seats("first", 4, "1-1"), svc(lav("L1", "L", 0.2), gal("G1", "R", 0.25)), stairs("L"), DOOR, crew(2), seats("business", 8, "2-2-2"), DOOR, svc(lav("L2", "L", 0.42), gal("G2", "C", 0.36), lav("L3", "R", 0.38)), seats("economy", 12, "3-4-3"), DOOR, svc(lav("L4", "L", 0.64), lav("L5", "R", 0.5)), seats("economy", 14, "3-4-3"), DOOR, svc(lav("L6", "L", 0.47), lav("L7", "R", 0.53)), seats("economy", 10, "3-4-3"), DOOR, svc(gal("G3", "C", 0.3)), crew(2)] },
    upper: { nose: "cockpit", tail: "hump", items: [C, crew(1), seats("business", 8, "2-2"), svc(lav("U1", "L", 0.22), gal("UG1", "R", 0.18)), stairs("R")] },
  },
};

let preset = PRESETS[IN.preset] || PRESETS.atr72;
if (IN.layout && String(IN.layout).trim()) {
  try {
    const custom = JSON.parse(IN.layout);
    preset = Object.assign({}, custom, {
      main: custom.main ? { nose: custom.main.nose || "cockpit", tail: custom.main.tail || "cone", items: custom.main.items || custom.main } : preset.main,
      upper: custom.upper ? { nose: custom.upper.nose || "blunt", tail: custom.upper.tail || "round", items: custom.upper.items || custom.upper } : undefined,
    });
  } catch (e) {
    // Keep the preset when the custom layout is not valid JSON.
  }
}

const groupsOf = (p) => String(p).split("-").map(Number).filter((n) => n > 0);
const sectionWidth = (el) => {
  const c = CLS[el.cls] || CLS.economy;
  const g = groupsOf(el.pattern);
  return g.reduce((a, b) => a + b, 0) * c.w + AISLE * (g.length - 1);
};
const deckWidth = (deck) => {
  let m = 3.4;
  for (const el of deck.items) if (el.t === "seats") m = Math.max(m, sectionWidth(el));
  return m + 2 * WALL;
};

function layoutDeck(deck, D) {
  const o = { seats: [], rects: [], ticks: [], crew: [], pilots: [], stairs: [], rowNums: [], labels: [], D };
  o.noseLen = deck.nose === "blunt" ? 0.55 * D : 1.2 * D;
  o.tailLen = deck.tail === "cone" ? 1.6 * D : deck.tail === "hump" ? 0.9 * D : 0.5 * D;
  let x = deck.nose === "cockpit" ? o.noseLen * 0.5 : deck.nose === "blunt" ? o.noseLen * 0.75 : o.noseLen * 0.95;
  let row = 1;
  const count = {};
  const firstX = {};
  for (const el of deck.items) {
    if (el.t === "cockpit") {
      o.pilots.push({ x: x + 1.0, y: D / 2 - 1.05, w: 1.0, h: 1.0 }, { x: x + 1.0, y: D / 2 + 0.05, w: 1.0, h: 1.0 });
      x += 2.8;
    } else if (el.t === "block") {
      o.rects.push({ kind: "block", x: x + 0.2, y: WALL + 0.1, w: 2.8, h: D - 2 * WALL - 0.2, label: el.label, value: el.value });
      x += 3.2;
    } else if (el.t === "crew") {
      o.crew.push({ x: x + 0.15, y: WALL * 0.45, w: 0.7, h: 0.7 });
      if ((el.n || 1) > 1) o.crew.push({ x: x + 0.15, y: D - WALL * 0.45 - 0.7, w: 0.7, h: 0.7 });
      x += 1.0;
    } else if (el.t === "door" || el.t === "exit") {
      const len = el.t === "door" ? 1.4 : 0.8;
      o.ticks.push({ x: x + 0.2, len: len - 0.4, kind: el.t });
      x += len;
    } else if (el.t === "service") {
      let depth = 0;
      for (const it of el.items) {
        const across = it.k === "lav" ? 1.9 : it.side === "C" ? 3.2 : 2.6;
        const along = it.k === "lav" ? 1.9 : 2.0;
        depth = Math.max(depth, along);
        const y = it.side === "L" ? WALL : it.side === "R" ? D - WALL - across : (D - across) / 2;
        o.rects.push({ kind: it.k, id: it.id, x: x + 0.2, y, w: along, h: across, wear: it.wear || 0 });
      }
      x += depth + 0.4;
    } else if (el.t === "stairs") {
      const across = 1.8;
      const along = 2.2;
      const y = el.side === "L" ? WALL : el.side === "R" ? D - WALL - across : (D - across) / 2;
      o.stairs.push({ x: x + 0.2, y, w: along, h: across });
      x += along + 0.4;
    } else if (el.t === "seats") {
      const c = CLS[el.cls] || CLS.economy;
      const g = groupsOf(el.pattern);
      const total = g.reduce((a, b) => a + b, 0);
      const y0 = (D - sectionWidth(el)) / 2;
      if (el.startRow) row = el.startRow;
      if (firstX[el.cls] === undefined) firstX[el.cls] = x + 0.2;
      for (let r = 0; r < el.rows; r++) {
        const last = r === el.rows - 1 && el.lastRow ? el.lastRow : total;
        let y = y0;
        let idx = 0;
        for (let gi = 0; gi < g.length; gi++) {
          for (let s = 0; s < g[gi]; s++) {
            if (idx < last) o.seats.push({ x: x + 0.2 + r * c.pitch, y: y + c.w * 0.09, w: c.pitch * 0.62, h: c.w * 0.82, cls: el.cls });
            y += c.w;
            idx++;
          }
          y += AISLE;
        }
        if (row === 1 || row % 5 === 0) o.rowNums.push({ x: x + 0.2 + r * c.pitch + c.pitch * 0.31, y: y0, n: row });
        row++;
      }
      count[el.cls] = (count[el.cls] || 0) + total * (el.rows - 1) + (el.lastRow || total);
      x += el.rows * c.pitch + 0.4;
    }
  }
  for (const k of Object.keys(firstX)) o.labels.push({ x: firstX[k], text: CLS[k].name + " · " + count[k], cls: k });
  o.tailStart = Math.max(o.noseLen, x + 0.3);
  o.length = o.tailStart + o.tailLen;
  return o;
}

// Which decks to draw.
const mode = IN.deck || "auto";
const decks = [];
if (preset.upper && (mode === "auto" || mode === "upper")) decks.push({ key: "upper", spec: preset.upper });
if (mode !== "upper") decks.push({ key: "main", spec: preset.main });

const mainD = deckWidth(preset.main);
for (const d of decks) {
  d.D = d.key === "main" ? mainD : Math.max(deckWidth(d.spec), mainD * (preset.upperMinWidth || 0.85));
  d.o = layoutDeck(d.spec, d.D);
}
const mainDeck = decks.find((d) => d.key === "main");
for (const d of decks) d.offset = d.key === "upper" && mainDeck ? (preset.upperX || 0) * mainDeck.o.length : 0;

const two = decks.length > 1;
const titleH = two ? 20 : 0;
const labelH = IN.labels === false ? 0 : 20;
const deckGap = two ? 30 : 0;
const legendH = IN.legend === false ? 0 : 34;
const maxLen = Math.max(...decks.map((d) => d.offset + d.o.length));
const sumD = decks.reduce((a, d) => a + d.D, 0);
const fixed = decks.length * (titleH + labelH) + deckGap * (decks.length - 1) + legendH;
const sc = Math.min(44, (W * 0.97) / maxLen, (H - fixed) / sumD);
const ox0 = (W - maxLen * sc) / 2;
const blockH = sumD * sc + fixed;
let cursorY = Math.max(0, (H - blockH) / 2);

const r1 = (n) => Math.round(n * 10) / 10;
const nodes = [];
const back = [];
const front = [];
const hl = IN.highlight || "none";
const occ = Math.max(0, Math.min(1, IN.occupancy === undefined ? 0.97 : IN.occupancy));
const seatGeo = {};
const rect = (x, y, w, h) => "M" + r1(x) + " " + r1(y) + "h" + r1(w) + "v" + r1(h) + "h" + r1(-w) + "Z";
let wornCount = 0;

for (const d of decks) {
  const o = d.o;
  if (two) {
    front.push({ type: "text", name: "Deck Title", x: ox0 + d.offset * sc, y: cursorY, content: d.key === "upper" ? "Pont supérieur" : "Pont principal", fontFamily: "$font-ui", fontSize: 14, fontWeight: "600", fill: "$text-primary" });
    cursorY += titleH;
  }
  const ox = ox0 + d.offset * sc;
  const labelY = cursorY;
  cursorY += labelH;
  const oy = cursorY;
  const P = (u, v) => r1(ox + u * sc) + " " + r1(oy + v * sc);
  const D = o.D;
  const hw = D / 2;
  const n = o.noseLen;
  const ts = o.tailStart;
  const Lx = o.length;
  const th = d.spec.tail === "cone" ? D * 0.06 : d.spec.tail === "hump" ? D * 0.28 : D * 0.42;
  const blunt = d.spec.nose === "blunt";
  let g = "M" + P(0, hw);
  g += blunt ? "C" + P(0, hw * 0.25) + " " + P(n * 0.25, 0) + " " + P(n, 0) : "C" + P(0, hw * 0.42) + " " + P(n * 0.36, 0) + " " + P(n, 0);
  g += "L" + P(ts, 0);
  g += "C" + P(ts + (Lx - ts) * 0.5, 0) + " " + P(Lx - (Lx - ts) * 0.1, hw - th * 1.6) + " " + P(Lx, hw - th);
  g += "L" + P(Lx, hw + th);
  g += "C" + P(Lx - (Lx - ts) * 0.1, hw + th * 1.6) + " " + P(ts + (Lx - ts) * 0.5, D) + " " + P(ts, D);
  g += "L" + P(n, D);
  g += blunt ? "C" + P(n * 0.25, D) + " " + P(0, hw * 1.75) + " " + P(0, hw) + "Z" : "C" + P(n * 0.36, D) + " " + P(0, hw * 1.58) + " " + P(0, hw) + "Z";
  back.push({ type: "path", name: "Fuselage · " + d.key, x: 0, y: 0, width: W, height: H, viewBox: [0, 0, W, H], geometry: g, fill: "#0F1114E6", stroke: "$border-strong", strokeWidth: 1.5 });

  // Doors and exits, marked on both walls.
  let tg = "";
  for (const t of o.ticks) {
    const x = ox + t.x * sc;
    const w = t.len * sc;
    tg += rect(x, oy - 1.5, w, 3) + rect(x, oy + D * sc - 1.5, w, 3);
  }
  if (tg) back.push({ type: "path", name: "Portes · " + d.key, x: 0, y: 0, width: W, height: H, viewBox: [0, 0, W, H], geometry: tg, fill: "$text-secondary" });

  // Service areas, cargo blocks and stairs.
  for (const r of o.rects) {
    const x = ox + r.x * sc;
    const y = oy + r.y * sc;
    const w = r.w * sc;
    const h = r.h * sc;
    if (r.kind === "block") {
      const kids = [{ type: "text", name: "Label", content: r.label, fontFamily: "$font-ui", fontSize: 11, fill: "$text-tertiary" }];
      if (r.value) kids.push({ type: "text", name: "Value", content: r.value, fontFamily: "$font-ui", fontSize: 13, fontWeight: "500", fill: "$text-primary" });
      front.push({ type: "frame", name: "Zone · " + r.label, x, y, width: w, height: h, layout: "vertical", gap: 2, justifyContent: "center", alignItems: "center", cornerRadius: 3, stroke: "$border-strong", strokeWidth: 1, children: kids });
      continue;
    }
    const worn = r.wear >= 0.6;
    if (worn) wornCount++;
    const isHl = hl === r.kind;
    const stroke = isHl ? IN.accentColor : r.wear >= 0.85 ? "$danger" : worn ? "$warning" : "$border-strong";
    const text = r.kind === "lav" ? "WC" : h > 46 && w > 30 ? "Galley" : "G";
    front.push({ type: "frame", name: (r.kind === "lav" ? "Toilettes " : "Galley ") + (r.id || ""), x, y, width: w, height: h, justifyContent: "center", alignItems: "center", cornerRadius: 3, fill: isHl ? "#FFFFFF1A" : "#FFFFFF08", stroke, strokeWidth: worn || isHl ? 1.5 : 1, children: [
      { type: "text", name: "Label", content: text, fontFamily: "$font-ui", fontSize: Math.max(8, Math.min(11, w * 0.32)), fontWeight: "500", fill: worn ? stroke : "$text-secondary" },
    ] });
  }
  for (const s of o.stairs) {
    const x = ox + s.x * sc;
    const y = oy + s.y * sc;
    const w = s.w * sc;
    const h = s.h * sc;
    let sg = rect(x, y, w, h);
    for (let i = 1; i < 6; i++) sg += "M" + r1(x + (w * i) / 6) + " " + r1(y) + "v" + r1(h);
    front.push({ type: "path", name: "Escalier", x: 0, y: 0, width: W, height: H, viewBox: [0, 0, W, H], geometry: sg, stroke: "$text-tertiary", strokeWidth: 1 });
  }

  // Seats, grouped by class and occupancy.
  for (const s of o.seats) {
    const taken = Math.random() < occ;
    const key = s.cls + (taken ? "-occ" : "-free") + (hl === s.cls ? "-hl" : "");
    seatGeo[key] = (seatGeo[key] || "") + rect(ox + s.x * sc, oy + s.y * sc, s.w * sc, s.h * sc);
  }
  let pg = "";
  for (const s of o.pilots) pg += rect(ox + s.x * sc, oy + s.y * sc, s.w * sc, s.h * sc);
  if (pg) front.push({ type: "path", name: "Pilotes", x: 0, y: 0, width: W, height: H, viewBox: [0, 0, W, H], geometry: pg, fill: "$text-primary" });
  let cg = "";
  for (const s of o.crew) cg += rect(ox + s.x * sc, oy + s.y * sc, s.w * sc, s.h * sc);
  if (cg) front.push({ type: "path", name: "PNC", x: 0, y: 0, width: W, height: H, viewBox: [0, 0, W, H], geometry: cg, fill: "$info" });

  // Row numbers in the wall band, only when seats are large enough to read.
  if (sc * CLS.economy.pitch >= 20) {
    for (const rn of o.rowNums) front.push({ type: "text", name: "Rang " + rn.n, x: ox + rn.x * sc - 6, y: oy + rn.y * sc - 13, width: 12, textGrowth: "fixed-width", textAlign: "center", content: String(rn.n), fontFamily: "$font-mono", fontSize: 9, fill: "$text-tertiary" });
  }

  // Class labels above the deck, pushed right when they would overlap.
  if (IN.labels !== false) {
    let prevEnd = -Infinity;
    for (const l of o.labels.sort((a, b) => a.x - b.x)) {
      let x = Math.max(ox + l.x * sc, prevEnd + 16);
      const w = l.text.length * 6.6;
      prevEnd = x + w;
      front.push({ type: "text", name: "Classe · " + l.text, x, y: labelY, content: l.text, fontFamily: "$font-ui", fontSize: 12, fontWeight: "500", fill: hl === l.cls ? IN.accentColor : "$text-secondary" });
    }
  }
  cursorY += D * sc + deckGap;
}

for (const key of Object.keys(seatGeo)) {
  const [cls, state, h] = key.split("-");
  const c = CLS[cls] || CLS.economy;
  const fill = h ? IN.accentColor : c.fill;
  nodes.push(state === "occ"
    ? { type: "path", name: "Sièges · " + c.name + " · occupés", x: 0, y: 0, width: W, height: H, viewBox: [0, 0, W, H], geometry: seatGeo[key], fill }
    : { type: "path", name: "Sièges · " + c.name + " · libres", x: 0, y: 0, width: W, height: H, viewBox: [0, 0, W, H], geometry: seatGeo[key], stroke: "#FFFFFF4D", strokeWidth: 1.2 });
}

if (IN.legend !== false) {
  const items = [["swatch", CLS.economy.fill, "Occupé"], ["free", null, "Libre"], ["swatch", "$info", "PNC"], ["swatch", "$text-primary", "Pilotes"], ["box", "$border-strong", "Toilettes / galley"]];
  if (wornCount) items.push(["box", "$warning", "À réviser"]);
  const children = items.map(([k, c, l]) => ({ type: "frame", name: "Légende · " + l, gap: 7, alignItems: "center", children: [
    k === "swatch" ? { type: "rectangle", name: "Swatch", width: 11, height: 11, cornerRadius: 2, fill: c }
      : k === "free" ? { type: "rectangle", name: "Swatch", width: 11, height: 11, cornerRadius: 2, stroke: "#FFFFFF4D", strokeWidth: 1.2 }
      : { type: "rectangle", name: "Swatch", width: 11, height: 11, cornerRadius: 2, stroke: c, strokeWidth: 1.5 },
    { type: "text", name: "Label", content: l, fontFamily: "$font-ui", fontSize: 13, fill: "$text-secondary" },
  ] }));
  front.push({ type: "frame", name: "Légende", x: ox0, y: cursorY - deckGap + 14, gap: 24, alignItems: "center", children });
}

return back.concat(nodes, front);
