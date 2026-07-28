'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');
const {
  sanitizeBuilderAgentSupervisionLeaseRecord,
} = require('./builder-agent-supervision-lease-contract.cjs');

const BUILDER_AGENT_BUDGET_AUDIT_CONTRACT_VERSION = 'builder-agent-budget-audit-contract.v1';
const BUILDER_AGENT_BUDGET_AUDIT_RECORD_VERSION = 'builder-agent-budget-audit-record.v1';
const BUILDER_AGENT_BUDGET_AUDIT_RECORD_KIND = 'builder_agent_budget_audit_record';
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
const BUDGET_AUDIT_ID_PATTERN = /^builder-agent-budget-audit:[0-9a-f]{64}$/u;
const BUDGET_KEYS = Object.freeze([
  'max_steps',
  'max_tool_calls',
  'max_runtime_ms',
  'max_private_source_bytes',
]);
const USAGE_KEYS = Object.freeze([
  'step_count',
  'tool_call_count',
  'runtime_ms',
  'private_source_bytes',
]);
const OUTCOME_INPUT_KEYS = Object.freeze(['decision', 'reason']);
const OUTCOME_RECORD_KEYS = Object.freeze(['decision', 'reason', 'display_summary']);
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
  'assignment_id',
  'assignment_status_id',
  'lease_id',
  'agent_id',
  'agent_version_id',
  'owner_id',
  'project_id',
  'conversation_id',
  'task_id',
  'run_id',
  'lease_holder_id',
  'observed_at_ms',
  'requested_next_action',
  'budget_limits',
  'budget_usage',
  'outcome',
  'audit_contract',
]);
const RECORD_KEYS = Object.freeze(['budget_audit_id', 'definition_digest', ...INPUT_KEYS, 'lifecycle', 'authority']);
const LIFECYCLE_KEYS = Object.freeze([
  'assignment',
  'supervision_lease',
  'budget_audit',
  'next_action',
  'source_materialization',
  'tool_dispatch',
  'project_revision',
]);
const AUTHORITY_KEYS = Object.freeze([
  'record_authority',
  'assignment_authority',
  'lease_authority',
  'budget_authority',
  'renderer_authority',
  'model_dispatch',
  'secret_access',
  'source_read',
  'source_write',
  'tool_dispatch',
  'process_run',
  'revision_authority',
]);
const DISPLAY_SUMMARIES = Object.freeze({
  allowed: 'Agent budget check passed.',
  denied: 'Agent budget needs owner review.',
});
const LIFECYCLE = Object.freeze({
  assignment: 'verified_active_assignment',
  supervision_lease: 'verified_active_lease_window',
  budget_audit: 'recorded_before_next_action',
  next_action: 'not_performed_by_contract',
  source_materialization: 'not_performed_by_contract',
  tool_dispatch: 'not_performed_by_contract',
  project_revision: 'not_created',
});
const AUTHORITY = Object.freeze({
  record_authority: 'main_agent_budget_audit_contract_v1',
  assignment_authority: 'main_agent_assignment_contract_v1',
  lease_authority: 'main_agent_supervision_lease_contract_v1',
  budget_authority: 'assignment_budget_snapshot_only',
  renderer_authority: 'not_present',
  model_dispatch: false,
  secret_access: 'not_present',
  source_read: 'not_performed_by_contract',
  source_write: 'not_performed_by_contract',
  tool_dispatch: 'not_performed_by_contract',
  process_run: 'not_performed_by_contract',
  revision_authority: 'not_present',
});
const ERROR_MESSAGES = Object.freeze({
  builder_agent_budget_audit_contract_invalid: 'Builder agent budget audit could not be verified.',
});

