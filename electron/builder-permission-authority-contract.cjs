'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const BUILDER_PERMISSION_POLICY_VERSION = 'builder-permission-policy.v1';
const BUILDER_PERMISSION_EVALUATOR_VERSION = 'builder-permission-evaluator.v1';
const BUILDER_PERMISSION_GRANT_RECORD_VERSION = 'builder-permission-grant.v1';
const BUILDER_PERMISSION_REVOCATION_RECORD_VERSION = 'builder-permission-revocation.v1';
const BUILDER_PERMISSION_FACTS_READ_RESULT_VERSION = 'builder-permission-facts-read-result.v1';
const BUILDER_PERMISSION_DECISION_VERSION = 'builder-permission-decision.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const ACTOR_ID_PATTERN = new RegExp(`^(?:builder-user|builder-agent):${UUID_SOURCE}$`, 'u');
const PERMISSION_ID_PATTERN = /^builder-permission:[0-9a-f]{64}$/u;
const REVOCATION_ID_PATTERN = /^builder-permission-revocation:[0-9a-f]{64}$/u;
const RESOURCE_ID_PATTERN = /^[a-z][a-z0-9._:/@-]{0,127}$/u;
const MAX_FACTS = 256;
const EVALUATOR_OPTION_KEYS = Object.freeze(['read_permission_facts']);
const GRANT_INPUT_KEYS = Object.freeze([
  'record_version',
  'policy_version',
  'project_id',
  'actor_id',
  'issuer_id',
  'scope_kind',
  'action',
  'resource',
  'issued_at_ms',
  'expires_at_ms',
]);
const GRANT_RECORD_KEYS = Object.freeze(['permission_id', ...GRANT_INPUT_KEYS]);
const REVOCATION_INPUT_KEYS = Object.freeze([
  'record_version',
  'policy_version',
  'permission_id',
  'project_id',
  'revoker_id',
  'revoked_at_ms',
]);
const REVOCATION_RECORD_KEYS = Object.freeze(['revocation_id', ...REVOCATION_INPUT_KEYS]);
const RESOURCE_KEYS = Object.freeze(['resource_kind', 'project_id', 'resource_id']);
const EVALUATE_REQUEST_KEYS = Object.freeze([
  'policy_version',
  'actor_id',
  'action',
  'resource',
  'now_ms',
]);
const FACTS_READ_RESULT_KEYS = Object.freeze([
  'result_version',
  'permission_authority',
  'policy_version',
  'actor_id',
  'action',
  'resource',
  'grants',
  'revocations',
]);
const RESOURCE_KINDS = Object.freeze([
  'project',
  'conversation',
  'task',
  'run',
  'revision',
  'artifact',
  'secret',
  'filesystem',
  'network',
  'process',
  'provider',
  'publication',
  'permission',
]);
const ACTION_RESOURCE_KINDS = Object.freeze({
  'context.read': Object.freeze(['project', 'conversation', 'task', 'run', 'revision', 'artifact']),
  'context.disclose': Object.freeze(['provider']),
  'project.read': Object.freeze(['project', 'revision']),
  'project.edit': Object.freeze(['project']),
  'secret.read': Object.freeze(['secret']),
  'filesystem.read': Object.freeze(['filesystem']),
  'filesystem.write': Object.freeze(['filesystem']),
  'network.request': Object.freeze(['network']),
  'process.spawn': Object.freeze(['process']),
  'publication.create': Object.freeze(['publication']),
  'permission.grant': Object.freeze(['permission']),
});
const ERROR_MESSAGES = Object.freeze({
  builder_permission_authority_contract_invalid: 'Builder permission facts could not be verified.',
});

class BuilderPermissionAuthorityContractError extends Error {
  constructor() {
    super(ERROR_MESSAGES.builder_permission_authority_contract_invalid);
    this.name = 'BuilderPermissionAuthorityContractError';
    this.code = 'builder_permission_authority_contract_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderPermissionAuthorityContractError();
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
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail();
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail();
  }
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
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`,
    ).join(',')}}`;
  }
  fail();
}

