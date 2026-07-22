'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  RUNTIME_VERSION,
  MINIMIZE_CHANNEL,
  TOGGLE_MAXIMIZE_CHANNEL,
  CLOSE_CHANNEL,
  READ_STATE_CHANNEL,
  BuilderWindowControlsIpcRuntimeError,
  createBuilderWindowControlsIpcRuntime,
} = require('../electron/builder-window-controls-ipc-runtime.cjs');

const EXACT_CHANNELS = Object.freeze([
  'clawfabric-builder:window-controls:minimize',
  'clawfabric-builder:window-controls:toggle-maximize',
  'clawfabric-builder:window-controls:close',
  'clawfabric-builder:window-controls:read-state',
]);

function fakeIpcMain({ failHandle = null, failRemove = null } = {}) {
  const handlers = new Map();
  const removed = [];
  const authority = {
    handlers,
    removed,
    failRemove,
    handle(channel, handler) {
      if (channel === failHandle || handlers.has(channel)) {
        throw new Error('private registration detail');
      }
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      if (channel === authority.failRemove) throw new Error('private removal detail');
      removed.push(channel);
      handlers.delete(channel);
    },
  };
  return authority;
}

function fakeWindow() {
  const calls = [];
  let destroyed = false;
  let webContentsDestroyed = false;
  let maximized = false;
  const webContents = {
    isDestroyed() {
      return webContentsDestroyed;
    },
  };
  const windowRef = {
    webContents,
    calls,
    isDestroyed() {
      return destroyed;
    },
    minimize() {
      calls.push('minimize');
    },
    isMaximized() {
      calls.push('isMaximized');
      return maximized;
    },
    maximize() {
      calls.push('maximize');
      maximized = true;
    },
    unmaximize() {
      calls.push('unmaximize');
      maximized = false;
    },
    close() {
      calls.push('close');
    },
    setDestroyed(value) {
      destroyed = value;
    },
    setWebContentsDestroyed(value) {
      webContentsDestroyed = value;
    },
  };
  return windowRef;
}

function registeredRuntime(windowRef = fakeWindow(), ipcMain = fakeIpcMain()) {
  const runtime = createBuilderWindowControlsIpcRuntime({
    ipcMain,
    mainWindowRef: () => windowRef,
  });
  runtime.register();
  return { runtime, ipcMain, windowRef };
}

function assertFixedError(operation, code, message = 'Builder window controls are unavailable.') {
  assert.throws(
    operation,
    (error) => error instanceof BuilderWindowControlsIpcRuntimeError
      && error.code === code
      && error.message === message
      && error.stack === `${error.name}: ${error.message}`
      && !`${error.message}:${error.stack}`.includes('private'),
  );
}

test('registers exactly the four fixed window-control channels', () => {
  const ipcMain = fakeIpcMain();
  const runtime = createBuilderWindowControlsIpcRuntime({
    ipcMain,
    mainWindowRef: () => fakeWindow(),
  });

  assert.equal(RUNTIME_VERSION, 'builder-window-controls-ipc-runtime.v1');
  assert.deepEqual([
    MINIMIZE_CHANNEL,
    TOGGLE_MAXIMIZE_CHANNEL,
    CLOSE_CHANNEL,
    READ_STATE_CHANNEL,
  ], EXACT_CHANNELS);
  assert.deepEqual(Array.from(runtime.channels), EXACT_CHANNELS);
  assert.equal(Object.isFrozen(runtime), true);
  assert.equal(Object.isFrozen(runtime.channels), true);
  assert.equal(runtime.register(), true);
  assert.deepEqual([...ipcMain.handlers.keys()], EXACT_CHANNELS);
  assertFixedError(
    () => runtime.register(),
    'builder_window_controls_ipc_runtime_unavailable',
  );
  assert.deepEqual([...ipcMain.handlers.keys()], EXACT_CHANNELS);
});

test('requires the exact active renderer sender and fails closed for null or destroyed windows', () => {
  const windowRef = fakeWindow();
  const { ipcMain } = registeredRuntime(windowRef);
  const invoke = ipcMain.handlers.get(MINIMIZE_CHANNEL);

  assertFixedError(() => invoke({ sender: {} }), 'builder_window_controls_forbidden');
  assert.deepEqual(windowRef.calls, []);

  const nullRuntime = registeredRuntime(null);
  assertFixedError(
    () => nullRuntime.ipcMain.handlers.get(MINIMIZE_CHANNEL)({ sender: windowRef.webContents }),
    'builder_window_controls_forbidden',
  );

  windowRef.setDestroyed(true);
  assertFixedError(
    () => invoke({ sender: windowRef.webContents }),
    'builder_window_controls_forbidden',
  );
  windowRef.setDestroyed(false);
  windowRef.setWebContentsDestroyed(true);
  assertFixedError(
    () => invoke({ sender: windowRef.webContents }),
    'builder_window_controls_forbidden',
  );
  assert.deepEqual(windowRef.calls, []);
});

