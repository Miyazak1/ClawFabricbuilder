'use strict';

const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { types: utilTypes } = require('node:util');

const {
  ANSWER_CHANNEL,
  AVAILABILITY_CHANNEL,
  CANCEL_CHANNEL,
  GENERATE_CHANNEL,
  GENERATION_OUTPUT_CHANNEL,
  GENERATION_STARTED_CHANNEL,
  REJECT_DRAFT_CHANNEL,
  RESTORE_DRAFT_CHANNEL,
  RETRY_GENERATE_CHANNEL,
  SUBMIT_CHANNEL,
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
  LOAD_REVISION_CHANNEL,
  LIST_CURRENT_CHANNEL,
  LIST_HISTORY_CHANNEL,
  createBuilderProjectWorkspaceIpcAdapter,
} = require('./builder-project-workspace-ipc-adapter.cjs');
const {
  READ_TASK_STREAM_CHANNEL,
  TASK_STREAM_CHANGED_CHANNEL,
  createBuilderTaskStreamIpcAdapter,
} = require('./builder-task-stream-ipc-adapter.cjs');
const {
  REVIEW_PLAN_CHANNEL,
  createBuilderPlanReviewIpcAdapter,
} = require('./builder-plan-review-ipc-adapter.cjs');
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
const REQUEST_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const CONVERSATION_ID_PATTERN = /^builder-conversation:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TURN_ID_PATTERN = /^builder-turn:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TASK_ID_PATTERN = /^builder-task:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RUN_ID_PATTERN = /^builder-run:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_DISPLAY_DELTA_TEXT_BYTES = 16 * 1024;

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

function activeWebContents(mainWindowRef) {
  try {
    const windowRef = Reflect.apply(mainWindowRef, undefined, []);
    if (!windowRef || (typeof windowRef.isDestroyed === 'function' && windowRef.isDestroyed())) {
      return null;
    }
    const webContents = windowRef.webContents;
    if (!webContents || (typeof webContents.isDestroyed === 'function' && webContents.isDestroyed())) {
      return null;
    }
    return webContents;
  } catch {
    return null;
  }
}

function taskStreamChangedEvent(rawEvent) {
  if (!isPlainObject(rawEvent)) fail();
  const keys = Reflect.ownKeys(rawEvent);
  if (
    keys.length !== 2
    || keys.some((key) => typeof key !== 'string' || !['event_version', 'project_id'].includes(key))
  ) fail();
  const version = Object.getOwnPropertyDescriptor(rawEvent, 'event_version');
  const projectId = Object.getOwnPropertyDescriptor(rawEvent, 'project_id');
  if (
    !version
    || version.enumerable !== true
    || !Object.hasOwn(version, 'value')
    || version.value !== 'builder-task-stream-changed.v1'
    || !projectId
    || projectId.enumerable !== true
    || !Object.hasOwn(projectId, 'value')
    || typeof projectId.value !== 'string'
    || !PROJECT_ID_PATTERN.test(projectId.value)
  ) fail();
  return Object.freeze({
    event_version: 'builder-task-stream-changed.v1',
    project_id: projectId.value,
  });
}

function generationStartedEvent(rawEvent) {
  if (!isPlainObject(rawEvent)) fail();
  const keys = Reflect.ownKeys(rawEvent);
  if (
    keys.length !== 3
    || keys.some((key) => typeof key !== 'string' || !['event_version', 'request_id', 'project_id'].includes(key))
  ) fail();
  const version = Object.getOwnPropertyDescriptor(rawEvent, 'event_version');
  const requestId = Object.getOwnPropertyDescriptor(rawEvent, 'request_id');
  const projectId = Object.getOwnPropertyDescriptor(rawEvent, 'project_id');
  if (
    !version
    || version.enumerable !== true
    || !Object.hasOwn(version, 'value')
    || version.value !== 'builder-generation-started.v1'
    || !requestId
    || requestId.enumerable !== true
    || !Object.hasOwn(requestId, 'value')
    || typeof requestId.value !== 'string'
    || !REQUEST_DIGEST_PATTERN.test(requestId.value)
    || !projectId
    || projectId.enumerable !== true
    || !Object.hasOwn(projectId, 'value')
    || typeof projectId.value !== 'string'
    || !PROJECT_ID_PATTERN.test(projectId.value)
  ) fail();
  return Object.freeze({
    event_version: 'builder-generation-started.v1',
    request_id: requestId.value,
    project_id: projectId.value,
  });
}

