'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');
const {
  sanitizeBuilderAgentSupervisionLeaseRecord,
} = require('./builder-agent-supervision-lease-contract.cjs');

const BUILDER_AGENT_PROJECT_WORK_CONTRACT_VERSION = 'builder-agent-project-work-contract.v1';
const BUILDER_AGENT_PROJECT_WORK_RESULT_RECORD_VERSION = 'builder-agent-project-work-result-record.v1';
const BUILDER_AGENT_PROJECT_WORK_RESULT_RECORD_KIND = 'builder_agent_project_work_result_record';
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
const WORK_RESULT_ID_PATTERN = /^builder-agent-project-work-result:[0-9a-f]{64}$/u;
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
const RESULT_INPUT_KEYS = Object.freeze(['status', 'summary_code']);
const RESULT_RECORD_KEYS = Object.freeze(['status', 'summary_code', 'display_summary']);
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
  'work_kind',
  'observed_at_ms',
  'result',
  'review_contract',
  'materialization_boundary',
]);
const RECORD_KEYS = Object.freeze(['work_result_id', 'definition_digest', ...INPUT_KEYS, 'lifecycle', 'authority']);
const LIFECYCLE_KEYS = Object.freeze([
  'assignment',
  'supervision_lease',
  'work_preparation',
  'review',
  'source_materialization',
  'check_run',
  'project_revision',
  'publication',
]);
const AUTHORITY_KEYS = Object.freeze([
  'record_authority',
  'assignment_authority',
  'lease_authority',
  'owner_review_authority',
  'renderer_authority',
  'model_dispatch',
  'secret_access',
  'source_read',
  'source_write',
  'process_run',
  'network_access',
  'revision_authority',
]);
const WORK_KIND_SUMMARY_CODES = Object.freeze({
  project_edit: Object.freeze({
    proposed: 'project_edit_candidate_ready_for_review',
    blocked: 'project_edit_needs_owner_attention',
    failed: 'project_edit_could_not_be_prepared',
  }),
  project_test: Object.freeze({
    proposed: 'project_check_plan_ready_for_review',
    blocked: 'project_check_needs_owner_attention',
    failed: 'project_check_could_not_be_prepared',
  }),
});
const DISPLAY_SUMMARIES = Object.freeze({
  project_edit_candidate_ready_for_review: 'Project changes are ready for review.',
  project_edit_needs_owner_attention: 'Project changes need owner attention.',
  project_edit_could_not_be_prepared: 'Project changes could not be prepared.',
  project_check_plan_ready_for_review: 'Project checks are ready for review.',
  project_check_needs_owner_attention: 'Project checks need owner attention.',
  project_check_could_not_be_prepared: 'Project checks could not be prepared.',
});
const LIFECYCLE = Object.freeze({
  assignment: 'verified_active_assignment',
  supervision_lease: 'verified_active_lease_window',
  work_preparation: 'recorded_for_owner_review',
  review: 'owner_review_required',
  source_materialization: 'not_performed_by_contract',
  check_run: 'not_performed_by_contract',
  project_revision: 'not_created',
  publication: 'not_created',
});
const AUTHORITY = Object.freeze({
  record_authority: 'main_agent_project_work_contract_v1',
  assignment_authority: 'main_agent_assignment_contract_v1',
  lease_authority: 'main_agent_supervision_lease_contract_v1',
  owner_review_authority: 'required_before_materialization',
  renderer_authority: 'not_present',
  model_dispatch: false,
  secret_access: 'not_present',
  source_read: 'not_performed_by_contract',
  source_write: 'not_performed_by_contract',
  process_run: 'not_performed_by_contract',
  network_access: 'not_present',
  revision_authority: 'not_present',
});
const ERROR_MESSAGES = Object.freeze({
  builder_agent_project_work_contract_invalid: 'Builder agent project work could not be verified.',
});

