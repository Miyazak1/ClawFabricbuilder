'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  BuilderAgentAssignmentContractError,
  sanitizeBuilderAgentAssignmentRecord,
  sanitizeBuilderAgentAssignmentStatusRecord,
} = require('./builder-agent-assignment-contract.cjs');
const {
  BuilderAgentBudgetAuditContractError,
  sanitizeBuilderAgentBudgetAuditRecord,
} = require('./builder-agent-budget-audit-contract.cjs');
const {
  BuilderAgentDefinitionContractError,
  sanitizeBuilderAgentDefinitionRecord,
  sanitizeBuilderAgentVersionRecord,
} = require('./builder-agent-definition-contract.cjs');
const {
  BuilderAgentParentTaskContextProjectionError,
  sanitizeBuilderAgentParentTaskContextProjection,
} = require('./builder-agent-parent-task-context-projection.cjs');
const {
  BuilderAgentSupervisionLeaseContractError,
  sanitizeBuilderAgentSupervisionLeaseRecord,
} = require('./builder-agent-supervision-lease-contract.cjs');

const BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_VERSION =
  'builder-agent-task-context-snapshot.v1';
const SNAPSHOT_ID_PREFIX = 'builder-agent-task-context-snapshot:';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const AGENT_ID_PATTERN = new RegExp(`^builder-agent:${UUID_SOURCE}$`, 'u');
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const MESSAGE_ID_PATTERN = new RegExp(`^builder-message:${UUID_SOURCE}$`, 'u');
const MEMORY_ID_PATTERN = /^builder-agent-memory:[0-9a-f]{64}$/u;
const ARTIFACT_ID_PATTERN = /^builder-artifact:[0-9a-f]{64}$/u;
const RUN_EVENT_ID_PATTERN = /^builder-run-event:[0-9a-f]{64}$/u;
const PERMISSION_ID_PATTERN = /^builder-permission:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const GIT_OID_PATTERN = /^[0-9a-f]{40}$/u;
const AGENT_VERSION_ID_PATTERN = /^builder-agent-version:[0-9a-f]{64}$/u;
const ASSIGNMENT_ID_PATTERN = /^builder-agent-assignment:[0-9a-f]{64}$/u;
const ASSIGNMENT_STATUS_ID_PATTERN = /^builder-agent-assignment-status:[0-9a-f]{64}$/u;
const SUPERVISION_LEASE_ID_PATTERN = /^builder-agent-supervision-lease:[0-9a-f]{64}$/u;
const BUDGET_AUDIT_ID_PATTERN = /^builder-agent-budget-audit:[0-9a-f]{64}$/u;
const PROJECTION_ID_PATTERN = /^builder-agent-parent-task-context-projection:[0-9a-f]{64}$/u;
const SNAPSHOT_ID_PATTERN = /^builder-agent-task-context-snapshot:[0-9a-f]{64}$/u;

