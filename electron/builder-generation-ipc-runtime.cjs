'use strict';

const { randomUUID } = require('node:crypto');
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
  createBuilderConversationMainService,
} = require('./builder-conversation-main-service.cjs');
const {
  createBuilderProjectSaveAuthority,
} = require('./builder-project-save-authority.cjs');
const {
  OPEN_PROJECT_CHANNEL,
  SAVE_DRAFT_CHANNEL,
  LOAD_CURRENT_CHANNEL,
  LIST_CURRENT_CHANNEL,
  createBuilderProjectWorkspaceIpcAdapter,
} = require('./builder-project-workspace-ipc-adapter.cjs');
const {
  createBuilderOpenAICompatibleTransport,
} = require('./builder-openai-compatible-transport.cjs');
const {
  BuilderGenerationKernelError,
  createBuilderGenerationRequest,
} = require('./builder-generation-kernel.cjs');
const {
  GIT_RUNTIME_DIRECTORY,
  METADATA_DATABASE,
  METADATA_DIRECTORY,
  PROJECT_REPOSITORY_DIRECTORY,
  createBuilderProjectMainAuthority,
} = require('./builder-project-main-authority.cjs');
const {
  createBuilderProviderConfigRepository,
} = require('./builder-provider-config-repository.cjs');

const BUILDER_GENERATION_IPC_RUNTIME_VERSION = 'builder-generation-ipc-runtime.v2';
const OPTION_KEYS = Object.freeze(['fetchImpl', 'ipcMain', 'mainWindowRef', 'userDataPath']);
const ERROR_MESSAGE = 'AI project generation is unavailable.';
const PROJECT_ID_PATTERN = /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

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

function exactDataValue(value, keys, key) {
  if (!isPlainObject(value)) fail();
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length
    || ownKeys.some((ownKey) => typeof ownKey !== 'string' || !keys.includes(ownKey))
  ) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const expectedKey of keys) {
    const descriptor = descriptors[expectedKey];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return descriptors[key].value;
}

function publicInstruction(rawRequest) {
  try {
    if (!isPlainObject(rawRequest)) throw new Error();
    const ownKeys = Reflect.ownKeys(rawRequest);
    if (
      ownKeys.length !== 1
      || ownKeys[0] !== 'instruction'
    ) throw new Error();
    const descriptor = Object.getOwnPropertyDescriptor(rawRequest, 'instruction');
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      throw new Error();
    }
    return descriptor.value;
  } catch {
    throw new BuilderGenerationKernelError('builder_generation_request_invalid');
  }
}

function openProjectId(rawRequest) {
  const projectId = exactDataValue(rawRequest, ['project_id'], 'project_id');
  if (projectId !== null && (typeof projectId !== 'string' || !PROJECT_ID_PATTERN.test(projectId))) fail();
  return projectId;
}

function readResultProjectId(value) {
  if (!isPlainObject(value)) fail();
  const receipt = Object.getOwnPropertyDescriptor(value, 'product_revision_receipt');
  if (!receipt || !Object.hasOwn(receipt, 'value') || !isPlainObject(receipt.value)) fail();
  const projectId = Object.getOwnPropertyDescriptor(receipt.value, 'project_id');
  if (
    !projectId
    || !Object.hasOwn(projectId, 'value')
    || typeof projectId.value !== 'string'
    || !PROJECT_ID_PATTERN.test(projectId.value)
  ) fail();
  return projectId.value;
}

