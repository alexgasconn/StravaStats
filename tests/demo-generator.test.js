import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_DEMO_REFERENCE_DATE,
  generateDemoAthlete,
  generateDemoData,
} from '../js/demo/generator.js';

test('demo activities are deterministic for the same seed and reference date', () => {
  const options = {
    seed: 123456,
    referenceDate: '2026-07-28T12:00:00.000Z',
  };
  const first = generateDemoData(options);
  const second = generateDemoData(options);

  assert.equal(first.length, 500);
  assert.deepEqual(second, first);
});

test('different demo seeds produce different synthetic activities', () => {
  const first = generateDemoData({ seed: 1 });
  const second = generateDemoData({ seed: 2 });

  assert.notDeepEqual(second[0], first[0]);
});

test('demo generation is timezone-independent and rejects invalid reference dates', () => {
  const [activity] = generateDemoData({
    seed: 42,
    referenceDate: '2026-07-28T12:00:00.000Z',
  });

  assert.match(activity.start_date, /Z$/);
  assert.match(activity.start_date_local, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/);
  assert.throws(
    () => generateDemoData({ referenceDate: 'not-a-date' }),
    /referenceDate must be a valid date value/,
  );
});

test('demo athlete metadata uses the fixed demo reference date by default', () => {
  assert.equal(generateDemoAthlete().updated_at, DEFAULT_DEMO_REFERENCE_DATE);
});
