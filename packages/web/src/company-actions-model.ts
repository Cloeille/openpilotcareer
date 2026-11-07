/** Pure logic of the "delete or reset a company" confirmation (Settings, Compte et données). No DOM, no network: the dialog renders what these functions say. */
import type { CompanyImpact } from '@opc/shared';

export type CompanyAction = 'reset' | 'delete';

export type Confirmation = {
  /** The company's exact name, which the player must type. */
  name: string;
  typedName: string;
  password: string;
  /** What would be lost; null while it loads or when it could not be read (then nothing can be confirmed). */
  impact: CompanyImpact | null;
  busy: boolean;
};

/** Why the destructive button is still off, in the order the player meets them; `ready` is the only state that lets it act. */
export type Readiness = 'loading' | 'flight_active' | 'name_mismatch' | 'password_missing' | 'busy' | 'ready';

export function readiness(c: Confirmation): Readiness {
  if (c.impact === null) return 'loading';
  if (c.impact.flightActive) return 'flight_active';
  if (c.typedName.trim() !== c.name) return 'name_mismatch';
  if (c.password === '') return 'password_missing';
  return c.busy ? 'busy' : 'ready';
}

/** The password field opens once the right name is typed: name first, then password. */
export const passwordOpen = (c: Confirmation): boolean => c.impact !== null && !c.impact.flightActive && c.typedName.trim() === c.name;

export type Loss = { kind: 'aircraft' | 'lines' | 'staff' | 'flights'; n: number };

/** The things the dialog counts, leaving out what the company does not have. The balance is shown separately: it is lost even at zero. */
export function losses(impact: CompanyImpact): Loss[] {
  return ([['aircraft', impact.aircraft], ['lines', impact.lines], ['staff', impact.staff], ['flights', impact.flights]] as const)
    .filter(([, n]) => n > 0).map(([kind, n]) => ({ kind, n }));
}
