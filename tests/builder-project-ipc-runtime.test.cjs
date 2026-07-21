'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  COMMIT_CHANNEL,
  LOAD_CURRENT_CHANNEL,
} = require('../electron/builder-project-revision-ipc-adapter.cjs');
const {
  LIST_CURRENT_CHANNEL,
} = require('../electron/builder-project-catalog-ipc-adapter.cjs');
const {
  BuilderProjectIpcRuntimeError,
  createBuilderProjectIpcRuntime,
} = require('../electron/builder-project-ipc-runtime.cjs');

function temporaryUserData(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function activeWindow() {
  const webContents = { isDestroyed: () => false };
  return { webContents, isDestroyed: () => false };
}

function fakeIpcMain(failOnChannel = null) {
  const handlers = new Map();
  const removed = [];
  return {
    handlers,
    removed,
    handle(channel, handler) {
      if (channel === failOnChannel || handlers.has(channel)) throw new Error('registration failed');
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      removed.push(channel);
      handlers.delete(channel);
    },
  };
}

test('registers exactly the standalone revision and catalog channels once', async (t) => {
  const windowRef = activeWindow();
  const ipcMain = fakeIpcMain();
  const runtime = createBuilderProjectIpcRuntime({
    ipcMain,
    mainWindowRef: () => windowRef,
    userDataPath: temporaryUserData(t),
  });

  assert.equal(runtime.runtime_version, 'builder-project-ipc-runtime.v1');
  assert.deepEqual(runtime.channels, [COMMIT_CHANNEL, LOAD_CURRENT_CHANNEL, LIST_CURRENT_CHANNEL]);
  assert.equal(runtime.register(), true);
  assert.equal(runtime.register(), false);
  assert.deepEqual([...ipcMain.handlers.keys()], runtime.channels);

  const catalog = await ipcMain.handlers.get(LIST_CURRENT_CHANNEL)(
    { sender: windowRef.webContents },
  );
  assert.equal(catalog.result_version, 'builder-project-catalog-result.v1');
  assert.deepEqual(catalog.projects, []);
  assert.equal(runtime.dispose(), true);
  assert.equal(runtime.dispose(), false);
  assert.deepEqual([...ipcMain.handlers.keys()], []);
});

test('keeps active-renderer checks inside the adapters', async (t) => {
  const windowRef = activeWindow();
  const ipcMain = fakeIpcMain();
  const runtime = createBuilderProjectIpcRuntime({
    ipcMain,
    mainWindowRef: () => windowRef,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();

  await assert.rejects(
    ipcMain.handlers.get(LIST_CURRENT_CHANNEL)({ sender: {} }),
    (error) => error.code === 'builder_project_catalog_forbidden'
      && error.stack === `${error.name}: ${error.message}`,
  );
  await assert.rejects(
    ipcMain.handlers.get(COMMIT_CHANNEL)({ sender: {} }, { private: 'marker' }),
    (error) => error.code === 'builder_project_revisions_forbidden'
      && !error.message.includes('marker'),
  );
});

test('rolls back partial registration and rejects malformed authority inputs', (t) => {
  const windowRef = activeWindow();
  const ipcMain = fakeIpcMain(LOAD_CURRENT_CHANNEL);
  const runtime = createBuilderProjectIpcRuntime({
    ipcMain,
    mainWindowRef: () => windowRef,
    userDataPath: temporaryUserData(t),
  });
  assert.throws(
    () => runtime.register(),
    (error) => error instanceof BuilderProjectIpcRuntimeError
      && error.code === 'builder_project_ipc_runtime_unavailable',
  );
  assert.deepEqual([...ipcMain.handlers.keys()], []);
  assert.deepEqual(ipcMain.removed, [COMMIT_CHANNEL]);

  for (const invalid of [
    null,
    {},
    { ipcMain, mainWindowRef: () => windowRef, userDataPath: 'relative' },
    { ipcMain, mainWindowRef: () => windowRef, userDataPath: temporaryUserData(t), extra: true },
  ]) {
    assert.throws(
      () => createBuilderProjectIpcRuntime(invalid),
      (error) => error instanceof BuilderProjectIpcRuntimeError,
    );
  }
});

test('contains no renderer, provider, legacy, or generic draft authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-project-ipc-runtime.cjs'),
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /ipcRenderer|contextBridge|clawfabricDesktop|desktop:builder|chat_planner|localProviderExecutor|ChatCreatePage|Canvas|\bJob\b|getDraft|saveDraft|fetch\(|https?:/iu,
  );
  assert.match(source, /builder-project-revisions-v1/u);
  assert.match(source, /mainWindowRef/u);
  assert.match(source, /createBuilderProjectRevisionIpcAdapter/u);
  assert.match(source, /createBuilderProjectCatalogIpcAdapter/u);
});
