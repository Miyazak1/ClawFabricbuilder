'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  BuilderAgentDelegationResultContractError,
  sanitizeBuilderAgentDelegationResultRecord,
} = require('./builder-agent-delegation-result-contract.cjs');

const BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_CONTRACT_VERSION =
  'builder-agent-delegation-result-admission-contract.v1';
const BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_RECORD_VERSION =
  'builder-agent-delegation-result-admission-record.v1';
const BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_RECORD_KIND =
  'builder_agent_delegation_result_admission_record';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const AGENT_ID_PATTERN = new RegExp(`^builder-agent:${UUID_SOURCE}$`, 'u');
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const SUPERVISOR_ID_PATTERN = new RegExp(`^builder-supervisor:${UUID_SOURCE}$`, 'u');
const AGENT_VERSION_ID_PATTERN = /^builder-agent-version:[0-9a-f]{64}$/u;
const ASSIGNMENT_ID_PATTERN = /^builder-agent-assignment:[0-9a-f]{64}$/u;
const ASSIGNMENT_STATUS_ID_PATTERN = /^builder-agent-assignment-status:[0-9a-f]{64}$/u;
const SUPERVISION_LEASE_ID_PATTERN = /^builder-agent-supervision-lease:[0-9a-f]{64}$/u;
const DELEGATION_ID_PATTERN = /^builder-agent-delegation:[0-9a-f]{64}$/u;
const DELEGATION_RESULT_ID_PATTERN = /^builder-agent-delegation-result:[0-9a-f]{64}$/u;
const DELEGATION_RESULT_ADMISSION_ID_PATTERN =
  /^builder-agent-delegation-result-admission:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const RESULT_RECORD_KEYS = Object.freeze(['status', 'summary_code', 'display_summary']);
