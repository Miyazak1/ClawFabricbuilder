'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderContextAssembly,
} = require('./builder-context-assembler.cjs');

const PROVIDER_CONTEXT_PROJECTION_VERSION = 'builder-provider-context-projection.v1';

const PROJECTION_KEYS = Object.freeze([
  'projection_version',
  'projection_id',
  'projection_status',
  'provider_context',
  'blocked_reason',
  'source_refs',
  'projected_at_ms',
  'authority',
]);
const INPUT_KEYS = Object.freeze([
  'context_assembly',
  'disclosure_decision',
  'projected_at_ms',
]);
const DISCLOSURE_DECISION_KEYS = Object.freeze([
  'decision',
  'approved_by',
  'approved_at_ms',
  'provider_scope',
  'purpose',
]);
const PROVIDER_CONTEXT_KEYS = Object.freeze([
  'context_version',
  'source',
  'purpose',
  'working_context_state_status',
  'segments',
  'omitted_ref_count',
  'budget',
  'permission_gate',
]);
const PROVIDER_SEGMENT_KEYS = Object.freeze(['kind', 'text']);
const PROVIDER_BUDGET_KEYS = Object.freeze(['used_prompt_bytes', 'max_prompt_bytes', 'reserved_response_bytes']);
const PROVIDER_PERMISSION_GATE_KEYS = Object.freeze(['workspace_state', 'write_permission', 'side_effect_ready']);
const SOURCE_REFS_KEYS = Object.freeze(['assembly_id', 'context_digest']);
const AUTHORITY_KEYS = Object.freeze([
  'provider_context_projection',
  'context_assembly',
  'disclosure_decision',
  'renderer_authority',
  'sqlite_read',
  'sqlite_write',
  'provider_dispatch',
  'tool_dispatch',
  'source_mutation',
  'git_mutation',
  'permission_grant',
  'revision_admission',
]);

