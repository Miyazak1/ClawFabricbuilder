'use strict';

const { types: utilTypes } = require('node:util');

const OPEN_PROJECT_CHANNEL = 'clawfabric-builder:project-workspace:open';
const OPEN_PROJECT_LOCATION_CHANNEL = 'clawfabric-builder:project-workspace:open-location';
const CREATE_LOCAL_PROJECT_CHANNEL = 'clawfabric-builder:project-workspace:create-local';
const SAVE_DRAFT_CHANNEL = 'clawfabric-builder:project-workspace:save-draft';
const LOAD_CURRENT_CHANNEL = 'clawfabric-builder:project-workspace:load-current';
const LOAD_REVISION_CHANNEL = 'clawfabric-builder:project-workspace:load-revision';
const LIST_CURRENT_CHANNEL = 'clawfabric-builder:project-workspace:list-current';
const LIST_WORKSPACES_CHANNEL = 'clawfabric-builder:project-workspace:list-workspaces';
const LIST_HISTORY_CHANNEL = 'clawfabric-builder:project-workspace:list-history';
const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DRAFT_ID_PATTERN = /^builder-generation-draft:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const OPTION_KEYS = Object.freeze([
  'openProject',
  'openProjectLocation',
  'createLocalProject',
  'saveDraft',
  'loadCurrent',
  'loadRevision',
  'listCurrent',
  'listWorkspaces',
  'listHistory',
  'mainWindowRef',
]);
const REQUIRED_OPTION_KEYS = Object.freeze([
  'openProject',
  'openProjectLocation',
  'saveDraft',
  'loadCurrent',
  'loadRevision',
  'listCurrent',
  'listWorkspaces',
  'listHistory',
  'mainWindowRef',
]);
const MAX_PLAIN_DATA_NODES = 20_000;
const MAX_PLAIN_DATA_ENTRIES = 20_000;
const MAX_PLAIN_DATA_UTF8_BYTES = 16 * 1024 * 1024;
const MAX_PLAIN_DATA_DEPTH = 64;
const MAX_LIST_HISTORY_LIMIT = 256;
const MAX_PROJECT_TITLE_LENGTH = 80;
const ERROR_MESSAGES = Object.freeze({
  builder_project_workspace_forbidden: 'Builder projects are unavailable.',
  builder_project_workspace_invalid: 'The Builder project request could not be verified.',
  builder_project_workspace_not_found: 'The Builder project is unavailable.',
  builder_project_workspace_conflict: 'The Builder project changed before this action completed.',
  builder_project_workspace_resource_exceeded: 'The Builder project is too large to read safely.',
  builder_project_workspace_integrity_failed: 'The Builder project could not be verified.',
  builder_project_workspace_unavailable: 'Builder projects are unavailable.',
});
const SOURCE_CODE_MAP = Object.freeze({
  builder_project_save_invalid: 'builder_project_workspace_invalid',
  builder_project_save_not_found: 'builder_project_workspace_not_found',
  builder_project_save_conflict: 'builder_project_workspace_conflict',
  builder_project_save_unavailable: 'builder_project_workspace_unavailable',
  builder_project_read_invalid: 'builder_project_workspace_invalid',
  builder_project_read_not_found: 'builder_project_workspace_not_found',
  builder_project_read_resource_exceeded: 'builder_project_workspace_resource_exceeded',
  builder_project_read_integrity_failed: 'builder_project_workspace_integrity_failed',
  builder_project_read_unavailable: 'builder_project_workspace_unavailable',
});

class BuilderProjectWorkspaceIpcError extends Error {
  constructor(code = 'builder_project_workspace_unavailable') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_project_workspace_unavailable';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderProjectWorkspaceIpcError';
    this.code = selected;
    this.retryable = ![
      'builder_project_workspace_forbidden',
      'builder_project_workspace_invalid',
      'builder_project_workspace_integrity_failed',
    ].includes(selected);
    this.stack = `${this.name}: ${this.message}`;
  }
}

