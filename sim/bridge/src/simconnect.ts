// SimConnect host adapter: the only file that talks to the simulator. It subscribes to the SimVars below once per second and
// turns each reading into a SimSample (validated like any other input) for the pure core.
// node-simconnect speaks the SimConnect protocol itself over TCP / a named pipe, so there is no SimConnect.dll or SDK to load;
// it is still imported lazily so that the CLI, the tests and `replay` never touch it.
// NOT VERIFIED AGAINST A LIVE SIMULATOR: the field list follows the MSFS SDK documentation, nothing here has met a running MSFS.
import type { ConnectionHandle, ConnectionOptions, RawBuffer } from 'node-simconnect';
import { simSampleSchema, type EngineKind, type SimSample } from './types.ts';

type Kind = 'f64' | 'i32' | 's32' | 's64' | 's256';
type Reading = Record<'atcModel' | 'title' | 'category', string> & Record<'engineType' | 'onGround' | 'slew' | 'lat' | 'lon' | 'groundSpeedKts' |
  'verticalSpeedFpm' | 'touchdownFpm' | 'fuelKg' | 'totalWeightKg' | 'emptyWeightKg' | 'simRate', number>;

/** One row per SimVar, in the order the values arrive in the data buffer. Names and units are the MSFS SDK's. */
const FIELDS: readonly (readonly [key: keyof Reading, simVar: string, units: string | null, kind: Kind])[] = [
  ['atcModel', 'ATC MODEL', null, 's64'],
  ['title', 'TITLE', null, 's256'],
  ['category', 'CATEGORY', null, 's32'],
  ['engineType', 'ENGINE TYPE', 'enum', 'i32'],
  ['onGround', 'SIM ON GROUND', 'bool', 'i32'],
  ['slew', 'IS SLEW ACTIVE', 'bool', 'i32'],
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
  map(r: Reading, t: number, paused: boolean): { sample: SimSample } | { why: string } {
    // the first reading only sets the baseline: the latched value belongs to some earlier landing
    if (this.#lastTouchdown !== undefined && r.touchdownFpm !== this.#lastTouchdown) this.#unreported = r.touchdownFpm;
    this.#lastTouchdown = r.touchdownFpm;
    const onGround = r.onGround !== 0;
    const touchdownFpm = onGround ? this.#unreported : undefined;
    if (onGround) this.#unreported = undefined;
    const parsed = simSampleSchema.safeParse({
      t, onGround, lat: r.lat, lon: r.lon, groundSpeedKts: r.groundSpeedKts, verticalSpeedFpm: r.verticalSpeedFpm,
      ...(touchdownFpm !== undefined ? { touchdownFpm } : {}),
      fuelKg: r.fuelKg, totalWeightKg: r.totalWeightKg,
      // MSFS reports 0 for an aircraft without a usable empty weight: unknown, not "weightless"
      ...(r.emptyWeightKg > 0 ? { emptyWeightKg: r.emptyWeightKg } : {}),
      simRate: r.simRate, slew: r.slew !== 0, paused, atcModel: r.atcModel, title: r.title, engineKind: engineKind(r),
    });
    return parsed.success ? { sample: parsed.data } : { why: `${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}` };
  }
}

export type WatchOptions = {
  log: (line: string) => void;
  /** Where to find SimConnect; default: node-simconnect's own discovery (SimConnect.cfg, Windows registry). */
  connection?: ConnectionOptions;
  retryMs?: number;
};

const DEFINITION = 0, REQUEST = 0, PAUSE_EVENT = 0;

/** Connect to MSFS (waiting for it to start, reconnecting if it quits) and call `onSample` about once a second. Returns a stop function. */
export async function watchSim(onSample: (s: SimSample) => void, o: WatchOptions): Promise<() => void> {
  const sc = await import('node-simconnect'); // lazy: see the header
  const { retryMs = 5_000 } = o;
  const units = { f64: sc.SimConnectDataType.FLOAT64, i32: sc.SimConnectDataType.INT32, s32: sc.SimConnectDataType.STRING32, s64: sc.SimConnectDataType.STRING64, s256: sc.SimConnectDataType.STRING256 };
  let stopped = false;
  let handle: ConnectionHandle | null = null;
  let timer: NodeJS.Timeout | null = null;
  let paused = false;
  let mapper = new SampleMapper();
  let rejected = 0;

  const retry = (why: string): void => {
    handle?.close();
    handle = null;
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
    mapper = new SampleMapper();
    paused = false;
    for (const [, simVar, unit, kind] of FIELDS) h.addToDataDefinition(DEFINITION, simVar, unit, units[kind]);
    h.requestDataOnSimObject(REQUEST, DEFINITION, sc.SimConnectConstants.OBJECT_ID_USER, sc.SimConnectPeriod.SECOND);
    // ponytail: the 'Pause' system event (1 = paused) stands in for the SIMULATION PAUSED the brief lists, which the SDK does not document as a SimVar.
    // MSFS 2024 builds have been reported to mis-report it; while paused no SimVar data arrives either, so a long pause also shows up as a time gap (long_pause).
    h.subscribeToSystemEvent(PAUSE_EVENT, 'Pause');
    h.on('event', (e) => { if (e.clientEventId === PAUSE_EVENT) paused = e.data === 1; });
    h.on('simObjectData', (d) => {
      if (d.requestID !== REQUEST) return;
      const r = mapper.map(decode(d.data), Date.now(), paused);
      if ('sample' in r) return onSample(r.sample);
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