test('rejects every renderer payload before resolving or acting on the main window', () => {
  const windowRef = fakeWindow();
  const ipcMain = fakeIpcMain();
  let mainWindowRefCalls = 0;
  const runtime = createBuilderWindowControlsIpcRuntime({
    ipcMain,
    mainWindowRef() {
      mainWindowRefCalls += 1;
      return windowRef;
    },
  });
  runtime.register();
  const event = { sender: windowRef.webContents };

  for (const channel of EXACT_CHANNELS) {
    for (const payload of [{ extra: true }, null, Symbol('extra-payload')]) {
      assertFixedError(
        () => ipcMain.handlers.get(channel)(event, payload),
        'builder_window_controls_forbidden',
      );
    }
  }

  assert.equal(mainWindowRefCalls, 0);
  assert.deepEqual(windowRef.calls, []);
});

test('executes minimize, maximize, unmaximize, and close only through the main window', () => {
  const { ipcMain, windowRef } = registeredRuntime();
  const event = { sender: windowRef.webContents };
  const expectedResult = {
    result_version: 'builder-window-control-result.v1',
    ok: true,
  };

  const minimized = ipcMain.handlers.get(MINIMIZE_CHANNEL)(event);
  const maximized = ipcMain.handlers.get(TOGGLE_MAXIMIZE_CHANNEL)(event);
  const unmaximized = ipcMain.handlers.get(TOGGLE_MAXIMIZE_CHANNEL)(event);
  const closed = ipcMain.handlers.get(CLOSE_CHANNEL)(event);

  for (const result of [minimized, maximized, unmaximized, closed]) {
    assert.deepEqual(result, expectedResult);
    assert.equal(Object.isFrozen(result), true);
    assert.deepEqual(Reflect.ownKeys(result), ['result_version', 'ok']);
  }
  assert.deepEqual(windowRef.calls, [
    'minimize',
    'isMaximized',
    'maximize',
    'isMaximized',
    'unmaximize',
    'close',
  ]);
});

test('read-state returns the exact deeply frozen state packet', () => {
  const { ipcMain, windowRef } = registeredRuntime();
  const event = { sender: windowRef.webContents };
  const readState = ipcMain.handlers.get(READ_STATE_CHANNEL);

  const initial = readState(event);
  assert.deepEqual(initial, {
    state_version: 'builder-window-state.v1',
    maximized: false,
  });
  assert.deepEqual(Reflect.ownKeys(initial), ['state_version', 'maximized']);
  assert.equal(Object.isFrozen(initial), true);

  ipcMain.handlers.get(TOGGLE_MAXIMIZE_CHANNEL)(event);
  const changed = readState(event);
  assert.deepEqual(changed, {
    state_version: 'builder-window-state.v1',
    maximized: true,
  });
  assert.equal(Object.isFrozen(changed), true);
});

test('normalizes raw BrowserWindow failures without leaking objects or error details', () => {
  const windowRef = fakeWindow();
  windowRef.minimize = function minimize() {
    const error = new Error('private BrowserWindow marker');
    error.windowRef = windowRef;
    throw error;
  };
  const { ipcMain } = registeredRuntime(windowRef);

  assertFixedError(
    () => ipcMain.handlers.get(MINIMIZE_CHANNEL)({ sender: windowRef.webContents }),
    'builder_window_controls_failed',
  );
});

test('rolls back partial registration and dispose removes handlers permanently', () => {
  const registrationFailure = fakeIpcMain({ failHandle: CLOSE_CHANNEL });
  const failedRuntime = createBuilderWindowControlsIpcRuntime({
    ipcMain: registrationFailure,
    mainWindowRef: () => fakeWindow(),
  });
  assertFixedError(
    () => failedRuntime.register(),
    'builder_window_controls_ipc_runtime_unavailable',
  );
  assert.deepEqual([...registrationFailure.handlers.keys()], []);
  assert.deepEqual(registrationFailure.removed, [TOGGLE_MAXIMIZE_CHANNEL, MINIMIZE_CHANNEL]);

  const { runtime, ipcMain } = registeredRuntime();
  assert.equal(runtime.dispose(), true);
  assert.deepEqual([...ipcMain.handlers.keys()], []);
  assert.deepEqual(ipcMain.removed, [...EXACT_CHANNELS].reverse());
  assert.equal(runtime.dispose(), false);
  assertFixedError(
    () => runtime.register(),
    'builder_window_controls_ipc_runtime_unavailable',
  );
});

