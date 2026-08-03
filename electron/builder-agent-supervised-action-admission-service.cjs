'use strict';

const { types: utilTypes } = require('node:util');

const {
  BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_STORE_VERSION,
  BuilderAgentTaskContextSnapshotStoreError,
} = require('./builder-agent-task-context-snapshot-store.cjs');
const {
  BuilderAgentSupervisedActionAdmissionError,
  createBuilderAgentSupervisedActionAdmission,
} = require('./builder-agent-supervised-action-admission.cjs');
const {
  BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_VERSION,
  BuilderAgentSupervisedActionAdmissionStoreError,
} = require('./builder-agent-supervised-action-admission-store.cjs');

const BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_SERVICE_VERSION =
  'builder-agent-supervised-action-admission-service.v1';
const BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_SERVICE_RESULT_VERSION =
  'builder-agent-supervised-action-admission-service-result.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const SNAPSHOT_ID_PATTERN = /^builder-agent-task-context-snapshot:[0-9a-f]{64}$/u;
const ACTION_REQUEST_ID_PATTERN = new RegExp(
  `^builder-agent-action-request:${UUID_SOURCE}$`,
  'u',
);
const SERVICE_KEYS = Object.freeze(['context_snapshot_store', 'admission_store']);
const RECORD_ADMISSION_KEYS = Object.freeze([
  'owner_id',
  'snapshot_id',
  'action_request_id',
  'requested_next_action',
  'run_status',
  'interrupt_requested',
  'cancel_requested',
  'now_ms',
]);
const ACTIONS = Object.freeze(['start_step', 'call_tool', 'read_private_source', 'finish_for_review']);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_supervised_action_admission_service_invalid:
    'Builder agent supervised action admission could not be verified.',
  builder_agent_supervised_action_admission_service_conflict:
    'Builder agent supervised action admission changed before it could be recorded.',
  builder_agent_supervised_action_admission_service_unavailable:
    'Builder agent supervised action admission service is unavailable.',
});

class BuilderAgentSupervisedActionAdmissionServiceError extends Error {
  constructor(code = 'builder_agent_supervised_action_admission_service_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_supervised_action_admission_service_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentSupervisedActionAdmissionServiceError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentSupervisedActionAdmissionServiceError(code);
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
  if (!isPlainObject(value)) fail('builder_agent_supervised_action_admission_service_invalid');
  const own = Reflect.ownKeys(value);
  if (
    own.length !== keys.length
    || own.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail('builder_agent_supervised_action_admission_service_invalid');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_agent_supervised_action_admission_service_invalid');
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_supervised_action_admission_service_invalid');
  }
  return descriptor.value;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    fail('builder_agent_supervised_action_admission_service_invalid');
  }
  return value;
}

function safeOwnerId(value) {
  return safePattern(value, OWNER_ID_PATTERN);
}

function safeSnapshotId(value) {
  return safePattern(value, SNAPSHOT_ID_PATTERN);
}

function safeActionRequestId(value) {
  return safePattern(value, ACTION_REQUEST_ID_PATTERN);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('builder_agent_supervised_action_admission_service_invalid');
  }
  return value;
}

function safeAction(value) {
  if (typeof value !== 'string' || !ACTIONS.includes(value)) {
    fail('builder_agent_supervised_action_admission_service_invalid');
  }
  return value;
}

function safeBoolean(value) {
  if (typeof value !== 'boolean') {
    fail('builder_agent_supervised_action_admission_service_invalid');
  }
  return value;
}

function storeMethod(store, name) {
  const descriptor = Object.getOwnPropertyDescriptor(store, name);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
    fail('builder_agent_supervised_action_admission_service_invalid');
  }
  return descriptor.value.bind(store);
}

function safeStore(value, expectedVersion, methods) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) {
    fail('builder_agent_supervised_action_admission_service_invalid');
  }
  const versionDescriptor = Object.getOwnPropertyDescriptor(value, 'store_version');
  if (
    !versionDescriptor
    || !Object.hasOwn(versionDescriptor, 'value')
    || versionDescriptor.value !== expectedVersion
  ) fail('builder_agent_supervised_action_admission_service_invalid');
  const selected = { store_version: expectedVersion };
  for (const method of methods) selected[method] = storeMethod(value, method);
  return freezeDeep(selected);
}

