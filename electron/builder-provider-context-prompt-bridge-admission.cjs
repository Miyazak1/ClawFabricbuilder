'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderProviderContextProjection,
} = require('./builder-provider-context-projection.cjs');
const {
  sanitizeBuilderProviderContextPromptEgressGate,
} = require('./builder-provider-context-prompt-egress-gate.cjs');
const {
  sanitizeBuilderRunContextSnapshot,
} = require('./builder-run-context-snapshot.cjs');

const PROVIDER_CONTEXT_PROMPT_BRIDGE_ADMISSION_VERSION =
  'builder-provider-context-prompt-bridge-admission.v1';
const PROVIDER_CONTEXT_PROMPT_BRIDGE_CONSENT_VERSION =
  'builder-provider-context-prompt-bridge-consent.v1';

const INPUT_KEYS = Object.freeze([
  'run_context_snapshot',
  'provider_context_projection',
  'provider_context_prompt_egress_gate',
  'bridge_consent',
  'provider_config_digest',
  'admitted_at_ms',
]);
const CONSENT_KEYS = Object.freeze([
  'consent_version',
  'project_id',
  'conversation_id',
  'purpose',
  'provider_scope',
  'provider_config_digest',
  'context_digest',
  'projection_id',
  'approved_at_ms',
  'expires_at_ms',
  'revoked_at_ms',
]);
const RESULT_KEYS = Object.freeze([
  'result_version',
  'admission_id',
  'project_id',
  'conversation_id',
  'turn_id',
  'run_id',
  'task_id',
  'purpose',
  'provider_scope',
  'provider_config_digest',
  'provider_prompt_context',
  'source_ref',
  'admitted_at_ms',
  'authority',
]);
const SOURCE_REF_KEYS = Object.freeze([
  'snapshot_id',
  'snapshot_context_digest',
  'projection_id',
  'gate_id',
  'context_digest',
  'projected_at_ms',
  'gate_assessed_at_ms',
  'consent_approved_at_ms',
  'consent_expires_at_ms',
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
const AUTHORITY_KEYS = Object.freeze([
  'prompt_bridge_admission',
  'run_context_snapshot',
  'provider_context_projection',
  'prompt_egress_gate',
  'bridge_consent',
  'renderer_authority',
  'provider_context_body',
  'provider_dispatch',
  'tool_dispatch',
  'source_mutation',
  'git_mutation',
  'sqlite_write',
  'permission_grant',
  'revision_admission',
  'secret_access',
]);

const AUTHORITY = Object.freeze({
  prompt_bridge_admission: 'main_only_explicit_provider_context_prompt_bridge_admission_v1',
  run_context_snapshot: 'caller_provided_verified',
  provider_context_projection: 'caller_provided_verified',
  prompt_egress_gate: 'caller_provided_verified',
  bridge_consent: 'caller_provided_explicit_user_consent',
  renderer_authority: 'not_accepted',
  provider_context_body: 'main_only_provider_prompt_context',
  provider_dispatch: 'not_performed',
  tool_dispatch: 'not_performed',
  source_mutation: 'not_performed',
  git_mutation: 'not_performed',
  sqlite_write: 'not_performed',
  permission_grant: 'not_performed',
  revision_admission: 'not_performed',
  secret_access: 'not_present',
});

const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const TURN_ID_PATTERN = new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const SNAPSHOT_ID_PATTERN = /^builder-run-context-snapshot:[0-9a-f]{64}$/u;
const PROJECTION_ID_PATTERN = /^builder-provider-context-projection:[0-9a-f]{64}$/u;
const GATE_ID_PATTERN = /^builder-provider-context-prompt-egress-gate:[0-9a-f]{64}$/u;
const ADMISSION_ID_PATTERN = /^builder-provider-context-prompt-bridge-admission:[0-9a-f]{64}$/u;
const PURPOSES = Object.freeze(['answer', 'plan', 'contextual_build']);
const PROVIDER_SCOPES = Object.freeze(['configured_provider']);
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
const UNSAFE_UNICODE_FORMAT_PATTERN = /[\p{Cf}\p{Bidi_Control}]/u;
const LOCAL_PATH_PATTERN = /(?:file:\/{1,3}|\\\\|(?:^|[\s"'`=(,:])(?:[A-Za-z]:[\\/]|~[\\/]|\/(?!\/)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*))/iu;
const CREDENTIAL_PATTERN = /(?:["'`]?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|credential|client[_-]?secret|private[_-]?key)["'`]?\s*[:=]\s*(?!["'`]?\s*(?:null|undefined)\b)\S|\b(?:basic|bearer)\s+[A-Za-z0-9._~+/=-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|https?:\/\/[^\s/:@]+:[^\s/@]+@|\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b)/iu;

class BuilderProviderContextPromptBridgeAdmissionError extends Error {
  constructor() {
    super('The provider context prompt bridge admission could not be verified.');
    this.name = 'BuilderProviderContextPromptBridgeAdmissionError';
    this.code = 'builder_provider_context_prompt_bridge_admission_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderProviderContextPromptBridgeAdmissionError(); }

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

function safeEnum(value, allowed) {
  if (typeof value !== 'string' || !allowed.includes(value)) fail();
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

function nullable(value, sanitizer) {
  return value === null ? null : sanitizer(value);
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
      kind: safeEnum(valueAt(segment, 'kind'), SEGMENT_KINDS),
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
    workspace_state: safeEnum(valueAt(source, 'workspace_state'), WORKSPACE_STATES),
    write_permission: safeEnum(valueAt(source, 'write_permission'), WRITE_PERMISSIONS),
    side_effect_ready: sideEffectReady,
  });
}

function sanitizeProviderPromptContext(value) {
  const source = exactObject(value, PROVIDER_CONTEXT_KEYS);
  if (valueAt(source, 'context_version') !== 'builder-provider-context.v1') fail();
  return freezeDeep({
    context_version: 'builder-provider-context.v1',
    source: valueAt(source, 'source') === 'context_assembler' ? 'context_assembler' : fail(),
    purpose: safeEnum(valueAt(source, 'purpose'), PURPOSES),
    working_context_state_status: safeEnum(valueAt(source, 'working_context_state_status'), WORKING_CONTEXT_STATES),
    segments: denseSegments(valueAt(source, 'segments')),
    omitted_ref_count: safeCount(valueAt(source, 'omitted_ref_count'), 0, 16),
    budget: sanitizeProviderBudget(valueAt(source, 'budget')),
    permission_gate: sanitizeProviderPermissionGate(valueAt(source, 'permission_gate')),
  });
}

function sanitizeBridgeConsent(value) {
  const source = exactObject(value, CONSENT_KEYS);
  const approvedAtMs = safeTimestamp(valueAt(source, 'approved_at_ms'));
  const expiresAtMs = safeTimestamp(valueAt(source, 'expires_at_ms'));
  if (approvedAtMs >= expiresAtMs) fail();
  return freezeDeep({
    consent_version: valueAt(source, 'consent_version') === PROVIDER_CONTEXT_PROMPT_BRIDGE_CONSENT_VERSION
      ? PROVIDER_CONTEXT_PROMPT_BRIDGE_CONSENT_VERSION
      : fail(),
    project_id: safePattern(valueAt(source, 'project_id'), PROJECT_ID_PATTERN),
    conversation_id: safePattern(valueAt(source, 'conversation_id'), CONVERSATION_ID_PATTERN),
    purpose: safeEnum(valueAt(source, 'purpose'), PURPOSES),
    provider_scope: safeEnum(valueAt(source, 'provider_scope'), PROVIDER_SCOPES),
    provider_config_digest: safePattern(valueAt(source, 'provider_config_digest'), DIGEST_PATTERN),
    context_digest: safePattern(valueAt(source, 'context_digest'), DIGEST_PATTERN),
    projection_id: safePattern(valueAt(source, 'projection_id'), PROJECTION_ID_PATTERN),
    approved_at_ms: approvedAtMs,
    expires_at_ms: expiresAtMs,
    revoked_at_ms: valueAt(source, 'revoked_at_ms') === null
      ? null
      : safeTimestamp(valueAt(source, 'revoked_at_ms')),
  });
}

function sanitizeSourceRef(value) {
  const source = exactObject(value, SOURCE_REF_KEYS);
  const consentApprovedAtMs = safeTimestamp(valueAt(source, 'consent_approved_at_ms'));
  const consentExpiresAtMs = safeTimestamp(valueAt(source, 'consent_expires_at_ms'));
  if (consentApprovedAtMs >= consentExpiresAtMs) fail();
  return freezeDeep({
    snapshot_id: safePattern(valueAt(source, 'snapshot_id'), SNAPSHOT_ID_PATTERN),
    snapshot_context_digest: safePattern(valueAt(source, 'snapshot_context_digest'), DIGEST_PATTERN),
    projection_id: safePattern(valueAt(source, 'projection_id'), PROJECTION_ID_PATTERN),
    gate_id: safePattern(valueAt(source, 'gate_id'), GATE_ID_PATTERN),
    context_digest: safePattern(valueAt(source, 'context_digest'), DIGEST_PATTERN),
    projected_at_ms: safeTimestamp(valueAt(source, 'projected_at_ms')),
    gate_assessed_at_ms: safeTimestamp(valueAt(source, 'gate_assessed_at_ms')),
    consent_approved_at_ms: consentApprovedAtMs,
    consent_expires_at_ms: consentExpiresAtMs,
  });
}

function sanitizeAuthority(value) {
  const source = exactObject(value, AUTHORITY_KEYS);
  if (canonicalJson(source) !== canonicalJson(AUTHORITY)) fail();
  return freezeDeep({ ...AUTHORITY });
}

function assertBridgeInputs({ snapshot, projection, gate, consent, providerConfigDigest, admittedAtMs }) {
  if (
    projection.projection_status !== 'ready'
    || projection.provider_context === null
    || projection.blocked_reason !== null
    || gate.projection_status !== 'ready'
    || gate.prompt_egress_status !== 'blocked_by_prompt_bridge'
    || gate.blocked_reason !== 'prompt_bridge_not_enabled'
    || gate.next_required_step !== 'implement_explicit_prompt_bridge'
    || gate.provider_prompt_context !== null
  ) fail();
  if (
    snapshot.project_id !== consent.project_id
    || snapshot.conversation_id !== consent.conversation_id
    || snapshot.provider_context_projection_ref.projection_id !== projection.projection_id
    || snapshot.provider_context_projection_ref.projection_status !== 'ready'
    || snapshot.provider_context_projection_ref.blocked_reason !== null
    || snapshot.provider_context_projection_ref.projected_at_ms !== projection.projected_at_ms
    || snapshot.provider_context_prompt_egress_gate_ref.gate_id !== gate.gate_id
    || snapshot.provider_context_prompt_egress_gate_ref.prompt_egress_status !== 'blocked_by_prompt_bridge'
    || snapshot.provider_context_prompt_egress_gate_ref.blocked_reason !== 'prompt_bridge_not_enabled'
    || snapshot.provider_context_prompt_egress_gate_ref.next_required_step !== 'implement_explicit_prompt_bridge'
    || snapshot.provider_context_prompt_egress_gate_ref.assessed_at_ms !== gate.assessed_at_ms
    || snapshot.context_assembly_ref.context_digest !== projection.source_refs.context_digest
    || gate.source_ref.projection_id !== projection.projection_id
    || gate.source_ref.projected_at_ms !== projection.projected_at_ms
    || consent.projection_id !== projection.projection_id
    || consent.context_digest !== projection.source_refs.context_digest
    || consent.purpose !== projection.provider_context.purpose
    || consent.provider_scope !== 'configured_provider'
    || consent.provider_config_digest !== providerConfigDigest
  ) fail();
  if (
    projection.projected_at_ms > gate.assessed_at_ms
    || gate.assessed_at_ms > consent.approved_at_ms
    || consent.approved_at_ms > admittedAtMs
    || consent.expires_at_ms <= admittedAtMs
    || consent.revoked_at_ms !== null
    || projection.projected_at_ms > admittedAtMs
  ) fail();
}

function bodyFromVerified({ snapshot, projection, gate, consent, providerConfigDigest, admittedAtMs }) {
  assertBridgeInputs({ snapshot, projection, gate, consent, providerConfigDigest, admittedAtMs });
  return freezeDeep({
    project_id: snapshot.project_id,
    conversation_id: snapshot.conversation_id,
    turn_id: snapshot.turn_id,
    run_id: snapshot.run_id,
    task_id: snapshot.task_id,
    purpose: projection.provider_context.purpose,
    provider_scope: consent.provider_scope,
    provider_config_digest: providerConfigDigest,
    provider_prompt_context: sanitizeProviderPromptContext(projection.provider_context),
    source_ref: {
      snapshot_id: snapshot.snapshot_id,
      snapshot_context_digest: snapshot.context_digest,
      projection_id: projection.projection_id,
      gate_id: gate.gate_id,
      context_digest: projection.source_refs.context_digest,
      projected_at_ms: projection.projected_at_ms,
      gate_assessed_at_ms: gate.assessed_at_ms,
      consent_approved_at_ms: consent.approved_at_ms,
      consent_expires_at_ms: consent.expires_at_ms,
    },
    admitted_at_ms: admittedAtMs,
  });
}

function withAdmissionId(body) {
  return freezeDeep({
    result_version: PROVIDER_CONTEXT_PROMPT_BRIDGE_ADMISSION_VERSION,
    admission_id: digestId('builder-provider-context-prompt-bridge-admission', body),
    ...body,
    authority: { ...AUTHORITY },
  });
}

function createBuilderProviderContextPromptBridgeAdmission(rawInput) {
  const input = exactObject(rawInput, INPUT_KEYS);
  let snapshot;
  let projection;
  let gate;
  try {
    snapshot = sanitizeBuilderRunContextSnapshot(valueAt(input, 'run_context_snapshot'));
    projection = sanitizeBuilderProviderContextProjection(valueAt(input, 'provider_context_projection'));
    gate = sanitizeBuilderProviderContextPromptEgressGate(valueAt(input, 'provider_context_prompt_egress_gate'));
  } catch {
    fail();
  }
  return withAdmissionId(bodyFromVerified({
    snapshot,
    projection,
    gate,
    consent: sanitizeBridgeConsent(valueAt(input, 'bridge_consent')),
    providerConfigDigest: safePattern(valueAt(input, 'provider_config_digest'), DIGEST_PATTERN),
    admittedAtMs: safeTimestamp(valueAt(input, 'admitted_at_ms')),
  }));
}

function sanitizeBuilderProviderContextPromptBridgeAdmission(value) {
  const source = exactObject(value, RESULT_KEYS);
  if (valueAt(source, 'result_version') !== PROVIDER_CONTEXT_PROMPT_BRIDGE_ADMISSION_VERSION) fail();
  const sourceRef = sanitizeSourceRef(valueAt(source, 'source_ref'));
  const admittedAtMs = safeTimestamp(valueAt(source, 'admitted_at_ms'));
  const body = freezeDeep({
    project_id: safePattern(valueAt(source, 'project_id'), PROJECT_ID_PATTERN),
    conversation_id: safePattern(valueAt(source, 'conversation_id'), CONVERSATION_ID_PATTERN),
    turn_id: safePattern(valueAt(source, 'turn_id'), TURN_ID_PATTERN),
    run_id: safePattern(valueAt(source, 'run_id'), RUN_ID_PATTERN),
    task_id: nullable(valueAt(source, 'task_id'), (item) => safePattern(item, TASK_ID_PATTERN)),
    purpose: safeEnum(valueAt(source, 'purpose'), PURPOSES),
    provider_scope: safeEnum(valueAt(source, 'provider_scope'), PROVIDER_SCOPES),
    provider_config_digest: safePattern(valueAt(source, 'provider_config_digest'), DIGEST_PATTERN),
    provider_prompt_context: sanitizeProviderPromptContext(valueAt(source, 'provider_prompt_context')),
    source_ref: sourceRef,
    admitted_at_ms: admittedAtMs,
  });
  if (
    body.provider_prompt_context.purpose !== body.purpose
    || sourceRef.projected_at_ms > sourceRef.gate_assessed_at_ms
    || sourceRef.gate_assessed_at_ms > sourceRef.consent_approved_at_ms
    || sourceRef.consent_approved_at_ms > admittedAtMs
    || sourceRef.consent_expires_at_ms <= admittedAtMs
  ) fail();
  const normalized = withAdmissionId(body);
  if (
    valueAt(source, 'admission_id') !== normalized.admission_id
    || safePattern(valueAt(source, 'admission_id'), ADMISSION_ID_PATTERN) !== normalized.admission_id
  ) fail();
  return freezeDeep({
    ...normalized,
    authority: sanitizeAuthority(valueAt(source, 'authority')),
  });
}

module.exports = freezeDeep({
  PROVIDER_CONTEXT_PROMPT_BRIDGE_ADMISSION_VERSION,
  PROVIDER_CONTEXT_PROMPT_BRIDGE_CONSENT_VERSION,
  BuilderProviderContextPromptBridgeAdmissionError,
  createBuilderProviderContextPromptBridgeAdmission,
  sanitizeBuilderProviderContextPromptBridgeAdmission,
});
