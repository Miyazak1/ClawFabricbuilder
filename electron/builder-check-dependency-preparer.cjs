'use strict';

const fs = require('node:fs');
const nodeCrypto = require('node:crypto');
const path = require('node:path');
const { types: utilTypes } = require('node:util');

const { sanitizeBuilderCheckRunAdmission } = require('./builder-check-run-admission.cjs');

const BUILDER_CHECK_DEPENDENCY_PREPARER_VERSION =
  'builder-check-dependency-preparer.v1';
const BUILDER_CHECK_DEPENDENCY_PREPARATION_RECEIPT_VERSION =
  'builder-check-dependency-preparation-receipt.v1';
const PREPARE_TIMEOUT_MS = 180_000;
const OUTPUT_LIMIT_BYTES = 64 * 1024;
const CREATE_KEYS = Object.freeze([
  'spawn_process',
  'terminate_process_tree',
  'workspace_materializer',
  'clock',
]);
const PREPARE_KEYS = Object.freeze([
  'check_run_admission',
  'workspace_admission',
  'package_manager',
]);
const PACKAGE_MANAGERS = Object.freeze(['npm']);
const RECEIPT_KEYS = Object.freeze([
  'receipt_version',
  'project_id',
  'candidate_id',
  'package_manager',
  'install_command',
  'status',
  'exit_code',
  'started_at_ms',
  'completed_at_ms',
  'output_digest',
  'authority',
  'receipt_digest',
]);
const AUTHORITY_KEYS = Object.freeze([
  'preparation_authority',
  'workspace_authority',
  'renderer_authority',
  'provider_dispatch',
  'harness_dispatch',
  'project_workspace_write',
  'check_workspace_write',
  'git_write',
  'sqlite_write',
  'network_access',
  'install_authority',
  'raw_output',
  'path_disclosure',
]);
const AUTHORITY = Object.freeze({
  preparation_authority: 'main_owned_dependency_preparation_v1',
  workspace_authority: 'trusted_candidate_check_workspace',
  renderer_authority: 'not_present',
  provider_dispatch: false,
  harness_dispatch: false,
  project_workspace_write: false,
  check_workspace_write: true,
  git_write: false,
  sqlite_write: false,
  network_access: 'package_manager_default',
  install_authority: 'explicit_allow_once',
  raw_output: 'digest_only',
  path_disclosure: 'not_serialized',
});
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

class BuilderCheckDependencyPreparerError extends Error {
  constructor() {
    super('The project check dependencies could not be prepared.');
    this.name = 'BuilderCheckDependencyPreparerError';
    this.code = 'builder_check_dependency_preparer_failed';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderCheckDependencyPreparerError(); }

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

function safeExitCode(value) {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0 || value > 255) fail();
  return value;
}

function safeDigest(value) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) fail();
  return value;
}

function methodValue(value, key) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) fail();
  const method = value[key];
  if (typeof method !== 'function' || utilTypes.isProxy(method)) fail();
  return method.bind(value);
}

function functionValue(value) {
  if (typeof value !== 'function' || utilTypes.isProxy(value)) fail();
  return value;
}

function installCommand(packageManager, workspacePath) {
  if (packageManager !== 'npm') fail();
  const hasLockfile = fs.existsSync(path.join(workspacePath, 'package-lock.json'));
  const npmArgs = hasLockfile
    ? Object.freeze(['ci', '--ignore-scripts', '--no-audit', '--no-fund'])
    : Object.freeze(['install', '--ignore-scripts', '--no-audit', '--no-fund']);
  if (process.platform === 'win32') {
    const systemRoot = typeof process.env.SystemRoot === 'string'
      ? process.env.SystemRoot
      : 'C:\\Windows';
    return Object.freeze({
      file: typeof process.env.ComSpec === 'string'
        ? process.env.ComSpec
        : path.join(systemRoot, 'System32', 'cmd.exe'),
      args: Object.freeze(['/d', '/s', '/c', 'npm', ...npmArgs]),
      display: hasLockfile ? 'npm ci' : 'npm install',
    });
  }
  return Object.freeze({
    file: 'npm',
    args: npmArgs,
    display: hasLockfile ? 'npm ci' : 'npm install',
  });
}

