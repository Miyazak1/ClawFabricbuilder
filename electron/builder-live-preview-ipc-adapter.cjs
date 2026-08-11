'use strict';

const { types: utilTypes } = require('node:util');

const REQUEST_CURRENT_DRAFT_LIVE_PREVIEW_CHANNEL =
  'clawfabric-builder:live-preview:request-current-draft';
const RELOAD_CURRENT_LIVE_PREVIEW_CHANNEL =
  'clawfabric-builder:live-preview:reload-current';
const STOP_CURRENT_LIVE_PREVIEW_CHANNEL =
  'clawfabric-builder:live-preview:stop-current';
const READ_CURRENT_LIVE_PREVIEW_STATUS_CHANNEL =
  'clawfabric-builder:live-preview:read-current-status';

const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONVERSATION_ID_PATTERN =
  /^builder-conversation:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const REQUEST_KEYS = Object.freeze(['project_id', 'conversation_id']);
const OPTION_KEYS = Object.freeze([
  'requestCurrentDraftLivePreview',
  'reloadCurrentLivePreview',
  'stopCurrentLivePreview',
  'readCurrentLivePreviewStatus',
  'mainWindowRef',
]);
const STATUS_KEYS = Object.freeze([
  'status_version',
  'project_id',
  'conversation_id',
  'preview_kind',
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
const ERROR_MESSAGES = Object.freeze({
  builder_live_preview_forbidden: 'Live preview is unavailable.',
  builder_live_preview_invalid: 'The live preview request could not be verified.',
  builder_live_preview_unavailable: 'Live preview is unavailable.',
});

class BuilderLivePreviewIpcError extends Error {
  constructor(code = 'builder_live_preview_unavailable') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_live_preview_unavailable';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderLivePreviewIpcError';
    this.code = selected;
    this.retryable = selected === 'builder_live_preview_unavailable';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function ipcError(code) {
  return new BuilderLivePreviewIpcError(code);
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

function exactObject(value, keys, code = 'builder_live_preview_invalid') {
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
    exactObject(value, OPTION_KEYS, 'builder_live_preview_unavailable');
    return Object.freeze({
      requestCurrentDraftLivePreview: stableMethod(value, 'requestCurrentDraftLivePreview'),
      reloadCurrentLivePreview: stableMethod(value, 'reloadCurrentLivePreview'),
      stopCurrentLivePreview: stableMethod(value, 'stopCurrentLivePreview'),
      readCurrentLivePreviewStatus: stableMethod(value, 'readCurrentLivePreviewStatus'),
      mainWindowRef: stableMethod(value, 'mainWindowRef'),
    });
  } catch {
    throw ipcError();
  }
}

function safeProjectId(value) {
  if (typeof value !== 'string' || !PROJECT_ID_PATTERN.test(value)) {
    throw ipcError('builder_live_preview_invalid');
  }
  return value;
}

function safeConversationId(value, projectId) {
  if (
    typeof value !== 'string'
    || !CONVERSATION_ID_PATTERN.test(value)
    || value.slice('builder-conversation:'.length) !== projectId.slice('builder-project:'.length)
  ) throw ipcError('builder_live_preview_invalid');
  return value;
}

function safeRequest(value) {
  const descriptors = exactObject(value, REQUEST_KEYS);
  const projectId = safeProjectId(descriptors.project_id.value);
  return Object.freeze({
    project_id: projectId,
    conversation_id: safeConversationId(descriptors.conversation_id.value, projectId),
  });
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw ipcError();
  return value;
}

function safeCount(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) throw ipcError();
  return value;
}

function safeNullableReason(value) {
  if (value === null) return null;
  if (!UNAVAILABLE_REASONS.includes(value)) throw ipcError();
  return value;
}

function safeMessage(value) {
  if (
    value !== 'Live preview can start for this draft.'
    && value !== 'Live preview is starting.'
    && value !== 'Live preview is ready.'
    && value !== 'Live preview is reloading.'
    && value !== 'Live preview is stopping.'
    && value !== 'Live preview is stopped.'
    && value !== 'Live preview is unavailable until a main-owned preview source resolver is connected.'
    && value !== 'Live preview could not start for the current draft.'
  ) throw ipcError();
  return value;
}

function safeAuthority(value) {
  const descriptors = exactObject(value, AUTHORITY_KEYS, 'builder_live_preview_unavailable');
  const authority = Object.freeze(Object.fromEntries(AUTHORITY_KEYS.map((key) => [
    key,
    descriptors[key].value,
  ])));
  if (
    authority.live_preview_authority !== 'main_owned_live_preview_ipc_adapter_v1'
    || authority.renderer_authority !== 'current_project_conversation_only'
    || authority.active_renderer_required !== true
    || authority.source_tree_from_renderer !== 'not_accepted'
    || authority.source_read !== 'main_owned_preview_source_resolver_or_not_performed'
    || authority.source_write !== 'not_performed'
    || authority.provider_dispatch !== false
    || authority.tool_dispatch !== false
    || authority.command_execution !== false
    || authority.git_mutation !== false
    || authority.sqlite_write !== false
    || authority.permission_grant !== false
    || authority.revision_admission !== false
    || authority.save_admission !== false
    || authority.electron_view_attachment !== 'main_only_not_exposed_to_renderer'
    || authority.preview_content_ipc !== false
    || authority.node_integration !== false
    || authority.preload !== false
  ) throw ipcError();
  return authority;
}

function safeStatus(value, request) {
  const descriptors = exactObject(value, STATUS_KEYS, 'builder_live_preview_unavailable');
  const status = descriptors.status.value;
  if (
    descriptors.status_version.value !== 'builder-live-preview-status-projection.v1'
    || descriptors.project_id.value !== request.project_id
    || descriptors.conversation_id.value !== request.conversation_id
    || descriptors.preview_kind.value !== 'live_static_web'
    || !STATUSES.includes(status)
    || typeof descriptors.can_start.value !== 'boolean'
    || typeof descriptors.can_reload.value !== 'boolean'
    || typeof descriptors.can_stop.value !== 'boolean'
  ) throw ipcError();
  const navigationBlockCount = safeCount(descriptors.navigation_block_count.value);
  const networkBlockCount = safeCount(descriptors.network_block_count.value);
  const permissionBlockCount = safeCount(descriptors.permission_block_count.value);
  const downloadBlockCount = safeCount(descriptors.download_block_count.value);
  const windowOpenBlockCount = safeCount(descriptors.window_open_block_count.value);
  const blockedRequestCount = safeCount(descriptors.blocked_request_count.value);
  if (
    blockedRequestCount !== navigationBlockCount
      + networkBlockCount
      + permissionBlockCount
      + downloadBlockCount
      + windowOpenBlockCount
  ) throw ipcError();
  return Object.freeze({
    status_version: 'builder-live-preview-status-projection.v1',
    project_id: request.project_id,
    conversation_id: request.conversation_id,
    preview_kind: 'live_static_web',
    status,
    can_start: descriptors.can_start.value,
    can_reload: descriptors.can_reload.value,
    can_stop: descriptors.can_stop.value,
    blocked_request_count: blockedRequestCount,
    navigation_block_count: navigationBlockCount,
    network_block_count: networkBlockCount,
    permission_block_count: permissionBlockCount,
    download_block_count: downloadBlockCount,
    window_open_block_count: windowOpenBlockCount,
    message: safeMessage(descriptors.message.value),
    unavailable_reason: safeNullableReason(descriptors.unavailable_reason.value),
    updated_at_ms: safeTimestamp(descriptors.updated_at_ms.value),
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
    : 'builder_live_preview_unavailable');
}

function activeWebContents(mainWindowRef) {
  try {
    const windowRef = Reflect.apply(mainWindowRef, undefined, []);
    if (!windowRef || (typeof windowRef.isDestroyed === 'function' && windowRef.isDestroyed())) {
      return null;
    }
    const webContents = windowRef.webContents;
    if (!webContents || (typeof webContents.isDestroyed === 'function' && webContents.isDestroyed())) {
      return null;
    }
    return webContents;
  } catch {
    return null;
  }
}

function assertActiveSender(event, mainWindowRef) {
  if (!event || event.sender !== activeWebContents(mainWindowRef)) {
    throw ipcError('builder_live_preview_forbidden');
  }
}

function createBuilderLivePreviewIpcAdapter(rawOptions) {
  const options = safeOptions(rawOptions);

  async function invoke(event, rawArguments, serviceMethod) {
    try {
      assertActiveSender(event, options.mainWindowRef);
      if (rawArguments.length !== 1) throw ipcError('builder_live_preview_invalid');
      const request = safeRequest(rawArguments[0]);
      return safeStatus(await Reflect.apply(serviceMethod, undefined, [request]), request);
    } catch (error) {
      throw normalizeError(error);
    }
  }

  return Object.freeze({
    adapter_id: 'builder_live_preview.controlled_ipc_adapter.v1',
    namespace: 'builderLivePreview',
    preload_namespace: 'window.clawfabricBuilder.livePreview',
    channels: Object.freeze({
      requestCurrentDraftPreview: Object.freeze({
        channel: REQUEST_CURRENT_DRAFT_LIVE_PREVIEW_CHANNEL,
        method: 'requestCurrentDraftPreview',
        invoke(event, ...rawArguments) {
          return invoke(event, rawArguments, options.requestCurrentDraftLivePreview);
        },
      }),
      reloadCurrentPreview: Object.freeze({
        channel: RELOAD_CURRENT_LIVE_PREVIEW_CHANNEL,
        method: 'reloadCurrentPreview',
        invoke(event, ...rawArguments) {
          return invoke(event, rawArguments, options.reloadCurrentLivePreview);
        },
      }),
      stopCurrentPreview: Object.freeze({
        channel: STOP_CURRENT_LIVE_PREVIEW_CHANNEL,
        method: 'stopCurrentPreview',
        invoke(event, ...rawArguments) {
          return invoke(event, rawArguments, options.stopCurrentLivePreview);
        },
      }),
      readCurrentPreviewStatus: Object.freeze({
        channel: READ_CURRENT_LIVE_PREVIEW_STATUS_CHANNEL,
        method: 'readCurrentPreviewStatus',
        invoke(event, ...rawArguments) {
          return invoke(event, rawArguments, options.readCurrentLivePreviewStatus);
        },
      }),
    }),
    exposed_methods: Object.freeze([
      'requestCurrentDraftPreview',
      'reloadCurrentPreview',
      'stopCurrentPreview',
      'readCurrentPreviewStatus',
    ]),
    authority: Object.freeze({
      renderer_authority: 'current_project_conversation_only',
      active_renderer_required: true,
      source_tree_from_renderer: false,
      provider_dispatch: false,
      tool_dispatch: false,
      command_execution: false,
      source_mutation: false,
      git_mutation: false,
      sqlite_write: false,
      permission_grant: false,
      revision_admission: false,
      save_admission: false,
      preview_content_ipc: false,
      direct_electron_registration: false,
      direct_preload_exposure: false,
    }),
  });
}

module.exports = Object.freeze({
  REQUEST_CURRENT_DRAFT_LIVE_PREVIEW_CHANNEL,
  RELOAD_CURRENT_LIVE_PREVIEW_CHANNEL,
  STOP_CURRENT_LIVE_PREVIEW_CHANNEL,
  READ_CURRENT_LIVE_PREVIEW_STATUS_CHANNEL,
  BuilderLivePreviewIpcError,
  createBuilderLivePreviewIpcAdapter,
});