const INPUT_KEYS = Object.freeze([
  'agent_definition',
  'agent_version',
  'assignment',
  'active_status',
  'lease',
  'budget_audit',
  'included_memory_ids',
  'included_message_ids',
  'included_artifact_ids',
  'included_run_event_ids',
  'included_permission_ids',
  'parent_task_context_projection',
  'base_project_revision',
  'token_budget',
  'created_at_ms',
]);
const SNAPSHOT_KEYS = Object.freeze([
  'snapshot_version',
  'snapshot_id',
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
  'context_kind',
  'included_memory_ids',
  'included_message_ids',
  'included_artifact_ids',
  'included_run_event_ids',
  'included_permission_ids',
  'parent_task_context_projection',
  'base_project_revision',
  'action_admission',
  'token_budget',
  'created_at_ms',
  'context_digest',
  'authority',
]);
const SNAPSHOT_BODY_KEYS = Object.freeze([
  'snapshot_version',
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
  'context_kind',
  'included_memory_ids',
  'included_message_ids',
  'included_artifact_ids',
  'included_run_event_ids',
  'included_permission_ids',
  'parent_task_context_projection',
  'base_project_revision',
  'action_admission',
  'token_budget',
  'created_at_ms',
  'authority',
]);
const PARENT_CONTEXT_REF_KEYS = Object.freeze([
  'status',
  'projection_id',
  'context_digest',
  'included_materialization_count',
  'truncated',
]);
const BASE_REVISION_KEYS = Object.freeze([
  'status',
  'revision_receipt_digest',
  'commit_oid',
]);
const ACTION_ADMISSION_KEYS = Object.freeze([
  'requested_next_action',
  'budget_audit_decision',
  'budget_audit_reason',
  'budget_audit_observed_at_ms',
]);
const TOKEN_BUDGET_KEYS = Object.freeze([
  'max_input_tokens',
  'reserved_output_tokens',
  'selection_policy',
]);
const AUTHORITY_KEYS = Object.freeze([
  'snapshot_authority',
  'assignment_authority',
  'lease_authority',
  'budget_authority',
  'parent_context_authority',
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
  'prompt_materialization',
  'raw_context_storage',
]);
const CONTEXT_KIND = 'agent_task_context_snapshot_before_supervised_action';
const AUTHORITY = Object.freeze({
  snapshot_authority: 'main_agent_task_context_snapshot_contract_v1',
  assignment_authority: 'main_agent_assignment_contract_v1',
  lease_authority: 'main_agent_supervision_lease_contract_v1',
  budget_authority: 'main_agent_budget_audit_contract_v1',
  parent_context_authority: 'main_agent_parent_task_context_projection_v1',
  renderer_authority: 'not_present',
  ipc_authority: 'not_present',
  provider_dispatch: false,
  model_dispatch: false,
  tool_dispatch: false,
  permission_grant_authority: false,
  credential_storage: 'not_present',
  source_access: 'not_present',
  source_read: 'not_performed_by_snapshot',
  source_write: 'not_present',
  process_run: false,
  network_access: false,
  revision_authority: false,
  review_authority: false,
  artifact_authority: false,
  prompt_materialization: false,
  raw_context_storage: false,
});
const ARRAY_LIMITS = Object.freeze({
  included_memory_ids: 16,
  included_message_ids: 32,
  included_artifact_ids: 16,
  included_run_event_ids: 32,
  included_permission_ids: 8,
});
const ARRAY_PATTERNS = Object.freeze({
  included_memory_ids: MEMORY_ID_PATTERN,
  included_message_ids: MESSAGE_ID_PATTERN,
  included_artifact_ids: ARTIFACT_ID_PATTERN,
  included_run_event_ids: RUN_EVENT_ID_PATTERN,
  included_permission_ids: PERMISSION_ID_PATTERN,
});
const ACTIONS = Object.freeze(['start_step', 'call_tool', 'read_private_source', 'finish_for_review']);

class BuilderAgentTaskContextSnapshotError extends Error {
  constructor() {
    super('Builder agent task context snapshot could not be verified.');
    this.name = 'BuilderAgentTaskContextSnapshotError';
    this.code = 'builder_agent_task_context_snapshot_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderAgentTaskContextSnapshotError();
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
  if (!isPlainObject(value)) fail();
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
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

function safeInteger(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail();
  return value;
}

function denseIds(value, key) {
  if (
    !Array.isArray(value)
    || utilTypes.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > ARRAY_LIMITS[key]
  ) fail();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length + 1 || ownKeys.some((item) => typeof item === 'symbol')) fail();
  const ids = [];
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    const id = safePattern(descriptor.value, ARRAY_PATTERNS[key]);
    if (seen.has(id)) fail();
    seen.add(id);
    ids.push(id);
  }
  return freezeDeep(ids);
}

function safeAuthority(value) {
  exactObject(value, AUTHORITY_KEYS);
  for (const key of AUTHORITY_KEYS) {
    if (valueAt(value, key) !== AUTHORITY[key]) fail();
  }
  return freezeDeep({ ...AUTHORITY });
}

function safeBaseProjectRevision(value) {
  const source = exactObject(value, BASE_REVISION_KEYS);
  const status = valueAt(source, 'status');
  if (status === 'not_available') {
    if (
      valueAt(source, 'revision_receipt_digest') !== null
      || valueAt(source, 'commit_oid') !== null
    ) fail();
    return freezeDeep({
      status,
      revision_receipt_digest: null,
      commit_oid: null,
    });
  }
  if (status !== 'available') fail();
  return freezeDeep({
    status,
    revision_receipt_digest: safePattern(valueAt(source, 'revision_receipt_digest'), DIGEST_PATTERN),
    commit_oid: safePattern(valueAt(source, 'commit_oid'), GIT_OID_PATTERN),
  });
}

