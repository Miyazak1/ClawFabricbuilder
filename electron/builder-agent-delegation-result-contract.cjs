'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const BUILDER_AGENT_DELEGATION_RESULT_CONTRACT_VERSION = 'builder-agent-delegation-result-contract.v1';
const BUILDER_AGENT_DELEGATION_RESULT_RECORD_VERSION = 'builder-agent-delegation-result-record.v1';
const BUILDER_AGENT_DELEGATION_RESULT_RECORD_KIND = 'builder_agent_delegation_result_record';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const AGENT_ID_PATTERN = new RegExp(`^builder-agent:${UUID_SOURCE}$`, 'u');
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const SUPERVISOR_ID_PATTERN = new RegExp(`^builder-supervisor:${UUID_SOURCE}$`, 'u');
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const AGENT_VERSION_ID_PATTERN = /^builder-agent-version:[0-9a-f]{64}$/u;
const ASSIGNMENT_ID_PATTERN = /^builder-agent-assignment:[0-9a-f]{64}$/u;
const ASSIGNMENT_STATUS_ID_PATTERN = /^builder-agent-assignment-status:[0-9a-f]{64}$/u;
const SUPERVISION_LEASE_ID_PATTERN = /^builder-agent-supervision-lease:[0-9a-f]{64}$/u;
const DELEGATION_ID_PATTERN = /^builder-agent-delegation:[0-9a-f]{64}$/u;
const DELEGATION_RESULT_ID_PATTERN = /^builder-agent-delegation-result:[0-9a-f]{64}$/u;
const BUDGET_KEYS = Object.freeze([
  'max_steps',
  'max_tool_calls',
  'max_runtime_ms',
  'max_private_source_bytes',
]);
const PERMISSION_INTERSECTION_KEYS = Object.freeze([
  'parent_boundary',
  'child_boundary',
  'effective_boundary',
  'external_resources',
]);
const DELEGATION_LIFECYCLE_KEYS = Object.freeze([
  'parent_assignment',
  'parent_supervision_lease',
  'delegation',
  'child_assignment',
  'permission_grant',
  'tool_dispatch',
  'result_return',
  'parent_materialization',
  'project_revision',
  'publication',
]);
const DELEGATION_AUTHORITY_KEYS = Object.freeze([
  'record_authority',
  'parent_assignment_authority',
  'parent_lease_authority',
  'target_agent_authority',
  'child_assignment_authority',
  'owner_review_authority',
  'renderer_authority',
  'model_dispatch',
  'permission_grant',
  'secret_access',
  'source_read',
  'source_write',
  'tool_dispatch',
  'process_run',
  'network_access',
  'revision_authority',
]);
const DELEGATION_RECORD_KEYS = Object.freeze([
  'delegation_id',
  'parent_definition_digest',
  'target_definition_digest',
  'record_version',
  'record_kind',
  'parent_assignment_id',
  'parent_assignment_status_id',
  'parent_lease_id',
  'from_agent_id',
  'from_agent_version_id',
  'to_agent_id',
  'to_agent_version_id',
  'owner_id',
  'project_id',
  'parent_conversation_id',
  'parent_task_id',
  'parent_run_id',
  'child_conversation_id',
  'child_task_id',
  'child_run_id',
  'lease_holder_id',
  'delegated_goal',
  'delegated_at_ms',
  'permission_intersection',
  'budget_intersection',
  'cancellation_policy',
  'result_contract',
  'materialization_boundary',
  'lifecycle',
  'authority',
]);
const RESULT_INPUT_KEYS = Object.freeze(['status', 'summary_code']);
const RESULT_RECORD_KEYS = Object.freeze(['status', 'summary_code', 'display_summary']);
const INPUT_KEYS = Object.freeze([
  'record_version',
  'record_kind',
  'delegation_id',
  'parent_assignment_id',
  'parent_assignment_status_id',
  'parent_lease_id',
  'from_agent_id',
  'from_agent_version_id',
  'to_agent_id',
  'to_agent_version_id',
  'owner_id',
  'project_id',
  'parent_conversation_id',
  'parent_task_id',
  'parent_run_id',
  'child_conversation_id',
  'child_task_id',
  'child_run_id',
  'lease_holder_id',
  'observed_at_ms',
  'result',
  'return_contract',
  'parent_materialization_boundary',
]);
const RECORD_KEYS = Object.freeze([
  'delegation_result_id',
  'delegation_definition_digest',
  'target_definition_digest',
  ...INPUT_KEYS,
  'lifecycle',
  'authority',
]);
const LIFECYCLE_KEYS = Object.freeze([
  'delegation',
  'child_result_return',
  'parent_review',
  'parent_materialization',
  'child_assignment',
  'permission_grant',
  'source_materialization',
  'project_revision',
  'publication',
]);
const AUTHORITY_KEYS = Object.freeze([
  'record_authority',
  'delegation_authority',
  'child_assignment_authority',
  'owner_review_authority',
  'renderer_authority',
  'model_dispatch',
  'permission_grant',
  'secret_access',
  'source_read',
  'source_write',
  'tool_dispatch',
  'process_run',
  'network_access',
  'revision_authority',
  'review_authority',
  'artifact_authority',
]);
const RESULT_SUMMARY_CODES = Object.freeze({
  proposed: 'delegated_child_result_ready_for_parent_review',
  blocked: 'delegated_child_result_needs_owner_attention',
  failed: 'delegated_child_result_could_not_be_prepared',
});
const DISPLAY_SUMMARIES = Object.freeze({
  delegated_child_result_ready_for_parent_review: 'Delegated result is ready for parent review.',
  delegated_child_result_needs_owner_attention: 'Delegated result needs owner attention.',
  delegated_child_result_could_not_be_prepared: 'Delegated result could not be prepared.',
});
const LIFECYCLE = Object.freeze({
  delegation: 'verified_recorded_delegation',
  child_result_return: 'recorded_for_parent_review',
  parent_review: 'owner_review_required',
  parent_materialization: 'not_performed_by_contract',
  child_assignment: 'not_created_by_contract',
  permission_grant: 'not_created',
  source_materialization: 'not_performed_by_contract',
  project_revision: 'not_created',
  publication: 'not_created',
});
const AUTHORITY = Object.freeze({
  record_authority: 'main_agent_delegation_result_contract_v1',
  delegation_authority: 'main_agent_delegation_contract_v1',
  child_assignment_authority: 'not_created_by_contract',
  owner_review_authority: 'required_before_parent_materialization',
  renderer_authority: 'not_present',
  model_dispatch: false,
  permission_grant: 'not_performed_by_contract',
  secret_access: 'not_present',
  source_read: 'not_performed_by_contract',
  source_write: 'not_performed_by_contract',
  tool_dispatch: 'not_performed_by_contract',
  process_run: 'not_performed_by_contract',
  network_access: 'not_present',
  revision_authority: 'not_present',
  review_authority: 'not_created_by_contract',
  artifact_authority: 'not_created_by_contract',
});
const ERROR_MESSAGES = Object.freeze({
  builder_agent_delegation_result_contract_invalid: 'Builder agent delegation result could not be verified.',
});

