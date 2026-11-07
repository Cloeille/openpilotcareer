/** The company a player acts as, remembered per account: server URL, then username. Accounts (and so company ids) exist on one server only, and a browser is shared by several players, so an id must never be read for another account. */
const KEY = 'opc.company';
type Store = Pick<Storage, 'getItem' | 'setItem'>;
type Remembered = Record<string, Record<string, number>>;

/** Usernames are unique case-insensitively on the server (the login response echoes them as typed). */
const account = (username: string): string => username.toLowerCase();
const isId = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;

function read(storage: Store): Remembered {
  const out: Remembered = {};
  try {
    const v = JSON.parse(storage.getItem(KEY) ?? 'null') as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [server, accounts] of Object.entries(v)) {
        // the old shape was {server: id}: a bare id belongs to no known account, so it is dropped
        if (!accounts || typeof accounts !== 'object' || Array.isArray(accounts)) continue;
        out[server] = Object.fromEntries(Object.entries(accounts).filter(([, id]) => isId(id))) as Record<string, number>;
      }
    }
  } catch { /* corrupt storage: forget it */ }
  return out;
}

export const readCompany = (storage: Store, server: string, username: string): number | null => read(storage)[server]?.[account(username)] ?? null;

export function writeCompany(storage: Store, server: string, username: string, id: number | null): void {
  const all = read(storage);
  const accounts = all[server] ?? {};
  if (id === null) delete accounts[account(username)];
  else accounts[account(username)] = id;
  all[server] = accounts;
  storage.setItem(KEY, JSON.stringify(all));
}
