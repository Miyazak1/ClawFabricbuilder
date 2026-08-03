'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  BuilderAgentTaskContextSnapshotError,
  sanitizeBuilderAgentTaskContextSnapshot,
} = require('./builder-agent-task-context-snapshot.cjs');

const BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_VERSION =
  'builder-agent-supervised-action-admission.v1';
const SUPERVISED_ACTION_ADMISSION_KIND = 'builder_agent_supervised_action_admission';
const ADMISSION_ID_PREFIX = 'builder-agent-supervised-action-admission:';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const ACTION_REQUEST_ID_PATTERN = new RegExp(
  `^builder-agent-action-request:${UUID_SOURCE}$`,
  'u',
);
const ADMISSION_ID_PATTERN = /^builder-agent-supervised-action-admission:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const INPUT_KEYS = Object.freeze([
  'context_snapshot',
  'action_request_id',
  'requested_next_action',
  'run_status',
  'interrupt_requested',
  'cancel_requested',
  'admitted_at_ms',
]);
const ADMISSION_KEYS = Object.freeze([
  'admission_version',
  'admission_kind',
  'admission_id',
  'action_request_id',
  'requested_next_action',
  'next_gate',
  'snapshot_id',
  'context_digest',
  'definition_digest',
  'assignment_id',
  'assignment_status_id',
  'lease_id',
  'budget_audit_id',
  'agent_id',
  'agent_version_id',
  'owner_id',
  'project_id',
  'conversation_id',
  'task_id',
  'run_id',
  'budget_audit_observed_at_ms',
  'snapshot_created_at_ms',
  'admitted_at_ms',
  'context_ref_counts',
  'token_budget',
  'lifecycle',
  'authority',
  'admission_digest',
]);
const COUNT_KEYS = Object.freeze([
  'included_memory_count',
  'included_message_count',
  'included_artifact_count',
  'included_run_event_count',
  'included_permission_count',
  'parent_context_included',
  'base_revision_included',
]);
const TOKEN_BUDGET_KEYS = Object.freeze([
  'max_input_tokens',
  'reserved_output_tokens',
  'selection_policy',
]);
const LIFECYCLE_KEYS = Object.freeze([
  'context_snapshot_admission',
  'supervised_action_admission',
  'provider_dispatch',
  'tool_call_admission',
  'source_context_admission',
  'result_for_review_admission',
  'materialization_admission',
]);
const AUTHORITY_KEYS = Object.freeze([
  'admission_authority',
  'context_snapshot_authority',
  'budget_authority',
  'lease_authority',
  'renderer_authority',
  'ipc_authority',
  'provider_dispatch',
  'model_dispatch',
  'tool_dispatch',
  'permission_grant_authority',
  'credential_storage',
  'source_access',
  'source_read',
  'source_write',
  'process_run',
  'network_access',
  'revision_authority',
  'review_authority',
  'artifact_authority',
  'raw_context_storage',
]);
const ACTIONS = Object.freeze(['start_step', 'call_tool', 'read_private_source', 'finish_for_review']);
const NEXT_GATES = Object.freeze({
  start_step: 'agent_step_runner_required_later',
  call_tool: 'tool_call_record_required_later',
  read_private_source: 'source_context_collector_required_later',
  finish_for_review: 'project_work_result_required_later',
});
const LIFECYCLE = Object.freeze({
  context_snapshot_admission: 'verified_context_snapshot_receipt',
  supervised_action_admission: 'bounded_main_admission_only',
  provider_dispatch: 'not_started',
  tool_call_admission: 'required_later_for_tool_actions',
  source_context_admission: 'required_later_for_private_source',
  result_for_review_admission: 'required_later_for_finish',
  materialization_admission: 'not_created',
});
const AUTHORITY = Object.freeze({
  admission_authority: 'main_agent_supervised_action_admission_contract_v1',
  context_snapshot_authority: 'main_agent_task_context_snapshot_contract_v1',
  budget_authority: 'main_agent_budget_audit_contract_v1',
  lease_authority: 'main_agent_supervision_lease_contract_v1',
  renderer_authority: 'not_present',
  ipc_authority: 'not_present',
  provider_dispatch: false,
  model_dispatch: false,
  tool_dispatch: false,
  permission_grant_authority: false,
  credential_storage: 'not_present',
  source_access: 'not_present',
  source_read: 'not_present',
  source_write: 'not_present',
  process_run: false,
  network_access: false,
  revision_authority: false,
  review_authority: false,
  artifact_authority: false,
  raw_context_storage: false,
});

