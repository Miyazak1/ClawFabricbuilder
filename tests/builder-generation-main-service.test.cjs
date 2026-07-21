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
  createBuilderProjectRevisionRepository,
} = require('../electron/builder-project-revision-repository.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
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

function request() {
  const unsigned = {
    version: 'builder-generation-request.v1',
    idea: 'Make a focus timer.',
    project_id: PROJECT_ID,
    target_revision: 1,
    parent_revision: null,
  };
  return { ...unsigned, request_digest: digest(unsigned) };
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

function proposal() {
  return {
    kind: 'builder_code_project',
    title: 'Focus timer',
    summary: 'A quiet timer for focused work.',
    files: {
      'index.html': '<main><h1>Focus</h1></main>',
      'styles.css': 'main { max-width: 30rem; }',
      'app.js': 'document.querySelector("h1")?.focus();',
    },
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
  const projectRevisionRepository = {
    load_revision() { throw new Error('revision one must not load a parent'); },
  };
  return { providerConfigRepository, projectRevisionRepository, ...overrides };
}

test('binds one provider config and secret snapshot per availability or generation operation', async () => {
  const transportInputs = [];
  const service = createBuilderGenerationMainService({
    ...repositories(),
    transport: async (input) => {
      transportInputs.push(input);
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: JSON.stringify(proposal()),
      };
    },
  });

  assert.equal(service.service_version, 'builder-generation-main-service.v1');
  assert.deepEqual(service.availability(), {
    version: 'builder-generation-availability.v1',
    available: true,
    reason: 'ready',
    supports_cancel: true,
  });
  const result = await service.generate(request());
  assert.equal(result.proposal.title, 'Focus timer');
  assert.equal(transportInputs.length, 1);
  assert.equal(transportInputs[0].model, 'builder-model-2');
  assert.equal(transportInputs[0].credential, 'credential-2');
  assert.doesNotMatch(JSON.stringify(result), /credential|provider\.example|builder-model/iu);
  assert.deepEqual(service.authority, {
    provider_config_snapshot_bound: true,
    parent_revision_main_repository: true,
    credential_exposed_to_renderer: false,
    electron_registration: false,
    preload_exposure: false,
  });
});

test('generates through the persisted provider authority without exposing its credential', async (t) => {
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
  const projectRevisionRepository = createBuilderProjectRevisionRepository(root);
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
    providerConfigRepository,
    projectRevisionRepository,
    transport: async (input) => {
      transportInputs.push(input);
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: JSON.stringify(proposal()),
      };
    },
  });

  const result = await service.generate(request());
  assert.equal(transportInputs.length, 1);
  assert.equal(transportInputs[0].model, 'persisted-builder-model');
  assert.equal(transportInputs[0].credential, PRIVATE_MARKER);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(`${PRIVATE_MARKER}|provider\\.example|persisted-builder-model`, 'iu'));
});

test('forwards only the exact parent lookup to the main-owned revision repository', async () => {
  const queries = [];
  const raw = request();
  raw.target_revision = 2;
  raw.parent_revision = { revision: 1, revision_digest: `sha256:${'0'.repeat(64)}` };
  const unsigned = { ...raw };
  delete unsigned.request_digest;
  raw.request_digest = digest(unsigned);
  const service = createBuilderGenerationMainService({
    ...repositories({
      projectRevisionRepository: {
        load_revision(query) {
          queries.push(query);
          return Promise.reject(new Error(PRIVATE_MARKER));
        },
      },
    }),
    transport: async () => { throw new Error('transport must not run'); },
  });
  await assert.rejects(service.generate(raw), (error) => {
    assert.equal(error.code, 'builder_generation_parent_unavailable');
    assert.doesNotMatch(`${error.message}:${error.stack}`, new RegExp(PRIVATE_MARKER, 'u'));
    return true;
  });
  assert.deepEqual(queries, [{
    project_id: PROJECT_ID,
    revision: 1,
    revision_digest: `sha256:${'0'.repeat(64)}`,
  }]);
});

test('fails closed for malformed repositories, authority pairs, and accessor options', async () => {
  const cases = [
    null,
    {},
    { providerConfigRepository: {}, projectRevisionRepository: {} },
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
    providerConfigRepository: { bind_current_authority: () => ({}) },
    projectRevisionRepository: { load_revision() {} },
    transport: async () => ({ transport_version: 'builder-openai-compatible-transport.v1', generated_text: '{}' }),
  });
  assert.equal(invalidAuthority.availability().available, false);

  const malformedMethod = createBuilderGenerationMainService({
    providerConfigRepository: {
      bind_current_authority: () => ({ readProviderConfig() {}, resolveSecret: 1 }),
    },
    projectRevisionRepository: { load_revision() {} },
    transport: async () => ({ transport_version: 'builder-openai-compatible-transport.v1', generated_text: '{}' }),
  });
  assert.equal(malformedMethod.availability().available, false);

  let binds = 0;
  let secretResolutions = 0;
  const recoversAfterInvalidConfig = createBuilderGenerationMainService({
    providerConfigRepository: {
      bind_current_authority() {
        binds += 1;
        const boundConfig = binds === 1 ? { invalid: true } : config();
        return {
          readProviderConfig() { return boundConfig; },
          resolveSecret(secretRef) {
            secretResolutions += 1;
            return {
              resolution_version: 'builder-provider-secret-resolution.v1',
              secret_ref: secretRef,
              credential: 'recovered-credential',
            };
          },
        };
      },
    },
    projectRevisionRepository: { load_revision() {} },
    transport: async () => ({ transport_version: 'builder-openai-compatible-transport.v1', generated_text: '{}' }),
  });
  assert.equal(recoversAfterInvalidConfig.availability().available, false);
  assert.equal(secretResolutions, 0);
  assert.equal(recoversAfterInvalidConfig.availability().available, true);
  assert.equal(secretResolutions, 1);
});

test('does not register Electron or expose provider settings and credential authority', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'builder-generation-main-service.cjs'), 'utf8');
  for (const forbidden of [
    /require\(['"]electron['"]\)/u,
    /ipcMain|ipcRenderer|contextBridge|BrowserWindow/u,
    /safeStorage|write_current|publish\(/u,
    /local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/u,
  ]) assert.doesNotMatch(source, forbidden);
});
