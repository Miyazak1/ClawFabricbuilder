'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderCheckRunAdmission,
} = require('./builder-check-run-admission.cjs');

const BUILDER_CHECK_RUN_VERSION = 'builder-check-run.v1';
const INPUT_KEYS = Object.freeze([
  'check_run_admission',
  'status',
  'exit_code',
  'output_digest',
  'failure_class',
  'started_at_ms',
  'completed_at_ms',
]);
const RECORD_KEYS = Object.freeze([
  'check_run_version',
  'check_run_id',
  'admission_id',
  'admission_digest',
  'approval_id',
  'approval_digest',
  'project_id',
  'conversation_id',
  'turn_id',
  'task_id',
  'run_id',
  'draft_id',
  'draft_checkpoint_id',
  'draft_checkpoint_sequence',
  'candidate_id',
  'candidate_digest',
  'resulting_tree_digest',
  'command_profile_id',
  'command_kind',
  'command_display',
  'script_digest',
  'invocation_digest',
  'execution_policy',
  'status',
  'exit_code',
  'output_digest',
  'failure_class',
  'started_at_ms',
  'completed_at_ms',
  'output_summary',
  'authority',
  'check_run_digest',
]);
const AUTHORITY_KEYS = Object.freeze([
  'record_authority',
  'admission_authority',
  'candidate_authority',
  'command_profile_authority',
  'renderer_authority',
  'ipc_authority',
  'provider_dispatch',
  'command_execution',
  'source_write',
  'git_write',
  'sqlite_write',
  'save_authority',
  'network_authority',
]);
const CHECK_RUN_ID_PATTERN = /^builder-check-run:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const STATUSES = Object.freeze([
  'passed',
  'failed',
  'timed_out',
  'environment_unavailable',
  'cancelled',
  'spawn_failed',
]);
const FAILURE_CLASS_BY_STATUS = Object.freeze({
  passed: 'none',
  failed: 'command_failed',
  timed_out: 'timed_out',
  environment_unavailable: 'environment_unavailable',
  cancelled: 'cancelled',
  spawn_failed: 'spawn_failed',
});
const SUMMARY_BY_STATUS = Object.freeze({
  passed: 'Check completed successfully.',
  failed: 'Check failed. Review the project command before saving.',
  timed_out: 'Check stopped after reaching the time limit.',
  environment_unavailable: 'Check could not start in the current environment.',
  cancelled: 'Check was cancelled.',
  spawn_failed: 'Check could not be started.',
});
const AUTHORITY = Object.freeze({
  record_authority: 'main_owned_check_run_contract_v1',
  admission_authority: 'verified_check_run_admission_v1',
  candidate_authority: 'admission_bound_verified_candidate',
  command_profile_authority: 'admission_bound_candidate_profile',
  renderer_authority: 'not_present',
  ipc_authority: 'not_present',
  provider_dispatch: false,
  command_execution: 'recorded_admitted_result_only',
  source_write: 'temporary_candidate_workspace_only',
  git_write: false,
  sqlite_write: false,
  save_authority: false,
  network_authority: 'not_granted_by_check_record',
});

