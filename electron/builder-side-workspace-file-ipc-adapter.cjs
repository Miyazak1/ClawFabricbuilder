'use strict';

const { types: utilTypes } = require('node:util');

const READ_CURRENT_DRAFT_FILE_TREE_CHANNEL =
  'clawfabric-builder:side-workspace-files:read-current-draft-tree';
const READ_CURRENT_DRAFT_FILE_CONTENT_CHANNEL =
  'clawfabric-builder:side-workspace-files:read-current-draft-content';

const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONVERSATION_ID_PATTERN =
  /^builder-conversation:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const READ_REQUEST_KEYS = Object.freeze(['project_id', 'conversation_id']);
const CONTENT_REQUEST_KEYS = Object.freeze(['project_id', 'conversation_id', 'file_ref']);
const FILE_REF_KEYS = Object.freeze([
  'file_ref_version',
  'source_tree_digest',
  'path',
  'content_digest',
]);
const OPTION_KEYS = Object.freeze([
  'readCurrentDraftFileTree',
  'readCurrentDraftFileContent',
  'mainWindowRef',
]);
const TREE_KEYS = Object.freeze([
  'projection_version',
  'project_id',
  'conversation_id',
  'source_kind',
  'root_label',
  'source_tree_digest',
  'entries',
  'selected_file_ref',
  'source_ref',
  'authority',
]);
const CONTENT_KEYS = Object.freeze([
  'projection_version',
  'project_id',
  'conversation_id',
  'source_kind',
  'source_tree_digest',
  'file_ref',
  'path',
  'language_hint',
  'content_status',
  'text_preview',
  'binary_summary',
  'authority',
]);
const DIRECTORY_ENTRY_KEYS = Object.freeze([
  'entry_kind',
  'path',
  'name',
  'parent_path',
  'depth',
  'child_count',
]);
const FILE_ENTRY_KEYS = Object.freeze([
  'entry_kind',
  'path',
  'name',
  'parent_path',
  'depth',
  'content_digest',
  'file_ref',
]);
const AUTHORITY_KEYS = Object.freeze([
  'file_projection_authority',
  'renderer_source_tree',
  'renderer_path_authority',
  'source_read',
  'source_write',
  'git_write',
  'sqlite_write',
  'provider_dispatch',
  'tool_dispatch',
  'command_execution',
  'electron_view_attachment',
  'ipc_registration',
  'revision_admission',
  'save_admission',
  'permission_grant',
]);
const SOURCE_KINDS = Object.freeze(['current_draft', 'saved_revision', 'inspected_revision']);
const LANGUAGES = Object.freeze([
  'javascript',
  'typescript',
  'html',
  'css',
  'json',
  'markdown',
  'python',
  'text',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_side_workspace_file_forbidden: 'Files are unavailable.',
  builder_side_workspace_file_invalid: 'The file request could not be verified.',
  builder_side_workspace_file_unavailable: 'Files are unavailable.',
});

class BuilderSideWorkspaceFileIpcError extends Error {
  constructor(code = 'builder_side_workspace_file_unavailable') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_side_workspace_file_unavailable';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderSideWorkspaceFileIpcError';
    this.code = selected;
    this.retryable = selected === 'builder_side_workspace_file_unavailable';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function ipcError(code) {
  return new BuilderSideWorkspaceFileIpcError(code);
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

function exactObject(value, keys, code = 'builder_side_workspace_file_invalid') {
  if (!isPlainObject(value)) throw ipcError(code);
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length
    || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) throw ipcError(code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      throw ipcError(code);
    }
  }
  return descriptors;
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    throw ipcError();
  }
  return descriptor.value;
}

function stableMethod(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (
    !descriptor
    || descriptor.enumerable !== true
    || !Object.hasOwn(descriptor, 'value')
    || typeof descriptor.value !== 'function'
    || utilTypes.isProxy(descriptor.value)
  ) throw ipcError();
  return descriptor.value;
}

function safeOptions(value) {
  try {
    exactObject(value, OPTION_KEYS, 'builder_side_workspace_file_unavailable');
    return Object.freeze({
      readCurrentDraftFileTree: stableMethod(value, 'readCurrentDraftFileTree'),
      readCurrentDraftFileContent: stableMethod(value, 'readCurrentDraftFileContent'),
      mainWindowRef: stableMethod(value, 'mainWindowRef'),
    });
  } catch {
    throw ipcError();
  }
}

