'use strict';

const { types: utilTypes } = require('node:util');

const {
  BUILDER_AUTOMATIC_DRAFT_CHECKPOINT_SERVICE_VERSION,
} = require('./builder-automatic-draft-checkpoint-service.cjs');
const {
  BUILDER_CONVERSATION_MAIN_SERVICE_VERSION,
} = require('./builder-conversation-main-service.cjs');
const {
  createBuilderLivePreviewSourceAdmission,
} = require('./builder-live-preview-source-admission.cjs');
const {
  createBuilderLivePreviewSourceResolver,
} = require('./builder-live-preview-source-resolver.cjs');
const {
  sanitizeBuilderGitCandidateReceipt,
} = require('./builder-git-receipt-contract.cjs');

const BUILDER_LIVE_PREVIEW_CURRENT_DRAFT_SOURCE_SERVICE_VERSION =
  'builder-live-preview-current-draft-source-service.v1';
const BUILDER_LIVE_PREVIEW_CURRENT_DRAFT_SOURCE_RESULT_VERSION =
  'builder-live-preview-current-draft-source-result.v1';
const OPTION_KEYS = Object.freeze([
  'conversation_service',
  'git_authority',
  'automatic_draft_checkpoint_service',
  'now_ms',
]);
const REQUEST_KEYS = Object.freeze(['project_id', 'conversation_id']);
const CONVERSATION_DRAFT_KEYS = Object.freeze([
  'result_version',
  'draft_id',
  'project_id',
  'conversation_id',
  'turn_id',
  'task_id',
  'run_id',
  'candidate_digest',
  'base_revision',
  'conversation_head',
  'candidate_result',
  'verification_admission',
]);
const CANDIDATE_RESULT_KEYS = Object.freeze([
  'draft_id',
  'title',
  'summary',
  'git_candidate_receipt',
]);
const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONVERSATION_ID_PATTERN =
  /^builder-conversation:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DRAFT_ID_PATTERN = /^builder-generation-draft:[0-9a-f]{64}$/u;

