/** The company the player acts as, remembered per server URL (accounts, and so company ids, exist on one server only). */
const KEY = 'opc.company';
type Store = Pick<Storage, 'getItem' | 'setItem'>;

function read(storage: Store): Record<string, number> {
  try {
    const v = JSON.parse(storage.getItem(KEY) ?? 'null') as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return Object.fromEntries(Object.entries(v).filter(([, id]) => Number.isInteger(id) && (id as number) > 0)) as Record<string, number>;
  } catch { /* corrupt storage: forget it */ }
  return {};
}

export const readCompany = (storage: Store, server: string): number | null => read(storage)[server] ?? null;

export function writeCompany(storage: Store, server: string, id: number | null): void {
  const all = read(storage);
  if (id === null) delete all[server];
  else all[server] = id;
  storage.setItem(KEY, JSON.stringify(all));
}
