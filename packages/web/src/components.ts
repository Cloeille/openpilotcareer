import { ICONS, type IconName } from './icons.ts';
import { h } from './ui.ts';

type Child = Node | string | number | null | false | undefined | Child[];
const SVG_NS = 'http://www.w3.org/2000/svg';

/** A Lucide icon; decorative (aria-hidden), colour follows the text colour. */
export function icon(name: IconName, size = 16): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'icon' })) svg.setAttribute(k, String(v));
  for (const [tag, attrs] of ICONS[name] as readonly (readonly [string, Record<string, string>])[]) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  }
  return svg;
}

/** The logo square beside the product name; `sub` is the line under the name (tagline or server). */
export const brandBlock = (name: string, sub: Child): HTMLElement =>
  h('div', { class: 'brand' }, h('div', { class: 'logo' }, icon('plane-takeoff', 20)), h('div', { class: 'brand-stack' }, h('span', { class: 'brand-name' }, name), sub));

// ------------------------------------------------------------------ Keycap, Button

/** A key legend: `Q`, `Entrée`, `Tab`. */
export const keycap = (label: string): HTMLElement => h('kbd', { class: 'keycap' }, label);

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonOpts = {
  variant?: ButtonVariant; icon?: IconName; key?: string; type?: 'button' | 'submit'; disabled?: boolean;
  /** Accessible name when the visible label is not enough. */
  label?: string; onclick?: (e: MouseEvent) => void; title?: string;
};

/** Button/Primary, /Secondary, /Ghost, /Danger. The primary one of a screen is what Enter triggers (data-primary). */
export function button(text: string, o: ButtonOpts = {}): HTMLButtonElement {
  const variant = o.variant ?? 'secondary';
  return h('button', {
    type: o.type ?? 'button', class: `btn ${variant}`, disabled: o.disabled, 'aria-label': o.label, title: o.title, 'data-primary': variant === 'primary' ? '' : null, onclick: o.onclick,
  }, o.icon && variant !== 'ghost' ? icon(o.icon) : null, h('span', null, text), o.key ? h('span', { class: 'btn-key' }, o.key) : null, variant === 'ghost' ? icon(o.icon ?? 'chevron-right') : null);
}

// ------------------------------------------------------------------ Badge

export type BadgeVariant = 'verified' | 'rejected' | 'unverified' | 'contested' | 'estimated' | 'neutral' | 'info' | 'route';
const BADGE_ICON: Record<BadgeVariant, IconName | null> = {
  verified: 'shield-check', rejected: 'shield-x', unverified: 'circle-dashed', contested: 'swords', estimated: null, neutral: 'plane', info: 'radio', route: 'route',
};
/** Status is carried by the icon and the label, colour only reinforces it. */
export const badge = (variant: BadgeVariant, label: string, iconName?: IconName | null): HTMLElement => {
  const name = iconName === undefined ? BADGE_ICON[variant] : iconName;
  return h('span', { class: `badge ${variant}` }, name ? icon(name, 12) : null, label);
};

// ------------------------------------------------------------------ Sign (ICAO taxiway-style airport codes)

/** Sign/Location: the airport you are at. */
export const signLocation = (code: string): HTMLElement => h('span', { class: 'sign location' }, code);
/** Sign/Direction: the airport you are heading to. */
export const signDirection = (code: string): HTMLElement => h('span', { class: 'sign direction' }, code, icon('arrow-up-right'));

// ------------------------------------------------------------------ Input, Stat, Panel

type InputOpts = { label: string; control?: HTMLElement; icon?: IconName; hint?: string; id?: string; trailing?: HTMLElement };
let uid = 0;
/** Input: a labelled field. Pass the control (input/select) to wrap, or props to build a text input. */
export function inputField(o: InputOpts, props?: Record<string, unknown>): { root: HTMLElement; control: HTMLInputElement } {
  const id = o.id ?? `in${++uid}`;
  const control = (o.control ?? h('input', { type: 'text', ...props })) as HTMLInputElement;
  control.id = id;
  const hintId = o.hint ? `${id}-hint` : null;
  if (hintId) control.setAttribute('aria-describedby', hintId);
  const root = h('div', { class: 'input' },
    h('label', { class: 'input-label', for: id }, o.label),
    h('div', { class: 'input-field' }, o.icon ? icon(o.icon) : null, control, o.trailing ?? null),
    o.hint ? h('small', { id: hintId }, o.hint) : null);
  return { root, control };
}

/** Stat: label, big value, optional coloured delta. */
export const stat = (label: string, value: Child, delta?: Child): HTMLElement =>
  h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, label), h('span', { class: 'stat-value' }, value), delta ? h('span', { class: 'stat-delta' }, delta) : null);

