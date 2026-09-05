'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { _electron: defaultElectron } = require('playwright-core');

const {
  PACKAGED_CANARY_PROJECT_ROOT_DIRECTORY,
  PACKAGED_CANARY_PROJECT_ROOT_PATH,
  PACKAGED_CANARY_SENTINEL,
  PACKAGED_CANARY_USER_DATA_PATH,
  PACKAGED_CANARY_USER_DATA_PREFIX,
} = require('./verify-packaged-canary.cjs');

const RESULT_VERSION = 'builder-packaged-epipe-fault-canary.v1';
const MAIN_RESULT_VERSION = 'builder-packaged-epipe-fault-main-result.v1';
const MAIN_RESULT_FILE = 'builder-epipe-fault-canary-result.json';
const FAULT_SENTINEL = 'BUILDER_PACKAGED_EPIPE_FAULT_CANARY';
const DEFAULT_EXECUTABLE = path.join(__dirname, '..', 'release', 'win-unpacked', 'ClawFabric Builder.exe');
const DEFAULT_RESOURCES = path.join(__dirname, '..', 'release', 'win-unpacked', 'resources');
const RUN_OPTION_KEYS = Object.freeze(['electron', 'env', 'executablePath', 'fs', 'os', 'resourcesPath']);
const ENV_ALLOWLIST = Object.freeze([
  'SystemRoot',
  'WINDIR',
  'PATH',
  'ComSpec',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'LOCALAPPDATA',
]);

function fail(message) {
  throw new Error(`verify-packaged-epipe-fault-canary: ${message}`);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeLocalAbsolutePath(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 2_048
    || value.trim() !== value
    || value.includes('\0')
    || !path.isAbsolute(value)
    || path.normalize(value) !== value
    || path.resolve(value) !== value
  ) fail('invalid local path');
  if (process.platform === 'win32' && (/^\\\\/u.test(value) || !/^[A-Za-z]:\\/u.test(value))) {
    fail('invalid local path');
  }
  return value;
}

function sanitizeOptions(rawOptions) {
  if (!isPlainObject(rawOptions)) fail('invalid options');
  const keys = Reflect.ownKeys(rawOptions);
  if (keys.some((key) => typeof key !== 'string' || !RUN_OPTION_KEYS.includes(key))) {
    fail('invalid options');
  }
  const electron = Object.hasOwn(rawOptions, 'electron') ? rawOptions.electron : defaultElectron;
  const fsModule = Object.hasOwn(rawOptions, 'fs') ? rawOptions.fs : fs;
  const osModule = Object.hasOwn(rawOptions, 'os') ? rawOptions.os : os;
  const env = Object.hasOwn(rawOptions, 'env') ? rawOptions.env : process.env;
  const executablePath = Object.hasOwn(rawOptions, 'executablePath')
    ? safeLocalAbsolutePath(rawOptions.executablePath)
    : DEFAULT_EXECUTABLE;
  const resourcesPath = Object.hasOwn(rawOptions, 'resourcesPath')
    ? safeLocalAbsolutePath(rawOptions.resourcesPath)
    : DEFAULT_RESOURCES;
  if (
    electron === null
    || typeof electron !== 'object'
    || typeof electron.launch !== 'function'
    || fsModule === null
    || typeof fsModule !== 'object'
    || osModule === null
    || typeof osModule !== 'object'
    || env === null
    || typeof env !== 'object'
  ) fail('invalid options');
  return Object.freeze({ electron, env, executablePath, fs: fsModule, os: osModule, resourcesPath });
}

function sanitizeLaunchEnvironment(sourceEnv, userDataPath, projectRootPath) {
  const output = {};
  for (const key of ENV_ALLOWLIST) {
    const value = sourceEnv[key];
    if (typeof value === 'string') output[key] = value;
  }
  output[PACKAGED_CANARY_SENTINEL] = '1';
  output[PACKAGED_CANARY_USER_DATA_PATH] = userDataPath;
  output[PACKAGED_CANARY_PROJECT_ROOT_PATH] = projectRootPath;
  output[FAULT_SENTINEL] = '1';
  return Object.freeze(output);
}

function makeUserDataPath(fsModule, osModule) {
  try {
    return fsModule.mkdtempSync(path.join(osModule.tmpdir(), PACKAGED_CANARY_USER_DATA_PREFIX));
  } catch {
    fail('could not create userData');
  }
}

function removeUserData(fsModule, userDataPath) {
  try {
    if (typeof fsModule.rmSync === 'function') {
      fsModule.rmSync(userDataPath, { recursive: true, force: true });
    }
  } catch {
    fail('could not clean userData');
  }
}

