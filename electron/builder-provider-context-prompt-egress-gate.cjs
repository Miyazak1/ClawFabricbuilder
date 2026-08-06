const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderProviderContextProjection,
} = require('./builder-provider-context-projection.cjs');

const PROVIDER_CONTEXT_PROMPT_EGRESS_GATE_VERSION =
  'builder-provider-context-prompt-egress-gate.v1';

const INPUT_KEYS = Object.freeze(['provider_context_projection', 'assessed_at_ms']);
const RESULT_KEYS = Object.freeze([
  'result_version',
  'gate_id',
  'projection_status',
  'prompt_egress_status',
  'blocked_reason',
  'next_required_step',
  'provider_prompt_context',
  'source_ref',
  'assessed_at_ms',
  'authority',
]);
const SOURCE_REF_KEYS = Object.freeze(['projection_id', 'projected_at_ms']);
const AUTHORITY_KEYS = Object.freeze([
  'prompt_egress_gate',
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
  'prompt_bridge',
]);

const AUTHORITY = Object.freeze({
  prompt_egress_gate: 'main_side_prompt_egress_gate_v1',
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
  prompt_bridge: 'not_enabled',
});

const GATE_ID_PATTERN =
  /^builder-provider-context-prompt-egress-gate:[0-9a-f]{64}$/u;
const PROJECTION_ID_PATTERN =
  /^builder-provider-context-projection:[0-9a-f]{64}$/u;

class BuilderProviderContextPromptEgressGateError extends Error {
  constructor() {
    super('The provider context prompt egress gate could not be verified.');
    this.name = 'BuilderProviderContextPromptEgressGateError';
    this.code = 'builder_provider_context_prompt_egress_gate_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderProviderContextPromptEgressGateError(); }

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

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function sanitizeProjectionStatus(value) {
  if (value !== 'blocked' && value !== 'ready') fail();
  return value;
}

function sanitizePromptEgressStatus(value) {
  if (
    value !== 'blocked_by_context_disclosure'
    && value !== 'blocked_by_prompt_bridge'
  ) fail();
  return value;
}

function sanitizeBlockedReason(value) {
  if (
    value !== 'context_disclosure_not_approved'
    && value !== 'context_disclosure_denied'
    && value !== 'prompt_bridge_not_enabled'
  ) fail();
  return value;
}

function sanitizeNextRequiredStep(value) {
  if (
    value !== 'approve_context_disclosure'
    && value !== 'context_disclosure_denied'
    && value !== 'implement_explicit_prompt_bridge'
  ) fail();
  return value;
}

function sanitizeSourceRef(value) {
  const source = exactObject(value, SOURCE_REF_KEYS);
  return freezeDeep({
    projection_id: safePattern(valueAt(source, 'projection_id'), PROJECTION_ID_PATTERN),
    projected_at_ms: safeTimestamp(valueAt(source, 'projected_at_ms')),
  });
}

function sanitizeAuthority(value) {
  exactObject(value, AUTHORITY_KEYS);
  if (canonicalJson(value) !== canonicalJson(AUTHORITY)) fail();
  return freezeDeep({ ...AUTHORITY });
}

function statusFor(projection) {
  if (projection.projection_status === 'blocked') {
    const reason = projection.blocked_reason;
    return freezeDeep({
      prompt_egress_status: 'blocked_by_context_disclosure',
      blocked_reason: reason,
      next_required_step: reason === 'context_disclosure_not_approved'
        ? 'approve_context_disclosure'
        : 'context_disclosure_denied',
    });
  }
  return freezeDeep({
    prompt_egress_status: 'blocked_by_prompt_bridge',
    blocked_reason: 'prompt_bridge_not_enabled',
    next_required_step: 'implement_explicit_prompt_bridge',
  });
}

function bodyFor(projection, assessedAtMs) {
  if (projection.projected_at_ms > assessedAtMs) fail();
  const status = statusFor(projection);
  return freezeDeep({
    projection_status: projection.projection_status,
    ...status,
    provider_prompt_context: null,
    source_ref: {
      projection_id: projection.projection_id,
      projected_at_ms: projection.projected_at_ms,
    },
    assessed_at_ms: assessedAtMs,
  });
}

function withGateId(body) {
  return freezeDeep({
    result_version: PROVIDER_CONTEXT_PROMPT_EGRESS_GATE_VERSION,
    gate_id: digestId('builder-provider-context-prompt-egress-gate', body),
    ...body,
    authority: { ...AUTHORITY },
  });
}

function assessBuilderProviderContextPromptEgress(rawInput) {
  const input = exactObject(rawInput, INPUT_KEYS);
  let projection;
  try {
    projection = sanitizeBuilderProviderContextProjection(
      valueAt(input, 'provider_context_projection'),
    );
  } catch {
    fail();
  }
  return withGateId(bodyFor(projection, safeTimestamp(valueAt(input, 'assessed_at_ms'))));
}

function sanitizeBuilderProviderContextPromptEgressGate(value) {
  const source = exactObject(value, RESULT_KEYS);
  if (valueAt(source, 'result_version') !== PROVIDER_CONTEXT_PROMPT_EGRESS_GATE_VERSION) fail();
  const providerPromptContext = valueAt(source, 'provider_prompt_context');
  if (providerPromptContext !== null) fail();
  const body = freezeDeep({
    projection_status: sanitizeProjectionStatus(valueAt(source, 'projection_status')),
    prompt_egress_status: sanitizePromptEgressStatus(valueAt(source, 'prompt_egress_status')),
    blocked_reason: sanitizeBlockedReason(valueAt(source, 'blocked_reason')),
    next_required_step: sanitizeNextRequiredStep(valueAt(source, 'next_required_step')),
    provider_prompt_context: null,
    source_ref: sanitizeSourceRef(valueAt(source, 'source_ref')),
    assessed_at_ms: safeTimestamp(valueAt(source, 'assessed_at_ms')),
  });
  if (
    (body.projection_status === 'ready') !== (body.prompt_egress_status === 'blocked_by_prompt_bridge')
    || (body.prompt_egress_status === 'blocked_by_prompt_bridge')
      !== (body.blocked_reason === 'prompt_bridge_not_enabled')
    || (body.blocked_reason === 'context_disclosure_not_approved')
      !== (body.next_required_step === 'approve_context_disclosure')
    || (body.blocked_reason === 'context_disclosure_denied')
      !== (body.next_required_step === 'context_disclosure_denied')
    || body.source_ref.projected_at_ms > body.assessed_at_ms
  ) fail();
  const normalized = withGateId(body);
  if (
    valueAt(source, 'gate_id') !== normalized.gate_id
    || safePattern(valueAt(source, 'gate_id'), GATE_ID_PATTERN) !== normalized.gate_id
  ) fail();
  return freezeDeep({
    ...normalized,
    authority: sanitizeAuthority(valueAt(source, 'authority')),
  });
}

module.exports = Object.freeze({
  PROVIDER_CONTEXT_PROMPT_EGRESS_GATE_VERSION,
  BuilderProviderContextPromptEgressGateError,
  assessBuilderProviderContextPromptEgress,
  sanitizeBuilderProviderContextPromptEgressGate,
});
