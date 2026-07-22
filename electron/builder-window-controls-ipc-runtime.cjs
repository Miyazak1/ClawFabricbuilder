'use strict';

const { types: utilTypes } = require('node:util');

const RUNTIME_VERSION = 'builder-window-controls-ipc-runtime.v1';
const MINIMIZE_CHANNEL = 'clawfabric-builder:window-controls:minimize';
const TOGGLE_MAXIMIZE_CHANNEL = 'clawfabric-builder:window-controls:toggle-maximize';
const CLOSE_CHANNEL = 'clawfabric-builder:window-controls:close';
const READ_STATE_CHANNEL = 'clawfabric-builder:window-controls:read-state';
const OPTION_KEYS = Object.freeze(['ipcMain', 'mainWindowRef']);
const ACTION_RESULT = Object.freeze({
  result_version: 'builder-window-control-result.v1',
  ok: true,
});
const ERROR_MESSAGES = Object.freeze({
  builder_window_controls_ipc_runtime_unavailable: 'Builder window controls are unavailable.',
  builder_window_controls_ipc_runtime_cleanup_required: 'Builder window controls cleanup is required.',
  builder_window_controls_forbidden: 'Builder window controls are unavailable.',
  builder_window_controls_failed: 'Builder window controls are unavailable.',
});

class BuilderWindowControlsIpcRuntimeError extends Error {
  constructor(code = 'builder_window_controls_ipc_runtime_unavailable') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_window_controls_ipc_runtime_unavailable';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderWindowControlsIpcRuntimeError';
    this.code = selected;
    this.retryable = selected === 'builder_window_controls_ipc_runtime_cleanup_required';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderWindowControlsIpcRuntimeError(code);
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

function stableMethod(value, key, errorCode) {
  let cursor = value;
  while (cursor !== null) {
    if (utilTypes.isProxy(cursor)) fail(errorCode);
    const descriptor = Object.getOwnPropertyDescriptor(cursor, key);
    if (descriptor) {
      if (
        !Object.hasOwn(descriptor, 'value')
        || typeof descriptor.value !== 'function'
        || utilTypes.isProxy(descriptor.value)
      ) fail(errorCode);
      return descriptor.value;
    }
    cursor = Object.getPrototypeOf(cursor);
  }
  fail(errorCode);
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
    });
  } catch {
    fail();
  }
}

function activeWindow(event, mainWindowRef) {
  try {
    const windowRef = Reflect.apply(mainWindowRef, undefined, []);
    if (
      windowRef === null
      || typeof windowRef !== 'object'
      || utilTypes.isProxy(windowRef)
    ) fail('builder_window_controls_forbidden');
    const isWindowDestroyed = stableMethod(
      windowRef,
      'isDestroyed',
      'builder_window_controls_forbidden',
    );
    if (Reflect.apply(isWindowDestroyed, windowRef, [])) fail('builder_window_controls_forbidden');
    const webContents = windowRef.webContents;
    if (
      webContents === null
      || typeof webContents !== 'object'
      || utilTypes.isProxy(webContents)
    ) fail('builder_window_controls_forbidden');
    const isWebContentsDestroyed = stableMethod(
      webContents,
      'isDestroyed',
      'builder_window_controls_forbidden',
    );
    if (Reflect.apply(isWebContentsDestroyed, webContents, [])) {
      fail('builder_window_controls_forbidden');
    }
    if (event === null || typeof event !== 'object' || event.sender !== webContents) {
      fail('builder_window_controls_forbidden');
    }
    return windowRef;
  } catch (error) {
    if (
      error instanceof BuilderWindowControlsIpcRuntimeError
      && error.code === 'builder_window_controls_forbidden'
    ) throw error;
    fail('builder_window_controls_forbidden');
  }
}

function invokeWindowAction(event, mainWindowRef, action) {
  const windowRef = activeWindow(event, mainWindowRef);
  try {
    action(windowRef);
    return ACTION_RESULT;
  } catch {
    fail('builder_window_controls_failed');
  }
}

function assertZeroPayload(payload) {
  if (payload.length !== 0) fail('builder_window_controls_forbidden');
}

function readWindowState(event, mainWindowRef) {
  const windowRef = activeWindow(event, mainWindowRef);
  try {
    const isMaximized = stableMethod(windowRef, 'isMaximized', 'builder_window_controls_failed');
    const maximized = Reflect.apply(isMaximized, windowRef, []);
    if (typeof maximized !== 'boolean') fail('builder_window_controls_failed');
    return Object.freeze({
      state_version: 'builder-window-state.v1',
      maximized,
    });
  } catch (error) {
    if (
      error instanceof BuilderWindowControlsIpcRuntimeError
      && error.code === 'builder_window_controls_failed'
    ) throw error;
    fail('builder_window_controls_failed');
  }
}

function createBuilderWindowControlsIpcRuntime(rawOptions) {
  const options = safeOptions(rawOptions);
  const handlers = Object.freeze([
    Object.freeze({
      channel: MINIMIZE_CHANNEL,
      invoke(event, ...payload) {
        assertZeroPayload(payload);
        return invokeWindowAction(event, options.mainWindowRef, (windowRef) => {
          const minimize = stableMethod(windowRef, 'minimize', 'builder_window_controls_failed');
          Reflect.apply(minimize, windowRef, []);
        });
      },
    }),
    Object.freeze({
      channel: TOGGLE_MAXIMIZE_CHANNEL,
      invoke(event, ...payload) {
        assertZeroPayload(payload);
        return invokeWindowAction(event, options.mainWindowRef, (windowRef) => {
          const isMaximized = stableMethod(windowRef, 'isMaximized', 'builder_window_controls_failed');
          const maximized = Reflect.apply(isMaximized, windowRef, []);
          if (typeof maximized !== 'boolean') fail('builder_window_controls_failed');
          const method = stableMethod(
            windowRef,
            maximized ? 'unmaximize' : 'maximize',
            'builder_window_controls_failed',
          );
          Reflect.apply(method, windowRef, []);
        });
      },
    }),
    Object.freeze({
      channel: CLOSE_CHANNEL,
      invoke(event, ...payload) {
        assertZeroPayload(payload);
        return invokeWindowAction(event, options.mainWindowRef, (windowRef) => {
          const close = stableMethod(windowRef, 'close', 'builder_window_controls_failed');
          Reflect.apply(close, windowRef, []);
        });
      },
    }),
    Object.freeze({
      channel: READ_STATE_CHANNEL,
      invoke(event, ...payload) {
        assertZeroPayload(payload);
        return readWindowState(event, options.mainWindowRef);
      },
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
    runtime_version: RUNTIME_VERSION,
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
          ? 'builder_window_controls_ipc_runtime_cleanup_required'
          : undefined);
      }
    },
    dispose() {
      if (state === 'disposed') return false;
      if (state === 'idle') {
        state = 'disposed';
        return false;
      }
      if (!removeInstalledHandlers()) {
        state = 'cleanup_required';
        fail('builder_window_controls_ipc_runtime_cleanup_required');
      }
      state = 'disposed';
      return true;
    },
  });
}

module.exports = Object.freeze({
  RUNTIME_VERSION,
  MINIMIZE_CHANNEL,
  TOGGLE_MAXIMIZE_CHANNEL,
  CLOSE_CHANNEL,
  READ_STATE_CHANNEL,
  BuilderWindowControlsIpcRuntimeError,
  createBuilderWindowControlsIpcRuntime,
});
