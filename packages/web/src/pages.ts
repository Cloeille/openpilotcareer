import { cannotFly, aircraftPrice, HUB_PRICE, RANKS, type AircraftType, type ApiKeyInfo, type Flight, type Job, type Leaderboard, type Me, type CompanyProfile, type Transaction, AIRCRAFT_CATEGORIES, WTCS, type Airport } from '@opc/shared';
import { api, downloadExport, session } from './api.ts';
import { ApiError } from './errors.ts';
import { debounce, field, fmtDate, fmtMoney, fmtNum, h, input, notify, table } from './ui.ts';

export type Ctx = { me: Me; refresh: () => Promise<void>; go: (page: string) => void };
type Page = (ctx: Ctx) => Promise<HTMLElement> | HTMLElement;

const run = async (label: string, fn: () => Promise<unknown>): Promise<boolean> => {
  try {
    await fn();
    notify(label);
    return true;
  } catch (e) {
    notify(e instanceof ApiError ? e.message : String(e), 'error');
    return false;
  }
};

const statusLabel: Record<Flight['status'], string> = { active: 'In progress', verified: 'Verified', unverified: 'Unverified (manual)', rejected: 'Rejected', cancelled: 'Cancelled' };
const badge = (f: Flight): HTMLElement => h('span', { class: `badge ${f.status}`, title: f.rejectReason ?? '' }, statusLabel[f.status], f.rejectReason ? ` - ${f.rejectReason}` : null);
const jobLabel = (j: Job): string => (j.kind === 'pax' ? `${j.pax} pax` : `${fmtNum(j.payloadKg)} kg cargo`);
const section = (title: string, ...kids: (Node | null)[]): HTMLElement => h('section', { class: 'card' }, h('h2', null, title), ...kids);

// ------------------------------------------------------------------ dashboard

const dashboard: Page = async ({ me, refresh }) => {
  const [active, recent] = await Promise.all([
    api<Flight[]>('/me/flights?status=active&limit=50'),
    api<Flight[]>('/me/flights?limit=5'),
  ]);
  const c = me.company;
  const stat = (label: string, value: string): HTMLElement => h('div', { class: 'stat' }, h('dt', null, label), h('dd', null, value));
  const next = RANKS.find((r) => r.hours > c.hours || r.flights > c.flights);
  return h('div', null,
    h('h1', null, c.name),
    h('dl', { class: 'stats' },
      stat('Pilot rank', me.rank), stat('Balance', fmtMoney(c.balance)), stat('Net worth', fmtMoney(c.netWorth)),
      stat('Reputation', `${c.reputation} / 100`), stat('Flights', fmtNum(c.flights)), stat('Hours', fmtNum(c.hours, 1))),
    next ? h('p', { class: 'muted' }, `Next rank: ${next.name} at ${next.hours} h and ${next.flights} flights.`) : null,
    section('Active flights', active.length === 0 ? h('p', { class: 'muted' }, 'No flight in progress. Accept a job on the job board.') : flightList(active, refresh)),
    section('Recent flights', recent.length === 0 ? h('p', { class: 'muted' }, 'Your first flight is waiting on the job board.') : flightTable(recent)));
};

function flightList(flights: Flight[], refresh: () => Promise<void>): HTMLElement {
  return h('ul', { class: 'plain' }, flights.map((f) => h('li', { class: 'flight' },
    h('div', null, h('strong', null, `${f.job.origin} \u2192 ${f.job.destination}`), ` ${fmtNum(f.job.distanceNm)} nm - ${jobLabel(f.job)} - ${f.aircraftIcao} - pays ${fmtMoney(f.job.payout)}`,
      f.job.route ? h('div', { class: 'muted route' }, f.job.route) : null),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'secondary', onclick: () => void run('Completed without telemetry (unverified, reduced pay).', async () => { await api(`/flights/${f.id}/complete`, { method: 'POST' }); await refresh(); }) }, 'Complete manually'),
      h('button', { type: 'button', class: 'danger', onclick: () => { if (confirm('Cancel this flight? The job stays taken and nothing is paid.')) void run('Flight cancelled.', async () => { await api(`/flights/${f.id}/cancel`, { method: 'POST' }); await refresh(); }); } }, 'Cancel')))));
}

