'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AGENT_TEST_BROWSER_LIFECYCLE_CHANNEL,
  STOP_AGENT_TEST_BROWSER_CHANNEL,
  UPDATE_AGENT_TEST_BROWSER_LAYOUT_CHANNEL,
  BuilderAgentTestBrowserIpcRuntimeError,
  createBuilderAgentTestBrowserIpcRuntime,
} = require('../electron/builder-agent-test-browser-ipc-runtime.cjs');

const RUN_ID = 'builder-run:22222222-2222-4222-8222-222222222222';

function ipcMainHarness() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, handler) { handlers.set(channel, handler); },
    removeHandler(channel) { handlers.delete(channel); },
  };
}

function electronShapedIpcMainHarness() {
  const handlers = new Map();
  const prototype = {
    handle(channel, handler) { this.handlers.set(channel, handler); },
    removeHandler(channel) { this.handlers.delete(channel); },
  };
  return Object.assign(Object.create(prototype), { handlers });
}

test('accepts layout only from the active renderer and delegates no browser authority', () => {
  const ipcMain = ipcMainHarness();
  const webContents = { sent: [], send(channel, payload) { this.sent.push([channel, payload]); } };
  const requests = [];
  let lifecycleSubscriber = null;
  const browserRuntime = {
    runtime_version: 'builder-agent-test-browser-runtime.v1',
    stop(request) { return Object.freeze({ closed: true, owner_run_id: request.owner_run_id }); },
    updateLayout(request) {
      requests.push(request);
      return Object.freeze({
        result_version: 'builder-agent-test-browser-layout-result.v1',
        owner_run_id: request.owner_run_id,
        operation: 'layout_updated',
        visible: request.view_bounds !== null,
        applied_bounds: request.view_bounds,
      });
    },
    subscribeLifecycle(subscriber) {
      lifecycleSubscriber = subscriber;
      return () => { lifecycleSubscriber = null; };
    },
  };
  const runtime = createBuilderAgentTestBrowserIpcRuntime({
    agentTestBrowserRuntime: browserRuntime,
    ipcMain,
    mainWindowRef: () => ({ webContents }),
  });
  assert.equal(runtime.register(), true);
  const handler = ipcMain.handlers.get(UPDATE_AGENT_TEST_BROWSER_LAYOUT_CHANNEL);
  const request = { owner_run_id: RUN_ID, view_bounds: { x: 900, y: 100, width: 360, height: 600 } };
  const result = handler({ sender: webContents }, request);
  assert.deepEqual(requests, [request]);
  assert.equal(result.owner_run_id, RUN_ID);
  lifecycleSubscriber({ owner_run_id: RUN_ID, lifecycle: 'opened' });
  assert.deepEqual(webContents.sent, [[
    AGENT_TEST_BROWSER_LIFECYCLE_CHANNEL,
    { owner_run_id: RUN_ID, lifecycle: 'opened' },
  ]]);
  assert.equal(JSON.stringify(result).includes('session'), false);
  assert.equal(JSON.stringify(result).includes('partition'), false);
  assert.throws(
    () => handler({ sender: {} }, request),
    (error) => error instanceof BuilderAgentTestBrowserIpcRuntimeError
      && error.code === 'builder_agent_test_browser_ipc_forbidden',
  );
  assert.equal(runtime.dispose(), true);
  assert.equal(ipcMain.handlers.has(UPDATE_AGENT_TEST_BROWSER_LAYOUT_CHANNEL), false);
  assert.equal(ipcMain.handlers.has(STOP_AGENT_TEST_BROWSER_CHANNEL), false);
});

test('fails closed on malformed runtime authority', () => {
  assert.throws(
    () => createBuilderAgentTestBrowserIpcRuntime({
      agentTestBrowserRuntime: { runtime_version: 'wrong', updateLayout() {} },
      ipcMain: ipcMainHarness(),
      mainWindowRef: () => null,
    }),
    BuilderAgentTestBrowserIpcRuntimeError,
  );
});

test('accepts Electron-shaped ipcMain with stable prototype methods', () => {
  const ipcMain = electronShapedIpcMainHarness();
  const runtime = createBuilderAgentTestBrowserIpcRuntime({
    agentTestBrowserRuntime: {
      runtime_version: 'builder-agent-test-browser-runtime.v1',
      stop(request) { return Object.freeze({ closed: false, owner_run_id: request.owner_run_id }); },
      updateLayout() { return Object.freeze({ operation: 'not_active' }); },
      subscribeLifecycle() { return () => undefined; },
    },
    ipcMain,
    mainWindowRef: () => ({ webContents: {} }),
  });
  assert.equal(runtime.register(), true);
  assert.equal(ipcMain.handlers.has(UPDATE_AGENT_TEST_BROWSER_LAYOUT_CHANNEL), true);
  assert.equal(runtime.dispose(), true);
});
