'use strict';

const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderGenerationMainService,
} = require('../electron/builder-generation-main-service.cjs');
const {
  createBuilderProviderConfig,
} = require('../electron/builder-provider-config.cjs');
const {
  createBuilderProviderConfigRepository,
} = require('../electron/builder-provider-config-repository.cjs');
const {
  createBuilderProviderSecretStore,
} = require('../electron/builder-provider-secret-store.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');

const UUIDS = Object.freeze([
  '123e4567-e89b-42d3-a456-426614174000',
  '123e4567-e89b-42d3-a456-426614174001',
  '123e4567-e89b-42d3-a456-426614174002',
  '123e4567-e89b-42d3-a456-426614174003',
  '123e4567-e89b-42d3-a456-426614174004',
  '123e4567-e89b-42d3-a456-426614174005',
  '123e4567-e89b-42d3-a456-426614174006',
  '123e4567-e89b-42d3-a456-426614174007',
  '123e4567-e89b-42d3-a456-426614174008',
  '123e4567-e89b-42d3-a456-426614174009',
]);
const PROJECT_ID = `builder-project:${UUIDS[0]}`;
const PRIVATE_MARKER = 'private-main-service-marker';

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function digest(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function request({ instruction = 'Make a focus timer.', existingProjectId = null } = {}) {
  const unsigned = {
    version: 'builder-generation-request.v2',
    instruction,
    existing_project_id: existingProjectId,
  };
  return { ...unsigned, request_digest: digest(unsigned) };
}

function createUuidFactory(seed = 0) {
  let index = seed;
  return () => {
    const value = UUIDS[index % UUIDS.length];
    index += 1;
    return value;
  };
}

function config(model = 'builder-model') {
  return createBuilderProviderConfig({
    base_url: 'https://provider.example/v1',
    model,
    timeout_ms: 30000,
    temperature: 0,
    max_tokens: 8192,
    secret_ref: {
      ref_version: 'builder-provider-secret-ref.v1',
      provider_id: 'builder-default',
      secret_id: 'builder-provider-secret:default',
    },
  });
}

function providerOutput(overrides = {}) {
  return {
    kind: 'builder_code_change_operations',
    title: 'Focus timer',
    summary: 'A quiet timer for focused work.',
    operations: [
      { operation: 'upsert', path: 'index.html', content: '<main><h1>Focus</h1></main>\n' },
      { operation: 'upsert', path: 'src/app.js', content: 'console.log("ready");\n' },
    ],
    ...overrides,
  };
}

function readResult(sourceTree = createBuilderProjectSourceTree({
  files: [{ path: 'src/app.js', content: 'export const before = true;\n' }],
})) {
  return {
    result_version: 'builder-project-read-result.v1',
    operation: 'current_loaded',
    product_revision_receipt: {
      project_id: PROJECT_ID,
      revision_receipt_digest: `sha256:${'1'.repeat(64)}`,
      commit_oid: '2'.repeat(40),
      resulting_tree_digest: sourceTree.source_tree_digest,
    },
    current: {},
    source_tree: sourceTree,
    git_candidate_receipt: {},
    git_verification_receipt: {},
    authority_evidence: {},
  };
}

function repositories(overrides = {}) {
  let generation = 0;
  const providerConfigRepository = {
    bind_current_authority() {
      generation += 1;
      const boundConfig = config(`builder-model-${generation}`);
      const boundCredential = `credential-${generation}`;
      const state = new WeakMap();
      const authority = {
        readProviderConfig() { return state.get(this).config; },
        resolveSecret(secretRef) {
          return {
            resolution_version: 'builder-provider-secret-resolution.v1',
            secret_ref: secretRef,
            credential: state.get(this).credential,
          };
        },
      };
      state.set(authority, { config: boundConfig, credential: boundCredential });
      return authority;
    },
  };
  const projectReadAuthority = {
    load_current() { throw new Error('new project must not read current source'); },
  };
  return {
    providerConfigRepository,
    projectReadAuthority,
    createUuid: createUuidFactory(),
    ...overrides,
  };
}

test('binds provider snapshot and returns only a redacted unsaved draft packet', async () => {
  const transportInputs = [];
  const service = createBuilderGenerationMainService({
    ...repositories(),
    transport: async (input) => {
      transportInputs.push(input);
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: JSON.stringify(providerOutput()),
      };
    },
  });

  assert.equal(service.service_version, 'builder-generation-main-service.v2');
  assert.deepEqual(service.availability(), {
    version: 'builder-generation-availability.v1',
    available: true,
    reason: 'ready',
    supports_cancel: true,
  });
  const result = await service.generate(request());
  assert.equal(result.version, 'builder-generation-result.v2');
  assert.match(result.draft_id, /^builder-generation-draft:[0-9a-f]{64}$/u);
  assert.equal(result.project_id, PROJECT_ID);
  assert.equal(result.existing_project_id, null);
  assert.equal(result.candidate.candidate_version, 'builder-code-change-candidate.v2');
  assert.equal(result.admissions.draft, 'candidate_not_saved');
  assert.equal(result.admissions.save, 'not_performed');
  assert.equal(result.admissions.conversation, 'candidate_local_not_recorded');
  assert.equal(result.restart_restore, 'not_persisted');
  assert.equal(transportInputs.length, 1);
  assert.equal(transportInputs[0].model, 'builder-model-2');
  assert.equal(transportInputs[0].credential, 'credential-2');
  assert.doesNotMatch(JSON.stringify(result), /credential|provider\.example|builder-model|operations|conversation_events|git_request_id/iu);
  assert.deepEqual(service.authority, {
    provider_config_snapshot_bound: true,
    project_read_authority_verified_source: true,
    pending_draft_restart_restore: 'not_persisted',
    conversation_event_admission: 'candidate_local_not_recorded',
    credential_exposed_to_renderer: false,
    electron_registration: false,
    preload_exposure: false,
  });
});

