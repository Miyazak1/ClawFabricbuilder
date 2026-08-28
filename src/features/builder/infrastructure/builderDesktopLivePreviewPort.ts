import type {
  BuilderLivePreviewPort,
  BuilderLivePreviewLayoutRequest,
  BuilderLivePreviewRequest,
  BuilderLivePreviewStatusProjection,
} from '../application/builderPorts';

type BuilderLivePreviewBridge = Readonly<{
  requestCurrentDraftPreview(request: unknown): Promise<unknown>;
  reloadCurrentPreview(request: unknown): Promise<unknown>;
  stopCurrentPreview(request: unknown): Promise<unknown>;
  readCurrentPreviewStatus(request: unknown): Promise<unknown>;
  updateCurrentPreviewLayout(request: unknown): Promise<unknown>;
  decideDevServerApproval(request: unknown): Promise<unknown>;
}>;

const BRIDGE_KEYS = Object.freeze([
  'requestCurrentDraftPreview',
  'reloadCurrentPreview',
  'stopCurrentPreview',
  'readCurrentPreviewStatus',
  'updateCurrentPreviewLayout',
  'decideDevServerApproval',
]);
const REQUEST_KEYS = Object.freeze(['project_id', 'conversation_id']);
const LAYOUT_REQUEST_KEYS = Object.freeze(['project_id', 'conversation_id', 'view_bounds']);
const VIEW_BOUNDS_KEYS = Object.freeze(['x', 'y', 'width', 'height']);
const STATUS_KEYS = Object.freeze([
  'status_version',
  'project_id',
  'conversation_id',
  'preview_kind',
  'entry_url',
  'status',
  'can_start',
  'can_reload',
  'can_stop',
  'blocked_request_count',
  'navigation_block_count',
  'network_block_count',
  'permission_block_count',
  'download_block_count',
  'window_open_block_count',
  'message',
  'dev_server_approval',
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
  /^builder-conversation:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const STATUSES = Object.freeze([
  'idle',
  'approval_required',
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
  'live_preview_static_server_unavailable',
  'live_preview_view_attachment_failed',
  'live_preview_dev_server_unavailable',
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
    updateCurrentPreviewLayout: source.updateCurrentPreviewLayout as (request: unknown) => Promise<unknown>,
    decideDevServerApproval: source.decideDevServerApproval as (request: unknown) => Promise<unknown>,
  });
}

function sanitizeLayoutRequest(
  request: BuilderLivePreviewLayoutRequest,
): BuilderLivePreviewLayoutRequest {
  const source = exactRecord(request, LAYOUT_REQUEST_KEYS);
  const identity = sanitizeRequest({
    project_id: source.project_id as string,
    conversation_id: source.conversation_id as string,
  });
  if (source.view_bounds === null) {
    return Object.freeze({ ...identity, view_bounds: null });
  }
  const bounds = exactRecord(source.view_bounds, VIEW_BOUNDS_KEYS);
  for (const key of VIEW_BOUNDS_KEYS) {
    const value = bounds[key];
    if (!Number.isSafeInteger(value)) throw unavailable();
  }
  if (
    (bounds.x as number) < 0
    || (bounds.y as number) < 0
    || (bounds.width as number) < 1
    || (bounds.height as number) < 1
  ) throw unavailable();
  return Object.freeze({
    ...identity,
    view_bounds: Object.freeze({
      x: bounds.x as number,
      y: bounds.y as number,
      width: bounds.width as number,
      height: bounds.height as number,
    }),
  });
}

function sanitizeRequest(request: BuilderLivePreviewRequest): BuilderLivePreviewRequest {
  const source = exactRecord(request, REQUEST_KEYS);
  if (
    typeof source.project_id !== 'string'
    || !PROJECT_ID_PATTERN.test(source.project_id)
    || typeof source.conversation_id !== 'string'
    || !CONVERSATION_ID_PATTERN.test(source.conversation_id)
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
    || typeof source.command_execution !== 'boolean'
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
    command_execution: source.command_execution,
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

function sanitizeCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 1_000_000) {
    throw unavailable();
  }
  return value;
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
    || !['live_static_web', 'live_dev_server_web'].includes(source.preview_kind as string)
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
  const entryUrl = source.entry_url;
  if (
    entryUrl !== null
    && (typeof entryUrl !== 'string' || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\//u.test(entryUrl))
  ) throw unavailable();
  let devServerApproval: BuilderLivePreviewStatusProjection['dev_server_approval'] = null;
  if (source.dev_server_approval !== null) {
    const approval = exactRecord(source.dev_server_approval, [
      'request_version', 'approval_request_id', 'project_id', 'conversation_id',
      'command_display', 'source_tree_digest', 'risk_notice', 'requested_at_ms',
      'expires_at_ms', 'decisions',
    ]);
    if (
      approval.request_version !== 'builder-live-preview-dev-server-approval-request.v1'
      || typeof approval.approval_request_id !== 'string'
      || !/^builder-live-preview-dev-server-approval-request:[0-9a-f-]{36}$/u
        .test(approval.approval_request_id)
      || approval.project_id !== request.project_id
      || approval.conversation_id !== request.conversation_id
      || typeof approval.command_display !== 'string'
      || typeof approval.source_tree_digest !== 'string'
      || !/^sha256:[0-9a-f]{64}$/u.test(approval.source_tree_digest)
      || approval.risk_notice !== 'This project script may modify files or use the network.'
      || !Array.isArray(approval.decisions)
      || approval.decisions.join('|') !== 'allow_once|deny'
      || typeof approval.requested_at_ms !== 'number'
      || !Number.isSafeInteger(approval.requested_at_ms)
      || typeof approval.expires_at_ms !== 'number'
      || !Number.isSafeInteger(approval.expires_at_ms)
    ) throw unavailable();
    devServerApproval = Object.freeze({
      request_version: 'builder-live-preview-dev-server-approval-request.v1',
      approval_request_id: approval.approval_request_id,
      project_id: request.project_id,
      conversation_id: request.conversation_id,
      command_display: approval.command_display,
      source_tree_digest: approval.source_tree_digest,
      risk_notice: 'This project script may modify files or use the network.',
      requested_at_ms: approval.requested_at_ms,
      expires_at_ms: approval.expires_at_ms,
      decisions: ['allow_once', 'deny'] as const,
    });
  }
  if ((source.status === 'approval_required') !== (devServerApproval !== null)) throw unavailable();
  const navigationBlockCount = sanitizeCount(source.navigation_block_count);
  const networkBlockCount = sanitizeCount(source.network_block_count);
  const permissionBlockCount = sanitizeCount(source.permission_block_count);
  const downloadBlockCount = sanitizeCount(source.download_block_count);
  const windowOpenBlockCount = sanitizeCount(source.window_open_block_count);
  const blockedRequestCount = sanitizeCount(source.blocked_request_count);
  if (
    blockedRequestCount !== navigationBlockCount
      + networkBlockCount
      + permissionBlockCount
      + downloadBlockCount
      + windowOpenBlockCount
  ) throw unavailable();
  return Object.freeze({
    status_version: 'builder-live-preview-status-projection.v1',
    project_id: request.project_id,
    conversation_id: request.conversation_id,
    preview_kind: source.preview_kind as BuilderLivePreviewStatusProjection['preview_kind'],
    entry_url: entryUrl,
    status: source.status as BuilderLivePreviewStatusProjection['status'],
    can_start: source.can_start,
    can_reload: source.can_reload,
    can_stop: source.can_stop,
    blocked_request_count: blockedRequestCount,
    navigation_block_count: navigationBlockCount,
    network_block_count: networkBlockCount,
    permission_block_count: permissionBlockCount,
    download_block_count: downloadBlockCount,
    window_open_block_count: windowOpenBlockCount,
    message: source.message,
    dev_server_approval: devServerApproval,
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
    async updateCurrentPreviewLayout(request: BuilderLivePreviewLayoutRequest) {
      try {
        const safeRequest = sanitizeLayoutRequest(request);
        return sanitizeStatus(
          await Reflect.apply(bridge.updateCurrentPreviewLayout, bridge, [safeRequest]),
          safeRequest,
        );
      } catch {
        throw unavailable();
      }
    },
    async decideDevServerApproval(
      request: Parameters<BuilderLivePreviewPort['decideDevServerApproval']>[0],
    ) {
      try {
        const identity = sanitizeRequest({
          project_id: request.project_id,
          conversation_id: request.conversation_id,
        });
        const approvalRequestId = request.approval_request_id;
        const decision = request.decision;
        if (
          typeof approvalRequestId !== 'string'
          || !/^builder-live-preview-dev-server-approval-request:[0-9a-f-]{36}$/u.test(approvalRequestId)
          || !['allow_once', 'deny'].includes(decision)
        ) throw unavailable();
        return sanitizeStatus(await Reflect.apply(bridge.decideDevServerApproval, bridge, [{
          ...identity,
          approval_request_id: approvalRequestId,
          decision,
        }]), identity);
      } catch {
        throw unavailable();
      }
    },
  });
}
