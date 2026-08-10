'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const mainPath = path.join(__dirname, '..', 'electron', 'main.cjs');
const mainSource = fs.readFileSync(mainPath, 'utf8');

async function executeMain({
  env = {},
  failCheckRunShutdown = false,
  failRegisterIndex = -1,
  iconExists = false,
  isPackaged = true,
  realpathMap = {},
  returnOnThrow = false,
  sessionDataExists = false,
  symlinkPaths = [],
  singleInstanceLock,
  windowConstructionFails,
}) {
  const calls = {
    createApprovalRuntime: 0,
    createCheckRunApprovalRuntime: 0,
    createGenerationRuntime: 0,
    createLivePreviewRuntime: 0,
    createPermissionRuntime: 0,
    createSettingsRuntime: 0,
    createWindowControlsRuntime: 0,
    dispose: 0,
    mkdir: 0,
    quit: 0,
    register: 0,
    setPath: [],
    shutdown: 0,
    whenReady: 0,
  };
  const applicationMenuCalls = [];
  const browserWindowOptions = [];
  const dialogCalls = [];
  let sessionCreated = sessionDataExists;
  let permissionGrantForExplicitApproval = null;
  let providerContextDisclosureStatusService = null;
  let currentDraftCheckRunService = null;
  const events = new Map();
  const generationRuntimeOptions = [];
  function runtime(index) {
    const grantForExplicitApproval = () => ({ ok: true });
    return {
      index,
      grantForExplicitApproval,
      dispose() { calls.dispose += 1; },
      register() {
        calls.register += 1;
        if (index === failRegisterIndex) throw new Error('private register marker');
      },
    };
  }
  const app = {
    getPath() { return path.join(process.cwd(), 'test-user-data'); },
    isPackaged,
    on(name, handler) { events.set(name, handler); },
    quit() { calls.quit += 1; },
    requestSingleInstanceLock() { return singleInstanceLock; },
    setAppUserModelId() {},
    setPath(name, value) { calls.setPath.push([name, value]); },
    whenReady() {
      calls.whenReady += 1;
      return Promise.resolve();
    },
  };
  class BrowserWindow {
    static getAllWindows() { return []; }
    constructor(options) {
      browserWindowOptions.push(options);
      if (windowConstructionFails) throw new Error('window failed');
      throw new Error('unexpected successful window construction');
    }
  }
  const electron = {
    app,
    BrowserWindow,
    dialog: {
      showOpenDialog(...args) {
        dialogCalls.push(args);
        return Promise.resolve({ canceled: true, filePaths: [] });
      },
    },
    Menu: {
      setApplicationMenu(value) {
        applicationMenuCalls.push(value);
      },
    },
    ipcMain: {},
    net: {
      fetch() {
        throw new Error('unexpected network request');
      },
    },
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
    process: Object.freeze({
      env,
      platform: process.platform,
    }),
    require(specifier) {
      if (specifier === 'node:fs') {
        return {
          lstatSync(target) {
            if (target.endsWith(`${path.sep}session-data`) && !sessionCreated) {
              const error = new Error('missing session');
              error.code = 'ENOENT';
              throw error;
            }
            return {
              isDirectory: () => true,
              isSymbolicLink: () => symlinkPaths.includes(target),
            };
          },
          mkdirSync(target) {
            calls.mkdir += 1;
            if (target.endsWith(`${path.sep}session-data`)) sessionCreated = true;
          },
          existsSync(target) {
            return iconExists && target === path.join(path.dirname(mainPath), '..', 'build', 'icon.ico');
          },
          realpathSync: {
            native(target) {
              return realpathMap[target] ?? target;
            },
          },
        };
      }
      if (specifier === 'node:os') {
        return { tmpdir: () => path.join(process.cwd(), 'tmp') };
      }
      if (specifier === 'node:path') return path;
      if (specifier === 'electron') return electron;
      if (specifier === './runtime-options.cjs') {
        return { resolveBuilderRendererTarget: () => ({ kind: 'packaged_file' }) };
      }
      if (specifier === './builder-provider-settings-ipc-runtime.cjs') {
        return {
          createBuilderProviderSettingsIpcRuntime() {
            calls.createSettingsRuntime += 1;
            return runtime(0);
          },
        };
      }
      if (specifier === './builder-permission-ipc-runtime.cjs') {
        return {
          createBuilderPermissionIpcRuntime(options) {
            calls.createPermissionRuntime += 1;
            assert.equal(options.ipcMain, electron.ipcMain);
            assert.equal(typeof options.mainWindowRef, 'function');
            const value = runtime(1);
            permissionGrantForExplicitApproval = value.grantForExplicitApproval;
            return value;
          },
        };
      }
      if (specifier === './builder-generation-ipc-runtime.cjs') {
        return {
          createBuilderGenerationIpcRuntime(options) {
            calls.createGenerationRuntime += 1;
            assert.equal(options.fetchImpl, electron.net.fetch);
            assert.equal(options.grantPermissionForExplicitApproval, permissionGrantForExplicitApproval);
            assert.equal(typeof options.showOpenDialog, 'function');
            generationRuntimeOptions.push(options);
            const value = runtime(2);
            providerContextDisclosureStatusService = Object.freeze({
              service_version: 'builder-provider-context-disclosure-status-service.v1',
            });
            value.readProviderContextDisclosureStatusServiceForMainOnlyApprovalRuntime =
              () => providerContextDisclosureStatusService;
            currentDraftCheckRunService = Object.freeze({
              service_version: 'builder-check-run-current-draft-service.v1',
            });
            value.readCheckRunCurrentDraftServiceForMainOnlyApprovalRuntime =
              () => currentDraftCheckRunService;
            return value;
          },
        };
      }
      if (specifier === './builder-provider-context-disclosure-approval-ipc-runtime.cjs') {
        return {
          createBuilderProviderContextDisclosureApprovalIpcRuntime(options) {
            calls.createApprovalRuntime += 1;
            assert.equal(options.ipcMain, electron.ipcMain);
            assert.equal(typeof options.mainWindowRef, 'function');
            assert.equal(options.grantPermissionForExplicitApproval, permissionGrantForExplicitApproval);
            assert.equal(options.providerContextDisclosureStatusService, providerContextDisclosureStatusService);
            return runtime(3);
          },
        };
      }
      if (specifier === './builder-check-run-approval-ipc-runtime.cjs') {
        return {
          createBuilderCheckRunApprovalIpcRuntime(options) {
            calls.createCheckRunApprovalRuntime += 1;
            assert.equal(options.ipcMain, electron.ipcMain);
            assert.equal(typeof options.mainWindowRef, 'function');
            assert.equal(options.currentDraftCheckRunService, currentDraftCheckRunService);
            const value = runtime(4);
            value.shutdown = async () => {
              calls.shutdown += 1;
              if (failCheckRunShutdown) throw new Error('private drain failure');
              return true;
            };
            return value;
          },
        };
      }
      if (specifier === './builder-live-preview-ipc-runtime.cjs') {
        const unavailableService = Object.freeze({
          service_version: 'builder-live-preview-unavailable-service.v1',
        });
        return {
          createUnavailableBuilderLivePreviewService() {
            return unavailableService;
          },
          createBuilderLivePreviewIpcRuntime(options) {
            calls.createLivePreviewRuntime += 1;
            assert.equal(options.ipcMain, electron.ipcMain);
            assert.equal(typeof options.mainWindowRef, 'function');
            assert.equal(options.livePreviewService, unavailableService);
            return runtime(5);
          },
        };
      }
      if (specifier === './builder-window-controls-ipc-runtime.cjs') {
        return {
          createBuilderWindowControlsIpcRuntime(options) {
            calls.createWindowControlsRuntime += 1;
            assert.equal(options.ipcMain, electron.ipcMain);
            assert.equal(typeof options.mainWindowRef, 'function');
            return runtime(6);
          },
        };
      }
      throw new Error(`unexpected require: ${specifier}`);
    },
  };
  try {
    vm.runInNewContext(mainSource, context, { filename: mainPath });
  } catch (error) {
    if (returnOnThrow) {
      return {
        applicationMenuCalls,
        browserWindowOptions,
        calls,
        dialogCalls,
        error,
        events,
        generationRuntimeOptions,
      };
    }
    throw error;
  }
  await new Promise((resolve) => setImmediate(resolve));
  return { applicationMenuCalls, browserWindowOptions, calls, dialogCalls, events, generationRuntimeOptions };
}