class BuilderLivePreviewCurrentDraftSourceServiceError extends Error {
  constructor() {
    super('Current draft source is unavailable for live preview.');
    this.name = 'BuilderLivePreviewCurrentDraftSourceServiceError';
    this.code = 'builder_live_preview_current_draft_source_unavailable';
    this.retryable = true;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderLivePreviewCurrentDraftSourceServiceError();
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length
    || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return descriptors;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function serviceMethod(value, versionKey, expectedVersion, methodKey) {
  if (!isPlainObject(value)) fail();
  const version = Object.getOwnPropertyDescriptor(value, versionKey);
  const method = Object.getOwnPropertyDescriptor(value, methodKey);
  if (
    !version
    || !Object.hasOwn(version, 'value')
    || version.value !== expectedVersion
    || !method
    || !Object.hasOwn(method, 'value')
    || typeof method.value !== 'function'
    || utilTypes.isProxy(method.value)
  ) fail();
  return method.value.bind(value);
}

function ownMethod(value, methodKey) {
  if (!isPlainObject(value)) fail();
  const method = Object.getOwnPropertyDescriptor(value, methodKey);
  if (
    !method
    || !Object.hasOwn(method, 'value')
    || typeof method.value !== 'function'
    || utilTypes.isProxy(method.value)
  ) fail();
  return method.value.bind(value);
}

function safeRequest(rawRequest) {
  const request = exactObject(rawRequest, REQUEST_KEYS);
  const projectId = safePattern(request.project_id.value, PROJECT_ID_PATTERN);
  const conversationId = safePattern(request.conversation_id.value, CONVERSATION_ID_PATTERN);
  if (conversationId.slice('builder-conversation:'.length) !== projectId.slice('builder-project:'.length)) fail();
  return freezeDeep({
    project_id: projectId,
    conversation_id: conversationId,
  });
}

function currentDraftIdFromStream(rawValue, request) {
  if (!isPlainObject(rawValue)) fail();
  const projectId = Object.getOwnPropertyDescriptor(rawValue, 'project_id');
  const conversation = Object.getOwnPropertyDescriptor(rawValue, 'conversation');
  const reviewState = Object.getOwnPropertyDescriptor(rawValue, 'review_state_projection');
  if (
    !projectId
    || !Object.hasOwn(projectId, 'value')
    || projectId.value !== request.project_id
    || !conversation
    || !Object.hasOwn(conversation, 'value')
    || !isPlainObject(conversation.value)
    || conversation.value.conversation_id !== request.conversation_id
    || !reviewState
    || !Object.hasOwn(reviewState, 'value')
    || !isPlainObject(reviewState.value)
  ) fail();
  return safePattern(reviewState.value.draft_id, DRAFT_ID_PATTERN);
}

function candidateFromConversation(rawValue, request) {
  const value = exactObject(rawValue, CONVERSATION_DRAFT_KEYS);
  if (
    value.result_version.value !== 'builder-conversation-candidate-draft-read-result.v1'
    || value.draft_id.value !== request.draft_id
    || value.project_id.value !== request.project_id
    || value.conversation_id.value !== request.conversation_id
    || value.verification_admission.value !== 'sqlite_replay_verified'
  ) fail();
  const candidateResult = exactObject(value.candidate_result.value, CANDIDATE_RESULT_KEYS);
  if (candidateResult.draft_id.value !== request.draft_id) fail();
  const receipt = sanitizeBuilderGitCandidateReceipt(candidateResult.git_candidate_receipt.value);
  if (
    receipt.project_id !== request.project_id
    || receipt.conversation_id !== request.conversation_id
    || receipt.turn_id !== value.turn_id.value
    || receipt.task_id !== value.task_id.value
    || receipt.run_id !== value.run_id.value
    || receipt.candidate_digest !== value.candidate_digest.value
  ) fail();
  return receipt;
}

function selectedHtmlEntryPath(sourceTree) {
  const index = sourceTree.files.find((file) => file.path === 'index.html') ?? null;
  if (index !== null) return index.path;
  const first = sourceTree.files.find((file) => /\.html?$/iu.test(file.path)) ?? null;
  if (first === null) fail();
  return first.path;
}

function createBuilderLivePreviewCurrentDraftSourceService(rawOptions) {
  const options = exactObject(rawOptions, OPTION_KEYS);
  const conversationService = options.conversation_service.value;
  const readCandidateDraft = serviceMethod(
    conversationService,
    'service_version',
    BUILDER_CONVERSATION_MAIN_SERVICE_VERSION,
    'read_candidate_draft',
  );
  const readStream = serviceMethod(
    conversationService,
    'service_version',
    BUILDER_CONVERSATION_MAIN_SERVICE_VERSION,
    'read_stream',
  );
  const gitAuthority = options.git_authority.value;
  ownMethod(gitAuthority, 'read_verified_candidate');
  const verifyCandidateReceipt = ownMethod(gitAuthority, 'verify_candidate_receipt');
  const automaticDraftCheckpointService = options.automatic_draft_checkpoint_service.value;
  serviceMethod(
    automaticDraftCheckpointService,
    'service_version',
    BUILDER_AUTOMATIC_DRAFT_CHECKPOINT_SERVICE_VERSION,
    'verify_current_candidate_checkpoint',
  );
  const nowMs = options.now_ms.value;
  if (typeof nowMs !== 'function' || utilTypes.isProxy(nowMs)) fail();
  const sourceResolver = createBuilderLivePreviewSourceResolver({
    automatic_draft_checkpoint_service: automaticDraftCheckpointService,
    git_authority: gitAuthority,
    project_read_authority: null,
  });

  return freezeDeep({
    service_version: BUILDER_LIVE_PREVIEW_CURRENT_DRAFT_SOURCE_SERVICE_VERSION,

    async resolve_current_draft_preview_source(rawRequest) {
      try {
        const request = safeRequest(rawRequest);
        const draftId = currentDraftIdFromStream(
          await readStream({ project_id: request.project_id }),
          request,
        );
        const draftRequest = freezeDeep({ ...request, draft_id: draftId });
        const receipt = candidateFromConversation(
          await readCandidateDraft({ draft_id: draftId }),
          draftRequest,
        );
        const resolverResult = await sourceResolver.resolveCurrentDraftPreviewSource({
          project_id: request.project_id,
          conversation_id: request.conversation_id,
          candidate_receipt: receipt,
          candidate_verification: await verifyCandidateReceipt(receipt),
        });
        if (resolverResult.status !== 'ready' || resolverResult.preview_source_snapshot === null) fail();
        const sourceTree = resolverResult.preview_source_snapshot.source_tree;
        const admittedAtMs = safeTimestamp(nowMs());
        const sourceAdmission = createBuilderLivePreviewSourceAdmission({
          source_resolver_result: resolverResult,
          selected_entry_path: selectedHtmlEntryPath(sourceTree),
          preview_kind: 'live_static_web',
          admitted_at_ms: admittedAtMs,
          expires_at_ms: admittedAtMs + 10 * 60 * 1_000,
        });
        return freezeDeep({
          result_version: BUILDER_LIVE_PREVIEW_CURRENT_DRAFT_SOURCE_RESULT_VERSION,
          service_version: BUILDER_LIVE_PREVIEW_CURRENT_DRAFT_SOURCE_SERVICE_VERSION,
          operation: 'current_draft_live_preview_source_admitted',
          draft_id: draftId,
          project_id: request.project_id,
          conversation_id: request.conversation_id,
          source_admission: sourceAdmission,
        });
      } catch (error) {
        if (error instanceof BuilderLivePreviewCurrentDraftSourceServiceError) throw error;
        fail();
      }
    },
  });
}

module.exports = freezeDeep({
  BUILDER_LIVE_PREVIEW_CURRENT_DRAFT_SOURCE_RESULT_VERSION,
  BUILDER_LIVE_PREVIEW_CURRENT_DRAFT_SOURCE_SERVICE_VERSION,
  BuilderLivePreviewCurrentDraftSourceServiceError,
  createBuilderLivePreviewCurrentDraftSourceService,
});
