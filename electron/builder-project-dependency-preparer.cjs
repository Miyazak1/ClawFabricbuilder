'use strict';

const fs = require('node:fs');
const nodeCrypto = require('node:crypto');
const path = require('node:path');
const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderProjectEnvironmentDiagnosisResult,
} = require('./builder-project-environment-diagnosis.cjs');

const BUILDER_PROJECT_DEPENDENCY_PREPARER_VERSION =
  'builder-project-dependency-preparer.v1';
const BUILDER_PROJECT_DEPENDENCY_PREPARATION_RESULT_VERSION =
  'builder-project-dependency-preparation-result.v1';
const BUILDER_PROJECT_DEPENDENCY_PREPARATION_RECEIPT_VERSION =
  'builder-project-dependency-preparation-receipt.v1';
const PROJECT_WORKSPACE_PATH_SERVICE_VERSION = 'builder-project-workspace-path-service.v1';
const PREPARE_TIMEOUT_MS = 180_000;
const OUTPUT_LIMIT_BYTES = 64 * 1024;
const CREATE_KEYS = Object.freeze([
  'project_environment_diagnosis_service',
  'project_workspace_path_service',
  'spawn_process',
  'terminate_process_tree',
  'clock',
  'platform',
  'windows_root',
]);
const REQUEST_KEYS = Object.freeze(['project_id']);
const RESULT_KEYS = Object.freeze([
  'result_version',
  'service_version',
  'operation',
  'project_id',
  'preparation_receipt',
  'environment_diagnosis',
]);
const RECEIPT_KEYS = Object.freeze([
  'receipt_version',
  'project_id',
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
  'browser_preview_authority',
  'provider_dispatch',
  'harness_dispatch',
  'command_execution',
  'dependency_preparation',
  'project_workspace_write',
  'check_workspace_write',
  'git_write',
  'sqlite_write',
  'save_authority',
  'network_access',
  'install_authority',
  'raw_output',
  'path_disclosure',
  'environment_variable_disclosure',
  'secret_access',
]);
const AUTHORITY = Object.freeze({
  preparation_authority: 'main_owned_project_dependency_preparation_v1',
  workspace_authority: 'main_owned_bound_project_workspace_path',
  renderer_authority: 'project_id_only_explicit_user_action',
  browser_preview_authority: 'readiness_context_only_no_install_decision',
  provider_dispatch: false,
  harness_dispatch: false,
  command_execution: true,
  dependency_preparation: true,
  project_workspace_write: true,
  check_workspace_write: false,
  git_write: false,
  sqlite_write: false,
  save_authority: false,
  network_access: 'package_manager_default',
  install_authority: 'explicit_project_prepare_once',
  raw_output: 'digest_only',
  path_disclosure: 'not_serialized',
  environment_variable_disclosure: false,
  secret_access: 'not_present',
});
const PACKAGE_MANAGERS = Object.freeze(['npm', 'pnpm', 'yarn', 'bun']);
const STATUS_VALUES = Object.freeze([
  'prepared',
  'already_prepared',
  'not_needed',
  'unsupported',
  'failed',
  'timed_out',
]);
const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

class BuilderProjectDependencyPreparerError extends Error {
  constructor() {
    super('The project dependencies could not be prepared.');
    this.name = 'BuilderProjectDependencyPreparerError';
    this.code = 'builder_project_dependency_preparer_failed';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderProjectDependencyPreparerError(); }

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

function safeExitCode(value) {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0 || value > 255) fail();
  return value;
}

function safeDigest(value) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) fail();
  return value;
}

