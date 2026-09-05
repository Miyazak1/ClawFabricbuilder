'use strict';

const nodeCrypto = require('node:crypto');
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
const {
  BUILDER_LIVE_PREVIEW_DEV_SERVER_RUNTIME_VERSION,
  discoverBuilderLivePreviewDevServerProfile,
} = require('./builder-live-preview-dev-server-runtime.cjs');
const {
  createBuilderLivePreviewDevServerAdmission,
  createBuilderLivePreviewDevServerApproval,
} = require('./builder-live-preview-dev-server-admission.cjs');

const BUILDER_LIVE_PREVIEW_MAIN_SERVICE_VERSION = 'builder-live-preview-main-service.v1';
const OPTION_KEYS = Object.freeze([
  'current_draft_source_service',
  'webcontents_view_runtime',
  'mainWindowRef',
  'now_ms',
]);
const OPTIONAL_OPTION_KEYS = Object.freeze(['dev_server_runtime', 'project_workspace_path_service']);
const REQUEST_KEYS = Object.freeze(['project_id', 'conversation_id']);
const LAYOUT_REQUEST_KEYS = Object.freeze(['project_id', 'conversation_id', 'view_bounds']);
const VIEW_BOUNDS_KEYS = Object.freeze(['x', 'y', 'width', 'height']);
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
  /^builder-conversation:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
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
  approval_required: 'Allow this project development server to run once.',
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
const FAILURE_REASON_BY_PHASE = Object.freeze({
  source: 'no_current_draft_preview_source',
  static_server: 'live_preview_static_server_unavailable',
  view_runtime: 'live_preview_runtime_unavailable',
  view_attachment: 'live_preview_view_attachment_failed',
  dev_server: 'live_preview_dev_server_unavailable',
});
const FALLBACK_ARTIFACT_PANEL_WIDTH_PX = 480;
const FALLBACK_ARTIFACT_PANEL_MIN_WIDTH_PX = 360;
const FALLBACK_ARTIFACT_PANEL_RIGHT_INSET_PX = 8;

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

function optionsObject(value) {
  if (!isPlainObject(value)) fail();
  const actual = Reflect.ownKeys(value);
  if (
    OPTION_KEYS.some((key) => !actual.includes(key))
    || actual.some((key) => !OPTION_KEYS.includes(key) && !OPTIONAL_OPTION_KEYS.includes(key))
  ) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of actual) {
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
  if (!conversationId.startsWith(
    `builder-conversation:${projectId.slice('builder-project:'.length)}:`,
  )) fail();
  return freezeDeep({
    project_id: projectId,
    conversation_id: conversationId,
  });
}

function safeViewBounds(rawBounds) {
  if (rawBounds === null) return null;
  const bounds = exactObject(rawBounds, VIEW_BOUNDS_KEYS);
  const selected = Object.freeze(Object.fromEntries(VIEW_BOUNDS_KEYS.map((key) => [
    key,
    bounds[key].value,
  ])));
  if (
    !Number.isSafeInteger(selected.x)
    || !Number.isSafeInteger(selected.y)
    || !Number.isSafeInteger(selected.width)
    || !Number.isSafeInteger(selected.height)
    || selected.x < 0
    || selected.y < 0
    || selected.width < 1
    || selected.height < 1
    || selected.x > 100_000
    || selected.y > 100_000
    || selected.width > 100_000
    || selected.height > 100_000
  ) fail();
  return selected;
}

