'use strict';

const { types: utilTypes } = require('node:util');

const {
  BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_VERSION,
  BuilderAgentSupervisedActionAdmissionStoreError,
} = require('./builder-agent-supervised-action-admission-store.cjs');
const {
  BUILDER_TOOL_SOURCE_CONTEXT_COLLECTOR_VERSION,
  BuilderToolSourceContextCollectorError,
} = require('./builder-tool-source-context-collector.cjs');

const BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_SERVICE_VERSION =
  'builder-agent-private-source-context-service.v1';
const BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_SERVICE_RESULT_VERSION =
  'builder-agent-private-source-context-service-result.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:(${UUID_SOURCE})$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:(${UUID_SOURCE})$`, 'u');
const TURN_ID_PATTERN = new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const RESOURCE_ID_PATTERN = /^project:\/[a-z0-9._/@-]{1,120}$/u;
const ADMISSION_ID_PATTERN = /^builder-agent-supervised-action-admission:[0-9a-f]{64}$/u;
const TOOL_CALL_ID_PATTERN = new RegExp(`^builder-tool-call:${UUID_SOURCE}$`, 'u');
const SERVICE_KEYS = Object.freeze([
  'supervised_action_admission_store',
  'source_context_collector',
]);
const COLLECT_KEYS = Object.freeze([
  'owner_id',
  'supervised_action_admission_id',
  'context',
  'resource_ids',
]);
const CONTEXT_KEYS = Object.freeze([
  'context_version',
  'mode',
  'project',
  'conversation',
  'request_digest',
  'start_head',
  'attempt_number',
  'events',
  'run_terminal_failure_code',
  'ids',
  'cancel_requested',
]);
const PROJECT_KEYS = Object.freeze(['project_id', 'created_at_ms']);
const CONVERSATION_KEYS = Object.freeze(['project_id', 'conversation_id', 'created_at_ms']);
const IDS_KEYS = Object.freeze([
  'turn_command_id',
  'run_command_id',
  'terminal_command_id',
  'turn_terminal_command_id',
  'cancel_command_id',
  'cancel_request_id',
  'interrupt_command_id',
  'interrupt_request_id',
  'message_id',
  'assistant_message_id',
  'turn_id',
  'task_id',
  'run_id',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_private_source_context_service_invalid:
    'Builder agent private source context could not be verified.',
  builder_agent_private_source_context_service_conflict:
    'Builder agent private source context changed before it could be collected.',
  builder_agent_private_source_context_service_unavailable:
    'Builder agent private source context service is unavailable.',
});
const MAX_CONTEXT_FILES = 8;

class BuilderAgentPrivateSourceContextServiceError extends Error {
  constructor(code = 'builder_agent_private_source_context_service_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_private_source_context_service_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentPrivateSourceContextServiceError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentPrivateSourceContextServiceError(code);
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
  if (!isPlainObject(value)) fail('builder_agent_private_source_context_service_invalid');
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail('builder_agent_private_source_context_service_invalid');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_agent_private_source_context_service_invalid');
    }
  }
  return value;
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_private_source_context_service_invalid');
  }
  return descriptor.value;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    fail('builder_agent_private_source_context_service_invalid');
  }
  return value;
}

function safeOwnerId(value) {
  return safePattern(value, OWNER_ID_PATTERN);
}

function safeAdmissionId(value) {
  return safePattern(value, ADMISSION_ID_PATTERN);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('builder_agent_private_source_context_service_invalid');
  }
  return value;
}

function storeMethod(store, name) {
  const descriptor = Object.getOwnPropertyDescriptor(store, name);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
    fail('builder_agent_private_source_context_service_invalid');
  }
  return descriptor.value.bind(store);
}

function safeStore(value, expectedVersion, methods) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) {
    fail('builder_agent_private_source_context_service_invalid');
  }
  const versionDescriptor = Object.getOwnPropertyDescriptor(value, 'store_version');
  if (
    !versionDescriptor
    || !Object.hasOwn(versionDescriptor, 'value')
    || versionDescriptor.value !== expectedVersion
  ) fail('builder_agent_private_source_context_service_invalid');
  const selected = { store_version: expectedVersion };
  for (const method of methods) selected[method] = storeMethod(value, method);
  return freezeDeep(selected);
}

