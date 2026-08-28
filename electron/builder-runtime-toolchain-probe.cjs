'use strict';

const nodeCrypto = require('node:crypto');
const path = require('node:path');
const { types: utilTypes } = require('node:util');

const BUILDER_RUNTIME_TOOLCHAIN_PROBE_SERVICE_VERSION =
  'builder-runtime-toolchain-probe-service.v1';
const BUILDER_RUNTIME_TOOLCHAIN_PROBE_VERSION =
  'builder-runtime-toolchain-probe.v1';
const BUILDER_RUNTIME_TOOLCHAIN_PROBE_DIGEST_PREFIX =
  'builder-runtime-toolchain-probe:';

const PROBE_TIMEOUT_MS = 5_000;
const OUTPUT_LIMIT_BYTES = 512;

const CREATE_KEYS = Object.freeze(['spawn_process', 'terminate_process_tree', 'clock']);
const PROBE_KEYS = Object.freeze(['package_manager']);
const PROBE_RESULT_KEYS = Object.freeze([
  'probe_version',
  'probe_id',
  'package_manager',
  'node_state',
  'package_manager_state',
  'node_version',
  'package_manager_version',
  'node_failure',
  'package_manager_failure',
  'policy',
  'authority',
  'probed_at_ms',
  'probe_digest',
]);
const POLICY_KEYS = Object.freeze([
  'node_probe',
  'package_manager_probe',
  'timeout_ms',
  'output_budget_bytes',
  'shell',
  'network_access',
  'install_execution',
  'raw_output_serialization',
]);
const AUTHORITY_KEYS = Object.freeze([
  'probe_authority',
  'renderer_authority',
  'provider_dispatch',
  'harness_dispatch',
  'path_disclosure',
  'environment_variable_disclosure',
  'secret_access',
  'source_read',
  'source_write',
  'git_write',
  'sqlite_write',
  'network_access',
  'install_authority',
]);
const PACKAGE_MANAGERS = Object.freeze(['npm', 'pnpm', 'yarn', 'bun', 'none']);
const PROBE_STATES = Object.freeze(['not_checked', 'visible', 'missing', 'unavailable']);
const FAILURES = Object.freeze([
  'none',
  'not_required',
  'spawn_failed',
  'timed_out',
  'nonzero_exit',
  'version_unreadable',
]);
const VERSION_PATTERN = /^(?:unknown|[vV]?[0-9][0-9A-Za-z.+_-]{0,63})$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const PROBE_ID_PATTERN = /^builder-runtime-toolchain-probe:[0-9a-f]{64}$/u;

const POLICY = Object.freeze({
  node_probe: 'required_for_node_package_managers',
  package_manager_probe: 'selected_package_manager_only',
  timeout_ms: PROBE_TIMEOUT_MS,
  output_budget_bytes: OUTPUT_LIMIT_BYTES,
  shell: false,
  network_access: false,
  install_execution: false,
  raw_output_serialization: false,
});
const AUTHORITY = Object.freeze({
  probe_authority: 'main_owned_bounded_toolchain_version_probe_v1',
  renderer_authority: 'not_present',
  provider_dispatch: false,
  harness_dispatch: false,
  path_disclosure: 'not_serialized',
  environment_variable_disclosure: false,
  secret_access: 'not_present',
  source_read: 'not_present',
  source_write: false,
  git_write: false,
  sqlite_write: false,
  network_access: false,
  install_authority: 'not_granted',
});

