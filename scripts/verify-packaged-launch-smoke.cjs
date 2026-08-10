'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { types: utilTypes } = require('node:util');
const { _electron: defaultElectron } = require('playwright-core');

const {
  PACKAGED_CANARY_PROJECT_ROOT_DIRECTORY,
  PACKAGED_CANARY_PROJECT_ROOT_PATH,
  PACKAGED_CANARY_SENTINEL,
  PACKAGED_CANARY_USER_DATA_PATH,
  PACKAGED_CANARY_USER_DATA_PREFIX,
  SELECTORS,
} = require('./verify-packaged-canary.cjs');

const RESULT_VERSION = 'builder-packaged-launch-smoke-result.v1';
const DEFAULT_EXECUTABLE = path.join(__dirname, '..', 'release', 'win-unpacked', 'ClawFabric Builder.exe');
const SMOKE_TIMEOUT_MS = 15_000;
const RUN_OPTION_KEYS = Object.freeze(['electron', 'env', 'executablePath', 'fs', 'os', 'userDataPath']);
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
const REQUIRED_SELECTORS = Object.freeze([
  SELECTORS.projectPage,
  SELECTORS.workspaceChip,
  SELECTORS.idea,
  SELECTORS.composerAddMenuButton,
  '[data-builder-rail-item="projects"]',
  '[data-builder-rail-item="settings"]',
]);
const ERROR_MESSAGES = Object.freeze({
  launch_smoke_input_invalid: 'Packaged launch smoke input is invalid.',
  launch_smoke_failed: 'Packaged launch smoke failed.',
  launch_smoke_cleanup_failed: 'Packaged launch smoke cleanup failed.',
});

class BuilderPackagedLaunchSmokeError extends Error {
  constructor(code = 'launch_smoke_failed') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code) ? code : 'launch_smoke_failed';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderPackagedLaunchSmokeError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code = 'launch_smoke_failed') {
  throw new BuilderPackagedLaunchSmokeError(code);
}

function fixedError(error, fallback = 'launch_smoke_failed') {
  if (error instanceof BuilderPackagedLaunchSmokeError) return error;
  return new BuilderPackagedLaunchSmokeError(fallback);
}

function isObjectProxy(value) {
  return value !== null && typeof value === 'object' && utilTypes.isProxy(value);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || isObjectProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactOptions(value) {
  if (!isPlainObject(value)) fail('launch_smoke_input_invalid');
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== 'string' || !RUN_OPTION_KEYS.includes(key))
  ) fail('launch_smoke_input_invalid');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      fail('launch_smoke_input_invalid');
    }
  }
  return descriptors;
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
  ) fail('launch_smoke_input_invalid');
  if (process.platform === 'win32' && (/^\\\\/u.test(value) || !/^[A-Za-z]:\\/u.test(value))) {
    fail('launch_smoke_input_invalid');
  }
  return value;
}

function sanitizeRunOptions(rawOptions) {
  const descriptors = exactOptions(rawOptions);
  const fsModule = Object.hasOwn(descriptors, 'fs') ? descriptors.fs.value : fs;
  const osModule = Object.hasOwn(descriptors, 'os') ? descriptors.os.value : os;
  const env = Object.hasOwn(descriptors, 'env') ? descriptors.env.value : process.env;
  const electron = Object.hasOwn(descriptors, 'electron') ? descriptors.electron.value : defaultElectron;
  const executablePath = Object.hasOwn(descriptors, 'executablePath')
    ? safeLocalAbsolutePath(descriptors.executablePath.value)
    : DEFAULT_EXECUTABLE;
  const userDataPath = Object.hasOwn(descriptors, 'userDataPath')
    ? safeLocalAbsolutePath(descriptors.userDataPath.value)
    : null;
  if (
    fsModule === null
    || typeof fsModule !== 'object'
    || isObjectProxy(fsModule)
    || osModule === null
    || typeof osModule !== 'object'
    || isObjectProxy(osModule)
    || env === null
    || typeof env !== 'object'
    || isObjectProxy(env)
    || electron === null
    || typeof electron !== 'object'
    || typeof electron.launch !== 'function'
    || isObjectProxy(electron)
  ) fail('launch_smoke_input_invalid');
  return Object.freeze({ electron, env, executablePath, fs: fsModule, os: osModule, userDataPath });
}