test('a second application instance exits before registering Builder authorities', async () => {
  const { calls, events } = await executeMain({
    singleInstanceLock: false,
    windowConstructionFails: false,
  });
  assert.deepEqual(calls, {
    createApprovalRuntime: 0,
    createCheckRunApprovalRuntime: 0,
    createGenerationRuntime: 0,
    createLivePreviewRuntime: 0,
    createPermissionRuntime: 0,
    createSettingsRuntime: 0,
    createWindowControlsRuntime: 0,
    dispose: 0,
    mkdir: 0,
    quit: 1,
    register: 0,
    setPath: [],
    shutdown: 0,
    whenReady: 0,
  });
  assert.deepEqual([...events.keys()], []);
});

test('window startup failure disposes registered handlers and quits', async () => {
  const { applicationMenuCalls, browserWindowOptions, calls, events } = await executeMain({
    singleInstanceLock: true,
    windowConstructionFails: true,
  });
  assert.deepEqual(calls, {
    createApprovalRuntime: 1,
    createCheckRunApprovalRuntime: 1,
    createGenerationRuntime: 1,
    createLivePreviewRuntime: 1,
    createPermissionRuntime: 1,
    createSettingsRuntime: 1,
    createWindowControlsRuntime: 1,
    dispose: 6,
    mkdir: 0,
    quit: 1,
    register: 7,
    setPath: [],
    shutdown: 1,
    whenReady: 1,
  });
  assert.equal(events.has('second-instance'), true);
  assert.equal(events.has('before-quit'), true);
  assert.equal(events.has('window-all-closed'), true);
  assert.deepEqual(applicationMenuCalls, [null]);
  assert.equal(browserWindowOptions.length, 1);
  assert.equal(browserWindowOptions[0].autoHideMenuBar, true);
  assert.equal(browserWindowOptions[0].frame, false);
  assert.equal(browserWindowOptions[0].icon, undefined);
  assert.equal(browserWindowOptions[0].titleBarStyle, undefined);
  assert.equal(browserWindowOptions[0].titleBarOverlay, undefined);
  assert.equal(browserWindowOptions[0].webPreferences.contextIsolation, true);
  assert.equal(browserWindowOptions[0].webPreferences.nodeIntegration, false);
  assert.equal(browserWindowOptions[0].webPreferences.sandbox, true);
});

