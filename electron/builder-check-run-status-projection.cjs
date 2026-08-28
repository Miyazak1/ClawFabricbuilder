'use strict';

const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderCheckRun,
} = require('./builder-check-run.cjs');
const {
  sanitizeBuilderRuntimeReadinessSnapshot,
} = require('./builder-runtime-readiness-snapshot.cjs');

const BUILDER_CHECK_RUN_STATUS_PROJECTION_VERSION = 'builder-check-run-status-projection.v1';
const INPUT_KEYS = Object.freeze(['check_run']);
const INPUT_WITH_READINESS_KEYS = Object.freeze(['check_run', 'runtime_readiness_snapshot']);
const PROJECTION_KEYS = Object.freeze([
  'projection_version',
  'project_id',
  'candidate_id',
  'check_run_id',
  'command_kind',
  'command_label',
  'status',
  'label',
  'summary',
  'environment_reason',
  'completed_at_ms',
  'result_digest',
  'authority',
]);
const AUTHORITY_KEYS = Object.freeze([
  'projection_authority',
  'check_run_authority',
  'renderer_authority',
  'ipc_authority',
  'raw_output',
  'runtime_paths',
  'provider_dispatch',
  'command_execution',
  'source_write',
  'git_write',
  'sqlite_write',
  'save_authority',
]);
const COMMAND_LABELS = Object.freeze({
  lint: 'Lint',
  typecheck: 'Type check',
  test: 'Tests',
  build: 'Build',
});
const STATUS_PROJECTIONS = Object.freeze({
  passed: Object.freeze({
    status: 'passed',
    label: 'Checked',
    summary: 'The project check completed successfully.',
  }),
  failed: Object.freeze({
    status: 'failed',
    label: 'Check failed',
    summary: 'The project check found a problem that needs review.',
  }),
  output_exceeded: Object.freeze({
    status: 'failed',
    label: 'Check failed',
    summary: 'The project check produced too much output to review safely.',
  }),
  timed_out: Object.freeze({
    status: 'incomplete',
    label: 'Check incomplete',
    summary: 'The project check reached its time limit.',
  }),
  cancelled: Object.freeze({
    status: 'incomplete',
    label: 'Check incomplete',
    summary: 'The project check was cancelled.',
  }),
  environment_unavailable: Object.freeze({
    status: 'incomplete',
    label: 'Check unavailable',
    summary: 'The admitted check workspace needs prepared dependencies or local toolchain access before this check can run.',
  }),
  spawn_failed: Object.freeze({
    status: 'incomplete',
    label: 'Check unavailable',
    summary: 'The project check could not be started.',
  }),
  termination_failed: Object.freeze({
    status: 'incomplete',
    label: 'Check needs attention',
    summary: 'Builder could not confirm that the project check stopped.',
  }),
});
const ENVIRONMENT_REASONS = Object.freeze([
  'none',
  'dependency_workspace_missing',
  'install_approval_required',
  'install_denied',
  'dependency_preparation_failed',
  'dependency_preparation_timed_out',
  'package_manager_unavailable',
  'host_toolchain_missing',
  'environment_unknown',
]);
const ENVIRONMENT_UNAVAILABLE_SUMMARIES = Object.freeze({
  dependency_workspace_missing:
    'This draft declares project dependencies, but the isolated check workspace has not prepared them yet.',
  install_approval_required:
    'This check needs explicit dependency preparation approval before it can run.',
  install_denied:
    'Dependency preparation was denied, so Builder could not run this check.',
  dependency_preparation_failed:
    'Dependency preparation failed in the isolated check workspace. You can retry preparation for this check.',
  dependency_preparation_timed_out:
    'Dependency preparation reached the time limit in the isolated check workspace. You can retry preparation for this check.',
  package_manager_unavailable:
    'Builder could not start the package manager needed to prepare check dependencies.',
  host_toolchain_missing:
    'Builder cannot see the local Node/package-manager toolchain required for this check.',
  environment_unknown:
    'The admitted check workspace needs prepared dependencies or local toolchain access before this check can run.',
});
const AUTHORITY = Object.freeze({
  projection_authority: 'main_owned_check_run_status_projection_v1',
  check_run_authority: 'verified_check_run_contract',
  renderer_authority: 'read_only_projection',
  ipc_authority: 'projection_only',
  raw_output: 'not_present',
  runtime_paths: 'not_present',
  provider_dispatch: false,
  command_execution: false,
  source_write: 'not_present',
  git_write: false,
  sqlite_write: false,
  save_authority: false,
});
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CANDIDATE_ID_PATTERN = /^builder-code-change-candidate:[0-9a-f]{64}$/u;
const CHECK_RUN_ID_PATTERN = /^builder-check-run:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const PUBLIC_STATUS_TUPLES = new Set(Object.values(STATUS_PROJECTIONS).map(
  ({ status, label, summary }) => JSON.stringify([status, label, summary]),
));
for (const summary of Object.values(ENVIRONMENT_UNAVAILABLE_SUMMARIES)) {
  PUBLIC_STATUS_TUPLES.add(JSON.stringify(['incomplete', 'Check unavailable', summary]));
}

