import type { Flight } from '@opc/shared';
import { badge, type BadgeVariant } from './components.ts';
import { t } from './i18n.ts';

const VARIANT: Record<Flight['status'], BadgeVariant> = { verified: 'verified', unverified: 'unverified', rejected: 'rejected', cancelled: 'neutral', active: 'route' };

/** The verification badge of a flight: the label says it, the icon and colour back it up. */
export const flightBadge = (f: Pick<Flight, 'status'>): HTMLElement => badge(VARIANT[f.status], t(`status.${f.status}`), f.status === 'cancelled' ? 'circle-x' : undefined);
