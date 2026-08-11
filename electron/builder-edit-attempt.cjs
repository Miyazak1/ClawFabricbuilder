'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderCodeChangeCandidate,
} = require('./builder-code-change-kernel.cjs');
const {
  sanitizeBuilderEditIntentPlan,
  sanitizeBuilderWorkspaceGuardReport,
} = require('./builder-edit-intent-workspace-guard.cjs');
const {
  createBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');

const BUILDER_EDIT_ATTEMPT_VERSION = 'builder-edit-attempt.v1';
const CREATE_KEYS = Object.freeze([
  'candidate',
  'edit_intent_plan',
  'workspace_guard_report',
  'attempted_at_ms',
]);
const ATTEMPT_KEYS = Object.freeze([
  'attempt_version',
  'edit_attempt_id',
  'edit_intent_plan_id',
  'plan_digest',
  'guard_report_id',
  'guard_report_digest',
  'project_id',
  'conversation_id',
  'turn_id',
  'task_id',
  'run_id',
  'candidate_id',
  'candidate_digest',
  'attempt_number',
  'status',
  'changed_paths',
  'operation_summary',
  'expected_old_verification',
  'conflict_summary',
  'base_tree_digest',
  'resulting_tree_digest',
  'attempted_at_ms',
  'authority',
  'edit_attempt_digest',
]);
const OPERATION_SUMMARY_KEYS = Object.freeze(['create_count', 'update_count', 'delete_count']);
const AUTHORITY_KEYS = Object.freeze([
  'attempt_authority',
  'candidate_authority',
  'plan_authority',
  'guard_authority',
  'renderer_authority',
  'provider_authority',
  'source_write',
  'git_mutation',
  'revision_admission',
  'rollback_model',
]);
const AUTHORITY = Object.freeze({
  attempt_authority: 'main_owned_deterministic_edit_attempt_v1',
  candidate_authority: 'sanitized_builder_code_change_candidate_v2',
  plan_authority: 'verified_edit_intent_plan_v1',
  guard_authority: 'verified_workspace_guard_report_v1',
  renderer_authority: 'not_present',
  provider_authority: 'not_present',
  source_write: 'not_performed',
  git_mutation: false,
  revision_admission: 'not_created',
  rollback_model: 'atomic_in_memory_transform_no_partial_write',
});
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ATTEMPT_ID_PATTERN = /^builder-edit-attempt:[0-9a-f]{64}$/u;
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const ID_PATTERNS = Object.freeze({
  project: new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u'),
  conversation: new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u'),
  turn: new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u'),
  task: new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u'),
  run: new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u'),
  candidate: /^builder-code-change-candidate:[0-9a-f]{64}$/u,
  plan: /^builder-edit-intent-plan:[0-9a-f]{64}$/u,
  report: /^builder-workspace-guard-report:[0-9a-f]{64}$/u,
});

class BuilderEditAttemptError extends Error {
  constructor() {
    super('The file edit attempt could not be verified.');
    this.name = 'BuilderEditAttemptError';
    this.code = 'builder_edit_attempt_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderEditAttemptError(); }

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some((key) => typeof key !== 'string' || !keys.includes(key))) fail();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
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

function safeDigest(value) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) fail();
  return value;
}

