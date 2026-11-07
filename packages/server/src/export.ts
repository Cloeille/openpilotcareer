import { companiesOf, customAircraftOf, fleetView, flightView, flightsOf, hubsOf, pilotView, transactionsOf, type FlightRow } from './game.ts';
import { EXPORT_SCHEMA_VERSION, type ServerInfo } from '@opc/shared';
import { all, get, type Db } from './db.ts';

type Cell = string | number | null;

/** RFC 4180 CSV. Text cells starting with = + - @ are prefixed with ' so spreadsheets never evaluate them as formulas. */
export function toCsv(header: string[], rows: Cell[][]): string {
  const cell = (c: Cell): string => {
    if (c === null) return '';
    const s = typeof c === 'number' ? String(c) : /^[=+\-@\t\r]/.test(c) ? `'${c}` : c;
    return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

const allFlights = (db: Db, companyId: number): FlightRow[] => flightsOf(db, companyId, Number.MAX_SAFE_INTEGER);
const allTransactions = (db: Db, companyId: number) => transactionsOf(db, companyId, Number.MAX_SAFE_INTEGER);
const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

export function flightsCsv(db: Db, companyId: number): string {
  return toCsv(
    ['id', 'status', 'rejectReason', 'acceptedAt', 'completedAt', 'kind', 'origin', 'destination', 'distanceNm', 'aircraft', 'payloadKg', 'pax', 'payout', 'revenue', 'fuelCost', 'landingFee', 'maintenance', 'net'],
    allFlights(db, companyId).map((f) => [f.id, f.status, f.reject_reason, iso(f.accepted_at), iso(f.completed_at), f.kind, f.origin, f.destination, f.distance_nm, f.aircraft_icao, f.payload_kg, f.pax, f.payout, f.revenue, f.fuel_cost, f.landing_fee, f.maintenance, f.net]),
  );
}

export function transactionsCsv(db: Db, companyId: number): string {
  return toCsv(['id', 'at', 'kind', 'amount', 'balanceAfter', 'flightId', 'memo'], allTransactions(db, companyId).map((t) => [t.id, iso(t.at), t.kind, t.amount, t.balanceAfter, t.flightId, t.memo]));
}

/** Everything the server holds about one account, all of its companies included. Credentials (password hash, session tokens, API-key hashes) are not included. */
export function exportDocument(db: Db, userId: number, server: ServerInfo, now: number) {
  const user = get<{ username: string; created_at: number }>(db, 'SELECT username, created_at FROM users WHERE id = ?', userId)!;
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date(now).toISOString(),
    server: { name: server.name, version: server.version, apiVersion: server.apiVersion },
    profile: { username: user.username, createdAt: new Date(user.created_at).toISOString(), ...pilotView(db, userId) },
    companies: companiesOf(db, userId).map((company) => ({
      company,
      hubs: hubsOf(db, company.id),
      fleet: fleetView(db, company.id, now),
      customAircraft: customAircraftOf(db, company.id),
      flights: allFlights(db, company.id).map((f) => ({ ...flightView(f), telemetry: f.telemetry ? (JSON.parse(f.telemetry) as unknown) : null })),
      transactions: allTransactions(db, company.id),
    })),
    apiKeys: all<{ id: number; label: string; created_at: number; last_used_at: number | null }>(db, 'SELECT id, label, created_at, last_used_at FROM api_keys WHERE user_id = ? ORDER BY id', userId)
      .map((k) => ({ id: k.id, label: k.label, createdAt: iso(k.created_at), lastUsedAt: iso(k.last_used_at) })),
  };
}
