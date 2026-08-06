'use strict';

const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderProviderContextDisclosureRequestPreparation,
} = require('./builder-provider-context-disclosure-request-service.cjs');

const PROVIDER_CONTEXT_DISCLOSURE_STATUS_PROJECTION_VERSION =
  'builder-provider-context-disclosure-status-projection.v1';

const INPUT_KEYS = Object.freeze(['disclosure_request_preparation']);
const PROJECTION_KEYS = Object.freeze([
  'projection_version',
  'label',
  'tone',
  'next_action_hint',
  'needs_user_approval',
  'can_use_provider_context',
  'blocked_reason',
  'request_available',
  'inspection',
  'authority',
]);
const INSPECTION_KEYS = Object.freeze([
  'title',
  'summary',
  'details',
  'purpose',
  'provider_scope',
  'context_surface',
]);
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
const AUTHORITY_KEYS = Object.freeze([
  'projection_authority',
  'disclosure_request_preparation',
  'renderer_authority',
  'provider_context_body',
  'provider_dispatch',
  'tool_dispatch',
  'source_read',
  'source_write',
  'git_mutation',
  'sqlite_write',
  'permission_grant',
  'revision_admission',
  'secret_access',
]);

const AUTHORITY = Object.freeze({
  projection_authority: 'main_owned_provider_context_disclosure_status_projection_v1',
  disclosure_request_preparation: 'verified_safe_inspection_only',
  renderer_authority: 'not_present',
  provider_context_body: 'not_present',
  provider_dispatch: false,
  tool_dispatch: false,
  source_read: 'not_present',
  source_write: 'not_present',
  git_mutation: false,
  sqlite_write: false,
  permission_grant: false,
  revision_admission: 'not_created',
  secret_access: 'not_present',
});

const COPY = Object.freeze({
  needs_approval: Object.freeze({
    label: 'Allow AI to use current context',
    tone: 'warning',
    next_action_hint: 'Review this before Builder shares the current task context.',
    needs_user_approval: true,
    can_use_provider_context: false,
    request_available: true,
  }),
  denied: Object.freeze({
    label: 'AI context not allowed',
    tone: 'neutral',
    next_action_hint: 'Builder will continue without sharing the current task context.',
    needs_user_approval: false,
    can_use_provider_context: false,
    request_available: true,
  }),
  ready: Object.freeze({
    label: 'AI context allowed',
    tone: 'success',
    next_action_hint: 'Builder can use the approved task context for this AI request.',
    needs_user_approval: false,
    can_use_provider_context: true,
    request_available: false,
  }),
});
const PURPOSES = Object.freeze(['answer', 'plan', 'contextual_build']);
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
const WORKING_CONTEXT_STATES = Object.freeze([
  'empty',
  'discussing',
  'ready',
  'stale',
  'approved_plan_ready',
  'needs_clarification',
]);
const WORKSPACE_STATES = Object.freeze(['bound', 'missing']);
const WRITE_PERMISSIONS = Object.freeze(['not_required', 'allowed', 'ask', 'denied']);
const SAFE_COPY_PATTERN = /^[A-Za-z0-9 .,;:/()_-]{1,240}$/u;
const FORBIDDEN_SAFE_COPY_PATTERN =
  /\b(?:sha256|digest|request_id|preparation_id|assembly_id|projection_id):/iu;

