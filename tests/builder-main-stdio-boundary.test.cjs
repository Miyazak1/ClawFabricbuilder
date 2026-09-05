'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_MAIN_STDIO_BOUNDARY_VERSION,
  installBuilderMainStdioBoundary,
  isBuilderBrokenStdioWrite,
  sanitizeBuilderMainStdioFailure,
} = require('../electron/builder-main-stdio-boundary.cjs');

class FakeStream extends EventEmitter {
  constructor() {
    super();
    this.failWrite = null;
    this.writes = [];
  }

  write(...args) {
    this.writes.push(args);
    if (this.failWrite !== null) throw this.failWrite;
    const callback = typeof args.at(-1) === 'function' ? args.at(-1) : null;
    if (callback !== null) queueMicrotask(() => callback());
    return true;
  }
}

test('classifies and contains broken main stderr writes', async () => {
  const stdout = new FakeStream();
  const stderr = new FakeStream();
  const epipe = Object.assign(new Error('EPIPE: broken pipe, write'), {
    code: 'EPIPE',
    syscall: 'write',
  });
  const failures = [];
  const boundary = installBuilderMainStdioBoundary({
    stdout,
    stderr,
    on_failure(failure) { failures.push(failure); },
  });

  stderr.failWrite = epipe;
  assert.equal(isBuilderBrokenStdioWrite(epipe), true);
  assert.equal(stderr.write('will not crash'), false);
  assert.deepEqual(boundary.diagnostics(), {
    boundary_version: BUILDER_MAIN_STDIO_BOUNDARY_VERSION,
    stdout_closed: false,
    stderr_closed: true,
  });
  assert.deepEqual(failures, [{
    diagnostic_version: BUILDER_MAIN_STDIO_BOUNDARY_VERSION,
    code: 'builder_main_stdio_write_closed',
    stream_name: 'stderr',
    cause_code: 'EPIPE',
    syscall: 'write',
  }]);

  let callbackError = null;
  assert.equal(stderr.write('after close', 'utf8', (error) => { callbackError = error; }), false);
  await new Promise((resolve) => queueMicrotask(resolve));
  assert.equal(callbackError.code, 'builder_main_stdio_write_closed');
  boundary.dispose();
});

test('contains broken main stdout error events without hiding other stream errors', () => {
  const stdout = new FakeStream();
  const stderr = new FakeStream();
  const econnreset = Object.assign(new Error('socket reset'), {
    code: 'ECONNRESET',
    syscall: 'write',
  });
  const failures = [];
  const boundary = installBuilderMainStdioBoundary({
    stdout,
    stderr,
    on_failure(failure) { failures.push(failure); },
  });

  assert.doesNotThrow(() => stdout.emit('error', econnreset));
  assert.deepEqual(failures.map((failure) => failure.stream_name), ['stdout']);
  assert.throws(
    () => stderr.emit('error', Object.assign(new Error('unexpected stream failure'), { code: 'BUG' })),
    /unexpected stream failure/u,
  );
  boundary.dispose();
});

test('does not hide non-stdio write failures and exposes sanitized diagnostics only', () => {
  const stdout = new FakeStream();
  const stderr = new FakeStream();
  const bug = Object.assign(new Error('console formatter bug'), { code: 'BUG' });
  const boundary = installBuilderMainStdioBoundary({ stdout, stderr });

  stderr.failWrite = bug;
  assert.equal(isBuilderBrokenStdioWrite(bug), false);
  assert.throws(() => stderr.write('boom'), /console formatter bug/u);
  assert.deepEqual(
    sanitizeBuilderMainStdioFailure('stderr', Object.assign(new Error('secret path'), {
      code: 'EPIPE',
      syscall: 'write',
      path: 'C:\\secret',
    })),
    {
      diagnostic_version: BUILDER_MAIN_STDIO_BOUNDARY_VERSION,
      code: 'builder_main_stdio_write_closed',
      stream_name: 'stderr',
      cause_code: 'EPIPE',
      syscall: 'write',
    },
  );
  boundary.dispose();
});

test('main stdio boundary owns no Electron, IPC, conversation, provider, or filesystem write authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-main-stdio-boundary.cjs'),
    'utf8',
  );
  assert.doesNotMatch(source, /\b(?:electron|ipcMain|ipcRenderer|contextBridge|BrowserWindow)\b/u);
  assert.doesNotMatch(source, /\b(?:builder-conversation|builder-project-main-authority|provider|credential)\b/u);
  assert.doesNotMatch(source, /\b(?:writeFile|appendFile|unlink|rmSync|spawn|execFile|fetch)\b/u);
});
