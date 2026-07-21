'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  CONFIG_DIRECTORY_NAME,
  CURRENT_FILE_NAME,
  BuilderProviderConfigRepositoryError,
  createBuilderProviderConfigRepository,
} = require('../electron/builder-provider-config-repository.cjs');
const {
  SECRET_DIRECTORY_NAME,
  createBuilderProviderSecretStore,
} = require('../electron/builder-provider-secret-store.cjs');

const PRIVATE_MARKER = 'private-settings-marker';

function temporaryRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-provider-config-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function secretRef() {
  return {
    ref_version: 'builder-provider-secret-ref.v1',
    provider_id: 'builder-default',
    secret_id: 'builder-provider-secret:default',
  };
}

function config(overrides = {}) {
  return {
    base_url: 'https://provider.example/v1',
    model: 'builder-model',
    timeout_ms: 30000,
    temperature: 0.2,
    max_tokens: 8192,
    secret_ref: secretRef(),
    ...overrides,
  };
}

function fakeSafeStorage(options = {}) {
  return {
    isEncryptionAvailable() { return true; },
    encryptString(value) { return Buffer.from(`encrypted:${value}`, 'utf8'); },
    decryptString(value) {
      if (options.decryptThrows) throw new Error(PRIVATE_MARKER);
      const text = Buffer.from(value).toString('utf8');
      if (!text.startsWith('encrypted:')) throw new Error(PRIVATE_MARKER);
      return text.slice('encrypted:'.length);
    },
  };
}

function repositoryWithFakeSecretStore(root) {
  return createBuilderProviderConfigRepository(root, {
    secretStore: createBuilderProviderSecretStore(root, { safeStorage: fakeSafeStorage() }),
  });
}

function assertRepositoryError(code) {
  return (error) => error instanceof BuilderProviderConfigRepositoryError
    && error.code === code
    && !`${error.name}:${error.message}:${error.stack}`.includes(PRIVATE_MARKER)
    && !`${error.name}:${error.message}:${error.stack}`.includes('real-key-value')
    && !`${error.name}:${error.message}:${error.stack}`.includes('provider.example')
    && !`${error.name}:${error.message}:${error.stack}`.includes(os.tmpdir());
}

test('writes secret blob before atomically publishing the current config envelope', (t) => {
  const root = temporaryRoot(t);
  const repository = repositoryWithFakeSecretStore(root);

  const result = repository.write_current({ config: config(), credential: 'real-key-value' });

  assert.equal(result.result_version, 'builder-provider-config-repository.v1');
  assert.equal(result.config.config_version, 'builder-provider-config.v1');
  assert.deepEqual(result.config.secret_ref, secretRef());
  assert.equal(result.secret_binding.encrypted_secret_digest.startsWith('sha256:'), true);
  assert.equal(result.restart_restore, false);
  assert.deepEqual(result.persistence_evidence, {
    evidence_version: 'builder-provider-config-repository.v1',
    operation: 'current_written',
    authority_scope: 'single_main_process_serialized_provider_settings',
    cross_process_cas: 'not_proven',
    sudden_power_loss_durability: 'not_proven',
    secret_file_fsync: 'proven',
    secret_publish: 'same_directory_replace_reopened',
    secret_parent_directory_fsync: result.persistence_evidence.secret_parent_directory_fsync,
    config_file_fsync: 'proven',
    config_publish: 'same_directory_replace_reopened',
    config_parent_directory_fsync: result.persistence_evidence.config_parent_directory_fsync,
    reopened_hash_verified: true,
    decryption_verified: true,
    orphan_secret_cleanup: 'not_performed',
  });
  assert.match(result.persistence_evidence.secret_parent_directory_fsync, /^(?:proven|not_proven)$/u);
  assert.match(result.persistence_evidence.config_parent_directory_fsync, /^(?:proven|not_proven)$/u);

  const currentPath = path.join(root, CONFIG_DIRECTORY_NAME, CURRENT_FILE_NAME);
  const currentText = fs.readFileSync(currentPath, 'utf8');
  assert.doesNotMatch(currentText, /real-key-value|Authorization|Bearer/iu);
  assert.match(currentText, new RegExp(result.secret_binding.encrypted_secret_digest, 'u'));
  assert.equal(fs.readdirSync(path.join(root, SECRET_DIRECTORY_NAME)).length, 1);
});

