// Client of the OpenPilotCareer API (docs/telemetry-api.md). Every response is validated; the API key is only ever put in
// the Authorization header, never in a URL, error message or log line.
import { icaoAirportSchema, icaoTypeSchema, infoSchema, type LiveSample, type ServerInfo, type Telemetry } from '@opc/shared';
import { z } from 'zod';

/** network/server: worth retrying. refused: the server answered 4xx. protocol: it answered 2xx with a body we cannot trust. */
export class ApiError extends Error {
  readonly kind: 'network' | 'server' | 'refused' | 'protocol';
  readonly status: number | undefined;
  readonly code: string | undefined;
  constructor(kind: ApiError['kind'], message: string, status?: number, code?: string) {
    super(message);
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
  get retryable(): boolean { return this.kind === 'network' || this.kind === 'server'; }
}

const REQUEST_TIMEOUT_MS = 10_000;
/** Live position is best effort and every sample is replaced by the next one: do not wait long for it. */
const LIVE_TIMEOUT_MS = 4_000;

/** The part of a flight the bridge needs; the server sends more and zod drops it. */
export const activeFlightSchema = z.object({
  id: z.int().positive(),
  aircraftIcao: icaoTypeSchema,
  acceptedAt: z.number().int().positive(),
  job: z.object({ origin: icaoAirportSchema, destination: icaoAirportSchema, distanceNm: z.number(), payloadKg: z.number() }),
});
export type ActiveFlight = z.infer<typeof activeFlightSchema>;

/** A simconnect report is answered verified or rejected; unverified (manual source) is accepted so a surprise never drops a report. */
export const verifyResponseSchema = z.object({ verification: z.enum(['verified', 'unverified', 'rejected']), reason: z.string().nullable() });
export type VerifyResponse = z.infer<typeof verifyResponseSchema>;

const errorBodySchema = z.object({ error: z.string(), message: z.string() });

export class ServerClient {
  readonly #base: string;
  readonly #key: string;
  readonly #fetch: typeof fetch;

  constructor(serverUrl: string, apiKey: string, fetchImpl: typeof fetch = fetch) {
    this.#base = serverUrl;
    this.#key = apiKey;
    this.#fetch = fetchImpl;
  }

  info = (): Promise<ServerInfo> => this.#call('GET', '/api/v1/info', undefined, infoSchema, false);
  activeFlights = (): Promise<ActiveFlight[]> => this.#call('GET', '/api/v1/flights/active', undefined, z.array(activeFlightSchema), true);
  verify = (flightId: number, report: Telemetry): Promise<VerifyResponse> =>
    this.#call('POST', `/api/v1/flights/${flightId}/telemetry-verify`, report, verifyResponseSchema, true);
  /** POST /flights/:id/live (204). Throws ApiError like every call; 429 means "too soon", the caller just drops the sample. */
  postLive = (flightId: number, sample: LiveSample): Promise<null> =>
    this.#call('POST', `/api/v1/flights/${flightId}/live`, sample, z.null(), true, LIVE_TIMEOUT_MS);

  async #call<T>(method: string, path: string, body: unknown, schema: z.ZodType<T>, auth: boolean, timeoutMs: number = REQUEST_TIMEOUT_MS): Promise<T> {
    let res: Response;
    let text: string;
    try {
      res = await this.#fetch(`${this.#base}${path}`, {
        method,
        headers: { ...(auth ? { authorization: `Bearer ${this.#key}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
      text = await res.text();
    } catch (e) {
      throw new ApiError('network', `cannot reach ${this.#base}: ${(e as Error).cause instanceof Error ? ((e as Error).cause as Error).message : (e as Error).message}`);
    }
    let json: unknown;
    try { json = text ? JSON.parse(text) : null; } catch { json = undefined; }
    if (!res.ok) {
      const err = errorBodySchema.safeParse(json);
      const message = err.success ? err.data.message : `HTTP ${res.status}`;
      throw new ApiError(res.status >= 500 || res.status === 429 ? 'server' : 'refused', message, res.status, err.success ? err.data.error : undefined);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new ApiError('protocol', `${path}: unexpected response (${parsed.error.issues[0]?.path.join('.') || 'body'}: ${parsed.error.issues[0]?.message})`, res.status);
    return parsed.data;
  }
}
