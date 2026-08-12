'use strict';

const { types: utilTypes } = require('node:util');

const {
  READ_CURRENT_DRAFT_FILE_CONTENT_CHANNEL,
  READ_CURRENT_DRAFT_FILE_TREE_CHANNEL,
  createBuilderSideWorkspaceFileIpcAdapter,
} = require('./builder-side-workspace-file-ipc-adapter.cjs');

const BUILDER_SIDE_WORKSPACE_FILE_IPC_RUNTIME_VERSION =
  'builder-side-workspace-file-ipc-runtime.v1';
const BUILDER_SIDE_WORKSPACE_FILE_UNAVAILABLE_SERVICE_VERSION =
  'builder-side-workspace-file-unavailable-service.v1';
const OPTION_KEYS = Object.freeze(['ipcMain', 'mainWindowRef', 'fileService']);
const SERVICE_KEYS = Object.freeze([
  'service_version',
  'read_current_draft_file_tree',
  'read_current_draft_file_content',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_side_workspace_file_ipc_runtime_unavailable: 'Files are unavailable.',
  builder_side_workspace_file_ipc_runtime_cleanup_required: 'Files cleanup is required.',
});

class BuilderSideWorkspaceFileIpcRuntimeError extends Error {
  constructor(code = 'builder_side_workspace_file_ipc_runtime_unavailable') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_side_workspace_file_ipc_runtime_unavailable';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderSideWorkspaceFileIpcRuntimeError';
    this.code = selected;
    this.retryable = selected === 'builder_side_workspace_file_ipc_runtime_cleanup_required';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderSideWorkspaceFileIpcRuntimeError(code);
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
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
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
      fileService: safeService(descriptors.fileService.value),
    });
  } catch {
    fail();
  }
}

function createUnavailableBuilderSideWorkspaceFileService() {
  async function unavailable() {
    const error = new Error('Files are unavailable.');
    error.code = 'builder_side_workspace_file_unavailable';
    throw error;
  }
  return Object.freeze({
    service_version: BUILDER_SIDE_WORKSPACE_FILE_UNAVAILABLE_SERVICE_VERSION,
    read_current_draft_file_tree: unavailable,
    read_current_draft_file_content: unavailable,
  });
}

function createBuilderSideWorkspaceFileIpcRuntime(rawOptions) {
  const options = safeOptions(rawOptions);
  let adapter;
  try {
    adapter = createBuilderSideWorkspaceFileIpcAdapter({
      readCurrentDraftFileTree: options.fileService.read_current_draft_file_tree,
      readCurrentDraftFileContent: options.fileService.read_current_draft_file_content,
      mainWindowRef: options.mainWindowRef,
    });
  } catch {
    fail();
  }

  const handlers = Object.freeze([
    Object.freeze({
      channel: READ_CURRENT_DRAFT_FILE_TREE_CHANNEL,
      invoke: adapter.channels.readCurrentDraftFileTree.invoke,
    }),
    Object.freeze({
      channel: READ_CURRENT_DRAFT_FILE_CONTENT_CHANNEL,
      invoke: adapter.channels.readCurrentDraftFileContent.invoke,
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
    runtime_version: BUILDER_SIDE_WORKSPACE_FILE_IPC_RUNTIME_VERSION,
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
          ? 'builder_side_workspace_file_ipc_runtime_cleanup_required'
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
        fail('builder_side_workspace_file_ipc_runtime_cleanup_required');
      }
      state = 'disposed';
      return true;
    },
  });
}

module.exports = Object.freeze({
  BUILDER_SIDE_WORKSPACE_FILE_IPC_RUNTIME_VERSION,
  BUILDER_SIDE_WORKSPACE_FILE_UNAVAILABLE_SERVICE_VERSION,
  BuilderSideWorkspaceFileIpcRuntimeError,
  createBuilderSideWorkspaceFileIpcRuntime,
  createUnavailableBuilderSideWorkspaceFileService,
});
