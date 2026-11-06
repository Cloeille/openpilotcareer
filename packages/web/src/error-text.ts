import { PRODUCT_NAME } from './brand.ts';
import { ApiError } from './errors.ts';
import { t } from './i18n.ts';
import { messageFor } from './messages.ts';

/** Text to show for a failure. Errors with a stable code get the player's language; the rest (validation details, texts the server composed from names and numbers) show the server's own message, the contract's only description of them. */
export function errorText(e: unknown): string {
  if (!(e instanceof ApiError)) return String(e);
  const key = messageFor(`err.${e.code}`);
  return key ? t(key, { product: PRODUCT_NAME }) : e.message;
}
