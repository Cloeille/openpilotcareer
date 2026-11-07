// Lot GROUP (v4): a parent company and its subsidiaries (docs/v4-plan.md A.3, B.1, B.3, C21, C32, C33). Request schemas and wire types; the server owns the money (server/src/group*.ts), the web only shows what it returns.
// Runtime-imports only career.ts (the identity schemas), never ./index.ts (index re-exports this file).
import { z } from 'zod';
import { airlineCodeSchema, callsignSchema } from './career.ts';

/** C32: what a subsidiary is for. A label: no rule reads it. */
export const GROUP_ACTIVITIES = ['passengers', 'cargo', 'charter'] as const;
export type GroupActivity = (typeof GROUP_ACTIVITIES)[number];

/** Why an aircraft cannot be ceded right now: the code a transfer of it would answer with (409). Leased, club and rented aircraft are never cedable (C33). */
export const CESSION_REFUSALS = ['leased_aircraft', 'aircraft_busy', 'in_maintenance', 'aircraft_on_line'] as const;
export type CessionRefusal = (typeof CESSION_REFUSALS)[number];

/** Why a subsidiary cannot be founded from this company: a subsidiary has none of its own, and the 5-company cap counts subsidiaries (C21). */
export const GROUP_CREATE_REFUSALS = ['is_subsidiary', 'limit_reached'] as const;
export type GroupCreateRefusal = (typeof GROUP_CREATE_REFUSALS)[number];

const TRANSFER_MAX = 1_000_000_000;
const euros = z.int().min(0).max(TRANSFER_MAX);
const aircraftIds = z.array(z.int().positive()).max(50).refine((ids) => new Set(ids).size === ids.length, { message: 'aircraft ids must be unique' });

/** `POST /group/subsidiaries`: the active company founds a subsidiary. `funding` and `aircraftIds` are a transfer from the parent made in the same transaction (none by default: no starting grant). */
export const subsidiarySchema = z.object({
  name: z.string().trim().min(2).max(40),
  hub: z.string().regex(/^[A-Z]{4}$/, 'ICAO airport code: 4 letters A-Z'),
  code: airlineCodeSchema,
  iata: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2}$/, '2 characters A-Z or 0-9').optional(),
  callsign: callsignSchema.optional(),
  activity: z.enum(GROUP_ACTIVITIES),
  funding: euros.default(0),
  aircraftIds: aircraftIds.default([]),
});
export type SubsidiaryRequest = z.infer<typeof subsidiarySchema>;

/** `POST /group/transfers`: one batch between a parent and its subsidiary, either way, all or nothing. */
export const groupTransferSchema = z.object({ from: z.int().positive(), to: z.int().positive(), cash: euros.default(0), aircraftIds: aircraftIds.default([]) })
  .refine((t) => t.from !== t.to, { message: 'from and to must differ', path: ['to'] })
  .refine((t) => t.cash > 0 || t.aircraftIds.length > 0, { message: 'nothing to transfer', path: ['cash'] });
export type GroupTransferRequest = z.infer<typeof groupTransferSchema>;

export const GROUP_ROLES = ['parent', 'subsidiary'] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];
export type GroupAircraft = { id: number; registration: string; icao: string; location: string; value: number; cession: CessionRefusal | null };
/** One closed month of one company, from its cash report (reports.ts) with the capital movements taken out: grants, bailouts and what the group moves between its companies are not results. */
export type GroupMonth = { revenue: number; spend: number; result: number };
export type GroupCompany = {
  id: number; name: string; code: string | null; iata: string | null; activity: GroupActivity | null; role: GroupRole; hub: string | null;
  balance: number; month: GroupMonth; aircraft: number; staff: number; lines: number; fleet: GroupAircraft[];
};
/** The consolidated group: every figure is the sum of the companies' own, except `netWorth`, which is the parent's (it already includes its subsidiaries). */
export type GroupTotals = GroupMonth & { balance: number; netWorth: number; aircraft: number; staff: number; lines: number };
/** `month` (`YYYY-MM`) is the last closed UTC month the results are of. Companies: the parent first, then the subsidiaries in the order they were founded. */
export type GroupView = { month: string; total: GroupTotals; companies: GroupCompany[]; createRefusal: GroupCreateRefusal | null };
export type GroupCreated = { id: number; group: GroupView };