function installEnvironment(workspacePath) {
  const env = {
    CI: '1',
    FORCE_COLOR: '0',
    HOME: workspacePath,
    NO_COLOR: '1',
    NPM_CONFIG_UPDATE_NOTIFIER: 'false',
    npm_config_cache: path.join(workspacePath, '.npm-cache'),
    PATH: typeof process.env.PATH === 'string' ? process.env.PATH : '',
    TEMP: workspacePath,
    TMP: workspacePath,
    USERPROFILE: workspacePath,
  };
  if (process.platform === 'win32') {
    if (typeof process.env.PATHEXT === 'string') env.PATHEXT = process.env.PATHEXT;
    if (typeof process.env.SystemRoot === 'string') {
      env.SystemRoot = process.env.SystemRoot;
      env.ComSpec = path.join(process.env.SystemRoot, 'System32', 'cmd.exe');
    }
  }
  return freezeDeep(env);
}

function trustedChild(value) {
  return value !== null
    && typeof value === 'object'
    && !utilTypes.isProxy(value)
    && typeof value.once === 'function'
    && value.stdout !== null
    && typeof value.stdout === 'object'
    && typeof value.stdout.on === 'function'
    && value.stderr !== null
    && typeof value.stderr === 'object'
    && typeof value.stderr.on === 'function';
}

function outputDigest(stdoutHash, stderrHash, accepted) {
  return sha256Canonical({
    stdout_sha256: `sha256:${stdoutHash.digest('hex')}`,
    stderr_sha256: `sha256:${stderrHash.digest('hex')}`,
    stdout_bytes: accepted.stdout,
    stderr_bytes: accepted.stderr,
  });
}

function receiptBody(value) {
  const body = { ...value };
  delete body.receipt_digest;
  return body;
}

function createReceipt(input) {
  const unsigned = freezeDeep({
    receipt_version: BUILDER_CHECK_DEPENDENCY_PREPARATION_RECEIPT_VERSION,
    project_id: input.project_id,
    candidate_id: input.candidate_id,
    package_manager: safeEnum(input.package_manager, PACKAGE_MANAGERS),
    install_command: input.install_command,
    status: safeEnum(input.status, ['prepared', 'failed', 'timed_out']),
    exit_code: safeExitCode(input.exit_code),
    started_at_ms: safeTimestamp(input.started_at_ms),
    completed_at_ms: safeTimestamp(input.completed_at_ms),
    output_digest: safeDigest(input.output_digest),
    authority: { ...AUTHORITY },
  });
  if (unsigned.completed_at_ms < unsigned.started_at_ms) fail();
  const receiptDigest = sha256Canonical(unsigned);
  return freezeDeep({ ...unsigned, receipt_digest: receiptDigest });
}

