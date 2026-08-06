'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderContextAssembly,
} = require('./builder-context-assembler.cjs');

const PROVIDER_CONTEXT_DISCLOSURE_REQUEST_VERSION = 'builder-provider-context-disclosure-request.v1';
const ACTION = 'context.disclose';
const PROVIDER_SCOPE = 'configured_provider';
const RESOURCE_KIND = 'provider';

const INPUT_KEYS = Object.freeze(['context_assembly', 'requested_at_ms']);
const RESULT_KEYS = Object.freeze([
  'result_version',
  'request_id',
  'project_id',
  'disclosure_request',
  'context_surface',
  'user_copy',
  'authority',
]);
const DISCLOSURE_REQUEST_KEYS = Object.freeze([
  'request_version',
  'approval_scope',
  'action',
  'resource',
  'provider_scope',
  'purpose',
  'requested_at_ms',
]);
const RESOURCE_KEYS = Object.freeze(['resource_kind', 'project_id', 'resource_id']);
const CONTEXT_SURFACE_KEYS = Object.freeze([
  'working_context_state_status',
  'segment_count',
  'segment_kinds',
  'omitted_ref_count',
  'budget',
  'permission_gate',
]);
const BUDGET_KEYS = Object.freeze(['used_prompt_bytes', 'max_prompt_bytes', 'reserved_response_bytes']);
const PERMISSION_GATE_KEYS = Object.freeze(['workspace_state', 'write_permission', 'side_effect_ready']);
const USER_COPY_KEYS = Object.freeze(['title', 'summary', 'details']);
const AUTHORITY_KEYS = Object.freeze([
  'provider_context_disclosure_request',
  'context_assembly',
  'renderer_authority',
  'provider_context_body',
  'provider_dispatch',
  'tool_dispatch',
  'source_mutation',
  'git_mutation',
  'sqlite_write',
  'permission_grant',
  'revision_admission',
]);

const AUTHORITY = Object.freeze({
  provider_context_disclosure_request: 'main_side_local_approval_request_contract_v1',
  context_assembly: 'caller_provided_verified',
  renderer_authority: 'not_accepted',
  provider_context_body: 'not_included',
  provider_dispatch: 'not_performed',
  tool_dispatch: 'not_performed',
  source_mutation: 'not_performed',
  git_mutation: 'not_performed',
  sqlite_write: 'not_performed',
  permission_grant: 'not_performed',
  revision_admission: 'not_performed',
});

const PROJECT_ID_PATTERN = /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const REQUEST_ID_PATTERN = /^builder-provider-context-disclosure-request:[0-9a-f]{64}$/u;
const PURPOSES = Object.freeze(['answer', 'plan', 'contextual_build']);
const WORKING_CONTEXT_STATES = Object.freeze([
  'empty',
  'discussing',
  'ready',
  'stale',
  'approved_plan_ready',
  'needs_clarification',
]);
const SEGMENT_KINDS = Object.freeze([
  'latest_user_message',
  'working_context_objective',
  'working_context_constraints',
  'approved_plan',
  'current_result',
  'selected_source_summary',
  'compaction_summary',
  'handoff_summary',
]);
const WORKSPACE_STATES = Object.freeze(['bound', 'missing']);
const WRITE_PERMISSIONS = Object.freeze(['not_required', 'allowed', 'ask', 'denied']);
const SAFE_TEXT_PATTERN = /^[A-Za-z0-9 .,;:/()_-]{1,240}$/u;

class BuilderProviderContextDisclosureRequestError extends Error {
  constructor() {
    super('The provider context disclosure request could not be verified.');
    this.name = 'BuilderProviderContextDisclosureRequestError';
    this.code = 'builder_provider_context_disclosure_request_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderProviderContextDisclosureRequestError(); }

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

function safeEnum(value, allowed) {
  if (typeof value !== 'string' || !allowed.includes(value)) fail();
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

function safeCount(value, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail();
  return value;
}

function denseSegmentKinds(value) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length > 16) fail();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length + 1 || ownKeys.some((key) => typeof key === 'symbol')) fail();
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    result.push(safeEnum(descriptor.value, SEGMENT_KINDS));
  }
  return freezeDeep(result);
}

