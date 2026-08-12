'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderCheckRun,
} = require('./builder-check-run.cjs');

const BUILDER_CHECK_FAILURE_TRIAGE_VERSION = 'builder-check-failure-triage.v1';
const CREATE_KEYS = Object.freeze(['check_run', 'triaged_at_ms']);
const RECORD_KEYS = Object.freeze([
  'triage_version',
  'triage_id',
  'triage_digest',
  'check_run_id',
  'check_run_digest',
  'project_id',
  'conversation_id',
  'turn_id',
  'task_id',
  'run_id',
  'draft_id',
  'draft_checkpoint_id',
  'candidate_id',
  'candidate_digest',
  'resulting_tree_digest',
  'command_kind',
  'status',
  'failure_class',
  'relevant_output_summary',
  'repairable',
  'next_action',
  'triaged_at_ms',
  'authority',
]);
const AUTHORITY_KEYS = Object.freeze([
  'triage_authority',
  'check_run_authority',
  'raw_output',
  'source_read',
  'source_write',
  'provider_dispatch',
  'tool_dispatch',
  'command_execution',
  'git_write',
  'sqlite_write',
  'save_authority',
  'renderer_authority',
]);
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const TRIAGE_ID_PATTERN = /^builder-check-failure-triage:[0-9a-f]{64}$/u;
const CHECK_RUN_ID_PATTERN = /^builder-check-run:[0-9a-f]{64}$/u;
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const TURN_ID_PATTERN = new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const DRAFT_ID_PATTERN = /^builder-generation-draft:[0-9a-f]{64}$/u;
const CHECKPOINT_ID_PATTERN = /^builder-draft-checkpoint:[0-9a-f]{64}$/u;
const CANDIDATE_ID_PATTERN = /^builder-code-change-candidate:[0-9a-f]{64}$/u;
const COMMAND_KINDS = Object.freeze(['lint', 'typecheck', 'test', 'build']);
const REPAIRABLE_FAILURE_CLASSES = Object.freeze(new Set([
  'command_failed',
  'timed_out',
  'output_exceeded',
]));
const FAILURE_CLASS_BY_STATUS = Object.freeze({
  failed: 'command_failed',
  timed_out: 'timed_out',
  environment_unavailable: 'environment_unavailable',
  cancelled: 'cancelled',
  spawn_failed: 'spawn_failed',
  output_exceeded: 'output_exceeded',
  termination_failed: 'termination_failed',
});
const SUMMARY_BY_FAILURE_CLASS = Object.freeze({
  command_failed: 'Check failed. Review the project command before saving.',
  timed_out: 'Check stopped after reaching the time limit.',
  environment_unavailable: 'Check could not start in the current environment.',
  cancelled: 'Check was cancelled.',
  spawn_failed: 'Check could not be started.',
  output_exceeded: 'Check output exceeded the review limit.',
  termination_failed: 'Check termination could not be confirmed.',
});
const NEXT_ACTION_BY_FAILURE_CLASS = Object.freeze({
  command_failed: 'repair_with_bounded_summary',
  timed_out: 'ask_user_or_adjust_check_timeout',
  output_exceeded: 'ask_user_or_rerun_with_smaller_output',
  environment_unavailable: 'ask_user_to_prepare_environment',
  cancelled: 'wait_for_user_direction',
  spawn_failed: 'ask_user_to_prepare_environment',
  termination_failed: 'manual_review_required',
});
const AUTHORITY = Object.freeze({
  triage_authority: 'main_owned_check_failure_triage_v1',
  check_run_authority: 'verified_check_run_v2',
  raw_output: 'not_present',
  source_read: 'not_performed',
  source_write: 'not_performed',
  provider_dispatch: false,
  tool_dispatch: false,
  command_execution: 'not_performed',
  git_write: false,
  sqlite_write: false,
  save_authority: false,
  renderer_authority: 'not_present',
});

