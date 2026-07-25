'use strict';

const { types: utilTypes } = require('node:util');

const {
  BUILDER_PERMISSION_DECISION_VERSION,
  BUILDER_PERMISSION_POLICY_VERSION,
} = require('./builder-permission-authority-contract.cjs');

const EVALUATE_PERMISSION_CHANNEL = 'clawfabric-builder:permissions:evaluate';
const OPTION_KEYS = Object.freeze(['evaluatePermission', 'mainWindowRef']);
const REQUEST_KEYS = Object.freeze(['project_id', 'action', 'resource_kind', 'resource_id']);
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
  builder_permission_forbidden: 'Permissions are unavailable.',
  builder_permission_request_invalid: 'The permission request could not be verified.',
  builder_permission_unavailable: 'Permissions are unavailable.',
});

class BuilderPermissionIpcError extends Error {
  constructor(code = 'builder_permission_unavailable') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_permission_unavailable';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderPermissionIpcError';
    this.code = selected;
    this.retryable = selected === 'builder_permission_unavailable';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function ipcError(code) {
  return new BuilderPermissionIpcError(code);
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

function exactObject(value, keys, code = 'builder_permission_request_invalid') {
  if (!isPlainObject(value)) throw ipcError(code);
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) throw ipcError(code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      throw ipcError(code);
    }
  }
  return descriptors;
}

function stableMethod(value, key) {
  const descriptor = exactObject(value, OPTION_KEYS, 'builder_permission_unavailable')[key];
  if (
    typeof descriptor.value !== 'function'
    || utilTypes.isProxy(descriptor.value)
  ) throw ipcError();
  return descriptor.value;
}

function safeOptions(value) {
  try {
    const descriptors = exactObject(value, OPTION_KEYS, 'builder_permission_unavailable');
    const mainWindowRef = descriptors.mainWindowRef.value;
    if (typeof mainWindowRef !== 'function' || utilTypes.isProxy(mainWindowRef)) {
      throw ipcError();
    }
    return Object.freeze({
      evaluatePermission: stableMethod(value, 'evaluatePermission'),
      mainWindowRef,
    });
  } catch {
    throw ipcError();
  }
}

function safeProjectId(value) {
  if (typeof value !== 'string' || !PROJECT_ID_PATTERN.test(value)) {
    throw ipcError('builder_permission_request_invalid');
  }
  return value;
}

function safeAction(value) {
  if (typeof value !== 'string' || !Object.hasOwn(ACTION_RESOURCE_KINDS, value)) {
    throw ipcError('builder_permission_request_invalid');
  }
  return value;
}

function safeResourceKind(value, action) {
  if (
    typeof value !== 'string'
    || !ACTION_RESOURCE_KINDS[action].includes(value)
  ) throw ipcError('builder_permission_request_invalid');
  return value;
}

function safeResourceId(value) {
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || !RESOURCE_ID_PATTERN.test(value)
  ) throw ipcError('builder_permission_request_invalid');
  return value;
}

function safeEvaluateRequest(value) {
  try {
    const descriptors = exactObject(value, REQUEST_KEYS);
    const action = safeAction(descriptors.action.value);
    return Object.freeze({
      project_id: safeProjectId(descriptors.project_id.value),
      action,
      resource_kind: safeResourceKind(descriptors.resource_kind.value, action),
      resource_id: safeResourceId(descriptors.resource_id.value),
    });
  } catch (error) {
    if (error instanceof BuilderPermissionIpcError) throw error;
    throw ipcError('builder_permission_request_invalid');
  }
}

function safeActorId(value) {
  if (typeof value !== 'string' || !ACTOR_ID_PATTERN.test(value)) throw ipcError();
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw ipcError();
  return value;
}

function safePermissionId(value, decision) {
  if (decision === 'denied') {
    if (value !== null) throw ipcError();
    return null;
  }
  if (typeof value !== 'string' || !PERMISSION_ID_PATTERN.test(value)) throw ipcError();
  return value;
}

function sanitizeDecisionResource(value, request) {
  const descriptors = exactObject(value, RESOURCE_KEYS, 'builder_permission_unavailable');
  const resource = Object.freeze({
    resource_kind: descriptors.resource_kind.value,
    project_id: descriptors.project_id.value,
    resource_id: descriptors.resource_id.value,
  });
  if (
    resource.resource_kind !== request.resource_kind
    || resource.project_id !== request.project_id
    || resource.resource_id !== request.resource_id
  ) throw ipcError();
  return resource;
}

