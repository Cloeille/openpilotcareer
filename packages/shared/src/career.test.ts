import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ONBOARDING_DRAFT_MAX_BYTES, REALISM_PRESETS, REALISM_TOGGLES, REALISM_TOGGLE_INFO, START_MODES, aircraftPrice, checkTelemetry, createCompanyStartSchema, deriveAircraft,
  fuelPriceFactor, onboardingUpdateSchema, presetSetting, realismUpdateSchema, realismView, settle, withToggles, FUEL_PRICE_PER_KG, NEUTRAL_REALISM, type Telemetry,
} from './index.ts';

test('presets: the modifiers of balanced/relaxed/hardcore are the sum of their toggles, as in the mockup', () => {
  const view = (p: 'relaxed' | 'balanced' | 'hardcore') => realismView(presetSetting(p));
  assert.deepEqual([view('relaxed').payModifierPct, view('relaxed').repModifierPct], [-5, -10]);
  assert.deepEqual([view('balanced').payModifierPct, view('balanced').repModifierPct], [10, 10]);
  assert.deepEqual([view('hardcore').payModifierPct, view('hardcore').repModifierPct], [30, 30]);
  assert.equal(REALISM_TOGGLES.filter((t) => REALISM_PRESETS.balanced.toggles[t]).length, 4, 'balanced has 4 of 6 toggles on');
  assert.deepEqual(REALISM_TOGGLES.filter((t) => !REALISM_PRESETS.balanced.toggles[t]), ['realFuelPrice', 'realWeatherRequired']);
});

test('realism view marks the toggles the server cannot apply yet', () => {
  const v = realismView(presetSetting('hardcore'));
  assert.deepEqual(REALISM_TOGGLES.filter((t) => !v.enforced[t]), ['delayPenalties', 'realWeatherRequired']);
  assert.equal(realismView(NEUTRAL_REALISM).payModifierPct, 0);
});

test('changing one toggle makes the preset custom; the modifiers follow; re-sending the same values changes nothing', () => {
  const balanced = presetSetting('balanced');
  assert.equal(withToggles(balanced, { realFuelPrice: false, wearAndFailures: true }), balanced);
  const custom = withToggles(balanced, { realFuelPrice: true });
  assert.equal(custom.preset, 'custom');
  const v = realismView(custom);
  assert.equal(v.payModifierPct, 10 + REALISM_TOGGLE_INFO.realFuelPrice.payPct);
  assert.equal(v.repModifierPct, 10 + REALISM_TOGGLE_INFO.realFuelPrice.repPct);
  assert.equal(balanced.toggles.realFuelPrice, false, 'the input is not mutated');
});

test('start modes match the contract', () => {
  assert.equal(START_MODES.airliner.capital, 2_500_000);
  assert.equal(START_MODES.hardcore.capital, 45_000);
  assert.deepEqual(START_MODES.airliner.starterTypes, ['A20N', 'B738', 'E295']);
  assert.deepEqual([START_MODES.hardcore.hubSize, START_MODES.hardcore.suggestedRealism], ['small', 'hardcore']);
});

test('fuelPriceFactor: deterministic per airport and UTC day, within +-25 %, varying', () => {
  const noon = Date.UTC(2026, 10, 4, 12);
  assert.equal(fuelPriceFactor('LFPG', noon), fuelPriceFactor('LFPG', Date.UTC(2026, 10, 4, 0, 0, 1)), 'same UTC day, same price');
  const seen = new Set<number>();
  for (let d = 0; d < 200; d++) for (const icao of ['LFPG', 'EGLL', 'KJFK']) {
    const f = fuelPriceFactor(icao, noon + d * 86_400_000);
    assert.ok(f >= 0.75 && f <= 1.25, String(f));
    seen.add(f);
  }
  assert.ok(seen.size > 500, 'prices vary across days and airports');
  assert.notEqual(fuelPriceFactor('LFPG', noon), fuelPriceFactor('LFPG', noon + 86_400_000));
});

const a320 = deriveAircraft({ icao: 'A320', name: 'A', category: 'jet-airliner', engines: 2, wtc: 'M' });
const base = { payout: 10_000, distanceNm: 300, aircraft: a320, status: 'verified', destSize: 'large', destIsHub: false } as const;

