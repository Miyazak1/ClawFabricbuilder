'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const mainPath = path.join(__dirname, '..', 'electron', 'main.cjs');
const mainSource = fs.readFileSync(mainPath, 'utf8');

async function executeMain({ singleInstanceLock, windowConstructionFails }) {
  const calls = {
    createRuntime: 0,
    dispose: 0,
    quit: 0,
    register: 0,
    whenReady: 0,
  };
  const events = new Map();
  const runtime = {
    dispose() { calls.dispose += 1; },
    register() { calls.register += 1; },
  };
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
            calls.createRuntime += 1;
            return runtime;
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
    createRuntime: 0,
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
    createRuntime: 1,
    dispose: 1,
    quit: 1,
    register: 1,
    whenReady: 1,
  });
  assert.equal(events.has('second-instance'), true);
  assert.equal(events.has('before-quit'), true);
  assert.equal(events.has('window-all-closed'), true);
});
