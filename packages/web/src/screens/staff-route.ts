import type { Ctx, Screen, ScreenFn } from '../screen.ts';
import { staff } from './staff.ts';
import { staffHire } from './staff-hire.ts';
import { staffLeave } from './staff-leave.ts';
import { staffMember } from './staff-member.ts';

/** `#staff`, `#staff/hire`, `#staff/leave` and `#staff/<id>` are one route name with a different argument (B.10): this picks the screen. */
export const staffRoute: ScreenFn = (ctx: Ctx): Promise<Screen> | Screen =>
  ctx.arg === null ? staff(ctx) : ctx.arg === 'hire' ? staffHire(ctx) : ctx.arg === 'leave' ? staffLeave(ctx) : staffMember(ctx);
