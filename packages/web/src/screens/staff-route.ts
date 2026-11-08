import type { Ctx, Screen, ScreenFn } from '../screen.ts';
import { staff } from './staff.ts';
import { staffAgency } from './staff-agency.ts';
import { staffHire } from './staff-hire.ts';
import { staffHr } from './staff-hr.ts';
import { staffLeave } from './staff-leave.ts';
import { staffMember } from './staff-member.ts';
import { staffTraining } from './staff-training.ts';

/** `#staff`, `#staff/hire`, `#staff/leave`, `#staff/agency`, `#staff/training`, `#staff/hr` and `#staff/<id>` are one route name with a different argument (B.10): this picks the screen. */
export const staffRoute: ScreenFn = (ctx: Ctx): Promise<Screen> | Screen =>
  ctx.arg === null ? staff(ctx) : ctx.arg === 'hire' ? staffHire(ctx) : ctx.arg === 'leave' ? staffLeave(ctx) : ctx.arg === 'agency' ? staffAgency(ctx) : ctx.arg === 'training' ? staffTraining(ctx) : ctx.arg === 'hr' ? staffHr(ctx) : staffMember(ctx);
