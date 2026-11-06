#!/usr/bin/env node
/* Dev-only stand-in for the bridge, so the panel can be viewed in a normal browser.
 *   node mock/mock-status-server.js [port]     (default 7878; the panel is hard-wired to 127.0.0.1:7878)
 *   open http://127.0.0.1:7878/                the panel, served from the real package files
 *   GET  /status                               current scenario as the fixed bridge contract
 *   GET  /scenario?name=<name>                 switch scenario (also: POST)
 * Scenarios: see SCENARIOS below.
 * "offline" is simulated by destroying the socket, which is what a closed port looks like to the panel. */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PANEL_DIR = path.join(__dirname, '..', 'openpilotcareer-panel', 'html_ui', 'InGamePanels', 'OpenPilotCareer');
const SERVER_URL = 'https://careers.example.org';
// What the real bridge sends today (sim/bridge/src/session.ts): the id is a number, nothing else is optional-rich.
const FLIGHT = { id: 7, from: 'LFPG', to: 'LFMN', aircraftIcao: 'A20N' };
// The richer, OPTIONAL fields the EFB can show (see the header of view-model.js). The values are made-up examples that
// reproduce the three design frames; the real bridge does not send them yet and the panel then shows a dash.
const RICH_FLIGHT = { id: 4127, from: 'LFMN', to: 'LFPG', aircraftIcao: 'AT76', fromName: 'Nice', toName: 'Paris-CDG', callsign: 'AZR 4127', aircraftName: 'ATR 72-600', registration: 'F-HAZR' };
const T = (iso) => Date.parse(iso);
const RICH = {
  simTime: T('2026-11-06T17:56:00Z'),
  sim: 'connected',
  plan: { blockFuelKg: 2150, tripFuelKg: 1640, reserveFuelKg: 420, cruiseAltFt: 24000 },
  cabin: { passengers: 68, cargoKg: 410 },
};

const SCENARIOS = {
  preflight: { phase: 'preflight', flight: FLIGHT, verification: null, flags: [], serverUrl: SERVER_URL },
  'taxi-pending': { phase: 'taxiOut', flight: FLIGHT, verification: 'pending', flags: [], serverUrl: SERVER_URL },
  'airborne-pending': { phase: 'airborne', flight: FLIGHT, verification: 'pending', flags: [], serverUrl: SERVER_URL },
  verified: { phase: 'parked', flight: FLIGHT, verification: 'verified', flags: [], serverUrl: SERVER_URL },
  rejected: {
    phase: 'parked',
    flight: FLIGHT,
    verification: 'rejected',
    reason: 'Landed at LFMD, not at the destination LFMN.',
    flags: [],
    serverUrl: SERVER_URL,
  },
  // Design frame "Panneau en jeu · EFB": cruise, ETA / fuel / estimated pay, verification running, close disabled.
  'efb-flight': {
    phase: 'airborne',
    flight: RICH_FLIGHT,
    verification: 'pending',
    flags: [],
    serverUrl: SERVER_URL,
    ...RICH,
    live: { altFt: 24000, progress: 0.37, etaAt: T('2026-11-06T18:42:00Z'), fuelArrivalKg: 1280 },
    estimatedPay: 14820,
  },
  // Design frame "vol terminé": parked, landing figures, verified, net pay.
  'efb-finished': {
    phase: 'parked',
    flight: RICH_FLIGHT,
    verification: 'verified',
    flags: [],
    serverUrl: SERVER_URL,
    ...RICH,
    result: { landingFpm: -142, gForce: 1.18, fuelRemainingKg: 1310, fuelVsSimbriefKg: 30, netPay: 14820, blockMinutes: 101, stand: 'F12', parkedAt: T('2026-11-06T18:39:00Z') },
  },
  // Design frame "vol rejeté": same landing, the bridge flagged time acceleration, 0 EUR.
  'efb-rejected': {
    phase: 'parked',
    flight: RICH_FLIGHT,
    verification: 'rejected',
    reason: 'The simulator client flagged this flight: time_acceleration_above_1x',
    flags: ['time_acceleration_above_1x'],
    serverUrl: SERVER_URL,
    ...RICH,
    result: { landingFpm: -142, gForce: 1.18, fuelRemainingKg: 1310, fuelVsSimbriefKg: 30, blockMinutes: 101, stand: 'F12', parkedAt: T('2026-11-06T18:39:00Z') },
  },
  // The simulator is not running yet: the bridge is up, the status bar says so.
  'efb-sim-waiting': {
    phase: 'preflight',
    flight: RICH_FLIGHT,
    verification: null,
    flags: [],
    serverUrl: SERVER_URL,
    ...RICH,
    sim: 'waiting',
  },
  flags: {
    phase: 'airborne',
    flight: FLIGHT,
    verification: 'pending',
    flags: ['slew_detected', 'time_acceleration_above_1x', 'teleport_jump_over_50nm'],
    serverUrl: SERVER_URL,
  },
  'no-job': { phase: 'parked', flight: null, verification: null, flags: [], serverUrl: SERVER_URL },
  offline: null,
  malformed: 'not-json',
  'bad-contract': { phase: 'sideways', flight: 'x', verification: 'maybe', flags: 'none' },
  'bad-http': 'http-500',
};

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.woff2': 'font/woff2' };

function createServer(initial = 'airborne-pending') {
  let current = initial;

  function serveFile(res, file, type) {
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(data);
    });
  }

  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/status') {
      const body = SCENARIOS[current];
      if (body === null) return req.socket.destroy();
      if (body === 'http-500') return void res.writeHead(500).end('boom');
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      return void res.end(typeof body === 'string' ? body : JSON.stringify(body));
    }
    if (url.pathname === '/scenario') {
      const name = url.searchParams.get('name');
      if (!Object.hasOwn(SCENARIOS, name)) return void res.writeHead(400).end(`unknown scenario; choose: ${Object.keys(SCENARIOS).join(', ')}`);
      current = name;
      return void res.writeHead(200).end(`scenario: ${name}\n`);
    }
    if (url.pathname === '/') return serveFile(res, path.join(__dirname, 'index.html'), TYPES['.html']);
    if (url.pathname.startsWith('/panel/fonts/')) {
      const name = path.basename(url.pathname);
      return serveFile(res, path.join(PANEL_DIR, 'fonts', name), TYPES[path.extname(name)] ?? 'application/octet-stream');
    }
    if (url.pathname.startsWith('/panel/')) {
      const name = path.basename(url.pathname);
      return serveFile(res, path.join(PANEL_DIR, name), TYPES[path.extname(name)] ?? 'application/octet-stream');
    }
    res.writeHead(404).end('not found');
  });
}

if (require.main === module) {
  const port = Number(process.argv[2] ?? 7878);
  createServer().listen(port, '127.0.0.1', () => {
    console.log(`mock bridge + panel on http://127.0.0.1:${port}/  (scenarios: ${Object.keys(SCENARIOS).join(', ')})`);
  });
}

module.exports = { createServer, SCENARIOS };
