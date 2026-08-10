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
  const clock = options.clock.value;
  const nowMs = clock?.now_ms;
  if (typeof registerRuntime !== 'function' || typeof nowMs !== 'function') fail();
  const launcherPath = safeAbsolutePath(options.launcher_path.value);
  const workerPath = safeAbsolutePath(options.worker_path.value);

  return Object.freeze({
    resolver_version: BUILDER_PACKAGED_CHECK_RUNTIME_RESOLVER_VERSION,
    resolve_npm_runtime() {
      try {
        const resolvedAtMs = nowMs.call(clock);
        if (!Number.isSafeInteger(resolvedAtMs) || resolvedAtMs < 0) fail();
        return registerRuntime.call(registry, {
          package_manager: 'npm',
          launcher_path: launcherPath,
          cli_entry_path: workerPath,
          package_manager_version: PACKAGED_NPM_SCRIPT_RUNTIME_VERSION,
          resolution_source: 'packaged_runtime',
          resolved_at_ms: resolvedAtMs,
          expires_at_ms: resolvedAtMs + MAX_RUNTIME_IDENTITY_LIFETIME_MS,
        });
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