function createBuilderCheckDependencyPreparer(rawOptions) {
  const options = exactObject(rawOptions, CREATE_KEYS);
  const spawnProcess = functionValue(options.spawn_process.value);
  const terminateProcessTree = functionValue(options.terminate_process_tree.value);
  const materializer = options.workspace_materializer.value;
  const readWorkspacePath = methodValue(materializer, 'read_workspace_path');
  const recordPreparedDependencies = typeof materializer.record_prepared_dependencies === 'function'
    ? materializer.record_prepared_dependencies.bind(materializer)
    : null;
  const clock = options.clock.value;
  const nowMs = methodValue(clock, 'now_ms');
  const setTimer = methodValue(clock, 'set_timeout');
  const clearTimer = methodValue(clock, 'clear_timeout');

  return freezeDeep({
    preparer_version: BUILDER_CHECK_DEPENDENCY_PREPARER_VERSION,
    prepare_dependencies(rawInput) {
      try {
        const input = exactObject(rawInput, PREPARE_KEYS);
        const admission = sanitizeBuilderCheckRunAdmission(input.check_run_admission.value);
        const packageManager = safeEnum(input.package_manager.value, PACKAGE_MANAGERS);
        if (packageManager !== admission.package_manager) fail();
        const workspacePath = readWorkspacePath(input.workspace_admission.value);
        const command = installCommand(packageManager, workspacePath);
        const startedAtMs = safeTimestamp(nowMs());
        const stdoutHash = nodeCrypto.createHash('sha256');
        const stderrHash = nodeCrypto.createHash('sha256');
        const accepted = { stdout: 0, stderr: 0 };

        return new Promise((resolve, reject) => {
          let child;
          let timer = null;
          let settled = false;
          const settle = (status, exitCode = null) => {
            if (settled) return;
            settled = true;
            if (timer !== null) clearTimer(timer);
            try {
              resolve(createReceipt({
                project_id: admission.project_id,
                candidate_id: admission.candidate_id,
                package_manager: packageManager,
                install_command: command.display,
                status,
                exit_code: exitCode,
                started_at_ms: startedAtMs,
                completed_at_ms: safeTimestamp(nowMs()),
                output_digest: outputDigest(stdoutHash, stderrHash, accepted),
              }));
            } catch (error) {
              reject(error);
            }
          };
          const capture = (stream, chunk) => {
            if (settled) return;
            const buffer = Buffer.from(chunk);
            const remaining = Math.max(0, OUTPUT_LIMIT_BYTES - accepted[stream]);
            if (remaining <= 0) return;
            const selected = buffer.subarray(0, remaining);
            accepted[stream] += selected.length;
            if (stream === 'stdout') stdoutHash.update(selected);
            else stderrHash.update(selected);
          };
          timer = setTimer(() => {
            try {
              Promise.resolve(terminateProcessTree({ child, reason: 'dependency_prepare_timed_out' }))
                .finally(() => settle('timed_out'));
            } catch {
              settle('timed_out');
            }
          }, PREPARE_TIMEOUT_MS);
          try {
            child = spawnProcess(command.file, command.args, {
              cwd: workspacePath,
              env: installEnvironment(workspacePath),
              shell: false,
              stdio: ['ignore', 'pipe', 'pipe'],
              windowsHide: true,
            });
            if (!trustedChild(child)) fail();
          } catch (error) {
            if (timer !== null) clearTimer(timer);
            reject(error instanceof BuilderCheckDependencyPreparerError ? error : new BuilderCheckDependencyPreparerError());
            return;
          }
          child.stdout.on('data', (chunk) => capture('stdout', chunk));
          child.stderr.on('data', (chunk) => capture('stderr', chunk));
          child.once('error', () => settle('failed'));
          child.once('close', (code, signal) => {
            if (signal !== null || code !== 0) settle('failed', Number.isSafeInteger(code) ? code : null);
            else if (recordPreparedDependencies === null) settle('prepared', 0);
            else {
              Promise.resolve()
                .then(() => recordPreparedDependencies(input.workspace_admission.value))
                .catch(() => {})
                .finally(() => settle('prepared', 0));
            }
          });
        });
      } catch (error) {
        if (error instanceof BuilderCheckDependencyPreparerError) throw error;
        fail();
      }
    },
  });
}

function sanitizeBuilderCheckDependencyPreparationReceipt(rawValue) {
  try {
    const value = exactObject(rawValue, RECEIPT_KEYS);
    const normalized = {
      receipt_version: value.receipt_version.value,
      project_id: value.project_id.value,
      candidate_id: value.candidate_id.value,
      package_manager: safeEnum(value.package_manager.value, PACKAGE_MANAGERS),
      install_command: value.install_command.value,
      status: safeEnum(value.status.value, ['prepared', 'failed', 'timed_out']),
      exit_code: safeExitCode(value.exit_code.value),
      started_at_ms: safeTimestamp(value.started_at_ms.value),
      completed_at_ms: safeTimestamp(value.completed_at_ms.value),
      output_digest: safeDigest(value.output_digest.value),
      authority: value.authority.value,
      receipt_digest: safeDigest(value.receipt_digest.value),
    };
    const authority = exactObject(normalized.authority, AUTHORITY_KEYS);
    for (const key of AUTHORITY_KEYS) {
      if (authority[key].value !== AUTHORITY[key]) fail();
    }
    if (
      normalized.receipt_version !== BUILDER_CHECK_DEPENDENCY_PREPARATION_RECEIPT_VERSION
      || typeof normalized.project_id !== 'string'
      || typeof normalized.candidate_id !== 'string'
      || !['npm ci', 'npm install'].includes(normalized.install_command)
      || normalized.receipt_digest !== sha256Canonical(receiptBody(normalized))
    ) fail();
    return freezeDeep(normalized);
  } catch (error) {
    if (error instanceof BuilderCheckDependencyPreparerError) throw error;
    fail();
  }
}

module.exports = freezeDeep({
  BUILDER_CHECK_DEPENDENCY_PREPARER_VERSION,
  BUILDER_CHECK_DEPENDENCY_PREPARATION_RECEIPT_VERSION,
  BuilderCheckDependencyPreparerError,
  createBuilderCheckDependencyPreparer,
  sanitizeBuilderCheckDependencyPreparationReceipt,
});