function safeLayoutRequest(rawRequest) {
  const request = exactObject(rawRequest, LAYOUT_REQUEST_KEYS);
  const identity = safeRequest({
    project_id: request.project_id.value,
    conversation_id: request.conversation_id.value,
  });
  return freezeDeep({
    ...identity,
    view_bounds: safeViewBounds(request.view_bounds.value),
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
  const availableWidth = Math.max(1, width - FALLBACK_ARTIFACT_PANEL_RIGHT_INSET_PX);
  const panelWidth = availableWidth < FALLBACK_ARTIFACT_PANEL_MIN_WIDTH_PX
    ? availableWidth
    : Math.min(FALLBACK_ARTIFACT_PANEL_WIDTH_PX, availableWidth);
  const y = Math.min(140, Math.max(88, Math.floor(height * 0.14)));
  return freezeDeep({
    x: Math.max(0, width - panelWidth - FALLBACK_ARTIFACT_PANEL_RIGHT_INSET_PX),
    y,
    width: panelWidth,
    height: Math.max(180, height - y - 24),
  });
}

function contentSize(windowRef) {
  const bounds = Reflect.apply(ownMethod(windowRef, 'getContentBounds'), windowRef, []);
  if (
    !isPlainObject(bounds)
    || !Number.isSafeInteger(bounds.width)
    || !Number.isSafeInteger(bounds.height)
    || bounds.width < 1
    || bounds.height < 1
  ) fail();
  return Object.freeze({ width: bounds.width, height: bounds.height });
}

function constrainViewBounds(windowRef, requestedBounds) {
  const size = contentSize(windowRef);
  const x = Math.min(requestedBounds.x, size.width - 1);
  const y = Math.min(requestedBounds.y, size.height - 1);
  return freezeDeep({
    x,
    y,
    width: Math.max(1, Math.min(requestedBounds.width, size.width - x)),
    height: Math.max(1, Math.min(requestedBounds.height, size.height - y)),
  });
}

function statusProjection(
  request,
  status,
  updatedAtMs,
  unavailableReason = null,
  rawRuntimeStatus = null,
  previewKind = 'live_static_web',
  devServerApproval = null,
) {
  const counts = runtimeBlockCounts(rawRuntimeStatus);
  const blockedRequestCount = RUNTIME_BLOCK_COUNT_KEYS
    .reduce((total, key) => total + counts[key], 0);
  let entryUrl = null;
  if (rawRuntimeStatus !== null && typeof rawRuntimeStatus.entry_url === 'string') {
    try {
      const parsed = new URL(rawRuntimeStatus.entry_url);
      if (
        parsed.protocol === 'http:'
        && parsed.hostname === '127.0.0.1'
        && Number.isSafeInteger(Number(parsed.port))
        && Number(parsed.port) >= 1
        && Number(parsed.port) <= 65_535
        && parsed.username === ''
        && parsed.password === ''
      ) entryUrl = rawRuntimeStatus.entry_url;
    } catch { /* status remains address-free */ }
  }
  return freezeDeep({
    status_version: 'builder-live-preview-status-projection.v1',
    project_id: request.project_id,
    conversation_id: request.conversation_id,
    preview_kind: previewKind,
    entry_url: entryUrl,
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
    dev_server_approval: devServerApproval,
    runtime_launch_projection: runtimeLaunchProjection(
      request, status, previewKind, devServerApproval,
    ),
    unavailable_reason: unavailableReason,
    updated_at_ms: updatedAtMs,
    authority: {
      ...AUTHORITY,
      command_execution: previewKind === 'live_dev_server_web',
    },
  });
}

function failureReasonForPhase(phase) {
  return Object.hasOwn(FAILURE_REASON_BY_PHASE, phase)
    ? FAILURE_REASON_BY_PHASE[phase]
    : 'live_preview_runtime_unavailable';
}

function commandExecutionState(status, previewKind) {
  if (previewKind !== 'live_dev_server_web') return 'not_applicable';
  if (status === 'approval_required') return 'approval_required';
  if (status === 'ready' || status === 'reloading' || status === 'starting') return 'started';
  if (status === 'failed') return 'failed';
  return 'stopped';
}

function userApprovalState(status, previewKind, devServerApproval) {
  if (previewKind !== 'live_dev_server_web') return 'not_required';
  if (devServerApproval !== null) return 'required';
  if (status === 'ready' || status === 'reloading' || status === 'starting' || status === 'failed') {
    return 'approved_once';
  }
  return 'denied_or_expired';
}

function runtimeLaunchProjection(request, status, previewKind, devServerApproval) {
  return freezeDeep({
    projection_version: 'builder-project-runtime-launch-projection.v1',
    project_id: request.project_id,
    conversation_id: request.conversation_id,
    preview_kind: previewKind,
    source_status: status === 'idle'
      ? 'not_requested'
      : 'main_owned_verified',
    command_profile: previewKind === 'live_dev_server_web'
      ? 'main_owned_dev_server_profile'
      : 'none',
    user_approval: userApprovalState(status, previewKind, devServerApproval),
    command_execution: commandExecutionState(status, previewKind),
    dependency_preparation: 'not_allowed',
    package_install: 'not_allowed',
    sandbox_policy: previewKind === 'live_dev_server_web'
      ? 'dev_server_only_no_dependency_install'
      : 'static_preview_no_command_execution',
    provider_dispatch: false,
    tool_dispatch: false,
    project_workspace_write: 'not_granted_by_preview',
    authority: {
      projection_authority: 'main_owned_project_runtime_launch_projection_v1',
      renderer_authority: 'status_projection_only',
      path_disclosure: 'not_serialized',
    },
  });
}
function livePreviewPhaseError(phase) {
  const error = new Error('Builder live preview failed.');
  error.livePreviewFailurePhase = phase;
  return error;
}

function phaseFromError(error, fallbackPhase) {
  return error !== null
    && typeof error === 'object'
    && typeof error.livePreviewFailurePhase === 'string'
    ? error.livePreviewFailurePhase
    : fallbackPhase;
}

function sanitizeSourceResult(rawValue, request) {
  const value = exactObject(rawValue, SOURCE_RESULT_KEYS);
  const operation = value.operation.value;
  if (
    value.result_version.value !== BUILDER_LIVE_PREVIEW_CURRENT_DRAFT_SOURCE_RESULT_VERSION
    || value.service_version.value !== BUILDER_LIVE_PREVIEW_CURRENT_DRAFT_SOURCE_SERVICE_VERSION
    || (
      operation !== 'current_draft_live_preview_source_admitted'
      && operation !== 'saved_revision_live_preview_source_admitted'
    )
    || value.project_id.value !== request.project_id
    || value.conversation_id.value !== request.conversation_id
  ) fail();
  if (operation === 'current_draft_live_preview_source_admitted') {
    safePattern(value.draft_id.value, /^builder-generation-draft:[0-9a-f]{64}$/u);
  } else if (value.draft_id.value !== null) {
    fail();
  }
  const sourceAdmission = sanitizeBuilderLivePreviewSourceAdmission(value.source_admission.value);
  if (
    (operation === 'current_draft_live_preview_source_admitted'
      && sourceAdmission.source_ref.source_ref_kind !== 'current_draft_checkpoint_candidate')
    || (operation === 'saved_revision_live_preview_source_admitted'
      && sourceAdmission.source_ref.source_ref_kind !== 'saved_project_revision')
  ) fail();
  return sourceAdmission;
}

function runtimeAdmissionFromSource(sourceAdmission) {
  const draftCheckpointId = sourceAdmission.source_ref.source_ref_kind === 'current_draft_checkpoint_candidate'
    ? sourceAdmission.source_ref.checkpoint_id
    : null;
  const revisionReceiptDigest = sourceAdmission.source_ref.source_ref_kind === 'saved_project_revision'
    ? sourceAdmission.source_ref.revision_receipt_digest
    : null;
  return createBuilderLivePreviewAdmission({
    project_id: sourceAdmission.project_id,
    conversation_id: sourceAdmission.conversation_id,
    task_id: null,
    run_id: null,
    draft_checkpoint_id: draftCheckpointId,
    revision_receipt_digest: revisionReceiptDigest,
    source_tree_digest: sourceAdmission.source_tree_digest,
    selected_entry_path: sourceAdmission.selected_entry_path,
    preview_kind: sourceAdmission.preview_kind,
    admitted_at_ms: sourceAdmission.admitted_at_ms,
    expires_at_ms: sourceAdmission.expires_at_ms,
  });
}

function optionalOwnMethod(value, methodKey) {
  try {
    return ownMethod(value, methodKey);
  } catch {
    return null;
  }
}

function attachView(windowRef, view, requestedBounds, requestedVisible = true) {
  if (windowRef === null || typeof windowRef !== 'object' || utilTypes.isProxy(windowRef)) fail();
  const contentView = windowRef.contentView;
  if (contentView === null || typeof contentView !== 'object' || utilTypes.isProxy(contentView)) fail();
  const addChildView = ownMethod(contentView, 'addChildView');
  const removeChildView = ownMethod(contentView, 'removeChildView');
  const setBounds = ownMethod(view, 'setBounds');
  const setVisible = optionalOwnMethod(view, 'setVisible');
  const bounds = requestedBounds ?? fallbackBounds(windowRef);
  if (setVisible !== null) Reflect.apply(setVisible, view, [requestedVisible]);
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
      if (setVisible !== null) Reflect.apply(setVisible, view, [true]);
      return selected;
    },
    hide() {
      if (setVisible !== null) {
        Reflect.apply(setVisible, view, [false]);
      } else {
        Reflect.apply(setBounds, view, [{ x: -10_000, y: -10_000, width: 1, height: 1 }]);
      }
    },
  });
}

