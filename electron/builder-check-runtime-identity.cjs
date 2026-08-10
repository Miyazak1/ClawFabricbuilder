'use strict';

const fs = require('node:fs');
const nodeCrypto = require('node:crypto');
const path = require('node:path');
const { types: utilTypes } = require('node:util');

const BUILDER_CHECK_RUNTIME_IDENTITY_VERSION = 'builder-check-runtime-identity.v1';
const BUILDER_CHECK_RUNTIME_REGISTRY_VERSION = 'builder-check-runtime-registry.v1';
const BUILDER_CHECK_RUNTIME_HANDLE_VERSION = 'builder-check-runtime-handle.v1';
const REGISTER_KEYS = Object.freeze([
  'package_manager',
  'launcher_path',
  'cli_entry_path',
  'package_manager_version',
  'resolution_source',
  'resolved_at_ms',
  'expires_at_ms',
]);
const READ_KEYS = Object.freeze(['runtime_identity', 'read_at_ms']);
const IDENTITY_KEYS = Object.freeze([
  'runtime_identity_version',
  'runtime_identity_id',
  'package_manager',
  'launcher_kind',
  'launcher_binary_digest',
  'cli_entry_digest',
  'package_manager_version',
  'resolution_source',
  'resolved_at_ms',
  'expires_at_ms',
  'status',
  'authority',
  'runtime_identity_digest',
]);
const AUTHORITY_KEYS = Object.freeze([
  'identity_authority',
  'path_authority',
  'renderer_authority',
  'ipc_authority',
  'provider_dispatch',
  'command_execution',
  'source_read',
  'source_write',
  'git_write',
  'sqlite_write',
  'save_authority',
  'network_authority',
]);
const AUTHORITY = Object.freeze({
  identity_authority: 'main_owned_verified_runtime_files_v1',
  path_authority: 'private_registry_only',
  renderer_authority: 'not_present',
  ipc_authority: 'not_present',
  provider_dispatch: false,
  command_execution: false,
  source_read: 'runtime_files_only',
  source_write: 'not_present',
  git_write: false,
  sqlite_write: false,
  save_authority: false,
  network_authority: 'not_present',
});
const HANDLE_AUTHORITY = Object.freeze({
  handle_authority: 'trusted_main_runtime_registry_v1',
  path_disclosure: 'main_runner_only',
  renderer_authority: 'not_present',
  ipc_authority: 'not_present',
  command_execution: false,
});
const PACKAGE_MANAGERS = Object.freeze(['npm', 'pnpm', 'yarn', 'bun']);
const NODE_CLI_MANAGERS = new Set(['npm', 'pnpm', 'yarn']);
const RESOLUTION_SOURCES = Object.freeze([
  'main_configured_runtime',
  'verified_external_runtime',
  'packaged_runtime',
]);
const ID_PATTERN = /^builder-check-runtime-identity:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const VERSION_PATTERN = /^(?:unknown|[vV]?[0-9][0-9A-Za-z.+_-]{0,63})$/u;
const MAX_IDENTITY_LIFETIME_MS = 10 * 60 * 1000;
const MAX_LAUNCHER_BYTES = 256 * 1024 * 1024;
const MAX_CLI_ENTRY_BYTES = 16 * 1024 * 1024;
const HASH_BUFFER_BYTES = 64 * 1024;
const TRUSTED_IDENTITIES = new WeakSet();
const PRIVATE_RUNTIME_PATHS = new WeakMap();

class BuilderCheckRuntimeIdentityError extends Error {
  constructor() {
    super('The local check runtime could not be verified.');
    this.name = 'BuilderCheckRuntimeIdentityError';
    this.code = 'builder_check_runtime_identity_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderCheckRuntimeIdentityError(); }

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
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return value;
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`,
    ).join(',')}}`;
  }
  fail();
}

function sha256Canonical(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeEnum(value, allowed) {
  if (typeof value !== 'string' || !allowed.includes(value)) fail();
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeAbsolutePath(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 1_024
    || value.trim() !== value
    || value.includes('\0')
    || !path.isAbsolute(value)
    || path.normalize(value) !== value
  ) fail();
  return value;
}

function assertNoPathLinks(filePath) {
  const resolved = path.resolve(filePath);
  const parsed = path.parse(resolved);
  const relative = path.relative(parsed.root, resolved);
  let current = parsed.root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let stats;
    try { stats = fs.lstatSync(current); } catch { fail(); }
    if (stats.isSymbolicLink()) fail();
  }
}