function safeOptionalAbsolutePath(value) {
  if (value === null) return null;
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

function serviceMethod(value, versionKey, expectedVersion, methodKey) {
  if (!isPlainObject(value)) fail();
  const version = Object.getOwnPropertyDescriptor(value, versionKey);
  const method = Object.getOwnPropertyDescriptor(value, methodKey);
  if (
    !version
    || !Object.hasOwn(version, 'value')
    || version.value !== expectedVersion
    || !method
    || !Object.hasOwn(method, 'value')
    || typeof method.value !== 'function'
    || utilTypes.isProxy(method.value)
  ) fail();
  return method.value.bind(value);
}

function functionValue(value) {
  if (typeof value !== 'function' || utilTypes.isProxy(value)) fail();
  return value;
}

function projectRootPathResult(rawValue, projectId) {
  const descriptors = exactObject(rawValue, [
    'result_version',
    'project_id',
    'project_root_path',
    'authority',
  ]);
  if (
    descriptors.result_version.value !== 'builder-project-workspace-path-result.v1'
    || descriptors.project_id.value !== projectId
    || descriptors.authority.value !== 'main_owned_bound_project_workspace_path'
  ) fail();
  return safeOptionalAbsolutePath(descriptors.project_root_path.value);
}

function installCommand(diagnosis, projectRootPath, platform, windowsRoot) {
  const manager = safeEnum(diagnosis.package_manager, PACKAGE_MANAGERS);
  const hasLockfile = diagnosis.lockfile !== 'none';
  let args;
  let display;
  if (manager === 'npm') {
    args = hasLockfile
      ? Object.freeze(['ci', '--ignore-scripts', '--no-audit', '--no-fund'])
      : Object.freeze(['install', '--ignore-scripts', '--no-audit', '--no-fund']);
    display = hasLockfile ? 'npm ci' : 'npm install';
  } else if (manager === 'pnpm') {
    args = hasLockfile
      ? Object.freeze(['install', '--frozen-lockfile', '--ignore-scripts'])
      : Object.freeze(['install', '--ignore-scripts']);
    display = 'pnpm install';
  } else if (manager === 'yarn') {
    args = hasLockfile
      ? Object.freeze(['install', '--frozen-lockfile', '--ignore-scripts'])
      : Object.freeze(['install', '--ignore-scripts']);
    display = 'yarn install';
  } else {
    args = hasLockfile
      ? Object.freeze(['install', '--frozen-lockfile', '--ignore-scripts'])
      : Object.freeze(['install', '--ignore-scripts']);
    display = 'bun install';
  }
  if (platform === 'win32') {
    return freezeDeep({
      file: path.join(windowsRoot, 'System32', 'cmd.exe'),
      args: ['/d', '/s', '/c', manager, ...args],
      display,
      cwd: projectRootPath,
    });
  }
  return freezeDeep({
    file: manager,
    args,
    display,
    cwd: projectRootPath,
  });
}

function installEnvironment(projectRootPath, platform, windowsRoot) {
  const env = {
    CI: '1',
    FORCE_COLOR: '0',
    HOME: projectRootPath,
    NO_COLOR: '1',
    NPM_CONFIG_UPDATE_NOTIFIER: 'false',
    PATH: typeof process.env.PATH === 'string' ? process.env.PATH : '',
    TEMP: projectRootPath,
    TMP: projectRootPath,
    USERPROFILE: projectRootPath,
  };
  if (platform === 'win32') {
    if (typeof process.env.PATHEXT === 'string') env.PATHEXT = process.env.PATHEXT;
    env.SystemRoot = windowsRoot;
    env.ComSpec = path.join(windowsRoot, 'System32', 'cmd.exe');
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
    receipt_version: BUILDER_PROJECT_DEPENDENCY_PREPARATION_RECEIPT_VERSION,
    project_id: safePattern(input.project_id, PROJECT_ID_PATTERN),
    package_manager: input.package_manager,
    install_command: input.install_command,
    status: safeEnum(input.status, STATUS_VALUES),
    exit_code: safeExitCode(input.exit_code),
    started_at_ms: safeTimestamp(input.started_at_ms),
    completed_at_ms: safeTimestamp(input.completed_at_ms),
    output_digest: safeDigest(input.output_digest),
    authority: { ...AUTHORITY },
  });
  if (
    unsigned.completed_at_ms < unsigned.started_at_ms
    || (unsigned.package_manager !== 'none' && !PACKAGE_MANAGERS.includes(unsigned.package_manager))
    || typeof unsigned.install_command !== 'string'
    || unsigned.install_command.length > 64
  ) fail();
  const digest = sha256Canonical(unsigned);
  return freezeDeep({ ...unsigned, receipt_digest: digest });
}

function createSyntheticReceipt(projectId, diagnosis, status, nowMs) {
  const packageManager = diagnosis.package_manager === 'none' ? 'none' : diagnosis.package_manager;
  return createReceipt({
    project_id: projectId,
    package_manager: packageManager,
    install_command: 'not_run',
    status,
    exit_code: null,
    started_at_ms: nowMs,
    completed_at_ms: nowMs,
    output_digest: sha256Canonical({ status, command: 'not_run' }),
  });
}

