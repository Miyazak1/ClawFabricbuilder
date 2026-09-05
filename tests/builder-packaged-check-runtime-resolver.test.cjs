'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BuilderPackagedCheckRuntimeResolverError,
  createBuilderPackagedCheckRuntimeResolver,
} = require('../electron/builder-packaged-check-runtime-resolver.cjs');
const {
  createBuilderCheckRuntimeRegistry,
} = require('../electron/builder-check-runtime-identity.cjs');

const WORKER_PATH = path.join(
  __dirname,
  '..',
  'electron',
  'builder-packaged-check-script-worker.cjs',
);

test('registers a short-lived packaged npm-compatible runtime identity', async () => {
  const registry = createBuilderCheckRuntimeRegistry();
  const resolver = createBuilderPackagedCheckRuntimeResolver({
    runtime_registry: registry,
    launcher_path: path.resolve(process.execPath),
    worker_path: path.resolve(WORKER_PATH),
    clock: { now_ms: () => 1_000 },
  });
  const identity = await resolver.resolve_npm_runtime_async();
  assert.equal(identity.package_manager, 'npm');
  assert.equal(identity.package_manager_version, '9.0.1');
  assert.equal(identity.resolution_source, 'packaged_runtime');
  assert.equal(identity.resolved_at_ms, 1_000);
  assert.equal(identity.expires_at_ms, 601_000);
  assert.match(identity.launcher_binary_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(identity.cli_entry_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(Object.hasOwn(identity, 'launcher_path'), false);
  assert.equal(resolver.resolve_npm_runtime(), identity);

  const handle = registry.read_private_runtime({ runtime_identity: identity, read_at_ms: 1_001 });
  assert.equal(handle.launcher_path, fs.realpathSync.native(process.execPath));
  assert.equal(handle.cli_entry_path, fs.realpathSync.native(WORKER_PATH));
});

test('renews a packaged runtime identity before it can no longer cover one check approval', () => {
  const registry = createBuilderCheckRuntimeRegistry();
  let now = 1_000;
  const resolver = createBuilderPackagedCheckRuntimeResolver({
    runtime_registry: registry,
    launcher_path: path.resolve(process.execPath),
    worker_path: path.resolve(WORKER_PATH),
    clock: { now_ms: () => now },
  });
  const first = resolver.resolve_npm_runtime();

  now = 300_999;
  assert.equal(resolver.resolve_npm_runtime(), first);

  now = 301_000;
  const renewed = resolver.resolve_npm_runtime();
  assert.notEqual(renewed.runtime_identity_id, first.runtime_identity_id);
  assert.equal(renewed.resolved_at_ms, 301_000);
  assert.equal(renewed.expires_at_ms, 901_000);
});

test('shares a pending async runtime registration only while it can cover one check approval', async () => {
  const registry = createBuilderCheckRuntimeRegistry();
  let now = 2_000;
  let registrations = 0;
  const resolver = createBuilderPackagedCheckRuntimeResolver({
    runtime_registry: {
      register_runtime: registry.register_runtime.bind(registry),
      async register_runtime_async(input) {
        registrations += 1;
        return registry.register_runtime(input);
      },
    },
    launcher_path: path.resolve(process.execPath),
    worker_path: path.resolve(WORKER_PATH),
    clock: { now_ms: () => now },
  });

  const [first, second] = await Promise.all([
    resolver.resolve_npm_runtime_async(),
    resolver.resolve_npm_runtime_async(),
  ]);
  assert.equal(first, second);
  assert.equal(registrations, 1);

  now = 302_000;
  const renewed = await resolver.resolve_npm_runtime_async();
  assert.notEqual(renewed.runtime_identity_id, first.runtime_identity_id);
  assert.equal(registrations, 2);
});

test('rejects malformed configuration and clock values with a fixed error', () => {
  const registry = createBuilderCheckRuntimeRegistry();
  assert.throws(() => createBuilderPackagedCheckRuntimeResolver({
    runtime_registry: registry,
    launcher_path: 'relative.exe',
    worker_path: path.resolve(WORKER_PATH),
    clock: { now_ms: () => 1_000 },
  }), BuilderPackagedCheckRuntimeResolverError);

  const resolver = createBuilderPackagedCheckRuntimeResolver({
    runtime_registry: registry,
    launcher_path: path.resolve(process.execPath),
    worker_path: path.resolve(WORKER_PATH),
    clock: { now_ms: () => -1 },
  });
  assert.throws(() => resolver.resolve_npm_runtime(), (error) => {
    assert.ok(error instanceof BuilderPackagedCheckRuntimeResolverError);
    assert.equal(error.message, 'The packaged project check runtime is unavailable.');
    assert.doesNotMatch(JSON.stringify(error), /node\.exe|worker|secret|runtime\/path/iu);
    return true;
  });
});

test('resolver source is main-only and has no execution or renderer authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-packaged-check-runtime-resolver.cjs'),
    'utf8',
  );
  assert.match(source, /builder-packaged-check-runtime-contract\.cjs/u);
  assert.doesNotMatch(source, /builder-packaged-check-script-worker\.cjs/u);
  assert.doesNotMatch(source, /node:child_process|\bspawn\b|execFile|shell:\s*true/iu);
  assert.doesNotMatch(source, /ipcMain|ipcRenderer|contextBridge|BrowserWindow|fetch\s*\(/iu);
  assert.doesNotMatch(source, /DatabaseSync|node:sqlite|git\s+commit|saveDraft|saveVersion/iu);
});
