'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { types: utilTypes } = require('node:util');

const {
  EVALUATE_PERMISSION_CHANNEL,
  createBuilderPermissionIpcAdapter,
} = require('./builder-permission-ipc-adapter.cjs');
const {
  BUILDER_PERMISSION_POLICY_VERSION,
  createBuilderPermissionGrantRecord,
} = require('./builder-permission-authority-contract.cjs');
const {
  createBuilderPermissionFactStore,
} = require('./builder-permission-fact-store.cjs');

const BUILDER_PERMISSION_IPC_RUNTIME_VERSION = 'builder-permission-ipc-runtime.v1';
const PERMISSION_DIRECTORY = 'builder-permissions-v1';
const PERMISSION_DATABASE = 'permissions.sqlite';
const LOCAL_BUILDER_USER_ACTOR_ID = 'builder-user:00000000-0000-4000-8000-000000000001';
const OPTION_KEYS = Object.freeze(['ipcMain', 'mainWindowRef', 'userDataPath', 'nowMs']);
const REQUIRED_OPTION_KEYS = Object.freeze(['ipcMain', 'mainWindowRef', 'userDataPath']);
const REQUEST_KEYS = Object.freeze(['project_id', 'action', 'resource_kind', 'resource_id']);
const ACTION_RESOURCE_KINDS = Object.freeze({
  'context.read': Object.freeze(['project', 'conversation', 'task', 'run', 'revision', 'artifact']),
  'project.read': Object.freeze(['project', 'revision']),
  'project.edit': Object.freeze(['project']),
  'secret.read': Object.freeze(['secret']),
  'filesystem.read': Object.freeze(['filesystem']),
  'filesystem.write': Object.freeze(['filesystem']),
  'network.request': Object.freeze(['network']),
  'process.spawn': Object.freeze(['process']),
  'publication.create': Object.freeze(['publication']),
  'permission.grant': Object.freeze(['permission']),
});
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const RESOURCE_ID_PATTERN = /^[a-z][a-z0-9._:/@-]{0,127}$/u;
const ERROR_MESSAGES = Object.freeze({
  builder_permission_ipc_runtime_unavailable: 'Permissions are unavailable.',
  builder_permission_ipc_runtime_cleanup_required: 'Permission cleanup is required.',
});

class BuilderPermissionIpcRuntimeError extends Error {
  constructor(code = 'builder_permission_ipc_runtime_unavailable') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_permission_ipc_runtime_unavailable';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderPermissionIpcRuntimeError';
    this.code = selected;
    this.retryable = selected === 'builder_permission_ipc_runtime_cleanup_required';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderPermissionIpcRuntimeError(code);
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
      if (
        !Object.hasOwn(descriptor, 'value')
        || typeof descriptor.value !== 'function'
        || utilTypes.isProxy(descriptor.value)
      ) fail();
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
    const ipcMain = descriptors.ipcMain.value;
    const mainWindowRef = descriptors.mainWindowRef.value;
    const userDataPath = descriptors.userDataPath.value;
    const nowMs = keys.includes('nowMs') ? descriptors.nowMs.value : () => Date.now();
    if (
      ipcMain === null
      || typeof ipcMain !== 'object'
      || utilTypes.isProxy(ipcMain)
      || typeof mainWindowRef !== 'function'
      || utilTypes.isProxy(mainWindowRef)
      || typeof nowMs !== 'function'
      || utilTypes.isProxy(nowMs)
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
      nowMs,
      userDataPath,
    });
  } catch {
    fail();
  }
}

function currentTime(options) {
  try {
    const now = Reflect.apply(options.nowMs, undefined, []);
    if (!Number.isSafeInteger(now) || now < 0) fail();
    return now;
  } catch {
    fail();
  }
}

function exactDescriptors(value, keys) {
  if (!isPlainObject(value)) fail();
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail();
    }
  }
  return descriptors;
}

function safeProjectId(value) {
  if (typeof value !== 'string' || !PROJECT_ID_PATTERN.test(value)) fail();
  return value;
}

function safeAction(value) {
  if (typeof value !== 'string' || !Object.hasOwn(ACTION_RESOURCE_KINDS, value)) fail();
  return value;
}

function safeResourceKind(value, action) {
  if (
    typeof value !== 'string'
    || !ACTION_RESOURCE_KINDS[action].includes(value)
  ) fail();
  return value;
}

function safeResourceId(value) {
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || !RESOURCE_ID_PATTERN.test(value)
  ) fail();
  return value;
}

function safeGrantRequest(value) {
  const descriptors = exactDescriptors(value, REQUEST_KEYS);
  const action = safeAction(descriptors.action.value);
  return Object.freeze({
    project_id: safeProjectId(descriptors.project_id.value),
    action,
    resource_kind: safeResourceKind(descriptors.resource_kind.value, action),
    resource_id: safeResourceId(descriptors.resource_id.value),
  });
}

