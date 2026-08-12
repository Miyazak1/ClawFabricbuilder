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
  createBuilderLivePreviewAdmission,
} = require('./builder-live-preview-run.cjs');
const {
  startBuilderLivePreviewStaticServer,
} = require('./builder-live-preview-static-server.cjs');

const BUILDER_LIVE_PREVIEW_MAIN_SERVICE_VERSION = 'builder-live-preview-main-service.v1';
const OPTION_KEYS = Object.freeze([
  'current_draft_source_service',
  'webcontents_view_runtime',
  'mainWindowRef',
  'now_ms',
]);
const REQUEST_KEYS = Object.freeze(['project_id', 'conversation_id']);
const SOURCE_RESULT_KEYS = Object.freeze([
  'result_version',
  'service_version',
  'operation',
  'draft_id',
  'project_id',
  'conversation_id',
  'source_admission',
]);
const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONVERSATION_ID_PATTERN =
  /^builder-conversation:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const AUTHORITY = Object.freeze({
  live_preview_authority: 'main_owned_live_preview_ipc_adapter_v1',
  renderer_authority: 'current_project_conversation_only',
  active_renderer_required: true,
  source_tree_from_renderer: 'not_accepted',
  source_read: 'main_owned_preview_source_resolver_or_not_performed',
  source_write: 'not_performed',
  provider_dispatch: false,
  tool_dispatch: false,
  command_execution: false,
  git_mutation: false,
  sqlite_write: false,
  permission_grant: false,
  revision_admission: false,
  save_admission: false,
  electron_view_attachment: 'main_only_not_exposed_to_renderer',
  preview_content_ipc: false,
  node_integration: false,
  preload: false,
});
const MESSAGES = Object.freeze({
  idle: 'Live preview can start for this draft.',
  starting: 'Live preview is starting.',
  ready: 'Live preview is ready.',
  reloading: 'Live preview is reloading.',
  stopping: 'Live preview is stopping.',
  stopped: 'Live preview is stopped.',
  failed: 'Live preview could not start for the current draft.',
});
const RUNTIME_BLOCK_COUNT_KEYS = Object.freeze([
  'navigation_block_count',
  'network_block_count',
  'permission_block_count',
  'download_block_count',
  'window_open_block_count',
]);

