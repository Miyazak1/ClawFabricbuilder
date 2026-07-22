'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const mainPath = path.join(__dirname, '..', 'electron', 'main.cjs');
const mainSource = fs.readFileSync(mainPath, 'utf8');

async function executeMain({ singleInstanceLock, windowConstructionFails, failRegisterIndex = -1 }) {
  const calls = {
    createGenerationRuntime: 0,
    createProjectRuntime: 0,
    createSettingsRuntime: 0,
    dispose: 0,
    quit: 0,
    register: 0,
    whenReady: 0,
  };
  const events = new Map();
  function runtime(index) {
    return {
      index,
      dispose() { calls.dispose += 1; },
      register() {
        calls.register += 1;
        if (index === failRegisterIndex) throw new Error('private register marker');
      },
    };
  }
  const app = {
    getPath() { return path.join(process.cwd(), 'test-user-data'); },
    isPackaged: true,
    on(name, handler) { events.set(name, handler); },
    quit() { calls.quit += 1; },
    requestSingleInstanceLock() { return singleInstanceLock; },
    setAppUserModelId() {},
    whenReady() {
      calls.whenReady += 1;
      return Promise.resolve();
    },
  };
  class BrowserWindow {
    static getAllWindows() { return []; }
    constructor() {
      if (windowConstructionFails) throw new Error('window failed');
      throw new Error('unexpected successful window construction');
    }
  }
  const electron = {
    app,
    BrowserWindow,
    ipcMain: {},
    session: {
      defaultSession: {
        setPermissionCheckHandler() {},
        setPermissionRequestHandler() {},
      },
    },
  };
  const context = {
    __dirname: path.dirname(mainPath),
    exports: {},
    module: { exports: {} },
    process,
    require(specifier) {
      if (specifier === 'node:path') return path;
      if (specifier === 'electron') return electron;
      if (specifier === './runtime-options.cjs') {
        return { resolveBuilderRendererTarget: () => ({ kind: 'packaged_file' }) };
      }
      if (specifier === './builder-project-ipc-runtime.cjs') {
        return {
          createBuilderProjectIpcRuntime() {
            calls.createProjectRuntime += 1;
            return runtime(0);
          },
        };
      }
      if (specifier === './builder-provider-settings-ipc-runtime.cjs') {
        return {
          createBuilderProviderSettingsIpcRuntime() {
            calls.createSettingsRuntime += 1;
            return runtime(1);
          },
        };
      }
      if (specifier === './builder-generation-ipc-runtime.cjs') {
        return {
          createBuilderGenerationIpcRuntime() {
            calls.createGenerationRuntime += 1;
            return runtime(2);
          },
        };
      }
      throw new Error(`unexpected require: ${specifier}`);
    },
  };
  vm.runInNewContext(mainSource, context, { filename: mainPath });
  await new Promise((resolve) => setImmediate(resolve));
  return { calls, events };
}

test('a second application instance exits before registering Builder authorities', async () => {
  const { calls, events } = await executeMain({
    singleInstanceLock: false,
    windowConstructionFails: false,
  });
  assert.deepEqual(calls, {
    createGenerationRuntime: 0,
    createProjectRuntime: 0,
    createSettingsRuntime: 0,
    dispose: 0,
    quit: 1,
    register: 0,
    whenReady: 0,
  });
  assert.deepEqual([...events.keys()], []);
});

test('window startup failure disposes registered handlers and quits', async () => {
  const { calls, events } = await executeMain({
    singleInstanceLock: true,
    windowConstructionFails: true,
  });
  assert.deepEqual(calls, {
    createGenerationRuntime: 1,
    createProjectRuntime: 1,
    createSettingsRuntime: 1,
    dispose: 3,
    quit: 1,
    register: 3,
    whenReady: 1,
  });
  assert.equal(events.has('second-instance'), true);
  assert.equal(events.has('before-quit'), true);
  assert.equal(events.has('window-all-closed'), true);
});

test('runtime registration failure rolls back previously registered handlers and quits', async () => {
  const { calls } = await executeMain({
    singleInstanceLock: true,
    windowConstructionFails: false,
    failRegisterIndex: 1,
  });
  assert.deepEqual(calls, {
    createGenerationRuntime: 1,
    createProjectRuntime: 1,
    createSettingsRuntime: 1,
    dispose: 1,
    quit: 1,
    register: 2,
    whenReady: 1,
  });
});
