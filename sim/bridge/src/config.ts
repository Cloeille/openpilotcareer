// Where the bridge keeps its state: one directory in the user's config location holding config.json (server URL + API key,
// owner-only) and outbox/ (reports not yet accepted by the server).
import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

export const configSchema = z.object({
  serverUrl: z.url({ protocol: /^https?$/ }),
  apiKey: z.string().regex(/^[\x21-\x7e]{8,200}$/, 'API key must be 8-200 printable characters'),
});
export type Config = z.infer<typeof configSchema>;

export function defaultConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  if (process.platform === 'win32') return join(env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'OpenPilotCareer');
  return join(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'openpilotcareer');
}

/** `https://host:8080/` -> `https://host:8080`. Throws on anything that is not an http(s) URL. */
export function normalizeServerUrl(raw: string): string {
  const u = new URL(raw);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('server URL must start with http:// or https://');
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

/** The API key travels in every request: plain http is fine on this machine, not across a network. */
export const sendsKeyInClear = (serverUrl: string): boolean => {
  const u = new URL(serverUrl);
  return u.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
};

const file = (dir: string): string => join(dir, 'config.json');

export function saveConfig(dir: string, c: Config): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${file(dir)}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(configSchema.parse(c), null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600); // `mode` is ignored when the temp file survived an earlier crash
  renameSync(tmp, file(dir));
}

/** Null when never set up. Throws when the file is unreadable, invalid, or (on POSIX) accessible to other users. */
export function loadConfig(dir: string): Config | null {
  let text: string;
  try {
    text = readFileSync(file(dir), 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
  if (process.platform !== 'win32' && statSync(file(dir)).mode & 0o077) throw new Error(`${file(dir)} holds your API key but is readable by other users: run chmod 600 on it`);
  const r = configSchema.safeParse(JSON.parse(text));
  if (!r.success) throw new Error(`${file(dir)} is invalid (${r.error.issues[0]?.path.join('.')}): run opc-bridge setup again`);
  return r.data;
}