function sanitizeBudget(value) {
  const source = exactObject(value, BUDGET_KEYS);
  const maxPromptBytes = safeCount(valueAt(source, 'max_prompt_bytes'), 512, 65_536);
  return freezeDeep({
    used_prompt_bytes: safeCount(valueAt(source, 'used_prompt_bytes'), 0, maxPromptBytes),
    max_prompt_bytes: maxPromptBytes,
    reserved_response_bytes: safeCount(valueAt(source, 'reserved_response_bytes'), 0, 65_536),
  });
}

function sanitizePermissionGate(value) {
  const source = exactObject(value, PERMISSION_GATE_KEYS);
  const sideEffectReady = valueAt(source, 'side_effect_ready');
  if (typeof sideEffectReady !== 'boolean') fail();
  return freezeDeep({
    workspace_state: safeEnum(valueAt(source, 'workspace_state'), WORKSPACE_STATES),
    write_permission: safeEnum(valueAt(source, 'write_permission'), WRITE_PERMISSIONS),
    side_effect_ready: sideEffectReady,
  });
}

function sanitizeContextSurface(value) {
  const source = exactObject(value, CONTEXT_SURFACE_KEYS);
  const segmentKinds = denseSegmentKinds(valueAt(source, 'segment_kinds'));
  const segmentCount = safeCount(valueAt(source, 'segment_count'), 0, 16);
  if (segmentCount !== segmentKinds.length) fail();
  return freezeDeep({
    working_context_state_status: safeEnum(valueAt(source, 'working_context_state_status'), WORKING_CONTEXT_STATES),
    segment_count: segmentCount,
    segment_kinds: segmentKinds,
    omitted_ref_count: safeCount(valueAt(source, 'omitted_ref_count'), 0, 16),
    budget: sanitizeBudget(valueAt(source, 'budget')),
    permission_gate: sanitizePermissionGate(valueAt(source, 'permission_gate')),
  });
}

function sanitizeResource(value, expectedProjectId, expectedPurpose) {
  const source = exactObject(value, RESOURCE_KEYS);
  const resource = freezeDeep({
    resource_kind: valueAt(source, 'resource_kind') === RESOURCE_KIND ? RESOURCE_KIND : fail(),
    project_id: safePattern(valueAt(source, 'project_id'), PROJECT_ID_PATTERN),
    resource_id: safePattern(valueAt(source, 'resource_id'), /^[a-z][a-z0-9._:/@-]{0,127}$/u),
  });
  if (
    resource.project_id !== expectedProjectId
    || resource.resource_id !== `provider:configured/${expectedPurpose}`
  ) fail();
  return resource;
}

function sanitizeDisclosureRequest(value, expectedProjectId) {
  const source = exactObject(value, DISCLOSURE_REQUEST_KEYS);
  if (valueAt(source, 'request_version') !== PROVIDER_CONTEXT_DISCLOSURE_REQUEST_VERSION) fail();
  const purpose = safeEnum(valueAt(source, 'purpose'), PURPOSES);
  return freezeDeep({
    request_version: PROVIDER_CONTEXT_DISCLOSURE_REQUEST_VERSION,
    approval_scope: valueAt(source, 'approval_scope') === 'configured_provider_purpose'
      ? 'configured_provider_purpose'
      : fail(),
    action: valueAt(source, 'action') === ACTION ? ACTION : fail(),
    resource: sanitizeResource(valueAt(source, 'resource'), expectedProjectId, purpose),
    provider_scope: valueAt(source, 'provider_scope') === PROVIDER_SCOPE ? PROVIDER_SCOPE : fail(),
    purpose,
    requested_at_ms: safeTimestamp(valueAt(source, 'requested_at_ms')),
  });
}

function safeCopy(value) {
  return safePattern(value, SAFE_TEXT_PATTERN);
}

function sanitizeUserCopy(value) {
  const source = exactObject(value, USER_COPY_KEYS);
  return freezeDeep({
    title: safeCopy(valueAt(source, 'title')),
    summary: safeCopy(valueAt(source, 'summary')),
    details: safeCopy(valueAt(source, 'details')),
  });
}

function sanitizeAuthority(value) {
  exactObject(value, AUTHORITY_KEYS);
  if (canonicalJson(value) !== canonicalJson(AUTHORITY)) fail();
  return freezeDeep({ ...AUTHORITY });
}

