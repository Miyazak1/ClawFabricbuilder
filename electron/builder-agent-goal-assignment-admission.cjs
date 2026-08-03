'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_AGENT_GOAL_RECORD_VERSION,
  BUILDER_AGENT_GOAL_STATUS_RECORD_VERSION,
} = require('./builder-agent-goal-contract.cjs');
const {
  BUILDER_AGENT_ASSIGNMENT_RECORD_VERSION,
} = require('./builder-agent-assignment-contract.cjs');

const BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_VERSION = 'builder-agent-goal-assignment-admission.v1';
const BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_RECORD_VERSION =
  'builder-agent-goal-assignment-admission-record.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const AGENT_ID_PATTERN = new RegExp(`^builder-agent:${UUID_SOURCE}$`, 'u');
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const AGENT_VERSION_ID_PATTERN = /^builder-agent-version:[0-9a-f]{64}$/u;
const AGENT_GOAL_ID_PATTERN = /^builder-agent-goal:[0-9a-f]{64}$/u;
const AGENT_GOAL_STATUS_ID_PATTERN = /^builder-agent-goal-status:[0-9a-f]{64}$/u;
const AGENT_ASSIGNMENT_ID_PATTERN = /^builder-agent-assignment:[0-9a-f]{64}$/u;
const GOAL_ASSIGNMENT_ADMISSION_ID_PATTERN = /^builder-agent-goal-assignment-admission:[0-9a-f]{64}$/u;
const GOAL_BUDGET_KEYS = Object.freeze([
  'max_steps',
  'max_runs',
  'max_tool_calls',
  'max_runtime_ms',
  'max_private_source_bytes',
]);
const ASSIGNMENT_BUDGET_KEYS = Object.freeze([
  'max_steps',
  'max_tool_calls',
  'max_runtime_ms',
  'max_private_source_bytes',
]);
const GOAL_RECORD_KEYS = Object.freeze([
  'goal_id',
  'definition_digest',
  'record_version',
  'agent_id',
  'agent_version_id',
  'owner_id',
  'created_by',
  'project_id',
  'conversation_id',
  'task_id',
  'objective',
  'created_at_ms',
  'permission_boundary',
  'supervision_policy',
  'execution_contract',
  'completion_contract',
  'budget',
  'lifecycle',
  'authority',
]);
const GOAL_STATUS_RECORD_KEYS = Object.freeze([
  'goal_status_id',
  'definition_digest',
  'record_version',
  'goal_id',
  'agent_id',
  'owner_id',
  'decided_by',
  'next_status',
  'reason',
  'decided_at_ms',
  'lifecycle',
  'authority',
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
const ADMISSION_INPUT_KEYS = Object.freeze([
  'record_version',
  'goal_id',
  'goal_status_id',
  'assignment_id',
  'agent_id',
  'agent_version_id',
  'owner_id',
  'project_id',
  'conversation_id',
  'task_id',
  'run_id',
  'admitted_by',
  'admitted_at_ms',
  'admission_contract',
  'materialization_boundary',
]);
const BUDGET_BOUND_KEYS = Object.freeze([
  'goal_max_steps',
  'assignment_max_steps',
  'goal_max_tool_calls',
  'assignment_max_tool_calls',
  'goal_max_runtime_ms',
  'assignment_max_runtime_ms',
  'goal_max_private_source_bytes',
  'assignment_max_private_source_bytes',
  'goal_max_runs',
  'assignment_run_scope',
]);
const ADMISSION_RECORD_KEYS = Object.freeze([
  'admission_id',
  'definition_digest',
  ...ADMISSION_INPUT_KEYS,
  'budget_bound',
  'lifecycle',
  'authority',
]);
const GOAL_LIFECYCLE_KEYS = Object.freeze([
  'goal',
  'assignment',
  'run',
  'completion',
  'source_materialization',
]);
const GOAL_AUTHORITY_KEYS = Object.freeze([
  'record_authority',
  'renderer_authority',
  'model_dispatch',
  'secret_access',
  'source_read',
  'source_write',
  'tool_dispatch',
  'process_run',
  'revision_authority',
]);
const STATUS_LIFECYCLE_KEYS = Object.freeze([
  'goal',
  'status',
  'assignment',
  'run',
  'completion',
]);
const STATUS_AUTHORITY_KEYS = Object.freeze([
  'record_authority',
  'goal_authority',
  'renderer_authority',
  'model_dispatch',
  'source_write',
  'tool_dispatch',
  'process_run',
  'revision_authority',
]);
const ADMISSION_LIFECYCLE_KEYS = Object.freeze([
  'goal',
  'goal_status',
  'assignment',
  'run',
  'execution',
  'materialization',
]);
const ADMISSION_AUTHORITY_KEYS = Object.freeze([
  'record_authority',
  'goal_authority',
  'assignment_authority',
  'renderer_authority',
  'model_dispatch',
  'secret_access',
  'source_read',
  'source_write',
  'tool_dispatch',
  'process_run',
  'permission_grant_authority',
  'revision_authority',
  'review_authority',
  'artifact_authority',
]);
const GOAL_LIFECYCLE = Object.freeze({
  goal: 'recorded_not_started',
  assignment: 'not_created_by_contract',
  run: 'not_created_by_contract',
  completion: 'requires_done_or_blocked_status_and_owner_review',
  source_materialization: 'not_performed_by_contract',
});
const GOAL_AUTHORITY = Object.freeze({
  record_authority: 'main_agent_goal_contract_v1',
  renderer_authority: 'not_present',
  model_dispatch: false,
  secret_access: 'not_present',
  source_read: 'not_performed_by_contract',
  source_write: 'not_performed_by_contract',
  tool_dispatch: 'not_performed_by_contract',
  process_run: 'not_performed_by_contract',
  revision_authority: 'not_present',
});
const STATUS_LIFECYCLE = Object.freeze({
  goal: 'verified_goal_record',
  status: 'owner_decision_recorded',
  assignment: 'not_created_by_contract',
  run: 'not_created_by_contract',
  completion: 'status_only_without_materialization',
});
const STATUS_AUTHORITY = Object.freeze({
  record_authority: 'main_agent_goal_status_contract_v1',
  goal_authority: 'main_agent_goal_contract_v1',
  renderer_authority: 'not_present',
  model_dispatch: false,
  source_write: 'not_performed_by_contract',
  tool_dispatch: 'not_performed_by_contract',
  process_run: 'not_performed_by_contract',
  revision_authority: 'not_present',
});
const ADMISSION_LIFECYCLE = Object.freeze({
  goal: 'active_goal_verified',
  goal_status: 'active_owner_decision_verified',
  assignment: 'admitted_not_recorded',
  run: 'not_started_by_admission',
  execution: 'not_started_by_admission',
  materialization: 'not_performed_by_admission',
});
const ADMISSION_AUTHORITY = Object.freeze({
  record_authority: 'main_agent_goal_assignment_admission_contract_v1',
  goal_authority: 'main_agent_goal_contract_v1',
  assignment_authority: 'main_agent_assignment_contract_v1',
  renderer_authority: 'not_present',
  model_dispatch: false,
  secret_access: 'not_present',
  source_read: 'not_performed_by_admission',
  source_write: 'not_performed_by_admission',
  tool_dispatch: 'not_performed_by_admission',
  process_run: 'not_performed_by_admission',
  permission_grant_authority: 'not_present',
  revision_authority: 'not_present',
  review_authority: 'not_present',
  artifact_authority: 'not_present',
});
const ERROR_MESSAGES = Object.freeze({
  builder_agent_goal_assignment_admission_invalid:
    'Builder agent goal assignment admission could not be verified.',
});

class BuilderAgentGoalAssignmentAdmissionError extends Error {
  constructor() {
    super(ERROR_MESSAGES.builder_agent_goal_assignment_admission_invalid);
    this.name = 'BuilderAgentGoalAssignmentAdmissionError';
    this.code = 'builder_agent_goal_assignment_admission_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderAgentGoalAssignmentAdmissionError();
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

function digestHex(value) {
  return sha256Canonical(value).slice('sha256:'.length);
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeDigest(value) {
  return safePattern(value, DIGEST_PATTERN);
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

function safeGoalId(value) {
  return safePattern(value, AGENT_GOAL_ID_PATTERN);
}

function safeGoalStatusId(value) {
  return safePattern(value, AGENT_GOAL_STATUS_ID_PATTERN);
}

function safeAssignmentId(value) {
  return safePattern(value, AGENT_ASSIGNMENT_ID_PATTERN);
}

function safeAdmissionId(value) {
  return safePattern(value, GOAL_ASSIGNMENT_ADMISSION_ID_PATTERN);
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

function safeLifecycle(value, expected, keys) {
  exactObject(value, keys);
  for (const key of keys) {
    if (valueAt(value, key) !== valueAt(expected, key)) fail();
  }
  return expected;
}

function safeAuthority(value, expected, keys) {
  exactObject(value, keys);
  for (const key of keys) {
    if (valueAt(value, key) !== valueAt(expected, key)) fail();
  }
  return expected;
}

function safeGoalBudget(value) {
  exactObject(value, GOAL_BUDGET_KEYS);
  return freezeDeep({
    max_steps: safeIntegerRange(valueAt(value, 'max_steps'), 1, 512),
    max_runs: safeIntegerRange(valueAt(value, 'max_runs'), 1, 64),
    max_tool_calls: safeIntegerRange(valueAt(value, 'max_tool_calls'), 0, 1_024),
    max_runtime_ms: safeIntegerRange(valueAt(value, 'max_runtime_ms'), 1_000, 604_800_000),
    max_private_source_bytes: safeIntegerRange(valueAt(value, 'max_private_source_bytes'), 0, 8 * 1_024 * 1_024),
  });
}

function safeAssignmentBudget(value) {
  exactObject(value, ASSIGNMENT_BUDGET_KEYS);
  return freezeDeep({
    max_steps: safeIntegerRange(valueAt(value, 'max_steps'), 1, 256),
    max_tool_calls: safeIntegerRange(valueAt(value, 'max_tool_calls'), 0, 256),
    max_runtime_ms: safeIntegerRange(valueAt(value, 'max_runtime_ms'), 1_000, 86_400_000),
    max_private_source_bytes: safeIntegerRange(valueAt(value, 'max_private_source_bytes'), 0, 4 * 1_024 * 1_024),
  });
}

function goalIdFor(definitionDigest, fields) {
  return `builder-agent-goal:${digestHex({
    agent_goal_identity: BUILDER_AGENT_GOAL_RECORD_VERSION,
    definition_digest: definitionDigest,
    fields,
  })}`;
}

function goalStatusIdFor(goal, fields) {
  return `builder-agent-goal-status:${digestHex({
    agent_goal_status_identity: BUILDER_AGENT_GOAL_STATUS_RECORD_VERSION,
    goal_id: goal.goal_id,
    definition_digest: goal.definition_digest,
    fields,
  })}`;
}

function assignmentIdFor(definitionDigest, fields) {
  return `builder-agent-assignment:${digestHex({
    agent_assignment_identity: BUILDER_AGENT_ASSIGNMENT_RECORD_VERSION,
    definition_digest: definitionDigest,
    fields,
  })}`;
}

function admissionIdFor(definitionDigest, fields, budgetBound) {
  return `builder-agent-goal-assignment-admission:${digestHex({
    agent_goal_assignment_admission_identity: BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_RECORD_VERSION,
    definition_digest: definitionDigest,
    fields,
    budget_bound: budgetBound,
  })}`;
}

function safeGoalRecord(value) {
  exactObject(value, GOAL_RECORD_KEYS);
  const definitionDigest = safeDigest(valueAt(value, 'definition_digest'));
  const fields = freezeDeep({
    record_version: valueAt(value, 'record_version'),
    agent_id: safeAgentId(valueAt(value, 'agent_id')),
    agent_version_id: safeAgentVersionId(valueAt(value, 'agent_version_id')),
    owner_id: safeOwnerId(valueAt(value, 'owner_id')),
    created_by: safeOwnerId(valueAt(value, 'created_by')),
    project_id: safeProjectId(valueAt(value, 'project_id')),
    conversation_id: safeConversationId(valueAt(value, 'conversation_id')),
    task_id: safeTaskId(valueAt(value, 'task_id')),
    objective: safeText(valueAt(value, 'objective'), 1, 2_000),
    created_at_ms: safeTimestamp(valueAt(value, 'created_at_ms')),
    permission_boundary: valueAt(value, 'permission_boundary'),
    supervision_policy: valueAt(value, 'supervision_policy'),
    execution_contract: valueAt(value, 'execution_contract'),
    completion_contract: valueAt(value, 'completion_contract'),
    budget: safeGoalBudget(valueAt(value, 'budget')),
  });
  if (
    fields.record_version !== BUILDER_AGENT_GOAL_RECORD_VERSION
    || fields.created_by !== fields.owner_id
    || fields.permission_boundary !== 'explicit_permission_required'
    || fields.supervision_policy !== 'owner_supervised'
    || fields.execution_contract !== 'continuous_until_done_or_blocked'
    || fields.completion_contract !== 'owner_review_required_before_done'
  ) fail();
  const goalId = safeGoalId(valueAt(value, 'goal_id'));
  if (goalId !== goalIdFor(definitionDigest, fields)) fail();
  safeLifecycle(valueAt(value, 'lifecycle'), GOAL_LIFECYCLE, GOAL_LIFECYCLE_KEYS);
  safeAuthority(valueAt(value, 'authority'), GOAL_AUTHORITY, GOAL_AUTHORITY_KEYS);
  return freezeDeep({ goal_id: goalId, definition_digest: definitionDigest, ...fields });
}

function safeGoalStatusRecord(value, goal) {
  exactObject(value, GOAL_STATUS_RECORD_KEYS);
  const definitionDigest = safeDigest(valueAt(value, 'definition_digest'));
  const fields = freezeDeep({
    record_version: valueAt(value, 'record_version'),
    goal_id: safeGoalId(valueAt(value, 'goal_id')),
    agent_id: safeAgentId(valueAt(value, 'agent_id')),
    owner_id: safeOwnerId(valueAt(value, 'owner_id')),
    decided_by: safeOwnerId(valueAt(value, 'decided_by')),
    next_status: valueAt(value, 'next_status'),
    reason: safeText(valueAt(value, 'reason'), 0, 280),
    decided_at_ms: safeTimestamp(valueAt(value, 'decided_at_ms')),
  });
  if (
    definitionDigest !== goal.definition_digest
    || fields.record_version !== BUILDER_AGENT_GOAL_STATUS_RECORD_VERSION
    || fields.goal_id !== goal.goal_id
    || fields.agent_id !== goal.agent_id
    || fields.owner_id !== goal.owner_id
    || fields.decided_by !== goal.owner_id
    || !['proposed', 'active', 'paused', 'blocked', 'completed', 'cancelled'].includes(fields.next_status)
  ) fail();
  const statusId = safeGoalStatusId(valueAt(value, 'goal_status_id'));
  if (statusId !== goalStatusIdFor(goal, fields)) fail();
  safeLifecycle(valueAt(value, 'lifecycle'), STATUS_LIFECYCLE, STATUS_LIFECYCLE_KEYS);
  safeAuthority(valueAt(value, 'authority'), STATUS_AUTHORITY, STATUS_AUTHORITY_KEYS);
  return freezeDeep({ goal_status_id: statusId, definition_digest: definitionDigest, ...fields });
}

function safeAssignmentRecord(value) {
  exactObject(value, ASSIGNMENT_RECORD_KEYS);
  const definitionDigest = safeDigest(valueAt(value, 'definition_digest'));
  const fields = freezeDeep({
    record_version: valueAt(value, 'record_version'),
    agent_id: safeAgentId(valueAt(value, 'agent_id')),
    agent_version_id: safeAgentVersionId(valueAt(value, 'agent_version_id')),
    owner_id: safeOwnerId(valueAt(value, 'owner_id')),
    assigned_by: safeOwnerId(valueAt(value, 'assigned_by')),
    project_id: safeProjectId(valueAt(value, 'project_id')),
    conversation_id: safeConversationId(valueAt(value, 'conversation_id')),
    task_id: safeTaskId(valueAt(value, 'task_id')),
    run_id: safeRunId(valueAt(value, 'run_id')),
    goal: safeText(valueAt(value, 'goal'), 1, 2_000),
    created_at_ms: safeTimestamp(valueAt(value, 'created_at_ms')),
    permission_boundary: valueAt(value, 'permission_boundary'),
    supervision_policy: valueAt(value, 'supervision_policy'),
    result_contract: valueAt(value, 'result_contract'),
    budget: safeAssignmentBudget(valueAt(value, 'budget')),
  });
  if (
    fields.record_version !== BUILDER_AGENT_ASSIGNMENT_RECORD_VERSION
    || fields.assigned_by !== fields.owner_id
    || fields.permission_boundary !== 'explicit_permission_required'
    || fields.supervision_policy !== 'owner_supervised'
    || fields.result_contract !== 'review_required_before_materialization'
  ) fail();
  const assignmentId = safeAssignmentId(valueAt(value, 'assignment_id'));
  if (assignmentId !== assignmentIdFor(definitionDigest, fields)) fail();
  return freezeDeep({ assignment_id: assignmentId, definition_digest: definitionDigest, ...fields });
}

function budgetBound(goal, assignment) {
  if (
    assignment.budget.max_steps > goal.budget.max_steps
    || assignment.budget.max_tool_calls > goal.budget.max_tool_calls
    || assignment.budget.max_runtime_ms > goal.budget.max_runtime_ms
    || assignment.budget.max_private_source_bytes > goal.budget.max_private_source_bytes
  ) fail();
  return freezeDeep({
    goal_max_steps: goal.budget.max_steps,
    assignment_max_steps: assignment.budget.max_steps,
    goal_max_tool_calls: goal.budget.max_tool_calls,
    assignment_max_tool_calls: assignment.budget.max_tool_calls,
    goal_max_runtime_ms: goal.budget.max_runtime_ms,
    assignment_max_runtime_ms: assignment.budget.max_runtime_ms,
    goal_max_private_source_bytes: goal.budget.max_private_source_bytes,
    assignment_max_private_source_bytes: assignment.budget.max_private_source_bytes,
    goal_max_runs: goal.budget.max_runs,
    assignment_run_scope: 'single_assignment_run',
  });
}

function safeBudgetBound(value, expected) {
  exactObject(value, BUDGET_BOUND_KEYS);
  const normalized = freezeDeep({
    goal_max_steps: safeIntegerRange(valueAt(value, 'goal_max_steps'), 1, 512),
    assignment_max_steps: safeIntegerRange(valueAt(value, 'assignment_max_steps'), 1, 256),
    goal_max_tool_calls: safeIntegerRange(valueAt(value, 'goal_max_tool_calls'), 0, 1_024),
    assignment_max_tool_calls: safeIntegerRange(valueAt(value, 'assignment_max_tool_calls'), 0, 256),
    goal_max_runtime_ms: safeIntegerRange(valueAt(value, 'goal_max_runtime_ms'), 1_000, 604_800_000),
    assignment_max_runtime_ms: safeIntegerRange(valueAt(value, 'assignment_max_runtime_ms'), 1_000, 86_400_000),
    goal_max_private_source_bytes:
      safeIntegerRange(valueAt(value, 'goal_max_private_source_bytes'), 0, 8 * 1_024 * 1_024),
    assignment_max_private_source_bytes:
      safeIntegerRange(valueAt(value, 'assignment_max_private_source_bytes'), 0, 4 * 1_024 * 1_024),
    goal_max_runs: safeIntegerRange(valueAt(value, 'goal_max_runs'), 1, 64),
    assignment_run_scope: valueAt(value, 'assignment_run_scope'),
  });
  if (canonicalJson(normalized) !== canonicalJson(expected)) fail();
  return expected;
}

function safeAdmissionFields(value, goal, goalStatus, assignment) {
  exactObject(value, ADMISSION_INPUT_KEYS);
  const fields = freezeDeep({
    record_version: valueAt(value, 'record_version'),
    goal_id: safeGoalId(valueAt(value, 'goal_id')),
    goal_status_id: safeGoalStatusId(valueAt(value, 'goal_status_id')),
    assignment_id: safeAssignmentId(valueAt(value, 'assignment_id')),
    agent_id: safeAgentId(valueAt(value, 'agent_id')),
    agent_version_id: safeAgentVersionId(valueAt(value, 'agent_version_id')),
    owner_id: safeOwnerId(valueAt(value, 'owner_id')),
    project_id: safeProjectId(valueAt(value, 'project_id')),
    conversation_id: safeConversationId(valueAt(value, 'conversation_id')),
    task_id: safeTaskId(valueAt(value, 'task_id')),
    run_id: safeRunId(valueAt(value, 'run_id')),
    admitted_by: safeOwnerId(valueAt(value, 'admitted_by')),
    admitted_at_ms: safeTimestamp(valueAt(value, 'admitted_at_ms')),
    admission_contract: valueAt(value, 'admission_contract'),
    materialization_boundary: valueAt(value, 'materialization_boundary'),
  });
  if (
    fields.record_version !== BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_RECORD_VERSION
    || fields.goal_id !== goal.goal_id
    || fields.goal_status_id !== goalStatus.goal_status_id
    || fields.assignment_id !== assignment.assignment_id
    || fields.agent_id !== goal.agent_id
    || fields.agent_id !== assignment.agent_id
    || fields.agent_version_id !== goal.agent_version_id
    || fields.agent_version_id !== assignment.agent_version_id
    || fields.owner_id !== goal.owner_id
    || fields.owner_id !== assignment.owner_id
    || fields.admitted_by !== fields.owner_id
    || fields.project_id !== goal.project_id
    || fields.project_id !== assignment.project_id
    || fields.conversation_id !== goal.conversation_id
    || fields.conversation_id !== assignment.conversation_id
    || fields.task_id !== goal.task_id
    || fields.task_id !== assignment.task_id
    || fields.run_id !== assignment.run_id
    || goalStatus.next_status !== 'active'
    || assignment.goal !== goal.objective
    || assignment.created_at_ms < goal.created_at_ms
    || fields.admitted_at_ms < goalStatus.decided_at_ms
    || fields.admitted_at_ms < assignment.created_at_ms
    || fields.admission_contract !== 'active_goal_to_owner_supervised_assignment'
    || fields.materialization_boundary !== 'assignment_record_required_before_execution'
  ) fail();
  return fields;
}

function createBuilderAgentGoalAssignmentAdmissionRecord(value, goalRecord, goalStatusRecord, assignmentRecord) {
  try {
    const goal = safeGoalRecord(goalRecord);
    const goalStatus = safeGoalStatusRecord(goalStatusRecord, goal);
    const assignment = safeAssignmentRecord(assignmentRecord);
    if (assignment.definition_digest !== goal.definition_digest) fail();
    const fields = safeAdmissionFields(value, goal, goalStatus, assignment);
    const bound = budgetBound(goal, assignment);
    return freezeDeep({
      admission_id: admissionIdFor(goal.definition_digest, fields, bound),
      definition_digest: goal.definition_digest,
      ...fields,
      budget_bound: bound,
      lifecycle: ADMISSION_LIFECYCLE,
      authority: ADMISSION_AUTHORITY,
    });
  } catch (error) {
    if (error instanceof BuilderAgentGoalAssignmentAdmissionError) throw error;
    fail();
  }
}

function sanitizeBuilderAgentGoalAssignmentAdmissionRecord(
  value,
  goalRecord,
  goalStatusRecord,
  assignmentRecord,
) {
  try {
    const goal = safeGoalRecord(goalRecord);
    const goalStatus = safeGoalStatusRecord(goalStatusRecord, goal);
    const assignment = safeAssignmentRecord(assignmentRecord);
    if (assignment.definition_digest !== goal.definition_digest) fail();
    exactObject(value, ADMISSION_RECORD_KEYS);
    const admissionId = safeAdmissionId(valueAt(value, 'admission_id'));
    const definitionDigest = safeDigest(valueAt(value, 'definition_digest'));
    if (definitionDigest !== goal.definition_digest) fail();
    const fields = safeAdmissionFields({
      record_version: valueAt(value, 'record_version'),
      goal_id: valueAt(value, 'goal_id'),
      goal_status_id: valueAt(value, 'goal_status_id'),
      assignment_id: valueAt(value, 'assignment_id'),
      agent_id: valueAt(value, 'agent_id'),
      agent_version_id: valueAt(value, 'agent_version_id'),
      owner_id: valueAt(value, 'owner_id'),
      project_id: valueAt(value, 'project_id'),
      conversation_id: valueAt(value, 'conversation_id'),
      task_id: valueAt(value, 'task_id'),
      run_id: valueAt(value, 'run_id'),
      admitted_by: valueAt(value, 'admitted_by'),
      admitted_at_ms: valueAt(value, 'admitted_at_ms'),
      admission_contract: valueAt(value, 'admission_contract'),
      materialization_boundary: valueAt(value, 'materialization_boundary'),
    }, goal, goalStatus, assignment);
    const bound = budgetBound(goal, assignment);
    safeBudgetBound(valueAt(value, 'budget_bound'), bound);
    if (admissionId !== admissionIdFor(goal.definition_digest, fields, bound)) fail();
    return freezeDeep({
      admission_id: admissionId,
      definition_digest: definitionDigest,
      ...fields,
      budget_bound: bound,
      lifecycle: safeLifecycle(valueAt(value, 'lifecycle'), ADMISSION_LIFECYCLE, ADMISSION_LIFECYCLE_KEYS),
      authority: safeAuthority(valueAt(value, 'authority'), ADMISSION_AUTHORITY, ADMISSION_AUTHORITY_KEYS),
    });
  } catch (error) {
    if (error instanceof BuilderAgentGoalAssignmentAdmissionError) throw error;
    fail();
  }
}

module.exports = Object.freeze({
  BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_RECORD_VERSION,
  BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_VERSION,
  BuilderAgentGoalAssignmentAdmissionError,
  createBuilderAgentGoalAssignmentAdmissionRecord,
  sanitizeBuilderAgentGoalAssignmentAdmissionRecord,
});
