import type {
  BuilderLivePreviewPort,
  BuilderLivePreviewRequest,
  BuilderLivePreviewStatusProjection,
} from '../application/builderPorts';

type BuilderLivePreviewBridge = Readonly<{
  requestCurrentDraftPreview(request: unknown): Promise<unknown>;
  reloadCurrentPreview(request: unknown): Promise<unknown>;
  stopCurrentPreview(request: unknown): Promise<unknown>;
  readCurrentPreviewStatus(request: unknown): Promise<unknown>;
}>;

const BRIDGE_KEYS = Object.freeze([
  'requestCurrentDraftPreview',
  'reloadCurrentPreview',
  'stopCurrentPreview',
  'readCurrentPreviewStatus',
]);
const REQUEST_KEYS = Object.freeze(['project_id', 'conversation_id']);
const STATUS_KEYS = Object.freeze([
  'status_version',
  'project_id',
  'conversation_id',
  'preview_kind',
  'status',
  'can_start',
  'can_reload',
  'can_stop',
  'message',
  'unavailable_reason',
  'updated_at_ms',
  'authority',
]);
const AUTHORITY_KEYS = Object.freeze([
  'live_preview_authority',
  'renderer_authority',
  'active_renderer_required',
  'source_tree_from_renderer',
  'source_read',
  'source_write',
  'provider_dispatch',
  'tool_dispatch',
  'command_execution',
  'git_mutation',
  'sqlite_write',
  'permission_grant',
  'revision_admission',
  'save_admission',
  'electron_view_attachment',
  'preview_content_ipc',
  'node_integration',
  'preload',
]);
const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONVERSATION_ID_PATTERN =
  /^builder-conversation:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const STATUSES = Object.freeze([
  'idle',
  'unavailable',
  'starting',
  'ready',
  'reloading',
  'stopping',
  'stopped',
  'failed',
]);
const UNAVAILABLE_REASONS = Object.freeze([
  'preview_source_resolver_not_connected',
  'no_current_draft_preview_source',
  'live_preview_runtime_unavailable',
]);

export class BuilderDesktopLivePreviewPortError extends Error {
  readonly code = 'builder_live_preview_unavailable';

  constructor() {
    super('Live preview is unavailable.');
    this.name = 'BuilderDesktopLivePreviewPortError';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function unavailable(): BuilderDesktopLivePreviewPortError {
  return new BuilderDesktopLivePreviewPortError();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isPlainObject(value)) throw unavailable();
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length
    || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) throw unavailable();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (
      !descriptor
      || !descriptor.enumerable
      || !Object.hasOwn(descriptor, 'value')
    ) throw unavailable();
  }
  return Object.freeze(Object.fromEntries(keys.map((key) => [key, descriptors[key].value])));
}

function sanitizeBridge(value: unknown): BuilderLivePreviewBridge {
  const source = exactRecord(value, BRIDGE_KEYS);
  for (const key of BRIDGE_KEYS) {
    if (typeof source[key] !== 'function') throw unavailable();
  }
  return Object.freeze({
    requestCurrentDraftPreview: source.requestCurrentDraftPreview as (request: unknown) => Promise<unknown>,
    reloadCurrentPreview: source.reloadCurrentPreview as (request: unknown) => Promise<unknown>,
    stopCurrentPreview: source.stopCurrentPreview as (request: unknown) => Promise<unknown>,
    readCurrentPreviewStatus: source.readCurrentPreviewStatus as (request: unknown) => Promise<unknown>,
  });
}

function projectUuid(projectId: string): string {
  return projectId.slice('builder-project:'.length);
}

function sanitizeRequest(request: BuilderLivePreviewRequest): BuilderLivePreviewRequest {
  const source = exactRecord(request, REQUEST_KEYS);
  if (
    typeof source.project_id !== 'string'
    || !PROJECT_ID_PATTERN.test(source.project_id)
    || typeof source.conversation_id !== 'string'
    || !CONVERSATION_ID_PATTERN.test(source.conversation_id)
    || source.conversation_id !== `builder-conversation:${projectUuid(source.project_id)}`
  ) throw unavailable();
  return Object.freeze({
    project_id: source.project_id,
    conversation_id: source.conversation_id,
  });
}