function fileIdentity(rawPath, maximumBytes) {
  const filePath = safeAbsolutePath(rawPath);
  let before;
  let realPath;
  let descriptor = null;
  try {
    before = fs.lstatSync(filePath);
    realPath = path.resolve(fs.realpathSync.native(filePath));
    assertNoPathLinks(filePath);
    if (
      !before.isFile()
      || before.isSymbolicLink()
      || before.size < 1
      || before.size > maximumBytes
    ) fail();
    descriptor = fs.openSync(realPath, 'r');
    const hash = nodeCrypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(HASH_BUFFER_BYTES);
    let offset = 0;
    while (offset < before.size) {
      const read = fs.readSync(
        descriptor,
        buffer,
        0,
        Math.min(buffer.length, before.size - offset),
        offset,
      );
      if (!Number.isSafeInteger(read) || read <= 0) fail();
      hash.update(buffer.subarray(0, read));
      offset += read;
    }
    const after = fs.fstatSync(descriptor);
    if (
      after.size !== before.size
      || after.mtimeMs !== before.mtimeMs
      || after.ctimeMs !== before.ctimeMs
    ) fail();
    return freezeDeep({
      real_path: realPath,
      digest: `sha256:${hash.digest('hex')}`,
    });
  } catch (error) {
    if (error instanceof BuilderCheckRuntimeIdentityError) throw error;
    fail();
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch { /* fixed failure is handled above */ }
    }
  }
}

function fixedObject(value, keys, expected) {
  exactObject(value, keys);
  for (const key of keys) if (valueAt(value, key) !== expected[key]) fail();
  return freezeDeep({ ...expected });
}

function identityBody(value) {
  const body = { ...value };
  delete body.runtime_identity_id;
  delete body.runtime_identity_digest;
  return body;
}

function sanitizeBuilderCheckRuntimeIdentity(rawValue) {
  try {
    const value = exactObject(rawValue, IDENTITY_KEYS);
    const packageManager = safeEnum(valueAt(value, 'package_manager'), PACKAGE_MANAGERS);
    const launcherKind = valueAt(value, 'launcher_kind');
    const cliEntryDigest = valueAt(value, 'cli_entry_digest');
    if (
      launcherKind !== (NODE_CLI_MANAGERS.has(packageManager) ? 'node_cli' : 'native_binary')
      || (launcherKind === 'node_cli' && !DIGEST_PATTERN.test(cliEntryDigest))
      || (launcherKind === 'native_binary' && cliEntryDigest !== null)
    ) fail();
    const normalized = {
      runtime_identity_version: valueAt(value, 'runtime_identity_version'),
      runtime_identity_id: safePattern(valueAt(value, 'runtime_identity_id'), ID_PATTERN),
      package_manager: packageManager,
      launcher_kind: launcherKind,
      launcher_binary_digest: safePattern(
        valueAt(value, 'launcher_binary_digest'),
        DIGEST_PATTERN,
      ),
      cli_entry_digest: cliEntryDigest,
      package_manager_version: safePattern(
        valueAt(value, 'package_manager_version'),
        VERSION_PATTERN,
      ),
      resolution_source: safeEnum(
        valueAt(value, 'resolution_source'),
        RESOLUTION_SOURCES,
      ),
      resolved_at_ms: safeTimestamp(valueAt(value, 'resolved_at_ms')),
      expires_at_ms: safeTimestamp(valueAt(value, 'expires_at_ms')),
      status: valueAt(value, 'status'),
      authority: fixedObject(valueAt(value, 'authority'), AUTHORITY_KEYS, AUTHORITY),
      runtime_identity_digest: safePattern(
        valueAt(value, 'runtime_identity_digest'),
        DIGEST_PATTERN,
      ),
    };
    if (
      normalized.runtime_identity_version !== BUILDER_CHECK_RUNTIME_IDENTITY_VERSION
      || normalized.status !== 'ready'
      || normalized.expires_at_ms <= normalized.resolved_at_ms
      || normalized.expires_at_ms - normalized.resolved_at_ms > MAX_IDENTITY_LIFETIME_MS
    ) fail();
    const expectedDigest = sha256Canonical(identityBody(normalized));
    if (
      normalized.runtime_identity_digest !== expectedDigest
      || normalized.runtime_identity_id !== `builder-check-runtime-identity:${expectedDigest.slice('sha256:'.length)}`
    ) fail();
    return freezeDeep(normalized);
  } catch (error) {
    if (error instanceof BuilderCheckRuntimeIdentityError) throw error;
    fail();
  }
}

