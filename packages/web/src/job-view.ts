import type { Job } from '@opc/shared';
import { fmt } from './format.ts';
import { t, tp } from './i18n.ts';

/** `46 passagers` / `1 300 kg de fret`. */
export const loadLabel = (j: Pick<Job, 'kind' | 'pax' | 'payloadKg'>): string => (j.kind === 'pax' ? tp('job.pax', j.pax) : t('job.cargoKg', { kg: fmt().kg(j.payloadKg) }));