function safeTokenBudget(value) {
  const source = exactObject(value, TOKEN_BUDGET_KEYS);
  return freezeDeep({
    max_input_tokens: safeInteger(valueAt(source, 'max_input_tokens'), 1_024, 256_000),
    reserved_output_tokens: safeInteger(valueAt(source, 'reserved_output_tokens'), 1, 64_000),
    selection_policy: safeFixed(
      valueAt(source, 'selection_policy'),
      'deterministic_task_local_budget_v1',
    ),
  });
}

function safeFixed(value, expected) {
  if (value !== expected) fail();
  return expected;
}

function safeActionAdmission(value) {
  const source = exactObject(value, ACTION_ADMISSION_KEYS);
  const requestedNextAction = valueAt(source, 'requested_next_action');
  if (typeof requestedNextAction !== 'string' || !ACTIONS.includes(requestedNextAction)) fail();
  return freezeDeep({
    requested_next_action: requestedNextAction,
    budget_audit_decision: safeFixed(valueAt(source, 'budget_audit_decision'), 'allowed'),
    budget_audit_reason: safeFixed(valueAt(source, 'budget_audit_reason'), 'none'),
    budget_audit_observed_at_ms: safeTimestamp(valueAt(source, 'budget_audit_observed_at_ms')),
  });
}

function parentContextRefFromProjection(value, expected, createdAtMs) {
  if (value === null) {
    return freezeDeep({
      status: 'not_available',
      projection_id: null,
      context_digest: null,
      included_materialization_count: 0,
      truncated: false,
    });
  }
  let projection;
  try {
    projection = sanitizeBuilderAgentParentTaskContextProjection(value, expected);
  } catch (error) {
    if (error instanceof BuilderAgentParentTaskContextProjectionError) fail();
    throw error;
  }
  if (projection.created_at_ms > createdAtMs) fail();
  return freezeDeep({
    status: 'included',
    projection_id: projection.projection_id,
    context_digest: projection.context_digest,
    included_materialization_count: projection.included_materialization_count,
    truncated: projection.truncated,
  });
}

function safeParentContextRef(value) {
  const source = exactObject(value, PARENT_CONTEXT_REF_KEYS);
  const status = valueAt(source, 'status');
  if (status === 'not_available') {
    if (
      valueAt(source, 'projection_id') !== null
      || valueAt(source, 'context_digest') !== null
      || valueAt(source, 'included_materialization_count') !== 0
      || valueAt(source, 'truncated') !== false
    ) fail();
    return freezeDeep({
      status,
      projection_id: null,
      context_digest: null,
      included_materialization_count: 0,
      truncated: false,
    });
  }
  if (status !== 'included') fail();
  const truncated = valueAt(source, 'truncated');
  if (typeof truncated !== 'boolean') fail();
  return freezeDeep({
    status,
    projection_id: safePattern(valueAt(source, 'projection_id'), PROJECTION_ID_PATTERN),
    context_digest: safePattern(valueAt(source, 'context_digest'), DIGEST_PATTERN),
    included_materialization_count: safeInteger(valueAt(source, 'included_materialization_count'), 1, 32),
    truncated,
  });
}

function sanitizeContextFacts(input, createdAtMs) {
  let definition;
  let agentVersion;
  let assignment;
  let activeStatus;
  let lease;
  let budgetAudit;
  try {
    definition = sanitizeBuilderAgentDefinitionRecord(valueAt(input, 'agent_definition'));
    agentVersion = sanitizeBuilderAgentVersionRecord(valueAt(input, 'agent_version'), definition);
    assignment = sanitizeBuilderAgentAssignmentRecord(valueAt(input, 'assignment'), agentVersion, definition);
    activeStatus = sanitizeBuilderAgentAssignmentStatusRecord(valueAt(input, 'active_status'), assignment);
    lease = sanitizeBuilderAgentSupervisionLeaseRecord(valueAt(input, 'lease'), assignment, activeStatus);
    budgetAudit = sanitizeBuilderAgentBudgetAuditRecord(
      valueAt(input, 'budget_audit'),
      assignment,
      activeStatus,
      lease,
    );
  } catch (error) {
    if (
      error instanceof BuilderAgentDefinitionContractError
      || error instanceof BuilderAgentAssignmentContractError
      || error instanceof BuilderAgentSupervisionLeaseContractError
      || error instanceof BuilderAgentBudgetAuditContractError
    ) fail();
    throw error;
  }
  if (
    activeStatus.next_status !== 'active'
    || budgetAudit.outcome.decision !== 'allowed'
    || budgetAudit.outcome.reason !== 'none'
    || budgetAudit.observed_at_ms > createdAtMs
    || lease.acquired_at_ms > createdAtMs
    || lease.expires_at_ms < createdAtMs
  ) fail();
  return freezeDeep({ definition, agentVersion, assignment, activeStatus, lease, budgetAudit });
}

