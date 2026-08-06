'use strict';

const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderContextAssembly,
} = require('./builder-context-assembler.cjs');
const {
  sanitizeBuilderProviderContextProjection,
} = require('./builder-provider-context-projection.cjs');
const {
  prepareBuilderProviderContextDisclosureRequest,
  sanitizeBuilderProviderContextDisclosureRequestPreparation,
} = require('./builder-provider-context-disclosure-request-service.cjs');
const {
  projectBuilderProviderContextDisclosureStatus,
  sanitizeBuilderProviderContextDisclosureStatusProjection,
} = require('./builder-provider-context-disclosure-status-projection.cjs');

const BUILDER_PROVIDER_CONTEXT_DISCLOSURE_STATUS_SERVICE_VERSION =
  'builder-provider-context-disclosure-status-service.v1';

const REQUEST_KEYS = Object.freeze(['project_id', 'conversation_id']);
const RECORD_KEYS = Object.freeze([
  'project_id',
  'conversation_id',
  'context_assembly',
  'provider_context_projection',
  'recorded_at_ms',
]);
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');

const AUTHORITY = Object.freeze({
  status_service: 'main_owned_provider_context_disclosure_status_service_v1',
  context_assembly: 'caller_provided_verified_not_exposed',
  provider_context_projection: 'caller_provided_verified_not_exposed',
  disclosure_request_preparation: 'in_memory_main_only_not_renderer_exposed',
  storage: 'process_memory_only',
  renderer_authority: 'not_present',
  provider_context_body: 'not_exposed',
  provider_dispatch: false,
  tool_dispatch: false,
  source_read: 'not_present',
  source_write: 'not_present',
  git_mutation: false,
  sqlite_write: false,
  permission_grant: false,
  revision_admission: 'not_created',
  ipc_registration: 'not_performed',
});

