'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { types: utilTypes } = require('node:util');

const {
  EVALUATE_PERMISSION_CHANNEL,
  createBuilderPermissionIpcAdapter,
} = require('./builder-permission-ipc-adapter.cjs');
const {
  BUILDER_PERMISSION_POLICY_VERSION,
} = require('./builder-permission-authority-contract.cjs');
const {
  createBuilderPermissionFactStore,
} = require('./builder-permission-fact-store.cjs');

const BUILDER_PERMISSION_IPC_RUNTIME_VERSION = 'builder-permission-ipc-runtime.v1';
const PERMISSION_DIRECTORY = 'builder-permissions-v1';
const PERMISSION_DATABASE = 'permissions.sqlite';
const LOCAL_BUILDER_USER_ACTOR_ID = 'builder-user:00000000-0000-4000-8000-000000000001';
const OPTION_KEYS = Object.freeze(['ipcMain', 'mainWindowRef', 'userDataPath', 'nowMs']);
const REQUIRED_OPTION_KEYS = Object.freeze(['ipcMain', 'mainWindowRef', 'userDataPath']);
const ERROR_MESSAGES = Object.freeze({
  builder_permission_ipc_runtime_unavailable: 'Permissions are unavailable.',
  builder_permission_ipc_runtime_cleanup_required: 'Permission cleanup is required.',
});

class BuilderPermissionIpcRuntimeError extends Error {
  constructor(code = 'builder_permission_ipc_runtime_unavailable') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_permission_ipc_runtime_unavailable';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderPermissionIpcRuntimeError';
    this.code = selected;
    this.retryable = selected === 'builder_permission_ipc_runtime_cleanup_required';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderPermissionIpcRuntimeError(code);
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
      keys.length < REQUIRED_OPTION_KEYS.length
      || keys.length > OPTION_KEYS.length
      || keys.some((key) => typeof key !== 'string' || !OPTION_KEYS.includes(key))
      || REQUIRED_OPTION_KEYS.some((key) => !keys.includes(key))
    ) fail();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    }
    const ipcMain = descriptors.ipcMain.value;
    const mainWindowRef = descriptors.mainWindowRef.value;
    const userDataPath = descriptors.userDataPath.value;
    const nowMs = keys.includes('nowMs') ? descriptors.nowMs.value : () => Date.now();
    if (
      ipcMain === null
      || typeof ipcMain !== 'object'
      || utilTypes.isProxy(ipcMain)
      || typeof mainWindowRef !== 'function'
      || utilTypes.isProxy(mainWindowRef)
      || typeof nowMs !== 'function'
      || utilTypes.isProxy(nowMs)
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
      nowMs,
      userDataPath,
    });
  } catch {
    fail();
  }
}

function currentTime(options) {
  try {
    const now = Reflect.apply(options.nowMs, undefined, []);
    if (!Number.isSafeInteger(now) || now < 0) fail();
    return now;
  } catch {
    fail();
  }
}

function createBuilderPermissionIpcRuntime(rawOptions) {
  const options = safeOptions(rawOptions);
  let store = null;
  let adapter;

  try {
    const permissionRoot = path.join(options.userDataPath, PERMISSION_DIRECTORY);
    fs.mkdirSync(permissionRoot, { recursive: true, mode: 0o700 });
    store = createBuilderPermissionFactStore(path.join(permissionRoot, PERMISSION_DATABASE));
    const evaluator = store.create_evaluator();
    adapter = createBuilderPermissionIpcAdapter({
      async evaluatePermission(request) {
        return evaluator.evaluate({
          policy_version: BUILDER_PERMISSION_POLICY_VERSION,
          actor_id: LOCAL_BUILDER_USER_ACTOR_ID,
          action: request.action,
          resource: {
            resource_kind: request.resource_kind,
            project_id: request.project_id,
            resource_id: request.resource_id,
          },
          now_ms: currentTime(options),
        });
      },
      mainWindowRef: options.mainWindowRef,
    });
  } catch {
    try { store?.close(); } catch { /* fixed failure below */ }
    fail();
  }

  const handlers = Object.freeze([
    Object.freeze({ channel: EVALUATE_PERMISSION_CHANNEL, invoke: adapter.channels.evaluate.invoke }),
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

  function closeStore() {
    if (store === null) return true;
    try {
      store.close();
      store = null;
      return true;
    } catch {
      return false;
    }
  }

  return Object.freeze({
    runtime_version: BUILDER_PERMISSION_IPC_RUNTIME_VERSION,
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
        const removed = removeInstalledHandlers();
        const closed = closeStore();
        state = removed && closed ? 'disposed' : 'cleanup_required';
        fail(state === 'cleanup_required'
          ? 'builder_permission_ipc_runtime_cleanup_required'
          : undefined);
      }
    },
    dispose() {
      if (state === 'disposed') return false;
      if (state === 'idle') {
        const closed = closeStore();
        if (!closed) {
          state = 'cleanup_required';
          fail('builder_permission_ipc_runtime_cleanup_required');
        }
        state = 'disposed';
        return false;
      }
      const removed = removeInstalledHandlers();
      const closed = closeStore();
      if (!removed || !closed) {
        state = 'cleanup_required';
        fail('builder_permission_ipc_runtime_cleanup_required');
      }
      state = 'disposed';
      return true;
    },
  });
}

module.exports = Object.freeze({
  BUILDER_PERMISSION_IPC_RUNTIME_VERSION,
  PERMISSION_DIRECTORY,
  PERMISSION_DATABASE,
  LOCAL_BUILDER_USER_ACTOR_ID,
  BuilderPermissionIpcRuntimeError,
  createBuilderPermissionIpcRuntime,
});