class BuilderAgentProjectWorkContractError extends Error {
  constructor() {
    super(ERROR_MESSAGES.builder_agent_project_work_contract_invalid);
    this.name = 'BuilderAgentProjectWorkContractError';
    this.code = 'builder_agent_project_work_contract_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderAgentProjectWorkContractError();
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

function safeWorkResultId(value) {
  return safePattern(value, WORK_RESULT_ID_PATTERN);
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

function safeWorkKind(value) {
  if (value !== 'project_edit' && value !== 'project_test') fail();
  return value;
}

function safeResultStatus(value) {
  if (value !== 'proposed' && value !== 'blocked' && value !== 'failed') fail();
  return value;
}

function safeResult(value, workKind) {
  exactObject(value, RESULT_INPUT_KEYS);
  const status = safeResultStatus(valueAt(value, 'status'));
  const summaryCode = valueAt(value, 'summary_code');
  if (summaryCode !== WORK_KIND_SUMMARY_CODES[workKind][status]) fail();
  const displaySummary = DISPLAY_SUMMARIES[summaryCode];
  if (typeof displaySummary !== 'string') fail();
  return freezeDeep({
    status,
    summary_code: summaryCode,
    display_summary: displaySummary,
  });
}

function safeResultRecord(value, workKind) {
  exactObject(value, RESULT_RECORD_KEYS);
  const result = safeResult({
    status: valueAt(value, 'status'),
    summary_code: valueAt(value, 'summary_code'),
  }, workKind);
  if (valueAt(value, 'display_summary') !== result.display_summary) fail();
  return result;
}

function safeAssignmentReference(value) {
  exactObject(value, ASSIGNMENT_RECORD_KEYS);
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

function safeWorkFields(value, assignmentRecord, statusRecord, leaseRecord) {
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
  const workKind = safeWorkKind(valueAt(value, 'work_kind'));
  const observedAtMs = safeTimestamp(valueAt(value, 'observed_at_ms'));
  if (
    recordVersion !== BUILDER_AGENT_PROJECT_WORK_RESULT_RECORD_VERSION
    || recordKind !== BUILDER_AGENT_PROJECT_WORK_RESULT_RECORD_KIND
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
    || valueAt(value, 'review_contract') !== 'owner_review_required_before_materialization'
    || valueAt(value, 'materialization_boundary') !== 'no_source_mutation_no_check_run'
  ) fail();
  return freezeDeep({
    record_version: BUILDER_AGENT_PROJECT_WORK_RESULT_RECORD_VERSION,
    record_kind: BUILDER_AGENT_PROJECT_WORK_RESULT_RECORD_KIND,
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
    work_kind: workKind,
    observed_at_ms: observedAtMs,
    result: safeResult(valueAt(value, 'result'), workKind),
    review_contract: 'owner_review_required_before_materialization',
    materialization_boundary: 'no_source_mutation_no_check_run',
  });
}

function workResultIdFor(definitionDigest, fields) {
  return `builder-agent-project-work-result:${sha256Canonical({
    agent_project_work_result_identity: BUILDER_AGENT_PROJECT_WORK_RESULT_RECORD_VERSION,
    definition_digest: definitionDigest,
    fields,
  }).slice('sha256:'.length)}`;
}

function createBuilderAgentProjectWorkResultRecord(value, assignmentRecord, statusRecord, leaseRecord) {
  try {
    const assignment = safeAssignmentReference(assignmentRecord);
    const fields = safeWorkFields(value, assignmentRecord, statusRecord, leaseRecord);
    return freezeDeep({
      work_result_id: workResultIdFor(assignment.definition_digest, fields),
      definition_digest: assignment.definition_digest,
      ...fields,
      lifecycle: freezeDeep({ ...LIFECYCLE }),
      authority: freezeDeep({ ...AUTHORITY }),
    });
  } catch (error) {
    if (error instanceof BuilderAgentProjectWorkContractError) throw error;
    fail();
  }
}

function sanitizeBuilderAgentProjectWorkResultRecord(value, assignmentRecord, statusRecord, leaseRecord) {
  try {
    const assignment = safeAssignmentReference(assignmentRecord);
    exactObject(value, RECORD_KEYS);
    const workResultId = safeWorkResultId(valueAt(value, 'work_result_id'));
    const definitionDigest = safeDigest(valueAt(value, 'definition_digest'));
    if (definitionDigest !== assignment.definition_digest) fail();
    const workKind = safeWorkKind(valueAt(value, 'work_kind'));
    const resultRecord = safeResultRecord(valueAt(value, 'result'), workKind);
    const fields = safeWorkFields({
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
      work_kind: workKind,
      observed_at_ms: valueAt(value, 'observed_at_ms'),
      result: {
        status: resultRecord.status,
        summary_code: resultRecord.summary_code,
      },
      review_contract: valueAt(value, 'review_contract'),
      materialization_boundary: valueAt(value, 'materialization_boundary'),
    }, assignmentRecord, statusRecord, leaseRecord);
    if (
      workResultId !== workResultIdFor(definitionDigest, fields)
      || !Object.isFrozen(safeLifecycle(valueAt(value, 'lifecycle')))
      || !Object.isFrozen(safeAuthority(valueAt(value, 'authority')))
    ) fail();
    return freezeDeep({
      work_result_id: workResultId,
      definition_digest: definitionDigest,
      ...fields,
      lifecycle: freezeDeep({ ...LIFECYCLE }),
      authority: freezeDeep({ ...AUTHORITY }),
    });
  } catch (error) {
    if (error instanceof BuilderAgentProjectWorkContractError) throw error;
    fail();
  }
}

module.exports = Object.freeze({
  BUILDER_AGENT_PROJECT_WORK_CONTRACT_VERSION,
  BUILDER_AGENT_PROJECT_WORK_RESULT_RECORD_VERSION,
  BUILDER_AGENT_PROJECT_WORK_RESULT_RECORD_KIND,
  BuilderAgentProjectWorkContractError,
  createBuilderAgentProjectWorkResultRecord,
  sanitizeBuilderAgentProjectWorkResultRecord,
});