function resourceFor(assembly) {
  return freezeDeep({
    resource_kind: RESOURCE_KIND,
    project_id: assembly.project_id,
    resource_id: `provider:configured/${assembly.assembly_purpose}`,
  });
}

function contextSurfaceFor(assembly) {
  return freezeDeep({
    working_context_state_status: assembly.working_context_state_status,
    segment_count: assembly.model_context_segments.length,
    segment_kinds: assembly.model_context_segments.map((segment) => segment.segment_kind),
    omitted_ref_count: assembly.omitted_refs.length,
    budget: {
      used_prompt_bytes: assembly.context_budget.used_prompt_bytes,
      max_prompt_bytes: assembly.context_budget.max_prompt_bytes,
      reserved_response_bytes: assembly.context_budget.reserved_response_bytes,
    },
    permission_gate: {
      workspace_state: assembly.permission_gate.workspace_state,
      write_permission: assembly.permission_gate.write_permission,
      side_effect_ready: assembly.permission_gate.side_effect_ready,
    },
  });
}

function userCopyFor(assembly) {
  const purposeText = assembly.assembly_purpose === 'contextual_build'
    ? 'build with current context'
    : assembly.assembly_purpose;
  return freezeDeep({
    title: 'Share current task context with the configured AI provider',
    summary: `Allow Builder to ${purposeText} using a bounded local context summary.`,
    details: 'This request does not include source files, secrets, ids, digests, or raw context text.',
  });
}

function bodyFor(assembly, requestedAtMs) {
  return freezeDeep({
    project_id: assembly.project_id,
    disclosure_request: {
      request_version: PROVIDER_CONTEXT_DISCLOSURE_REQUEST_VERSION,
      approval_scope: 'configured_provider_purpose',
      action: ACTION,
      resource: resourceFor(assembly),
      provider_scope: PROVIDER_SCOPE,
      purpose: assembly.assembly_purpose,
      requested_at_ms: requestedAtMs,
    },
    context_surface: contextSurfaceFor(assembly),
    user_copy: userCopyFor(assembly),
  });
}

function withRequestId(body) {
  return freezeDeep({
    result_version: PROVIDER_CONTEXT_DISCLOSURE_REQUEST_VERSION,
    request_id: digestId('builder-provider-context-disclosure-request', body),
    ...body,
    authority: { ...AUTHORITY },
  });
}

function createBuilderProviderContextDisclosureRequest(rawInput) {
  const input = exactObject(rawInput, INPUT_KEYS);
  const requestedAtMs = safeTimestamp(valueAt(input, 'requested_at_ms'));
  const assembly = sanitizeBuilderContextAssembly(valueAt(input, 'context_assembly'));
  if (assembly.assembled_at_ms > requestedAtMs) fail();
  return withRequestId(bodyFor(assembly, requestedAtMs));
}

function sanitizeBuilderProviderContextDisclosureRequest(value) {
  const source = exactObject(value, RESULT_KEYS);
  if (valueAt(source, 'result_version') !== PROVIDER_CONTEXT_DISCLOSURE_REQUEST_VERSION) fail();
  const projectId = safePattern(valueAt(source, 'project_id'), PROJECT_ID_PATTERN);
  const body = freezeDeep({
    project_id: projectId,
    disclosure_request: sanitizeDisclosureRequest(valueAt(source, 'disclosure_request'), projectId),
    context_surface: sanitizeContextSurface(valueAt(source, 'context_surface')),
    user_copy: sanitizeUserCopy(valueAt(source, 'user_copy')),
  });
  const normalized = withRequestId(body);
  if (
    valueAt(source, 'request_id') !== normalized.request_id
    || safePattern(valueAt(source, 'request_id'), REQUEST_ID_PATTERN) !== normalized.request_id
  ) fail();
  return freezeDeep({
    ...normalized,
    authority: sanitizeAuthority(valueAt(source, 'authority')),
  });
}

module.exports = Object.freeze({
  PROVIDER_CONTEXT_DISCLOSURE_REQUEST_VERSION,
  BuilderProviderContextDisclosureRequestError,
  createBuilderProviderContextDisclosureRequest,
  sanitizeBuilderProviderContextDisclosureRequest,
});
