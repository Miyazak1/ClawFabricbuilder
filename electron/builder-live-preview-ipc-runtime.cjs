'use strict';

const { types: utilTypes } = require('node:util');

const {
  READ_CURRENT_LIVE_PREVIEW_STATUS_CHANNEL,
  RELOAD_CURRENT_LIVE_PREVIEW_CHANNEL,
  REQUEST_CURRENT_DRAFT_LIVE_PREVIEW_CHANNEL,
  STOP_CURRENT_LIVE_PREVIEW_CHANNEL,
  createBuilderLivePreviewIpcAdapter,
} = require('./builder-live-preview-ipc-adapter.cjs');

const BUILDER_LIVE_PREVIEW_IPC_RUNTIME_VERSION = 'builder-live-preview-ipc-runtime.v1';
const BUILDER_LIVE_PREVIEW_UNAVAILABLE_SERVICE_VERSION =
  'builder-live-preview-unavailable-service.v1';
const OPTION_KEYS = Object.freeze(['ipcMain', 'mainWindowRef', 'livePreviewService']);
const SERVICE_KEYS = Object.freeze([
  'service_version',
  'request_current_draft_live_preview',
  'reload_current_live_preview',
  'stop_current_live_preview',
  'read_current_live_preview_status',
  'shutdown',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_live_preview_ipc_runtime_unavailable: 'Live preview is unavailable.',
  builder_live_preview_ipc_runtime_cleanup_required: 'Live preview cleanup is required.',
});
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

class BuilderLivePreviewIpcRuntimeError extends Error {
  constructor(code = 'builder_live_preview_ipc_runtime_unavailable') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_live_preview_ipc_runtime_unavailable';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderLivePreviewIpcRuntimeError';
    this.code = selected;
    this.retryable = selected === 'builder_live_preview_ipc_runtime_cleanup_required';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderLivePreviewIpcRuntimeError(code);
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

function exactDescriptors(value, keys) {
  if (!isPlainObject(value)) fail();
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length
    || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail();
    }
  }
  return descriptors;
}

function stableMethod(value, key) {
  let cursor = value;
  while (cursor !== null) {
    if (utilTypes.isProxy(cursor)) fail();
    const descriptor = Object.getOwnPropertyDescriptor(cursor, key);
    if (descriptor) {
      if (
        !Object.hasOwn(descriptor, 'value')
        || typeof descriptor.value !== 'function'
        || utilTypes.isProxy(descriptor.value)
      ) fail();
      return descriptor.value;
    }
    cursor = Object.getPrototypeOf(cursor);
  }
  fail();
}

function safeService(value) {
  const descriptors = exactDescriptors(value, SERVICE_KEYS);
  if (typeof descriptors.service_version.value !== 'string') fail();
  for (const key of SERVICE_KEYS) {
    if (key === 'service_version') continue;
    if (
      typeof descriptors[key].value !== 'function'
      || utilTypes.isProxy(descriptors[key].value)
    ) fail();
  }
  return value;
}

function safeOptions(value) {
  try {
    const descriptors = exactDescriptors(value, OPTION_KEYS);
    const ipcMain = descriptors.ipcMain.value;
    const mainWindowRef = descriptors.mainWindowRef.value;
    if (
      ipcMain === null
      || typeof ipcMain !== 'object'
      || utilTypes.isProxy(ipcMain)
      || typeof mainWindowRef !== 'function'
      || utilTypes.isProxy(mainWindowRef)
    ) fail();
    return Object.freeze({
      ipcMain,
      handle: stableMethod(ipcMain, 'handle'),
      removeHandler: stableMethod(ipcMain, 'removeHandler'),
      mainWindowRef,
      livePreviewService: safeService(descriptors.livePreviewService.value),
    });
  } catch {
    fail();
  }
}

function unavailableStatus(request, status = 'unavailable') {
  return Object.freeze({
    status_version: 'builder-live-preview-status-projection.v1',
    project_id: request.project_id,
    conversation_id: request.conversation_id,
    preview_kind: 'live_static_web',
    status,
    can_start: false,
    can_reload: false,
    can_stop: false,
    message: status === 'stopped'
      ? 'Live preview is stopped.'
      : 'Live preview is unavailable until a main-owned preview source resolver is connected.',
    unavailable_reason: status === 'stopped' ? null : 'preview_source_resolver_not_connected',
    updated_at_ms: Date.now(),
    authority: AUTHORITY,
  });
}