function sha256Canonical(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeProjectId(value) {
  return safePattern(value, PROJECT_ID_PATTERN);
}

function safeActorId(value) {
  return safePattern(value, ACTOR_ID_PATTERN);
}

function safePermissionId(value) {
  return safePattern(value, PERMISSION_ID_PATTERN);
}

function safeRevocationId(value) {
  return safePattern(value, REVOCATION_ID_PATTERN);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeNullableTimestamp(value) {
  if (value === null) return null;
  return safeTimestamp(value);
}

function safePolicyVersion(value) {
  if (value !== BUILDER_PERMISSION_POLICY_VERSION) fail();
  return value;
}

function safeAction(value) {
  if (typeof value !== 'string' || !Object.hasOwn(ACTION_RESOURCE_KINDS, value)) fail();
  return value;
}

function safeResourceKind(value) {
  if (typeof value !== 'string' || !RESOURCE_KINDS.includes(value)) fail();
  return value;
}

function safeResourceId(value) {
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || !RESOURCE_ID_PATTERN.test(value)
  ) fail();
  return value;
}

function stableMethod(value, key) {
  if (!isPlainObject(value)) fail();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (
    !descriptor
    || descriptor.enumerable !== true
    || !Object.hasOwn(descriptor, 'value')
    || typeof descriptor.value !== 'function'
    || utilTypes.isProxy(descriptor.value)
  ) fail();
  return descriptor.value;
}

function sanitizeResource(value) {
  exactObject(value, RESOURCE_KEYS);
  return freezeDeep({
    resource_kind: safeResourceKind(valueAt(value, 'resource_kind')),
    project_id: safeProjectId(valueAt(value, 'project_id')),
    resource_id: safeResourceId(valueAt(value, 'resource_id')),
  });
}

function assertActionResource(action, resource) {
  if (!ACTION_RESOURCE_KINDS[action].includes(resource.resource_kind)) fail();
}

function sanitizeGrantFields(value) {
  exactObject(value, GRANT_INPUT_KEYS);
  const recordVersion = valueAt(value, 'record_version');
  const policyVersion = safePolicyVersion(valueAt(value, 'policy_version'));
  const projectId = safeProjectId(valueAt(value, 'project_id'));
  const actorId = safeActorId(valueAt(value, 'actor_id'));
  const issuerId = safeActorId(valueAt(value, 'issuer_id'));
  const scopeKind = valueAt(value, 'scope_kind');
  const action = safeAction(valueAt(value, 'action'));
  const resource = sanitizeResource(valueAt(value, 'resource'));
  const issuedAtMs = safeTimestamp(valueAt(value, 'issued_at_ms'));
  const expiresAtMs = safeNullableTimestamp(valueAt(value, 'expires_at_ms'));
  if (
    recordVersion !== BUILDER_PERMISSION_GRANT_RECORD_VERSION
    || scopeKind !== 'project'
    || resource.project_id !== projectId
    || (expiresAtMs !== null && expiresAtMs <= issuedAtMs)
  ) fail();
  assertActionResource(action, resource);
  return freezeDeep({
    record_version: BUILDER_PERMISSION_GRANT_RECORD_VERSION,
    policy_version: policyVersion,
    project_id: projectId,
    actor_id: actorId,
    issuer_id: issuerId,
    scope_kind: 'project',
    action,
    resource,
    issued_at_ms: issuedAtMs,
    expires_at_ms: expiresAtMs,
  });
}

function permissionIdFor(grantFields) {
  return `builder-permission:${sha256Canonical({
    permission_identity: 'builder-permission-grant-id.v1',
    grant: grantFields,
  }).slice('sha256:'.length)}`;
}

function createBuilderPermissionGrantRecord(value) {
  try {
    const fields = sanitizeGrantFields(value);
    return freezeDeep({
      permission_id: permissionIdFor(fields),
      ...fields,
    });
  } catch (error) {
    if (error instanceof BuilderPermissionAuthorityContractError) throw error;
    fail();
  }
}

function sanitizeBuilderPermissionGrantRecord(value) {
  try {
    exactObject(value, GRANT_RECORD_KEYS);
    const permissionId = safePermissionId(valueAt(value, 'permission_id'));
    const fields = sanitizeGrantFields({
      record_version: valueAt(value, 'record_version'),
      policy_version: valueAt(value, 'policy_version'),
      project_id: valueAt(value, 'project_id'),
      actor_id: valueAt(value, 'actor_id'),
      issuer_id: valueAt(value, 'issuer_id'),
      scope_kind: valueAt(value, 'scope_kind'),
      action: valueAt(value, 'action'),
      resource: valueAt(value, 'resource'),
      issued_at_ms: valueAt(value, 'issued_at_ms'),
      expires_at_ms: valueAt(value, 'expires_at_ms'),
    });
    if (permissionId !== permissionIdFor(fields)) fail();
    return freezeDeep({ permission_id: permissionId, ...fields });
  } catch (error) {
    if (error instanceof BuilderPermissionAuthorityContractError) throw error;
    fail();
  }
}

function sanitizeRevocationFields(value) {
  exactObject(value, REVOCATION_INPUT_KEYS);
  const recordVersion = valueAt(value, 'record_version');
  const policyVersion = safePolicyVersion(valueAt(value, 'policy_version'));
  const permissionId = safePermissionId(valueAt(value, 'permission_id'));
  const projectId = safeProjectId(valueAt(value, 'project_id'));
  const revokerId = safeActorId(valueAt(value, 'revoker_id'));
  const revokedAtMs = safeTimestamp(valueAt(value, 'revoked_at_ms'));
  if (recordVersion !== BUILDER_PERMISSION_REVOCATION_RECORD_VERSION) fail();
  return freezeDeep({
    record_version: BUILDER_PERMISSION_REVOCATION_RECORD_VERSION,
    policy_version: policyVersion,
    permission_id: permissionId,
    project_id: projectId,
    revoker_id: revokerId,
    revoked_at_ms: revokedAtMs,
  });
}

function revocationIdFor(revocationFields) {
  return `builder-permission-revocation:${sha256Canonical({
    permission_identity: 'builder-permission-revocation-id.v1',
    revocation: revocationFields,
  }).slice('sha256:'.length)}`;
}

function createBuilderPermissionRevocationRecord(value) {
  try {
    const fields = sanitizeRevocationFields(value);
    return freezeDeep({
      revocation_id: revocationIdFor(fields),
      ...fields,
    });
  } catch (error) {
    if (error instanceof BuilderPermissionAuthorityContractError) throw error;
    fail();
  }
}

function sanitizeBuilderPermissionRevocationRecord(value) {
  try {
    exactObject(value, REVOCATION_RECORD_KEYS);
    const revocationId = safeRevocationId(valueAt(value, 'revocation_id'));
    const fields = sanitizeRevocationFields({
      record_version: valueAt(value, 'record_version'),
      policy_version: valueAt(value, 'policy_version'),
      permission_id: valueAt(value, 'permission_id'),
      project_id: valueAt(value, 'project_id'),
      revoker_id: valueAt(value, 'revoker_id'),
      revoked_at_ms: valueAt(value, 'revoked_at_ms'),
    });
    if (revocationId !== revocationIdFor(fields)) fail();
    return freezeDeep({ revocation_id: revocationId, ...fields });
  } catch (error) {
    if (error instanceof BuilderPermissionAuthorityContractError) throw error;
    fail();
  }
}

function sameResource(left, right) {
  return left.resource_kind === right.resource_kind
    && left.project_id === right.project_id
    && left.resource_id === right.resource_id;
}

function sanitizeFactList(value, sanitizer) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > MAX_FACTS) {
    fail();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !Object.hasOwn(descriptors, 'length')) fail();
  const facts = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
    facts.push(sanitizer(descriptor.value));
  }
  return freezeDeep(facts);
}

