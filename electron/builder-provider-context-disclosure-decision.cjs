'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_PERMISSION_DECISION_VERSION,
  BUILDER_PERMISSION_POLICY_VERSION,
  BuilderPermissionAuthorityContractError,
} = require('./builder-permission-authority-contract.cjs');
const {
  sanitizeBuilderContextAssembly,
} = require('./builder-context-assembler.cjs');

const PROVIDER_CONTEXT_DISCLOSURE_DECISION_VERSION = 'builder-provider-context-disclosure-decision.v1';
const RESOURCE_KIND = 'provider';
const ACTION = 'context.disclose';
const PROVIDER_SCOPE = 'configured_provider';

const OPTION_KEYS = Object.freeze(['actor_id', 'now_ms', 'evaluate_permission']);
const INPUT_KEYS = Object.freeze(['context_assembly']);
const RESULT_KEYS = Object.freeze([
  'result_version',
  'decision_id',
  'disclosure_decision',
  'permission_evidence',
  'authority',
]);
const DISCLOSURE_DECISION_KEYS = Object.freeze([
  'decision',
  'approved_by',
  'approved_at_ms',
  'provider_scope',
  'purpose',
]);
const PERMISSION_EVIDENCE_KEYS = Object.freeze([
  'policy_version',
  'actor_id',
  'action',
  'resource',
  'evaluated_at_ms',
  'decision',
  'reason',
  'permission_id',
  'permission_authority',
  'ui_selection_authority',
]);
const RESOURCE_KEYS = Object.freeze(['resource_kind', 'project_id', 'resource_id']);
const AUTHORITY_KEYS = Object.freeze([
  'provider_context_disclosure_decision',
  'context_assembly',
  'permission_authority',
  'renderer_authority',
  'ui_selection_authority',
  'provider_dispatch',
  'tool_dispatch',
  'source_mutation',
  'git_mutation',
  'sqlite_write',
  'permission_grant',
  'revision_admission',
]);

const AUTHORITY = Object.freeze({
  provider_context_disclosure_decision: 'main_side_permission_evaluation_adapter',
  context_assembly: 'caller_provided_verified',
  permission_authority: 'main_owned_permission_facts_deny_by_default',
  renderer_authority: 'not_accepted',
  ui_selection_authority: 'not_permission',
  provider_dispatch: 'not_performed',
  tool_dispatch: 'not_performed',
  source_mutation: 'not_performed',
  git_mutation: 'not_performed',
  sqlite_write: 'not_performed',
  permission_grant: 'not_performed',
  revision_admission: 'not_performed',
});

const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const ACTOR_ID_PATTERN = new RegExp(`^(?:builder-user|builder-agent):${UUID_SOURCE}$`, 'u');
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const PERMISSION_ID_PATTERN = /^builder-permission:[0-9a-f]{64}$/u;
const DECISION_ID_PATTERN = /^builder-provider-context-disclosure-decision:[0-9a-f]{64}$/u;
const DISCLOSURE_DECISIONS = Object.freeze(['approved', 'denied']);
const PERMISSION_DECISIONS = Object.freeze(['allowed', 'denied']);
const PURPOSES = Object.freeze(['answer', 'plan', 'contextual_build']);

class BuilderProviderContextDisclosureDecisionError extends Error {
  constructor(code = 'builder_provider_context_disclosure_decision_unavailable') {
    const selected = code === 'builder_provider_context_disclosure_decision_denied'
      ? code
      : 'builder_provider_context_disclosure_decision_unavailable';
    super('The provider context disclosure decision could not be verified.');
    this.name = 'BuilderProviderContextDisclosureDecisionError';
    this.code = selected;
    this.retryable = selected !== 'builder_provider_context_disclosure_decision_denied';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) { throw new BuilderProviderContextDisclosureDecisionError(code); }

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys, code) {
  if (!isPlainObject(value)) fail(code);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) {
    fail(code);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail(code);
  }
  return value;
}

function valueAt(value, key, code) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail(code);
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

