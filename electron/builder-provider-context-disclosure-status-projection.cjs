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
  'authority',
]);
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
  disclosure_request_preparation: 'verified_not_exposed',
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
  if (
    (label === COPY.ready.label && blockedReason !== null)
    || (label === COPY.denied.label && blockedReason !== 'context_disclosure_denied')
    || (label === COPY.needs_approval.label && blockedReason !== 'context_disclosure_not_approved')
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
