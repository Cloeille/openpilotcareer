// SimConnect host adapter: the only file that talks to the simulator. It subscribes to the SimVars below once per second and
// turns each reading into a SimSample (validated like any other input) for the pure core.
// node-simconnect speaks the SimConnect protocol itself over TCP / a named pipe, so there is no SimConnect.dll or SDK to load;
// it is still imported lazily so that the CLI, the tests and `replay` never touch it.
// SimConnect names used for the anti-cheat's reload rules, checked against the MSFS 2024 SDK documentation:
//   system events  https://docs.flightsimulator.com/msfs2024/retail/programming-apis/simconnect/api-reference/general/simconnect_subscribetosystemevent/
//     FlightLoaded (a flight is loaded, answered in a SIMCONNECT_RECV_EVENT_FILENAME), Crashed (the user aircraft crashes), CrashReset (the crash cut-scene has completed).
//     SimStart/SimStop are documented too but not used: the docs say a flight reset sends SimStop, SimStart, SimStop, SimStart, so they are too noisy to mean "reloaded".
//   SimVars        https://docs.flightsimulator.com/msfs2024/retail/programming-apis/simvars/aircraft-simvars/aircraft-miscellaneous-variables/  (PLANE ALT ABOVE GROUND, feet)
//                  https://docs.flightsimulator.com/msfs2024/retail/programming-apis/simvars/miscellaneous-variables/  (CRASH FLAG: cause of a crash, 0 = none; CRASH SEQUENCE: 0 = off; both legacy but supported)
// Aircraft enumeration (enumerateAircraft / watchAircraft below), checked against the MSFS 2024 SDK documentation:
//   https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/AI_Object/SimConnect_EnumerateSimObjectsAndLiveries.htm
//   (also listed under .../API_Reference/Events_And_Data/SimConnect_EnumerateSimObjectsAndLiveries.htm)
//     (SimObject types: SIMCONNECT_SIMOBJECT_TYPE_AIRCRAFT = airplanes only, _HELICOPTER = helicopters only; answered in SIMCONNECT_RECV_ENUMERATE_SIMOBJECT_AND_LIVERY_LIST packets,
//      or a SIMCONNECT_EXCEPTION with SIMCONNECT_EXCEPTION_INTERNAL)
//   https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Structures_And_Enumerations/SIMCONNECT_RECV_ENUMERATE_SIMOBJECT_AND_LIVERY_LIST.htm
//     (each entry is one unique combination of SimObject title and livery name)
//   https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Structures_And_Enumerations/SIMCONNECT_ENUMERATE_SIMOBJECT_LIVERY.htm  (AircraftTitle, LiveryName: 256 chars each)
//   https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Structures_And_Enumerations/SIMCONNECT_RECV_LIST_TEMPLATE.htm
//     (a long list is split in packets: dwArraySize entries in this packet, dwEntryNumber 0..dwOutOf-1, dwOutOf packets in all)
// This function needs node-simconnect's Protocol.SunRise (MSFS 2024); MSFS 2020 refuses it.
// The older notes below: NOT VERIFIED AGAINST A LIVE SIMULATOR: the field list follows the MSFS SDK documentation, nothing here has met a running MSFS.
import { setTimeout as sleep } from 'node:timers/promises';
import type { ConnectionHandle, ConnectionOptions, RawBuffer } from 'node-simconnect';
import type { Listing } from './aircraft-cfg.ts';
import { simSampleSchema, type EngineKind, type Resume, type SimSample } from './types.ts';

type Kind = 'f64' | 'i32' | 's32' | 's64' | 's256';
type Reading = Record<'atcModel' | 'title' | 'category', string> & Record<'engineType' | 'onGround' | 'slew' | 'parkingBrake' | 'lat' | 'lon' | 'groundSpeedKts' |
  'verticalSpeedFpm' | 'touchdownFpm' | 'fuelKg' | 'totalWeightKg' | 'emptyWeightKg' | 'simRate', number>;

