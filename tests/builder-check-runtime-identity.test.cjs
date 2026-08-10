'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_CHECK_RUNTIME_HANDLE_VERSION,
  BUILDER_CHECK_RUNTIME_IDENTITY_VERSION,
  BUILDER_CHECK_RUNTIME_REGISTRY_VERSION,
  BuilderCheckRuntimeIdentityError,
  createBuilderCheckRuntimeRegistry,
  sanitizeBuilderCheckRuntimeIdentity,
} = require('../electron/builder-check-runtime-identity.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb-check-runtime-'));
  const launcherPath = path.join(root, process.platform === 'win32' ? 'node.exe' : 'node');
  const cliEntryPath = path.join(root, 'npm-cli.js');
  fs.writeFileSync(launcherPath, Buffer.from('verified-node-launcher'));
  fs.writeFileSync(cliEntryPath, Buffer.from("'use strict';\n"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, launcherPath, cliEntryPath };
}

function registration(paths, overrides = {}) {
  return {
    package_manager: 'npm',
    launcher_path: paths.launcherPath,
    cli_entry_path: paths.cliEntryPath,
    package_manager_version: '10.9.2',
    resolution_source: 'verified_external_runtime',
    resolved_at_ms: 100,
    expires_at_ms: 600_100,
    ...overrides,
  };
}

function assertRuntimeError(fn) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof BuilderCheckRuntimeIdentityError);
    assert.equal(error.code, 'builder_check_runtime_identity_invalid');
    assert.equal(error.message, 'The local check runtime could not be verified.');
    assert.doesNotMatch(JSON.stringify(error), /node\.exe|npm-cli|cfb-check-runtime|secret/iu);
    return true;
  });
}

