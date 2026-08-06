'use strict';

const { types: utilTypes } = require('node:util');

const {
  BUILDER_TASK_CAPSULE_STORE_READ_RESULT_VERSION,
  BUILDER_TASK_CAPSULE_STORE_VERSION,
  BuilderTaskCapsuleStoreError,
} = require('./builder-task-capsule-store.cjs');
const {
  BUILDER_SESSION_TASK_ADDRESS_STORE_READ_RESULT_VERSION,
  BUILDER_SESSION_TASK_ADDRESS_STORE_VERSION,
  BuilderSessionTaskAddressStoreError,
} = require('./builder-session-task-address-store.cjs');
const {
  BUILDER_CONTEXT_COMPACTION_SUMMARY_STORE_READ_RESULT_VERSION,
  BUILDER_CONTEXT_COMPACTION_SUMMARY_STORE_VERSION,
  BuilderContextCompactionSummaryStoreError,
} = require('./builder-context-compaction-summary-store.cjs');
const {
  BUILDER_HANDOFF_PACKET_STORE_READ_RESULT_VERSION,
  BUILDER_HANDOFF_PACKET_STORE_VERSION,
  BuilderHandoffPacketStoreError,
} = require('./builder-handoff-packet-store.cjs');
const {
  BuilderWorkingContextStateError,
  createBuilderWorkingContextState,
} = require('./builder-working-context-state.cjs');

const BUILDER_WORKING_CONTEXT_STATE_SERVICE_VERSION = 'builder-working-context-state-service.v1';
const BUILDER_WORKING_CONTEXT_STATE_SERVICE_RESULT_VERSION = 'builder-working-context-state-service-result.v1';

