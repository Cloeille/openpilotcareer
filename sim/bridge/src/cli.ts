#!/usr/bin/env node
// opc-bridge command line: setup, flights, replay.
import { createInterface } from 'node:readline/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { Writable } from 'node:stream';
import { parseArgs } from 'node:util';
import { ServerClient } from './client.ts';
import { configSchema, defaultConfigDir, loadConfig, normalizeServerUrl, saveConfig, sendsKeyInClear } from './config.ts';
import { readSamples, rebaseToStart } from './fixture.ts';
import { Outbox } from './outbox.ts';
import { Session } from './session.ts';
import { FlightTracker } from './tracker.ts';

const USAGE = `usage: opc-bridge <command>

  setup [--server URL] [--key KEY]    save the server and your API key (asked for what is missing; the key is typed hidden)
  flights                             list the active flights you can report on
  replay <fixture.json> [--flight ID] [--speed N]
                                      feed a recorded sample stream through the bridge and report it to the server, without a simulator.
                                      The flight is the active one that flies the same route in the same aircraft, unless --flight is given.
                                      --speed N plays it N times faster than real time; only useful against a test server whose clock
                                      runs N times faster too (the server refuses a landing that lies in its future).

--server URL and --key KEY (or OPC_API_KEY) override the saved setup for one run. State lives in
$XDG_CONFIG_HOME/openpilotcareer (%APPDATA%\\OpenPilotCareer on Windows). OPC_DEBUG=1 prints stack traces.`;

const log = (line: string): void => console.log(`${new Date().toTimeString().slice(0, 8)}  ${line}`);

type Flags = { server?: string | undefined; key?: string | undefined };

/** Asks for what is missing. The key is read with the terminal's echo off. */
async function askMissing(f: Flags): Promise<{ server: string; key: string }> {
  let server = f.server;
  let key = f.key ?? (process.env.OPC_API_KEY || undefined);
  if (server && key) return { server, key };
  let muted = false;
  const output = new Writable({ write: (chunk, _enc, done) => { if (!muted) process.stdout.write(chunk); done(); } });
  const rl = createInterface({ input: process.stdin, output, terminal: process.stdin.isTTY === true });
  const closed = new Promise<never>((_, reject) => rl.once('close', () => reject(new Error('no input: pass --server and --key instead'))));
  closed.catch(() => {}); // only awaited while a question is open
  try {
    server ??= (await Promise.race([rl.question('Server URL (e.g. https://opc.example.org): '), closed])).trim();
    if (!key) {
      process.stdout.write('API key (web app > Settings > API keys; typing is hidden): ');
      muted = true;
      key = (await Promise.race([rl.question(''), closed])).trim();
      muted = false;
      process.stdout.write('\n');
    }
  } finally {
    rl.close();
  }
  return { server, key };
}

/** Validates server + key (the same schema as the config file) and builds the client. */
function clientFor(server: string, apiKey: string) {
  let serverUrl: string;
  try { serverUrl = normalizeServerUrl(server); } catch (e) { throw new Error(`bad server URL "${server}": ${(e as Error).message}`); }
  const parsed = configSchema.safeParse({ serverUrl, apiKey });
  if (!parsed.success) throw new Error(`${parsed.error.issues[0]?.path.join('.')}: ${parsed.error.issues[0]?.message}`);
  if (sendsKeyInClear(serverUrl)) log(`warning: ${serverUrl} is plain http: your API key crosses the network unencrypted`);
  return { serverUrl, client: new ServerClient(serverUrl, apiKey) };
}

/** Flags beat the saved setup; the saved file is only read (and only has to be valid) when something is missing. */
function connect(f: Flags) {
  const dir = defaultConfigDir();
  let server = f.server, key = f.key ?? (process.env.OPC_API_KEY || undefined);
  if (!server || !key) {
    const saved = loadConfig(dir);
    if (!saved) throw new Error('not set up yet: run `opc-bridge setup` (or pass --server and --key)');
    server ??= saved.serverUrl;
    key ??= saved.apiKey;
  }
  return { dir, ...clientFor(server, key) };
}

