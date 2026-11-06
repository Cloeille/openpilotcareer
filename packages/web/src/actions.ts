import { ApiError } from './errors.ts';
import { errorText } from './error-text.ts';
import { notify } from './ui.ts';

/** Errors that mean the screen shows something that is no longer true (another player took the job, the aircraft left): the state must be reloaded, not just reported. */
const STALE = new Set(['job_taken', 'job_not_found', 'aircraft_busy', 'flight_closed']);

/** Run a server action: announce the outcome (success text, or the localized error), and reload the shell after a success or a stale-state error. Returns whether it succeeded. */
export async function act(done: string, fn: () => Promise<unknown>, after?: () => Promise<void>): Promise<boolean> {
  try {
    await fn();
    notify(done);
    await after?.();
    return true;
  } catch (e) {
    notify(errorText(e), 'error');
    if (e instanceof ApiError && STALE.has(e.code)) await after?.().catch(() => undefined);
    return false;
  }
}