function safeCollector(value) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) {
    fail('builder_agent_private_source_context_service_invalid');
  }
  const versionDescriptor = Object.getOwnPropertyDescriptor(value, 'collector_version');
  const collectDescriptor = Object.getOwnPropertyDescriptor(value, 'collect_project_source_context');
  if (
    !versionDescriptor
    || !Object.hasOwn(versionDescriptor, 'value')
    || versionDescriptor.value !== BUILDER_TOOL_SOURCE_CONTEXT_COLLECTOR_VERSION
    || !collectDescriptor
    || !Object.hasOwn(collectDescriptor, 'value')
    || typeof collectDescriptor.value !== 'function'
  ) fail('builder_agent_private_source_context_service_invalid');
  return freezeDeep({
    collector_version: BUILDER_TOOL_SOURCE_CONTEXT_COLLECTOR_VERSION,
    collect_project_source_context: collectDescriptor.value.bind(value),
  });
}

function safeServices(rawServices) {
  exactObject(rawServices, SERVICE_KEYS);
  return freezeDeep({
    supervised_action_admission_store: safeStore(
      valueAt(rawServices, 'supervised_action_admission_store'),
      BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_VERSION,
      ['read_admission', 'list_task_admissions', 'list_run_admissions'],
    ),
    source_context_collector: safeCollector(valueAt(rawServices, 'source_context_collector')),
  });
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentPrivateSourceContextServiceError) {
    return new BuilderAgentPrivateSourceContextServiceError(error.code);
  }
  if (error instanceof BuilderToolSourceContextCollectorError) {
    return new BuilderAgentPrivateSourceContextServiceError(
      'builder_agent_private_source_context_service_unavailable',
    );
  }
  if (error instanceof BuilderAgentSupervisedActionAdmissionStoreError) {
    if (/_conflict$/u.test(error.code)) {
      return new BuilderAgentPrivateSourceContextServiceError(
        'builder_agent_private_source_context_service_conflict',
      );
    }
    if (/_unavailable$/u.test(error.code)) {
      return new BuilderAgentPrivateSourceContextServiceError(
        'builder_agent_private_source_context_service_unavailable',
      );
    }
    return new BuilderAgentPrivateSourceContextServiceError(
      'builder_agent_private_source_context_service_invalid',
    );
  }
  return new BuilderAgentPrivateSourceContextServiceError(
    'builder_agent_private_source_context_service_unavailable',
  );
}

function serviceEvidence() {
  return freezeDeep({
    service_authority: 'main_owned_agent_private_source_context_service',
    supervised_action_admission_store_authority: 'main_owned_agent_supervised_action_admission_store',
    supervised_action_admission_authority: 'main_agent_supervised_action_admission_contract_v1',
    source_context_collector_authority: 'main_tool_source_context_collector_v1',
    permission_authority: 'main_permission_decision_before_tool_dispatch_v1',
    conversation_authority: 'trusted_conversation_main_service_methods',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    model_dispatch: false,
    tool_dispatch: 'collector_internal_request_facts_only',
    execution_authority: 'collector_internal_filesystem_read_only',
    permission_grant_authority: false,
    credential_storage: 'not_present',
    source_access: 'private_main_only_collector_result',
    source_read: 'bounded_project_files_after_collector_permission',
    source_write: 'not_present',
    process_run: false,
    network_access: false,
    revision_authority: false,
    review_authority: false,
    artifact_authority: false,
    raw_context_storage: 'not_durable',
    recovery_model: 'store_backed_action_admission_plus_collector_replay',
  });
}

function safeContext(rawContext) {
  const context = exactObject(rawContext, CONTEXT_KEYS);
  const project = exactObject(valueAt(context, 'project'), PROJECT_KEYS);
  const conversation = exactObject(valueAt(context, 'conversation'), CONVERSATION_KEYS);
  const ids = exactObject(valueAt(context, 'ids'), IDS_KEYS);
  const projectId = safePattern(valueAt(project, 'project_id'), PROJECT_ID_PATTERN);
  const conversationId = safePattern(valueAt(conversation, 'conversation_id'), CONVERSATION_ID_PATTERN);
  if (
    valueAt(context, 'context_version') !== 'builder-conversation-run-context.v1'
    || valueAt(context, 'mode') !== 'work'
    || valueAt(context, 'run_terminal_failure_code') !== null
    || valueAt(context, 'cancel_requested') !== false
    || valueAt(conversation, 'project_id') !== projectId
    || conversationId.slice('builder-conversation:'.length)
      !== projectId.slice('builder-project:'.length)
    || !Array.isArray(valueAt(context, 'events'))
    || utilTypes.isProxy(valueAt(context, 'events'))
    || !Number.isSafeInteger(valueAt(context, 'attempt_number'))
    || valueAt(context, 'attempt_number') < 1
  ) fail('builder_agent_private_source_context_service_invalid');
  safeTimestamp(valueAt(project, 'created_at_ms'));
  safeTimestamp(valueAt(conversation, 'created_at_ms'));
  return freezeDeep({
    project_id: projectId,
    conversation_id: conversationId,
    turn_id: safePattern(valueAt(ids, 'turn_id'), TURN_ID_PATTERN),
    task_id: safePattern(valueAt(ids, 'task_id'), TASK_ID_PATTERN),
    run_id: safePattern(valueAt(ids, 'run_id'), RUN_ID_PATTERN),
  });
}

