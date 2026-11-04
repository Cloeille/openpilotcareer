import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hello } from './index.ts';
test('x', () => assert.equal(hello(1), 'hi 1'));
