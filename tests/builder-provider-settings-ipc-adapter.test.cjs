'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  READ_CURRENT_CHANNEL,
  REPLACE_CURRENT_CHANNEL,
  STATUS_CHANNEL,
  BuilderProviderSettingsIpcError,
  createBuilderProviderSettingsIpcAdapter,
} = require('../electron/builder-provider-settings-ipc-adapter.cjs');
const {
  createBuilderProviderConfig,
} = require('../electron/builder-provider-config.cjs');

function activeWindow() {
  const webContents = { isDestroyed: () => false };
  return { webContents, isDestroyed: () => false };
}

function secretRef() {
  return {
    ref_version: 'builder-provider-secret-ref.v1',
    provider_id: 'builder-default',
    secret_id: 'builder-provider-secret:default',
  };
}

function repositoryConfig(overrides = {}) {
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

const DEFAULT_CONFIG_DIGEST = repositoryConfig().config_digest;

function repositoryEnvelope(overrides = {}) {
  return {
    result_version: 'builder-provider-config-repository.v1',
    config: repositoryConfig(),
    secret_binding: {
      binding_version: 'builder-provider-secret-binding.v1',
      secret_ref: secretRef(),
      encrypted_secret_digest: `sha256:${'b'.repeat(64)}`,
    },
    restart_restore: true,
    persistence_evidence: {
      secret_file_fsync: 'private-evidence-marker',
    },
    ...overrides,
  };
}

function repositoryError(code) {
  const error = new Error('private-repository-message');
  error.name = 'BuilderProviderConfigRepositoryError';
  error.code = code;
  error.stack = 'private-repository-stack';
  return error;
}

function adapter(overrides = {}) {
  const windowRef = activeWindow();
  const calls = [];
  const value = createBuilderProviderSettingsIpcAdapter({
    readCurrent: () => {
      calls.push(['readCurrent']);
      return repositoryEnvelope();
    },
    writeCurrent: (request) => {
      calls.push(['writeCurrent', request]);
      return repositoryEnvelope({ config: repositoryConfig(request.config) });
    },
    mainWindowRef: () => windowRef,
    ...overrides,
  });
  return { calls, value, windowRef };
}

function assertRedacted(value) {
  const text = JSON.stringify(value);
  assert.doesNotMatch(
    text,
    /real-key-value|secret_ref|secret_binding|encrypted_secret_digest|private-evidence-marker/iu,
  );
}

test('exposes only dedicated provider settings channels and redacts repository authority', () => {
  const { calls, value, windowRef } = adapter();

  assert.equal(value.adapter_id, 'builder_provider_settings.controlled_ipc_adapter.v1');
  assert.equal(value.namespace, 'providerSettings');
  assert.equal(value.preload_namespace, 'window.clawfabricBuilder.providerSettings');
  assert.deepEqual(value.exposed_methods, ['readCurrent', 'replaceCurrent', 'status']);
  assert.deepEqual(
    Object.values(value.channels).map(({ channel }) => channel),
    [READ_CURRENT_CHANNEL, REPLACE_CURRENT_CHANNEL, STATUS_CHANNEL],
  );

  const loaded = value.channels.readCurrent.invoke({ sender: windowRef.webContents });
  assert.deepEqual(loaded, {
    result_version: 'builder-provider-settings-ipc-adapter.v1',
    operation: 'current_loaded',
    configured: true,
    config: {
      provider_id: 'builder-default',
      base_url: 'https://provider.example/v1',
      model: 'builder-model',
      timeout_ms: 30000,
      temperature: 0.2,
      max_tokens: 8192,
      config_digest: DEFAULT_CONFIG_DIGEST,
    },
    credential_status: 'stored',
  });
  assertRedacted(loaded);

  const status = value.channels.status.invoke({ sender: windowRef.webContents });
  assert.deepEqual(status, {
    status_version: 'builder-provider-settings-status.v1',
    configured: true,
    config_digest: DEFAULT_CONFIG_DIGEST,
    credential_status: 'stored',
  });
  assertRedacted(status);

  assert.deepEqual(calls, [['readCurrent'], ['readCurrent']]);
  assert.deepEqual(value.authority, {
    provider_config_repository_injected: true,
    active_renderer_required: true,
    generic_provider_authority_reused: false,
    direct_electron_registration: false,
    direct_preload_exposure: false,
    credential_readback: false,
    encrypted_secret_readback: false,
    secret_binding_readback: false,
    persistence_evidence_readback: false,
  });
});

test('replaces config and credential without returning credential or secret binding data', () => {
  const { calls, value, windowRef } = adapter();
  const request = Object.freeze({
    config: {
      base_url: 'https://provider.example/v1',
      model: 'new-model',
      timeout_ms: 60000,
      temperature: null,
      max_tokens: null,
      secret_ref: secretRef(),
    },
    credential: 'real-key-value',
  });

  const replaced = value.channels.replaceCurrent.invoke({ sender: windowRef.webContents }, request);

  assert.equal(replaced.operation, 'current_replaced');
  assert.equal(replaced.config.model, 'new-model');
  assert.equal(replaced.credential_status, 'stored');
  assertRedacted(replaced);
  assert.deepEqual(calls, [['writeCurrent', request]]);
});

test('reports missing current config as redacted unconfigured status', () => {
  const { value, windowRef } = adapter({
    readCurrent: () => {
      throw repositoryError('builder_provider_config_repository_not_found');
    },
  });

  assert.deepEqual(value.channels.readCurrent.invoke({ sender: windowRef.webContents }), {
    result_version: 'builder-provider-settings-ipc-adapter.v1',
    operation: 'current_loaded',
    configured: false,
    config: null,
    credential_status: 'missing',
  });
  assert.deepEqual(value.channels.status.invoke({ sender: windowRef.webContents }), {
    status_version: 'builder-provider-settings-status.v1',
    configured: false,
    config_digest: null,
    credential_status: 'missing',
  });
});

test('keeps storage and decrypt unavailable failures closed instead of reporting unconfigured', () => {
  const { value, windowRef } = adapter({
    readCurrent: () => {
      throw repositoryError('builder_provider_config_repository_unavailable');
    },
  });

  assert.throws(
    () => value.channels.readCurrent.invoke({ sender: windowRef.webContents }),
    (error) => error instanceof BuilderProviderSettingsIpcError
      && error.code === 'builder_provider_settings_unavailable'
      && error.message === 'AI provider settings are unavailable.',
  );
  assert.throws(
    () => value.channels.status.invoke({ sender: windowRef.webContents }),
    (error) => error.code === 'builder_provider_settings_unavailable',
  );
});

test('rejects inactive renderers, exact payload drift, and malformed write requests', () => {
  const { calls, value, windowRef } = adapter();
  const marker = 'real-key-value';

  assert.throws(
    () => value.channels.readCurrent.invoke({ sender: {} }),
    (error) => error instanceof BuilderProviderSettingsIpcError
      && error.code === 'builder_provider_settings_forbidden'
      && error.message === 'AI provider settings are unavailable.',
  );
  assert.throws(
    () => value.channels.readCurrent.invoke({ sender: windowRef.webContents }, { extra: true }),
    (error) => error.code === 'builder_provider_settings_request_invalid',
  );
  assert.throws(
    () => value.channels.status.invoke({ sender: windowRef.webContents }, { extra: true }),
    (error) => error.code === 'builder_provider_settings_request_invalid',
  );
  assert.throws(
    () => value.channels.replaceCurrent.invoke({ sender: windowRef.webContents }),
    (error) => error.code === 'builder_provider_settings_request_invalid',
  );
  assert.throws(
    () => value.channels.replaceCurrent.invoke(
      { sender: windowRef.webContents },
      { config: repositoryConfig(), credential: marker, extra: true },
    ),
    (error) => error.code === 'builder_provider_settings_request_invalid'
      && !error.message.includes(marker),
  );
  assert.deepEqual(calls, []);
});

test('normalizes known repository failures into fresh fixed errors', () => {
  const windowRef = activeWindow();
  const mutated = repositoryError('builder_provider_config_repository_persistence_failed');
  const value = createBuilderProviderSettingsIpcAdapter({
    readCurrent: () => {
      throw mutated;
    },
    writeCurrent: () => ({}),
    mainWindowRef: () => windowRef,
  });

  assert.throws(
    () => value.channels.readCurrent.invoke({ sender: windowRef.webContents }),
    (error) => error instanceof BuilderProviderSettingsIpcError
      && error !== mutated
      && error.code === 'builder_provider_settings_persistence_failed'
      && error.stack === `${error.name}: ${error.message}`
      && !`${error.message}:${error.stack}`.includes('private-repository'),
  );
});

test('rejects forged repository config values before redacting for the renderer', () => {
  const windowRef = activeWindow();
  let trapCalls = 0;
  const hostileModel = new Proxy({}, {
    getPrototypeOf() {
      trapCalls += 1;
      throw new Error('private-model-prototype-marker');
    },
  });
  const cases = [
    { ...repositoryConfig(), timeout_ms: '30000' },
    { ...repositoryConfig(), model: hostileModel },
    { ...repositoryConfig(), config_digest: `sha256:${'c'.repeat(64)}` },
    {
      ...repositoryConfig(),
      secret_ref: {
        ...secretRef(),
        secret_id: 'builder-provider-secret:drifted',
      },
    },
  ];

  for (const forgedConfig of cases) {
    const value = createBuilderProviderSettingsIpcAdapter({
      readCurrent: () => repositoryEnvelope({ config: forgedConfig }),
      writeCurrent: () => repositoryEnvelope({ config: forgedConfig }),
      mainWindowRef: () => windowRef,
    });

    assert.throws(
      () => value.channels.readCurrent.invoke({ sender: windowRef.webContents }),
      (error) => error instanceof BuilderProviderSettingsIpcError
        && error.code === 'builder_provider_settings_integrity_failed'
        && error.stack === `${error.name}: ${error.message}`
        && !`${error.message}:${error.stack}`.includes('secret_ref')
        && !`${error.message}:${error.stack}`.includes('private-model-prototype-marker'),
    );
    assert.throws(
      () => value.channels.status.invoke({ sender: windowRef.webContents }),
      (error) => error.code === 'builder_provider_settings_integrity_failed'
        && !`${error.message}:${error.stack}`.includes('secret_ref'),
    );
    assert.throws(
      () => value.channels.replaceCurrent.invoke(
        { sender: windowRef.webContents },
        { config: repositoryConfig({ model: 'replacement-model' }), credential: 'real-key-value' },
      ),
      (error) => error.code === 'builder_provider_settings_integrity_failed'
        && !`${error.message}:${error.stack}`.includes('real-key-value'),
    );
  }
  assert.equal(trapCalls, 0);
});

test('rejects forged repository envelopes without invoking accessors or proxy traps', () => {
  const windowRef = activeWindow();
  let trapCalls = 0;
  const accessorEnvelope = repositoryEnvelope();
  Object.defineProperty(accessorEnvelope, 'config', {
    enumerable: true,
    get() {
      trapCalls += 1;
      throw new Error('private-config-getter-marker');
    },
  });
  const extraEnvelope = {
    ...repositoryEnvelope(),
    extra: true,
  };
  const symbolEnvelope = {
    ...repositoryEnvelope(),
    [Symbol('private-symbol-marker')]: true,
  };
  const proxyEnvelope = new Proxy(repositoryEnvelope(), {
    ownKeys() {
      trapCalls += 1;
      return Reflect.ownKeys(repositoryEnvelope());
    },
  });

  for (const forgedEnvelope of [accessorEnvelope, extraEnvelope, symbolEnvelope, proxyEnvelope]) {
    const value = createBuilderProviderSettingsIpcAdapter({
      readCurrent: () => forgedEnvelope,
      writeCurrent: () => forgedEnvelope,
      mainWindowRef: () => windowRef,
    });

    assert.throws(
      () => value.channels.readCurrent.invoke({ sender: windowRef.webContents }),
      (error) => error instanceof BuilderProviderSettingsIpcError
        && error.code === 'builder_provider_settings_integrity_failed'
        && error.stack === `${error.name}: ${error.message}`
        && !`${error.message}:${error.stack}`.includes('private-config-getter-marker')
        && !`${error.message}:${error.stack}`.includes('private-symbol-marker'),
    );
    assert.throws(
      () => value.channels.status.invoke({ sender: windowRef.webContents }),
      (error) => error.code === 'builder_provider_settings_integrity_failed'
        && !`${error.message}:${error.stack}`.includes('private-config-getter-marker'),
    );
    assert.throws(
      () => value.channels.replaceCurrent.invoke(
        { sender: windowRef.webContents },
        { config: repositoryConfig({ model: 'replacement-model' }), credential: 'real-key-value' },
      ),
      (error) => error.code === 'builder_provider_settings_integrity_failed'
        && !`${error.message}:${error.stack}`.includes('real-key-value'),
    );
  }
  assert.equal(trapCalls, 0);
});

test('rejects hostile options, proxy failures, and accessor payloads without leaking details', () => {
  let trapCalls = 0;
  const valid = {
    readCurrent: () => repositoryEnvelope(),
    writeCurrent: () => repositoryEnvelope(),
    mainWindowRef: activeWindow,
  };
  const accessor = { ...valid };
  Object.defineProperty(accessor, 'readCurrent', {
    enumerable: true,
    get() {
      trapCalls += 1;
      return () => repositoryEnvelope();
    },
  });
  const proxy = new Proxy(valid, {
    ownKeys() {
      trapCalls += 1;
      return Reflect.ownKeys(valid);
    },
  });

  for (const invalid of [
    null,
    {},
    { ...valid, extra: true },
    { ...valid, readCurrent: 'not-a-function' },
    accessor,
    proxy,
  ]) {
    assert.throws(
      () => createBuilderProviderSettingsIpcAdapter(invalid),
      (error) => error instanceof BuilderProviderSettingsIpcError
        && error.code === 'builder_provider_settings_failed',
    );
  }
  assert.equal(trapCalls, 0);

  const { value, windowRef } = adapter({
    readCurrent: () => {
      throw new Proxy(new Error('private-proxy-marker'), {
        getPrototypeOf() {
          trapCalls += 1;
          throw new Error('private-prototype-marker');
        },
      });
    },
  });
  assert.throws(
    () => value.channels.readCurrent.invoke({ sender: windowRef.webContents }),
    (error) => error.code === 'builder_provider_settings_failed'
      && !`${error.message}:${error.stack}`.includes('private-proxy-marker'),
  );

  const hostilePayload = { config: repositoryConfig() };
  Object.defineProperty(hostilePayload, 'credential', {
    enumerable: true,
    get() {
      throw new Error('private-credential-marker');
    },
  });
  assert.throws(
    () => value.channels.replaceCurrent.invoke({ sender: windowRef.webContents }, hostilePayload),
    (error) => error.code === 'builder_provider_settings_request_invalid'
      && !`${error.message}:${error.stack}`.includes('private-credential-marker'),
  );
  assert.equal(trapCalls, 0);
});

test('source is a pure controlled adapter and shell wiring exposes only settings channels', () => {
  const root = path.join(__dirname, '..');
  const source = fs.readFileSync(
    path.join(root, 'electron', 'builder-provider-settings-ipc-adapter.cjs'),
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|\bipcMain\b|\bipcRenderer\b|contextBridge|safeStorage|fetch\s*\(|https?:|Authorization|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta|AppLayout|generic.*(?:config|secret)/iu,
  );
  assert.doesNotMatch(source, /builder-provider-config-repository|builder-provider-secret-store/u);
  assert.match(source, /active_renderer_required:\s*true/u);
  assert.match(source, /direct_electron_registration:\s*false/u);
  assert.match(source, /direct_preload_exposure:\s*false/u);
  assert.match(source, /credential_readback:\s*false/u);
  assert.match(source, /encrypted_secret_readback:\s*false/u);
  assert.match(source, /secret_binding_readback:\s*false/u);
  assert.match(source, /persistence_evidence_readback:\s*false/u);

  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
  assert.match(main, /createBuilderProviderSettingsIpcRuntime/u);
  assert.doesNotMatch(main, /clawfabric-builder:provider-settings:|credential|safeStorage/iu);
  assert.match(preload, /providerSettings/u);
  assert.match(preload, new RegExp(READ_CURRENT_CHANNEL, 'u'));
  assert.match(preload, new RegExp(REPLACE_CURRENT_CHANNEL, 'u'));
  assert.match(preload, new RegExp(STATUS_CHANNEL, 'u'));
  assert.doesNotMatch(preload, /credential|secret_ref|secret_binding|encrypted_secret_digest|safeStorage/iu);
});