function createBuilderPermissionIpcRuntime(rawOptions) {
  const options = safeOptions(rawOptions);
  let store = null;
  let evaluator = null;
  let adapter;

  try {
    const permissionRoot = path.join(options.userDataPath, PERMISSION_DIRECTORY);
    fs.mkdirSync(permissionRoot, { recursive: true, mode: 0o700 });
    store = createBuilderPermissionFactStore(path.join(permissionRoot, PERMISSION_DATABASE));
    evaluator = store.create_evaluator();
    adapter = createBuilderPermissionIpcAdapter({
      async evaluatePermission(request) {
        return evaluator.evaluate({
          policy_version: BUILDER_PERMISSION_POLICY_VERSION,
          actor_id: LOCAL_BUILDER_USER_ACTOR_ID,
          action: request.action,
          resource: {
            resource_kind: request.resource_kind,
            project_id: request.project_id,
            resource_id: request.resource_id,
          },
          now_ms: currentTime(options),
        });
      },
      mainWindowRef: options.mainWindowRef,
    });
  } catch {
    try { store?.close(); } catch { /* fixed failure below */ }
    fail();
  }

  const handlers = Object.freeze([
    Object.freeze({ channel: EVALUATE_PERMISSION_CHANNEL, invoke: adapter.channels.evaluate.invoke }),
  ]);
  const installed = [];
  let state = 'idle';

  async function grantForExplicitApproval(rawRequest) {
    if (state !== 'registered') fail();
    const request = safeGrantRequest(rawRequest);
    const nowMs = currentTime(options);
    const resource = Object.freeze({
      resource_kind: request.resource_kind,
      project_id: request.project_id,
      resource_id: request.resource_id,
    });
    const existing = await evaluator.evaluate({
      policy_version: BUILDER_PERMISSION_POLICY_VERSION,
      actor_id: LOCAL_BUILDER_USER_ACTOR_ID,
      action: request.action,
      resource,
      now_ms: nowMs,
    });
    if (existing.decision === 'allowed') {
      return Object.freeze({
        result_version: 'builder-permission-grant-result.v1',
        project_id: request.project_id,
        action: request.action,
        resource,
        operation: 'grant_existing',
        granted_at_ms: nowMs,
        permission_id: existing.permission_id,
        permission_authority: 'builder_permission_facts_deny_by_default_v1',
        ui_selection_authority: 'main_owned_explicit_user_approval_required',
        preload_exposure: false,
      });
    }
    const grant = createBuilderPermissionGrantRecord({
      record_version: 'builder-permission-grant.v1',
      policy_version: BUILDER_PERMISSION_POLICY_VERSION,
      project_id: request.project_id,
      actor_id: LOCAL_BUILDER_USER_ACTOR_ID,
      issuer_id: LOCAL_BUILDER_USER_ACTOR_ID,
      scope_kind: 'project',
      action: request.action,
      resource,
      issued_at_ms: nowMs,
      expires_at_ms: null,
    });
    const recorded = store.record_grant({ grant });
    return Object.freeze({
      result_version: 'builder-permission-grant-result.v1',
      project_id: request.project_id,
      action: request.action,
      resource,
      operation: recorded.operation === 'grant_replayed' ? 'grant_existing' : recorded.operation,
      granted_at_ms: grant.issued_at_ms,
      permission_id: grant.permission_id,
      permission_authority: 'builder_permission_facts_deny_by_default_v1',
      ui_selection_authority: 'main_owned_explicit_user_approval_required',
      preload_exposure: false,
    });
  }

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

  function closeStore() {
    if (store === null) return true;
    try {
      store.close();
      store = null;
      return true;
    } catch {
      return false;
    }
  }

  return Object.freeze({
    runtime_version: BUILDER_PERMISSION_IPC_RUNTIME_VERSION,
    channels: Object.freeze(handlers.map(({ channel }) => channel)),
    grantForExplicitApproval,
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
        const closed = closeStore();
        state = removed && closed ? 'disposed' : 'cleanup_required';
        fail(state === 'cleanup_required'
          ? 'builder_permission_ipc_runtime_cleanup_required'
          : undefined);
      }
    },
    dispose() {
      if (state === 'disposed') return false;
      if (state === 'idle') {
        const closed = closeStore();
        if (!closed) {
          state = 'cleanup_required';
          fail('builder_permission_ipc_runtime_cleanup_required');
        }
        state = 'disposed';
        return false;
      }
      const removed = removeInstalledHandlers();
      const closed = closeStore();
      if (!removed || !closed) {
        state = 'cleanup_required';
        fail('builder_permission_ipc_runtime_cleanup_required');
      }
      state = 'disposed';
      return true;
    },
  });
}

module.exports = Object.freeze({
  BUILDER_PERMISSION_IPC_RUNTIME_VERSION,
  PERMISSION_DIRECTORY,
  PERMISSION_DATABASE,
  LOCAL_BUILDER_USER_ACTOR_ID,
  BuilderPermissionIpcRuntimeError,
  createBuilderPermissionIpcRuntime,
});
