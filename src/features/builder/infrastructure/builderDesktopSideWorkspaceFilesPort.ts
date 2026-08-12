import type {
  BuilderSideWorkspaceFileAuthority,
  BuilderSideWorkspaceFileContentProjection,
  BuilderSideWorkspaceFileContentRequest,
  BuilderSideWorkspaceFileRef,
  BuilderSideWorkspaceFilesPort,
  BuilderSideWorkspaceFileTreeEntry,
  BuilderSideWorkspaceFileTreeProjection,
  BuilderSideWorkspaceFileRequest,
} from '../application/builderPorts';

type BuilderSideWorkspaceFilesBridge = Readonly<{
  readCurrentDraftFileTree(request: unknown): Promise<unknown>;
  readCurrentDraftFileContent(request: unknown): Promise<unknown>;
}>;

const BRIDGE_KEYS = Object.freeze([
  'readCurrentDraftFileTree',
  'readCurrentDraftFileContent',
]);
const REQUEST_KEYS = Object.freeze(['project_id', 'conversation_id']);
const CONTENT_REQUEST_KEYS = Object.freeze(['project_id', 'conversation_id', 'file_ref']);
const FILE_REF_KEYS = Object.freeze([
  'file_ref_version',
  'source_tree_digest',
  'path',
  'content_digest',
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
const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONVERSATION_ID_PATTERN =
  /^builder-conversation:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
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

export class BuilderDesktopSideWorkspaceFilesPortError extends Error {
  readonly code = 'builder_side_workspace_files_unavailable';

  constructor() {
    super('Files are unavailable.');
    this.name = 'BuilderDesktopSideWorkspaceFilesPortError';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function unavailable(): BuilderDesktopSideWorkspaceFilesPortError {
  return new BuilderDesktopSideWorkspaceFilesPortError();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactRecord(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> {
  if (!isPlainObject(value)) throw unavailable();
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length
    || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) throw unavailable();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw unavailable();
    }
  }
  return Object.freeze(Object.fromEntries(keys.map((key) => [key, descriptors[key].value])));
}

function sanitizeBridge(value: unknown): BuilderSideWorkspaceFilesBridge {
  const source = exactRecord(value, BRIDGE_KEYS);
  if (
    typeof source.readCurrentDraftFileTree !== 'function'
    || typeof source.readCurrentDraftFileContent !== 'function'
  ) throw unavailable();
  return Object.freeze({
    readCurrentDraftFileTree: source.readCurrentDraftFileTree as (request: unknown) => Promise<unknown>,
    readCurrentDraftFileContent: source.readCurrentDraftFileContent as (request: unknown) => Promise<unknown>,
  });
}

function projectUuid(projectId: string): string {
  return projectId.slice('builder-project:'.length);
}

function safeProjectConversation(
  projectId: unknown,
  conversationId: unknown,
): Readonly<{ project_id: string; conversation_id: string }> {
  if (
    typeof projectId !== 'string'
    || !PROJECT_ID_PATTERN.test(projectId)
    || typeof conversationId !== 'string'
    || !CONVERSATION_ID_PATTERN.test(conversationId)
    || conversationId !== `builder-conversation:${projectUuid(projectId)}`
  ) throw unavailable();
  return Object.freeze({ project_id: projectId, conversation_id: conversationId });
}

function sanitizeRequest(request: BuilderSideWorkspaceFileRequest): BuilderSideWorkspaceFileRequest {
  const source = exactRecord(request, REQUEST_KEYS);
  return safeProjectConversation(source.project_id, source.conversation_id);
}

function safeDigest(value: unknown): string {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) throw unavailable();
  return value;
}

function safePath(value: unknown): string {
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
  ) throw unavailable();
  return value;
}

function sanitizeFileRef(value: unknown, sourceTreeDigest?: string): BuilderSideWorkspaceFileRef {
  const source = exactRecord(value, FILE_REF_KEYS);
  const safe = Object.freeze({
    file_ref_version: source.file_ref_version,
    source_tree_digest: safeDigest(source.source_tree_digest),
    path: safePath(source.path),
    content_digest: safeDigest(source.content_digest),
  });
  if (
    safe.file_ref_version !== 'builder-side-workspace-file-ref.v1'
    || (sourceTreeDigest !== undefined && safe.source_tree_digest !== sourceTreeDigest)
  ) throw unavailable();
  return safe as BuilderSideWorkspaceFileRef;
}

function sanitizeContentRequest(
  request: BuilderSideWorkspaceFileContentRequest,
): BuilderSideWorkspaceFileContentRequest {
  const source = exactRecord(request, CONTENT_REQUEST_KEYS);
  const ids = safeProjectConversation(source.project_id, source.conversation_id);
  return Object.freeze({
    ...ids,
    file_ref: sanitizeFileRef(source.file_ref),
  });
}

function sanitizeAuthority(value: unknown): BuilderSideWorkspaceFileAuthority {
  const source = exactRecord(value, AUTHORITY_KEYS);
  if (
    source.file_projection_authority !== 'main_owned_side_workspace_file_projection_v1'
    || source.renderer_source_tree !== 'not_accepted'
    || source.renderer_path_authority !== 'main_issued_file_ref_only'
    || source.source_read !== 'main_owned_verified_source_tree_only'
    || source.source_write !== 'not_performed'
    || source.git_write !== 'not_performed'
    || source.sqlite_write !== 'not_performed'
    || source.provider_dispatch !== false
    || source.tool_dispatch !== false
    || source.command_execution !== false
    || source.electron_view_attachment !== false
    || source.ipc_registration !== false
    || source.revision_admission !== false
    || source.save_admission !== false
    || source.permission_grant !== false
  ) throw unavailable();
  return Object.freeze(source) as BuilderSideWorkspaceFileAuthority;
}

function nullablePath(value: unknown): string | null {
  if (value === null) return null;
  return safePath(value);
}

function safeSourceRef(value: unknown): Readonly<Record<string, unknown>> {
  if (!isPlainObject(value)) throw unavailable();
  const forbidden = new Set(['content', 'files', 'path', 'source_tree', 'source_tree_body', 'text_preview']);
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || forbidden.has(key)) throw unavailable();
    const nested = value[key];
    if (Array.isArray(nested)) throw unavailable();
    if (isPlainObject(nested)) {
      for (const nestedKey of Reflect.ownKeys(nested)) {
        if (typeof nestedKey !== 'string' || forbidden.has(nestedKey)) throw unavailable();
      }
    }
    result[key] = nested;
  }
  return Object.freeze(result);
}

