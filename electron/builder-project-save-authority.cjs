'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderCodeChangeCandidate,
} = require('./builder-code-change-kernel.cjs');
const {
  sanitizeBuilderGitCandidateReceiptPair,
} = require('./builder-git-receipt-contract.cjs');

const BUILDER_PROJECT_SAVE_AUTHORITY_VERSION = 'builder-project-save-authority.v1';
const BUILDER_PROJECT_SAVE_RESULT_VERSION = 'builder-project-save-result.v1';
const OPTION_KEYS = Object.freeze([
  'generationDrafts',
  'gitAuthority',
  'metadataAuthority',
  'projectReadAuthority',
  'conversationService',
  'createUuid',
  'nowMs',
]);
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const UUID_PATTERN = new RegExp(`^${UUID_SOURCE}$`, 'u');
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const DRAFT_ID_PATTERN = /^builder-generation-draft:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const OID_PATTERN = /^[0-9a-f]{40}$/u;
const ERROR_MESSAGES = Object.freeze({
  builder_project_save_invalid: 'The project save request could not be verified.',
  builder_project_save_not_found: 'The generated project draft is no longer available.',
  builder_project_save_conflict: 'The project changed before the draft could be saved.',
  builder_project_save_unavailable: 'The project draft could not be saved.',
});

class BuilderProjectSaveAuthorityError extends Error {
  constructor(code = 'builder_project_save_unavailable') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code) ? code : 'builder_project_save_unavailable';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderProjectSaveAuthorityError';
    this.code = selected;
    this.retryable = selected !== 'builder_project_save_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderProjectSaveAuthorityError(code);
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
  if (!isPlainObject(value)) fail('builder_project_save_invalid');
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail('builder_project_save_invalid');
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_project_save_invalid');
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_project_save_invalid');
  }
  return descriptor.value;
}

function ownMethod(value, key) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) {
    fail('builder_project_save_invalid');
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
    fail('builder_project_save_invalid');
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
  fail('builder_project_save_invalid');
}

function sha256Canonical(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function safeUuid(value) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) fail('builder_project_save_invalid');
  return value;
}

function safeDraftId(value) {
  if (typeof value !== 'string' || !DRAFT_ID_PATTERN.test(value)) fail('builder_project_save_invalid');
  return value;
}

function safeProjectId(value) {
  if (typeof value !== 'string' || !PROJECT_ID_PATTERN.test(value)) fail('builder_project_save_invalid');
  return value;
}

function safeDigest(value) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) fail('builder_project_save_invalid');
  return value;
}

function safeOid(value, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !OID_PATTERN.test(value)) fail('builder_project_save_invalid');
  return value;
}

function safeMs(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail('builder_project_save_invalid');
  return value;
}

function sanitizeOptions(value) {
  exactObject(value, OPTION_KEYS);
  const generationDrafts = valueAt(value, 'generationDrafts');
  const gitAuthority = valueAt(value, 'gitAuthority');
  const metadataAuthority = valueAt(value, 'metadataAuthority');
  const projectReadAuthority = valueAt(value, 'projectReadAuthority');
  const conversationService = valueAt(value, 'conversationService');
  const createUuid = valueAt(value, 'createUuid');
  const nowMs = valueAt(value, 'nowMs');
  if (
    typeof createUuid !== 'function'
    || utilTypes.isProxy(createUuid)
    || typeof nowMs !== 'function'
    || utilTypes.isProxy(nowMs)
  ) fail('builder_project_save_invalid');
  return Object.freeze({
    generationDrafts,
    readPendingDraft: ownMethod(generationDrafts, 'read_pending_draft'),
    releasePendingDraft: ownMethod(generationDrafts, 'release_pending_draft'),
    gitAuthority,
    verifyCandidateReceipt: ownMethod(gitAuthority, 'verify_candidate_receipt'),
    metadataAuthority,
    loadProjectIdentity: ownMethod(metadataAuthority, 'load_project_identity'),
    recordProjectRevisionReceipt: ownMethod(metadataAuthority, 'record_project_revision_receipt'),
    projectReadAuthority,
    loadCurrent: ownMethod(projectReadAuthority, 'load_current'),
    conversationService,
    verifyConversationCandidate: ownMethod(conversationService, 'verify_candidate'),
    createUuid,
    nowMs,
  });
}

