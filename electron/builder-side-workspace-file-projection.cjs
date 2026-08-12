'use strict';

const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');

const BUILDER_SIDE_WORKSPACE_FILE_TREE_PROJECTION_VERSION =
  'builder-side-workspace-file-tree.v1';
const BUILDER_SIDE_WORKSPACE_FILE_CONTENT_PROJECTION_VERSION =
  'builder-side-workspace-file-content.v1';
const BUILDER_SIDE_WORKSPACE_FILE_REF_VERSION =
  'builder-side-workspace-file-ref.v1';

const TREE_INPUT_KEYS = Object.freeze([
  'project_id',
  'conversation_id',
  'source_kind',
  'root_label',
  'source_tree',
  'source_ref',
  'selected_path',
]);
const CONTENT_INPUT_KEYS = Object.freeze([
  'file_tree_projection',
  'source_tree',
  'file_ref',
]);
const SOURCE_KINDS = Object.freeze([
  'current_draft',
  'saved_revision',
  'inspected_revision',
]);
const TREE_PROJECTION_KEYS = Object.freeze([
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
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const TEXT_PREVIEW_MAX_CHARS = 96 * 1_024;

const AUTHORITY = Object.freeze({
  file_projection_authority: 'main_owned_side_workspace_file_projection_v1',
  renderer_source_tree: 'not_accepted',
  renderer_path_authority: 'main_issued_file_ref_only',
  source_read: 'main_owned_verified_source_tree_only',
  source_write: 'not_performed',
  git_write: 'not_performed',
  sqlite_write: 'not_performed',
  provider_dispatch: false,
  tool_dispatch: false,
  command_execution: false,
  electron_view_attachment: false,
  ipc_registration: false,
  revision_admission: false,
  save_admission: false,
  permission_grant: false,
});

class BuilderSideWorkspaceFileProjectionError extends Error {
  constructor() {
    super('Side workspace file projection could not be verified.');
    this.name = 'BuilderSideWorkspaceFileProjectionError';
    this.code = 'builder_side_workspace_file_projection_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderSideWorkspaceFileProjectionError();
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

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function safeProjectId(value) {
  if (typeof value !== 'string' || !PROJECT_ID_PATTERN.test(value)) fail();
  return value;
}

function safeConversationId(value) {
  if (typeof value !== 'string' || !CONVERSATION_ID_PATTERN.test(value)) fail();
  return value;
}

function safeDigest(value) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) fail();
  return value;
}

function safeSourceKind(value) {
  if (!SOURCE_KINDS.includes(value)) fail();
  return value;
}

function safeRootLabel(value) {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 80
    || Array.from(value).some((character) => {
      const code = character.codePointAt(0);
      return code !== undefined && ((code >= 0 && code <= 0x1f) || (code >= 0x7f && code <= 0x9f));
    })
  ) fail();
  return value;
}

function safeSelectedPath(value, filesByPath) {
  if (value === null) return null;
  if (typeof value !== 'string' || !filesByPath.has(value)) fail();
  return value;
}

function safeSourceRef(value) {
  if (!isPlainObject(value)) fail();
  const forbiddenKeys = new Set(['content', 'files', 'path', 'source_tree', 'source_tree_body', 'text_preview']);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || forbiddenKeys.has(key)) fail();
    const nested = valueAt(value, key);
    if (Array.isArray(nested) || utilTypes.isProxy(nested)) fail();
    if (isPlainObject(nested)) {
      for (const nestedKey of Reflect.ownKeys(nested)) {
        if (typeof nestedKey !== 'string' || forbiddenKeys.has(nestedKey)) fail();
      }
    }
  }
  return freezeDeep({ ...value });
}

function fileName(path) {
  const parts = path.split('/');
  return parts[parts.length - 1];
}

