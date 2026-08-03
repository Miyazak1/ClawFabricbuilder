'use strict';

const { types: utilTypes } = require('node:util');

const {
  BUILDER_AGENT_TOOL_CALL_RECORD_STORE_VERSION,
  BuilderAgentToolCallRecordStoreError,
} = require('./builder-agent-tool-call-record-store.cjs');
const {
  BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_VERSION,
  BuilderAgentSupervisedActionAdmissionStoreError,
} = require('./builder-agent-supervised-action-admission-store.cjs');
const {
  BuilderToolCallRecordError,
  createBuilderToolCallRecord,
} = require('./builder-tool-call-records.cjs');

const BUILDER_AGENT_TOOL_CALL_RECORD_SERVICE_VERSION =
  'builder-agent-tool-call-record-service.v1';
const BUILDER_AGENT_TOOL_CALL_RECORD_SERVICE_RESULT_VERSION =
  'builder-agent-tool-call-record-service-result.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const TURN_ID_PATTERN = new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u');
const STEP_ID_PATTERN = new RegExp(`^builder-run-step:${UUID_SOURCE}$`, 'u');
const ADMISSION_ID_PATTERN = /^builder-agent-supervised-action-admission:[0-9a-f]{64}$/u;
const SERVICE_KEYS = Object.freeze([
  'supervised_action_admission_store',
  'tool_call_record_store',
]);
const RECORD_TOOL_CALL_KEYS = Object.freeze([
  'owner_id',
  'supervised_action_admission_id',
  'turn_id',
  'step_id',
  'session_policy',
  'permission_admission',
  'requested_at_ms',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_tool_call_record_service_invalid:
    'Builder agent tool call record could not be verified.',
  builder_agent_tool_call_record_service_conflict:
    'Builder agent tool call record changed before it could be recorded.',
  builder_agent_tool_call_record_service_unavailable:
    'Builder agent tool call record service is unavailable.',
});

class BuilderAgentToolCallRecordServiceError extends Error {
  constructor(code = 'builder_agent_tool_call_record_service_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_tool_call_record_service_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentToolCallRecordServiceError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentToolCallRecordServiceError(code);
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
  if (!isPlainObject(value)) fail('builder_agent_tool_call_record_service_invalid');
  const own = Reflect.ownKeys(value);
  if (
    own.length !== keys.length
    || own.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail('builder_agent_tool_call_record_service_invalid');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_agent_tool_call_record_service_invalid');
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_tool_call_record_service_invalid');
  }
  return descriptor.value;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    fail('builder_agent_tool_call_record_service_invalid');
  }
  return value;
}

function safeOwnerId(value) {
  return safePattern(value, OWNER_ID_PATTERN);
}

function safeAdmissionId(value) {
  return safePattern(value, ADMISSION_ID_PATTERN);
}

function safeTurnId(value) {
  return safePattern(value, TURN_ID_PATTERN);
}

function safeStepId(value) {
  return safePattern(value, STEP_ID_PATTERN);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('builder_agent_tool_call_record_service_invalid');
  }
  return value;
}

function storeMethod(store, name) {
  const descriptor = Object.getOwnPropertyDescriptor(store, name);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
    fail('builder_agent_tool_call_record_service_invalid');
  }
  return descriptor.value.bind(store);
}

function safeStore(value, expectedVersion, methods) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) {
    fail('builder_agent_tool_call_record_service_invalid');
  }
  const versionDescriptor = Object.getOwnPropertyDescriptor(value, 'store_version');
  if (
    !versionDescriptor
    || !Object.hasOwn(versionDescriptor, 'value')
    || versionDescriptor.value !== expectedVersion
  ) fail('builder_agent_tool_call_record_service_invalid');
  const selected = { store_version: expectedVersion };
  for (const method of methods) selected[method] = storeMethod(value, method);
  return freezeDeep(selected);
}

