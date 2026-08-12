'use strict';

const { types: utilTypes } = require('node:util');

const {
  BUILDER_LIVE_PREVIEW_CURRENT_DRAFT_SOURCE_RESULT_VERSION,
  BUILDER_LIVE_PREVIEW_CURRENT_DRAFT_SOURCE_SERVICE_VERSION,
} = require('./builder-live-preview-current-draft-source-service.cjs');
const {
  sanitizeBuilderLivePreviewSourceAdmission,
} = require('./builder-live-preview-source-admission.cjs');
const {
  createBuilderSideWorkspaceFileContentProjection,
  createBuilderSideWorkspaceFileTreeProjection,
} = require('./builder-side-workspace-file-projection.cjs');

const BUILDER_SIDE_WORKSPACE_FILE_MAIN_SERVICE_VERSION =
  'builder-side-workspace-file-main-service.v1';
const OPTION_KEYS = Object.freeze(['current_draft_source_service']);
const REQUEST_KEYS = Object.freeze(['project_id', 'conversation_id']);
const CONTENT_REQUEST_KEYS = Object.freeze(['project_id', 'conversation_id', 'file_ref']);
const SOURCE_RESULT_KEYS = Object.freeze([
  'result_version',
  'service_version',
  'operation',
  'draft_id',
  'project_id',
  'conversation_id',
  'source_admission',
]);
const FILE_REF_KEYS = Object.freeze([
  'file_ref_version',
  'source_tree_digest',
  'path',
  'content_digest',
]);
const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONVERSATION_ID_PATTERN =
  /^builder-conversation:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const FILE_REF_VERSION = 'builder-side-workspace-file-ref.v1';
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