const AUTHORITY = Object.freeze({
  provider_context_projection: 'main_side_projection_only',
  context_assembly: 'caller_provided_verified',
  disclosure_decision: 'caller_provided_verified',
  renderer_authority: 'not_accepted',
  sqlite_read: 'not_performed',
  sqlite_write: 'not_performed',
  provider_dispatch: 'not_performed',
  tool_dispatch: 'not_performed',
  source_mutation: 'not_performed',
  git_mutation: 'not_performed',
  permission_grant: 'not_performed',
  revision_admission: 'not_performed',
});

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ASSEMBLY_ID_PATTERN = /^builder-context-assembly:[0-9a-f]{64}$/u;
const PROJECTION_ID_PATTERN = /^builder-provider-context-projection:[0-9a-f]{64}$/u;
const UNSAFE_UNICODE_FORMAT_PATTERN = /[\p{Cf}\p{Bidi_Control}]/u;
const LOCAL_PATH_PATTERN = /(?:file:\/{1,3}|\\\\|(?:^|[\s"'`=(,:])(?:[A-Za-z]:[\\/]|~[\\/]|\/(?!\/)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*))/iu;
const CREDENTIAL_PATTERN = /(?:["'`]?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|credential|client[_-]?secret|private[_-]?key)["'`]?\s*[:=]\s*(?!["'`]?\s*(?:null|undefined)\b)\S|\b(?:basic|bearer)\s+[A-Za-z0-9._~+/=-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|https?:\/\/[^\s/:@]+:[^\s/@]+@|\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b)/iu;
const DECISIONS = Object.freeze(['not_requested', 'denied', 'approved']);
const PURPOSES = Object.freeze(['answer', 'plan', 'contextual_build']);
const PROVIDER_SCOPES = Object.freeze(['configured_provider']);
const APPROVERS = Object.freeze(['local_user']);
const STATUS = Object.freeze(['blocked', 'ready']);
const BLOCKED_REASONS = Object.freeze(['context_disclosure_not_approved', 'context_disclosure_denied']);

class BuilderProviderContextProjectionError extends Error {
  constructor() {
    super('The provider context projection could not be verified.');
    this.name = 'BuilderProviderContextProjectionError';
    this.code = 'builder_provider_context_projection_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderProviderContextProjectionError(); }

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
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
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

function safeNullableEnum(value, allowed) {
  if (value === null) return null;
  return safeEnum(value, allowed);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeCount(value, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail();
  return value;
}

function safeText(value) {
  if (typeof value !== 'string') fail();
  const normalized = value.normalize('NFKC');
  if (
    value.length < 1
    || Array.from(value).length > 1_024
    || Buffer.byteLength(value, 'utf8') > 4_096
    || UNSAFE_UNICODE_FORMAT_PATTERN.test(value)
    || LOCAL_PATH_PATTERN.test(normalized)
    || CREDENTIAL_PATTERN.test(normalized)
  ) fail();
  return value;
}

function denseSegments(value) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length > 16) fail();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length + 1 || ownKeys.some((key) => typeof key === 'symbol')) fail();
  const segments = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    const segment = exactObject(descriptor.value, PROVIDER_SEGMENT_KEYS);
    segments.push(freezeDeep({
      kind: safeEnum(valueAt(segment, 'kind'), [
        'latest_user_message',
        'working_context_objective',
        'working_context_constraints',
        'approved_plan',
        'current_result',
        'selected_source_summary',
        'compaction_summary',
        'handoff_summary',
      ]),
      text: safeText(valueAt(segment, 'text')),
    }));
  }
  return freezeDeep(segments);
}

function sanitizeProviderBudget(value) {
  const source = exactObject(value, PROVIDER_BUDGET_KEYS);
  const maxPromptBytes = safeCount(valueAt(source, 'max_prompt_bytes'), 512, 65_536);
  return freezeDeep({
    used_prompt_bytes: safeCount(valueAt(source, 'used_prompt_bytes'), 0, maxPromptBytes),
    max_prompt_bytes: maxPromptBytes,
    reserved_response_bytes: safeCount(valueAt(source, 'reserved_response_bytes'), 0, 65_536),
  });
}

function sanitizeProviderPermissionGate(value) {
  const source = exactObject(value, PROVIDER_PERMISSION_GATE_KEYS);
  const sideEffectReady = valueAt(source, 'side_effect_ready');
  if (typeof sideEffectReady !== 'boolean') fail();
  return freezeDeep({
    workspace_state: safeEnum(valueAt(source, 'workspace_state'), ['bound', 'missing']),
    write_permission: safeEnum(valueAt(source, 'write_permission'), ['not_required', 'allowed', 'ask', 'denied']),
    side_effect_ready: sideEffectReady,
  });
}

function sanitizeProviderContext(value) {
  if (value === null) return null;
  const source = exactObject(value, PROVIDER_CONTEXT_KEYS);
  if (valueAt(source, 'context_version') !== 'builder-provider-context.v1') fail();
  return freezeDeep({
    context_version: 'builder-provider-context.v1',
    source: safeEnum(valueAt(source, 'source'), ['context_assembler']),
    purpose: safeEnum(valueAt(source, 'purpose'), PURPOSES),
    working_context_state_status: safeEnum(valueAt(source, 'working_context_state_status'), [
      'empty',
      'discussing',
      'ready',
      'stale',
      'approved_plan_ready',
      'needs_clarification',
    ]),
    segments: denseSegments(valueAt(source, 'segments')),
    omitted_ref_count: safeCount(valueAt(source, 'omitted_ref_count'), 0, 16),
    budget: sanitizeProviderBudget(valueAt(source, 'budget')),
    permission_gate: sanitizeProviderPermissionGate(valueAt(source, 'permission_gate')),
  });
}

function sanitizeDisclosureDecision(value, projectedAtMs) {
  const source = exactObject(value, DISCLOSURE_DECISION_KEYS);
  const decision = safeEnum(valueAt(source, 'decision'), DECISIONS);
  const approvedBy = safeNullableEnum(valueAt(source, 'approved_by'), APPROVERS);
  const approvedAtMs = valueAt(source, 'approved_at_ms') === null
    ? null
    : safeTimestamp(valueAt(source, 'approved_at_ms'));
  const providerScope = safeNullableEnum(valueAt(source, 'provider_scope'), PROVIDER_SCOPES);
  const purpose = safeNullableEnum(valueAt(source, 'purpose'), PURPOSES);
  if (decision === 'approved') {
    if (
      approvedBy !== 'local_user'
      || approvedAtMs === null
      || approvedAtMs > projectedAtMs
      || providerScope !== 'configured_provider'
      || purpose === null
    ) fail();
  } else if (
    approvedBy !== null
    || approvedAtMs !== null
    || providerScope !== null
    || purpose !== null
  ) fail();
  return freezeDeep({ decision, approved_by: approvedBy, approved_at_ms: approvedAtMs, provider_scope: providerScope, purpose });
}

function providerContextFromAssembly(assembly) {
  return freezeDeep({
    context_version: 'builder-provider-context.v1',
    source: 'context_assembler',
    purpose: assembly.assembly_purpose,
    working_context_state_status: assembly.working_context_state_status,
    segments: assembly.model_context_segments.map((segment) => ({
      kind: segment.segment_kind,
      text: segment.text,
    })),
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

function sourceRefsFromAssembly(assembly) {
  return freezeDeep({
    assembly_id: assembly.assembly_id,
    context_digest: assembly.context_digest,
  });
}

function projectionBodyFrom(value) {
  const source = exactObject(value, [
    'projection_status',
    'provider_context',
    'blocked_reason',
    'source_refs',
    'projected_at_ms',
  ]);
  const projectionStatus = safeEnum(valueAt(source, 'projection_status'), STATUS);
  const providerContext = sanitizeProviderContext(valueAt(source, 'provider_context'));
  const blockedReason = valueAt(source, 'blocked_reason') === null
    ? null
    : safeEnum(valueAt(source, 'blocked_reason'), BLOCKED_REASONS);
  const sourceRefs = exactObject(valueAt(source, 'source_refs'), SOURCE_REFS_KEYS);
  if (
    (projectionStatus === 'ready' && (providerContext === null || blockedReason !== null))
    || (projectionStatus === 'blocked' && (providerContext !== null || blockedReason === null))
  ) fail();
  return freezeDeep({
    projection_status: projectionStatus,
    provider_context: providerContext,
    blocked_reason: blockedReason,
    source_refs: {
      assembly_id: safePattern(valueAt(sourceRefs, 'assembly_id'), ASSEMBLY_ID_PATTERN),
      context_digest: safePattern(valueAt(sourceRefs, 'context_digest'), DIGEST_PATTERN),
    },
    projected_at_ms: safeTimestamp(valueAt(source, 'projected_at_ms')),
  });
}

function sanitizeAuthority(value) {
  exactObject(value, AUTHORITY_KEYS);
  if (canonicalJson(value) !== canonicalJson(AUTHORITY)) fail();
  return freezeDeep({ ...AUTHORITY });
}

function withProjectionId(body) {
  return freezeDeep({
    projection_version: PROVIDER_CONTEXT_PROJECTION_VERSION,
    projection_id: digestId('builder-provider-context-projection', body),
    ...body,
    authority: { ...AUTHORITY },
  });
}

function createBuilderProviderContextProjection(rawInput) {
  const input = exactObject(rawInput, INPUT_KEYS);
  const projectedAtMs = safeTimestamp(valueAt(input, 'projected_at_ms'));
  const assembly = sanitizeBuilderContextAssembly(valueAt(input, 'context_assembly'));
  if (assembly.assembled_at_ms > projectedAtMs) fail();
  const disclosureDecision = sanitizeDisclosureDecision(valueAt(input, 'disclosure_decision'), projectedAtMs);
  const sourceRefs = sourceRefsFromAssembly(assembly);
  if (disclosureDecision.decision !== 'approved') {
    return withProjectionId(projectionBodyFrom({
      projection_status: 'blocked',
      provider_context: null,
      blocked_reason: disclosureDecision.decision === 'denied'
        ? 'context_disclosure_denied'
        : 'context_disclosure_not_approved',
      source_refs: sourceRefs,
      projected_at_ms: projectedAtMs,
    }));
  }
  if (disclosureDecision.purpose !== assembly.assembly_purpose) fail();
  return withProjectionId(projectionBodyFrom({
    projection_status: 'ready',
    provider_context: providerContextFromAssembly(assembly),
    blocked_reason: null,
    source_refs: sourceRefs,
    projected_at_ms: projectedAtMs,
  }));
}

function sanitizeBuilderProviderContextProjection(value) {
  const source = exactObject(value, PROJECTION_KEYS);
  if (valueAt(source, 'projection_version') !== PROVIDER_CONTEXT_PROJECTION_VERSION) fail();
  const body = projectionBodyFrom({
    projection_status: valueAt(source, 'projection_status'),
    provider_context: valueAt(source, 'provider_context'),
    blocked_reason: valueAt(source, 'blocked_reason'),
    source_refs: valueAt(source, 'source_refs'),
    projected_at_ms: valueAt(source, 'projected_at_ms'),
  });
  const normalized = withProjectionId(body);
  if (
    valueAt(source, 'projection_id') !== normalized.projection_id
    || safePattern(valueAt(source, 'projection_id'), PROJECTION_ID_PATTERN) !== normalized.projection_id
  ) fail();
  return freezeDeep({
    ...normalized,
    authority: sanitizeAuthority(valueAt(source, 'authority')),
  });
}

module.exports = Object.freeze({
  PROVIDER_CONTEXT_PROJECTION_VERSION,
  BuilderProviderContextProjectionError,
  createBuilderProviderContextProjection,
  sanitizeBuilderProviderContextProjection,
});
