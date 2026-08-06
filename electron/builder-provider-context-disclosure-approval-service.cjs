'use strict';

const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderProviderContextDisclosureRequestPreparation,
} = require('./builder-provider-context-disclosure-request-service.cjs');

const PROVIDER_CONTEXT_DISCLOSURE_APPROVAL_SERVICE_VERSION =
  'builder-provider-context-disclosure-approval-service.v1';
const PROVIDER_CONTEXT_DISCLOSURE_APPROVAL_RESULT_VERSION =
  'builder-provider-context-disclosure-approval-result.v1';

const OPTION_KEYS = Object.freeze(['grant_permission_for_explicit_approval']);
const APPROVE_KEYS = Object.freeze(['disclosure_request_preparation']);
const RESOURCE_KEYS = Object.freeze(['resource_kind', 'project_id', 'resource_id']);
const GRANT_RESULT_KEYS = Object.freeze([
  'result_version',
  'project_id',
  'action',
  'resource',
  'operation',
  'granted_at_ms',
  'permission_id',
  'permission_authority',
  'ui_selection_authority',
  'preload_exposure',
]);
const RESULT_KEYS = Object.freeze([
  'result_version',
  'project_id',
  'operation',
  'approval_scope',
  'provider_scope',
  'purpose',
  'authority',
]);
const AUTHORITY_KEYS = Object.freeze([
  'provider_context_disclosure_approval',
  'disclosure_request_preparation',
  'renderer_authority',
  'permission_grant',
  'provider_context_body',
  'provider_dispatch',
  'prompt_bridge',
  'tool_dispatch',
  'source_read',
  'source_write',
  'git_mutation',
  'sqlite_write',
  'revision_admission',
  'ipc_registration',
  'preload_exposure',
]);