function sanitizeSaveRequest(value) {
  exactObject(value, ['draft_id']);
  return freezeDeep({ draft_id: safeDraftId(valueAt(value, 'draft_id')) });
}

function sanitizePendingDraft(value, expectedDraftId) {
  exactObject(value, [
    'result_version',
    'draft_id',
    'restart_restore',
    'conversation_event_admission',
    'request',
    'git_request_id',
    'title',
    'summary',
    'conversation_head',
    'candidate',
  ]);
  if (
    valueAt(value, 'result_version') !== 'builder-generation-pending-draft.v1'
    || valueAt(value, 'draft_id') !== expectedDraftId
    || valueAt(value, 'restart_restore') !== 'not_persisted'
    || valueAt(value, 'conversation_event_admission') !== 'sqlite_recorded'
  ) fail('builder_project_save_invalid');
  const candidate = sanitizeBuilderCodeChangeCandidate(valueAt(value, 'candidate'));
  const conversationHead = valueAt(value, 'conversation_head');
  exactObject(conversationHead, ['sequence', 'event_id', 'event_digest']);
  const sequence = valueAt(conversationHead, 'sequence');
  const eventId = valueAt(conversationHead, 'event_id');
  if (
    !Number.isSafeInteger(sequence)
    || sequence < 1
    || sequence > 1_024
    || typeof eventId !== 'string'
    || !/^builder-conversation-event:[0-9a-f]{64}$/u.test(eventId)
  ) fail('builder_project_save_invalid');
  return freezeDeep({
    draft_id: expectedDraftId,
    git_request_id: valueAt(value, 'git_request_id'),
    title: valueAt(value, 'title'),
    summary: valueAt(value, 'summary'),
    conversation_head: {
      sequence,
      event_id: eventId,
      event_digest: safeDigest(valueAt(conversationHead, 'event_digest')),
    },
    candidate,
  });
}

function sanitizeConversationVerification(value, draft) {
  const candidate = draft.candidate;
  const conversationHead = draft.conversation_head;
  exactObject(value, [
    'verification_version',
    'project_id',
    'conversation_id',
    'turn_id',
    'task_id',
    'run_id',
    'candidate_digest',
    'conversation_head',
    'candidate_result',
    'verification_admission',
  ]);
  const verifiedHead = valueAt(value, 'conversation_head');
  exactObject(verifiedHead, ['sequence', 'event_id', 'event_digest']);
  const candidateResult = valueAt(value, 'candidate_result');
  exactObject(candidateResult, ['draft_id', 'title', 'summary', 'git_candidate_receipt']);
  const gitCandidateReceipt = valueAt(candidateResult, 'git_candidate_receipt');
  if (
    valueAt(value, 'verification_version')
      !== 'builder-conversation-candidate-verification.v1'
    || valueAt(value, 'project_id') !== candidate.project_id
    || valueAt(value, 'conversation_id') !== candidate.conversation_id
    || valueAt(value, 'turn_id') !== candidate.turn_id
    || valueAt(value, 'task_id') !== candidate.task_id
    || valueAt(value, 'run_id') !== candidate.run_id
    || valueAt(value, 'candidate_digest') !== candidate.candidate_digest
    || valueAt(value, 'verification_admission') !== 'sqlite_replay_verified'
    || valueAt(verifiedHead, 'sequence') !== conversationHead.sequence
    || valueAt(verifiedHead, 'event_id') !== conversationHead.event_id
    || valueAt(verifiedHead, 'event_digest') !== conversationHead.event_digest
    || valueAt(candidateResult, 'draft_id') !== draft.draft_id
    || valueAt(candidateResult, 'title') !== draft.title
    || valueAt(candidateResult, 'summary') !== draft.summary
  ) fail('builder_project_save_invalid');
  return gitCandidateReceipt;
}

function taskTitle(candidate) {
  return candidate.base_revision_evidence === null
    ? 'Create Builder project'
    : 'Update Builder project';
}