test('does not close generation authority or quit when CheckRun drain is unconfirmed', async () => {
  const { calls } = await executeMain({
    failCheckRunShutdown: true,
    singleInstanceLock: true,
    windowConstructionFails: true,
  });
  assert.equal(calls.createGenerationRuntime, 1);
  assert.equal(calls.createCheckRunApprovalRuntime, 1);
  assert.equal(calls.register, 7);
  assert.equal(calls.shutdown, 1);
  assert.equal(calls.dispose, 2);
  assert.equal(calls.quit, 0);
});

test('window startup uses the Builder icon when the local icon exists', async () => {
  const { browserWindowOptions } = await executeMain({
    iconExists: true,
    singleInstanceLock: true,
    windowConstructionFails: true,
  });
  assert.equal(browserWindowOptions.length, 1);
  assert.equal(
    browserWindowOptions[0].icon,
    path.join(path.dirname(mainPath), '..', 'build', 'icon.ico'),
  );
});

test('project folder dialog uses native Electron selection outside packaged canary automation', async () => {
  const { dialogCalls, generationRuntimeOptions } = await executeMain({
    singleInstanceLock: true,
    windowConstructionFails: true,
  });

  assert.equal(generationRuntimeOptions.length, 1);
  assert.deepEqual(
    await generationRuntimeOptions[0].showOpenDialog('owner-window', { properties: ['openDirectory'] }),
    { canceled: true, filePaths: [] },
  );
  assert.deepEqual(dialogCalls, [['owner-window', { properties: ['openDirectory'] }]]);
});

test('runtime registration failure rolls back previously registered handlers and quits', async () => {
  const { calls } = await executeMain({
    singleInstanceLock: true,
    windowConstructionFails: false,
    failRegisterIndex: 2,
  });
  assert.deepEqual(calls, {
    createApprovalRuntime: 1,
    createCheckRunApprovalRuntime: 1,
    createGenerationRuntime: 1,
    createLivePreviewRuntime: 1,
    createPermissionRuntime: 1,
    createSettingsRuntime: 1,
    createWindowControlsRuntime: 1,
    dispose: 2,
    mkdir: 0,
    quit: 1,
    register: 3,
    setPath: [],
    shutdown: 0,
    whenReady: 1,
  });
});

test('packaged canary sentinel overrides userData and sessionData before ready', async () => {
  const userData = path.join(process.cwd(), 'tmp', 'clawfabric-builder-packaged-canary-main');
  const { calls } = await executeMain({
    env: {
      BUILDER_PACKAGED_CANARY: '1',
      BUILDER_PACKAGED_CANARY_USER_DATA_PATH: userData,
    },
    sessionDataExists: false,
    singleInstanceLock: true,
    windowConstructionFails: true,
  });
  assert.deepEqual(calls.setPath, [
    ['userData', userData],
    ['sessionData', path.join(userData, 'session-data')],
  ]);
  assert.equal(calls.mkdir, 1);
  assert.equal(calls.whenReady, 1);
});