function safeId(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function operationSummary(plan) {
  const summary = { create_count: 0, update_count: 0, delete_count: 0 };
  for (const operation of plan.file_operations) summary[`${operation.operation}_count`] += 1;
  return freezeDeep(summary);
}

function attemptBody(candidate, plan, report, attemptedAtMs) {
  return freezeDeep({
    attempt_version: BUILDER_EDIT_ATTEMPT_VERSION,
    edit_intent_plan_id: plan.edit_intent_plan_id,
    plan_digest: plan.plan_digest,
    guard_report_id: report.guard_report_id,
    guard_report_digest: report.report_digest,
    project_id: candidate.project_id,
    conversation_id: candidate.conversation_id,
    turn_id: candidate.turn_id,
    task_id: candidate.task_id,
    run_id: candidate.run_id,
    candidate_id: candidate.candidate_id,
    candidate_digest: candidate.candidate_digest,
    attempt_number: 1,
    status: 'succeeded',
    changed_paths: [...plan.target_paths],
    operation_summary: operationSummary(plan),
    expected_old_verification: 'candidate_base_and_fresh_workspace_verified',
    conflict_summary: null,
    base_tree_digest: candidate.base_source_tree.source_tree_digest,
    resulting_tree_digest: candidate.resulting_tree_digest,
    attempted_at_ms: attemptedAtMs,
    authority: { ...AUTHORITY },
  });
}

function assertBindings(candidate, plan, report) {
  if (
    report.status !== 'allowed'
    || plan.project_id !== candidate.project_id
    || plan.conversation_id !== candidate.conversation_id
    || plan.turn_id !== candidate.turn_id
    || plan.task_id !== candidate.task_id
    || plan.run_id !== candidate.run_id
    || plan.candidate_id !== candidate.candidate_id
    || plan.candidate_digest !== candidate.candidate_digest
    || plan.base_source_tree_digest !== candidate.base_source_tree.source_tree_digest
    || report.edit_intent_plan_id !== plan.edit_intent_plan_id
    || report.plan_digest !== plan.plan_digest
    || report.project_id !== candidate.project_id
    || report.run_id !== candidate.run_id
    || report.candidate_id !== candidate.candidate_id
    || report.candidate_digest !== candidate.candidate_digest
    || report.observed_workspace_source_tree_digest !== candidate.base_source_tree.source_tree_digest
    || report.decisions.length !== plan.file_operations.length
    || report.decisions.some((decision, index) => (
      decision.decision !== 'allowed'
      || decision.path !== plan.file_operations[index].path
      || decision.operation !== plan.file_operations[index].operation
    ))
  ) fail();
}

function createBuilderEditAttempt(rawInput) {
  exactObject(rawInput, CREATE_KEYS);
  let candidate;
  let plan;
  let report;
  try {
    candidate = sanitizeBuilderCodeChangeCandidate(valueAt(rawInput, 'candidate'));
    plan = sanitizeBuilderEditIntentPlan(valueAt(rawInput, 'edit_intent_plan'));
    report = sanitizeBuilderWorkspaceGuardReport(valueAt(rawInput, 'workspace_guard_report'));
  } catch { fail(); }
  assertBindings(candidate, plan, report);
  const body = attemptBody(candidate, plan, report, safeTimestamp(valueAt(rawInput, 'attempted_at_ms')));
  const digest = sha256Canonical(body);
  return freezeDeep({
    ...body,
    edit_attempt_id: `builder-edit-attempt:${digest.slice('sha256:'.length)}`,
    edit_attempt_digest: digest,
  });
}

function sanitizeOperationSummary(value) {
  exactObject(value, OPERATION_SUMMARY_KEYS);
  const summary = {};
  for (const key of OPERATION_SUMMARY_KEYS) {
    const count = valueAt(value, key);
    if (!Number.isSafeInteger(count) || count < 0 || count > 256) fail();
    summary[key] = count;
  }
  return freezeDeep(summary);
}

function sanitizeAuthority(value) {
  exactObject(value, AUTHORITY_KEYS);
  for (const [key, expected] of Object.entries(AUTHORITY)) {
    if (valueAt(value, key) !== expected) fail();
  }
  return freezeDeep({ ...AUTHORITY });
}

function sanitizeBuilderEditAttempt(value) {
  exactObject(value, ATTEMPT_KEYS);
  const changedPaths = valueAt(value, 'changed_paths');
  if (!Array.isArray(changedPaths) || utilTypes.isProxy(changedPaths) || changedPaths.length < 1 || changedPaths.length > 256) fail();
  const safePaths = changedPaths.map((path) => {
    try {
      return createBuilderProjectSourceTree({ files: [{ path, content: 'path validation\n' }] })
        .files[0].path;
    } catch { fail(); }
  });
  if (new Set(safePaths.map((path) => path.normalize('NFKC').toUpperCase())).size !== safePaths.length) fail();
  const body = freezeDeep({
    attempt_version: valueAt(value, 'attempt_version'),
    edit_intent_plan_id: safeId(valueAt(value, 'edit_intent_plan_id'), ID_PATTERNS.plan),
    plan_digest: safeDigest(valueAt(value, 'plan_digest')),
    guard_report_id: safeId(valueAt(value, 'guard_report_id'), ID_PATTERNS.report),
    guard_report_digest: safeDigest(valueAt(value, 'guard_report_digest')),
    project_id: safeId(valueAt(value, 'project_id'), ID_PATTERNS.project),
    conversation_id: safeId(valueAt(value, 'conversation_id'), ID_PATTERNS.conversation),
    turn_id: safeId(valueAt(value, 'turn_id'), ID_PATTERNS.turn),
    task_id: safeId(valueAt(value, 'task_id'), ID_PATTERNS.task),
    run_id: safeId(valueAt(value, 'run_id'), ID_PATTERNS.run),
    candidate_id: safeId(valueAt(value, 'candidate_id'), ID_PATTERNS.candidate),
    candidate_digest: safeDigest(valueAt(value, 'candidate_digest')),
    attempt_number: valueAt(value, 'attempt_number'),
    status: valueAt(value, 'status'),
    changed_paths: safePaths,
    operation_summary: sanitizeOperationSummary(valueAt(value, 'operation_summary')),
    expected_old_verification: valueAt(value, 'expected_old_verification'),
    conflict_summary: valueAt(value, 'conflict_summary'),
    base_tree_digest: safeDigest(valueAt(value, 'base_tree_digest')),
    resulting_tree_digest: safeDigest(valueAt(value, 'resulting_tree_digest')),
    attempted_at_ms: safeTimestamp(valueAt(value, 'attempted_at_ms')),
    authority: sanitizeAuthority(valueAt(value, 'authority')),
  });
  if (
    body.attempt_version !== BUILDER_EDIT_ATTEMPT_VERSION
    || body.attempt_number !== 1
    || body.status !== 'succeeded'
    || body.expected_old_verification !== 'candidate_base_and_fresh_workspace_verified'
    || body.conflict_summary !== null
    || body.operation_summary.create_count + body.operation_summary.update_count
      + body.operation_summary.delete_count !== body.changed_paths.length
  ) fail();
  const digest = safeDigest(valueAt(value, 'edit_attempt_digest'));
  const id = valueAt(value, 'edit_attempt_id');
  if (
    typeof id !== 'string'
    || !ATTEMPT_ID_PATTERN.test(id)
    || digest !== sha256Canonical(body)
    || id !== `builder-edit-attempt:${digest.slice('sha256:'.length)}`
  ) fail();
  return freezeDeep({ ...body, edit_attempt_id: id, edit_attempt_digest: digest });
}

function projectBuilderEditAttemptRef(rawAttempt) {
  const attempt = sanitizeBuilderEditAttempt(rawAttempt);
  return freezeDeep({
    edit_attempt_id: attempt.edit_attempt_id,
    edit_attempt_digest: attempt.edit_attempt_digest,
    status: attempt.status,
    candidate_id: attempt.candidate_id,
    candidate_digest: attempt.candidate_digest,
    resulting_tree_digest: attempt.resulting_tree_digest,
  });
}

module.exports = freezeDeep({
  BUILDER_EDIT_ATTEMPT_VERSION,
  BuilderEditAttemptError,
  createBuilderEditAttempt,
  sanitizeBuilderEditAttempt,
  projectBuilderEditAttemptRef,
});