function safeResourceIds(value) {
  if (
    !Array.isArray(value)
    || utilTypes.isProxy(value)
    || value.length < 1
    || value.length > MAX_CONTEXT_FILES
  ) fail('builder_agent_private_source_context_service_invalid');
  const own = Reflect.ownKeys(value);
  if (own.length !== value.length + 1 || own.some((key) => typeof key === 'symbol')) {
    fail('builder_agent_private_source_context_service_invalid');
  }
  const seen = new Set();
  const resourceIds = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_agent_private_source_context_service_invalid');
    }
    const resourceId = safePattern(descriptor.value, RESOURCE_ID_PATTERN);
    const segments = resourceId.slice('project:/'.length).split('/');
    if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
      fail('builder_agent_private_source_context_service_invalid');
    }
    if (seen.has(resourceId)) fail('builder_agent_private_source_context_service_invalid');
    seen.add(resourceId);
    resourceIds.push(resourceId);
  }
  return freezeDeep(resourceIds);
}

function admissionFact(admissionRead) {
  if (admissionRead.status !== 'ready') fail('builder_agent_private_source_context_service_conflict');
  const entry = admissionRead.supervised_action_admission;
  if (!entry || !entry.admission) fail('builder_agent_private_source_context_service_invalid');
  return entry.admission;
}

function requireReadPrivateSourceAdmission(stores, ownerId, admissionId, binding) {
  const admissionRead = stores.supervised_action_admission_store.read_admission({
    admission_id: admissionId,
    owner_id: ownerId,
  });
  const admission = admissionFact(admissionRead);
  const taskAdmissions = stores.supervised_action_admission_store.list_task_admissions({
    owner_id: ownerId,
    project_id: binding.project_id,
    task_id: binding.task_id,
  });
  const runAdmissions = stores.supervised_action_admission_store.list_run_admissions({
    owner_id: ownerId,
    project_id: binding.project_id,
    task_id: binding.task_id,
    run_id: binding.run_id,
  });
  if (
    taskAdmissions.status !== 'ready'
    || runAdmissions.status !== 'ready'
    || !taskAdmissions.supervised_action_admissions.some(
      (entry) => entry.admission.admission_id === admissionId,
    )
    || !runAdmissions.supervised_action_admissions.some(
      (entry) => entry.admission.admission_id === admissionId,
    )
    || admission.owner_id !== ownerId
    || admission.project_id !== binding.project_id
    || admission.conversation_id !== binding.conversation_id
    || admission.task_id !== binding.task_id
    || admission.run_id !== binding.run_id
    || admission.requested_next_action !== 'read_private_source'
    || admission.next_gate !== 'source_context_collector_required_later'
  ) fail('builder_agent_private_source_context_service_invalid');
  return freezeDeep({
    admission,
    admission_read: admissionRead,
    task_admissions: taskAdmissions,
    run_admissions: runAdmissions,
  });
}

function safeReadEntries(value, resourceIds) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length !== resourceIds.length) {
    fail('builder_agent_private_source_context_service_invalid');
  }
  const own = Reflect.ownKeys(value);
  if (own.length !== value.length + 1 || own.some((key) => typeof key === 'symbol')) {
    fail('builder_agent_private_source_context_service_invalid');
  }
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_agent_private_source_context_service_invalid');
    }
    const entry = exactObject(descriptor.value, ['resource_id', 'status', 'tool_call_id']);
    const resourceId = safePattern(valueAt(entry, 'resource_id'), RESOURCE_ID_PATTERN);
    if (!resourceIds.includes(resourceId) || seen.has(resourceId)) {
      fail('builder_agent_private_source_context_service_invalid');
    }
    seen.add(resourceId);
    const status = valueAt(entry, 'status');
    if (status !== 'succeeded' && status !== 'failed') {
      fail('builder_agent_private_source_context_service_invalid');
    }
    safePattern(valueAt(entry, 'tool_call_id'), TOOL_CALL_ID_PATTERN);
  }
}

