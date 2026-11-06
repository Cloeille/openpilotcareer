import { h } from '../ui.ts';
import { svg } from '../svg.ts';
import { icon, unknownValue } from '../components.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import { buildModel, placeTags, project, schematicCategory, DEFAULT_PITCH, DEFAULT_YAW, TAG_HEIGHT, type AnchorKey } from '../schematic.ts';
import { flightLevelLabel, enginesRunning, type Body, type LiveCtx, type LiveFacts } from '../live-view.ts';

export const SCHEMATIC_W = 1536;
export const SCHEMATIC_H = 588;
const DOT_COLOR = '#9A9DA1';
const SIZE = [1.25, 1.08, 0.92, 0.78];
const OPACITY = [0.95, 0.68, 0.44, 0.26];
const PITCH_RANGE: [number, number] = [-12, 62];
const ROTATE_KEY_DEG = 6;
const DRAG_YAW = 0.4;
const DRAG_PITCH = 0.3;

const r1 = (n: number): number => Math.round(n * 10) / 10;
const dotPath = (x: number, y: number, r: number): string => `M${r1(x - r)} ${r1(y)}a${r1(r)} ${r1(r)} 0 1 0 ${r1(2 * r)} 0a${r1(r)} ${r1(r)} 0 1 0 ${r1(-2 * r)} 0`;
const squarePath = (x: number, y: number, s: number): string => `M${r1(x - s / 2)} ${r1(y - s / 2)}h${r1(s)}v${r1(s)}h${r1(-s)}Z`;

type TagSpec = { key: AnchorKey; label: string; text: string };

/** The tags that have an honest value: the load of the job, the live heading, the engines in service. */
function tagSpecs(c: LiveCtx, f: LiveFacts | null): TagSpec[] {
  const fm = fmt();
  const job = c.flight.job;
  const specs: TagSpec[] = [];
  if (f?.sample) specs.push({ key: 'cockpit', label: t('live.tag.cockpit'), text: t('live.tag.heading', { deg: Math.round(f.sample.headingDeg) }) });
  if (job.kind === 'pax') specs.push({ key: 'cabin', label: t('live.tag.cabin'), text: t('job.pax', { n: job.pax }) });
  if (job.kind === 'cargo') specs.push({ key: 'cargo', label: t('live.tag.cargo'), text: t('job.cargoKg', { kg: fm.kg(job.payloadKg) }) });
  const running = f ? enginesRunning(f.engines) : 0;
  specs.push({ key: 'engines', label: t('live.tag.engines'), text: running > 0 ? t('live.tag.running', { n: running }) : tp('live.tag.engineCount', c.type.engines) });
  return specs;
}

const fact = (label: string, value: HTMLElement | string): HTMLElement => h('div', { class: 'live-fact' }, h('span', { class: 'live-fact-label' }, label), value instanceof HTMLElement ? value : h('span', { class: 'live-fact-value' }, value));

