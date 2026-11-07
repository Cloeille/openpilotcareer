import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interruptionLabel } from './flight-view.ts';

test('the flight detail names the reloads and sim restarts the bridge saw, in the pilot\'s language', () => {
  assert.equal(interruptionLabel({ reloads: 1, simRestarts: 0, downtimeMs: 0 }, 'en'), '1 reload');
  assert.equal(interruptionLabel({ reloads: 3, simRestarts: 1, downtimeMs: 60_000 }, 'en'), '3 reloads · simulator restart');
  assert.equal(interruptionLabel({ reloads: 0, simRestarts: 2, downtimeMs: 60_000 }, 'en'), '2 simulator restarts');
  assert.equal(interruptionLabel({ reloads: 1, simRestarts: 1, downtimeMs: 60_000 }, 'fr'), '1 rechargement · redémarrage du simulateur');
  assert.equal(interruptionLabel({ reloads: 2, simRestarts: 0, downtimeMs: 0 }, 'fr'), '2 rechargements');
});
