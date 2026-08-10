'use strict';

const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderLivePreviewAdmission,
} = require('./builder-live-preview-run.cjs');

const BUILDER_LIVE_PREVIEW_WEBCONTENTS_VIEW_RUNTIME_VERSION =
  'builder-live-preview-webcontents-view-runtime.v1';
const BUILDER_LIVE_PREVIEW_WEBCONTENTS_VIEW_HANDLE_VERSION =
  'builder-live-preview-webcontents-view-handle.v1';
const STATIC_SERVER_VERSION = 'builder-live-preview-static-server.v1';
const OPTION_KEYS = Object.freeze(['WebContentsView', 'session', 'nowMs']);
const START_KEYS = Object.freeze(['admission', 'static_server']);
const STATIC_SERVER_KEYS = Object.freeze([
  'server_version',
  'project_id',
  'admission_id',
  'source_tree_digest',
  'preview_origin',
  'entry_url',
  'stop',
]);
const STATUS_KEYS = Object.freeze([
  'status_version',
  'admission_id',
  'project_id',
  'status',
  'preview_origin',
  'entry_url',
  'partition',
  'navigation_block_count',
  'network_block_count',
  'permission_block_count',
  'download_block_count',
  'window_open_block_count',
  'started_at_ms',
  'stopped_at_ms',
  'authority',
]);
const AUTHORITY_KEYS = Object.freeze([
  'live_preview_authority',
  'electron_view_creation',
  'renderer_authority',
  'ipc_authority',
  'provider_dispatch',
  'tool_dispatch',
  'command_execution',
  'source_write',
  'git_mutation',
  'sqlite_write',
  'permission_grant',
  'external_navigation',
  'network_access',
  'node_integration',
  'context_isolation',
  'sandbox',
  'preload_script',
  'downloads',
  'new_windows',
  'session_persistence',
]);
const AUTHORITY = Object.freeze({
  live_preview_authority: 'main_webcontents_view_runtime_v1',
  electron_view_creation: 'performed_by_preview_runtime',
  renderer_authority: 'not_present',
  ipc_authority: 'not_present',
  provider_dispatch: 'not_performed',
  tool_dispatch: 'not_performed',
  command_execution: 'not_performed',
  source_write: 'not_present',
  git_mutation: 'not_performed',
  sqlite_write: 'not_performed',
  permission_grant: 'not_performed',
  external_navigation: 'blocked',
  network_access: 'admitted_preview_origin_only',
  node_integration: 'disabled',
  context_isolation: 'enabled',
  sandbox: 'enabled',
  preload_script: 'not_configured',
  downloads: 'blocked',
  new_windows: 'blocked',
  session_persistence: 'non_persistent',
});
const WEB_PREFERENCES = Object.freeze({
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  devTools: false,
  webviewTag: false,
  allowRunningInsecureContent: false,
});
const PREVIEW_ORIGIN_PATTERN = /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/u;
const PREVIEW_URL_PATTERN = /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/[A-Za-z0-9._~!$&'()*+,;=:@/%-]*$/u;
const ERROR_MESSAGES = Object.freeze({
  builder_live_preview_webcontents_view_runtime_invalid:
    'Builder live preview browser runtime is unavailable.',
  builder_live_preview_webcontents_view_runtime_conflict:
    'Builder live preview browser runtime is already active.',
  builder_live_preview_webcontents_view_runtime_failed:
    'Builder live preview browser runtime is unavailable.',
  builder_live_preview_webcontents_view_runtime_cleanup_required:
    'Builder live preview browser runtime cleanup is required.',
});

class BuilderLivePreviewWebContentsViewRuntimeError extends Error {
  constructor(code = 'builder_live_preview_webcontents_view_runtime_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_live_preview_webcontents_view_runtime_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderLivePreviewWebContentsViewRuntimeError';
    this.code = selected;
    this.retryable = selected === 'builder_live_preview_webcontents_view_runtime_cleanup_required';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderLivePreviewWebContentsViewRuntimeError(code);
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

function exactObject(value, keys, code) {
  if (!isPlainObject(value)) fail(code);
  const own = Reflect.ownKeys(value);
  if (
    own.length !== keys.length
    || own.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail(code);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail(code);
    }
  }
}

function valueAt(value, key, code) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail(code);
  return descriptor.value;
}

function stableMethod(value, key, code) {
  let cursor = value;
  while (cursor !== null) {
    if (utilTypes.isProxy(cursor)) fail(code);
    const descriptor = Object.getOwnPropertyDescriptor(cursor, key);
    if (descriptor) {
      if (
        !Object.hasOwn(descriptor, 'value')
        || typeof descriptor.value !== 'function'
        || utilTypes.isProxy(descriptor.value)
      ) fail(code);
      return descriptor.value;
    }
    cursor = Object.getPrototypeOf(cursor);
  }
  fail(code);
}

function safeOptions(value) {
  try {
    exactObject(value, OPTION_KEYS);
    const WebContentsView = valueAt(value, 'WebContentsView');
    const session = valueAt(value, 'session');
    const nowMs = valueAt(value, 'nowMs');
    if (
      typeof WebContentsView !== 'function'
      || utilTypes.isProxy(WebContentsView)
      || session === null
      || typeof session !== 'object'
      || utilTypes.isProxy(session)
      || typeof nowMs !== 'function'
      || utilTypes.isProxy(nowMs)
    ) fail();
    return Object.freeze({
      WebContentsView,
      session,
      sessionFromPartition: stableMethod(session, 'fromPartition'),
      nowMs,
    });
  } catch (error) {
    if (error instanceof BuilderLivePreviewWebContentsViewRuntimeError) throw error;
    fail();
  }
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeUrl(value, pattern, maximum) {
  if (typeof value !== 'string' || value.length > maximum || !pattern.test(value)) fail();
  const parsed = new URL(value);
  const port = Number(parsed.port);
  if (
    parsed.protocol !== 'http:'
    || parsed.hostname !== '127.0.0.1'
    || parsed.username !== ''
    || parsed.password !== ''
    || !Number.isSafeInteger(port)
    || port < 1
    || port > 65_535
  ) fail();
  return value;
}

function sameAdmittedOrigin(url, previewOrigin) {
  try {
    const parsed = new URL(url);
    return parsed.origin === previewOrigin
      && parsed.protocol === 'http:'
      && parsed.hostname === '127.0.0.1'
      && parsed.username === ''
      && parsed.password === '';
  } catch {
    return false;
  }
}

function safeStaticServer(rawServer, admission) {
  exactObject(rawServer, STATIC_SERVER_KEYS);
  const serverVersion = valueAt(rawServer, 'server_version');
  const projectId = valueAt(rawServer, 'project_id');
  const admissionId = valueAt(rawServer, 'admission_id');
  const sourceTreeDigest = valueAt(rawServer, 'source_tree_digest');
  const previewOrigin = safeUrl(valueAt(rawServer, 'preview_origin'), PREVIEW_ORIGIN_PATTERN, 64);
  const entryUrl = safeUrl(valueAt(rawServer, 'entry_url'), PREVIEW_URL_PATTERN, 2_048);
  const stop = valueAt(rawServer, 'stop');
  if (
    serverVersion !== STATIC_SERVER_VERSION
    || projectId !== admission.project_id
    || admissionId !== admission.admission_id
    || sourceTreeDigest !== admission.source_tree_digest
    || !entryUrl.startsWith(`${previewOrigin}/`)
    || typeof stop !== 'function'
    || utilTypes.isProxy(stop)
  ) fail();
  return Object.freeze({
    server_version: serverVersion,
    project_id: projectId,
    admission_id: admissionId,
    source_tree_digest: sourceTreeDigest,
    preview_origin: previewOrigin,
    entry_url: entryUrl,
    stop,
  });
}

function sessionPartitionFor(admission) {
  return `builder-live-preview-${admission.admission_id.slice('builder-live-preview-admission:'.length)}`;
}

function safeElectronSession(value, partition) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) fail();
  const webRequest = value.webRequest;
  if (webRequest === null || typeof webRequest !== 'object' || utilTypes.isProxy(webRequest)) fail();
  return Object.freeze({
    session: value,
    partition,
    setPermissionRequestHandler: stableMethod(value, 'setPermissionRequestHandler'),
    setPermissionCheckHandler: stableMethod(value, 'setPermissionCheckHandler'),
    clearStorageData: stableMethod(value, 'clearStorageData'),
    on: stableMethod(value, 'on'),
    onBeforeRequest: stableMethod(webRequest, 'onBeforeRequest'),
    webRequest,
  });
}

