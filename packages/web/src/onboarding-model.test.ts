import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLUB, MONTHLY_RENTAL, cheapestAbove, LADDER, ladderRank, PRESET_TOGGLES, bridgeVerdict, cheapestBelow, clampStep, hardcoreOptions, keyUsed, leaseRecap, listedTerm, modifiersOf, normalizeCallsign, normalizeCode,
  pickLoan, presetRealism, readDraft, resumeStep, signedPct, stepPreset, suggestCallsign, suggestCode, toDraft, typicalGain, withToggle, monthlyCost, activeToggles, runningCostPerHour, liveryIdOf, DRAFT_MAX_BYTES, emptyForm,
} from './onboarding-model.ts';

const loanOpt = (downPct: number, months: number, monthly: number, total: number) => ({ downPct, months, monthly, total, down: 0, dueToday: 0 });
const quoteOf = (cash: number, loans: ReturnType<typeof loanOpt>[], leaseOffers: number) => ({ cash, loans, leaseOffers, price: cash, ferryFee: 0, balance: 0 });

test('presets add up to the pay and reputation of the mockup', () => {
  const m = (p: keyof typeof PRESET_TOGGLES) => modifiersOf(PRESET_TOGGLES[p]);
  assert.deepEqual(m('relaxed'), { pay: -5, rep: -10 });
  assert.deepEqual(m('balanced'), { pay: 10, rep: 10 });
  assert.deepEqual(m('hardcore'), { pay: 30, rep: 30 });
  assert.equal(activeToggles({ toggles: PRESET_TOGGLES.balanced }), 4);
});

test('changing one toggle moves the preset to custom and re-sums the modifiers', () => {
  const balanced = presetRealism('balanced');
  assert.equal(balanced.payModifierPct, 10);
  const next = withToggle(balanced, 'realFuelPrice', true);
  assert.equal(next.preset, 'custom');
  assert.equal(next.payModifierPct, 18);
  assert.equal(next.repModifierPct, 15);
  assert.equal(withToggle(next, 'realFuelPrice', false).payModifierPct, 10);
  assert.equal(withToggle(balanced, 'wearAndFailures', true), balanced, 'no change keeps the preset');
});

test('stepping presets clamps, and from custom goes to the nearest end', () => {
  assert.equal(stepPreset('balanced', 1), 'hardcore');
  assert.equal(stepPreset('hardcore', 1), 'hardcore');
  assert.equal(stepPreset('relaxed', -1), 'relaxed');
  assert.equal(stepPreset('custom', 1), 'relaxed');
  assert.equal(stepPreset('custom', -1), 'hardcore');
});

test('signed percentages use the typographic minus', () => {
  assert.equal(signedPct(10), '+10\u00a0%');
  assert.equal(signedPct(-5), '\u22125\u00a0%');
  assert.equal(signedPct(0), '0\u00a0%');
});

test('code and callsign are normalised and suggested from the name', () => {
  assert.equal(normalizeCode('az-r é!'), 'AZR');
  assert.equal(normalizeCode('abcdef'), 'ABC');
  assert.equal(normalizeCallsign('Azur 12'), 'AZUR');
  assert.equal(suggestCode('Azur Régional'), 'AZR');
  assert.equal(suggestCode(''), '');
  assert.equal(suggestCallsign('Azur Régional'), 'AZUR');
  assert.equal(liveryIdOf('#6fb4d4'), 'azure');
  assert.equal(liveryIdOf(null), null);
});

test('lease recap computes deposit, first rent, remaining capital, autonomy and flights per month', () => {
  const r = leaseRecap(2_500_000, { deposit: 640_000, ferryFee: 0 }, 320_000, 42_000);
  assert.equal(r.remaining, 1_540_000);
  assert.equal(r.autonomyMonths, 4.8);
  assert.equal(r.flightsPerMonth, 8);
  assert.equal(r.affordable, true);
  assert.ok(Math.abs(r.shares.deposit + r.shares.first + r.shares.rest - 1) < 1e-9);
});