class BuilderAgentDelegationResultContractError extends Error {
  constructor() {
    super(ERROR_MESSAGES.builder_agent_delegation_result_contract_invalid);
    this.name = 'BuilderAgentDelegationResultContractError';
    this.code = 'builder_agent_delegation_result_contract_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderAgentDelegationResultContractError();
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
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail();
    }
  }
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

function hasControlCharacter(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeDigest(value) {
  return safePattern(value, DIGEST_PATTERN);
}

function safeDelegationId(value) {
  return safePattern(value, DELEGATION_ID_PATTERN);
}

function safeDelegationResultId(value) {
  return safePattern(value, DELEGATION_RESULT_ID_PATTERN);
}

function safeAssignmentId(value) {
  return safePattern(value, ASSIGNMENT_ID_PATTERN);
}

function safeAssignmentStatusId(value) {
  return safePattern(value, ASSIGNMENT_STATUS_ID_PATTERN);
}

function safeLeaseId(value) {
  return safePattern(value, SUPERVISION_LEASE_ID_PATTERN);
}

function safeAgentId(value) {
  return safePattern(value, AGENT_ID_PATTERN);
}

function safeAgentVersionId(value) {
  return safePattern(value, AGENT_VERSION_ID_PATTERN);
}

function safeOwnerId(value) {
  return safePattern(value, OWNER_ID_PATTERN);
}

function safeProjectId(value) {
  return safePattern(value, PROJECT_ID_PATTERN);
}

function safeConversationId(value) {
  return safePattern(value, CONVERSATION_ID_PATTERN);
}

function safeTaskId(value) {
  return safePattern(value, TASK_ID_PATTERN);
}

function safeRunId(value) {
  return safePattern(value, RUN_ID_PATTERN);
}

function safeSupervisorId(value) {
  return safePattern(value, SUPERVISOR_ID_PATTERN);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeText(value, minLength, maxLength) {
  if (
    typeof value !== 'string'
    || value.length < minLength
    || value.length > maxLength
    || value.trim() !== value
    || hasControlCharacter(value)
  ) fail();
  return value;
}

function exactConstantObject(value, expected, keys) {
  exactObject(value, keys);
  const next = {};
  for (const key of keys) {
    const actual = valueAt(value, key);
    if (actual !== expected[key]) fail();
    next[key] = actual;
  }
  return freezeDeep(next);
}

function safeBudget(value) {
  exactObject(value, BUDGET_KEYS);
  const maxSteps = valueAt(value, 'max_steps');
  const maxToolCalls = valueAt(value, 'max_tool_calls');
  const maxRuntimeMs = valueAt(value, 'max_runtime_ms');
  const maxPrivateSourceBytes = valueAt(value, 'max_private_source_bytes');
  if (
    !Number.isSafeInteger(maxSteps)
    || !Number.isSafeInteger(maxToolCalls)
    || !Number.isSafeInteger(maxRuntimeMs)
    || !Number.isSafeInteger(maxPrivateSourceBytes)
    || maxSteps < 1
    || maxSteps > 256
    || maxToolCalls < 0
    || maxToolCalls > maxSteps
    || maxRuntimeMs < 1_000
    || maxRuntimeMs > 86_400_000
    || maxPrivateSourceBytes < 0
    || maxPrivateSourceBytes > 4_194_304
  ) fail();
  return freezeDeep({
    max_steps: maxSteps,
    max_tool_calls: maxToolCalls,
    max_runtime_ms: maxRuntimeMs,
    max_private_source_bytes: maxPrivateSourceBytes,
  });
}

function safeDelegationReference(delegation) {
  exactObject(delegation, DELEGATION_RECORD_KEYS);
  const recordVersion = valueAt(delegation, 'record_version');
  const recordKind = valueAt(delegation, 'record_kind');
  const delegatedAtMs = safeTimestamp(valueAt(delegation, 'delegated_at_ms'));
  const resultContract = valueAt(delegation, 'result_contract');
  const materializationBoundary = valueAt(delegation, 'materialization_boundary');
  if (
    recordVersion !== 'builder-agent-delegation-record.v1'
    || recordKind !== 'builder_agent_delegation_record'
    || resultContract !== 'child_result_returns_for_parent_review'
    || materializationBoundary !== 'no_direct_parent_mutation'
  ) fail();
  exactConstantObject(valueAt(delegation, 'permission_intersection'), {
    parent_boundary: 'explicit_permission_required',
    child_boundary: 'explicit_permission_required',
    effective_boundary: 'parent_child_intersection_only',
    external_resources: 'not_granted_by_delegation',
  }, PERMISSION_INTERSECTION_KEYS);
  exactConstantObject(valueAt(delegation, 'lifecycle'), {
    parent_assignment: 'verified_active_assignment',
    parent_supervision_lease: 'verified_active_lease_window',
    delegation: 'recorded_for_owner_review',
    child_assignment: 'not_created_by_contract',
    permission_grant: 'not_created',
    tool_dispatch: 'not_performed_by_contract',
    result_return: 'review_or_contribution_required',
    parent_materialization: 'not_performed_by_contract',
    project_revision: 'not_created',
    publication: 'not_created',
  }, DELEGATION_LIFECYCLE_KEYS);
  exactConstantObject(valueAt(delegation, 'authority'), {
    record_authority: 'main_agent_delegation_contract_v1',
    parent_assignment_authority: 'main_agent_assignment_contract_v1',
    parent_lease_authority: 'main_agent_supervision_lease_contract_v1',
    target_agent_authority: 'main_agent_definition_contract_v1',
    child_assignment_authority: 'not_created_by_contract',
    owner_review_authority: 'required_before_child_result_materialization',
    renderer_authority: 'not_present',
    model_dispatch: false,
    permission_grant: 'not_performed_by_contract',
    secret_access: 'not_present',
    source_read: 'not_performed_by_contract',
    source_write: 'not_performed_by_contract',
    tool_dispatch: 'not_performed_by_contract',
    process_run: 'not_performed_by_contract',
    network_access: 'not_present',
    revision_authority: 'not_present',
  }, DELEGATION_AUTHORITY_KEYS);
  return freezeDeep({
    delegation_id: safeDelegationId(valueAt(delegation, 'delegation_id')),
    parent_definition_digest: safeDigest(valueAt(delegation, 'parent_definition_digest')),
    target_definition_digest: safeDigest(valueAt(delegation, 'target_definition_digest')),
    parent_assignment_id: safeAssignmentId(valueAt(delegation, 'parent_assignment_id')),
    parent_assignment_status_id: safeAssignmentStatusId(valueAt(delegation, 'parent_assignment_status_id')),
    parent_lease_id: safeLeaseId(valueAt(delegation, 'parent_lease_id')),
    from_agent_id: safeAgentId(valueAt(delegation, 'from_agent_id')),
    from_agent_version_id: safeAgentVersionId(valueAt(delegation, 'from_agent_version_id')),
    to_agent_id: safeAgentId(valueAt(delegation, 'to_agent_id')),
    to_agent_version_id: safeAgentVersionId(valueAt(delegation, 'to_agent_version_id')),
    owner_id: safeOwnerId(valueAt(delegation, 'owner_id')),
    project_id: safeProjectId(valueAt(delegation, 'project_id')),
    parent_conversation_id: safeConversationId(valueAt(delegation, 'parent_conversation_id')),
    parent_task_id: safeTaskId(valueAt(delegation, 'parent_task_id')),
    parent_run_id: safeRunId(valueAt(delegation, 'parent_run_id')),
    child_conversation_id: safeConversationId(valueAt(delegation, 'child_conversation_id')),
    child_task_id: safeTaskId(valueAt(delegation, 'child_task_id')),
    child_run_id: safeRunId(valueAt(delegation, 'child_run_id')),
    lease_holder_id: safeSupervisorId(valueAt(delegation, 'lease_holder_id')),
    delegated_goal: safeText(valueAt(delegation, 'delegated_goal'), 1, 2_000),
    delegated_at_ms: delegatedAtMs,
    budget_intersection: safeBudget(valueAt(delegation, 'budget_intersection')),
  });
}

function safeResult(value) {
  exactObject(value, RESULT_INPUT_KEYS);
  const status = valueAt(value, 'status');
  const summaryCode = valueAt(value, 'summary_code');
  if (!Object.hasOwn(RESULT_SUMMARY_CODES, status) || RESULT_SUMMARY_CODES[status] !== summaryCode) fail();
  return freezeDeep({
    status,
    summary_code: summaryCode,
    display_summary: DISPLAY_SUMMARIES[summaryCode],
  });
}

function safeResultRecord(value) {
  exactObject(value, RESULT_RECORD_KEYS);
  const status = valueAt(value, 'status');
  const summaryCode = valueAt(value, 'summary_code');
  const displaySummary = valueAt(value, 'display_summary');
  if (
    !Object.hasOwn(RESULT_SUMMARY_CODES, status)
    || RESULT_SUMMARY_CODES[status] !== summaryCode
    || displaySummary !== DISPLAY_SUMMARIES[summaryCode]
  ) fail();
  return freezeDeep({
    status,
    summary_code: summaryCode,
    display_summary: displaySummary,
  });
}

function safeLifecycle(value) {
  return exactConstantObject(value, LIFECYCLE, LIFECYCLE_KEYS);
}

function safeAuthority(value) {
  return exactConstantObject(value, AUTHORITY, AUTHORITY_KEYS);
}

function safeResultFields(value, delegationRecord) {
  exactObject(value, INPUT_KEYS);
  const delegation = safeDelegationReference(delegationRecord);
  const recordVersion = valueAt(value, 'record_version');
  const recordKind = valueAt(value, 'record_kind');
  const delegationId = safeDelegationId(valueAt(value, 'delegation_id'));
  const parentAssignmentId = safeAssignmentId(valueAt(value, 'parent_assignment_id'));
  const parentAssignmentStatusId = safeAssignmentStatusId(valueAt(value, 'parent_assignment_status_id'));
  const parentLeaseId = safeLeaseId(valueAt(value, 'parent_lease_id'));
  const fromAgentId = safeAgentId(valueAt(value, 'from_agent_id'));
  const fromAgentVersionId = safeAgentVersionId(valueAt(value, 'from_agent_version_id'));
  const toAgentId = safeAgentId(valueAt(value, 'to_agent_id'));
  const toAgentVersionId = safeAgentVersionId(valueAt(value, 'to_agent_version_id'));
  const ownerId = safeOwnerId(valueAt(value, 'owner_id'));
  const projectId = safeProjectId(valueAt(value, 'project_id'));
  const parentConversationId = safeConversationId(valueAt(value, 'parent_conversation_id'));
  const parentTaskId = safeTaskId(valueAt(value, 'parent_task_id'));
  const parentRunId = safeRunId(valueAt(value, 'parent_run_id'));
  const childConversationId = safeConversationId(valueAt(value, 'child_conversation_id'));
  const childTaskId = safeTaskId(valueAt(value, 'child_task_id'));
  const childRunId = safeRunId(valueAt(value, 'child_run_id'));
  const leaseHolderId = safeSupervisorId(valueAt(value, 'lease_holder_id'));
  const observedAtMs = safeTimestamp(valueAt(value, 'observed_at_ms'));
  if (
    recordVersion !== BUILDER_AGENT_DELEGATION_RESULT_RECORD_VERSION
    || recordKind !== BUILDER_AGENT_DELEGATION_RESULT_RECORD_KIND
    || delegationId !== delegation.delegation_id
    || parentAssignmentId !== delegation.parent_assignment_id
    || parentAssignmentStatusId !== delegation.parent_assignment_status_id
    || parentLeaseId !== delegation.parent_lease_id
    || fromAgentId !== delegation.from_agent_id
    || fromAgentVersionId !== delegation.from_agent_version_id
    || toAgentId !== delegation.to_agent_id
    || toAgentVersionId !== delegation.to_agent_version_id
    || ownerId !== delegation.owner_id
    || projectId !== delegation.project_id
    || parentConversationId !== delegation.parent_conversation_id
    || parentTaskId !== delegation.parent_task_id
    || parentRunId !== delegation.parent_run_id
    || childConversationId !== delegation.child_conversation_id
    || childTaskId !== delegation.child_task_id
    || childRunId !== delegation.child_run_id
    || leaseHolderId !== delegation.lease_holder_id
    || observedAtMs < delegation.delegated_at_ms
    || valueAt(value, 'return_contract') !== 'child_result_returned_for_parent_review'
    || valueAt(value, 'parent_materialization_boundary') !== 'no_direct_parent_mutation'
  ) fail();
  return freezeDeep({
    record_version: BUILDER_AGENT_DELEGATION_RESULT_RECORD_VERSION,
    record_kind: BUILDER_AGENT_DELEGATION_RESULT_RECORD_KIND,
    delegation_id: delegationId,
    parent_assignment_id: parentAssignmentId,
    parent_assignment_status_id: parentAssignmentStatusId,
    parent_lease_id: parentLeaseId,
    from_agent_id: fromAgentId,
    from_agent_version_id: fromAgentVersionId,
    to_agent_id: toAgentId,
    to_agent_version_id: toAgentVersionId,
    owner_id: ownerId,
    project_id: projectId,
    parent_conversation_id: parentConversationId,
    parent_task_id: parentTaskId,
    parent_run_id: parentRunId,
    child_conversation_id: childConversationId,
    child_task_id: childTaskId,
    child_run_id: childRunId,
    lease_holder_id: leaseHolderId,
    observed_at_ms: observedAtMs,
    result: safeResult(valueAt(value, 'result')),
    return_contract: 'child_result_returned_for_parent_review',
    parent_materialization_boundary: 'no_direct_parent_mutation',
  });
}

function delegationResultIdFor(delegationDefinitionDigest, targetDefinitionDigest, fields) {
  return `builder-agent-delegation-result:${sha256Canonical({
    agent_delegation_result_identity: BUILDER_AGENT_DELEGATION_RESULT_RECORD_VERSION,
    delegation_definition_digest: delegationDefinitionDigest,
    target_definition_digest: targetDefinitionDigest,
    fields,
  }).slice('sha256:'.length)}`;
}

function createBuilderAgentDelegationResultRecord(value, delegationRecord) {
  try {
    const delegation = safeDelegationReference(delegationRecord);
    const fields = safeResultFields(value, delegationRecord);
    return freezeDeep({
      delegation_result_id: delegationResultIdFor(
        delegation.parent_definition_digest,
        delegation.target_definition_digest,
        fields,
      ),
      delegation_definition_digest: delegation.parent_definition_digest,
      target_definition_digest: delegation.target_definition_digest,
      ...fields,
      lifecycle: freezeDeep({ ...LIFECYCLE }),
      authority: freezeDeep({ ...AUTHORITY }),
    });
  } catch (error) {
    if (error instanceof BuilderAgentDelegationResultContractError) throw error;
    fail();
  }
}

function sanitizeBuilderAgentDelegationResultRecord(value, delegationRecord) {
  try {
    const delegation = safeDelegationReference(delegationRecord);
    exactObject(value, RECORD_KEYS);
    const delegationResultId = safeDelegationResultId(valueAt(value, 'delegation_result_id'));
    const delegationDefinitionDigest = safeDigest(valueAt(value, 'delegation_definition_digest'));
    const targetDefinitionDigest = safeDigest(valueAt(value, 'target_definition_digest'));
    if (
      delegationDefinitionDigest !== delegation.parent_definition_digest
      || targetDefinitionDigest !== delegation.target_definition_digest
    ) fail();
    const resultRecord = safeResultRecord(valueAt(value, 'result'));
    const fields = safeResultFields({
      record_version: valueAt(value, 'record_version'),
      record_kind: valueAt(value, 'record_kind'),
      delegation_id: valueAt(value, 'delegation_id'),
      parent_assignment_id: valueAt(value, 'parent_assignment_id'),
      parent_assignment_status_id: valueAt(value, 'parent_assignment_status_id'),
      parent_lease_id: valueAt(value, 'parent_lease_id'),
      from_agent_id: valueAt(value, 'from_agent_id'),
      from_agent_version_id: valueAt(value, 'from_agent_version_id'),
      to_agent_id: valueAt(value, 'to_agent_id'),
      to_agent_version_id: valueAt(value, 'to_agent_version_id'),
      owner_id: valueAt(value, 'owner_id'),
      project_id: valueAt(value, 'project_id'),
      parent_conversation_id: valueAt(value, 'parent_conversation_id'),
      parent_task_id: valueAt(value, 'parent_task_id'),
      parent_run_id: valueAt(value, 'parent_run_id'),
      child_conversation_id: valueAt(value, 'child_conversation_id'),
      child_task_id: valueAt(value, 'child_task_id'),
      child_run_id: valueAt(value, 'child_run_id'),
      lease_holder_id: valueAt(value, 'lease_holder_id'),
      observed_at_ms: valueAt(value, 'observed_at_ms'),
      result: {
        status: resultRecord.status,
        summary_code: resultRecord.summary_code,
      },
      return_contract: valueAt(value, 'return_contract'),
      parent_materialization_boundary: valueAt(value, 'parent_materialization_boundary'),
    }, delegationRecord);
    if (delegationResultId !== delegationResultIdFor(
      delegationDefinitionDigest,
      targetDefinitionDigest,
      fields,
    )) fail();
    return freezeDeep({
      delegation_result_id: delegationResultId,
      delegation_definition_digest: delegationDefinitionDigest,
      target_definition_digest: targetDefinitionDigest,
      ...fields,
      lifecycle: safeLifecycle(valueAt(value, 'lifecycle')),
      authority: safeAuthority(valueAt(value, 'authority')),
    });
  } catch (error) {
    if (error instanceof BuilderAgentDelegationResultContractError) throw error;
    fail();
  }
}

module.exports = Object.freeze({
  BUILDER_AGENT_DELEGATION_RESULT_CONTRACT_VERSION,
  BUILDER_AGENT_DELEGATION_RESULT_RECORD_KIND,
  BUILDER_AGENT_DELEGATION_RESULT_RECORD_VERSION,
  BuilderAgentDelegationResultContractError,
  createBuilderAgentDelegationResultRecord,
  sanitizeBuilderAgentDelegationResultRecord,
});