function ipcError(code) {
  return new BuilderProjectWorkspaceIpcError(code);
}

function safeErrorCode(error) {
  try {
    if (
      error === null
      || (typeof error !== 'object' && typeof error !== 'function')
      || utilTypes.isProxy(error)
    ) return null;
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    return descriptor
      && Object.hasOwn(descriptor, 'value')
      && typeof descriptor.value === 'string'
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

function normalizeError(error) {
  const sourceCode = safeErrorCode(error);
  if (sourceCode !== null && Object.hasOwn(ERROR_MESSAGES, sourceCode)) {
    return new BuilderProjectWorkspaceIpcError(sourceCode);
  }
  return ipcError(SOURCE_CODE_MAP[sourceCode] ?? 'builder_project_workspace_unavailable');
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
  if (!isPlainObject(value)) throw ipcError();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (
    !descriptor
    || descriptor.enumerable !== true
    || !Object.hasOwn(descriptor, 'value')
    || typeof descriptor.value !== 'function'
    || utilTypes.isProxy(descriptor.value)
  ) throw ipcError();
  return descriptor.value;
}

function exactPayload(value, expectedKeys) {
  if (!isPlainObject(value)) throw ipcError('builder_project_workspace_invalid');
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) throw ipcError('builder_project_workspace_invalid');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const output = {};
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (
      !descriptor
      || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
    ) throw ipcError('builder_project_workspace_invalid');
    output[key] = descriptor.value;
  }
  return output;
}

function safeProjectId(value, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !PROJECT_ID_PATTERN.test(value)) {
    throw ipcError('builder_project_workspace_invalid');
  }
  return value;
}

function hasControlCharacter(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function safeProjectTitle(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_PROJECT_TITLE_LENGTH * 2
    || value.length > MAX_PROJECT_TITLE_LENGTH
    || value.trim() !== value
    || hasControlCharacter(value)
  ) throw ipcError('builder_project_workspace_invalid');
  return value;
}

function safeDraftId(value) {
  if (typeof value !== 'string' || !DRAFT_ID_PATTERN.test(value)) {
    throw ipcError('builder_project_workspace_invalid');
  }
  return value;
}

function safeDigest(value) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
    throw ipcError('builder_project_workspace_invalid');
  }
  return value;
}

function safeLimit(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_LIST_HISTORY_LIMIT) {
    throw ipcError('builder_project_workspace_invalid');
  }
  return value;
}

function openProjectRequest(value) {
  const source = exactPayload(value, ['project_id']);
  return Object.freeze({ project_id: safeProjectId(source.project_id, true) });
}

function createLocalProjectRequest(value) {
  const source = exactPayload(value, ['project_id', 'project_title']);
  return Object.freeze({
    project_id: safeProjectId(source.project_id, true),
    project_title: safeProjectTitle(source.project_title),
  });
}

function saveDraftRequest(value) {
  const source = exactPayload(value, ['draft_id']);
  return Object.freeze({ draft_id: safeDraftId(source.draft_id) });
}

function loadCurrentRequest(value) {
  const source = exactPayload(value, ['project_id']);
  return Object.freeze({ project_id: safeProjectId(source.project_id) });
}

function loadRevisionRequest(value) {
  const source = exactPayload(value, ['project_id', 'revision_receipt_digest']);
  return Object.freeze({
    project_id: safeProjectId(source.project_id),
    revision_receipt_digest: safeDigest(source.revision_receipt_digest),
  });
}

function listHistoryRequest(value) {
  const source = exactPayload(value, ['project_id', 'limit']);
  return Object.freeze({
    project_id: safeProjectId(source.project_id),
    limit: safeLimit(source.limit),
  });
}