/** Vue en coupe: the point-cloud drawing of the aircraft type with its callouts, and the four live figures beneath. Drag or arrow keys rotate it. */
export function cutawayBody(c: LiveCtx): Body {
  const model = buildModel(schematicCategory(c.type), { engines: c.type.engines, seats: c.type.seats });
  let yaw = DEFAULT_YAW;
  let pitch = DEFAULT_PITCH;
  let facts: LiveFacts | null = null;
  let queued = false;

  const canvas = svg('svg', { viewBox: `0 0 ${SCHEMATIC_W} ${SCHEMATIC_H}`, width: SCHEMATIC_W, height: SCHEMATIC_H, 'aria-hidden': 'true' });
  const tags = h('div', { class: 'sch-tags' });
  const stage = h('div', {
    class: 'cutaway', tabindex: 0, role: 'img', 'aria-label': t('live.cutaway.aria', { type: c.type.name }),
  }, canvas, tags);

  const draw = (): void => {
    queued = false;
    const p = project(model, { w: SCHEMATIC_W, h: SCHEMATIC_H, yaw, pitch, labels: true });
    const levels = SIZE.length;
    const buckets = Array.from({ length: levels }, () => '');
    for (const d of p.dots) buckets[d.level] += dotPath(d.x, d.y, p.dotRadius * SIZE[d.level]!);
    const specs = new Map(tagSpecs(c, facts).map((s) => [s.key, s]));
    const placed = placeTags(p.anchors.filter((a) => specs.has(a.key)).map((a) => {
      const s = specs.get(a.key)!;
      return { key: a.key, ax: a.x, ay: a.y, side: a.side, w: Math.max(s.label.length * 6.8, s.text.length * 7.9) + 30 };
    }), SCHEMATIC_W, SCHEMATIC_H);
    const leaders = placed.map((b) => `M${r1(b.lx)} ${r1(b.ly)}L${r1(b.ax)} ${r1(b.ay)}`).join('');
    canvas.replaceChildren(
      svg('path', { d: leaders, stroke: '#FFFFFF59', 'stroke-width': 1, fill: 'none' }),
      ...[...buckets.keys()].reverse().map((lvl) => svg('path', { d: buckets[lvl]!, fill: DOT_COLOR, opacity: OPACITY[lvl] })),
      ...(p.seats.length > 0 ? [svg('path', { d: p.seats.map((s) => squarePath(s.x, s.y, p.seatSize)).join(''), fill: DOT_COLOR, opacity: 0.7 })] : []),
      ...placed.map((b) => svg('circle', { cx: r1(b.ax), cy: r1(b.ay), r: 3.5, fill: 'var(--text-primary)' })));
    tags.replaceChildren(...placed.map((b) => {
      const s = specs.get(b.key)!;
      return h('div', { class: 'sch-tag', style: `left:${r1(b.x)}px;top:${r1(b.y)}px;height:${TAG_HEIGHT}px` }, h('span', { class: 'sch-tag-label' }, s.label), h('span', { class: 'sch-tag-value' }, s.text));
    }));
  };
  const redraw = (): void => { if (!queued) { queued = true; requestAnimationFrame(draw); } };
  const rotate = (dYaw: number, dPitch: number): void => { yaw += dYaw; pitch = Math.min(PITCH_RANGE[1], Math.max(PITCH_RANGE[0], pitch + dPitch)); redraw(); };

  let drag: { x: number; y: number } | null = null;
  stage.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointermove', (e) => { if (drag) { rotate((e.clientX - drag.x) * DRAG_YAW, (e.clientY - drag.y) * DRAG_PITCH); drag = { x: e.clientX, y: e.clientY }; } });
  stage.addEventListener('pointerup', () => { drag = null; });
  stage.addEventListener('pointercancel', () => { drag = null; });
  stage.addEventListener('keydown', (e) => {
    const step: Record<string, [number, number]> = { ArrowLeft: [-ROTATE_KEY_DEG, 0], ArrowRight: [ROTATE_KEY_DEG, 0], ArrowUp: [0, 4], ArrowDown: [0, -4] };
    if (e.key === 'Home') { yaw = DEFAULT_YAW; pitch = DEFAULT_PITCH; redraw(); } else if (step[e.key]) rotate(...step[e.key]!); else return;
    e.preventDefault();
  });

  const altitude = h('span', { class: 'live-fact-value' });
  const speed = h('span', { class: 'live-fact-value' });
  const eta = h('span', { class: 'live-fact-value' });
  const fuel = h('span', { class: 'live-fact-value' });
  const verif = h('div', { class: 'live-verif' });
  const set = (el: HTMLElement, text: string | null): void => { el.replaceChildren(text ?? unknownValue()); };

  const update = (f: LiveFacts): void => {
    const fm = fmt();
    facts = f;
    set(altitude, f.altitude ? (f.altitude.kind === 'fl' ? flightLevelLabel(f.altitude.level) : t('live.ft', { n: fm.num(f.altitude.ft) })) : null);
    set(speed, f.gsKts !== null ? fm.kt(f.gsKts) : null);
    set(eta, f.etaAt !== null ? fm.zulu(f.etaAt) : null);
    set(fuel, f.fuelKg !== null ? fm.kg(f.fuelKg) : null);
    const flags = f.checks.filter((k) => k.state === 'flagged').length;
    const text = f.lost ? t('live.verif.paused', { time: f.receivedAt !== null ? fm.zulu(f.receivedAt) : '–' })
      : f.sample === null ? t('live.verif.waiting')
      : flags === 0 ? t('live.verif.running') : tp('live.verif.flags', flags);
    verif.className = `live-verif${f.lost ? ' warn' : ''}`;
    verif.replaceChildren(icon(f.lost ? 'pause' : 'scan-line', 15), text);
    redraw();
  };

  const el = h('div', { class: 'live-cutaway-view' },
    h('div', { class: 'cutaway-area' }, stage),
    h('div', { class: 'live-facts' }, fact(t('live.altitude'), altitude), fact(t('live.gs'), speed), fact(t('live.eta'), eta), fact(t('live.fuel'), fuel), h('span', { class: 'grow' }), verif));
  return { el, update };
}
