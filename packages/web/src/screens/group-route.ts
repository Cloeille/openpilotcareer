import type { Ctx, Screen, ScreenFn } from '../screen.ts';
import { group } from './group.ts';
import { groupNew } from './group-new.ts';
import { groupTransfers } from './group-transfers.ts';

/** `#group`, `#group/new` and `#group/transfers` are one route name with a different argument (B.10): this picks the screen. An unknown argument is the group overview. */
export const groupRoute: ScreenFn = (ctx: Ctx): Promise<Screen> | Screen =>
  ctx.arg === 'new' ? groupNew(ctx) : ctx.arg === 'transfers' ? groupTransfers(ctx) : group(ctx);