const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const SESSION_ID_PATTERN = new RegExp(`^builder-session:${UUID_SOURCE}$`, 'u');
const TASK_ADDRESS_ID_PATTERN = new RegExp(`^builder-task-address:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const SERVICE_KEYS = Object.freeze(['task_capsule_store']);
const SERVICE_WITH_ADDRESS_KEYS = Object.freeze(['task_capsule_store', 'session_task_address_store']);
const SERVICE_WITH_COMPACTION_KEYS = Object.freeze(['task_capsule_store', 'context_compaction_summary_store']);
const SERVICE_WITH_HANDOFF_KEYS = Object.freeze(['task_capsule_store', 'handoff_packet_store']);
const SERVICE_WITH_ADDRESS_AND_COMPACTION_KEYS = Object.freeze([
  'task_capsule_store',
  'session_task_address_store',
  'context_compaction_summary_store',
]);
const SERVICE_WITH_ADDRESS_AND_HANDOFF_KEYS = Object.freeze([
  'task_capsule_store',
  'session_task_address_store',
  'handoff_packet_store',
]);
const SERVICE_WITH_COMPACTION_AND_HANDOFF_KEYS = Object.freeze([
  'task_capsule_store',
  'context_compaction_summary_store',
  'handoff_packet_store',
]);
const SERVICE_WITH_ALL_OPTIONAL_KEYS = Object.freeze([
  'task_capsule_store',
  'session_task_address_store',
  'context_compaction_summary_store',
  'handoff_packet_store',
]);
const REQUEST_KEYS = Object.freeze([
  'project_id',
  'session_id',
  'task_address_id',
  'conversation_id',
  'objective_summary',
  'confirmed_constraints',
  'rejected_constraints',
  'open_questions',
  'latest_user_intent',
  'source_refs',
  'compaction_refs',
  'handoff_refs',
  'approved_plan_ref',
  'base_revision_ref',
  'invalidated_by',
  'updated_at_ms',
]);
const CONVERSATION_REQUEST_KEYS = Object.freeze([
  'project_id',
  'conversation_id',
  'objective_summary',
  'confirmed_constraints',
  'rejected_constraints',
  'open_questions',
  'latest_user_intent',
  'source_refs',
  'compaction_refs',
  'handoff_refs',
  'approved_plan_ref',
  'base_revision_ref',
  'invalidated_by',
  'updated_at_ms',
]);
const RESULT_KEYS = Object.freeze([
  'result_version',
  'service_version',
  'operation',
  'status',
  'project_id',
  'session_id',
  'task_address_id',
  'conversation_id',
  'working_context_state',
  'latest_task_capsule',
  'latest_context_compaction_summary',
  'pending_handoff_packets',
  'evidence',
]);
const LATEST_TASK_CAPSULE_KEYS = Object.freeze(['status', 'update_id']);
const LATEST_COMPACTION_SUMMARY_KEYS = Object.freeze(['status', 'summary_id']);
const PENDING_HANDOFF_PACKETS_KEYS = Object.freeze(['status', 'count', 'first_handoff_id']);
const EVIDENCE_KEYS = Object.freeze([
  'service_authority',
  'working_context_contract_authority',
  'task_capsule_store_authority',
  'task_capsule_store_operation',
  'context_compaction_summary_store_authority',
  'context_compaction_summary_store_operation',
  'handoff_packet_store_authority',
  'handoff_packet_store_operation',
  'renderer_authority',
  'ipc_authority',
  'sqlite_write',
  'conversation_append',
  'provider_dispatch',
  'tool_dispatch',
  'source_mutation',
  'git_mutation',
  'permission_grant',
  'revision_admission',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_working_context_state_service_invalid: 'Builder working context state projection could not be verified.',
  builder_working_context_state_service_unavailable: 'Builder working context state projection is unavailable.',
});

class BuilderWorkingContextStateServiceError extends Error {
  constructor(code = 'builder_working_context_state_service_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_working_context_state_service_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderWorkingContextStateServiceError';
    this.code = selected;
    this.retryable = selected === 'builder_working_context_state_service_unavailable';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code = 'builder_working_context_state_service_invalid') {
  throw new BuilderWorkingContextStateServiceError(code);
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

function exactObjectOneOf(value, keySets) {
  if (!isPlainObject(value)) fail();
  const actual = Reflect.ownKeys(value);
  const match = keySets.find((keys) => (
    actual.length === keys.length
    && actual.every((key) => typeof key === 'string' && keys.includes(key))
  ));
  if (match === undefined) fail();
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return match;
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function method(value, name) {
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') fail();
  return descriptor.value.bind(value);
}

function safePattern(value, pattern, maximum) {
  if (typeof value !== 'string' || value.length > maximum || !pattern.test(value)) fail();
  return value;
}

function safeProjectId(value) {
  return safePattern(value, PROJECT_ID_PATTERN, 64);
}

function safeSessionId(value) {
  return safePattern(value, SESSION_ID_PATTERN, 96);
}

function safeTaskAddressId(value) {
  return safePattern(value, TASK_ADDRESS_ID_PATTERN, 96);
}

function safeConversationId(value) {
  return safePattern(value, CONVERSATION_ID_PATTERN, 96);
}

function safeStore(value) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) fail();
  const version = Object.getOwnPropertyDescriptor(value, 'store_version');
  if (!version || !Object.hasOwn(version, 'value') || version.value !== BUILDER_TASK_CAPSULE_STORE_VERSION) fail();
  return freezeDeep({
    store_version: BUILDER_TASK_CAPSULE_STORE_VERSION,
    read_latest_task_capsule: method(value, 'read_latest_task_capsule'),
  });
}

function safeAddressStore(value) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) fail();
  const version = Object.getOwnPropertyDescriptor(value, 'store_version');
  if (!version || !Object.hasOwn(version, 'value') || version.value !== BUILDER_SESSION_TASK_ADDRESS_STORE_VERSION) {
    fail();
  }
  return freezeDeep({
    store_version: BUILDER_SESSION_TASK_ADDRESS_STORE_VERSION,
    read_current_session_task_for_conversation: method(value, 'read_current_session_task_for_conversation'),
  });
}

function safeCompactionStore(value) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) fail();
  const version = Object.getOwnPropertyDescriptor(value, 'store_version');
  if (
    !version
    || !Object.hasOwn(version, 'value')
    || version.value !== BUILDER_CONTEXT_COMPACTION_SUMMARY_STORE_VERSION
  ) fail();
  return freezeDeep({
    store_version: BUILDER_CONTEXT_COMPACTION_SUMMARY_STORE_VERSION,
    read_latest_context_compaction_summary: method(value, 'read_latest_context_compaction_summary'),
  });
}

function safeHandoffStore(value) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) fail();
  const version = Object.getOwnPropertyDescriptor(value, 'store_version');
  if (!version || !Object.hasOwn(version, 'value') || version.value !== BUILDER_HANDOFF_PACKET_STORE_VERSION) fail();
  return freezeDeep({
    store_version: BUILDER_HANDOFF_PACKET_STORE_VERSION,
    list_pending_handoff_packets: method(value, 'list_pending_handoff_packets'),
  });
}

function safeServices(rawServices) {
  const keys = exactObjectOneOf(rawServices, [
    SERVICE_KEYS,
    SERVICE_WITH_ADDRESS_KEYS,
    SERVICE_WITH_COMPACTION_KEYS,
    SERVICE_WITH_HANDOFF_KEYS,
    SERVICE_WITH_ADDRESS_AND_COMPACTION_KEYS,
    SERVICE_WITH_ADDRESS_AND_HANDOFF_KEYS,
    SERVICE_WITH_COMPACTION_AND_HANDOFF_KEYS,
    SERVICE_WITH_ALL_OPTIONAL_KEYS,
  ]);
  const hasAddressStore = keys.includes('session_task_address_store');
  const hasCompactionStore = keys.includes('context_compaction_summary_store');
  const hasHandoffStore = keys.includes('handoff_packet_store');
  return freezeDeep({
    task_capsule_store: safeStore(valueAt(rawServices, 'task_capsule_store')),
    session_task_address_store: hasAddressStore
      ? safeAddressStore(valueAt(rawServices, 'session_task_address_store'))
      : null,
    context_compaction_summary_store: hasCompactionStore
      ? safeCompactionStore(valueAt(rawServices, 'context_compaction_summary_store'))
      : null,
    handoff_packet_store: hasHandoffStore
      ? safeHandoffStore(valueAt(rawServices, 'handoff_packet_store'))
      : null,
  });
}

function safeRequest(rawRequest) {
  exactObject(rawRequest, REQUEST_KEYS);
  return freezeDeep({
    project_id: safeProjectId(valueAt(rawRequest, 'project_id')),
    session_id: safeSessionId(valueAt(rawRequest, 'session_id')),
    task_address_id: safeTaskAddressId(valueAt(rawRequest, 'task_address_id')),
    conversation_id: safeConversationId(valueAt(rawRequest, 'conversation_id')),
    objective_summary: valueAt(rawRequest, 'objective_summary'),
    confirmed_constraints: valueAt(rawRequest, 'confirmed_constraints'),
    rejected_constraints: valueAt(rawRequest, 'rejected_constraints'),
    open_questions: valueAt(rawRequest, 'open_questions'),
    latest_user_intent: valueAt(rawRequest, 'latest_user_intent'),
    source_refs: valueAt(rawRequest, 'source_refs'),
    compaction_refs: valueAt(rawRequest, 'compaction_refs'),
    handoff_refs: valueAt(rawRequest, 'handoff_refs'),
    approved_plan_ref: valueAt(rawRequest, 'approved_plan_ref'),
    base_revision_ref: valueAt(rawRequest, 'base_revision_ref'),
    invalidated_by: valueAt(rawRequest, 'invalidated_by'),
    updated_at_ms: valueAt(rawRequest, 'updated_at_ms'),
  });
}

function safeConversationRequest(rawRequest) {
  exactObject(rawRequest, CONVERSATION_REQUEST_KEYS);
  return freezeDeep({
    project_id: safeProjectId(valueAt(rawRequest, 'project_id')),
    conversation_id: safeConversationId(valueAt(rawRequest, 'conversation_id')),
    objective_summary: valueAt(rawRequest, 'objective_summary'),
    confirmed_constraints: valueAt(rawRequest, 'confirmed_constraints'),
    rejected_constraints: valueAt(rawRequest, 'rejected_constraints'),
    open_questions: valueAt(rawRequest, 'open_questions'),
    latest_user_intent: valueAt(rawRequest, 'latest_user_intent'),
    source_refs: valueAt(rawRequest, 'source_refs'),
    compaction_refs: valueAt(rawRequest, 'compaction_refs'),
    handoff_refs: valueAt(rawRequest, 'handoff_refs'),
    approved_plan_ref: valueAt(rawRequest, 'approved_plan_ref'),
    base_revision_ref: valueAt(rawRequest, 'base_revision_ref'),
    invalidated_by: valueAt(rawRequest, 'invalidated_by'),
    updated_at_ms: valueAt(rawRequest, 'updated_at_ms'),
  });
}

function evidence(taskCapsuleStoreOperation, compactionStoreOperation, handoffStoreOperation) {
  return freezeDeep({
    service_authority: 'main_working_context_state_projection_service_v1',
    working_context_contract_authority: 'main_working_context_state_contract_v1',
    task_capsule_store_authority: 'main_owned_task_capsule_store',
    task_capsule_store_operation: taskCapsuleStoreOperation,
    context_compaction_summary_store_authority: compactionStoreOperation === 'not_configured'
      ? 'not_configured'
      : 'main_owned_context_compaction_summary_store',
    context_compaction_summary_store_operation: compactionStoreOperation,
    handoff_packet_store_authority: handoffStoreOperation === 'not_configured'
      ? 'not_configured'
      : 'main_owned_handoff_packet_store',
    handoff_packet_store_operation: handoffStoreOperation,
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    sqlite_write: 'not_performed',
    conversation_append: false,
    provider_dispatch: false,
    tool_dispatch: false,
    source_mutation: false,
    git_mutation: false,
    permission_grant: false,
    revision_admission: 'not_created',
  });
}

function normalizeOperationError(error) {
  if (error instanceof BuilderWorkingContextStateServiceError) {
    return new BuilderWorkingContextStateServiceError(error.code);
  }
  if (error instanceof BuilderWorkingContextStateError) {
    return new BuilderWorkingContextStateServiceError(
      'builder_working_context_state_service_invalid',
    );
  }
  if (error instanceof BuilderTaskCapsuleStoreError) {
    if (/_unavailable$/u.test(error.code)) {
      return new BuilderWorkingContextStateServiceError(
        'builder_working_context_state_service_unavailable',
      );
    }
    return new BuilderWorkingContextStateServiceError(
      'builder_working_context_state_service_invalid',
    );
  }
  if (error instanceof BuilderSessionTaskAddressStoreError) {
    if (/_unavailable$/u.test(error.code)) {
      return new BuilderWorkingContextStateServiceError(
        'builder_working_context_state_service_unavailable',
      );
    }
    return new BuilderWorkingContextStateServiceError(
      'builder_working_context_state_service_invalid',
    );
  }
  if (error instanceof BuilderContextCompactionSummaryStoreError) {
    if (/_unavailable$/u.test(error.code)) {
      return new BuilderWorkingContextStateServiceError(
        'builder_working_context_state_service_unavailable',
      );
    }
    return new BuilderWorkingContextStateServiceError(
      'builder_working_context_state_service_invalid',
    );
  }
  if (error instanceof BuilderHandoffPacketStoreError) {
    if (/_unavailable$/u.test(error.code)) {
      return new BuilderWorkingContextStateServiceError(
        'builder_working_context_state_service_unavailable',
      );
    }
    return new BuilderWorkingContextStateServiceError(
      'builder_working_context_state_service_invalid',
    );
  }
  return new BuilderWorkingContextStateServiceError(
    'builder_working_context_state_service_unavailable',
  );
}

function safeLatestResult(value, projectId) {
  exactObject(value, ['result_version', 'task_capsule_authority', 'status', 'task_capsule_update', 'evidence']);
  if (
    valueAt(value, 'result_version') !== BUILDER_TASK_CAPSULE_STORE_READ_RESULT_VERSION
    || valueAt(value, 'task_capsule_authority') !== 'main_owned_task_capsule_store'
  ) fail();
  const status = valueAt(value, 'status');
  if (status === 'absent') {
    if (valueAt(value, 'task_capsule_update') !== null) fail();
    return freezeDeep({
      status: 'absent',
      update_id: null,
      task_capsule: null,
      operation: safeStoreOperation(valueAt(value, 'evidence')),
    });
  }
  if (status !== 'ready') fail();
  const wrapper = valueAt(value, 'task_capsule_update');
  exactObject(wrapper, ['task_capsule_update']);
  const update = valueAt(wrapper, 'task_capsule_update');
  if (
    !isPlainObject(update)
    || valueAt(update, 'project_id') !== projectId
    || !isPlainObject(valueAt(update, 'task_capsule'))
    || valueAt(valueAt(update, 'task_capsule'), 'project_id') !== projectId
  ) fail();
  return freezeDeep({
    status: 'ready',
    update_id: valueAt(update, 'update_id'),
    task_capsule: valueAt(update, 'task_capsule'),
    operation: safeStoreOperation(valueAt(value, 'evidence')),
  });
}

function safeStoreOperation(evidenceValue) {
  if (!isPlainObject(evidenceValue)) fail();
  const transaction = valueAt(evidenceValue, 'transaction');
  if (
    transaction !== 'latest_task_capsule_ready_read'
    && transaction !== 'latest_task_capsule_absent_read'
  ) fail();
  return transaction;
}

function safeLatestCompactionResult(value, conversationId, taskAddressId) {
  if (value === null) {
    return freezeDeep({
      status: 'absent',
      summary_id: null,
      compaction_ref: null,
      operation: 'not_configured',
    });
  }
  exactObject(value, [
    'result_version',
    'compaction_summary_authority',
    'status',
    'context_compaction_summary',
    'evidence',
  ]);
  if (
    valueAt(value, 'result_version') !== BUILDER_CONTEXT_COMPACTION_SUMMARY_STORE_READ_RESULT_VERSION
    || valueAt(value, 'compaction_summary_authority') !== 'main_owned_context_compaction_summary_store'
  ) fail();
  const status = valueAt(value, 'status');
  const operation = safeCompactionStoreOperation(valueAt(value, 'evidence'));
  if (status === 'absent') {
    if (valueAt(value, 'context_compaction_summary') !== null) fail();
    return freezeDeep({
      status: 'absent',
      summary_id: null,
      compaction_ref: null,
      operation,
    });
  }
  if (status !== 'ready') fail();
  const wrapper = valueAt(value, 'context_compaction_summary');
  exactObject(wrapper, ['context_compaction_summary']);
  const summary = valueAt(wrapper, 'context_compaction_summary');
  if (
    !isPlainObject(summary)
    || valueAt(summary, 'conversation_id') !== conversationId
    || valueAt(summary, 'task_address_id') !== taskAddressId
  ) fail();
  return freezeDeep({
    status: 'ready',
    summary_id: valueAt(summary, 'summary_id'),
    compaction_ref: {
      summary_digest: valueAt(summary, 'digest'),
      source_range_digest: valueAt(summary, 'source_range_digest'),
      compacted_at_ms: valueAt(summary, 'created_at_ms'),
    },
    operation,
  });
}

function safeCompactionStoreOperation(evidenceValue) {
  if (!isPlainObject(evidenceValue)) fail();
  const transaction = valueAt(evidenceValue, 'transaction');
  if (
    transaction !== 'latest_context_compaction_summary_ready_read'
    && transaction !== 'latest_context_compaction_summary_absent_read'
  ) fail();
  return transaction;
}

function safePendingHandoffResult(value, sessionId) {
  if (value === null) {
    return freezeDeep({
      status: 'absent',
      count: 0,
      first_handoff_id: null,
      operation: 'not_configured',
    });
  }
  exactObject(value, [
    'result_version',
    'handoff_packet_authority',
    'status',
    'handoff_packets',
    'truncated',
    'evidence',
  ]);
  if (
    valueAt(value, 'result_version') !== BUILDER_HANDOFF_PACKET_STORE_READ_RESULT_VERSION
    || valueAt(value, 'handoff_packet_authority') !== 'main_owned_handoff_packet_store'
    || valueAt(value, 'truncated') !== false
  ) fail();
  const operation = safeHandoffStoreOperation(valueAt(value, 'evidence'));
  const status = valueAt(value, 'status');
  const packets = valueAt(value, 'handoff_packets');
  if (!Array.isArray(packets) || utilTypes.isProxy(packets) || packets.length > 128) fail();
  const keys = Reflect.ownKeys(packets);
  if (keys.some((key) => typeof key === 'symbol') || keys.length !== packets.length + 1) fail();
  if (status === 'absent') {
    if (packets.length !== 0) fail();
    return freezeDeep({
      status: 'absent',
      count: 0,
      first_handoff_id: null,
      operation,
    });
  }
  if (status !== 'ready' || packets.length < 1) fail();
  let firstHandoffId = null;
  for (let index = 0; index < packets.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(packets, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    const entry = descriptor.value;
    exactObject(entry, ['status', 'handoff_packet']);
    if (valueAt(entry, 'status') !== 'pending') fail();
    const packet = valueAt(entry, 'handoff_packet');
    if (!isPlainObject(packet) || valueAt(packet, 'target_thread_id') !== sessionId) fail();
    if (firstHandoffId === null) firstHandoffId = valueAt(packet, 'handoff_id');
  }
  return freezeDeep({
    status: 'pending',
    count: packets.length,
    first_handoff_id: firstHandoffId,
    operation,
  });
}

function safeHandoffStoreOperation(evidenceValue) {
  if (!isPlainObject(evidenceValue)) fail();
  const transaction = valueAt(evidenceValue, 'transaction');
  if (
    transaction !== 'pending_handoff_packets_ready_read'
    && transaction !== 'pending_handoff_packets_absent_read'
  ) fail();
  return transaction;
}

function mergeCompactionRefs(baseRefs, latestCompaction) {
  if (latestCompaction.compaction_ref === null) return baseRefs;
  if (baseRefs.some((ref) => (
    ref.summary_digest === latestCompaction.compaction_ref.summary_digest
    && ref.source_range_digest === latestCompaction.compaction_ref.source_range_digest
  ))) return baseRefs;
  return [...baseRefs, latestCompaction.compaction_ref];
}

function safeCurrentAddressResult(value, projectId, conversationId) {
  exactObject(value, ['result_version', 'status', 'session_address', 'task_address', 'address_evidence']);
  if (valueAt(value, 'result_version') !== BUILDER_SESSION_TASK_ADDRESS_STORE_READ_RESULT_VERSION) fail();
  if (valueAt(value, 'status') !== 'ready') fail();
  const sessionWrapper = valueAt(value, 'session_address');
  const taskWrapper = valueAt(value, 'task_address');
  exactObject(sessionWrapper, ['session_address']);
  exactObject(taskWrapper, ['task_address']);
  const session = valueAt(sessionWrapper, 'session_address');
  const task = valueAt(taskWrapper, 'task_address');
  if (
    !isPlainObject(session)
    || !isPlainObject(task)
    || valueAt(session, 'project_id') !== projectId
    || valueAt(task, 'project_id') !== projectId
    || valueAt(task, 'conversation_id') !== conversationId
    || valueAt(task, 'session_id') !== valueAt(session, 'session_id')
    || valueAt(session, 'current_task_id') === null
    || valueAt(session, 'current_task_id') !== valueAt(task, 'task_address_id')
  ) fail();
  return freezeDeep({
    session_id: safeSessionId(valueAt(session, 'session_id')),
    task_address_id: safeTaskAddressId(valueAt(task, 'task_address_id')),
  });
}

function safeServiceResult(value) {
  exactObject(value, RESULT_KEYS);
  const latest = valueAt(value, 'latest_task_capsule');
  exactObject(latest, LATEST_TASK_CAPSULE_KEYS);
  const latestStatus = valueAt(latest, 'status');
  if (
    (latestStatus === 'absent' && valueAt(latest, 'update_id') !== null)
    || (latestStatus === 'ready' && typeof valueAt(latest, 'update_id') !== 'string')
  ) fail();
  const latestCompaction = valueAt(value, 'latest_context_compaction_summary');
  exactObject(latestCompaction, LATEST_COMPACTION_SUMMARY_KEYS);
  const compactionStatus = valueAt(latestCompaction, 'status');
  if (
    (compactionStatus === 'absent' && valueAt(latestCompaction, 'summary_id') !== null)
    || (compactionStatus === 'ready' && typeof valueAt(latestCompaction, 'summary_id') !== 'string')
  ) fail();
  const pendingHandoffs = valueAt(value, 'pending_handoff_packets');
  exactObject(pendingHandoffs, PENDING_HANDOFF_PACKETS_KEYS);
  const handoffStatus = valueAt(pendingHandoffs, 'status');
  const handoffCount = valueAt(pendingHandoffs, 'count');
  if (
    !Number.isSafeInteger(handoffCount)
    || handoffCount < 0
    || (handoffStatus === 'absent' && (handoffCount !== 0 || valueAt(pendingHandoffs, 'first_handoff_id') !== null))
    || (handoffStatus === 'pending' && (handoffCount < 1 || typeof valueAt(pendingHandoffs, 'first_handoff_id') !== 'string'))
    || (handoffStatus !== 'absent' && handoffStatus !== 'pending')
  ) fail();
  const evidenceValue = valueAt(value, 'evidence');
  exactObject(evidenceValue, EVIDENCE_KEYS);
  return value;
}

function readCurrentWorkingContextState(services, rawRequest) {
  const request = safeRequest(rawRequest);
  const latest = safeLatestResult(
    services.task_capsule_store.read_latest_task_capsule({ project_id: request.project_id }),
    request.project_id,
  );
  const latestCompaction = safeLatestCompactionResult(
    services.context_compaction_summary_store === null
      ? null
      : services.context_compaction_summary_store.read_latest_context_compaction_summary({
        conversation_id: request.conversation_id,
        task_address_id: request.task_address_id,
      }),
    request.conversation_id,
    request.task_address_id,
  );
  const pendingHandoffs = safePendingHandoffResult(
    services.handoff_packet_store === null
      ? null
      : services.handoff_packet_store.list_pending_handoff_packets({
        target_thread_id: request.session_id,
      }),
    request.session_id,
  );
  const state = createBuilderWorkingContextState({
    ...request,
    compaction_refs: mergeCompactionRefs(request.compaction_refs, latestCompaction),
    latest_task_capsule: latest.task_capsule,
  });
  return freezeDeep(safeServiceResult({
    result_version: BUILDER_WORKING_CONTEXT_STATE_SERVICE_RESULT_VERSION,
    service_version: BUILDER_WORKING_CONTEXT_STATE_SERVICE_VERSION,
    operation: 'working_context_state_projected',
    status: state.state,
    project_id: state.project_id,
    session_id: state.session_id,
    task_address_id: state.task_address_id,
    conversation_id: state.conversation_id,
    working_context_state: state,
    latest_task_capsule: {
      status: latest.status,
      update_id: latest.update_id,
    },
    latest_context_compaction_summary: {
      status: latestCompaction.status,
      summary_id: latestCompaction.summary_id,
    },
    pending_handoff_packets: {
      status: pendingHandoffs.status,
      count: pendingHandoffs.count,
      first_handoff_id: pendingHandoffs.first_handoff_id,
    },
    evidence: evidence(latest.operation, latestCompaction.operation, pendingHandoffs.operation),
  }));
}

function readCurrentWorkingContextStateForConversation(services, rawRequest) {
  if (services.session_task_address_store === null) fail();
  const request = safeConversationRequest(rawRequest);
  const currentAddress = safeCurrentAddressResult(
    services.session_task_address_store.read_current_session_task_for_conversation({
      project_id: request.project_id,
      conversation_id: request.conversation_id,
    }),
    request.project_id,
    request.conversation_id,
  );
  return readCurrentWorkingContextState(services, {
    ...request,
    session_id: currentAddress.session_id,
    task_address_id: currentAddress.task_address_id,
  });
}

function createBuilderWorkingContextStateService(rawServices) {
  const services = safeServices(rawServices);
  return freezeDeep({
    service_version: BUILDER_WORKING_CONTEXT_STATE_SERVICE_VERSION,

    read_current_working_context_state(rawRequest) {
      try { return readCurrentWorkingContextState(services, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    read_current_working_context_state_for_conversation(rawRequest) {
      try { return readCurrentWorkingContextStateForConversation(services, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_WORKING_CONTEXT_STATE_SERVICE_RESULT_VERSION,
  BUILDER_WORKING_CONTEXT_STATE_SERVICE_VERSION,
  BuilderWorkingContextStateServiceError,
  createBuilderWorkingContextStateService,
});
