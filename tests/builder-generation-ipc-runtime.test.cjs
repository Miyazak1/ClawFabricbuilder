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
  OPEN_PROJECT_CHANNEL,
  SAVE_DRAFT_CHANNEL,
  LOAD_CURRENT_CHANNEL,
  LIST_CURRENT_CHANNEL,
} = require('../electron/builder-project-workspace-ipc-adapter.cjs');
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

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';

function hostRequestDigest(instruction = 'Make a timer.', existingProjectId = null) {
  return digest({
    version: 'builder-generation-request.v2',
    instruction,
    existing_project_id: existingProjectId,
  });
}

function activeWindow() {
  const webContents = { isDestroyed: () => false };
  return { webContents, isDestroyed: () => false };
}

async function unreachableFetch() {
  throw new Error('unexpected network request');
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

async function waitForProbe(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail('expected runtime probe was not observed');
}

function runtimeWithService(service, probes = {}) {
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
              generate: { invoke: (_event, body) => options.generate(body) },
              cancel: { invoke: (_event, body) => options.cancel(body) },
              availability: { invoke: () => options.availability() },
            },
          }),
        };
      }
      if (specifier === './builder-generation-main-service.cjs') {
        return {
          createBuilderGenerationMainService: (options) => {
            probes.serviceOptions = options;
            assert.equal(options.transport, context.__sentinelTransport);
            assert.equal(options.projectReadAuthority, context.__projectMainAuthority.project_read_authority);
            return service;
          },
        };
      }
      if (specifier === './builder-project-save-authority.cjs') {
        return {
          createBuilderProjectSaveAuthority: (options) => {
            probes.saveOptions = options;
            return {
              save: async (body) => {
                if (typeof probes.saveDraft === 'function') return probes.saveDraft(body);
                return { result_version: 'builder-project-save-result.v1' };
              },
            };
          },
        };
      }
      if (specifier === './builder-project-workspace-ipc-adapter.cjs') {
        return {
          OPEN_PROJECT_CHANNEL,
          SAVE_DRAFT_CHANNEL,
          LOAD_CURRENT_CHANNEL,
          LIST_CURRENT_CHANNEL,
          createBuilderProjectWorkspaceIpcAdapter: (options) => ({
            channels: {
              open: { invoke: (_event, body) => options.openProject(body) },
              saveDraft: { invoke: (_event, body) => options.saveDraft(body) },
              loadCurrent: { invoke: (_event, body) => options.loadCurrent(body) },
              listCurrent: { invoke: () => options.listCurrent() },
            },
          }),
        };
      }
      if (specifier === './builder-openai-compatible-transport.cjs') {
        return {
          createBuilderOpenAICompatibleTransport: (options) => {
            assert.equal(options.fetchImpl, context.__fetchImpl);
            return context.__sentinelTransport;
          },
        };
      }
      if (specifier === './builder-provider-config-repository.cjs') {
        return { createBuilderProviderConfigRepository: () => ({ bind_current_authority() {} }) };
      }
      if (specifier === './builder-generation-kernel.cjs') {
        const actual = require('../electron/builder-generation-kernel.cjs');
        return {
          ...actual,
          createBuilderGenerationRequest(body) {
            return actual.createBuilderGenerationRequest({
              instruction: body.instruction,
              existing_project_id: body.existing_project_id,
            });
          },
        };
      }
      if (specifier === './builder-project-main-authority.cjs') {
        return {
          PROJECT_REPOSITORY_DIRECTORY: 'builder-projects-v2',
          GIT_RUNTIME_DIRECTORY: 'builder-git-runtime-v2',
          METADATA_DIRECTORY: 'builder-product-metadata-v2',
          METADATA_DATABASE: 'builder.sqlite',
          createBuilderProjectMainAuthority(options) {
            probes.projectMainAuthorityOptions = options;
            context.__projectMainAuthority = {
              closed: false,
              git_authority: { persist_candidate_commit() {}, verify_candidate_receipt() {} },
              metadata_authority: { load_project_identity() {}, record_project_revision_receipt() {} },
              project_read_authority: {
                load_current(body) {
                  probes.loadCurrentRequests ??= [];
                  probes.loadCurrentRequests.push({ project_id: body.project_id });
                  if (typeof probes.loadCurrent === 'function') return probes.loadCurrent(body);
                  context.__readProjectId = body.project_id;
                  return vm.runInContext(
                    '({ product_revision_receipt: { project_id: __readProjectId } })',
                    context,
                  );
                },
                load_revision() {},
                list_current() { return { projects: [] }; },
              },
              close() { this.closed = true; return true; },
            };
            return context.__projectMainAuthority;
          },
        };
      }
      if (specifier === './builder-project-revision-repository.cjs') {
        throw new Error('old revision repository must not be imported');
      }
      return require(path.join(path.dirname(runtimePath), specifier));
    },
  });
  vm.runInContext(source, context, { filename: runtimePath });
  return {
    context,
    createRuntime(options) {
      context.__ipcMain = options.ipcMain;
      context.__fetchImpl = options.fetchImpl;
      context.__sentinelTransport = async () => {
        throw new Error('unexpected transport request');
      };
      context.__mainWindow = options.mainWindow;
      context.__userDataPath = options.userDataPath;
      return vm.runInContext(`module.exports.createBuilderGenerationIpcRuntime({
        fetchImpl: __fetchImpl,
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
    fetchImpl: unreachableFetch,
    ipcMain,
    mainWindowRef: () => mainWindow,
    userDataPath,
  });

  assert.equal(runtime.runtime_version, 'builder-generation-ipc-runtime.v2');
  assert.deepEqual(runtime.channels, [
    GENERATE_CHANNEL,
    CANCEL_CHANNEL,
    AVAILABILITY_CHANNEL,
    OPEN_PROJECT_CHANNEL,
    SAVE_DRAFT_CHANNEL,
    LOAD_CURRENT_CHANNEL,
    LIST_CURRENT_CHANNEL,
  ]);
  assert.equal(fs.existsSync(path.join(userDataPath, 'builder-project-revisions-v1')), false);
  assert.equal(fs.existsSync(path.join(userDataPath, 'builder-projects-v2')), true);
  assert.equal(fs.existsSync(path.join(userDataPath, 'builder-product-metadata-v2', 'builder.sqlite')), true);
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
  runtime.dispose();
});

test('keeps active-renderer and request validation inside the controlled adapter', async (t) => {
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const runtime = createBuilderGenerationIpcRuntime({
    fetchImpl: unreachableFetch,
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
  runtime.dispose();
});

test('rolls back partial registration and rejects malformed runtime authority', (t) => {
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain(CANCEL_CHANNEL);
  const runtime = createBuilderGenerationIpcRuntime({
    fetchImpl: unreachableFetch,
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
  assert.equal(runtime.dispose(), false);

  const removalFailure = fakeIpcMain(CANCEL_CHANNEL, GENERATE_CHANNEL);
  const cleanupRuntime = createBuilderGenerationIpcRuntime({
    fetchImpl: unreachableFetch,
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

  for (const invalid of [
    null,
    {},
    {
      fetchImpl: new Proxy(unreachableFetch, { apply() { throw new Error('private fetch trap'); } }),
      ipcMain,
      mainWindowRef: () => mainWindow,
      userDataPath: temporaryUserData(t),
    },
    { fetchImpl: unreachableFetch, ipcMain, mainWindowRef: () => mainWindow, userDataPath: 'relative' },
    {
      fetchImpl: unreachableFetch,
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
});

test('closes project main authority when generation channel registration fails', (t) => {
  const harness = runtimeWithService({
    generate: async () => ({ ok: true }),
    cancel: () => ({ cancelled: false }),
    availability: () => ({ available: false }),
  });
  const ipcMain = fakeIpcMain(CANCEL_CHANNEL);
  const runtime = harness.createRuntime({
    fetchImpl: unreachableFetch,
    ipcMain,
    mainWindow: activeWindow(),
    userDataPath: temporaryUserData(t),
  });

  assert.equal(harness.context.__projectMainAuthority.closed, false);
  assert.throws(() => runtime.register(), {
    code: 'builder_generation_ipc_runtime_unavailable',
  });
  assert.deepEqual([...ipcMain.handlers.keys()], []);
  assert.equal(harness.context.__projectMainAuthority.closed, true);
  assert.equal(runtime.dispose(), false);
});

test('composes project main authority and closes it on dispose', (t) => {
  const probes = {};
  const service = {
    generate() { return Promise.reject(new Error('not used')); },
    cancel() { return { cancelled: false }; },
    availability() {
      return { version: 'builder-generation-availability.v1', available: true, reason: 'ready', supports_cancel: true };
    },
  };
  const runtimeModule = runtimeWithService(service, probes);
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const userDataPath = temporaryUserData(t);
  const runtime = runtimeModule.createRuntime({
    fetchImpl: unreachableFetch,
    ipcMain,
    mainWindow,
    userDataPath,
  });

  assert.equal(probes.projectMainAuthorityOptions.userDataPath, userDataPath);
  assert.deepEqual(Object.keys(probes.projectMainAuthorityOptions), ['userDataPath']);
  assert.equal(probes.serviceOptions.projectReadAuthority,
    runtimeModule.context.__projectMainAuthority.project_read_authority);
  assert.equal(probes.saveOptions.generationDrafts, service);
  assert.equal(probes.saveOptions.gitAuthority,
    runtimeModule.context.__projectMainAuthority.git_authority);
  assert.equal(probes.saveOptions.metadataAuthority,
    runtimeModule.context.__projectMainAuthority.metadata_authority);
  assert.equal(probes.saveOptions.projectReadAuthority,
    runtimeModule.context.__projectMainAuthority.project_read_authority);
  assert.equal(runtime.dispose(), false);
  assert.equal(runtimeModule.context.__projectMainAuthority.closed, true);
});

test('keeps selected project identity in main and accepts only instruction over generation IPC', async (t) => {
  const generated = [];
  const probes = {};
  const service = {
    generate(body) {
      generated.push(body);
      return Promise.resolve({ request_id: body.request_digest });
    },
    cancel() { return { cancelled: false }; },
    availability() {
      return { version: 'builder-generation-availability.v1', available: true, reason: 'ready', supports_cancel: true };
    },
  };
  const runtimeModule = runtimeWithService(service, probes);
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const runtime = runtimeModule.createRuntime({
    fetchImpl: unreachableFetch,
    ipcMain,
    mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();

  const selected = vm.runInContext(
    `({ project_id: ${JSON.stringify(PROJECT_ID)} })`,
    runtimeModule.context,
  );
  await ipcMain.handlers.get(OPEN_PROJECT_CHANNEL)({ sender: mainWindow.webContents }, selected);
  await ipcMain.handlers.get(GENERATE_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext('({ instruction: "Revise the timer." })', runtimeModule.context),
  );
  assert.equal(generated[0].existing_project_id, PROJECT_ID);
  assert.equal(generated[0].instruction, 'Revise the timer.');
  assert.equal(generated[0].request_digest, hostRequestDigest('Revise the timer.', PROJECT_ID));
  assert.deepEqual(probes.loadCurrentRequests, [{ project_id: PROJECT_ID }]);

  await ipcMain.handlers.get(OPEN_PROJECT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext('({ project_id: null })', runtimeModule.context),
  );
  await ipcMain.handlers.get(GENERATE_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext('({ instruction: "Make a fresh timer." })', runtimeModule.context),
  );
  assert.equal(generated[1].existing_project_id, null);
  assert.equal(generated[1].request_digest, hostRequestDigest('Make a fresh timer.', null));

  await assert.rejects(
    async () => ipcMain.handlers.get(GENERATE_CHANNEL)(
      { sender: mainWindow.webContents },
      vm.runInContext(`({
        instruction: "forged",
        existing_project_id: ${JSON.stringify(PROJECT_ID)}
      })`, runtimeModule.context),
    ),
    { code: 'builder_generation_request_invalid' },
  );
  runtime.dispose();
});

test('ignores stale Open and Save completions when a newer project selection wins', async (t) => {
  const projectB = 'builder-project:223e4567-e89b-42d3-a456-426614174000';
  const generated = [];
  const reads = new Map();
  let resolveSave;
  const probes = {
    loadCurrent(body) {
      return new Promise((resolve) => {
        reads.set(body.project_id, resolve);
      });
    },
    saveDraft() {
      return new Promise((resolve) => {
        resolveSave = resolve;
      });
    },
  };
  const runtimeModule = runtimeWithService({
    generate(body) {
      generated.push(body);
      return Promise.resolve({ request_id: body.request_digest });
    },
    cancel() { return { cancelled: false }; },
    availability() {
      return { version: 'builder-generation-availability.v1', available: true, reason: 'ready', supports_cancel: true };
    },
  }, probes);
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const runtime = runtimeModule.createRuntime({
    fetchImpl: unreachableFetch,
    ipcMain,
    mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();
  const invoke = (channel, body) => ipcMain.handlers.get(channel)({ sender: mainWindow.webContents }, body);
  const body = (source) => vm.runInContext(source, runtimeModule.context);

  const openA = invoke(OPEN_PROJECT_CHANNEL, body(`({ project_id: ${JSON.stringify(PROJECT_ID)} })`))
    .then((value) => ({ value }), (error) => ({ error }));
  const openB = invoke(OPEN_PROJECT_CHANNEL, body(`({ project_id: ${JSON.stringify(projectB)} })`))
    .then((value) => ({ value }), (error) => ({ error }));
  await waitForProbe(() => reads.has(PROJECT_ID) && reads.has(projectB));
  await assert.rejects(
    async () => invoke(
      GENERATE_CHANNEL,
      body('({ instruction: "Must not use the previous selection." })'),
    ),
    { code: 'builder_generation_ipc_runtime_unavailable' },
  );
  await assert.rejects(
    async () => invoke(
      SAVE_DRAFT_CHANNEL,
      body(`({ draft_id: "builder-generation-draft:${'f'.repeat(64)}" })`),
    ),
    { code: 'builder_generation_ipc_runtime_unavailable' },
  );
  assert.deepEqual(generated, []);
  assert.equal(resolveSave, undefined);
  runtimeModule.context.__projectB = projectB;
  reads.get(projectB)(vm.runInContext(
    '({ product_revision_receipt: { project_id: __projectB } })',
    runtimeModule.context,
  ));
  assert.equal((await openB).error, undefined);
  runtimeModule.context.__projectA = PROJECT_ID;
  reads.get(PROJECT_ID)(vm.runInContext(
    '({ product_revision_receipt: { project_id: __projectA } })',
    runtimeModule.context,
  ));
  assert.equal((await openA).error, undefined);
  await invoke(GENERATE_CHANNEL, body('({ instruction: "Continue B." })'));
  assert.equal(generated.at(-1).existing_project_id, projectB);

  const save = invoke(
    SAVE_DRAFT_CHANNEL,
    body(`({ draft_id: "builder-generation-draft:${'a'.repeat(64)}" })`),
  )
    .then((value) => ({ value }), (error) => ({ error }));
  await waitForProbe(() => typeof resolveSave === 'function');
  await invoke(OPEN_PROJECT_CHANNEL, body('({ project_id: null })'));
  resolveSave(vm.runInContext(`({
    result_version: "builder-project-save-result.v1",
    project_id: __projectB
  })`, runtimeModule.context));
  assert.equal((await save).error, undefined);
  await invoke(GENERATE_CHANNEL, body('({ instruction: "Make a fresh project." })'));
  assert.equal(generated.at(-1).existing_project_id, null);
  runtime.dispose();
});

test('cancels every accepted generation before removing its cancel channel', async (t) => {
  let rejectGeneration;
  const cancelRequests = [];
  const service = {
    generate() {
      return new Promise((_resolve, reject) => { rejectGeneration = reject; });
    },
    cancel(body) {
      cancelRequests.push(body);
      const error = new Error('private provider request');
      error.code = 'builder_generation_cancelled';
      rejectGeneration(error);
      return { request_id: body.request_id, cancelled: true };
    },
    availability() {
      return { version: 'builder-generation-availability.v1', available: true, reason: 'ready', supports_cancel: true };
    },
  };
  const runtimeModule = runtimeWithService(service);
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const runtime = runtimeModule.createRuntime({
    fetchImpl: unreachableFetch,
    ipcMain,
    mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();
  const body = vm.runInContext('({ instruction: "Make a timer." })', runtimeModule.context);
  const operation = ipcMain.handlers.get(GENERATE_CHANNEL)({ sender: mainWindow.webContents }, body);
  const cancelled = assert.rejects(operation, { code: 'builder_generation_cancelled' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.dispose(), true);
  assert.equal(cancelRequests.length, 1);
  assert.equal(cancelRequests[0].request_id, hostRequestDigest());
  await cancelled;
  assert.deepEqual([...ipcMain.handlers.keys()], []);
});

test('contains no preload, renderer, settings write, generic provider, or legacy revision authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-generation-ipc-runtime.cjs'),
    'utf8',
  );
  for (const forbidden of [
    /ipcRenderer|contextBridge|BrowserWindow|require\(['"]electron['"]\)|\bnet\b/u,
    /write_current|credential|safeStorage|providerSettings/u,
    /builder-project-revision-repository|builder-project-revisions-v1|projectRevisionRepository|load_revision/u,
    /local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/u,
  ]) assert.doesNotMatch(source, forbidden);
  assert.match(source, /createBuilderProjectMainAuthority/u);
  assert.doesNotMatch(source, /createDefaultBuilderGitProjectRepository/u);
  assert.doesNotMatch(source, /createBuilderProductMetadataDatabase/u);
  assert.doesNotMatch(source, /createBuilderProjectReadAuthority/u);
  assert.match(source, /createBuilderGenerationMainService/u);
  assert.match(source, /createBuilderOpenAICompatibleTransport\(\{ fetchImpl: options\.fetchImpl \}\)/u);
  assert.doesNotMatch(source, /globalThis\.fetch/u);
});