function sameRequest(left, right) {
  return left.project_id === right.project_id
    && left.conversation_id === right.conversation_id;
}

function createBuilderLivePreviewMainService(rawOptions) {
  const options = optionsObject(rawOptions);
  const sourceService = options.current_draft_source_service.value;
  const resolveCurrentDraft = ownMethod(sourceService, 'resolve_current_draft_preview_source');
  const runtime = options.webcontents_view_runtime.value;
  const startRuntime = ownMethod(runtime, 'start');
  const disposeRuntime = ownMethod(runtime, 'dispose');
  const mainWindowRef = options.mainWindowRef.value;
  const nowMs = options.now_ms.value;
  const devServerRuntime = options.dev_server_runtime?.value ?? null;
  const projectWorkspacePathService = options.project_workspace_path_service?.value ?? null;
  const startDevServer = devServerRuntime === null ? null : ownMethod(devServerRuntime, 'start');
  const shutdownDevServers = devServerRuntime === null ? null : ownMethod(devServerRuntime, 'shutdown');
  const resolveProjectWorkspacePath = projectWorkspacePathService === null
    ? null
    : ownMethod(projectWorkspacePathService, 'resolve_project_workspace_path');
  if (
    !isPlainObject(sourceService)
    || sourceService.service_version !== BUILDER_LIVE_PREVIEW_CURRENT_DRAFT_SOURCE_SERVICE_VERSION
    || typeof mainWindowRef !== 'function'
    || utilTypes.isProxy(mainWindowRef)
    || typeof nowMs !== 'function'
    || utilTypes.isProxy(nowMs)
    || (devServerRuntime === null) !== (projectWorkspacePathService === null)
    || (devServerRuntime !== null
      && devServerRuntime.runtime_version !== BUILDER_LIVE_PREVIEW_DEV_SERVER_RUNTIME_VERSION)
    || (projectWorkspacePathService !== null
      && projectWorkspacePathService.service_version !== 'builder-project-workspace-path-service.v1')
  ) fail();

  let active = null;
  let pendingLayout = null;
  let pendingDevApproval = null;
  let latestResult = null;
  let pendingOperation = Promise.resolve();

  function serializeOperation(operation) {
    return (request) => {
      const result = pendingOperation.then(async () => {
        latestResult = null;
        latestResult = await operation(request);
        return latestResult;
      });
      pendingOperation = result.catch(() => {});
      return result;
    };
  }

  async function stopActive() {
    if (active === null) return;
    const item = active;
    active = null;
    try { item.attachment.detach(); } catch { /* stop below destroys the view. */ }
    await item.handle.stop();
  }

  async function activateServer(request, sourceAdmission, runtimeAdmission, server, previewKind) {
    let handle = null;
    try {
      handle = await startRuntime({ admission: runtimeAdmission, static_server: server });
    } catch {
      throw livePreviewPhaseError('view_runtime');
    }
    let attachment;
    try {
      const view = handle.readMainOnlyWebContentsViewForAttachment();
      const windowRef = mainWindowRef();
      const requestedLayout = pendingLayout === null ? undefined
        : sameRequest(pendingLayout, request) ? pendingLayout.view_bounds : null;
      const requestedBounds = requestedLayout === null || requestedLayout === undefined
        ? undefined
        : constrainViewBounds(windowRef, requestedLayout);
      attachment = attachView(
        windowRef,
        view,
        requestedBounds,
        requestedLayout !== null,
      );
    } catch {
      try { await handle.stop(); } catch { /* failure below stays fixed. */ }
      throw livePreviewPhaseError('view_attachment');
    }
    active = freezeDeep({
      request, sourceAdmission, runtimeAdmission, handle, attachment, previewKind,
    });
    return statusProjection(
      request, 'ready', safeTimestamp(nowMs()), null, handle.readStatus(), previewKind,
    );
  }

  async function start(rawRequest) {
    const request = safeRequest(rawRequest);
    const now = safeTimestamp(nowMs());
    let staticServer = null;
    let phase = 'source';
    try {
      pendingDevApproval = null;
      if (active !== null) await stopActive();
      const sourceResult = await resolveCurrentDraft({
        project_id: request.project_id,
        conversation_id: request.conversation_id,
      });
      const sourceAdmission = sanitizeSourceResult(sourceResult, request);
      const runtimeAdmission = runtimeAdmissionFromSource(sourceAdmission);
      phase = 'static_server';
      const devProfile = discoverBuilderLivePreviewDevServerProfile({
        source_admission: sourceAdmission,
        source_tree: sourceAdmission.source_tree,
        discovered_at_ms: now,
      });
      if (devProfile !== null && startDevServer !== null && resolveProjectWorkspacePath !== null) {
        const workspace = await resolveProjectWorkspacePath({ project_id: request.project_id });
        if (
          !isPlainObject(workspace)
          || workspace.result_version !== 'builder-project-workspace-path-result.v1'
          || workspace.project_id !== request.project_id
          || workspace.authority !== 'main_owned_bound_project_workspace_path'
        ) fail();
        const approvalRequest = freezeDeep({
          request_version: 'builder-live-preview-dev-server-approval-request.v1',
          approval_request_id: `builder-live-preview-dev-server-approval-request:${nodeCrypto.randomUUID()}`,
          project_id: request.project_id,
          conversation_id: request.conversation_id,
          command_display: devProfile.command_display,
          source_tree_digest: sourceAdmission.source_tree_digest,
          risk_notice: 'This project script may modify files or use the network.',
          requested_at_ms: now,
          expires_at_ms: now + 5 * 60 * 1_000,
          decisions: ['allow_once', 'deny'],
        });
        pendingDevApproval = freezeDeep({
          request,
          approvalRequest,
          sourceAdmission,
          runtimeAdmission,
          devProfile,
          workspaceRootPath: workspace.project_root_path,
        });
        return statusProjection(
          request,
          'approval_required',
          now,
          null,
          null,
          'live_dev_server_web',
          approvalRequest,
        );
      }
      staticServer = await startBuilderLivePreviewStaticServer({
        admission: runtimeAdmission,
        source_tree: sourceAdmission.source_tree,
      });
      phase = 'view_runtime';
      return await activateServer(
        request, sourceAdmission, runtimeAdmission, staticServer, 'live_static_web',
      );
    } catch (error) {
      try {
        if (staticServer !== null) await staticServer.stop();
      } catch {
        // The renderer receives the fixed failed projection below.
      }
      try { await stopActive(); } catch { /* fixed failed projection below. */ }
      pendingDevApproval = null;
      return statusProjection(request, 'failed', now, failureReasonForPhase(phaseFromError(error, phase)));
    }
  }

  async function decideDevServerApproval(rawDecision) {
    const decision = exactObject(rawDecision, [
      'project_id', 'conversation_id', 'approval_request_id', 'decision',
    ]);
    const request = safeRequest({
      project_id: decision.project_id.value,
      conversation_id: decision.conversation_id.value,
    });
    const approvalRequestId = safePattern(
      decision.approval_request_id.value,
      /^builder-live-preview-dev-server-approval-request:[0-9a-f-]{36}$/u,
    );
    if (!['allow_once', 'deny'].includes(decision.decision.value)) fail();
    const pending = pendingDevApproval;
    if (
      pending === null
      || !sameRequest(pending.request, request)
      || pending.approvalRequest.approval_request_id !== approvalRequestId
    ) fail();
    pendingDevApproval = null;
    const now = safeTimestamp(nowMs());
    if (now >= pending.approvalRequest.expires_at_ms || decision.decision.value === 'deny') {
      return statusProjection(
        request, 'stopped', now, null, null, 'live_dev_server_web',
      );
    }
    let server = null;
    let phase = 'dev_server';
    try {
      const approval = createBuilderLivePreviewDevServerApproval({
        source_admission: pending.sourceAdmission,
        command_profile: pending.devProfile,
        approved_at_ms: now,
        expires_at_ms: Math.min(now + 5 * 60 * 1_000, pending.approvalRequest.expires_at_ms),
      });
      const devAdmission = createBuilderLivePreviewDevServerAdmission({
        source_admission: pending.sourceAdmission,
        command_profile: pending.devProfile,
        approval,
        admitted_at_ms: now,
        expires_at_ms: approval.expires_at_ms,
      });
      server = await startDevServer({
        source_admission: pending.sourceAdmission,
        source_tree: pending.sourceAdmission.source_tree,
        runtime_admission: pending.runtimeAdmission,
        dev_admission: devAdmission,
        workspace_root_path: pending.workspaceRootPath,
      });
      phase = 'view_runtime';
      return await activateServer(
        request,
        pending.sourceAdmission,
        pending.runtimeAdmission,
        server,
        'live_dev_server_web',
      );
    } catch (error) {
      try { await server?.stop(); } catch { /* fixed failed status below */ }
      try { await stopActive(); } catch { /* fixed failed status below */ }
      return statusProjection(
        request,
        'failed',
        now,
        failureReasonForPhase(phaseFromError(error, phase)),
        null,
        'live_dev_server_web',
      );
    }
  }

  async function reload(rawRequest) {
    const request = safeRequest(rawRequest);
    if (active === null || !sameRequest(active.request, request)) return start(request);
    let phase = 'source';
    try {
      const sourceAdmission = sanitizeSourceResult(await resolveCurrentDraft(request), request);
      if (sourceAdmission.source_tree_digest !== active.sourceAdmission.source_tree_digest
        || sourceAdmission.selected_entry_path !== active.sourceAdmission.selected_entry_path) {
        return start(request);
      }
      phase = 'view_runtime';
      await active.handle.reload();
      return statusProjection(
        request,
        'ready',
        safeTimestamp(nowMs()),
        null,
        active.handle.readStatus(),
        active.previewKind,
      );
    } catch (error) {
      const previewKind = active?.previewKind ?? 'live_static_web';
      try { await stopActive(); } catch { /* fixed failed projection below. */ }
      return statusProjection(request, 'failed', safeTimestamp(nowMs()),
        failureReasonForPhase(phaseFromError(error, phase)), null, previewKind);
    }
  }

  async function stop(rawRequest) {
    const request = safeRequest(rawRequest);
    if (pendingDevApproval !== null && sameRequest(pendingDevApproval.request, request)) {
      pendingDevApproval = null;
      return statusProjection(
        request, 'stopped', safeTimestamp(nowMs()), null, null, 'live_dev_server_web',
      );
    }
    const previewKind = active !== null && sameRequest(active.request, request)
      ? active.previewKind
      : 'live_static_web';
    const runtimeStatus = active !== null && sameRequest(active.request, request)
      ? active.handle.readStatus()
      : null;
    if (active !== null && sameRequest(active.request, request)) await stopActive();
    return statusProjection(
      request, 'stopped', safeTimestamp(nowMs()), null, runtimeStatus, previewKind,
    );
  }

  function readStatus(rawRequest) {
    const request = safeRequest(rawRequest);
    if (pendingDevApproval !== null && sameRequest(pendingDevApproval.request, request)) {
      return statusProjection(
        request,
        'approval_required',
        safeTimestamp(nowMs()),
        null,
        null,
        'live_dev_server_web',
        pendingDevApproval.approvalRequest,
      );
    }
    if (active === null || !sameRequest(active.request, request)) {
      if (latestResult !== null && sameRequest(latestResult, request)) return latestResult;
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
      active.previewKind,
    );
  }

  function updateLayout(rawRequest) {
    const request = safeLayoutRequest(rawRequest);
    const windowRef = mainWindowRef();
    const viewBounds = request.view_bounds === null
      ? null
      : constrainViewBounds(windowRef, request.view_bounds);
    pendingLayout = freezeDeep({ ...request, view_bounds: viewBounds });
    if (active !== null && sameRequest(active.request, request)) {
      if (viewBounds === null) active.attachment.hide();
      else active.attachment.update(viewBounds);
    } else if (active !== null) {
      active.attachment.hide();
    }
    return readStatus({
      project_id: request.project_id,
      conversation_id: request.conversation_id,
    });
  }

  return freezeDeep({
    service_version: BUILDER_LIVE_PREVIEW_MAIN_SERVICE_VERSION,
    request_current_draft_live_preview: serializeOperation(start),
    decide_current_live_preview_dev_server: serializeOperation(decideDevServerApproval),
    reload_current_live_preview: serializeOperation(reload),
    stop_current_live_preview: serializeOperation(stop),
    read_current_live_preview_status: readStatus,
    update_current_live_preview_layout: updateLayout,
    async shutdown() {
      await pendingOperation;
      let cleanupRequired = false;
      pendingDevApproval = null;
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
      if (shutdownDevServers !== null) {
        try { await shutdownDevServers(); } catch { cleanupRequired = true; }
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
