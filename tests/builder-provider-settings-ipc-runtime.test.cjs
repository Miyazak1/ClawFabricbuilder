'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const {
  createBuilderProviderConfig,
} = require('../electron/builder-provider-config.cjs');
const {
  READ_CURRENT_CHANNEL,
  REPLACE_CURRENT_CHANNEL,
  STATUS_CHANNEL,
} = require('../electron/builder-provider-settings-ipc-adapter.cjs');
const {
  BuilderProviderSettingsIpcRuntimeError,
  createBuilderProviderSettingsIpcRuntime,
} = require('../electron/builder-provider-settings-ipc-runtime.cjs');

function temporaryUserData(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-settings-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
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

function secretRef() {
  return {
    ref_version: 'builder-provider-secret-ref.v1',
    provider_id: 'builder-default',
    secret_id: 'builder-provider-secret:default',
  };
}

function providerConfig(overrides = {}) {
  return createBuilderProviderConfig({
    base_url: 'https://provider.example/v1',
    model: 'builder-model',
    timeout_ms: 30000,
    temperature: 0.2,
    max_tokens: 8192,
    secret_ref: secretRef(),
    ...overrides,
  });
}

function repositoryEnvelope(config = providerConfig()) {
  return {
    result_version: 'builder-provider-config-repository.v1',
    config,
    secret_binding: {
      binding_version: 'builder-provider-secret-binding.v1',
      secret_ref: secretRef(),
      encrypted_secret_digest: `sha256:${'b'.repeat(64)}`,
    },
    restart_restore: true,
    persistence_evidence: {
      secret_file_fsync: 'private-evidence-marker',
    },
  };
}

function repositoryError(code) {
  const error = new Error('private repository failure');
  error.code = code;
  error.stack = 'private repository stack';
  return error;
}

function runtimeWithRepository(createRepository) {
  const runtimePath = path.join(__dirname, '..', 'electron', 'builder-provider-settings-ipc-runtime.cjs');
  const source = fs.readFileSync(runtimePath, 'utf8');
  const realSettingsAdapter = require('../electron/builder-provider-settings-ipc-adapter.cjs');
  const context = vm.createContext({
    __dirname: path.dirname(runtimePath),
    Buffer,
    exports: {},
    module: { exports: {} },
    process,
    require(specifier) {
      if (specifier.startsWith('node:')) return require(specifier);
      if (specifier === './builder-provider-settings-ipc-adapter.cjs') {
        return {
          READ_CURRENT_CHANNEL,
          REPLACE_CURRENT_CHANNEL,
          STATUS_CHANNEL,
          createBuilderProviderSettingsIpcAdapter: (options) => (
            realSettingsAdapter.createBuilderProviderSettingsIpcAdapter({
              readCurrent: options.readCurrent,
              writeCurrent: options.writeCurrent,
              mainWindowRef: options.mainWindowRef,
            })
          ),
        };
      }
      if (specifier === './builder-provider-config-repository.cjs') {
        return { createBuilderProviderConfigRepository: createRepository };
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
      return vm.runInContext(`module.exports.createBuilderProviderSettingsIpcRuntime({
        ipcMain: __ipcMain,
        mainWindowRef: () => __mainWindow,
        userDataPath: __userDataPath,
      })`, context);
    },
  };
}

test('registers exactly the controlled settings channels and keeps repository creation lazy', (t) => {
  let createCount = 0;
  const runtimeModule = runtimeWithRepository(() => {
    createCount += 1;
    return {
      read_current() {
        throw repositoryError('builder_provider_config_repository_not_found');
      },
      write_current() {
        throw repositoryError('builder_provider_config_repository_unavailable');
      },
    };
  });
  const userDataPath = temporaryUserData(t);
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const runtime = runtimeModule.createRuntime({ ipcMain, mainWindow, userDataPath });

  assert.equal(runtime.runtime_version, 'builder-provider-settings-ipc-runtime.v1');
  assert.deepEqual(Array.from(runtime.channels), [READ_CURRENT_CHANNEL, REPLACE_CURRENT_CHANNEL, STATUS_CHANNEL]);
  assert.equal(createCount, 0);
  assert.equal(runtime.register(), true);
  assert.equal(runtime.register(), false);
  assert.deepEqual([...ipcMain.handlers.keys()], Array.from(runtime.channels));
  assert.equal(createCount, 0);
  assert.deepEqual(ipcMain.handlers.get(STATUS_CHANNEL)({ sender: mainWindow.webContents }), {
    status_version: 'builder-provider-settings-status.v1',
    configured: false,
    config_digest: null,
    credential_status: 'missing',
  });
  assert.equal(createCount, 1);
  assert.equal(runtime.dispose(), true);
  assert.equal(runtime.dispose(), false);
  assert.deepEqual([...ipcMain.handlers.keys()], []);
  assert.throws(() => runtime.register(), {
    code: 'builder_provider_settings_ipc_runtime_unavailable',
  });
});

test('forwards read and replace through lazy main-only repository authority without readback leakage', (t) => {
  const calls = [];
  const runtimeModule = runtimeWithRepository((rootPath) => {
    calls.push(['createRepository', rootPath]);
    return {
      read_current() {
        calls.push(['read_current']);
        return repositoryEnvelope();
      },
      write_current(request) {
        calls.push(['write_current', request]);
        return repositoryEnvelope(providerConfig(request.config));
      },
    };
  });
  const userDataPath = temporaryUserData(t);
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const runtime = runtimeModule.createRuntime({ ipcMain, mainWindow, userDataPath });
  runtime.register();
  const read = ipcMain.handlers.get(READ_CURRENT_CHANNEL)({ sender: mainWindow.webContents });
  assert.equal(read.config.model, 'builder-model');
  const request = {
    config: {
      base_url: 'https://provider.example/v1',
      model: 'replacement-model',
      timeout_ms: 45000,
      temperature: null,
      max_tokens: null,
      secret_ref: secretRef(),
    },
    credential: 'real-key-value',
  };
  const replaced = ipcMain.handlers.get(REPLACE_CURRENT_CHANNEL)({ sender: mainWindow.webContents }, request);

  assert.equal(replaced.config.model, 'replacement-model');
  for (const result of [read, replaced]) {
    assert.doesNotMatch(
      JSON.stringify(result),
      /real-key-value|secret_ref|secret_binding|encrypted_secret_digest|private-evidence-marker/iu,
    );
  }
  assert.deepEqual(calls, [
    ['createRepository', userDataPath],
    ['read_current'],
    ['write_current', request],
  ]);
});

test('keeps active renderer and payload validation inside the controlled settings adapter', (t) => {
  let createCount = 0;
  const runtimeModule = runtimeWithRepository(() => {
    createCount += 1;
    return {
      read_current() {
        return repositoryEnvelope();
      },
      write_current() {
        return repositoryEnvelope();
      },
    };
  });
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const runtime = runtimeModule.createRuntime({
    ipcMain,
    mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();

  assert.throws(
    () => ipcMain.handlers.get(READ_CURRENT_CHANNEL)({ sender: {} }),
    (error) => error.code === 'builder_provider_settings_forbidden'
      && error.stack === `${error.name}: ${error.message}`,
  );
  assert.throws(
    () => ipcMain.handlers.get(REPLACE_CURRENT_CHANNEL)({ sender: mainWindow.webContents }),
    (error) => error.code === 'builder_provider_settings_request_invalid',
  );
  assert.equal(createCount, 0);
});

test('rolls back partial registration and reports retryable cleanup failures', (t) => {
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain(REPLACE_CURRENT_CHANNEL);
  const runtime = createBuilderProviderSettingsIpcRuntime({
    ipcMain,
    mainWindowRef: () => mainWindow,
    userDataPath: temporaryUserData(t),
  });

  assert.throws(
    () => runtime.register(),
    (error) => error instanceof BuilderProviderSettingsIpcRuntimeError
      && error.code === 'builder_provider_settings_ipc_runtime_unavailable'
      && error.retryable === false
      && error.stack === `${error.name}: ${error.message}`,
  );
  assert.deepEqual([...ipcMain.handlers.keys()], []);
  assert.deepEqual(ipcMain.removed, [READ_CURRENT_CHANNEL]);

  const removalFailure = fakeIpcMain(REPLACE_CURRENT_CHANNEL, READ_CURRENT_CHANNEL);
  const cleanupRuntime = createBuilderProviderSettingsIpcRuntime({
    ipcMain: removalFailure,
    mainWindowRef: () => mainWindow,
    userDataPath: temporaryUserData(t),
  });
  assert.throws(
    () => cleanupRuntime.register(),
    (error) => error.code === 'builder_provider_settings_ipc_runtime_cleanup_required'
      && error.retryable === true,
  );
  assert.equal(removalFailure.handlers.has(READ_CURRENT_CHANNEL), true);
  assert.throws(
    () => cleanupRuntime.dispose(),
    (error) => error.code === 'builder_provider_settings_ipc_runtime_cleanup_required'
      && error.retryable === true,
  );
  removalFailure.failRemoveOnChannel = null;
  assert.equal(cleanupRuntime.dispose(), true);
  assert.deepEqual([...removalFailure.handlers.keys()], []);
});

test('rejects malformed runtime authority without invoking getters or proxy traps', (t) => {
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const userDataPath = temporaryUserData(t);
  for (const invalid of [
    null,
    {},
    { ipcMain, mainWindowRef: () => mainWindow, userDataPath: 'relative' },
    { ipcMain, mainWindowRef: () => mainWindow, userDataPath, extra: true },
    new Proxy({}, { getPrototypeOf() { throw new Error('private trap'); } }),
  ]) {
    assert.throws(
      () => createBuilderProviderSettingsIpcRuntime(invalid),
      (error) => error instanceof BuilderProviderSettingsIpcRuntimeError
        && error.code === 'builder_provider_settings_ipc_runtime_unavailable'
        && !`${error.message}:${error.stack}`.includes('private'),
    );
  }

  let getterCalls = 0;
  const accessorOptions = { ipcMain, userDataPath };
  Object.defineProperty(accessorOptions, 'mainWindowRef', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return () => mainWindow;
    },
  });
  assert.throws(() => createBuilderProviderSettingsIpcRuntime(accessorOptions), {
    code: 'builder_provider_settings_ipc_runtime_unavailable',
  });
  const accessorIpcMain = {};
  Object.defineProperties(accessorIpcMain, {
    handle: { get() { getterCalls += 1; return () => {}; } },
    removeHandler: { get() { getterCalls += 1; return () => {}; } },
  });
  assert.throws(() => createBuilderProviderSettingsIpcRuntime({
    ipcMain: accessorIpcMain,
    mainWindowRef: () => mainWindow,
    userDataPath,
  }), { code: 'builder_provider_settings_ipc_runtime_unavailable' });
  assert.equal(getterCalls, 0);

  let applyTrapCalls = 0;
  function proxiedFunction() {}
  const proxyFunction = new Proxy(proxiedFunction, {
    apply() {
      applyTrapCalls += 1;
      return undefined;
    },
  });
  for (const proxyAuthority of [
    {
      ipcMain: { handle: proxyFunction, removeHandler() {} },
      mainWindowRef: () => mainWindow,
      userDataPath,
    },
    {
      ipcMain: { handle() {}, removeHandler: proxyFunction },
      mainWindowRef: () => mainWindow,
      userDataPath,
    },
    {
      ipcMain,
      mainWindowRef: proxyFunction,
      userDataPath,
    },
  ]) {
    assert.throws(
      () => createBuilderProviderSettingsIpcRuntime(proxyAuthority),
      (error) => error instanceof BuilderProviderSettingsIpcRuntimeError
        && error.code === 'builder_provider_settings_ipc_runtime_unavailable'
        && !`${error.message}:${error.stack}`.includes('private'),
    );
  }
  assert.equal(applyTrapCalls, 0);
});

test('repository unavailability is lazy and does not crash startup or registration', (t) => {
  let createCount = 0;
  const runtimeModule = runtimeWithRepository(() => {
    createCount += 1;
    throw new Error('private safeStorage startup marker');
  });
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const runtime = runtimeModule.createRuntime({
    ipcMain,
    mainWindow,
    userDataPath: temporaryUserData(t),
  });

  assert.equal(createCount, 0);
  assert.equal(runtime.register(), true);
  assert.equal(createCount, 0);
  assert.throws(
    () => ipcMain.handlers.get(STATUS_CHANNEL)({ sender: mainWindow.webContents }),
    (error) => error.code === 'builder_provider_settings_failed'
      && !`${error.message}:${error.stack}`.includes('private safeStorage'),
  );
  assert.equal(createCount, 1);
});

test('contains no preload, renderer, direct UI, generic provider, or legacy authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-provider-settings-ipc-runtime.cjs'),
    'utf8',
  );
  for (const forbidden of [
    /ipcRenderer|contextBridge|BrowserWindow/u,
    /providerSettings|clawfabricBuilder|window\./u,
    /fetch\s*\(|https?:|Authorization/u,
    /local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta|AppLayout/u,
    /generic.*(?:config|secret)|secure-provider/u,
  ]) assert.doesNotMatch(source, forbidden);
  assert.match(source, /createBuilderProviderSettingsIpcAdapter/u);
  assert.match(source, /createBuilderProviderConfigRepository/u);
  assert.match(source, /read_current/u);
  assert.match(source, /write_current/u);
});