test('reports fixed cleanup failure and allows dispose to finish rollback cleanup', () => {
  const ipcMain = fakeIpcMain({
    failHandle: CLOSE_CHANNEL,
    failRemove: MINIMIZE_CHANNEL,
  });
  const runtime = createBuilderWindowControlsIpcRuntime({
    ipcMain,
    mainWindowRef: () => fakeWindow(),
  });

  assertFixedError(
    () => runtime.register(),
    'builder_window_controls_ipc_runtime_cleanup_required',
    'Builder window controls cleanup is required.',
  );
  assert.deepEqual([...ipcMain.handlers.keys()], [MINIMIZE_CHANNEL]);
  ipcMain.failRemove = null;
  assert.equal(runtime.dispose(), true);
  assert.deepEqual([...ipcMain.handlers.keys()], []);
  assertFixedError(
    () => runtime.register(),
    'builder_window_controls_ipc_runtime_unavailable',
  );
});

test('rejects proxy, accessor, symbol, extra, and unstable runtime options without traps', () => {
  const ipcMain = fakeIpcMain();
  const mainWindowRef = () => fakeWindow();
  let trapCalls = 0;
  const proxiedOptions = new Proxy({}, {
    getPrototypeOf() {
      trapCalls += 1;
      throw new Error('private proxy trap');
    },
  });
  const symbol = Symbol('private');
  for (const invalid of [
    null,
    {},
    { ipcMain, mainWindowRef, extra: true },
    { ipcMain, mainWindowRef, [symbol]: true },
    proxiedOptions,
  ]) {
    assertFixedError(
      () => createBuilderWindowControlsIpcRuntime(invalid),
      'builder_window_controls_ipc_runtime_unavailable',
    );
  }
  assert.equal(trapCalls, 0);

  let getterCalls = 0;
  const accessorOptions = { ipcMain };
  Object.defineProperty(accessorOptions, 'mainWindowRef', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return mainWindowRef;
    },
  });
  assertFixedError(
    () => createBuilderWindowControlsIpcRuntime(accessorOptions),
    'builder_window_controls_ipc_runtime_unavailable',
  );

  const accessorIpcMain = {};
  Object.defineProperties(accessorIpcMain, {
    handle: { get() { getterCalls += 1; return () => {}; } },
    removeHandler: { get() { getterCalls += 1; return () => {}; } },
  });
  assertFixedError(
    () => createBuilderWindowControlsIpcRuntime({ ipcMain: accessorIpcMain, mainWindowRef }),
    'builder_window_controls_ipc_runtime_unavailable',
  );

  let applyTrapCalls = 0;
  const proxiedFunction = new Proxy(function authority() {}, {
    apply() {
      applyTrapCalls += 1;
      throw new Error('private apply trap');
    },
  });
  for (const invalid of [
    { ipcMain: { handle: proxiedFunction, removeHandler() {} }, mainWindowRef },
    { ipcMain: { handle() {}, removeHandler: proxiedFunction }, mainWindowRef },
    { ipcMain, mainWindowRef: proxiedFunction },
  ]) {
    assertFixedError(
      () => createBuilderWindowControlsIpcRuntime(invalid),
      'builder_window_controls_ipc_runtime_unavailable',
    );
  }
  assert.equal(getterCalls, 0);
  assert.equal(applyTrapCalls, 0);
});

test('contains no preload, renderer, package, provider, secret, or generic IPC authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-window-controls-ipc-runtime.cjs'),
    'utf8',
  );
  for (const forbidden of [
    /ipcRenderer|contextBridge|preload|BrowserWindow/u,
    /React|BuilderApp|BuilderPage|styles\.css/u,
    /provider|secret|credential|Authorization|safeStorage/iu,
    /generic.*ipc|ipc.*generic/iu,
    /main\.cjs|package\.json/u,
  ]) assert.doesNotMatch(source, forbidden);
  assert.equal((source.match(/clawfabric-builder:window-controls:/gu) ?? []).length, 4);
});