function sanitizeEntry(value: unknown, sourceTreeDigest: string): BuilderSideWorkspaceFileTreeEntry {
  if (!isPlainObject(value)) throw unavailable();
  const kind = value.entry_kind;
  if (kind === 'directory') {
    const source = exactRecord(value, DIRECTORY_ENTRY_KEYS);
    if (
      typeof source.depth !== 'number'
      || !Number.isSafeInteger(source.depth)
      || source.depth < 0
      || typeof source.child_count !== 'number'
      || !Number.isSafeInteger(source.child_count)
      || source.child_count < 0
    ) throw unavailable();
    return Object.freeze({
      entry_kind: 'directory',
      path: safePath(source.path),
      name: safePath(source.name),
      parent_path: nullablePath(source.parent_path),
      depth: source.depth,
      child_count: source.child_count,
    });
  }
  if (kind === 'text_file') {
    const source = exactRecord(value, FILE_ENTRY_KEYS);
    if (
      typeof source.depth !== 'number'
      || !Number.isSafeInteger(source.depth)
      || source.depth < 0
    ) throw unavailable();
    const fileRef = sanitizeFileRef(source.file_ref, sourceTreeDigest);
    const path = safePath(source.path);
    const contentDigest = safeDigest(source.content_digest);
    if (fileRef.path !== path || fileRef.content_digest !== contentDigest) throw unavailable();
    return Object.freeze({
      entry_kind: 'text_file',
      path,
      name: safePath(source.name),
      parent_path: nullablePath(source.parent_path),
      depth: source.depth,
      content_digest: contentDigest,
      file_ref: fileRef,
    });
  }
  throw unavailable();
}

