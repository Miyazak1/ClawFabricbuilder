'use strict';

const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderCheckRun,
} = require('./builder-check-run.cjs');

const BUILDER_CHECK_RUN_STATUS_PROJECTION_VERSION = 'builder-check-run-status-projection.v1';
const INPUT_KEYS = Object.freeze(['check_run']);
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
    summary: 'The required local check environment is unavailable.',
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
  if (!['passed', 'failed', 'incomplete'].includes(checkStatus)) fail();
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
    || !Number.isSafeInteger(valueAt(value, 'completed_at_ms'))
    || valueAt(value, 'completed_at_ms') < 0
    || !DIGEST_PATTERN.test(valueAt(value, 'result_digest'))
  ) fail();
  return value;
}

function projectBuilderCheckRunStatus(rawInput) {
  try {
    const input = exactObject(rawInput, INPUT_KEYS);
    const checkRun = sanitizeBuilderCheckRun(valueAt(input, 'check_run'));
    const publicStatus = STATUS_PROJECTIONS[checkRun.status];
    if (!publicStatus) fail();
    return freezeDeep(assertProjection({
      projection_version: BUILDER_CHECK_RUN_STATUS_PROJECTION_VERSION,
      project_id: checkRun.project_id,
      candidate_id: checkRun.candidate_id,
      check_run_id: checkRun.check_run_id,
      command_kind: checkRun.command_kind,
      command_label: COMMAND_LABELS[checkRun.command_kind],
      ...publicStatus,
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