const flightTable = (flights: Flight[]): HTMLElement => table('Flights', ['Date', 'Route', 'Aircraft', 'Load', 'Status', 'Revenue', 'Costs', 'Net'],
  flights.map((f) => [fmtDate(f.completedAt ?? f.acceptedAt), `${f.job.origin} \u2192 ${f.job.destination}`, f.aircraftIcao, jobLabel(f.job), badge(f),
    fmtMoney(f.revenue), fmtMoney(f.fuelCost + f.landingFee + f.maintenance), fmtMoney(f.net)]));

// ------------------------------------------------------------------ job board

const jobs: Page = async ({ me, refresh, go }) => {
  const idle = me.fleet.filter((a) => !a.busy);
  const airportsWithIdle = [...new Set(idle.map((a) => a.location))];
  const board = await api<{ jobs: Job[]; imported: Job[] }>('/jobs');
  const sb = input({ type: 'text', name: 'simbrief', autocomplete: 'off', maxlength: 64 });

  const flyable = (j: Job): boolean => idle.some((a) => a.location === j.origin && !cannotFly(a.type, j));
  const accept = (job: Job, aircraftId: number): void => void run(`Accepted ${job.origin} \u2192 ${job.destination}.`, async () => { await api(`/jobs/${job.id}/accept`, { method: 'POST', body: { aircraftId } }); await refresh(); go('dashboard'); });
  const row = (j: Job): (Node | string)[] => {
    const options = idle.filter((a) => a.location === j.origin && !cannotFly(a.type, j));
    const select = h('select', { 'aria-label': `Aircraft for ${j.origin} to ${j.destination}`, disabled: options.length === 0 },
      options.length === 0 ? h('option', { value: '' }, 'no suitable aircraft here') : options.map((a) => h('option', { value: a.id }, `${a.icao} #${a.id}`)));
    return [`${j.origin} \u2192 ${j.destination}`, fmtNum(j.distanceNm), jobLabel(j), j.requiredAircraft ?? 'any', fmtMoney(j.payout),
      h('div', { class: 'row' }, select, h('button', { type: 'button', disabled: options.length === 0, 'aria-label': `Accept ${j.origin} to ${j.destination}`, onclick: () => accept(j, Number((select as HTMLSelectElement).value)) }, 'Accept'))];
  };
  const head = ['Route', 'nm', 'Load', 'Aircraft', 'Pays', 'Assign'];
  return h('div', null,
    h('h1', null, 'Job board'),
    h('p', { class: 'muted' }, 'The board is shared by everyone on this server, AI companies included. A job taken by anyone disappears for everyone. It refreshes every 6 hours. Jobs your aircraft can fly are listed first.'),
    airportsWithIdle.length === 0 ? h('p', { class: 'muted' }, 'All your aircraft are on a flight.') : null,
    board.imported.length > 0 ? section('Imported from SimBrief', table('Imported jobs', head, board.imported.map(row))) : null,
    section(`Jobs where your aircraft stand (${airportsWithIdle.join(', ') || 'none'})`, table('Board jobs', head, board.jobs.filter((j) => airportsWithIdle.includes(j.origin)).sort((a, b) => Number(flyable(b)) - Number(flyable(a)) || b.payout - a.payout).map(row), 'No jobs here right now.')),
    h('form', { class: 'card', onsubmit: (e: Event) => { e.preventDefault(); void run('Imported your latest SimBrief flight plan.', async () => { await api('/jobs/import-simbrief', { method: 'POST', body: { simbriefUsername: sb.value.trim() } }); await refresh(); go('jobs'); }); } },
      h('h2', null, 'Import a SimBrief flight plan'),
      field('SimBrief username', sb, 'Your latest generated plan becomes a job for the aircraft type it was planned for.'),
      h('button', { type: 'submit' }, 'Import')));
};