class BuilderCheckRunStatusProjectionError extends Error {
  constructor() {
    super('Builder check status is unavailable.');
    this.name = 'BuilderCheckRunStatusProjectionError';
    this.code = 'builder_check_run_status_projection_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderCheckRunStatusProjectionError(); }

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

function exactInput(value) {
  if (!isPlainObject(value)) fail();
  const ownKeys = Reflect.ownKeys(value);
  const hasReadiness = ownKeys.includes('runtime_readiness_snapshot');
  const keys = hasReadiness ? INPUT_WITH_READINESS_KEYS : INPUT_KEYS;
  if (
    ownKeys.length !== keys.length
    || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail();
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

function assertProjection(rawValue) {
  const value = exactObject(rawValue, PROJECTION_KEYS);
  const checkStatus = valueAt(value, 'status');
  const environmentReason = valueAt(value, 'environment_reason');
  if (!['passed', 'failed', 'incomplete'].includes(checkStatus)) fail();
  if (typeof environmentReason !== 'string' || !ENVIRONMENT_REASONS.includes(environmentReason)) {
    fail();
  }
  const authority = exactObject(valueAt(value, 'authority'), AUTHORITY_KEYS);
  for (const key of AUTHORITY_KEYS) if (valueAt(authority, key) !== AUTHORITY[key]) fail();
  if (
    valueAt(value, 'projection_version') !== BUILDER_CHECK_RUN_STATUS_PROJECTION_VERSION
    || !PROJECT_ID_PATTERN.test(valueAt(value, 'project_id'))
    || !CANDIDATE_ID_PATTERN.test(valueAt(value, 'candidate_id'))
    || !CHECK_RUN_ID_PATTERN.test(valueAt(value, 'check_run_id'))
    || !Object.hasOwn(COMMAND_LABELS, valueAt(value, 'command_kind'))
    || valueAt(value, 'command_label') !== COMMAND_LABELS[valueAt(value, 'command_kind')]
    || !PUBLIC_STATUS_TUPLES.has(JSON.stringify([
      checkStatus,
      valueAt(value, 'label'),
      valueAt(value, 'summary'),
    ]))
    || (
      valueAt(value, 'label') !== 'Check unavailable'
      && environmentReason !== 'none'
    )
    || !Number.isSafeInteger(valueAt(value, 'completed_at_ms'))
    || valueAt(value, 'completed_at_ms') < 0
    || !DIGEST_PATTERN.test(valueAt(value, 'result_digest'))
  ) fail();
  return value;
}

function readinessReason(checkRun, rawReadinessSnapshot) {
  if (checkRun.status !== 'environment_unavailable') return 'none';
  if (
    typeof checkRun.environment_reason === 'string'
    && checkRun.environment_reason !== 'environment_unknown'
  ) {
    return checkRun.environment_reason;
  }
  if (rawReadinessSnapshot === null || rawReadinessSnapshot === undefined) {
    return typeof checkRun.environment_reason === 'string'
      ? checkRun.environment_reason
      : 'environment_unknown';
  }
  const snapshot = sanitizeBuilderRuntimeReadinessSnapshot(rawReadinessSnapshot);
  if (
    snapshot.project_id !== checkRun.project_id
    || snapshot.candidate_id !== checkRun.candidate_id
    || snapshot.source_tree_digest !== checkRun.resulting_tree_digest
    || snapshot.package_manager !== checkRun.package_manager
  ) fail();
  if (snapshot.dependency_strategy === 'needs_prepared_dependency_workspace') {
    return 'dependency_workspace_missing';
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
  ) return 'host_toolchain_missing';
  return 'environment_unknown';
}

function projectBuilderCheckRunStatus(rawInput) {
  try {
    const input = exactInput(rawInput);
    const checkRun = sanitizeBuilderCheckRun(valueAt(input, 'check_run'));
    const publicStatus = STATUS_PROJECTIONS[checkRun.status];
    if (!publicStatus) fail();
    const environmentReason = readinessReason(
      checkRun,
      Object.hasOwn(input, 'runtime_readiness_snapshot')
        ? valueAt(input, 'runtime_readiness_snapshot')
        : null,
    );
    const summary = checkRun.status === 'environment_unavailable'
      ? ENVIRONMENT_UNAVAILABLE_SUMMARIES[environmentReason] ?? publicStatus.summary
      : publicStatus.summary;
    return freezeDeep(assertProjection({
      projection_version: BUILDER_CHECK_RUN_STATUS_PROJECTION_VERSION,
      project_id: checkRun.project_id,
      candidate_id: checkRun.candidate_id,
      check_run_id: checkRun.check_run_id,
      command_kind: checkRun.command_kind,
      command_label: COMMAND_LABELS[checkRun.command_kind],
      ...publicStatus,
      summary,
      environment_reason: environmentReason,
      completed_at_ms: checkRun.completed_at_ms,
      result_digest: checkRun.check_run_digest,
      authority: { ...AUTHORITY },
    }));
  } catch (error) {
    if (error instanceof BuilderCheckRunStatusProjectionError) throw error;
    fail();
  }
}

function sanitizeBuilderCheckRunStatusProjection(rawValue) {
  try {
    return freezeDeep(assertProjection(rawValue));
  } catch {
    fail();
  }
}

module.exports = freezeDeep({
  BUILDER_CHECK_RUN_STATUS_PROJECTION_VERSION,
  BuilderCheckRunStatusProjectionError,
  projectBuilderCheckRunStatus,
  sanitizeBuilderCheckRunStatusProjection,
});
