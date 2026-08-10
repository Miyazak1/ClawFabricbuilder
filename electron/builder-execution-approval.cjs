'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderApprovedPlanContinuationAdmission,
} = require('./builder-approved-plan-continuation-admission.cjs');
const {
  builderProjectUnderstandingSnapshotDigest,
  sanitizeBuilderProjectUnderstandingSnapshot,
} = require('./builder-project-understanding.cjs');

const BUILDER_EXECUTION_APPROVAL_VERSION = 'builder-execution-approval.v1';
const BUILDER_EXECUTION_APPROVAL_KIND = 'builder_execution_approval';
const INPUT_KEYS = Object.freeze([
  'approved_plan_continuation',
  'write_permission_decision',
  'provider_config_digest',
  'source_tree_digest',
  'project_understanding',
  'approved_at_ms',
  'expires_at_ms',
]);
const RECORD_KEYS = Object.freeze([
  'approval_version',
  'approval_kind',
  'approval_id',
  'project_id',
  'conversation_id',
  'approved_plan_turn_id',
  'approved_plan_task_id',
  'approved_plan_run_id',
  'approved_subject',
  'approved_subject_digest',
  'conversation_head_digest',
  'source_tree_digest',
  'project_understanding_ref',
  'permission_mode',
  'permission_decision_ref',
  'provider_config_digest',
  'approved_at_ms',
  'expires_at_ms',
  'lifecycle',
  'authority',
  'approval_digest',
]);
const PERMISSION_DECISION_KEYS = Object.freeze([
  'decision_version',
  'policy_version',
  'actor_id',
  'action',
  'resource',
  'evaluated_at_ms',
  'decision',
  'reason',
  'permission_id',
  'permission_authority',
  'ui_selection_authority',
]);
const PERMISSION_RESOURCE_KEYS = Object.freeze(['resource_kind', 'project_id', 'resource_id']);
const PERMISSION_DECISION_REF_KEYS = Object.freeze([
  'decision_version',
  'policy_version',
  'permission_id',
  'evaluated_at_ms',
  'permission_authority',
]);
const PROJECT_UNDERSTANDING_RECORD_KEYS = Object.freeze([
  'snapshot_digest',
  'project_understanding_snapshot',
]);
const PROJECT_UNDERSTANDING_REF_KEYS = Object.freeze([
  'snapshot_digest',
  'source_tree_digest',
  'updated_at_ms',
]);
const LIFECYCLE_KEYS = Object.freeze([
  'approved_plan',
  'write_permission',
  'provider_config',
  'source_state',
  'provider_dispatch',
  'source_mutation',
  'save_version',
]);
const AUTHORITY_KEYS = Object.freeze([
  'approval_authority',
  'approved_plan_authority',
  'permission_authority',
  'provider_config_authority',
  'renderer_authority',
  'provider_dispatch',
  'source_mutation',
  'save_version_authority',
]);
const LIFECYCLE = Object.freeze({
  approved_plan: 'fresh_current_head_verified',
  write_permission: 'main_permission_decision_allowed',
  provider_config: 'digest_bound_before_dispatch',
  source_state: 'current_source_tree_digest_bound',
  provider_dispatch: 'not_started',
  source_mutation: 'not_performed',
  save_version: 'not_authorized',
});
const AUTHORITY = Object.freeze({
  approval_authority: 'main_execution_approval_contract_v1',
  approved_plan_authority: 'sqlite_current_head_approved_plan',
  permission_authority: 'main_owned_permission_fact_evaluator',
  provider_config_authority: 'main_owned_provider_config_digest',
  renderer_authority: 'not_present',
  provider_dispatch: false,
  source_mutation: 'not_performed',
  save_version_authority: 'not_present',
});
const PROJECT_ID_PATTERN = /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONVERSATION_ID_PATTERN = /^builder-conversation:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TURN_ID_PATTERN = /^builder-turn:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TASK_ID_PATTERN = /^builder-task:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RUN_ID_PATTERN = /^builder-run:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ACTOR_ID_PATTERN = /^builder-user:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PERMISSION_ID_PATTERN = /^builder-permission:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const APPROVAL_ID_PATTERN = /^builder-execution-approval:[0-9a-f]{64}$/u;
const PROJECT_UNDERSTANDING_SNAPSHOT_DIGEST_PATTERN =
  /^builder-project-understanding-snapshot:[0-9a-f]{64}$/u;

