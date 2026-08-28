'use strict';

const { types: utilTypes } = require('node:util');

const BUILDER_AGENT_TEST_BROWSER_IPC_RUNTIME_VERSION =
  'builder-agent-test-browser-ipc-runtime.v1';
const UPDATE_AGENT_TEST_BROWSER_LAYOUT_CHANNEL =
  'clawfabric-builder:agent-test-browser:update-layout';
const STOP_AGENT_TEST_BROWSER_CHANNEL =
  'clawfabric-builder:agent-test-browser:stop';
const AGENT_TEST_BROWSER_LIFECYCLE_CHANNEL =
  'clawfabric-builder:agent-test-browser:lifecycle';
const OPTION_KEYS = Object.freeze(['agentTestBrowserRuntime', 'ipcMain', 'mainWindowRef']);

class BuilderAgentTestBrowserIpcRuntimeError extends Error {
  constructor(code = 'builder_agent_test_browser_ipc_unavailable') {
    const selected = code === 'builder_agent_test_browser_ipc_forbidden'
      ? code
      : 'builder_agent_test_browser_ipc_unavailable';
    super('Agent Test browser layout is unavailable.');
    this.name = 'BuilderAgentTestBrowserIpcRuntimeError';
    this.code = selected;
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentTestBrowserIpcRuntimeError(code);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length
    || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
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

function safeOptions(value) {
  exactObject(value, OPTION_KEYS);
  if (
    !isPlainObject(value.agentTestBrowserRuntime)
    || value.agentTestBrowserRuntime.runtime_version !== 'builder-agent-test-browser-runtime.v1'
    || value.ipcMain === null
    || typeof value.ipcMain !== 'object'
    || utilTypes.isProxy(value.ipcMain)
    || typeof value.mainWindowRef !== 'function'
    || utilTypes.isProxy(value.mainWindowRef)
  ) fail();
  return Object.freeze({
    agentTestBrowserRuntime: value.agentTestBrowserRuntime,
    updateLayout: stableMethod(value.agentTestBrowserRuntime, 'updateLayout'),
    stop: stableMethod(value.agentTestBrowserRuntime, 'stop'),
    subscribeLifecycle: stableMethod(value.agentTestBrowserRuntime, 'subscribeLifecycle'),
    ipcMain: value.ipcMain,
    handle: stableMethod(value.ipcMain, 'handle'),
    removeHandler: stableMethod(value.ipcMain, 'removeHandler'),
    mainWindowRef: value.mainWindowRef,
  });
}

function assertActiveRenderer(event, mainWindowRef) {
  let windowRef;
  try { windowRef = Reflect.apply(mainWindowRef, undefined, []); } catch { fail('builder_agent_test_browser_ipc_forbidden'); }
  if (
    event === null
    || typeof event !== 'object'
    || utilTypes.isProxy(event)
    || windowRef === null
    || typeof windowRef !== 'object'
    || utilTypes.isProxy(windowRef)
    || event.sender !== windowRef.webContents
  ) fail('builder_agent_test_browser_ipc_forbidden');
}

function createBuilderAgentTestBrowserIpcRuntime(rawOptions) {
  const options = safeOptions(rawOptions);
  let registered = false;
  let unsubscribeLifecycle = null;
  const handler = (event, request) => {
    assertActiveRenderer(event, options.mainWindowRef);
    return Reflect.apply(options.updateLayout, options.agentTestBrowserRuntime, [request]);
  };
  const stopHandler = (event, request) => {
    assertActiveRenderer(event, options.mainWindowRef);
    return Reflect.apply(options.stop, options.agentTestBrowserRuntime, [request]);
  };
  return Object.freeze({
    runtime_version: BUILDER_AGENT_TEST_BROWSER_IPC_RUNTIME_VERSION,
    channels: Object.freeze([
      UPDATE_AGENT_TEST_BROWSER_LAYOUT_CHANNEL,
      STOP_AGENT_TEST_BROWSER_CHANNEL,
      AGENT_TEST_BROWSER_LIFECYCLE_CHANNEL,
    ]),
    register() {
      if (registered) fail();
      Reflect.apply(options.handle, options.ipcMain, [
        UPDATE_AGENT_TEST_BROWSER_LAYOUT_CHANNEL,
        handler,
      ]);
      Reflect.apply(options.handle, options.ipcMain, [STOP_AGENT_TEST_BROWSER_CHANNEL, stopHandler]);
      unsubscribeLifecycle = Reflect.apply(
        options.subscribeLifecycle,
        options.agentTestBrowserRuntime,
        [(event) => {
          let windowRef;
          try { windowRef = Reflect.apply(options.mainWindowRef, undefined, []); } catch { return; }
          try { windowRef?.webContents?.send?.(AGENT_TEST_BROWSER_LIFECYCLE_CHANNEL, event); } catch {
            // Renderer lifecycle delivery cannot affect Main-owned cleanup.
          }
        }],
      );
      registered = true;
      return true;
    },
    dispose() {
      if (!registered) return false;
      Reflect.apply(options.removeHandler, options.ipcMain, [
        UPDATE_AGENT_TEST_BROWSER_LAYOUT_CHANNEL,
      ]);
      Reflect.apply(options.removeHandler, options.ipcMain, [STOP_AGENT_TEST_BROWSER_CHANNEL]);
      try { unsubscribeLifecycle?.(); } catch { /* disposal remains best effort */ }
      unsubscribeLifecycle = null;
      registered = false;
      return true;
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_TEST_BROWSER_IPC_RUNTIME_VERSION,
  UPDATE_AGENT_TEST_BROWSER_LAYOUT_CHANNEL,
  STOP_AGENT_TEST_BROWSER_CHANNEL,
  AGENT_TEST_BROWSER_LIFECYCLE_CHANNEL,
  BuilderAgentTestBrowserIpcRuntimeError,
  createBuilderAgentTestBrowserIpcRuntime,
});
