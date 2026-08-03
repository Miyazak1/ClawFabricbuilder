'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  BuilderAgentProjectWorkContractError,
  sanitizeBuilderAgentProjectWorkResultRecord,
} = require('./builder-agent-project-work-contract.cjs');

const BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_CONTRACT_VERSION =
  'builder-agent-project-work-result-review-contract.v1';
const BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_RECORD_VERSION =
  'builder-agent-project-work-result-review-record.v1';
const BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_RECORD_KIND =
  'builder_agent_project_work_result_review_record';
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
const WORK_RESULT_ID_PATTERN = /^builder-agent-project-work-result:[0-9a-f]{64}$/u;
const WORK_RESULT_REVIEW_ID_PATTERN = /^builder-agent-project-work-result-review:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const RESULT_RECORD_KEYS = Object.freeze(['status', 'summary_code', 'display_summary']);
const INPUT_KEYS = Object.freeze([
  'record_version',
  'record_kind',
  'work_result_id',
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
  'reviewed_by',
  'reviewed_at_ms',
  'result',
  'decision',
  'decision_summary_code',
  'decision_display_summary',
  'review_contract',
  'materialization_boundary',
]);
const RECORD_KEYS = Object.freeze([
  'work_result_review_id',
  'work_result_digest',
  'definition_digest',
  ...INPUT_KEYS,
  'lifecycle',
  'authority',
]);
const LIFECYCLE_KEYS = Object.freeze([
  'assignment',
  'supervision_lease',
  'project_work_result',
  'owner_review',
  'source_materialization',
  'check_run',
  'project_revision',
  'artifact',
  'publication',
]);
const AUTHORITY_KEYS = Object.freeze([
  'record_authority',
  'project_work_result_authority',
  'assignment_authority',
  'lease_authority',
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
const DECISION_SUMMARY_CODES = Object.freeze({
  approved_for_project_materialization:
    'agent_project_work_result_approved_for_project_materialization',
  rejected:
    'agent_project_work_result_rejected_by_owner',
  acknowledged_without_materialization:
    'agent_project_work_result_acknowledged_without_materialization',
});
const DECISION_DISPLAY_SUMMARIES = Object.freeze({
  agent_project_work_result_approved_for_project_materialization:
    'Agent project work is approved for the materialization gate.',
  agent_project_work_result_rejected_by_owner:
    'Agent project work was rejected by the owner.',
  agent_project_work_result_acknowledged_without_materialization:
    'Agent project work was acknowledged without materialization.',
});
const LIFECYCLE = Object.freeze({
  assignment: 'verified_active_assignment',
  supervision_lease: 'verified_active_lease_window',
  project_work_result: 'verified_recorded_for_owner_review',
  owner_review: 'recorded',
  source_materialization: 'not_performed_by_contract',
  check_run: 'not_performed_by_contract',
  project_revision: 'not_created',
  artifact: 'not_created',
  publication: 'not_created',
});
const AUTHORITY = Object.freeze({
  record_authority: 'main_agent_project_work_result_review_contract_v1',
  project_work_result_authority: 'main_agent_project_work_contract_v1',
  assignment_authority: 'main_agent_assignment_contract_v1',
  lease_authority: 'main_agent_supervision_lease_contract_v1',
  owner_review_authority: 'main_owner_review_decision_receipt',
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
  builder_agent_project_work_result_review_contract_invalid:
    'Builder agent project work result review could not be verified.',
});

class BuilderAgentProjectWorkResultReviewContractError extends Error {
  constructor() {
    super(ERROR_MESSAGES.builder_agent_project_work_result_review_contract_invalid);
    this.name = 'BuilderAgentProjectWorkResultReviewContractError';
    this.code = 'builder_agent_project_work_result_review_contract_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderAgentProjectWorkResultReviewContractError();
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

function safeWorkResultReviewId(value) {
  return safePattern(value, WORK_RESULT_REVIEW_ID_PATTERN);
}

function safeWorkResultId(value) {
  return safePattern(value, WORK_RESULT_ID_PATTERN);
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

function safeWorkKind(value) {
  if (value !== 'project_edit' && value !== 'project_test') fail();
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

function safeWorkResultReference(resultRecord, assignmentRecord, statusRecord, leaseRecord) {
  try {
    return sanitizeBuilderAgentProjectWorkResultRecord(
      resultRecord,
      assignmentRecord,
      statusRecord,
      leaseRecord,
    );
  } catch (error) {
    if (error instanceof BuilderAgentProjectWorkContractError) fail();
    fail();
  }
}

function safeResult(value, workResult) {
  exactObject(value, RESULT_RECORD_KEYS);
  const status = valueAt(value, 'status');
  const summaryCode = valueAt(value, 'summary_code');
  const displaySummary = valueAt(value, 'display_summary');
  if (
    status !== workResult.result.status
    || summaryCode !== workResult.result.summary_code
    || displaySummary !== workResult.result.display_summary
  ) fail();
  return freezeDeep({
    status,
    summary_code: summaryCode,
    display_summary: displaySummary,
  });
}

function safeDecision(decision, resultStatus) {
  if (
    decision !== 'approved_for_project_materialization'
    && decision !== 'rejected'
    && decision !== 'acknowledged_without_materialization'
  ) fail();
  if (resultStatus === 'proposed') {
    if (
      decision !== 'approved_for_project_materialization'
      && decision !== 'rejected'
    ) fail();
  } else if (decision !== 'acknowledged_without_materialization') fail();
  return decision;
}

function safeLifecycle(value) {
  return exactConstantObject(value, LIFECYCLE, LIFECYCLE_KEYS);
}

function safeAuthority(value) {
  return exactConstantObject(value, AUTHORITY, AUTHORITY_KEYS);
}

function safeReviewFields(value, resultRecord, assignmentRecord, statusRecord, leaseRecord) {
  exactObject(value, INPUT_KEYS);
  const workResult = safeWorkResultReference(resultRecord, assignmentRecord, statusRecord, leaseRecord);
  const recordVersion = valueAt(value, 'record_version');
  const recordKind = valueAt(value, 'record_kind');
  const workResultId = safeWorkResultId(valueAt(value, 'work_result_id'));
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
  const reviewedBy = safeOwnerId(valueAt(value, 'reviewed_by'));
  const reviewedAtMs = safeTimestamp(valueAt(value, 'reviewed_at_ms'));
  const result = safeResult(valueAt(value, 'result'), workResult);
  const decision = safeDecision(valueAt(value, 'decision'), result.status);
  const decisionSummaryCode = valueAt(value, 'decision_summary_code');
  const decisionDisplaySummary = valueAt(value, 'decision_display_summary');
  const expectedDecisionSummaryCode = DECISION_SUMMARY_CODES[decision];
  if (
    recordVersion !== BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_RECORD_VERSION
    || recordKind !== BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_RECORD_KIND
    || workResultId !== workResult.work_result_id
    || assignmentId !== workResult.assignment_id
    || assignmentStatusId !== workResult.assignment_status_id
    || leaseId !== workResult.lease_id
    || agentId !== workResult.agent_id
    || agentVersionId !== workResult.agent_version_id
    || ownerId !== workResult.owner_id
    || projectId !== workResult.project_id
    || conversationId !== workResult.conversation_id
    || taskId !== workResult.task_id
    || runId !== workResult.run_id
    || leaseHolderId !== workResult.lease_holder_id
    || workKind !== workResult.work_kind
    || reviewedBy !== ownerId
    || reviewedAtMs < workResult.observed_at_ms
    || decisionSummaryCode !== expectedDecisionSummaryCode
    || decisionDisplaySummary !== DECISION_DISPLAY_SUMMARIES[expectedDecisionSummaryCode]
    || valueAt(value, 'review_contract') !== 'owner_review_recorded_before_project_materialization'
    || valueAt(value, 'materialization_boundary') !== 'no_source_mutation_no_project_revision'
  ) fail();
  return freezeDeep({
    record_version: BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_RECORD_VERSION,
    record_kind: BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_RECORD_KIND,
    work_result_id: workResultId,
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
    reviewed_by: reviewedBy,
    reviewed_at_ms: reviewedAtMs,
    result,
    decision,
    decision_summary_code: expectedDecisionSummaryCode,
    decision_display_summary: DECISION_DISPLAY_SUMMARIES[expectedDecisionSummaryCode],
    review_contract: 'owner_review_recorded_before_project_materialization',
    materialization_boundary: 'no_source_mutation_no_project_revision',
  });
}

function workResultReviewIdFor(workResultDigest, fields) {
  return `builder-agent-project-work-result-review:${sha256Canonical({
    agent_project_work_result_review_identity:
      BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_RECORD_VERSION,
    work_result_digest: workResultDigest,
    fields,
  }).slice('sha256:'.length)}`;
}

function createBuilderAgentProjectWorkResultReviewRecord(
  value,
  resultRecord,
  assignmentRecord,
  statusRecord,
  leaseRecord,
) {
  try {
    const workResult = safeWorkResultReference(resultRecord, assignmentRecord, statusRecord, leaseRecord);
    const fields = safeReviewFields(value, resultRecord, assignmentRecord, statusRecord, leaseRecord);
    const workResultDigest = sha256Canonical(workResult);
    return freezeDeep({
      work_result_review_id: workResultReviewIdFor(workResultDigest, fields),
      work_result_digest: workResultDigest,
      definition_digest: workResult.definition_digest,
      ...fields,
      lifecycle: freezeDeep({ ...LIFECYCLE }),
      authority: freezeDeep({ ...AUTHORITY }),
    });
  } catch (error) {
    if (error instanceof BuilderAgentProjectWorkResultReviewContractError) throw error;
    fail();
  }
}

function sanitizeBuilderAgentProjectWorkResultReviewRecord(
  value,
  resultRecord,
  assignmentRecord,
  statusRecord,
  leaseRecord,
) {
  try {
    const workResult = safeWorkResultReference(resultRecord, assignmentRecord, statusRecord, leaseRecord);
    exactObject(value, RECORD_KEYS);
    const reviewId = safeWorkResultReviewId(valueAt(value, 'work_result_review_id'));
    const workResultDigest = safeDigest(valueAt(value, 'work_result_digest'));
    const definitionDigest = safeDigest(valueAt(value, 'definition_digest'));
    if (
      workResultDigest !== sha256Canonical(workResult)
      || definitionDigest !== workResult.definition_digest
    ) fail();
    const fields = safeReviewFields({
      record_version: valueAt(value, 'record_version'),
      record_kind: valueAt(value, 'record_kind'),
      work_result_id: valueAt(value, 'work_result_id'),
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
      work_kind: valueAt(value, 'work_kind'),
      reviewed_by: valueAt(value, 'reviewed_by'),
      reviewed_at_ms: valueAt(value, 'reviewed_at_ms'),
      result: valueAt(value, 'result'),
      decision: valueAt(value, 'decision'),
      decision_summary_code: valueAt(value, 'decision_summary_code'),
      decision_display_summary: valueAt(value, 'decision_display_summary'),
      review_contract: valueAt(value, 'review_contract'),
      materialization_boundary: valueAt(value, 'materialization_boundary'),
    }, resultRecord, assignmentRecord, statusRecord, leaseRecord);
    if (reviewId !== workResultReviewIdFor(workResultDigest, fields)) fail();
    return freezeDeep({
      work_result_review_id: reviewId,
      work_result_digest: workResultDigest,
      definition_digest: definitionDigest,
      ...fields,
      lifecycle: safeLifecycle(valueAt(value, 'lifecycle')),
      authority: safeAuthority(valueAt(value, 'authority')),
    });
  } catch (error) {
    if (error instanceof BuilderAgentProjectWorkResultReviewContractError) throw error;
    fail();
  }
}

module.exports = Object.freeze({
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_CONTRACT_VERSION,
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_RECORD_KIND,
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_RECORD_VERSION,
  BuilderAgentProjectWorkResultReviewContractError,
  createBuilderAgentProjectWorkResultReviewRecord,
  sanitizeBuilderAgentProjectWorkResultReviewRecord,
});
