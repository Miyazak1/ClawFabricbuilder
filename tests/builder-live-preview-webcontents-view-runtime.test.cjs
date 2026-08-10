'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderLivePreviewAdmission,
} = require('../electron/builder-live-preview-run.cjs');
const {
  BUILDER_LIVE_PREVIEW_WEBCONTENTS_VIEW_RUNTIME_VERSION,
  BUILDER_LIVE_PREVIEW_WEBCONTENTS_VIEW_HANDLE_VERSION,
  BuilderLivePreviewWebContentsViewRuntimeError,
  createBuilderLivePreviewWebContentsViewRuntime,
} = require('../electron/builder-live-preview-webcontents-view-runtime.cjs');

const PROJECT_ID = 'builder-project:11111111-1111-4111-8111-111111111111';
const CONVERSATION_ID = 'builder-conversation:22222222-2222-4222-8222-222222222222';
const TASK_ID = 'builder-task:33333333-3333-4333-8333-333333333333';
const RUN_ID = 'builder-run:44444444-4444-4444-8444-444444444444';
const SOURCE_TREE_DIGEST = `sha256:${'a'.repeat(64)}`;
const SERVER_CALLS = new WeakMap();

function admission(overrides = {}) {
  return createBuilderLivePreviewAdmission({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    draft_checkpoint_id: null,
    source_tree_digest: SOURCE_TREE_DIGEST,
    selected_entry_path: 'index.html',
    preview_kind: 'live_static_web',
    admitted_at_ms: 1_000,
    expires_at_ms: 60_000,
    ...overrides,
  });
}

function staticServer(value = admission(), overrides = {}) {
  const calls = [];
  const server = {
    server_version: 'builder-live-preview-static-server.v1',
    project_id: value.project_id,
    admission_id: value.admission_id,
    source_tree_digest: value.source_tree_digest,
    preview_origin: 'http://127.0.0.1:49231',
    entry_url: 'http://127.0.0.1:49231/index.html',
    async stop() {
      calls.push('stop');
      return { stopped: true };
    },
    ...overrides,
  };
  SERVER_CALLS.set(server, calls);
  return server;
}

function electronHarness({ loadFailure = false, clearFailure = false } = {}) {
  const views = [];
  const sessions = [];
  class WebContentsView {
    constructor(options) {
      const handlers = new Map();
      let destroyed = false;
      const webContents = {
        loadedUrls: [],
        handlers,
        windowOpenHandler: null,
        setWindowOpenHandler(handler) {
          webContents.windowOpenHandler = handler;
        },
        on(eventName, handler) {
          handlers.set(eventName, handler);
        },
        async loadURL(url) {
          if (loadFailure) throw new Error('private load failure');
          webContents.loadedUrls.push(url);
        },
        destroy() {
          destroyed = true;
        },
        isDestroyed() {
          return destroyed;
        },
      };
      this.options = options;
      this.webContents = webContents;
      views.push(this);
    }
  }
  const session = {
    fromPartition(partition) {
      const handlers = new Map();
      const webRequest = {
        filter: null,
        handler: null,
        onBeforeRequest(filter, handler) {
          webRequest.filter = filter;
          webRequest.handler = handler;
        },
      };
      const item = {
        partition,
        handlers,
        webRequest,
        permissionRequestHandler: null,
        permissionCheckHandler: null,
        clearStorageCalls: [],
        setPermissionRequestHandler(handler) {
          item.permissionRequestHandler = handler;
        },
        setPermissionCheckHandler(handler) {
          item.permissionCheckHandler = handler;
        },
        on(eventName, handler) {
          handlers.set(eventName, handler);
        },
        async clearStorageData(options) {
          if (clearFailure) throw new Error('private clear failure');
          item.clearStorageCalls.push(options);
        },
      };
      sessions.push(item);
      return item;
    },
  };
  return { WebContentsView, session, sessions, views };
}

function runtimeFor(harness, now = 2_000) {
  return createBuilderLivePreviewWebContentsViewRuntime({
    WebContentsView: harness.WebContentsView,
    session: harness.session,
    nowMs: () => now,
  });
}

function assertFixedError(operation, code) {
  assert.throws(
    operation,
    (error) => error instanceof BuilderLivePreviewWebContentsViewRuntimeError
      && error.code === code
      && error.message === 'Builder live preview browser runtime is unavailable.'
      && error.stack === `${error.name}: ${error.message}`
      && !`${error.message}:${error.stack}`.includes('private'),
  );
}

async function assertFixedAsyncError(operation, code) {
  await assert.rejects(
    operation,
    (error) => error instanceof BuilderLivePreviewWebContentsViewRuntimeError
      && error.code === code
      && !`${error.message}:${error.stack}`.includes('private'),
  );
}

