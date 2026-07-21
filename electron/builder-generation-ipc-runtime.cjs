'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { types: utilTypes } = require('node:util');

const {
  AVAILABILITY_CHANNEL,
  CANCEL_CHANNEL,
  GENERATE_CHANNEL,
  createBuilderGenerationIpcAdapter,
} = require('./builder-generation-ipc-adapter.cjs');
const {
  createBuilderGenerationMainService,
} = require('./builder-generation-main-service.cjs');
const {
  sanitizeBuilderGenerationRequest,
} = require('./builder-generation-kernel.cjs');
const {
  createBuilderProjectRevisionRepository,
} = require('./builder-project-revision-repository.cjs');
const {
  createBuilderProviderConfigRepository,
} = require('./builder-provider-config-repository.cjs');

const BUILDER_GENERATION_IPC_RUNTIME_VERSION = 'builder-generation-ipc-runtime.v1';
const PROJECT_REPOSITORY_DIRECTORY = 'builder-project-revisions-v1';
const OPTION_KEYS = Object.freeze(['ipcMain', 'mainWindowRef', 'userDataPath']);
const ERROR_MESSAGE = 'AI project generation is unavailable.';

class BuilderGenerationIpcRuntimeError extends Error {
  constructor() {
    super(ERROR_MESSAGE);
    this.name = 'BuilderGenerationIpcRuntimeError';
    this.code = 'builder_generation_ipc_runtime_unavailable';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderGenerationIpcRuntimeError();
}

function isPlainObject(value) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || utilTypes.isProxy(value)
  ) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function stableMethod(value, key) {
  let cursor = value;
  while (cursor !== null) {
    if (utilTypes.isProxy(cursor)) fail();
    const descriptor = Object.getOwnPropertyDescriptor(cursor, key);
    if (descriptor) {
      if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') fail();
      return descriptor.value;
    }
    cursor = Object.getPrototypeOf(cursor);
  }
  fail();
}

function safeOptions(value) {
  try {
    if (!isPlainObject(value)) fail();
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== OPTION_KEYS.length
      || keys.some((key) => typeof key !== 'string' || !OPTION_KEYS.includes(key))
    ) fail();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of OPTION_KEYS) {
      const descriptor = descriptors[key];
      if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    }
    const ipcMain = descriptors.ipcMain.value;
    const mainWindowRef = descriptors.mainWindowRef.value;
    const userDataPath = descriptors.userDataPath.value;
    if (
      ipcMain === null
      || typeof ipcMain !== 'object'
      || utilTypes.isProxy(ipcMain)
      || typeof mainWindowRef !== 'function'
      || typeof userDataPath !== 'string'
      || userDataPath.length === 0
      || userDataPath.length > 1_024
      || userDataPath.trim() !== userDataPath
      || userDataPath.includes('\0')
      || !path.isAbsolute(userDataPath)
      || path.normalize(userDataPath) !== userDataPath
    ) fail();
    return Object.freeze({
      ipcMain,
      handle: stableMethod(ipcMain, 'handle'),
      removeHandler: stableMethod(ipcMain, 'removeHandler'),
      mainWindowRef,
      userDataPath,
    });
  } catch {
    fail();
  }
}

function createBuilderGenerationIpcRuntime(rawOptions) {
  const options = safeOptions(rawOptions);
  let providerConfigRepository = null;
  let service;
  let adapter;
  let activeRequestIds = () => Object.freeze([]);
  try {
    const projectRoot = path.join(options.userDataPath, PROJECT_REPOSITORY_DIRECTORY);
    fs.mkdirSync(projectRoot, { recursive: true, mode: 0o700 });
    const projectRevisionRepository = createBuilderProjectRevisionRepository(projectRoot);
    const lazyProviderConfigRepository = Object.freeze({
      bind_current_authority() {
        if (providerConfigRepository === null) {
          providerConfigRepository = createBuilderProviderConfigRepository(options.userDataPath);
        }
        return providerConfigRepository.bind_current_authority();
      },
    });
    service = createBuilderGenerationMainService({
      providerConfigRepository: lazyProviderConfigRepository,
      projectRevisionRepository,
    });
    const activeRequests = new Map();

    function trackedGenerate(rawRequest) {
      let request;
      try {
        request = sanitizeBuilderGenerationRequest(rawRequest);
      } catch {
        return service.generate(rawRequest);
      }
      const requestId = request.request_digest;
      activeRequests.set(requestId, (activeRequests.get(requestId) ?? 0) + 1);
      let operation;
      try {
        operation = Promise.resolve(service.generate(request));
      } catch (error) {
        const remaining = (activeRequests.get(requestId) ?? 1) - 1;
        if (remaining === 0) activeRequests.delete(requestId);
        else activeRequests.set(requestId, remaining);
        throw error;
      }
      return operation.finally(() => {
        const remaining = (activeRequests.get(requestId) ?? 1) - 1;
        if (remaining === 0) activeRequests.delete(requestId);
        else activeRequests.set(requestId, remaining);
      });
    }

    adapter = createBuilderGenerationIpcAdapter({
      generate: trackedGenerate,
      cancel: service.cancel,
      availability: service.availability,
      mainWindowRef: options.mainWindowRef,
    });
    activeRequestIds = () => Object.freeze([...activeRequests.keys()]);
  } catch {
    fail();
  }

  const handlers = Object.freeze([
    Object.freeze({ channel: GENERATE_CHANNEL, invoke: adapter.channels.generate.invoke }),
    Object.freeze({ channel: CANCEL_CHANNEL, invoke: adapter.channels.cancel.invoke }),
    Object.freeze({ channel: AVAILABILITY_CHANNEL, invoke: adapter.channels.availability.invoke }),
  ]);
  const installed = [];
  let state = 'idle';

  function removeInstalledHandlers() {
    let failed = false;
    for (const entry of [...installed].reverse()) {
      try {
        Reflect.apply(options.removeHandler, options.ipcMain, [entry.channel]);
        installed.splice(installed.indexOf(entry), 1);
      } catch {
        failed = true;
      }
    }
    return failed === false;
  }

  function cancelActiveRequests() {
    let failed = false;
    for (const requestId of activeRequestIds()) {
      try {
        Reflect.apply(service.cancel, undefined, [{ request_id: requestId }]);
      } catch {
        failed = true;
      }
    }
    return failed === false;
  }

  return Object.freeze({
    runtime_version: BUILDER_GENERATION_IPC_RUNTIME_VERSION,
    channels: Object.freeze(handlers.map(({ channel }) => channel)),
    register() {
      if (state === 'registered') return false;
      if (state !== 'idle') fail();
      try {
        for (const entry of handlers) {
          Reflect.apply(options.handle, options.ipcMain, [entry.channel, entry.invoke]);
          installed.push(entry);
        }
        state = 'registered';
        return true;
      } catch {
        state = removeInstalledHandlers() ? 'idle' : 'cleanup_required';
        fail();
      }
    },
    dispose() {
      if (state === 'disposed') return false;
      if (state === 'idle') {
        state = 'disposed';
        return false;
      }
      const cancelled = cancelActiveRequests();
      const removed = removeInstalledHandlers();
      if (!cancelled || !removed) {
        state = 'cleanup_required';
        fail();
      }
      state = 'disposed';
      return true;
    },
  });
}

module.exports = Object.freeze({
  BUILDER_GENERATION_IPC_RUNTIME_VERSION,
  PROJECT_REPOSITORY_DIRECTORY,
  BuilderGenerationIpcRuntimeError,
  createBuilderGenerationIpcRuntime,
});