// ------------------------------------------------------------------ fleet

const fleet: Page = ({ me, refresh }) => {
  const c = me.company;
  const q = input({ type: 'search', name: 'type-search', autocomplete: 'off', placeholder: 'e.g. A320, Caravan, Robinson' });
  const hubSel = h('select', { name: 'hub' }, me.hubs.map((hub) => h('option', { value: hub }, hub)));
  const results = h('div', { 'aria-live': 'polite' });
  const buy = (t: AircraftType): void => void run(`Bought a ${t.icao}.`, async () => { await api('/me/fleet', { method: 'POST', body: { icao: t.icao, hub: (hubSel as HTMLSelectElement).value } }); await refresh(); });
  const search = debounce(async () => {
    const text = q.value.trim();
    const types = text ? await api<AircraftType[]>(`/aircraft-types?q=${encodeURIComponent(text)}`).catch(() => []) : [];
    const rows = types.map((t) => [t.icao, t.name, `${t.seats} seats / ${fmtNum(t.cargoKg)} kg`, `${t.cruiseKts} kts / ${fmtNum(t.rangeNm)} nm`, t.derived ? 'estimated' : 'curated', fmtMoney(aircraftPrice(t)),
      h('button', { type: 'button', 'aria-label': `Buy ${t.icao} ${t.name}`, disabled: aircraftPrice(t) > c.balance, onclick: () => buy(t) }, 'Buy')]);
    results.replaceChildren(text ? table('Aircraft search results', ['ICAO', 'Name', 'Capacity', 'Performance', 'Data', 'Price', ''], rows, `No type matches "${text}". Any ICAO code still works: buy it from the exact designator below.`) : '');
  }, 250);
  q.addEventListener('input', search);
  const exact = input({ type: 'text', name: 'exact', maxlength: 4, pattern: '[A-Z0-9]{2,4}', autocomplete: 'off', style: 'text-transform:uppercase' });

  const cu = (name: string, props: Record<string, unknown>): HTMLInputElement => input({ name, required: true, ...props });
  const custom = {
    icao: cu('c-icao', { type: 'text', maxlength: 4, pattern: '[A-Z0-9]{2,4}', style: 'text-transform:uppercase' }), name: cu('c-name', { type: 'text', maxlength: 80 }),
    category: h('select', { name: 'c-cat' }, AIRCRAFT_CATEGORIES.map((x) => h('option', { value: x }, x))), engines: cu('c-eng', { type: 'number', min: 1, max: 8, value: 1 }),
    wtc: h('select', { name: 'c-wtc' }, WTCS.map((x) => h('option', { value: x }, x))), seats: cu('c-seats', { type: 'number', min: 0, max: 1000, value: 2 }),
    cargoKg: cu('c-cargo', { type: 'number', min: 0, max: 500000, value: 0 }), cruiseKts: cu('c-cruise', { type: 'number', min: 20, max: 700, value: 100 }), rangeNm: cu('c-range', { type: 'number', min: 20, max: 9000, value: 400 }),
  };
  const num = (el: HTMLElement): number => Number((el as HTMLInputElement).value);

  return h('div', null,
    h('h1', null, 'Fleet and hubs'),
    section('Your aircraft', table('Fleet', ['Aircraft', 'Name', 'Location', 'Status', 'Capacity', 'Value'],
      me.fleet.map((a) => [`${a.icao} #${a.id}`, a.type.name, a.location, a.busy ? 'On a flight' : 'Available', `${a.type.seats} seats / ${fmtNum(a.type.cargoKg)} kg${a.type.derived ? ' (estimated)' : ''}`, fmtMoney(a.value)]))),
    section('Buy an aircraft',
      h('p', { class: 'muted' }, 'Performance comes from data per ICAO type. Types without curated figures use estimates from their category, engines and wake class.'),
      field('Delivered to hub', hubSel), field('Search aircraft types', q), results,
      h('form', { class: 'row end', onsubmit: (e: Event) => { e.preventDefault(); buy({ icao: exact.value.toUpperCase() } as AircraftType); } },
        field('Or buy by exact ICAO designator', exact, 'Unknown designators get category defaults.'), h('button', { type: 'submit' }, 'Buy'))),
    section(`Hubs (${me.hubs.join(', ')})`, hubForm(refresh), h('p', { class: 'muted' }, `A new hub costs ${fmtMoney(HUB_PRICE)}. Landing at a hub is half price.`)),
    section('Custom aircraft',
      me.customAircraft.length ? table('Custom aircraft', ['ICAO', 'Name', 'Seats', 'Cargo kg', 'Cruise', 'Range', ''], me.customAircraft.map((t) => [t.icao, t.name, t.seats, t.cargoKg, `${t.cruiseKts} kts`, `${t.rangeNm} nm`,
        h('button', { type: 'button', class: 'secondary', 'aria-label': `Remove custom aircraft ${t.icao}`, onclick: () => void run('Removed.', async () => { await api(`/me/custom-aircraft/${t.icao}`, { method: 'DELETE' }); await refresh(); }) }, 'Remove')])) : h('p', { class: 'muted' }, 'Define your own aircraft (an add-on, a homebuilt). Buy it above by its ICAO code.'),
      h('form', { class: 'grid', onsubmit: (e: Event) => { e.preventDefault(); void run(`Defined ${custom.icao.value.toUpperCase()}.`, async () => { await api('/me/custom-aircraft', { method: 'POST', body: { icao: custom.icao.value.toUpperCase(), name: custom.name.value, category: (custom.category as HTMLSelectElement).value, engines: num(custom.engines), wtc: (custom.wtc as HTMLSelectElement).value, seats: num(custom.seats), cargoKg: num(custom.cargoKg), cruiseKts: num(custom.cruiseKts), rangeNm: num(custom.rangeNm) } }); await refresh(); }); } },
        field('ICAO designator', custom.icao), field('Name', custom.name), field('Category', custom.category), field('Engines', custom.engines), field('Wake class', custom.wtc),
        field('Seats', custom.seats), field('Cargo capacity (kg)', custom.cargoKg), field('Cruise speed (kts)', custom.cruiseKts), field('Range (nm)', custom.rangeNm),
        h('button', { type: 'submit' }, 'Define aircraft'))));

  function hubForm(refreshFn: () => Promise<void>): HTMLElement {
    const code = input({ type: 'text', name: 'hub-code', maxlength: 4, pattern: '[A-Za-z]{4}', autocomplete: 'off', required: true, style: 'text-transform:uppercase' });
    const found = h('div', { 'aria-live': 'polite', class: 'muted' });
    code.addEventListener('input', debounce(async () => {
      const v = code.value.trim();
      const a = v.length === 4 ? await api<Airport>(`/airports/${v}`).catch(() => null) : null;
      found.textContent = a ? `${a.name}, ${a.city} (${a.size})` : v.length === 4 ? 'Unknown airport' : '';
    }, 250));
    return h('form', { class: 'row end', onsubmit: (e: Event) => { e.preventDefault(); void run(`Hub ${code.value.toUpperCase()} opened.`, async () => { await api('/me/hubs', { method: 'POST', body: { icao: code.value.toUpperCase() } }); await refreshFn(); }); } },
      field('Open a hub at (ICAO)', code), h('button', { type: 'submit' }, 'Open hub'), found);
  }
};

