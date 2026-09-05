'use strict';

const fs = require('node:fs');
const nodeCrypto = require('node:crypto');
const path = require('node:path');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_PROJECT_READ_AUTHORITY_VERSION,
} = require('./builder-project-read-authority.cjs');
const {
  sanitizeBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');

const BUILDER_PROJECT_ENVIRONMENT_DIAGNOSIS_SERVICE_VERSION =
  'builder-project-environment-diagnosis-service.v1';
const BUILDER_PROJECT_ENVIRONMENT_DIAGNOSIS_VERSION =
  'builder-project-environment-diagnosis.v1';
const BUILDER_PROJECT_ENVIRONMENT_DIAGNOSIS_RESULT_VERSION =
  'builder-project-environment-diagnosis-result.v1';
const BUILDER_PROJECT_ENVIRONMENT_DIAGNOSIS_DIGEST_PREFIX =
  'builder-project-environment-diagnosis:';
const PROJECT_WORKSPACE_PATH_SERVICE_VERSION = 'builder-project-workspace-path-service.v1';
const PROBE_TIMEOUT_MS = 5_000;
const OUTPUT_LIMIT_BYTES = 512;

const CREATE_KEYS = Object.freeze([
  'project_read_authority',
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
  'environment_diagnosis',
]);
const DIAGNOSIS_KEYS = Object.freeze([
  'diagnosis_version',
  'diagnosis_id',
  'project_id',
  'source_tree_digest',
  'package_manager',
  'package_manifest',
  'dependency_manifest',
  'lockfile',
  'project_dependency_state',
  'toolchains',
  'readiness_state',
  'primary_action',
  'safe_summary',
  'authority',
  'diagnosed_at_ms',
  'diagnosis_digest',
]);
const TOOLCHAIN_KEYS = Object.freeze(['state', 'version']);
const TOOLCHAIN_NAMES = Object.freeze(['node', 'npm', 'pnpm', 'yarn', 'git']);
const AUTHORITY_KEYS = Object.freeze([
  'diagnosis_authority',
  'source_authority',
  'toolchain_probe_authority',
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
  'path_disclosure',
  'environment_variable_disclosure',
  'raw_output',
  'secret_access',
  'network_access',
]);
const PACKAGE_MANAGERS = Object.freeze(['npm', 'pnpm', 'yarn', 'bun', 'none']);
const LOCKFILES = Object.freeze([
  'none',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
]);
const MANIFEST_STATES = Object.freeze(['absent', 'present', 'unreadable']);
const PROJECT_DEPENDENCY_STATES = Object.freeze([
  'not_applicable',
  'not_admitted',
  'install_present',
  'install_missing',
  'unavailable',
]);
const TOOLCHAIN_STATES = Object.freeze(['visible', 'missing', 'unavailable']);
const READINESS_STATES = Object.freeze([
  'ready',
  'host_toolchain_missing',
  'project_dependencies_missing',
  'unknown',
]);
const PRIMARY_ACTIONS = Object.freeze([
  'none',
  'show_missing_toolchain',
  'show_project_dependency_setup',
  'show_diagnostics',
]);
const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const DIAGNOSIS_ID_PATTERN = /^builder-project-environment-diagnosis:[0-9a-f]{64}$/u;
const VERSION_PATTERN = /^(?:unknown|[vV]?[0-9][0-9A-Za-z.+_-]{0,63})$/u;

const AUTHORITY = Object.freeze({
  diagnosis_authority: 'main_owned_read_only_project_environment_diagnosis_v1',
  source_authority: 'main_owned_current_project_source_tree',
  toolchain_probe_authority: 'main_owned_bounded_toolchain_version_probe_v1',
  renderer_authority: 'redacted_projection_only',
  browser_preview_authority: 'readiness_context_only_no_install_decision',
  provider_dispatch: false,
  harness_dispatch: false,
  command_execution: false,
  dependency_preparation: false,
  project_workspace_write: false,
  check_workspace_write: false,
  git_write: false,
  sqlite_write: false,
  save_authority: false,
  path_disclosure: 'not_serialized',
  environment_variable_disclosure: false,
  raw_output: 'not_present',
  secret_access: 'not_present',
  network_access: false,
});
const SAFE_SUMMARIES = Object.freeze({
  ready: 'The project environment appears ready.',
  host_toolchain_missing:
    'Builder cannot see the local toolchain required by this project.',
  project_dependencies_missing:
    'This project declares dependencies, but the project folder does not have installed dependencies.',
  unknown:
    'Builder could not determine whether this project environment is ready.',
});

class BuilderProjectEnvironmentDiagnosisError extends Error {
  constructor() {
    super('Builder project environment diagnosis could not be verified.');
    this.name = 'BuilderProjectEnvironmentDiagnosisError';
    this.code = 'builder_project_environment_diagnosis_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderProjectEnvironmentDiagnosisError(); }

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

function safeVersion(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || !VERSION_PATTERN.test(value)) fail();
  return value;
}

function ownMethod(value, key) {
  if (!isPlainObject(value)) fail();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') fail();
  return descriptor.value.bind(value);
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
  ) fail();
  return method.value.bind(value);
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

function fileMap(sourceTree) {
  return new Map(sourceTree.files.map((file) => [file.path, file]));
}

function packageManifest(files) {
  const manifest = files.get('package.json');
  if (!manifest) return 'absent';
  try {
    return isPlainObject(JSON.parse(manifest.content)) ? 'present' : 'unreadable';
  } catch {
    return 'unreadable';
  }
}

function packageJson(files) {
  const manifest = files.get('package.json');
  if (!manifest) return null;
  try {
    const parsed = JSON.parse(manifest.content);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function dependencyManifest(files) {
  const parsed = packageJson(files);
  if (parsed === null) return files.has('package.json') ? 'unreadable' : 'absent';
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const dependencies = parsed[field];
    if (dependencies === undefined) continue;
    if (!isPlainObject(dependencies) || utilTypes.isProxy(dependencies)) return 'unreadable';
    if (Object.keys(dependencies).length > 0) return 'present';
  }
  return 'absent';
}

function lockfile(files) {
  for (const selected of LOCKFILES) {
    if (selected !== 'none' && files.has(selected)) return selected;
  }
  return 'none';
}

function packageManager(files) {
  const selectedLockfile = lockfile(files);
  if (selectedLockfile === 'pnpm-lock.yaml') return 'pnpm';
  if (selectedLockfile === 'yarn.lock') return 'yarn';
  if (selectedLockfile === 'bun.lock' || selectedLockfile === 'bun.lockb') return 'bun';
  if (selectedLockfile === 'package-lock.json') return 'npm';
  const parsed = packageJson(files);
  const declared = typeof parsed?.packageManager === 'string' ? parsed.packageManager : '';
  if (declared.startsWith('pnpm@')) return 'pnpm';
  if (declared.startsWith('yarn@')) return 'yarn';
  if (declared.startsWith('bun@')) return 'bun';
  if (declared.startsWith('npm@')) return 'npm';
  return files.has('package.json') ? 'npm' : 'none';
}

function checkedDirectoryState(rootPath, hasNodeManifest) {
  if (!hasNodeManifest) return 'not_applicable';
  if (rootPath === null) return 'not_admitted';
  try {
    const stats = fs.lstatSync(rootPath);
    if (!stats.isDirectory() || stats.isSymbolicLink()) return 'unavailable';
    const moduleStats = fs.lstatSync(path.join(rootPath, 'node_modules'));
    return moduleStats.isDirectory() && !moduleStats.isSymbolicLink()
      ? 'install_present'
      : 'install_missing';
  } catch (error) {
    if (error && error.code === 'ENOENT') return 'install_missing';
    return 'unavailable';
  }
}

function parseVersion(output) {
  if (typeof output !== 'string' || output.length > OUTPUT_LIMIT_BYTES * 2) return null;
  const normalized = output.replace(/\0/gu, '').trim();
  const match = /(?:^|\s)(v?[0-9][0-9A-Za-z.+_-]{0,63})(?:\s|$)/u.exec(normalized);
  return match ? match[1] : null;
}

function probeEnv() {
  const env = {};
  if (typeof process.env.PATH === 'string') env.PATH = process.env.PATH;
  if (typeof process.env.Path === 'string') env.Path = process.env.Path;
  if (process.platform === 'win32') {
    if (typeof process.env.PATHEXT === 'string') env.PATHEXT = process.env.PATHEXT;
    if (typeof process.env.SystemRoot === 'string') {
      env.SystemRoot = process.env.SystemRoot;
      env.ComSpec = path.join(process.env.SystemRoot, 'System32', 'cmd.exe');
    }
  }
  return Object.freeze(env);
}

function windowsCommand(name, args, windowsRoot) {
  if (process.platform !== 'win32' || name === 'node' || name === 'git') {
    return Object.freeze({ file: name, args });
  }
  return Object.freeze({
    file: path.join(windowsRoot, 'System32', 'cmd.exe'),
    args: ['/d', '/s', '/c', `${name} ${args.join(' ')}`],
  });
}

async function runVersionProbe(name, options) {
  let child;
  let settled = false;
  let acceptedBytes = 0;
  const chunks = [];
  return await new Promise((resolve) => {
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(freezeDeep(result));
    };
    const timer = options.setTimer(() => {
      try {
        if (child !== undefined) {
          Promise.resolve(options.terminateProcessTree({ child, reason: 'project_environment_probe_timed_out' }))
            .finally(() => finish({ state: 'unavailable', version: null }));
          return;
        }
      } catch {
        // The fixed unavailable result below is sufficient.
      }
      finish({ state: 'unavailable', version: null });
    }, PROBE_TIMEOUT_MS);
    const clearTimer = () => {
      try { options.clearTimer(timer); } catch { /* fixed result below */ }
    };
    const capture = (chunk) => {
      if (settled) return;
      const bytes = Buffer.from(chunk);
      const remaining = Math.max(0, OUTPUT_LIMIT_BYTES - acceptedBytes);
      if (remaining <= 0) return;
      chunks.push(bytes.subarray(0, remaining));
      acceptedBytes += Math.min(bytes.length, remaining);
    };
    try {
      const command = windowsCommand(name, ['--version'], options.windowsRoot);
      child = options.spawnProcess(command.file, command.args, {
        env: probeEnv(),
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
      const code = error && typeof error === 'object' ? error.code : null;
      finish({ state: code === 'ENOENT' || code === 'EACCES' ? 'missing' : 'unavailable', version: null });
      return;
    }
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.once('error', (error) => {
      clearTimer();
      const code = error && typeof error === 'object' ? error.code : null;
      finish({ state: code === 'ENOENT' || code === 'EACCES' ? 'missing' : 'unavailable', version: null });
    });
    child.once('close', (code, signal) => {
      clearTimer();
      if (settled) return;
      const version = signal === null && code === 0
        ? parseVersion(Buffer.concat(chunks).toString('utf8'))
        : null;
      finish(version === null
        ? { state: 'unavailable', version: null }
        : { state: 'visible', version });
    });
  });
}

function projectReadResult(rawValue, projectId) {
  const envelope = exactObject(rawValue, Reflect.ownKeys(rawValue));
  const resultVersion = envelope.result_version?.value;
  const operation = envelope.operation?.value;
  if (resultVersion === 'builder-project-read-result.v1' && operation === 'current_loaded') {
    const descriptors = exactObject(rawValue, [
      'result_version',
      'product_revision_receipt',
      'current',
      'source_tree',
      'git_candidate_receipt',
      'git_verification_receipt',
      'authority_evidence',
      'operation',
    ]);
    const receipt = exactObject(
      descriptors.product_revision_receipt.value,
      Reflect.ownKeys(descriptors.product_revision_receipt.value),
    );
    const sourceTree = sanitizeBuilderProjectSourceTree(descriptors.source_tree.value);
    if (
      !Object.hasOwn(receipt, 'project_id')
      || !Object.hasOwn(receipt, 'resulting_tree_digest')
      || receipt.project_id.value !== projectId
      || sourceTree.source_tree_digest !== receipt.resulting_tree_digest.value
    ) fail();
    return freezeDeep({ source_tree: sourceTree });
  }
  if (
    resultVersion === 'builder-project-local-workspace-read-result.v1'
    && operation === 'local_workspace_loaded'
  ) {
    const descriptors = exactObject(rawValue, [
      'result_version',
      'operation',
      'project_id',
      'source_tree',
      'authority_evidence',
    ]);
    if (descriptors.project_id.value !== projectId) fail();
    return freezeDeep({
      source_tree: sanitizeBuilderProjectSourceTree(descriptors.source_tree.value),
    });
  }
  fail();
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

function readinessState(facts) {
  if (facts.package_manifest === 'unreadable' || facts.dependency_manifest === 'unreadable') {
    return 'unknown';
  }
  if (facts.package_manifest === 'absent' || facts.dependency_manifest === 'absent') {
    return facts.toolchains.git.state === 'visible' ? 'ready' : 'host_toolchain_missing';
  }
  const managerReady = facts.package_manager === 'none'
    || facts.toolchains[facts.package_manager]?.state === 'visible';
  const nodeReady = ['npm', 'pnpm', 'yarn'].includes(facts.package_manager)
    ? facts.toolchains.node.state === 'visible'
    : true;
  if (!managerReady || !nodeReady || facts.toolchains.git.state !== 'visible') {
    return 'host_toolchain_missing';
  }
  if (facts.project_dependency_state === 'install_missing') {
    return 'project_dependencies_missing';
  }
  if (facts.project_dependency_state === 'install_present' || facts.project_dependency_state === 'not_applicable') {
    return 'ready';
  }
  return 'unknown';
}

function primaryAction(state) {
  if (state === 'ready') return 'none';
  if (state === 'host_toolchain_missing') return 'show_missing_toolchain';
  if (state === 'project_dependencies_missing') return 'show_project_dependency_setup';
  return 'show_diagnostics';
}

function authority() {
  return { ...AUTHORITY };
}

function diagnosisBody(value) {
  const body = { ...value };
  delete body.diagnosis_id;
  delete body.diagnosis_digest;
  return body;
}

function createDiagnosis(input) {
  const state = readinessState(input);
  const unsigned = freezeDeep({
    diagnosis_version: BUILDER_PROJECT_ENVIRONMENT_DIAGNOSIS_VERSION,
    project_id: input.project_id,
    source_tree_digest: input.source_tree_digest,
    package_manager: input.package_manager,
    package_manifest: input.package_manifest,
    dependency_manifest: input.dependency_manifest,
    lockfile: input.lockfile,
    project_dependency_state: input.project_dependency_state,
    toolchains: input.toolchains,
    readiness_state: state,
    primary_action: primaryAction(state),
    safe_summary: SAFE_SUMMARIES[state],
    authority: authority(),
    diagnosed_at_ms: input.diagnosed_at_ms,
  });
  const digest = sha256Canonical(unsigned);
  return freezeDeep({
    ...unsigned,
    diagnosis_id: `${BUILDER_PROJECT_ENVIRONMENT_DIAGNOSIS_DIGEST_PREFIX}${digest.slice('sha256:'.length)}`,
    diagnosis_digest: digest,
  });
}

function sanitizeToolchains(value) {
  const descriptors = exactObject(value, TOOLCHAIN_NAMES);
  const selected = {};
  for (const key of TOOLCHAIN_NAMES) {
    const tool = exactObject(descriptors[key].value, TOOLCHAIN_KEYS);
    selected[key] = freezeDeep({
      state: safeEnum(tool.state.value, TOOLCHAIN_STATES),
      version: safeVersion(tool.version.value),
    });
    if ((selected[key].state === 'visible') !== (selected[key].version !== null)) fail();
  }
  return freezeDeep(selected);
}

function sanitizeAuthority(value) {
  const descriptors = exactObject(value, AUTHORITY_KEYS);
  const selected = {};
  for (const key of AUTHORITY_KEYS) selected[key] = descriptors[key].value;
  if (canonicalJson(selected) !== canonicalJson(AUTHORITY)) fail();
  return freezeDeep(selected);
}

function sanitizeBuilderProjectEnvironmentDiagnosis(rawValue) {
  try {
    const descriptors = exactObject(rawValue, DIAGNOSIS_KEYS);
    const normalized = freezeDeep({
      diagnosis_version: descriptors.diagnosis_version.value,
      diagnosis_id: safePattern(descriptors.diagnosis_id.value, DIAGNOSIS_ID_PATTERN),
      project_id: safePattern(descriptors.project_id.value, PROJECT_ID_PATTERN),
      source_tree_digest: safePattern(descriptors.source_tree_digest.value, DIGEST_PATTERN),
      package_manager: safeEnum(descriptors.package_manager.value, PACKAGE_MANAGERS),
      package_manifest: safeEnum(descriptors.package_manifest.value, MANIFEST_STATES),
      dependency_manifest: safeEnum(descriptors.dependency_manifest.value, MANIFEST_STATES),
      lockfile: safeEnum(descriptors.lockfile.value, LOCKFILES),
      project_dependency_state: safeEnum(
        descriptors.project_dependency_state.value,
        PROJECT_DEPENDENCY_STATES,
      ),
      toolchains: sanitizeToolchains(descriptors.toolchains.value),
      readiness_state: safeEnum(descriptors.readiness_state.value, READINESS_STATES),
      primary_action: safeEnum(descriptors.primary_action.value, PRIMARY_ACTIONS),
      safe_summary: descriptors.safe_summary.value,
      authority: sanitizeAuthority(descriptors.authority.value),
      diagnosed_at_ms: safeTimestamp(descriptors.diagnosed_at_ms.value),
      diagnosis_digest: safePattern(descriptors.diagnosis_digest.value, DIGEST_PATTERN),
    });
    if (
      normalized.diagnosis_version !== BUILDER_PROJECT_ENVIRONMENT_DIAGNOSIS_VERSION
      || normalized.primary_action !== primaryAction(normalized.readiness_state)
      || normalized.safe_summary !== SAFE_SUMMARIES[normalized.readiness_state]
    ) fail();
    const expectedDigest = sha256Canonical(diagnosisBody(normalized));
    if (
      normalized.diagnosis_digest !== expectedDigest
      || normalized.diagnosis_id !== `${BUILDER_PROJECT_ENVIRONMENT_DIAGNOSIS_DIGEST_PREFIX}${expectedDigest.slice('sha256:'.length)}`
    ) fail();
    return normalized;
  } catch (error) {
    if (error instanceof BuilderProjectEnvironmentDiagnosisError) throw error;
    fail();
  }
}

function sanitizeBuilderProjectEnvironmentDiagnosisResult(rawValue) {
  try {
    const descriptors = exactObject(rawValue, RESULT_KEYS);
    if (
      descriptors.result_version.value !== BUILDER_PROJECT_ENVIRONMENT_DIAGNOSIS_RESULT_VERSION
      || descriptors.service_version.value !== BUILDER_PROJECT_ENVIRONMENT_DIAGNOSIS_SERVICE_VERSION
      || descriptors.operation.value !== 'project_environment_diagnosed'
      || typeof descriptors.project_id.value !== 'string'
      || !PROJECT_ID_PATTERN.test(descriptors.project_id.value)
    ) fail();
    const diagnosis = sanitizeBuilderProjectEnvironmentDiagnosis(
      descriptors.environment_diagnosis.value,
    );
    if (diagnosis.project_id !== descriptors.project_id.value) fail();
    return freezeDeep({
      result_version: BUILDER_PROJECT_ENVIRONMENT_DIAGNOSIS_RESULT_VERSION,
      service_version: BUILDER_PROJECT_ENVIRONMENT_DIAGNOSIS_SERVICE_VERSION,
      operation: 'project_environment_diagnosed',
      project_id: diagnosis.project_id,
      environment_diagnosis: diagnosis,
    });
  } catch (error) {
    if (error instanceof BuilderProjectEnvironmentDiagnosisError) throw error;
    fail();
  }
}

function createBuilderProjectEnvironmentDiagnosisService(rawOptions) {
  const options = exactObject(rawOptions, CREATE_KEYS);
  const projectReadAuthority = options.project_read_authority.value;
  if (
    !isPlainObject(projectReadAuthority)
    || projectReadAuthority.authority_version !== BUILDER_PROJECT_READ_AUTHORITY_VERSION
  ) fail();
  const loadCurrent = ownMethod(projectReadAuthority, 'load_current');
  const resolveProjectWorkspacePath = serviceMethod(
    options.project_workspace_path_service.value,
    'service_version',
    PROJECT_WORKSPACE_PATH_SERVICE_VERSION,
    'resolve_project_workspace_path',
  );
  const spawnProcess = options.spawn_process.value;
  const terminateProcessTree = options.terminate_process_tree.value;
  const clock = options.clock.value;
  const nowMs = serviceMethod(clock, 'clock_version', 'builder-clock.v1', 'now_ms');
  const setTimer = serviceMethod(clock, 'clock_version', 'builder-clock.v1', 'set_timeout');
  const clearTimer = serviceMethod(clock, 'clock_version', 'builder-clock.v1', 'clear_timeout');
  const platform = safeEnum(options.platform.value, ['win32', 'darwin', 'linux']);
  const windowsRoot = platform === 'win32' ? safeOptionalAbsolutePath(options.windows_root.value) : null;
  if (
    typeof spawnProcess !== 'function'
    || typeof terminateProcessTree !== 'function'
    || (platform === 'win32' && windowsRoot === null)
  ) fail();

  return freezeDeep({
    service_version: BUILDER_PROJECT_ENVIRONMENT_DIAGNOSIS_SERVICE_VERSION,
    async diagnose_project_environment(rawRequest) {
      try {
        const request = exactObject(rawRequest, REQUEST_KEYS);
        const projectId = safePattern(request.project_id.value, PROJECT_ID_PATTERN);
        const diagnosedAtMs = safeTimestamp(nowMs());
        const [current, rootPath, probes] = await Promise.all([
          (async () => projectReadResult(await loadCurrent({ project_id: projectId }), projectId))(),
          (async () => {
            try {
              return projectRootPathResult(
                await resolveProjectWorkspacePath({ project_id: projectId }),
                projectId,
              );
            } catch {
              return null;
            }
          })(),
          (async () => {
            const probeOptions = {
              spawnProcess: spawnProcess.bind(null),
              terminateProcessTree: terminateProcessTree.bind(null),
              setTimer: setTimer.bind(clock),
              clearTimer: clearTimer.bind(clock),
              windowsRoot,
            };
            const entries = await Promise.all(TOOLCHAIN_NAMES.map(async (name) => [
              name,
              await runVersionProbe(name, probeOptions),
            ]));
            return freezeDeep(Object.fromEntries(entries));
          })(),
        ]);
        const files = fileMap(current.source_tree);
        const manifestState = packageManifest(files);
        const facts = {
          project_id: projectId,
          source_tree_digest: current.source_tree.source_tree_digest,
          package_manager: packageManager(files),
          package_manifest: manifestState,
          dependency_manifest: dependencyManifest(files),
          lockfile: lockfile(files),
          project_dependency_state: checkedDirectoryState(rootPath, manifestState === 'present'),
          toolchains: probes,
          diagnosed_at_ms: diagnosedAtMs,
        };
        const diagnosis = createDiagnosis(facts);
        return freezeDeep({
          result_version: BUILDER_PROJECT_ENVIRONMENT_DIAGNOSIS_RESULT_VERSION,
          service_version: BUILDER_PROJECT_ENVIRONMENT_DIAGNOSIS_SERVICE_VERSION,
          operation: 'project_environment_diagnosed',
          project_id: projectId,
          environment_diagnosis: diagnosis,
        });
      } catch (error) {
        if (error instanceof BuilderProjectEnvironmentDiagnosisError) throw error;
        fail();
      }
    },
  });
}

function safeBoundary(fn) {
  return (...args) => {
    try {
      return fn(...args);
    } catch (error) {
      if (error instanceof BuilderProjectEnvironmentDiagnosisError) throw error;
      fail();
    }
  };
}

module.exports = freezeDeep({
  BUILDER_PROJECT_ENVIRONMENT_DIAGNOSIS_RESULT_VERSION,
  BUILDER_PROJECT_ENVIRONMENT_DIAGNOSIS_SERVICE_VERSION,
  BUILDER_PROJECT_ENVIRONMENT_DIAGNOSIS_VERSION,
  BuilderProjectEnvironmentDiagnosisError,
  createBuilderProjectEnvironmentDiagnosisService: safeBoundary(createBuilderProjectEnvironmentDiagnosisService),
  sanitizeBuilderProjectEnvironmentDiagnosis: safeBoundary(sanitizeBuilderProjectEnvironmentDiagnosis),
  sanitizeBuilderProjectEnvironmentDiagnosisResult:
    safeBoundary(sanitizeBuilderProjectEnvironmentDiagnosisResult),
});
