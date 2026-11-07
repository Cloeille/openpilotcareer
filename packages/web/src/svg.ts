const NS = 'http://www.w3.org/2000/svg';
type Attrs = Record<string, string | number | null | undefined>;
type Kid = Node | string | null | undefined | false;

/** An SVG element built like `h()` builds HTML: attributes as given, string children as text. Never parses markup. */
export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: Kid[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, String(v));
  for (const k of kids) if (k !== null && k !== undefined && k !== false) el.append(k);
  return el;
}