function safePattern(value, pattern, code) {
  if (typeof value !== 'string' || !pattern.test(value)) fail(code);
  return value;
}

function safeEnum(value, allowed, code) {
  if (typeof value !== 'string' || !allowed.includes(value)) fail(code);
  return value;
}

function safeTimestamp(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) fail(code);
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
  ) fail('builder_provider_context_disclosure_decision_unavailable');
  return descriptor.value;
}

function safeOptions(value) {
  const source = exactObject(value, OPTION_KEYS, 'builder_provider_context_disclosure_decision_unavailable');
  return freezeDeep({
    actorId: safePattern(valueAt(source, 'actor_id', 'builder_provider_context_disclosure_decision_unavailable'), ACTOR_ID_PATTERN, 'builder_provider_context_disclosure_decision_unavailable'),
    nowMs: stableMethod(source, 'now_ms'),
    evaluatePermission: stableMethod(source, 'evaluate_permission'),
  });
}

function resourceFor(assembly) {
  return freezeDeep({
    resource_kind: RESOURCE_KIND,
    project_id: assembly.project_id,
    resource_id: `provider:configured/${assembly.assembly_purpose}`,
  });
}

function sanitizeResource(value, expected, code) {
  const source = exactObject(value, RESOURCE_KEYS, code);
  const resource = freezeDeep({
    resource_kind: safeEnum(valueAt(source, 'resource_kind', code), [RESOURCE_KIND], code),
    project_id: safePattern(valueAt(source, 'project_id', code), PROJECT_ID_PATTERN, code),
    resource_id: safeEnum(valueAt(source, 'resource_id', code), [
      'provider:configured/answer',
      'provider:configured/plan',
      'provider:configured/contextual_build',
    ], code),
  });
  if (canonicalJson(resource) !== canonicalJson(expected)) fail(code);
  return resource;
}

function sanitizePermissionDecision(value, expected, actorId, evaluatedAtMs) {
  const source = exactObject(value, [
    'decision_version',
    'policy_version',
    'actor_id',
    'action',
    'resource',
    'evaluated_at_ms',
    'decision',
    'reason',
    'permission_id',
    'permission_authority',
    'ui_selection_authority',
  ], 'builder_provider_context_disclosure_decision_unavailable');
  const decision = safeEnum(valueAt(source, 'decision', 'builder_provider_context_disclosure_decision_unavailable'), PERMISSION_DECISIONS, 'builder_provider_context_disclosure_decision_unavailable');
  const reason = valueAt(source, 'reason', 'builder_provider_context_disclosure_decision_unavailable');
  const permissionId = valueAt(source, 'permission_id', 'builder_provider_context_disclosure_decision_unavailable');
  if (
    valueAt(source, 'decision_version', 'builder_provider_context_disclosure_decision_unavailable') !== BUILDER_PERMISSION_DECISION_VERSION
    || valueAt(source, 'policy_version', 'builder_provider_context_disclosure_decision_unavailable') !== BUILDER_PERMISSION_POLICY_VERSION
    || safePattern(valueAt(source, 'actor_id', 'builder_provider_context_disclosure_decision_unavailable'), ACTOR_ID_PATTERN, 'builder_provider_context_disclosure_decision_unavailable') !== actorId
    || valueAt(source, 'action', 'builder_provider_context_disclosure_decision_unavailable') !== ACTION
    || safeTimestamp(valueAt(source, 'evaluated_at_ms', 'builder_provider_context_disclosure_decision_unavailable'), 'builder_provider_context_disclosure_decision_unavailable') !== evaluatedAtMs
    || valueAt(source, 'permission_authority', 'builder_provider_context_disclosure_decision_unavailable') !== 'builder_permission_facts_deny_by_default_v1'
    || valueAt(source, 'ui_selection_authority', 'builder_provider_context_disclosure_decision_unavailable') !== 'not_permission'
  ) fail('builder_provider_context_disclosure_decision_unavailable');
  const resource = sanitizeResource(
    valueAt(source, 'resource', 'builder_provider_context_disclosure_decision_unavailable'),
    expected,
    'builder_provider_context_disclosure_decision_unavailable',
  );
  if (decision === 'allowed') {
    if (reason !== 'matching_active_grant') fail('builder_provider_context_disclosure_decision_unavailable');
    return freezeDeep({
      policy_version: BUILDER_PERMISSION_POLICY_VERSION,
      actor_id: actorId,
      action: ACTION,
      resource,
      evaluated_at_ms: evaluatedAtMs,
      decision,
      reason,
      permission_id: safePattern(permissionId, PERMISSION_ID_PATTERN, 'builder_provider_context_disclosure_decision_unavailable'),
      permission_authority: 'builder_permission_facts_deny_by_default_v1',
      ui_selection_authority: 'not_permission',
    });
  }
  if (decision !== 'denied' || reason !== 'no_matching_active_grant' || permissionId !== null) {
    fail('builder_provider_context_disclosure_decision_unavailable');
  }
  return freezeDeep({
    policy_version: BUILDER_PERMISSION_POLICY_VERSION,
    actor_id: actorId,
    action: ACTION,
    resource,
    evaluated_at_ms: evaluatedAtMs,
    decision,
    reason,
    permission_id: null,
    permission_authority: 'builder_permission_facts_deny_by_default_v1',
    ui_selection_authority: 'not_permission',
  });
}