function safeOptions(value) {
  try {
    if (!isPlainObject(value)) throw ipcError();
    const keys = Reflect.ownKeys(value);
    if (
      keys.length < REQUIRED_OPTION_KEYS.length
      || keys.length > OPTION_KEYS.length
      || keys.some((key) => typeof key !== 'string' || !OPTION_KEYS.includes(key))
      || REQUIRED_OPTION_KEYS.some((key) => !keys.includes(key))
    ) throw ipcError();
    return Object.freeze({
      openProject: stableMethod(value, 'openProject'),
      openProjectLocation: stableMethod(value, 'openProjectLocation'),
      createLocalProject: keys.includes('createLocalProject')
        ? stableMethod(value, 'createLocalProject')
        : () => {
          throw ipcError();
        },
      saveDraft: stableMethod(value, 'saveDraft'),
      loadCurrent: stableMethod(value, 'loadCurrent'),
      loadRevision: stableMethod(value, 'loadRevision'),
      listCurrent: stableMethod(value, 'listCurrent'),
      listWorkspaces: stableMethod(value, 'listWorkspaces'),
      listHistory: stableMethod(value, 'listHistory'),
      mainWindowRef: stableMethod(value, 'mainWindowRef'),
    });
  } catch {
    throw ipcError();
  }
}

function accountUtf8(value, state) {
  if (value.length > MAX_PLAIN_DATA_UTF8_BYTES - state.utf8Bytes) throw ipcError();
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes > MAX_PLAIN_DATA_UTF8_BYTES - state.utf8Bytes) throw ipcError();
  state.utf8Bytes += bytes;
}

function clonePlainData(value, state = {
  entries: 0,
  nodes: 0,
  seen: new WeakSet(),
  utf8Bytes: 0,
}, depth = 0) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    accountUtf8(value, state);
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (
    typeof value !== 'object'
    || utilTypes.isProxy(value)
    || state.seen.has(value)
    || depth > MAX_PLAIN_DATA_DEPTH
    || state.nodes >= MAX_PLAIN_DATA_NODES
  ) throw ipcError();
  state.seen.add(value);
  state.nodes += 1;
  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (
    (isArray && prototype !== Array.prototype)
    || (!isArray && prototype !== Object.prototype && prototype !== null)
    || (isArray && value.length > MAX_PLAIN_DATA_ENTRIES - state.entries)
  ) throw ipcError();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) throw ipcError();
  const entryCount = keys.length - (isArray ? 1 : 0);
  if (entryCount > MAX_PLAIN_DATA_ENTRIES - state.entries) throw ipcError();
  state.entries += entryCount;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(descriptors).length !== keys.length
    || (isArray && (keys.length !== value.length + 1 || !Object.hasOwn(descriptors, 'length')))
  ) throw ipcError();
  const output = isArray ? [] : {};
  for (const key of keys) {
    accountUtf8(key, state);
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw ipcError();
    if (isArray && key === 'length') continue;
    if (
      !descriptor.enumerable
      || (isArray && !/^(?:0|[1-9][0-9]*)$/u.test(key))
      || (!isArray && ['__proto__', 'prototype', 'constructor'].includes(key))
    ) throw ipcError();
    output[key] = clonePlainData(descriptor.value, state, depth + 1);
  }
  return Object.freeze(output);
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

function assertActiveSender(event, mainWindowRef) {
  if (!event || event.sender !== activeWebContents(mainWindowRef)) {
    throw ipcError('builder_project_workspace_forbidden');
  }
}

