'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_PROVIDER_SECRET_STORE_VERSION,
  SECRET_DIRECTORY_NAME,
  BuilderProviderSecretStoreError,
  createBuilderProviderSecretStore,
} = require('../electron/builder-provider-secret-store.cjs');

const PRIVATE_MARKER = 'private-secret-marker';

function temporaryRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-provider-secrets-'));
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

function fakeSafeStorage(options = {}) {
  return {
    isEncryptionAvailable() {
      return options.available !== false;
    },
    encryptString(value) {
      if (options.encryptThrows) throw new Error(PRIVATE_MARKER);
      return Buffer.from(`encrypted:${value}`, 'utf8');
    },
    decryptString(value) {
      if (options.decryptThrows) throw new Error(PRIVATE_MARKER);
      const text = Buffer.from(value).toString('utf8');
      if (!text.startsWith('encrypted:')) throw new Error(PRIVATE_MARKER);
      return text.slice('encrypted:'.length);
    },
  };
}

function assertSecretStoreError(code) {
  return (error) => error instanceof BuilderProviderSecretStoreError
    && error.code === code
    && !`${error.name}:${error.message}:${error.stack}`.includes(PRIVATE_MARKER)
    && !`${error.name}:${error.message}:${error.stack}`.includes(os.tmpdir());
}

test('publishes an encrypted Builder provider secret and resolves only the bound blob', (t) => {
  const root = temporaryRoot(t);
  const store = createBuilderProviderSecretStore(root, { safeStorage: fakeSafeStorage() });

  const result = store.publish({ secret_ref: secretRef(), credential: 'real-key-value' });

  assert.equal(result.result_version, BUILDER_PROVIDER_SECRET_STORE_VERSION);
  assert.equal(result.secret_binding.binding_version, 'builder-provider-secret-binding.v1');
  assert.match(result.secret_binding.encrypted_secret_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(result.secret_binding.secret_ref, secretRef());
  assert.equal(result.persistence_evidence.operation, 'secret_published');
  assert.equal(result.persistence_evidence.secret_file_fsync, 'proven');
  assert.equal(result.persistence_evidence.secret_publish, 'same_directory_replace_reopened');
  assert.match(result.persistence_evidence.secret_parent_directory_fsync, /^(?:proven|not_proven)$/u);
  assert.equal(result.persistence_evidence.reopened_hash_verified, true);
  assert.equal(result.persistence_evidence.decryption_verified, true);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.secret_binding.secret_ref), true);

  const secretFiles = fs.readdirSync(path.join(root, SECRET_DIRECTORY_NAME));
  assert.equal(secretFiles.length, 1);
  const storedText = fs.readFileSync(path.join(root, SECRET_DIRECTORY_NAME, secretFiles[0]), 'utf8');
  assert.doesNotMatch(storedText, /real-key-value|Authorization|Bearer/iu);
  assert.match(storedText, /electron\.safeStorage/u);

  const resolution = store.resolve({
    secret_ref: secretRef(),
    encrypted_secret_digest: result.secret_binding.encrypted_secret_digest,
  });
  assert.deepEqual(resolution, {
    resolution_version: 'builder-provider-secret-resolution.v1',
    secret_ref: secretRef(),
    credential: 'real-key-value',
  });
});

test('rejects unavailable safeStorage and unsafe credentials before writing', (t) => {
  const root = temporaryRoot(t);
  assert.throws(
    () => createBuilderProviderSecretStore(root, { safeStorage: fakeSafeStorage({ available: false }) }),
    assertSecretStoreError('builder_provider_secret_store_unavailable'),
  );
  const store = createBuilderProviderSecretStore(root, { safeStorage: fakeSafeStorage() });
  for (const credential of ['', ' key', 'key\nvalue', `${'x'.repeat(16 * 1024)}x`]) {
    assert.throws(
      () => store.publish({ secret_ref: secretRef(), credential }),
      assertSecretStoreError('builder_provider_secret_store_invalid'),
    );
  }
  assert.deepEqual(fs.readdirSync(path.join(root, SECRET_DIRECTORY_NAME)), []);
});