test('lease recap counts the ferry fee in the first payment and flags a short capital', () => {
  const r = leaseRecap(500_000, { deposit: 470_000, ferryFee: 12_000 }, 235_000, null);
  assert.equal(r.remaining, 500_000 - 470_000 - 247_000);
  assert.equal(r.affordable, false);
  assert.equal(r.flightsPerMonth, null);
  assert.equal(r.shares.rest, 0);
});

test('the listed term is the one for the minimum duration', () => {
  const durations = [{ months: 12 as const, monthlyRent: 350 }, { months: 24 as const, monthlyRent: 320 }, { months: 36 as const, monthlyRent: 300 }];
  assert.deepEqual(listedTerm({ minMonths: 24, durations }), { months: 24, monthlyRent: 320 });
  assert.deepEqual(listedTerm({ minMonths: 18, durations }), { months: 24, monthlyRent: 320 });
  assert.deepEqual(listedTerm({ minMonths: 60, durations }), { months: 36, monthlyRent: 300 });
});

test('typical gain follows the game pay formula for a jet airliner and a trainer', () => {
  const a320 = { icao: 'A20N', name: 'A320neo', category: 'jet-airliner', engines: 2, wtc: 'M', seats: 186, cargoKg: 3000, cruiseKts: 450, rangeNm: 3400, derived: false } as const;
  const c152 = { icao: 'C152', name: 'Cessna 152', category: 'piston-single', engines: 1, wtc: 'L', seats: 2, cargoKg: 25, cruiseKts: 107, rangeNm: 415, derived: false } as const;
  assert.ok(typicalGain(a320) > typicalGain(c152) * 20);
  assert.ok(typicalGain(c152) > 0);
});

test('the 20 h per month column of the hardcore table matches the mockup', () => {
  const quote = quoteOf(62_000, [loanOpt(25, 60, 1_510, 90_600), loanOpt(50, 36, 1_200, 43_200)], 3);
  const [club, monthly, credit] = hardcoreOptions(quote, 100);
  assert.equal(monthlyCost(club!), 4_200);
  assert.equal(monthlyCost(monthly!), 4_100);
  assert.equal(monthlyCost(credit!), 3_510);
  assert.equal(credit!.upfront, 15_500);
  assert.equal(credit!.price, 62_000);
  assert.equal(monthlyCost(club!, 0), 0);
});

test('without a loan quote only the two rentals are offered', () => {
  assert.equal(hardcoreOptions(null, null).length, 2);
  assert.equal(hardcoreOptions(quoteOf(62_000, [], 0), 100).length, 2);
  assert.equal(pickLoan([]), null);
});

test('the club is cheapest below 13 h per month against the mockup options', () => {
  const opts = hardcoreOptions(quoteOf(62_000, [loanOpt(25, 60, 1_510, 0)], 0), 100);
  assert.equal(cheapestBelow(opts[0]!, opts.slice(1)), 13);
  assert.equal(cheapestBelow(opts[1]!, [opts[0]!]), null, 'monthly rental costs more fixed AND is cheaper per hour: no ceiling against the club');
  assert.equal(CLUB.hourly, 210);
  assert.equal(MONTHLY_RENTAL.deposit, 5_000);
});

test('running cost per hour is fuel plus upkeep from the game settlement formula', () => {
  const c152 = { icao: 'C152', name: 'Cessna 152', category: 'piston-single', engines: 1, wtc: 'L', seats: 2, cargoKg: 25, cruiseKts: 107, rangeNm: 415, derived: false } as const;
  const jet = { icao: 'A20N', name: 'A320neo', category: 'jet-airliner', engines: 2, wtc: 'M', seats: 180, cargoKg: 4000, cruiseKts: 447, rangeNm: 3400, derived: false } as const;
  assert.equal(runningCostPerHour(c152), 30, '12 EUR fuel + 18 EUR upkeep');
  assert.ok(runningCostPerHour(jet) > runningCostPerHour(c152) * 100);
});