function safeProjectId(value) {
  if (typeof value !== 'string' || !PROJECT_ID_PATTERN.test(value)) {
    throw ipcError('builder_side_workspace_file_invalid');
  }
  return value;
}

function safeConversationId(value, projectId) {
  if (
    typeof value !== 'string'
    || !CONVERSATION_ID_PATTERN.test(value)
    || value.slice('builder-conversation:'.length) !== projectId.slice('builder-project:'.length)
  ) throw ipcError('builder_side_workspace_file_invalid');
  return value;
}

function safeRequest(value) {
  const descriptors = exactObject(value, READ_REQUEST_KEYS);
  const projectId = safeProjectId(descriptors.project_id.value);
  return Object.freeze({
    project_id: projectId,
    conversation_id: safeConversationId(descriptors.conversation_id.value, projectId),
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
  ) throw ipcError('builder_side_workspace_file_invalid');
  return value;
}

function safeDigest(value) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) throw ipcError();
  return value;
}

function safeFileRef(value, sourceTreeDigest = null) {
  const descriptors = exactObject(value, FILE_REF_KEYS);
  const ref = Object.freeze({
    file_ref_version: descriptors.file_ref_version.value,
    source_tree_digest: safeDigest(descriptors.source_tree_digest.value),
    path: safeFilePath(descriptors.path.value),
    content_digest: safeDigest(descriptors.content_digest.value),
  });
  if (
    ref.file_ref_version !== 'builder-side-workspace-file-ref.v1'
    || (sourceTreeDigest !== null && ref.source_tree_digest !== sourceTreeDigest)
  ) throw ipcError();
  return ref;
}

function safeContentRequest(value) {
  const descriptors = exactObject(value, CONTENT_REQUEST_KEYS);
  const projectId = safeProjectId(descriptors.project_id.value);
  return Object.freeze({
    project_id: projectId,
    conversation_id: safeConversationId(descriptors.conversation_id.value, projectId),
    file_ref: safeFileRef(descriptors.file_ref.value),
  });
}

function safeString(value, max = 240) {
  if (
    typeof value !== 'string'
    || value.length > max
    || value.includes('\0')
  ) throw ipcError();
  return value;
}

function safeNullablePath(value) {
  if (value === null) return null;
  return safeFilePath(value);
}

function safeSourceRef(value) {
  if (!isPlainObject(value)) throw ipcError();
  const forbidden = new Set(['content', 'files', 'path', 'source_tree', 'source_tree_body', 'text_preview']);
  const output = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || forbidden.has(key)) throw ipcError();
    const nested = valueAt(value, key);
    if (Array.isArray(nested) || utilTypes.isProxy(nested)) throw ipcError();
    if (isPlainObject(nested)) {
      for (const nestedKey of Reflect.ownKeys(nested)) {
        if (typeof nestedKey !== 'string' || forbidden.has(nestedKey)) throw ipcError();
      }
    }
    output[key] = nested;
  }
  return Object.freeze(output);
}

function safeAuthority(value) {
  const descriptors = exactObject(value, AUTHORITY_KEYS, 'builder_side_workspace_file_unavailable');
  const authority = Object.freeze(Object.fromEntries(AUTHORITY_KEYS.map((key) => [
    key,
    descriptors[key].value,
  ])));
  if (
    authority.file_projection_authority !== 'main_owned_side_workspace_file_projection_v1'
    || authority.renderer_source_tree !== 'not_accepted'
    || authority.renderer_path_authority !== 'main_issued_file_ref_only'
    || authority.source_read !== 'main_owned_verified_source_tree_only'
    || authority.source_write !== 'not_performed'
    || authority.git_write !== 'not_performed'
    || authority.sqlite_write !== 'not_performed'
    || authority.provider_dispatch !== false
    || authority.tool_dispatch !== false
    || authority.command_execution !== false
    || authority.electron_view_attachment !== false
    || authority.ipc_registration !== false
    || authority.revision_admission !== false
    || authority.save_admission !== false
    || authority.permission_grant !== false
  ) throw ipcError();
  return authority;
}