test('restores current config after restart and exposes a bound exact4 authority facade', (t) => {
  const root = temporaryRoot(t);
  const first = repositoryWithFakeSecretStore(root);
  const written = first.write_current({ config: config(), credential: 'real-key-value' });

  const restarted = repositoryWithFakeSecretStore(root);
  const loaded = restarted.read_current();
  assert.deepEqual(loaded.config, written.config);
  assert.deepEqual(loaded.secret_binding, written.secret_binding);
  assert.equal(loaded.restart_restore, true);
  assert.equal(loaded.persistence_evidence.operation, 'current_loaded');
  assert.equal(loaded.persistence_evidence.config_publish, 'not_performed');
  assert.equal(loaded.persistence_evidence.decryption_verified, true);

  const authority = restarted.bind_current_authority();
  assert.deepEqual(authority.readProviderConfig(), written.config);
  assert.deepEqual(authority.resolveSecret(secretRef()), {
    resolution_version: 'builder-provider-secret-resolution.v1',
    secret_ref: secretRef(),
    credential: 'real-key-value',
  });
  assert.throws(
    () => authority.resolveSecret({ ...secretRef(), secret_id: 'builder-provider-secret:other' }),
    assertRepositoryError('builder_provider_config_repository_integrity_failed'),
  );
});

test('reports only read_current missing current as not found while bound authority stays unavailable', (t) => {
  const root = temporaryRoot(t);
  const repository = repositoryWithFakeSecretStore(root);

  assert.throws(
    () => repository.read_current(),
    assertRepositoryError('builder_provider_config_repository_not_found'),
  );
  assert.throws(
    () => repository.bind_current_authority(),
    assertRepositoryError('builder_provider_config_repository_unavailable'),
  );
});

test('keeps decrypt or safeStorage unavailability distinct from missing current config', (t) => {
  const root = temporaryRoot(t);
  const first = repositoryWithFakeSecretStore(root);
  first.write_current({ config: config(), credential: 'real-key-value' });
  const restarted = createBuilderProviderConfigRepository(root, {
    secretStore: createBuilderProviderSecretStore(root, {
      safeStorage: fakeSafeStorage({ decryptThrows: true }),
    }),
  });

  assert.throws(
    () => restarted.read_current(),
    assertRepositoryError('builder_provider_config_repository_unavailable'),
  );
});

test('leaves the previous current envelope active when config publish fails after secret publish', (t) => {
  const root = temporaryRoot(t);
  const repository = repositoryWithFakeSecretStore(root);
  const first = repository.write_current({ config: config({ model: 'first-model' }), credential: 'first-key' });
  const currentPath = path.join(root, CONFIG_DIRECTORY_NAME, CURRENT_FILE_NAME);
  const currentBefore = fs.readFileSync(currentPath, 'utf8');
  const originalRenameSync = fs.renameSync;
  fs.renameSync = function failConfigPublish(source, target) {
    if (path.basename(String(source)).startsWith('.current-') && path.basename(String(target)) === CURRENT_FILE_NAME) {
      throw new Error(PRIVATE_MARKER);
    }
    return originalRenameSync.apply(fs, arguments);
  };
  try {
    assert.throws(
      () => repository.write_current({ config: config({ model: 'second-model' }), credential: 'second-key' }),
      assertRepositoryError('builder_provider_config_repository_persistence_failed'),
    );
  } finally {
    fs.renameSync = originalRenameSync;
  }
  assert.equal(fs.readFileSync(currentPath, 'utf8'), currentBefore);
  assert.deepEqual(repository.read_current().secret_binding, first.secret_binding);
  assert.equal(fs.readdirSync(path.join(root, SECRET_DIRECTORY_NAME)).length, 2);
});

