// Fixture files: a JSON array of SimSample, one sample per line. Parsed with the same schema as live sim data.
import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { simSampleSchema, type SimSample } from './types.ts';

export function readSamples(path: string): SimSample[] {
  const r = z.array(simSampleSchema).min(1).safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!r.success) throw new Error(`${path} is not a valid sample stream: ${r.error.issues[0]?.path.join('.')} ${r.error.issues[0]?.message}`);
  return r.data;
}

export const writeSamples = (path: string, samples: SimSample[]): void =>
  writeFileSync(path, `[\n${samples.map((s) => JSON.stringify(s)).join(',\n')}\n]\n`);

/** Shift a recorded stream in time so that its first sample is at `startAt`. A replay starts when the job was accepted:
 *  the server rejects a takeoff that predates the acceptance. */
export function rebaseToStart(samples: SimSample[], startAt: number): SimSample[] {
  const shift = startAt - samples[0]!.t;
  return samples.map((s) => ({ ...s, t: s.t + shift }));
}
