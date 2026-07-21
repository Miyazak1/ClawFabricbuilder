'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  GENERATE_CHANNEL,
  CANCEL_CHANNEL,
  AVAILABILITY_CHANNEL,
  BuilderGenerationIpcError,
  createBuilderGenerationIpcAdapter,
} = require('../electron/builder-generation-ipc-adapter.cjs');

function activeWindow() {
  const webContents = { isDestroyed: () => false };
  return { webContents, isDestroyed: () => false };
}

function adapter(overrides = {}) {
  const windowRef = activeWindow();
  const calls = [];
  const value = createBuilderGenerationIpcAdapter({
    generate: async (request) => {
      calls.push(['generate', request]);
      return { result: 'generated' };
    },
    cancel: (request) => {
      calls.push(['cancel', request]);
      return { cancelled: true };
    },
    availability: () => {
      calls.push(['availability']);
      return { available: true };
    },
    mainWindowRef: () => windowRef,
    ...overrides,
  });
  return { calls, value, windowRef };
}

test('exposes only the dedicated Builder generation channels and forwards exact calls', async () => {
  const { calls, value, windowRef } = adapter();
  const request = Object.freeze({ request_digest: `sha256:${'a'.repeat(64)}` });
  const cancellation = Object.freeze({ request_id: request.request_digest });

  assert.equal(value.adapter_id, 'builder_code_generation.controlled_ipc_adapter.v1');
  assert.equal(value.namespace, 'builderCodeGenerator');
  assert.equal(value.preload_namespace, 'window.clawfabricBuilder.codeGenerator');
  assert.deepEqual(value.exposed_methods, ['generate', 'cancel', 'availability']);
  assert.deepEqual(
    Object.values(value.channels).map(({ channel }) => channel),
    [GENERATE_CHANNEL, CANCEL_CHANNEL, AVAILABILITY_CHANNEL],
  );
  assert.deepEqual(
    await value.channels.generate.invoke({ sender: windowRef.webContents }, request),
    { result: 'generated' },
  );
  assert.deepEqual(
    await value.channels.cancel.invoke({ sender: windowRef.webContents }, cancellation),
    { cancelled: true },
  );
  assert.deepEqual(
    await value.channels.availability.invoke({ sender: windowRef.webContents }),
    { available: true },
  );
  assert.deepEqual(calls, [
    ['generate', request],
    ['cancel', cancellation],
    ['availability'],
  ]);
  assert.deepEqual(value.authority, {
    host_adapter_injected: true,
    active_renderer_required: true,
    generic_provider_authority_reused: false,
    direct_electron_registration: false,
    direct_preload_exposure: false,
    provider_settings_exposed: false,
    credential_readback: false,
  });
});

test('rejects inactive renderers and argument-count drift before invoking host authority', async () => {
  const { calls, value, windowRef } = adapter();
  const marker = 'private-request-marker';

  await assert.rejects(
    value.channels.generate.invoke({ sender: {} }, { marker }),
    (error) => error instanceof BuilderGenerationIpcError
      && error.code === 'builder_generation_forbidden'
      && error.message === 'AI project generation is unavailable.'
      && !error.message.includes(marker),
  );
  await assert.rejects(
    value.channels.generate.invoke({ sender: windowRef.webContents }),
    (error) => error.code === 'builder_generation_request_invalid',
  );
  await assert.rejects(
    value.channels.cancel.invoke(
      { sender: windowRef.webContents },
      { request_id: `sha256:${'a'.repeat(64)}` },
      { extra: true },
    ),
    (error) => error.code === 'builder_generation_request_invalid',
  );
  await assert.rejects(
    value.channels.availability.invoke({ sender: windowRef.webContents }, { extra: marker }),
    (error) => error.code === 'builder_generation_request_invalid'
      && !error.message.includes(marker),
  );
  assert.deepEqual(calls, []);
});

test('preserves known safe host codes and redacts unknown or hostile failures', async () => {
  const windowRef = activeWindow();
  const modified = new BuilderGenerationIpcError('builder_generation_timeout');
  modified.message = 'modified-private-marker';
  modified.stack = 'modified-private-stack';
  const known = createBuilderGenerationIpcAdapter({
    generate: () => {
      throw modified;
    },
    cancel: () => {
      throw new Proxy(new Error('proxy-private-marker'), {
        getPrototypeOf() { throw new Error('proxy prototype trap marker'); },
      });
    },
    availability: () => {
      const error = new Error('getter-private-marker');
      Object.defineProperty(error, 'code', {
        get() { throw new Error('getter trap marker'); },
      });
      throw error;
    },
    mainWindowRef: () => windowRef,
  });

  await assert.rejects(
    known.channels.generate.invoke({ sender: windowRef.webContents }, {}),
    (error) => error.code === 'builder_generation_timeout'
      && error.retryable === true
      && error.stack === `${error.name}: ${error.message}`
      && error !== modified
      && !error.message.includes('modified-private-marker')
      && !error.stack.includes('modified-private-stack'),
  );
  await assert.rejects(
    known.channels.cancel.invoke({ sender: windowRef.webContents }, {}),
    (error) => error.code === 'builder_generation_failed'
      && !error.message.includes('proxy-private-marker'),
  );
  await assert.rejects(
    known.channels.availability.invoke({ sender: windowRef.webContents }),
    (error) => error.code === 'builder_generation_failed'
      && !error.message.includes('getter-private-marker'),
  );
});

test('rejects malformed dependency authority without invoking getters or proxy traps', () => {
  let trapCalls = 0;
  const valid = {
    generate: async () => ({}),
    cancel: () => ({}),
    availability: () => ({}),
    mainWindowRef: activeWindow,
  };
  const accessor = { ...valid };
  Object.defineProperty(accessor, 'generate', {
    enumerable: true,
    get() {
      trapCalls += 1;
      return async () => ({});
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
    { ...valid, generate: 'not-a-function' },
    accessor,
    proxy,
  ]) {
    assert.throws(
      () => createBuilderGenerationIpcAdapter(invalid),
      (error) => error instanceof BuilderGenerationIpcError
        && error.code === 'builder_generation_failed',
    );
  }
  assert.equal(trapCalls, 0);
});

test('contains no registration, preload, secret, transport, repository, or legacy authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-generation-ipc-adapter.cjs'),
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|\bipcMain\b|\bipcRenderer\b|contextBridge|safeStorage|\bcredential\b|Authorization|fetch\s*\(|https?:|builder-provider-config|builder-provider-secret|builder-project-revision|ChatCreatePage|chat_planner|local-provider-executor|Canvas|JobMeta|AppLayout/iu,
  );
  assert.match(source, /active_renderer_required:\s*true/u);
  assert.match(source, /generic_provider_authority_reused:\s*false/u);
  assert.match(source, /provider_settings_exposed:\s*false/u);
  assert.match(source, /credential_readback:\s*false/u);
});