function snapshotIdFor(contextDigest) {
  return `${SNAPSHOT_ID_PREFIX}${contextDigest.slice('sha256:'.length)}`;
}

function snapshotBody(facts, refs, parentContext, baseRevision, tokenBudget, createdAtMs) {
  return freezeDeep({
    snapshot_version: BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_VERSION,
    definition_digest: facts.definition.definition_digest,
    assignment_id: facts.assignment.assignment_id,
    assignment_status_id: facts.activeStatus.assignment_status_id,
    lease_id: facts.lease.lease_id,
    budget_audit_id: facts.budgetAudit.budget_audit_id,
    agent_id: facts.assignment.agent_id,
    agent_version_id: facts.assignment.agent_version_id,
    owner_id: facts.assignment.owner_id,
    project_id: facts.assignment.project_id,
    conversation_id: facts.assignment.conversation_id,
    task_id: facts.assignment.task_id,
    run_id: facts.assignment.run_id,
    context_kind: CONTEXT_KIND,
    included_memory_ids: refs.included_memory_ids,
    included_message_ids: refs.included_message_ids,
    included_artifact_ids: refs.included_artifact_ids,
    included_run_event_ids: refs.included_run_event_ids,
    included_permission_ids: refs.included_permission_ids,
    parent_task_context_projection: parentContext,
    base_project_revision: baseRevision,
    action_admission: freezeDeep({
      requested_next_action: facts.budgetAudit.requested_next_action,
      budget_audit_decision: 'allowed',
      budget_audit_reason: 'none',
      budget_audit_observed_at_ms: facts.budgetAudit.observed_at_ms,
    }),
    token_budget: tokenBudget,
    created_at_ms: createdAtMs,
    authority: freezeDeep({ ...AUTHORITY }),
  });
}

function createBuilderAgentTaskContextSnapshot(rawInput) {
  try {
    const input = exactObject(rawInput, INPUT_KEYS);
    const createdAtMs = safeTimestamp(valueAt(input, 'created_at_ms'));
    const facts = sanitizeContextFacts(input, createdAtMs);
    const refs = freezeDeep({
      included_memory_ids: denseIds(valueAt(input, 'included_memory_ids'), 'included_memory_ids'),
      included_message_ids: denseIds(valueAt(input, 'included_message_ids'), 'included_message_ids'),
      included_artifact_ids: denseIds(valueAt(input, 'included_artifact_ids'), 'included_artifact_ids'),
      included_run_event_ids: denseIds(valueAt(input, 'included_run_event_ids'), 'included_run_event_ids'),
      included_permission_ids: denseIds(valueAt(input, 'included_permission_ids'), 'included_permission_ids'),
    });
    const parentContext = parentContextRefFromProjection(
      valueAt(input, 'parent_task_context_projection'),
      {
        owner_id: facts.assignment.owner_id,
        project_id: facts.assignment.project_id,
        parent_task_id: facts.assignment.task_id,
      },
      createdAtMs,
    );
    const body = snapshotBody(
      facts,
      refs,
      parentContext,
      safeBaseProjectRevision(valueAt(input, 'base_project_revision')),
      safeTokenBudget(valueAt(input, 'token_budget')),
      createdAtMs,
    );
    const contextDigest = sha256Canonical(body);
    return freezeDeep({
      ...body,
      snapshot_id: snapshotIdFor(contextDigest),
      context_digest: contextDigest,
    });
  } catch (error) {
    if (error instanceof BuilderAgentTaskContextSnapshotError) fail();
    throw error;
  }
}

