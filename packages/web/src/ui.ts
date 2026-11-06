import { fmt } from './format.ts';

type Child = Node | string | number | null | false | undefined | Child[];
type Props = Record<string, unknown>;

/** Build DOM safely: children are always text nodes or elements, never parsed HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') (el as unknown as Props)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  const add = (c: Child): void => {
    if (Array.isArray(c)) c.forEach(add);
    else if (c !== null && c !== false && c !== undefined) el.append(c instanceof Node ? c : String(c));
  };
  kids.forEach(add);
  return el;
}

export const fmtMoney = (n: number): string => fmt().money(n);
export const fmtNum = (n: number, digits = 0): string => fmt().num(n, digits);
export const fmtDate = (ms: number | null): string => (ms === null ? '' : fmt().dateTime(ms));

let uid = 0;
/** A labelled form control: <label for> + control, so every field has an accessible name. */
export function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const id = control.id || `f${++uid}`;
  control.id = id;
  const hintId = hint ? `${id}-hint` : null;
  if (hintId) control.setAttribute('aria-describedby', hintId);
  return h('div', { class: 'field' }, h('label', { for: id }, label), control, hint ? h('small', { id: hintId }, hint) : null);
}

export const input = (props: Props): HTMLInputElement => h('input', props);

export function table(caption: string, head: string[], rows: Child[][], empty = 'Nothing here yet.'): HTMLElement {
  if (rows.length === 0) return h('p', { class: 'muted' }, empty);
  return h('div', { class: 'scroll', role: 'region', 'aria-label': caption, tabindex: 0 },
    h('table', null,
      h('caption', { class: 'sr' }, caption),
      h('thead', null, h('tr', null, head.map((c) => h('th', { scope: 'col' }, c)))),
      h('tbody', null, rows.map((r) => h('tr', null, r.map((c, i) => (i === 0 ? h('th', { scope: 'row' }, c) : h('td', null, c))))))));
}

let timer: number | undefined;
/** Announce through the polite live region (success) or the alert region (errors). */
export function notify(message: string, kind: 'ok' | 'error' = 'ok'): void {
  const status = document.getElementById('status')!, alert = document.getElementById('alert')!;
  status.textContent = '';
  alert.textContent = '';
  (kind === 'ok' ? status : alert).textContent = message;
  clearTimeout(timer);
  timer = window.setTimeout(() => { status.textContent = ''; alert.textContent = ''; }, 8000);
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void {
  let t: number | undefined;
  return (...a) => { clearTimeout(t); t = window.setTimeout(() => fn(...a), ms); };
}
