// Lease offers: a pure function of (aircraft type, UTC day). The four mockup aircraft are pinned to the mockup's lessor,
// age and rent level (jittered +-2.5 % per day); every other type is priced from its game value at the airliners' average rate.
import { LEASE_DEPOSIT_RENTS, LEASE_DURATIONS, aircraftPrice, type AircraftType, type LeaseMonths, type LeaseOffer } from '@opc/shared';
import { hashSeed, mulberry32 } from './board.ts';
import { ferryFee, insuranceMonthly } from './fleet-extras.ts';

const DAY_MS = 86_400_000;
export const dayOf = (ms: number): number => Math.floor(ms / DAY_MS);

type Anchor = {
  lessor: string; year: number; airframeHours: number; rent24: number; maintenanceIncluded: boolean; insuranceMonthly: number | null;
  minMonths: number; purchaseOptionPrice?: number; earlyExitAfter?: number;
};
/** Mockup frames "Onboarding 3a" and "Catalogue d'avions - location". */
export const LEASE_ANCHORS: Record<string, Anchor> = {
  A20N: { lessor: 'AerCap', year: 2024, airframeHours: 2_900, rent24: 320_000, maintenanceIncluded: true, insuranceMonthly: null, minMonths: 24 },
  B738: { lessor: 'SMBC Aviation', year: 2016, airframeHours: 38_400, rent24: 235_000, maintenanceIncluded: false, insuranceMonthly: null, minMonths: 12 },
  E295: { lessor: 'Azorra', year: 2022, airframeHours: 9_100, rent24: 205_000, maintenanceIncluded: true, insuranceMonthly: null, minMonths: 18 },
  DHC6: { lessor: 'Viking Air Leasing', year: 2015, airframeHours: 6_840, rent24: 38_000, maintenanceIncluded: true, insuranceMonthly: 2_100, minMonths: 12, purchaseOptionPrice: 2_650_000, earlyExitAfter: 6 },
};
/** Monthly rent at 12 / 24 / 36 months relative to the 24-month rent (DHC-6 frame: 42 000 / 38 000 / 34 500). */
const DURATION_FACTOR: Record<LeaseMonths, number> = { 12: 42_000 / 38_000, 24: 1, 36: 34_500 / 38_000 };
const GENERIC_RATE = 0.0326; // average of the three airliner anchors: rent per month / game price
const OPTION_SHARE = 0.65;
const LESSORS_JET = ['AerCap', 'SMBC Aviation', 'Azorra'];
const LESSORS_OTHER = ['Viking Air Leasing', 'Azorra'];

const roundTo = (n: number, step: number): number => Math.round(n / step) * step;
const isJet = (t: AircraftType): boolean => t.category === 'jet-airliner' || t.category === 'jet-widebody' || t.category === 'jet-business' || t.category === 'spaceplane';

export const offerId = (icao: string, day: number): string => `L-${icao}-${day}`;
export function parseOfferId(id: string): { icao: string; day: number } | null {
  const m = /^L-([A-Z0-9]{2,4})-(\d{1,7})$/.exec(id);
  return m ? { icao: m[1]!, day: Number(m[2]) } : null;
}

export function leaseOffer(type: AircraftType, day: number): LeaseOffer {
  const price = aircraftPrice(type);
  const rand = mulberry32(hashSeed(`lease:${type.icao}:${day}`));
  const anchor = LEASE_ANCHORS[type.icao];
  const jitter = 1 + (rand() * 2 - 1) * 0.025;
  const pick = rand();
  const baseRent = anchor?.rent24 ?? Math.max(250, roundTo(price * GENERIC_RATE, 50));
  const rent24 = roundTo(baseRent * jitter, baseRent >= 10_000 ? 500 : 50);
  const lessors = isJet(type) ? LESSORS_JET : LESSORS_OTHER;
  const year = anchor?.year ?? 2012 + Math.floor(pick * 13);
  const perYearHours = isJet(type) ? 3_000 : type.category.startsWith('turboprop') ? 1_200 : 250;
  const minMonths = anchor?.minMonths ?? (isJet(type) ? 24 : 12);
  const durations = LEASE_DURATIONS.filter((m) => m >= minMonths).map((months) => ({ months, monthlyRent: roundTo(rent24 * DURATION_FACTOR[months], rent24 >= 10_000 ? 500 : 50) }));
  const option = anchor?.purchaseOptionPrice ?? roundTo(price * OPTION_SHARE, price >= 1_000_000 ? 10_000 : 100);
  return {
    id: offerId(type.icao, day),
    lessor: anchor?.lessor ?? lessors[Math.floor(rand() * lessors.length)]!,
    icao: type.icao, typeName: type.name, year,
    airframeHours: anchor?.airframeHours ?? Math.round(((2026 - year) * perYearHours * (0.7 + rand() * 0.6)) / 10) * 10,
    maintenanceIncluded: anchor?.maintenanceIncluded ?? rand() < 0.5,
    insuranceMonthly: anchor ? anchor.insuranceMonthly : isJet(type) ? null : insuranceMonthly(Math.round(price * 0.8), type.category),
    deposit: LEASE_DEPOSIT_RENTS * rent24,
    ferryFee: ferryFee(price),
    // This slice delivers at signing: the convoy fee is paid and the aircraft stands at the hub at once.
    deliveryHours: 0,
    minMonths,
    durations,
    purchaseOptionPrice: option,
    earlyExit: { afterMonths: anchor?.earlyExitAfter ?? (isJet(type) ? minMonths : 6), penaltyRents: 2 },
  };
}