function sanitizeBuilderAgentTaskContextSnapshot(rawSnapshot, expected = null) {
  try {
    const source = exactObject(rawSnapshot, SNAPSHOT_KEYS);
    const body = {};
    for (const key of SNAPSHOT_BODY_KEYS) body[key] = valueAt(source, key);
    const snapshotVersion = safeFixed(
      body.snapshot_version,
      BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_VERSION,
    );
    const definitionDigest = safePattern(body.definition_digest, DIGEST_PATTERN);
    const assignmentId = safePattern(body.assignment_id, ASSIGNMENT_ID_PATTERN);
    const assignmentStatusId = safePattern(body.assignment_status_id, ASSIGNMENT_STATUS_ID_PATTERN);
    const leaseId = safePattern(body.lease_id, SUPERVISION_LEASE_ID_PATTERN);
    const budgetAuditId = safePattern(body.budget_audit_id, BUDGET_AUDIT_ID_PATTERN);
    const agentId = safePattern(body.agent_id, AGENT_ID_PATTERN);
    const agentVersionId = safePattern(body.agent_version_id, AGENT_VERSION_ID_PATTERN);
    const ownerId = safePattern(body.owner_id, OWNER_ID_PATTERN);
    const projectId = safePattern(body.project_id, PROJECT_ID_PATTERN);
    const conversationId = safePattern(body.conversation_id, CONVERSATION_ID_PATTERN);
    const taskId = safePattern(body.task_id, TASK_ID_PATTERN);
    const runId = safePattern(body.run_id, RUN_ID_PATTERN);
    if (expected !== null) {
      exactObject(expected, ['owner_id', 'project_id', 'task_id', 'run_id']);
      if (
        ownerId !== safePattern(valueAt(expected, 'owner_id'), OWNER_ID_PATTERN)
        || projectId !== safePattern(valueAt(expected, 'project_id'), PROJECT_ID_PATTERN)
        || taskId !== safePattern(valueAt(expected, 'task_id'), TASK_ID_PATTERN)
        || runId !== safePattern(valueAt(expected, 'run_id'), RUN_ID_PATTERN)
      ) fail();
    }
    const actionAdmission = safeActionAdmission(body.action_admission);
    const normalizedBody = freezeDeep({
      snapshot_version: snapshotVersion,
      definition_digest: definitionDigest,
      assignment_id: assignmentId,
      assignment_status_id: assignmentStatusId,
      lease_id: leaseId,
      budget_audit_id: budgetAuditId,
      agent_id: agentId,
      agent_version_id: agentVersionId,
      owner_id: ownerId,
      project_id: projectId,
      conversation_id: conversationId,
      task_id: taskId,
      run_id: runId,
      context_kind: safeFixed(body.context_kind, CONTEXT_KIND),
      included_memory_ids: denseIds(body.included_memory_ids, 'included_memory_ids'),
      included_message_ids: denseIds(body.included_message_ids, 'included_message_ids'),
      included_artifact_ids: denseIds(body.included_artifact_ids, 'included_artifact_ids'),
      included_run_event_ids: denseIds(body.included_run_event_ids, 'included_run_event_ids'),
      included_permission_ids: denseIds(body.included_permission_ids, 'included_permission_ids'),
      parent_task_context_projection: safeParentContextRef(body.parent_task_context_projection),
      base_project_revision: safeBaseProjectRevision(body.base_project_revision),
      action_admission: actionAdmission,
      token_budget: safeTokenBudget(body.token_budget),
      created_at_ms: safeTimestamp(body.created_at_ms),
      authority: safeAuthority(body.authority),
    });
    if (actionAdmission.budget_audit_observed_at_ms > normalizedBody.created_at_ms) fail();
    const contextDigest = safePattern(valueAt(source, 'context_digest'), DIGEST_PATTERN);
    const snapshotId = safePattern(valueAt(source, 'snapshot_id'), SNAPSHOT_ID_PATTERN);
    if (contextDigest !== sha256Canonical(normalizedBody) || snapshotId !== snapshotIdFor(contextDigest)) {
      fail();
    }
    return freezeDeep({
      ...normalizedBody,
      snapshot_id: snapshotId,
      context_digest: contextDigest,
    });
  } catch (error) {
    if (error instanceof BuilderAgentTaskContextSnapshotError) fail();
    throw error;
  }
}

module.exports = Object.freeze({
  BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_VERSION,
  BuilderAgentTaskContextSnapshotError,
  createBuilderAgentTaskContextSnapshot,
  sanitizeBuilderAgentTaskContextSnapshot,
});