test('registers an opaque npm runtime identity and discloses paths only to its registry', (t) => {
  const paths = fixture(t);
  const registry = createBuilderCheckRuntimeRegistry();
  const identity = registry.register_runtime(registration(paths));

  assert.equal(registry.registry_version, BUILDER_CHECK_RUNTIME_REGISTRY_VERSION);
  assert.equal(identity.runtime_identity_version, BUILDER_CHECK_RUNTIME_IDENTITY_VERSION);
  assert.equal(identity.package_manager, 'npm');
  assert.equal(identity.launcher_kind, 'node_cli');
  assert.match(identity.launcher_binary_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(identity.cli_entry_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(Object.hasOwn(identity, 'launcher_path'), false);
  assert.equal(Object.hasOwn(identity, 'cli_entry_path'), false);
  assert.deepEqual(sanitizeBuilderCheckRuntimeIdentity(identity), identity);
  assert.ok(Object.isFrozen(identity));

  const handle = registry.read_private_runtime({ runtime_identity: identity, read_at_ms: 101 });
  assert.equal(handle.runtime_handle_version, BUILDER_CHECK_RUNTIME_HANDLE_VERSION);
  assert.equal(handle.launcher_path, fs.realpathSync.native(paths.launcherPath));
  assert.equal(handle.cli_entry_path, fs.realpathSync.native(paths.cliEntryPath));
  assert.equal(handle.authority.path_disclosure, 'main_runner_only');
  assert.equal(handle.authority.command_execution, false);
});

test('supports a native Bun runtime without inventing a CLI entry', (t) => {
  const paths = fixture(t);
  const registry = createBuilderCheckRuntimeRegistry();
  const identity = registry.register_runtime(registration(paths, {
    package_manager: 'bun',
    cli_entry_path: null,
    package_manager_version: '1.2.20',
  }));
  assert.equal(identity.launcher_kind, 'native_binary');
  assert.equal(identity.cli_entry_digest, null);
  assert.equal(
    registry.read_private_runtime({ runtime_identity: identity, read_at_ms: 101 }).cli_entry_path,
    null,
  );
});

test('rejects copied identities, expired handles, and runtime file drift', (t) => {
  const paths = fixture(t);
  const registry = createBuilderCheckRuntimeRegistry();
  const identity = registry.register_runtime(registration(paths));
  assertRuntimeError(() => registry.read_private_runtime({
    runtime_identity: { ...identity },
    read_at_ms: 101,
  }));
  assertRuntimeError(() => registry.read_private_runtime({
    runtime_identity: identity,
    read_at_ms: identity.expires_at_ms,
  }));

  fs.writeFileSync(paths.cliEntryPath, Buffer.from("'use strict';\n// changed\n"));
  assertRuntimeError(() => registry.read_private_runtime({
    runtime_identity: identity,
    read_at_ms: 102,
  }));
});

test('rejects ambiguous manager shapes, unsafe files, malformed lifetime, and identity drift', (t) => {
  const paths = fixture(t);
  const registry = createBuilderCheckRuntimeRegistry();
  assertRuntimeError(() => registry.register_runtime(registration(paths, {
    package_manager: 'npm',
    cli_entry_path: null,
  })));
  assertRuntimeError(() => registry.register_runtime(registration(paths, {
    package_manager: 'bun',
  })));
  assertRuntimeError(() => registry.register_runtime(registration(paths, {
    expires_at_ms: 600_101,
  })));
  assertRuntimeError(() => registry.register_runtime(registration(paths, {
    launcher_path: path.join('relative', 'node.exe'),
  })));

  const identity = registry.register_runtime(registration(paths));
  assertRuntimeError(() => sanitizeBuilderCheckRuntimeIdentity({
    ...identity,
    launcher_binary_digest: `sha256:${'f'.repeat(64)}`,
  }));
  assertRuntimeError(() => sanitizeBuilderCheckRuntimeIdentity({
    ...identity,
    authority: { ...identity.authority, command_execution: true },
  }));
});

test('rejects runtime files reached through a linked directory', (t) => {
  const paths = fixture(t);
  const linkedRoot = path.join(paths.root, 'linked-runtime');
  const actualRoot = path.join(paths.root, 'actual-runtime');
  fs.mkdirSync(actualRoot);
  const launcherPath = path.join(actualRoot, process.platform === 'win32' ? 'node.exe' : 'node');
  const cliEntryPath = path.join(actualRoot, 'npm-cli.js');
  fs.writeFileSync(launcherPath, Buffer.from('verified-node-launcher'));
  fs.writeFileSync(cliEntryPath, Buffer.from("'use strict';\n"));
  fs.symlinkSync(actualRoot, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');

  const registry = createBuilderCheckRuntimeRegistry();
  assertRuntimeError(() => registry.register_runtime(registration({
    launcherPath: path.join(linkedRoot, path.basename(launcherPath)),
    cliEntryPath: path.join(linkedRoot, path.basename(cliEntryPath)),
  })));
});

test('rejects accessors and proxies without invoking hostile values', (t) => {
  const paths = fixture(t);
  const registry = createBuilderCheckRuntimeRegistry();
  let invoked = false;
  const hostile = {};
  Object.defineProperty(hostile, 'package_manager', {
    enumerable: true,
    get() {
      invoked = true;
      return 'npm';
    },
  });
  assertRuntimeError(() => registry.register_runtime(hostile));
  assert.equal(invoked, false);
  assertRuntimeError(() => registry.register_runtime(new Proxy(registration(paths), {})));
});

test('source is a main-only runtime identity registry without execution or IPC authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-check-runtime-identity.cjs'),
    'utf8',
  );
  assert.match(source, /TRUSTED_IDENTITIES = new WeakSet/u);
  assert.match(source, /PRIVATE_RUNTIME_PATHS = new WeakMap/u);
  assert.match(source, /main_runner_only/u);
  assert.doesNotMatch(
    source,
    /node:child_process|\bspawn\b|execFile|shell:\s*true|ipcMain|ipcRenderer|contextBridge|BrowserWindow|node:sqlite|DatabaseSync|fetch\s*\(|https?:\/\//iu,
  );
});