function sanitizeAuthority(value: unknown) {
  const source = exactRecord(value, AUTHORITY_KEYS);
  if (
    source.live_preview_authority !== 'main_owned_live_preview_ipc_adapter_v1'
    || source.renderer_authority !== 'current_project_conversation_only'
    || source.active_renderer_required !== true
    || source.source_tree_from_renderer !== 'not_accepted'
    || source.source_read !== 'main_owned_preview_source_resolver_or_not_performed'
    || source.source_write !== 'not_performed'
    || source.provider_dispatch !== false
    || source.tool_dispatch !== false
    || source.command_execution !== false
    || source.git_mutation !== false
    || source.sqlite_write !== false
    || source.permission_grant !== false
    || source.revision_admission !== false
    || source.save_admission !== false
    || source.electron_view_attachment !== 'main_only_not_exposed_to_renderer'
    || source.preview_content_ipc !== false
    || source.node_integration !== false
    || source.preload !== false
  ) throw unavailable();
  return Object.freeze({
    live_preview_authority: 'main_owned_live_preview_ipc_adapter_v1' as const,
    renderer_authority: 'current_project_conversation_only' as const,
    active_renderer_required: true as const,
    source_tree_from_renderer: 'not_accepted' as const,
    source_read: 'main_owned_preview_source_resolver_or_not_performed' as const,
    source_write: 'not_performed' as const,
    provider_dispatch: false as const,
    tool_dispatch: false as const,
    command_execution: false as const,
    git_mutation: false as const,
    sqlite_write: false as const,
    permission_grant: false as const,
    revision_admission: false as const,
    save_admission: false as const,
    electron_view_attachment: 'main_only_not_exposed_to_renderer' as const,
    preview_content_ipc: false as const,
    node_integration: false as const,
    preload: false as const,
  });
}

function sanitizeStatus(
  value: unknown,
  request: BuilderLivePreviewRequest,
): BuilderLivePreviewStatusProjection {
  const source = exactRecord(value, STATUS_KEYS);
  const updatedAtMs = source.updated_at_ms;
  if (
    source.status_version !== 'builder-live-preview-status-projection.v1'
    || source.project_id !== request.project_id
    || source.conversation_id !== request.conversation_id
    || source.preview_kind !== 'live_static_web'
    || typeof source.status !== 'string'
    || !STATUSES.includes(source.status)
    || typeof source.can_start !== 'boolean'
    || typeof source.can_reload !== 'boolean'
    || typeof source.can_stop !== 'boolean'
    || typeof source.message !== 'string'
    || source.message.length < 1
    || source.message.length > 180
    || typeof updatedAtMs !== 'number'
    || !Number.isSafeInteger(updatedAtMs)
    || updatedAtMs < 0
    || (
      source.unavailable_reason !== null
      && (
        typeof source.unavailable_reason !== 'string'
        || !UNAVAILABLE_REASONS.includes(source.unavailable_reason)
      )
    )
  ) throw unavailable();
  return Object.freeze({
    status_version: 'builder-live-preview-status-projection.v1',
    project_id: request.project_id,
    conversation_id: request.conversation_id,
    preview_kind: 'live_static_web',
    status: source.status as BuilderLivePreviewStatusProjection['status'],
    can_start: source.can_start,
    can_reload: source.can_reload,
    can_stop: source.can_stop,
    message: source.message,
    unavailable_reason: source.unavailable_reason as BuilderLivePreviewStatusProjection['unavailable_reason'],
    updated_at_ms: updatedAtMs,
    authority: sanitizeAuthority(source.authority),
  });
}

async function callPreview(
  bridge: BuilderLivePreviewBridge,
  method: keyof BuilderLivePreviewBridge,
  request: BuilderLivePreviewRequest,
): Promise<BuilderLivePreviewStatusProjection> {
  try {
    const safeRequest = sanitizeRequest(request);
    return sanitizeStatus(await Reflect.apply(bridge[method], bridge, [safeRequest]), safeRequest);
  } catch {
    throw unavailable();
  }
}

export function createBuilderDesktopLivePreviewPort(value: unknown): BuilderLivePreviewPort {
  const bridge = sanitizeBridge(value);
  return Object.freeze({
    requestCurrentDraftPreview(request: BuilderLivePreviewRequest) {
      return callPreview(bridge, 'requestCurrentDraftPreview', request);
    },
    reloadCurrentPreview(request: BuilderLivePreviewRequest) {
      return callPreview(bridge, 'reloadCurrentPreview', request);
    },
    stopCurrentPreview(request: BuilderLivePreviewRequest) {
      return callPreview(bridge, 'stopCurrentPreview', request);
    },
    readCurrentPreviewStatus(request: BuilderLivePreviewRequest) {
      return callPreview(bridge, 'readCurrentPreviewStatus', request);
    },
  });
}