function sanitizeEvaluateRequest(value) {
  exactObject(value, EVALUATE_REQUEST_KEYS);
  const action = safeAction(valueAt(value, 'action'));
  const resource = sanitizeResource(valueAt(value, 'resource'));
  assertActionResource(action, resource);
  return freezeDeep({
    policy_version: safePolicyVersion(valueAt(value, 'policy_version')),
    actor_id: safeActorId(valueAt(value, 'actor_id')),
    action,
    resource,
    now_ms: safeTimestamp(valueAt(value, 'now_ms')),
  });
}

function sanitizeFactsReadResult(value, request) {
  exactObject(value, FACTS_READ_RESULT_KEYS);
  const action = safeAction(valueAt(value, 'action'));
  const resource = sanitizeResource(valueAt(value, 'resource'));
  const policyVersion = safePolicyVersion(valueAt(value, 'policy_version'));
  const actorId = safeActorId(valueAt(value, 'actor_id'));
  if (
    valueAt(value, 'result_version') !== BUILDER_PERMISSION_FACTS_READ_RESULT_VERSION
    || valueAt(value, 'permission_authority') !== 'main_owned_permission_fact_store'
    || policyVersion !== request.policy_version
    || actorId !== request.actor_id
    || action !== request.action
    || !sameResource(resource, request.resource)
  ) fail();
  const grants = sanitizeFactList(valueAt(value, 'grants'), sanitizeBuilderPermissionGrantRecord);
  const revocations = sanitizeFactList(
    valueAt(value, 'revocations'),
    sanitizeBuilderPermissionRevocationRecord,
  );
  return freezeDeep({
    result_version: BUILDER_PERMISSION_FACTS_READ_RESULT_VERSION,
    permission_authority: 'main_owned_permission_fact_store',
    policy_version: policyVersion,
    actor_id: actorId,
    action,
    resource,
    grants,
    revocations,
  });
}