test('uses read authority for existing projects and stores a main-only pending draft', async () => {
  const sourceTree = createBuilderProjectSourceTree({
    files: [{ path: 'src/app.js', content: 'export const before = true;\n' }],
  });
  const reads = [];
  const service = createBuilderGenerationMainService({
    ...repositories({
      createUuid: createUuidFactory(1),
      projectReadAuthority: {
        load_current(query) {
          reads.push(query);
          return readResult(sourceTree);
        },
      },
    }),
    transport: async () => ({
      transport_version: 'builder-openai-compatible-transport.v1',
      generated_text: JSON.stringify(providerOutput({
        operations: [{ operation: 'upsert', path: 'src/app.js', content: 'export const before = false;\n' }],
      })),
    }),
  });

  const result = await service.generate(request({ existingProjectId: PROJECT_ID }));
  assert.deepEqual(reads, [{ project_id: PROJECT_ID }]);
  assert.equal(result.project_id, PROJECT_ID);
  assert.equal(result.base_revision_evidence.revision_receipt_digest, `sha256:${'1'.repeat(64)}`);
  assert.equal(result.source_tree.source_tree_digest, result.candidate.resulting_tree_digest);
  assert.equal(Object.hasOwn(result.candidate, 'operations'), false);

  const pending = service.read_pending_draft({ draft_id: result.draft_id });
  assert.equal(pending.result_version, 'builder-generation-pending-draft.v1');
  assert.equal(pending.draft_id, result.draft_id);
  assert.match(pending.git_request_id, /^builder-git-request:/u);
  assert.equal(pending.candidate.candidate_digest, result.candidate.candidate_digest);
  assert.equal(pending.conversation_events.length, 2);
  assert.equal(pending.conversation_event_admission, 'candidate_local_not_recorded');
  assert.equal(pending.restart_restore, 'not_persisted');

  assert.throws(
    () => service.release_pending_draft({
      draft_id: result.draft_id,
      candidate_digest: `sha256:${'f'.repeat(64)}`,
    }),
    (error) => error.code === 'builder_generation_draft_conflict'
      && !`${error.message}:${error.stack}`.includes(result.draft_id),
  );
  assert.equal(service.read_pending_draft({ draft_id: result.draft_id }).draft_id, result.draft_id);
  assert.deepEqual(service.release_pending_draft({
    draft_id: result.draft_id,
    candidate_digest: result.candidate.candidate_digest,
  }), {
    result_version: 'builder-generation-pending-draft.v1',
    draft_id: result.draft_id,
    released: true,
    pending_draft_restart_restore: 'not_persisted',
  });
  assert.throws(
    () => service.read_pending_draft({ draft_id: result.draft_id }),
    (error) => error.code === 'builder_generation_service_unavailable',
  );
});

