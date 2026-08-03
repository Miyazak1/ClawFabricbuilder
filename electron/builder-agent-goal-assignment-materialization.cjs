'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  BuilderAgentAssignmentContractError,
  sanitizeBuilderAgentAssignmentStatusRecord,
} = require('./builder-agent-assignment-contract.cjs');
const {
  BuilderAgentGoalAssignmentAdmissionError,
  sanitizeBuilderAgentGoalAssignmentAdmissionRecord,
} = require('./builder-agent-goal-assignment-admission.cjs');

const BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_VERSION =
  'builder-agent-goal-assignment-materialization.v1';
const BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_RECORD_VERSION =
  'builder-agent-goal-assignment-materialization-record.v1';
const BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_RECORD_KIND =
  'builder_agent_goal_assignment_materialization_record';
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
const AGENT_ASSIGNMENT_STATUS_ID_PATTERN = /^builder-agent-assignment-status:[0-9a-f]{64}$/u;
const GOAL_ASSIGNMENT_ADMISSION_ID_PATTERN =
  /^builder-agent-goal-assignment-admission:[0-9a-f]{64}$/u;
const MATERIALIZATION_ID_PATTERN =
  /^builder-agent-goal-assignment-materialization:[0-9a-f]{64}$/u;
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
const ASSIGNMENT_READ_KEYS = Object.freeze([
  'result_version',
  'assignment_authority',
  'status',
  'assignment_id',
  'owner_id',
  'assignment',
  'statuses',
  'current_status',
  'evidence',
]);
const ASSIGNMENT_EVIDENCE_KEYS = Object.freeze([
  'database_id',
  'schema_version',
  'user_version',
  'schema_fingerprint_digest',
  'runtime_pragmas',
  'transaction',
  'assignment_authority',
  'renderer_authority',
  'ipc_authority',
  'provider_dispatch',
  'tool_dispatch',
  'permission_grant_authority',
  'credential_storage',
  'source_access',
  'revision_authority',
  'review_authority',
]);
const RUNTIME_PRAGMA_KEYS = Object.freeze([
  'foreign_keys',
  'journal_mode',
  'synchronous',
  'trusted_schema',
]);
const INPUT_KEYS = Object.freeze([
  'record_version',
  'record_kind',
  'admission_id',
  'goal_id',
  'goal_status_id',
  'assignment_id',
  'assignment_status_id',
  'agent_id',
  'agent_version_id',
  'owner_id',
  'project_id',
  'conversation_id',
  'task_id',
  'run_id',
  'materialized_by',
  'materialized_at_ms',
  'materialization_contract',
  'execution_boundary',
]);
const RECORD_KEYS = Object.freeze([
  'materialization_id',
  'definition_digest',
  ...INPUT_KEYS,
  'lifecycle',
  'authority',
]);
const LIFECYCLE_KEYS = Object.freeze([
  'goal',
  'goal_status',
  'goal_assignment_admission',
  'assignment_store',
  'assignment_status',
  'run',
  'execution',
  'source_materialization',
]);
const AUTHORITY_KEYS = Object.freeze([
  'record_authority',
  'goal_authority',
  'admission_authority',
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
const LIFECYCLE = Object.freeze({
  goal: 'active_goal_verified',
  goal_status: 'active_owner_decision_verified',
  goal_assignment_admission: 'verified_admitted_for_assignment_recording',
  assignment_store: 'recorded_as_owner_supervised_assignment',
  assignment_status: 'queued_initial_status_recorded',
  run: 'not_started_by_materialization',
  execution: 'not_started_by_materialization',
  source_materialization: 'not_performed_by_materialization',
});
const AUTHORITY = Object.freeze({
  record_authority: 'main_agent_goal_assignment_materialization_contract_v1',
  goal_authority: 'main_agent_goal_contract_v1',
  admission_authority: 'main_owned_agent_goal_assignment_admission_store',
  assignment_authority: 'main_owned_agent_assignment_store',
  renderer_authority: 'not_present',
  model_dispatch: false,
  secret_access: 'not_present',
  source_read: 'not_performed_by_materialization',
  source_write: 'not_performed_by_materialization',
  tool_dispatch: 'not_performed_by_materialization',
  process_run: 'not_performed_by_materialization',
  permission_grant_authority: 'not_present',
  revision_authority: 'not_present',
  review_authority: 'not_present',
  artifact_authority: 'not_present',
});
const ERROR_MESSAGES = Object.freeze({
  builder_agent_goal_assignment_materialization_invalid:
    'Builder agent goal assignment materialization could not be verified.',
});

class BuilderAgentGoalAssignmentMaterializationError extends Error {
  constructor() {
    super(ERROR_MESSAGES.builder_agent_goal_assignment_materialization_invalid);
    this.name = 'BuilderAgentGoalAssignmentMaterializationError';
    this.code = 'builder_agent_goal_assignment_materialization_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderAgentGoalAssignmentMaterializationError();
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
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
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
  return nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeOwnerId(value) {
  return safePattern(value, OWNER_ID_PATTERN);
}

function safeAgentId(value) {
  return safePattern(value, AGENT_ID_PATTERN);
}

function safeAgentVersionId(value) {
  return safePattern(value, AGENT_VERSION_ID_PATTERN);
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

function safeAssignmentStatusId(value) {
  return safePattern(value, AGENT_ASSIGNMENT_STATUS_ID_PATTERN);
}

function safeAdmissionId(value) {
  return safePattern(value, GOAL_ASSIGNMENT_ADMISSION_ID_PATTERN);
}

function safeMaterializationId(value) {
  return safePattern(value, MATERIALIZATION_ID_PATTERN);
}

function safeDigest(value) {
  return safePattern(value, DIGEST_PATTERN);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeAssignmentRecordReference(value) {
  exactObject(value, ASSIGNMENT_RECORD_KEYS);
  return freezeDeep({
    assignment_id: safeAssignmentId(valueAt(value, 'assignment_id')),
    definition_digest: safeDigest(valueAt(value, 'definition_digest')),
    record_version: valueAt(value, 'record_version'),
    agent_id: safeAgentId(valueAt(value, 'agent_id')),
    agent_version_id: safeAgentVersionId(valueAt(value, 'agent_version_id')),
    owner_id: safeOwnerId(valueAt(value, 'owner_id')),
    assigned_by: safeOwnerId(valueAt(value, 'assigned_by')),
    project_id: safeProjectId(valueAt(value, 'project_id')),
    conversation_id: safeConversationId(valueAt(value, 'conversation_id')),
    task_id: safeTaskId(valueAt(value, 'task_id')),
    run_id: safeRunId(valueAt(value, 'run_id')),
    goal: valueAt(value, 'goal'),
    created_at_ms: safeTimestamp(valueAt(value, 'created_at_ms')),
    permission_boundary: valueAt(value, 'permission_boundary'),
    supervision_policy: valueAt(value, 'supervision_policy'),
    result_contract: valueAt(value, 'result_contract'),
    budget: valueAt(value, 'budget'),
  });
}

function safeRuntimePragmas(value) {
  exactObject(value, RUNTIME_PRAGMA_KEYS);
  if (
    valueAt(value, 'foreign_keys') !== 'on'
    || valueAt(value, 'journal_mode') !== 'wal'
    || valueAt(value, 'synchronous') !== 'full'
    || valueAt(value, 'trusted_schema') !== 'off'
  ) fail();
  return freezeDeep({
    foreign_keys: 'on',
    journal_mode: 'wal',
    synchronous: 'full',
    trusted_schema: 'off',
  });
}

function safeAssignmentEvidence(value) {
  exactObject(value, ASSIGNMENT_EVIDENCE_KEYS);
  if (
    valueAt(value, 'database_id') !== 'builder-agent-assignment-store.v1'
    || valueAt(value, 'schema_version') !== 'builder-agent-assignment-store-schema.v1'
    || valueAt(value, 'user_version') !== 1
    || valueAt(value, 'transaction') !== 'assignment_ready_read'
    || valueAt(value, 'assignment_authority') !== 'main_owned_agent_assignment_store'
    || valueAt(value, 'renderer_authority') !== 'not_present'
    || valueAt(value, 'ipc_authority') !== 'not_present'
    || valueAt(value, 'provider_dispatch') !== false
    || valueAt(value, 'tool_dispatch') !== false
    || valueAt(value, 'permission_grant_authority') !== false
    || valueAt(value, 'credential_storage') !== 'not_present'
    || valueAt(value, 'source_access') !== 'not_present'
    || valueAt(value, 'revision_authority') !== false
    || valueAt(value, 'review_authority') !== false
  ) fail();
  return freezeDeep({
    database_id: 'builder-agent-assignment-store.v1',
    schema_version: 'builder-agent-assignment-store-schema.v1',
    user_version: 1,
    schema_fingerprint_digest: safePattern(valueAt(value, 'schema_fingerprint_digest'), /^[a-f0-9]{64}$/u),
    runtime_pragmas: safeRuntimePragmas(valueAt(value, 'runtime_pragmas')),
    transaction: 'assignment_ready_read',
    assignment_authority: 'main_owned_agent_assignment_store',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    tool_dispatch: false,
    permission_grant_authority: false,
    credential_storage: 'not_present',
    source_access: 'not_present',
    revision_authority: false,
    review_authority: false,
  });
}

function safeStatusArray(value, assignment) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length !== 1) fail();
  const descriptor = Object.getOwnPropertyDescriptor(value, '0');
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  const status = sanitizeBuilderAgentAssignmentStatusRecord(descriptor.value, assignment);
  if (status.next_status !== 'queued') fail();
  return freezeDeep([status]);
}

function safeAssignmentReadResult(value) {
  exactObject(value, ASSIGNMENT_READ_KEYS);
  if (
    valueAt(value, 'result_version') !== 'builder-agent-assignment-store-read-result.v1'
    || valueAt(value, 'assignment_authority') !== 'main_owned_agent_assignment_store'
    || valueAt(value, 'status') !== 'ready'
    || valueAt(value, 'current_status') !== 'queued'
  ) fail();
  const assignment = safeAssignmentRecordReference(valueAt(value, 'assignment'));
  const assignmentId = safeAssignmentId(valueAt(value, 'assignment_id'));
  const ownerId = safeOwnerId(valueAt(value, 'owner_id'));
  if (assignment.assignment_id !== assignmentId || assignment.owner_id !== ownerId) fail();
  const statuses = safeStatusArray(valueAt(value, 'statuses'), assignment);
  if (statuses[0].assignment_id !== assignment.assignment_id || statuses[0].owner_id !== ownerId) fail();
  return freezeDeep({
    result_version: 'builder-agent-assignment-store-read-result.v1',
    assignment_authority: 'main_owned_agent_assignment_store',
    status: 'ready',
    assignment_id: assignmentId,
    owner_id: ownerId,
    assignment,
    statuses,
    current_status: 'queued',
    evidence: safeAssignmentEvidence(valueAt(value, 'evidence')),
  });
}

function safeLifecycle(value) {
  exactObject(value, LIFECYCLE_KEYS);
  for (const key of LIFECYCLE_KEYS) {
    if (valueAt(value, key) !== LIFECYCLE[key]) fail();
  }
  return LIFECYCLE;
}

function safeAuthority(value) {
  exactObject(value, AUTHORITY_KEYS);
  for (const key of AUTHORITY_KEYS) {
    if (valueAt(value, key) !== AUTHORITY[key]) fail();
  }
  return AUTHORITY;
}

function safeFields(value, admission, assignmentRead) {
  exactObject(value, INPUT_KEYS);
  const fields = freezeDeep({
    record_version: valueAt(value, 'record_version'),
    record_kind: valueAt(value, 'record_kind'),
    admission_id: safeAdmissionId(valueAt(value, 'admission_id')),
    goal_id: safeGoalId(valueAt(value, 'goal_id')),
    goal_status_id: safeGoalStatusId(valueAt(value, 'goal_status_id')),
    assignment_id: safeAssignmentId(valueAt(value, 'assignment_id')),
    assignment_status_id: safeAssignmentStatusId(valueAt(value, 'assignment_status_id')),
    agent_id: safeAgentId(valueAt(value, 'agent_id')),
    agent_version_id: safeAgentVersionId(valueAt(value, 'agent_version_id')),
    owner_id: safeOwnerId(valueAt(value, 'owner_id')),
    project_id: safeProjectId(valueAt(value, 'project_id')),
    conversation_id: safeConversationId(valueAt(value, 'conversation_id')),
    task_id: safeTaskId(valueAt(value, 'task_id')),
    run_id: safeRunId(valueAt(value, 'run_id')),
    materialized_by: safeOwnerId(valueAt(value, 'materialized_by')),
    materialized_at_ms: safeTimestamp(valueAt(value, 'materialized_at_ms')),
    materialization_contract: valueAt(value, 'materialization_contract'),
    execution_boundary: valueAt(value, 'execution_boundary'),
  });
  const assignment = assignmentRead.assignment;
  const queuedStatus = assignmentRead.statuses[0];
  if (
    fields.record_version !== BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_RECORD_VERSION
    || fields.record_kind !== BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_RECORD_KIND
    || fields.admission_id !== admission.admission_id
    || fields.goal_id !== admission.goal_id
    || fields.goal_status_id !== admission.goal_status_id
    || fields.assignment_id !== admission.assignment_id
    || fields.assignment_id !== assignment.assignment_id
    || fields.assignment_status_id !== queuedStatus.assignment_status_id
    || fields.agent_id !== admission.agent_id
    || fields.agent_id !== assignment.agent_id
    || fields.agent_version_id !== admission.agent_version_id
    || fields.agent_version_id !== assignment.agent_version_id
    || fields.owner_id !== admission.owner_id
    || fields.owner_id !== assignment.owner_id
    || fields.owner_id !== queuedStatus.owner_id
    || fields.materialized_by !== fields.owner_id
    || fields.project_id !== admission.project_id
    || fields.project_id !== assignment.project_id
    || fields.conversation_id !== admission.conversation_id
    || fields.conversation_id !== assignment.conversation_id
    || fields.task_id !== admission.task_id
    || fields.task_id !== assignment.task_id
    || fields.run_id !== admission.run_id
    || fields.run_id !== assignment.run_id
    || admission.materialization_boundary !== 'assignment_record_required_before_execution'
    || queuedStatus.next_status !== 'queued'
    || queuedStatus.decided_by !== fields.owner_id
    || queuedStatus.decided_at_ms < admission.admitted_at_ms
    || fields.materialized_at_ms < queuedStatus.decided_at_ms
    || fields.materialization_contract !== 'admitted_goal_assignment_recorded_as_queued_assignment'
    || fields.execution_boundary !== 'no_run_no_execution_no_source_materialization'
  ) fail();
  return fields;
}

function materializationIdFor(definitionDigest, fields, assignmentEvidenceDigest) {
  return `builder-agent-goal-assignment-materialization:${digestHex({
    agent_goal_assignment_materialization_identity:
      BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_RECORD_VERSION,
    definition_digest: definitionDigest,
    fields,
    assignment_evidence_digest: assignmentEvidenceDigest,
  })}`;
}

function createBuilderAgentGoalAssignmentMaterializationRecord(
  value,
  goalRecord,
  goalStatusRecord,
  admissionRecord,
  assignmentReadResult,
) {
  try {
    const assignmentRead = safeAssignmentReadResult(assignmentReadResult);
    const admission = sanitizeBuilderAgentGoalAssignmentAdmissionRecord(
      admissionRecord,
      goalRecord,
      goalStatusRecord,
      assignmentRead.assignment,
    );
    const fields = safeFields(value, admission, assignmentRead);
    const assignmentEvidenceDigest = sha256Canonical(assignmentRead.evidence);
    return freezeDeep({
      materialization_id: materializationIdFor(admission.definition_digest, fields, assignmentEvidenceDigest),
      definition_digest: admission.definition_digest,
      ...fields,
      lifecycle: LIFECYCLE,
      authority: AUTHORITY,
    });
  } catch (error) {
    if (
      error instanceof BuilderAgentGoalAssignmentMaterializationError
      || error instanceof BuilderAgentGoalAssignmentAdmissionError
      || error instanceof BuilderAgentAssignmentContractError
    ) fail();
    throw error;
  }
}

function sanitizeBuilderAgentGoalAssignmentMaterializationRecord(
  value,
  goalRecord,
  goalStatusRecord,
  admissionRecord,
  assignmentReadResult,
) {
  try {
    exactObject(value, RECORD_KEYS);
    const assignmentRead = safeAssignmentReadResult(assignmentReadResult);
    const admission = sanitizeBuilderAgentGoalAssignmentAdmissionRecord(
      admissionRecord,
      goalRecord,
      goalStatusRecord,
      assignmentRead.assignment,
    );
    const materializationId = safeMaterializationId(valueAt(value, 'materialization_id'));
    const definitionDigest = safeDigest(valueAt(value, 'definition_digest'));
    if (definitionDigest !== admission.definition_digest) fail();
    const fields = safeFields({
      record_version: valueAt(value, 'record_version'),
      record_kind: valueAt(value, 'record_kind'),
      admission_id: valueAt(value, 'admission_id'),
      goal_id: valueAt(value, 'goal_id'),
      goal_status_id: valueAt(value, 'goal_status_id'),
      assignment_id: valueAt(value, 'assignment_id'),
      assignment_status_id: valueAt(value, 'assignment_status_id'),
      agent_id: valueAt(value, 'agent_id'),
      agent_version_id: valueAt(value, 'agent_version_id'),
      owner_id: valueAt(value, 'owner_id'),
      project_id: valueAt(value, 'project_id'),
      conversation_id: valueAt(value, 'conversation_id'),
      task_id: valueAt(value, 'task_id'),
      run_id: valueAt(value, 'run_id'),
      materialized_by: valueAt(value, 'materialized_by'),
      materialized_at_ms: valueAt(value, 'materialized_at_ms'),
      materialization_contract: valueAt(value, 'materialization_contract'),
      execution_boundary: valueAt(value, 'execution_boundary'),
    }, admission, assignmentRead);
    const expectedId = materializationIdFor(
      admission.definition_digest,
      fields,
      sha256Canonical(assignmentRead.evidence),
    );
    if (materializationId !== expectedId) fail();
    return freezeDeep({
      materialization_id: materializationId,
      definition_digest: definitionDigest,
      ...fields,
      lifecycle: safeLifecycle(valueAt(value, 'lifecycle')),
      authority: safeAuthority(valueAt(value, 'authority')),
    });
  } catch (error) {
    if (
      error instanceof BuilderAgentGoalAssignmentMaterializationError
      || error instanceof BuilderAgentGoalAssignmentAdmissionError
      || error instanceof BuilderAgentAssignmentContractError
    ) fail();
    throw error;
  }
}

module.exports = Object.freeze({
  BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_RECORD_KIND,
  BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_RECORD_VERSION,
  BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_VERSION,
  BuilderAgentGoalAssignmentMaterializationError,
  createBuilderAgentGoalAssignmentMaterializationRecord,
  sanitizeBuilderAgentGoalAssignmentMaterializationRecord,
});