function projectIdentityFromResult(value, expectedProjectId) {
  exactObject(value, ['result_version', 'operation', 'project', 'metadata_evidence']);
  if (
    valueAt(value, 'result_version') !== 'builder-product-metadata-result.v3'
    || valueAt(value, 'operation') !== 'project_identity_loaded'
  ) fail('builder_project_save_invalid');
  const project = valueAt(value, 'project');
  exactObject(project, ['project_id', 'created_at_ms']);
  if (safeProjectId(valueAt(project, 'project_id')) !== expectedProjectId) fail('builder_project_save_invalid');
  return freezeDeep({
    project_id: expectedProjectId,
    created_at_ms: safeMs(valueAt(project, 'created_at_ms')),
  });
}

function currentReceiptFromReadResult(value, expectedProjectId, expectedReceipt, expectedCommit) {
  exactObject(value, [
    'result_version',
    'product_revision_receipt',
    'current',
    'source_tree',
    'git_candidate_receipt',
    'git_verification_receipt',
    'authority_evidence',
    'operation',
  ]);
  if (
    valueAt(value, 'result_version') !== 'builder-project-read-result.v1'
    || valueAt(value, 'operation') !== 'current_loaded'
  ) fail('builder_project_save_invalid');
  const receipt = valueAt(value, 'product_revision_receipt');
  if (
    !isPlainObject(receipt)
    || safeProjectId(valueAt(receipt, 'project_id')) !== expectedProjectId
    || safeDigest(valueAt(receipt, 'revision_receipt_digest')) !== expectedReceipt
    || safeOid(valueAt(receipt, 'commit_oid')) !== expectedCommit
  ) fail('builder_project_save_invalid');
  return receipt;
}

function ownCode(error) {
  if (!error || typeof error !== 'object' || utilTypes.isProxy(error)) return null;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
  } catch {
    return null;
  }
}

