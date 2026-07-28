'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const BUILDER_DRAFT_CONTINUATION_ADMISSION_VERSION = 'builder-draft-continuation-admission.v1';
const DRAFT_CONTINUATION_ADMISSION_KIND = 'builder_draft_continuation_admission';
const PENDING_DRAFT_RESULT_VERSION = 'builder-generation-pending-draft.v2';
const PENDING_DRAFT_KEYS = Object.freeze([
  'result_version',
  'draft_id',
  'restart_restore',
  'conversation_event_admission',
  'git_request_id',
  'title',
  'summary',
  'conversation_head',
  'candidate_proof',
]);
const CANDIDATE_PROOF_KEYS = Object.freeze([
  'proof_version',
  'project_id',
  'conversation_id',
  'turn_id',
  'task_id',
  'run_id',
  'request_digest',
  'git_request_id',
  'candidate_id',
  'candidate_digest',
  'resulting_tree_digest',
  'expected_base_oid',
  'base_revision',
]);
const BASE_REVISION_KEYS = Object.freeze(['revision_receipt_digest', 'commit_oid']);
const CONVERSATION_HEAD_KEYS = Object.freeze(['sequence', 'event_id', 'event_digest']);
const INPUT_KEYS = Object.freeze([
  'pending_draft',
  'continuation_id',
  'admitted_at_ms',
]);
const ADMISSION_KEYS = Object.freeze([
  'admission_version',
  'admission_kind',
  'pending_draft_result_version',
  'project_id',
  'conversation_id',
  'previous_turn_id',
  'previous_task_id',
  'previous_run_id',
  'previous_request_digest',
  'draft_id',
  'candidate_id',
  'candidate_digest',
  'resulting_tree_digest',
  'pending_draft_restart_restore',
  'conversation_head',
  'conversation_head_digest',
  'continuation_id',
  'admitted_at_ms',
  'lifecycle',
  'authority',
  'admission_digest',
]);
const LIFECYCLE_KEYS = Object.freeze([
  'pending_draft_gate',
  'current_head_reverification',
  'review_state_reverification',
  'continuation_admission',
  'prior_candidate_release',
  'provider_dispatch',
  'tool_dispatch',
  'source_mutation',
  'git_authority',
  'revision_admission',
  'save_admission',
]);
const AUTHORITY_KEYS = Object.freeze([
  'admission_authority',
  'pending_draft_authority',
  'conversation_binding',
  'review_state_authority',
  'renderer_authority',
  'provider_dispatch',
  'credential_readback',
  'tool_dispatch',
  'source_mutation',
  'git_authority',
  'revision_authority',
  'save_authority',
  'cost_authority',
]);
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:(${UUID_SOURCE})$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:(${UUID_SOURCE})$`, 'u');
const TURN_ID_PATTERN = new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const GIT_REQUEST_ID_PATTERN = new RegExp(`^builder-git-request:${UUID_SOURCE}$`, 'u');
const CONTINUATION_ID_PATTERN = new RegExp(`^builder-draft-continuation:${UUID_SOURCE}$`, 'u');
const CANDIDATE_ID_PATTERN = /^builder-code-change-candidate:[0-9a-f]{64}$/u;
const DRAFT_ID_PATTERN = /^builder-generation-draft:[0-9a-f]{64}$/u;
const EVENT_ID_PATTERN = /^builder-conversation-event:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const OID_PATTERN = /^[0-9a-f]{40}$/u;
const LIFECYCLE = Object.freeze({
  pending_draft_gate: 'pending_candidate_identity_bound',
  current_head_reverification: 'required_before_provider_dispatch',
  review_state_reverification: 'required_before_replacement',
  continuation_admission: 'admitted_without_starting_run',
  prior_candidate_release: 'not_performed',
  provider_dispatch: 'not_started',
  tool_dispatch: 'not_started',
  source_mutation: 'not_performed',
  git_authority: 'not_present',
  revision_admission: 'not_created',
  save_admission: 'not_performed',
});
const AUTHORITY = Object.freeze({
  admission_authority: 'main_draft_continuation_admission_contract_v1',
  pending_draft_authority: 'main_generation_pending_draft_identity_verified',
  conversation_binding: 'pending_draft_head_bound_reverify_current_head_before_use',
  review_state_authority: 'not_asserted_reverify_before_replacement',
  renderer_authority: 'not_present',
  provider_dispatch: false,
  credential_readback: false,
  tool_dispatch: 'not_performed',
  source_mutation: 'not_performed',
  git_authority: 'not_present',
  revision_authority: 'not_present',
  save_authority: 'not_present',
  cost_authority: 'no_chargeable_dispatch_without_generation_runtime_v1',
});

class BuilderDraftContinuationAdmissionError extends Error {
  constructor() {
    super('The draft continuation could not be verified.');
    this.name = 'BuilderDraftContinuationAdmissionError';
    this.code = 'builder_draft_continuation_admission_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderDraftContinuationAdmissionError();
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

function safeDigest(value) {
  return safePattern(value, DIGEST_PATTERN);
}

function safeOptionalDigest(value) {
  if (value === null) return null;
  return safeDigest(value);
}

function safeOptionalOid(value) {
  if (value === null) return null;
  return safePattern(value, OID_PATTERN);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeSequence(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_024) fail();
  return value;
}

function hasUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function safeText(value, maximumCodePoints, maximumBytes) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || hasUnpairedSurrogate(value)
    || [...value].length > maximumCodePoints
    || Buffer.byteLength(value, 'utf8') > maximumBytes
  ) fail();
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if ((code >= 0x7f && code <= 0x9f) || (code <= 0x1f && ![0x09, 0x0a, 0x0d].includes(code))) {
      fail();
    }
  }
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

function sanitizeBaseRevision(value) {
  if (value === null) return null;
  const descriptors = exactObject(value, BASE_REVISION_KEYS);
  return freezeDeep({
    revision_receipt_digest: safeDigest(descriptors.revision_receipt_digest.value),
    commit_oid: safePattern(descriptors.commit_oid.value, OID_PATTERN),
  });
}

function sanitizeCandidateProof(value, expectedGitRequestId) {
  const descriptors = exactObject(value, CANDIDATE_PROOF_KEYS);
  if (descriptors.proof_version.value !== 'builder-generation-pending-candidate-proof.v1') fail();
  const projectId = safeProjectId(descriptors.project_id.value);
  const conversationId = safeConversationId(descriptors.conversation_id.value, projectId);
  const gitRequestId = safePattern(descriptors.git_request_id.value, GIT_REQUEST_ID_PATTERN);
  const baseRevision = sanitizeBaseRevision(descriptors.base_revision.value);
  const expectedBaseOid = safeOptionalOid(descriptors.expected_base_oid.value);
  if (
    gitRequestId !== expectedGitRequestId
    || (baseRevision === null ? expectedBaseOid !== null : expectedBaseOid !== baseRevision.commit_oid)
  ) fail();
  return freezeDeep({
    project_id: projectId,
    conversation_id: conversationId,
    turn_id: safePattern(descriptors.turn_id.value, TURN_ID_PATTERN),
    task_id: safePattern(descriptors.task_id.value, TASK_ID_PATTERN),
    run_id: safePattern(descriptors.run_id.value, RUN_ID_PATTERN),
    request_digest: safeOptionalDigest(descriptors.request_digest.value),
    git_request_id: gitRequestId,
    candidate_id: safePattern(descriptors.candidate_id.value, CANDIDATE_ID_PATTERN),
    candidate_digest: safeDigest(descriptors.candidate_digest.value),
    resulting_tree_digest: safeDigest(descriptors.resulting_tree_digest.value),
  });
}

function sanitizePendingDraft(value) {
  const descriptors = exactObject(value, PENDING_DRAFT_KEYS);
  if (
    descriptors.result_version.value !== PENDING_DRAFT_RESULT_VERSION
    || !['not_persisted', 'git_sqlite_verified'].includes(descriptors.restart_restore.value)
    || descriptors.conversation_event_admission.value !== 'sqlite_recorded'
  ) fail();
  safeText(descriptors.title.value, 160, 1_024);
  safeText(descriptors.summary.value, 2_000, 8_192);
  const gitRequestId = safePattern(descriptors.git_request_id.value, GIT_REQUEST_ID_PATTERN);
  const candidateProof = sanitizeCandidateProof(descriptors.candidate_proof.value, gitRequestId);
  return freezeDeep({
    result_version: PENDING_DRAFT_RESULT_VERSION,
    draft_id: safePattern(descriptors.draft_id.value, DRAFT_ID_PATTERN),
    restart_restore: descriptors.restart_restore.value,
    conversation_head: sanitizeConversationHead(descriptors.conversation_head.value),
    candidate_proof: candidateProof,
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
    authority: value.authority,
    candidate_digest: value.candidate_digest,
    candidate_id: value.candidate_id,
    conversation_head: value.conversation_head,
    conversation_head_digest: value.conversation_head_digest,
    conversation_id: value.conversation_id,
    continuation_id: value.continuation_id,
    draft_id: value.draft_id,
    lifecycle: value.lifecycle,
    pending_draft_restart_restore: value.pending_draft_restart_restore,
    pending_draft_result_version: value.pending_draft_result_version,
    previous_request_digest: value.previous_request_digest,
    previous_run_id: value.previous_run_id,
    previous_task_id: value.previous_task_id,
    previous_turn_id: value.previous_turn_id,
    project_id: value.project_id,
    resulting_tree_digest: value.resulting_tree_digest,
  };
}

function unsignedAdmission({ pendingDraft, continuationId, admittedAtMs }) {
  const proof = pendingDraft.candidate_proof;
  return freezeDeep({
    admission_version: BUILDER_DRAFT_CONTINUATION_ADMISSION_VERSION,
    admission_kind: DRAFT_CONTINUATION_ADMISSION_KIND,
    pending_draft_result_version: pendingDraft.result_version,
    project_id: proof.project_id,
    conversation_id: proof.conversation_id,
    previous_turn_id: proof.turn_id,
    previous_task_id: proof.task_id,
    previous_run_id: proof.run_id,
    previous_request_digest: proof.request_digest,
    draft_id: pendingDraft.draft_id,
    candidate_id: proof.candidate_id,
    candidate_digest: proof.candidate_digest,
    resulting_tree_digest: proof.resulting_tree_digest,
    pending_draft_restart_restore: pendingDraft.restart_restore,
    conversation_head: { ...pendingDraft.conversation_head },
    conversation_head_digest: conversationHeadDigest(pendingDraft.conversation_head),
    continuation_id: continuationId,
    admitted_at_ms: admittedAtMs,
    lifecycle: { ...LIFECYCLE },
    authority: { ...AUTHORITY },
  });
}

function createBuilderDraftContinuationAdmission(rawInput) {
  try {
    const descriptors = exactObject(rawInput, INPUT_KEYS);
    const admission = unsignedAdmission({
      pendingDraft: sanitizePendingDraft(descriptors.pending_draft.value),
      continuationId: safePattern(descriptors.continuation_id.value, CONTINUATION_ID_PATTERN),
      admittedAtMs: safeTimestamp(descriptors.admitted_at_ms.value),
    });
    return freezeDeep({
      ...admission,
      admission_digest: sha256Canonical(admissionDigestBody(admission)),
    });
  } catch (error) {
    if (error instanceof BuilderDraftContinuationAdmissionError) throw error;
    fail();
  }
}

function sanitizeBuilderDraftContinuationAdmission(rawAdmission) {
  try {
    const descriptors = exactObject(rawAdmission, ADMISSION_KEYS);
    const projectId = safeProjectId(descriptors.project_id.value);
    const conversationHead = sanitizeConversationHead(descriptors.conversation_head.value);
    const admission = freezeDeep({
      admission_version: descriptors.admission_version.value,
      admission_kind: descriptors.admission_kind.value,
      pending_draft_result_version: descriptors.pending_draft_result_version.value,
      project_id: projectId,
      conversation_id: safeConversationId(descriptors.conversation_id.value, projectId),
      previous_turn_id: safePattern(descriptors.previous_turn_id.value, TURN_ID_PATTERN),
      previous_task_id: safePattern(descriptors.previous_task_id.value, TASK_ID_PATTERN),
      previous_run_id: safePattern(descriptors.previous_run_id.value, RUN_ID_PATTERN),
      previous_request_digest: safeOptionalDigest(descriptors.previous_request_digest.value),
      draft_id: safePattern(descriptors.draft_id.value, DRAFT_ID_PATTERN),
      candidate_id: safePattern(descriptors.candidate_id.value, CANDIDATE_ID_PATTERN),
      candidate_digest: safeDigest(descriptors.candidate_digest.value),
      resulting_tree_digest: safeDigest(descriptors.resulting_tree_digest.value),
      pending_draft_restart_restore: descriptors.pending_draft_restart_restore.value,
      conversation_head: conversationHead,
      conversation_head_digest: safeDigest(descriptors.conversation_head_digest.value),
      continuation_id: safePattern(descriptors.continuation_id.value, CONTINUATION_ID_PATTERN),
      admitted_at_ms: safeTimestamp(descriptors.admitted_at_ms.value),
      lifecycle: sanitizeLifecycle(descriptors.lifecycle.value),
      authority: sanitizeAuthority(descriptors.authority.value),
    });
    if (
      admission.admission_version !== BUILDER_DRAFT_CONTINUATION_ADMISSION_VERSION
      || admission.admission_kind !== DRAFT_CONTINUATION_ADMISSION_KIND
      || admission.pending_draft_result_version !== PENDING_DRAFT_RESULT_VERSION
      || !['not_persisted', 'git_sqlite_verified'].includes(admission.pending_draft_restart_restore)
      || admission.conversation_head_digest !== conversationHeadDigest(admission.conversation_head)
    ) fail();
    const digest = safeDigest(descriptors.admission_digest.value);
    if (digest !== sha256Canonical(admissionDigestBody(admission))) fail();
    return freezeDeep({
      ...admission,
      admission_digest: digest,
    });
  } catch (error) {
    if (error instanceof BuilderDraftContinuationAdmissionError) throw error;
    fail();
  }
}

module.exports = freezeDeep({
  BUILDER_DRAFT_CONTINUATION_ADMISSION_VERSION,
  DRAFT_CONTINUATION_ADMISSION_KIND,
  PENDING_DRAFT_RESULT_VERSION,
  BuilderDraftContinuationAdmissionError,
  createBuilderDraftContinuationAdmission,
  sanitizeBuilderDraftContinuationAdmission,
});