/** One row per SimVar, in the order the values arrive in the data buffer. Names and units are the MSFS SDK's. */
const FIELDS: readonly (readonly [key: keyof Reading, simVar: string, units: string | null, kind: Kind])[] = [
  ['atcModel', 'ATC MODEL', null, 's64'],
  ['title', 'TITLE', null, 's256'],
  ['category', 'CATEGORY', null, 's32'],
  ['engineType', 'ENGINE TYPE', 'enum', 'i32'],
  ['onGround', 'SIM ON GROUND', 'bool', 'i32'],
  ['slew', 'IS SLEW ACTIVE', 'bool', 'i32'],
  ['parkingBrake', 'BRAKE PARKING POSITION', 'bool', 'i32'],
  ['lat', 'PLANE LATITUDE', 'degrees', 'f64'],
  ['lon', 'PLANE LONGITUDE', 'degrees', 'f64'],
  ['groundSpeedKts', 'GROUND VELOCITY', 'knots', 'f64'],
  ['verticalSpeedFpm', 'VERTICAL SPEED', 'feet per minute', 'f64'],
  ['touchdownFpm', 'PLANE TOUCHDOWN NORMAL VELOCITY', 'feet per minute', 'f64'],
  ['fuelKg', 'FUEL TOTAL QUANTITY WEIGHT', 'kilograms', 'f64'],
  ['totalWeightKg', 'TOTAL WEIGHT', 'kilograms', 'f64'],
  ['emptyWeightKg', 'EMPTY WEIGHT', 'kilograms', 'f64'],
  ['simRate', 'SIMULATION RATE', 'number', 'f64'],
];

/** Live-only readings, on a SECOND data definition: if this SimVar list is refused (an unknown name on some aircraft or sim build),
 *  the flight tracker's own definition above is untouched and only the live view loses altitude, heading and engines. */
export const MAX_ENGINES = 4;
const GAUGES = ['torquePct', 'n1Pct', 'ittC', 'oilPsi'] as const;
type Gauge = (typeof GAUGES)[number];
const GAUGE_VARS: Record<Gauge, readonly [simVar: string, units: string]> = {
  torquePct: ['TURB ENG MAX TORQUE PERCENT', 'percent'],   // percent of max rated torque: turboprops and turbine helicopters
  n1Pct: ['TURB ENG N1', 'percent'],
  ittC: ['TURB ENG ITT', 'celsius'],
  oilPsi: ['GENERAL ENG OIL PRESSURE', 'psi'],
};
export const EXTRA_FIELDS: readonly (readonly [simVar: string, units: string, kind: 'f64' | 'i32'])[] = [
  ['PLANE ALTITUDE', 'feet', 'f64'],
  ['PLANE HEADING DEGREES TRUE', 'degrees', 'f64'],
  ['NUMBER OF ENGINES', 'number', 'i32'],
  ...Array.from({ length: MAX_ENGINES }, (_, i) => GAUGES.map((g) => [`${GAUGE_VARS[g][0]}:${i + 1}`, GAUGE_VARS[g][1], 'f64'] as const)).flat(),
];
export type ExtrasReading = { altFt: number; headingDeg: number; engineCount: number; engines: Record<Gauge, number>[] };

export function decodeExtras(buf: Pick<RawBuffer, 'readFloat64' | 'readInt32'>): ExtrasReading {
  const altFt = buf.readFloat64();
  const headingDeg = buf.readFloat64();
  const engineCount = buf.readInt32();
  const engines = Array.from({ length: MAX_ENGINES }, () => Object.fromEntries(GAUGES.map((g) => [g, buf.readFloat64()])) as Record<Gauge, number>);
  return { altFt, headingDeg, engineCount, engines };
}

/** The anti-cheat's own optional readings, on a THIRD data definition for the same reason as the extras: the legacy CRASH SimVars could be refused by
 *  some sim build, and that must cost only these rules (the Crashed event and the -6000 fpm rule still work), never the tracker's readings. */