test('creates a dedicated non-persistent WebContentsView with safe web preferences', async () => {
  const previewAdmission = admission();
  const server = staticServer(previewAdmission);
  const harness = electronHarness();
  const runtime = runtimeFor(harness);

  assert.equal(
    BUILDER_LIVE_PREVIEW_WEBCONTENTS_VIEW_RUNTIME_VERSION,
    'builder-live-preview-webcontents-view-runtime.v1',
  );
  assert.equal(runtime.runtime_version, BUILDER_LIVE_PREVIEW_WEBCONTENTS_VIEW_RUNTIME_VERSION);

  const handle = await runtime.start({ admission: previewAdmission, static_server: server });

  assert.equal(handle.handle_version, BUILDER_LIVE_PREVIEW_WEBCONTENTS_VIEW_HANDLE_VERSION);
  assert.equal(handle.admission_id, previewAdmission.admission_id);
  assert.equal(handle.project_id, PROJECT_ID);
  assert.equal(harness.views.length, 1);
  assert.equal(harness.sessions.length, 1);
  assert.equal(harness.sessions[0].partition.startsWith('builder-live-preview-'), true);
  assert.equal(harness.sessions[0].partition.startsWith('persist:'), false);
  assert.deepEqual(harness.views[0].options.webPreferences, {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    devTools: false,
    webviewTag: false,
    allowRunningInsecureContent: false,
    partition: harness.sessions[0].partition,
  });
  assert.equal(Object.hasOwn(harness.views[0].options.webPreferences, 'preload'), false);
  assert.deepEqual(harness.views[0].webContents.loadedUrls, [server.entry_url]);
  assert.equal(handle.readMainOnlyWebContentsViewForAttachment(), harness.views[0]);
  assert.deepEqual(handle.readStatus(), {
    status_version: 'builder-live-preview-webcontents-view-status.v1',
    admission_id: previewAdmission.admission_id,
    project_id: PROJECT_ID,
    status: 'ready',
    preview_origin: server.preview_origin,
    entry_url: server.entry_url,
    partition: harness.sessions[0].partition,
    navigation_block_count: 0,
    network_block_count: 0,
    permission_block_count: 0,
    download_block_count: 0,
    window_open_block_count: 0,
    started_at_ms: 2_000,
    stopped_at_ms: null,
    authority: {
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
    },
  });
});

test('installs permission, window, download, navigation, and network deny policies', async () => {
  const previewAdmission = admission();
  const server = staticServer(previewAdmission);
  const harness = electronHarness();
  const runtime = runtimeFor(harness);
  const handle = await runtime.start({ admission: previewAdmission, static_server: server });
  const electronSession = harness.sessions[0];
  const webContents = harness.views[0].webContents;

  let permissionDecision = true;
  electronSession.permissionRequestHandler({}, 'media', (allowed) => {
    permissionDecision = allowed;
  });
  assert.equal(permissionDecision, false);
  assert.equal(electronSession.permissionCheckHandler(), false);
  assert.deepEqual(webContents.windowOpenHandler({ url: 'http://127.0.0.1:49231/popup.html' }), {
    action: 'deny',
  });

  let downloadPrevented = false;
  electronSession.handlers.get('will-download')({
    preventDefault() {
      downloadPrevented = true;
    },
  });
  assert.equal(downloadPrevented, true);
  assert.deepEqual(electronSession.webRequest.filter, {
    urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'ftp://*/*', 'file:///*'],
  });

  let sameOriginNavigationPrevented = false;
  webContents.handlers.get('will-navigate')({
    preventDefault() {
      sameOriginNavigationPrevented = true;
    },
  }, 'http://127.0.0.1:49231/next.html#section');
  assert.equal(sameOriginNavigationPrevented, false);

  let externalNavigationPrevented = false;
  webContents.handlers.get('will-frame-navigate')({
    preventDefault() {
      externalNavigationPrevented = true;
    },
  }, 'https://example.com/');
  assert.equal(externalNavigationPrevented, true);

  const networkResults = [];
  electronSession.webRequest.handler({ url: 'http://127.0.0.1:49231/app.js' }, (result) => {
    networkResults.push(result);
  });
  electronSession.webRequest.handler({ url: 'https://example.com/app.js' }, (result) => {
    networkResults.push(result);
  });
  electronSession.webRequest.handler({ url: 'file:///C:/Users/secret.txt' }, (result) => {
    networkResults.push(result);
  });
  assert.deepEqual(networkResults, [
    { cancel: false },
    { cancel: true },
    { cancel: true },
  ]);

  const status = handle.readStatus();
  assert.equal(status.permission_block_count, 2);
  assert.equal(status.window_open_block_count, 1);
  assert.equal(status.download_block_count, 1);
  assert.equal(status.navigation_block_count, 1);
  assert.equal(status.network_block_count, 2);
});