class BuilderCheckRunError extends Error {
  constructor() {
    super('The project check result could not be verified.');
    this.name = 'BuilderCheckRunError';
    this.code = 'builder_check_run_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderCheckRunError(); }

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
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
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

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeStatus(value) {
  if (typeof value !== 'string' || !STATUSES.includes(value)) fail();
  return value;
}

function safeExitCode(value, status) {
  if (status === 'passed') {
    if (value !== 0) fail();
    return 0;
  }
  if (status === 'failed') {
    if (!Number.isSafeInteger(value) || value < 1 || value > 255) fail();
    return value;
  }
  if (value !== null) fail();
  return null;
}

function resultFacts(rawValue) {
  const source = exactObject(rawValue, INPUT_KEYS);
  const admission = sanitizeBuilderCheckRunAdmission(valueAt(source, 'check_run_admission'));
  const status = safeStatus(valueAt(source, 'status'));
  const startedAtMs = safeTimestamp(valueAt(source, 'started_at_ms'));
  const completedAtMs = safeTimestamp(valueAt(source, 'completed_at_ms'));
  if (
    startedAtMs < admission.admitted_at_ms
    || completedAtMs < startedAtMs
    || completedAtMs - startedAtMs > admission.timeout_ms + 30_000
  ) fail();
  const failureClass = valueAt(source, 'failure_class');
  if (failureClass !== FAILURE_CLASS_BY_STATUS[status]) fail();
  return freezeDeep({
    admission,
    status,
    exit_code: safeExitCode(valueAt(source, 'exit_code'), status),
    output_digest: safePattern(valueAt(source, 'output_digest'), DIGEST_PATTERN),
    failure_class: failureClass,
    started_at_ms: startedAtMs,
    completed_at_ms: completedAtMs,
  });
}

function checkRunBody(value) {
  const body = { ...value };
  delete body.check_run_id;
  delete body.check_run_digest;
  return body;
}

function assertAuthority(value) {
  exactObject(value, AUTHORITY_KEYS);
  for (const key of AUTHORITY_KEYS) if (valueAt(value, key) !== AUTHORITY[key]) fail();
  return freezeDeep({ ...AUTHORITY });
}

function createBuilderCheckRun(rawInput) {
  try {
    const result = resultFacts(rawInput);
    const admission = result.admission;
    const unsigned = freezeDeep({
      check_run_version: BUILDER_CHECK_RUN_VERSION,
      admission_id: admission.admission_id,
      admission_digest: admission.admission_digest,
      approval_id: admission.approval_id,
      approval_digest: admission.approval_digest,
      project_id: admission.project_id,
      conversation_id: admission.conversation_id,
      turn_id: admission.turn_id,
      task_id: admission.task_id,
      run_id: admission.run_id,
      draft_id: admission.draft_id,
      draft_checkpoint_id: admission.draft_checkpoint_id,
      draft_checkpoint_sequence: admission.draft_checkpoint_sequence,
      candidate_id: admission.candidate_id,
      candidate_digest: admission.candidate_digest,
      resulting_tree_digest: admission.resulting_tree_digest,
      command_profile_id: admission.command_profile_id,
      command_kind: admission.command_kind,
      command_display: admission.command_display,
      script_digest: admission.script_digest,
      invocation_digest: admission.invocation_digest,
      execution_policy: admission.execution_policy,
      status: result.status,
      exit_code: result.exit_code,
      output_digest: result.output_digest,
      failure_class: result.failure_class,
      started_at_ms: result.started_at_ms,
      completed_at_ms: result.completed_at_ms,
      output_summary: SUMMARY_BY_STATUS[result.status],
      authority: { ...AUTHORITY },
    });
    const digest = sha256Canonical(unsigned);
    return freezeDeep({
      ...unsigned,
      check_run_id: `builder-check-run:${digest.slice('sha256:'.length)}`,
      check_run_digest: digest,
    });
  } catch (error) {
    if (error instanceof BuilderCheckRunError) throw error;
    fail();
  }
}

function sanitizeBuilderCheckRun(rawValue) {
  try {
    const value = exactObject(rawValue, RECORD_KEYS);
    const normalized = {
      ...value,
      check_run_id: safePattern(valueAt(value, 'check_run_id'), CHECK_RUN_ID_PATTERN),
      admission_digest: safePattern(valueAt(value, 'admission_digest'), DIGEST_PATTERN),
      approval_digest: safePattern(valueAt(value, 'approval_digest'), DIGEST_PATTERN),
      script_digest: safePattern(valueAt(value, 'script_digest'), DIGEST_PATTERN),
      invocation_digest: safePattern(valueAt(value, 'invocation_digest'), DIGEST_PATTERN),
      output_digest: safePattern(valueAt(value, 'output_digest'), DIGEST_PATTERN),
      status: safeStatus(valueAt(value, 'status')),
      started_at_ms: safeTimestamp(valueAt(value, 'started_at_ms')),
      completed_at_ms: safeTimestamp(valueAt(value, 'completed_at_ms')),
      check_run_digest: safePattern(valueAt(value, 'check_run_digest'), DIGEST_PATTERN),
    };
    if (
      normalized.check_run_version !== BUILDER_CHECK_RUN_VERSION
      || normalized.output_summary !== SUMMARY_BY_STATUS[normalized.status]
      || normalized.failure_class !== FAILURE_CLASS_BY_STATUS[normalized.status]
    ) fail();
    safeExitCode(normalized.exit_code, normalized.status);
    normalized.authority = assertAuthority(normalized.authority);
    const expectedDigest = sha256Canonical(checkRunBody(normalized));
    if (
      normalized.check_run_digest !== expectedDigest
      || normalized.check_run_id !== `builder-check-run:${expectedDigest.slice('sha256:'.length)}`
    ) fail();
    return freezeDeep(normalized);
  } catch (error) {
    if (error instanceof BuilderCheckRunError) throw error;
    fail();
  }
}

module.exports = freezeDeep({
  BUILDER_CHECK_RUN_VERSION,
  BuilderCheckRunError,
  createBuilderCheckRun,
  sanitizeBuilderCheckRun,
});