test('fails closed on corruption, missing secret binding, malformed input, and authority replacement', (t) => {
  const root = temporaryRoot(t);
  const repository = repositoryWithFakeSecretStore(root);
  repository.write_current({ config: config(), credential: 'real-key-value' });
  assert.throws(
    () => repository.write_current({ config: config({ temperature: -0 }), credential: 'real-key-value' }),
    assertRepositoryError('builder_provider_config_repository_invalid'),
  );
  const accessor = { config: config() };
  Object.defineProperty(accessor, 'credential', {
    enumerable: true,
    get() { throw new Error(PRIVATE_MARKER); },
  });
  assert.throws(
    () => repository.write_current(accessor),
    assertRepositoryError('builder_provider_config_repository_invalid'),
  );
  assert.throws(
    () => repository.write_current(new Proxy({ config: config(), credential: 'real-key-value' }, {})),
    assertRepositoryError('builder_provider_config_repository_invalid'),
  );

  const currentPath = path.join(root, CONFIG_DIRECTORY_NAME, CURRENT_FILE_NAME);
  const drift = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
  drift.config.model = 'drifted-model';
  fs.writeFileSync(currentPath, `${JSON.stringify(drift)}\n`, 'utf8');
  assert.throws(
    () => repository.read_current(),
    assertRepositoryError('builder_provider_config_repository_integrity_failed'),
  );

  const replacementRoot = temporaryRoot(t);
  const replaced = repositoryWithFakeSecretStore(replacementRoot);
  replaced.write_current({ config: config(), credential: 'real-key-value' });
  const configDirectory = path.join(replacementRoot, CONFIG_DIRECTORY_NAME);
  fs.renameSync(configDirectory, `${configDirectory}-moved`);
  fs.mkdirSync(configDirectory);
  assert.throws(
    () => replaced.read_current(),
    assertRepositoryError('builder_provider_config_repository_integrity_failed'),
  );
});

test('normalizes repository failures into fresh fixed errors without leaking mutated details or proxy traps', (t) => {
  const root = temporaryRoot(t);
  const mutated = new BuilderProviderConfigRepositoryError('builder_provider_config_repository_persistence_failed');
  mutated.message = PRIVATE_MARKER;
  mutated.stack = PRIVATE_MARKER;
  const repository = repositoryWithFakeSecretStore(root);
  const originalRenameSync = fs.renameSync;
  fs.renameSync = function failCurrentPublish(source, target) {
    if (path.basename(String(source)).startsWith('.current-') && path.basename(String(target)) === CURRENT_FILE_NAME) {
      throw mutated;
    }
    return originalRenameSync.apply(fs, arguments);
  };
  try {
    assert.throws(
      () => repository.write_current({ config: config(), credential: 'real-key-value' }),
      (error) => error instanceof BuilderProviderConfigRepositoryError
        && error !== mutated
        && error.code === 'builder_provider_config_repository_persistence_failed'
        && error.stack === `${error.name}: ${error.message}`
        && !`${error.message}:${error.stack}`.includes(PRIVATE_MARKER),
    );
  } finally {
    fs.renameSync = originalRenameSync;
  }

  let trapCalls = 0;
  const hostile = new Proxy(new Error(PRIVATE_MARKER), {
    getPrototypeOf() {
      trapCalls += 1;
      throw new Error(PRIVATE_MARKER);
    },
  });
  const hostileRepository = createBuilderProviderConfigRepository(root, {
    secretStore: {
      publish() { throw hostile; },
      resolve() { throw hostile; },
      verify_binding() { throw hostile; },
    },
  });
  assert.throws(
    () => hostileRepository.write_current({ config: config(), credential: 'real-key-value' }),
    (error) => error instanceof BuilderProviderConfigRepositoryError
      && error.code === 'builder_provider_config_repository_unavailable'
      && !`${error.message}:${error.stack}`.includes(PRIVATE_MARKER),
  );
  assert.equal(trapCalls, 0);
});

test('source stays main-only and isolated from IPC, renderer, host adapter, transport, and legacy authorities', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-provider-config-repository.cjs'),
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /safeStorage|ipcMain|ipcRenderer|contextBridge|BrowserWindow|preload|fetch\s*\(|Authorization|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta|generic.*config|secure-provider|localStorage|sessionStorage|\beval\s*\(|new Function/iu,
  );
  assert.doesNotMatch(source, /builder-generation-host-adapter|builder-openai-compatible-transport/u);
});