function createBuilderProjectWorkspaceIpcAdapter(rawOptions) {
  const options = safeOptions(rawOptions);

  async function invoke(event, rawArguments, method, expectedArguments, requestSanitizer = null) {
    try {
      assertActiveSender(event, options.mainWindowRef);
      if (rawArguments.length !== expectedArguments) {
        throw ipcError('builder_project_workspace_invalid');
      }
      const safeArguments = requestSanitizer === null
        ? rawArguments
        : [requestSanitizer(rawArguments[0])];
      return clonePlainData(await Reflect.apply(method, undefined, safeArguments));
    } catch (error) {
      throw normalizeError(error);
    }
  }

  return Object.freeze({
    adapter_id: 'builder_project_workspace.controlled_ipc_adapter.v1',
    namespace: 'builderProjectWorkspace',
    preload_namespace: 'window.clawfabricBuilder.projectWorkspace',
    channels: Object.freeze({
      open: Object.freeze({
        channel: OPEN_PROJECT_CHANNEL,
        method: 'open',
        invoke(event, ...rawArguments) {
          return invoke(event, rawArguments, options.openProject, 1, openProjectRequest);
        },
      }),
      openLocation: Object.freeze({
        channel: OPEN_PROJECT_LOCATION_CHANNEL,
        method: 'openLocation',
        invoke(event, ...rawArguments) {
          return invoke(event, rawArguments, options.openProjectLocation, 1, loadCurrentRequest);
        },
      }),
      saveDraft: Object.freeze({
        channel: SAVE_DRAFT_CHANNEL,
        method: 'saveDraft',
        invoke(event, ...rawArguments) {
          return invoke(event, rawArguments, options.saveDraft, 1, saveDraftRequest);
        },
      }),
      createLocalProject: Object.freeze({
        channel: CREATE_LOCAL_PROJECT_CHANNEL,
        method: 'createLocalProject',
        invoke(event, ...rawArguments) {
          return invoke(event, rawArguments, options.createLocalProject, 1, createLocalProjectRequest);
        },
      }),
      loadCurrent: Object.freeze({
        channel: LOAD_CURRENT_CHANNEL,
        method: 'loadCurrent',
        invoke(event, ...rawArguments) {
          return invoke(event, rawArguments, options.loadCurrent, 1, loadCurrentRequest);
        },
      }),
      loadRevision: Object.freeze({
        channel: LOAD_REVISION_CHANNEL,
        method: 'loadRevision',
        invoke(event, ...rawArguments) {
          return invoke(event, rawArguments, options.loadRevision, 1, loadRevisionRequest);
        },
      }),
      listCurrent: Object.freeze({
        channel: LIST_CURRENT_CHANNEL,
        method: 'listCurrent',
        invoke(event, ...rawArguments) {
          return invoke(event, rawArguments, options.listCurrent, 0);
        },
      }),
      listWorkspaces: Object.freeze({
        channel: LIST_WORKSPACES_CHANNEL,
        method: 'listWorkspaces',
        invoke(event, ...rawArguments) {
          return invoke(event, rawArguments, options.listWorkspaces, 0);
        },
      }),
      listHistory: Object.freeze({
        channel: LIST_HISTORY_CHANNEL,
        method: 'listHistory',
        invoke(event, ...rawArguments) {
          return invoke(event, rawArguments, options.listHistory, 1, listHistoryRequest);
        },
      }),
    }),
    exposed_methods: Object.freeze([
      'open',
      'openLocation',
      'createLocalProject',
      'saveDraft',
      'loadCurrent',
      'loadRevision',
      'listCurrent',
      'listWorkspaces',
      'listHistory',
    ]),
    authority: Object.freeze({
      renderer_authority: 'project_selection_project_id_or_draft_id_only',
      main_owned_git_authority: true,
      main_owned_sqlite_authority: true,
      active_renderer_required: true,
      direct_electron_registration: false,
      direct_preload_exposure: false,
    }),
  });
}

module.exports = Object.freeze({
  OPEN_PROJECT_CHANNEL,
  OPEN_PROJECT_LOCATION_CHANNEL,
  CREATE_LOCAL_PROJECT_CHANNEL,
  SAVE_DRAFT_CHANNEL,
  LOAD_CURRENT_CHANNEL,
  LOAD_REVISION_CHANNEL,
  LIST_CURRENT_CHANNEL,
  LIST_WORKSPACES_CHANNEL,
  LIST_HISTORY_CHANNEL,
  BuilderProjectWorkspaceIpcError,
  createBuilderProjectWorkspaceIpcAdapter,
});
