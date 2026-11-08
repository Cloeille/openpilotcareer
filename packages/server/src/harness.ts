import assert from 'node:assert/strict';
import { fuelBurnKg, type Telemetry, type Job } from '@opc/shared';
import { buildApp, type AppOptions } from './app.ts';
import { catalogType } from './catalog.ts';
import { get, openDb } from './db.ts';
import { JOB_WINDOW_MS } from './board.ts';

const T0 = Date.UTC(2026, 10, 4, 12, 0, 0);

export async function harness(opts: Partial<AppOptions> = {}) {
  const clock = { t: T0 };
  const db = openDb(':memory:');
  const app = await buildApp({ db, now: () => clock.t, ai: false, ...opts });
  type Res = { status: number; body: any; headers: Record<string, unknown>; text: string };
  /** `company` acts as that company (X-OPC-Company); `rawCompany` sends the header verbatim. */
  const call = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, o: { token?: string; body?: unknown; company?: number; rawCompany?: string } = {}): Promise<Res> => {
    const company = o.rawCompany ?? (o.company === undefined ? undefined : String(o.company));
    const r = await app.inject({ method, url, headers: { ...(company === undefined ? {} : { 'x-opc-company': company }), ...(o.token ? { authorization: `Bearer ${o.token}` } : {}) }, ...(o.body !== undefined ? { payload: o.body as object } : {}) });
    let body: any = null;
    try { body = r.body ? JSON.parse(r.body) : null; } catch { /* csv */ }
    return { status: r.statusCode, body, headers: r.headers, text: r.body };
  };
  let n = 0;
  const register = async (name = `pilot${++n}`, hub = 'LFPG') => {
    const r = await call('POST', '/api/v1/auth/register', { body: { username: name, password: 'correct horse', hub } });
    assert.equal(r.status, 201, r.text);
    return { token: r.body.token as string, me: r.body, name };
  };
  /** Advance windows until the board offers a job that suits the aircraft where it stands (the C172 the goodReport flies); returns it. */
  const flyableJob = async (token: string, aircraftId: number, company?: number): Promise<Job> => {
    const where = get<{ location: string }>(db, 'SELECT location FROM aircraft WHERE id = ?', aircraftId)?.location;
    for (let i = 0; i < 40; i++) {
      const jobs = (await call('GET', '/api/v1/jobs', { token, ...(company === undefined ? {} : { company }) })).body.jobs as Job[];
      const j = jobs.find((x) => x.origin === where && x.fits?.includes(aircraftId));
      if (j) return j;
      clock.t += JOB_WINDOW_MS;
    }
    throw new Error(`no job suits aircraft ${aircraftId}`);
  };
  const apiKey = async (token: string) => (await call('POST', '/api/v1/me/api-keys', { token, body: { label: 'sim' } })).body.key as string;
  /** Telemetry that passes every plausibility check for `job` flown in a C172. */
  const goodReport = (job: Job): Telemetry => {
    const c172 = catalogType('C172');
    const hours = job.distanceNm / c172.cruiseKts + 0.1;
    const takeoff = clock.t + 60_000;
    const landed = takeoff + hours * 3_600_000;
    clock.t = landed + 60_000;
    return {
      takeoffAt: new Date(takeoff).toISOString(), landedAt: new Date(landed).toISOString(), departureIcao: job.origin, arrivalIcao: job.destination,
      aircraftIcao: 'C172', payloadKg: job.payloadKg, fuelUsedKg: fuelBurnKg(c172, job.distanceNm), landingFpm: -180, distanceNm: job.distanceNm + 2, source: 'simconnect',
    };
  };
  return { app, db, clock, call, register, flyableJob, apiKey, goodReport };
}
