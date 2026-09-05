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
  sanitizeBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');
const {
  createBuilderSideWorkspaceFileContentProjection,
  createBuilderSideWorkspaceFileTreeProjection,
} = require('./builder-side-workspace-file-projection.cjs');

const BUILDER_SIDE_WORKSPACE_FILE_MAIN_SERVICE_VERSION =
  'builder-side-workspace-file-main-service.v1';
const OPTION_KEYS = Object.freeze([
  'current_draft_source_service',
  'runtime_snapshot_source_service',
]);
const REQUEST_KEYS = Object.freeze(['project_id', 'conversation_id']);
const CONTENT_REQUEST_KEYS = Object.freeze(['project_id', 'conversation_id', 'file_ref']);
const RUNTIME_TOOL_REQUEST_KEYS = Object.freeze([
  'project_id', 'conversation_id', 'run_id', 'tool_call_id',
]);
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
  'source_kind',
  'source_tree_digest',
  'path',
  'content_digest',
]);
const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONVERSATION_ID_PATTERN =
  /^builder-conversation:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RUN_ID_PATTERN =
  /^builder-run:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TOOL_CALL_ID_PATTERN =
  /^builder-tool-call:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const FILE_REF_VERSION = 'builder-side-workspace-file-ref.v1';
const RUNTIME_WORKSPACE_SOURCE_SERVICE_VERSION =
  'builder-runtime-workspace-source-service.v1';
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ADMISSION_CACHE_LIMIT = 8;

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
  if (!conversationId.startsWith(
    `builder-conversation:${projectId.slice('builder-project:'.length)}:`,
  )) {
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

function safeRuntimeToolRequest(rawRequest) {
  const descriptors = exactObject(rawRequest, RUNTIME_TOOL_REQUEST_KEYS);
  const projectId = safeProjectId(descriptors.project_id.value);
  return freezeDeep({
    project_id: projectId,
    conversation_id: safeConversationId(descriptors.conversation_id.value, projectId),
    run_id: safePattern(descriptors.run_id.value, RUN_ID_PATTERN),
    tool_call_id: safePattern(descriptors.tool_call_id.value, TOOL_CALL_ID_PATTERN),
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
    source_kind: safePattern(
      descriptors.source_kind.value,
      /^(?:current_draft|saved_revision|inspected_revision|runtime_snapshot)$/u,
    ),
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
  const operation = descriptors.operation.value;
  if (
    descriptors.result_version.value !== BUILDER_LIVE_PREVIEW_CURRENT_DRAFT_SOURCE_RESULT_VERSION
    || descriptors.service_version.value !== BUILDER_LIVE_PREVIEW_CURRENT_DRAFT_SOURCE_SERVICE_VERSION
    || (
      operation !== 'current_draft_live_preview_source_admitted'
      && operation !== 'saved_revision_live_preview_source_admitted'
    )
    || descriptors.project_id.value !== request.project_id
    || descriptors.conversation_id.value !== request.conversation_id
  ) fail();
  const sourceAdmission = sanitizeBuilderLivePreviewSourceAdmission(descriptors.source_admission.value);
  if (
    (operation === 'current_draft_live_preview_source_admitted'
      && sourceAdmission.source_kind !== 'current_draft')
    || (operation === 'saved_revision_live_preview_source_admitted'
      && sourceAdmission.source_kind !== 'saved_revision')
  ) fail();
  return sourceAdmission;
}

function rootLabel(sourceAdmission) {
  if (sourceAdmission.source_ref.source_ref_kind === 'saved_project_revision') {
    return `Saved revision ${sourceAdmission.source_ref.revision_number}`;
  }
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
  const runtimeSourceService = options.runtime_snapshot_source_service.value;
  if (
    !isPlainObject(runtimeSourceService)
    || runtimeSourceService.service_version !== RUNTIME_WORKSPACE_SOURCE_SERVICE_VERSION
  ) fail();
  const resolveRuntimeToolSource = ownMethod(runtimeSourceService, 'resolve_runtime_tool_source');
  const resolveRuntimeSnapshotSource = ownMethod(runtimeSourceService, 'resolve_runtime_snapshot_source');
  const admissionCache = new Map();

  function admissionCacheKey(request, sourceTreeDigest) {
    return `${request.project_id}:${request.conversation_id}:${sourceTreeDigest}`;
  }

  function rememberAdmission(request, sourceAdmission) {
    const key = admissionCacheKey(request, sourceAdmission.source_tree.source_tree_digest);
    admissionCache.delete(key);
    admissionCache.set(key, sourceAdmission);
    while (admissionCache.size > ADMISSION_CACHE_LIMIT) {
      admissionCache.delete(admissionCache.keys().next().value);
    }
  }

  async function resolveAdmission(request, expectedSourceTreeDigest = null) {
    if (expectedSourceTreeDigest !== null) {
      const cached = admissionCache.get(admissionCacheKey(request, expectedSourceTreeDigest));
      if (cached !== undefined) return cached;
    }
    const sourceResult = await resolveCurrentDraft({
      project_id: request.project_id,
      conversation_id: request.conversation_id,
    });
    const sourceAdmission = sanitizeSourceResult(sourceResult, request);
    if (
      expectedSourceTreeDigest !== null
      && sourceAdmission.source_tree.source_tree_digest !== expectedSourceTreeDigest
    ) fail();
    rememberAdmission(request, sourceAdmission);
    return sourceAdmission;
  }

  function runtimeSourceRecord(rawValue, request, expectedDigest = null) {
    if (!isPlainObject(rawValue)) fail();
    const projectId = safeProjectId(rawValue.project_id);
    const conversationId = safeConversationId(rawValue.conversation_id, projectId);
    if (projectId !== request.project_id || conversationId !== request.conversation_id) fail();
    const sourceTree = sanitizeBuilderProjectSourceTree(rawValue.source_tree);
    if (expectedDigest !== null && sourceTree.source_tree_digest !== expectedDigest) fail();
    const runId = safePattern(rawValue.run_id, RUN_ID_PATTERN);
    return freezeDeep({
      project_id: projectId,
      conversation_id: conversationId,
      source_kind: 'runtime_snapshot',
      root_label: 'Run files',
      source_tree: sourceTree,
      source_ref: {
        source_ref_kind: 'runtime_workspace_snapshot',
        run_id: runId,
      },
    });
  }

  function treeProjectionFromRuntime(record, selectedPath) {
    return createBuilderSideWorkspaceFileTreeProjection({
      project_id: record.project_id,
      conversation_id: record.conversation_id,
      source_kind: record.source_kind,
      root_label: record.root_label,
      source_tree: record.source_tree,
      source_ref: record.source_ref,
      selected_path: selectedPath,
    });
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
        let sourceTree;
        let treeProjection;
        if (
          request.file_ref.source_kind === 'current_draft'
          || request.file_ref.source_kind === 'saved_revision'
        ) {
          const sourceAdmission = await resolveAdmission(request, request.file_ref.source_tree_digest);
          sourceTree = sourceAdmission.source_tree;
          treeProjection = treeProjectionFromAdmission(sourceAdmission, request.file_ref.path);
        } else if (request.file_ref.source_kind === 'runtime_snapshot') {
          const runtimeRecord = runtimeSourceRecord(await resolveRuntimeSnapshotSource({
            project_id: request.project_id,
            conversation_id: request.conversation_id,
            source_tree_digest: request.file_ref.source_tree_digest,
          }), request, request.file_ref.source_tree_digest);
          sourceTree = runtimeRecord.source_tree;
          treeProjection = treeProjectionFromRuntime(runtimeRecord, request.file_ref.path);
        } else {
          fail();
        }
        return createBuilderSideWorkspaceFileContentProjection({
          file_tree_projection: treeProjection,
          source_tree: sourceTree,
          file_ref: request.file_ref,
        });
      } catch (error) {
        if (error instanceof BuilderSideWorkspaceFileMainServiceError) throw error;
        fail();
      }
    },

    async read_runtime_tool_file_tree(rawRequest) {
      try {
        const request = safeRuntimeToolRequest(rawRequest);
        const rawRecord = await resolveRuntimeToolSource(request);
        const runtimeRecord = runtimeSourceRecord(rawRecord, request);
        const selectedPath = safeFilePath(rawRecord.selected_path);
        if (!runtimeRecord.source_tree.files.some((file) => file.path === selectedPath)) fail();
        return treeProjectionFromRuntime(runtimeRecord, selectedPath);
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