test('generates through persisted provider authority without exposing its credential', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-main-service-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const safeStorage = {
    isEncryptionAvailable() { return true; },
    encryptString(value) { return Buffer.from(`encrypted:${value}`, 'utf8'); },
    decryptString(value) {
      const text = value.toString('utf8');
      if (!text.startsWith('encrypted:')) throw new Error(PRIVATE_MARKER);
      return text.slice('encrypted:'.length);
    },
  };
  const secretStore = createBuilderProviderSecretStore(root, { safeStorage });
  const providerConfigRepository = createBuilderProviderConfigRepository(root, { secretStore });
  providerConfigRepository.write_current({
    config: {
      base_url: 'https://provider.example/v1',
      model: 'persisted-builder-model',
      timeout_ms: 30000,
      temperature: 0,
      max_tokens: 8192,
      secret_ref: {
        ref_version: 'builder-provider-secret-ref.v1',
        provider_id: 'builder-default',
        secret_id: 'builder-provider-secret:default',
      },
    },
    credential: PRIVATE_MARKER,
  });
  const transportInputs = [];
  const service = createBuilderGenerationMainService({
    ...repositories({ providerConfigRepository }),
    transport: async (input) => {
      transportInputs.push(input);
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: JSON.stringify(providerOutput()),
      };
    },
  });

  const result = await service.generate(request());
  assert.equal(transportInputs.length, 1);
  assert.equal(transportInputs[0].model, 'persisted-builder-model');
  assert.equal(transportInputs[0].credential, PRIVATE_MARKER);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(`${PRIVATE_MARKER}|provider\\.example|persisted-builder-model`, 'iu'));
});

test('fails closed for malformed repositories, read authority, authority pairs, and accessor options', async () => {
  const cases = [
    null,
    {},
    { providerConfigRepository: {}, projectReadAuthority: {} },
    new Proxy({}, { getPrototypeOf() { throw new Error(PRIVATE_MARKER); } }),
  ];
  for (const value of cases) {
    assert.throws(() => createBuilderGenerationMainService(value), (error) => {
      assert.equal(error.code, 'builder_generation_service_unavailable');
      assert.doesNotMatch(`${error.message}:${error.stack}`, new RegExp(PRIVATE_MARKER, 'u'));
      return true;
    });
  }

  const options = repositories();
  Object.defineProperty(options, 'transport', {
    enumerable: true,
    get() { throw new Error(PRIVATE_MARKER); },
  });
  assert.throws(() => createBuilderGenerationMainService(options), {
    code: 'builder_generation_service_unavailable',
  });

  const invalidAuthority = createBuilderGenerationMainService({
    ...repositories({
      providerConfigRepository: { bind_current_authority: () => ({}) },
    }),
    transport: async () => ({ transport_version: 'builder-openai-compatible-transport.v1', generated_text: '{}' }),
  });
  assert.equal(invalidAuthority.availability().available, false);

  const malformedRead = createBuilderGenerationMainService({
    ...repositories({
      projectReadAuthority: {
        load_current() { return {}; },
      },
    }),
    transport: async () => ({ transport_version: 'builder-openai-compatible-transport.v1', generated_text: JSON.stringify(providerOutput()) }),
  });
  await assert.rejects(
    malformedRead.generate(request({ existingProjectId: PROJECT_ID })),
    { code: 'builder_generation_base_unavailable' },
  );
});

test('does not register Electron, save, old revision, or expose provider credential authority', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'builder-generation-main-service.cjs'), 'utf8');
  for (const forbidden of [
    /require\(['"]electron['"]\)/u,
    /ipcMain|ipcRenderer|contextBridge|BrowserWindow/u,
    /safeStorage|write_current|publish\(/u,
    /builder-project-revision|projectRevisionRepository|load_revision|revision_digest/u,
    /local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/u,
  ]) assert.doesNotMatch(source, forbidden);
});