function runInstall(input) {
  const {
    command,
    projectId,
    diagnosis,
    spawnProcess,
    terminateProcessTree,
    nowMs,
    setTimer,
    clearTimer,
    platform,
    windowsRoot,
  } = input;
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
          project_id: projectId,
          package_manager: diagnosis.package_manager,
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
        Promise.resolve(terminateProcessTree({ child, reason: 'project_dependency_prepare_timed_out' }))
          .finally(() => settle('timed_out'));
      } catch {
        settle('timed_out');
      }
    }, PREPARE_TIMEOUT_MS);
    try {
      child = spawnProcess(command.file, command.args, {
        cwd: command.cwd,
        env: installEnvironment(command.cwd, platform, windowsRoot),
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      if (!trustedChild(child)) fail();
    } catch (error) {
      if (timer !== null) clearTimer(timer);
      reject(error instanceof BuilderProjectDependencyPreparerError
        ? error
        : new BuilderProjectDependencyPreparerError());
      return;
    }
    child.stdout.on('data', (chunk) => capture('stdout', chunk));
    child.stderr.on('data', (chunk) => capture('stderr', chunk));
    child.once('error', () => settle('failed'));
    child.once('close', (code, signal) => {
      if (signal !== null || code !== 0) settle('failed', Number.isSafeInteger(code) ? code : null);
      else settle('prepared', 0);
    });
  });
}

function createResult(projectId, receipt, diagnosisResult) {
  const sanitizedDiagnosis = sanitizeBuilderProjectEnvironmentDiagnosisResult(diagnosisResult);
  if (sanitizedDiagnosis.project_id !== projectId) fail();
  return freezeDeep({
    result_version: BUILDER_PROJECT_DEPENDENCY_PREPARATION_RESULT_VERSION,
    service_version: BUILDER_PROJECT_DEPENDENCY_PREPARER_VERSION,
    operation: 'project_dependencies_prepared',
    project_id: projectId,
    preparation_receipt: receipt,
    environment_diagnosis: sanitizedDiagnosis.environment_diagnosis,
  });
}

function createBuilderProjectDependencyPreparer(rawOptions) {
  const options = exactObject(rawOptions, CREATE_KEYS);
  const diagnoseProjectEnvironment = serviceMethod(
    options.project_environment_diagnosis_service.value,
    'service_version',
    'builder-project-environment-diagnosis-service.v1',
    'diagnose_project_environment',
  );
  const resolveProjectWorkspacePath = serviceMethod(
    options.project_workspace_path_service.value,
    'service_version',
    PROJECT_WORKSPACE_PATH_SERVICE_VERSION,
    'resolve_project_workspace_path',
  );
  const spawnProcess = functionValue(options.spawn_process.value);
  const terminateProcessTree = functionValue(options.terminate_process_tree.value);
  const clock = options.clock.value;
  const nowMs = serviceMethod(clock, 'clock_version', 'builder-clock.v1', 'now_ms');
  const setTimer = serviceMethod(clock, 'clock_version', 'builder-clock.v1', 'set_timeout');
  const clearTimer = serviceMethod(clock, 'clock_version', 'builder-clock.v1', 'clear_timeout');
  const platform = safeEnum(options.platform.value, ['win32', 'darwin', 'linux']);
  const windowsRoot = platform === 'win32' ? safeOptionalAbsolutePath(options.windows_root.value) : null;
  if (platform === 'win32' && windowsRoot === null) fail();

  return freezeDeep({
    preparer_version: BUILDER_PROJECT_DEPENDENCY_PREPARER_VERSION,
    async prepare_project_dependencies(rawRequest) {
      try {
        const request = exactObject(rawRequest, REQUEST_KEYS);
        const projectId = safePattern(request.project_id.value, PROJECT_ID_PATTERN);
        const initial = sanitizeBuilderProjectEnvironmentDiagnosisResult(
          await diagnoseProjectEnvironment({ project_id: projectId }),
        );
        const initialDiagnosis = initial.environment_diagnosis;
        if (initialDiagnosis.project_dependency_state === 'install_present') {
          const receipt = createSyntheticReceipt(projectId, initialDiagnosis, 'already_prepared', nowMs());
          return createResult(projectId, receipt, initial);
        }
        if (
          initialDiagnosis.package_manifest === 'absent'
          || initialDiagnosis.dependency_manifest === 'absent'
          || initialDiagnosis.package_manager === 'none'
        ) {
          const receipt = createSyntheticReceipt(projectId, initialDiagnosis, 'not_needed', nowMs());
          return createResult(projectId, receipt, initial);
        }
        if (
          initialDiagnosis.readiness_state !== 'project_dependencies_missing'
          || initialDiagnosis.project_dependency_state !== 'install_missing'
          || !PACKAGE_MANAGERS.includes(initialDiagnosis.package_manager)
        ) {
          const receipt = createSyntheticReceipt(projectId, initialDiagnosis, 'unsupported', nowMs());
          return createResult(projectId, receipt, initial);
        }
        const projectRootPath = projectRootPathResult(
          await resolveProjectWorkspacePath({ project_id: projectId }),
          projectId,
        );
        if (projectRootPath === null) {
          const receipt = createSyntheticReceipt(projectId, initialDiagnosis, 'unsupported', nowMs());
          return createResult(projectId, receipt, initial);
        }
        const rootStats = fs.lstatSync(projectRootPath);
        if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) fail();
        const command = installCommand(initialDiagnosis, projectRootPath, platform, windowsRoot);
        const receipt = await runInstall({
          command,
          projectId,
          diagnosis: initialDiagnosis,
          spawnProcess,
          terminateProcessTree,
          nowMs: nowMs.bind(clock),
          setTimer: setTimer.bind(clock),
          clearTimer: clearTimer.bind(clock),
          platform,
          windowsRoot,
        });
        const followup = sanitizeBuilderProjectEnvironmentDiagnosisResult(
          await diagnoseProjectEnvironment({ project_id: projectId }),
        );
        return createResult(projectId, receipt, followup);
      } catch (error) {
        if (error instanceof BuilderProjectDependencyPreparerError) throw error;
        fail();
      }
    },
  });
}