function directoryEntries(files) {
  const directories = new Map();
  for (const file of files) {
    const parts = file.path.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      const path = parts.slice(0, index).join('/');
      const parentPath = index === 1 ? null : parts.slice(0, index - 1).join('/');
      const current = directories.get(path) ?? {
        entry_kind: 'directory',
        path,
        name: parts[index - 1],
        parent_path: parentPath,
        depth: index - 1,
        child_count: 0,
      };
      current.child_count += index === parts.length - 1 ? 1 : 0;
      directories.set(path, current);
    }
  }
  return [...directories.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function fileRef(sourceTreeDigest, file) {
  return freezeDeep({
    file_ref_version: BUILDER_SIDE_WORKSPACE_FILE_REF_VERSION,
    source_tree_digest: sourceTreeDigest,
    path: file.path,
    content_digest: file.content_digest,
  });
}

function sanitizeFileRef(value, sourceTreeDigest) {
  const descriptors = exactObject(value, FILE_REF_KEYS);
  const safe = freezeDeep({
    file_ref_version: valueAt(value, 'file_ref_version'),
    source_tree_digest: safeDigest(valueAt(value, 'source_tree_digest')),
    path: valueAt(value, 'path'),
    content_digest: safeDigest(valueAt(value, 'content_digest')),
  });
  if (
    safe.file_ref_version !== BUILDER_SIDE_WORKSPACE_FILE_REF_VERSION
    || safe.source_tree_digest !== sourceTreeDigest
    || descriptors.path.value !== safe.path
  ) fail();
  return safe;
}

function authority() {
  return AUTHORITY;
}

function createBuilderSideWorkspaceFileTreeProjection(rawInput) {
  const input = exactObject(rawInput, TREE_INPUT_KEYS);
  const projectId = safeProjectId(valueAt(rawInput, 'project_id'));
  const conversationId = safeConversationId(valueAt(rawInput, 'conversation_id'));
  if (conversationId.slice('builder-conversation:'.length) !== projectId.slice('builder-project:'.length)) {
    fail();
  }
  const sourceKind = safeSourceKind(valueAt(rawInput, 'source_kind'));
  const rootLabel = safeRootLabel(valueAt(rawInput, 'root_label'));
  const sourceTree = sanitizeBuilderProjectSourceTree(valueAt(rawInput, 'source_tree'));
  const filesByPath = new Map(sourceTree.files.map((file) => [file.path, file]));
  const selectedPath = safeSelectedPath(input.selected_path.value, filesByPath);
  const sourceRef = safeSourceRef(valueAt(rawInput, 'source_ref'));
  const fileEntries = sourceTree.files.map((file) => freezeDeep({
    entry_kind: 'text_file',
    path: file.path,
    name: fileName(file.path),
    parent_path: file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : null,
    depth: file.path.split('/').length - 1,
    content_digest: file.content_digest,
    file_ref: fileRef(sourceTree.source_tree_digest, file),
  }));
  const entries = [
    ...directoryEntries(sourceTree.files),
    ...fileEntries,
  ].sort((left, right) => left.path.localeCompare(right.path));
  const selectedFileRef = selectedPath === null
    ? null
    : fileRef(sourceTree.source_tree_digest, filesByPath.get(selectedPath));
  return freezeDeep({
    projection_version: BUILDER_SIDE_WORKSPACE_FILE_TREE_PROJECTION_VERSION,
    project_id: projectId,
    conversation_id: conversationId,
    source_kind: sourceKind,
    root_label: rootLabel,
    source_tree_digest: sourceTree.source_tree_digest,
    entries,
    selected_file_ref: selectedFileRef,
    source_ref: sourceRef,
    authority: authority(),
  });
}

function sanitizeTreeProjection(value) {
  exactObject(value, TREE_PROJECTION_KEYS);
  if (valueAt(value, 'projection_version') !== BUILDER_SIDE_WORKSPACE_FILE_TREE_PROJECTION_VERSION) fail();
  return freezeDeep({
    projection_version: BUILDER_SIDE_WORKSPACE_FILE_TREE_PROJECTION_VERSION,
    project_id: safeProjectId(valueAt(value, 'project_id')),
    conversation_id: safeConversationId(valueAt(value, 'conversation_id')),
    source_kind: safeSourceKind(valueAt(value, 'source_kind')),
    root_label: safeRootLabel(valueAt(value, 'root_label')),
    source_tree_digest: safeDigest(valueAt(value, 'source_tree_digest')),
    entries: valueAt(value, 'entries'),
    selected_file_ref: valueAt(value, 'selected_file_ref'),
    source_ref: safeSourceRef(valueAt(value, 'source_ref')),
    authority: valueAt(value, 'authority'),
  });
}

function languageHint(path) {
  const extension = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1).toLowerCase() : '';
  if (extension === 'js' || extension === 'jsx' || extension === 'mjs' || extension === 'cjs') return 'javascript';
  if (extension === 'ts' || extension === 'tsx') return 'typescript';
  if (extension === 'html' || extension === 'htm') return 'html';
  if (extension === 'css') return 'css';
  if (extension === 'json') return 'json';
  if (extension === 'md' || extension === 'markdown') return 'markdown';
  if (extension === 'py') return 'python';
  return 'text';
}

function contentPreview(content) {
  if (content.length <= TEXT_PREVIEW_MAX_CHARS) {
    return { status: 'ready', text: content };
  }
  return {
    status: 'truncated',
    text: content.slice(0, TEXT_PREVIEW_MAX_CHARS),
  };
}

function createBuilderSideWorkspaceFileContentProjection(rawInput) {
  exactObject(rawInput, CONTENT_INPUT_KEYS);
  const treeProjection = sanitizeTreeProjection(valueAt(rawInput, 'file_tree_projection'));
  const sourceTree = sanitizeBuilderProjectSourceTree(valueAt(rawInput, 'source_tree'));
  if (sourceTree.source_tree_digest !== treeProjection.source_tree_digest) fail();
  const ref = sanitizeFileRef(valueAt(rawInput, 'file_ref'), sourceTree.source_tree_digest);
  const file = sourceTree.files.find((entry) => (
    entry.path === ref.path
    && entry.content_digest === ref.content_digest
  ));
  if (!file) fail();
  const preview = contentPreview(file.content);
  return freezeDeep({
    projection_version: BUILDER_SIDE_WORKSPACE_FILE_CONTENT_PROJECTION_VERSION,
    project_id: treeProjection.project_id,
    conversation_id: treeProjection.conversation_id,
    source_kind: treeProjection.source_kind,
    source_tree_digest: sourceTree.source_tree_digest,
    file_ref: ref,
    path: file.path,
    language_hint: languageHint(file.path),
    content_status: preview.status,
    text_preview: preview.text,
    binary_summary: null,
    authority: authority(),
  });
}

module.exports = freezeDeep({
  BUILDER_SIDE_WORKSPACE_FILE_TREE_PROJECTION_VERSION,
  BUILDER_SIDE_WORKSPACE_FILE_CONTENT_PROJECTION_VERSION,
  BUILDER_SIDE_WORKSPACE_FILE_REF_VERSION,
  BuilderSideWorkspaceFileProjectionError,
  createBuilderSideWorkspaceFileTreeProjection,
  createBuilderSideWorkspaceFileContentProjection,
});
