'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BuilderProviderConfigError,
  createBuilderProviderConfig,
  sanitizeBuilderProviderConfig,
} = require('../electron/builder-provider-config.cjs');

function secretRef() {
  return {
    ref_version: 'builder-provider-secret-ref.v1',
    provider_id: 'builder-default',
    secret_id: 'builder-provider-secret:default',
  };
}

function input(overrides = {}) {
  return {
    base_url: 'https://api.example/v1',
    model: 'builder-model',
    timeout_ms: 60000,
    temperature: 0.2,
    max_tokens: 8192,
    secret_ref: secretRef(),
    ...overrides,
  };
}

test('creates and sanitizes one deterministic immutable Builder provider config', () => {
  const first = createBuilderProviderConfig(input());
  const second = createBuilderProviderConfig(input());
  assert.deepEqual(first, second);
  assert.equal(first.config_version, 'builder-provider-config.v1');
  assert.equal(first.provider_id, 'builder-default');
  assert.match(first.config_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.secret_ref), true);
  const sanitized = sanitizeBuilderProviderConfig(structuredClone(first));
  assert.deepEqual(sanitized, first);
  assert.notEqual(sanitized, first);
});

test('normalizes the base URL and preserves explicit nullable tuning', () => {
  const config = createBuilderProviderConfig(input({
    base_url: 'http://127.0.0.1:11434/v1/',
    temperature: null,
    max_tokens: null,
  }));
  assert.equal(config.base_url, 'http://127.0.0.1:11434/v1');
  assert.equal(config.temperature, null);
  assert.equal(config.max_tokens, null);
});

test('rejects endpoint, identity, bounds, extras, accessors, proxies, and digest drift', () => {
  const cases = [
    input({ base_url: 'http://api.example/v1' }),
    input({ base_url: 'https://user:pass@api.example/v1' }),
    input({ model: '' }),
    input({ timeout_ms: 999 }),
    input({ temperature: 3 }),
    input({ temperature: -0 }),
    input({ max_tokens: 0 }),
    input({ secret_ref: { ...secretRef(), provider_id: 'other' } }),
    { ...input(), extra: true },
    new Proxy(input(), {}),
  ];
  const accessor = input();
  Object.defineProperty(accessor, 'model', { enumerable: true, get() { throw new Error('private'); } });
  cases.push(accessor);
  for (const value of cases) assert.throws(() => createBuilderProviderConfig(value), BuilderProviderConfigError);
  const drifted = structuredClone(createBuilderProviderConfig(input()));
  drifted.model = 'changed';
  assert.throws(() => sanitizeBuilderProviderConfig(drifted), BuilderProviderConfigError);
});

test('contains no secret value, transport, IPC, renderer, or legacy authority', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'builder-provider-config.cjs'), 'utf8');
  assert.doesNotMatch(source, /credential|api[_-]?key|fetch\s*\(|ipcMain|ipcRenderer|contextBridge|chat_planner|local-provider-executor|repository|safeStorage/iu);
});