function safeDisplayDeltaText(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_DISPLAY_DELTA_TEXT_BYTES
    || Buffer.byteLength(value, 'utf8') > MAX_DISPLAY_DELTA_TEXT_BYTES
  ) fail();
  return value;
}

function generationOutputEvent(rawEvent) {
  if (!isPlainObject(rawEvent)) fail();
  const keys = Reflect.ownKeys(rawEvent);
  const expectedKeys = [
    'event_version',
    'request_id',
    'project_id',
    'conversation_id',
    'turn_id',
    'task_id',
    'run_id',
    'display_delta_text',
  ];
  if (
    keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) fail();
  const descriptors = Object.getOwnPropertyDescriptors(rawEvent);
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  const taskId = descriptors.task_id.value;
  if (
    descriptors.event_version.value !== 'builder-generation-output.v1'
    || typeof descriptors.request_id.value !== 'string'
    || !REQUEST_DIGEST_PATTERN.test(descriptors.request_id.value)
    || typeof descriptors.project_id.value !== 'string'
    || !PROJECT_ID_PATTERN.test(descriptors.project_id.value)
    || typeof descriptors.conversation_id.value !== 'string'
    || !CONVERSATION_ID_PATTERN.test(descriptors.conversation_id.value)
    || descriptors.conversation_id.value.slice('builder-conversation:'.length)
      !== descriptors.project_id.value.slice('builder-project:'.length)
    || typeof descriptors.turn_id.value !== 'string'
    || !TURN_ID_PATTERN.test(descriptors.turn_id.value)
    || (taskId !== null && (typeof taskId !== 'string' || !TASK_ID_PATTERN.test(taskId)))
    || typeof descriptors.run_id.value !== 'string'
    || !RUN_ID_PATTERN.test(descriptors.run_id.value)
  ) fail();
  return Object.freeze({
    event_version: 'builder-generation-output.v1',
    request_id: descriptors.request_id.value,
    project_id: descriptors.project_id.value,
    conversation_id: descriptors.conversation_id.value,
    turn_id: descriptors.turn_id.value,
    task_id: taskId,
    run_id: descriptors.run_id.value,
    display_delta_text: safeDisplayDeltaText(descriptors.display_delta_text.value),
  });
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
  let taskStreamAdapter;
  let planReviewAdapter;
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
    function publishTaskStreamChanged(rawEvent) {
      const event = taskStreamChangedEvent(rawEvent);
      const webContents = activeWebContents(options.mainWindowRef);
      if (webContents === null || typeof webContents.send !== 'function') return;
      try {
        webContents.send(TASK_STREAM_CHANGED_CHANNEL, event);
      } catch {
        // Activity notifications are opportunistic; the read IPC remains authoritative.
      }
    }
    const conversationService = createBuilderConversationMainService({
      metadataAuthority: projectMainAuthority.metadata_authority,
      createUuid: randomUUID,
      nowMs: () => Date.now(),
      onTaskStreamChanged: publishTaskStreamChanged,
    });
    service = createBuilderGenerationMainService({
      providerConfigRepository: lazyProviderConfigRepository,
      projectReadAuthority: projectMainAuthority.project_read_authority,
      conversationService,
      gitAuthority: projectMainAuthority.git_authority,
      transport: createBuilderOpenAICompatibleTransport({ fetchImpl: options.fetchImpl }),
      onGenerationStarted(event) {
        const webContents = activeWebContents(options.mainWindowRef);
        if (webContents === null) return;
        webContents.send(GENERATION_STARTED_CHANNEL, generationStartedEvent(event));
      },
      onProviderOutputDelta(event) {
        const webContents = activeWebContents(options.mainWindowRef);
        if (webContents === null) return;
        webContents.send(GENERATION_OUTPUT_CHANNEL, generationOutputEvent(event));
      },
    });
    const saveAuthority = createBuilderProjectSaveAuthority({
      generationDrafts: service,
      gitAuthority: projectMainAuthority.git_authority,
      currentProjection: projectMainAuthority.git_current_projection,
      metadataAuthority: projectMainAuthority.metadata_authority,
      projectReadAuthority: projectMainAuthority.project_read_authority,
      conversationService,
      createUuid: randomUUID,
      nowMs: () => Date.now(),
    });
    const activeRequests = new Map();

    function trackedGenerationOperation(rawRequest, method) {
      if (selectionPending) fail();
      const request = createBuilderGenerationRequest({
        instruction: publicInstruction(rawRequest),
        existing_project_id: selectedProjectId,
      });
      const requestId = request.request_digest;
      activeRequests.set(requestId, (activeRequests.get(requestId) ?? 0) + 1);
      let operation;
      try {
        operation = Promise.resolve(Reflect.apply(method, service, [request]));
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

    function trackedGenerate(rawRequest) {
      return trackedGenerationOperation(rawRequest, service.generate);
    }

    function trackedSubmit(rawRequest) {
      return trackedGenerationOperation(rawRequest, service.submit);
    }

    function trackedRetryGenerate(rawRequest) {
      return trackedGenerationOperation(rawRequest, service.retry_generate);
    }

    function trackedAnswer(rawRequest) {
      return trackedGenerationOperation(rawRequest, service.answer);
    }

    adapter = createBuilderGenerationIpcAdapter({
      generate: trackedGenerate,
      submit: trackedSubmit,
      retry: trackedRetryGenerate,
      answer: trackedAnswer,
      restoreDraft: service.restore_draft,
      rejectDraft: service.reject_draft,
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
      loadRevision: projectMainAuthority.project_read_authority.load_revision,
      listCurrent: () => projectMainAuthority.project_read_authority.list_current({ limit: 256 }),
      listHistory: projectMainAuthority.project_read_authority.list_history,
      mainWindowRef: options.mainWindowRef,
    });
    taskStreamAdapter = createBuilderTaskStreamIpcAdapter({
      readStream: conversationService.read_stream,
      mainWindowRef: options.mainWindowRef,
    });
    planReviewAdapter = createBuilderPlanReviewIpcAdapter({
      reviewPlan: conversationService.review_plan,
      mainWindowRef: options.mainWindowRef,
    });
    activeRequestIds = () => Object.freeze([...activeRequests.keys()]);
  } catch {
    try { projectMainAuthority?.close(); } catch { /* fixed failure below */ }
    fail();
  }

  const handlers = Object.freeze([
    Object.freeze({ channel: GENERATE_CHANNEL, invoke: adapter.channels.generate.invoke }),
    Object.freeze({ channel: SUBMIT_CHANNEL, invoke: adapter.channels.submit.invoke }),
    Object.freeze({ channel: RETRY_GENERATE_CHANNEL, invoke: adapter.channels.retry.invoke }),
    Object.freeze({ channel: ANSWER_CHANNEL, invoke: adapter.channels.answer.invoke }),
    Object.freeze({ channel: RESTORE_DRAFT_CHANNEL, invoke: adapter.channels.restoreDraft.invoke }),
    Object.freeze({ channel: REJECT_DRAFT_CHANNEL, invoke: adapter.channels.rejectDraft.invoke }),
    Object.freeze({ channel: CANCEL_CHANNEL, invoke: adapter.channels.cancel.invoke }),
    Object.freeze({ channel: AVAILABILITY_CHANNEL, invoke: adapter.channels.availability.invoke }),
    Object.freeze({ channel: OPEN_PROJECT_CHANNEL, invoke: workspaceAdapter.channels.open.invoke }),
    Object.freeze({ channel: SAVE_DRAFT_CHANNEL, invoke: workspaceAdapter.channels.saveDraft.invoke }),
    Object.freeze({ channel: LOAD_CURRENT_CHANNEL, invoke: workspaceAdapter.channels.loadCurrent.invoke }),
    Object.freeze({ channel: LOAD_REVISION_CHANNEL, invoke: workspaceAdapter.channels.loadRevision.invoke }),
    Object.freeze({ channel: LIST_CURRENT_CHANNEL, invoke: workspaceAdapter.channels.listCurrent.invoke }),
    Object.freeze({ channel: LIST_HISTORY_CHANNEL, invoke: workspaceAdapter.channels.listHistory.invoke }),
    Object.freeze({ channel: READ_TASK_STREAM_CHANNEL, invoke: taskStreamAdapter.channels.read.invoke }),
    Object.freeze({ channel: REVIEW_PLAN_CHANNEL, invoke: planReviewAdapter.channels.review.invoke }),
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
