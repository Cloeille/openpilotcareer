// One flown flight, end to end: samples in -> tracker -> report -> queued on disk -> delivered -> status for the in-sim panel.
import type { Flag, Phase, SimSample, TrackerOptions } from './types.ts';
import type { ServerClient } from './client.ts';
import { deliver, pendingFor, type DeliverOptions, type Delivery } from './deliver.ts';
import type { Outbox } from './outbox.ts';
import type { LiveReporter } from './live.ts';
import { FlightTracker } from './tracker.ts';

export type FlightInfo = { id: number; from: string; to: string; aircraftIcao: string };

/** FIXED CONTRACT with the in-sim panel (GET http://127.0.0.1:7878/status). Do not change field names or values. */
export type Status = {
  phase: Phase;
  flight: FlightInfo | null;
  verification: 'pending' | 'verified' | 'rejected' | null;
  reason?: string;
  flags: Flag[];
  serverUrl: string;
};

export type SessionOptions = {
  flight: FlightInfo;
  serverUrl: string;
  client: ServerClient;
  outbox: Outbox;
  now?: () => number;
  deliver?: Omit<DeliverOptions, 'onRetry'>;
  /** Called for every state change worth telling the pilot (phase change, retry, final verdict). */
  log?: (line: string) => void;
  /** Posts the live position to the server. Best effort: it can never delay or fail the tracker. */
  live?: LiveReporter;
};

type Verdict = { verification: 'verified' | 'rejected'; reason: string | null };

export class Session {
  readonly #o: SessionOptions;
  readonly #tracker: FlightTracker;
  #lastPhase: Phase = 'preflight';
  #sending: Promise<void> | null = null;
  #waiting: string | null = null;      // why the report is not delivered yet (server unreachable...)
  #verdict: Verdict | null = null;
  readonly #done = Promise.withResolvers<void>();

  constructor(o: SessionOptions) {
    this.#o = o;
    // the job's assigned aircraft is the fallback when ATC MODEL is not a designator (add-on aircraft); its airports say where the flight leaves from and ends
    const opts: TrackerOptions = { aircraftIcao: o.flight.aircraftIcao, originIcao: o.flight.from, destinationIcao: o.flight.to };
    this.#tracker = new FlightTracker(opts);
  }

  /** Pending until there is an outcome: a verdict (verified, rejected, closed, dropped), a report left queued on disk, or nothing reportable (`end()`).
   *  Never resolved by merely starting: a flight that is still being flown has no outcome yet. */
  get done(): Promise<void> { return this.#done.promise; }

  /** The stream of samples is over (recording exhausted). If nothing was or will be reported, `done` resolves now; a report in flight still settles first. */
  end(): void {
    if (!this.#sending && !this.#verdict) this.#done.resolve();
  }

  feed(s: SimSample): void {
    this.#tracker.feed(s);
    const phase = this.#tracker.phase;
    if (phase !== this.#lastPhase) { this.#lastPhase = phase; this.#o.log?.(`phase: ${phase}`); }
    this.#o.live?.push(s, phase, this.#tracker.flags);
    const outcome = this.#tracker.outcome;
    if (!outcome || this.#sending || this.#verdict) return;
    if (!outcome.ok) {
      this.#verdict = { verification: 'rejected', reason: outcome.reason }; // never sent: the server still has this flight active
      this.#o.log?.(`not reported: ${outcome.reason}`);
      this.#done.resolve();
      return;
    }
    const flags = this.#tracker.flags;
    if (flags.length > 0) this.#o.log?.(`reporting with anti-cheat flags: ${flags.join(', ')}`);
    const p = pendingFor(this.#o.serverUrl, this.#o.flight.id, outcome.report, (this.#o.now ?? Date.now)());
    this.#sending = deliver(this.#o.client, this.#o.outbox, p, {
      ...this.#o.deliver,
      onRetry: (e, ms) => { this.#waiting = `server unavailable (${e.message}), retrying in ${Math.round(ms / 1000)} s`; this.#o.log?.(this.#waiting); },
    }).then((d) => { this.#settle(d); this.#done.resolve(); }, (e: unknown) => this.#done.reject(e));
  }

  #settle(d: Delivery): void {
    this.#waiting = null;
    if (d.state === 'verified' || d.state === 'unverified') this.#verdict = { verification: 'verified', reason: null };
    else if (d.state === 'rejected') this.#verdict = { verification: 'rejected', reason: d.reason };
    else if (d.state === 'closed') this.#verdict = { verification: 'rejected', reason: `the server had already closed this flight: ${d.reason}` };
    else if (d.state === 'dropped') this.#verdict = { verification: 'rejected', reason: `the server refused the report: ${d.reason}` };
    else this.#waiting = d.reason; // queued: stays on disk for the next run
    this.#o.log?.(`${d.state}${d.reason ? `: ${d.reason}` : ''}`);
  }

  get status(): Status {
    const phase = this.#tracker.phase;
    const base = { phase, flight: this.#o.flight, flags: this.#tracker.flags, serverUrl: this.#o.serverUrl };
    if (this.#verdict) return { ...base, verification: this.#verdict.verification, ...(this.#verdict.reason ? { reason: this.#verdict.reason } : {}) };
    return { ...base, verification: phase === 'preflight' ? null : 'pending', ...(this.#waiting ? { reason: this.#waiting } : {}) };
  }
}
