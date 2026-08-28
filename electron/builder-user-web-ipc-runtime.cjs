'use strict';

const { types: utilTypes } = require('node:util');

const BUILDER_USER_WEB_IPC_RUNTIME_VERSION = 'builder-user-web-ipc-runtime.v1';
const CHANNELS = Object.freeze({
  navigate: 'clawfabric-builder:user-web:navigate',
  goBack: 'clawfabric-builder:user-web:go-back',
  goForward: 'clawfabric-builder:user-web:go-forward',
  reload: 'clawfabric-builder:user-web:reload',
  stop: 'clawfabric-builder:user-web:stop',
  readStatus: 'clawfabric-builder:user-web:read-status',
  updateLayout: 'clawfabric-builder:user-web:update-layout',
});
const OPTION_KEYS = Object.freeze(['ipcMain', 'mainWindowRef', 'userWebService']);

class BuilderUserWebIpcRuntimeError extends Error {
  constructor(code = 'builder_user_web_ipc_unavailable') {
    super('User Web is unavailable.');
    this.name = 'BuilderUserWebIpcRuntimeError';
    this.code = code === 'builder_user_web_ipc_forbidden'
      ? code
      : 'builder_user_web_ipc_unavailable';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderUserWebIpcRuntimeError(code);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some((key) => typeof key !== 'string' || !keys.includes(key))) fail();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
  }
}

function stableMethod(value, key) {
  let cursor = value;
  while (cursor !== null) {
    if (utilTypes.isProxy(cursor)) fail();
    const descriptor = Object.getOwnPropertyDescriptor(cursor, key);
    if (descriptor) {
      if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') fail();
      return descriptor.value;
    }
    cursor = Object.getPrototypeOf(cursor);
  }
  fail();
}

function safeOptions(rawOptions) {
  exactObject(rawOptions, OPTION_KEYS);
  if (
    rawOptions.ipcMain === null
    || typeof rawOptions.ipcMain !== 'object'
    || utilTypes.isProxy(rawOptions.ipcMain)
    || typeof rawOptions.mainWindowRef !== 'function'
    || utilTypes.isProxy(rawOptions.mainWindowRef)
    || rawOptions.userWebService === null
    || typeof rawOptions.userWebService !== 'object'
    || utilTypes.isProxy(rawOptions.userWebService)
  ) fail();
  return Object.freeze({
    ipcMain: rawOptions.ipcMain,
    handle: stableMethod(rawOptions.ipcMain, 'handle'),
    removeHandler: stableMethod(rawOptions.ipcMain, 'removeHandler'),
    mainWindowRef: rawOptions.mainWindowRef,
    userWebService: rawOptions.userWebService,
    navigate: stableMethod(rawOptions.userWebService, 'navigate'),
    goBack: stableMethod(rawOptions.userWebService, 'go_back'),
    goForward: stableMethod(rawOptions.userWebService, 'go_forward'),
    reload: stableMethod(rawOptions.userWebService, 'reload'),
    stop: stableMethod(rawOptions.userWebService, 'stop'),
    readStatus: stableMethod(rawOptions.userWebService, 'read_status'),
    updateLayout: stableMethod(rawOptions.userWebService, 'update_layout'),
    shutdown: stableMethod(rawOptions.userWebService, 'shutdown'),
  });
}

function assertActiveRenderer(event, mainWindowRef) {
  const mainWindow = Reflect.apply(mainWindowRef, undefined, []);
  if (
    mainWindow === null
    || typeof mainWindow !== 'object'
    || utilTypes.isProxy(mainWindow)
    || event === null
    || typeof event !== 'object'
    || utilTypes.isProxy(event)
    || event.sender !== mainWindow.webContents
  ) fail('builder_user_web_ipc_forbidden');
}

function createBuilderUserWebIpcRuntime(rawOptions) {
  const options = safeOptions(rawOptions);
  let registered = false;
  const handlers = Object.freeze({
    [CHANNELS.navigate]: (event, request) => {
      assertActiveRenderer(event, options.mainWindowRef);
      return Reflect.apply(options.navigate, options.userWebService, [request]);
    },
    [CHANNELS.goBack]: (event) => {
      assertActiveRenderer(event, options.mainWindowRef);
      return Reflect.apply(options.goBack, options.userWebService, []);
    },
    [CHANNELS.goForward]: (event) => {
      assertActiveRenderer(event, options.mainWindowRef);
      return Reflect.apply(options.goForward, options.userWebService, []);
    },
    [CHANNELS.reload]: (event) => {
      assertActiveRenderer(event, options.mainWindowRef);
      return Reflect.apply(options.reload, options.userWebService, []);
    },
    [CHANNELS.stop]: (event) => {
      assertActiveRenderer(event, options.mainWindowRef);
      return Reflect.apply(options.stop, options.userWebService, []);
    },
    [CHANNELS.readStatus]: (event) => {
      assertActiveRenderer(event, options.mainWindowRef);
      return Reflect.apply(options.readStatus, options.userWebService, []);
    },
    [CHANNELS.updateLayout]: (event, request) => {
      assertActiveRenderer(event, options.mainWindowRef);
      return Reflect.apply(options.updateLayout, options.userWebService, [request]);
    },
  });
  return Object.freeze({
    runtime_version: BUILDER_USER_WEB_IPC_RUNTIME_VERSION,
    channels: CHANNELS,
    register() {
      if (registered) fail();
      for (const [channel, handler] of Object.entries(handlers)) {
        Reflect.apply(options.handle, options.ipcMain, [channel, handler]);
      }
      registered = true;
    },
    dispose() {
      if (!registered) return;
      for (const channel of Object.values(CHANNELS)) {
        Reflect.apply(options.removeHandler, options.ipcMain, [channel]);
      }
      registered = false;
    },
    async shutdown() {
      this.dispose();
      await Reflect.apply(options.shutdown, options.userWebService, []);
    },
  });
}

module.exports = Object.freeze({
  BUILDER_USER_WEB_IPC_RUNTIME_VERSION,
  BuilderUserWebIpcRuntimeError,
  createBuilderUserWebIpcRuntime,
});
