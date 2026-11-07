import type { Ctx, Screen, ScreenFn } from '../screen.ts';
import { financeCash } from './finance-cash.ts';
import { financeForecast } from './finance-forecast.ts';
import { financeLedger } from './finance-ledger.ts';
import { financeLines } from './finance-lines.ts';

/** `#finance`, `#finance/lines`, `#finance/ledger` and `#finance/forecast` are one route name with a different argument (B.10): this picks the screen. An unknown argument is the cash screen. */
export const financeRoute: ScreenFn = (ctx: Ctx): Promise<Screen> | Screen =>
  ctx.arg === 'lines' ? financeLines(ctx) : ctx.arg === 'ledger' ? financeLedger(ctx) : ctx.arg === 'forecast' ? financeForecast(ctx) : financeCash(ctx);