class BuilderLivePreviewMainServiceError extends Error {
  constructor() {
    super('Live preview is unavailable.');
    this.name = 'BuilderLivePreviewMainServiceError';
    this.code = 'builder_live_preview_unavailable';
    this.retryable = true;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderLivePreviewMainServiceError();
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000 ? value : 0;
}

function runtimeBlockCounts(rawStatus = null) {
  const counts = {
    navigation_block_count: 0,
    network_block_count: 0,
    permission_block_count: 0,
    download_block_count: 0,
    window_open_block_count: 0,
  };
  if (rawStatus !== null && typeof rawStatus === 'object' && !utilTypes.isProxy(rawStatus)) {
    for (const key of RUNTIME_BLOCK_COUNT_KEYS) {
      const descriptor = Object.getOwnPropertyDescriptor(rawStatus, key);
      counts[key] = descriptor && Object.hasOwn(descriptor, 'value')
        ? safeCount(descriptor.value)
        : 0;
    }
  }
  return counts;
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

function ownMethod(value, methodKey) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) fail();
  let cursor = value;
  while (cursor !== null) {
    if (utilTypes.isProxy(cursor)) fail();
    const descriptor = Object.getOwnPropertyDescriptor(cursor, methodKey);
    if (descriptor) {
      if (
        !Object.hasOwn(descriptor, 'value')
        || typeof descriptor.value !== 'function'
        || utilTypes.isProxy(descriptor.value)
      ) fail();
      return descriptor.value.bind(value);
    }
    cursor = Object.getPrototypeOf(cursor);
  }
  fail();
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
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

function fallbackBounds(windowRef) {
  let width = 1280;
  let height = 820;
  try {
    const contentBounds = Reflect.apply(ownMethod(windowRef, 'getContentBounds'), windowRef, []);
    if (
      isPlainObject(contentBounds)
      && Number.isSafeInteger(contentBounds.width)
      && Number.isSafeInteger(contentBounds.height)
      && contentBounds.width > 0
      && contentBounds.height > 0
    ) {
      width = contentBounds.width;
      height = contentBounds.height;
    }
  } catch {
    // Fall through to a bounded default; the view remains local-only.
  }
  const panelWidth = Math.max(320, Math.min(520, Math.floor(width * 0.34)));
  const y = Math.min(140, Math.max(88, Math.floor(height * 0.14)));
  return freezeDeep({
    x: Math.max(0, width - panelWidth - 20),
    y,
    width: panelWidth,
    height: Math.max(180, height - y - 24),
  });
}

function statusProjection(
  request,
  status,
  updatedAtMs,
  unavailableReason = null,
  rawRuntimeStatus = null,
) {
  const counts = runtimeBlockCounts(rawRuntimeStatus);
  const blockedRequestCount = RUNTIME_BLOCK_COUNT_KEYS
    .reduce((total, key) => total + counts[key], 0);
  return freezeDeep({
    status_version: 'builder-live-preview-status-projection.v1',
    project_id: request.project_id,
    conversation_id: request.conversation_id,
    preview_kind: 'live_static_web',
    status,
    can_start: status === 'idle' || status === 'stopped' || status === 'failed',
    can_reload: status === 'ready',
    can_stop: status === 'starting' || status === 'ready' || status === 'reloading',
    blocked_request_count: blockedRequestCount,
    navigation_block_count: counts.navigation_block_count,
    network_block_count: counts.network_block_count,
    permission_block_count: counts.permission_block_count,
    download_block_count: counts.download_block_count,
    window_open_block_count: counts.window_open_block_count,
    message: MESSAGES[status],
    unavailable_reason: unavailableReason,
    updated_at_ms: updatedAtMs,
    authority: AUTHORITY,
  });
}

function sanitizeSourceResult(rawValue, request) {
  const value = exactObject(rawValue, SOURCE_RESULT_KEYS);
  if (
    value.result_version.value !== BUILDER_LIVE_PREVIEW_CURRENT_DRAFT_SOURCE_RESULT_VERSION
    || value.service_version.value !== BUILDER_LIVE_PREVIEW_CURRENT_DRAFT_SOURCE_SERVICE_VERSION
    || value.operation.value !== 'current_draft_live_preview_source_admitted'
    || value.project_id.value !== request.project_id
    || value.conversation_id.value !== request.conversation_id
  ) fail();
  safePattern(value.draft_id.value, /^builder-generation-draft:[0-9a-f]{64}$/u);
  return sanitizeBuilderLivePreviewSourceAdmission(value.source_admission.value);
}

function runtimeAdmissionFromSource(sourceAdmission) {
  const draftCheckpointId = sourceAdmission.source_ref.source_ref_kind === 'current_draft_checkpoint_candidate'
    ? sourceAdmission.source_ref.checkpoint_id
    : null;
  return createBuilderLivePreviewAdmission({
    project_id: sourceAdmission.project_id,
    conversation_id: sourceAdmission.conversation_id,
    task_id: null,
    run_id: null,
    draft_checkpoint_id: draftCheckpointId,
    source_tree_digest: sourceAdmission.source_tree_digest,
    selected_entry_path: sourceAdmission.selected_entry_path,
    preview_kind: sourceAdmission.preview_kind,
    admitted_at_ms: sourceAdmission.admitted_at_ms,
    expires_at_ms: sourceAdmission.expires_at_ms,
  });
}

function attachView(windowRef, view, requestedBounds) {
  if (windowRef === null || typeof windowRef !== 'object' || utilTypes.isProxy(windowRef)) fail();
  const contentView = windowRef.contentView;
  if (contentView === null || typeof contentView !== 'object' || utilTypes.isProxy(contentView)) fail();
  const addChildView = ownMethod(contentView, 'addChildView');
  const removeChildView = ownMethod(contentView, 'removeChildView');
  const setBounds = ownMethod(view, 'setBounds');
  const bounds = requestedBounds ?? fallbackBounds(windowRef);
  Reflect.apply(addChildView, contentView, [view]);
  Reflect.apply(setBounds, view, [bounds]);
  return freezeDeep({
    bounds,
    detach() {
      try {
        Reflect.apply(removeChildView, contentView, [view]);
      } catch {
        // Runtime stop still destroys the isolated WebContentsView.
      }
    },
    update(nextBounds) {
      const selected = nextBounds ?? bounds;
      Reflect.apply(setBounds, view, [selected]);
      return selected;
    },
  });
}

function sameRequest(left, right) {
  return left.project_id === right.project_id
    && left.conversation_id === right.conversation_id;
}

function createBuilderLivePreviewMainService(rawOptions) {
  const options = exactObject(rawOptions, OPTION_KEYS);
  const sourceService = options.current_draft_source_service.value;
  const resolveCurrentDraft = ownMethod(sourceService, 'resolve_current_draft_preview_source');
  const runtime = options.webcontents_view_runtime.value;
  const startRuntime = ownMethod(runtime, 'start');
  const disposeRuntime = ownMethod(runtime, 'dispose');
  const mainWindowRef = options.mainWindowRef.value;
  const nowMs = options.now_ms.value;
  if (
    !isPlainObject(sourceService)
    || sourceService.service_version !== BUILDER_LIVE_PREVIEW_CURRENT_DRAFT_SOURCE_SERVICE_VERSION
    || typeof mainWindowRef !== 'function'
    || utilTypes.isProxy(mainWindowRef)
    || typeof nowMs !== 'function'
    || utilTypes.isProxy(nowMs)
  ) fail();

  let active = null;

  async function stopActive() {
    if (active === null) return;
    const item = active;
    active = null;
    try { item.attachment.detach(); } catch { /* stop below destroys the view. */ }
    await item.handle.stop();
  }

  async function start(rawRequest) {
    const request = safeRequest(rawRequest);
    const now = safeTimestamp(nowMs());
    let staticServer = null;
    let handle = null;
    try {
      if (active !== null) await stopActive();
      const sourceResult = await resolveCurrentDraft({
        project_id: request.project_id,
        conversation_id: request.conversation_id,
      });
      const sourceAdmission = sanitizeSourceResult(sourceResult, request);
      const runtimeAdmission = runtimeAdmissionFromSource(sourceAdmission);
      staticServer = await startBuilderLivePreviewStaticServer({
        admission: runtimeAdmission,
        source_tree: sourceAdmission.source_tree,
      });
      handle = await startRuntime({
        admission: runtimeAdmission,
        static_server: staticServer,
      });
      const view = handle.readMainOnlyWebContentsViewForAttachment();
      const attachment = attachView(mainWindowRef(), view);
      active = freezeDeep({ request, sourceAdmission, runtimeAdmission, handle, attachment });
      return statusProjection(request, 'ready', safeTimestamp(nowMs()), null, handle.readStatus());
    } catch {
      try {
        if (handle !== null) await handle.stop();
        else if (staticServer !== null) await staticServer.stop();
      } catch {
        // The renderer receives the fixed failed projection below.
      }
      try { await stopActive(); } catch { /* fixed failed projection below. */ }
      return statusProjection(request, 'failed', now);
    }
  }

  async function reload(rawRequest) {
    const request = safeRequest(rawRequest);
      if (active === null || !sameRequest(active.request, request)) return start(request);
    try {
      await active.handle.reload();
      return statusProjection(
        request,
        'ready',
        safeTimestamp(nowMs()),
        null,
        active.handle.readStatus(),
      );
    } catch {
      try { await stopActive(); } catch { /* fixed failed projection below. */ }
      return statusProjection(request, 'failed', safeTimestamp(nowMs()));
    }
  }

  async function stop(rawRequest) {
    const request = safeRequest(rawRequest);
    const runtimeStatus = active !== null && sameRequest(active.request, request)
      ? active.handle.readStatus()
      : null;
    if (active !== null && sameRequest(active.request, request)) await stopActive();
    return statusProjection(request, 'stopped', safeTimestamp(nowMs()), null, runtimeStatus);
  }

  function readStatus(rawRequest) {
    const request = safeRequest(rawRequest);
    if (active === null || !sameRequest(active.request, request)) {
      return statusProjection(request, 'idle', safeTimestamp(nowMs()));
    }
    const runtimeStatus = active.handle.readStatus();
    const status = runtimeStatus.status;
    return statusProjection(
      request,
      status === 'ready' ? 'ready' : status === 'stopped' ? 'stopped' : 'starting',
      safeTimestamp(nowMs()),
      null,
      runtimeStatus,
    );
  }

  return freezeDeep({
    service_version: BUILDER_LIVE_PREVIEW_MAIN_SERVICE_VERSION,
    request_current_draft_live_preview: start,
    reload_current_live_preview: reload,
    stop_current_live_preview: stop,
    read_current_live_preview_status: readStatus,
    async shutdown() {
      let cleanupRequired = false;
      try {
        await stopActive();
      } catch {
        cleanupRequired = true;
      }
      try {
        await disposeRuntime();
      } catch {
        cleanupRequired = true;
      }
      return freezeDeep({ shutdown: true, cleanup_required: cleanupRequired });
    },
  });
}

module.exports = freezeDeep({
  BUILDER_LIVE_PREVIEW_MAIN_SERVICE_VERSION,
  BuilderLivePreviewMainServiceError,
  createBuilderLivePreviewMainService,
});
