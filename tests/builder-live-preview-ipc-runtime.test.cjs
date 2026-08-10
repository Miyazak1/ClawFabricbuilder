'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  READ_CURRENT_LIVE_PREVIEW_STATUS_CHANNEL,
  RELOAD_CURRENT_LIVE_PREVIEW_CHANNEL,
  REQUEST_CURRENT_DRAFT_LIVE_PREVIEW_CHANNEL,
  STOP_CURRENT_LIVE_PREVIEW_CHANNEL,
} = require('../electron/builder-live-preview-ipc-adapter.cjs');
const {
  BUILDER_LIVE_PREVIEW_IPC_RUNTIME_VERSION,
  BUILDER_LIVE_PREVIEW_UNAVAILABLE_SERVICE_VERSION,
  BuilderLivePreviewIpcRuntimeError,
  createBuilderLivePreviewIpcRuntime,
  createUnavailableBuilderLivePreviewService,
} = require('../electron/builder-live-preview-ipc-runtime.cjs');

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}`;

function fakeIpcMain({ failHandle = null, failRemove = null } = {}) {
  const handlers = new Map();
  const removed = [];
  const authority = {
    handlers,
    removed,
    failRemove,
    handle(channel, handler) {
      if (channel === failHandle || handlers.has(channel)) {
        throw new Error('private registration detail');
      }
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      if (channel === authority.failRemove) throw new Error('private removal detail');
      removed.push(channel);
      handlers.delete(channel);
    },
  };
  return authority;
}

function fakeWindow() {
  const webContents = Object.freeze({
    isDestroyed: () => false,
  });
  return Object.freeze({
    webContents,
    isDestroyed: () => false,
  });
}

function runtimeFixture(overrides = {}) {
  const ipcMain = overrides.ipcMain ?? fakeIpcMain();
  const windowRef = overrides.windowRef ?? fakeWindow();
  const runtime = createBuilderLivePreviewIpcRuntime({
    ipcMain,
    mainWindowRef: () => windowRef,
    livePreviewService: overrides.livePreviewService ?? createUnavailableBuilderLivePreviewService(),
  });
  return { ipcMain, runtime, windowRef };
}

function assertRuntimeError(operation, code, message = 'Live preview is unavailable.') {
  assert.throws(
    operation,
    (error) => error instanceof BuilderLivePreviewIpcRuntimeError
      && error.code === code
      && error.message === message
      && error.stack === `${error.name}: ${error.message}`
      && !`${error.message}:${error.stack}`.includes('private'),
  );
}

test('registers fixed live preview channels in a preview-specific runtime', () => {
  const { ipcMain, runtime } = runtimeFixture();

  assert.equal(BUILDER_LIVE_PREVIEW_IPC_RUNTIME_VERSION, 'builder-live-preview-ipc-runtime.v1');
  assert.equal(
    BUILDER_LIVE_PREVIEW_UNAVAILABLE_SERVICE_VERSION,
    'builder-live-preview-unavailable-service.v1',
  );
  assert.equal(runtime.runtime_version, BUILDER_LIVE_PREVIEW_IPC_RUNTIME_VERSION);
  assert.deepEqual(Array.from(runtime.channels), [
    REQUEST_CURRENT_DRAFT_LIVE_PREVIEW_CHANNEL,
    RELOAD_CURRENT_LIVE_PREVIEW_CHANNEL,
    STOP_CURRENT_LIVE_PREVIEW_CHANNEL,
    READ_CURRENT_LIVE_PREVIEW_STATUS_CHANNEL,
  ]);
  assert.equal(Object.isFrozen(runtime), true);
  assert.equal(Object.isFrozen(runtime.channels), true);

  assert.equal(runtime.register(), true);
  assert.deepEqual([...ipcMain.handlers.keys()], Array.from(runtime.channels));
  assertRuntimeError(() => runtime.register(), 'builder_live_preview_ipc_runtime_unavailable');
});

test('registered unavailable service returns safe status without source or view authority', async () => {
  const { ipcMain, runtime, windowRef } = runtimeFixture();
  runtime.register();

  const projected = await ipcMain.handlers.get(REQUEST_CURRENT_DRAFT_LIVE_PREVIEW_CHANNEL)(
    Object.freeze({ sender: windowRef.webContents }),
    { project_id: PROJECT_ID, conversation_id: CONVERSATION_ID },
  );

  assert.equal(projected.status_version, 'builder-live-preview-status-projection.v1');
  assert.equal(projected.project_id, PROJECT_ID);
  assert.equal(projected.conversation_id, CONVERSATION_ID);
  assert.equal(projected.status, 'unavailable');
  assert.equal(projected.can_start, false);
  assert.equal(projected.can_reload, false);
  assert.equal(projected.can_stop, false);
  assert.equal(projected.unavailable_reason, 'preview_source_resolver_not_connected');
  assert.equal(projected.authority.source_tree_from_renderer, 'not_accepted');
  assert.equal(projected.authority.preview_content_ipc, false);
  assert.equal(projected.authority.node_integration, false);
  assert.equal(projected.authority.preload, false);
  assert.doesNotMatch(
    JSON.stringify(projected),
    /"source_tree":|content_digest|entry_url|preview_origin|credential|permission_id|revision_receipt|commit_oid|tree_oid/iu,
  );
  await assert.rejects(
    ipcMain.handlers.get(REQUEST_CURRENT_DRAFT_LIVE_PREVIEW_CHANNEL)(
      Object.freeze({ sender: windowRef.webContents }),
      {
        project_id: PROJECT_ID,
        conversation_id: CONVERSATION_ID,
        source_tree: { files: [{ path: 'index.html', contents: '<h1>renderer source</h1>' }] },
      },
    ),
    { code: 'builder_live_preview_invalid' },
  );
});

test('registered live preview handler fails closed without active sender', async () => {
  const { ipcMain, runtime } = runtimeFixture();
  runtime.register();

  await assert.rejects(
    ipcMain.handlers.get(READ_CURRENT_LIVE_PREVIEW_STATUS_CHANNEL)(
      Object.freeze({ sender: Object.freeze({}) }),
      { project_id: PROJECT_ID, conversation_id: CONVERSATION_ID },
    ),
    { code: 'builder_live_preview_forbidden' },
  );
});

test('rolls back partial registration and dispose removes live preview handlers permanently', () => {
  const registrationFailure = fakeIpcMain({ failHandle: STOP_CURRENT_LIVE_PREVIEW_CHANNEL });
  const failedRuntime = runtimeFixture({ ipcMain: registrationFailure }).runtime;
  assertRuntimeError(
    () => failedRuntime.register(),
    'builder_live_preview_ipc_runtime_unavailable',
  );
  assert.deepEqual([...registrationFailure.handlers.keys()], []);

  const { ipcMain, runtime } = runtimeFixture();
  runtime.register();
  assert.equal(runtime.dispose(), true);
  assert.deepEqual([...ipcMain.handlers.keys()], []);
  assert.deepEqual([...ipcMain.removed].sort(), [...runtime.channels].sort());
  assert.equal(runtime.dispose(), false);
  assertRuntimeError(() => runtime.register(), 'builder_live_preview_ipc_runtime_unavailable');
});

test('reports fixed cleanup failure and allows dispose to finish rollback cleanup', () => {
  const ipcMain = fakeIpcMain({ failRemove: STOP_CURRENT_LIVE_PREVIEW_CHANNEL });
  const runtime = runtimeFixture({ ipcMain }).runtime;
  runtime.register();

  assertRuntimeError(
    () => runtime.dispose(),
    'builder_live_preview_ipc_runtime_cleanup_required',
    'Live preview cleanup is required.',
  );
  assert.equal(ipcMain.handlers.size > 0, true);
  ipcMain.failRemove = null;
  assert.equal(runtime.dispose(), true);
  assert.deepEqual([...ipcMain.handlers.keys()], []);
});

test('rejects proxy, accessor, symbol, extra, and unstable runtime options without traps', () => {
  const ipcMain = fakeIpcMain();
  const mainWindowRef = () => fakeWindow();
  const livePreviewService = createUnavailableBuilderLivePreviewService();
  const symbol = Symbol('private');
  let trapCalls = 0;
  const proxiedOptions = new Proxy({}, {
    getPrototypeOf() {
      trapCalls += 1;
      throw new Error('private proxy trap');
    },
  });
  for (const invalid of [
    null,
    {},
    { ipcMain, mainWindowRef },
    { ipcMain, mainWindowRef, livePreviewService, extra: true },
    { ipcMain, mainWindowRef, livePreviewService, [symbol]: true },
    proxiedOptions,
    { ipcMain, mainWindowRef, livePreviewService: { ...livePreviewService, service_version: 1 } },
  ]) {
    assertRuntimeError(
      () => createBuilderLivePreviewIpcRuntime(invalid),
      'builder_live_preview_ipc_runtime_unavailable',
    );
  }
  assert.equal(trapCalls, 0);

  let getterCalls = 0;
  const accessorOptions = { ipcMain, mainWindowRef };
  Object.defineProperty(accessorOptions, 'livePreviewService', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return livePreviewService;
    },
  });
  assertRuntimeError(
    () => createBuilderLivePreviewIpcRuntime(accessorOptions),
    'builder_live_preview_ipc_runtime_unavailable',
  );
  assert.equal(getterCalls, 0);
});

test('runtime source has no provider dispatch, prompt, source, Git, storage, preload, or generation wiring authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-live-preview-ipc-runtime.cjs'),
    'utf8',
  );
  assert.match(source, /createBuilderLivePreviewIpcAdapter/u);
  assert.match(source, /createUnavailableBuilderLivePreviewService/u);
  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|ipcRenderer|contextBridge|BrowserWindow|WebContentsView|safeStorage|node:sqlite|DatabaseSync|builder-git-|builder-generation-|fetch\s*\(|https?:|saveDraft|generate|persist_candidate_commit|write_current|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta|preload\.cjs/iu,
  );
});
