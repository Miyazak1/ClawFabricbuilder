'use strict';

const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const {
  AVAILABILITY_CHANNEL,
  CANCEL_CHANNEL,
  GENERATE_CHANNEL,
} = require('../electron/builder-generation-ipc-adapter.cjs');
const {
  BuilderGenerationIpcRuntimeError,
  createBuilderGenerationIpcRuntime,
} = require('../electron/builder-generation-ipc-runtime.cjs');

function temporaryUserData(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-generation-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function digest(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function activeWindow() {
  const webContents = { isDestroyed: () => false };
  return { webContents, isDestroyed: () => false };
}

function fakeIpcMain(failOnChannel = null, failRemoveOnChannel = null) {
  const handlers = new Map();
  const removed = [];
  const authority = {
    handlers,
    removed,
    failRemoveOnChannel,
    handle(channel, handler) {
      if (channel === failOnChannel || handlers.has(channel)) throw new Error('private registration failure');
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      if (channel === authority.failRemoveOnChannel) throw new Error('private removal failure');
      removed.push(channel);
      handlers.delete(channel);
    },
  };
  return authority;
}

function runtimeWithService(service) {
  const runtimePath = path.join(__dirname, '..', 'electron', 'builder-generation-ipc-runtime.cjs');
  const source = fs.readFileSync(runtimePath, 'utf8');
  const context = vm.createContext({
    __dirname: path.dirname(runtimePath),
    Buffer,
    exports: {},
    module: { exports: {} },
    process,
    require(specifier) {
      if (specifier.startsWith('node:')) return require(specifier);
      if (specifier === './builder-generation-ipc-adapter.cjs') {
        return {
          GENERATE_CHANNEL,
          CANCEL_CHANNEL,
          AVAILABILITY_CHANNEL,
          createBuilderGenerationIpcAdapter: (options) => ({
            channels: {
              generate: { invoke: (_event, request) => options.generate(request) },
              cancel: { invoke: (_event, request) => options.cancel(request) },
              availability: { invoke: () => options.availability() },
            },
          }),
        };
      }
      if (specifier === './builder-generation-main-service.cjs') {
        return { createBuilderGenerationMainService: () => service };
      }
      if (specifier === './builder-project-revision-repository.cjs') {
        return { createBuilderProjectRevisionRepository: () => ({ load_revision() {} }) };
      }
      if (specifier === './builder-provider-config-repository.cjs') {
        return { createBuilderProviderConfigRepository: () => ({ bind_current_authority() {} }) };
      }
      return require(path.join(path.dirname(runtimePath), specifier));
    },
  });
  vm.runInContext(source, context, { filename: runtimePath });
  return {
    createRuntime(options) {
      context.__ipcMain = options.ipcMain;
      context.__mainWindow = options.mainWindow;
      context.__userDataPath = options.userDataPath;
      return vm.runInContext(`module.exports.createBuilderGenerationIpcRuntime({
        ipcMain: __ipcMain,
        mainWindowRef: () => __mainWindow,
        userDataPath: __userDataPath,
      })`, context);
    },
  };
}

test('registers exactly the controlled generation channels and keeps provider storage lazy', async (t) => {
  const userDataPath = temporaryUserData(t);
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const runtime = createBuilderGenerationIpcRuntime({
    ipcMain,
    mainWindowRef: () => mainWindow,
    userDataPath,
  });

  assert.equal(runtime.runtime_version, 'builder-generation-ipc-runtime.v1');
  assert.deepEqual(runtime.channels, [GENERATE_CHANNEL, CANCEL_CHANNEL, AVAILABILITY_CHANNEL]);
  assert.equal(fs.existsSync(path.join(userDataPath, 'builder-provider-config-v1')), false);
  assert.equal(fs.existsSync(path.join(userDataPath, 'builder-provider-secrets-v1')), false);
  assert.equal(runtime.register(), true);
  assert.equal(runtime.register(), false);
  assert.deepEqual([...ipcMain.handlers.keys()], runtime.channels);

  const availability = await ipcMain.handlers.get(AVAILABILITY_CHANNEL)(
    { sender: mainWindow.webContents },
  );
  assert.deepEqual(availability, {
    version: 'builder-generation-availability.v1',
    available: false,
    reason: 'not_configured',
    supports_cancel: true,
  });
  assert.equal(runtime.dispose(), true);
  assert.equal(runtime.dispose(), false);
  assert.deepEqual([...ipcMain.handlers.keys()], []);
  assert.throws(() => runtime.register(), {
    code: 'builder_generation_ipc_runtime_unavailable',
  });
});

test('keeps active-renderer and request validation inside the controlled adapter', async (t) => {
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const runtime = createBuilderGenerationIpcRuntime({
    ipcMain,
    mainWindowRef: () => mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();

  await assert.rejects(
    ipcMain.handlers.get(AVAILABILITY_CHANNEL)({ sender: {} }),
    (error) => error.code === 'builder_generation_forbidden'
      && error.stack === `${error.name}: ${error.message}`,
  );
  await assert.rejects(
    ipcMain.handlers.get(GENERATE_CHANNEL)({ sender: mainWindow.webContents }, { private: 'marker' }),
    (error) => error.code === 'builder_generation_request_invalid'
      && !`${error.message}:${error.stack}`.includes('marker'),
  );
  await assert.rejects(
    ipcMain.handlers.get(CANCEL_CHANNEL)({ sender: mainWindow.webContents }, { request_id: 'bad' }),
    (error) => error.code === 'builder_generation_request_invalid',
  );
});

test('rolls back partial registration and rejects malformed runtime authority', (t) => {
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain(CANCEL_CHANNEL);
  const runtime = createBuilderGenerationIpcRuntime({
    ipcMain,
    mainWindowRef: () => mainWindow,
    userDataPath: temporaryUserData(t),
  });
  assert.throws(() => runtime.register(), (error) => (
    error instanceof BuilderGenerationIpcRuntimeError
    && error.code === 'builder_generation_ipc_runtime_unavailable'
    && error.stack === `${error.name}: ${error.message}`
  ));
  assert.deepEqual([...ipcMain.handlers.keys()], []);
  assert.deepEqual(ipcMain.removed, [GENERATE_CHANNEL]);

  const removalFailure = fakeIpcMain(CANCEL_CHANNEL, GENERATE_CHANNEL);
  const cleanupRuntime = createBuilderGenerationIpcRuntime({
    ipcMain: removalFailure,
    mainWindowRef: () => mainWindow,
    userDataPath: temporaryUserData(t),
  });
  assert.throws(() => cleanupRuntime.register(), {
    code: 'builder_generation_ipc_runtime_unavailable',
  });
  assert.equal(removalFailure.handlers.has(GENERATE_CHANNEL), true);
  assert.throws(() => cleanupRuntime.dispose(), {
    code: 'builder_generation_ipc_runtime_unavailable',
  });
  removalFailure.failRemoveOnChannel = null;
  assert.equal(cleanupRuntime.dispose(), true);
  assert.deepEqual([...removalFailure.handlers.keys()], []);

  for (const invalid of [
    null,
    {},
    { ipcMain, mainWindowRef: () => mainWindow, userDataPath: 'relative' },
    {
      ipcMain,
      mainWindowRef: () => mainWindow,
      userDataPath: temporaryUserData(t),
      extra: true,
    },
    new Proxy({}, { getPrototypeOf() { throw new Error('private trap'); } }),
  ]) {
    assert.throws(
      () => createBuilderGenerationIpcRuntime(invalid),
      (error) => error instanceof BuilderGenerationIpcRuntimeError
        && !`${error.message}:${error.stack}`.includes('private'),
    );
  }

  let getterCalls = 0;
  const accessorIpcMain = {};
  Object.defineProperties(accessorIpcMain, {
    handle: { get() { getterCalls += 1; return () => {}; } },
    removeHandler: { get() { getterCalls += 1; return () => {}; } },
  });
  assert.throws(() => createBuilderGenerationIpcRuntime({
    ipcMain: accessorIpcMain,
    mainWindowRef: () => mainWindow,
    userDataPath: temporaryUserData(t),
  }), { code: 'builder_generation_ipc_runtime_unavailable' });
  assert.equal(getterCalls, 0);
});

test('cancels every accepted generation before removing its cancel channel', async (t) => {
  let rejectGeneration;
  const cancelRequests = [];
  const service = {
    generate() {
      return new Promise((_resolve, reject) => { rejectGeneration = reject; });
    },
    cancel(request) {
      cancelRequests.push(request);
      const error = new Error('private provider request');
      error.code = 'builder_generation_cancelled';
      rejectGeneration(error);
      return { request_id: request.request_id, cancelled: true };
    },
    availability() {
      return { version: 'builder-generation-availability.v1', available: true, reason: 'ready', supports_cancel: true };
    },
  };
  const runtimeModule = runtimeWithService(service);
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const runtime = runtimeModule.createRuntime({
    ipcMain,
    mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();
  const requestBody = {
    version: 'builder-generation-request.v1',
    idea: 'Make a timer.',
    project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174000',
    target_revision: 1,
    parent_revision: null,
  };
  const request = { ...requestBody, request_digest: digest(requestBody) };
  const operation = ipcMain.handlers.get(GENERATE_CHANNEL)({ sender: mainWindow.webContents }, request);
  const cancelled = assert.rejects(operation, { code: 'builder_generation_cancelled' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.dispose(), true);
  assert.equal(cancelRequests.length, 1);
  assert.equal(cancelRequests[0].request_id, request.request_digest);
  await cancelled;
  assert.deepEqual([...ipcMain.handlers.keys()], []);
});

test('contains no preload, renderer, settings write, generic provider, or legacy authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-generation-ipc-runtime.cjs'),
    'utf8',
  );
  for (const forbidden of [
    /ipcRenderer|contextBridge|BrowserWindow/u,
    /write_current|credential|safeStorage|providerSettings/u,
    /local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/u,
  ]) assert.doesNotMatch(source, forbidden);
  assert.match(source, /createBuilderGenerationMainService/u);
  assert.match(source, /createBuilderGenerationIpcAdapter/u);
  assert.match(source, /bind_current_authority/u);
});
