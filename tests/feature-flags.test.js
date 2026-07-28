import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_FEATURE_FLAGS,
  getFeatureFlags,
  resolveFeatureFlags,
} from '../js/app/feature-flags.js';

test('feature flags default to the legacy repository with local v2 paths disabled', () => {
  assert.deepEqual(resolveFeatureFlags(), DEFAULT_FEATURE_FLAGS);
});

test('feature flag overrides are explicit and validated', () => {
  assert.deepEqual(
    resolveFeatureFlags({
      dataRepositoryMode: 'v2',
      localImportEnabled: true,
      canonicalShadowWriteEnabled: true,
    }),
    {
      dataRepositoryMode: 'v2',
      localImportEnabled: true,
      canonicalShadowWriteEnabled: true,
    },
  );

  assert.deepEqual(
    resolveFeatureFlags({
      dataRepositoryMode: 'unknown',
      localImportEnabled: 'true',
    }),
    DEFAULT_FEATURE_FLAGS,
  );
});

test('runtime feature flags do not mutate the defaults', () => {
  const resolved = getFeatureFlags({ localImportEnabled: true });

  assert.equal(resolved.localImportEnabled, true);
  assert.equal(DEFAULT_FEATURE_FLAGS.localImportEnabled, false);
  assert.equal(Object.isFrozen(resolved), true);
});
