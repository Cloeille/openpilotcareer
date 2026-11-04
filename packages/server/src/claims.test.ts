// Cross-process proof of "a job can only be taken once": separate OS processes share one SQLite file and race for one job.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { seedAi } from './ai.ts';
import { openDb, all, get } from './db.ts';
import { openBoard } from './game.ts';

const exec = promisify(execFile);
const T0 = Date.UTC(2026, 10, 4, 12);
const src = (f: string): string => new URL(f, import.meta.url).href;

const WORKER = `
import { openDb, tx, get } from '${src('./db.ts')}';
import { startFlight } from '${src('./game.ts')}';
const [file, companyId, jobJson, now] = process.argv.slice(1);
const db = openDb(file);
const job = JSON.parse(jobJson);
const aircraft = get(db, 'SELECT * FROM aircraft WHERE company_id = ?', Number(companyId));
try {
  tx(db, () => startFlight(db, Number(companyId), job, { ...aircraft, location: job.origin }, Number(now)));
  console.log('won');
} catch (e) { console.log(e.code ?? e.message); }
`;

test('six processes race for one job on the same database file: exactly one wins, the others get job_taken', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'opc-claims-')), 'race.sqlite');
  const db = openDb(file);
  seedAi(db, T0);
  const companies = all<{ id: number }>(db, 'SELECT id FROM companies ORDER BY id LIMIT 6').map((c) => c.id);
  const job = openBoard(db, 'EGLL', T0).find((j) => j.kind === 'pax' && j.pax <= 4)!;
  assert.ok(job, 'a light job exists at EGLL');
  db.close();

  const results = await Promise.all(companies.map((id) => exec(process.execPath, ['--input-type=module', '-e', WORKER, file, String(id), JSON.stringify(job), String(T0)])));
  const outcomes = results.map((r) => r.stdout.trim()).sort();
  assert.deepEqual(outcomes, ['job_taken', 'job_taken', 'job_taken', 'job_taken', 'job_taken', 'won']);

  const check = openDb(file);
  assert.equal(get<{ n: number }>(check, 'SELECT COUNT(*) n FROM job_claims WHERE job_id = ?', job.id)!.n, 1);
  assert.equal(get<{ n: number }>(check, 'SELECT COUNT(*) n FROM flights WHERE job_id = ?', job.id)!.n, 1);
});