function safeStores(rawStores) {
  exactObject(rawStores, SERVICE_KEYS);
  return freezeDeep({
    supervised_action_admission_store: safeStore(
      valueAt(rawStores, 'supervised_action_admission_store'),
      BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_VERSION,
      ['read_admission', 'list_task_admissions', 'list_run_admissions'],
    ),
    tool_call_record_store: safeStore(
      valueAt(rawStores, 'tool_call_record_store'),
      BUILDER_AGENT_TOOL_CALL_RECORD_STORE_VERSION,
      [
        'record_tool_call',
        'read_tool_call',
        'read_tool_call_for_admission',
        'list_task_tool_calls',
        'list_run_tool_calls',
      ],
    ),
  });
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentToolCallRecordServiceError) {
    return new BuilderAgentToolCallRecordServiceError(error.code);
  }
  if (error instanceof BuilderToolCallRecordError) {
    return new BuilderAgentToolCallRecordServiceError(
      'builder_agent_tool_call_record_service_invalid',
    );
  }
  if (
    error instanceof BuilderAgentSupervisedActionAdmissionStoreError
    || error instanceof BuilderAgentToolCallRecordStoreError
  ) {
    if (/_conflict$/u.test(error.code)) {
      return new BuilderAgentToolCallRecordServiceError(
        'builder_agent_tool_call_record_service_conflict',
      );
    }
    if (/_unavailable$/u.test(error.code)) {
      return new BuilderAgentToolCallRecordServiceError(
        'builder_agent_tool_call_record_service_unavailable',
      );
    }
    return new BuilderAgentToolCallRecordServiceError(
      'builder_agent_tool_call_record_service_invalid',
    );
  }
  return new BuilderAgentToolCallRecordServiceError(
    'builder_agent_tool_call_record_service_unavailable',
  );
}

function serviceEvidence() {
  return freezeDeep({
    service_authority: 'main_owned_agent_tool_call_record_service',
    supervised_action_admission_store_authority: 'main_owned_agent_supervised_action_admission_store',
    supervised_action_admission_authority: 'main_agent_supervised_action_admission_contract_v1',
    tool_call_record_store_authority: 'main_owned_agent_tool_call_record_store',
    tool_call_record_authority: 'main_tool_call_record_contract_v1',
    tool_session_policy_authority: 'main_tool_session_policy_contract_v1',
    permission_admission_authority: 'main_permission_decision_before_tool_dispatch_v1',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    model_dispatch: false,
    tool_dispatch: false,
    execution_authority: false,
    permission_grant_authority: false,
    credential_storage: 'not_present',
    source_access: 'not_present',
    source_read: 'not_present',
    source_write: 'not_present',
    process_run: false,
    network_access: false,
    revision_authority: false,
    review_authority: false,
    artifact_authority: false,
    raw_output_storage: 'not_present',
    recovery_model: 'idempotent_tool_call_record_store_replay',
  });
}

function admissionFact(admissionRead) {
  if (admissionRead.status !== 'ready') fail('builder_agent_tool_call_record_service_conflict');
  const entry = admissionRead.supervised_action_admission;
  if (!entry || !entry.admission) fail('builder_agent_tool_call_record_service_invalid');
  return entry.admission;
}

function toolCallRecordFact(toolCallRecordRead) {
  if (toolCallRecordRead.status !== 'ready') {
    fail('builder_agent_tool_call_record_service_conflict');
  }
  const entry = toolCallRecordRead.agent_tool_call_record;
  if (!entry || !entry.tool_call_record) fail('builder_agent_tool_call_record_service_invalid');
  return entry.tool_call_record;
}

function requireCallToolAdmission(stores, ownerId, admissionId) {
  const admissionRead = stores.supervised_action_admission_store.read_admission({
    admission_id: admissionId,
    owner_id: ownerId,
  });
  const admission = admissionFact(admissionRead);
  const taskAdmissions = stores.supervised_action_admission_store.list_task_admissions({
    owner_id: admission.owner_id,
    project_id: admission.project_id,
    task_id: admission.task_id,
  });
  const runAdmissions = stores.supervised_action_admission_store.list_run_admissions({
    owner_id: admission.owner_id,
    project_id: admission.project_id,
    task_id: admission.task_id,
    run_id: admission.run_id,
  });
  if (
    taskAdmissions.status !== 'ready'
    || !taskAdmissions.supervised_action_admissions.some(
      (entry) => entry.admission.admission_id === admissionId,
    )
    || runAdmissions.status !== 'ready'
    || !runAdmissions.supervised_action_admissions.some(
      (entry) => entry.admission.admission_id === admissionId,
    )
    || admission.requested_next_action !== 'call_tool'
    || admission.next_gate !== 'tool_call_record_required_later'
  ) fail('builder_agent_tool_call_record_service_invalid');
  return freezeDeep({
    admission,
    admission_read: admissionRead,
    run_admissions: runAdmissions,
    task_admissions: taskAdmissions,
  });
}

function verifyRecordAgainstAdmission(record, admission) {
  if (
    record.project_id !== admission.project_id
    || record.conversation_id !== admission.conversation_id
    || record.task_id !== admission.task_id
    || record.run_id !== admission.run_id
    || record.session_policy.issued_at_ms < admission.admitted_at_ms
    || record.permission_admission_receipt.evaluated_at_ms < admission.admitted_at_ms
    || record.permission_admission_receipt.actor_id !== admission.agent_id
    || record.permission_admission_receipt.project_id !== admission.project_id
    || record.requested_at_ms < admission.admitted_at_ms
    || record.lifecycle.dispatch_admission !== 'not_started'
    || record.lifecycle.execution_admission !== 'not_performed'
    || record.authority.tool_dispatch !== 'not_performed'
  ) fail('builder_agent_tool_call_record_service_invalid');
}