class BuilderProviderContextDisclosureStatusServiceError extends Error {
  constructor() {
    super('Builder provider context disclosure status is unavailable.');
    this.name = 'BuilderProviderContextDisclosureStatusServiceError';
    this.code = 'builder_provider_context_disclosure_status_service_unavailable';
    this.retryable = true;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderProviderContextDisclosureStatusServiceError(); }

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail();
  for (const key of actual) {
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

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function conversationRequest(rawRequest) {
  const request = exactObject(rawRequest, REQUEST_KEYS);
  return freezeDeep({
    project_id: safePattern(valueAt(request, 'project_id'), PROJECT_ID_PATTERN),
    conversation_id: safePattern(valueAt(request, 'conversation_id'), CONVERSATION_ID_PATTERN),
  });
}

function statusKey(request) {
  return `${request.project_id}\n${request.conversation_id}`;
}

function readResult(request, statusProjection) {
  return freezeDeep({
    result_version: BUILDER_PROVIDER_CONTEXT_DISCLOSURE_STATUS_SERVICE_VERSION,
    operation: statusProjection === null
      ? 'provider_context_disclosure_status_absent'
      : 'provider_context_disclosure_status_read',
    project_id: request.project_id,
    conversation_id: request.conversation_id,
    provider_context_disclosure_status_projection: statusProjection,
    authority: { ...AUTHORITY },
  });
}

function readPreparationResult(request, preparation) {
  return freezeDeep({
    result_version: BUILDER_PROVIDER_CONTEXT_DISCLOSURE_STATUS_SERVICE_VERSION,
    operation: preparation === null
      ? 'provider_context_disclosure_request_preparation_absent'
      : 'provider_context_disclosure_request_preparation_read',
    project_id: request.project_id,
    conversation_id: request.conversation_id,
    disclosure_request_preparation: preparation,
    authority: { ...AUTHORITY },
  });
}

function recordResult(request, statusProjection) {
  return freezeDeep({
    result_version: BUILDER_PROVIDER_CONTEXT_DISCLOSURE_STATUS_SERVICE_VERSION,
    operation: 'provider_context_disclosure_status_recorded',
    project_id: request.project_id,
    conversation_id: request.conversation_id,
    provider_context_disclosure_status_projection: statusProjection,
    authority: { ...AUTHORITY },
  });
}

function clearResult(request, cleared) {
  return freezeDeep({
    result_version: BUILDER_PROVIDER_CONTEXT_DISCLOSURE_STATUS_SERVICE_VERSION,
    operation: 'provider_context_disclosure_status_cleared',
    project_id: request.project_id,
    conversation_id: request.conversation_id,
    cleared,
    authority: { ...AUTHORITY },
  });
}

function recordRequest(rawRequest) {
  const source = exactObject(rawRequest, RECORD_KEYS);
  const request = freezeDeep({
    project_id: safePattern(valueAt(source, 'project_id'), PROJECT_ID_PATTERN),
    conversation_id: safePattern(valueAt(source, 'conversation_id'), CONVERSATION_ID_PATTERN),
  });
  const contextAssembly = sanitizeBuilderContextAssembly(valueAt(source, 'context_assembly'));
  const providerContextProjection = sanitizeBuilderProviderContextProjection(
    valueAt(source, 'provider_context_projection'),
  );
  const recordedAtMs = safeTimestamp(valueAt(source, 'recorded_at_ms'));
  if (
    contextAssembly.project_id !== request.project_id
    || providerContextProjection.source_refs.assembly_id !== contextAssembly.assembly_id
    || providerContextProjection.source_refs.context_digest !== contextAssembly.context_digest
    || providerContextProjection.projected_at_ms > recordedAtMs
  ) fail();
  return { request, contextAssembly, providerContextProjection, recordedAtMs };
}

function createDisclosureRequestPreparation(record) {
  return prepareBuilderProviderContextDisclosureRequest({
    context_assembly: record.contextAssembly,
    provider_context_projection: record.providerContextProjection,
    requested_at_ms: record.recordedAtMs,
  });
}

function createStatusProjection(preparation) {
  return projectBuilderProviderContextDisclosureStatus({
    disclosure_request_preparation: preparation,
  });
}

function createBuilderProviderContextDisclosureStatusService() {
  const currentRecords = new Map();

  return Object.freeze({
    service_version: BUILDER_PROVIDER_CONTEXT_DISCLOSURE_STATUS_SERVICE_VERSION,
    record_current_provider_context_disclosure_status(rawRequest) {
      try {
        const record = recordRequest(rawRequest);
        const disclosureRequestPreparation = sanitizeBuilderProviderContextDisclosureRequestPreparation(
          createDisclosureRequestPreparation(record),
        );
        const statusProjection = createStatusProjection(disclosureRequestPreparation);
        const storedProjection = sanitizeBuilderProviderContextDisclosureStatusProjection(
          statusProjection,
        );
        currentRecords.set(statusKey(record.request), freezeDeep({
          disclosureRequestPreparation,
          statusProjection: storedProjection,
        }));
        return recordResult(record.request, storedProjection);
      } catch {
        fail();
      }
      return null;
    },
    read_current_provider_context_disclosure_status_for_conversation(rawRequest) {
      try {
        const request = conversationRequest(rawRequest);
        const storedRecord = currentRecords.get(statusKey(request));
        return readResult(request, storedRecord === undefined ? null : storedRecord.statusProjection);
      } catch {
        fail();
      }
      return null;
    },
    read_current_provider_context_disclosure_request_preparation_for_conversation(rawRequest) {
      try {
        const request = conversationRequest(rawRequest);
        const storedRecord = currentRecords.get(statusKey(request));
        return readPreparationResult(
          request,
          storedRecord === undefined ? null : storedRecord.disclosureRequestPreparation,
        );
      } catch {
        fail();
      }
      return null;
    },
    clear_current_provider_context_disclosure_status_for_conversation(rawRequest) {
      try {
        const request = conversationRequest(rawRequest);
        const key = statusKey(request);
        const cleared = currentRecords.delete(key);
        return clearResult(request, cleared);
      } catch {
        fail();
      }
      return null;
    },
  });
}

module.exports = Object.freeze({
  BUILDER_PROVIDER_CONTEXT_DISCLOSURE_STATUS_SERVICE_VERSION,
  BuilderProviderContextDisclosureStatusServiceError,
  createBuilderProviderContextDisclosureStatusService,
});
