// Durable queue of reports the server has not accepted yet. One file per (server, flight): putting the same flight again
// overwrites it, so re-sending is idempotent and a crash between "queued" and "sent" loses nothing.
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { telemetrySchema } from '@opc/shared';
import { z } from 'zod';

const pendingSchema = z.object({ serverUrl: z.string(), flightId: z.int().positive(), report: telemetrySchema, queuedAt: z.number() });
export type Pending = z.infer<typeof pendingSchema>;

export class Outbox {
  readonly #dir: string;
  constructor(configDir: string) { this.#dir = join(configDir, 'outbox'); }

  #path = (serverUrl: string, flightId: number): string => join(this.#dir, `${encodeURIComponent(serverUrl)}__${flightId}.json`);

  put(p: Pending): void {
    mkdirSync(this.#dir, { recursive: true, mode: 0o700 });
    const path = this.#path(p.serverUrl, p.flightId);
    writeFileSync(`${path}.tmp`, JSON.stringify(pendingSchema.parse(p)));
    renameSync(`${path}.tmp`, path);
  }

  remove(serverUrl: string, flightId: number): void { rmSync(this.#path(serverUrl, flightId), { force: true }); }

  /** Entries for one server. Unreadable files are set aside as `.corrupt` rather than blocking the queue or being deleted. */
  list(serverUrl: string): Pending[] {
    let names: string[];
    try { names = readdirSync(this.#dir).filter((n) => n.endsWith('.json')); } catch { return []; }
    const out: Pending[] = [];
    for (const n of names) {
      const path = join(this.#dir, n);
      try {
        const p = pendingSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
        if (p.serverUrl === serverUrl) out.push(p);
      } catch {
        renameSync(path, `${path}.corrupt`);
      }
    }
    return out.sort((a, b) => a.queuedAt - b.queuedAt);
  }
}
