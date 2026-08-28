'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_RUNTIME_TOOLCHAIN_PROBE_SERVICE_VERSION,
  BUILDER_RUNTIME_TOOLCHAIN_PROBE_VERSION,
  BuilderRuntimeToolchainProbeError,
  createBuilderRuntimeToolchainProbe,
  sanitizeBuilderRuntimeToolchainProbe,
} = require('../electron/builder-runtime-toolchain-probe.cjs');

function childProcess() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 42;
  return child;
}

function harness(overrides = {}) {
  let now = 100;
  let nextTimerId = 1;
  const timers = new Map();
  const spawns = [];
  const terminations = [];
  const service = createBuilderRuntimeToolchainProbe({
    spawn_process(file, args, options) {
      if (overrides.spawnError) {
        const error = new Error('secret path C:\\Users\\Ada\\npm.cmd');
        error.code = overrides.spawnError;
        throw error;
      }
      const child = childProcess();
      spawns.push({ file, args, options, child });
      return child;
    },
    terminate_process_tree(input) {
      terminations.push(input);
      return true;
    },
    clock: {
      now_ms: () => now,
      set_timeout(callback, delayMs) {
        const id = nextTimerId;
        nextTimerId += 1;
        timers.set(id, { callback, delayMs });
        return id;
      },
      clear_timeout(id) {
        timers.delete(id);
      },
    },
  });
  return {
    service,
    spawns,
    terminations,
    setNow(value) { now = value; },
    fireTimer(delayMs) {
      const entry = [...timers.entries()].find(([, timer]) => timer.delayMs === delayMs);
      assert.ok(entry, `missing timer for ${delayMs}ms`);
      timers.delete(entry[0]);
      entry[1].callback();
    },
  };
}

function nextTurn() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function assertProbeError(fn, forbidden = []) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof BuilderRuntimeToolchainProbeError);
    assert.equal(error.code, 'builder_runtime_toolchain_probe_invalid');
    assert.equal(error.message, 'Builder runtime toolchain probe could not be verified.');
    const serialized = JSON.stringify({
      name: error.name,
      code: error.code,
      message: error.message,
      stack: error.stack,
    });
    for (const marker of forbidden) assert.doesNotMatch(serialized, new RegExp(marker, 'iu'));
    assert.doesNotMatch(serialized, /Users|PATH|TOKEN|npm\.cmd/iu);
    return true;
  });
}

test('probes npm with bounded node and package-manager version facts', async () => {
  const h = harness();
  const pending = h.service.probe_package_manager({ package_manager: 'npm' });

  assert.equal(h.service.service_version, BUILDER_RUNTIME_TOOLCHAIN_PROBE_SERVICE_VERSION);
  assert.equal(h.spawns.length, 1);
  assert.equal(h.spawns[0].file, 'node');
  assert.deepEqual(h.spawns[0].args, ['--version']);
  assert.equal(h.spawns[0].options.shell, false);
  assert.equal(h.spawns[0].options.stdio[0], 'ignore');
  h.spawns[0].child.stdout.emit('data', Buffer.from('v22.22.3\n'));
  h.spawns[0].child.emit('close', 0, null);

  await nextTurn();
  assert.equal(h.spawns.length, 2);
  assert.equal(h.spawns[1].file, 'npm');
  assert.deepEqual(h.spawns[1].args, ['--version']);
  h.spawns[1].child.stdout.emit('data', Buffer.from('10.9.3\n'));
  h.spawns[1].child.emit('close', 0, null);

  const result = await pending;
  assert.equal(result.probe_version, BUILDER_RUNTIME_TOOLCHAIN_PROBE_VERSION);
  assert.equal(result.package_manager, 'npm');
  assert.equal(result.node_state, 'visible');
  assert.equal(result.node_version, 'v22.22.3');
  assert.equal(result.package_manager_state, 'visible');
  assert.equal(result.package_manager_version, '10.9.3');
  assert.equal(result.authority.path_disclosure, 'not_serialized');
  assert.equal(result.authority.install_authority, 'not_granted');
  assert.equal(result.policy.raw_output_serialization, false);
  assert.equal(Object.hasOwn(result, 'stdout'), false);
  assert.equal(Object.hasOwn(result, 'stderr'), false);
  assert.deepEqual(sanitizeBuilderRuntimeToolchainProbe(result), result);
});