function safeEntry(value, sourceTreeDigest) {
  if (!isPlainObject(value)) throw ipcError();
  const kind = valueAt(value, 'entry_kind');
  if (kind === 'directory') {
    const descriptors = exactObject(value, DIRECTORY_ENTRY_KEYS);
    const depth = descriptors.depth.value;
    const childCount = descriptors.child_count.value;
    if (
      !Number.isSafeInteger(depth)
      || depth < 0
      || !Number.isSafeInteger(childCount)
      || childCount < 0
    ) throw ipcError();
    return Object.freeze({
      entry_kind: 'directory',
      path: safeFilePath(descriptors.path.value),
      name: safeString(descriptors.name.value, 120),
      parent_path: safeNullablePath(descriptors.parent_path.value),
      depth,
      child_count: childCount,
    });
  }
  if (kind === 'text_file') {
    const descriptors = exactObject(value, FILE_ENTRY_KEYS);
    const depth = descriptors.depth.value;
    if (!Number.isSafeInteger(depth) || depth < 0) throw ipcError();
    const ref = safeFileRef(descriptors.file_ref.value, sourceTreeDigest);
    const path = safeFilePath(descriptors.path.value);
    if (ref.path !== path || ref.content_digest !== descriptors.content_digest.value) throw ipcError();
    return Object.freeze({
      entry_kind: 'text_file',
      path,
      name: safeString(descriptors.name.value, 120),
      parent_path: safeNullablePath(descriptors.parent_path.value),
      depth,
      content_digest: safeDigest(descriptors.content_digest.value),
      file_ref: ref,
    });
  }
  throw ipcError();
}

function safeTreeProjection(value, request) {
  const descriptors = exactObject(value, TREE_KEYS, 'builder_side_workspace_file_unavailable');
  const sourceTreeDigest = safeDigest(descriptors.source_tree_digest.value);
  if (
    descriptors.projection_version.value !== 'builder-side-workspace-file-tree.v1'
    || descriptors.project_id.value !== request.project_id
    || descriptors.conversation_id.value !== request.conversation_id
    || !SOURCE_KINDS.includes(descriptors.source_kind.value)
    || typeof descriptors.root_label.value !== 'string'
    || descriptors.root_label.value.length < 1
    || descriptors.root_label.value.length > 80
    || !Array.isArray(descriptors.entries.value)
    || descriptors.entries.value.length > 5_000
  ) throw ipcError();
  const entries = Object.freeze(descriptors.entries.value.map((entry) => safeEntry(entry, sourceTreeDigest)));
  const selectedFileRef = descriptors.selected_file_ref.value === null
    ? null
    : safeFileRef(descriptors.selected_file_ref.value, sourceTreeDigest);
  return Object.freeze({
    projection_version: 'builder-side-workspace-file-tree.v1',
    project_id: request.project_id,
    conversation_id: request.conversation_id,
    source_kind: descriptors.source_kind.value,
    root_label: descriptors.root_label.value,
    source_tree_digest: sourceTreeDigest,
    entries,
    selected_file_ref: selectedFileRef,
    source_ref: safeSourceRef(descriptors.source_ref.value),
    authority: safeAuthority(descriptors.authority.value),
  });
}

function safeContentProjection(value, request) {
  const descriptors = exactObject(value, CONTENT_KEYS, 'builder_side_workspace_file_unavailable');
  const sourceTreeDigest = safeDigest(descriptors.source_tree_digest.value);
  const fileRef = safeFileRef(descriptors.file_ref.value, sourceTreeDigest);
  const textPreview = descriptors.text_preview.value;
  if (
    descriptors.projection_version.value !== 'builder-side-workspace-file-content.v1'
    || descriptors.project_id.value !== request.project_id
    || descriptors.conversation_id.value !== request.conversation_id
    || !SOURCE_KINDS.includes(descriptors.source_kind.value)
    || descriptors.path.value !== fileRef.path
    || !LANGUAGES.includes(descriptors.language_hint.value)
    || !['ready', 'truncated'].includes(descriptors.content_status.value)
    || typeof textPreview !== 'string'
    || textPreview.length > 96 * 1_024
    || descriptors.binary_summary.value !== null
  ) throw ipcError();
  return Object.freeze({
    projection_version: 'builder-side-workspace-file-content.v1',
    project_id: request.project_id,
    conversation_id: request.conversation_id,
    source_kind: descriptors.source_kind.value,
    source_tree_digest: sourceTreeDigest,
    file_ref: fileRef,
    path: fileRef.path,
    language_hint: descriptors.language_hint.value,
    content_status: descriptors.content_status.value,
    text_preview: textPreview,
    binary_summary: null,
    authority: safeAuthority(descriptors.authority.value),
  });
}

