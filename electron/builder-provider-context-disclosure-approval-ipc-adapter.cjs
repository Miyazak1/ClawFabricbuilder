'use strict';

const { types: utilTypes } = require('node:util');

const APPROVE_PROVIDER_CONTEXT_DISCLOSURE_CHANNEL =
  'clawfabric-builder:provider-context-disclosure:approve-current';

const CURRENT_APPROVAL_GATE_VERSION =
  'builder-provider-context-disclosure-current-approval-gate.v1';
const OPTION_KEYS = Object.freeze(['approveCurrentProviderContextDisclosure', 'mainWindowRef']);
const REQUEST_KEYS = Object.freeze(['project_id', 'conversation_id']);
const RESULT_KEYS = Object.freeze([
  'result_version',
  'project_id',
  'conversation_id',
  'operation',
  'approval_scope',
  'provider_scope',
  'purpose',
  'authority',
]);
const RESULT_AUTHORITY_KEYS = Object.freeze([
  'current_approval_gate',
  'status_service',
  'approval_service',
  'renderer_authority',
  'provider_context_body',
  'provider_dispatch',
  'prompt_bridge',
  'tool_dispatch',
  'source_read',
  'source_write',
  'git_mutation',
  'sqlite_write',
  'revision_admission',
  'ipc_registration',
  'preload_exposure',
]);
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');

const ERROR_MESSAGES = Object.freeze({
  builder_provider_context_disclosure_approval_forbidden: 'AI context approval is unavailable.',
  builder_provider_context_disclosure_approval_invalid:
    'The AI context approval request could not be verified.',
  builder_provider_context_disclosure_approval_unavailable: 'AI context approval is unavailable.',
});

class BuilderProviderContextDisclosureApprovalIpcError extends Error {
  constructor(code = 'builder_provider_context_disclosure_approval_unavailable') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_provider_context_disclosure_approval_unavailable';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderProviderContextDisclosureApprovalIpcError';
    this.code = selected;
    this.retryable = selected === 'builder_provider_context_disclosure_approval_unavailable';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function ipcError(code) {
  return new BuilderProviderContextDisclosureApprovalIpcError(code);
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
    : 'builder_provider_context_disclosure_approval_unavailable');
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

function exactObject(value, keys, code = 'builder_provider_context_disclosure_approval_invalid') {
  if (!isPlainObject(value)) throw ipcError(code);
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length
    || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
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
  if (!isPlainObject(value)) throw ipcError();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (
    !descriptor
    || descriptor.enumerable !== true
    || !Object.hasOwn(descriptor, 'value')
    || typeof descriptor.value !== 'function'
    || utilTypes.isProxy(descriptor.value)
  ) throw ipcError();
  return descriptor.value;
}

function safeOptions(value) {
  try {
    if (!isPlainObject(value)) throw ipcError();
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== OPTION_KEYS.length
      || keys.some((key) => typeof key !== 'string' || !OPTION_KEYS.includes(key))
    ) throw ipcError();
    return Object.freeze({
      approveCurrentProviderContextDisclosure: stableMethod(
        value,
        'approveCurrentProviderContextDisclosure',
      ),
      mainWindowRef: stableMethod(value, 'mainWindowRef'),
    });
  } catch {
    throw ipcError();
  }
}

function safeProjectId(value) {
  if (typeof value !== 'string' || !PROJECT_ID_PATTERN.test(value)) {
    throw ipcError('builder_provider_context_disclosure_approval_invalid');
  }
  return value;
}

function safeConversationId(value) {
  if (typeof value !== 'string' || !CONVERSATION_ID_PATTERN.test(value)) {
    throw ipcError('builder_provider_context_disclosure_approval_invalid');
  }
  return value;
}

function safeApprovalRequest(value) {
  try {
    const descriptors = exactObject(value, REQUEST_KEYS);
    return Object.freeze({
      project_id: safeProjectId(descriptors.project_id.value),
      conversation_id: safeConversationId(descriptors.conversation_id.value),
    });
  } catch (error) {
    if (error instanceof BuilderProviderContextDisclosureApprovalIpcError) throw error;
    throw ipcError('builder_provider_context_disclosure_approval_invalid');
  }
}