test('does not spawn anything for source-only package manager none', async () => {
  const h = harness();
  const result = await h.service.probe_package_manager({ package_manager: 'none' });

  assert.equal(h.spawns.length, 0);
  assert.equal(result.node_state, 'not_checked');
  assert.equal(result.package_manager_state, 'not_checked');
  assert.equal(result.node_failure, 'not_required');
  assert.equal(result.package_manager_failure, 'not_required');
});

test('treats missing spawn as a redacted missing toolchain result', async () => {
  const h = harness({ spawnError: 'ENOENT' });
  const result = await h.service.probe_package_manager({ package_manager: 'npm' });

  assert.equal(result.node_state, 'missing');
  assert.equal(result.node_failure, 'spawn_failed');
  assert.equal(result.node_version, null);
  assert.equal(result.package_manager_state, 'missing');
  assert.equal(result.package_manager_failure, 'spawn_failed');
  assert.doesNotMatch(JSON.stringify(result), /Users|npm\.cmd/iu);
});

test('bounds output and records unreadable versions without raw output', async () => {
  const h = harness();
  const pending = h.service.probe_package_manager({ package_manager: 'bun' });

  assert.equal(h.spawns.length, 1);
  assert.equal(h.spawns[0].file, 'bun');
  h.spawns[0].child.stderr.emit('data', Buffer.alloc(2_048, 'x'));
  h.spawns[0].child.emit('close', 0, null);

  const result = await pending;
  assert.equal(result.node_state, 'not_checked');
  assert.equal(result.package_manager_state, 'unavailable');
  assert.equal(result.package_manager_failure, 'version_unreadable');
  assert.doesNotMatch(JSON.stringify(result), /xxxxxxxx/u);
});

test('terminates timed-out probes and reports a fixed unavailable state', async () => {
  const h = harness();
  const pending = h.service.probe_package_manager({ package_manager: 'bun' });
  h.fireTimer(5_000);

  const result = await pending;
  assert.equal(result.package_manager_state, 'unavailable');
  assert.equal(result.package_manager_failure, 'timed_out');
  assert.equal(h.terminations.length, 1);
  assert.equal(h.terminations[0].reason, 'toolchain_probe_timed_out');
});

test('rejects exact-object drift, probe digest drift, and unsupported managers', async () => {
  const h = harness();
  await assert.rejects(
    h.service.probe_package_manager({ package_manager: 'python' }),
    BuilderRuntimeToolchainProbeError,
  );

  const pending = h.service.probe_package_manager({ package_manager: 'bun' });
  h.spawns[0].child.stdout.emit('data', Buffer.from('1.2.20\n'));
  h.spawns[0].child.emit('close', 0, null);
  const result = await pending;

  assertProbeError(() => sanitizeBuilderRuntimeToolchainProbe({
    ...result,
    package_manager_version: '1.2.21',
  }));
  assertProbeError(() => createBuilderRuntimeToolchainProbe(new Proxy({
    spawn_process() {},
    terminate_process_tree() {},
    clock: { now_ms() {}, set_timeout() {}, clear_timeout() {} },
  }, {})));
});

test('probe source has no renderer, persistence, network, install, or raw-path authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-runtime-toolchain-probe.cjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /require\(['"]node:child_process['"]\)|execFile|shell:\s*true/iu);
  assert.doesNotMatch(source, /ipcMain|ipcRenderer|contextBridge|BrowserWindow|node:sqlite|DatabaseSync|git\s+commit|saveVersion/iu);
  assert.doesNotMatch(source, /npm\s+install|pnpm\s+install|yarn\s+install|bun\s+install|fetch\s*\(|https?:\/\//iu);
  assert.match(source, /raw_output_serialization: false/u);
  assert.match(source, /install_authority: 'not_granted'/u);
  assert.match(source, /path_disclosure: 'not_serialized'/u);
});