async function runPackagedMainFault(rawOptions = {}) {
  const options = sanitizeOptions(rawOptions);
  if (!options.fs.existsSync(options.executablePath)) fail('missing packaged executable');
  const userDataPath = makeUserDataPath(options.fs, options.os);
  const projectRootPath = path.join(userDataPath, PACKAGED_CANARY_PROJECT_ROOT_DIRECTORY);
  options.fs.mkdirSync(projectRootPath);
  const resultPath = path.join(userDataPath, MAIN_RESULT_FILE);
  let app = null;
  let primaryError = null;
  let exitCode = null;
  let result = null;
  try {
    app = await options.electron.launch({
      args: [],
      executablePath: options.executablePath,
      env: sanitizeLaunchEnvironment(options.env, userDataPath, projectRootPath),
    });
    const child = typeof app.process === 'function' ? app.process() : null;
    if (child !== null && typeof child.once === 'function') {
      child.once('exit', (code) => { exitCode = code; });
    }
    if (typeof app.firstWindow === 'function') await app.firstWindow();
    if (typeof app.waitForEvent === 'function') {
      await app.waitForEvent('close', { timeout: 15_000 });
    } else if (typeof app.close === 'function') {
      await app.close();
    }
    const main = JSON.parse(options.fs.readFileSync(resultPath, 'utf8'));
    assert.deepEqual(main, {
      result_version: MAIN_RESULT_VERSION,
      main_stdio_boundary_version: 'builder-main-stdio-boundary.v1',
      injected_stream: 'stderr',
      epipe_error_event_contained: true,
      post_close_write_returned_false: true,
      post_close_callback_code: 'builder_main_stdio_write_closed',
      uncaught_exception_observed: false,
      uncaught_exception_count: 0,
    });
    result = Object.freeze({
      main_result_version: main.result_version,
      main_stdio_boundary_version: main.main_stdio_boundary_version,
      main_epipe_contained: true,
      main_uncaught_exception_observed: false,
      main_exit_code: exitCode,
    });
  } catch (error) {
    primaryError = error;
  }
  try {
    if (app !== null && typeof app.close === 'function') await app.close();
  } catch {
    // Preserve the primary fault.
  }
  removeUserData(options.fs, userDataPath);
  if (primaryError !== null) throw primaryError;
  if (result !== null) return result;
  throw new Error('main fault canary did not complete');
}

async function runPackagedSidecarFault(rawOptions = {}) {
  const options = sanitizeOptions(rawOptions);
  const adapterPath = path.join(
    options.resourcesPath,
    'app.asar.unpacked',
    'electron',
    'harness',
    'builder-session-resume-server.mjs',
  );
  if (!options.fs.existsSync(adapterPath)) fail('missing packaged sidecar adapter');
  const {
    installBuilderJsonRpcTransportWriteBoundary,
    isBuilderBrokenTransportWrite,
  } = await import(pathToFileURL(adapterPath).href);
  const listeners = new Map();
  const reports = [];
  let closed = 0;
  const epipe = Object.assign(new Error('EPIPE: broken pipe, write'), {
    code: 'EPIPE',
    syscall: 'write',
  });
  const output = {
    write() { throw epipe; },
    on(event, listener) { listeners.set(event, listener); },
    off(event, listener) {
      if (listeners.get(event) === listener) listeners.delete(event);
    },
  };
  const transport = installBuilderJsonRpcTransportWriteBoundary({
    output,
    notify(method, params) { this.write({ jsonrpc: '2.0', method, params }); },
    writeError(id, code, message) { this.write({ jsonrpc: '2.0', id, error: { code, message } }); },
    async flush() { throw epipe; },
    close() { closed += 1; },
  }, {
    onTransportError(report) { reports.push(report); },
  });
  assert.equal(isBuilderBrokenTransportWrite(epipe), true);
  assert.doesNotThrow(() => transport.notify('session.status', { sessionId: 's', status: 'idle' }));
  await assert.doesNotReject(() => transport.flush());
  assert.equal(closed, 1);
  assert.deepEqual(reports, [{
    code: 'builder_harness_jsonrpc_transport_closed',
    cause_code: 'EPIPE',
    syscall: 'write',
  }]);

  const frames = [];
  const writable = installBuilderJsonRpcTransportWriteBoundary({
    output: {
      write(frame) { frames.push(JSON.parse(frame.trim())); return true; },
      on() {},
      off() {},
    },
    writeError(id, code, message) { this.write({ jsonrpc: '2.0', id, error: { code, message } }); },
    async flush() {},
    close() {},
  });
  writable.writeError('request-1', -32603, 'business failure');
  assert.deepEqual(frames, [{
    jsonrpc: '2.0',
    id: 'request-1',
    error: { code: -32603, message: 'business failure' },
  }]);
  return Object.freeze({
    sidecar_adapter_source: 'packaged_app_asar_unpacked',
    sidecar_epipe_contained: true,
    sidecar_business_error_frame_preserved: true,
  });
}

async function runPackagedEpipeFaultCanary(rawOptions = {}) {
  const options = sanitizeOptions(rawOptions);
  const [main, sidecar] = await Promise.all([
    runPackagedMainFault(options),
    runPackagedSidecarFault(options),
  ]);
  return Object.freeze({
    result_version: RESULT_VERSION,
    executable_path: options.executablePath,
    ...main,
    ...sidecar,
    root_conversation_compatibility_added: false,
  });
}

async function runCli({ argv = process.argv.slice(2), run = runPackagedEpipeFaultCanary, stdout = process.stdout } = {}) {
  if (!Array.isArray(argv) || argv.length !== 0) fail('unsupported arguments');
  const result = await run();
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

module.exports = Object.freeze({
  FAULT_SENTINEL,
  MAIN_RESULT_FILE,
  MAIN_RESULT_VERSION,
  RESULT_VERSION,
  runCli,
  runPackagedEpipeFaultCanary,
  runPackagedMainFault,
  runPackagedSidecarFault,
  sanitizeLaunchEnvironment,
});

if (require.main === module) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : 'Packaged EPIPE fault canary failed.'}\n`);
    process.exitCode = 1;
  });
}