test('reload and stop stay main-owned and clean up view, session, and static server', async () => {
  const previewAdmission = admission();
  const server = staticServer(previewAdmission);
  const harness = electronHarness();
  let now = 2_000;
  const runtime = createBuilderLivePreviewWebContentsViewRuntime({
    WebContentsView: harness.WebContentsView,
    session: harness.session,
    nowMs: () => now,
  });
  const handle = await runtime.start({ admission: previewAdmission, static_server: server });
  assert.equal(runtime.activeCount(), 1);

  await handle.reload();
  assert.deepEqual(harness.views[0].webContents.loadedUrls, [server.entry_url, server.entry_url]);

  now = 3_000;
  const stopped = await handle.stop();
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.stopped_at_ms, 3_000);
  assert.equal(harness.views[0].webContents.isDestroyed(), true);
  assert.deepEqual(harness.sessions[0].clearStorageCalls, [{}]);
  assert.deepEqual(SERVER_CALLS.get(server), ['stop']);
  assert.equal(runtime.activeCount(), 0);
  assert.equal((await handle.stop()).status, 'stopped');
});

test('fails closed on stale admissions, duplicate previews, server drift, and load failures', async () => {
  const previewAdmission = admission();
  const harness = electronHarness();
  await assertFixedAsyncError(
    () => runtimeFor(harness, 80_000).start({
      admission: previewAdmission,
      static_server: staticServer(previewAdmission),
    }),
    'builder_live_preview_webcontents_view_runtime_invalid',
  );

  const runtime = runtimeFor(electronHarness());
  await runtime.start({ admission: previewAdmission, static_server: staticServer(previewAdmission) });
  await assertFixedAsyncError(
    () => runtime.start({ admission: previewAdmission, static_server: staticServer(previewAdmission) }),
    'builder_live_preview_webcontents_view_runtime_conflict',
  );

  const driftAdmission = admission({ source_tree_digest: `sha256:${'b'.repeat(64)}` });
  await assertFixedAsyncError(
    () => runtimeFor(electronHarness()).start({
      admission: driftAdmission,
      static_server: staticServer(driftAdmission, { source_tree_digest: SOURCE_TREE_DIGEST }),
    }),
    'builder_live_preview_webcontents_view_runtime_invalid',
  );

  await assertFixedAsyncError(
    () => runtimeFor(electronHarness({ loadFailure: true })).start({
      admission: previewAdmission,
      static_server: staticServer(previewAdmission),
    }),
    'builder_live_preview_webcontents_view_runtime_failed',
  );
});

test('rejects malformed options, proxies, and accessors without leaking hostile values', () => {
  const harness = electronHarness();
  assertFixedError(
    () => createBuilderLivePreviewWebContentsViewRuntime({}),
    'builder_live_preview_webcontents_view_runtime_invalid',
  );
  assertFixedError(
    () => createBuilderLivePreviewWebContentsViewRuntime({
      WebContentsView: harness.WebContentsView,
      session: harness.session,
      nowMs: () => 1,
      extra: true,
    }),
    'builder_live_preview_webcontents_view_runtime_invalid',
  );

  let trapCalls = 0;
  const proxy = new Proxy({}, {
    getPrototypeOf() {
      trapCalls += 1;
      throw new Error('private proxy trap');
    },
  });
  assertFixedError(
    () => createBuilderLivePreviewWebContentsViewRuntime(proxy),
    'builder_live_preview_webcontents_view_runtime_invalid',
  );
  assert.equal(trapCalls, 0);

  let getterCalls = 0;
  const accessorOptions = {
    WebContentsView: harness.WebContentsView,
    session: harness.session,
  };
  Object.defineProperty(accessorOptions, 'nowMs', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return () => 1;
    },
  });
  assertFixedError(
    () => createBuilderLivePreviewWebContentsViewRuntime(accessorOptions),
    'builder_live_preview_webcontents_view_runtime_invalid',
  );
  assert.equal(getterCalls, 0);
});

test('source remains preview-specific without IPC, renderer, provider, command, or mutation authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-live-preview-webcontents-view-runtime.cjs'),
    'utf8',
  );
  for (const forbidden of [
    /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|BrowserView/u,
    /builder-generation|builder-conversation|builder-execution-approval|builder-programming-run/iu,
    /provider_dispatch:\s*'performed'|tool_dispatch:\s*'performed'|command_execution:\s*'performed'/u,
    /source_write:\s*'performed'|git_mutation:\s*'performed'|sqlite_write:\s*'performed'/u,
    /permission_grant:\s*'performed'|revision_admission|save_admission/u,
    /nodeIntegration:\s*true|sandbox:\s*false|contextIsolation:\s*false|webviewTag:\s*true/u,
    /preload\s*:/u,
    /child_process|execFile|spawn\s*\(|writeFile|appendFile|rmSync|readFileSync/u,
    /Authorization|Bearer|credential|secret|safeStorage/iu,
  ]) assert.doesNotMatch(source, forbidden);
});
