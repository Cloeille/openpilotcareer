// GET /downloads/:file: serves the Windows bridge and the MSFS panel from the directory in OPC_DOWNLOADS.
// Only the two names in FILES exist; anything else (including path tricks) is a plain 404.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';

export const DOWNLOAD_FILES = {
  'opc-bridge-win-x64.exe': 'application/vnd.microsoft.portable-executable',
  'openpilotcareer-panel.zip': 'application/zip',
} as const;

export type DownloadsContext = { downloads?: string | undefined };

export function registerDownloads(app: FastifyInstance, ctx: DownloadsContext): void {
  app.get('/downloads/:file', async (req, reply) => {
    const name = (req.params as { file: string }).file;
    const type = Object.hasOwn(DOWNLOAD_FILES, name) ? DOWNLOAD_FILES[name as keyof typeof DOWNLOAD_FILES] : undefined;
    const notFound = () => reply.status(404).send({ error: 'not_found', message: 'not found' });
    if (!ctx.downloads || !type) return notFound();
    const path = join(ctx.downloads, name);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) return notFound();
    return reply
      .header('content-type', type)
      .header('content-length', info.size)
      .header('content-disposition', `attachment; filename="${name}"`)
      .header('cache-control', 'no-cache')
      .send(createReadStream(path));
  });
}
