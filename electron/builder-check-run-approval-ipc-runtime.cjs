'use strict';

const { types: utilTypes } = require('node:util');

const {
  APPROVE_CURRENT_DRAFT_CHECK_CHANNEL,
  READ_CURRENT_DRAFT_AVAILABLE_CHECKS_CHANNEL,
  createBuilderCheckRunApprovalIpcAdapter,
} = require('./builder-check-run-approval-ipc-adapter.cjs');
const {
  BUILDER_CHECK_RUN_CURRENT_DRAFT_SERVICE_VERSION,
} = require('./builder-check-run-current-draft-service.cjs');

const BUILDER_CHECK_RUN_APPROVAL_IPC_RUNTIME_VERSION =
  'builder-check-run-approval-ipc-runtime.v1';
const OPTION_KEYS = Object.freeze(['ipcMain', 'mainWindowRef', 'currentDraftCheckRunService']);
const SERVICE_KEYS = Object.freeze([
  'service_version',
  'read_available_checks',
  'run_approved_check',
]);

class BuilderCheckRunApprovalIpcRuntimeError extends Error {
  constructor(code = 'builder_check_run_approval_ipc_runtime_unavailable') {
    const selected = code === 'builder_check_run_approval_ipc_runtime_cleanup_required'
      ? code
      : 'builder_check_run_approval_ipc_runtime_unavailable';
    super(selected === 'builder_check_run_approval_ipc_runtime_cleanup_required'
      ? 'Project check cleanup is required.'
      : 'Project checks are unavailable.');
    this.name = 'BuilderCheckRunApprovalIpcRuntimeError';
    this.code = selected;
    this.retryable = selected === 'builder_check_run_approval_ipc_runtime_cleanup_required';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) { throw new BuilderCheckRunApprovalIpcRuntimeError(code); }

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

function safeService(value) {
  const descriptors = exactObject(value, SERVICE_KEYS);
  if (descriptors.service_version.value !== BUILDER_CHECK_RUN_CURRENT_DRAFT_SERVICE_VERSION) fail();
  for (const key of SERVICE_KEYS) {
    if (key === 'service_version') continue;
    if (typeof descriptors[key].value !== 'function' || utilTypes.isProxy(descriptors[key].value)) {
      fail();
    }
  }
  return value;
}

function safeOptions(value) {
  const descriptors = exactObject(value, OPTION_KEYS);
  const ipcMain = descriptors.ipcMain.value;
  const mainWindowRef = descriptors.mainWindowRef.value;
  if (
    ipcMain === null
    || typeof ipcMain !== 'object'
    || utilTypes.isProxy(ipcMain)
    || typeof mainWindowRef !== 'function'
    || utilTypes.isProxy(mainWindowRef)
  ) fail();
  return Object.freeze({
    ipcMain,
    handle: stableMethod(ipcMain, 'handle'),
    removeHandler: stableMethod(ipcMain, 'removeHandler'),
    mainWindowRef,
    currentDraftCheckRunService: safeService(descriptors.currentDraftCheckRunService.value),
  });
}

function createBuilderCheckRunApprovalIpcRuntime(rawOptions) {
  const options = safeOptions(rawOptions);
  const activeReads = new Map();
  const activeRuns = new Set();

  function readAvailableChecks(request) {
    const existing = activeReads.get(request.draft_id);
    if (existing !== undefined) return existing;
    const operation = Promise.resolve().then(() => Reflect.apply(
      options.currentDraftCheckRunService.read_available_checks,
      options.currentDraftCheckRunService,
      [request],
    ));
    activeReads.set(request.draft_id, operation);
    operation.finally(() => {
      if (activeReads.get(request.draft_id) === operation) activeReads.delete(request.draft_id);
    }).catch(() => undefined);
    return operation;
  }

  async function approveAndRunCheck(request) {
    if (activeRuns.has(request.draft_id)) {
      const error = new Error('A project check is already in progress.');
      error.code = 'builder_check_run_approval_busy';
      throw error;
    }
    activeRuns.add(request.draft_id);
    try {
      return await Reflect.apply(
        options.currentDraftCheckRunService.run_approved_check,
        options.currentDraftCheckRunService,
        [request],
      );
    } finally {
      activeRuns.delete(request.draft_id);
    }
  }

  let adapter;
  try {
    adapter = createBuilderCheckRunApprovalIpcAdapter({
      readCurrentDraftAvailableChecks: readAvailableChecks,
      approveAndRunCurrentDraftCheck: approveAndRunCheck,
      mainWindowRef: options.mainWindowRef,
    });
  } catch {
    fail();
  }
  const handlers = Object.freeze([
    Object.freeze({
      channel: READ_CURRENT_DRAFT_AVAILABLE_CHECKS_CHANNEL,
      invoke: adapter.channels.readCurrentDraftAvailableChecks.invoke,
    }),
    Object.freeze({
      channel: APPROVE_CURRENT_DRAFT_CHECK_CHANNEL,
      invoke: adapter.channels.approveAndRunCurrentDraftCheck.invoke,
    }),
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

  return Object.freeze({
    runtime_version: BUILDER_CHECK_RUN_APPROVAL_IPC_RUNTIME_VERSION,
    channels: Object.freeze(handlers.map(({ channel }) => channel)),
    register() {
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
        fail(state === 'cleanup_required'
          ? 'builder_check_run_approval_ipc_runtime_cleanup_required'
          : undefined);
      }
      return false;
    },
    dispose() {
      if (state === 'disposed') return false;
      if (state === 'idle') {
        state = 'disposed';
        return false;
      }
      if (state === 'draining') {
        if (activeReads.size > 0 || activeRuns.size > 0) {
          fail('builder_check_run_approval_ipc_runtime_cleanup_required');
        }
        state = 'disposed';
        return true;
      }
      if (!removeInstalledHandlers()) {
        state = 'cleanup_required';
        fail('builder_check_run_approval_ipc_runtime_cleanup_required');
      }
      if (activeReads.size > 0 || activeRuns.size > 0) {
        state = 'draining';
        fail('builder_check_run_approval_ipc_runtime_cleanup_required');
      }
      state = 'disposed';
      return true;
    },
  });
}

module.exports = Object.freeze({
  BUILDER_CHECK_RUN_APPROVAL_IPC_RUNTIME_VERSION,
  BuilderCheckRunApprovalIpcRuntimeError,
  createBuilderCheckRunApprovalIpcRuntime,
});
