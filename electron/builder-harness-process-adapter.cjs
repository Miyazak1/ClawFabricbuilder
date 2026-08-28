'use strict';

const path = require('node:path');
const { types: utilTypes } = require('node:util');

const BUILDER_HARNESS_PROCESS_ADAPTER_VERSION = 'builder-harness-process-adapter.v1';
const CREATE_KEYS = Object.freeze(['spawn_process', 'platform', 'windows_root']);
const SPAWN_KEYS = Object.freeze(['executable', 'args', 'cwd', 'env']);
const TERMINATE_KEYS = Object.freeze(['child', 'reason']);
const STOP_REASONS = Object.freeze([
  'cancelled',
  'protocol_error',
  'shutdown',
  'spawn_failed',
  'timed_out',
]);

class BuilderHarnessProcessAdapterError extends Error {
  constructor() {
    super('The Harness runtime process is unavailable.');
    this.name = 'BuilderHarnessProcessAdapterError';
    this.code = 'builder_harness_process_unavailable';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderHarnessProcessAdapterError(); }

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length
    || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return descriptors;
}

function safeAbsolutePath(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 1_024
    || value.includes('\0')
    || !path.isAbsolute(value)
    || path.normalize(value) !== value
  ) fail();
  return value;
}

function safeArgs(value) {
  if (
    !Array.isArray(value)
    || utilTypes.isProxy(value)
    || value.length < 1
    || value.length > 3
  ) fail();
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== value.length + 1
    || !keys.includes('length')
    || keys.some((key) => typeof key === 'symbol')
  ) fail();
  return value.map((entry, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    return safeAbsolutePath(descriptor.value);
  });
}

function safeEnvironment(value) {
  if (!isPlainObject(value)) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(value);
  if (keys.length === 0 || keys.length > 64 || keys.some((key) => typeof key !== 'string')) fail();
  let totalBytes = 0;
  const environment = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (
      !descriptor
      || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
      || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/u.test(key)
      || typeof descriptor.value !== 'string'
      || descriptor.value.length > 32 * 1_024
      || descriptor.value.includes('\0')
    ) fail();
    totalBytes += Buffer.byteLength(key, 'utf8') + Buffer.byteLength(descriptor.value, 'utf8');
    if (totalBytes > 256 * 1_024) fail();
    environment[key] = descriptor.value;
  }
  return environment;
}

function trustedChild(value) {
  return value !== null
    && typeof value === 'object'
    && !utilTypes.isProxy(value)
    && typeof value.once === 'function'
    && typeof value.kill === 'function'
    && value.stdin !== null
    && typeof value.stdin === 'object'
    && typeof value.stdin.write === 'function'
    && typeof value.stdin.end === 'function'
    && value.stdout !== null
    && typeof value.stdout === 'object'
    && typeof value.stdout.on === 'function'
    && typeof value.stdout.off === 'function'
    && value.stderr !== null
    && typeof value.stderr === 'object'
    && typeof value.stderr.on === 'function'
    && typeof value.stderr.off === 'function';
}

function createBuilderHarnessProcessAdapter(rawOptions) {
  const options = exactObject(rawOptions, CREATE_KEYS);
  const rawSpawn = options.spawn_process.value;
  const platform = options.platform.value;
  const windowsRoot = options.windows_root.value;
  if (
    typeof rawSpawn !== 'function'
    || utilTypes.isProxy(rawSpawn)
    || !['win32', 'darwin', 'linux'].includes(platform)
    || (platform === 'win32' && windowsRoot === null)
    || (platform !== 'win32' && windowsRoot !== null)
  ) fail();
  const taskkillPath = platform === 'win32'
    ? path.join(safeAbsolutePath(windowsRoot), 'System32', 'taskkill.exe')
    : null;
  const children = new WeakSet();

  return Object.freeze({
    adapter_version: BUILDER_HARNESS_PROCESS_ADAPTER_VERSION,

    spawn_runtime(rawRequest) {
      const request = exactObject(rawRequest, SPAWN_KEYS);
      const executable = safeAbsolutePath(request.executable.value);
      const args = safeArgs(request.args.value);
      const spawnOptions = {
        cwd: safeAbsolutePath(request.cwd.value),
        env: safeEnvironment(request.env.value),
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      };
      let child;
      try {
        child = Reflect.apply(rawSpawn, undefined, [executable, args, spawnOptions]);
      } catch {
        fail();
      }
      if (!trustedChild(child)) fail();
      children.add(child);
      return child;
    },

    terminate_process_tree(rawRequest) {
      const request = exactObject(rawRequest, TERMINATE_KEYS);
      const child = request.child.value;
      if (
        !trustedChild(child)
        || !children.has(child)
        || !STOP_REASONS.includes(request.reason.value)
      ) return Promise.resolve(false);
      let direct = false;
      try { direct = child.kill() === true; } catch { direct = false; }
      if (platform !== 'win32' || !Number.isSafeInteger(child.pid) || child.pid < 1) {
        return Promise.resolve(direct);
      }
      return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        try {
          const killer = Reflect.apply(rawSpawn, undefined, [
            taskkillPath,
            ['/pid', String(child.pid), '/t', '/f'],
            { shell: false, windowsHide: true, stdio: 'ignore' },
          ]);
          if (killer === null || typeof killer !== 'object' || typeof killer.once !== 'function') {
            finish(direct);
            return;
          }
          killer.once('error', () => finish(direct));
          killer.once('close', (code) => finish(code === 0 || direct));
        } catch {
          finish(direct);
        }
      });
    },
  });
}

module.exports = Object.freeze({
  BUILDER_HARNESS_PROCESS_ADAPTER_VERSION,
  BuilderHarnessProcessAdapterError,
  createBuilderHarnessProcessAdapter,
});