function safeResultAuthority(value) {
  const descriptors = exactObject(
    value,
    RESULT_AUTHORITY_KEYS,
    'builder_provider_context_disclosure_approval_unavailable',
  );
  const authority = Object.freeze({
    current_approval_gate: descriptors.current_approval_gate.value,
    status_service: descriptors.status_service.value,
    approval_service: descriptors.approval_service.value,
    renderer_authority: descriptors.renderer_authority.value,
    provider_context_body: descriptors.provider_context_body.value,
    provider_dispatch: descriptors.provider_dispatch.value,
    prompt_bridge: descriptors.prompt_bridge.value,
    tool_dispatch: descriptors.tool_dispatch.value,
    source_read: descriptors.source_read.value,
    source_write: descriptors.source_write.value,
    git_mutation: descriptors.git_mutation.value,
    sqlite_write: descriptors.sqlite_write.value,
    revision_admission: descriptors.revision_admission.value,
    ipc_registration: descriptors.ipc_registration.value,
    preload_exposure: descriptors.preload_exposure.value,
  });
  if (
    authority.current_approval_gate !== 'main_owned_current_disclosure_preparation_gate_v1'
    || authority.status_service !== 'main_only_in_memory_preparation_reader'
    || authority.approval_service !== 'main_owned_prepared_disclosure_request_approval_v1'
    || authority.renderer_authority !== 'not_accepted'
    || authority.provider_context_body !== 'not_present'
    || authority.provider_dispatch !== false
    || authority.prompt_bridge !== false
    || authority.tool_dispatch !== false
    || authority.source_read !== 'not_performed'
    || authority.source_write !== 'not_performed'
    || authority.git_mutation !== false
    || authority.sqlite_write !== false
    || authority.revision_admission !== 'not_created'
    || authority.ipc_registration !== 'not_performed'
    || authority.preload_exposure !== false
  ) throw ipcError();
  return authority;
}

function safeApprovalResult(value, request) {
  try {
    const descriptors = exactObject(
      value,
      RESULT_KEYS,
      'builder_provider_context_disclosure_approval_unavailable',
    );
    const operation = descriptors.operation.value;
    if (
      descriptors.result_version.value !== CURRENT_APPROVAL_GATE_VERSION
      || descriptors.project_id.value !== request.project_id
      || descriptors.conversation_id.value !== request.conversation_id
      || (operation !== 'approval_recorded' && operation !== 'already_approved')
      || descriptors.approval_scope.value !== 'configured_provider_purpose'
      || descriptors.provider_scope.value !== 'configured_provider'
      || descriptors.purpose.value !== 'contextual_build'
    ) throw ipcError();
    return Object.freeze({
      result_version: CURRENT_APPROVAL_GATE_VERSION,
      project_id: request.project_id,
      conversation_id: request.conversation_id,
      operation,
      approval_scope: 'configured_provider_purpose',
      provider_scope: 'configured_provider',
      purpose: 'contextual_build',
      authority: safeResultAuthority(descriptors.authority.value),
    });
  } catch (error) {
    if (error instanceof BuilderProviderContextDisclosureApprovalIpcError) throw error;
    throw ipcError();
  }
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
    throw ipcError('builder_provider_context_disclosure_approval_forbidden');
  }
}

function createBuilderProviderContextDisclosureApprovalIpcAdapter(rawOptions) {
  const options = safeOptions(rawOptions);

  async function invokeApproveCurrent(event, rawArguments) {
    try {
      assertActiveSender(event, options.mainWindowRef);
      if (rawArguments.length !== 1) {
        throw ipcError('builder_provider_context_disclosure_approval_invalid');
      }
      const request = safeApprovalRequest(rawArguments[0]);
      return safeApprovalResult(
        await Reflect.apply(options.approveCurrentProviderContextDisclosure, undefined, [request]),
        request,
      );
    } catch (error) {
      throw normalizeError(error);
    }
  }

  return Object.freeze({
    adapter_id: 'builder_provider_context_disclosure_approval.controlled_ipc_adapter.v1',
    namespace: 'builderProviderContextDisclosureApproval',
    preload_namespace: 'window.clawfabricBuilder.providerContextDisclosureApproval',
    channels: Object.freeze({
      approveCurrent: Object.freeze({
        channel: APPROVE_PROVIDER_CONTEXT_DISCLOSURE_CHANNEL,
        method: 'approveCurrent',
        invoke(event, ...rawArguments) {
          return invokeApproveCurrent(event, rawArguments);
        },
      }),
    }),
    exposed_methods: Object.freeze(['approveCurrent']),
    authority: Object.freeze({
      renderer_authority: 'current_project_conversation_only',
      approval_authority: 'main_owned_current_provider_context_disclosure_gate',
      active_renderer_required: true,
      approval_command: true,
      permission_grant_scope: 'context_disclose_configured_provider_contextual_build_only',
      permission_fact_readback: false,
      request_id_exposed: false,
      provider_context_body: false,
      source_refs_exposed: false,
      provider_dispatch: false,
      prompt_bridge: false,
      tool_dispatch: false,
      source_mutation: false,
      git_mutation: false,
      revision_admission: false,
      direct_electron_registration: false,
      direct_preload_exposure: false,
    }),
  });
}

module.exports = Object.freeze({
  APPROVE_PROVIDER_CONTEXT_DISCLOSURE_CHANNEL,
  BuilderProviderContextDisclosureApprovalIpcError,
  createBuilderProviderContextDisclosureApprovalIpcAdapter,
});
