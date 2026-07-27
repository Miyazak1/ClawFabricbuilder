'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');
const {
  sanitizeBuilderAgentDefinitionRecord,
  sanitizeBuilderAgentVersionRecord,
} = require('./builder-agent-definition-contract.cjs');

const BUILDER_AGENT_ASSIGNMENT_CONTRACT_VERSION = 'builder-agent-assignment-contract.v1';
const BUILDER_AGENT_ASSIGNMENT_RECORD_VERSION = 'builder-agent-assignment-record.v1';
const BUILDER_AGENT_ASSIGNMENT_STATUS_RECORD_VERSION = 'builder-agent-assignment-status-record.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const AGENT_ID_PATTERN = new RegExp(`^builder-agent:${UUID_SOURCE}$`, 'u');
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const AGENT_VERSION_ID_PATTERN = /^builder-agent-version:[0-9a-f]{64}$/u;
const AGENT_ASSIGNMENT_ID_PATTERN = /^builder-agent-assignment:[0-9a-f]{64}$/u;
const AGENT_ASSIGNMENT_STATUS_ID_PATTERN = /^builder-agent-assignment-status:[0-9a-f]{64}$/u;
const ASSIGNMENT_BUDGET_KEYS = Object.freeze([
  'max_steps',
  'max_tool_calls',
  'max_runtime_ms',
  'max_private_source_bytes',
]);
const ASSIGNMENT_INPUT_KEYS = Object.freeze([
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
const ASSIGNMENT_RECORD_KEYS = Object.freeze(['assignment_id', 'definition_digest', ...ASSIGNMENT_INPUT_KEYS]);
const ASSIGNMENT_STATUS_INPUT_KEYS = Object.freeze([
  'record_version',
  'assignment_id',
  'agent_id',
  'owner_id',
  'decided_by',
  'next_status',
  'reason',
  'decided_at_ms',
]);
const ASSIGNMENT_STATUS_RECORD_KEYS = Object.freeze([
  'assignment_status_id',
  'definition_digest',
  ...ASSIGNMENT_STATUS_INPUT_KEYS,
]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_assignment_contract_invalid: 'Builder agent assignment could not be verified.',
});

class BuilderAgentAssignmentContractError extends Error {
  constructor() {
    super(ERROR_MESSAGES.builder_agent_assignment_contract_invalid);
    this.name = 'BuilderAgentAssignmentContractError';
    this.code = 'builder_agent_assignment_contract_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderAgentAssignmentContractError();
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

function safeOwnerId(value) {
  return safePattern(value, OWNER_ID_PATTERN);
}

function safeAgentVersionId(value) {
  return safePattern(value, AGENT_VERSION_ID_PATTERN);
}

function safeAgentAssignmentId(value) {
  return safePattern(value, AGENT_ASSIGNMENT_ID_PATTERN);
}

function safeAgentAssignmentStatusId(value) {
  return safePattern(value, AGENT_ASSIGNMENT_STATUS_ID_PATTERN);
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

function safeAssignmentBudget(value) {
  exactObject(value, ASSIGNMENT_BUDGET_KEYS);
  return freezeDeep({
    max_steps: safeIntegerRange(valueAt(value, 'max_steps'), 1, 256),
    max_tool_calls: safeIntegerRange(valueAt(value, 'max_tool_calls'), 0, 256),
    max_runtime_ms: safeIntegerRange(valueAt(value, 'max_runtime_ms'), 1_000, 86_400_000),
    max_private_source_bytes: safeIntegerRange(valueAt(value, 'max_private_source_bytes'), 0, 4 * 1_024 * 1_024),
  });
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

function safeAssignmentFields(value, agentVersionRecord, definitionRecord) {
  exactObject(value, ASSIGNMENT_INPUT_KEYS);
  const definition = sanitizeBuilderAgentDefinitionRecord(definitionRecord);
  const version = sanitizeBuilderAgentVersionRecord(agentVersionRecord, definition);
  const recordVersion = valueAt(value, 'record_version');
  const agentId = safeAgentId(valueAt(value, 'agent_id'));
  const agentVersionId = safeAgentVersionId(valueAt(value, 'agent_version_id'));
  const ownerId = safeOwnerId(valueAt(value, 'owner_id'));
  const assignedBy = safeOwnerId(valueAt(value, 'assigned_by'));
  if (
    recordVersion !== BUILDER_AGENT_ASSIGNMENT_RECORD_VERSION
    || agentId !== version.agent_id
    || agentVersionId !== version.agent_version_id
    || ownerId !== version.owner_id
    || assignedBy !== ownerId
    || valueAt(value, 'permission_boundary') !== 'explicit_permission_required'
    || valueAt(value, 'supervision_policy') !== 'owner_supervised'
    || valueAt(value, 'result_contract') !== 'review_required_before_materialization'
  ) fail();
  return freezeDeep({
    record_version: BUILDER_AGENT_ASSIGNMENT_RECORD_VERSION,
    agent_id: agentId,
    agent_version_id: agentVersionId,
    owner_id: ownerId,
    assigned_by: assignedBy,
    project_id: safeProjectId(valueAt(value, 'project_id')),
    conversation_id: safeConversationId(valueAt(value, 'conversation_id')),
    task_id: safeTaskId(valueAt(value, 'task_id')),
    run_id: safeRunId(valueAt(value, 'run_id')),
    goal: safeText(valueAt(value, 'goal'), 1, 2_000),
    created_at_ms: safeTimestamp(valueAt(value, 'created_at_ms')),
    permission_boundary: 'explicit_permission_required',
    supervision_policy: 'owner_supervised',
    result_contract: 'review_required_before_materialization',
    budget: safeAssignmentBudget(valueAt(value, 'budget')),
  });
}

function assignmentIdFor(definition, fields) {
  return `builder-agent-assignment:${sha256Canonical({
    agent_assignment_identity: BUILDER_AGENT_ASSIGNMENT_RECORD_VERSION,
    definition_digest: definition.definition_digest,
    fields,
  }).slice('sha256:'.length)}`;
}

function createBuilderAgentAssignmentRecord(value, agentVersionRecord, definitionRecord) {
  try {
    const definition = sanitizeBuilderAgentDefinitionRecord(definitionRecord);
    const fields = safeAssignmentFields(value, agentVersionRecord, definition);
    return freezeDeep({
      assignment_id: assignmentIdFor(definition, fields),
      definition_digest: definition.definition_digest,
      ...fields,
    });
  } catch (error) {
    if (error instanceof BuilderAgentAssignmentContractError) throw error;
    fail();
  }
}

function sanitizeBuilderAgentAssignmentRecord(value, agentVersionRecord, definitionRecord) {
  try {
    const definition = sanitizeBuilderAgentDefinitionRecord(definitionRecord);
    exactObject(value, ASSIGNMENT_RECORD_KEYS);
    const assignmentId = safeAgentAssignmentId(valueAt(value, 'assignment_id'));
    const definitionDigest = safeDigest(valueAt(value, 'definition_digest'));
    if (definitionDigest !== definition.definition_digest) fail();
    const fields = safeAssignmentFields({
      record_version: valueAt(value, 'record_version'),
      agent_id: valueAt(value, 'agent_id'),
      agent_version_id: valueAt(value, 'agent_version_id'),
      owner_id: valueAt(value, 'owner_id'),
      assigned_by: valueAt(value, 'assigned_by'),
      project_id: valueAt(value, 'project_id'),
      conversation_id: valueAt(value, 'conversation_id'),
      task_id: valueAt(value, 'task_id'),
      run_id: valueAt(value, 'run_id'),
      goal: valueAt(value, 'goal'),
      created_at_ms: valueAt(value, 'created_at_ms'),
      permission_boundary: valueAt(value, 'permission_boundary'),
      supervision_policy: valueAt(value, 'supervision_policy'),
      result_contract: valueAt(value, 'result_contract'),
      budget: valueAt(value, 'budget'),
    }, agentVersionRecord, definition);
    if (assignmentId !== assignmentIdFor(definition, fields)) fail();
    return freezeDeep({ assignment_id: assignmentId, definition_digest: definitionDigest, ...fields });
  } catch (error) {
    if (error instanceof BuilderAgentAssignmentContractError) throw error;
    fail();
  }
}

function safeAssignmentStatus(value) {
  if (
    value !== 'queued'
    && value !== 'active'
    && value !== 'paused'
    && value !== 'cancelled'
    && value !== 'completed'
  ) fail();
  return value;
}

function safeAssignmentStatusFields(value, assignmentRecord) {
  exactObject(value, ASSIGNMENT_STATUS_INPUT_KEYS);
  const recordVersion = valueAt(value, 'record_version');
  const assignmentId = safeAgentAssignmentId(valueAt(value, 'assignment_id'));
  const agentId = safeAgentId(valueAt(value, 'agent_id'));
  const ownerId = safeOwnerId(valueAt(value, 'owner_id'));
  const decidedBy = safeOwnerId(valueAt(value, 'decided_by'));
  if (
    recordVersion !== BUILDER_AGENT_ASSIGNMENT_STATUS_RECORD_VERSION
    || assignmentId !== assignmentRecord.assignment_id
    || agentId !== assignmentRecord.agent_id
    || ownerId !== assignmentRecord.owner_id
    || decidedBy !== assignmentRecord.owner_id
  ) fail();
  return freezeDeep({
    record_version: BUILDER_AGENT_ASSIGNMENT_STATUS_RECORD_VERSION,
    assignment_id: assignmentId,
    agent_id: agentId,
    owner_id: ownerId,
    decided_by: decidedBy,
    next_status: safeAssignmentStatus(valueAt(value, 'next_status')),
    reason: safeText(valueAt(value, 'reason'), 0, 280),
    decided_at_ms: safeTimestamp(valueAt(value, 'decided_at_ms')),
  });
}

function safeAssignmentRecordReference(value) {
  exactObject(value, ASSIGNMENT_RECORD_KEYS);
  return freezeDeep({
    assignment_id: safeAgentAssignmentId(valueAt(value, 'assignment_id')),
    definition_digest: safeDigest(valueAt(value, 'definition_digest')),
    agent_id: safeAgentId(valueAt(value, 'agent_id')),
    owner_id: safeOwnerId(valueAt(value, 'owner_id')),
  });
}

function assignmentStatusIdFor(assignmentRecord, fields) {
  return `builder-agent-assignment-status:${sha256Canonical({
    agent_assignment_status_identity: BUILDER_AGENT_ASSIGNMENT_STATUS_RECORD_VERSION,
    assignment_id: assignmentRecord.assignment_id,
    definition_digest: assignmentRecord.definition_digest,
    fields,
  }).slice('sha256:'.length)}`;
}

function createBuilderAgentAssignmentStatusRecord(value, assignmentRecord) {
  try {
    const assignment = safeAssignmentRecordReference(assignmentRecord);
    const fields = safeAssignmentStatusFields(value, assignment);
    return freezeDeep({
      assignment_status_id: assignmentStatusIdFor(assignment, fields),
      definition_digest: assignment.definition_digest,
      ...fields,
    });
  } catch (error) {
    if (error instanceof BuilderAgentAssignmentContractError) throw error;
    fail();
  }
}

function sanitizeBuilderAgentAssignmentStatusRecord(value, assignmentRecord) {
  try {
    const assignment = safeAssignmentRecordReference(assignmentRecord);
    exactObject(value, ASSIGNMENT_STATUS_RECORD_KEYS);
    const assignmentStatusId = safeAgentAssignmentStatusId(valueAt(value, 'assignment_status_id'));
    const definitionDigest = safeDigest(valueAt(value, 'definition_digest'));
    if (definitionDigest !== assignment.definition_digest) fail();
    const fields = safeAssignmentStatusFields({
      record_version: valueAt(value, 'record_version'),
      assignment_id: valueAt(value, 'assignment_id'),
      agent_id: valueAt(value, 'agent_id'),
      owner_id: valueAt(value, 'owner_id'),
      decided_by: valueAt(value, 'decided_by'),
      next_status: valueAt(value, 'next_status'),
      reason: valueAt(value, 'reason'),
      decided_at_ms: valueAt(value, 'decided_at_ms'),
    }, assignment);
    if (assignmentStatusId !== assignmentStatusIdFor(assignment, fields)) fail();
    return freezeDeep({ assignment_status_id: assignmentStatusId, definition_digest: definitionDigest, ...fields });
  } catch (error) {
    if (error instanceof BuilderAgentAssignmentContractError) throw error;
    fail();
  }
}

module.exports = Object.freeze({
  BUILDER_AGENT_ASSIGNMENT_CONTRACT_VERSION,
  BUILDER_AGENT_ASSIGNMENT_RECORD_VERSION,
  BUILDER_AGENT_ASSIGNMENT_STATUS_RECORD_VERSION,
  BuilderAgentAssignmentContractError,
  createBuilderAgentAssignmentRecord,
  createBuilderAgentAssignmentStatusRecord,
  sanitizeBuilderAgentAssignmentRecord,
  sanitizeBuilderAgentAssignmentStatusRecord,
});