function safeStores(rawStores) {
  exactObject(rawStores, SERVICE_KEYS);
  return freezeDeep({
    context_snapshot_store: safeStore(
      valueAt(rawStores, 'context_snapshot_store'),
      BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_STORE_VERSION,
      ['read_snapshot', 'list_task_snapshots', 'list_run_snapshots'],
    ),
    admission_store: safeStore(
      valueAt(rawStores, 'admission_store'),
      BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_VERSION,
      ['record_admission', 'read_admission', 'read_admission_for_snapshot', 'list_task_admissions', 'list_run_admissions'],
    ),
  });
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentSupervisedActionAdmissionServiceError) {
    return new BuilderAgentSupervisedActionAdmissionServiceError(error.code);
  }
  if (error instanceof BuilderAgentSupervisedActionAdmissionError) {
    return new BuilderAgentSupervisedActionAdmissionServiceError(
      'builder_agent_supervised_action_admission_service_invalid',
    );
  }
  if (
    error instanceof BuilderAgentTaskContextSnapshotStoreError
    || error instanceof BuilderAgentSupervisedActionAdmissionStoreError
  ) {
    if (/_conflict$/u.test(error.code)) {
      return new BuilderAgentSupervisedActionAdmissionServiceError(
        'builder_agent_supervised_action_admission_service_conflict',
      );
    }
    if (/_unavailable$/u.test(error.code)) {
      return new BuilderAgentSupervisedActionAdmissionServiceError(
        'builder_agent_supervised_action_admission_service_unavailable',
      );
    }
    return new BuilderAgentSupervisedActionAdmissionServiceError(
      'builder_agent_supervised_action_admission_service_invalid',
    );
  }
  return new BuilderAgentSupervisedActionAdmissionServiceError(
    'builder_agent_supervised_action_admission_service_unavailable',
  );
}

function serviceEvidence() {
  return freezeDeep({
    service_authority: 'main_owned_agent_supervised_action_admission_service',
    context_snapshot_store_authority: 'main_owned_agent_task_context_snapshot_store',
    admission_store_authority: 'main_owned_agent_supervised_action_admission_store',
    context_snapshot_contract_authority: 'main_agent_task_context_snapshot_contract_v1',
    admission_contract_authority: 'main_agent_supervised_action_admission_contract_v1',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    model_dispatch: false,
    tool_dispatch: false,
    next_action_dispatch: false,
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
    raw_context_storage: false,
    recovery_model: 'idempotent_store_replay',
  });
}

function requireStoreBackedSnapshot(stores, ownerId, snapshotId) {
  const snapshotRead = stores.context_snapshot_store.read_snapshot({
    snapshot_id: snapshotId,
    owner_id: ownerId,
  });
  if (
    snapshotRead.status !== 'ready'
    || !snapshotRead.agent_task_context_snapshot
    || snapshotRead.agent_task_context_snapshot.snapshot.snapshot_id !== snapshotId
    || snapshotRead.agent_task_context_snapshot.snapshot.owner_id !== ownerId
  ) fail('builder_agent_supervised_action_admission_service_conflict');
  const snapshot = snapshotRead.agent_task_context_snapshot.snapshot;
  const taskSnapshots = stores.context_snapshot_store.list_task_snapshots({
    owner_id: ownerId,
    project_id: snapshot.project_id,
    task_id: snapshot.task_id,
  });
  if (
    taskSnapshots.status !== 'ready'
    || !taskSnapshots.agent_task_context_snapshots.some(
      (entry) => entry.snapshot.snapshot_id === snapshotId,
    )
  ) fail('builder_agent_supervised_action_admission_service_invalid');
  const runSnapshots = stores.context_snapshot_store.list_run_snapshots({
    owner_id: ownerId,
    project_id: snapshot.project_id,
    task_id: snapshot.task_id,
    run_id: snapshot.run_id,
  });
  if (
    runSnapshots.status !== 'ready'
    || !runSnapshots.agent_task_context_snapshots.some(
      (entry) => entry.snapshot.snapshot_id === snapshotId,
    )
  ) fail('builder_agent_supervised_action_admission_service_invalid');
  return freezeDeep({ run_snapshots: runSnapshots, snapshot, snapshot_read: snapshotRead, task_snapshots: taskSnapshots });
}

