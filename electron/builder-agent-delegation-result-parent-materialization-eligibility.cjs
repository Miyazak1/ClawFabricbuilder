'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  BuilderAgentDelegationResultReviewContractError,
  sanitizeBuilderAgentDelegationResultReviewRecord,
} = require('./builder-agent-delegation-result-review-contract.cjs');

const BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_CONTRACT_VERSION =
  'builder-agent-delegation-result-parent-materialization-eligibility-contract.v1';
const BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_RECORD_VERSION =
  'builder-agent-delegation-result-parent-materialization-eligibility-record.v1';
const BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_RECORD_KIND =
  'builder_agent_delegation_result_parent_materialization_eligibility_record';
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
const DELEGATION_RESULT_REVIEW_ID_PATTERN =
  /^builder-agent-delegation-result-review:[0-9a-f]{64}$/u;
const ELIGIBILITY_ID_PATTERN =
  /^builder-agent-delegation-result-parent-materialization-eligibility:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const RESULT_RECORD_KEYS = Object.freeze(['status', 'summary_code', 'display_summary']);
const INPUT_KEYS = Object.freeze([
  'record_version',
  'record_kind',
  'delegation_result_review_id',
  'delegation_result_admission_id',
  'delegation_result_id',
  'delegation_id',
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
  'eligibility_recorded_by',
  'eligibility_recorded_at_ms',
  'result',
  'decision',
  'eligibility_status',
  'eligibility_summary_code',
  'eligibility_display_summary',
  'eligibility_contract',
  'parent_materialization_boundary',
]);
const RECORD_KEYS = Object.freeze([
  'delegation_result_parent_materialization_eligibility_id',
  'delegation_result_review_digest',
  'delegation_result_admission_digest',
  'delegation_result_digest',
  'delegation_definition_digest',
  'target_definition_digest',
  ...INPUT_KEYS,
  'lifecycle',
  'authority',
]);
const LIFECYCLE_KEYS = Object.freeze([
  'delegation',
  'child_result_return',
  'local_contribution_admission',
  'owner_review',
  'parent_materialization_eligibility',
  'parent_materialization',
  'child_assignment',
  'permission_grant',
  'source_materialization',
  'project_revision',
  'artifact',
  'publication',
]);
const AUTHORITY_KEYS = Object.freeze([
  'record_authority',
  'delegation_authority',
  'delegation_result_authority',
  'delegation_result_admission_authority',
  'delegation_result_review_authority',
  'parent_materialization_eligibility_authority',
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
const LIFECYCLE = Object.freeze({
  delegation: 'verified_recorded_delegation',
  child_result_return: 'verified_recorded_child_result',
  local_contribution_admission: 'verified_admitted_for_parent_review',
  owner_review: 'verified_owner_approved_for_parent_materialization',
  parent_materialization_eligibility: 'recorded_for_later_gate',
  parent_materialization: 'not_performed_by_contract',
  child_assignment: 'not_created_by_contract',
  permission_grant: 'not_created',
  source_materialization: 'not_performed_by_contract',
  project_revision: 'not_created',
  artifact: 'not_created',
  publication: 'not_created',
});
const AUTHORITY = Object.freeze({
  record_authority: 'main_agent_delegation_result_parent_materialization_eligibility_contract_v1',
  delegation_authority: 'main_agent_delegation_contract_v1',
  delegation_result_authority: 'main_agent_delegation_result_contract_v1',
  delegation_result_admission_authority: 'main_agent_delegation_result_admission_contract_v1',
  delegation_result_review_authority: 'main_agent_delegation_result_review_contract_v1',
  parent_materialization_eligibility_authority: 'local_receipt_only',
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
  review_authority: 'local_decision_receipt_only',
  artifact_authority: 'not_created_by_contract',
});
const ERROR_MESSAGES = Object.freeze({
  builder_agent_delegation_result_parent_materialization_eligibility_invalid:
    'Builder agent delegation result parent materialization eligibility could not be verified.',
});

class BuilderAgentDelegationResultParentMaterializationEligibilityError extends Error {
  constructor() {
    super(ERROR_MESSAGES.builder_agent_delegation_result_parent_materialization_eligibility_invalid);
    this.name = 'BuilderAgentDelegationResultParentMaterializationEligibilityError';
    this.code = 'builder_agent_delegation_result_parent_materialization_eligibility_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderAgentDelegationResultParentMaterializationEligibilityError();
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

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeDigest(value) {
  return safePattern(value, DIGEST_PATTERN);
}

function safeEligibilityId(value) {
  return safePattern(value, ELIGIBILITY_ID_PATTERN);
}

function safeDelegationResultReviewId(value) {
  return safePattern(value, DELEGATION_RESULT_REVIEW_ID_PATTERN);
}

function safeDelegationResultAdmissionId(value) {
  return safePattern(value, DELEGATION_RESULT_ADMISSION_ID_PATTERN);
}

function safeDelegationResultId(value) {
  return safePattern(value, DELEGATION_RESULT_ID_PATTERN);
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

function safeReviewReference(reviewRecord, admissionRecord, resultRecord, delegationRecord) {
  try {
    return sanitizeBuilderAgentDelegationResultReviewRecord(
      reviewRecord,
      admissionRecord,
      resultRecord,
      delegationRecord,
    );
  } catch (error) {
    if (error instanceof BuilderAgentDelegationResultReviewContractError) fail();
    fail();
  }
}

function safeResult(value, reviewRecord) {
  exactObject(value, RESULT_RECORD_KEYS);
  const status = valueAt(value, 'status');
  const summaryCode = valueAt(value, 'summary_code');
  const displaySummary = valueAt(value, 'display_summary');
  if (
    status !== reviewRecord.result.status
    || summaryCode !== reviewRecord.result.summary_code
    || displaySummary !== reviewRecord.result.display_summary
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

function safeEligibilityFields(value, reviewRecord, admissionRecord, resultRecord, delegationRecord) {
  exactObject(value, INPUT_KEYS);
  const review = safeReviewReference(reviewRecord, admissionRecord, resultRecord, delegationRecord);
  if (
    review.decision !== 'approved_for_parent_materialization'
    || review.result.status !== 'proposed'
  ) fail();
  const recordVersion = valueAt(value, 'record_version');
  const recordKind = valueAt(value, 'record_kind');
  const reviewId = safeDelegationResultReviewId(valueAt(value, 'delegation_result_review_id'));
  const delegationResultAdmissionId = safeDelegationResultAdmissionId(valueAt(value, 'delegation_result_admission_id'));
  const delegationResultId = safeDelegationResultId(valueAt(value, 'delegation_result_id'));
  const delegationId = safeDelegationId(valueAt(value, 'delegation_id'));
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
  const eligibilityRecordedBy = safeOwnerId(valueAt(value, 'eligibility_recorded_by'));
  const eligibilityRecordedAtMs = safeTimestamp(valueAt(value, 'eligibility_recorded_at_ms'));
  const result = safeResult(valueAt(value, 'result'), review);
  const decision = valueAt(value, 'decision');
  const eligibilityStatus = valueAt(value, 'eligibility_status');
  const eligibilitySummaryCode = valueAt(value, 'eligibility_summary_code');
  const eligibilityDisplaySummary = valueAt(value, 'eligibility_display_summary');
  if (
    recordVersion !== BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_RECORD_VERSION
    || recordKind !== BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_RECORD_KIND
    || reviewId !== review.delegation_result_review_id
    || delegationResultAdmissionId !== review.delegation_result_admission_id
    || delegationResultId !== review.delegation_result_id
    || delegationId !== review.delegation_id
    || parentAssignmentId !== review.parent_assignment_id
    || parentAssignmentStatusId !== review.parent_assignment_status_id
    || parentLeaseId !== review.parent_lease_id
    || fromAgentId !== review.from_agent_id
    || fromAgentVersionId !== review.from_agent_version_id
    || toAgentId !== review.to_agent_id
    || toAgentVersionId !== review.to_agent_version_id
    || ownerId !== review.owner_id
    || projectId !== review.project_id
    || parentConversationId !== review.parent_conversation_id
    || parentTaskId !== review.parent_task_id
    || parentRunId !== review.parent_run_id
    || childConversationId !== review.child_conversation_id
    || childTaskId !== review.child_task_id
    || childRunId !== review.child_run_id
    || leaseHolderId !== review.lease_holder_id
    || eligibilityRecordedBy !== ownerId
    || eligibilityRecordedAtMs < review.reviewed_at_ms
    || decision !== 'approved_for_parent_materialization'
    || eligibilityStatus !== 'eligible_for_parent_materialization_gate'
    || eligibilitySummaryCode !== 'delegated_child_result_eligible_for_parent_materialization_gate'
    || eligibilityDisplaySummary !== 'Delegated result is eligible for the later parent materialization gate.'
    || valueAt(value, 'eligibility_contract')
      !== 'owner_reviewed_delegated_result_recorded_for_later_parent_materialization'
    || valueAt(value, 'parent_materialization_boundary') !== 'no_direct_parent_mutation'
  ) fail();
  return freezeDeep({
    record_version: BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_RECORD_VERSION,
    record_kind: BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_RECORD_KIND,
    delegation_result_review_id: reviewId,
    delegation_result_admission_id: delegationResultAdmissionId,
    delegation_result_id: delegationResultId,
    delegation_id: delegationId,
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
    eligibility_recorded_by: eligibilityRecordedBy,
    eligibility_recorded_at_ms: eligibilityRecordedAtMs,
    result,
    decision: 'approved_for_parent_materialization',
    eligibility_status: 'eligible_for_parent_materialization_gate',
    eligibility_summary_code: 'delegated_child_result_eligible_for_parent_materialization_gate',
    eligibility_display_summary: 'Delegated result is eligible for the later parent materialization gate.',
    eligibility_contract: 'owner_reviewed_delegated_result_recorded_for_later_parent_materialization',
    parent_materialization_boundary: 'no_direct_parent_mutation',
  });
}

function eligibilityIdFor(reviewDigest, fields) {
  return `builder-agent-delegation-result-parent-materialization-eligibility:${sha256Canonical({
    agent_delegation_result_parent_materialization_eligibility_identity:
      BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_RECORD_VERSION,
    delegation_result_review_digest: reviewDigest,
    fields,
  }).slice('sha256:'.length)}`;
}

function createBuilderAgentDelegationResultParentMaterializationEligibilityRecord(
  value,
  reviewRecord,
  admissionRecord,
  resultRecord,
  delegationRecord,
) {
  try {
    const review = safeReviewReference(reviewRecord, admissionRecord, resultRecord, delegationRecord);
    const fields = safeEligibilityFields(value, reviewRecord, admissionRecord, resultRecord, delegationRecord);
    const reviewDigest = sha256Canonical(review);
    return freezeDeep({
      delegation_result_parent_materialization_eligibility_id: eligibilityIdFor(reviewDigest, fields),
      delegation_result_review_digest: reviewDigest,
      delegation_result_admission_digest: review.delegation_result_admission_digest,
      delegation_result_digest: review.delegation_result_digest,
      delegation_definition_digest: review.delegation_definition_digest,
      target_definition_digest: review.target_definition_digest,
      ...fields,
      lifecycle: freezeDeep({ ...LIFECYCLE }),
      authority: freezeDeep({ ...AUTHORITY }),
    });
  } catch (error) {
    if (
      error instanceof BuilderAgentDelegationResultParentMaterializationEligibilityError
      || error instanceof BuilderAgentDelegationResultReviewContractError
    ) fail();
    throw error;
  }
}

function sanitizeBuilderAgentDelegationResultParentMaterializationEligibilityRecord(
  value,
  reviewRecord,
  admissionRecord,
  resultRecord,
  delegationRecord,
) {
  try {
    const review = safeReviewReference(reviewRecord, admissionRecord, resultRecord, delegationRecord);
    exactObject(value, RECORD_KEYS);
    const eligibilityId = safeEligibilityId(valueAt(value, 'delegation_result_parent_materialization_eligibility_id'));
    const reviewDigest = safeDigest(valueAt(value, 'delegation_result_review_digest'));
    const admissionDigest = safeDigest(valueAt(value, 'delegation_result_admission_digest'));
    const delegationResultDigest = safeDigest(valueAt(value, 'delegation_result_digest'));
    const delegationDefinitionDigest = safeDigest(valueAt(value, 'delegation_definition_digest'));
    const targetDefinitionDigest = safeDigest(valueAt(value, 'target_definition_digest'));
    if (
      reviewDigest !== sha256Canonical(review)
      || admissionDigest !== review.delegation_result_admission_digest
      || delegationResultDigest !== review.delegation_result_digest
      || delegationDefinitionDigest !== review.delegation_definition_digest
      || targetDefinitionDigest !== review.target_definition_digest
    ) fail();
    const fields = safeEligibilityFields({
      record_version: valueAt(value, 'record_version'),
      record_kind: valueAt(value, 'record_kind'),
      delegation_result_review_id: valueAt(value, 'delegation_result_review_id'),
      delegation_result_admission_id: valueAt(value, 'delegation_result_admission_id'),
      delegation_result_id: valueAt(value, 'delegation_result_id'),
      delegation_id: valueAt(value, 'delegation_id'),
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
      eligibility_recorded_by: valueAt(value, 'eligibility_recorded_by'),
      eligibility_recorded_at_ms: valueAt(value, 'eligibility_recorded_at_ms'),
      result: valueAt(value, 'result'),
      decision: valueAt(value, 'decision'),
      eligibility_status: valueAt(value, 'eligibility_status'),
      eligibility_summary_code: valueAt(value, 'eligibility_summary_code'),
      eligibility_display_summary: valueAt(value, 'eligibility_display_summary'),
      eligibility_contract: valueAt(value, 'eligibility_contract'),
      parent_materialization_boundary: valueAt(value, 'parent_materialization_boundary'),
    }, reviewRecord, admissionRecord, resultRecord, delegationRecord);
    if (eligibilityId !== eligibilityIdFor(reviewDigest, fields)) fail();
    return freezeDeep({
      delegation_result_parent_materialization_eligibility_id: eligibilityId,
      delegation_result_review_digest: reviewDigest,
      delegation_result_admission_digest: admissionDigest,
      delegation_result_digest: delegationResultDigest,
      delegation_definition_digest: delegationDefinitionDigest,
      target_definition_digest: targetDefinitionDigest,
      ...fields,
      lifecycle: safeLifecycle(valueAt(value, 'lifecycle')),
      authority: safeAuthority(valueAt(value, 'authority')),
    });
  } catch (error) {
    if (
      error instanceof BuilderAgentDelegationResultParentMaterializationEligibilityError
      || error instanceof BuilderAgentDelegationResultReviewContractError
    ) fail();
    throw error;
  }
}

module.exports = Object.freeze({
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_CONTRACT_VERSION,
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_RECORD_KIND,
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_RECORD_VERSION,
  BuilderAgentDelegationResultParentMaterializationEligibilityError,
  createBuilderAgentDelegationResultParentMaterializationEligibilityRecord,
  sanitizeBuilderAgentDelegationResultParentMaterializationEligibilityRecord,
});