const INPUT_KEYS = Object.freeze([
  'record_version',
  'record_kind',
  'delegation_id',
  'delegation_result_id',
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
  'admitted_at_ms',
  'result',
  'admission_status',
  'admission_summary_code',
  'admission_display_summary',
  'admission_contract',
  'parent_review_contract',
  'parent_materialization_boundary',
]);
const RECORD_KEYS = Object.freeze([
  'delegation_result_admission_id',
  'delegation_definition_digest',
  'target_definition_digest',
  'delegation_result_digest',
  ...INPUT_KEYS,
  'lifecycle',
  'authority',
]);
const LIFECYCLE_KEYS = Object.freeze([
  'delegation',
  'child_result_return',
  'local_contribution_admission',
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
  'delegation_result_authority',
  'local_contribution_authority',
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
const ADMISSION_SUMMARY_CODES = Object.freeze({
  proposed: 'delegated_child_result_admitted_for_parent_review',
  blocked: 'delegated_child_blocker_admitted_for_owner_attention',
  failed: 'delegated_child_failure_admitted_for_owner_attention',
});
const ADMISSION_DISPLAY_SUMMARIES = Object.freeze({
  delegated_child_result_admitted_for_parent_review:
    'Delegated result is admitted for parent review.',
  delegated_child_blocker_admitted_for_owner_attention:
    'Delegated blocker is admitted for owner attention.',
  delegated_child_failure_admitted_for_owner_attention:
    'Delegated failure is admitted for owner attention.',
});
const LIFECYCLE = Object.freeze({
  delegation: 'verified_recorded_delegation',
  child_result_return: 'verified_recorded_child_result',
  local_contribution_admission: 'recorded_for_parent_review',
  parent_review: 'owner_review_required',
  parent_materialization: 'not_performed_by_contract',
  child_assignment: 'not_created_by_contract',
  permission_grant: 'not_created',
  source_materialization: 'not_performed_by_contract',
  project_revision: 'not_created',
  publication: 'not_created',
});
const AUTHORITY = Object.freeze({
  record_authority: 'main_agent_delegation_result_admission_contract_v1',
  delegation_authority: 'main_agent_delegation_contract_v1',
  delegation_result_authority: 'main_agent_delegation_result_contract_v1',
  local_contribution_authority: 'local_admission_receipt_only',
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
  builder_agent_delegation_result_admission_contract_invalid:
    'Builder agent delegation result admission could not be verified.',
});

class BuilderAgentDelegationResultAdmissionContractError extends Error {
  constructor() {
    super(ERROR_MESSAGES.builder_agent_delegation_result_admission_contract_invalid);
    this.name = 'BuilderAgentDelegationResultAdmissionContractError';
    this.code = 'builder_agent_delegation_result_admission_contract_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderAgentDelegationResultAdmissionContractError();
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

function safeDelegationResultId(value) {
  return safePattern(value, DELEGATION_RESULT_ID_PATTERN);
}

function safeDelegationResultAdmissionId(value) {
  return safePattern(value, DELEGATION_RESULT_ADMISSION_ID_PATTERN);
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

function safeResultReference(resultRecord, delegationRecord) {
  try {
    return sanitizeBuilderAgentDelegationResultRecord(resultRecord, delegationRecord);
  } catch (error) {
    if (error instanceof BuilderAgentDelegationResultContractError) fail();
    fail();
  }
}

function safeResult(value, resultRecord) {
  exactObject(value, RESULT_RECORD_KEYS);
  const status = valueAt(value, 'status');
  const summaryCode = valueAt(value, 'summary_code');
  const displaySummary = valueAt(value, 'display_summary');
  if (
    status !== resultRecord.result.status
    || summaryCode !== resultRecord.result.summary_code
    || displaySummary !== resultRecord.result.display_summary
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

function safeAdmissionFields(value, resultRecord, delegationRecord) {
  exactObject(value, INPUT_KEYS);
  const result = safeResultReference(resultRecord, delegationRecord);
  const recordVersion = valueAt(value, 'record_version');
  const recordKind = valueAt(value, 'record_kind');
  const delegationId = safeDelegationId(valueAt(value, 'delegation_id'));
  const delegationResultId = safeDelegationResultId(valueAt(value, 'delegation_result_id'));
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
  const admittedAtMs = safeTimestamp(valueAt(value, 'admitted_at_ms'));
  const admissionStatus = valueAt(value, 'admission_status');
  const admissionSummaryCode = valueAt(value, 'admission_summary_code');
  const admissionDisplaySummary = valueAt(value, 'admission_display_summary');
  const expectedAdmissionSummaryCode = ADMISSION_SUMMARY_CODES[result.result.status];
  if (
    recordVersion !== BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_RECORD_VERSION
    || recordKind !== BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_RECORD_KIND
    || delegationId !== result.delegation_id
    || delegationResultId !== result.delegation_result_id
    || parentAssignmentId !== result.parent_assignment_id
    || parentAssignmentStatusId !== result.parent_assignment_status_id
    || parentLeaseId !== result.parent_lease_id
    || fromAgentId !== result.from_agent_id
    || fromAgentVersionId !== result.from_agent_version_id
    || toAgentId !== result.to_agent_id
    || toAgentVersionId !== result.to_agent_version_id
    || ownerId !== result.owner_id
    || projectId !== result.project_id
    || parentConversationId !== result.parent_conversation_id
    || parentTaskId !== result.parent_task_id
    || parentRunId !== result.parent_run_id
    || childConversationId !== result.child_conversation_id
    || childTaskId !== result.child_task_id
    || childRunId !== result.child_run_id
    || leaseHolderId !== result.lease_holder_id
    || admittedAtMs < result.observed_at_ms
    || admissionStatus !== 'admitted_for_parent_review'
    || admissionSummaryCode !== expectedAdmissionSummaryCode
    || admissionDisplaySummary !== ADMISSION_DISPLAY_SUMMARIES[expectedAdmissionSummaryCode]
    || valueAt(value, 'admission_contract') !== 'local_contribution_admitted_for_parent_review'
    || valueAt(value, 'parent_review_contract') !== 'owner_review_required_before_materialization'
    || valueAt(value, 'parent_materialization_boundary') !== 'no_direct_parent_mutation'
  ) fail();
  return freezeDeep({
    record_version: BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_RECORD_VERSION,
    record_kind: BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_RECORD_KIND,
    delegation_id: delegationId,
    delegation_result_id: delegationResultId,
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
    admitted_at_ms: admittedAtMs,
    result: safeResult(valueAt(value, 'result'), result),
    admission_status: 'admitted_for_parent_review',
    admission_summary_code: expectedAdmissionSummaryCode,
    admission_display_summary: ADMISSION_DISPLAY_SUMMARIES[expectedAdmissionSummaryCode],
    admission_contract: 'local_contribution_admitted_for_parent_review',
    parent_review_contract: 'owner_review_required_before_materialization',
    parent_materialization_boundary: 'no_direct_parent_mutation',
  });
}

function delegationResultAdmissionIdFor(delegationResultDigest, fields) {
  return `builder-agent-delegation-result-admission:${sha256Canonical({
    agent_delegation_result_admission_identity:
      BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_RECORD_VERSION,
    delegation_result_digest: delegationResultDigest,
    fields,
  }).slice('sha256:'.length)}`;
}

function createBuilderAgentDelegationResultAdmissionRecord(value, resultRecord, delegationRecord) {
  try {
    const result = safeResultReference(resultRecord, delegationRecord);
    const fields = safeAdmissionFields(value, resultRecord, delegationRecord);
    const delegationResultDigest = sha256Canonical(result);
    return freezeDeep({
      delegation_result_admission_id: delegationResultAdmissionIdFor(delegationResultDigest, fields),
      delegation_definition_digest: result.delegation_definition_digest,
      target_definition_digest: result.target_definition_digest,
      delegation_result_digest: delegationResultDigest,
      ...fields,
      lifecycle: freezeDeep({ ...LIFECYCLE }),
      authority: freezeDeep({ ...AUTHORITY }),
    });
  } catch (error) {
    if (error instanceof BuilderAgentDelegationResultAdmissionContractError) throw error;
    fail();
  }
}

function sanitizeBuilderAgentDelegationResultAdmissionRecord(value, resultRecord, delegationRecord) {
  try {
    const result = safeResultReference(resultRecord, delegationRecord);
    exactObject(value, RECORD_KEYS);
    const admissionId = safeDelegationResultAdmissionId(valueAt(value, 'delegation_result_admission_id'));
    const delegationDefinitionDigest = safeDigest(valueAt(value, 'delegation_definition_digest'));
    const targetDefinitionDigest = safeDigest(valueAt(value, 'target_definition_digest'));
    const delegationResultDigest = safeDigest(valueAt(value, 'delegation_result_digest'));
    const expectedDelegationResultDigest = sha256Canonical(result);
    if (
      delegationDefinitionDigest !== result.delegation_definition_digest
      || targetDefinitionDigest !== result.target_definition_digest
      || delegationResultDigest !== expectedDelegationResultDigest
    ) fail();
    const fields = safeAdmissionFields({
      record_version: valueAt(value, 'record_version'),
      record_kind: valueAt(value, 'record_kind'),
      delegation_id: valueAt(value, 'delegation_id'),
      delegation_result_id: valueAt(value, 'delegation_result_id'),
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
      admitted_at_ms: valueAt(value, 'admitted_at_ms'),
      result: valueAt(value, 'result'),
      admission_status: valueAt(value, 'admission_status'),
      admission_summary_code: valueAt(value, 'admission_summary_code'),
      admission_display_summary: valueAt(value, 'admission_display_summary'),
      admission_contract: valueAt(value, 'admission_contract'),
      parent_review_contract: valueAt(value, 'parent_review_contract'),
      parent_materialization_boundary: valueAt(value, 'parent_materialization_boundary'),
    }, resultRecord, delegationRecord);
    if (admissionId !== delegationResultAdmissionIdFor(delegationResultDigest, fields)) fail();
    return freezeDeep({
      delegation_result_admission_id: admissionId,
      delegation_definition_digest: delegationDefinitionDigest,
      target_definition_digest: targetDefinitionDigest,
      delegation_result_digest: delegationResultDigest,
      ...fields,
      lifecycle: safeLifecycle(valueAt(value, 'lifecycle')),
      authority: safeAuthority(valueAt(value, 'authority')),
    });
  } catch (error) {
    if (error instanceof BuilderAgentDelegationResultAdmissionContractError) throw error;
    fail();
  }
}

module.exports = Object.freeze({
  BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_CONTRACT_VERSION,
  BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_RECORD_KIND,
  BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_RECORD_VERSION,
  BuilderAgentDelegationResultAdmissionContractError,
  createBuilderAgentDelegationResultAdmissionRecord,
  sanitizeBuilderAgentDelegationResultAdmissionRecord,
});