function sanitizeReceipt(rawValue) {
  const descriptors = exactObject(rawValue, RECEIPT_KEYS);
  const normalized = {
    receipt_version: descriptors.receipt_version.value,
    project_id: safePattern(descriptors.project_id.value, PROJECT_ID_PATTERN),
    package_manager: descriptors.package_manager.value,
    install_command: descriptors.install_command.value,
    status: safeEnum(descriptors.status.value, STATUS_VALUES),
    exit_code: safeExitCode(descriptors.exit_code.value),
    started_at_ms: safeTimestamp(descriptors.started_at_ms.value),
    completed_at_ms: safeTimestamp(descriptors.completed_at_ms.value),
    output_digest: safeDigest(descriptors.output_digest.value),
    authority: descriptors.authority.value,
    receipt_digest: safeDigest(descriptors.receipt_digest.value),
  };
  if (
    normalized.receipt_version !== BUILDER_PROJECT_DEPENDENCY_PREPARATION_RECEIPT_VERSION
    || normalized.completed_at_ms < normalized.started_at_ms
    || typeof normalized.package_manager !== 'string'
    || (normalized.package_manager !== 'none' && !PACKAGE_MANAGERS.includes(normalized.package_manager))
    || typeof normalized.install_command !== 'string'
    || normalized.receipt_digest !== sha256Canonical(receiptBody(normalized))
  ) fail();
  const authority = exactObject(normalized.authority, AUTHORITY_KEYS);
  for (const key of AUTHORITY_KEYS) {
    if (authority[key].value !== AUTHORITY[key]) fail();
  }
  return freezeDeep(normalized);
}

function sanitizeBuilderProjectDependencyPreparationResult(rawValue) {
  try {
    const descriptors = exactObject(rawValue, RESULT_KEYS);
    if (
      descriptors.result_version.value !== BUILDER_PROJECT_DEPENDENCY_PREPARATION_RESULT_VERSION
      || descriptors.service_version.value !== BUILDER_PROJECT_DEPENDENCY_PREPARER_VERSION
      || descriptors.operation.value !== 'project_dependencies_prepared'
      || typeof descriptors.project_id.value !== 'string'
      || !PROJECT_ID_PATTERN.test(descriptors.project_id.value)
    ) fail();
    const receipt = sanitizeReceipt(descriptors.preparation_receipt.value);
    const diagnosisResult = sanitizeBuilderProjectEnvironmentDiagnosisResult({
      result_version: 'builder-project-environment-diagnosis-result.v1',
      service_version: 'builder-project-environment-diagnosis-service.v1',
      operation: 'project_environment_diagnosed',
      project_id: descriptors.project_id.value,
      environment_diagnosis: descriptors.environment_diagnosis.value,
    });
    if (receipt.project_id !== descriptors.project_id.value) fail();
    return freezeDeep({
      result_version: BUILDER_PROJECT_DEPENDENCY_PREPARATION_RESULT_VERSION,
      service_version: BUILDER_PROJECT_DEPENDENCY_PREPARER_VERSION,
      operation: 'project_dependencies_prepared',
      project_id: descriptors.project_id.value,
      preparation_receipt: receipt,
      environment_diagnosis: diagnosisResult.environment_diagnosis,
    });
  } catch (error) {
    if (error instanceof BuilderProjectDependencyPreparerError) throw error;
    fail();
  }
}

module.exports = freezeDeep({
  BUILDER_PROJECT_DEPENDENCY_PREPARER_VERSION,
  BUILDER_PROJECT_DEPENDENCY_PREPARATION_RESULT_VERSION,
  BUILDER_PROJECT_DEPENDENCY_PREPARATION_RECEIPT_VERSION,
  BuilderProjectDependencyPreparerError,
  createBuilderProjectDependencyPreparer,
  sanitizeBuilderProjectDependencyPreparationResult,
});