test('settle: pay and reputation modifiers scale revenue and the reputation gain; without them nothing changes', () => {
  const plain = settle(base);
  assert.deepEqual(settle({ ...base, payModifierPct: 0, repModifierPct: 0 }), plain);
  const hard = settle({ ...base, payModifierPct: 30, repModifierPct: 30 });
  assert.equal(hard.revenue, 13_000);
  assert.equal(hard.fuelCost, plain.fuelCost, 'costs do not scale with pay');
  assert.equal(hard.net, plain.net + 3_000);
  assert.ok(Math.abs(hard.reputationDelta - 0.13) < 1e-9);
  assert.equal(settle({ ...base, payModifierPct: -5 }).revenue, 9_500);
  assert.equal(settle({ ...base, status: 'unverified', payModifierPct: 10 }).revenue, Math.round(10_000 * 0.6 * 1.1));
  const landing = settle({ ...base, landingFpm: -900, repModifierPct: 30 });
  assert.equal(landing.reputationDelta, 0, 'a hard landing cancels the gain; it never goes below zero');
});

test('settle: fuelPriceFactor multiplies the fuel cost', () => {
  const plain = settle({ ...base, fuelUsedKg: 1000 });
  assert.equal(plain.fuelCost, Math.round(1000 * FUEL_PRICE_PER_KG));
  assert.equal(settle({ ...base, fuelUsedKg: 1000, fuelPriceFactor: 1.2 }).fuelCost, Math.round(1000 * FUEL_PRICE_PER_KG * 1.2));
});

test('checkTelemetry: ignoreFlags drops only the named flags', () => {
  const t0 = Date.UTC(2026, 10, 4, 12);
  const report = (flags: string[]): Telemetry => ({
    takeoffAt: new Date(t0 + 60_000).toISOString(), landedAt: new Date(t0 + 60_000 + 1.5 * 3_600_000).toISOString(), departureIcao: 'LFPG', arrivalIcao: 'EGLL', aircraftIcao: 'A320',
    payloadKg: 5000, fuelUsedKg: 2000, landingFpm: -200, distanceNm: 300, source: 'simconnect', flags,
  });
  const facts = { origin: 'LFPG', destination: 'EGLL', distanceNm: 300, payloadKg: 5000, aircraftIcao: 'A320', aircraft: a320, acceptedAt: t0, now: t0 + 3 * 3_600_000, antiCheat: true };
  assert.equal(checkTelemetry(report(['long_pause']), facts).ok, false);
  assert.equal(checkTelemetry(report(['long_pause']), { ...facts, ignoreFlags: ['long_pause'] }).ok, true);
  const other = checkTelemetry(report(['long_pause', 'slew_detected']), { ...facts, ignoreFlags: ['long_pause'] });
  assert.equal(other.ok, false);
  assert.match(other.ok ? '' : other.reason, /slew_detected/);
  assert.doesNotMatch(other.ok ? '' : other.reason, /long_pause/);
});

test('request schemas: identity is upper-cased and validated, draft is capped, realism update is strict', () => {
  const ok = createCompanyStartSchema.parse({ name: 'Azur Régional', hub: 'LFMN', code: 'azr', callsign: ' azur ', liveryColor: '#3b82f6', startMode: 'airliner' });
  assert.deepEqual([ok.code, ok.callsign, ok.liveryColor], ['AZR', 'AZUR', '#3B82F6']);
  assert.equal(createCompanyStartSchema.safeParse({ name: 'X Air', hub: 'LFMN', startMode: 'airliner' }).success, false, 'code and callsign required with a start mode');
  assert.equal(createCompanyStartSchema.safeParse({ name: 'X Air', hub: 'LFMN' }).success, true, 'legacy body');
  for (const bad of [{ code: 'AB' }, { code: 'ABCD' }, { code: 'A1B' }, { callsign: 'AB' }, { callsign: 'ABCDEFGHIJKLM' }, { liveryColor: 'blue' }, { liveryColor: '#12345' }]) {
    assert.equal(createCompanyStartSchema.safeParse({ name: 'X Air', hub: 'LFMN', ...bad }).success, false, JSON.stringify(bad));
  }
  assert.equal(onboardingUpdateSchema.safeParse({ step: 7 }).success, false);
  assert.equal(onboardingUpdateSchema.safeParse({ step: 0 }).success, false);
  assert.equal(onboardingUpdateSchema.safeParse({ draft: { a: 'x'.repeat(ONBOARDING_DRAFT_MAX_BYTES) } }).success, false);
  assert.equal(onboardingUpdateSchema.safeParse({ draft: { a: 'x'.repeat(100) }, step: 2, startMode: 'hardcore' }).success, true);
  assert.equal(realismUpdateSchema.safeParse({ preset: 'custom' }).success, false, 'custom is only ever the result of toggling');
  assert.equal(realismUpdateSchema.safeParse({ preset: 'balanced', toggles: {} }).success, false);
  assert.equal(realismUpdateSchema.safeParse({ toggles: { pauseTolerance: false } }).success, true);
  assert.equal(realismUpdateSchema.safeParse({ toggles: { nope: true } }).success, false);
  assert.ok(aircraftPrice(a320) > 0);
});
