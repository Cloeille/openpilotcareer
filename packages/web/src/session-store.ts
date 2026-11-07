import { readCompany, writeCompany } from './company-store.ts';

const KEY = 'opc.session';
type Store = Pick<Storage, 'getItem' | 'setItem'>;
/** `username` is who the token belongs to. It is null while signed out, and for a session saved before accounts were recorded (or injected by a script): that one acts as the server's default company and remembers none until the next sign-in. */
type Stored = { server: string; token: string | null; username: string | null };

function load(storage: Store, fallbackServer: string): Stored {
  try {
    const v = JSON.parse(storage.getItem(KEY) ?? 'null') as Partial<Stored> | null;
    if (v && typeof v.server === 'string') {
      return { server: v.server, token: typeof v.token === 'string' ? v.token : null, username: typeof v.token === 'string' && typeof v.username === 'string' ? v.username : null };
    }
  } catch { /* corrupt storage: start over */ }
  return { server: fallbackServer, token: null, username: null };
}

/** The signed-in account and the company it acts as. The company is remembered per account, so it is only known while someone is signed in: signing out, or in as another player, can never carry it over. */
export function createSession(storage: Store, fallbackServer: string) {
  const state = load(storage, fallbackServer);
  const recall = (): number | null => (state.username === null ? null : readCompany(storage, state.server, state.username));
  let company = recall();
  const save = (): void => storage.setItem(KEY, JSON.stringify(state));
  return {
    get server() { return state.server; },
    get token() { return state.token; },
    /** Accounts live on one server, so signing in names the server as well. */
    signIn(server: string, token: string, username: string) {
      Object.assign(state, { server, token, username });
      company = recall();
      save();
    },
    /** Keeps the server (the login screen starts there), drops the account. */
    signOut() {
      Object.assign(state, { token: null, username: null });
      company = null;
      save();
    },
    /** The company requests act as (sent as X-OPC-Company); null = the server's default, the player's oldest. */
    get company() { return company; },
    /** The company was deleted: if it is the remembered one, forget it (the next request acts as the player's oldest). */
    forget(id: number) { if (company === id) this.company = null; },
    set company(id: number | null) {
      company = id;
      if (state.username !== null) writeCompany(storage, state.server, state.username, id);
    },
  };
}
