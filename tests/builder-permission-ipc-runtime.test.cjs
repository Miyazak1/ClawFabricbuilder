'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_PERMISSION_POLICY_VERSION,
  createBuilderPermissionGrantRecord,
} = require('../electron/builder-permission-authority-contract.cjs');
const {
  EVALUATE_PERMISSION_CHANNEL,
} = require('../electron/builder-permission-ipc-adapter.cjs');
const {
  createBuilderPermissionFactStore,
} = require('../electron/builder-permission-fact-store.cjs');
const {
  BUILDER_PERMISSION_IPC_RUNTIME_VERSION,
  LOCAL_BUILDER_USER_ACTOR_ID,
  PERMISSION_DATABASE,
  PERMISSION_DIRECTORY,
  BuilderPermissionIpcRuntimeError,
  createBuilderPermissionIpcRuntime,
} = require('../electron/builder-permission-ipc-runtime.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const ISSUER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174003';

function temporaryUserData(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-permission-runtime-'));
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

function permissionDatabasePath(userDataPath) {
  return path.join(userDataPath, PERMISSION_DIRECTORY, PERMISSION_DATABASE);
}

function evaluateRequest(overrides = {}) {
  return {
    project_id: PROJECT_ID,
    action: 'project.edit',
    resource_kind: 'project',
    resource_id: 'project:self',
    ...overrides,
  };
}

function grant(overrides = {}) {
  return createBuilderPermissionGrantRecord({
    record_version: 'builder-permission-grant.v1',
    policy_version: BUILDER_PERMISSION_POLICY_VERSION,
    project_id: PROJECT_ID,
    actor_id: LOCAL_BUILDER_USER_ACTOR_ID,
    issuer_id: ISSUER_ID,
    scope_kind: 'project',
    action: 'project.edit',
    resource: {
      resource_kind: 'project',
      project_id: PROJECT_ID,
      resource_id: 'project:self',
    },
    issued_at_ms: 10,
    expires_at_ms: null,
    ...overrides,
  });
}

test('registers the evaluate-only permission channel and denies by default from main-owned facts', async (t) => {
  const userDataPath = temporaryUserData(t);
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const runtime = createBuilderPermissionIpcRuntime({
    ipcMain,
    mainWindowRef: () => mainWindow,
    nowMs: () => 30,
    userDataPath,
  });

  assert.equal(runtime.runtime_version, BUILDER_PERMISSION_IPC_RUNTIME_VERSION);
  assert.deepEqual(runtime.channels, [EVALUATE_PERMISSION_CHANNEL]);
  assert.equal(fs.existsSync(path.join(userDataPath, PERMISSION_DIRECTORY)), true);
  assert.equal(fs.existsSync(permissionDatabasePath(userDataPath)), true);
  assert.equal(fs.existsSync(path.join(userDataPath, 'builder-product-metadata-v4')), false);
  assert.equal(fs.existsSync(path.join(userDataPath, 'builder-provider-config-v1')), false);
  assert.equal(fs.existsSync(path.join(userDataPath, 'builder-provider-secrets-v1')), false);
  assert.equal(runtime.register(), true);
  assert.equal(runtime.register(), false);
  assert.deepEqual([...ipcMain.handlers.keys()], runtime.channels);

  const decision = await ipcMain.handlers.get(EVALUATE_PERMISSION_CHANNEL)(
    { sender: mainWindow.webContents },
    evaluateRequest(),
  );
  assert.equal(decision.decision, 'denied');
  assert.equal(decision.permission_id, null);
  assert.equal(decision.actor_id, LOCAL_BUILDER_USER_ACTOR_ID);
  assert.equal(decision.evaluated_at_ms, 30);
  assert.equal(Object.hasOwn(decision, 'grants'), false);
  assert.equal(Object.hasOwn(decision, 'revocations'), false);

  assert.equal(runtime.dispose(), true);
  assert.equal(runtime.dispose(), false);
  assert.deepEqual([...ipcMain.handlers.keys()], []);
  assert.throws(() => runtime.register(), {
    code: 'builder_permission_ipc_runtime_unavailable',
  });
});

test('evaluates persisted grants after restart without exposing grant facts', async (t) => {
  const userDataPath = temporaryUserData(t);
  fs.mkdirSync(path.join(userDataPath, PERMISSION_DIRECTORY), { recursive: true });
  const store = createBuilderPermissionFactStore(permissionDatabasePath(userDataPath));
  const permission = grant();
  store.record_grant({ grant: permission });
  store.close();

  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const runtime = createBuilderPermissionIpcRuntime({
    ipcMain,
    mainWindowRef: () => mainWindow,
    nowMs: () => 30,
    userDataPath,
  });
  runtime.register();

  const decision = await ipcMain.handlers.get(EVALUATE_PERMISSION_CHANNEL)(
    { sender: mainWindow.webContents },
    evaluateRequest(),
  );
  assert.equal(decision.decision, 'allowed');
  assert.equal(decision.permission_id, permission.permission_id);
  assert.equal(decision.permission_authority, 'builder_permission_facts_deny_by_default_v1');
  assert.equal(decision.ui_selection_authority, 'not_permission');
  assert.equal(Object.hasOwn(decision, 'grants'), false);
  assert.equal(Object.hasOwn(decision, 'revocations'), false);
  runtime.dispose();
});

test('keeps active renderer and payload validation inside the controlled permission adapter', async (t) => {
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const runtime = createBuilderPermissionIpcRuntime({
    ipcMain,
    mainWindowRef: () => mainWindow,
    nowMs: () => 30,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();

  await assert.rejects(
    ipcMain.handlers.get(EVALUATE_PERMISSION_CHANNEL)({ sender: {} }, evaluateRequest()),
    (error) => error.code === 'builder_permission_forbidden'
      && error.stack === `${error.name}: ${error.message}`,
  );
  await assert.rejects(
    ipcMain.handlers.get(EVALUATE_PERMISSION_CHANNEL)(
      { sender: mainWindow.webContents },
      { ...evaluateRequest(), project_id: 'bad' },
    ),
    (error) => error.code === 'builder_permission_request_invalid'
      && error.stack === `${error.name}: ${error.message}`,
  );
  await assert.rejects(
    ipcMain.handlers.get(EVALUATE_PERMISSION_CHANNEL)(
      { sender: mainWindow.webContents },
      evaluateRequest(),
      { extra: true },
    ),
    (error) => error.code === 'builder_permission_request_invalid',
  );
  runtime.dispose();
});

test('rolls back partial registration, closes storage, and rejects malformed runtime authority', (t) => {
  const userDataPath = temporaryUserData(t);
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain(EVALUATE_PERMISSION_CHANNEL);
  const runtime = createBuilderPermissionIpcRuntime({
    ipcMain,
    mainWindowRef: () => mainWindow,
    nowMs: () => 30,
    userDataPath,
  });
  assert.throws(() => runtime.register(), (error) => (
    error instanceof BuilderPermissionIpcRuntimeError
    && error.code === 'builder_permission_ipc_runtime_unavailable'
    && error.stack === `${error.name}: ${error.message}`
  ));
  assert.deepEqual([...ipcMain.handlers.keys()], []);
  assert.deepEqual(ipcMain.removed, []);
  assert.equal(runtime.dispose(), false);
  const reopened = createBuilderPermissionFactStore(permissionDatabasePath(userDataPath));
  reopened.close();

  const removalFailure = fakeIpcMain(null, EVALUATE_PERMISSION_CHANNEL);
  const cleanupRuntime = createBuilderPermissionIpcRuntime({
    ipcMain: removalFailure,
    mainWindowRef: () => mainWindow,
    nowMs: () => 30,
    userDataPath: temporaryUserData(t),
  });
  cleanupRuntime.register();
  assert.throws(() => cleanupRuntime.dispose(), {
    code: 'builder_permission_ipc_runtime_cleanup_required',
  });
  removalFailure.failRemoveOnChannel = null;
  assert.equal(cleanupRuntime.dispose(), true);

  for (const invalid of [
    null,
    {},
    { ipcMain: fakeIpcMain(), mainWindowRef: () => mainWindow, userDataPath: 'relative' },
    { ipcMain: fakeIpcMain(), mainWindowRef: () => mainWindow, userDataPath: temporaryUserData(t), extra: true },
    {
      ipcMain: fakeIpcMain(),
      mainWindowRef: new Proxy(() => mainWindow, { apply() { throw new Error('private window trap'); } }),
      userDataPath: temporaryUserData(t),
    },
    new Proxy({}, { getPrototypeOf() { throw new Error('private trap'); } }),
  ]) {
    assert.throws(
      () => createBuilderPermissionIpcRuntime(invalid),
      (error) => error instanceof BuilderPermissionIpcRuntimeError
        && error.code === 'builder_permission_ipc_runtime_unavailable'
        && !`${error.message}:${error.stack}`.includes('private'),
    );
  }
});

test('permission runtime source wires only permission facts and no provider, Git, preload, network, or grant UI authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-permission-ipc-runtime.cjs'),
    'utf8',
  );
  assert.match(source, /createBuilderPermissionIpcAdapter/u);
  assert.match(source, /createBuilderPermissionFactStore/u);
  assert.match(source, /LOCAL_BUILDER_USER_ACTOR_ID/u);
  assert.match(source, /PERMISSION_DIRECTORY = 'builder-permissions-v1'/u);
  assert.match(source, /PERMISSION_DATABASE = 'permissions\.sqlite'/u);
  assert.match(source, /EVALUATE_PERMISSION_CHANNEL/u);
  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|builder-project-main-authority|fetch\s*\(|https?:|Authorization|Bearer|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta|record_grant|record_revocation|grant_command|revoke_command/iu,
  );
});
