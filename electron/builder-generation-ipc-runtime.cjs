'use strict';

const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { types: utilTypes } = require('node:util');

const {
  ANSWER_CHANNEL,
  AVAILABILITY_CHANNEL,
  APPROVE_PLAN_SOURCE_READ_CHANNEL,
  CANCEL_CHANNEL,
  GENERATE_APPROVED_PLAN_CHANNEL,
  GENERATE_CHANNEL,
  GENERATION_OUTPUT_CHANNEL,
  GENERATION_STARTED_CHANNEL,
  PREPARE_PLAN_SOURCE_READ_APPROVAL_CHANNEL,
  PROPOSE_PLAN_CHANNEL,
  REJECT_DRAFT_CHANNEL,
  RESTORE_DRAFT_CHANNEL,
  RETRY_GENERATE_CHANNEL,
  STEER_CHANNEL,
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
  CREATE_LOCAL_PROJECT_CHANNEL,
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
const {
  BUILDER_PERMISSION_POLICY_VERSION,
} = require('./builder-permission-authority-contract.cjs');
const {
  createBuilderPermissionFactStore,
} = require('./builder-permission-fact-store.cjs');
const {
  LOCAL_BUILDER_USER_ACTOR_ID,
  PERMISSION_DATABASE,
  PERMISSION_DIRECTORY,
} = require('./builder-permission-ipc-runtime.cjs');
const {
  createBuilderToolPermissionAdmission,
} = require('./builder-tool-permission-admission.cjs');
const {
  createBuilderToolSourceContextCollector,
} = require('./builder-tool-source-context-collector.cjs');

const BUILDER_GENERATION_IPC_RUNTIME_VERSION = 'builder-generation-ipc-runtime.v2';
const OPTION_KEYS = Object.freeze([
  'fetchImpl',
  'grantPermissionForExplicitApproval',
  'ipcMain',
  'mainWindowRef',
  'userDataPath',
  'showOpenDialog',
]);
const REQUIRED_OPTION_KEYS = Object.freeze([
  'fetchImpl',
  'grantPermissionForExplicitApproval',
  'ipcMain',
  'mainWindowRef',
  'userDataPath',
]);
const ERROR_MESSAGE = 'AI project generation is unavailable.';
const PROJECT_ID_PATTERN = /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const REQUEST_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const CONVERSATION_ID_PATTERN = /^builder-conversation:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TURN_ID_PATTERN = /^builder-turn:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TASK_ID_PATTERN = /^builder-task:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RUN_ID_PATTERN = /^builder-run:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_DISPLAY_DELTA_TEXT_BYTES = 16 * 1024;
const MAX_PLAN_CONTEXT_RESOURCES = 8;
const MAX_PROJECT_RESOURCE_ID_LENGTH = 128;
const PLAN_RESOURCE_ID_PATTERN = /^project:\/[a-z0-9._/@-]{1,120}$/u;

class BuilderGenerationIpcRuntimeError extends Error {
  constructor() {
    super(ERROR_MESSAGE);
    this.name = 'BuilderGenerationIpcRuntimeError';
    this.code = 'builder_generation_ipc_runtime_unavailable';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

class BuilderGenerationProjectWorkspaceRequiredError extends Error {
  constructor() {
    super('Choose or open a project folder before building.');
    this.name = 'BuilderGenerationProjectWorkspaceRequiredError';
    this.code = 'builder_generation_project_workspace_required';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderGenerationIpcRuntimeError();
}

function failGenerationProjectWorkspaceRequired() {
  throw new BuilderGenerationProjectWorkspaceRequiredError();
}

function failGenerationBaseUnavailable() {
  throw new BuilderGenerationKernelError('builder_generation_base_unavailable');
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

function safePublicWorkspaceText(value, maximum) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maximum * 2
    || value.length > maximum
    || value.trim() !== value
    || value.includes('\0')
  ) fail();
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) fail();
  }
  return value;
}

function createLocalProjectRequest(rawRequest) {
  const projectId = exactDataValue(rawRequest, ['project_id', 'project_title'], 'project_id');
  if (projectId !== null && (typeof projectId !== 'string' || !PROJECT_ID_PATTERN.test(projectId))) fail();
  return Object.freeze({
    project_id: projectId,
    project_title: safePublicWorkspaceText(
      exactDataValue(rawRequest, ['project_id', 'project_title'], 'project_title'),
      80,
    ),
  });
}

function verifiedProjectIdentityId(value, expectedProjectId) {
  if (!isPlainObject(value)) fail();
  const operation = Object.getOwnPropertyDescriptor(value, 'operation');
  const project = Object.getOwnPropertyDescriptor(value, 'project');
  if (
    !operation
    || operation.value !== 'project_identity_loaded'
    || !project
    || !isPlainObject(project.value)
  ) fail();
  const projectId = Object.getOwnPropertyDescriptor(project.value, 'project_id');
  if (!projectId || projectId.value !== expectedProjectId) fail();
  return expectedProjectId;
}

function planSourceReadApprovalProjectId(rawRequest) {
  const projectId = exactDataValue(rawRequest, ['project_id'], 'project_id');
  if (typeof projectId !== 'string' || !PROJECT_ID_PATTERN.test(projectId)) fail();
  return projectId;
}

function approvedPlanGenerationRequest(rawRequest) {
  if (!isPlainObject(rawRequest)) fail();
  const keys = Reflect.ownKeys(rawRequest);
  const expectedKeys = ['project_id', 'conversation_id', 'turn_id', 'run_id'];
  if (
    keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) fail();
  const descriptors = Object.getOwnPropertyDescriptors(rawRequest);
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  const projectId = descriptors.project_id.value;
  const conversationId = descriptors.conversation_id.value;
  if (
    typeof projectId !== 'string'
    || !PROJECT_ID_PATTERN.test(projectId)
    || typeof conversationId !== 'string'
    || !CONVERSATION_ID_PATTERN.test(conversationId)
    || conversationId.slice('builder-conversation:'.length)
      !== projectId.slice('builder-project:'.length)
    || typeof descriptors.turn_id.value !== 'string'
    || !TURN_ID_PATTERN.test(descriptors.turn_id.value)
    || typeof descriptors.run_id.value !== 'string'
    || !RUN_ID_PATTERN.test(descriptors.run_id.value)
  ) fail();
  return Object.freeze({
    project_id: projectId,
    conversation_id: conversationId,
    turn_id: descriptors.turn_id.value,
    run_id: descriptors.run_id.value,
  });
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

function workspaceBoundProjectId(value, expectedProjectId) {
  if (!isPlainObject(value)) fail();
  const operation = Object.getOwnPropertyDescriptor(value, 'operation');
  const workspace = Object.getOwnPropertyDescriptor(value, 'workspace');
  if (
    !operation
    || operation.value !== 'project_workspace_bound'
    || !workspace
    || !isPlainObject(workspace.value)
  ) fail();
  const projectId = Object.getOwnPropertyDescriptor(workspace.value, 'project_id');
  const status = Object.getOwnPropertyDescriptor(workspace.value, 'binding_status');
  if (
    !projectId
    || projectId.value !== expectedProjectId
    || !status
    || status.value !== 'bound'
  ) fail();
  return expectedProjectId;
}

function sameFilesystemPath(left, right) {
  return process.platform === 'win32'
    ? left.toLocaleLowerCase('en-US') === right.toLocaleLowerCase('en-US')
    : left === right;
}

function selectedDirectoryFromDialog(value) {
  if (!isPlainObject(value)) fail();
  const canceled = Object.getOwnPropertyDescriptor(value, 'canceled');
  const filePaths = Object.getOwnPropertyDescriptor(value, 'filePaths');
  if (
    !canceled
    || typeof canceled.value !== 'boolean'
    || !filePaths
    || !Array.isArray(filePaths.value)
  ) fail();
  if (canceled.value) return null;
  if (filePaths.value.length !== 1 || typeof filePaths.value[0] !== 'string') fail();
  const resolved = path.resolve(filePaths.value[0]);
  if (
    resolved !== filePaths.value[0]
    || path.normalize(resolved) !== resolved
    || resolved.length === 0
    || resolved.length > 1024
    || resolved.includes('\0')
    || path.parse(resolved).root === resolved
  ) fail();
  let stat;
  let realPath;
  try {
    stat = fs.lstatSync(resolved);
    realPath = path.resolve(fs.realpathSync.native(resolved));
  } catch {
    fail();
  }
  if (
    !stat.isDirectory()
    || stat.isSymbolicLink()
    || !sameFilesystemPath(realPath, resolved)
    || fs.readdirSync(realPath).length !== 0
  ) fail();
  return realPath;
}

function sourceFolderNameFromRoot(projectRootPath) {
  return safePublicWorkspaceText(path.basename(projectRootPath), 120);
}

function safeProjectSourcePath(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_PROJECT_RESOURCE_ID_LENGTH - 'project:/'.length
    || value.includes('\\')
    || value.startsWith('/')
    || value.endsWith('/')
    || /^[A-Za-z]:/u.test(value)
    || value.startsWith('//')
  ) fail();
  const segments = value.split('/');
  if (
    segments.length === 0
    || segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) fail();
  return value;
}

function sourceTreeResourceIds(readResult) {
  if (!isPlainObject(readResult)) fail();
  const sourceTree = Object.getOwnPropertyDescriptor(readResult, 'source_tree');
  if (
    !sourceTree
    || sourceTree.enumerable !== true
    || !Object.hasOwn(sourceTree, 'value')
    || !isPlainObject(sourceTree.value)
  ) fail();
  const files = Object.getOwnPropertyDescriptor(sourceTree.value, 'files');
  if (
    !files
    || files.enumerable !== true
    || !Object.hasOwn(files, 'value')
    || !Array.isArray(files.value)
    || utilTypes.isProxy(files.value)
  ) fail();
  const keys = Reflect.ownKeys(files.value);
  if (keys.some((key) => typeof key === 'symbol') || keys.length !== files.value.length + 1) fail();
  const resourceIds = [];
  const seen = new Set();
  for (let index = 0; index < files.value.length; index += 1) {
    const file = Object.getOwnPropertyDescriptor(files.value, String(index));
    if (
      !file
      || file.enumerable !== true
      || !Object.hasOwn(file, 'value')
      || !isPlainObject(file.value)
    ) fail();
    const pathDescriptor = Object.getOwnPropertyDescriptor(file.value, 'path');
    if (
      !pathDescriptor
      || pathDescriptor.enumerable !== true
      || !Object.hasOwn(pathDescriptor, 'value')
    ) fail();
    const resourceId = `project:/${safeProjectSourcePath(pathDescriptor.value)}`;
    if (
      resourceId.length > MAX_PROJECT_RESOURCE_ID_LENGTH
      || !PLAN_RESOURCE_ID_PATTERN.test(resourceId)
    ) continue;
    if (seen.has(resourceId)) fail();
    seen.add(resourceId);
    resourceIds.push(resourceId);
  }
  resourceIds.sort();
  const selected = resourceIds.slice(0, MAX_PLAN_CONTEXT_RESOURCES);
  if (selected.length === 0) fail();
  return Object.freeze(selected);
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
      keys.length < REQUIRED_OPTION_KEYS.length
      || keys.length > OPTION_KEYS.length
      || keys.some((key) => typeof key !== 'string' || !OPTION_KEYS.includes(key))
      || REQUIRED_OPTION_KEYS.some((key) => !keys.includes(key))
    ) fail();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    }
    const fetchImpl = descriptors.fetchImpl.value;
    const grantPermissionForExplicitApproval = descriptors.grantPermissionForExplicitApproval.value;
    const ipcMain = descriptors.ipcMain.value;
    const mainWindowRef = descriptors.mainWindowRef.value;
    const userDataPath = descriptors.userDataPath.value;
    const showOpenDialog = keys.includes('showOpenDialog')
      ? descriptors.showOpenDialog.value
      : null;
    if (
      typeof fetchImpl !== 'function'
      || utilTypes.isProxy(fetchImpl)
      || typeof grantPermissionForExplicitApproval !== 'function'
      || utilTypes.isProxy(grantPermissionForExplicitApproval)
      || ipcMain === null
      || typeof ipcMain !== 'object'
      || utilTypes.isProxy(ipcMain)
      || typeof mainWindowRef !== 'function'
      || (showOpenDialog !== null && (typeof showOpenDialog !== 'function' || utilTypes.isProxy(showOpenDialog)))
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
      grantPermissionForExplicitApproval,
      ipcMain,
      handle: stableMethod(ipcMain, 'handle'),
      removeHandler: stableMethod(ipcMain, 'removeHandler'),
      mainWindowRef,
      showOpenDialog,
      userDataPath,
    });
  } catch {
    fail();
  }
}

