'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_TOOL_PERMISSION_ADMISSION_VERSION,
} = require('./builder-tool-permission-admission.cjs');
const {
  BUILDER_TOOL_SESSION_POLICY_VERSION,
  sanitizeBuilderToolSessionPolicy,
} = require('./builder-tool-session-policy.cjs');

const BUILDER_TOOL_CALL_RECORD_VERSION = 'builder-tool-call-record.v1';
const TOOL_CALL_RECORD_KIND = 'builder_tool_call_record';
const INPUT_KEYS = Object.freeze([
  'project_id',
  'conversation_id',
  'turn_id',
  'task_id',
  'run_id',
  'step_id',
  'session_policy',
  'admission',
  'requested_at_ms',
]);
const RECORD_KEYS = Object.freeze([
  'record_version',
  'record_kind',
  'project_id',
  'conversation_id',
  'turn_id',
  'task_id',
  'run_id',
  'step_id',
  'tool_call_id',
  'tool_name',
  'action',
  'resource',
  'requested_at_ms',
  'session_policy',
  'permission_admission_receipt',
  'lifecycle',
  'authority',
  'record_digest',
]);
const ADMISSION_KEYS = Object.freeze([
  'admission_version',
  'tool_call_id',
  'tool_name',
  'actor_id',
  'project_id',
  'action',
  'resource',
  'evaluated_at_ms',
  'permission_decision',
  'permission_id',
  'permission_authority',
  'ui_selection_authority',
  'execution_admission',
  'admission_authority',
  'evidence_digest',
]);
const RESOURCE_KEYS = Object.freeze(['resource_kind', 'project_id', 'resource_id']);
const LIFECYCLE_KEYS = Object.freeze([
  'permission_admission',
  'session_policy_admission',
  'dispatch_admission',
  'execution_admission',
  'result_admission',
  'revision_admission',
]);
const AUTHORITY_KEYS = Object.freeze([
  'record_authority',
  'admission_authority',
  'session_policy_authority',
  'conversation_binding',
  'renderer_authority',
  'provider_dispatch',
  'credential_readback',
  'tool_dispatch',
]);
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:(${UUID_SOURCE})$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:(${UUID_SOURCE})$`, 'u');
const TURN_ID_PATTERN = new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const STEP_ID_PATTERN = new RegExp(`^builder-run-step:${UUID_SOURCE}$`, 'u');
const ACTOR_ID_PATTERN = new RegExp(`^(?:builder-user|builder-agent):${UUID_SOURCE}$`, 'u');
const TOOL_CALL_ID_PATTERN = new RegExp(`^builder-tool-call:${UUID_SOURCE}$`, 'u');
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9.-]{0,63}$/u;
const PERMISSION_ID_PATTERN = /^builder-permission:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const RESOURCE_ID_PATTERN = /^[a-z][a-z0-9._:/@-]{0,127}$/u;
const ACTION_RESOURCE_KINDS = Object.freeze({
  'context.read': Object.freeze(['project', 'conversation', 'task', 'run', 'revision', 'artifact']),
  'project.read': Object.freeze(['project', 'revision']),
  'project.edit': Object.freeze(['project']),
  'secret.read': Object.freeze(['secret']),
  'filesystem.read': Object.freeze(['filesystem']),
  'filesystem.write': Object.freeze(['filesystem']),
  'network.request': Object.freeze(['network']),
  'process.spawn': Object.freeze(['process']),
  'publication.create': Object.freeze(['publication']),
  'permission.grant': Object.freeze(['permission']),
});
const LIFECYCLE = Object.freeze({
  permission_admission: 'verified_allowed',
  session_policy_admission: 'verified_main_run_policy',
  dispatch_admission: 'not_started',
  execution_admission: 'not_performed',
  result_admission: 'not_recorded',
  revision_admission: 'not_created',
});
const AUTHORITY = Object.freeze({
  record_authority: 'main_tool_call_record_contract_v1',
  admission_authority: 'main_permission_decision_before_tool_dispatch_v1',
  session_policy_authority: 'main_tool_session_policy_contract_v1',
  conversation_binding: 'ids_only_host_replay_required',
  renderer_authority: 'not_present',
  provider_dispatch: false,
  credential_readback: false,
  tool_dispatch: 'not_performed',
});

class BuilderToolCallRecordError extends Error {
  constructor() {
    super('The tool call record could not be verified.');
    this.name = 'BuilderToolCallRecordError';
    this.code = 'builder_tool_call_record_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderToolCallRecordError();
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
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail();
    }
  }
  return descriptors;
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail();
  }
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

function safeProjectId(value) {
  return safePattern(value, PROJECT_ID_PATTERN);
}

function safeConversationId(value, projectId) {
  const conversationId = safePattern(value, CONVERSATION_ID_PATTERN);
  if (conversationId.slice('builder-conversation:'.length)
    !== projectId.slice('builder-project:'.length)) fail();
  return conversationId;
}

function safeTurnId(value) {
  return safePattern(value, TURN_ID_PATTERN);
}

function safeTaskId(value) {
  return safePattern(value, TASK_ID_PATTERN);
}

function safeRunId(value) {
  return safePattern(value, RUN_ID_PATTERN);
}

function safeStepId(value) {
  return safePattern(value, STEP_ID_PATTERN);
}

function safeActorId(value) {
  return safePattern(value, ACTOR_ID_PATTERN);
}

function safeToolCallId(value) {
  return safePattern(value, TOOL_CALL_ID_PATTERN);
}

function safeToolName(value) {
  return safePattern(value, TOOL_NAME_PATTERN);
}

function safePermissionId(value) {
  return safePattern(value, PERMISSION_ID_PATTERN);
}

function safeDigest(value) {
  return safePattern(value, DIGEST_PATTERN);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeAction(value) {
  if (typeof value !== 'string' || !Object.hasOwn(ACTION_RESOURCE_KINDS, value)) fail();
  return value;
}

function safeResourceKind(value, action) {
  if (
    typeof value !== 'string'
    || !ACTION_RESOURCE_KINDS[action].includes(value)
  ) fail();
  return value;
}

function safeResourceId(value) {
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || !RESOURCE_ID_PATTERN.test(value)
  ) fail();
  return value;
}

function sanitizeResource(value, action, projectId) {
  const descriptors = exactObject(value, RESOURCE_KEYS);
  const resource = {
    resource_kind: safeResourceKind(descriptors.resource_kind.value, action),
    project_id: safeProjectId(descriptors.project_id.value),
    resource_id: safeResourceId(descriptors.resource_id.value),
  };
  if (resource.project_id !== projectId) fail();
  return freezeDeep(resource);
}

function admissionDigestBody(value) {
  return {
    action: value.action,
    actor_id: value.actor_id,
    admission_authority: value.admission_authority,
    admission_version: value.admission_version,
    evaluated_at_ms: value.evaluated_at_ms,
    execution_admission: value.execution_admission,
    permission_authority: value.permission_authority,
    permission_decision: value.permission_decision,
    permission_id: value.permission_id,
    project_id: value.project_id,
    resource: value.resource,
    tool_call_id: value.tool_call_id,
    tool_name: value.tool_name,
    ui_selection_authority: value.ui_selection_authority,
  };
}

function sanitizePermissionAdmission(value) {
  const descriptors = exactObject(value, ADMISSION_KEYS);
  const projectId = safeProjectId(descriptors.project_id.value);
  const action = safeAction(descriptors.action.value);
  const admission = freezeDeep({
    admission_version: descriptors.admission_version.value,
    tool_call_id: safeToolCallId(descriptors.tool_call_id.value),
    tool_name: safeToolName(descriptors.tool_name.value),
    actor_id: safeActorId(descriptors.actor_id.value),
    project_id: projectId,
    action,
    resource: sanitizeResource(descriptors.resource.value, action, projectId),
    evaluated_at_ms: safeTimestamp(descriptors.evaluated_at_ms.value),
    permission_decision: descriptors.permission_decision.value,
    permission_id: safePermissionId(descriptors.permission_id.value),
    permission_authority: descriptors.permission_authority.value,
    ui_selection_authority: descriptors.ui_selection_authority.value,
    execution_admission: descriptors.execution_admission.value,
    admission_authority: descriptors.admission_authority.value,
    evidence_digest: safeDigest(descriptors.evidence_digest.value),
  });
  if (
    admission.admission_version !== BUILDER_TOOL_PERMISSION_ADMISSION_VERSION
    || admission.permission_decision !== 'allowed'
    || admission.permission_authority !== 'builder_permission_facts_deny_by_default_v1'
    || admission.ui_selection_authority !== 'not_permission'
    || admission.execution_admission !== 'permission_allowed_dispatch_not_performed'
    || admission.admission_authority !== AUTHORITY.admission_authority
    || admission.evidence_digest !== sha256Canonical(admissionDigestBody(admission))
  ) fail();
  return admission;
}

function sameRunBinding(left, right) {
  return left.project_id === right.project_id
    && left.conversation_id === right.conversation_id
    && left.turn_id === right.turn_id
    && left.task_id === right.task_id
    && left.run_id === right.run_id;
}

function sanitizeSessionPolicy(value, expected) {
  const policy = sanitizeBuilderToolSessionPolicy(value);
  if (
    policy.policy_version !== BUILDER_TOOL_SESSION_POLICY_VERSION
    || !sameRunBinding(policy, expected)
    || policy.lifecycle.tool_call_admission !== 'bounded_pre_dispatch_only'
    || policy.lifecycle.dispatch_admission !== 'not_performed_by_policy_contract'
    || policy.lifecycle.execution_admission !== 'not_performed_by_policy_contract'
    || policy.lifecycle.raw_output_admission !== 'not_included'
    || policy.lifecycle.revision_admission !== 'not_created'
    || policy.authority.policy_authority !== AUTHORITY.session_policy_authority
    || policy.authority.issuance_authority !== 'trusted_main_run_context_required'
    || policy.authority.digest_authority !== 'integrity_digest_not_issuer_proof_v1'
    || policy.authority.renderer_authority !== 'not_present'
    || policy.authority.provider_dispatch !== false
    || policy.authority.credential_readback !== false
    || policy.authority.tool_dispatch !== 'not_performed_by_policy_contract'
    || policy.authority.raw_output_storage !== 'not_present'
    || policy.authority.git_authority !== 'not_present'
    || policy.limits.max_chargeable_dispatches !== 0
  ) fail();
  return policy;
}

function sanitizeLifecycle(value) {
  const descriptors = exactObject(value, LIFECYCLE_KEYS);
  for (const key of LIFECYCLE_KEYS) {
    if (descriptors[key].value !== LIFECYCLE[key]) fail();
  }
  return freezeDeep({ ...LIFECYCLE });
}

function sanitizeAuthority(value) {
  const descriptors = exactObject(value, AUTHORITY_KEYS);
  for (const key of AUTHORITY_KEYS) {
    if (descriptors[key].value !== AUTHORITY[key]) fail();
  }
  return freezeDeep({ ...AUTHORITY });
}

function recordDigestBody(value) {
  return {
    action: value.action,
    authority: value.authority,
    conversation_id: value.conversation_id,
    lifecycle: value.lifecycle,
    permission_admission_receipt: value.permission_admission_receipt,
    project_id: value.project_id,
    record_kind: value.record_kind,
    record_version: value.record_version,
    requested_at_ms: value.requested_at_ms,
    resource: value.resource,
    run_id: value.run_id,
    session_policy: value.session_policy,
    step_id: value.step_id,
    task_id: value.task_id,
    tool_call_id: value.tool_call_id,
    tool_name: value.tool_name,
    turn_id: value.turn_id,
  };
}

function unsignedRecord({
  projectId,
  conversationId,
  turnId,
  taskId,
  runId,
  stepId,
  sessionPolicy,
  admission,
  requestedAtMs,
}) {
  if (
    admission.project_id !== projectId
    || admission.evaluated_at_ms < sessionPolicy.issued_at_ms
    || requestedAtMs < admission.evaluated_at_ms
    || requestedAtMs - admission.evaluated_at_ms > sessionPolicy.limits.max_step_timeout_ms
    || requestedAtMs - sessionPolicy.issued_at_ms > sessionPolicy.limits.max_total_timeout_ms
  ) fail();
  return freezeDeep({
    record_version: BUILDER_TOOL_CALL_RECORD_VERSION,
    record_kind: TOOL_CALL_RECORD_KIND,
    project_id: projectId,
    conversation_id: conversationId,
    turn_id: turnId,
    task_id: taskId,
    run_id: runId,
    step_id: stepId,
    tool_call_id: admission.tool_call_id,
    tool_name: admission.tool_name,
    action: admission.action,
    resource: { ...admission.resource },
    requested_at_ms: requestedAtMs,
    session_policy: sessionPolicy,
    permission_admission_receipt: admission,
    lifecycle: { ...LIFECYCLE },
    authority: { ...AUTHORITY },
  });
}

function createBuilderToolCallRecord(rawInput) {
  try {
    const descriptors = exactObject(rawInput, INPUT_KEYS);
    const projectId = safeProjectId(descriptors.project_id.value);
    const conversationId = safeConversationId(descriptors.conversation_id.value, projectId);
    const turnId = safeTurnId(descriptors.turn_id.value);
    const taskId = safeTaskId(descriptors.task_id.value);
    const runId = safeRunId(descriptors.run_id.value);
    const record = unsignedRecord({
      projectId,
      conversationId,
      turnId,
      taskId,
      runId,
      stepId: safeStepId(descriptors.step_id.value),
      sessionPolicy: sanitizeSessionPolicy(descriptors.session_policy.value, {
        project_id: projectId,
        conversation_id: conversationId,
        turn_id: turnId,
        task_id: taskId,
        run_id: runId,
      }),
      admission: sanitizePermissionAdmission(descriptors.admission.value),
      requestedAtMs: safeTimestamp(descriptors.requested_at_ms.value),
    });
    return freezeDeep({
      ...record,
      record_digest: sha256Canonical(recordDigestBody(record)),
    });
  } catch (error) {
    if (error instanceof BuilderToolCallRecordError) throw error;
    fail();
  }
}

function sanitizeBuilderToolCallRecord(rawRecord) {
  try {
    const descriptors = exactObject(rawRecord, RECORD_KEYS);
    const projectId = safeProjectId(descriptors.project_id.value);
    const admission = sanitizePermissionAdmission(descriptors.permission_admission_receipt.value);
    const requestedAtMs = safeTimestamp(descriptors.requested_at_ms.value);
    const conversationId = safeConversationId(descriptors.conversation_id.value, projectId);
    const turnId = safeTurnId(descriptors.turn_id.value);
    const taskId = safeTaskId(descriptors.task_id.value);
    const runId = safeRunId(descriptors.run_id.value);
    const record = unsignedRecord({
      projectId,
      conversationId,
      turnId,
      taskId,
      runId,
      stepId: safeStepId(descriptors.step_id.value),
      sessionPolicy: sanitizeSessionPolicy(descriptors.session_policy.value, {
        project_id: projectId,
        conversation_id: conversationId,
        turn_id: turnId,
        task_id: taskId,
        run_id: runId,
      }),
      admission,
      requestedAtMs,
    });
    const resource = sanitizeResource(descriptors.resource.value, record.action, projectId);
    if (
      descriptors.record_version.value !== BUILDER_TOOL_CALL_RECORD_VERSION
      || descriptors.record_kind.value !== TOOL_CALL_RECORD_KIND
      || descriptors.tool_call_id.value !== record.tool_call_id
      || descriptors.tool_name.value !== record.tool_name
      || descriptors.action.value !== record.action
      || resource.resource_kind !== record.resource.resource_kind
      || resource.project_id !== record.resource.project_id
      || resource.resource_id !== record.resource.resource_id
      || JSON.stringify(sanitizeLifecycle(descriptors.lifecycle.value)) !== JSON.stringify(record.lifecycle)
      || JSON.stringify(sanitizeAuthority(descriptors.authority.value)) !== JSON.stringify(record.authority)
    ) fail();
    const digest = safeDigest(descriptors.record_digest.value);
    if (digest !== sha256Canonical(recordDigestBody(record))) fail();
    return freezeDeep({
      ...record,
      record_digest: digest,
    });
  } catch (error) {
    if (error instanceof BuilderToolCallRecordError) throw error;
    fail();
  }
}

module.exports = freezeDeep({
  BUILDER_TOOL_CALL_RECORD_VERSION,
  TOOL_CALL_RECORD_KIND,
  BuilderToolCallRecordError,
  createBuilderToolCallRecord,
  sanitizeBuilderToolCallRecord,
});