function sanitizeTreeProjection(
  value: unknown,
  request: BuilderSideWorkspaceFileRequest,
): BuilderSideWorkspaceFileTreeProjection {
  const source = exactRecord(value, TREE_KEYS);
  const digest = safeDigest(source.source_tree_digest);
  if (
    source.projection_version !== 'builder-side-workspace-file-tree.v1'
    || source.project_id !== request.project_id
    || source.conversation_id !== request.conversation_id
    || typeof source.source_kind !== 'string'
    || !SOURCE_KINDS.includes(source.source_kind)
    || typeof source.root_label !== 'string'
    || source.root_label.length < 1
    || source.root_label.length > 80
    || !Array.isArray(source.entries)
    || source.entries.length > 5_000
  ) throw unavailable();
  return Object.freeze({
    projection_version: 'builder-side-workspace-file-tree.v1',
    project_id: request.project_id,
    conversation_id: request.conversation_id,
    source_kind: source.source_kind as BuilderSideWorkspaceFileTreeProjection['source_kind'],
    root_label: source.root_label,
    source_tree_digest: digest,
    entries: Object.freeze(source.entries.map((entry) => sanitizeEntry(entry, digest))),
    selected_file_ref: source.selected_file_ref === null ? null : sanitizeFileRef(source.selected_file_ref, digest),
    source_ref: safeSourceRef(source.source_ref),
    authority: sanitizeAuthority(source.authority),
  });
}

function sanitizeContentProjection(
  value: unknown,
  request: BuilderSideWorkspaceFileContentRequest,
): BuilderSideWorkspaceFileContentProjection {
  const source = exactRecord(value, CONTENT_KEYS);
  const digest = safeDigest(source.source_tree_digest);
  const fileRef = sanitizeFileRef(source.file_ref, digest);
  if (
    source.projection_version !== 'builder-side-workspace-file-content.v1'
    || source.project_id !== request.project_id
    || source.conversation_id !== request.conversation_id
    || typeof source.source_kind !== 'string'
    || !SOURCE_KINDS.includes(source.source_kind)
    || source.path !== fileRef.path
    || typeof source.language_hint !== 'string'
    || !LANGUAGES.includes(source.language_hint)
    || typeof source.content_status !== 'string'
    || !['ready', 'truncated'].includes(source.content_status)
    || typeof source.text_preview !== 'string'
    || source.text_preview.length > 96 * 1_024
    || source.binary_summary !== null
  ) throw unavailable();
  return Object.freeze({
    projection_version: 'builder-side-workspace-file-content.v1',
    project_id: request.project_id,
    conversation_id: request.conversation_id,
    source_kind: source.source_kind as BuilderSideWorkspaceFileContentProjection['source_kind'],
    source_tree_digest: digest,
    file_ref: fileRef,
    path: fileRef.path,
    language_hint: source.language_hint as BuilderSideWorkspaceFileContentProjection['language_hint'],
    content_status: source.content_status as BuilderSideWorkspaceFileContentProjection['content_status'],
    text_preview: source.text_preview,
    binary_summary: null,
    authority: sanitizeAuthority(source.authority),
  });
}

async function callTree(
  bridge: BuilderSideWorkspaceFilesBridge,
  request: BuilderSideWorkspaceFileRequest,
): Promise<BuilderSideWorkspaceFileTreeProjection> {
  try {
    const safe = sanitizeRequest(request);
    return sanitizeTreeProjection(await Reflect.apply(
      bridge.readCurrentDraftFileTree,
      bridge,
      [safe],
    ), safe);
  } catch {
    throw unavailable();
  }
}

async function callContent(
  bridge: BuilderSideWorkspaceFilesBridge,
  request: BuilderSideWorkspaceFileContentRequest,
): Promise<BuilderSideWorkspaceFileContentProjection> {
  try {
    const safe = sanitizeContentRequest(request);
    return sanitizeContentProjection(await Reflect.apply(
      bridge.readCurrentDraftFileContent,
      bridge,
      [safe],
    ), safe);
  } catch {
    throw unavailable();
  }
}

export function createBuilderDesktopSideWorkspaceFilesPort(value: unknown): BuilderSideWorkspaceFilesPort {
  const bridge = sanitizeBridge(value);
  return Object.freeze({
    readCurrentDraftFileTree(request: BuilderSideWorkspaceFileRequest) {
      return callTree(bridge, request);
    },
    readCurrentDraftFileContent(request: BuilderSideWorkspaceFileContentRequest) {
      return callContent(bridge, request);
    },
  });
}
