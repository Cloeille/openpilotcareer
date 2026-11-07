import type { Flight, Interruptions } from '@opc/shared';
import { badge, type BadgeVariant } from './components.ts';
import { getLang, t, translatePlural, type Lang } from './i18n.ts';

const VARIANT: Record<Flight['status'], BadgeVariant> = { verified: 'verified', unverified: 'unverified', rejected: 'rejected', cancelled: 'neutral', active: 'route' };

/** The verification badge of a flight: the label says it, the icon and colour back it up. */
export const flightBadge = (f: Pick<Flight, 'status'>): HTMLElement => badge(VARIANT[f.status], t(`status.${f.status}`), f.status === 'cancelled' ? 'circle-x' : undefined);

/** "2 reloads · simulator restart": the reloads and sim crashes the bridge saw. They are allowed, so this only informs. */
export const interruptionLabel = (i: Interruptions, lang: Lang = getLang()): string =>
  [i.reloads > 0 ? translatePlural(lang, 'fl.reloads', i.reloads) : null, i.simRestarts > 0 ? translatePlural(lang, 'fl.simRestarts', i.simRestarts) : null].filter((x) => x !== null).join(' · ');
