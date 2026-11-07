import type { Ctx, Screen, ScreenFn } from '../screen.ts';
import { financeCash } from './finance-cash.ts';
import { financeCreditNew } from './finance-credit-new.ts';
import { financeCredits } from './finance-credits.ts';
import { financeForecast } from './finance-forecast.ts';
import { financeLedger } from './finance-ledger.ts';
import { financeLines } from './finance-lines.ts';

/** `#finance`, `#finance/lines`, `#finance/ledger`, `#finance/forecast`, `#finance/credits` and `#finance/credit-new` are one route name with a different argument (B.10): this picks the screen. An unknown argument is the cash screen. */
export const financeRoute: ScreenFn = (ctx: Ctx): Promise<Screen> | Screen =>
  ctx.arg === 'lines' ? financeLines(ctx) : ctx.arg === 'ledger' ? financeLedger(ctx) : ctx.arg === 'forecast' ? financeForecast(ctx) : ctx.arg === 'credits' ? financeCredits(ctx) : ctx.arg === 'credit-new' ? financeCreditNew(ctx) : financeCash(ctx);
