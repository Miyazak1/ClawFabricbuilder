'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_PERMISSION_DECISION_VERSION,
  BUILDER_PERMISSION_POLICY_VERSION,
  BuilderPermissionAuthorityContractError,
} = require('./builder-permission-authority-contract.cjs');

const BUILDER_TOOL_PERMISSION_ADMISSION_VERSION = 'builder-tool-permission-admission.v1';
const OPTION_KEYS = Object.freeze(['evaluate_permission', 'actor_id', 'now_ms']);
const REQUEST_KEYS = Object.freeze(['tool_call_id', 'tool_name', 'project_id', 'action', 'resource']);
const RESOURCE_KEYS = Object.freeze(['resource_kind', 'project_id', 'resource_id']);
const DECISION_KEYS = Object.freeze([
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
]);
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const ACTOR_ID_PATTERN = new RegExp(`^(?:builder-user|builder-agent):${UUID_SOURCE}$`, 'u');
const TOOL_CALL_ID_PATTERN = new RegExp(`^builder-tool-call:${UUID_SOURCE}$`, 'u');
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9.-]{0,63}$/u;
const PERMISSION_ID_PATTERN = /^builder-permission:[0-9a-f]{64}$/u;
const RESOURCE_ID_PATTERN = /^[a-z][a-z0-9._:/@-]{0,127}$/u;
const ACTION_RESOURCE_KINDS = Object.freeze({
  'context.read': Object.freeze(['project', 'conversation', 'task', 'run', 'revision', 'artifact']),
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
  builder_tool_permission_admission_denied: 'The requested action is not permitted.',
  builder_tool_permission_admission_invalid: 'The requested action could not be verified.',
  builder_tool_permission_admission_unavailable: 'Permission admission is unavailable.',
});

class BuilderToolPermissionAdmissionError extends Error {
  constructor(code = 'builder_tool_permission_admission_unavailable') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_tool_permission_admission_unavailable';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderToolPermissionAdmissionError';
    this.code = selected;
    this.retryable = selected === 'builder_tool_permission_admission_unavailable';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderToolPermissionAdmissionError(code);
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

function exactObject(value, keys, code = 'builder_tool_permission_admission_invalid') {
  if (!isPlainObject(value)) fail(code);
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail(code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail(code);
    }
  }
  return descriptors;
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_tool_permission_admission_invalid');
  }
  return descriptor.value;
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
  fail('builder_tool_permission_admission_invalid');
}

function sha256Canonical(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function safePattern(value, pattern, code = 'builder_tool_permission_admission_invalid') {
  if (typeof value !== 'string' || !pattern.test(value)) fail(code);
  return value;
}

function safeProjectId(value) {
  return safePattern(value, PROJECT_ID_PATTERN);
}

function safeActorId(value, code = 'builder_tool_permission_admission_invalid') {
  return safePattern(value, ACTOR_ID_PATTERN, code);
}

function safeToolCallId(value) {
  return safePattern(value, TOOL_CALL_ID_PATTERN);
}

function safeToolName(value) {
  return safePattern(value, TOOL_NAME_PATTERN);
}

function safeAction(value) {
  if (typeof value !== 'string' || !Object.hasOwn(ACTION_RESOURCE_KINDS, value)) {
    fail('builder_tool_permission_admission_invalid');
  }
  return value;
}

function safeResourceKind(value, action) {
  if (
    typeof value !== 'string'
    || !ACTION_RESOURCE_KINDS[action].includes(value)
  ) fail('builder_tool_permission_admission_invalid');
  return value;
}

function safeResourceId(value) {
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || !RESOURCE_ID_PATTERN.test(value)
  ) fail('builder_tool_permission_admission_invalid');
  return value;
}

function safeTimestamp(value, code = 'builder_tool_permission_admission_invalid') {
  if (!Number.isSafeInteger(value) || value < 0) fail(code);
  return value;
}