test('bridge verdict: waiting, connected, failed after 60 s', () => {
  assert.equal(bridgeVerdict(null, false, 5_000).overall, 'waiting');
  assert.equal(bridgeVerdict(null, false, 61_000).overall, 'failed');
  const up = { reachable: true, version: '0.6.2', sim: 'waiting' as const };
  const waiting = bridgeVerdict(up, true, 24_000);
  assert.equal(waiting.bridge, 'ok');
  assert.equal(waiting.key, 'ok');
  assert.equal(waiting.sim, 'wait');
  assert.equal(waiting.overall, 'waiting');
  assert.equal(bridgeVerdict({ ...up, sim: 'connected' }, true, 30_000).overall, 'connected');
  assert.equal(bridgeVerdict({ ...up, sim: 'connected' }, false, 30_000).overall, 'waiting', 'the server has not seen the key yet');
  assert.equal(bridgeVerdict({ reachable: true }, true, 1_000).overall, 'connected', 'a bridge without a sim field counts as connected once the key was used');
  assert.equal(bridgeVerdict(null, true, 1_000).overall, 'connected', 'the server saw the key: the bridge may run on another PC');
  assert.equal(bridgeVerdict(up, true, 10_000).overall, 'waiting', 'key used but the simulator is not connected yet');
  assert.equal(bridgeVerdict(up, false, 90_000).overall, 'waiting', 'a reachable bridge never times out into failure');
});

test('key usage reads lastUsedAt of the created key only', () => {
  const keys = [{ id: 1, label: 'old', lastUsedAt: 5 }, { id: 2, label: 'PC principal', lastUsedAt: null }];
  assert.equal(keyUsed(keys, 2), false);
  assert.equal(keyUsed(keys, 1), true);
  assert.equal(keyUsed(keys, null), false);
});

test('draft survives a round trip, rejects junk and stays under 8 KB', () => {
  const d = readDraft(toDraft({ form: { ...emptyForm(), name: 'Azur Régional', code: 'AZR', callsign: 'AZUR', color: '#6FB4D4', hub: 'LFMN' }, bridge: 'skipped' }));
  assert.equal(d.form.name, 'Azur Régional');
  assert.equal(d.form.hub, 'LFMN');
  assert.equal(d.bridge, 'skipped');
  const junk = readDraft({ form: { name: 5, color: 'red', hub: 'lfmn', code: 'a1z' }, bridge: 'x' });
  assert.equal(junk.form.name, '');
  assert.equal(junk.form.color, null);
  assert.equal(junk.form.hub, null);
  assert.equal(junk.form.code, 'AZ');
  assert.equal(junk.bridge, 'unknown');
  assert.ok(new TextEncoder().encode(JSON.stringify(toDraft({ form: { ...emptyForm(), name: 'x'.repeat(50_000), hubQuery: 'y'.repeat(50_000) }, bridge: 'unknown' }))).length <= DRAFT_MAX_BYTES);
  assert.deepEqual(readDraft(null).form, emptyForm());
});

test('the wizard resumes where the saved state allows', () => {
  assert.equal(resumeStep({ step: 4, startMode: null, companyId: null }), 1);
  assert.equal(resumeStep({ step: 5, startMode: 'airliner', companyId: null }), 2);
  assert.equal(resumeStep({ step: 1, startMode: 'airliner', companyId: null }), 1);
  assert.equal(resumeStep({ step: 2, startMode: 'airliner', companyId: 7 }), 3);
  assert.equal(resumeStep({ step: 5, startMode: 'hardcore', companyId: 7 }), 5);
  assert.equal(clampStep(9), 6);
  assert.equal(clampStep(0), 1);
});

test('the credit plan becomes the cheapest above a number of flight hours', () => {
  const opts = hardcoreOptions(quoteOf(62_000, [loanOpt(25, 60, 1_510, 0)], 0), 100);
  assert.equal(cheapestAbove(opts[2]!, opts.slice(0, 2)), 14, 'vs the club: 1510 / (210 - 100) = 13.7 h; vs the monthly rental it is cheaper at every volume');
  assert.equal(cheapestAbove(opts[0]!, opts.slice(1)), null, 'the club has the dearest hour: never cheapest at high volume');
});

test('the progression ladder uses the real rank thresholds', () => {
  assert.equal(ladderRank(LADDER[1]!.rank).hours, 150);
  assert.equal(ladderRank(LADDER[2]!.rank).hours, 500);
  assert.equal(ladderRank(LADDER[3]!.rank).hours, 1500);
});
