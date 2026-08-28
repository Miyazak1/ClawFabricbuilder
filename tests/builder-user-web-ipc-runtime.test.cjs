'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createBuilderUserWebIpcRuntime,
} = require('../electron/builder-user-web-ipc-runtime.cjs');

function fixture() {
  const handlers = new Map();
  const calls = [];
  const ipcMain = {
    handle(channel, handler) { handlers.set(channel, handler); },
    removeHandler(channel) { handlers.delete(channel); },
  };
  const webContents = {};
  const service = {
    navigate(request) { calls.push(['navigate', request]); return { status: 'ready' }; },
    go_back() { calls.push(['back']); return { status: 'ready' }; },
    go_forward() { calls.push(['forward']); return { status: 'ready' }; },
    reload() { calls.push(['reload']); return { status: 'ready' }; },
    stop() { calls.push(['stop']); return { status: 'stopped' }; },
    read_status() { calls.push(['read']); return { status: 'idle' }; },
    update_layout(request) { calls.push(['layout', request]); return { status: 'ready' }; },
    async shutdown() { calls.push(['shutdown']); },
  };
  const runtime = createBuilderUserWebIpcRuntime({
    ipcMain,
    mainWindowRef: () => ({ webContents }),
    userWebService: service,
  });
  return { calls, handlers, runtime, webContents };
}

test('registers bounded User Web IPC for the active renderer only', async () => {
  const value = fixture();
  value.runtime.register();
  assert.equal(value.handlers.size, 7);
  const event = { sender: value.webContents };
  await value.handlers.get(value.runtime.channels.navigate)(event, { url: 'https://example.com/' });
  await value.handlers.get(value.runtime.channels.updateLayout)(event, {
    view_bounds: { x: 1, y: 2, width: 300, height: 400 },
  });
  await value.handlers.get(value.runtime.channels.reload)(event);
  assert.deepEqual(value.calls.slice(0, 3), [
    ['navigate', { url: 'https://example.com/' }],
    ['layout', { view_bounds: { x: 1, y: 2, width: 300, height: 400 } }],
    ['reload'],
  ]);

  assert.throws(
    () => value.handlers.get(value.runtime.channels.readStatus)({ sender: {} }),
    (error) => error.code === 'builder_user_web_ipc_forbidden',
  );
  await value.runtime.shutdown();
  assert.equal(value.handlers.size, 0);
  assert.deepEqual(value.calls.at(-1), ['shutdown']);
});