// ------------------------------------------------------------------ flights, ledger

const flights: Page = async () => {
  const [list, ledger] = await Promise.all([api<Flight[]>('/me/flights?limit=100'), api<Transaction[]>('/me/transactions?limit=30')]);
  return h('div', null,
    h('h1', null, 'Flight history'),
    h('p', { class: 'muted' }, 'Verified flights come from simulator telemetry and pay in full. Manual completions are unverified and pay 60%. Rejected flights failed the plausibility checks and pay nothing.'),
    section('Flights', flightTable(list)),
    section('Ledger', table('Transactions', ['Date', 'Type', 'Memo', 'Amount', 'Balance'], ledger.map((t) => [fmtDate(t.at), t.kind.replace('_', ' '), t.memo, fmtMoney(t.amount), fmtMoney(t.balanceAfter)]))));
};

// ------------------------------------------------------------------ leaderboard, company comparison

const leaderboard: Page = async ({ me }) => {
  const host = h('div');
  const compare = h('div', { 'aria-live': 'polite' });
  const picked = new Set<number>([me.company.id]);
  const season = h('select', { name: 'season' });

  async function load(s?: string): Promise<void> {
    const lb = await api<Leaderboard>(`/leaderboard${s ? `?season=${s}` : ''}`);
    season.replaceChildren(...lb.seasons.map((x) => h('option', { value: x, selected: x === lb.season }, x)));
    host.replaceChildren(table(`Leaderboard ${lb.season}`, ['#', 'Company', 'Type', 'Net worth', 'Flights', 'Reputation', 'Compare'],
      lb.rows.map((r) => [r.rank, r.name, r.isAI ? 'AI' : 'Pilot', fmtMoney(r.netWorth), fmtNum(r.flights), r.reputation.toFixed(1),
        input({ type: 'checkbox', 'aria-label': `Compare ${r.name}`, checked: picked.has(r.companyId), onchange: (e: Event) => { toggle(r.companyId, (e.target as HTMLInputElement).checked); } })])));
    await showCompare();
  }
  function toggle(id: number, on: boolean): void {
    if (on) picked.add(id);
    else picked.delete(id);
    void showCompare();
  }
  async function showCompare(): Promise<void> {
    if (picked.size === 0) { compare.replaceChildren(h('p', { class: 'muted' }, 'Tick companies in the leaderboard to compare them.')); return; }
    const ps = await Promise.all([...picked].slice(0, 6).map((id) => api<CompanyProfile>(`/companies/${id}`).catch(() => null)));
    const cs = ps.filter((p): p is CompanyProfile => p !== null);
    const rows: [string, (c: CompanyProfile) => string][] = [
      ['Net worth', (c) => fmtMoney(c.netWorth)], ['Balance', (c) => fmtMoney(c.balance)], ['Lifetime revenue', (c) => fmtMoney(c.revenue)], ['Lifetime flights', (c) => fmtNum(c.flights)],
      ['Lifetime hours', (c) => fmtNum(c.hours, 1)], ['Reputation', (c) => c.reputation.toFixed(1)], ['Hubs', (c) => c.hubs.join(', ')],
      ['Fleet', (c) => c.fleet.map((f) => `${f.count}\u00d7${f.icao}`).join(' ')], ['Style', (c) => (c.personality ? `${c.personality.style}, prefers ${c.personality.preferred.join('/')}` : 'human pilot')]];
    compare.replaceChildren(table('Company comparison', ['', ...cs.map((c) => c.name)], rows.map(([label, f]) => [label, ...cs.map(f)])));
  }
  season.addEventListener('change', () => void load((season as HTMLSelectElement).value));
  await load();
  return h('div', null, h('h1', null, 'Leaderboard'),
    h('p', { class: 'muted' }, 'Monthly seasons rank by net worth (cash + aircraft value). Lifetime stats are in the comparison below.'),
    field('Season', season), host, section('Company comparison', compare));
};