class BuilderProviderContextDisclosureStatusProjectionError extends Error {
  constructor() {
    super('Builder provider context disclosure status is unavailable.');
    this.name = 'BuilderProviderContextDisclosureStatusProjectionError';
    this.code = 'builder_provider_context_disclosure_status_projection_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderProviderContextDisclosureStatusProjectionError(); }

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

function safeEnum(value, allowed) {
  if (typeof value !== 'string' || !allowed.includes(value)) fail();
  return value;
}

function safeNullableBlockedReason(value) {
  if (value === null) return null;
  return safeEnum(value, ['context_disclosure_not_approved', 'context_disclosure_denied']);
}

function safeCount(value, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail();
  return value;
}

function safeCopy(value) {
  if (
    typeof value !== 'string'
    || !SAFE_COPY_PATTERN.test(value)
    || FORBIDDEN_SAFE_COPY_PATTERN.test(value)
  ) fail();
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

function sanitizeInspection(value) {
  if (value === null) return null;
  const source = exactObject(value, INSPECTION_KEYS);
  return freezeDeep({
    title: safeCopy(valueAt(source, 'title')),
    summary: safeCopy(valueAt(source, 'summary')),
    details: safeCopy(valueAt(source, 'details')),
    purpose: safeEnum(valueAt(source, 'purpose'), PURPOSES),
    provider_scope: valueAt(source, 'provider_scope') === 'configured_provider'
      ? 'configured_provider'
      : fail(),
    context_surface: sanitizeContextSurface(valueAt(source, 'context_surface')),
  });
}

function inspectionFor(preparation) {
  const request = preparation.provider_context_disclosure_request;
  if (request === null) return null;
  return sanitizeInspection({
    title: request.user_copy.title,
    summary: request.user_copy.summary,
    details: request.user_copy.details,
    purpose: request.disclosure_request.purpose,
    provider_scope: request.disclosure_request.provider_scope,
    context_surface: request.context_surface,
  });
}

function sanitizeAuthority(value) {
  exactObject(value, AUTHORITY_KEYS);
  for (const key of AUTHORITY_KEYS) {
    if (valueAt(value, key) !== valueAt(AUTHORITY, key)) fail();
  }
  return freezeDeep({ ...AUTHORITY });
}

function copyFor(preparation) {
  if (preparation.projection_status === 'ready') return COPY.ready;
  if (preparation.blocked_reason === 'context_disclosure_denied') return COPY.denied;
  if (preparation.blocked_reason === 'context_disclosure_not_approved') return COPY.needs_approval;
  fail();
  return null;
}

function assertProjection(value) {
  const source = exactObject(value, PROJECTION_KEYS);
  if (valueAt(source, 'projection_version') !== PROVIDER_CONTEXT_DISCLOSURE_STATUS_PROJECTION_VERSION) fail();
  const label = safeEnum(valueAt(source, 'label'), [
    COPY.needs_approval.label,
    COPY.denied.label,
    COPY.ready.label,
  ]);
  const matched = Object.values(COPY).find((copy) => copy.label === label);
  if (matched === undefined) fail();
  if (
    valueAt(source, 'tone') !== matched.tone
    || valueAt(source, 'next_action_hint') !== matched.next_action_hint
    || valueAt(source, 'needs_user_approval') !== matched.needs_user_approval
    || valueAt(source, 'can_use_provider_context') !== matched.can_use_provider_context
    || valueAt(source, 'request_available') !== matched.request_available
  ) fail();
  const blockedReason = safeNullableBlockedReason(valueAt(source, 'blocked_reason'));
  const inspection = sanitizeInspection(valueAt(source, 'inspection'));
  if (
    (label === COPY.ready.label && blockedReason !== null)
    || (label === COPY.denied.label && blockedReason !== 'context_disclosure_denied')
    || (label === COPY.needs_approval.label && blockedReason !== 'context_disclosure_not_approved')
    || (label === COPY.ready.label && inspection !== null)
    || (label !== COPY.ready.label && inspection === null)
  ) fail();
  return freezeDeep({
    projection_version: PROVIDER_CONTEXT_DISCLOSURE_STATUS_PROJECTION_VERSION,
    label,
    tone: matched.tone,
    next_action_hint: matched.next_action_hint,
    needs_user_approval: matched.needs_user_approval,
    can_use_provider_context: matched.can_use_provider_context,
    blocked_reason: blockedReason,
    request_available: matched.request_available,
    inspection,
    authority: sanitizeAuthority(valueAt(source, 'authority')),
  });
}

function projectBuilderProviderContextDisclosureStatus(rawInput) {
  try {
    exactObject(rawInput, INPUT_KEYS);
    const preparation = sanitizeBuilderProviderContextDisclosureRequestPreparation(
      valueAt(rawInput, 'disclosure_request_preparation'),
    );
    const copy = copyFor(preparation);
    return assertProjection({
      projection_version: PROVIDER_CONTEXT_DISCLOSURE_STATUS_PROJECTION_VERSION,
      label: copy.label,
      tone: copy.tone,
      next_action_hint: copy.next_action_hint,
      needs_user_approval: copy.needs_user_approval,
      can_use_provider_context: copy.can_use_provider_context,
      blocked_reason: preparation.blocked_reason,
      request_available: copy.request_available,
      inspection: inspectionFor(preparation),
      authority: { ...AUTHORITY },
    });
  } catch {
    fail();
  }
}

function sanitizeBuilderProviderContextDisclosureStatusProjection(value) {
  try {
    return assertProjection(value);
  } catch {
    fail();
  }
}

module.exports = Object.freeze({
  PROVIDER_CONTEXT_DISCLOSURE_STATUS_PROJECTION_VERSION,
  BuilderProviderContextDisclosureStatusProjectionError,
  projectBuilderProviderContextDisclosureStatus,
  sanitizeBuilderProviderContextDisclosureStatusProjection,
});
