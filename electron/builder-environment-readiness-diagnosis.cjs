'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderCheckRunAdmission,
} = require('./builder-check-run-admission.cjs');
const {
  sanitizeBuilderRuntimeReadinessSnapshot,
} = require('./builder-runtime-readiness-snapshot.cjs');

const BUILDER_ENVIRONMENT_READINESS_DIAGNOSIS_VERSION =
  'builder-environment-readiness-diagnosis.v1';
const BUILDER_ENVIRONMENT_READINESS_DIAGNOSIS_DIGEST_PREFIX =
  'builder-environment-readiness-diagnosis:';

const INPUT_KEYS = Object.freeze([
  'check_run_admission',
  'runtime_readiness_snapshot',
  'diagnosed_at_ms',
]);
const DIAGNOSIS_KEYS = Object.freeze([
  'diagnosis_version',
  'diagnosis_id',
  'project_id',
  'candidate_id',
  'source_tree_digest',
  'command_profile_id',
  'command_kind',
  'command_display',
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
  'readiness_state',
  'primary_action',
  'safe_summary',
  'authority',
  'diagnosed_at_ms',
  'diagnosis_digest',
]);
const AUTHORITY_KEYS = Object.freeze([
  'diagnosis_authority',
  'readiness_authority',
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
const AUTHORITY = Object.freeze({
  diagnosis_authority: 'main_owned_read_only_environment_diagnosis_v1',
  readiness_authority: 'verified_builder_runtime_readiness_snapshot_v1',
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

const READINESS_STATES = Object.freeze([
  'ready',
  'host_toolchain_missing',
  'dependencies_not_prepared',
  'install_approval_required',
  'install_denied',
  'unknown',
]);
const PRIMARY_ACTIONS = Object.freeze([
  'run_check',
  'prepare_once',
  'show_missing_toolchain',
  'show_diagnostics',
  'none',
]);
const SAFE_SUMMARIES = Object.freeze({
  ready: 'The selected check environment is ready.',
  host_toolchain_missing:
    'Builder cannot see the local toolchain required for this check.',
  dependencies_not_prepared:
    'The isolated check workspace has not prepared this draft\'s dependencies yet.',
  install_approval_required:
    'This check needs one-time approval before Builder can prepare dependencies.',
  install_denied:
    'Dependency preparation was denied for this check.',
  unknown:
    'Builder could not determine whether this check environment is ready.',
});
const COMMAND_KINDS = Object.freeze(['lint', 'typecheck', 'test', 'build']);
const PACKAGE_MANAGERS = Object.freeze(['npm', 'pnpm', 'yarn', 'bun']);
const COMMAND_DISPLAYS = Object.freeze({
  lint: Object.freeze(['npm run lint', 'pnpm run lint', 'yarn lint', 'bun run lint']),
  typecheck: Object.freeze(['npm run typecheck', 'pnpm run typecheck', 'yarn typecheck', 'bun run typecheck']),
  test: Object.freeze(['npm test', 'pnpm test', 'yarn test', 'bun run test']),
  build: Object.freeze(['npm run build', 'pnpm run build', 'yarn build', 'bun run build']),
});
const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CANDIDATE_ID_PATTERN = /^builder-code-change-candidate:[0-9a-f]{64}$/u;
const PROFILE_ID_PATTERN = /^builder-command-profile:[0-9a-f]{32}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const DIAGNOSIS_ID_PATTERN = /^builder-environment-readiness-diagnosis:[0-9a-f]{64}$/u;
const VERSION_PATTERN = /^(?:unknown|[vV]?[0-9][0-9A-Za-z.+_-]{0,63})$/u;

class BuilderEnvironmentReadinessDiagnosisError extends Error {
  constructor() {
    super('Builder environment readiness diagnosis could not be verified.');
    this.name = 'BuilderEnvironmentReadinessDiagnosisError';
    this.code = 'builder_environment_readiness_diagnosis_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderEnvironmentReadinessDiagnosisError(); }

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

function readinessState(snapshot) {
  if (snapshot.dependency_strategy === 'can_run_without_install'
    || snapshot.dependency_strategy === 'no_execution_needed') {
    return 'ready';
  }
  if (snapshot.dependency_strategy === 'needs_prepared_dependency_workspace') {
    return 'dependencies_not_prepared';
  }
  if (snapshot.dependency_strategy === 'needs_install_approval') {
    return 'install_approval_required';
  }
  if (snapshot.dependency_strategy === 'blocked_by_install_denial') {
    return 'install_denied';
  }
  if (
    snapshot.host_toolchain_state === 'missing'
    || snapshot.dependency_strategy === 'needs_host_toolchain_admission'
  ) {
    return 'host_toolchain_missing';
  }
  return 'unknown';
}

function primaryAction(state) {
  if (state === 'ready') return 'run_check';
  if (state === 'dependencies_not_prepared' || state === 'install_approval_required') {
    return 'prepare_once';
  }
  if (state === 'host_toolchain_missing') return 'show_missing_toolchain';
  if (state === 'install_denied') return 'none';
  return 'show_diagnostics';
}

function diagnosisBody(value) {
  const body = { ...value };
  delete body.diagnosis_id;
  delete body.diagnosis_digest;
  return body;
}

function authority() {
  return { ...AUTHORITY };
}

function createBuilderEnvironmentReadinessDiagnosis(rawInput) {
  try {
    const input = exactObject(rawInput, INPUT_KEYS);
    const admission = sanitizeBuilderCheckRunAdmission(input.check_run_admission.value);
    const snapshot = sanitizeBuilderRuntimeReadinessSnapshot(input.runtime_readiness_snapshot.value);
    if (
      snapshot.project_id !== admission.project_id
      || snapshot.candidate_id !== admission.candidate_id
      || snapshot.source_tree_digest !== admission.resulting_tree_digest
      || snapshot.package_manager !== admission.package_manager
    ) fail();
    const state = readinessState(snapshot);
    const unsigned = freezeDeep({
      diagnosis_version: BUILDER_ENVIRONMENT_READINESS_DIAGNOSIS_VERSION,
      project_id: admission.project_id,
      candidate_id: admission.candidate_id,
      source_tree_digest: snapshot.source_tree_digest,
      command_profile_id: admission.command_profile_id,
      command_kind: admission.command_kind,
      command_display: admission.command_display,
      package_manager: snapshot.package_manager,
      package_manifest: snapshot.package_manifest,
      dependency_manifest: snapshot.dependency_manifest,
      lockfile: snapshot.lockfile,
      project_dependency_state: snapshot.project_dependency_state,
      check_workspace_dependency_state: snapshot.check_workspace_dependency_state,
      host_toolchain_state: snapshot.host_toolchain_state,
      host_node_version: snapshot.host_node_version,
      host_package_manager_version: snapshot.host_package_manager_version,
      install_permission: snapshot.install_permission,
      dependency_strategy: snapshot.dependency_strategy,
      readiness_state: state,
      primary_action: primaryAction(state),
      safe_summary: SAFE_SUMMARIES[state],
      authority: authority(),
      diagnosed_at_ms: safeTimestamp(input.diagnosed_at_ms.value),
    });
    const digest = sha256Canonical(unsigned);
    return freezeDeep({
      ...unsigned,
      diagnosis_id: `${BUILDER_ENVIRONMENT_READINESS_DIAGNOSIS_DIGEST_PREFIX}${digest.slice('sha256:'.length)}`,
      diagnosis_digest: digest,
    });
  } catch (error) {
    if (error instanceof BuilderEnvironmentReadinessDiagnosisError) throw error;
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

function sanitizeBuilderEnvironmentReadinessDiagnosis(rawValue) {
  try {
    const descriptors = exactObject(rawValue, DIAGNOSIS_KEYS);
    const normalized = {
      diagnosis_version: descriptors.diagnosis_version.value,
      diagnosis_id: safePattern(descriptors.diagnosis_id.value, DIAGNOSIS_ID_PATTERN),
      project_id: safePattern(descriptors.project_id.value, PROJECT_ID_PATTERN),
      candidate_id: safePattern(descriptors.candidate_id.value, CANDIDATE_ID_PATTERN),
      source_tree_digest: safePattern(descriptors.source_tree_digest.value, DIGEST_PATTERN),
      command_profile_id: safePattern(descriptors.command_profile_id.value, PROFILE_ID_PATTERN),
      command_kind: safeEnum(descriptors.command_kind.value, COMMAND_KINDS),
      command_display: descriptors.command_display.value,
      package_manager: safeEnum(descriptors.package_manager.value, PACKAGE_MANAGERS),
      package_manifest: safeEnum(descriptors.package_manifest.value, ['absent', 'present', 'unreadable']),
      dependency_manifest: safeEnum(descriptors.dependency_manifest.value, ['absent', 'present', 'unreadable']),
      lockfile: safeEnum(descriptors.lockfile.value, [
        'none',
        'package-lock.json',
        'pnpm-lock.yaml',
        'yarn.lock',
        'bun.lock',
        'bun.lockb',
      ]),
      project_dependency_state: safeEnum(descriptors.project_dependency_state.value, [
        'not_applicable',
        'not_admitted',
        'unknown',
        'install_present',
        'install_missing',
        'unavailable',
      ]),
      check_workspace_dependency_state: safeEnum(descriptors.check_workspace_dependency_state.value, [
        'not_applicable',
        'not_materialized',
        'install_present',
        'install_missing',
        'unavailable',
      ]),
      host_toolchain_state: safeEnum(descriptors.host_toolchain_state.value, [
        'not_checked',
        'visible',
        'missing',
        'not_admitted',
      ]),
      host_node_version: safeVersion(descriptors.host_node_version.value),
      host_package_manager_version: safeVersion(descriptors.host_package_manager_version.value),
      install_permission: safeEnum(descriptors.install_permission.value, [
        'not_requested',
        'required',
        'denied',
        'approved_once',
      ]),
      dependency_strategy: safeEnum(descriptors.dependency_strategy.value, [
        'no_execution_needed',
        'can_run_without_install',
        'needs_host_toolchain_admission',
        'needs_install_approval',
        'needs_prepared_dependency_workspace',
        'blocked_by_install_denial',
        'unknown',
      ]),
      readiness_state: safeEnum(descriptors.readiness_state.value, READINESS_STATES),
      primary_action: safeEnum(descriptors.primary_action.value, PRIMARY_ACTIONS),
      safe_summary: descriptors.safe_summary.value,
      authority: sanitizeAuthority(descriptors.authority.value),
      diagnosed_at_ms: safeTimestamp(descriptors.diagnosed_at_ms.value),
      diagnosis_digest: safePattern(descriptors.diagnosis_digest.value, DIGEST_PATTERN),
    };
    if (
      normalized.diagnosis_version !== BUILDER_ENVIRONMENT_READINESS_DIAGNOSIS_VERSION
      || !COMMAND_DISPLAYS[normalized.command_kind].includes(normalized.command_display)
      || normalized.safe_summary !== SAFE_SUMMARIES[normalized.readiness_state]
      || normalized.primary_action !== primaryAction(normalized.readiness_state)
    ) fail();
    const expectedDigest = sha256Canonical(diagnosisBody(normalized));
    if (
      normalized.diagnosis_digest !== expectedDigest
      || normalized.diagnosis_id !== `${BUILDER_ENVIRONMENT_READINESS_DIAGNOSIS_DIGEST_PREFIX}${expectedDigest.slice('sha256:'.length)}`
    ) fail();
    return freezeDeep(normalized);
  } catch (error) {
    if (error instanceof BuilderEnvironmentReadinessDiagnosisError) throw error;
    fail();
  }
}

function safeBoundary(fn) {
  return (...args) => {
    try {
      return fn(...args);
    } catch (error) {
      if (error instanceof BuilderEnvironmentReadinessDiagnosisError) throw error;
      fail();
    }
  };
}

module.exports = freezeDeep({
  BUILDER_ENVIRONMENT_READINESS_DIAGNOSIS_DIGEST_PREFIX,
  BUILDER_ENVIRONMENT_READINESS_DIAGNOSIS_VERSION,
  BuilderEnvironmentReadinessDiagnosisError,
  createBuilderEnvironmentReadinessDiagnosis: safeBoundary(createBuilderEnvironmentReadinessDiagnosis),
  sanitizeBuilderEnvironmentReadinessDiagnosis:
    safeBoundary(sanitizeBuilderEnvironmentReadinessDiagnosis),
});