function samePath(left, right) {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function makeTempUserData(fsModule, osModule) {
  try {
    return fsModule.mkdtempSync(path.join(osModule.tmpdir(), PACKAGED_CANARY_USER_DATA_PREFIX));
  } catch {
    fail('launch_smoke_failed');
  }
}

function ensureGuardedUserDataPath(userDataPath, fsModule, osModule) {
  const resolved = safeLocalAbsolutePath(userDataPath);
  const tempRoot = path.resolve(osModule.tmpdir());
  if (
    !samePath(path.dirname(resolved), tempRoot)
    || !path.basename(resolved).startsWith(PACKAGED_CANARY_USER_DATA_PREFIX)
  ) fail('launch_smoke_input_invalid');
  try {
    const stat = fsModule.lstatSync(resolved);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('launch_smoke_input_invalid');
  } catch (error) {
    if (error instanceof BuilderPackagedLaunchSmokeError) throw error;
    fail('launch_smoke_input_invalid');
  }
  return resolved;
}

function createProjectRoot(userDataPath, fsModule) {
  const projectRoot = path.join(userDataPath, PACKAGED_CANARY_PROJECT_ROOT_DIRECTORY);
  try {
    fsModule.mkdirSync(projectRoot, { recursive: false });
  } catch (error) {
    if (error === null || error.code !== 'EEXIST') fail('launch_smoke_failed');
  }
  return projectRoot;
}

function sanitizeLaunchEnvironment(sourceEnv, userDataPath, projectRootPath) {
  if (sourceEnv === null || typeof sourceEnv !== 'object' || isObjectProxy(sourceEnv)) fail('launch_smoke_input_invalid');
  const output = {};
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(sourceEnv);
  } catch {
    fail('launch_smoke_input_invalid');
  }
  for (const key of ENV_ALLOWLIST) {
    const descriptor = descriptors[key];
    if (
      descriptor
      && descriptor.enumerable
      && Object.hasOwn(descriptor, 'value')
      && typeof descriptor.value === 'string'
    ) output[key] = descriptor.value;
  }
  output[PACKAGED_CANARY_SENTINEL] = '1';
  output[PACKAGED_CANARY_USER_DATA_PATH] = userDataPath;
  output[PACKAGED_CANARY_PROJECT_ROOT_PATH] = projectRootPath;
  return Object.freeze(output);
}

async function assertVisible(page, selector) {
  try {
    await page.locator(selector).waitFor({ state: 'visible', timeout: SMOKE_TIMEOUT_MS });
  } catch {
    fail('launch_smoke_failed');
  }
}

async function assertTextIncludes(page, selector, expected) {
  await assertVisible(page, selector);
  let text;
  try {
    text = await page.locator(selector).textContent();
  } catch {
    fail('launch_smoke_failed');
  }
  if (typeof text !== 'string' || !text.includes(expected)) fail('launch_smoke_failed');
}

async function assertBridgeShape(page) {
  let bridge;
  try {
    bridge = await page.evaluate(() => {
      const root = globalThis.clawfabricBuilder;
      return {
        bridgeVersion: root?.bridgeVersion ?? null,
        checkRun: typeof root?.checkRun?.readCurrentDraftAvailableChecks,
        codeGenerator: typeof root?.codeGenerator?.answer,
        projectWorkspace: typeof root?.projectWorkspace?.listCurrent,
        providerSettings: typeof root?.providerSettings?.status,
        taskStream: typeof root?.taskStream?.read,
        windowControls: typeof root?.windowControls?.readState,
      };
    });
  } catch {
    fail('launch_smoke_failed');
  }
  if (
    !isPlainObject(bridge)
    || typeof bridge.bridgeVersion !== 'string'
    || !/^builder-preload\.v\d+$/u.test(bridge.bridgeVersion)
    || bridge.checkRun !== 'function'
    || bridge.codeGenerator !== 'function'
    || bridge.projectWorkspace !== 'function'
    || bridge.providerSettings !== 'function'
    || bridge.taskStream !== 'function'
    || bridge.windowControls !== 'function'
  ) fail('launch_smoke_failed');
  return bridge.bridgeVersion;
}

