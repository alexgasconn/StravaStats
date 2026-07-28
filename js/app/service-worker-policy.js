export const LOCAL_SERVICE_WORKER_QUERY_PARAM = 'enable-sw';

const localHostnames = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function isLocalDevelopmentHost(hostname = '') {
    return localHostnames.has(String(hostname).toLowerCase());
}

export function shouldRegisterServiceWorker({
    hostname = '',
    search = '',
} = {}) {
    if (!isLocalDevelopmentHost(hostname)) {
        return true;
    }

    const params = new URLSearchParams(search);
    return params.get(LOCAL_SERVICE_WORKER_QUERY_PARAM) === '1';
}

async function unregisterDevelopmentWorkers(serviceWorker) {
    if (typeof serviceWorker.getRegistrations !== 'function') {
        return 0;
    }

    const registrations = await serviceWorker.getRegistrations();
    const results = await Promise.all(registrations.map(registration => registration.unregister()));
    return results.filter(Boolean).length;
}

async function clearDevelopmentCaches(cacheStorage) {
    if (!cacheStorage || typeof cacheStorage.keys !== 'function') {
        return 0;
    }

    const cacheNames = await cacheStorage.keys();
    const targetNames = cacheNames.filter(name => name.startsWith('strava-dashboard-'));
    const results = await Promise.all(targetNames.map(name => cacheStorage.delete(name)));
    return results.filter(Boolean).length;
}

export async function applyServiceWorkerPolicy({
    navigatorObject = globalThis.navigator,
    locationObject = globalThis.location,
    cacheStorage = globalThis.caches,
    serviceWorkerUrl = './sw.js',
    logger = console,
} = {}) {
    const serviceWorker = navigatorObject?.serviceWorker;
    if (!serviceWorker) {
        return { action: 'unsupported', registrationsChanged: 0, cachesChanged: 0 };
    }

    const register = shouldRegisterServiceWorker({
        hostname: locationObject?.hostname,
        search: locationObject?.search,
    });

    if (register) {
        await serviceWorker.register(serviceWorkerUrl);
        logger.info?.('Service Worker registered.');
        return { action: 'registered', registrationsChanged: 1, cachesChanged: 0 };
    }

    const [registrationsChanged, cachesChanged] = await Promise.all([
        unregisterDevelopmentWorkers(serviceWorker),
        clearDevelopmentCaches(cacheStorage),
    ]);

    logger.info?.('Service Worker disabled for local development.', {
        registrationsChanged,
        cachesChanged,
    });

    return { action: 'disabled', registrationsChanged, cachesChanged };
}