class BuilderAgentSupervisedActionAdmissionError extends Error {
  constructor() {
    super('Builder agent supervised action admission could not be verified.');
    this.name = 'BuilderAgentSupervisedActionAdmissionError';
    this.code = 'builder_agent_supervised_action_admission_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderAgentSupervisedActionAdmissionError();
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function isPlainObject(value) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || utilTypes.isProxy(value)
  ) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail();
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

function safeNonNegativeInteger(value, max) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) fail();
  return value;
}

function safeInteger(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail();
  return value;
}

function safeBoolean(value) {
  if (typeof value !== 'boolean') fail();
  return value;
}

function safeAction(value) {
  if (typeof value !== 'string' || !ACTIONS.includes(value)) fail();
  return value;
}

function safeActionRequestId(value) {
  return safePattern(value, ACTION_REQUEST_ID_PATTERN);
}

function safeAdmissionId(value) {
  return safePattern(value, ADMISSION_ID_PATTERN);
}

function safeDigest(value) {
  return safePattern(value, DIGEST_PATTERN);
}

function safeTokenBudget(value) {
  const source = exactObject(value, TOKEN_BUDGET_KEYS);
  const selectionPolicy = valueAt(source, 'selection_policy');
  if (selectionPolicy !== 'deterministic_task_local_budget_v1') fail();
  return freezeDeep({
    max_input_tokens: safeInteger(valueAt(source, 'max_input_tokens'), 1_024, 256_000),
    reserved_output_tokens: safeInteger(valueAt(source, 'reserved_output_tokens'), 1, 64_000),
    selection_policy: selectionPolicy,
  });
}

function safeContextCounts(value) {
  const source = exactObject(value, COUNT_KEYS);
  return freezeDeep({
    included_memory_count: safeNonNegativeInteger(valueAt(source, 'included_memory_count'), 16),
    included_message_count: safeNonNegativeInteger(valueAt(source, 'included_message_count'), 32),
    included_artifact_count: safeNonNegativeInteger(valueAt(source, 'included_artifact_count'), 16),
    included_run_event_count: safeNonNegativeInteger(valueAt(source, 'included_run_event_count'), 32),
    included_permission_count: safeNonNegativeInteger(valueAt(source, 'included_permission_count'), 8),
    parent_context_included: safeBoolean(valueAt(source, 'parent_context_included')),
    base_revision_included: safeBoolean(valueAt(source, 'base_revision_included')),
  });
}

function safeLifecycle(value) {
  const source = exactObject(value, LIFECYCLE_KEYS);
  for (const key of LIFECYCLE_KEYS) {
    if (valueAt(source, key) !== LIFECYCLE[key]) fail();
  }
  return freezeDeep({ ...LIFECYCLE });
}

function safeAuthority(value) {
  const source = exactObject(value, AUTHORITY_KEYS);
  for (const key of AUTHORITY_KEYS) {
    if (valueAt(source, key) !== AUTHORITY[key]) fail();
  }
  return freezeDeep({ ...AUTHORITY });
}

function admissionDigestBody(value) {
  return freezeDeep({
    action_request_id: value.action_request_id,
    admitted_at_ms: value.admitted_at_ms,
    admission_kind: value.admission_kind,
    admission_version: value.admission_version,
    authority: value.authority,
    budget_audit_id: value.budget_audit_id,
    budget_audit_observed_at_ms: value.budget_audit_observed_at_ms,
    context_digest: value.context_digest,
    context_ref_counts: value.context_ref_counts,
    lifecycle: value.lifecycle,
    next_gate: value.next_gate,
    requested_next_action: value.requested_next_action,
    run_id: value.run_id,
    snapshot_created_at_ms: value.snapshot_created_at_ms,
    snapshot_id: value.snapshot_id,
    task_id: value.task_id,
    token_budget: value.token_budget,
  });
}

