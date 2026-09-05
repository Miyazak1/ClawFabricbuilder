'use strict';

const { types: utilTypes } = require('node:util');

const BUILDER_MAIN_STDIO_BOUNDARY_VERSION = 'builder-main-stdio-boundary.v1';
const BROKEN_STDIO_WRITE_CODES = Object.freeze([
  'EPIPE',
  'ECONNRESET',
  'ERR_STREAM_DESTROYED',
  'ERR_STREAM_WRITE_AFTER_END',
]);
const BROKEN_STDIO_WRITE_CODE_SET = new Set(BROKEN_STDIO_WRITE_CODES);

function isBuilderBrokenStdioWrite(error) {
  return error instanceof Error
    && typeof error.code === 'string'
    && BROKEN_STDIO_WRITE_CODE_SET.has(error.code);
}

function sanitizeBuilderMainStdioFailure(streamName, error) {
  return Object.freeze({
    diagnostic_version: BUILDER_MAIN_STDIO_BOUNDARY_VERSION,
    code: 'builder_main_stdio_write_closed',
    stream_name: streamName,
    cause_code: typeof error?.code === 'string' ? error.code : 'unknown',
    syscall: typeof error?.syscall === 'string' ? error.syscall : null,
  });
}

function trustedStream(value) {
  return value !== null
    && typeof value === 'object'
    && !utilTypes.isProxy(value)
    && typeof value.write === 'function'
    && typeof value.on === 'function'
    && typeof value.off === 'function';
}

function callbackFromWriteArgs(args) {
  const last = args.at(-1);
  return typeof last === 'function' && !utilTypes.isProxy(last) ? last : null;
}

function installOnStream(streamName, stream, onFailure) {
  if (!trustedStream(stream)) throw new Error('Invalid Builder main stdio stream.');
  const originalWrite = stream.write;
  let closedByBoundary = false;

  function report(error) {
    if (!isBuilderBrokenStdioWrite(error)) return false;
    if (!closedByBoundary) {
      closedByBoundary = true;
      try {
        onFailure(sanitizeBuilderMainStdioFailure(streamName, error));
      } catch {
        // Diagnostics must never turn a closed stdio pipe into a startup failure.
      }
    }
    return true;
  }

  const errorListener = (error) => {
    if (!report(error)) throw error;
  };

  stream.write = function writeWithBuilderMainStdioBoundary(...args) {
    if (closedByBoundary) {
      const callback = callbackFromWriteArgs(args);
      if (callback !== null) {
        queueMicrotask(() => {
          callback(Object.assign(new Error('Builder main stdio is closed.'), {
            code: 'builder_main_stdio_write_closed',
          }));
        });
      }
      return false;
    }
    try {
      return Reflect.apply(originalWrite, this, args);
    } catch (error) {
      if (report(error)) return false;
      throw error;
    }
  };
  stream.on('error', errorListener);

  return Object.freeze({
    dispose() {
      stream.off('error', errorListener);
      stream.write = originalWrite;
    },
    is_closed() {
      return closedByBoundary;
    },
  });
}

function installBuilderMainStdioBoundary({
  stdout = process.stdout,
  stderr = process.stderr,
  on_failure = () => {},
} = {}) {
  if (typeof on_failure !== 'function' || utilTypes.isProxy(on_failure)) {
    throw new Error('Invalid Builder main stdio boundary reporter.');
  }
  const stdoutBoundary = installOnStream('stdout', stdout, on_failure);
  const stderrBoundary = installOnStream('stderr', stderr, on_failure);
  return Object.freeze({
    boundary_version: BUILDER_MAIN_STDIO_BOUNDARY_VERSION,
    dispose() {
      stderrBoundary.dispose();
      stdoutBoundary.dispose();
    },
    diagnostics() {
      return Object.freeze({
        boundary_version: BUILDER_MAIN_STDIO_BOUNDARY_VERSION,
        stdout_closed: stdoutBoundary.is_closed(),
        stderr_closed: stderrBoundary.is_closed(),
      });
    },
  });
}

module.exports = Object.freeze({
  BROKEN_STDIO_WRITE_CODES,
  BUILDER_MAIN_STDIO_BOUNDARY_VERSION,
  installBuilderMainStdioBoundary,
  isBuilderBrokenStdioWrite,
  sanitizeBuilderMainStdioFailure,
});
