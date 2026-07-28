export const DEFAULT_FEATURE_FLAGS = Object.freeze({
    dataRepositoryMode: 'legacy',
    localImportEnabled: false,
    canonicalShadowWriteEnabled: false,
});

const repositoryModes = new Set(['legacy', 'v2']);

export function resolveFeatureFlags(overrides = {}) {
    const dataRepositoryMode = repositoryModes.has(overrides.dataRepositoryMode)
        ? overrides.dataRepositoryMode
        : DEFAULT_FEATURE_FLAGS.dataRepositoryMode;

    return Object.freeze({
        dataRepositoryMode,
        localImportEnabled: overrides.localImportEnabled === true,
        canonicalShadowWriteEnabled: overrides.canonicalShadowWriteEnabled === true,
    });
}

export function getFeatureFlags(runtimeOverrides = globalThis.__STRAVASTATS_FEATURE_FLAGS__) {
    return resolveFeatureFlags(runtimeOverrides || {});
}
