'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const {
  createBuilderHarnessProcessAdapter,
} = require('../electron/builder-harness-process-adapter.cjs');

function child(pid = 123) {
  const value = new EventEmitter();
  value.pid = pid;
  value.stdin = new PassThrough();
  value.stdout = new PassThrough();
  value.stderr = new PassThrough();
  value.killCalls = 0;
  value.kill = () => {
    value.killCalls += 1;
    return true;
  };
  return value;
}

function request() {
  return {
    executable: path.resolve(process.execPath),
    args: [
      path.resolve('harness', 'lib', 'bin.js'),
      path.resolve('harness', 'cordis.yml'),
    ],
    cwd: path.resolve('runtime-workspace'),
    env: {
      PATH: path.dirname(process.execPath),
      DSH_CWD: path.resolve('runtime-workspace'),
      DSH_SESSION_ROOT: path.resolve('runtime-sessions'),
    },
  };
}

test('spawns a shell-disabled hidden runtime with all three protocol pipes', () => {
  const calls = [];
  const spawned = child();
  const adapter = createBuilderHarnessProcessAdapter({
    spawn_process(file, args, options) {
      calls.push({ file, args, options });
      return spawned;
    },
    platform: 'linux',
    windows_root: null,
  });

  assert.equal(adapter.spawn_runtime(request()), spawned);
  assert.deepEqual(calls, [{
    file: request().executable,
    args: request().args,
    options: {
      cwd: request().cwd,
      env: request().env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    },
  }]);
});

test('rejects relative paths, shell-like arguments, unsafe environments, and invalid children', () => {
  const adapter = createBuilderHarnessProcessAdapter({
    spawn_process() { return {}; },
    platform: 'linux',
    windows_root: null,
  });
  assert.throws(
    () => adapter.spawn_runtime({ ...request(), executable: 'node' }),
    { code: 'builder_harness_process_unavailable' },
  );
  assert.throws(
    () => adapter.spawn_runtime({ ...request(), args: ['--eval', 'malicious()'] }),
    { code: 'builder_harness_process_unavailable' },
  );
  assert.throws(
    () => adapter.spawn_runtime({ ...request(), env: { 'INVALID-KEY': 'value' } }),
    { code: 'builder_harness_process_unavailable' },
  );
  assert.throws(
    () => adapter.spawn_runtime(request()),
    { code: 'builder_harness_process_unavailable' },
  );
});

test('terminates only runtime children created by this adapter', async () => {
  const spawned = child();
  const adapter = createBuilderHarnessProcessAdapter({
    spawn_process() { return spawned; },
    platform: 'linux',
    windows_root: null,
  });
  adapter.spawn_runtime(request());
  assert.equal(
    await adapter.terminate_process_tree({ child: spawned, reason: 'protocol_error' }),
    true,
  );
  assert.equal(spawned.killCalls, 1);
  assert.equal(
    await adapter.terminate_process_tree({ child: child(456), reason: 'protocol_error' }),
    false,
  );
  assert.equal(
    await adapter.terminate_process_tree({ child: spawned, reason: 'save' }),
    false,
  );
});

test('uses fixed taskkill argv on Windows after direct termination', async () => {
  const calls = [];
  const spawned = child(321);
  const killer = new EventEmitter();
  const root = path.parse(process.execPath).root;
  const windowsRoot = path.join(root, 'Windows');
  const adapter = createBuilderHarnessProcessAdapter({
    spawn_process(file, args, options) {
      calls.push({ file, args, options });
      if (calls.length === 1) return spawned;
      queueMicrotask(() => killer.emit('close', 0));
      return killer;
    },
    platform: 'win32',
    windows_root: windowsRoot,
  });
  adapter.spawn_runtime(request());
  assert.equal(
    await adapter.terminate_process_tree({ child: spawned, reason: 'shutdown' }),
    true,
  );
  assert.equal(calls[1].file, path.join(windowsRoot, 'System32', 'taskkill.exe'));
  assert.deepEqual(calls[1].args, ['/pid', '321', '/t', '/f']);
  assert.deepEqual(calls[1].options, {
    shell: false,
    windowsHide: true,
    stdio: 'ignore',
  });
});
