'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BuilderProjectRevisionRepositoryError,
} = require('../electron/builder-project-revision-repository.cjs');
const {
  BuilderProjectCatalogIpcError,
  createBuilderProjectCatalogIpcAdapter,
} = require('../electron/builder-project-catalog-ipc-adapter.cjs');

const SOURCE_PATH = path.join(
  __dirname,
  '..',
  'electron',
  'builder-project-catalog-ipc-adapter.cjs',
);
const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';

function activeWindow() {
  const webContents = { isDestroyed: () => false };
  return { webContents, isDestroyed: () => false };
}

function catalogEnvelope() {
  return Object.freeze({
    result_version: 'builder-project-catalog-result.v1',
    projects: Object.freeze([Object.freeze({
      project_id: PROJECT_ID,
      title: 'Focus board',
      summary: 'A small board for today.',
      revision: 1,
      revision_digest: `sha256:${'a'.repeat(64)}`,
    })]),
    catalog_evidence: Object.freeze({
      source_authority: 'verified_project_head_and_revision_chain',
      ordering: 'project_id_ascending',
      recency: 'not_available',
      global_atomic_snapshot: 'not_proven',
      headless_orphans: 'excluded',
      write_activity: 'none',
      resource_bounds: Object.freeze({
        max_project_directories: 256,
        max_file_reads: 1024,
        max_bytes: 32 * 1024 * 1024,
      }),
    }),
  });
}

function expectIpcError(promise, code, marker = 'private-marker') {
  return assert.rejects(promise, (error) => error instanceof BuilderProjectCatalogIpcError
    && error.code === code
    && !error.message.includes(marker)
    && error.stack === `${error.name}: ${error.message}`);
}

test('exposes one zero-payload read-only catalog channel', () => {
  const windowRef = activeWindow();
  const value = createBuilderProjectCatalogIpcAdapter({
    listCurrent: async () => catalogEnvelope(),
    mainWindowRef: () => windowRef,
  });

  assert.equal(value.adapter_id, 'builder_project_catalog.read_only_ipc_adapter.v1');
  assert.equal(value.namespace, 'builderProjectCatalog');
  assert.equal(value.preload_namespace, 'window.clawfabricBuilder.projectCatalog');
  assert.deepEqual(value.exposed_methods, ['listCurrent']);
  assert.deepEqual(Object.keys(value.channels), ['listCurrent']);
  assert.equal(
    value.channels.listCurrent.channel,
    'clawfabric-builder:project-catalog:list-current',
  );
  assert.equal(value.channels.listCurrent.method, 'listCurrent');
  assert.deepEqual(value.authority, {
    main_owned_repository: true,
    repository_method: 'list_current',
    read_only: true,
    active_renderer_required: true,
    payload: 'none',
    secondary_sanitizer: false,
    direct_electron_registration: false,
    direct_preload_exposure: false,
  });
});

test('returns the exact repository envelope after exactly one list call', async () => {
  const windowRef = activeWindow();
  const envelope = catalogEnvelope();
  let calls = 0;
  const value = createBuilderProjectCatalogIpcAdapter({
    listCurrent: async () => {
      calls += 1;
      return envelope;
    },
    mainWindowRef: () => windowRef,
  });

  const result = await value.channels.listCurrent.invoke({ sender: windowRef.webContents });
  assert.strictEqual(result, envelope);
  assert.equal(calls, 1);
});

test('rejects foreign, destroyed, and payload-bearing calls before repository authority', async () => {
  const windowRef = activeWindow();
  let calls = 0;
  const value = createBuilderProjectCatalogIpcAdapter({
    listCurrent: async () => {
      calls += 1;
      return catalogEnvelope();
    },
    mainWindowRef: () => windowRef,
  });

  await expectIpcError(
    value.channels.listCurrent.invoke({ sender: {} }),
    'builder_project_catalog_forbidden',
  );
  await expectIpcError(
    value.channels.listCurrent.invoke({ sender: windowRef.webContents }, { private: 'private-marker' }),
    'builder_project_catalog_invalid',
  );
  windowRef.isDestroyed = () => true;
  await expectIpcError(
    value.channels.listCurrent.invoke({ sender: windowRef.webContents }),
    'builder_project_catalog_forbidden',
  );
  assert.equal(calls, 0);
});

test('maps repository and unknown failures to fixed redacted catalog errors', async () => {
  const cases = [
    ['builder_project_repository_invalid', 'builder_project_catalog_invalid'],
    ['builder_project_repository_resource_exceeded', 'builder_project_catalog_resource_exceeded'],
    ['builder_project_repository_integrity_failed', 'builder_project_catalog_integrity_failed'],
    ['builder_project_repository_not_found', 'builder_project_catalog_unavailable'],
  ];
  for (const [repositoryCode, expectedCode] of cases) {
    const windowRef = activeWindow();
    const value = createBuilderProjectCatalogIpcAdapter({
      listCurrent: async () => { throw new BuilderProjectRevisionRepositoryError(repositoryCode); },
      mainWindowRef: () => windowRef,
    });
    await expectIpcError(
      value.channels.listCurrent.invoke({ sender: windowRef.webContents }),
      expectedCode,
    );
  }

  const windowRef = activeWindow();
  const unknown = createBuilderProjectCatalogIpcAdapter({
    listCurrent: async () => { throw new Error('private-marker'); },
    mainWindowRef: () => windowRef,
  });
  await expectIpcError(
    unknown.channels.listCurrent.invoke({ sender: windowRef.webContents }),
    'builder_project_catalog_unavailable',
  );
});

test('rejects forged dependency surfaces without invoking accessors', () => {
  let getterCalls = 0;
  const forged = {};
  Object.defineProperty(forged, 'listCurrent', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return async () => catalogEnvelope();
    },
  });
  Object.defineProperty(forged, 'mainWindowRef', {
    enumerable: true,
    value: () => activeWindow(),
  });
  assert.throws(
    () => createBuilderProjectCatalogIpcAdapter(forged),
    (error) => error instanceof BuilderProjectCatalogIpcError
      && error.code === 'builder_project_catalog_unavailable',
  );
  assert.equal(getterCalls, 0);
  assert.throws(
    () => createBuilderProjectCatalogIpcAdapter(new Proxy({
      listCurrent: async () => catalogEnvelope(),
      mainWindowRef: () => activeWindow(),
    }, {})),
    (error) => error instanceof BuilderProjectCatalogIpcError
      && error.code === 'builder_project_catalog_unavailable',
  );
});

test('keeps catalog IPC free of scanning, mutation, Electron registration, and legacy authority', () => {
  const source = fs.readFileSync(SOURCE_PATH, 'utf8');
  assert.doesNotMatch(source, /require\(['"]electron['"]\)|ipcMain|contextBridge|ipcRenderer|BrowserWindow/u);
  assert.doesNotMatch(source, /clawfabricDesktop|desktop:builder/iu);
  assert.doesNotMatch(
    source,
    /createBuilderProjectRevisionRepository|readdir|opendir|readFile|writeFile|mkdir|unlink|rename|mtime|index\.json|sanitizeBuilder|loadCurrent|commit|provider|chat_planner|Canvas|\bJob\b|fetch\(/iu,
  );
  assert.match(source, /return await options\.listCurrent\(\)/u);
  assert.match(source, /event\.sender !== webContents/u);
});