test('fails closed on malformed refs, accessors, proxies, missing blobs, and decrypt failure', (t) => {
  const root = temporaryRoot(t);
  const store = createBuilderProviderSecretStore(root, { safeStorage: fakeSafeStorage() });
  const published = store.publish({ secret_ref: secretRef(), credential: 'real-key-value' });
  assert.throws(
    () => store.publish(new Proxy({ secret_ref: secretRef(), credential: 'x' }, {})),
    assertSecretStoreError('builder_provider_secret_store_invalid'),
  );
  const accessor = { secret_ref: secretRef() };
  Object.defineProperty(accessor, 'credential', {
    enumerable: true,
    get() { throw new Error(PRIVATE_MARKER); },
  });
  assert.throws(
    () => store.publish(accessor),
    assertSecretStoreError('builder_provider_secret_store_invalid'),
  );
  assert.throws(
    () => store.resolve({
      secret_ref: { ...secretRef(), secret_id: 'builder-provider-secret:other' },
      encrypted_secret_digest: published.secret_binding.encrypted_secret_digest,
    }),
    assertSecretStoreError('builder_provider_secret_store_invalid'),
  );
  assert.throws(
    () => store.resolve({ secret_ref: secretRef(), encrypted_secret_digest: `sha256:${'f'.repeat(64)}` }),
    assertSecretStoreError('builder_provider_secret_store_unavailable'),
  );
  const restarted = createBuilderProviderSecretStore(root, {
    safeStorage: fakeSafeStorage({ decryptThrows: true }),
  });
  assert.throws(
    () => restarted.resolve({
      secret_ref: secretRef(),
      encrypted_secret_digest: published.secret_binding.encrypted_secret_digest,
    }),
    assertSecretStoreError('builder_provider_secret_store_integrity_failed'),
  );
});

test('normalizes storage failures into fresh fixed errors without leaking mutated details or proxy traps', (t) => {
  const root = temporaryRoot(t);
  const mutated = new BuilderProviderSecretStoreError('builder_provider_secret_store_persistence_failed');
  mutated.message = PRIVATE_MARKER;
  mutated.stack = PRIVATE_MARKER;
  const store = createBuilderProviderSecretStore(root, { safeStorage: fakeSafeStorage() });
  const originalOpenSync = fs.openSync;
  fs.openSync = () => {
    throw mutated;
  };
  try {
    assert.throws(
      () => store.publish({ secret_ref: secretRef(), credential: 'real-key-value' }),
      (error) => error instanceof BuilderProviderSecretStoreError
        && error !== mutated
        && error.code === 'builder_provider_secret_store_persistence_failed'
        && error.stack === `${error.name}: ${error.message}`
        && !`${error.message}:${error.stack}`.includes(PRIVATE_MARKER),
    );
  } finally {
    fs.openSync = originalOpenSync;
  }

  let trapCalls = 0;
  const hostile = new Proxy(new Error(PRIVATE_MARKER), {
    getPrototypeOf() {
      trapCalls += 1;
      throw new Error(PRIVATE_MARKER);
    },
  });
  const hostileStore = createBuilderProviderSecretStore(root, {
    safeStorage: {
      isEncryptionAvailable() { return true; },
      encryptString() { throw hostile; },
      decryptString() { throw hostile; },
    },
  });
  assert.throws(
    () => hostileStore.publish({ secret_ref: secretRef(), credential: 'real-key-value' }),
    (error) => error instanceof BuilderProviderSecretStoreError
      && error.code === 'builder_provider_secret_store_unavailable'
      && !`${error.message}:${error.stack}`.includes(PRIVATE_MARKER),
  );
  assert.equal(trapCalls, 0);
});

test('detects encrypted blob corruption and directory authority replacement', (t) => {
  const root = temporaryRoot(t);
  const store = createBuilderProviderSecretStore(root, { safeStorage: fakeSafeStorage() });
  const published = store.publish({ secret_ref: secretRef(), credential: 'real-key-value' });
  const blobPath = path.join(
    root,
    SECRET_DIRECTORY_NAME,
    `${published.secret_binding.encrypted_secret_digest.slice(7)}.json`,
  );
  const corrupted = JSON.parse(fs.readFileSync(blobPath, 'utf8'));
  corrupted.encrypted_credential = Buffer.from('encrypted:changed', 'utf8').toString('base64');
  fs.writeFileSync(blobPath, `${JSON.stringify(corrupted)}\n`, 'utf8');
  assert.throws(
    () => store.resolve({
      secret_ref: secretRef(),
      encrypted_secret_digest: published.secret_binding.encrypted_secret_digest,
    }),
    assertSecretStoreError('builder_provider_secret_store_integrity_failed'),
  );

  const moved = path.join(root, 'moved-secrets');
  fs.renameSync(path.join(root, SECRET_DIRECTORY_NAME), moved);
  fs.mkdirSync(path.join(root, SECRET_DIRECTORY_NAME));
  assert.throws(
    () => store.resolve({
      secret_ref: secretRef(),
      encrypted_secret_digest: published.secret_binding.encrypted_secret_digest,
    }),
    assertSecretStoreError('builder_provider_secret_store_integrity_failed'),
  );
});

test('source is main-only and isolated from config repository, IPC, renderer, and legacy stores', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-provider-secret-store.cjs'),
    'utf8',
  );
  assert.match(source, /safeStorage/u);
  assert.doesNotMatch(
    source,
    /ipcMain|ipcRenderer|contextBridge|BrowserWindow|preload|fetch\s*\(|Authorization|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta|generic.*secret|secure-provider|localStorage|sessionStorage|\beval\s*\(|new Function/iu,
  );
  assert.doesNotMatch(source, /builder-provider-config-repository/u);
});