function admissionIdFor(admissionDigest) {
  return `${ADMISSION_ID_PREFIX}${admissionDigest.slice('sha256:'.length)}`;
}

function contextCounts(snapshot) {
  return freezeDeep({
    included_memory_count: snapshot.included_memory_ids.length,
    included_message_count: snapshot.included_message_ids.length,
    included_artifact_count: snapshot.included_artifact_ids.length,
    included_run_event_count: snapshot.included_run_event_ids.length,
    included_permission_count: snapshot.included_permission_ids.length,
    parent_context_included: snapshot.parent_task_context_projection.status === 'included',
    base_revision_included: snapshot.base_project_revision.status === 'available',
  });
}

function actionAdmissionBody(snapshot, actionRequestId, admittedAtMs) {
  return freezeDeep({
    admission_version: BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_VERSION,
    admission_kind: SUPERVISED_ACTION_ADMISSION_KIND,
    action_request_id: actionRequestId,
    requested_next_action: snapshot.action_admission.requested_next_action,
    next_gate: NEXT_GATES[snapshot.action_admission.requested_next_action],
    snapshot_id: snapshot.snapshot_id,
    context_digest: snapshot.context_digest,
    definition_digest: snapshot.definition_digest,
    assignment_id: snapshot.assignment_id,
    assignment_status_id: snapshot.assignment_status_id,
    lease_id: snapshot.lease_id,
    budget_audit_id: snapshot.budget_audit_id,
    agent_id: snapshot.agent_id,
    agent_version_id: snapshot.agent_version_id,
    owner_id: snapshot.owner_id,
    project_id: snapshot.project_id,
    conversation_id: snapshot.conversation_id,
    task_id: snapshot.task_id,
    run_id: snapshot.run_id,
    budget_audit_observed_at_ms: snapshot.action_admission.budget_audit_observed_at_ms,
    snapshot_created_at_ms: snapshot.created_at_ms,
    admitted_at_ms: admittedAtMs,
    context_ref_counts: contextCounts(snapshot),
    token_budget: snapshot.token_budget,
    lifecycle: freezeDeep({ ...LIFECYCLE }),
    authority: freezeDeep({ ...AUTHORITY }),
  });
}

function createBuilderAgentSupervisedActionAdmission(rawInput) {
  try {
    const input = exactObject(rawInput, INPUT_KEYS);
    const actionRequestId = safeActionRequestId(valueAt(input, 'action_request_id'));
    const requestedNextAction = safeAction(valueAt(input, 'requested_next_action'));
    const admittedAtMs = safeTimestamp(valueAt(input, 'admitted_at_ms'));
    if (
      valueAt(input, 'run_status') !== 'running'
      || valueAt(input, 'interrupt_requested') !== false
      || valueAt(input, 'cancel_requested') !== false
    ) fail();
    const snapshot = sanitizeBuilderAgentTaskContextSnapshot(valueAt(input, 'context_snapshot'));
    if (
      requestedNextAction !== snapshot.action_admission.requested_next_action
      || admittedAtMs < snapshot.created_at_ms
    ) fail();
    const body = actionAdmissionBody(snapshot, actionRequestId, admittedAtMs);
    const admissionDigest = sha256Canonical(admissionDigestBody(body));
    return freezeDeep({
      ...body,
      admission_id: admissionIdFor(admissionDigest),
      admission_digest: admissionDigest,
    });
  } catch (error) {
    if (
      error instanceof BuilderAgentSupervisedActionAdmissionError
      || error instanceof BuilderAgentTaskContextSnapshotError
    ) fail();
    throw error;
  }
}

