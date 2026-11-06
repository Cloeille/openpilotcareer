// Builds dist/opc-bridge-win-x64.exe: a Node single executable application (SEA), so Windows players need no Node install.
//   npm run build:win -w @opc/bridge        (run from any OS; needs network the first time)
// 1. esbuild bundles src/cli.ts + zod + node-simconnect + data/airports.json into one CJS file.
// 2. The official node.exe for the same Node version as this process is downloaded and checked against nodejs.org's SHASUMS256.txt.
// 3. `node --build-sea` injects the bundle into that node.exe (cross-platform: no code cache, no snapshot).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const work = join(dist, 'work');
const out = join(dist, 'opc-bridge-win-x64.exe');
const version = process.version; // the blob and the injected node.exe must be the same Node version
const sha256 = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');

mkdirSync(work, { recursive: true });
mkdirSync(join(dist, 'cache'), { recursive: true });

const bundle = join(work, 'bundle.cjs');
execFileSync('npx', ['--yes', 'esbuild@0.28.2', 'src/cli.ts', '--bundle', '--platform=node', '--format=cjs', '--target=node26', `--outfile=${bundle}`, '--log-level=warning'], { cwd: root, stdio: 'inherit' });

const nodeExe = join(dist, 'cache', `node-${version}-win-x64.exe`);
const base = `https://nodejs.org/dist/${version}`;
const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
const expected = sums.split('\n').find((l) => l.endsWith('  win-x64/node.exe'))?.split(/\s+/)[0];
if (!expected) throw new Error(`no win-x64/node.exe line in ${base}/SHASUMS256.txt`);
if (!existsSync(nodeExe) || sha256(nodeExe) !== expected) {
  const res = await fetch(`${base}/win-x64/node.exe`);
  if (!res.ok) throw new Error(`download of ${base}/win-x64/node.exe failed: HTTP ${res.status}`);
  writeFileSync(`${nodeExe}.part`, Buffer.from(await res.arrayBuffer()));
  if (sha256(`${nodeExe}.part`) !== expected) throw new Error(`node.exe SHA256 does not match SHASUMS256.txt (${expected})`);
  renameSync(`${nodeExe}.part`, nodeExe);
}
console.log(`node.exe ${version} win-x64 sha256 ${expected} (verified against SHASUMS256.txt)`);

const config = join(work, 'sea-config.json');
writeFileSync(config, JSON.stringify({ main: bundle, mainFormat: 'commonjs', executable: nodeExe, output: out, disableExperimentalSEAWarning: true, useCodeCache: false, useSnapshot: false }, null, 2));
rmSync(out, { force: true });
execFileSync(process.execPath, ['--build-sea', config], { stdio: 'inherit' });

console.log(`${out}\n  ${(statSync(out).size / 1e6).toFixed(1)} MB  sha256 ${sha256(out)}`);