function verifyStoredAdmission(stores, admission) {
  const admissionRead = stores.admission_store.read_admission({
    admission_id: admission.admission_id,
    owner_id: admission.owner_id,
  });
  const admissionForSnapshot = stores.admission_store.read_admission_for_snapshot({
    snapshot_id: admission.snapshot_id,
    owner_id: admission.owner_id,
  });
  const taskAdmissions = stores.admission_store.list_task_admissions({
    owner_id: admission.owner_id,
    project_id: admission.project_id,
    task_id: admission.task_id,
  });
  const runAdmissions = stores.admission_store.list_run_admissions({
    owner_id: admission.owner_id,
    project_id: admission.project_id,
    task_id: admission.task_id,
    run_id: admission.run_id,
  });
  if (
    admissionRead.status !== 'ready'
    || admissionRead.supervised_action_admission.admission.admission_id !== admission.admission_id
    || admissionForSnapshot.status !== 'ready'
    || admissionForSnapshot.supervised_action_admission.admission.admission_id !== admission.admission_id
    || taskAdmissions.status !== 'ready'
    || !taskAdmissions.supervised_action_admissions.some(
      (entry) => entry.admission.admission_id === admission.admission_id,
    )
    || runAdmissions.status !== 'ready'
    || !runAdmissions.supervised_action_admissions.some(
      (entry) => entry.admission.admission_id === admission.admission_id,
    )
  ) fail('builder_agent_supervised_action_admission_service_invalid');
  return freezeDeep({
    admission_for_snapshot: admissionForSnapshot,
    admission_read: admissionRead,
    run_admissions: runAdmissions,
    task_admissions: taskAdmissions,
  });
}

function recordSupervisedActionAdmission(stores, rawRequest) {
  exactObject(rawRequest, RECORD_ADMISSION_KEYS);
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const snapshotId = safeSnapshotId(valueAt(rawRequest, 'snapshot_id'));
  const actionRequestId = safeActionRequestId(valueAt(rawRequest, 'action_request_id'));
  const requestedNextAction = safeAction(valueAt(rawRequest, 'requested_next_action'));
  const nowMs = safeTimestamp(valueAt(rawRequest, 'now_ms'));
  const snapshotEvidence = requireStoreBackedSnapshot(stores, ownerId, snapshotId);
  const admission = createBuilderAgentSupervisedActionAdmission({
    context_snapshot: snapshotEvidence.snapshot,
    action_request_id: actionRequestId,
    requested_next_action: requestedNextAction,
    run_status: valueAt(rawRequest, 'run_status'),
    interrupt_requested: safeBoolean(valueAt(rawRequest, 'interrupt_requested')),
    cancel_requested: safeBoolean(valueAt(rawRequest, 'cancel_requested')),
    admitted_at_ms: nowMs,
  });
  const admissionWrite = stores.admission_store.record_admission({ admission });
  const admissionEvidence = verifyStoredAdmission(stores, admission);
  return freezeDeep({
    result_version: BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_SERVICE_RESULT_VERSION,
    service_version: BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_SERVICE_VERSION,
    operation: 'agent_supervised_action_admission_recorded',
    status: 'ready',
    requested_next_action: admission.requested_next_action,
    next_gate: admission.next_gate,
    supervised_action_admission: admission,
    snapshot_read: snapshotEvidence.snapshot_read,
    task_snapshots: snapshotEvidence.task_snapshots,
    run_snapshots: snapshotEvidence.run_snapshots,
    admission_write: admissionWrite,
    admission_read: admissionEvidence.admission_read,
    admission_for_snapshot: admissionEvidence.admission_for_snapshot,
    task_admissions: admissionEvidence.task_admissions,
    run_admissions: admissionEvidence.run_admissions,
    operations: {
      admission_store: admissionWrite.operation,
    },
    evidence: serviceEvidence(),
  });
}

function createBuilderAgentSupervisedActionAdmissionService(rawStores) {
  const stores = safeStores(rawStores);
  return freezeDeep({
    service_version: BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_SERVICE_VERSION,

    record_supervised_action_admission(rawRequest) {
      try { return recordSupervisedActionAdmission(stores, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_SERVICE_VERSION,
  BuilderAgentSupervisedActionAdmissionServiceError,
  createBuilderAgentSupervisedActionAdmissionService,
});
