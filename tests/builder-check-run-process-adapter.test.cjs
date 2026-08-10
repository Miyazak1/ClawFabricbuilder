'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderCheckRunProcessAdapter,
} = require('../electron/builder-check-run-process-adapter.cjs');

function child(pid = 123) {
  const value = new EventEmitter();
  value.pid = pid;
  value.stdout = new EventEmitter();
  value.stderr = new EventEmitter();
  value.killCalls = 0;
  value.kill = () => {
    value.killCalls += 1;
    return true;
  };
  return value;
}

function spawnOptions(cwd = path.resolve('project-check')) {
  return {
    cwd,
    env: { CI: '1', PATH: path.dirname(process.execPath) },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  };
}

test('spawns only the runner fixed shell-disabled process shape', () => {
  const calls = [];
  const spawned = child();
  const adapter = createBuilderCheckRunProcessAdapter({
    spawn_process(file, args, options) {
      calls.push({ file, args, options });
      return spawned;
    },
    platform: 'linux',
    windows_root: null,
  });
  const file = path.resolve(process.execPath);
  const worker = path.resolve('builder-packaged-check-script-worker.cjs');
  assert.equal(adapter.spawn_process(
    file,
    [worker, 'run-script', 'test', `sha256:${'a'.repeat(64)}`],
    spawnOptions(),
  ), spawned);
  assert.deepEqual(calls, [{
    file,
    args: [worker, 'run-script', 'test', `sha256:${'a'.repeat(64)}`],
    options: spawnOptions(),
  }]);
  assert.throws(() => adapter.spawn_process(file, ['test'], spawnOptions()), {
    code: 'builder_check_run_process_unavailable',
  });
  assert.throws(() => adapter.spawn_process(file, [worker, 'test'], {
    ...spawnOptions(),
    shell: true,
  }), { code: 'builder_check_run_process_unavailable' });
});

test('terminates only child identities created by the adapter', async () => {
  const spawned = child();
  const adapter = createBuilderCheckRunProcessAdapter({
    spawn_process() { return spawned; },
    platform: 'linux',
    windows_root: null,
  });
  adapter.spawn_process(
    path.resolve(process.execPath),
    [path.resolve('worker.cjs'), 'test'],
    spawnOptions(),
  );
  assert.equal(await adapter.terminate_process_tree({ child: spawned, reason: 'timed_out' }), true);
  assert.equal(spawned.killCalls, 1);
  assert.equal(await adapter.terminate_process_tree({ child: child(456), reason: 'timed_out' }), false);
  assert.equal(await adapter.terminate_process_tree({ child: spawned, reason: 'save' }), false);
});

test('uses fixed taskkill argv on Windows while retaining direct-child fallback', async () => {
  const calls = [];
  const spawned = child(321);
  const killer = new EventEmitter();
  const windowsRoot = path.parse(process.execPath).root.endsWith('\\')
    ? `${path.parse(process.execPath).root}Windows`
    : path.resolve('Windows');
  const adapter = createBuilderCheckRunProcessAdapter({
    spawn_process(file, args, options) {
      calls.push({ file, args, options });
      if (calls.length === 1) return spawned;
      queueMicrotask(() => killer.emit('close', 0));
      return killer;
    },
    platform: 'win32',
    windows_root: windowsRoot,
  });
  adapter.spawn_process(
    path.resolve(process.execPath),
    [path.resolve('worker.cjs'), 'test'],
    spawnOptions(),
  );
  assert.equal(await adapter.terminate_process_tree({ child: spawned, reason: 'cancelled' }), true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].file, path.join(windowsRoot, 'System32', 'taskkill.exe'));
  assert.deepEqual(calls[1].args, ['/pid', '321', '/t', '/f']);
  assert.deepEqual(calls[1].options, {
    shell: false,
    windowsHide: true,
    stdio: 'ignore',
  });
});

test('fails closed on malformed adapters, paths, options, proxies, and invalid children', () => {
  assert.throws(() => createBuilderCheckRunProcessAdapter({
    spawn_process() {},
    platform: 'win32',
    windows_root: null,
  }), { code: 'builder_check_run_process_unavailable' });
  const adapter = createBuilderCheckRunProcessAdapter({
    spawn_process() { return {}; },
    platform: 'linux',
    windows_root: null,
  });
  assert.throws(() => adapter.spawn_process(
    'relative.exe',
    [path.resolve('worker.cjs'), 'test'],
    spawnOptions(),
  ), { code: 'builder_check_run_process_unavailable' });
  assert.throws(() => adapter.spawn_process(
    path.resolve(process.execPath),
    [path.resolve('worker.cjs'), 'test'],
    new Proxy(spawnOptions(), {}),
  ), { code: 'builder_check_run_process_unavailable' });
});