function sanitizeDecision(value, request) {
  try {
    const descriptors = exactObject(value, DECISION_KEYS, 'builder_permission_unavailable');
    const decision = descriptors.decision.value;
    const reason = descriptors.reason.value;
    if (
      descriptors.decision_version.value !== BUILDER_PERMISSION_DECISION_VERSION
      || descriptors.policy_version.value !== BUILDER_PERMISSION_POLICY_VERSION
      || descriptors.action.value !== request.action
      || !['allowed', 'denied'].includes(decision)
      || (decision === 'allowed' && reason !== 'matching_active_grant')
      || (decision === 'denied' && reason !== 'no_matching_active_grant')
      || descriptors.permission_authority.value !== 'builder_permission_facts_deny_by_default_v1'
      || descriptors.ui_selection_authority.value !== 'not_permission'
    ) throw ipcError();
    return Object.freeze({
      decision_version: BUILDER_PERMISSION_DECISION_VERSION,
      policy_version: BUILDER_PERMISSION_POLICY_VERSION,
      actor_id: safeActorId(descriptors.actor_id.value),
      action: request.action,
      resource: sanitizeDecisionResource(descriptors.resource.value, request),
      evaluated_at_ms: safeTimestamp(descriptors.evaluated_at_ms.value),
      decision,
      reason,
      permission_id: safePermissionId(descriptors.permission_id.value, decision),
      permission_authority: 'builder_permission_facts_deny_by_default_v1',
      ui_selection_authority: 'not_permission',
    });
  } catch (error) {
    if (error instanceof BuilderPermissionIpcError) throw error;
    throw ipcError();
  }
}

function safeErrorCode(error) {
  try {
    if (
      error === null
      || (typeof error !== 'object' && typeof error !== 'function')
      || utilTypes.isProxy(error)
    ) return null;
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    return descriptor
      && Object.hasOwn(descriptor, 'value')
      && typeof descriptor.value === 'string'
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

function normalizeError(error) {
  const code = safeErrorCode(error);
  return ipcError(code !== null && Object.hasOwn(ERROR_MESSAGES, code)
    ? code
    : 'builder_permission_unavailable');
}

function activeWebContents(mainWindowRef) {
  try {
    const windowRef = Reflect.apply(mainWindowRef, undefined, []);
    if (!windowRef || (typeof windowRef.isDestroyed === 'function' && windowRef.isDestroyed())) {
      return null;
    }
    const webContents = windowRef.webContents;
    if (!webContents || (typeof webContents.isDestroyed === 'function' && webContents.isDestroyed())) {
      return null;
    }
    return webContents;
  } catch {
    return null;
  }
}

function assertActiveSender(event, mainWindowRef) {
  if (!event || event.sender !== activeWebContents(mainWindowRef)) {
    throw ipcError('builder_permission_forbidden');
  }
}

function createBuilderPermissionIpcAdapter(rawOptions) {
  const options = safeOptions(rawOptions);

  async function invokeEvaluate(event, rawArguments) {
    try {
      assertActiveSender(event, options.mainWindowRef);
      if (rawArguments.length !== 1) {
        throw ipcError('builder_permission_request_invalid');
      }
      const request = safeEvaluateRequest(rawArguments[0]);
      return sanitizeDecision(
        await Reflect.apply(options.evaluatePermission, undefined, [request]),
        request,
      );
    } catch (error) {
      throw normalizeError(error);
    }
  }

  return Object.freeze({
    adapter_id: 'builder_permission.controlled_ipc_adapter.v1',
    namespace: 'builderPermission',
    preload_namespace: 'window.clawfabricBuilder.permissions',
    channels: Object.freeze({
      evaluate: Object.freeze({
        channel: EVALUATE_PERMISSION_CHANNEL,
        method: 'evaluate',
        invoke(event, ...rawArguments) {
          return invokeEvaluate(event, rawArguments);
        },
      }),
    }),
    exposed_methods: Object.freeze(['evaluate']),
    authority: Object.freeze({
      renderer_authority: 'project_action_resource_only',
      actor_authority: 'main_bound_local_user',
      permission_fact_authority: 'main_owned_sqlite_permission_facts',
      active_renderer_required: true,
      read_only: true,
      grants_exposed: false,
      revocations_exposed: false,
      grant_command: false,
      revoke_command: false,
      provider_dispatch: false,
      credential_readback: false,
      direct_electron_registration: false,
      direct_preload_exposure: false,
    }),
  });
}

module.exports = Object.freeze({
  EVALUATE_PERMISSION_CHANNEL,
  BuilderPermissionIpcError,
  createBuilderPermissionIpcAdapter,
});