class BuilderRuntimeToolchainProbeError extends Error {
  constructor() {
    super('Builder runtime toolchain probe could not be verified.');
    this.name = 'BuilderRuntimeToolchainProbeError';
    this.code = 'builder_runtime_toolchain_probe_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderRuntimeToolchainProbeError();
}

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
  if (
    ownKeys.length !== keys.length
    || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return descriptors;
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
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
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

function safeEnum(value, allowed) {
  if (typeof value !== 'string' || !allowed.includes(value)) fail();
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeVersion(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 64 || !VERSION_PATTERN.test(value)) fail();
  return value;
}

function parseVersion(output) {
  if (typeof output !== 'string' || output.length > OUTPUT_LIMIT_BYTES * 2) return null;
  const normalized = output.replace(/\0/gu, '').trim();
  const match = /(?:^|\s)(v?[0-9][0-9A-Za-z.+_-]{0,63})(?:\s|$)/u.exec(normalized);
  if (!match) return null;
  try {
    return safeVersion(match[1]);
  } catch {
    return null;
  }
}

function probeCommandFor(name) {
  if (name === 'node' || PACKAGE_MANAGERS.includes(name)) return Object.freeze([name, ['--version']]);
  fail();
}

function probeEnvironment() {
  const env = {};
  if (typeof process.env.PATH === 'string') env.PATH = process.env.PATH;
  if (process.platform === 'win32') {
    if (typeof process.env.PATHEXT === 'string') env.PATHEXT = process.env.PATHEXT;
    if (typeof process.env.SystemRoot === 'string') {
      env.SystemRoot = process.env.SystemRoot;
      env.ComSpec = path.join(process.env.SystemRoot, 'System32', 'cmd.exe');
    }
  }
  return Object.freeze(env);
}

function classifySpawnError(error) {
  const code = error && typeof error === 'object' ? error.code : null;
  return code === 'ENOENT' || code === 'EACCES'
    ? Object.freeze({ state: 'missing', failure: 'spawn_failed', version: null })
    : Object.freeze({ state: 'unavailable', failure: 'spawn_failed', version: null });
}

async function runVersionProbe(name, tools) {
  const [file, args] = probeCommandFor(name);
  let child;
  let settled = false;
  let acceptedBytes = 0;
  const chunks = [];
  const settle = (resolve, result) => {
    if (settled) return;
    settled = true;
    resolve(freezeDeep(result));
  };

  return await new Promise((resolve) => {
    const timer = tools.setTimer(() => {
      try {
        if (child !== undefined) {
          Promise.resolve(tools.terminateProcessTree({ child, reason: 'toolchain_probe_timed_out' }))
            .finally(() => settle(resolve, {
              state: 'unavailable',
              failure: 'timed_out',
              version: null,
            }));
          return;
        }
      } catch {
        // Use the fixed timeout result even if process cleanup reporting fails.
      }
      settle(resolve, { state: 'unavailable', failure: 'timed_out', version: null });
    }, PROBE_TIMEOUT_MS);

    const clearTimer = () => {
      try { tools.clearTimer(timer); } catch { /* redacted fixed result below */ }
    };
    const capture = (chunk) => {
      if (settled) return;
      const bytes = Buffer.from(chunk);
      const remaining = Math.max(0, OUTPUT_LIMIT_BYTES - acceptedBytes);
      if (remaining > 0) {
        const selected = bytes.subarray(0, remaining);
        chunks.push(selected);
        acceptedBytes += selected.length;
      }
    };

    try {
      child = tools.spawnProcess(file, args, {
        env: probeEnvironment(),
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      if (
        child === null
        || typeof child !== 'object'
        || typeof child.once !== 'function'
        || !child.stdout
        || typeof child.stdout.on !== 'function'
        || !child.stderr
        || typeof child.stderr.on !== 'function'
      ) fail();
    } catch (error) {
      clearTimer();
      settle(resolve, classifySpawnError(error));
      return;
    }

    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.once('error', (error) => {
      clearTimer();
      settle(resolve, classifySpawnError(error));
    });
    child.once('close', (code, signal) => {
      clearTimer();
      if (settled) return;
      if (signal !== null || code !== 0) {
        settle(resolve, { state: 'unavailable', failure: 'nonzero_exit', version: null });
        return;
      }
      const version = parseVersion(Buffer.concat(chunks).toString('utf8'));
      settle(resolve, version === null
        ? { state: 'unavailable', failure: 'version_unreadable', version: null }
        : { state: 'visible', failure: 'none', version });
    });
  });
}

function policy() {
  return { ...POLICY };
}

function authority() {
  return { ...AUTHORITY };
}

function resultBody(value) {
  const body = { ...value };
  delete body.probe_id;
  delete body.probe_digest;
  return body;
}

function createProbeResult(input) {
  const unsigned = freezeDeep({
    probe_version: BUILDER_RUNTIME_TOOLCHAIN_PROBE_VERSION,
    package_manager: safeEnum(input.package_manager, PACKAGE_MANAGERS),
    node_state: safeEnum(input.node_state, PROBE_STATES),
    package_manager_state: safeEnum(input.package_manager_state, PROBE_STATES),
    node_version: safeVersion(input.node_version),
    package_manager_version: safeVersion(input.package_manager_version),
    node_failure: safeEnum(input.node_failure, FAILURES),
    package_manager_failure: safeEnum(input.package_manager_failure, FAILURES),
    policy: policy(),
    authority: authority(),
    probed_at_ms: safeTimestamp(input.probed_at_ms),
  });
  const digest = sha256Canonical(unsigned);
  return freezeDeep({
    ...unsigned,
    probe_id: `${BUILDER_RUNTIME_TOOLCHAIN_PROBE_DIGEST_PREFIX}${digest.slice('sha256:'.length)}`,
    probe_digest: digest,
  });
}

function createBuilderRuntimeToolchainProbe(rawOptions) {
  const options = exactObject(rawOptions, CREATE_KEYS);
  const spawnProcess = options.spawn_process.value;
  const terminateProcessTree = options.terminate_process_tree.value;
  const clock = options.clock.value;
  const nowMs = clock?.now_ms;
  const setTimer = clock?.set_timeout;
  const clearTimer = clock?.clear_timeout;
  if (
    typeof spawnProcess !== 'function'
    || typeof terminateProcessTree !== 'function'
    || typeof nowMs !== 'function'
    || typeof setTimer !== 'function'
    || typeof clearTimer !== 'function'
  ) fail();

  return freezeDeep({
    service_version: BUILDER_RUNTIME_TOOLCHAIN_PROBE_SERVICE_VERSION,
    async probe_package_manager(rawInput) {
      try {
        const input = exactObject(rawInput, PROBE_KEYS);
        const packageManager = safeEnum(input.package_manager.value, PACKAGE_MANAGERS);
        const probedAtMs = safeTimestamp(nowMs.call(clock));
        const tools = {
          spawnProcess: spawnProcess.bind(null),
          terminateProcessTree: terminateProcessTree.bind(null),
          setTimer: setTimer.bind(clock),
          clearTimer: clearTimer.bind(clock),
        };
        if (packageManager === 'none') {
          return createProbeResult({
            package_manager: packageManager,
            node_state: 'not_checked',
            package_manager_state: 'not_checked',
            node_version: null,
            package_manager_version: null,
            node_failure: 'not_required',
            package_manager_failure: 'not_required',
            probed_at_ms: probedAtMs,
          });
        }
        const nodeProbe = ['npm', 'pnpm', 'yarn'].includes(packageManager)
          ? await runVersionProbe('node', tools)
          : Object.freeze({ state: 'not_checked', failure: 'not_required', version: null });
        const managerProbe = await runVersionProbe(packageManager, tools);
        return createProbeResult({
          package_manager: packageManager,
          node_state: nodeProbe.state,
          package_manager_state: managerProbe.state,
          node_version: nodeProbe.version,
          package_manager_version: managerProbe.version,
          node_failure: nodeProbe.failure,
          package_manager_failure: managerProbe.failure,
          probed_at_ms: probedAtMs,
        });
      } catch (error) {
        if (error instanceof BuilderRuntimeToolchainProbeError) throw error;
        fail();
      }
    },
  });
}

function sanitizeFixedObject(value, keys, expected) {
  exactObject(value, keys);
  const selected = {};
  for (const key of keys) selected[key] = valueAt(value, key);
  if (canonicalJson(selected) !== canonicalJson(expected)) fail();
  return freezeDeep(selected);
}

function sanitizeBuilderRuntimeToolchainProbe(rawValue) {
  try {
    const value = exactObject(rawValue, PROBE_RESULT_KEYS);
    const normalized = {
      probe_version: value.probe_version.value,
      probe_id: value.probe_id.value,
      package_manager: safeEnum(value.package_manager.value, PACKAGE_MANAGERS),
      node_state: safeEnum(value.node_state.value, PROBE_STATES),
      package_manager_state: safeEnum(value.package_manager_state.value, PROBE_STATES),
      node_version: safeVersion(value.node_version.value),
      package_manager_version: safeVersion(value.package_manager_version.value),
      node_failure: safeEnum(value.node_failure.value, FAILURES),
      package_manager_failure: safeEnum(value.package_manager_failure.value, FAILURES),
      policy: sanitizeFixedObject(value.policy.value, POLICY_KEYS, POLICY),
      authority: sanitizeFixedObject(value.authority.value, AUTHORITY_KEYS, AUTHORITY),
      probed_at_ms: safeTimestamp(value.probed_at_ms.value),
      probe_digest: value.probe_digest.value,
    };
    if (
      normalized.probe_version !== BUILDER_RUNTIME_TOOLCHAIN_PROBE_VERSION
      || typeof normalized.probe_id !== 'string'
      || !PROBE_ID_PATTERN.test(normalized.probe_id)
      || typeof normalized.probe_digest !== 'string'
      || !DIGEST_PATTERN.test(normalized.probe_digest)
      || (normalized.node_state === 'visible') !== (normalized.node_version !== null)
      || (normalized.package_manager_state === 'visible')
        !== (normalized.package_manager_version !== null)
    ) fail();
    const expectedDigest = sha256Canonical(resultBody(normalized));
    if (
      normalized.probe_digest !== expectedDigest
      || normalized.probe_id !== `${BUILDER_RUNTIME_TOOLCHAIN_PROBE_DIGEST_PREFIX}${expectedDigest.slice('sha256:'.length)}`
    ) fail();
    return freezeDeep(normalized);
  } catch (error) {
    if (error instanceof BuilderRuntimeToolchainProbeError) throw error;
    fail();
  }
}

function safeBoundary(fn) {
  return (...args) => {
    try {
      return fn(...args);
    } catch (error) {
      if (error instanceof BuilderRuntimeToolchainProbeError) throw error;
      fail();
    }
  };
}

module.exports = freezeDeep({
  BUILDER_RUNTIME_TOOLCHAIN_PROBE_DIGEST_PREFIX,
  BUILDER_RUNTIME_TOOLCHAIN_PROBE_SERVICE_VERSION,
  BUILDER_RUNTIME_TOOLCHAIN_PROBE_VERSION,
  BuilderRuntimeToolchainProbeError,
  createBuilderRuntimeToolchainProbe: safeBoundary(createBuilderRuntimeToolchainProbe),
  sanitizeBuilderRuntimeToolchainProbe: safeBoundary(sanitizeBuilderRuntimeToolchainProbe),
});