function createAgentToolCallRecord(stores, rawRequest) {
  exactObject(rawRequest, RECORD_TOOL_CALL_KEYS);
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const admissionId = safeAdmissionId(valueAt(rawRequest, 'supervised_action_admission_id'));
  const turnId = safeTurnId(valueAt(rawRequest, 'turn_id'));
  const stepId = safeStepId(valueAt(rawRequest, 'step_id'));
  const requestedAtMs = safeTimestamp(valueAt(rawRequest, 'requested_at_ms'));
  const admissionEvidence = requireCallToolAdmission(stores, ownerId, admissionId);
  const admission = admissionEvidence.admission;
  const record = createBuilderToolCallRecord({
    project_id: admission.project_id,
    conversation_id: admission.conversation_id,
    turn_id: turnId,
    task_id: admission.task_id,
    run_id: admission.run_id,
    step_id: stepId,
    session_policy: valueAt(rawRequest, 'session_policy'),
    admission: valueAt(rawRequest, 'permission_admission'),
    requested_at_ms: requestedAtMs,
  });
  verifyRecordAgainstAdmission(record, admission);
  const recordWrite = stores.tool_call_record_store.record_tool_call({
    owner_id: admission.owner_id,
    supervised_action_admission_id: admissionId,
    tool_call_record: record,
  });
  const recordRead = stores.tool_call_record_store.read_tool_call({
    tool_call_id: record.tool_call_id,
    owner_id: admission.owner_id,
  });
  const admissionRecordRead = stores.tool_call_record_store.read_tool_call_for_admission({
    supervised_action_admission_id: admissionId,
    owner_id: admission.owner_id,
  });
  const taskRecords = stores.tool_call_record_store.list_task_tool_calls({
    owner_id: admission.owner_id,
    project_id: admission.project_id,
    task_id: admission.task_id,
  });
  const runRecords = stores.tool_call_record_store.list_run_tool_calls({
    owner_id: admission.owner_id,
    project_id: admission.project_id,
    task_id: admission.task_id,
    run_id: admission.run_id,
  });
  const storedRecord = toolCallRecordFact(recordRead);
  const admissionStoredRecord = toolCallRecordFact(admissionRecordRead);
  if (
    storedRecord.record_digest !== record.record_digest
    || admissionStoredRecord.record_digest !== record.record_digest
    || taskRecords.status !== 'ready'
    || !taskRecords.agent_tool_call_records.some(
      (entry) => entry.tool_call_record.record_digest === record.record_digest,
    )
    || runRecords.status !== 'ready'
    || !runRecords.agent_tool_call_records.some(
      (entry) => entry.tool_call_record.record_digest === record.record_digest,
    )
  ) fail('builder_agent_tool_call_record_service_invalid');
  return freezeDeep({
    result_version: BUILDER_AGENT_TOOL_CALL_RECORD_SERVICE_RESULT_VERSION,
    service_version: BUILDER_AGENT_TOOL_CALL_RECORD_SERVICE_VERSION,
    operation: 'agent_tool_call_record_admitted',
    status: 'ready',
    requested_next_action: admission.requested_next_action,
    next_gate: admission.next_gate,
    supervised_action_admission: admission,
    supervised_action_admission_read: admissionEvidence.admission_read,
    action_task_admissions: admissionEvidence.task_admissions,
    action_run_admissions: admissionEvidence.run_admissions,
    tool_call_record: storedRecord,
    tool_call_record_store_write: recordWrite,
    tool_call_record_read: recordRead,
    admission_tool_call_record_read: admissionRecordRead,
    task_tool_call_records: taskRecords,
    run_tool_call_records: runRecords,
    operations: freezeDeep({
      tool_call_record_store: recordWrite.operation,
    }),
    evidence: serviceEvidence(),
  });
}

function createBuilderAgentToolCallRecordService(rawStores) {
  const stores = safeStores(rawStores);
  return freezeDeep({
    service_version: BUILDER_AGENT_TOOL_CALL_RECORD_SERVICE_VERSION,

    create_agent_tool_call_record(rawRequest) {
      try { return createAgentToolCallRecord(stores, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_TOOL_CALL_RECORD_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_TOOL_CALL_RECORD_SERVICE_VERSION,
  BuilderAgentToolCallRecordServiceError,
  createBuilderAgentToolCallRecordService,
});
