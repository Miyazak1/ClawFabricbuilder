'use strict';

const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderProviderContextDisclosureRequestPreparation,
} = require('./builder-provider-context-disclosure-request-service.cjs');
const {
  sanitizeBuilderProviderContextDisclosureApprovalResult,
} = require('./builder-provider-context-disclosure-approval-service.cjs');

const PROVIDER_CONTEXT_DISCLOSURE_CURRENT_APPROVAL_GATE_VERSION =
  'builder-provider-context-disclosure-current-approval-gate.v1';

const OPTION_KEYS = Object.freeze([
  'provider_context_disclosure_status_service',
  'provider_context_disclosure_approval_service',
]);
const REQUEST_KEYS = Object.freeze(['project_id', 'conversation_id']);
const STATUS_READ_RESULT_KEYS = Object.freeze([
  'result_version',
  'operation',
  'project_id',
  'conversation_id',
  'disclosure_request_preparation',
  'authority',
]);
const AUTHORITY = Object.freeze({
  current_approval_gate: 'main_owned_current_disclosure_preparation_gate_v1',
  status_service: 'main_only_in_memory_preparation_reader',
  approval_service: 'main_owned_prepared_disclosure_request_approval_v1',
  renderer_authority: 'not_accepted',
  provider_context_body: 'not_present',
  provider_dispatch: false,
  prompt_bridge: false,
  tool_dispatch: false,
  source_read: 'not_performed',
  source_write: 'not_performed',
  git_mutation: false,
  sqlite_write: false,
  revision_admission: 'not_created',
  ipc_registration: 'not_performed',
  preload_exposure: false,
});

const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const STATUS_SERVICE_VERSION = 'builder-provider-context-disclosure-status-service.v1';

class BuilderProviderContextDisclosureCurrentApprovalGateError extends Error {
  constructor() {
    super('The current provider context disclosure approval could not be verified.');
    this.name = 'BuilderProviderContextDisclosureCurrentApprovalGateError';
    this.code = 'builder_provider_context_disclosure_current_approval_unavailable';
    this.retryable = true;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderProviderContextDisclosureCurrentApprovalGateError(); }

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
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return value;
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function stableMethod(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (
    !descriptor
    || descriptor.enumerable !== true
    || !Object.hasOwn(descriptor, 'value')
    || typeof descriptor.value !== 'function'
    || utilTypes.isProxy(descriptor.value)
  ) fail();
  return descriptor.value;
}

function safeOptions(value) {
  const source = exactObject(value, OPTION_KEYS);
  const statusService = exactObject(valueAt(source, 'provider_context_disclosure_status_service'), [
    'service_version',
    'record_current_provider_context_disclosure_status',
    'read_current_provider_context_disclosure_status_for_conversation',
    'read_current_provider_context_disclosure_request_preparation_for_conversation',
    'clear_current_provider_context_disclosure_status_for_conversation',
  ]);
  const approvalService = exactObject(valueAt(source, 'provider_context_disclosure_approval_service'), [
    'service_version',
    'authority',
    'approve_prepared_provider_context_disclosure',
  ]);
  return freezeDeep({
    readPreparation: stableMethod(
      statusService,
      'read_current_provider_context_disclosure_request_preparation_for_conversation',
    ),
    approvePreparedDisclosure: stableMethod(
      approvalService,
      'approve_prepared_provider_context_disclosure',
    ),
    statusService,
    approvalService,
  });
}

function currentApprovalRequest(rawRequest) {
  const request = exactObject(rawRequest, REQUEST_KEYS);
  return freezeDeep({
    project_id: safePattern(valueAt(request, 'project_id'), PROJECT_ID_PATTERN),
    conversation_id: safePattern(valueAt(request, 'conversation_id'), CONVERSATION_ID_PATTERN),
  });
}

function sanitizePreparationReadResult(value, request) {
  const source = exactObject(value, STATUS_READ_RESULT_KEYS);
  if (
    valueAt(source, 'result_version') !== STATUS_SERVICE_VERSION
    || valueAt(source, 'operation') !== 'provider_context_disclosure_request_preparation_read'
    || safePattern(valueAt(source, 'project_id'), PROJECT_ID_PATTERN) !== request.project_id
    || safePattern(valueAt(source, 'conversation_id'), CONVERSATION_ID_PATTERN) !== request.conversation_id
  ) fail();
  const preparation = sanitizeBuilderProviderContextDisclosureRequestPreparation(
    valueAt(source, 'disclosure_request_preparation'),
  );
  if (
    preparation.project_id !== request.project_id
    || preparation.projection_status !== 'blocked'
    || preparation.blocked_reason !== 'context_disclosure_not_approved'
    || preparation.provider_context_disclosure_request === null
  ) fail();
  return preparation;
}

function resultRecord(request, approvalResult) {
  return freezeDeep({
    result_version: PROVIDER_CONTEXT_DISCLOSURE_CURRENT_APPROVAL_GATE_VERSION,
    project_id: request.project_id,
    conversation_id: request.conversation_id,
    operation: approvalResult.operation,
    approval_scope: approvalResult.approval_scope,
    provider_scope: approvalResult.provider_scope,
    purpose: approvalResult.purpose,
    authority: { ...AUTHORITY },
  });
}

function createBuilderProviderContextDisclosureCurrentApprovalGate(rawOptions) {
  const options = safeOptions(rawOptions);

  async function approveCurrentProviderContextDisclosure(rawRequest) {
    try {
      const request = currentApprovalRequest(rawRequest);
      const preparation = sanitizePreparationReadResult(
        Reflect.apply(options.readPreparation, options.statusService, [request]),
        request,
      );
      const approvalResult = sanitizeBuilderProviderContextDisclosureApprovalResult(
        await Reflect.apply(options.approvePreparedDisclosure, options.approvalService, [{
          disclosure_request_preparation: preparation,
        }]),
      );
      if (approvalResult.project_id !== request.project_id) fail();
      return resultRecord(request, approvalResult);
    } catch {
      fail();
    }
    return null;
  }

  return freezeDeep({
    service_version: PROVIDER_CONTEXT_DISCLOSURE_CURRENT_APPROVAL_GATE_VERSION,
    authority: { ...AUTHORITY },
    approve_current_provider_context_disclosure: approveCurrentProviderContextDisclosure,
  });
}

module.exports = freezeDeep({
  PROVIDER_CONTEXT_DISCLOSURE_CURRENT_APPROVAL_GATE_VERSION,
  BuilderProviderContextDisclosureCurrentApprovalGateError,
  createBuilderProviderContextDisclosureCurrentApprovalGate,
});
