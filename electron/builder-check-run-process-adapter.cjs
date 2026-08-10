'use strict';

const path = require('node:path');
const { types: utilTypes } = require('node:util');

const BUILDER_CHECK_RUN_PROCESS_ADAPTER_VERSION = 'builder-check-run-process-adapter.v1';
const CREATE_KEYS = Object.freeze(['spawn_process', 'platform', 'windows_root']);
const SPAWN_OPTION_KEYS = Object.freeze(['cwd', 'env', 'shell', 'stdio', 'windowsHide']);
const TERMINATE_KEYS = Object.freeze(['child', 'reason']);
const STOP_REASONS = Object.freeze([
  'cancelled',
  'output_exceeded',
  'spawn_failed',
  'timed_out',
]);

class BuilderCheckRunProcessAdapterError extends Error {
  constructor() {
    super('The project check process is unavailable.');
    this.name = 'BuilderCheckRunProcessAdapterError';
    this.code = 'builder_check_run_process_unavailable';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderCheckRunProcessAdapterError(); }

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
  if (ownKeys.length !== keys.length || ownKeys.some(
    (key) => typeof key !== 'string' || !keys.includes(key),
  )) fail();
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
    || value.length < 2
    || value.length > 8
    || value.some((entry) => (
      typeof entry !== 'string'
      || entry.length === 0
      || entry.length > 1_024
      || entry.includes('\0')
    ))
  ) fail();
  return [...value];
}

function safeEnvironment(value) {
  if (!isPlainObject(value)) fail();
  const entries = Object.entries(value);
  if (
    entries.length === 0
    || entries.length > 32
    || entries.some(([key, entry]) => (
      !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/u.test(key)
      || typeof entry !== 'string'
      || entry.length > 2_048
      || entry.includes('\0')
    ))
  ) fail();
  return Object.fromEntries(entries);
}

function safeSpawnOptions(rawValue) {
  const value = exactObject(rawValue, SPAWN_OPTION_KEYS);
  if (
    value.shell.value !== false
    || value.windowsHide.value !== true
    || !Array.isArray(value.stdio.value)
    || value.stdio.value.length !== 3
    || value.stdio.value[0] !== 'ignore'
    || value.stdio.value[1] !== 'pipe'
    || value.stdio.value[2] !== 'pipe'
  ) fail();
  return {
    cwd: safeAbsolutePath(value.cwd.value),
    env: safeEnvironment(value.env.value),
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  };
}

function trustedChild(value) {
  return value !== null
    && typeof value === 'object'
    && !utilTypes.isProxy(value)
    && typeof value.once === 'function'
    && typeof value.kill === 'function'
    && value.stdout !== null
    && typeof value.stdout === 'object'
    && typeof value.stdout.on === 'function'
    && value.stderr !== null
    && typeof value.stderr === 'object'
    && typeof value.stderr.on === 'function';
}

function createBuilderCheckRunProcessAdapter(rawOptions) {
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
    adapter_version: BUILDER_CHECK_RUN_PROCESS_ADAPTER_VERSION,

    spawn_process(rawFile, rawArgs, rawSpawnOptions) {
      const file = safeAbsolutePath(rawFile);
      const args = safeArgs(rawArgs);
      const spawnOptions = safeSpawnOptions(rawSpawnOptions);
      let child;
      try {
        child = rawSpawn(file, args, spawnOptions);
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
        let killer;
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        try {
          killer = rawSpawn(taskkillPath, ['/pid', String(child.pid), '/t', '/f'], {
            shell: false,
            windowsHide: true,
            stdio: 'ignore',
          });
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
  BUILDER_CHECK_RUN_PROCESS_ADAPTER_VERSION,
  BuilderCheckRunProcessAdapterError,
  createBuilderCheckRunProcessAdapter,
});