test('packaged canary project root supplies a guarded main-only folder dialog result', async () => {
  const userData = path.join(process.cwd(), 'tmp', 'clawfabric-builder-packaged-canary-main');
  const projectRoot = path.join(userData, 'project-root');
  const { dialogCalls, generationRuntimeOptions } = await executeMain({
    env: {
      BUILDER_PACKAGED_CANARY: '1',
      BUILDER_PACKAGED_CANARY_PROJECT_ROOT_PATH: projectRoot,
      BUILDER_PACKAGED_CANARY_USER_DATA_PATH: userData,
    },
    sessionDataExists: false,
    singleInstanceLock: true,
    windowConstructionFails: true,
  });

  assert.equal(generationRuntimeOptions.length, 1);
  const result = await generationRuntimeOptions[0].showOpenDialog('owner-window', { properties: ['openDirectory'] });
  assert.equal(result.canceled, false);
  assert.deepEqual([...result.filePaths], [projectRoot]);
  assert.deepEqual(dialogCalls, []);
});

test('packaged canary folder dialog returns the verified project-root realpath', async () => {
  const tempRoot = path.join(process.cwd(), 'tmp');
  const tempRootReal = path.join(process.cwd(), 'tmp-real');
  const basename = 'clawfabric-builder-packaged-canary-main';
  const userData = path.join(tempRoot, basename);
  const userDataReal = path.join(tempRootReal, basename);
  const projectRoot = path.join(userData, 'project-root');
  const projectRootReal = path.join(userDataReal, 'project-root');
  const sessionData = path.join(userData, 'session-data');
  const sessionDataReal = path.join(userDataReal, 'session-data');
  const { generationRuntimeOptions } = await executeMain({
    env: {
      BUILDER_PACKAGED_CANARY: '1',
      BUILDER_PACKAGED_CANARY_PROJECT_ROOT_PATH: projectRoot,
      BUILDER_PACKAGED_CANARY_USER_DATA_PATH: userData,
    },
    realpathMap: {
      [tempRoot]: tempRootReal,
      [userData]: userDataReal,
      [sessionData]: sessionDataReal,
      [projectRoot]: projectRootReal,
    },
    sessionDataExists: false,
    singleInstanceLock: true,
    windowConstructionFails: true,
  });

  assert.equal(generationRuntimeOptions.length, 1);
  const result = await generationRuntimeOptions[0].showOpenDialog('owner-window', { properties: ['openDirectory'] });
  assert.deepEqual([...result.filePaths], [projectRootReal]);
});

test('packaged canary path guard rejects non-temp and unpackaged overrides', async () => {
  await assert.rejects(
    executeMain({
      env: {
        BUILDER_PACKAGED_CANARY: '1',
        BUILDER_PACKAGED_CANARY_USER_DATA_PATH: path.join(
          process.cwd(),
          'outside',
          'clawfabric-builder-packaged-canary-main',
        ),
      },
      singleInstanceLock: true,
      windowConstructionFails: true,
    }),
    /invalid packaged canary user data path/u,
  );

  const userData = path.join(process.cwd(), 'tmp', 'clawfabric-builder-packaged-canary-main');
  const { calls } = await executeMain({
    env: {
      BUILDER_PACKAGED_CANARY: '1',
      BUILDER_PACKAGED_CANARY_USER_DATA_PATH: userData,
    },
    isPackaged: false,
    singleInstanceLock: true,
    windowConstructionFails: true,
  });
  assert.deepEqual(calls.setPath, []);
});

test('packaged canary rejects nested paths, prefix drift, and root reparse before setPath', async () => {
  for (const requested of [
    path.join(process.cwd(), 'tmp', 'nested', 'clawfabric-builder-packaged-canary-main'),
    path.join(process.cwd(), 'tmp', 'clawfabric-builder-canary-main'),
  ]) {
    const { calls, error } = await executeMain({
      env: {
        BUILDER_PACKAGED_CANARY: '1',
        BUILDER_PACKAGED_CANARY_USER_DATA_PATH: requested,
      },
      returnOnThrow: true,
      singleInstanceLock: true,
      windowConstructionFails: true,
    });
    assert.match(error.message, /^invalid packaged canary user data path$/u);
    assert.deepEqual(calls.setPath, []);
  }

  const userData = path.join(process.cwd(), 'tmp', 'clawfabric-builder-packaged-canary-main');
  const rootJunction = await executeMain({
    env: {
      BUILDER_PACKAGED_CANARY: '1',
      BUILDER_PACKAGED_CANARY_USER_DATA_PATH: userData,
    },
    returnOnThrow: true,
    singleInstanceLock: true,
    symlinkPaths: [userData],
    windowConstructionFails: true,
  });
  assert.match(rootJunction.error.message, /^invalid packaged canary user data path$/u);
  assert.deepEqual(rootJunction.calls.setPath, []);
});