class BuilderCheckFailureTriageError extends Error {
  constructor() {
    super('Builder check failure triage could not be verified.');
    this.name = 'BuilderCheckFailureTriageError';
    this.code = 'builder_check_failure_triage_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderCheckFailureTriageError(); }

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
  for (const key of keys) {
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

function safeOutputSummary(value) {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 240
    || /[\r\n\t]/u.test(value)
  ) fail();
  return value;
}

function safeCommandKind(value) {
  if (typeof value !== 'string' || !COMMAND_KINDS.includes(value)) fail();
  return value;
}

function safeFailureStatus(value) {
  if (typeof value !== 'string' || !Object.hasOwn(FAILURE_CLASS_BY_STATUS, value)) fail();
  return value;
}

function assertAuthority(value) {
  exactObject(value, AUTHORITY_KEYS);
  for (const key of AUTHORITY_KEYS) if (valueAt(value, key) !== AUTHORITY[key]) fail();
  return freezeDeep({ ...AUTHORITY });
}

function triageBody(value) {
  const body = { ...value };
  delete body.triage_id;
  delete body.triage_digest;
  return body;
}

function createBuilderCheckFailureTriage(rawInput) {
  try {
    const input = exactObject(rawInput, CREATE_KEYS);
    const checkRun = sanitizeBuilderCheckRun(valueAt(input, 'check_run'));
    if (checkRun.status === 'passed' || checkRun.failure_class === 'none') fail();
    const triagedAtMs = safeTimestamp(valueAt(input, 'triaged_at_ms'));
    if (triagedAtMs < checkRun.completed_at_ms || triagedAtMs - checkRun.completed_at_ms > 86_400_000) fail();
    const repairable = REPAIRABLE_FAILURE_CLASSES.has(checkRun.failure_class);
    const nextAction = NEXT_ACTION_BY_FAILURE_CLASS[checkRun.failure_class];
    if (nextAction === undefined) fail();
    const unsigned = freezeDeep({
      triage_version: BUILDER_CHECK_FAILURE_TRIAGE_VERSION,
      check_run_id: checkRun.check_run_id,
      check_run_digest: checkRun.check_run_digest,
      project_id: checkRun.project_id,
      conversation_id: checkRun.conversation_id,
      turn_id: checkRun.turn_id,
      task_id: checkRun.task_id,
      run_id: checkRun.run_id,
      draft_id: checkRun.draft_id,
      draft_checkpoint_id: checkRun.draft_checkpoint_id,
      candidate_id: checkRun.candidate_id,
      candidate_digest: checkRun.candidate_digest,
      resulting_tree_digest: checkRun.resulting_tree_digest,
      command_kind: checkRun.command_kind,
      status: checkRun.status,
      failure_class: checkRun.failure_class,
      relevant_output_summary: checkRun.output_summary,
      repairable,
      next_action: nextAction,
      triaged_at_ms: triagedAtMs,
      authority: { ...AUTHORITY },
    });
    const digest = sha256Canonical(unsigned);
    return freezeDeep({
      ...unsigned,
      triage_id: `builder-check-failure-triage:${digest.slice('sha256:'.length)}`,
      triage_digest: digest,
    });
  } catch (error) {
    if (error instanceof BuilderCheckFailureTriageError) throw error;
    fail();
  }
}

function sanitizeBuilderCheckFailureTriage(rawValue) {
  try {
    const value = exactObject(rawValue, RECORD_KEYS);
    const normalized = {
      triage_version: valueAt(value, 'triage_version'),
      triage_id: safePattern(valueAt(value, 'triage_id'), TRIAGE_ID_PATTERN),
      triage_digest: safePattern(valueAt(value, 'triage_digest'), DIGEST_PATTERN),
      check_run_id: safePattern(valueAt(value, 'check_run_id'), CHECK_RUN_ID_PATTERN),
      check_run_digest: safePattern(valueAt(value, 'check_run_digest'), DIGEST_PATTERN),
      project_id: safePattern(valueAt(value, 'project_id'), PROJECT_ID_PATTERN),
      conversation_id: safePattern(valueAt(value, 'conversation_id'), CONVERSATION_ID_PATTERN),
      turn_id: safePattern(valueAt(value, 'turn_id'), TURN_ID_PATTERN),
      task_id: safePattern(valueAt(value, 'task_id'), TASK_ID_PATTERN),
      run_id: safePattern(valueAt(value, 'run_id'), RUN_ID_PATTERN),
      draft_id: safePattern(valueAt(value, 'draft_id'), DRAFT_ID_PATTERN),
      draft_checkpoint_id: safePattern(valueAt(value, 'draft_checkpoint_id'), CHECKPOINT_ID_PATTERN),
      candidate_id: safePattern(valueAt(value, 'candidate_id'), CANDIDATE_ID_PATTERN),
      candidate_digest: safePattern(valueAt(value, 'candidate_digest'), DIGEST_PATTERN),
      resulting_tree_digest: safePattern(valueAt(value, 'resulting_tree_digest'), DIGEST_PATTERN),
      command_kind: safeCommandKind(valueAt(value, 'command_kind')),
      status: safeFailureStatus(valueAt(value, 'status')),
      failure_class: valueAt(value, 'failure_class'),
      relevant_output_summary: safeOutputSummary(valueAt(value, 'relevant_output_summary')),
      repairable: valueAt(value, 'repairable'),
      next_action: valueAt(value, 'next_action'),
      triaged_at_ms: safeTimestamp(valueAt(value, 'triaged_at_ms')),
      authority: assertAuthority(valueAt(value, 'authority')),
    };
    const expectedNextAction = NEXT_ACTION_BY_FAILURE_CLASS[normalized.failure_class];
    if (
      normalized.triage_version !== BUILDER_CHECK_FAILURE_TRIAGE_VERSION
      || expectedNextAction === undefined
      || normalized.failure_class !== FAILURE_CLASS_BY_STATUS[normalized.status]
      || normalized.relevant_output_summary !== SUMMARY_BY_FAILURE_CLASS[normalized.failure_class]
      || normalized.repairable !== REPAIRABLE_FAILURE_CLASSES.has(normalized.failure_class)
      || normalized.next_action !== expectedNextAction
      || normalized.check_run_id !== `builder-check-run:${normalized.check_run_digest.slice('sha256:'.length)}`
    ) fail();
    const expectedDigest = sha256Canonical(triageBody(normalized));
    if (
      normalized.triage_digest !== expectedDigest
      || normalized.triage_id !== `builder-check-failure-triage:${expectedDigest.slice('sha256:'.length)}`
    ) fail();
    return freezeDeep(normalized);
  } catch (error) {
    if (error instanceof BuilderCheckFailureTriageError) throw error;
    fail();
  }
}

module.exports = freezeDeep({
  BUILDER_CHECK_FAILURE_TRIAGE_VERSION,
  BuilderCheckFailureTriageError,
  createBuilderCheckFailureTriage,
  sanitizeBuilderCheckFailureTriage,
});
