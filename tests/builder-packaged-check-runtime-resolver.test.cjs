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

test('registers a short-lived packaged npm-compatible runtime identity', () => {
  const registry = createBuilderCheckRuntimeRegistry();
  const resolver = createBuilderPackagedCheckRuntimeResolver({
    runtime_registry: registry,
    launcher_path: path.resolve(process.execPath),
    worker_path: path.resolve(WORKER_PATH),
    clock: { now_ms: () => 1_000 },
  });
  const identity = resolver.resolve_npm_runtime();
  assert.equal(identity.package_manager, 'npm');
  assert.equal(identity.package_manager_version, '9.0.1');
  assert.equal(identity.resolution_source, 'packaged_runtime');
  assert.equal(identity.resolved_at_ms, 1_000);
  assert.equal(identity.expires_at_ms, 601_000);
  assert.match(identity.launcher_binary_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(identity.cli_entry_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(Object.hasOwn(identity, 'launcher_path'), false);

  const handle = registry.read_private_runtime({ runtime_identity: identity, read_at_ms: 1_001 });
  assert.equal(handle.launcher_path, fs.realpathSync.native(process.execPath));
  assert.equal(handle.cli_entry_path, fs.realpathSync.native(WORKER_PATH));
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