function saveResultProjectId(value) {
  if (!isPlainObject(value)) fail();
  const projectId = Object.getOwnPropertyDescriptor(value, 'project_id');
  if (
    !projectId
    || !Object.hasOwn(projectId, 'value')
    || typeof projectId.value !== 'string'
    || !PROJECT_ID_PATTERN.test(projectId.value)
  ) fail();
  return projectId.value;
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
    const fetchImpl = descriptors.fetchImpl.value;
    const ipcMain = descriptors.ipcMain.value;
    const mainWindowRef = descriptors.mainWindowRef.value;
    const userDataPath = descriptors.userDataPath.value;
    if (
      typeof fetchImpl !== 'function'
      || utilTypes.isProxy(fetchImpl)
      || ipcMain === null
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
      fetchImpl,
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
  let projectMainAuthority = null;
  let service;
  let adapter;
  let workspaceAdapter;
  let selectedProjectId = null;
  let selectionEpoch = 0;
  let selectionPending = false;
  let activeRequestIds = () => Object.freeze([]);
  try {
    projectMainAuthority = createBuilderProjectMainAuthority({
      userDataPath: options.userDataPath,
    });
    const lazyProviderConfigRepository = Object.freeze({
      bind_current_authority() {
        if (providerConfigRepository === null) {
          providerConfigRepository = createBuilderProviderConfigRepository(options.userDataPath);
        }
        return providerConfigRepository.bind_current_authority();
      },
    });
    const conversationService = createBuilderConversationMainService({
      metadataAuthority: projectMainAuthority.metadata_authority,
      createUuid: randomUUID,
      nowMs: () => Date.now(),
    });
    service = createBuilderGenerationMainService({
      providerConfigRepository: lazyProviderConfigRepository,
      projectReadAuthority: projectMainAuthority.project_read_authority,
      conversationService,
      gitAuthority: projectMainAuthority.git_authority,
      transport: createBuilderOpenAICompatibleTransport({ fetchImpl: options.fetchImpl }),
    });
    const saveAuthority = createBuilderProjectSaveAuthority({
      generationDrafts: service,
      gitAuthority: projectMainAuthority.git_authority,
      metadataAuthority: projectMainAuthority.metadata_authority,
      projectReadAuthority: projectMainAuthority.project_read_authority,
      conversationService,
      createUuid: randomUUID,
      nowMs: () => Date.now(),
    });
    const activeRequests = new Map();

    function trackedGenerate(rawRequest) {
      if (selectionPending) fail();
      const request = createBuilderGenerationRequest({
        instruction: publicInstruction(rawRequest),
        existing_project_id: selectedProjectId,
      });
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
    async function openProject(rawRequest) {
      const projectId = openProjectId(rawRequest);
      const operationEpoch = ++selectionEpoch;
      selectionPending = projectId !== null;
      selectedProjectId = null;
      if (projectId === null) {
        return Object.freeze({
          result_version: 'builder-project-selection-result.v1',
          operation: 'new_selected',
          project_id: null,
        });
      }
      let result;
      try {
        result = await projectMainAuthority.project_read_authority.load_current({
          project_id: projectId,
        });
      } catch (error) {
        if (operationEpoch === selectionEpoch) selectionPending = false;
        throw error;
      }
      if (readResultProjectId(result) !== projectId) fail();
      if (operationEpoch === selectionEpoch) {
        selectedProjectId = projectId;
        selectionPending = false;
      }
      return result;
    }
    async function saveDraft(rawRequest) {
      if (selectionPending) fail();
      const operationEpoch = selectionEpoch;
      const expectedProjectId = selectedProjectId;
      const result = await saveAuthority.save(rawRequest);
      const savedProjectId = saveResultProjectId(result);
      if (operationEpoch === selectionEpoch && selectedProjectId === expectedProjectId) {
        selectedProjectId = savedProjectId;
        selectionEpoch += 1;
      }
      return result;
    }
    workspaceAdapter = createBuilderProjectWorkspaceIpcAdapter({
      openProject,
      saveDraft,
      loadCurrent: projectMainAuthority.project_read_authority.load_current,
      listCurrent: () => projectMainAuthority.project_read_authority.list_current({ limit: 256 }),
      mainWindowRef: options.mainWindowRef,
    });
    activeRequestIds = () => Object.freeze([...activeRequests.keys()]);
  } catch {
    try { projectMainAuthority?.close(); } catch { /* fixed failure below */ }
    fail();
  }

  const handlers = Object.freeze([
    Object.freeze({ channel: GENERATE_CHANNEL, invoke: adapter.channels.generate.invoke }),
    Object.freeze({ channel: CANCEL_CHANNEL, invoke: adapter.channels.cancel.invoke }),
    Object.freeze({ channel: AVAILABILITY_CHANNEL, invoke: adapter.channels.availability.invoke }),
    Object.freeze({ channel: OPEN_PROJECT_CHANNEL, invoke: workspaceAdapter.channels.open.invoke }),
    Object.freeze({ channel: SAVE_DRAFT_CHANNEL, invoke: workspaceAdapter.channels.saveDraft.invoke }),
    Object.freeze({ channel: LOAD_CURRENT_CHANNEL, invoke: workspaceAdapter.channels.loadCurrent.invoke }),
    Object.freeze({ channel: LIST_CURRENT_CHANNEL, invoke: workspaceAdapter.channels.listCurrent.invoke }),
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
        const result = Reflect.apply(service.cancel, undefined, [{ request_id: requestId }]);
        if (result?.cancelled !== true) failed = true;
      } catch {
        failed = true;
      }
    }
    return failed === false;
  }

  function closeProjectMainAuthority() {
    if (projectMainAuthority === null) return true;
    try {
      projectMainAuthority.close();
      projectMainAuthority = null;
      return true;
    } catch {
      return false;
    }
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
        const removed = removeInstalledHandlers();
        const closed = closeProjectMainAuthority();
        state = removed && closed ? 'disposed' : 'cleanup_required';
        fail();
      }
    },
    dispose() {
      if (state === 'disposed') return false;
      if (state === 'idle') {
        const closed = closeProjectMainAuthority();
        if (!closed) {
          state = 'cleanup_required';
          fail();
        }
        state = 'disposed';
        return false;
      }
      const cancelled = cancelActiveRequests();
      const removed = removeInstalledHandlers();
      const closed = cancelled ? closeProjectMainAuthority() : false;
      if (!cancelled || !removed || !closed) {
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
  GIT_RUNTIME_DIRECTORY,
  METADATA_DIRECTORY,
  METADATA_DATABASE,
  BuilderGenerationIpcRuntimeError,
  createBuilderGenerationIpcRuntime,
});
