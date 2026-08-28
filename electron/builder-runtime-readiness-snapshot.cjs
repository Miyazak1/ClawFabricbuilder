'use strict';

const fs = require('node:fs');
const nodeCrypto = require('node:crypto');
const path = require('node:path');
const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderCheckRunAdmission,
} = require('./builder-check-run-admission.cjs');
const {
  sanitizeBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');
const {
  sanitizeBuilderRuntimeToolchainProbe,
} = require('./builder-runtime-toolchain-probe.cjs');

const BUILDER_RUNTIME_READINESS_SNAPSHOT_VERSION =
  'builder-runtime-readiness-snapshot.v1';
const BUILDER_RUNTIME_READINESS_SNAPSHOT_DIGEST_PREFIX =
  'builder-runtime-readiness-snapshot:';

const INPUT_KEYS = Object.freeze([
  'project_id',
  'candidate_id',
  'package_manager',
  'check_run_admission',
  'source_tree',
  'project_root_path',
  'check_workspace_path',
  'host_toolchain_state',
  'toolchain_probe',
  'install_permission',
  'updated_at_ms',
]);
const SNAPSHOT_KEYS = Object.freeze([
  'snapshot_version',
  'snapshot_id',
  'project_id',
  'candidate_id',
  'source_tree_digest',
  'package_manager',
  'package_manifest',
  'dependency_manifest',
  'lockfile',
  'project_dependency_state',
  'check_workspace_dependency_state',
  'host_toolchain_state',
  'host_node_version',
  'host_package_manager_version',
  'install_permission',
  'dependency_strategy',
  'authority',
  'updated_at_ms',
  'snapshot_digest',
]);
const AUTHORITY_KEYS = Object.freeze([
  'readiness_authority',
  'source_tree_authority',
  'check_run_admission_authority',
  'renderer_authority',
  'provider_dispatch',
  'harness_dispatch',
  'source_write',
  'project_workspace_write',
  'check_workspace_write',
  'path_disclosure',
  'environment_variable_disclosure',
  'secret_access',
  'network_access',
  'install_authority',
]);

const HOST_TOOLCHAIN_STATES = Object.freeze([
  'not_checked',
  'visible',
  'missing',
  'not_admitted',
]);
const INSTALL_PERMISSIONS = Object.freeze([
  'not_requested',
  'required',
  'denied',
  'approved_once',
]);
const DEPENDENCY_STATES = Object.freeze([
  'not_applicable',
  'not_admitted',
  'unknown',
  'install_present',
  'install_missing',
  'unavailable',
]);
const CHECK_WORKSPACE_DEPENDENCY_STATES = Object.freeze([
  'not_applicable',
  'not_materialized',
  'install_present',
  'install_missing',
  'unavailable',
]);
const DEPENDENCY_STRATEGIES = Object.freeze([
  'no_execution_needed',
  'can_run_without_install',
  'needs_host_toolchain_admission',
  'needs_install_approval',
  'needs_prepared_dependency_workspace',
  'blocked_by_install_denial',
  'unknown',
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
const DEPENDENCY_MANIFEST_STATES = Object.freeze(['absent', 'present', 'unreadable']);

const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CANDIDATE_ID_PATTERN = /^builder-code-change-candidate:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const SNAPSHOT_ID_PATTERN = /^builder-runtime-readiness-snapshot:[0-9a-f]{64}$/u;
const VERSION_PATTERN = /^(?:unknown|[vV]?[0-9][0-9A-Za-z.+_-]{0,63})$/u;

const AUTHORITY = Object.freeze({
  readiness_authority: 'main_owned_runtime_readiness_snapshot_v1',
  source_tree_authority: 'verified_builder_project_source_tree',
  check_run_admission_authority: 'verified_builder_check_run_admission',
  renderer_authority: 'not_present',
  provider_dispatch: false,
  harness_dispatch: false,
  source_write: false,
  project_workspace_write: false,
  check_workspace_write: false,
  path_disclosure: 'redacted_status_only',
  environment_variable_disclosure: false,
  secret_access: 'not_present',
  network_access: false,
  install_authority: 'not_granted',
});

class BuilderRuntimeReadinessSnapshotError extends Error {
  constructor() {
    super('Builder runtime readiness could not be verified.');
    this.name = 'BuilderRuntimeReadinessSnapshotError';
    this.code = 'builder_runtime_readiness_snapshot_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderRuntimeReadinessSnapshotError();
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

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeVersion(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || !VERSION_PATTERN.test(value)) fail();
  return value;
}

function hostToolchainStateFromProbe(probe) {
  if (probe.package_manager === 'none') return 'not_checked';
  const nodeReady = ['npm', 'pnpm', 'yarn'].includes(probe.package_manager)
    ? probe.node_state === 'visible'
    : true;
  return nodeReady && probe.package_manager_state === 'visible'
    ? 'visible'
    : 'missing';
}

function toolchainFacts(rawProbe, packageManager, declaredHostState) {
  if (rawProbe === null) {
    return freezeDeep({
      host_toolchain_state: declaredHostState,
      host_node_version: null,
      host_package_manager_version: null,
    });
  }
  const probe = sanitizeBuilderRuntimeToolchainProbe(rawProbe);
  if (probe.package_manager !== packageManager) fail();
  const probedHostState = hostToolchainStateFromProbe(probe);
  if (declaredHostState !== 'not_checked' && declaredHostState !== probedHostState) fail();
  return freezeDeep({
    host_toolchain_state: probedHostState,
    host_node_version: probe.node_version,
    host_package_manager_version: probe.package_manager_version,
  });
}

function safeNullableAbsolutePath(value) {
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

function checkedDirectoryState(rootPath) {
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

function checkWorkspaceState(workspacePath) {
  if (workspacePath === null) return 'not_materialized';
  const state = checkedDirectoryState(workspacePath);
  return state === 'not_admitted' ? 'not_materialized' : state;
}

function fileMap(sourceTree) {
  return new Map(sourceTree.files.map((file) => [file.path, file]));
}

function packageManifest(files) {
  const manifest = files.get('package.json');
  if (!manifest) return 'absent';
  try {
    const parsed = JSON.parse(manifest.content);
    return isPlainObject(parsed) ? 'present' : 'unreadable';
  } catch {
    return 'unreadable';
  }
}

function dependencyManifest(files) {
  const manifest = files.get('package.json');
  if (!manifest) return 'absent';
  try {
    const parsed = JSON.parse(manifest.content);
    if (!isPlainObject(parsed)) return 'unreadable';
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      const dependencies = parsed[field];
      if (dependencies === undefined) continue;
      if (!isPlainObject(dependencies) || utilTypes.isProxy(dependencies)) return 'unreadable';
      if (Object.keys(dependencies).length > 0) return 'present';
    }
    return 'absent';
  } catch {
    return 'unreadable';
  }
}

function lockfile(files) {
  for (const selected of LOCKFILES) {
    if (selected !== 'none' && files.has(selected)) return selected;
  }
  return 'none';
}

function strategyFor(facts) {
  if (facts.package_manifest === 'absent') return 'no_execution_needed';
  if (facts.package_manifest === 'unreadable' || facts.dependency_manifest === 'unreadable') {
    return 'unknown';
  }
  if (facts.install_permission === 'denied') return 'blocked_by_install_denial';
  if (facts.dependency_manifest === 'absent') {
    return facts.host_toolchain_state === 'missing' || facts.host_toolchain_state === 'not_admitted'
      ? 'needs_host_toolchain_admission'
      : 'can_run_without_install';
  }
  if (facts.check_workspace_dependency_state === 'install_present') {
    return facts.host_toolchain_state === 'missing' || facts.host_toolchain_state === 'not_admitted'
      ? 'needs_host_toolchain_admission'
      : 'can_run_without_install';
  }
  if (facts.install_permission === 'required') return 'needs_install_approval';
  if (facts.check_workspace_dependency_state === 'install_missing') {
    return 'needs_prepared_dependency_workspace';
  }
  if (facts.project_dependency_state === 'install_present') {
    return 'needs_prepared_dependency_workspace';
  }
  if (facts.host_toolchain_state === 'missing' || facts.host_toolchain_state === 'not_admitted') {
    return 'needs_host_toolchain_admission';
  }
  return 'unknown';
}

function snapshotBody(value) {
  const body = { ...value };
  delete body.snapshot_id;
  delete body.snapshot_digest;
  return body;
}

function authority() {
  return { ...AUTHORITY };
}

function createBuilderRuntimeReadinessSnapshot(rawInput) {
  try {
    const input = exactObject(rawInput, INPUT_KEYS);
    const projectId = safePattern(input.project_id.value, PROJECT_ID_PATTERN);
    const candidateId = safePattern(input.candidate_id.value, CANDIDATE_ID_PATTERN);
    const packageManager = safeEnum(input.package_manager.value, PACKAGE_MANAGERS);
    const rawAdmission = input.check_run_admission.value;
    const admission = rawAdmission === null ? null : sanitizeBuilderCheckRunAdmission(rawAdmission);
    const sourceTree = sanitizeBuilderProjectSourceTree(input.source_tree.value);
    if (admission !== null && (
      admission.project_id !== projectId
      || admission.candidate_id !== candidateId
      || admission.resulting_tree_digest !== sourceTree.source_tree_digest
      || admission.package_manager !== packageManager
    )) fail();
    const projectRootPath = safeNullableAbsolutePath(input.project_root_path.value);
    const checkWorkspacePath = safeNullableAbsolutePath(input.check_workspace_path.value);
    const toolchain = toolchainFacts(
      input.toolchain_probe.value,
      packageManager,
      safeEnum(input.host_toolchain_state.value, HOST_TOOLCHAIN_STATES),
    );
    const files = fileMap(sourceTree);
    const packageManifestState = packageManifest(files);
    const dependencyManifestState = dependencyManifest(files);
    const hasNodeManifest = packageManifestState === 'present';
    const facts = {
      package_manifest: packageManifestState,
      dependency_manifest: dependencyManifestState,
      host_toolchain_state: toolchain.host_toolchain_state,
      install_permission: safeEnum(input.install_permission.value, INSTALL_PERMISSIONS),
      project_dependency_state: hasNodeManifest
        ? checkedDirectoryState(projectRootPath)
        : 'not_applicable',
      check_workspace_dependency_state: hasNodeManifest
        ? checkWorkspaceState(checkWorkspacePath)
        : 'not_applicable',
    };
    safeEnum(facts.project_dependency_state, DEPENDENCY_STATES);
    safeEnum(facts.check_workspace_dependency_state, CHECK_WORKSPACE_DEPENDENCY_STATES);
    const unsigned = freezeDeep({
      snapshot_version: BUILDER_RUNTIME_READINESS_SNAPSHOT_VERSION,
      project_id: projectId,
      candidate_id: candidateId,
      source_tree_digest: sourceTree.source_tree_digest,
      package_manager: packageManager,
      package_manifest: facts.package_manifest,
      dependency_manifest: facts.dependency_manifest,
      lockfile: lockfile(files),
      project_dependency_state: facts.project_dependency_state,
      check_workspace_dependency_state: facts.check_workspace_dependency_state,
      host_toolchain_state: facts.host_toolchain_state,
      host_node_version: toolchain.host_node_version,
      host_package_manager_version: toolchain.host_package_manager_version,
      install_permission: facts.install_permission,
      dependency_strategy: strategyFor(facts),
      authority: authority(),
      updated_at_ms: safeTimestamp(input.updated_at_ms.value),
    });
    safeEnum(unsigned.dependency_strategy, DEPENDENCY_STRATEGIES);
    const digest = sha256Canonical(unsigned);
    return freezeDeep({
      ...unsigned,
      snapshot_id: `${BUILDER_RUNTIME_READINESS_SNAPSHOT_DIGEST_PREFIX}${digest.slice('sha256:'.length)}`,
      snapshot_digest: digest,
    });
  } catch (error) {
    if (error instanceof BuilderRuntimeReadinessSnapshotError) throw error;
    fail();
  }
}

function sanitizeAuthority(value) {
  const descriptors = exactObject(value, AUTHORITY_KEYS);
  const selected = {};
  for (const key of AUTHORITY_KEYS) selected[key] = descriptors[key].value;
  if (canonicalJson(selected) !== canonicalJson(AUTHORITY)) fail();
  return freezeDeep(selected);
}

function sanitizeBuilderRuntimeReadinessSnapshot(rawSnapshot) {
  try {
    const descriptors = exactObject(rawSnapshot, SNAPSHOT_KEYS);
    const normalized = {
      snapshot_version: descriptors.snapshot_version.value,
      snapshot_id: descriptors.snapshot_id.value,
      project_id: descriptors.project_id.value,
      candidate_id: descriptors.candidate_id.value,
      source_tree_digest: descriptors.source_tree_digest.value,
      package_manager: descriptors.package_manager.value,
      package_manifest: descriptors.package_manifest.value,
      dependency_manifest: descriptors.dependency_manifest.value,
      lockfile: descriptors.lockfile.value,
      project_dependency_state: descriptors.project_dependency_state.value,
      check_workspace_dependency_state: descriptors.check_workspace_dependency_state.value,
      host_toolchain_state: descriptors.host_toolchain_state.value,
      host_node_version: safeVersion(descriptors.host_node_version.value),
      host_package_manager_version: safeVersion(descriptors.host_package_manager_version.value),
      install_permission: descriptors.install_permission.value,
      dependency_strategy: descriptors.dependency_strategy.value,
      authority: sanitizeAuthority(descriptors.authority.value),
      updated_at_ms: safeTimestamp(descriptors.updated_at_ms.value),
      snapshot_digest: descriptors.snapshot_digest.value,
    };
    if (
      normalized.snapshot_version !== BUILDER_RUNTIME_READINESS_SNAPSHOT_VERSION
      || typeof normalized.snapshot_id !== 'string'
      || !SNAPSHOT_ID_PATTERN.test(normalized.snapshot_id)
      || typeof normalized.project_id !== 'string'
      || !PROJECT_ID_PATTERN.test(normalized.project_id)
      || typeof normalized.candidate_id !== 'string'
      || !CANDIDATE_ID_PATTERN.test(normalized.candidate_id)
      || typeof normalized.source_tree_digest !== 'string'
      || !DIGEST_PATTERN.test(normalized.source_tree_digest)
      || typeof normalized.snapshot_digest !== 'string'
      || !DIGEST_PATTERN.test(normalized.snapshot_digest)
    ) fail();
    safeEnum(normalized.package_manager, PACKAGE_MANAGERS);
    safeEnum(normalized.package_manifest, MANIFEST_STATES);
    safeEnum(normalized.dependency_manifest, DEPENDENCY_MANIFEST_STATES);
    safeEnum(normalized.lockfile, LOCKFILES);
    safeEnum(normalized.project_dependency_state, DEPENDENCY_STATES);
    safeEnum(normalized.check_workspace_dependency_state, CHECK_WORKSPACE_DEPENDENCY_STATES);
    safeEnum(normalized.host_toolchain_state, HOST_TOOLCHAIN_STATES);
    safeEnum(normalized.install_permission, INSTALL_PERMISSIONS);
    safeEnum(normalized.dependency_strategy, DEPENDENCY_STRATEGIES);
    const expectedDigest = sha256Canonical(snapshotBody(normalized));
    if (
      normalized.snapshot_digest !== expectedDigest
      || normalized.snapshot_id !== `${BUILDER_RUNTIME_READINESS_SNAPSHOT_DIGEST_PREFIX}${expectedDigest.slice('sha256:'.length)}`
    ) fail();
    return freezeDeep(normalized);
  } catch (error) {
    if (error instanceof BuilderRuntimeReadinessSnapshotError) throw error;
    fail();
  }
}

function safeBoundary(fn) {
  return (...args) => {
    try {
      return fn(...args);
    } catch (error) {
      if (error instanceof BuilderRuntimeReadinessSnapshotError) throw error;
      fail();
    }
  };
}

module.exports = freezeDeep({
  BUILDER_RUNTIME_READINESS_SNAPSHOT_VERSION,
  BUILDER_RUNTIME_READINESS_SNAPSHOT_DIGEST_PREFIX,
  BuilderRuntimeReadinessSnapshotError,
  createBuilderRuntimeReadinessSnapshot: safeBoundary(createBuilderRuntimeReadinessSnapshot),
  sanitizeBuilderRuntimeReadinessSnapshot: safeBoundary(sanitizeBuilderRuntimeReadinessSnapshot),
});
