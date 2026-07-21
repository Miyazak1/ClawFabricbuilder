'use strict';

const path = require('node:path');
const fs = require('node:fs');

const {
  createBuilderProjectRevisionRepository,
} = require('./builder-project-revision-repository.cjs');
const {
  COMMIT_CHANNEL,
  LOAD_CURRENT_CHANNEL,
  createBuilderProjectRevisionIpcAdapter,
} = require('./builder-project-revision-ipc-adapter.cjs');
const {
  LIST_CURRENT_CHANNEL,
  createBuilderProjectCatalogIpcAdapter,
} = require('./builder-project-catalog-ipc-adapter.cjs');

const RUNTIME_VERSION = 'builder-project-ipc-runtime.v1';
const REPOSITORY_DIRECTORY = 'builder-project-revisions-v1';
const OPTION_KEYS = new Set(['ipcMain', 'mainWindowRef', 'userDataPath']);

class BuilderProjectIpcRuntimeError extends Error {
  constructor() {
    super('Builder project storage is unavailable.');
    this.name = 'BuilderProjectIpcRuntimeError';
    this.code = 'builder_project_ipc_runtime_unavailable';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function runtimeError() {
  return new BuilderProjectIpcRuntimeError();
}

function safeOptions(value) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw runtimeError();
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== OPTION_KEYS.size
      || keys.some((key) => typeof key !== 'string' || !OPTION_KEYS.has(key))
    ) throw runtimeError();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of OPTION_KEYS) {
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || 'get' in descriptor || 'set' in descriptor) {
        throw runtimeError();
      }
    }
    const ipcMain = descriptors.ipcMain.value;
    const mainWindowRef = descriptors.mainWindowRef.value;
    const userDataPath = descriptors.userDataPath.value;
    if (
      ipcMain === null
      || typeof ipcMain !== 'object'
      || typeof ipcMain.handle !== 'function'
      || typeof ipcMain.removeHandler !== 'function'
      || typeof mainWindowRef !== 'function'
      || typeof userDataPath !== 'string'
      || userDataPath.length === 0
      || userDataPath.length > 1024
      || userDataPath.trim() !== userDataPath
      || userDataPath.includes('\0')
      || !path.isAbsolute(userDataPath)
      || path.normalize(userDataPath) !== userDataPath
    ) throw runtimeError();
    return Object.freeze({ ipcMain, mainWindowRef, userDataPath });
  } catch {
    throw runtimeError();
  }
}

function createBuilderProjectIpcRuntime(rawOptions) {
  const options = safeOptions(rawOptions);
  const rootPath = path.join(options.userDataPath, REPOSITORY_DIRECTORY);
  let revisionAdapter;
  let catalogAdapter;
  try {
    fs.mkdirSync(rootPath, { recursive: true, mode: 0o700 });
    const catalogRepository = createBuilderProjectRevisionRepository(rootPath);
    revisionAdapter = createBuilderProjectRevisionIpcAdapter({
      rootPath,
      mainWindowRef: options.mainWindowRef,
    });
    catalogAdapter = createBuilderProjectCatalogIpcAdapter({
      listCurrent: () => catalogRepository.list_current(),
      mainWindowRef: options.mainWindowRef,
    });
  } catch {
    throw runtimeError();
  }

  const handlers = Object.freeze([
    Object.freeze({
      channel: COMMIT_CHANNEL,
      invoke: revisionAdapter.channels.commit.invoke,
    }),
    Object.freeze({
      channel: LOAD_CURRENT_CHANNEL,
      invoke: revisionAdapter.channels.loadCurrent.invoke,
    }),
    Object.freeze({
      channel: LIST_CURRENT_CHANNEL,
      invoke: catalogAdapter.channels.listCurrent.invoke,
    }),
  ]);
  let registered = false;

  function removeHandlers(entries = handlers) {
    for (const entry of [...entries].reverse()) {
      try {
        Reflect.apply(options.ipcMain.removeHandler, options.ipcMain, [entry.channel]);
      } catch {
        // Best-effort rollback never authorizes an untracked replacement handler.
      }
    }
  }

  return Object.freeze({
    runtime_version: RUNTIME_VERSION,
    channels: Object.freeze(handlers.map(({ channel }) => channel)),
    register() {
      if (registered) return false;
      const installed = [];
      try {
        for (const entry of handlers) {
          Reflect.apply(options.ipcMain.handle, options.ipcMain, [entry.channel, entry.invoke]);
          installed.push(entry);
        }
        registered = true;
        return true;
      } catch {
        removeHandlers(installed);
        throw runtimeError();
      }
    },
    dispose() {
      if (!registered) return false;
      registered = false;
      removeHandlers();
      return true;
    },
  });
}

module.exports = Object.freeze({
  RUNTIME_VERSION,
  REPOSITORY_DIRECTORY,
  BuilderProjectIpcRuntimeError,
  createBuilderProjectIpcRuntime,
});