function createBuilderCheckRuntimeRegistry() {
  return freezeDeep({
    registry_version: BUILDER_CHECK_RUNTIME_REGISTRY_VERSION,
    register_runtime(rawInput) {
      try {
        const input = exactObject(rawInput, REGISTER_KEYS);
        const packageManager = safeEnum(valueAt(input, 'package_manager'), PACKAGE_MANAGERS);
        const nodeCli = NODE_CLI_MANAGERS.has(packageManager);
        const launcher = fileIdentity(valueAt(input, 'launcher_path'), MAX_LAUNCHER_BYTES);
        const rawCliEntryPath = valueAt(input, 'cli_entry_path');
        const cliEntry = nodeCli
          ? fileIdentity(rawCliEntryPath, MAX_CLI_ENTRY_BYTES)
          : null;
        if ((!nodeCli && rawCliEntryPath !== null) || (nodeCli && rawCliEntryPath === null)) fail();
        const resolvedAtMs = safeTimestamp(valueAt(input, 'resolved_at_ms'));
        const expiresAtMs = safeTimestamp(valueAt(input, 'expires_at_ms'));
        if (
          expiresAtMs <= resolvedAtMs
          || expiresAtMs - resolvedAtMs > MAX_IDENTITY_LIFETIME_MS
        ) fail();
        const unsigned = freezeDeep({
          runtime_identity_version: BUILDER_CHECK_RUNTIME_IDENTITY_VERSION,
          package_manager: packageManager,
          launcher_kind: nodeCli ? 'node_cli' : 'native_binary',
          launcher_binary_digest: launcher.digest,
          cli_entry_digest: cliEntry?.digest ?? null,
          package_manager_version: safePattern(
            valueAt(input, 'package_manager_version'),
            VERSION_PATTERN,
          ),
          resolution_source: safeEnum(
            valueAt(input, 'resolution_source'),
            RESOLUTION_SOURCES,
          ),
          resolved_at_ms: resolvedAtMs,
          expires_at_ms: expiresAtMs,
          status: 'ready',
          authority: { ...AUTHORITY },
        });
        const digest = sha256Canonical(unsigned);
        const identity = freezeDeep({
          ...unsigned,
          runtime_identity_id: `builder-check-runtime-identity:${digest.slice('sha256:'.length)}`,
          runtime_identity_digest: digest,
        });
        TRUSTED_IDENTITIES.add(identity);
        PRIVATE_RUNTIME_PATHS.set(identity, freezeDeep({
          launcher_path: launcher.real_path,
          cli_entry_path: cliEntry?.real_path ?? null,
        }));
        return identity;
      } catch (error) {
        if (error instanceof BuilderCheckRuntimeIdentityError) throw error;
        fail();
      }
    },
    read_private_runtime(rawInput) {
      try {
        const input = exactObject(rawInput, READ_KEYS);
        const identity = valueAt(input, 'runtime_identity');
        if (!TRUSTED_IDENTITIES.has(identity)) fail();
        const normalized = sanitizeBuilderCheckRuntimeIdentity(identity);
        const readAtMs = safeTimestamp(valueAt(input, 'read_at_ms'));
        if (readAtMs < normalized.resolved_at_ms || readAtMs >= normalized.expires_at_ms) fail();
        const privatePaths = PRIVATE_RUNTIME_PATHS.get(identity);
        if (!privatePaths) fail();
        const launcher = fileIdentity(privatePaths.launcher_path, MAX_LAUNCHER_BYTES);
        const cliEntry = privatePaths.cli_entry_path === null
          ? null
          : fileIdentity(privatePaths.cli_entry_path, MAX_CLI_ENTRY_BYTES);
        if (
          launcher.digest !== normalized.launcher_binary_digest
          || (cliEntry?.digest ?? null) !== normalized.cli_entry_digest
        ) fail();
        return freezeDeep({
          runtime_handle_version: BUILDER_CHECK_RUNTIME_HANDLE_VERSION,
          runtime_identity: normalized,
          launcher_path: launcher.real_path,
          cli_entry_path: cliEntry?.real_path ?? null,
          authority: { ...HANDLE_AUTHORITY },
        });
      } catch (error) {
        if (error instanceof BuilderCheckRuntimeIdentityError) throw error;
        fail();
      }
    },
  });
}

module.exports = freezeDeep({
  BUILDER_CHECK_RUNTIME_HANDLE_VERSION,
  BUILDER_CHECK_RUNTIME_IDENTITY_VERSION,
  BUILDER_CHECK_RUNTIME_REGISTRY_VERSION,
  BuilderCheckRuntimeIdentityError,
  createBuilderCheckRuntimeRegistry,
  sanitizeBuilderCheckRuntimeIdentity,
});
