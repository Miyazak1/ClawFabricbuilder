'use strict';

const path = require('node:path');
const { types: utilTypes } = require('node:util');

const {
  READ_CURRENT_CHANNEL,
  REPLACE_CURRENT_CHANNEL,
  STATUS_CHANNEL,
  createBuilderProviderSettingsIpcAdapter,
} = require('./builder-provider-settings-ipc-adapter.cjs');
const {
  createBuilderProviderConfigRepository,
} = require('./builder-provider-config-repository.cjs');

const BUILDER_PROVIDER_SETTINGS_IPC_RUNTIME_VERSION = 'builder-provider-settings-ipc-runtime.v1';
const OPTION_KEYS = Object.freeze(['ipcMain', 'mainWindowRef', 'userDataPath']);
const ERROR_MESSAGES = Object.freeze({
  builder_provider_settings_ipc_runtime_unavailable: 'AI provider settings are unavailable.',
  builder_provider_settings_ipc_runtime_cleanup_required: 'AI provider settings cleanup is required.',
});

class BuilderProviderSettingsIpcRuntimeError extends Error {
  constructor(code = 'builder_provider_settings_ipc_runtime_unavailable') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_provider_settings_ipc_runtime_unavailable';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderProviderSettingsIpcRuntimeError';
    this.code = selected;
    this.retryable = selected === 'builder_provider_settings_ipc_runtime_cleanup_required';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderProviderSettingsIpcRuntimeError(code);
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

function safeOptions(value) {
  try {
    if (!isPlainObject(value)) fail();
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== OPTION_KEYS.length
      || keys.some((key) => typeof key !== 'string' || !OPTION_KEYS.includes(key))
    ) fail();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of OPTION_KEYS) {
      const descriptor = descriptors[key];
      if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    }
    const ipcMain = descriptors.ipcMain.value;
    const mainWindowRef = descriptors.mainWindowRef.value;
    const userDataPath = descriptors.userDataPath.value;
    if (
      ipcMain === null
      || typeof ipcMain !== 'object'
      || utilTypes.isProxy(ipcMain)
      || typeof mainWindowRef !== 'function'
      || utilTypes.isProxy(mainWindowRef)
      || typeof userDataPath !== 'string'
      || userDataPath.length === 0
      || userDataPath.length > 1_024
      || userDataPath.trim() !== userDataPath
      || userDataPath.includes('\0')
      || !path.isAbsolute(userDataPath)
      || path.normalize(userDataPath) !== userDataPath
    ) fail();
    return Object.freeze({
      ipcMain,
      handle: stableMethod(ipcMain, 'handle'),
      removeHandler: stableMethod(ipcMain, 'removeHandler'),
      mainWindowRef,
      userDataPath,
    });
  } catch {
    fail();
  }
}

function createBuilderProviderSettingsIpcRuntime(rawOptions) {
  const options = safeOptions(rawOptions);
  let repository = null;

  function currentRepository() {
    if (repository === null) {
      repository = createBuilderProviderConfigRepository(options.userDataPath);
    }
    return repository;
  }

  let adapter;
  try {
    adapter = createBuilderProviderSettingsIpcAdapter({
      readCurrent() {
        return currentRepository().read_current();
      },
      writeCurrent(request) {
        return currentRepository().write_current(request);
      },
      mainWindowRef: options.mainWindowRef,
    });
  } catch {
    fail();
  }

  const handlers = Object.freeze([
    Object.freeze({ channel: READ_CURRENT_CHANNEL, invoke: adapter.channels.readCurrent.invoke }),
    Object.freeze({ channel: REPLACE_CURRENT_CHANNEL, invoke: adapter.channels.replaceCurrent.invoke }),
    Object.freeze({ channel: STATUS_CHANNEL, invoke: adapter.channels.status.invoke }),
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
    runtime_version: BUILDER_PROVIDER_SETTINGS_IPC_RUNTIME_VERSION,
    channels: Object.freeze(handlers.map(({ channel }) => channel)),
    register() {
      if (state === 'registered') return false;
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
          ? 'builder_provider_settings_ipc_runtime_cleanup_required'
          : undefined);
      }
    },
    dispose() {
      if (state === 'disposed') return false;
      if (state === 'idle') {
        state = 'disposed';
        return false;
      }
      const removed = removeInstalledHandlers();
      if (!removed) {
        state = 'cleanup_required';
        fail('builder_provider_settings_ipc_runtime_cleanup_required');
      }
      state = 'disposed';
      return true;
    },
  });
}

module.exports = Object.freeze({
  BUILDER_PROVIDER_SETTINGS_IPC_RUNTIME_VERSION,
  BuilderProviderSettingsIpcRuntimeError,
  createBuilderProviderSettingsIpcRuntime,
});