function createUnavailableBuilderLivePreviewService() {
  return Object.freeze({
    service_version: BUILDER_LIVE_PREVIEW_UNAVAILABLE_SERVICE_VERSION,
    request_current_draft_live_preview(request) {
      return Promise.resolve(unavailableStatus(request));
    },
    reload_current_live_preview(request) {
      return Promise.resolve(unavailableStatus(request));
    },
    stop_current_live_preview(request) {
      return Promise.resolve(unavailableStatus(request, 'stopped'));
    },
    read_current_live_preview_status(request) {
      return Promise.resolve(unavailableStatus(request));
    },
    shutdown() {
      return Promise.resolve(Object.freeze({ shutdown: true }));
    },
  });
}

function createBuilderLivePreviewIpcRuntime(rawOptions) {
  const options = safeOptions(rawOptions);
  let adapter;
  try {
    adapter = createBuilderLivePreviewIpcAdapter({
      requestCurrentDraftLivePreview:
        options.livePreviewService.request_current_draft_live_preview,
      reloadCurrentLivePreview: options.livePreviewService.reload_current_live_preview,
      stopCurrentLivePreview: options.livePreviewService.stop_current_live_preview,
      readCurrentLivePreviewStatus: options.livePreviewService.read_current_live_preview_status,
      mainWindowRef: options.mainWindowRef,
    });
  } catch {
    fail();
  }

  const handlers = Object.freeze([
    Object.freeze({
      channel: REQUEST_CURRENT_DRAFT_LIVE_PREVIEW_CHANNEL,
      invoke: adapter.channels.requestCurrentDraftPreview.invoke,
    }),
    Object.freeze({
      channel: RELOAD_CURRENT_LIVE_PREVIEW_CHANNEL,
      invoke: adapter.channels.reloadCurrentPreview.invoke,
    }),
    Object.freeze({
      channel: STOP_CURRENT_LIVE_PREVIEW_CHANNEL,
      invoke: adapter.channels.stopCurrentPreview.invoke,
    }),
    Object.freeze({
      channel: READ_CURRENT_LIVE_PREVIEW_STATUS_CHANNEL,
      invoke: adapter.channels.readCurrentPreviewStatus.invoke,
    }),
  ]);
  const installed = [];
  let state = 'idle';

  function removeInstalledHandlers() {
    let failed = false;
    for (const entry of [...installed].reverse()) {
      try {
        Reflect.apply(options.removeHandler, options.ipcMain, [entry.channel]);
        installed.splice(installed.indexOf(entry), 1);
      } catch {
        failed = true;
      }
    }
    return failed === false;
  }

  return Object.freeze({
    runtime_version: BUILDER_LIVE_PREVIEW_IPC_RUNTIME_VERSION,
    channels: Object.freeze(handlers.map(({ channel }) => channel)),
    register() {
      if (state !== 'idle') fail();
      try {
        for (const entry of handlers) {
          Reflect.apply(options.handle, options.ipcMain, [entry.channel, entry.invoke]);
          installed.push(entry);
        }
        state = 'registered';
        return true;
      } catch {
        state = removeInstalledHandlers() ? 'idle' : 'cleanup_required';
        fail(state === 'cleanup_required'
          ? 'builder_live_preview_ipc_runtime_cleanup_required'
          : undefined);
      }
      return false;
    },
    dispose() {
      if (state === 'disposed') return false;
      if (state === 'idle') {
        state = 'disposed';
        return false;
      }
      if (!removeInstalledHandlers()) {
        state = 'cleanup_required';
        fail('builder_live_preview_ipc_runtime_cleanup_required');
      }
      state = 'disposed';
      return true;
    },
    async shutdown() {
      let disposed = false;
      try {
        disposed = this.dispose();
      } finally {
        await options.livePreviewService.shutdown();
      }
      return disposed;
    },
  });
}

module.exports = Object.freeze({
  BUILDER_LIVE_PREVIEW_IPC_RUNTIME_VERSION,
  BUILDER_LIVE_PREVIEW_UNAVAILABLE_SERVICE_VERSION,
  BuilderLivePreviewIpcRuntimeError,
  createBuilderLivePreviewIpcRuntime,
  createUnavailableBuilderLivePreviewService,
});
