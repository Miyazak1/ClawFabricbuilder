'use strict';

const { types: utilTypes } = require('node:util');

const {
  BuilderWorkingContextStateError,
  sanitizeBuilderWorkingContextState,
} = require('./builder-working-context-state.cjs');

const BUILDER_CONTEXT_STATUS_PROJECTION_VERSION = 'builder-context-status-projection.v1';

const INPUT_KEYS = Object.freeze(['working_context_state', 'pending_handoff_packets']);
const PENDING_HANDOFF_KEYS = Object.freeze(['status', 'count', 'first_handoff_id']);
const PROJECTION_KEYS = Object.freeze([
  'projection_version',
  'label',
  'tone',
  'next_action_hint',
  'has_pending_handoff',
  'pending_handoff_count',
  'needs_confirmation',
  'can_contextual_execute',
  'authority',
]);
const AUTHORITY_KEYS = Object.freeze([
  'projection_authority',
  'working_context_state',
  'pending_handoff_packets',
  'renderer_authority',
  'ipc_authority',
  'provider_dispatch',
  'tool_dispatch',
  'source_read',
  'source_write',
  'git_mutation',
  'permission_grant',
  'revision_admission',
  'secret_access',
]);

const STATUS_COPY = Object.freeze({
  empty: Object.freeze({
    label: 'No direction yet',
    tone: 'neutral',
    next_action_hint: 'Describe what you want to make or change.',
    needs_confirmation: false,
    can_contextual_execute: false,
  }),
  discussing: Object.freeze({
    label: 'Direction updated',
    tone: 'info',
    next_action_hint: 'Ask me to make the change when the direction is ready.',
    needs_confirmation: false,
    can_contextual_execute: false,
  }),
  ready: Object.freeze({
    label: 'Ready to execute current direction',
    tone: 'success',
    next_action_hint: 'You can ask me to make the change.',
    needs_confirmation: false,
    can_contextual_execute: true,
  }),
  stale: Object.freeze({
    label: 'Direction changed',
    tone: 'warning',
    next_action_hint: 'Confirm the new direction before I change files.',
    needs_confirmation: true,
    can_contextual_execute: false,
  }),
  approved_plan_ready: Object.freeze({
    label: 'Using approved plan',
    tone: 'success',
    next_action_hint: 'You can ask me to apply the approved plan.',
    needs_confirmation: false,
    can_contextual_execute: true,
  }),
  needs_clarification: Object.freeze({
    label: 'Needs confirmation',
    tone: 'warning',
    next_action_hint: 'Answer the open question before I change files.',
    needs_confirmation: true,
    can_contextual_execute: false,
  }),
});

class BuilderContextStatusProjectionError extends Error {
  constructor() {
    super('Builder context status is unavailable.');
    this.name = 'BuilderContextStatusProjectionError';
    this.code = 'builder_context_status_projection_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderContextStatusProjectionError();
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
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
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function safePendingHandoff(value) {
  exactObject(value, PENDING_HANDOFF_KEYS);
  const status = valueAt(value, 'status');
  const count = valueAt(value, 'count');
  if (
    (status !== 'absent' && status !== 'pending')
    || !Number.isSafeInteger(count)
    || count < 0
    || count > 128
  ) fail();
  const firstHandoffId = valueAt(value, 'first_handoff_id');
  if (status === 'absent') {
    if (count !== 0 || firstHandoffId !== null) fail();
    return freezeDeep({ status, count });
  }
  if (count < 1 || typeof firstHandoffId !== 'string') fail();
  return freezeDeep({ status, count });
}

function authority(hasPendingHandoff) {
  return freezeDeep({
    projection_authority: 'main_owned_context_status_projection_v1',
    working_context_state: 'verified_not_exposed',
    pending_handoff_packets: hasPendingHandoff ? 'pending_count_only' : 'none',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    tool_dispatch: false,
    source_read: 'not_present',
    source_write: 'not_present',
    git_mutation: false,
    permission_grant: false,
    revision_admission: 'not_created',
    secret_access: 'not_present',
  });
}

function assertProjection(value) {
  exactObject(value, PROJECTION_KEYS);
  if (valueAt(value, 'projection_version') !== BUILDER_CONTEXT_STATUS_PROJECTION_VERSION) fail();
  if (!Object.values(STATUS_COPY).some((copy) => copy.label === valueAt(value, 'label'))) {
    if (valueAt(value, 'label') !== 'Handoff received') fail();
  }
  if (!['neutral', 'info', 'success', 'warning'].includes(valueAt(value, 'tone'))) fail();
  if (typeof valueAt(value, 'next_action_hint') !== 'string') fail();
  if (typeof valueAt(value, 'has_pending_handoff') !== 'boolean') fail();
  if (!Number.isSafeInteger(valueAt(value, 'pending_handoff_count'))) fail();
  if (typeof valueAt(value, 'needs_confirmation') !== 'boolean') fail();
  if (typeof valueAt(value, 'can_contextual_execute') !== 'boolean') fail();
  const authorityValue = valueAt(value, 'authority');
  exactObject(authorityValue, AUTHORITY_KEYS);
  const expectedAuthority = authority(valueAt(value, 'has_pending_handoff'));
  for (const key of AUTHORITY_KEYS) {
    if (valueAt(authorityValue, key) !== valueAt(expectedAuthority, key)) fail();
  }
  return value;
}

function projectBuilderContextStatus(rawInput) {
  try {
    exactObject(rawInput, INPUT_KEYS);
    const state = sanitizeBuilderWorkingContextState(valueAt(rawInput, 'working_context_state'));
    const pendingHandoff = safePendingHandoff(valueAt(rawInput, 'pending_handoff_packets'));
    const hasPendingHandoff = pendingHandoff.status === 'pending';
    const copy = STATUS_COPY[state.state];
    if (copy === undefined) fail();
    const visible = hasPendingHandoff
      ? {
        label: 'Handoff received',
        tone: 'warning',
        next_action_hint: 'Review the handoff before the next change.',
        needs_confirmation: true,
        can_contextual_execute: false,
      }
      : copy;
    return freezeDeep(assertProjection({
      projection_version: BUILDER_CONTEXT_STATUS_PROJECTION_VERSION,
      label: visible.label,
      tone: visible.tone,
      next_action_hint: visible.next_action_hint,
      has_pending_handoff: hasPendingHandoff,
      pending_handoff_count: pendingHandoff.count,
      needs_confirmation: visible.needs_confirmation,
      can_contextual_execute: visible.can_contextual_execute,
      authority: authority(hasPendingHandoff),
    }));
  } catch (error) {
    if (
      error instanceof BuilderContextStatusProjectionError
      || error instanceof BuilderWorkingContextStateError
    ) fail();
    fail();
  }
}

function sanitizeBuilderContextStatusProjection(value) {
  try {
    return freezeDeep(assertProjection(value));
  } catch {
    fail();
  }
}

module.exports = Object.freeze({
  BUILDER_CONTEXT_STATUS_PROJECTION_VERSION,
  BuilderContextStatusProjectionError,
  projectBuilderContextStatus,
  sanitizeBuilderContextStatusProjection,
});
