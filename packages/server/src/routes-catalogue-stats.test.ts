import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aircraftTypes } from './catalog.ts';
import { harness } from './harness.ts';

test('catalogue stats count every ICAO type and the curated ones, matching the catalogue itself', async () => {
  const h = await harness();
  const r = await h.call('GET', '/api/v1/aircraft-types/stats');
  assert.equal(r.status, 200);
  assert.equal(r.body.total, aircraftTypes.size);
  assert.equal(r.body.curated, [...aircraftTypes.values()].filter((t) => !t.derived).length);
  assert.ok(r.body.curated > 0 && r.body.curated < r.body.total);
  assert.equal((await h.call('GET', '/api/v1/aircraft-types/A320')).body.icao, 'A320');
});