function safeWebContents(value) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) fail();
  return Object.freeze({
    webContents: value,
    setWindowOpenHandler: stableMethod(value, 'setWindowOpenHandler'),
    on: stableMethod(value, 'on'),
    loadURL: stableMethod(value, 'loadURL'),
    destroy: stableMethod(value, 'destroy'),
    isDestroyed: stableMethod(value, 'isDestroyed'),
  });
}

function createView(WebContentsView, electronSession) {
  try {
    const view = new WebContentsView({
      webPreferences: {
        ...WEB_PREFERENCES,
        partition: electronSession.partition,
      },
    });
    if (view === null || typeof view !== 'object' || utilTypes.isProxy(view)) fail();
    return view;
  } catch (error) {
    if (error instanceof BuilderLivePreviewWebContentsViewRuntimeError) throw error;
    fail('builder_live_preview_webcontents_view_runtime_failed');
  }
}

function installPolicies(state, electronSession, safeContents) {
  Reflect.apply(electronSession.setPermissionRequestHandler, electronSession.session, [
    (_webContents, _permission, callback) => {
      state.permission_block_count += 1;
      callback(false);
    },
  ]);
  Reflect.apply(electronSession.setPermissionCheckHandler, electronSession.session, [
    () => {
      state.permission_block_count += 1;
      return false;
    },
  ]);
  Reflect.apply(safeContents.setWindowOpenHandler, safeContents.webContents, [
    () => {
      state.window_open_block_count += 1;
      return { action: 'deny' };
    },
  ]);
  Reflect.apply(electronSession.on, electronSession.session, [
    'will-download',
    (event) => {
      state.download_block_count += 1;
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
    },
  ]);
  Reflect.apply(safeContents.on, safeContents.webContents, [
    'will-navigate',
    (event, url) => {
      if (sameAdmittedOrigin(url, state.preview_origin)) return;
      state.navigation_block_count += 1;
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
    },
  ]);
  Reflect.apply(safeContents.on, safeContents.webContents, [
    'will-frame-navigate',
    (event, url) => {
      if (sameAdmittedOrigin(url, state.preview_origin)) return;
      state.navigation_block_count += 1;
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
    },
  ]);
  Reflect.apply(electronSession.onBeforeRequest, electronSession.webRequest, [
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'ftp://*/*', 'file:///*'] },
    (details, callback) => {
      if (details && sameAdmittedOrigin(details.url, state.preview_origin)) {
        callback({ cancel: false });
        return;
      }
      state.network_block_count += 1;
      callback({ cancel: true });
    },
  ]);
}

