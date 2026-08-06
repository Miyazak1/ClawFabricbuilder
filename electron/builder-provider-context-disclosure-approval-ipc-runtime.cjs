'use strict';

const { types: utilTypes } = require('node:util');

const {
  APPROVE_PROVIDER_CONTEXT_DISCLOSURE_CHANNEL,
  createBuilderProviderContextDisclosureApprovalIpcAdapter,
} = require('./builder-provider-context-disclosure-approval-ipc-adapter.cjs');
const {
  createBuilderProviderContextDisclosureApprovalService,
} = require('./builder-provider-context-disclosure-approval-service.cjs');
const {
  createBuilderProviderContextDisclosureCurrentApprovalGate,
} = require('./builder-provider-context-disclosure-current-approval-gate.cjs');

const BUILDER_PROVIDER_CONTEXT_DISCLOSURE_APPROVAL_IPC_RUNTIME_VERSION =
  'builder-provider-context-disclosure-approval-ipc-runtime.v1';

const OPTION_KEYS = Object.freeze([
  'ipcMain',
  'mainWindowRef',
  'providerContextDisclosureStatusService',
  'grantPermissionForExplicitApproval',
]);
const STATUS_SERVICE_KEYS = Object.freeze([
  'service_version',
  'record_current_provider_context_disclosure_status',
  'read_current_provider_context_disclosure_status_for_conversation',
  'read_current_provider_context_disclosure_request_preparation_for_conversation',
  'clear_current_provider_context_disclosure_status_for_conversation',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_provider_context_disclosure_approval_ipc_runtime_unavailable:
    'AI context approval is unavailable.',
  builder_provider_context_disclosure_approval_ipc_runtime_cleanup_required:
    'AI context approval cleanup is required.',
});

class BuilderProviderContextDisclosureApprovalIpcRuntimeError extends Error {
  constructor(code = 'builder_provider_context_disclosure_approval_ipc_runtime_unavailable') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_provider_context_disclosure_approval_ipc_runtime_unavailable';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderProviderContextDisclosureApprovalIpcRuntimeError';
    this.code = selected;
    this.retryable =
      selected === 'builder_provider_context_disclosure_approval_ipc_runtime_cleanup_required';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderProviderContextDisclosureApprovalIpcRuntimeError(code);
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

function exactDescriptors(value, keys) {
  if (!isPlainObject(value)) fail();
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length
    || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
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

function safeStatusService(value) {
  const descriptors = exactDescriptors(value, STATUS_SERVICE_KEYS);
  if (descriptors.service_version.value !== 'builder-provider-context-disclosure-status-service.v1') {
    fail();
  }
  for (const key of STATUS_SERVICE_KEYS) {
    if (key === 'service_version') continue;
    if (
      typeof descriptors[key].value !== 'function'
      || utilTypes.isProxy(descriptors[key].value)
    ) fail();
  }
  return value;
}

function safeOptions(value) {
  try {
    const descriptors = exactDescriptors(value, OPTION_KEYS);
    const ipcMain = descriptors.ipcMain.value;
    const mainWindowRef = descriptors.mainWindowRef.value;
    const grantPermissionForExplicitApproval = descriptors.grantPermissionForExplicitApproval.value;
    if (
      ipcMain === null
      || typeof ipcMain !== 'object'
      || utilTypes.isProxy(ipcMain)
      || typeof mainWindowRef !== 'function'
      || utilTypes.isProxy(mainWindowRef)
      || typeof grantPermissionForExplicitApproval !== 'function'
      || utilTypes.isProxy(grantPermissionForExplicitApproval)
    ) fail();
    return Object.freeze({
      ipcMain,
      handle: stableMethod(ipcMain, 'handle'),
      removeHandler: stableMethod(ipcMain, 'removeHandler'),
      mainWindowRef,
      providerContextDisclosureStatusService: safeStatusService(
        descriptors.providerContextDisclosureStatusService.value,
      ),
      grantPermissionForExplicitApproval,
    });
  } catch {
    fail();
  }
}

function createBuilderProviderContextDisclosureApprovalIpcRuntime(rawOptions) {
  const options = safeOptions(rawOptions);

  let adapter;
  try {
    const approvalService = createBuilderProviderContextDisclosureApprovalService({
      grant_permission_for_explicit_approval: options.grantPermissionForExplicitApproval,
    });
    const currentApprovalGate = createBuilderProviderContextDisclosureCurrentApprovalGate({
      provider_context_disclosure_status_service: options.providerContextDisclosureStatusService,
      provider_context_disclosure_approval_service: approvalService,
    });
    adapter = createBuilderProviderContextDisclosureApprovalIpcAdapter({
      approveCurrentProviderContextDisclosure:
        currentApprovalGate.approve_current_provider_context_disclosure,
      mainWindowRef: options.mainWindowRef,
    });
  } catch {
    fail();
  }

  const handlers = Object.freeze([
    Object.freeze({
      channel: APPROVE_PROVIDER_CONTEXT_DISCLOSURE_CHANNEL,
      invoke: adapter.channels.approveCurrent.invoke,
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
    runtime_version: BUILDER_PROVIDER_CONTEXT_DISCLOSURE_APPROVAL_IPC_RUNTIME_VERSION,
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
          ? 'builder_provider_context_disclosure_approval_ipc_runtime_cleanup_required'
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
      if (!removeInstalledHandlers()) {
        state = 'cleanup_required';
        fail('builder_provider_context_disclosure_approval_ipc_runtime_cleanup_required');
      }
      state = 'disposed';
      return true;
    },
  });
}

module.exports = Object.freeze({
  BUILDER_PROVIDER_CONTEXT_DISCLOSURE_APPROVAL_IPC_RUNTIME_VERSION,
  BuilderProviderContextDisclosureApprovalIpcRuntimeError,
  createBuilderProviderContextDisclosureApprovalIpcRuntime,
});