function sanitizeBuilderAgentSupervisedActionAdmission(rawAdmission, expected = null) {
  try {
    const source = exactObject(rawAdmission, ADMISSION_KEYS);
    const admissionVersion = valueAt(source, 'admission_version');
    const admissionKind = valueAt(source, 'admission_kind');
    if (
      admissionVersion !== BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_VERSION
      || admissionKind !== SUPERVISED_ACTION_ADMISSION_KIND
    ) fail();
    const requestedNextAction = safeAction(valueAt(source, 'requested_next_action'));
    const nextGate = valueAt(source, 'next_gate');
    if (nextGate !== NEXT_GATES[requestedNextAction]) fail();
    const snapshotId = safePattern(
      valueAt(source, 'snapshot_id'),
      /^builder-agent-task-context-snapshot:[0-9a-f]{64}$/u,
    );
    const normalized = freezeDeep({
      admission_version: admissionVersion,
      admission_kind: admissionKind,
      action_request_id: safeActionRequestId(valueAt(source, 'action_request_id')),
      requested_next_action: requestedNextAction,
      next_gate: nextGate,
      snapshot_id: snapshotId,
      context_digest: safeDigest(valueAt(source, 'context_digest')),
      definition_digest: safeDigest(valueAt(source, 'definition_digest')),
      assignment_id: safePattern(
        valueAt(source, 'assignment_id'),
        /^builder-agent-assignment:[0-9a-f]{64}$/u,
      ),
      assignment_status_id: safePattern(
        valueAt(source, 'assignment_status_id'),
        /^builder-agent-assignment-status:[0-9a-f]{64}$/u,
      ),
      lease_id: safePattern(
        valueAt(source, 'lease_id'),
        /^builder-agent-supervision-lease:[0-9a-f]{64}$/u,
      ),
      budget_audit_id: safePattern(
        valueAt(source, 'budget_audit_id'),
        /^builder-agent-budget-audit:[0-9a-f]{64}$/u,
      ),
      agent_id: safePattern(valueAt(source, 'agent_id'), new RegExp(`^builder-agent:${UUID_SOURCE}$`, 'u')),
      agent_version_id: safePattern(
        valueAt(source, 'agent_version_id'),
        /^builder-agent-version:[0-9a-f]{64}$/u,
      ),
      owner_id: safePattern(valueAt(source, 'owner_id'), new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u')),
      project_id: safePattern(valueAt(source, 'project_id'), new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u')),
      conversation_id: safePattern(
        valueAt(source, 'conversation_id'),
        new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u'),
      ),
      task_id: safePattern(valueAt(source, 'task_id'), new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u')),
      run_id: safePattern(valueAt(source, 'run_id'), new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u')),
      budget_audit_observed_at_ms: safeTimestamp(valueAt(source, 'budget_audit_observed_at_ms')),
      snapshot_created_at_ms: safeTimestamp(valueAt(source, 'snapshot_created_at_ms')),
      admitted_at_ms: safeTimestamp(valueAt(source, 'admitted_at_ms')),
      context_ref_counts: safeContextCounts(valueAt(source, 'context_ref_counts')),
      token_budget: safeTokenBudget(valueAt(source, 'token_budget')),
      lifecycle: safeLifecycle(valueAt(source, 'lifecycle')),
      authority: safeAuthority(valueAt(source, 'authority')),
    });
    if (
      normalized.budget_audit_observed_at_ms > normalized.snapshot_created_at_ms
      || normalized.snapshot_created_at_ms > normalized.admitted_at_ms
    ) fail();
    if (expected !== null) {
      exactObject(expected, ['snapshot_id', 'context_digest', 'requested_next_action']);
      if (
        normalized.snapshot_id !== valueAt(expected, 'snapshot_id')
        || normalized.context_digest !== valueAt(expected, 'context_digest')
        || normalized.requested_next_action !== valueAt(expected, 'requested_next_action')
      ) fail();
    }
    const admissionDigest = safeDigest(valueAt(source, 'admission_digest'));
    const admissionId = safeAdmissionId(valueAt(source, 'admission_id'));
    if (
      admissionDigest !== sha256Canonical(admissionDigestBody(normalized))
      || admissionId !== admissionIdFor(admissionDigest)
    ) fail();
    return freezeDeep({
      ...normalized,
      admission_id: admissionId,
      admission_digest: admissionDigest,
    });
  } catch (error) {
    if (error instanceof BuilderAgentSupervisedActionAdmissionError) fail();
    throw error;
  }
}

module.exports = Object.freeze({
  BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_VERSION,
  SUPERVISED_ACTION_ADMISSION_KIND,
  BuilderAgentSupervisedActionAdmissionError,
  createBuilderAgentSupervisedActionAdmission,
  sanitizeBuilderAgentSupervisedActionAdmission,
});