const AUTHORITY = Object.freeze({
  provider_context_disclosure_approval:
    'main_owned_prepared_disclosure_request_approval_v1',
  disclosure_request_preparation: 'caller_provided_verified',
  renderer_authority: 'not_accepted',
  permission_grant: 'main_owned_explicit_user_approval_required',
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

const ACTION = 'context.disclose';
const RESOURCE_KIND = 'provider';
const PROVIDER_SCOPE = 'configured_provider';
const APPROVAL_SCOPE = 'configured_provider_purpose';
const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RESOURCE_ID_PATTERN = /^provider:configured\/(?:answer|plan|contextual_build)$/u;
const PERMISSION_ID_PATTERN = /^builder-permission:[0-9a-f]{64}$/u;
const PURPOSES = Object.freeze(['answer', 'plan', 'contextual_build']);

class BuilderProviderContextDisclosureApprovalServiceError extends Error {
  constructor() {
    super('The provider context disclosure approval could not be verified.');
    this.name = 'BuilderProviderContextDisclosureApprovalServiceError';
    this.code = 'builder_provider_context_disclosure_approval_unavailable';
    this.retryable = true;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderProviderContextDisclosureApprovalServiceError(); }

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

function safeEnum(value, allowed) {
  if (typeof value !== 'string' || !allowed.includes(value)) fail();
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
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
  return freezeDeep({
    grantPermissionForExplicitApproval: stableMethod(source, 'grant_permission_for_explicit_approval'),
  });
}

function sanitizeRequestedResource(value, expectedProjectId) {
  const source = exactObject(value, RESOURCE_KEYS);
  const resource = freezeDeep({
    resource_kind: valueAt(source, 'resource_kind') === RESOURCE_KIND ? RESOURCE_KIND : fail(),
    project_id: safePattern(valueAt(source, 'project_id'), PROJECT_ID_PATTERN),
    resource_id: safePattern(valueAt(source, 'resource_id'), RESOURCE_ID_PATTERN),
  });
  if (resource.project_id !== expectedProjectId) fail();
  return resource;
}

function approvalRequestFromPreparation(rawInput) {
  const input = exactObject(rawInput, APPROVE_KEYS);
  const preparation = sanitizeBuilderProviderContextDisclosureRequestPreparation(
    valueAt(input, 'disclosure_request_preparation'),
  );
  if (
    preparation.projection_status !== 'blocked'
    || preparation.provider_context_disclosure_request === null
  ) fail();
  const request = preparation.provider_context_disclosure_request;
  const disclosure = request.disclosure_request;
  if (
    disclosure.action !== ACTION
    || disclosure.approval_scope !== APPROVAL_SCOPE
    || disclosure.provider_scope !== PROVIDER_SCOPE
  ) fail();
  const resource = sanitizeRequestedResource(disclosure.resource, preparation.project_id);
  return freezeDeep({
    project_id: preparation.project_id,
    action: ACTION,
    resource_kind: RESOURCE_KIND,
    resource_id: resource.resource_id,
    provider_scope: PROVIDER_SCOPE,
    purpose: safeEnum(disclosure.purpose, PURPOSES),
  });
}

function sanitizeGrantResource(value, expected) {
  const source = exactObject(value, RESOURCE_KEYS);
  const resource = freezeDeep({
    resource_kind: valueAt(source, 'resource_kind') === RESOURCE_KIND ? RESOURCE_KIND : fail(),
    project_id: safePattern(valueAt(source, 'project_id'), PROJECT_ID_PATTERN),
    resource_id: safePattern(valueAt(source, 'resource_id'), RESOURCE_ID_PATTERN),
  });
  if (
    resource.project_id !== expected.project_id
    || resource.resource_id !== expected.resource_id
  ) fail();
  return resource;
}

function sanitizeGrantResult(value, expected) {
  const source = exactObject(value, GRANT_RESULT_KEYS);
  const operation = safeEnum(valueAt(source, 'operation'), ['grant_recorded', 'grant_existing']);
  if (
    valueAt(source, 'result_version') !== 'builder-permission-grant-result.v1'
    || safePattern(valueAt(source, 'project_id'), PROJECT_ID_PATTERN) !== expected.project_id
    || valueAt(source, 'action') !== ACTION
    || valueAt(source, 'permission_authority') !== 'builder_permission_facts_deny_by_default_v1'
    || valueAt(source, 'ui_selection_authority') !== 'main_owned_explicit_user_approval_required'
    || valueAt(source, 'preload_exposure') !== false
  ) fail();
  sanitizeGrantResource(valueAt(source, 'resource'), expected);
  safeTimestamp(valueAt(source, 'granted_at_ms'));
  safePattern(valueAt(source, 'permission_id'), PERMISSION_ID_PATTERN);
  return freezeDeep({ operation });
}

function resultRecord(request, grantResult) {
  return freezeDeep({
    result_version: PROVIDER_CONTEXT_DISCLOSURE_APPROVAL_RESULT_VERSION,
    project_id: request.project_id,
    operation: grantResult.operation === 'grant_recorded'
      ? 'approval_recorded'
      : 'already_approved',
    approval_scope: APPROVAL_SCOPE,
    provider_scope: PROVIDER_SCOPE,
    purpose: request.purpose,
    authority: { ...AUTHORITY },
  });
}

function sanitizeBuilderProviderContextDisclosureApprovalResult(value) {
  const source = exactObject(value, RESULT_KEYS);
  if (valueAt(source, 'result_version') !== PROVIDER_CONTEXT_DISCLOSURE_APPROVAL_RESULT_VERSION) fail();
  const authority = exactObject(valueAt(source, 'authority'), AUTHORITY_KEYS);
  for (const key of AUTHORITY_KEYS) {
    if (valueAt(authority, key) !== valueAt(AUTHORITY, key)) fail();
  }
  return freezeDeep({
    result_version: PROVIDER_CONTEXT_DISCLOSURE_APPROVAL_RESULT_VERSION,
    project_id: safePattern(valueAt(source, 'project_id'), PROJECT_ID_PATTERN),
    operation: safeEnum(valueAt(source, 'operation'), ['approval_recorded', 'already_approved']),
    approval_scope: valueAt(source, 'approval_scope') === APPROVAL_SCOPE ? APPROVAL_SCOPE : fail(),
    provider_scope: valueAt(source, 'provider_scope') === PROVIDER_SCOPE ? PROVIDER_SCOPE : fail(),
    purpose: safeEnum(valueAt(source, 'purpose'), PURPOSES),
    authority: { ...AUTHORITY },
  });
}

function createBuilderProviderContextDisclosureApprovalService(rawOptions) {
  const options = safeOptions(rawOptions);

  async function approvePreparedProviderContextDisclosure(rawInput) {
    try {
      const request = approvalRequestFromPreparation(rawInput);
      const grantResult = sanitizeGrantResult(
        await Reflect.apply(options.grantPermissionForExplicitApproval, undefined, [{
          project_id: request.project_id,
          action: request.action,
          resource_kind: request.resource_kind,
          resource_id: request.resource_id,
        }]),
        request,
      );
      return resultRecord(request, grantResult);
    } catch {
      fail();
    }
    return null;
  }

  return freezeDeep({
    service_version: PROVIDER_CONTEXT_DISCLOSURE_APPROVAL_SERVICE_VERSION,
    authority: { ...AUTHORITY },
    approve_prepared_provider_context_disclosure: approvePreparedProviderContextDisclosure,
  });
}

module.exports = freezeDeep({
  PROVIDER_CONTEXT_DISCLOSURE_APPROVAL_SERVICE_VERSION,
  PROVIDER_CONTEXT_DISCLOSURE_APPROVAL_RESULT_VERSION,
  BuilderProviderContextDisclosureApprovalServiceError,
  createBuilderProviderContextDisclosureApprovalService,
  sanitizeBuilderProviderContextDisclosureApprovalResult,
});