function createBuilderGenerationIpcRuntime(rawOptions) {
  const options = safeOptions(rawOptions);
  let providerConfigRepository = null;
  let permissionFactStore = null;
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
    const permissionRoot = path.join(options.userDataPath, PERMISSION_DIRECTORY);
    fs.mkdirSync(permissionRoot, { recursive: true, mode: 0o700 });
    permissionFactStore = createBuilderPermissionFactStore(path.join(permissionRoot, PERMISSION_DATABASE));
    const permissionEvaluator = permissionFactStore.create_evaluator();
    const permissionAdmission = createBuilderToolPermissionAdmission({
      actor_id: LOCAL_BUILDER_USER_ACTOR_ID,
      evaluate_permission(request) {
        return permissionEvaluator.evaluate({
          policy_version: BUILDER_PERMISSION_POLICY_VERSION,
          actor_id: LOCAL_BUILDER_USER_ACTOR_ID,
          action: request.action,
          resource: request.resource,
          now_ms: request.now_ms,
        });
      },
      now_ms: () => Date.now(),
    });
    const sourceContextCollector = createBuilderToolSourceContextCollector({
      conversation_service: conversationService,
      permission_admission: permissionAdmission,
      project_workspace_authority: projectMainAuthority.project_workspace_authority,
      create_uuid: randomUUID,
      now_ms: () => Date.now(),
    });
    service = createBuilderGenerationMainService({
      providerConfigRepository: lazyProviderConfigRepository,
      projectReadAuthority: projectMainAuthority.project_read_authority,
      projectIdentityAuthority: projectMainAuthority.metadata_authority,
      conversationService,
      gitAuthority: projectMainAuthority.git_authority,
      sourceContextCollector,
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
      publicInstruction(rawRequest);
      if (selectionPending) fail();
      if (selectedProjectId === null) failGenerationProjectWorkspaceRequired();
      return trackedGenerationOperation(rawRequest, service.generate);
    }

    function trackedGenerateApprovedPlan(rawRequest) {
      if (selectionPending) fail();
      const request = approvedPlanGenerationRequest(rawRequest);
      if (selectedProjectId !== request.project_id) fail();
      return service.generate_approved_plan(request);
    }

    async function trackedProposePlan(rawRequest) {
      if (selectionPending || selectedProjectId === null) failGenerationBaseUnavailable();
      const projectId = selectedProjectId;
      const request = createBuilderGenerationRequest({
        instruction: publicInstruction(rawRequest),
        existing_project_id: projectId,
      });
      const requestId = request.request_digest;
      activeRequests.set(requestId, (activeRequests.get(requestId) ?? 0) + 1);
      try {
        let currentProject;
        let resourceIds;
        try {
          currentProject = await projectMainAuthority.project_read_authority.load_current({ project_id: projectId });
          if (readResultProjectId(currentProject) !== projectId) fail();
          resourceIds = sourceTreeResourceIds(currentProject);
        } catch {
          failGenerationBaseUnavailable();
        }
        return await service.propose_plan({
          request,
          resource_ids: resourceIds,
        });
      } finally {
        const remaining = (activeRequests.get(requestId) ?? 1) - 1;
        if (remaining === 0) activeRequests.delete(requestId);
        else activeRequests.set(requestId, remaining);
      }
    }

    async function selectedPlanSourceReadResources(projectId) {
      if (selectionPending || selectedProjectId !== projectId) failGenerationBaseUnavailable();
      let currentProject;
      try {
        currentProject = await projectMainAuthority.project_read_authority.load_current({ project_id: projectId });
        if (readResultProjectId(currentProject) !== projectId) fail();
        return sourceTreeResourceIds(currentProject);
      } catch {
        failGenerationBaseUnavailable();
      }
    }

    async function planSourceReadApprovalStatus(rawRequest) {
      const projectId = planSourceReadApprovalProjectId(rawRequest);
      const resourceIds = await selectedPlanSourceReadResources(projectId);
      const nowMs = Date.now();
      let denied = false;
      for (const resourceId of resourceIds) {
        const decision = await permissionEvaluator.evaluate({
          policy_version: BUILDER_PERMISSION_POLICY_VERSION,
          actor_id: LOCAL_BUILDER_USER_ACTOR_ID,
          action: 'filesystem.read',
          resource: {
            resource_kind: 'filesystem',
            project_id: projectId,
            resource_id: resourceId,
          },
          now_ms: nowMs,
        });
        if (decision.decision !== 'allowed') denied = true;
      }
      return Object.freeze({
        result_version: 'builder-plan-source-read-approval-status.v1',
        project_id: projectId,
        state: denied ? 'approval_required' : 'ready',
        file_count: resourceIds.length,
        approval_scope: 'current_project_plan_source_read',
        authority: 'main_selected_project_bounded_filesystem_read_v1',
      });
    }

    async function approvePlanSourceRead(rawRequest) {
      const projectId = planSourceReadApprovalProjectId(rawRequest);
      const resourceIds = await selectedPlanSourceReadResources(projectId);
      let recorded = false;
      for (const resourceId of resourceIds) {
        const result = await Reflect.apply(options.grantPermissionForExplicitApproval, undefined, [{
          project_id: projectId,
          action: 'filesystem.read',
          resource_kind: 'filesystem',
          resource_id: resourceId,
        }]);
        if (
          !isPlainObject(result)
          || Object.getOwnPropertyDescriptor(result, 'result_version')?.value !== 'builder-permission-grant-result.v1'
          || Object.getOwnPropertyDescriptor(result, 'project_id')?.value !== projectId
          || Object.getOwnPropertyDescriptor(result, 'action')?.value !== 'filesystem.read'
          || Object.getOwnPropertyDescriptor(result, 'ui_selection_authority')?.value
            !== 'main_owned_explicit_user_approval_required'
        ) fail();
        const operation = Object.getOwnPropertyDescriptor(result, 'operation')?.value;
        if (operation === 'grant_recorded') recorded = true;
        else if (operation !== 'grant_existing') fail();
      }
      return Object.freeze({
        result_version: 'builder-plan-source-read-approval-result.v1',
        project_id: projectId,
        operation: recorded ? 'approval_recorded' : 'already_approved',
        file_count: resourceIds.length,
        approval_scope: 'current_project_plan_source_read',
        authority: 'main_selected_project_bounded_filesystem_read_v1',
      });
    }

    function trackedSubmit(rawRequest) {
      return trackedGenerationOperation(rawRequest, service.submit);
    }

    function trackedRetryGenerate(rawRequest) {
      publicInstruction(rawRequest);
      if (selectionPending) fail();
      if (selectedProjectId === null) failGenerationProjectWorkspaceRequired();
      return trackedGenerationOperation(rawRequest, service.retry_generate);
    }

    function trackedAnswer(rawRequest) {
      return trackedGenerationOperation(rawRequest, service.answer);
    }

    adapter = createBuilderGenerationIpcAdapter({
      generate: trackedGenerate,
      generateApprovedPlan: trackedGenerateApprovedPlan,
      proposePlan: trackedProposePlan,
      preparePlanSourceReadApproval: planSourceReadApprovalStatus,
      approvePlanSourceRead,
      submit: trackedSubmit,
      retry: trackedRetryGenerate,
      answer: trackedAnswer,
      restoreDraft: service.restore_draft,
      rejectDraft: service.reject_draft,
      cancel: service.cancel,
      steer: service.steer,
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
    async function createLocalProject(rawRequest) {
      const request = createLocalProjectRequest(rawRequest);
      if (options.showOpenDialog === null) fail();
      const operationEpoch = ++selectionEpoch;
      selectionPending = true;
      selectedProjectId = null;
      let projectRootPath;
      try {
        const windowRef = Reflect.apply(options.mainWindowRef, undefined, []);
        if (!windowRef || (typeof windowRef.isDestroyed === 'function' && windowRef.isDestroyed())) fail();
        const dialogOptions = {
          title: 'Choose an empty folder for this project',
          properties: ['openDirectory', 'createDirectory'],
        };
        projectRootPath = selectedDirectoryFromDialog(await Reflect.apply(
          options.showOpenDialog,
          undefined,
          [windowRef, dialogOptions],
        ));
      } catch (error) {
        if (operationEpoch === selectionEpoch) selectionPending = false;
        throw error;
      }
      if (projectRootPath === null) {
        if (operationEpoch === selectionEpoch) selectionPending = false;
        return Object.freeze({
          result_version: 'builder-project-selection-result.v1',
          operation: 'new_selected',
          project_id: null,
        });
      }
      const projectId = request.project_id ?? `builder-project:${randomUUID()}`;
      if (request.project_id !== null) {
        try {
          verifiedProjectIdentityId(
            await projectMainAuthority.metadata_authority.load_project_identity({
              project_id: request.project_id,
            }),
            request.project_id,
          );
        } catch (error) {
          if (operationEpoch === selectionEpoch) selectionPending = false;
          throw error;
        }
      }
      const boundAtMs = Date.now();
      let result;
      try {
        result = await projectMainAuthority.metadata_authority.bind_project_workspace({
          project_id: projectId,
          project_title: request.project_title,
          project_root_path: projectRootPath,
          source_folder_name: sourceFolderNameFromRoot(projectRootPath),
          created_at_ms: boundAtMs,
          bound_at_ms: boundAtMs,
        });
      } catch (error) {
        if (operationEpoch === selectionEpoch) selectionPending = false;
        throw error;
      }
      workspaceBoundProjectId(result, projectId);
      if (operationEpoch === selectionEpoch) {
        selectedProjectId = projectId;
        selectionPending = false;
      }
      return Object.freeze({
        result_version: 'builder-project-selection-result.v1',
        operation: 'local_project_bound',
        project_id: projectId,
        project_title: request.project_title,
        source_folders: [
          {
            name: sourceFolderNameFromRoot(projectRootPath),
            status: 'selected',
          },
        ],
      });
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
      createLocalProject,
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
    try { permissionFactStore?.close(); } catch { /* fixed failure below */ }
    try { projectMainAuthority?.close(); } catch { /* fixed failure below */ }
    fail();
  }

  const handlers = Object.freeze([
    Object.freeze({ channel: GENERATE_CHANNEL, invoke: adapter.channels.generate.invoke }),
    Object.freeze({ channel: GENERATE_APPROVED_PLAN_CHANNEL, invoke: adapter.channels.generateApprovedPlan.invoke }),
    Object.freeze({ channel: PROPOSE_PLAN_CHANNEL, invoke: adapter.channels.proposePlan.invoke }),
    Object.freeze({
      channel: PREPARE_PLAN_SOURCE_READ_APPROVAL_CHANNEL,
      invoke: adapter.channels.preparePlanSourceReadApproval.invoke,
    }),
    Object.freeze({
      channel: APPROVE_PLAN_SOURCE_READ_CHANNEL,
      invoke: adapter.channels.approvePlanSourceRead.invoke,
    }),
    Object.freeze({ channel: SUBMIT_CHANNEL, invoke: adapter.channels.submit.invoke }),
    Object.freeze({ channel: RETRY_GENERATE_CHANNEL, invoke: adapter.channels.retry.invoke }),
    Object.freeze({ channel: ANSWER_CHANNEL, invoke: adapter.channels.answer.invoke }),
    Object.freeze({ channel: RESTORE_DRAFT_CHANNEL, invoke: adapter.channels.restoreDraft.invoke }),
    Object.freeze({ channel: REJECT_DRAFT_CHANNEL, invoke: adapter.channels.rejectDraft.invoke }),
    Object.freeze({ channel: CANCEL_CHANNEL, invoke: adapter.channels.cancel.invoke }),
    Object.freeze({ channel: STEER_CHANNEL, invoke: adapter.channels.steer.invoke }),
    Object.freeze({ channel: AVAILABILITY_CHANNEL, invoke: adapter.channels.availability.invoke }),
    Object.freeze({ channel: OPEN_PROJECT_CHANNEL, invoke: workspaceAdapter.channels.open.invoke }),
    Object.freeze({ channel: CREATE_LOCAL_PROJECT_CHANNEL, invoke: workspaceAdapter.channels.createLocalProject.invoke }),
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

  function closePermissionFactStore() {
    if (permissionFactStore === null) return true;
    try {
      permissionFactStore.close();
      permissionFactStore = null;
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
        const permissionsClosed = closePermissionFactStore();
        const closed = permissionsClosed ? closeProjectMainAuthority() : false;
        state = removed && permissionsClosed && closed ? 'disposed' : 'cleanup_required';
        fail();
      }
    },
    dispose() {
      if (state === 'disposed') return false;
      if (state === 'idle') {
        const permissionsClosed = closePermissionFactStore();
        const closed = permissionsClosed ? closeProjectMainAuthority() : false;
        if (!permissionsClosed || !closed) {
          state = 'cleanup_required';
          fail();
        }
        state = 'disposed';
        return false;
      }
      const cancelled = cancelActiveRequests();
      const removed = removeInstalledHandlers();
      const permissionsClosed = cancelled ? closePermissionFactStore() : false;
      const closed = permissionsClosed ? closeProjectMainAuthority() : false;
      if (!cancelled || !removed || !permissionsClosed || !closed) {
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
