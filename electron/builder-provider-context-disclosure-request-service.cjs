'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderContextAssembly,
} = require('./builder-context-assembler.cjs');
const {
  sanitizeBuilderProviderContextProjection,
} = require('./builder-provider-context-projection.cjs');
const {
  createBuilderProviderContextDisclosureRequest,
  sanitizeBuilderProviderContextDisclosureRequest,
} = require('./builder-provider-context-disclosure-request.cjs');

const PROVIDER_CONTEXT_DISCLOSURE_REQUEST_PREPARATION_VERSION =
  'builder-provider-context-disclosure-request-preparation.v1';

const INPUT_KEYS = Object.freeze([
  'context_assembly',
  'provider_context_projection',
  'requested_at_ms',
]);
const RESULT_KEYS = Object.freeze([
  'result_version',
  'preparation_id',
  'project_id',
  'requested_at_ms',
  'projection_status',
  'blocked_reason',
  'provider_context_disclosure_request',
  'authority',
]);
const AUTHORITY_KEYS = Object.freeze([
  'provider_context_disclosure_request_preparation',
  'context_assembly',
  'provider_context_projection',
  'renderer_authority',
  'provider_context_body',
  'provider_dispatch',
  'tool_dispatch',
  'source_mutation',
  'git_mutation',
  'sqlite_write',
  'permission_grant',
  'revision_admission',
  'ipc_registration',
]);

const AUTHORITY = Object.freeze({
  provider_context_disclosure_request_preparation:
    'main_side_projection_bound_request_preparation_v1',
  context_assembly: 'caller_provided_verified',
  provider_context_projection: 'caller_provided_verified',
  renderer_authority: 'not_accepted',
  provider_context_body: 'not_included',
  provider_dispatch: 'not_performed',
  tool_dispatch: 'not_performed',
  source_mutation: 'not_performed',
  git_mutation: 'not_performed',
  sqlite_write: 'not_performed',
  permission_grant: 'not_performed',
  revision_admission: 'not_performed',
  ipc_registration: 'not_performed',
});

const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PREPARATION_ID_PATTERN =
  /^builder-provider-context-disclosure-request-preparation:[0-9a-f]{64}$/u;

class BuilderProviderContextDisclosureRequestPreparationError extends Error {
  constructor() {
    super('The provider context disclosure request preparation could not be verified.');
    this.name = 'BuilderProviderContextDisclosureRequestPreparationError';
    this.code = 'builder_provider_context_disclosure_request_preparation_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderProviderContextDisclosureRequestPreparationError(); }

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
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) {
    fail();
  }
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

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isPlainObject(value)) fail();
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`).join(',')}}`;
}

function digest(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function digestId(prefix, value) {
  return `${prefix}:${digest(value).slice('sha256:'.length)}`;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function nullable(value, sanitizer) {
  return value === null ? null : sanitizer(value);
}

function sanitizeProjectionStatus(value) {
  if (value !== 'blocked' && value !== 'ready') fail();
  return value;
}

function sanitizeBlockedReason(value) {
  if (value !== 'context_disclosure_not_approved' && value !== 'context_disclosure_denied') fail();
  return value;
}

function sanitizeAuthority(value) {
  exactObject(value, AUTHORITY_KEYS);
  if (canonicalJson(value) !== canonicalJson(AUTHORITY)) fail();
  return freezeDeep({ ...AUTHORITY });
}

function assertProjectionBoundToAssembly(projection, assembly) {
  if (
    projection.source_refs.assembly_id !== assembly.assembly_id
    || projection.source_refs.context_digest !== assembly.context_digest
  ) fail();
}

function requestForProjection(assembly, projection, requestedAtMs) {
  if (projection.projection_status === 'ready') return null;
  if (projection.projection_status !== 'blocked' || projection.blocked_reason === null) fail();
  try {
    return createBuilderProviderContextDisclosureRequest({
      context_assembly: assembly,
      requested_at_ms: requestedAtMs,
    });
  } catch {
    fail();
  }
  return null;
}

function sanitizeNestedDisclosureRequest(value) {
  try {
    return sanitizeBuilderProviderContextDisclosureRequest(value);
  } catch {
    fail();
  }
  return null;
}

function bodyFor(assembly, projection, requestedAtMs) {
  if (projection.projected_at_ms > requestedAtMs) fail();
  assertProjectionBoundToAssembly(projection, assembly);
  return freezeDeep({
    project_id: assembly.project_id,
    requested_at_ms: requestedAtMs,
    projection_status: projection.projection_status,
    blocked_reason: projection.blocked_reason,
    provider_context_disclosure_request: requestForProjection(assembly, projection, requestedAtMs),
  });
}

function withPreparationId(body) {
  return freezeDeep({
    result_version: PROVIDER_CONTEXT_DISCLOSURE_REQUEST_PREPARATION_VERSION,
    preparation_id: digestId('builder-provider-context-disclosure-request-preparation', body),
    ...body,
    authority: { ...AUTHORITY },
  });
}

function prepareBuilderProviderContextDisclosureRequest(rawInput) {
  const input = exactObject(rawInput, INPUT_KEYS);
  const requestedAtMs = safeTimestamp(valueAt(input, 'requested_at_ms'));
  const assembly = sanitizeBuilderContextAssembly(valueAt(input, 'context_assembly'));
  const projection = sanitizeBuilderProviderContextProjection(valueAt(input, 'provider_context_projection'));
  return withPreparationId(bodyFor(assembly, projection, requestedAtMs));
}

function sanitizeBuilderProviderContextDisclosureRequestPreparation(value) {
  const source = exactObject(value, RESULT_KEYS);
  if (valueAt(source, 'result_version') !== PROVIDER_CONTEXT_DISCLOSURE_REQUEST_PREPARATION_VERSION) fail();
  const body = freezeDeep({
    project_id: safePattern(valueAt(source, 'project_id'), PROJECT_ID_PATTERN),
    requested_at_ms: safeTimestamp(valueAt(source, 'requested_at_ms')),
    projection_status: sanitizeProjectionStatus(valueAt(source, 'projection_status')),
    blocked_reason: nullable(valueAt(source, 'blocked_reason'), sanitizeBlockedReason),
    provider_context_disclosure_request: nullable(
      valueAt(source, 'provider_context_disclosure_request'),
      sanitizeNestedDisclosureRequest,
    ),
  });
  if (
    (body.projection_status === 'blocked') !== (body.blocked_reason !== null)
    || (body.projection_status === 'blocked') !== (body.provider_context_disclosure_request !== null)
    || (
      body.provider_context_disclosure_request !== null
      && body.provider_context_disclosure_request.project_id !== body.project_id
    )
  ) fail();
  const normalized = withPreparationId(body);
  if (
    valueAt(source, 'preparation_id') !== normalized.preparation_id
    || safePattern(valueAt(source, 'preparation_id'), PREPARATION_ID_PATTERN) !== normalized.preparation_id
  ) fail();
  return freezeDeep({
    ...normalized,
    authority: sanitizeAuthority(valueAt(source, 'authority')),
  });
}

module.exports = Object.freeze({
  PROVIDER_CONTEXT_DISCLOSURE_REQUEST_PREPARATION_VERSION,
  BuilderProviderContextDisclosureRequestPreparationError,
  prepareBuilderProviderContextDisclosureRequest,
  sanitizeBuilderProviderContextDisclosureRequestPreparation,
});