async function assertBasicUi(page) {
  for (const selector of REQUIRED_SELECTORS) await assertVisible(page, selector);
  await assertTextIncludes(page, SELECTORS.workspaceChip, 'Choose project');
  await assertTextIncludes(page, '[data-builder-rail-item="projects"]', 'Projects');
  await assertTextIncludes(page, '[data-builder-rail-item="settings"]', 'Settings');
  return assertBridgeShape(page);
}

async function closeApp(app) {
  if (app === null) return;
  try {
    await app.close();
  } catch {
    fail('launch_smoke_cleanup_failed');
  }
}

function removeUserData(userDataPath, fsModule) {
  try {
    if (typeof fsModule.rmSync === 'function') {
      fsModule.rmSync(userDataPath, { recursive: true, force: true });
    }
  } catch {
    fail('launch_smoke_cleanup_failed');
  }
}

async function runPackagedLaunchSmoke(rawOptions = {}) {
  let app = null;
  let cleanupPath = null;
  let fsModule = fs;
  let primaryError = null;
  let result = null;
  try {
    const options = sanitizeRunOptions(rawOptions);
    fsModule = options.fs;
    if (!options.fs.existsSync(options.executablePath)) fail('launch_smoke_failed');
    const rawUserDataPath = options.userDataPath ?? makeTempUserData(options.fs, options.os);
    cleanupPath = rawUserDataPath;
    const userDataPath = ensureGuardedUserDataPath(rawUserDataPath, options.fs, options.os);
    const projectRootPath = createProjectRoot(userDataPath, options.fs);
    app = await options.electron.launch({
      args: [],
      executablePath: options.executablePath,
      env: sanitizeLaunchEnvironment(options.env, userDataPath, projectRootPath),
    });
    const page = await app.firstWindow();
    const bridgeVersion = await assertBasicUi(page);
    result = Object.freeze({
      result_version: RESULT_VERSION,
      bridge_version: bridgeVersion,
      executable_path: options.executablePath,
      isolated_user_data: true,
      provider_configured: false,
    });
  } catch (error) {
    primaryError = fixedError(error);
  }
  try {
    await closeApp(app);
  } catch (error) {
    if (primaryError === null) primaryError = fixedError(error, 'launch_smoke_cleanup_failed');
  }
  if (cleanupPath !== null) {
    try {
      removeUserData(cleanupPath, fsModule);
    } catch (error) {
      if (primaryError === null) primaryError = fixedError(error, 'launch_smoke_cleanup_failed');
    }
  }
  if (primaryError !== null) throw primaryError;
  if (result === null) throw new BuilderPackagedLaunchSmokeError('launch_smoke_failed');
  return result;
}

async function runCli({
  argv = process.argv.slice(2),
  run = runPackagedLaunchSmoke,
  stdout = process.stdout,
} = {}) {
  if (!Array.isArray(argv) || argv.length !== 0) fail('launch_smoke_input_invalid');
  const result = await run();
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

async function main() {
  await runCli();
}

module.exports = {
  BuilderPackagedLaunchSmokeError,
  RESULT_VERSION,
  REQUIRED_SELECTORS,
  runCli,
  runPackagedLaunchSmoke,
  sanitizeLaunchEnvironment,
};

if (require.main === module) {
  main().catch((error) => {
    const fixed = fixedError(error);
    process.stdout.write(`${JSON.stringify({
      ok: false,
      code: fixed.code,
      message: fixed.message,
    })}\n`);
    process.exitCode = 1;
  });
}