function verifySourceContextResult(result, binding, resourceIds) {
  const source = exactObject(result, [
    'result_version',
    'operation',
    'status',
    'context',
    'private_source_context',
    'reads',
    'authority',
  ]);
  const status = valueAt(source, 'status');
  if (
    valueAt(source, 'result_version') !== 'builder-tool-source-context-result.v1'
    || valueAt(source, 'operation') !== 'project_source_context_collected'
    || (status !== 'succeeded' && status !== 'partial' && status !== 'failed')
  ) fail('builder_agent_private_source_context_service_invalid');
  const resultBinding = safeContext(valueAt(source, 'context'));
  if (
    resultBinding.project_id !== binding.project_id
    || resultBinding.conversation_id !== binding.conversation_id
    || resultBinding.turn_id !== binding.turn_id
    || resultBinding.task_id !== binding.task_id
    || resultBinding.run_id !== binding.run_id
  ) fail('builder_agent_private_source_context_service_invalid');
  const privateContext = exactObject(valueAt(source, 'private_source_context'), ['context_version', 'files']);
  if (
    valueAt(privateContext, 'context_version') !== 'builder-private-source-context.v1'
    || !Array.isArray(valueAt(privateContext, 'files'))
    || utilTypes.isProxy(valueAt(privateContext, 'files'))
    || valueAt(privateContext, 'files').length > resourceIds.length
  ) fail('builder_agent_private_source_context_service_invalid');
  safeReadEntries(valueAt(source, 'reads'), resourceIds);
  const authority = exactObject(valueAt(source, 'authority'), [
    'collector_authority',
    'permission_authority',
    'policy_authority',
    'conversation_authority',
    'execution_authority',
    'renderer_authority',
    'provider_dispatch',
    'credential_readback',
    'raw_output_storage',
    'conversation_event',
    'git_authority',
    'revision_admission',
  ]);
  if (
    valueAt(authority, 'collector_authority') !== 'main_tool_source_context_collector_v1'
    || valueAt(authority, 'renderer_authority') !== 'not_present'
    || valueAt(authority, 'provider_dispatch') !== false
    || valueAt(authority, 'credential_readback') !== false
    || valueAt(authority, 'raw_output_storage') !== 'not_durable'
    || valueAt(authority, 'conversation_event') !== 'tool_request_and_fixed_result_only'
    || valueAt(authority, 'git_authority') !== 'not_present'
    || valueAt(authority, 'revision_admission') !== 'not_created'
  ) fail('builder_agent_private_source_context_service_invalid');
}

async function collectAgentPrivateSourceContext(services, rawRequest) {
  exactObject(rawRequest, COLLECT_KEYS);
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const admissionId = safeAdmissionId(valueAt(rawRequest, 'supervised_action_admission_id'));
  const context = valueAt(rawRequest, 'context');
  const binding = safeContext(context);
  const resourceIds = safeResourceIds(valueAt(rawRequest, 'resource_ids'));
  const admissionEvidence = requireReadPrivateSourceAdmission(
    services,
    ownerId,
    admissionId,
    binding,
  );
  const sourceContextResult = await services.source_context_collector.collect_project_source_context({
    context,
    resource_ids: resourceIds,
  });
  verifySourceContextResult(sourceContextResult, binding, resourceIds);
  return freezeDeep({
    result_version: BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_SERVICE_RESULT_VERSION,
    service_version: BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_SERVICE_VERSION,
    operation: 'agent_private_source_context_collected',
    status: sourceContextResult.status,
    requested_next_action: 'read_private_source',
    next_gate: 'source_context_collector_required_later',
    supervised_action_admission: admissionEvidence.admission,
    supervised_action_admission_read: admissionEvidence.admission_read,
    action_task_admissions: admissionEvidence.task_admissions,
    action_run_admissions: admissionEvidence.run_admissions,
    resource_ids: resourceIds,
    source_context_result: sourceContextResult,
    evidence: serviceEvidence(),
  });
}

function createBuilderAgentPrivateSourceContextService(rawServices) {
  const services = safeServices(rawServices);
  return freezeDeep({
    service_version: BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_SERVICE_VERSION,

    async collect_agent_private_source_context(rawRequest) {
      try {
        return await collectAgentPrivateSourceContext(services, rawRequest);
      } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_SERVICE_VERSION,
  BuilderAgentPrivateSourceContextServiceError,
  createBuilderAgentPrivateSourceContextService,
});
