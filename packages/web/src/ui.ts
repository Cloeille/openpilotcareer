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