function ownSaveErrorCode(error) {
  if (!error || typeof error !== 'object' || utilTypes.isProxy(error)) return null;
  try {
    if (Object.getPrototypeOf(error) !== BuilderProjectSaveAuthorityError.prototype) return null;
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    return descriptor
      && Object.hasOwn(descriptor, 'value')
      && Object.hasOwn(ERROR_MESSAGES, descriptor.value)
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

function normalizeError(error) {
  const saveCode = ownSaveErrorCode(error);
  if (saveCode !== null) return new BuilderProjectSaveAuthorityError(saveCode);
  const code = ownCode(error);
  if (
    code === 'builder_product_metadata_conflict'
    || code === 'builder_git_project_conflict'
    || code === 'builder_git_project_dirty'
  ) return new BuilderProjectSaveAuthorityError('builder_project_save_conflict');
  if (
    code === 'builder_product_metadata_not_found'
    || code === 'builder_generation_service_unavailable'
  ) return new BuilderProjectSaveAuthorityError('builder_project_save_not_found');
  if (
    code === 'builder_product_metadata_invalid'
    || code === 'builder_product_metadata_integrity_failed'
    || code === 'builder_git_project_invalid'
    || code === 'builder_git_project_integrity_failed'
    || code === 'builder_project_read_integrity_failed'
    || code === 'builder_generation_draft_conflict'
  ) return new BuilderProjectSaveAuthorityError('builder_project_save_invalid');
  return new BuilderProjectSaveAuthorityError('builder_project_save_unavailable');
}

function createBuilderProjectSaveAuthority(rawOptions) {
  const options = sanitizeOptions(rawOptions);
  const attempts = new Map();
  const inFlight = new Map();

  function createAttempt(draft) {
    const acceptedAtMs = safeMs(Reflect.apply(options.nowMs, undefined, []));
    const reviewUuid = safeUuid(Reflect.apply(options.createUuid, undefined, []));
    const reviewerUuid = safeUuid(Reflect.apply(options.createUuid, undefined, []));
    return freezeDeep({
      accepted_at_ms: acceptedAtMs,
      review_id: `builder-review:${reviewUuid}`,
      reviewer_id: `builder-user:${reviewerUuid}`,
      git_request_id: draft.git_request_id,
      candidate_digest: draft.candidate.candidate_digest,
      idempotency_key: `builder-idempotency:${sha256Canonical({
        authority: BUILDER_PROJECT_SAVE_AUTHORITY_VERSION,
        draft_id: draft.draft_id,
        git_request_id: draft.git_request_id,
        candidate_digest: draft.candidate.candidate_digest,
      }).slice('sha256:'.length)}`,
    });
  }

  function attemptFor(draft) {
    const existing = attempts.get(draft.draft_id);
    if (existing) {
      if (
        existing.git_request_id !== draft.git_request_id
        || existing.candidate_digest !== draft.candidate.candidate_digest
      ) fail('builder_project_save_invalid');
      return existing;
    }
    const attempt = createAttempt(draft);
    attempts.set(draft.draft_id, attempt);
    return attempt;
  }

  async function projectIdentity(candidate) {
    const loaded = await Reflect.apply(
      options.loadProjectIdentity,
      options.metadataAuthority,
      [{ project_id: candidate.project_id }],
    );
    return projectIdentityFromResult(loaded, candidate.project_id);
  }

  async function saveOnce(request) {
    try {
      const draft = sanitizePendingDraft(
        Reflect.apply(options.readPendingDraft, options.generationDrafts, [{ draft_id: request.draft_id }]),
        request.draft_id,
      );
      const attempt = attemptFor(draft);
      const candidate = draft.candidate;
      const recordedGitReceipt = sanitizeConversationVerification(
        Reflect.apply(
          options.verifyConversationCandidate,
          options.conversationService,
          [{
            project_id: candidate.project_id,
            conversation_id: candidate.conversation_id,
            turn_id: candidate.turn_id,
            task_id: candidate.task_id,
            run_id: candidate.run_id,
            candidate_digest: candidate.candidate_digest,
            conversation_head: draft.conversation_head,
          }],
        ),
        draft,
      );
      const expectedBaseOid = candidate.base_revision_evidence === null
        ? null
        : safeOid(candidate.base_revision_evidence.commit_oid);
      const expectedCurrent = candidate.base_revision_evidence === null
        ? null
        : safeDigest(candidate.base_revision_evidence.revision_receipt_digest);
      const rawVerification = await Reflect.apply(
        options.verifyCandidateReceipt,
        options.gitAuthority,
        [recordedGitReceipt],
      );
      const receiptPair = sanitizeBuilderGitCandidateReceiptPair(
        recordedGitReceipt,
        rawVerification,
      );
      const gitReceipt = receiptPair.candidate_receipt;
      const verification = receiptPair.verification_receipt;
      if (
        gitReceipt.request_id !== draft.git_request_id
        || gitReceipt.project_id !== candidate.project_id
        || gitReceipt.conversation_id !== candidate.conversation_id
        || gitReceipt.turn_id !== candidate.turn_id
        || gitReceipt.task_id !== candidate.task_id
        || gitReceipt.run_id !== candidate.run_id
        || gitReceipt.candidate_id !== candidate.candidate_id
        || gitReceipt.candidate_digest !== candidate.candidate_digest
        || gitReceipt.resulting_tree_digest !== candidate.resulting_tree_digest
        || gitReceipt.expected_base_oid !== expectedBaseOid
      ) fail('builder_project_save_invalid');
      const project = await projectIdentity(candidate);
      const record = await Reflect.apply(options.recordProjectRevisionReceipt, options.metadataAuthority, [{
        idempotency: { idempotency_key: attempt.idempotency_key },
        project,
        conversation: {
          conversation_id: candidate.conversation_id,
          project_id: candidate.project_id,
          created_at_ms: project.created_at_ms,
        },
        task: {
          task_id: candidate.task_id,
          project_id: candidate.project_id,
          conversation_id: candidate.conversation_id,
          title: taskTitle(candidate),
          base_commit_oid: expectedBaseOid,
          created_at_ms: attempt.accepted_at_ms,
        },
        run: {
          run_id: candidate.run_id,
          project_id: candidate.project_id,
          task_id: candidate.task_id,
          turn_id: candidate.turn_id,
          request_id: draft.git_request_id,
          candidate_id: candidate.candidate_id,
          status: 'succeeded',
          result_kind: 'candidate',
          result_digest: candidate.candidate_digest,
          completed_at_ms: attempt.accepted_at_ms,
        },
        review: {
          review_id: attempt.review_id,
          project_id: candidate.project_id,
          task_id: candidate.task_id,
          run_id: candidate.run_id,
          subject_kind: 'git_candidate',
          subject_candidate_id: candidate.candidate_id,
          subject_candidate_digest: candidate.candidate_digest,
          subject_verification_receipt_digest: gitReceipt.verification_receipt_digest,
          decision: 'accepted',
          reviewer_id: attempt.reviewer_id,
          reviewed_at_ms: attempt.accepted_at_ms,
        },
        git_candidate_verification_receipt: verification,
        git_candidate_receipt: gitReceipt,
        project_revision: {
          project_id: candidate.project_id,
          title: draft.title,
          summary: draft.summary,
          conversation_id: candidate.conversation_id,
          turn_id: candidate.turn_id,
          request_id: draft.git_request_id,
          object_format: gitReceipt.object_format,
          commit_oid: gitReceipt.commit_oid,
          tree_oid: gitReceipt.tree_oid,
          parent_oid: gitReceipt.parent_oid,
          candidate_id: gitReceipt.candidate_id,
          candidate_digest: gitReceipt.candidate_digest,
          resulting_tree_digest: gitReceipt.resulting_tree_digest,
          semantic_identity_digest: gitReceipt.semantic_identity_digest,
          verification_receipt_digest: gitReceipt.verification_receipt_digest,
          selected_at_ms: attempt.accepted_at_ms,
        },
        expected_current_revision_receipt_digest: expectedCurrent,
      }]);
      const current = await Reflect.apply(options.loadCurrent, options.projectReadAuthority, [{
        project_id: candidate.project_id,
      }]);
      const currentReceipt = currentReceiptFromReadResult(
        current,
        candidate.project_id,
        safeDigest(valueAt(record.receipt, 'revision_receipt_digest')),
        gitReceipt.commit_oid,
      );
      Reflect.apply(options.releasePendingDraft, options.generationDrafts, [{
        draft_id: draft.draft_id,
        candidate_digest: candidate.candidate_digest,
      }]);
      attempts.delete(draft.draft_id);
      return freezeDeep({
        result_version: BUILDER_PROJECT_SAVE_RESULT_VERSION,
        operation: 'draft_saved',
        draft_id: draft.draft_id,
        project_id: candidate.project_id,
        revision_receipt_digest: valueAt(currentReceipt, 'revision_receipt_digest'),
        commit_oid: gitReceipt.commit_oid,
        tree_oid: gitReceipt.tree_oid,
        pending_draft_released: true,
        save_evidence: {
          code_authority: 'git_commit_candidate',
          product_authority: 'sqlite_accepted_project_revision_receipt',
          conversation_event_admission: 'sqlite_recorded',
          renderer_authority: 'draft_id_only',
        },
      });
    } catch (error) {
      throw normalizeError(error);
    }
  }

  function save(rawRequest) {
    let request;
    try {
      request = sanitizeSaveRequest(rawRequest);
    } catch (error) {
      return Promise.reject(normalizeError(error));
    }
    const existing = inFlight.get(request.draft_id);
    if (existing) return existing;
    const operation = saveOnce(request);
    inFlight.set(request.draft_id, operation);
    const clear = () => {
      if (inFlight.get(request.draft_id) === operation) inFlight.delete(request.draft_id);
    };
    operation.then(clear, clear);
    return operation;
  }

  return freezeDeep({
    authority_version: BUILDER_PROJECT_SAVE_AUTHORITY_VERSION,
    save,
  });
}

module.exports = Object.freeze({
  BUILDER_PROJECT_SAVE_AUTHORITY_VERSION,
  BUILDER_PROJECT_SAVE_RESULT_VERSION,
  BuilderProjectSaveAuthorityError,
  createBuilderProjectSaveAuthority,
});
