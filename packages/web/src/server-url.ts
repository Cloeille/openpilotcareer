import { ApiError } from './errors.ts';

/** Only http(s) URLs are accepted; query and hash are dropped and trailing slashes trimmed (`https://x.org/opc/` -> `https://x.org/opc`). */
export function normalizeServer(raw: string): string {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new ApiError(0, 'bad_url', 'enter a full URL such as https://opc.example.org'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new ApiError(0, 'bad_url', 'the server URL must start with http:// or https://');
  return u.origin + u.pathname.replace(/\/+$/, '');
}