function safePermissionId(value) {
  return safePattern(value, PERMISSION_ID_PATTERN, 'builder_tool_permission_admission_unavailable');
}

function stableMethod(value, key) {
  const descriptor = exactObject(value, OPTION_KEYS, 'builder_tool_permission_admission_unavailable')[key];
  if (
    typeof descriptor.value !== 'function'
    || utilTypes.isProxy(descriptor.value)
  ) fail('builder_tool_permission_admission_unavailable');
  return descriptor.value;
}

function safeOptions(value) {
  try {
    const descriptors = exactObject(value, OPTION_KEYS, 'builder_tool_permission_admission_unavailable');
    const actorId = safeActorId(descriptors.actor_id.value, 'builder_tool_permission_admission_unavailable');
    const nowMs = descriptors.now_ms.value;
    if (typeof nowMs !== 'function' || utilTypes.isProxy(nowMs)) {
      fail('builder_tool_permission_admission_unavailable');
    }
    return freezeDeep({
      actorId,
      evaluatePermission: stableMethod(value, 'evaluate_permission'),
      nowMs,
    });
  } catch (error) {
    if (error instanceof BuilderToolPermissionAdmissionError) throw error;
    fail('builder_tool_permission_admission_unavailable');
  }
}

function sanitizeResource(value, action) {
  const descriptors = exactObject(value, RESOURCE_KEYS);
  return freezeDeep({
    resource_kind: safeResourceKind(descriptors.resource_kind.value, action),
    project_id: safeProjectId(descriptors.project_id.value),
    resource_id: safeResourceId(descriptors.resource_id.value),
  });
}

function sanitizeAdmissionRequest(value) {
  const descriptors = exactObject(value, REQUEST_KEYS);
  const action = safeAction(descriptors.action.value);
  const projectId = safeProjectId(descriptors.project_id.value);
  const resource = sanitizeResource(descriptors.resource.value, action);
  if (resource.project_id !== projectId) fail('builder_tool_permission_admission_invalid');
  return freezeDeep({
    tool_call_id: safeToolCallId(descriptors.tool_call_id.value),
    tool_name: safeToolName(descriptors.tool_name.value),
    project_id: projectId,
    action,
    resource,
  });
}

function currentTime(options) {
  try {
    const now = Reflect.apply(options.nowMs, undefined, []);
    return safeTimestamp(now, 'builder_tool_permission_admission_unavailable');
  } catch (error) {
    if (error instanceof BuilderToolPermissionAdmissionError) throw error;
    fail('builder_tool_permission_admission_unavailable');
  }
}

function sameResource(left, right) {
  return left.resource_kind === right.resource_kind
    && left.project_id === right.project_id
    && left.resource_id === right.resource_id;
}

function sanitizeDecisionResource(value, request) {
  const resource = sanitizeResource(value, request.action);
  if (!sameResource(resource, request.resource)) fail('builder_tool_permission_admission_unavailable');
  return resource;
}

function admissionDigestBody(value) {
  return {
    action: value.action,
    actor_id: value.actor_id,
    admission_authority: value.admission_authority,
    admission_version: value.admission_version,
    evaluated_at_ms: value.evaluated_at_ms,
    execution_admission: value.execution_admission,
    permission_authority: value.permission_authority,
    permission_decision: value.permission_decision,
    permission_id: value.permission_id,
    project_id: value.project_id,
    resource: value.resource,
    tool_call_id: value.tool_call_id,
    tool_name: value.tool_name,
    ui_selection_authority: value.ui_selection_authority,
  };
}

function admissionRecord(request, decision) {
  const unsigned = freezeDeep({
    admission_version: BUILDER_TOOL_PERMISSION_ADMISSION_VERSION,
    tool_call_id: request.tool_call_id,
    tool_name: request.tool_name,
    actor_id: decision.actor_id,
    project_id: request.project_id,
    action: request.action,
    resource: request.resource,
    evaluated_at_ms: decision.evaluated_at_ms,
    permission_decision: 'allowed',
    permission_id: decision.permission_id,
    permission_authority: 'builder_permission_facts_deny_by_default_v1',
    ui_selection_authority: 'not_permission',
    execution_admission: 'permission_allowed_dispatch_not_performed',
    admission_authority: 'main_permission_decision_before_tool_dispatch_v1',
  });
  return freezeDeep({
    ...unsigned,
    evidence_digest: sha256Canonical(admissionDigestBody(unsigned)),
  });
}

