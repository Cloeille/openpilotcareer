import { z } from 'zod';
import { icaoAirportSchema, icaoTypeSchema } from '@opc/shared';
import { HttpError } from './http.ts';

const TIMEOUT_MS = 8_000;
const MAX_BYTES = 4 * 1024 * 1024;
const LBS_TO_KG = 0.45359237;

const num = z.coerce.number().finite().min(0);
const ofpSchema = z.object({
  origin: z.object({ icao_code: icaoAirportSchema }),
  destination: z.object({ icao_code: icaoAirportSchema }),
  aircraft: z.object({ icaocode: icaoTypeSchema }),
  weights: z.object({ payload: num, pax_count_actual: num.default(0) }),
  fuel: z.object({ plan_ramp: num }),
  general: z.object({ route: z.string().max(4000).default('') }),
  params: z.object({ units: z.string() }),
});
const errorSchema = z.object({ fetch: z.object({ status: z.string() }) });

export type Ofp = { origin: string; destination: string; aircraftIcao: string; payloadKg: number; pax: number; plannedFuelKg: number; route: string };

export type Fetch = typeof fetch;

async function readCapped(res: Response): Promise<string> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_BYTES || !res.body) throw new HttpError(502, 'simbrief_invalid', 'SimBrief response is too large or empty');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > MAX_BYTES) throw new HttpError(502, 'simbrief_invalid', 'SimBrief response is too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Fetch and validate the latest OFP of a SimBrief user. Every failure is a clear HttpError, never a crash. */
export async function fetchLatestOfp(username: string, doFetch: Fetch): Promise<Ofp> {
  const url = `https://www.simbrief.com/api/xml.fetcher.php?username=${encodeURIComponent(username)}&json=1`;
  let res: Response;
  try {
    res = await doFetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error', headers: { accept: 'application/json' } });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new HttpError(504, 'simbrief_unavailable', timeout ? 'SimBrief did not answer in time, try again' : 'SimBrief could not be reached, try again');
  }
  let body: unknown;
  try {
    body = JSON.parse(await readCapped(res));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, 'simbrief_invalid', 'SimBrief returned something that is not JSON');
  }
  if (!res.ok) {
    const status = errorSchema.safeParse(body);
    if (res.status === 400 && status.success) throw new HttpError(404, 'simbrief_not_found', `SimBrief: ${status.data.fetch.status.replace(/^Error:\s*/, '')}`);
    throw new HttpError(502, 'simbrief_unavailable', `SimBrief answered HTTP ${res.status}`);
  }
  const ofp = ofpSchema.safeParse(body);
  if (!ofp.success) throw new HttpError(502, 'simbrief_invalid', 'SimBrief returned a flight plan this server cannot read');
  const o = ofp.data;
  const toKg = /^k/i.test(o.params.units) ? 1 : LBS_TO_KG;
  return {
    origin: o.origin.icao_code, destination: o.destination.icao_code, aircraftIcao: o.aircraft.icaocode,
    payloadKg: Math.round(o.weights.payload * toKg), pax: Math.round(o.weights.pax_count_actual),
    plannedFuelKg: Math.round(o.fuel.plan_ramp * toKg), route: o.general.route,
  };
}
