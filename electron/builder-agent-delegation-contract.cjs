'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');
const {
  sanitizeBuilderAgentDefinitionRecord,
  sanitizeBuilderAgentVersionRecord,
} = require('./builder-agent-definition-contract.cjs');
const {
  sanitizeBuilderAgentSupervisionLeaseRecord,
} = require('./builder-agent-supervision-lease-contract.cjs');

const BUILDER_AGENT_DELEGATION_CONTRACT_VERSION = 'builder-agent-delegation-contract.v1';
const BUILDER_AGENT_DELEGATION_RECORD_VERSION = 'builder-agent-delegation-record.v1';
const BUILDER_AGENT_DELEGATION_RECORD_KIND = 'builder_agent_delegation_record';
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
const ASSIGNMENT_RECORD_KEYS = Object.freeze([
  'assignment_id',
  'definition_digest',
  'record_version',
  'agent_id',
  'agent_version_id',
  'owner_id',
  'assigned_by',
  'project_id',
  'conversation_id',
  'task_id',
  'run_id',
  'goal',
  'created_at_ms',
  'permission_boundary',
  'supervision_policy',
  'result_contract',
  'budget',
]);
const LEASE_RECORD_KEYS = Object.freeze([
  'lease_id',
  'definition_digest',
  'record_version',
  'assignment_id',
  'assignment_status_id',
  'agent_id',
  'owner_id',
  'project_id',
  'conversation_id',
  'task_id',
  'run_id',
  'lease_holder_id',
  'lease_epoch',
  'acquired_at_ms',
  'expires_at_ms',
  'purpose',
  'redispatch_policy',
  'supervision_state',
  'authority_boundary',
]);
const INPUT_KEYS = Object.freeze([
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
]);
const RECORD_KEYS = Object.freeze([
  'delegation_id',
  'parent_definition_digest',
  'target_definition_digest',
  ...INPUT_KEYS,
  'lifecycle',
  'authority',
]);
const LIFECYCLE_KEYS = Object.freeze([
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
const AUTHORITY_KEYS = Object.freeze([
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
const PERMISSION_INTERSECTION = Object.freeze({
  parent_boundary: 'explicit_permission_required',
  child_boundary: 'explicit_permission_required',
  effective_boundary: 'parent_child_intersection_only',
  external_resources: 'not_granted_by_delegation',
});
const LIFECYCLE = Object.freeze({
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
});
const AUTHORITY = Object.freeze({
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
});
const ERROR_MESSAGES = Object.freeze({
  builder_agent_delegation_contract_invalid: 'Builder agent delegation could not be verified.',
});

class BuilderAgentDelegationContractError extends Error {
  constructor() {
    super(ERROR_MESSAGES.builder_agent_delegation_contract_invalid);
    this.name = 'BuilderAgentDelegationContractError';
    this.code = 'builder_agent_delegation_contract_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderAgentDelegationContractError();
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

function safeIntegerRange(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail();
  return value;
}

function safeText(value, minLength, maxLength) {
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || value.length < minLength
    || value.length > maxLength
  ) fail();
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) fail();
  }
  return value;
}

function safeLifecycle(value) {
  exactObject(value, LIFECYCLE_KEYS);
  for (const key of LIFECYCLE_KEYS) {
    if (valueAt(value, key) !== LIFECYCLE[key]) fail();
  }
  return freezeDeep({ ...LIFECYCLE });
}

function safeAuthority(value) {
  exactObject(value, AUTHORITY_KEYS);
  for (const key of AUTHORITY_KEYS) {
    if (valueAt(value, key) !== AUTHORITY[key]) fail();
  }
  return freezeDeep({ ...AUTHORITY });
}

function safeBudget(value) {
  exactObject(value, BUDGET_KEYS);
  const budget = {
    max_steps: safeIntegerRange(valueAt(value, 'max_steps'), 1, 256),
    max_tool_calls: safeIntegerRange(valueAt(value, 'max_tool_calls'), 0, 256),
    max_runtime_ms: safeIntegerRange(valueAt(value, 'max_runtime_ms'), 1_000, 86_400_000),
    max_private_source_bytes: safeIntegerRange(valueAt(value, 'max_private_source_bytes'), 0, 4 * 1_024 * 1_024),
  };
  if (budget.max_tool_calls > budget.max_steps) fail();
  return freezeDeep(budget);
}

function safeBudgetIntersection(value, parentBudget) {
  const budget = safeBudget(value);
  if (
    budget.max_steps > parentBudget.max_steps
    || budget.max_tool_calls > parentBudget.max_tool_calls
    || budget.max_runtime_ms > parentBudget.max_runtime_ms
    || budget.max_private_source_bytes > parentBudget.max_private_source_bytes
  ) fail();
  return budget;
}

function safePermissionIntersection(value) {
  exactObject(value, PERMISSION_INTERSECTION_KEYS);
  for (const key of PERMISSION_INTERSECTION_KEYS) {
    if (valueAt(value, key) !== PERMISSION_INTERSECTION[key]) fail();
  }
  return freezeDeep({ ...PERMISSION_INTERSECTION });
}

function safeAssignmentReference(value) {
  exactObject(value, ASSIGNMENT_RECORD_KEYS);
  const budget = safeBudget(valueAt(value, 'budget'));
  if (
    valueAt(value, 'permission_boundary') !== 'explicit_permission_required'
    || valueAt(value, 'supervision_policy') !== 'owner_supervised'
    || valueAt(value, 'result_contract') !== 'review_required_before_materialization'
  ) fail();
  return freezeDeep({
    assignment_id: safeAssignmentId(valueAt(value, 'assignment_id')),
    definition_digest: safeDigest(valueAt(value, 'definition_digest')),
    agent_id: safeAgentId(valueAt(value, 'agent_id')),
    agent_version_id: safeAgentVersionId(valueAt(value, 'agent_version_id')),
    owner_id: safeOwnerId(valueAt(value, 'owner_id')),
    project_id: safeProjectId(valueAt(value, 'project_id')),
    conversation_id: safeConversationId(valueAt(value, 'conversation_id')),
    task_id: safeTaskId(valueAt(value, 'task_id')),
    run_id: safeRunId(valueAt(value, 'run_id')),
    budget,
  });
}

function safeLeaseReference(value, assignmentRecord, statusRecord) {
  const lease = sanitizeBuilderAgentSupervisionLeaseRecord(value, assignmentRecord, statusRecord);
  exactObject(lease, LEASE_RECORD_KEYS);
  return freezeDeep({
    lease_id: safeLeaseId(valueAt(lease, 'lease_id')),
    definition_digest: safeDigest(valueAt(lease, 'definition_digest')),
    assignment_id: safeAssignmentId(valueAt(lease, 'assignment_id')),
    assignment_status_id: safeAssignmentStatusId(valueAt(lease, 'assignment_status_id')),
    agent_id: safeAgentId(valueAt(lease, 'agent_id')),
    owner_id: safeOwnerId(valueAt(lease, 'owner_id')),
    project_id: safeProjectId(valueAt(lease, 'project_id')),
    conversation_id: safeConversationId(valueAt(lease, 'conversation_id')),
    task_id: safeTaskId(valueAt(lease, 'task_id')),
    run_id: safeRunId(valueAt(lease, 'run_id')),
    lease_holder_id: safeSupervisorId(valueAt(lease, 'lease_holder_id')),
    acquired_at_ms: safeTimestamp(valueAt(lease, 'acquired_at_ms')),
    expires_at_ms: safeTimestamp(valueAt(lease, 'expires_at_ms')),
  });
}

function targetAgentReference(versionRecord, definitionRecord) {
  const definition = sanitizeBuilderAgentDefinitionRecord(definitionRecord);
  const version = sanitizeBuilderAgentVersionRecord(versionRecord, definition);
  return freezeDeep({
    agent_id: version.agent_id,
    agent_version_id: version.agent_version_id,
    owner_id: version.owner_id,
    definition_digest: definition.definition_digest,
  });
}

function safeDelegationFields(value, assignmentRecord, statusRecord, leaseRecord, targetVersionRecord, targetDefinitionRecord) {
  exactObject(value, INPUT_KEYS);
  const parent = safeAssignmentReference(assignmentRecord);
  const lease = safeLeaseReference(leaseRecord, assignmentRecord, statusRecord);
  const target = targetAgentReference(targetVersionRecord, targetDefinitionRecord);
  const recordVersion = valueAt(value, 'record_version');
  const recordKind = valueAt(value, 'record_kind');
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
  const delegatedAtMs = safeTimestamp(valueAt(value, 'delegated_at_ms'));
  if (
    recordVersion !== BUILDER_AGENT_DELEGATION_RECORD_VERSION
    || recordKind !== BUILDER_AGENT_DELEGATION_RECORD_KIND
    || parent.definition_digest !== lease.definition_digest
    || parentAssignmentId !== parent.assignment_id
    || parentAssignmentStatusId !== lease.assignment_status_id
    || parentLeaseId !== lease.lease_id
    || fromAgentId !== parent.agent_id
    || fromAgentId !== lease.agent_id
    || fromAgentVersionId !== parent.agent_version_id
    || toAgentId !== target.agent_id
    || toAgentVersionId !== target.agent_version_id
    || toAgentId === fromAgentId
    || ownerId !== parent.owner_id
    || ownerId !== lease.owner_id
    || ownerId !== target.owner_id
    || projectId !== parent.project_id
    || projectId !== lease.project_id
    || parentConversationId !== parent.conversation_id
    || parentConversationId !== lease.conversation_id
    || parentTaskId !== parent.task_id
    || parentTaskId !== lease.task_id
    || parentRunId !== parent.run_id
    || parentRunId !== lease.run_id
    || childTaskId === parentTaskId
    || childRunId === parentRunId
    || leaseHolderId !== lease.lease_holder_id
    || delegatedAtMs < lease.acquired_at_ms
    || delegatedAtMs > lease.expires_at_ms
    || valueAt(value, 'cancellation_policy') !== 'parent_cancellation_propagates_to_child'
    || valueAt(value, 'result_contract') !== 'child_result_returns_for_parent_review'
    || valueAt(value, 'materialization_boundary') !== 'no_direct_parent_mutation'
  ) fail();
  return freezeDeep({
    record_version: BUILDER_AGENT_DELEGATION_RECORD_VERSION,
    record_kind: BUILDER_AGENT_DELEGATION_RECORD_KIND,
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
    delegated_goal: safeText(valueAt(value, 'delegated_goal'), 1, 2_000),
    delegated_at_ms: delegatedAtMs,
    permission_intersection: safePermissionIntersection(valueAt(value, 'permission_intersection')),
    budget_intersection: safeBudgetIntersection(valueAt(value, 'budget_intersection'), parent.budget),
    cancellation_policy: 'parent_cancellation_propagates_to_child',
    result_contract: 'child_result_returns_for_parent_review',
    materialization_boundary: 'no_direct_parent_mutation',
  });
}

function delegationIdFor(parentDefinitionDigest, targetDefinitionDigest, fields) {
  return `builder-agent-delegation:${sha256Canonical({
    agent_delegation_identity: BUILDER_AGENT_DELEGATION_RECORD_VERSION,
    parent_definition_digest: parentDefinitionDigest,
    target_definition_digest: targetDefinitionDigest,
    fields,
  }).slice('sha256:'.length)}`;
}

function createBuilderAgentDelegationRecord(
  value,
  assignmentRecord,
  statusRecord,
  leaseRecord,
  targetVersionRecord,
  targetDefinitionRecord,
) {
  try {
    const parent = safeAssignmentReference(assignmentRecord);
    const target = targetAgentReference(targetVersionRecord, targetDefinitionRecord);
    const fields = safeDelegationFields(
      value,
      assignmentRecord,
      statusRecord,
      leaseRecord,
      targetVersionRecord,
      targetDefinitionRecord,
    );
    return freezeDeep({
      delegation_id: delegationIdFor(parent.definition_digest, target.definition_digest, fields),
      parent_definition_digest: parent.definition_digest,
      target_definition_digest: target.definition_digest,
      ...fields,
      lifecycle: freezeDeep({ ...LIFECYCLE }),
      authority: freezeDeep({ ...AUTHORITY }),
    });
  } catch (error) {
    if (error instanceof BuilderAgentDelegationContractError) throw error;
    fail();
  }
}

function sanitizeBuilderAgentDelegationRecord(
  value,
  assignmentRecord,
  statusRecord,
  leaseRecord,
  targetVersionRecord,
  targetDefinitionRecord,
) {
  try {
    const parent = safeAssignmentReference(assignmentRecord);
    const target = targetAgentReference(targetVersionRecord, targetDefinitionRecord);
    exactObject(value, RECORD_KEYS);
    const delegationId = safeDelegationId(valueAt(value, 'delegation_id'));
    const parentDefinitionDigest = safeDigest(valueAt(value, 'parent_definition_digest'));
    const targetDefinitionDigest = safeDigest(valueAt(value, 'target_definition_digest'));
    if (
      parentDefinitionDigest !== parent.definition_digest
      || targetDefinitionDigest !== target.definition_digest
    ) fail();
    const fields = safeDelegationFields({
      record_version: valueAt(value, 'record_version'),
      record_kind: valueAt(value, 'record_kind'),
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
      delegated_goal: valueAt(value, 'delegated_goal'),
      delegated_at_ms: valueAt(value, 'delegated_at_ms'),
      permission_intersection: valueAt(value, 'permission_intersection'),
      budget_intersection: valueAt(value, 'budget_intersection'),
      cancellation_policy: valueAt(value, 'cancellation_policy'),
      result_contract: valueAt(value, 'result_contract'),
      materialization_boundary: valueAt(value, 'materialization_boundary'),
    }, assignmentRecord, statusRecord, leaseRecord, targetVersionRecord, targetDefinitionRecord);
    if (delegationId !== delegationIdFor(parentDefinitionDigest, targetDefinitionDigest, fields)) fail();
    return freezeDeep({
      delegation_id: delegationId,
      parent_definition_digest: parentDefinitionDigest,
      target_definition_digest: targetDefinitionDigest,
      ...fields,
      lifecycle: safeLifecycle(valueAt(value, 'lifecycle')),
      authority: safeAuthority(valueAt(value, 'authority')),
    });
  } catch (error) {
    if (error instanceof BuilderAgentDelegationContractError) throw error;
    fail();
  }
}

module.exports = Object.freeze({
  BUILDER_AGENT_DELEGATION_CONTRACT_VERSION,
  BUILDER_AGENT_DELEGATION_RECORD_KIND,
  BUILDER_AGENT_DELEGATION_RECORD_VERSION,
  BuilderAgentDelegationContractError,
  createBuilderAgentDelegationRecord,
  sanitizeBuilderAgentDelegationRecord,
});