// ------------------------------------------------------------------ settings

const settings: Page = async ({ me }) => {
  const keys = await api<ApiKeyInfo[]>('/me/api-keys');
  const label = input({ type: 'text', name: 'key-label', required: true, maxlength: 40, placeholder: 'e.g. MSFS PC' });
  const reveal = h('div', { 'aria-live': 'polite' });
  const list = h('div');
  const drawKeys = (items: ApiKeyInfo[]): void => list.replaceChildren(table('API keys', ['Label', 'Created', 'Last used', ''], items.map((k) => [k.label, fmtDate(k.createdAt), k.lastUsedAt ? fmtDate(k.lastUsedAt) : 'never',
    h('button', { type: 'button', class: 'danger', 'aria-label': `Revoke API key ${k.label}`, onclick: () => void run('Key revoked.', async () => { await api(`/me/api-keys/${k.id}`, { method: 'DELETE' }); drawKeys(items.filter((x) => x.id !== k.id)); }) }, 'Revoke')]), 'No API keys.'));
  drawKeys(keys);
  const pw = input({ type: 'password', name: 'confirm-password', autocomplete: 'current-password', required: true });

  return h('div', null, h('h1', null, 'Settings'),
    section('Server', h('p', null, `You are signed in as ${me.username} on `, h('strong', null, session.server), '. Accounts exist only on this server.')),
    section('API keys for simulator clients',
      h('p', { class: 'muted' }, 'A key lets a simulator companion list your active flights and submit telemetry for them (see docs/telemetry-api.md). It cannot read or change anything else. Keys are stored hashed and shown once.'),
      list,
      h('form', { class: 'row end', onsubmit: (e: Event) => { e.preventDefault(); void run('API key created.', async () => {
        const k = await api<ApiKeyInfo & { key: string }>('/me/api-keys', { method: 'POST', body: { label: label.value.trim() } });
        reveal.replaceChildren(h('p', { class: 'key-reveal' }, 'Copy this key now, it will not be shown again: ', h('code', null, k.key)));
        label.value = '';
        drawKeys(await api<ApiKeyInfo[]>('/me/api-keys'));
      }); } }, field('Label', label), h('button', { type: 'submit' }, 'Create key')),
      reveal),
    section('Export your data',
      h('p', { class: 'muted' }, 'Everything this server holds about you, as JSON (profile, company, hubs, fleet, flights, ledger), plus CSV tables.'),
      h('div', { class: 'row' },
        h('button', { type: 'button', onclick: () => void run('Export downloaded.', () => downloadExport('json')) }, 'Download JSON'),
        h('button', { type: 'button', class: 'secondary', onclick: () => void run('Export downloaded.', () => downloadExport('flights.csv')) }, 'Flights CSV'),
        h('button', { type: 'button', class: 'secondary', onclick: () => void run('Export downloaded.', () => downloadExport('transactions.csv')) }, 'Transactions CSV'))),
    h('section', { class: 'card danger-zone' }, h('h2', null, 'Delete account'),
      h('p', null, 'Permanently deletes your account, company, fleet, flights and ledger from this server. This cannot be undone. Export first if you want a copy.'),
      h('form', { class: 'row end', onsubmit: (e: Event) => { e.preventDefault(); if (!confirm(`Delete ${me.username} permanently?`)) return; void run('Account deleted.', async () => { await api('/me', { method: 'DELETE', body: { password: pw.value } }); session.set(session.server, null); location.reload(); }); } },
        field('Confirm with your password', pw), h('button', { type: 'submit', class: 'danger' }, 'Delete my account'))));
};

export const pages: Record<string, { title: string; render: Page }> = {
  dashboard: { title: 'Dashboard', render: dashboard },
  jobs: { title: 'Job board', render: jobs },
  fleet: { title: 'Fleet', render: fleet },
  flights: { title: 'Flights', render: flights },
  leaderboard: { title: 'Leaderboard', render: leaderboard },
  settings: { title: 'Settings', render: settings },
};
