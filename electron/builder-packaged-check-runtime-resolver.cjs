'use strict';

const path = require('node:path');
const { types: utilTypes } = require('node:util');

const {
  PACKAGED_NPM_SCRIPT_RUNTIME_VERSION,
} = require('./builder-packaged-check-runtime-contract.cjs');

const BUILDER_PACKAGED_CHECK_RUNTIME_RESOLVER_VERSION = 'builder-packaged-check-runtime-resolver.v1';
const MAX_RUNTIME_IDENTITY_LIFETIME_MS = 10 * 60 * 1000;
const CREATE_KEYS = Object.freeze([
  'runtime_registry',
  'launcher_path',
  'worker_path',
  'clock',
]);

class BuilderPackagedCheckRuntimeResolverError extends Error {
  constructor() {
    super('The packaged project check runtime is unavailable.');
    this.name = 'BuilderPackagedCheckRuntimeResolverError';
    this.code = 'builder_packaged_check_runtime_unavailable';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderPackagedCheckRuntimeResolverError(); }

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some(
    (key) => typeof key !== 'string' || !keys.includes(key),
  )) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return descriptors;
}

function safeAbsolutePath(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 1_024
    || value.includes('\0')
    || !path.isAbsolute(value)
    || path.normalize(value) !== value
  ) fail();
  return value;
}

function createBuilderPackagedCheckRuntimeResolver(rawOptions) {
  const options = exactObject(rawOptions, CREATE_KEYS);
  const registry = options.runtime_registry.value;
  const registerRuntime = registry?.register_runtime;
  const registerRuntimeAsync = registry?.register_runtime_async;
  const clock = options.clock.value;
  const nowMs = clock?.now_ms;
  if (
    typeof registerRuntime !== 'function'
    || (registerRuntimeAsync !== undefined && typeof registerRuntimeAsync !== 'function')
    || typeof nowMs !== 'function'
  ) fail();
  const launcherPath = safeAbsolutePath(options.launcher_path.value);
  const workerPath = safeAbsolutePath(options.worker_path.value);
  let cachedIdentity = null;
  let pendingIdentity = null;

  function registration(resolvedAtMs) {
    return {
      package_manager: 'npm',
      launcher_path: launcherPath,
      cli_entry_path: workerPath,
      package_manager_version: PACKAGED_NPM_SCRIPT_RUNTIME_VERSION,
      resolution_source: 'packaged_runtime',
      resolved_at_ms: resolvedAtMs,
      expires_at_ms: resolvedAtMs + MAX_RUNTIME_IDENTITY_LIFETIME_MS,
    };
  }

  function reusableIdentity(resolvedAtMs) {
    return cachedIdentity !== null
      && resolvedAtMs >= cachedIdentity.resolved_at_ms
      && resolvedAtMs < cachedIdentity.expires_at_ms
      ? cachedIdentity
      : null;
  }

  return Object.freeze({
    resolver_version: BUILDER_PACKAGED_CHECK_RUNTIME_RESOLVER_VERSION,
    resolve_npm_runtime() {
      try {
        const resolvedAtMs = nowMs.call(clock);
        if (!Number.isSafeInteger(resolvedAtMs) || resolvedAtMs < 0) fail();
        const reusable = reusableIdentity(resolvedAtMs);
        if (reusable !== null) return reusable;
        cachedIdentity = registerRuntime.call(registry, registration(resolvedAtMs));
        return cachedIdentity;
      } catch (error) {
        if (error instanceof BuilderPackagedCheckRuntimeResolverError) throw error;
        fail();
      }
    },
    async resolve_npm_runtime_async() {
      try {
        const resolvedAtMs = nowMs.call(clock);
        if (!Number.isSafeInteger(resolvedAtMs) || resolvedAtMs < 0) fail();
        const reusable = reusableIdentity(resolvedAtMs);
        if (reusable !== null) return reusable;
        if (pendingIdentity !== null) return await pendingIdentity;
        const register = registerRuntimeAsync ?? registerRuntime;
        pendingIdentity = Promise.resolve(
          register.call(registry, registration(resolvedAtMs)),
        ).then((identity) => {
          cachedIdentity = identity;
          return identity;
        });
        try {
          return await pendingIdentity;
        } finally {
          pendingIdentity = null;
        }
      } catch (error) {
        if (error instanceof BuilderPackagedCheckRuntimeResolverError) throw error;
        fail();
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_PACKAGED_CHECK_RUNTIME_RESOLVER_VERSION,
  MAX_RUNTIME_IDENTITY_LIFETIME_MS,
  BuilderPackagedCheckRuntimeResolverError,
  createBuilderPackagedCheckRuntimeResolver,
});