class BuilderSideWorkspaceFileMainServiceError extends Error {
  constructor() {
    super('Side workspace files are unavailable.');
    this.name = 'BuilderSideWorkspaceFileMainServiceError';
    this.code = 'builder_side_workspace_file_unavailable';
    this.retryable = true;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderSideWorkspaceFileMainServiceError();
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
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

function safeProjectId(value) {
  return safePattern(value, PROJECT_ID_PATTERN);
}

function safeConversationId(value, projectId) {
  const conversationId = safePattern(value, CONVERSATION_ID_PATTERN);
  if (conversationId.slice('builder-conversation:'.length) !== projectId.slice('builder-project:'.length)) {
    fail();
  }
  return conversationId;
}

function safeRequest(rawRequest) {
  const descriptors = exactObject(rawRequest, REQUEST_KEYS);
  const projectId = safeProjectId(descriptors.project_id.value);
  return freezeDeep({
    project_id: projectId,
    conversation_id: safeConversationId(descriptors.conversation_id.value, projectId),
  });
}

function safeContentRequest(rawRequest) {
  const descriptors = exactObject(rawRequest, CONTENT_REQUEST_KEYS);
  const projectId = safeProjectId(descriptors.project_id.value);
  return freezeDeep({
    project_id: projectId,
    conversation_id: safeConversationId(descriptors.conversation_id.value, projectId),
    file_ref: safeFileRef(descriptors.file_ref.value),
  });
}

function safeFilePath(value) {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 240
    || value.trim() !== value
    || value.startsWith('/')
    || value.endsWith('/')
    || value.includes('\\')
    || value.includes('..')
    || /[<>:"|?*\0]/u.test(value)
  ) fail();
  return value;
}

function safeFileRef(value) {
  const descriptors = exactObject(value, FILE_REF_KEYS);
  if (descriptors.file_ref_version.value !== FILE_REF_VERSION) fail();
  return freezeDeep({
    file_ref_version: FILE_REF_VERSION,
    source_tree_digest: safePattern(descriptors.source_tree_digest.value, DIGEST_PATTERN),
    path: safeFilePath(descriptors.path.value),
    content_digest: safePattern(descriptors.content_digest.value, DIGEST_PATTERN),
  });
}

function ownMethod(value, methodKey) {
  if (!isPlainObject(value)) fail();
  const descriptor = Object.getOwnPropertyDescriptor(value, methodKey);
  if (
    !descriptor
    || !Object.hasOwn(descriptor, 'value')
    || typeof descriptor.value !== 'function'
    || utilTypes.isProxy(descriptor.value)
  ) fail();
  return descriptor.value.bind(value);
}

function sanitizeSourceResult(rawValue, request) {
  const descriptors = exactObject(rawValue, SOURCE_RESULT_KEYS);
  if (
    descriptors.result_version.value !== BUILDER_LIVE_PREVIEW_CURRENT_DRAFT_SOURCE_RESULT_VERSION
    || descriptors.service_version.value !== BUILDER_LIVE_PREVIEW_CURRENT_DRAFT_SOURCE_SERVICE_VERSION
    || descriptors.operation.value !== 'current_draft_live_preview_source_admitted'
    || descriptors.project_id.value !== request.project_id
    || descriptors.conversation_id.value !== request.conversation_id
  ) fail();
  return sanitizeBuilderLivePreviewSourceAdmission(descriptors.source_admission.value);
}

function rootLabel(sourceAdmission) {
  if (sourceAdmission.source_ref.source_ref_kind !== 'current_draft_checkpoint_candidate') return 'Current files';
  return `Current draft ${sourceAdmission.source_ref.checkpoint_sequence}`;
}

function treeProjectionFromAdmission(sourceAdmission, selectedPath = null) {
  return createBuilderSideWorkspaceFileTreeProjection({
    project_id: sourceAdmission.project_id,
    conversation_id: sourceAdmission.conversation_id,
    source_kind: sourceAdmission.source_kind,
    root_label: rootLabel(sourceAdmission),
    source_tree: sourceAdmission.source_tree,
    source_ref: sourceAdmission.source_ref,
    selected_path: selectedPath,
  });
}

function createBuilderSideWorkspaceFileMainService(rawOptions) {
  const options = exactObject(rawOptions, OPTION_KEYS);
  const sourceService = options.current_draft_source_service.value;
  if (
    !isPlainObject(sourceService)
    || sourceService.service_version !== BUILDER_LIVE_PREVIEW_CURRENT_DRAFT_SOURCE_SERVICE_VERSION
  ) fail();
  const resolveCurrentDraft = ownMethod(sourceService, 'resolve_current_draft_preview_source');

  async function resolveAdmission(request) {
    const sourceResult = await resolveCurrentDraft({
      project_id: request.project_id,
      conversation_id: request.conversation_id,
    });
    const sourceAdmission = sanitizeSourceResult(sourceResult, request);
    if (sourceAdmission.source_kind !== 'current_draft') fail();
    return sourceAdmission;
  }

  return freezeDeep({
    service_version: BUILDER_SIDE_WORKSPACE_FILE_MAIN_SERVICE_VERSION,

    async read_current_draft_file_tree(rawRequest) {
      try {
        const request = safeRequest(rawRequest);
        const sourceAdmission = await resolveAdmission(request);
        return treeProjectionFromAdmission(sourceAdmission);
      } catch (error) {
        if (error instanceof BuilderSideWorkspaceFileMainServiceError) throw error;
        fail();
      }
    },

    async read_current_draft_file_content(rawRequest) {
      try {
        const request = safeContentRequest(rawRequest);
        const sourceAdmission = await resolveAdmission(request);
        const treeProjection = treeProjectionFromAdmission(sourceAdmission, request.file_ref.path);
        return createBuilderSideWorkspaceFileContentProjection({
          file_tree_projection: treeProjection,
          source_tree: sourceAdmission.source_tree,
          file_ref: request.file_ref,
        });
      } catch (error) {
        if (error instanceof BuilderSideWorkspaceFileMainServiceError) throw error;
        fail();
      }
    },
  });
}

module.exports = freezeDeep({
  BUILDER_SIDE_WORKSPACE_FILE_MAIN_SERVICE_VERSION,
  BuilderSideWorkspaceFileMainServiceError,
  createBuilderSideWorkspaceFileMainService,
});