export const GUARD_FIELDS: readonly (readonly [simVar: string, units: string, kind: 'f64' | 'i32'])[] = [
  ['PLANE ALT ABOVE GROUND', 'feet', 'f64'],
  ['CRASH FLAG', 'enum', 'i32'],
  ['CRASH SEQUENCE', 'enum', 'i32'],
];
export type GuardReading = { aglFt: number; crashFlag: number; crashSequence: number };
export const decodeGuard = (buf: Pick<RawBuffer, 'readFloat64' | 'readInt32'>): GuardReading => ({ aglFt: buf.readFloat64(), crashFlag: buf.readInt32(), crashSequence: buf.readInt32() });

/** What the host tells the tracker about the track besides the position: height above ground, a crash, and that the track was broken. */
export type TrackMarks = Pick<SimSample, 'aglFt' | 'crashed' | 'resumed'>;

/** The host's memory between readings. A flight reload and a lost link are events, not readings, so they wait here for the next sample
 *  (`resumed`); `Crashed` is latched until the track breaks, as a crashed aircraft stays crashed until a flight is loaded. */
export class TrackSignals {
  #guard: GuardReading | undefined;
  #crashed = false;
  #resume: Resume | undefined;

  guard(g: GuardReading | undefined): void { this.#guard = g; }
  crashed(): void { this.#crashed = true; }
  /** FlightLoaded or CrashReset. A lost link is the stronger signal: it is not downgraded to a reload. */
  flightLoaded(): void { this.#resume ??= 'reload'; }
  linkLost(): void { this.#resume = 'reconnect'; }

  /** The marks for the next sample. Pure: call `sent()` once that sample was accepted. */
  marks(): TrackMarks {
    const g = this.#guard;
    const marks: TrackMarks = {};
    if (g && Number.isFinite(g.aglFt)) marks.aglFt = g.aglFt;
    if (this.#resume) { // the first reading after a break shows the state after it: only the Crashed event, never the SimVars, speaks for the time before
      marks.resumed = this.#resume;
      if (this.#crashed) marks.crashed = true;
    } else if (this.#crashed || (g && (g.crashFlag !== 0 || g.crashSequence !== 0))) marks.crashed = true;
    return marks;
  }
  sent(): void { if (this.#resume) { this.#resume = undefined; this.#crashed = false; } }
}

/** Which gauges an engine kind really has. A gauge that does not apply is omitted rather than reported as 0. */
const GAUGES_OF: Record<EngineKind, readonly Gauge[]> = {
  piston: ['oilPsi'],
  turboprop: ['torquePct', 'n1Pct', 'ittC', 'oilPsi'],
  jet: ['n1Pct', 'ittC', 'oilPsi'],
  helicopter: ['torquePct', 'n1Pct', 'ittC', 'oilPsi'],
  other: [],
};

/** The optional SimSample fields for one extras reading. Only finite numbers pass (a SimVar can answer NaN), so these never invalidate a sample. */
export function liveFields(r: ExtrasReading, kind: EngineKind): Pick<SimSample, 'altFt' | 'headingDeg' | 'engines'> {
  const fields: Pick<SimSample, 'altFt' | 'headingDeg' | 'engines'> = {};
  if (Number.isFinite(r.altFt)) fields.altFt = r.altFt;
  if (Number.isFinite(r.headingDeg)) fields.headingDeg = r.headingDeg;
  const count = Math.max(0, Math.min(MAX_ENGINES, Number.isFinite(r.engineCount) ? Math.trunc(r.engineCount) : 0));
  const wanted = GAUGES_OF[kind];
  if (count > 0 && wanted.length > 0) {
    fields.engines = r.engines.slice(0, count).map((e) => Object.fromEntries(wanted.filter((g) => Number.isFinite(e[g])).map((g) => [g, e[g]])));
  }
  return fields;
}

export function decode(buf: Pick<RawBuffer, 'readFloat64' | 'readInt32' | 'readString32' | 'readString64' | 'readString256'>): Reading {
  const out: Record<string, number | string> = {};
  for (const [key, , , kind] of FIELDS) {
    out[key] = kind === 'f64' ? buf.readFloat64() : kind === 'i32' ? buf.readInt32() : kind === 's32' ? buf.readString32() : kind === 's64' ? buf.readString64() : buf.readString256();
  }
  return out as Reading;
}

/** ENGINE TYPE enum of the SDK: 0 piston, 1 jet, 3 helicopter turbine, 5 turboprop (2 none, 4 unsupported, 6 electric -> other). */
const engineKind = (r: Reading): EngineKind =>
  r.category === 'Helicopter' || r.engineType === 3 ? 'helicopter' : r.engineType === 0 ? 'piston' : r.engineType === 1 ? 'jet' : r.engineType === 5 ? 'turboprop' : 'other';

/** Remembers the latched touchdown rate between readings: SimSample.touchdownFpm is set once, on the first ground reading after the value changed. */
export class SampleMapper {
  #lastTouchdown: number | undefined;
  #unreported: number | undefined;

  /** Null when the reading is not a valid SimSample (the SimVar returned garbage); `why` then says which field. */
  map(r: Reading, t: number, paused: boolean, extras?: ExtrasReading, marks?: TrackMarks): { sample: SimSample } | { why: string } {
    // the first reading only sets the baseline: the latched value belongs to some earlier landing
    if (this.#lastTouchdown !== undefined && r.touchdownFpm !== this.#lastTouchdown) this.#unreported = r.touchdownFpm;
    this.#lastTouchdown = r.touchdownFpm;
    const onGround = r.onGround !== 0;
    const touchdownFpm = onGround ? this.#unreported : undefined;
    if (onGround) this.#unreported = undefined;
    const parsed = simSampleSchema.safeParse({
      t, onGround, parkingBrake: r.parkingBrake !== 0, lat: r.lat, lon: r.lon, groundSpeedKts: r.groundSpeedKts, verticalSpeedFpm: r.verticalSpeedFpm,
      ...(touchdownFpm !== undefined ? { touchdownFpm } : {}),
      fuelKg: r.fuelKg, totalWeightKg: r.totalWeightKg,
      // MSFS reports 0 for an aircraft without a usable empty weight: unknown, not "weightless"
      ...(r.emptyWeightKg > 0 ? { emptyWeightKg: r.emptyWeightKg } : {}),
      simRate: r.simRate, slew: r.slew !== 0, paused, atcModel: r.atcModel, title: r.title, engineKind: engineKind(r),
      ...(extras ? liveFields(extras, engineKind(r)) : {}),
      ...marks,
    });
    return parsed.success ? { sample: parsed.data } : { why: `${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}` };
  }
}

export type WatchOptions = {
  log: (line: string) => void;
  /** Where to find SimConnect; default: node-simconnect's own discovery (SimConnect.cfg, Windows registry). */
  connection?: ConnectionOptions;
  retryMs?: number;
  /** Told whenever the link to the simulator changes: connected, waiting (not running yet, or it quit), unavailable (no SimConnect client on this machine). */
  onState?: (s: SimLink) => void;
};

/** What `GET /status` reports as `sim`. */
export type SimLink = 'connected' | 'waiting' | 'unavailable';

const DEFINITION = 0, REQUEST = 0, EXTRAS_DEFINITION = 1, EXTRAS_REQUEST = 1, GUARD_DEFINITION = 2, GUARD_REQUEST = 2;
const PAUSE_EVENT = 0, FLIGHT_LOADED_EVENT = 1, CRASHED_EVENT = 2, CRASH_RESET_EVENT = 3;

/** Connect to MSFS (waiting for it to start, reconnecting if it quits) and call `onSample` about once a second. Returns a stop function. */
export async function watchSim(onSample: (s: SimSample) => void, o: WatchOptions): Promise<() => void> {
  const { retryMs = 5_000 } = o;
  let sc: typeof import('node-simconnect');
  try {
    sc = await import('node-simconnect'); // lazy: see the header
  } catch (e) {
    o.onState?.('unavailable');
    o.log(`no SimConnect client on this machine (${(e as Error).message}); the bridge keeps running so its status can say so`);
    return () => {};
  }
  o.onState?.('waiting');
  const units = { f64: sc.SimConnectDataType.FLOAT64, i32: sc.SimConnectDataType.INT32, s32: sc.SimConnectDataType.STRING32, s64: sc.SimConnectDataType.STRING64, s256: sc.SimConnectDataType.STRING256 };
  let stopped = false;
  let handle: ConnectionHandle | null = null;
  let timer: NodeJS.Timeout | null = null;
  let paused = false;
  let mapper = new SampleMapper();
  let rejected = 0;
  let extras: ExtrasReading | undefined;
  const signals = new TrackSignals();

  const retry = (why: string): void => {
    if (handle) signals.linkLost(); // the next reading, when the sim is back, is a break of the track (a game crash, or the sim was closed)
    handle?.close();
    handle = null;
    extras = undefined;
    signals.guard(undefined);
    o.onState?.('waiting');
    if (stopped || timer) return;
    o.log(`${why}; trying again in ${Math.round(retryMs / 1000)} s`);
    timer = setTimeout(() => { timer = null; void connect(); }, retryMs);
  };

  async function connect(): Promise<void> {
    let opened;
    try {
      opened = await sc.open('OpenPilotCareer bridge', sc.Protocol.FSX_SP2, o.connection); // FSX_SP2 protocol also works on MSFS 2020 and 2024
    } catch (e) {
      return retry(`waiting for the simulator (${(e instanceof AggregateError ? e.errors[0] : e)?.message ?? 'not running'})`);
    }
    if (stopped) return void opened.handle.close();
    const h = (handle = opened.handle);
    o.log(`connected to ${opened.recvOpen.applicationName}`);
    o.onState?.('connected');
    mapper = new SampleMapper();
    paused = false;
    for (const [, simVar, unit, kind] of FIELDS) h.addToDataDefinition(DEFINITION, simVar, unit, units[kind]);
    h.requestDataOnSimObject(REQUEST, DEFINITION, sc.SimConnectConstants.OBJECT_ID_USER, sc.SimConnectPeriod.SECOND);
    for (const [simVar, unit, kind] of EXTRA_FIELDS) h.addToDataDefinition(EXTRAS_DEFINITION, simVar, unit, units[kind]);
    h.requestDataOnSimObject(EXTRAS_REQUEST, EXTRAS_DEFINITION, sc.SimConnectConstants.OBJECT_ID_USER, sc.SimConnectPeriod.SECOND);
    // ponytail: the 'Pause' system event (1 = paused) stands in for the SIMULATION PAUSED the brief lists, which the SDK does not document as a SimVar.
    // MSFS 2024 builds have been reported to mis-report it; while paused no SimVar data arrives either, so a long pause also shows up as a time gap (long_pause).
    h.subscribeToSystemEvent(PAUSE_EVENT, 'Pause');
    for (const [simVar, unit, kind] of GUARD_FIELDS) h.addToDataDefinition(GUARD_DEFINITION, simVar, unit, units[kind]);
    h.requestDataOnSimObject(GUARD_REQUEST, GUARD_DEFINITION, sc.SimConnectConstants.OBJECT_ID_USER, sc.SimConnectPeriod.SECOND);
    h.subscribeToSystemEvent(FLIGHT_LOADED_EVENT, 'FlightLoaded');
    h.subscribeToSystemEvent(CRASHED_EVENT, 'Crashed');
    h.subscribeToSystemEvent(CRASH_RESET_EVENT, 'CrashReset');
    h.on('event', (e) => {
      if (e.clientEventId === PAUSE_EVENT) paused = e.data === 1;
      else if (e.clientEventId === CRASHED_EVENT) signals.crashed();
      else if (e.clientEventId === CRASH_RESET_EVENT) signals.flightLoaded();
    });
    h.on('eventFilename', (e) => { if (e.clientEventId === FLIGHT_LOADED_EVENT) signals.flightLoaded(); }); // FlightLoaded answers with the file name of the flight
    h.on('simObjectData', (d) => {
      if (d.requestID === EXTRAS_REQUEST) { extras = decodeExtras(d.data); return; }
      if (d.requestID === GUARD_REQUEST) { signals.guard(decodeGuard(d.data)); return; }
      if (d.requestID !== REQUEST) return;
      const r = mapper.map(decode(d.data), Date.now(), paused, extras, signals.marks());
      if ('sample' in r) { signals.sent(); return onSample(r.sample); }
      if (rejected++ === 0) o.log(`ignoring a reading the simulator sent that is not valid (${r.why})`);
    });
    h.on('exception', (e) => o.log(`SimConnect exception ${e.exception} (packet ${e.sendId})`));
    h.on('error', (e) => retry(`SimConnect error: ${e.message}`));
    h.on('quit', () => retry('the simulator quit'));
    h.on('close', () => retry('SimConnect connection closed'));
  }

  void connect();
  return () => { stopped = true; if (timer) clearTimeout(timer); handle?.close(); };
}

// ---------------------------------------------------------------- the aircraft the simulator offers

/** The SimObject types asked for, with their request ids (any ids that differ from the flight readings' own). */
const ENUM_REQUESTS = [{ id: 10, type: 'AIRCRAFT' }, { id: 11, type: 'HELICOPTER' }] as const;
const ENUM_TIMEOUT_MS = 30_000;

export type ListPacket = { requestID: number; entryNumber: number; outOf: number; simobjectLiveries: { aircraftTitle: string; liveryName: string }[] };

/** Puts the packets of the requested lists back together: a request is complete when all `outOf` of its packets arrived. */
export class ListAssembly {
  readonly rows: Listing[] = [];
  readonly #state = new Map<number, { got: number; outOf: number; rows: number }>();
  readonly #ids: readonly number[];
  constructor(ids: readonly number[]) { this.#ids = ids; }

  add(p: ListPacket): void {
    if (!this.#ids.includes(p.requestID)) return;
    const s = this.#state.get(p.requestID) ?? { got: 0, outOf: p.outOf, rows: 0 };
    s.got++;
    s.outOf = p.outOf;
    for (const r of p.simobjectLiveries) { this.rows.push({ title: r.aircraftTitle, livery: r.liveryName }); s.rows++; }
    this.#state.set(p.requestID, s);
  }
  get complete(): boolean { return this.#ids.every((id) => { const s = this.#state.get(id); return s !== undefined && s.got >= s.outOf; }); }
  rowsOf(id: number): number { return this.#state.get(id)?.rows ?? 0; }
}

type Sc = typeof import('node-simconnect');

/** Asks the open connection for every airplane and helicopter title with its liveries (official and community). */
export function enumerateOn(sc: Sc, h: ConnectionHandle, o: { log: (line: string) => void; timeoutMs?: number }): Promise<Listing[]> {
  return new Promise((resolve, reject) => {
    const assembly = new ListAssembly(ENUM_REQUESTS.map((r) => r.id));
    const sent = new Set<number>();
    const finish = (err?: Error): void => {
      clearTimeout(timer);
      h.off('enumerateSimobjectAndLiveryList', onList);
      h.off('exception', onException);
      if (err) return reject(err);
      o.log(`simulator lists ${assembly.rows.length} aircraft and livery rows (${ENUM_REQUESTS.map((r) => `${r.type.toLowerCase()}: ${assembly.rowsOf(r.id)}`).join(', ')})`);
      resolve(assembly.rows);
    };
    const onList = (p: ListPacket): void => { assembly.add(p); if (assembly.complete) finish(); };
    const onException = (e: { exception: number; sendId: number }): void => { if (sent.has(e.sendId)) finish(new Error(`SimConnect refused the aircraft list (exception ${e.exception})`)); };
    const timer = setTimeout(() => (assembly.rows.length > 0 ? (o.log('the simulator did not finish its aircraft list in time; using what arrived'), finish()) : finish(new Error('the simulator did not answer the aircraft list'))), o.timeoutMs ?? ENUM_TIMEOUT_MS);
    h.on('enumerateSimobjectAndLiveryList', onList);
    h.on('exception', onException);
    try {
      for (const r of ENUM_REQUESTS) sent.add(h.enumerateSimObjectsAndLiveries(r.id, sc.SimObjectType[r.type]));
    } catch (e) {
      finish(e as Error);
    }
  });
}

const loadSimConnect = async (log: (line: string) => void): Promise<Sc | null> => {
  try { return await import('node-simconnect'); } catch (e) { log(`no SimConnect client on this machine (${(e as Error).message})`); return null; }
};

/** One shot (`opc-bridge scan-aircraft`): connect, list, disconnect. Throws when MSFS is not running or does not answer. */
export async function enumerateAircraft(o: { log: (line: string) => void; connection?: ConnectionOptions; timeoutMs?: number }): Promise<Listing[]> {
  const sc = await loadSimConnect(o.log);
  if (!sc) throw new Error('no SimConnect client on this machine: run it on the PC that runs MSFS');
  let opened;
  try {
    opened = await sc.open('OpenPilotCareer bridge', sc.Protocol.SunRise, o.connection);
  } catch (e) {
    throw new Error(`MSFS is not running (${(e instanceof AggregateError ? e.errors[0] : e)?.message ?? 'no answer'}): start it, then scan again`);
  }
  try {
    return await enumerateOn(sc, opened.handle, o);
  } finally {
    opened.handle.close();
  }
}

export type AircraftWatchOptions = { log: (line: string) => void; connection?: ConnectionOptions; retryMs?: number; settleMs?: number; attempts?: number };

/**
 * Auto mode: once per simulator session (from its start to its quit) list the aircraft and hand the list to `onListing`. The simulator may still be
 * loading its content when SimConnect first answers, so the first try waits `settleMs`; a failed try is repeated up to `attempts` times, then given up until the next session.
 */
export async function watchAircraft(onListing: (l: Listing[]) => Promise<void>, o: AircraftWatchOptions): Promise<() => void> {
  const { retryMs = 15_000, settleMs = 20_000, attempts = 3 } = o;
  const sc = await loadSimConnect(o.log);
  if (!sc) return () => {};
  const stop = new AbortController();
  void (async () => {
    while (!stop.signal.aborted) {
      let opened;
      try {
        opened = await sc.open('OpenPilotCareer bridge', sc.Protocol.SunRise, o.connection);
      } catch {
        await sleep(retryMs, undefined, { signal: stop.signal }).catch(() => undefined);
        continue;
      }
      const h = opened.handle;
      const gone = new Promise<void>((resolve) => { h.on('quit', resolve); h.on('close', resolve); h.on('error', () => resolve()); stop.signal.addEventListener('abort', () => resolve()); });
      for (let attempt = 1; attempt <= attempts && !stop.signal.aborted; attempt++) {
        await sleep(attempt === 1 ? settleMs : retryMs * 2, undefined, { signal: stop.signal }).catch(() => undefined);
        try {
          await onListing(await enumerateOn(sc, h, o));
          break;
        } catch (e) {
          o.log(`aircraft scan ${attempt}/${attempts}: ${(e as Error).message}`);
        }
      }
      await gone; // one scan per session: wait for the simulator to quit before looking again
      h.close();
    }
  })();
  return () => { stop.abort(); };
}
