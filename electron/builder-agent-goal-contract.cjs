'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');
const {
  sanitizeBuilderAgentDefinitionRecord,
  sanitizeBuilderAgentVersionRecord,
} = require('./builder-agent-definition-contract.cjs');

const BUILDER_AGENT_GOAL_CONTRACT_VERSION = 'builder-agent-goal-contract.v1';
const BUILDER_AGENT_GOAL_RECORD_VERSION = 'builder-agent-goal-record.v1';
const BUILDER_AGENT_GOAL_STATUS_RECORD_VERSION = 'builder-agent-goal-status-record.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const AGENT_ID_PATTERN = new RegExp(`^builder-agent:${UUID_SOURCE}$`, 'u');
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const AGENT_VERSION_ID_PATTERN = /^builder-agent-version:[0-9a-f]{64}$/u;
const AGENT_GOAL_ID_PATTERN = /^builder-agent-goal:[0-9a-f]{64}$/u;
const AGENT_GOAL_STATUS_ID_PATTERN = /^builder-agent-goal-status:[0-9a-f]{64}$/u;
const GOAL_BUDGET_KEYS = Object.freeze([
  'max_steps',
  'max_runs',
  'max_tool_calls',
  'max_runtime_ms',
  'max_private_source_bytes',
]);
const GOAL_INPUT_KEYS = Object.freeze([
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
]);
const GOAL_RECORD_KEYS = Object.freeze([
  'goal_id',
  'definition_digest',
  ...GOAL_INPUT_KEYS,
  'lifecycle',
  'authority',
]);
const GOAL_STATUS_INPUT_KEYS = Object.freeze([
  'record_version',
  'goal_id',
  'agent_id',
  'owner_id',
  'decided_by',
  'next_status',
  'reason',
  'decided_at_ms',
]);
const GOAL_STATUS_RECORD_KEYS = Object.freeze([
  'goal_status_id',
  'definition_digest',
  ...GOAL_STATUS_INPUT_KEYS,
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
const ERROR_MESSAGES = Object.freeze({
  builder_agent_goal_contract_invalid: 'Builder agent goal could not be verified.',
});

class BuilderAgentGoalContractError extends Error {
  constructor() {
    super(ERROR_MESSAGES.builder_agent_goal_contract_invalid);
    this.name = 'BuilderAgentGoalContractError';
    this.code = 'builder_agent_goal_contract_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderAgentGoalContractError();
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

function safeGoalId(value) {
  return safePattern(value, AGENT_GOAL_ID_PATTERN);
}

function safeGoalStatusId(value) {
  return safePattern(value, AGENT_GOAL_STATUS_ID_PATTERN);
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

function safeGoalFields(value, agentVersionRecord, definitionRecord) {
  exactObject(value, GOAL_INPUT_KEYS);
  const definition = sanitizeBuilderAgentDefinitionRecord(definitionRecord);
  const version = sanitizeBuilderAgentVersionRecord(agentVersionRecord, definition);
  const recordVersion = valueAt(value, 'record_version');
  const agentId = safeAgentId(valueAt(value, 'agent_id'));
  const agentVersionId = safeAgentVersionId(valueAt(value, 'agent_version_id'));
  const ownerId = safeOwnerId(valueAt(value, 'owner_id'));
  const createdBy = safeOwnerId(valueAt(value, 'created_by'));
  if (
    recordVersion !== BUILDER_AGENT_GOAL_RECORD_VERSION
    || agentId !== version.agent_id
    || agentVersionId !== version.agent_version_id
    || ownerId !== version.owner_id
    || createdBy !== ownerId
    || valueAt(value, 'permission_boundary') !== 'explicit_permission_required'
    || valueAt(value, 'supervision_policy') !== 'owner_supervised'
    || valueAt(value, 'execution_contract') !== 'continuous_until_done_or_blocked'
    || valueAt(value, 'completion_contract') !== 'owner_review_required_before_done'
  ) fail();
  return freezeDeep({
    record_version: BUILDER_AGENT_GOAL_RECORD_VERSION,
    agent_id: agentId,
    agent_version_id: agentVersionId,
    owner_id: ownerId,
    created_by: createdBy,
    project_id: safeProjectId(valueAt(value, 'project_id')),
    conversation_id: safeConversationId(valueAt(value, 'conversation_id')),
    task_id: safeTaskId(valueAt(value, 'task_id')),
    objective: safeText(valueAt(value, 'objective'), 1, 2_000),
    created_at_ms: safeTimestamp(valueAt(value, 'created_at_ms')),
    permission_boundary: 'explicit_permission_required',
    supervision_policy: 'owner_supervised',
    execution_contract: 'continuous_until_done_or_blocked',
    completion_contract: 'owner_review_required_before_done',
    budget: safeGoalBudget(valueAt(value, 'budget')),
  });
}

function goalIdFor(definition, fields) {
  return `builder-agent-goal:${sha256Canonical({
    agent_goal_identity: BUILDER_AGENT_GOAL_RECORD_VERSION,
    definition_digest: definition.definition_digest,
    fields,
  }).slice('sha256:'.length)}`;
}

function createBuilderAgentGoalRecord(value, agentVersionRecord, definitionRecord) {
  try {
    const definition = sanitizeBuilderAgentDefinitionRecord(definitionRecord);
    const fields = safeGoalFields(value, agentVersionRecord, definition);
    return freezeDeep({
      goal_id: goalIdFor(definition, fields),
      definition_digest: definition.definition_digest,
      ...fields,
      lifecycle: GOAL_LIFECYCLE,
      authority: GOAL_AUTHORITY,
    });
  } catch (error) {
    if (error instanceof BuilderAgentGoalContractError) throw error;
    fail();
  }
}

function sanitizeBuilderAgentGoalRecord(value, agentVersionRecord, definitionRecord) {
  try {
    const definition = sanitizeBuilderAgentDefinitionRecord(definitionRecord);
    exactObject(value, GOAL_RECORD_KEYS);
    const goalId = safeGoalId(valueAt(value, 'goal_id'));
    const definitionDigest = safeDigest(valueAt(value, 'definition_digest'));
    if (definitionDigest !== definition.definition_digest) fail();
    const fields = safeGoalFields({
      record_version: valueAt(value, 'record_version'),
      agent_id: valueAt(value, 'agent_id'),
      agent_version_id: valueAt(value, 'agent_version_id'),
      owner_id: valueAt(value, 'owner_id'),
      created_by: valueAt(value, 'created_by'),
      project_id: valueAt(value, 'project_id'),
      conversation_id: valueAt(value, 'conversation_id'),
      task_id: valueAt(value, 'task_id'),
      objective: valueAt(value, 'objective'),
      created_at_ms: valueAt(value, 'created_at_ms'),
      permission_boundary: valueAt(value, 'permission_boundary'),
      supervision_policy: valueAt(value, 'supervision_policy'),
      execution_contract: valueAt(value, 'execution_contract'),
      completion_contract: valueAt(value, 'completion_contract'),
      budget: valueAt(value, 'budget'),
    }, agentVersionRecord, definition);
    if (goalId !== goalIdFor(definition, fields)) fail();
    return freezeDeep({
      goal_id: goalId,
      definition_digest: definitionDigest,
      ...fields,
      lifecycle: safeLifecycle(valueAt(value, 'lifecycle'), GOAL_LIFECYCLE, GOAL_LIFECYCLE_KEYS),
      authority: safeAuthority(valueAt(value, 'authority'), GOAL_AUTHORITY, GOAL_AUTHORITY_KEYS),
    });
  } catch (error) {
    if (error instanceof BuilderAgentGoalContractError) throw error;
    fail();
  }
}

function safeGoalRecordReference(value) {
  exactObject(value, GOAL_RECORD_KEYS);
  return freezeDeep({
    goal_id: safeGoalId(valueAt(value, 'goal_id')),
    definition_digest: safeDigest(valueAt(value, 'definition_digest')),
    agent_id: safeAgentId(valueAt(value, 'agent_id')),
    owner_id: safeOwnerId(valueAt(value, 'owner_id')),
  });
}

function safeGoalStatus(value) {
  if (
    value !== 'proposed'
    && value !== 'active'
    && value !== 'paused'
    && value !== 'blocked'
    && value !== 'completed'
    && value !== 'cancelled'
  ) fail();
  return value;
}

function safeGoalStatusFields(value, goalRecord) {
  exactObject(value, GOAL_STATUS_INPUT_KEYS);
  const recordVersion = valueAt(value, 'record_version');
  const goalId = safeGoalId(valueAt(value, 'goal_id'));
  const agentId = safeAgentId(valueAt(value, 'agent_id'));
  const ownerId = safeOwnerId(valueAt(value, 'owner_id'));
  const decidedBy = safeOwnerId(valueAt(value, 'decided_by'));
  if (
    recordVersion !== BUILDER_AGENT_GOAL_STATUS_RECORD_VERSION
    || goalId !== goalRecord.goal_id
    || agentId !== goalRecord.agent_id
    || ownerId !== goalRecord.owner_id
    || decidedBy !== goalRecord.owner_id
  ) fail();
  return freezeDeep({
    record_version: BUILDER_AGENT_GOAL_STATUS_RECORD_VERSION,
    goal_id: goalId,
    agent_id: agentId,
    owner_id: ownerId,
    decided_by: decidedBy,
    next_status: safeGoalStatus(valueAt(value, 'next_status')),
    reason: safeText(valueAt(value, 'reason'), 0, 280),
    decided_at_ms: safeTimestamp(valueAt(value, 'decided_at_ms')),
  });
}

function goalStatusIdFor(goalRecord, fields) {
  return `builder-agent-goal-status:${sha256Canonical({
    agent_goal_status_identity: BUILDER_AGENT_GOAL_STATUS_RECORD_VERSION,
    goal_id: goalRecord.goal_id,
    definition_digest: goalRecord.definition_digest,
    fields,
  }).slice('sha256:'.length)}`;
}

function createBuilderAgentGoalStatusRecord(value, goalRecord) {
  try {
    const goal = safeGoalRecordReference(goalRecord);
    const fields = safeGoalStatusFields(value, goal);
    return freezeDeep({
      goal_status_id: goalStatusIdFor(goal, fields),
      definition_digest: goal.definition_digest,
      ...fields,
      lifecycle: STATUS_LIFECYCLE,
      authority: STATUS_AUTHORITY,
    });
  } catch (error) {
    if (error instanceof BuilderAgentGoalContractError) throw error;
    fail();
  }
}

function sanitizeBuilderAgentGoalStatusRecord(value, goalRecord) {
  try {
    const goal = safeGoalRecordReference(goalRecord);
    exactObject(value, GOAL_STATUS_RECORD_KEYS);
    const statusId = safeGoalStatusId(valueAt(value, 'goal_status_id'));
    const definitionDigest = safeDigest(valueAt(value, 'definition_digest'));
    if (definitionDigest !== goal.definition_digest) fail();
    const fields = safeGoalStatusFields({
      record_version: valueAt(value, 'record_version'),
      goal_id: valueAt(value, 'goal_id'),
      agent_id: valueAt(value, 'agent_id'),
      owner_id: valueAt(value, 'owner_id'),
      decided_by: valueAt(value, 'decided_by'),
      next_status: valueAt(value, 'next_status'),
      reason: valueAt(value, 'reason'),
      decided_at_ms: valueAt(value, 'decided_at_ms'),
    }, goal);
    if (statusId !== goalStatusIdFor(goal, fields)) fail();
    return freezeDeep({
      goal_status_id: statusId,
      definition_digest: definitionDigest,
      ...fields,
      lifecycle: safeLifecycle(valueAt(value, 'lifecycle'), STATUS_LIFECYCLE, STATUS_LIFECYCLE_KEYS),
      authority: safeAuthority(valueAt(value, 'authority'), STATUS_AUTHORITY, STATUS_AUTHORITY_KEYS),
    });
  } catch (error) {
    if (error instanceof BuilderAgentGoalContractError) throw error;
    fail();
  }
}

module.exports = Object.freeze({
  BUILDER_AGENT_GOAL_CONTRACT_VERSION,
  BUILDER_AGENT_GOAL_RECORD_VERSION,
  BUILDER_AGENT_GOAL_STATUS_RECORD_VERSION,
  BuilderAgentGoalContractError,
  createBuilderAgentGoalRecord,
  createBuilderAgentGoalStatusRecord,
  sanitizeBuilderAgentGoalRecord,
  sanitizeBuilderAgentGoalStatusRecord,
});