type PanelOpts = { title: string; action?: Child; tick?: boolean; danger?: boolean; class?: string; id?: string; headless?: boolean };
/** Panel: the translucent card every screen is made of. Content is a flat list of children. */
export function panel(o: PanelOpts, ...content: Child[]): HTMLElement {
  const headingId = o.id && !o.headless ? `${o.id}-title` : null;
  return h('section', { class: `panel ${o.danger ? 'danger' : ''} ${o.class ?? ''}`.trim(), id: o.id, 'aria-labelledby': headingId, 'aria-label': o.headless ? o.title : null },
    o.headless ? null : h('header', { class: 'panel-head' }, o.tick ? h('span', { class: 'tick' }) : null, h('h2', { id: headingId }, o.title), o.action ? h('div', { class: 'panel-action' }, o.action) : null),
    h('div', { class: 'panel-body' }, content));
}

/** Title block at the top of a screen: a status line, then the title. */
export const titleBlock = (status: Child, title: string, extra?: Child): HTMLElement =>
  h('div', { class: 'title-block' }, h('div', { class: 'status-line' }, status), h('h1', { class: 'title' }, title), extra);

// ------------------------------------------------------------------ Segments, rows

type Seg<V extends string> = { value: V; label: string; count?: number };
/** A row of exclusive filter buttons (Tous / Passagers / Fret). */
export function segments<V extends string>(name: string, options: Seg<V>[], current: V, onChange: (v: V) => void): HTMLElement {
  return h('div', { class: 'segments', role: 'group', 'aria-label': name }, options.map((s) =>
    h('button', { type: 'button', class: 'seg', 'aria-pressed': String(s.value === current), onclick: () => onChange(s.value) }, h('span', null, s.label), s.count === undefined ? null : h('span', { class: 'seg-count' }, s.count))));
}

type Col = { label: string; align?: 'end' | 'center' };
export type Row = { cells: Child[]; /** An indented row that belongs to the row above (a subsidiary under its parent): read, never stepped to with the arrows. */ nested?: boolean; /** The row opens and closes the rows under it. */ expanded?: boolean; onOpen?: () => void; /** Runs when the row takes focus (arrow keys, click): lets a list drive a detail panel. */ onFocus?: () => void; label?: string; selected?: boolean };
/** Data table whose rows are reachable with the arrow keys and open with Enter (see keyboard.ts). */
export function dataTable(caption: string, cols: Col[], rows: Row[], empty?: HTMLElement): HTMLElement {
  if (rows.length === 0 && empty) return empty;
  return h('div', { class: 'scroll', role: 'region', 'aria-label': caption, tabindex: 0 },
    h('table', { class: 'data' },
      h('caption', { class: 'sr' }, caption),
      h('thead', null, h('tr', null, cols.map((c) => h('th', { scope: 'col', class: c.align ?? '' }, c.label)))),
      h('tbody', null, rows.map((r) => h('tr', {
        'data-row': r.nested ? null : '', class: r.nested ? 'nested' : null, tabindex: r.onOpen ? 0 : null, 'aria-label': r.label, 'aria-selected': r.selected ? 'true' : null, 'aria-expanded': r.expanded === undefined ? null : String(r.expanded),
        onfocus: r.onFocus ?? null,
        onclick: r.onOpen ? (e: Event) => { if (!(e.target as Element).closest('button, a, input, select')) r.onOpen!(); } : null,
      }, r.cells.map((c, i) => h(i === 0 ? 'th' : 'td', i === 0 ? { scope: 'row', class: cols[i]?.align ?? '' } : { class: cols[i]?.align ?? '' }, c)))))));
}

/** A line of "label … value" used in summaries and statements. */
export const line = (label: Child, value: Child, cls = ''): HTMLElement => h('div', { class: `line ${cls}`.trim() }, h('span', { class: 'line-label' }, label), h('span', { class: 'line-value' }, value));

/** Placeholder for a figure the API does not provide: shown honestly, never invented. */
export const unknownValue = (): HTMLElement => h('span', { class: 'unknown', title: '-' }, '–');

// ------------------------------------------------------------------ Switch

type SwitchOpts = { checked: boolean; onchange: (value: boolean) => void; /** Accessible name; or point `labelledBy` at the visible label. */ label?: string; labelledBy?: string; describedBy?: string; id?: string; disabled?: boolean };
/** Switch: a 36x20 track, the knob at the end when on. A real button with role=switch, so Space and Enter toggle it. */
export function switchControl(o: SwitchOpts): HTMLButtonElement {
  const el = h('button', {
    type: 'button', role: 'switch', class: 'switch', id: o.id, disabled: o.disabled, 'aria-checked': String(o.checked),
    'aria-label': o.labelledBy ? null : o.label, 'aria-labelledby': o.labelledBy, 'aria-describedby': o.describedBy,
  }, h('span', { class: 'switch-knob' }));
  el.addEventListener('click', () => {
    const next = el.getAttribute('aria-checked') !== 'true';
    el.setAttribute('aria-checked', String(next));
    o.onchange(next);
  });
  return el;
}
