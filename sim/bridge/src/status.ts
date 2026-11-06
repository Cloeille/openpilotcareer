// Local status endpoint for the in-sim panel: GET http://127.0.0.1:7878/status. Read-only, loopback only, no secrets in the body.
import { createServer, type Server } from 'node:http';
import type { Status } from './session.ts';

export const STATUS_PORT = 7878;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** `port` 0 picks a free one (tests). Resolves once listening. */
export async function serveStatus(getStatus: () => Status, port: number = STATUS_PORT): Promise<Server> {
  const server = createServer((req, res) => {
    // Host check against DNS rebinding: a web page cannot make the browser send another host name to this socket.
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    const headers = {
      'content-type': 'application/json',
      // ponytail: the origin of a panel inside MSFS is unknown (see sim/msfs-package README), so any origin may read this
      // status. It holds no credentials and no write endpoint exists.
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    };
    if (!LOOPBACK_HOSTS.has(host)) return void res.writeHead(403, headers).end('{"error":"forbidden"}');
    if (req.method === 'OPTIONS') return void res.writeHead(204, { ...headers, 'access-control-allow-methods': 'GET', 'access-control-max-age': '600' }).end();
    if (req.method !== 'GET' || req.url?.split('?')[0] !== '/status') return void res.writeHead(404, headers).end('{"error":"not_found"}');
    res.writeHead(200, headers).end(JSON.stringify(getStatus()));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', (e: NodeJS.ErrnoException) => reject(e.code === 'EADDRINUSE' ? new Error(`port ${port} is in use (another opc-bridge, or the panel's mock status server?)`) : e));
    server.listen(port, '127.0.0.1', resolve);
  });
  return server;
}
