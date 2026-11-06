import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { buildApp } from './app.ts';
import { openDb } from './db.ts';

const env = process.env;
const webRoot = env.OPC_WEB_ROOT ?? fileURLToPath(new URL('../../web/dist', import.meta.url));

const db = openDb(env.OPC_DB ?? 'opc.sqlite');
const app = await buildApp({
  db,
  name: env.OPC_SERVER_NAME ?? 'OpenPilotCareer',
  registrationOpen: env.OPC_REGISTRATION !== 'closed',
  antiCheat: env.OPC_ANTICHEAT !== 'off',
  trustProxy: env.OPC_TRUST_PROXY === '1',
  ...(existsSync(webRoot) ? { webRoot } : {}),
});

await app.listen({ host: env.OPC_HOST ?? '0.0.0.0', port: Number(env.OPC_PORT ?? 8080) });
console.log(`OpenPilotCareer server listening on ${env.OPC_HOST ?? '0.0.0.0'}:${env.OPC_PORT ?? 8080}`);

// As PID 1 in a container Node ignores SIGTERM unless handled: drain requests, checkpoint and close the database, then exit.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    app.close().finally(() => {
      db.close();
      process.exit(0);
    });
  });
}