function statusFor(state) {
  exactObject(AUTHORITY, AUTHORITY_KEYS);
  const status = {
    status_version: 'builder-live-preview-webcontents-view-status.v1',
    admission_id: state.admission_id,
    project_id: state.project_id,
    status: state.status,
    preview_origin: state.preview_origin,
    entry_url: state.entry_url,
    partition: state.partition,
    navigation_block_count: state.navigation_block_count,
    network_block_count: state.network_block_count,
    permission_block_count: state.permission_block_count,
    download_block_count: state.download_block_count,
    window_open_block_count: state.window_open_block_count,
    started_at_ms: state.started_at_ms,
    stopped_at_ms: state.stopped_at_ms,
    authority: AUTHORITY,
  };
  exactObject(status, STATUS_KEYS);
  return freezeDeep(status);
}

async function stopHandle(state) {
  if (state.status === 'stopped') return statusFor(state);
  state.status = 'stopped';
  state.stopped_at_ms = safeTimestamp(Reflect.apply(state.nowMs, undefined, []));
  let cleanupFailed = false;
  try {
    if (!Reflect.apply(state.isDestroyed, state.webContents, [])) {
      Reflect.apply(state.destroy, state.webContents, []);
    }
  } catch {
    cleanupFailed = true;
  }
  try {
    await Reflect.apply(state.clearStorageData, state.electronSession, [{}]);
  } catch {
    cleanupFailed = true;
  }
  try {
    await Reflect.apply(state.stopServer, undefined, []);
  } catch {
    cleanupFailed = true;
  }
  state.activeMap.delete(state.admission_id);
  if (cleanupFailed) fail('builder_live_preview_webcontents_view_runtime_cleanup_required');
  return statusFor(state);
}