function sanitizePermissionDecision(value, request, actorId, evaluatedAtMs) {
  const descriptors = exactObject(value, DECISION_KEYS, 'builder_tool_permission_admission_unavailable');
  const decision = descriptors.decision.value;
  const reason = descriptors.reason.value;
  if (
    descriptors.decision_version.value !== BUILDER_PERMISSION_DECISION_VERSION
    || descriptors.policy_version.value !== BUILDER_PERMISSION_POLICY_VERSION
    || safeActorId(descriptors.actor_id.value, 'builder_tool_permission_admission_unavailable') !== actorId
    || descriptors.action.value !== request.action
    || safeTimestamp(descriptors.evaluated_at_ms.value, 'builder_tool_permission_admission_unavailable') !== evaluatedAtMs
    || descriptors.permission_authority.value !== 'builder_permission_facts_deny_by_default_v1'
    || descriptors.ui_selection_authority.value !== 'not_permission'
  ) fail('builder_tool_permission_admission_unavailable');
  const resource = sanitizeDecisionResource(descriptors.resource.value, request);
  if (decision === 'denied' && reason === 'no_matching_active_grant' && descriptors.permission_id.value === null) {
    fail('builder_tool_permission_admission_denied');
  }
  if (
    decision !== 'allowed'
    || reason !== 'matching_active_grant'
  ) fail('builder_tool_permission_admission_unavailable');
  return freezeDeep({
    actor_id: actorId,
    action: request.action,
    resource,
    evaluated_at_ms: evaluatedAtMs,
    permission_id: safePermissionId(descriptors.permission_id.value),
  });
}

function normalizeError(error) {
  if (error instanceof BuilderToolPermissionAdmissionError) {
    return new BuilderToolPermissionAdmissionError(error.code);
  }
  if (error instanceof BuilderPermissionAuthorityContractError) {
    return new BuilderToolPermissionAdmissionError('builder_tool_permission_admission_unavailable');
  }
  return new BuilderToolPermissionAdmissionError('builder_tool_permission_admission_unavailable');
}

function createBuilderToolPermissionAdmission(rawOptions) {
  const options = safeOptions(rawOptions);

  async function admit(rawRequest) {
    try {
      const request = sanitizeAdmissionRequest(rawRequest);
      const nowMs = currentTime(options);
      const decision = await Reflect.apply(options.evaluatePermission, undefined, [{
        policy_version: BUILDER_PERMISSION_POLICY_VERSION,
        actor_id: options.actorId,
        action: request.action,
        resource: request.resource,
        now_ms: nowMs,
      }]);
      return admissionRecord(
        request,
        sanitizePermissionDecision(decision, request, options.actorId, nowMs),
      );
    } catch (error) {
      throw normalizeError(error);
    }
  }

  return freezeDeep({
    admission_version: BUILDER_TOOL_PERMISSION_ADMISSION_VERSION,
    authority: {
      actor_authority: 'main_bound_actor_id',
      permission_authority: 'main_owned_permission_facts',
      renderer_authority: 'not_present',
      ui_selection_authority: 'not_permission',
      tool_dispatch: 'not_performed',
      provider_dispatch: false,
      credential_readback: false,
      grant_command: false,
      revoke_command: false,
      direct_ipc_authority: false,
      direct_preload_exposure: false,
    },
    admit,
  });
}

module.exports = freezeDeep({
  BUILDER_TOOL_PERMISSION_ADMISSION_VERSION,
  BuilderToolPermissionAdmissionError,
  createBuilderToolPermissionAdmission,
});
