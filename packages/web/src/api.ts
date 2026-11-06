import { OPC_GLOBAL_URL, infoSchema, type ServerInfo } from '@opc/shared';
import { readCompany, writeCompany } from './company-store.ts';
import { ApiError } from './errors.ts';

/** Default server: VITE_OPC_GLOBAL_URL at build time (empty = the server that served this page), else the shared OPC_GLOBAL_URL. */
const env = import.meta.env.VITE_OPC_GLOBAL_URL as string | undefined;
export const GLOBAL_URL = env === undefined ? OPC_GLOBAL_URL : env || location.origin;
export const isOwnOrigin = GLOBAL_URL === location.origin;

const STORE_KEY = 'opc.session';
type Stored = { server: string; token: string | null };

function load(): Stored {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Partial<Stored> | null;
    if (v && typeof v.server === 'string') return { server: v.server, token: typeof v.token === 'string' ? v.token : null };
  } catch { /* corrupt storage: start over */ }
  return { server: GLOBAL_URL, token: null };
}

const state = load();
let company = readCompany(localStorage, state.server);
export const session = {
  get server() { return state.server; },
  get token() { return state.token; },
  /** Accounts live on one server, so switching server drops the token. */
  set(server: string, token: string | null) {
    state.server = server;
    state.token = token;
    company = readCompany(localStorage, server);
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  },
  /** The company requests act as (sent as X-OPC-Company); null = the server's default, the player's oldest. */
  get company() { return company; },
  set company(id: number | null) {
    company = id;
    writeCompany(localStorage, state.server, id);
  },
};

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void): void => { onUnauthorized = fn; };

/** Called when a signed-in request cannot reach the server at all (the screen then switches to the read-only offline state). */
let onNetworkLost: () => void = () => {};
export const setNetworkLostHandler = (fn: () => void): void => { onNetworkLost = fn; };

let lastSync: number | null = null;
/** When the server last answered a signed-in request (ms), or null if it has not yet. */
export const lastSyncAt = (): number | null => lastSync;

type Opts = { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; server?: string; auth?: boolean; timeoutMs?: number };

async function request(path: string, o: Opts): Promise<Response> {
  const headers: Record<string, string> = {};
  if (o.body !== undefined) headers['content-type'] = 'application/json';
  if (o.auth !== false && state.token) headers.authorization = `Bearer ${state.token}`;
  if (o.auth !== false && company !== null) headers['x-opc-company'] = String(company);
  try {
    return await fetch(`${o.server ?? state.server}/api/v1${path}`, {
      method: o.method ?? (o.body === undefined ? 'GET' : 'POST'), headers, ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}), signal: AbortSignal.timeout(o.timeoutMs ?? 20_000),
    });
  } catch {
    if (o.auth !== false && state.token) onNetworkLost();
    throw new ApiError(0, 'network', `cannot reach ${o.server ?? state.server}`);
  }
}

async function fail(res: Response, auth: boolean): Promise<never> {
  if (auth) lastSync = Date.now();
  const data = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
  if (res.status === 401 && auth && state.token) onUnauthorized();
  throw new ApiError(res.status, data?.error ?? 'error', data?.message ?? `${res.status} ${res.statusText}`);
}

export async function api<T>(path: string, o: Opts = {}): Promise<T> {
  const res = await request(path, o);
  if (!res.ok) return fail(res, o.auth !== false);
  if (o.auth !== false) lastSync = Date.now();
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Validate that `server` speaks OPC: GET /api/v1/info must return the documented shape. */
export async function fetchInfo(server: string): Promise<ServerInfo> {
  const res = await request('/info', { server, auth: false, timeoutMs: 5000 });
  if (!res.ok) throw new ApiError(res.status, 'not_opc', 'that address answered, but it is not an OpenPilotCareer server');
  const parsed = infoSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new ApiError(res.status, 'not_opc', 'that address answered, but it is not an OpenPilotCareer server');
  return parsed.data;
}

/** Download an authenticated export (the browser cannot send the Bearer header from a plain link). */
export async function downloadExport(format: 'json' | 'flights.csv' | 'transactions.csv'): Promise<void> {
  const res = await request(`/me/export?format=${format}`, {});
  if (!res.ok) return fail(res, true);
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `opc-${format}`;
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