function disclosureDecisionFromEvidence(evidence, purpose) {
  if (evidence.decision === 'allowed') {
    return freezeDeep({
      decision: 'approved',
      approved_by: 'local_user',
      approved_at_ms: evidence.evaluated_at_ms,
      provider_scope: PROVIDER_SCOPE,
      purpose,
    });
  }
  return freezeDeep({
    decision: 'denied',
    approved_by: null,
    approved_at_ms: null,
    provider_scope: null,
    purpose: null,
  });
}

function resultRecord(disclosureDecision, permissionEvidence) {
  const body = freezeDeep({
    disclosure_decision: disclosureDecision,
    permission_evidence: permissionEvidence,
  });
  return freezeDeep({
    result_version: PROVIDER_CONTEXT_DISCLOSURE_DECISION_VERSION,
    decision_id: digestId('builder-provider-context-disclosure-decision', body),
    ...body,
    authority: { ...AUTHORITY },
  });
}

function sanitizeDisclosureDecision(value, evidence) {
  const source = exactObject(value, DISCLOSURE_DECISION_KEYS, 'builder_provider_context_disclosure_decision_unavailable');
  const decision = safeEnum(valueAt(source, 'decision', 'builder_provider_context_disclosure_decision_unavailable'), DISCLOSURE_DECISIONS, 'builder_provider_context_disclosure_decision_unavailable');
  if (decision === 'approved') {
    if (
      evidence.decision !== 'allowed'
      || valueAt(source, 'approved_by', 'builder_provider_context_disclosure_decision_unavailable') !== 'local_user'
      || valueAt(source, 'approved_at_ms', 'builder_provider_context_disclosure_decision_unavailable') !== evidence.evaluated_at_ms
      || valueAt(source, 'provider_scope', 'builder_provider_context_disclosure_decision_unavailable') !== PROVIDER_SCOPE
      || safeEnum(valueAt(source, 'purpose', 'builder_provider_context_disclosure_decision_unavailable'), PURPOSES, 'builder_provider_context_disclosure_decision_unavailable') !== evidence.resource.resource_id.slice('provider:configured/'.length)
    ) fail('builder_provider_context_disclosure_decision_unavailable');
    return freezeDeep({
      decision,
      approved_by: 'local_user',
      approved_at_ms: evidence.evaluated_at_ms,
      provider_scope: PROVIDER_SCOPE,
      purpose: valueAt(source, 'purpose', 'builder_provider_context_disclosure_decision_unavailable'),
    });
  }
  if (
    evidence.decision !== 'denied'
    || valueAt(source, 'approved_by', 'builder_provider_context_disclosure_decision_unavailable') !== null
    || valueAt(source, 'approved_at_ms', 'builder_provider_context_disclosure_decision_unavailable') !== null
    || valueAt(source, 'provider_scope', 'builder_provider_context_disclosure_decision_unavailable') !== null
    || valueAt(source, 'purpose', 'builder_provider_context_disclosure_decision_unavailable') !== null
  ) fail('builder_provider_context_disclosure_decision_unavailable');
  return freezeDeep({
    decision,
    approved_by: null,
    approved_at_ms: null,
    provider_scope: null,
    purpose: null,
  });
}