async function setup(f: Flags): Promise<void> {
  const { server, key } = await askMissing(f);
  const { serverUrl, client } = clientFor(server, key);
  const info = await client.info();
  const flights = await client.activeFlights(); // a wrong or revoked key fails here, not in the middle of a flight
  const dir = defaultConfigDir();
  saveConfig(dir, { serverUrl, apiKey: key });
  log(`${info.name} ${info.version} at ${serverUrl}: key accepted, ${flights.length} active flight${flights.length === 1 ? '' : 's'}`);
  log(`saved to ${dir} (readable by you only)`);
}

async function flights(f: Flags): Promise<void> {
  const list = await connect(f).client.activeFlights();
  if (list.length === 0) return log('no active flight: accept a job in the web app first');
  for (const x of list) console.log(`${String(x.id).padStart(6)}  ${x.job.origin} -> ${x.job.destination}  ${x.aircraftIcao.padEnd(5)} ${Math.round(x.job.distanceNm)} nm  ${Math.round(x.job.payloadKg)} kg`);
}

/** Exit code: 0 verified, 2 rejected, 1 nothing was reported (or it is still queued). */
async function replay(path: string, f: Flags & { flight?: string | undefined; speed?: string | undefined }): Promise<number> {
  const speed = Number(f.speed ?? 1);
  if (!(speed > 0 && Number.isFinite(speed))) throw new Error('--speed must be a positive number');
  const samples = readSamples(path);
  const { client, serverUrl, dir } = connect(f);
  const active = await client.activeFlights();
  let flight;
  if (f.flight !== undefined) {
    flight = active.find((x) => x.id === Number(f.flight));
    if (!flight) throw new Error(`flight ${f.flight} is not among your active flights (see \`opc-bridge flights\`)`);
  } else {
    const dry = new FlightTracker(); // find out which route the stream flies
    for (const s of samples) dry.feed(s);
    if (!dry.outcome?.ok) throw new Error(`${path} cannot be matched to a flight (${dry.outcome ? dry.outcome.reason : 'the stream does not end with the aircraft parked'}): pass --flight ID`);
    const { departureIcao, arrivalIcao, aircraftIcao } = dry.outcome.report;
    flight = active.find((x) => x.job.origin === departureIcao && x.job.destination === arrivalIcao && x.aircraftIcao === aircraftIcao);
    if (!flight) throw new Error(`${path} flies ${departureIcao} -> ${arrivalIcao} in a ${aircraftIcao}: accept such a job in the web app first (or pass --flight ID)`);
  }
  log(`replaying ${path} (${samples.length} samples, x${speed}) as flight ${flight.id}: ${flight.job.origin} -> ${flight.job.destination}`);
  const session = new Session({
    flight: { id: flight.id, from: flight.job.origin, to: flight.job.destination, aircraftIcao: flight.aircraftIcao },
    serverUrl, client, outbox: new Outbox(dir), log,
    deliver: { maxAttempts: 5 }, // headless: give up after a few tries; the report stays in the outbox
  });
  // the recording is old but the server judges against its own clock: play it as if the flight started when the job was accepted
  const play = rebaseToStart(samples, flight.acceptedAt);
  const startedAt = Date.now();
  for (const s of play) {
    const wait = startedAt + (s.t - flight.acceptedAt) / speed - Date.now();
    if (wait >= 1) await sleep(wait);
    session.feed(s);
  }
  await session.done;
  const { verification, reason } = session.status;
  if (verification === 'verified') return 0;
  if (verification === 'rejected') return 2;
  log(reason ?? 'the stream ended before the aircraft parked: nothing was reported');
  return 1;
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv, allowPositionals: true,
    options: { server: { type: 'string' }, key: { type: 'string' }, flight: { type: 'string' }, speed: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
  });
  const [command, arg, ...extra] = positionals;
  if (values.help || !command || extra.length > 0) {
    console.log(USAGE);
    return values.help || !command ? 0 : 1;
  }
  switch (command) {
    case 'setup': await setup(values); return 0;
    case 'flights': await flights(values); return 0;
    case 'replay':
      if (!arg) throw new Error('replay needs a fixture file');
      return replay(arg, values);
    default: throw new Error(`unknown command "${command}"\n\n${USAGE}`);
  }
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e: unknown) => {
  console.error(`opc-bridge: ${process.env.OPC_DEBUG ? ((e as Error).stack ?? e) : (e as Error).message}`);
  process.exitCode = 1;
});
