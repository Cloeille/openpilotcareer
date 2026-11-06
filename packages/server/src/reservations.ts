// First-job reservations: a job held for one company for a while. Other players and the AI neither see nor take it.
import { get, run, type Db } from './db.ts';

/** Window number inside a board job id (`LFPG-123-4`); null for ids that are not board jobs. */
export const windowOfJobId = (id: string): number | null => {
  const m = /^[A-Z]{4}-(\d+)-\d+$/.exec(id);
  return m ? Number(m[1]) : null;
};

/** Is `jobId` held for a company other than `companyId` (undefined: for anyone) at time `at`? */
export const reservedAgainst = (db: Db, jobId: string, companyId: number | undefined, at: number): boolean =>
  !!get(db, 'SELECT 1 AS x FROM job_reservations WHERE job_id = ? AND reserved_until > ? AND company_id != ?', jobId, at, companyId ?? -1);

/** Job ids of `prefix` held for companies other than `companyId`. */
export const reservedIds = (db: Db, prefix: string, companyId: number | undefined, at: number): Set<string> =>
  new Set(db.prepare('SELECT job_id FROM job_reservations WHERE job_id LIKE ? AND reserved_until > ? AND company_id != ?').all(`${prefix}%`, at, companyId ?? -1).map((r) => (r as { job_id: string }).job_id));

/** The company's live reservation, if any. */
export const reservationOf = (db: Db, companyId: number, at: number): { jobId: string; reservedUntil: number } | null => {
  const r = get<{ job_id: string; reserved_until: number }>(db, 'SELECT job_id, reserved_until FROM job_reservations WHERE company_id = ? AND reserved_until > ?', companyId, at);
  return r ? { jobId: r.job_id, reservedUntil: r.reserved_until } : null;
};

/** Hold `jobId` for the company (replacing any earlier reservation of it). */
export const reserve = (db: Db, companyId: number, jobId: string, until: number): void => {
  run(db, 'DELETE FROM job_reservations WHERE company_id = ? OR job_id = ?', companyId, jobId);
  run(db, 'INSERT INTO job_reservations (job_id, company_id, reserved_until) VALUES (?, ?, ?)', jobId, companyId, until);
};

export const release = (db: Db, companyId: number, jobId: string): void => {
  run(db, 'DELETE FROM job_reservations WHERE company_id = ? AND job_id = ?', companyId, jobId);
};
