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

function request() {
  const body = {
    version: 'builder-generation-request.v2',
    instruction: 'Make a timer.',
    existing_project_id: null,
  };
  return { ...body, request_digest: digest(body) };
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
            assert.equal(options.projectReadAuthority, context.__readAuthority);
            return service;
          },
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
      if (specifier === './builder-git-project-repository.cjs') {
        return {
          createDefaultBuilderGitProjectRepository(options) {
            probes.gitOptions = options;
            context.__gitRepository = { read_verified_candidate() {} };
            return context.__gitRepository;
          },
        };
      }
      if (specifier === './builder-product-metadata-database.cjs') {
        return {
          createBuilderProductMetadataDatabase(databasePath) {
            probes.metadataPath = databasePath;
            context.__metadataDatabase = {
              closed: false,
              close() { this.closed = true; },
              load_current_project_revision() {},
              load_project_revision() {},
              list_current_project_revisions() {},
            };
            return context.__metadataDatabase;
          },
        };
      }
      if (specifier === './builder-project-read-authority.cjs') {
        return {
          createBuilderProjectReadAuthority(options) {
            probes.readAuthorityOptions = options;
            assert.equal(options.metadata_database, context.__metadataDatabase);
            assert.equal(options.git_repository, context.__gitRepository);
            context.__readAuthority = { load_current() {} };
            return context.__readAuthority;
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
  assert.deepEqual(runtime.channels, [GENERATE_CHANNEL, CANCEL_CHANNEL, AVAILABILITY_CHANNEL]);
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

test('closes product metadata when generation channel registration fails', (t) => {
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

  assert.equal(harness.context.__metadataDatabase.closed, false);
  assert.throws(() => runtime.register(), {
    code: 'builder_generation_ipc_runtime_unavailable',
  });
  assert.deepEqual([...ipcMain.handlers.keys()], []);
  assert.equal(harness.context.__metadataDatabase.closed, true);
  assert.equal(runtime.dispose(), false);
});

test('composes Git, SQLite metadata, read authority, and closes metadata on dispose', (t) => {
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

  assert.equal(probes.gitOptions.projects_root, path.join(userDataPath, 'builder-projects-v2'));
  assert.equal(probes.gitOptions.runtime_root, path.join(userDataPath, 'builder-git-runtime-v2'));
  assert.equal(probes.metadataPath, path.join(userDataPath, 'builder-product-metadata-v2', 'builder.sqlite'));
  assert.equal(probes.readAuthorityOptions.metadata_database, runtimeModule.context.__metadataDatabase);
  assert.equal(probes.serviceOptions.projectReadAuthority, runtimeModule.context.__readAuthority);
  assert.equal(runtime.dispose(), false);
  assert.equal(runtimeModule.context.__metadataDatabase.closed, true);
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
  const body = request();
  const operation = ipcMain.handlers.get(GENERATE_CHANNEL)({ sender: mainWindow.webContents }, body);
  const cancelled = assert.rejects(operation, { code: 'builder_generation_cancelled' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.dispose(), true);
  assert.equal(cancelRequests.length, 1);
  assert.equal(cancelRequests[0].request_id, body.request_digest);
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
  assert.match(source, /createDefaultBuilderGitProjectRepository/u);
  assert.match(source, /createBuilderProductMetadataDatabase/u);
  assert.match(source, /createBuilderProjectReadAuthority/u);
  assert.match(source, /createBuilderGenerationMainService/u);
  assert.match(source, /createBuilderOpenAICompatibleTransport\(\{ fetchImpl: options\.fetchImpl \}\)/u);
  assert.doesNotMatch(source, /globalThis\.fetch/u);
});