function sanitizePermissionEvidence(value) {
  const source = exactObject(value, PERMISSION_EVIDENCE_KEYS, 'builder_provider_context_disclosure_decision_unavailable');
  const resource = exactObject(valueAt(source, 'resource', 'builder_provider_context_disclosure_decision_unavailable'), RESOURCE_KEYS, 'builder_provider_context_disclosure_decision_unavailable');
  return freezeDeep({
    policy_version: valueAt(source, 'policy_version', 'builder_provider_context_disclosure_decision_unavailable') === BUILDER_PERMISSION_POLICY_VERSION ? BUILDER_PERMISSION_POLICY_VERSION : fail('builder_provider_context_disclosure_decision_unavailable'),
    actor_id: safePattern(valueAt(source, 'actor_id', 'builder_provider_context_disclosure_decision_unavailable'), ACTOR_ID_PATTERN, 'builder_provider_context_disclosure_decision_unavailable'),
    action: valueAt(source, 'action', 'builder_provider_context_disclosure_decision_unavailable') === ACTION ? ACTION : fail('builder_provider_context_disclosure_decision_unavailable'),
    resource: freezeDeep({
      resource_kind: valueAt(resource, 'resource_kind', 'builder_provider_context_disclosure_decision_unavailable') === RESOURCE_KIND ? RESOURCE_KIND : fail('builder_provider_context_disclosure_decision_unavailable'),
      project_id: safePattern(valueAt(resource, 'project_id', 'builder_provider_context_disclosure_decision_unavailable'), PROJECT_ID_PATTERN, 'builder_provider_context_disclosure_decision_unavailable'),
      resource_id: safeEnum(valueAt(resource, 'resource_id', 'builder_provider_context_disclosure_decision_unavailable'), [
        'provider:configured/answer',
        'provider:configured/plan',
        'provider:configured/contextual_build',
      ], 'builder_provider_context_disclosure_decision_unavailable'),
    }),
    evaluated_at_ms: safeTimestamp(valueAt(source, 'evaluated_at_ms', 'builder_provider_context_disclosure_decision_unavailable'), 'builder_provider_context_disclosure_decision_unavailable'),
    decision: safeEnum(valueAt(source, 'decision', 'builder_provider_context_disclosure_decision_unavailable'), PERMISSION_DECISIONS, 'builder_provider_context_disclosure_decision_unavailable'),
    reason: safeEnum(valueAt(source, 'reason', 'builder_provider_context_disclosure_decision_unavailable'), ['matching_active_grant', 'no_matching_active_grant'], 'builder_provider_context_disclosure_decision_unavailable'),
    permission_id: valueAt(source, 'permission_id', 'builder_provider_context_disclosure_decision_unavailable') === null
      ? null
      : safePattern(valueAt(source, 'permission_id', 'builder_provider_context_disclosure_decision_unavailable'), PERMISSION_ID_PATTERN, 'builder_provider_context_disclosure_decision_unavailable'),
    permission_authority: valueAt(source, 'permission_authority', 'builder_provider_context_disclosure_decision_unavailable') === 'builder_permission_facts_deny_by_default_v1'
      ? 'builder_permission_facts_deny_by_default_v1'
      : fail('builder_provider_context_disclosure_decision_unavailable'),
    ui_selection_authority: valueAt(source, 'ui_selection_authority', 'builder_provider_context_disclosure_decision_unavailable') === 'not_permission'
      ? 'not_permission'
      : fail('builder_provider_context_disclosure_decision_unavailable'),
  });
}

