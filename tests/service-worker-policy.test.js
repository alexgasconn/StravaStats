import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyServiceWorkerPolicy,
  isLocalDevelopmentHost,
  shouldRegisterServiceWorker,
} from '../js/app/service-worker-policy.js';

test('local development hosts disable Service Worker by default', () => {
  for (const hostname of ['localhost', '127.0.0.1', '::1', '[::1]']) {
    assert.equal(isLocalDevelopmentHost(hostname), true);
    assert.equal(shouldRegisterServiceWorker({ hostname }), false);
  }
});

test('local Service Worker can be enabled explicitly and production remains enabled', () => {
  assert.equal(
    shouldRegisterServiceWorker({ hostname: 'localhost', search: '?enable-sw=1' }),
    true,
  );
  assert.equal(shouldRegisterServiceWorker({ hostname: 'stravastats.vercel.app' }), true);
});

test('disabled local policy unregisters workers and clears only app caches', async () => {
  const unregistered = [];
  const deletedCaches = [];
  const serviceWorker = {
    async getRegistrations() {
      return [
        { unregister: async () => unregistered.push('one') && true },
        { unregister: async () => unregistered.push('two') && true },
      ];
    },
    async register() {
      throw new Error('register must not run for default localhost policy');
    },
  };
  const cacheStorage = {
    async keys() {
      return ['strava-dashboard-v1', 'unrelated-cache'];
    },
    async delete(name) {
      deletedCaches.push(name);
      return true;
    },
  };

  const result = await applyServiceWorkerPolicy({
    navigatorObject: { serviceWorker },
    locationObject: { hostname: 'localhost', search: '' },
    cacheStorage,
    logger: {},
  });

  assert.deepEqual(result, {
    action: 'disabled',
    registrationsChanged: 2,
    cachesChanged: 1,
  });
  assert.deepEqual(unregistered, ['one', 'two']);
  assert.deepEqual(deletedCaches, ['strava-dashboard-v1']);
});

test('production policy registers the existing Service Worker path', async () => {
  const registered = [];

  const result = await applyServiceWorkerPolicy({
    navigatorObject: {
      serviceWorker: {
        async register(url) {
          registered.push(url);
        },
      },
    },
    locationObject: { hostname: 'stravastats.vercel.app', search: '' },
    cacheStorage: null,
    logger: {},
  });

  assert.deepEqual(result, {
    action: 'registered',
    registrationsChanged: 1,
    cachesChanged: 0,
  });
  assert.deepEqual(registered, ['./sw.js']);
});