class BuilderExecutionApprovalError extends Error {
  constructor() {
    super('The approved plan execution could not be verified.');
    this.name = 'BuilderExecutionApprovalError';
    this.code = 'builder_execution_approval_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderExecutionApprovalError(); }

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
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) fail();
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
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`).join(',')}}`;
  }
  fail();
}

function sha256Canonical(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function digestHex(value) { return sha256Canonical(value).slice('sha256:'.length); }

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function sanitizePermissionDecision(value, projectId, approvedAtMs) {
  const source = exactObject(value, PERMISSION_DECISION_KEYS);
  const resource = exactObject(valueAt(source, 'resource'), PERMISSION_RESOURCE_KEYS);
  const evaluatedAtMs = safeTimestamp(valueAt(source, 'evaluated_at_ms'));
  if (
    valueAt(source, 'decision_version') !== 'builder-permission-decision.v1'
    || valueAt(source, 'policy_version') !== 'builder-permission-policy.v1'
    || safePattern(valueAt(source, 'actor_id'), ACTOR_ID_PATTERN)
      !== 'builder-user:00000000-0000-4000-8000-000000000001'
    || valueAt(source, 'action') !== 'project.edit'
    || valueAt(resource, 'resource_kind') !== 'project'
    || valueAt(resource, 'project_id') !== projectId
    || valueAt(resource, 'resource_id') !== 'project:self'
    || valueAt(source, 'decision') !== 'allowed'
    || valueAt(source, 'reason') !== 'matching_active_grant'
    || valueAt(source, 'permission_authority') !== 'builder_permission_facts_deny_by_default_v1'
    || valueAt(source, 'ui_selection_authority') !== 'not_permission'
    || evaluatedAtMs > approvedAtMs
  ) fail();
  return freezeDeep({
    decision_version: 'builder-permission-decision.v1',
    policy_version: 'builder-permission-policy.v1',
    permission_id: safePattern(valueAt(source, 'permission_id'), PERMISSION_ID_PATTERN),
    evaluated_at_ms: evaluatedAtMs,
    permission_authority: 'builder_permission_facts_deny_by_default_v1',
  });
}

function sanitizeProjectUnderstandingRef(value, projectId, sourceTreeDigest, approvedAtMs) {
  if (value === null) return null;
  const source = exactObject(value, PROJECT_UNDERSTANDING_RECORD_KEYS);
  const snapshot = sanitizeBuilderProjectUnderstandingSnapshot(
    valueAt(source, 'project_understanding_snapshot'),
  );
  const snapshotDigest = safePattern(
    valueAt(source, 'snapshot_digest'),
    PROJECT_UNDERSTANDING_SNAPSHOT_DIGEST_PATTERN,
  );
  if (
    snapshot.project_id !== projectId
    || snapshot.source_tree_digest !== sourceTreeDigest
    || snapshot.updated_at_ms > approvedAtMs
    || builderProjectUnderstandingSnapshotDigest(snapshot) !== snapshotDigest
  ) fail();
  return freezeDeep({
    snapshot_digest: snapshotDigest,
    source_tree_digest: snapshot.source_tree_digest,
    updated_at_ms: snapshot.updated_at_ms,
  });
}

function sanitizeProjectUnderstandingReference(value, projectId, sourceTreeDigest, approvedAtMs) {
  if (value === null) return null;
  const source = exactObject(value, PROJECT_UNDERSTANDING_REF_KEYS);
  const updatedAtMs = safeTimestamp(valueAt(source, 'updated_at_ms'));
  const snapshotDigest = safePattern(
    valueAt(source, 'snapshot_digest'),
    PROJECT_UNDERSTANDING_SNAPSHOT_DIGEST_PATTERN,
  );
  if (
    safePattern(valueAt(source, 'source_tree_digest'), DIGEST_PATTERN) !== sourceTreeDigest
    || updatedAtMs > approvedAtMs
  ) fail();
  return freezeDeep({ snapshot_digest: snapshotDigest, source_tree_digest: sourceTreeDigest, updated_at_ms: updatedAtMs });
}

function sanitizeLifecycle(value) {
  const source = exactObject(value, LIFECYCLE_KEYS);
  for (const key of LIFECYCLE_KEYS) if (valueAt(source, key) !== LIFECYCLE[key]) fail();
  return freezeDeep({ ...LIFECYCLE });
}

function sanitizeAuthority(value) {
  const source = exactObject(value, AUTHORITY_KEYS);
  for (const key of AUTHORITY_KEYS) if (valueAt(source, key) !== AUTHORITY[key]) fail();
  return freezeDeep({ ...AUTHORITY });
}

function approvalBody(value) {
  const body = { ...value };
  delete body.approval_id;
  delete body.approval_digest;
  return body;
}

function createBuilderExecutionApproval(rawInput) {
  try {
    const input = exactObject(rawInput, INPUT_KEYS);
    const continuation = sanitizeBuilderApprovedPlanContinuationAdmission(
      valueAt(input, 'approved_plan_continuation'),
    );
    const approvedAtMs = safeTimestamp(valueAt(input, 'approved_at_ms'));
    const expiresAtMs = safeTimestamp(valueAt(input, 'expires_at_ms'));
    if (expiresAtMs <= approvedAtMs || expiresAtMs - approvedAtMs > 60_000) fail();
    const sourceTreeDigest = safePattern(valueAt(input, 'source_tree_digest'), DIGEST_PATTERN);
    const unsigned = freezeDeep({
      approval_version: BUILDER_EXECUTION_APPROVAL_VERSION,
      approval_kind: BUILDER_EXECUTION_APPROVAL_KIND,
      project_id: continuation.project_id,
      conversation_id: continuation.conversation_id,
      approved_plan_turn_id: continuation.turn_id,
      approved_plan_task_id: continuation.task_id,
      approved_plan_run_id: continuation.run_id,
      approved_subject: 'approved_plan',
      approved_subject_digest: continuation.plan_result_digest,
      conversation_head_digest: continuation.conversation_head_digest,
      source_tree_digest: sourceTreeDigest,
      project_understanding_ref: sanitizeProjectUnderstandingRef(
        valueAt(input, 'project_understanding'),
        continuation.project_id,
        sourceTreeDigest,
        approvedAtMs,
      ),
      permission_mode: 'current_project_write',
      permission_decision_ref: sanitizePermissionDecision(
        valueAt(input, 'write_permission_decision'),
        continuation.project_id,
        approvedAtMs,
      ),
      provider_config_digest: safePattern(valueAt(input, 'provider_config_digest'), DIGEST_PATTERN),
      approved_at_ms: approvedAtMs,
      expires_at_ms: expiresAtMs,
      lifecycle: { ...LIFECYCLE },
      authority: { ...AUTHORITY },
    });
    const approvalDigest = sha256Canonical(unsigned);
    return freezeDeep({
      ...unsigned,
      approval_id: `builder-execution-approval:${digestHex(unsigned)}`,
      approval_digest: approvalDigest,
    });
  } catch (error) {
    if (error instanceof BuilderExecutionApprovalError) throw error;
    fail();
  }
}

function sanitizeBuilderExecutionApproval(rawValue) {
  try {
    const source = exactObject(rawValue, RECORD_KEYS);
    const projectId = safePattern(valueAt(source, 'project_id'), PROJECT_ID_PATTERN);
    const conversationId = safePattern(valueAt(source, 'conversation_id'), CONVERSATION_ID_PATTERN);
    if (conversationId.slice('builder-conversation:'.length) !== projectId.slice('builder-project:'.length)) fail();
    const approvedAtMs = safeTimestamp(valueAt(source, 'approved_at_ms'));
    const expiresAtMs = safeTimestamp(valueAt(source, 'expires_at_ms'));
    if (expiresAtMs <= approvedAtMs || expiresAtMs - approvedAtMs > 60_000) fail();
    const sourceTreeDigest = safePattern(valueAt(source, 'source_tree_digest'), DIGEST_PATTERN);
    const normalized = freezeDeep({
      approval_version: valueAt(source, 'approval_version'),
      approval_kind: valueAt(source, 'approval_kind'),
      approval_id: safePattern(valueAt(source, 'approval_id'), APPROVAL_ID_PATTERN),
      project_id: projectId,
      conversation_id: conversationId,
      approved_plan_turn_id: safePattern(valueAt(source, 'approved_plan_turn_id'), TURN_ID_PATTERN),
      approved_plan_task_id: safePattern(valueAt(source, 'approved_plan_task_id'), TASK_ID_PATTERN),
      approved_plan_run_id: safePattern(valueAt(source, 'approved_plan_run_id'), RUN_ID_PATTERN),
      approved_subject: valueAt(source, 'approved_subject'),
      approved_subject_digest: safePattern(valueAt(source, 'approved_subject_digest'), DIGEST_PATTERN),
      conversation_head_digest: safePattern(valueAt(source, 'conversation_head_digest'), DIGEST_PATTERN),
      source_tree_digest: sourceTreeDigest,
      project_understanding_ref: sanitizeProjectUnderstandingReference(
        valueAt(source, 'project_understanding_ref'),
        projectId,
        sourceTreeDigest,
        approvedAtMs,
      ),
      permission_mode: valueAt(source, 'permission_mode'),
      permission_decision_ref: (() => {
        const decision = exactObject(valueAt(source, 'permission_decision_ref'), PERMISSION_DECISION_REF_KEYS);
        const evaluatedAtMs = safeTimestamp(valueAt(decision, 'evaluated_at_ms'));
        if (
          valueAt(decision, 'decision_version') !== 'builder-permission-decision.v1'
          || valueAt(decision, 'policy_version') !== 'builder-permission-policy.v1'
          || valueAt(decision, 'permission_authority') !== 'builder_permission_facts_deny_by_default_v1'
          || evaluatedAtMs > approvedAtMs
        ) fail();
        return {
          decision_version: 'builder-permission-decision.v1',
          policy_version: 'builder-permission-policy.v1',
          permission_id: safePattern(valueAt(decision, 'permission_id'), PERMISSION_ID_PATTERN),
          evaluated_at_ms: evaluatedAtMs,
          permission_authority: 'builder_permission_facts_deny_by_default_v1',
        };
      })(),
      provider_config_digest: safePattern(valueAt(source, 'provider_config_digest'), DIGEST_PATTERN),
      approved_at_ms: approvedAtMs,
      expires_at_ms: expiresAtMs,
      lifecycle: sanitizeLifecycle(valueAt(source, 'lifecycle')),
      authority: sanitizeAuthority(valueAt(source, 'authority')),
      approval_digest: safePattern(valueAt(source, 'approval_digest'), DIGEST_PATTERN),
    });
    if (
      normalized.approval_version !== BUILDER_EXECUTION_APPROVAL_VERSION
      || normalized.approval_kind !== BUILDER_EXECUTION_APPROVAL_KIND
      || normalized.approved_subject !== 'approved_plan'
      || normalized.permission_mode !== 'current_project_write'
      || normalized.approval_id !== `builder-execution-approval:${digestHex(approvalBody(normalized))}`
      || normalized.approval_digest !== sha256Canonical(approvalBody(normalized))
    ) fail();
    return normalized;
  } catch (error) {
    if (error instanceof BuilderExecutionApprovalError) throw error;
    fail();
  }
}

module.exports = Object.freeze({
  BUILDER_EXECUTION_APPROVAL_VERSION,
  BUILDER_EXECUTION_APPROVAL_KIND,
  BuilderExecutionApprovalError,
  createBuilderExecutionApproval,
  sanitizeBuilderExecutionApproval,
});