function revokedPermissionIds(facts, nowMs) {
  const revoked = new Set();
  for (const revocation of facts.revocations) {
    if (
      revocation.policy_version === facts.policy_version
      && revocation.project_id === facts.resource.project_id
      && revocation.revoked_at_ms <= nowMs
    ) revoked.add(revocation.permission_id);
  }
  return revoked;
}

function isActiveGrant(grant, request, revoked) {
  return grant.policy_version === request.policy_version
    && grant.actor_id === request.actor_id
    && grant.action === request.action
    && sameResource(grant.resource, request.resource)
    && grant.issued_at_ms <= request.now_ms
    && !revoked.has(grant.permission_id)
    && (grant.expires_at_ms === null || request.now_ms < grant.expires_at_ms);
}

function decisionFor(request, grant) {
  return freezeDeep({
    decision_version: BUILDER_PERMISSION_DECISION_VERSION,
    policy_version: request.policy_version,
    actor_id: request.actor_id,
    action: request.action,
    resource: request.resource,
    evaluated_at_ms: request.now_ms,
    decision: grant === null ? 'denied' : 'allowed',
    reason: grant === null ? 'no_matching_active_grant' : 'matching_active_grant',
    permission_id: grant === null ? null : grant.permission_id,
    permission_authority: 'builder_permission_facts_deny_by_default_v1',
    ui_selection_authority: 'not_permission',
  });
}

function sanitizeOptions(value) {
  exactObject(value, EVALUATOR_OPTION_KEYS);
  return freezeDeep({
    readPermissionFacts: stableMethod(value, 'read_permission_facts'),
  });
}

function createBuilderPermissionEvaluator(value) {
  const options = sanitizeOptions(value);

  async function evaluate(rawRequest) {
    try {
      const request = sanitizeEvaluateRequest(rawRequest);
      const facts = sanitizeFactsReadResult(
        await Reflect.apply(options.readPermissionFacts, undefined, [request]),
        request,
      );
      const revoked = revokedPermissionIds(facts, request.now_ms);
      const grant = facts.grants.find((entry) => isActiveGrant(entry, request, revoked)) ?? null;
      return decisionFor(request, grant);
    } catch (error) {
      if (error instanceof BuilderPermissionAuthorityContractError) throw error;
      fail();
    }
  }

  return freezeDeep({
    evaluator_version: BUILDER_PERMISSION_EVALUATOR_VERSION,
    authority: {
      request_authority: 'actor_action_resource_only',
      fact_authority: 'main_owned_permission_fact_store',
      deny_by_default: true,
      ui_selection_authority: 'not_permission',
      direct_renderer_authority: false,
      direct_ipc_authority: false,
      provider_dispatch: false,
      credential_readback: false,
    },
    evaluate,
  });
}

module.exports = Object.freeze({
  BUILDER_PERMISSION_POLICY_VERSION,
  BUILDER_PERMISSION_EVALUATOR_VERSION,
  BUILDER_PERMISSION_GRANT_RECORD_VERSION,
  BUILDER_PERMISSION_REVOCATION_RECORD_VERSION,
  BUILDER_PERMISSION_FACTS_READ_RESULT_VERSION,
  BUILDER_PERMISSION_DECISION_VERSION,
  BuilderPermissionAuthorityContractError,
  createBuilderPermissionEvaluator,
  createBuilderPermissionGrantRecord,
  createBuilderPermissionRevocationRecord,
  sanitizeBuilderPermissionGrantRecord,
  sanitizeBuilderPermissionRevocationRecord,
});