function safeErrorCode(error) {
  try {
    if (
      error === null
      || (typeof error !== 'object' && typeof error !== 'function')
      || utilTypes.isProxy(error)
    ) return null;
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    return descriptor
      && Object.hasOwn(descriptor, 'value')
      && typeof descriptor.value === 'string'
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

function normalizeError(error) {
  const code = safeErrorCode(error);
  return ipcError(code !== null && Object.hasOwn(ERROR_MESSAGES, code)
    ? code
    : 'builder_side_workspace_file_unavailable');
}

function activeWebContents(mainWindowRef) {
  try {
    const windowRef = Reflect.apply(mainWindowRef, undefined, []);
    if (!windowRef || (typeof windowRef.isDestroyed === 'function' && windowRef.isDestroyed())) return null;
    const webContents = windowRef.webContents;
    if (!webContents || (typeof webContents.isDestroyed === 'function' && webContents.isDestroyed())) return null;
    return webContents;
  } catch {
    return null;
  }
}

function assertActiveSender(event, mainWindowRef) {
  if (!event || event.sender !== activeWebContents(mainWindowRef)) {
    throw ipcError('builder_side_workspace_file_forbidden');
  }
}

function createBuilderSideWorkspaceFileIpcAdapter(rawOptions) {
  const options = safeOptions(rawOptions);

  async function invokeTree(event, rawArguments) {
    try {
      assertActiveSender(event, options.mainWindowRef);
      if (rawArguments.length !== 1) throw ipcError('builder_side_workspace_file_invalid');
      const request = safeRequest(rawArguments[0]);
      return safeTreeProjection(await Reflect.apply(
        options.readCurrentDraftFileTree,
        undefined,
        [request],
      ), request);
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async function invokeContent(event, rawArguments) {
    try {
      assertActiveSender(event, options.mainWindowRef);
      if (rawArguments.length !== 1) throw ipcError('builder_side_workspace_file_invalid');
      const request = safeContentRequest(rawArguments[0]);
      return safeContentProjection(await Reflect.apply(
        options.readCurrentDraftFileContent,
        undefined,
        [request],
      ), request);
    } catch (error) {
      throw normalizeError(error);
    }
  }

  return Object.freeze({
    adapter_id: 'builder_side_workspace_files.controlled_ipc_adapter.v1',
    namespace: 'builderSideWorkspaceFiles',
    preload_namespace: 'window.clawfabricBuilder.sideWorkspaceFiles',
    channels: Object.freeze({
      readCurrentDraftFileTree: Object.freeze({
        channel: READ_CURRENT_DRAFT_FILE_TREE_CHANNEL,
        method: 'readCurrentDraftFileTree',
        invoke(event, ...rawArguments) {
          return invokeTree(event, rawArguments);
        },
      }),
      readCurrentDraftFileContent: Object.freeze({
        channel: READ_CURRENT_DRAFT_FILE_CONTENT_CHANNEL,
        method: 'readCurrentDraftFileContent',
        invoke(event, ...rawArguments) {
          return invokeContent(event, rawArguments);
        },
      }),
    }),
    exposed_methods: Object.freeze([
      'readCurrentDraftFileTree',
      'readCurrentDraftFileContent',
    ]),
    authority: Object.freeze({
      renderer_authority: 'current_project_conversation_and_main_issued_file_ref_only',
      active_renderer_required: true,
      source_tree_from_renderer: false,
      raw_path_from_renderer: false,
      provider_dispatch: false,
      tool_dispatch: false,
      command_execution: false,
      source_mutation: false,
      git_mutation: false,
      sqlite_write: false,
      permission_grant: false,
      revision_admission: false,
      save_admission: false,
      direct_electron_registration: false,
      direct_preload_exposure: false,
    }),
  });
}

module.exports = Object.freeze({
  READ_CURRENT_DRAFT_FILE_TREE_CHANNEL,
  READ_CURRENT_DRAFT_FILE_CONTENT_CHANNEL,
  BuilderSideWorkspaceFileIpcError,
  createBuilderSideWorkspaceFileIpcAdapter,
});
