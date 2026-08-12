'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  READ_CURRENT_DRAFT_FILE_CONTENT_CHANNEL,
  READ_CURRENT_DRAFT_FILE_TREE_CHANNEL,
} = require('../electron/builder-side-workspace-file-ipc-adapter.cjs');
const {
  BUILDER_SIDE_WORKSPACE_FILE_IPC_RUNTIME_VERSION,
  BuilderSideWorkspaceFileIpcRuntimeError,
  createBuilderSideWorkspaceFileIpcRuntime,
  createUnavailableBuilderSideWorkspaceFileService,
} = require('../electron/builder-side-workspace-file-ipc-runtime.cjs');

function ipcMainFixture(overrides = {}) {
  const handlers = new Map();
  return {
    handlers,
    ipcMain: {
      handle(channel, invoke) {
        if (overrides.failHandle === channel) throw new Error('handle failed');
        handlers.set(channel, invoke);
      },
      removeHandler(channel) {
        if (overrides.failRemove === channel) throw new Error('remove failed');
        handlers.delete(channel);
      },
    },
  };
}

function windowRef() {
  const webContents = Object.freeze({ isDestroyed: () => false });
  return () => Object.freeze({ webContents, isDestroyed: () => false });
}

function runtimeFixture(overrides = {}) {
  const ipc = ipcMainFixture(overrides);
  const service = overrides.fileService ?? createUnavailableBuilderSideWorkspaceFileService();
  const runtime = createBuilderSideWorkspaceFileIpcRuntime({
    ipcMain: ipc.ipcMain,
    mainWindowRef: windowRef(),
    fileService: service,
  });
  return { ipc, runtime, service };
}

test('registers fixed side workspace file channels in a preview-specific runtime', () => {
  const { ipc, runtime } = runtimeFixture();

  assert.equal(runtime.runtime_version, BUILDER_SIDE_WORKSPACE_FILE_IPC_RUNTIME_VERSION);
  assert.deepEqual(runtime.channels, [
    READ_CURRENT_DRAFT_FILE_TREE_CHANNEL,
    READ_CURRENT_DRAFT_FILE_CONTENT_CHANNEL,
  ]);
  assert.equal(runtime.register(), true);
  assert.equal(ipc.handlers.has(READ_CURRENT_DRAFT_FILE_TREE_CHANNEL), true);
  assert.equal(ipc.handlers.has(READ_CURRENT_DRAFT_FILE_CONTENT_CHANNEL), true);
  assert.equal(runtime.dispose(), true);
  assert.equal(ipc.handlers.size, 0);
});

test('registered unavailable service fails closed without source or path authority', async () => {
  const { ipc, runtime } = runtimeFixture();
  runtime.register();

  await assert.rejects(
    ipc.handlers.get(READ_CURRENT_DRAFT_FILE_TREE_CHANNEL)(
      { sender: windowRef()().webContents },
      {
        project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174000',
        conversation_id: 'builder-conversation:123e4567-e89b-42d3-a456-426614174000',
      },
    ),
    { code: 'builder_side_workspace_file_forbidden' },
  );
});

test('rolls back partial registration and dispose removes side workspace file handlers', () => {
  const { ipc, runtime } = runtimeFixture({
    failHandle: READ_CURRENT_DRAFT_FILE_CONTENT_CHANNEL,
  });

  assert.throws(
    () => runtime.register(),
    BuilderSideWorkspaceFileIpcRuntimeError,
  );
  assert.equal(ipc.handlers.size, 0);

  const success = runtimeFixture();
  success.runtime.register();
  assert.equal(success.runtime.dispose(), true);
  assert.equal(success.ipc.handlers.size, 0);
  assert.equal(success.runtime.dispose(), false);
});

test('rejects proxy, accessor, symbol, extra, and unstable runtime options without traps', () => {
  const ipc = ipcMainFixture();
  const service = createUnavailableBuilderSideWorkspaceFileService();
  const symbol = Symbol('secret');
  const accessorOptions = {
    ipcMain: ipc.ipcMain,
    mainWindowRef: windowRef(),
  };
  Object.defineProperty(accessorOptions, 'fileService', {
    enumerable: true,
    get() {
      throw new Error('private getter marker');
    },
  });
  for (const invalid of [
    null,
    {},
    { ipcMain: ipc.ipcMain, mainWindowRef: windowRef(), fileService: service, extra: true },
    { ipcMain: ipc.ipcMain, mainWindowRef: windowRef(), fileService: service, [symbol]: true },
    accessorOptions,
    new Proxy({}, { getPrototypeOf() { throw new Error('private proxy marker'); } }),
  ]) {
    assert.throws(
      () => createBuilderSideWorkspaceFileIpcRuntime(invalid),
      (error) => error instanceof BuilderSideWorkspaceFileIpcRuntimeError
        && error.code === 'builder_side_workspace_file_ipc_runtime_unavailable'
        && !`${error.message}:${error.stack}`.includes('private'),
    );
  }
});
