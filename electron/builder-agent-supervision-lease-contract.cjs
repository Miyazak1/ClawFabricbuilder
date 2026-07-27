'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');
const {
  sanitizeBuilderAgentAssignmentStatusRecord,
} = require('./builder-agent-assignment-contract.cjs');

const BUILDER_AGENT_SUPERVISION_LEASE_CONTRACT_VERSION = 'builder-agent-supervision-lease-contract.v1';
const BUILDER_AGENT_SUPERVISION_LEASE_RECORD_VERSION = 'builder-agent-supervision-lease-record.v1';
const BUILDER_AGENT_SUPERVISION_LEASE_RELEASE_RECORD_VERSION = 'builder-agent-supervision-lease-release-record.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const AGENT_ID_PATTERN = new RegExp(`^builder-agent:${UUID_SOURCE}$`, 'u');
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const SUPERVISOR_ID_PATTERN = new RegExp(`^builder-supervisor:${UUID_SOURCE}$`, 'u');
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ASSIGNMENT_ID_PATTERN = /^builder-agent-assignment:[0-9a-f]{64}$/u;
const ASSIGNMENT_STATUS_ID_PATTERN = /^builder-agent-assignment-status:[0-9a-f]{64}$/u;
const SUPERVISION_LEASE_ID_PATTERN = /^builder-agent-supervision-lease:[0-9a-f]{64}$/u;
const SUPERVISION_LEASE_RELEASE_ID_PATTERN = /^builder-agent-supervision-lease-release:[0-9a-f]{64}$/u;
const MAX_LEASE_TTL_MS = 10 * 60 * 1_000;
const LEASE_INPUT_KEYS = Object.freeze([
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
const LEASE_RECORD_KEYS = Object.freeze(['lease_id', 'definition_digest', ...LEASE_INPUT_KEYS]);
const RELEASE_INPUT_KEYS = Object.freeze([
  'record_version',
  'lease_id',
  'assignment_id',
  'owner_id',
  'lease_holder_id',
  'released_by',
  'released_at_ms',
  'release_outcome',
  'reason',
]);
const RELEASE_RECORD_KEYS = Object.freeze(['lease_release_id', 'definition_digest', ...RELEASE_INPUT_KEYS]);
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
const ERROR_MESSAGES = Object.freeze({
  builder_agent_supervision_lease_contract_invalid: 'Builder agent supervision lease could not be verified.',
});

class BuilderAgentSupervisionLeaseContractError extends Error {
  constructor() {
    super(ERROR_MESSAGES.builder_agent_supervision_lease_contract_invalid);
    this.name = 'BuilderAgentSupervisionLeaseContractError';
    this.code = 'builder_agent_supervision_lease_contract_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderAgentSupervisionLeaseContractError();
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

function safeLeaseReleaseId(value) {
  return safePattern(value, SUPERVISION_LEASE_RELEASE_ID_PATTERN);
}

function safeAgentId(value) {
  return safePattern(value, AGENT_ID_PATTERN);
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

function safePositiveInteger(value, max) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) fail();
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

function safeReleaseOutcome(value) {
  if (
    value !== 'completed'
    && value !== 'cancelled'
    && value !== 'expired'
    && value !== 'failed'
    && value !== 'superseded'
  ) fail();
  return value;
}

function safeAssignmentReference(value) {
  exactObject(value, ASSIGNMENT_RECORD_KEYS);
  return freezeDeep({
    assignment_id: safeAssignmentId(valueAt(value, 'assignment_id')),
    definition_digest: safeDigest(valueAt(value, 'definition_digest')),
    agent_id: safeAgentId(valueAt(value, 'agent_id')),
    owner_id: safeOwnerId(valueAt(value, 'owner_id')),
    project_id: safeProjectId(valueAt(value, 'project_id')),
    conversation_id: safeConversationId(valueAt(value, 'conversation_id')),
    task_id: safeTaskId(valueAt(value, 'task_id')),
    run_id: safeRunId(valueAt(value, 'run_id')),
  });
}

function activeAssignmentStatus(statusRecord, assignmentRecord) {
  const status = sanitizeBuilderAgentAssignmentStatusRecord(statusRecord, assignmentRecord);
  if (status.next_status !== 'active') fail();
  return status;
}

function safeLeaseFields(value, assignmentRecord, statusRecord) {
  exactObject(value, LEASE_INPUT_KEYS);
  const assignment = safeAssignmentReference(assignmentRecord);
  const status = activeAssignmentStatus(statusRecord, assignmentRecord);
  const recordVersion = valueAt(value, 'record_version');
  const assignmentId = safeAssignmentId(valueAt(value, 'assignment_id'));
  const assignmentStatusId = safeAssignmentStatusId(valueAt(value, 'assignment_status_id'));
  const agentId = safeAgentId(valueAt(value, 'agent_id'));
  const ownerId = safeOwnerId(valueAt(value, 'owner_id'));
  const projectId = safeProjectId(valueAt(value, 'project_id'));
  const conversationId = safeConversationId(valueAt(value, 'conversation_id'));
  const taskId = safeTaskId(valueAt(value, 'task_id'));
  const runId = safeRunId(valueAt(value, 'run_id'));
  const acquiredAtMs = safeTimestamp(valueAt(value, 'acquired_at_ms'));
  const expiresAtMs = safeTimestamp(valueAt(value, 'expires_at_ms'));
  if (
    recordVersion !== BUILDER_AGENT_SUPERVISION_LEASE_RECORD_VERSION
    || assignmentId !== assignment.assignment_id
    || assignmentStatusId !== status.assignment_status_id
    || agentId !== assignment.agent_id
    || ownerId !== assignment.owner_id
    || projectId !== assignment.project_id
    || conversationId !== assignment.conversation_id
    || taskId !== assignment.task_id
    || runId !== assignment.run_id
    || acquiredAtMs < status.decided_at_ms
    || expiresAtMs <= acquiredAtMs
    || expiresAtMs - acquiredAtMs > MAX_LEASE_TTL_MS
    || valueAt(value, 'redispatch_policy') !== 'lease_required_no_duplicate_dispatch'
    || valueAt(value, 'supervision_state') !== 'active_assignment_only'
    || valueAt(value, 'authority_boundary') !== 'main_supervision_lease_only'
  ) fail();
  return freezeDeep({
    record_version: BUILDER_AGENT_SUPERVISION_LEASE_RECORD_VERSION,
    assignment_id: assignmentId,
    assignment_status_id: assignmentStatusId,
    agent_id: agentId,
    owner_id: ownerId,
    project_id: projectId,
    conversation_id: conversationId,
    task_id: taskId,
    run_id: runId,
    lease_holder_id: safeSupervisorId(valueAt(value, 'lease_holder_id')),
    lease_epoch: safePositiveInteger(valueAt(value, 'lease_epoch'), 1_000_000),
    acquired_at_ms: acquiredAtMs,
    expires_at_ms: expiresAtMs,
    purpose: safeText(valueAt(value, 'purpose'), 1, 280),
    redispatch_policy: 'lease_required_no_duplicate_dispatch',
    supervision_state: 'active_assignment_only',
    authority_boundary: 'main_supervision_lease_only',
  });
}

function leaseIdFor(definitionDigest, fields) {
  return `builder-agent-supervision-lease:${sha256Canonical({
    agent_supervision_lease_identity: BUILDER_AGENT_SUPERVISION_LEASE_RECORD_VERSION,
    definition_digest: definitionDigest,
    fields,
  }).slice('sha256:'.length)}`;
}

function createBuilderAgentSupervisionLeaseRecord(value, assignmentRecord, statusRecord) {
  try {
    const assignment = safeAssignmentReference(assignmentRecord);
    const definitionDigest = assignment.definition_digest;
    const fields = safeLeaseFields(value, assignmentRecord, statusRecord);
    return freezeDeep({
      lease_id: leaseIdFor(definitionDigest, fields),
      definition_digest: definitionDigest,
      ...fields,
    });
  } catch (error) {
    if (error instanceof BuilderAgentSupervisionLeaseContractError) throw error;
    fail();
  }
}

function sanitizeBuilderAgentSupervisionLeaseRecord(value, assignmentRecord, statusRecord) {
  try {
    exactObject(value, LEASE_RECORD_KEYS);
    const leaseId = safeLeaseId(valueAt(value, 'lease_id'));
    const definitionDigest = safeDigest(valueAt(value, 'definition_digest'));
    const fields = safeLeaseFields({
      record_version: valueAt(value, 'record_version'),
      assignment_id: valueAt(value, 'assignment_id'),
      assignment_status_id: valueAt(value, 'assignment_status_id'),
      agent_id: valueAt(value, 'agent_id'),
      owner_id: valueAt(value, 'owner_id'),
      project_id: valueAt(value, 'project_id'),
      conversation_id: valueAt(value, 'conversation_id'),
      task_id: valueAt(value, 'task_id'),
      run_id: valueAt(value, 'run_id'),
      lease_holder_id: valueAt(value, 'lease_holder_id'),
      lease_epoch: valueAt(value, 'lease_epoch'),
      acquired_at_ms: valueAt(value, 'acquired_at_ms'),
      expires_at_ms: valueAt(value, 'expires_at_ms'),
      purpose: valueAt(value, 'purpose'),
      redispatch_policy: valueAt(value, 'redispatch_policy'),
      supervision_state: valueAt(value, 'supervision_state'),
      authority_boundary: valueAt(value, 'authority_boundary'),
    }, assignmentRecord, statusRecord);
    if (leaseId !== leaseIdFor(definitionDigest, fields)) fail();
    return freezeDeep({ lease_id: leaseId, definition_digest: definitionDigest, ...fields });
  } catch (error) {
    if (error instanceof BuilderAgentSupervisionLeaseContractError) throw error;
    fail();
  }
}

function safeLeaseReference(value) {
  exactObject(value, LEASE_RECORD_KEYS);
  return freezeDeep({
    lease_id: safeLeaseId(valueAt(value, 'lease_id')),
    definition_digest: safeDigest(valueAt(value, 'definition_digest')),
    assignment_id: safeAssignmentId(valueAt(value, 'assignment_id')),
    owner_id: safeOwnerId(valueAt(value, 'owner_id')),
    lease_holder_id: safeSupervisorId(valueAt(value, 'lease_holder_id')),
    acquired_at_ms: safeTimestamp(valueAt(value, 'acquired_at_ms')),
    expires_at_ms: safeTimestamp(valueAt(value, 'expires_at_ms')),
  });
}

function safeReleaseFields(value, leaseRecord) {
  exactObject(value, RELEASE_INPUT_KEYS);
  const lease = safeLeaseReference(leaseRecord);
  const recordVersion = valueAt(value, 'record_version');
  const leaseId = safeLeaseId(valueAt(value, 'lease_id'));
  const assignmentId = safeAssignmentId(valueAt(value, 'assignment_id'));
  const ownerId = safeOwnerId(valueAt(value, 'owner_id'));
  const leaseHolderId = safeSupervisorId(valueAt(value, 'lease_holder_id'));
  const releasedBy = safeSupervisorId(valueAt(value, 'released_by'));
  const releasedAtMs = safeTimestamp(valueAt(value, 'released_at_ms'));
  const releaseOutcome = safeReleaseOutcome(valueAt(value, 'release_outcome'));
  if (
    recordVersion !== BUILDER_AGENT_SUPERVISION_LEASE_RELEASE_RECORD_VERSION
    || leaseId !== lease.lease_id
    || assignmentId !== lease.assignment_id
    || ownerId !== lease.owner_id
    || leaseHolderId !== lease.lease_holder_id
    || releasedBy !== lease.lease_holder_id
    || releasedAtMs < lease.acquired_at_ms
    || (releaseOutcome === 'expired' && releasedAtMs < lease.expires_at_ms)
    || (releaseOutcome !== 'expired' && releasedAtMs > lease.expires_at_ms)
  ) fail();
  return freezeDeep({
    record_version: BUILDER_AGENT_SUPERVISION_LEASE_RELEASE_RECORD_VERSION,
    lease_id: leaseId,
    assignment_id: assignmentId,
    owner_id: ownerId,
    lease_holder_id: leaseHolderId,
    released_by: releasedBy,
    released_at_ms: releasedAtMs,
    release_outcome: releaseOutcome,
    reason: safeText(valueAt(value, 'reason'), 0, 280),
  });
}

function leaseReleaseIdFor(leaseRecord, fields) {
  return `builder-agent-supervision-lease-release:${sha256Canonical({
    agent_supervision_lease_release_identity: BUILDER_AGENT_SUPERVISION_LEASE_RELEASE_RECORD_VERSION,
    lease_id: leaseRecord.lease_id,
    definition_digest: leaseRecord.definition_digest,
    fields,
  }).slice('sha256:'.length)}`;
}

function createBuilderAgentSupervisionLeaseReleaseRecord(value, leaseRecord) {
  try {
    const lease = safeLeaseReference(leaseRecord);
    const fields = safeReleaseFields(value, leaseRecord);
    return freezeDeep({
      lease_release_id: leaseReleaseIdFor(lease, fields),
      definition_digest: lease.definition_digest,
      ...fields,
    });
  } catch (error) {
    if (error instanceof BuilderAgentSupervisionLeaseContractError) throw error;
    fail();
  }
}

function sanitizeBuilderAgentSupervisionLeaseReleaseRecord(value, leaseRecord) {
  try {
    const lease = safeLeaseReference(leaseRecord);
    exactObject(value, RELEASE_RECORD_KEYS);
    const leaseReleaseId = safeLeaseReleaseId(valueAt(value, 'lease_release_id'));
    const definitionDigest = safeDigest(valueAt(value, 'definition_digest'));
    if (definitionDigest !== lease.definition_digest) fail();
    const fields = safeReleaseFields({
      record_version: valueAt(value, 'record_version'),
      lease_id: valueAt(value, 'lease_id'),
      assignment_id: valueAt(value, 'assignment_id'),
      owner_id: valueAt(value, 'owner_id'),
      lease_holder_id: valueAt(value, 'lease_holder_id'),
      released_by: valueAt(value, 'released_by'),
      released_at_ms: valueAt(value, 'released_at_ms'),
      release_outcome: valueAt(value, 'release_outcome'),
      reason: valueAt(value, 'reason'),
    }, leaseRecord);
    if (leaseReleaseId !== leaseReleaseIdFor(lease, fields)) fail();
    return freezeDeep({ lease_release_id: leaseReleaseId, definition_digest: definitionDigest, ...fields });
  } catch (error) {
    if (error instanceof BuilderAgentSupervisionLeaseContractError) throw error;
    fail();
  }
}

module.exports = Object.freeze({
  BUILDER_AGENT_SUPERVISION_LEASE_CONTRACT_VERSION,
  BUILDER_AGENT_SUPERVISION_LEASE_RECORD_VERSION,
  BUILDER_AGENT_SUPERVISION_LEASE_RELEASE_RECORD_VERSION,
  BuilderAgentSupervisionLeaseContractError,
  createBuilderAgentSupervisionLeaseRecord,
  createBuilderAgentSupervisionLeaseReleaseRecord,
  sanitizeBuilderAgentSupervisionLeaseRecord,
  sanitizeBuilderAgentSupervisionLeaseReleaseRecord,
});