function sanitizeAuthority(value) {
  exactObject(value, AUTHORITY_KEYS, 'builder_provider_context_disclosure_decision_unavailable');
  if (canonicalJson(value) !== canonicalJson(AUTHORITY)) fail('builder_provider_context_disclosure_decision_unavailable');
  return freezeDeep({ ...AUTHORITY });
}

function sanitizeBuilderProviderContextDisclosureDecision(value) {
  const source = exactObject(value, RESULT_KEYS, 'builder_provider_context_disclosure_decision_unavailable');
  if (valueAt(source, 'result_version', 'builder_provider_context_disclosure_decision_unavailable') !== PROVIDER_CONTEXT_DISCLOSURE_DECISION_VERSION) {
    fail('builder_provider_context_disclosure_decision_unavailable');
  }
  const evidence = sanitizePermissionEvidence(valueAt(source, 'permission_evidence', 'builder_provider_context_disclosure_decision_unavailable'));
  const disclosureDecision = sanitizeDisclosureDecision(
    valueAt(source, 'disclosure_decision', 'builder_provider_context_disclosure_decision_unavailable'),
    evidence,
  );
  const normalized = resultRecord(disclosureDecision, evidence);
  if (
    valueAt(source, 'decision_id', 'builder_provider_context_disclosure_decision_unavailable') !== normalized.decision_id
    || safePattern(valueAt(source, 'decision_id', 'builder_provider_context_disclosure_decision_unavailable'), DECISION_ID_PATTERN, 'builder_provider_context_disclosure_decision_unavailable') !== normalized.decision_id
  ) fail('builder_provider_context_disclosure_decision_unavailable');
  return freezeDeep({
    ...normalized,
    authority: sanitizeAuthority(valueAt(source, 'authority', 'builder_provider_context_disclosure_decision_unavailable')),
  });
}

function normalizeError(error) {
  if (error instanceof BuilderProviderContextDisclosureDecisionError) return error;
  if (error instanceof BuilderPermissionAuthorityContractError) {
    return new BuilderProviderContextDisclosureDecisionError();
  }
  return new BuilderProviderContextDisclosureDecisionError();
}

function createBuilderProviderContextDisclosureDecisionService(rawOptions) {
  const options = safeOptions(rawOptions);

  async function decide(rawInput) {
    try {
      const input = exactObject(rawInput, INPUT_KEYS, 'builder_provider_context_disclosure_decision_unavailable');
      const assembly = sanitizeBuilderContextAssembly(valueAt(input, 'context_assembly', 'builder_provider_context_disclosure_decision_unavailable'));
      const nowMs = safeTimestamp(Reflect.apply(options.nowMs, undefined, []), 'builder_provider_context_disclosure_decision_unavailable');
      if (assembly.assembled_at_ms > nowMs) fail('builder_provider_context_disclosure_decision_unavailable');
      const resource = resourceFor(assembly);
      const permissionDecision = await Reflect.apply(options.evaluatePermission, undefined, [{
        policy_version: BUILDER_PERMISSION_POLICY_VERSION,
        actor_id: options.actorId,
        action: ACTION,
        resource,
        now_ms: nowMs,
      }]);
      const evidence = sanitizePermissionDecision(permissionDecision, resource, options.actorId, nowMs);
      return resultRecord(
        disclosureDecisionFromEvidence(evidence, assembly.assembly_purpose),
        evidence,
      );
    } catch (error) {
      throw normalizeError(error);
    }
  }

  return freezeDeep({
    service_version: PROVIDER_CONTEXT_DISCLOSURE_DECISION_VERSION,
    authority: { ...AUTHORITY },
    decide,
  });
}

module.exports = freezeDeep({
  PROVIDER_CONTEXT_DISCLOSURE_DECISION_VERSION,
  BuilderProviderContextDisclosureDecisionError,
  createBuilderProviderContextDisclosureDecisionService,
  sanitizeBuilderProviderContextDisclosureDecision,
});