async function startPreview(options, activeMap, rawInput) {
  try {
    exactObject(rawInput, START_KEYS);
    const admission = sanitizeBuilderLivePreviewAdmission(valueAt(rawInput, 'admission'));
    const now = safeTimestamp(Reflect.apply(options.nowMs, undefined, []));
    if (now < admission.admitted_at_ms || now >= admission.expires_at_ms) fail();
    if (activeMap.has(admission.admission_id)) {
      fail('builder_live_preview_webcontents_view_runtime_conflict');
    }
    const staticServer = safeStaticServer(valueAt(rawInput, 'static_server'), admission);
    const partition = sessionPartitionFor(admission);
    const electronSession = safeElectronSession(Reflect.apply(
      options.sessionFromPartition,
      options.session,
      [partition],
    ), partition);
    const view = createView(options.WebContentsView, electronSession);
    const safeContents = safeWebContents(view.webContents);
    const state = {
      admission_id: admission.admission_id,
      project_id: admission.project_id,
      source_tree_digest: admission.source_tree_digest,
      preview_origin: staticServer.preview_origin,
      entry_url: staticServer.entry_url,
      partition,
      status: 'loading',
      navigation_block_count: 0,
      network_block_count: 0,
      permission_block_count: 0,
      download_block_count: 0,
      window_open_block_count: 0,
      started_at_ms: now,
      stopped_at_ms: null,
      view,
      webContents: safeContents.webContents,
      electronSession: electronSession.session,
      destroy: safeContents.destroy,
      isDestroyed: safeContents.isDestroyed,
      clearStorageData: electronSession.clearStorageData,
      stopServer: staticServer.stop,
      nowMs: options.nowMs,
      activeMap,
    };
    installPolicies(state, electronSession, safeContents);
    activeMap.set(admission.admission_id, state);
    try {
      await Reflect.apply(safeContents.loadURL, safeContents.webContents, [staticServer.entry_url]);
      if (state.status !== 'stopped') state.status = 'ready';
    } catch {
      activeMap.delete(admission.admission_id);
      state.status = 'failed';
      try {
        await stopHandle(state);
      } catch {
        // The fixed load failure below is more useful than a cleanup detail here.
      }
      fail('builder_live_preview_webcontents_view_runtime_failed');
    }
    const handle = {
      handle_version: BUILDER_LIVE_PREVIEW_WEBCONTENTS_VIEW_HANDLE_VERSION,
      admission_id: admission.admission_id,
      project_id: admission.project_id,
      readStatus() {
        return statusFor(state);
      },
      readMainOnlyWebContentsViewForAttachment() {
        return state.view;
      },
      async reload() {
        if (state.status === 'stopped') fail('builder_live_preview_webcontents_view_runtime_failed');
        state.status = 'loading';
        await Reflect.apply(safeContents.loadURL, safeContents.webContents, [staticServer.entry_url]);
        state.status = 'ready';
        return statusFor(state);
      },
      async stop() {
        return stopHandle(state);
      },
    };
    return Object.freeze(handle);
  } catch (error) {
    if (error instanceof BuilderLivePreviewWebContentsViewRuntimeError) throw error;
    fail();
  }
}

function createBuilderLivePreviewWebContentsViewRuntime(rawOptions) {
  const options = safeOptions(rawOptions);
  const activeMap = new Map();
  return Object.freeze({
    runtime_version: BUILDER_LIVE_PREVIEW_WEBCONTENTS_VIEW_RUNTIME_VERSION,
    async start(rawInput) {
      return startPreview(options, activeMap, rawInput);
    },
    activeCount() {
      return activeMap.size;
    },
    async dispose() {
      const handles = [...activeMap.values()].map((state) => stopHandle(state));
      await Promise.all(handles);
      return Object.freeze({ disposed: true });
    },
  });
}

module.exports = Object.freeze({
  BUILDER_LIVE_PREVIEW_WEBCONTENTS_VIEW_RUNTIME_VERSION,
  BUILDER_LIVE_PREVIEW_WEBCONTENTS_VIEW_HANDLE_VERSION,
  BuilderLivePreviewWebContentsViewRuntimeError,
  createBuilderLivePreviewWebContentsViewRuntime,
});
