'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const APPROVED_PLAN_READ_RESULT_VERSION = 'builder-conversation-approved-plan-read-result.v1';
const BUILDER_APPROVED_PLAN_CONTINUATION_ADMISSION_VERSION = 'builder-approved-plan-continuation-admission.v1';
const APPROVED_PLAN_CONTINUATION_ADMISSION_KIND = 'builder_approved_plan_continuation_admission';
const INPUT_KEYS = Object.freeze([
  'approved_plan',
  'continuation_id',
  'admitted_at_ms',
]);
const APPROVED_PLAN_KEYS = Object.freeze([
  'result_version',
  'project_id',
  'conversation_id',
  'turn_id',
  'task_id',
  'run_id',
  'decision',
  'plan_result_digest',
  'conversation_head',
  'authority',
]);
const CONVERSATION_HEAD_KEYS = Object.freeze(['sequence', 'event_id', 'event_digest']);
const APPROVED_PLAN_AUTHORITY_KEYS = Object.freeze([
  'conversation',
  'plan_review',
  'renderer_authority',
  'provider_dispatch',
  'tool_dispatch',
  'source_mutation',
  'git_authority',
  'revision_admission',
]);
const ADMISSION_KEYS = Object.freeze([
  'admission_version',
  'admission_kind',
  'approved_plan_result_version',
  'project_id',
  'conversation_id',
  'turn_id',
  'task_id',
  'run_id',
  'decision',
  'plan_result_digest',
  'conversation_head',
  'conversation_head_digest',
  'continuation_id',
  'admitted_at_ms',
  'lifecycle',
  'authority',
  'admission_digest',
]);
const LIFECYCLE_KEYS = Object.freeze([
  'approval_gate',
  'continuation_admission',
  'provider_dispatch',
  'tool_dispatch',
  'source_mutation',
  'git_authority',
  'revision_admission',
]);
const AUTHORITY_KEYS = Object.freeze([
  'admission_authority',
  'approved_plan_read_authority',
  'conversation_binding',
  'plan_review',
  'renderer_authority',
  'provider_dispatch',
  'credential_readback',
  'tool_dispatch',
  'source_mutation',
  'git_authority',
  'revision_authority',
  'cost_authority',
]);
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:(${UUID_SOURCE})$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:(${UUID_SOURCE})$`, 'u');
const TURN_ID_PATTERN = new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const CONTINUATION_ID_PATTERN = new RegExp(`^builder-approved-plan-continuation:${UUID_SOURCE}$`, 'u');
const EVENT_ID_PATTERN = /^builder-conversation-event:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const LIFECYCLE = Object.freeze({
  approval_gate: 'verified_current_head_approved_plan',
  continuation_admission: 'admitted_without_starting_run',
  provider_dispatch: 'not_started',
  tool_dispatch: 'not_started',
  source_mutation: 'not_performed',
  git_authority: 'not_present',
  revision_admission: 'not_created',
});
const AUTHORITY = Object.freeze({
  admission_authority: 'main_approved_plan_continuation_admission_contract_v1',
  approved_plan_read_authority: 'sqlite_replay_current_head_verified',
  conversation_binding: 'approved_plan_read_current_head_required',
  plan_review: 'approved_current_head',
  renderer_authority: 'not_present',
  provider_dispatch: false,
  credential_readback: false,
  tool_dispatch: 'not_performed',
  source_mutation: 'not_performed',
  git_authority: 'not_present',
  revision_authority: 'not_present',
  cost_authority: 'no_chargeable_dispatch_without_agent_runtime_v1',
});

class BuilderApprovedPlanContinuationAdmissionError extends Error {
  constructor() {
    super('The approved plan continuation could not be verified.');
    this.name = 'BuilderApprovedPlanContinuationAdmissionError';
    this.code = 'builder_approved_plan_continuation_admission_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderApprovedPlanContinuationAdmissionError();
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
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail();
    }
  }
  return descriptors;
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
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
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

function safeProjectId(value) {
  return safePattern(value, PROJECT_ID_PATTERN);
}

function safeConversationId(value, projectId) {
  const conversationId = safePattern(value, CONVERSATION_ID_PATTERN);
  if (conversationId.slice('builder-conversation:'.length)
    !== projectId.slice('builder-project:'.length)) fail();
  return conversationId;
}

function safeTurnId(value) {
  return safePattern(value, TURN_ID_PATTERN);
}

function safeTaskId(value) {
  return safePattern(value, TASK_ID_PATTERN);
}

function safeRunId(value) {
  return safePattern(value, RUN_ID_PATTERN);
}

function safeContinuationId(value) {
  return safePattern(value, CONTINUATION_ID_PATTERN);
}

function safeDigest(value) {
  return safePattern(value, DIGEST_PATTERN);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeSequence(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_024) fail();
  return value;
}

function sanitizeConversationHead(value) {
  const descriptors = exactObject(value, CONVERSATION_HEAD_KEYS);
  return freezeDeep({
    sequence: safeSequence(descriptors.sequence.value),
    event_id: safePattern(descriptors.event_id.value, EVENT_ID_PATTERN),
    event_digest: safeDigest(descriptors.event_digest.value),
  });
}

function conversationHeadDigest(value) {
  return sha256Canonical({
    event_digest: value.event_digest,
    event_id: value.event_id,
    sequence: value.sequence,
  });
}

function sanitizeApprovedPlanAuthority(value) {
  const descriptors = exactObject(value, APPROVED_PLAN_AUTHORITY_KEYS);
  if (
    descriptors.conversation.value !== 'sqlite_replay_current_head_verified'
    || descriptors.plan_review.value !== 'approved_current_head'
    || descriptors.renderer_authority.value !== 'not_present'
    || descriptors.provider_dispatch.value !== false
    || descriptors.tool_dispatch.value !== 'not_performed'
    || descriptors.source_mutation.value !== 'not_performed'
    || descriptors.git_authority.value !== 'not_present'
    || descriptors.revision_admission.value !== 'not_created'
  ) fail();
  return freezeDeep({
    conversation: 'sqlite_replay_current_head_verified',
    plan_review: 'approved_current_head',
    renderer_authority: 'not_present',
    provider_dispatch: false,
    tool_dispatch: 'not_performed',
    source_mutation: 'not_performed',
    git_authority: 'not_present',
    revision_admission: 'not_created',
  });
}

function sanitizeApprovedPlan(value) {
  const descriptors = exactObject(value, APPROVED_PLAN_KEYS);
  if (descriptors.result_version.value !== APPROVED_PLAN_READ_RESULT_VERSION) fail();
  const projectId = safeProjectId(descriptors.project_id.value);
  const conversationId = safeConversationId(descriptors.conversation_id.value, projectId);
  if (descriptors.decision.value !== 'approved') fail();
  return freezeDeep({
    result_version: APPROVED_PLAN_READ_RESULT_VERSION,
    project_id: projectId,
    conversation_id: conversationId,
    turn_id: safeTurnId(descriptors.turn_id.value),
    task_id: safeTaskId(descriptors.task_id.value),
    run_id: safeRunId(descriptors.run_id.value),
    decision: 'approved',
    plan_result_digest: safeDigest(descriptors.plan_result_digest.value),
    conversation_head: sanitizeConversationHead(descriptors.conversation_head.value),
    authority: sanitizeApprovedPlanAuthority(descriptors.authority.value),
  });
}

function sanitizeLifecycle(value) {
  const descriptors = exactObject(value, LIFECYCLE_KEYS);
  for (const key of LIFECYCLE_KEYS) {
    if (descriptors[key].value !== LIFECYCLE[key]) fail();
  }
  return freezeDeep({ ...LIFECYCLE });
}

function sanitizeAuthority(value) {
  const descriptors = exactObject(value, AUTHORITY_KEYS);
  for (const key of AUTHORITY_KEYS) {
    if (descriptors[key].value !== AUTHORITY[key]) fail();
  }
  return freezeDeep({ ...AUTHORITY });
}

function admissionDigestBody(value) {
  return {
    admitted_at_ms: value.admitted_at_ms,
    admission_kind: value.admission_kind,
    admission_version: value.admission_version,
    approved_plan_result_version: value.approved_plan_result_version,
    authority: value.authority,
    conversation_head: value.conversation_head,
    conversation_head_digest: value.conversation_head_digest,
    conversation_id: value.conversation_id,
    continuation_id: value.continuation_id,
    decision: value.decision,
    lifecycle: value.lifecycle,
    plan_result_digest: value.plan_result_digest,
    project_id: value.project_id,
    run_id: value.run_id,
    task_id: value.task_id,
    turn_id: value.turn_id,
  };
}

function unsignedAdmission({ approvedPlan, continuationId, admittedAtMs }) {
  return freezeDeep({
    admission_version: BUILDER_APPROVED_PLAN_CONTINUATION_ADMISSION_VERSION,
    admission_kind: APPROVED_PLAN_CONTINUATION_ADMISSION_KIND,
    approved_plan_result_version: approvedPlan.result_version,
    project_id: approvedPlan.project_id,
    conversation_id: approvedPlan.conversation_id,
    turn_id: approvedPlan.turn_id,
    task_id: approvedPlan.task_id,
    run_id: approvedPlan.run_id,
    decision: 'approved',
    plan_result_digest: approvedPlan.plan_result_digest,
    conversation_head: { ...approvedPlan.conversation_head },
    conversation_head_digest: conversationHeadDigest(approvedPlan.conversation_head),
    continuation_id: continuationId,
    admitted_at_ms: admittedAtMs,
    lifecycle: { ...LIFECYCLE },
    authority: { ...AUTHORITY },
  });
}

function createBuilderApprovedPlanContinuationAdmission(rawInput) {
  try {
    const descriptors = exactObject(rawInput, INPUT_KEYS);
    const approvedPlan = sanitizeApprovedPlan(descriptors.approved_plan.value);
    const admission = unsignedAdmission({
      approvedPlan,
      continuationId: safeContinuationId(descriptors.continuation_id.value),
      admittedAtMs: safeTimestamp(descriptors.admitted_at_ms.value),
    });
    return freezeDeep({
      ...admission,
      admission_digest: sha256Canonical(admissionDigestBody(admission)),
    });
  } catch (error) {
    if (error instanceof BuilderApprovedPlanContinuationAdmissionError) throw error;
    fail();
  }
}

function sanitizeBuilderApprovedPlanContinuationAdmission(rawAdmission) {
  try {
    const descriptors = exactObject(rawAdmission, ADMISSION_KEYS);
    const projectId = safeProjectId(descriptors.project_id.value);
    const conversationHead = sanitizeConversationHead(descriptors.conversation_head.value);
    const admission = freezeDeep({
      admission_version: descriptors.admission_version.value,
      admission_kind: descriptors.admission_kind.value,
      approved_plan_result_version: descriptors.approved_plan_result_version.value,
      project_id: projectId,
      conversation_id: safeConversationId(descriptors.conversation_id.value, projectId),
      turn_id: safeTurnId(descriptors.turn_id.value),
      task_id: safeTaskId(descriptors.task_id.value),
      run_id: safeRunId(descriptors.run_id.value),
      decision: descriptors.decision.value,
      plan_result_digest: safeDigest(descriptors.plan_result_digest.value),
      conversation_head: conversationHead,
      conversation_head_digest: safeDigest(descriptors.conversation_head_digest.value),
      continuation_id: safeContinuationId(descriptors.continuation_id.value),
      admitted_at_ms: safeTimestamp(descriptors.admitted_at_ms.value),
      lifecycle: sanitizeLifecycle(descriptors.lifecycle.value),
      authority: sanitizeAuthority(descriptors.authority.value),
    });
    if (
      admission.admission_version !== BUILDER_APPROVED_PLAN_CONTINUATION_ADMISSION_VERSION
      || admission.admission_kind !== APPROVED_PLAN_CONTINUATION_ADMISSION_KIND
      || admission.approved_plan_result_version !== APPROVED_PLAN_READ_RESULT_VERSION
      || admission.decision !== 'approved'
      || admission.conversation_head_digest !== conversationHeadDigest(admission.conversation_head)
    ) fail();
    const digest = safeDigest(descriptors.admission_digest.value);
    if (digest !== sha256Canonical(admissionDigestBody(admission))) fail();
    return freezeDeep({
      ...admission,
      admission_digest: digest,
    });
  } catch (error) {
    if (error instanceof BuilderApprovedPlanContinuationAdmissionError) throw error;
    fail();
  }
}

module.exports = freezeDeep({
  APPROVED_PLAN_READ_RESULT_VERSION,
  BUILDER_APPROVED_PLAN_CONTINUATION_ADMISSION_VERSION,
  APPROVED_PLAN_CONTINUATION_ADMISSION_KIND,
  BuilderApprovedPlanContinuationAdmissionError,
  createBuilderApprovedPlanContinuationAdmission,
  sanitizeBuilderApprovedPlanContinuationAdmission,
});