class BuilderAgentBudgetAuditContractError extends Error {
  constructor() {
    super(ERROR_MESSAGES.builder_agent_budget_audit_contract_invalid);
    this.name = 'BuilderAgentBudgetAuditContractError';
    this.code = 'builder_agent_budget_audit_contract_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderAgentBudgetAuditContractError();
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

function safeAssignmentId(value) {
  return safePattern(value, ASSIGNMENT_ID_PATTERN);
}

function safeAssignmentStatusId(value) {
  return safePattern(value, ASSIGNMENT_STATUS_ID_PATTERN);
}

function safeLeaseId(value) {
  return safePattern(value, SUPERVISION_LEASE_ID_PATTERN);
}

function safeBudgetAuditId(value) {
  return safePattern(value, BUDGET_AUDIT_ID_PATTERN);
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

function safeAction(value) {
  if (
    value !== 'start_step'
    && value !== 'call_tool'
    && value !== 'read_private_source'
    && value !== 'finish_for_review'
  ) fail();
  return value;
}

function safeDecision(value) {
  if (value !== 'allowed' && value !== 'denied') fail();
  return value;
}

function safeReason(value) {
  if (
    value !== 'none'
    && value !== 'max_steps_reached'
    && value !== 'max_tool_calls_reached'
    && value !== 'max_runtime_reached'
    && value !== 'private_source_budget_reached'
  ) fail();
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
  return freezeDeep({
    max_steps: safeIntegerRange(valueAt(value, 'max_steps'), 1, 256),
    max_tool_calls: safeIntegerRange(valueAt(value, 'max_tool_calls'), 0, 256),
    max_runtime_ms: safeIntegerRange(valueAt(value, 'max_runtime_ms'), 1_000, 86_400_000),
    max_private_source_bytes: safeIntegerRange(valueAt(value, 'max_private_source_bytes'), 0, 4 * 1_024 * 1_024),
  });
}

function safeUsage(value, budget) {
  exactObject(value, USAGE_KEYS);
  return freezeDeep({
    step_count: safeIntegerRange(valueAt(value, 'step_count'), 0, budget.max_steps),
    tool_call_count: safeIntegerRange(valueAt(value, 'tool_call_count'), 0, budget.max_tool_calls),
    runtime_ms: safeIntegerRange(valueAt(value, 'runtime_ms'), 0, budget.max_runtime_ms),
    private_source_bytes: safeIntegerRange(
      valueAt(value, 'private_source_bytes'),
      0,
      budget.max_private_source_bytes,
    ),
  });
}

function expectedOutcome(action, usage, budget) {
  if (action === 'start_step') {
    if (usage.step_count >= budget.max_steps) {
      return { decision: 'denied', reason: 'max_steps_reached' };
    }
    if (usage.runtime_ms >= budget.max_runtime_ms) {
      return { decision: 'denied', reason: 'max_runtime_reached' };
    }
  } else if (action === 'call_tool') {
    if (usage.tool_call_count >= budget.max_tool_calls) {
      return { decision: 'denied', reason: 'max_tool_calls_reached' };
    }
    if (usage.runtime_ms >= budget.max_runtime_ms) {
      return { decision: 'denied', reason: 'max_runtime_reached' };
    }
  } else if (action === 'read_private_source') {
    if (usage.private_source_bytes >= budget.max_private_source_bytes) {
      return { decision: 'denied', reason: 'private_source_budget_reached' };
    }
    if (usage.runtime_ms >= budget.max_runtime_ms) {
      return { decision: 'denied', reason: 'max_runtime_reached' };
    }
  }
  return { decision: 'allowed', reason: 'none' };
}

function safeOutcome(value, action, usage, budget) {
  exactObject(value, OUTCOME_INPUT_KEYS);
  const decision = safeDecision(valueAt(value, 'decision'));
  const reason = safeReason(valueAt(value, 'reason'));
  const expected = expectedOutcome(action, usage, budget);
  if (decision !== expected.decision || reason !== expected.reason) fail();
  return freezeDeep({
    decision,
    reason,
    display_summary: DISPLAY_SUMMARIES[decision],
  });
}

function safeOutcomeRecord(value, action, usage, budget) {
  exactObject(value, OUTCOME_RECORD_KEYS);
  const outcome = safeOutcome({
    decision: valueAt(value, 'decision'),
    reason: valueAt(value, 'reason'),
  }, action, usage, budget);
  if (valueAt(value, 'display_summary') !== outcome.display_summary) fail();
  return outcome;
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

function safeAuditFields(value, assignmentRecord, statusRecord, leaseRecord) {
  exactObject(value, INPUT_KEYS);
  const assignment = safeAssignmentReference(assignmentRecord);
  const lease = safeLeaseReference(leaseRecord, assignmentRecord, statusRecord);
  const recordVersion = valueAt(value, 'record_version');
  const recordKind = valueAt(value, 'record_kind');
  const assignmentId = safeAssignmentId(valueAt(value, 'assignment_id'));
  const assignmentStatusId = safeAssignmentStatusId(valueAt(value, 'assignment_status_id'));
  const leaseId = safeLeaseId(valueAt(value, 'lease_id'));
  const agentId = safeAgentId(valueAt(value, 'agent_id'));
  const agentVersionId = safeAgentVersionId(valueAt(value, 'agent_version_id'));
  const ownerId = safeOwnerId(valueAt(value, 'owner_id'));
  const projectId = safeProjectId(valueAt(value, 'project_id'));
  const conversationId = safeConversationId(valueAt(value, 'conversation_id'));
  const taskId = safeTaskId(valueAt(value, 'task_id'));
  const runId = safeRunId(valueAt(value, 'run_id'));
  const leaseHolderId = safeSupervisorId(valueAt(value, 'lease_holder_id'));
  const observedAtMs = safeTimestamp(valueAt(value, 'observed_at_ms'));
  const requestedNextAction = safeAction(valueAt(value, 'requested_next_action'));
  const budgetLimits = safeBudget(valueAt(value, 'budget_limits'));
  const budgetUsage = safeUsage(valueAt(value, 'budget_usage'), budgetLimits);
  if (
    recordVersion !== BUILDER_AGENT_BUDGET_AUDIT_RECORD_VERSION
    || recordKind !== BUILDER_AGENT_BUDGET_AUDIT_RECORD_KIND
    || assignment.definition_digest !== lease.definition_digest
    || assignmentId !== assignment.assignment_id
    || assignmentStatusId !== lease.assignment_status_id
    || leaseId !== lease.lease_id
    || agentId !== assignment.agent_id
    || agentId !== lease.agent_id
    || agentVersionId !== assignment.agent_version_id
    || ownerId !== assignment.owner_id
    || ownerId !== lease.owner_id
    || projectId !== assignment.project_id
    || projectId !== lease.project_id
    || conversationId !== assignment.conversation_id
    || conversationId !== lease.conversation_id
    || taskId !== assignment.task_id
    || taskId !== lease.task_id
    || runId !== assignment.run_id
    || runId !== lease.run_id
    || leaseHolderId !== lease.lease_holder_id
    || observedAtMs < lease.acquired_at_ms
    || observedAtMs > lease.expires_at_ms
    || canonicalJson(budgetLimits) !== canonicalJson(assignment.budget)
    || valueAt(value, 'audit_contract') !== 'assignment_budget_checked_before_agent_work'
  ) fail();
  return freezeDeep({
    record_version: BUILDER_AGENT_BUDGET_AUDIT_RECORD_VERSION,
    record_kind: BUILDER_AGENT_BUDGET_AUDIT_RECORD_KIND,
    assignment_id: assignmentId,
    assignment_status_id: assignmentStatusId,
    lease_id: leaseId,
    agent_id: agentId,
    agent_version_id: agentVersionId,
    owner_id: ownerId,
    project_id: projectId,
    conversation_id: conversationId,
    task_id: taskId,
    run_id: runId,
    lease_holder_id: leaseHolderId,
    observed_at_ms: observedAtMs,
    requested_next_action: requestedNextAction,
    budget_limits: budgetLimits,
    budget_usage: budgetUsage,
    outcome: safeOutcome(valueAt(value, 'outcome'), requestedNextAction, budgetUsage, budgetLimits),
    audit_contract: 'assignment_budget_checked_before_agent_work',
  });
}

function budgetAuditIdFor(definitionDigest, fields) {
  return `builder-agent-budget-audit:${sha256Canonical({
    agent_budget_audit_identity: BUILDER_AGENT_BUDGET_AUDIT_RECORD_VERSION,
    definition_digest: definitionDigest,
    fields,
  }).slice('sha256:'.length)}`;
}

function createBuilderAgentBudgetAuditRecord(value, assignmentRecord, statusRecord, leaseRecord) {
  try {
    const assignment = safeAssignmentReference(assignmentRecord);
    const fields = safeAuditFields(value, assignmentRecord, statusRecord, leaseRecord);
    return freezeDeep({
      budget_audit_id: budgetAuditIdFor(assignment.definition_digest, fields),
      definition_digest: assignment.definition_digest,
      ...fields,
      lifecycle: freezeDeep({ ...LIFECYCLE }),
      authority: freezeDeep({ ...AUTHORITY }),
    });
  } catch (error) {
    if (error instanceof BuilderAgentBudgetAuditContractError) throw error;
    fail();
  }
}

function sanitizeBuilderAgentBudgetAuditRecord(value, assignmentRecord, statusRecord, leaseRecord) {
  try {
    const assignment = safeAssignmentReference(assignmentRecord);
    exactObject(value, RECORD_KEYS);
    const budgetAuditId = safeBudgetAuditId(valueAt(value, 'budget_audit_id'));
    const definitionDigest = safeDigest(valueAt(value, 'definition_digest'));
    if (definitionDigest !== assignment.definition_digest) fail();
    const budgetLimits = safeBudget(valueAt(value, 'budget_limits'));
    const budgetUsage = safeUsage(valueAt(value, 'budget_usage'), budgetLimits);
    const requestedNextAction = safeAction(valueAt(value, 'requested_next_action'));
    const outcomeRecord = safeOutcomeRecord(
      valueAt(value, 'outcome'),
      requestedNextAction,
      budgetUsage,
      budgetLimits,
    );
    const fields = safeAuditFields({
      record_version: valueAt(value, 'record_version'),
      record_kind: valueAt(value, 'record_kind'),
      assignment_id: valueAt(value, 'assignment_id'),
      assignment_status_id: valueAt(value, 'assignment_status_id'),
      lease_id: valueAt(value, 'lease_id'),
      agent_id: valueAt(value, 'agent_id'),
      agent_version_id: valueAt(value, 'agent_version_id'),
      owner_id: valueAt(value, 'owner_id'),
      project_id: valueAt(value, 'project_id'),
      conversation_id: valueAt(value, 'conversation_id'),
      task_id: valueAt(value, 'task_id'),
      run_id: valueAt(value, 'run_id'),
      lease_holder_id: valueAt(value, 'lease_holder_id'),
      observed_at_ms: valueAt(value, 'observed_at_ms'),
      requested_next_action: requestedNextAction,
      budget_limits: budgetLimits,
      budget_usage: budgetUsage,
      outcome: {
        decision: outcomeRecord.decision,
        reason: outcomeRecord.reason,
      },
      audit_contract: valueAt(value, 'audit_contract'),
    }, assignmentRecord, statusRecord, leaseRecord);
    if (
      budgetAuditId !== budgetAuditIdFor(definitionDigest, fields)
      || !Object.isFrozen(safeLifecycle(valueAt(value, 'lifecycle')))
      || !Object.isFrozen(safeAuthority(valueAt(value, 'authority')))
    ) fail();
    return freezeDeep({
      budget_audit_id: budgetAuditId,
      definition_digest: definitionDigest,
      ...fields,
      lifecycle: freezeDeep({ ...LIFECYCLE }),
      authority: freezeDeep({ ...AUTHORITY }),
    });
  } catch (error) {
    if (error instanceof BuilderAgentBudgetAuditContractError) throw error;
    fail();
  }
}

module.exports = Object.freeze({
  BUILDER_AGENT_BUDGET_AUDIT_CONTRACT_VERSION,
  BUILDER_AGENT_BUDGET_AUDIT_RECORD_KIND,
  BUILDER_AGENT_BUDGET_AUDIT_RECORD_VERSION,
  BuilderAgentBudgetAuditContractError,
  createBuilderAgentBudgetAuditRecord,
  sanitizeBuilderAgentBudgetAuditRecord,
});