test('packaged canary rejects project roots outside the guarded userData child before setPath', async () => {
  const userData = path.join(process.cwd(), 'tmp', 'clawfabric-builder-packaged-canary-main');
  for (const projectRoot of [
    path.join(process.cwd(), 'tmp', 'project-root'),
    path.join(userData, 'nested', 'project-root'),
    path.join(userData, 'wrong-name'),
  ]) {
    const { calls, error } = await executeMain({
      env: {
        BUILDER_PACKAGED_CANARY: '1',
        BUILDER_PACKAGED_CANARY_PROJECT_ROOT_PATH: projectRoot,
        BUILDER_PACKAGED_CANARY_USER_DATA_PATH: userData,
      },
      returnOnThrow: true,
      singleInstanceLock: true,
      windowConstructionFails: true,
    });
    assert.match(error.message, /^invalid packaged canary project root path$/u);
    assert.deepEqual(calls.setPath, []);
  }
});

test('packaged canary rejects project root symlinks and realpath escapes before setPath', async () => {
  const userData = path.join(process.cwd(), 'tmp', 'clawfabric-builder-packaged-canary-main');
  const projectRoot = path.join(userData, 'project-root');
  const rootJunction = await executeMain({
    env: {
      BUILDER_PACKAGED_CANARY: '1',
      BUILDER_PACKAGED_CANARY_PROJECT_ROOT_PATH: projectRoot,
      BUILDER_PACKAGED_CANARY_USER_DATA_PATH: userData,
    },
    returnOnThrow: true,
    singleInstanceLock: true,
    symlinkPaths: [projectRoot],
    windowConstructionFails: true,
  });
  assert.match(rootJunction.error.message, /^invalid packaged canary project root path$/u);
  assert.deepEqual(rootJunction.calls.setPath, []);

  const escapedRoot = await executeMain({
    env: {
      BUILDER_PACKAGED_CANARY: '1',
      BUILDER_PACKAGED_CANARY_PROJECT_ROOT_PATH: projectRoot,
      BUILDER_PACKAGED_CANARY_USER_DATA_PATH: userData,
    },
    realpathMap: {
      [projectRoot]: path.join(process.cwd(), 'outside', 'project-root'),
    },
    returnOnThrow: true,
    singleInstanceLock: true,
    windowConstructionFails: true,
  });
  assert.match(escapedRoot.error.message, /^invalid packaged canary project root path$/u);
  assert.deepEqual(escapedRoot.calls.setPath, []);
});

test('packaged canary rejects realpath escapes and session-data replacement before setPath', async () => {
  const userData = path.join(process.cwd(), 'tmp', 'clawfabric-builder-packaged-canary-main');
  const escapedRoot = await executeMain({
    env: {
      BUILDER_PACKAGED_CANARY: '1',
      BUILDER_PACKAGED_CANARY_USER_DATA_PATH: userData,
    },
    realpathMap: {
      [userData]: path.join(process.cwd(), 'outside', 'clawfabric-builder-packaged-canary-main'),
    },
    returnOnThrow: true,
    singleInstanceLock: true,
    windowConstructionFails: true,
  });
  assert.match(escapedRoot.error.message, /^invalid packaged canary user data path$/u);
  assert.deepEqual(escapedRoot.calls.setPath, []);

  const sessionData = path.join(userData, 'session-data');
  const replacedSession = await executeMain({
    env: {
      BUILDER_PACKAGED_CANARY: '1',
      BUILDER_PACKAGED_CANARY_USER_DATA_PATH: userData,
    },
    realpathMap: {
      [sessionData]: path.join(process.cwd(), 'outside', 'session-data'),
    },
    returnOnThrow: true,
    sessionDataExists: true,
    singleInstanceLock: true,
    windowConstructionFails: true,
  });
  assert.match(replacedSession.error.message, /^invalid packaged canary user data path$/u);
  assert.deepEqual(replacedSession.calls.setPath, []);
});
