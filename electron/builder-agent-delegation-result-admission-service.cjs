'use strict';

const { types: utilTypes } = require('node:util');

const {
  BuilderAgentDelegationResultAdmissionContractError,
  createBuilderAgentDelegationResultAdmissionRecord,
} = require('./builder-agent-delegation-result-admission-contract.cjs');
const {
  BUILDER_AGENT_DELEGATION_RESULT_STORE_VERSION,
  BuilderAgentDelegationResultStoreError,
} = require('./builder-agent-delegation-result-store.cjs');
const {
  BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_VERSION,
  BuilderAgentDelegationResultAdmissionStoreError,
} = require('./builder-agent-delegation-result-admission-store.cjs');

const BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_SERVICE_VERSION =
  'builder-agent-delegation-result-admission-service.v1';
const BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_SERVICE_RESULT_VERSION =
  'builder-agent-delegation-result-admission-service-result.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const DELEGATION_RESULT_ID_PATTERN = /^builder-agent-delegation-result:[0-9a-f]{64}$/u;
const SERVICE_KEYS = Object.freeze(['result_store', 'admission_store']);
const RECORD_ADMISSION_KEYS = Object.freeze([
  'owner_id',
  'delegation_result_id',
  'admission_input',
  'now_ms',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_delegation_result_admission_service_invalid:
    'Builder agent delegation result admission could not be verified.',
  builder_agent_delegation_result_admission_service_conflict:
    'Builder agent delegation result admission changed before it could be recorded.',
  builder_agent_delegation_result_admission_service_unavailable:
    'Builder agent delegation result admission service is unavailable.',
});

class BuilderAgentDelegationResultAdmissionServiceError extends Error {
  constructor(code = 'builder_agent_delegation_result_admission_service_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_delegation_result_admission_service_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentDelegationResultAdmissionServiceError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentDelegationResultAdmissionServiceError(code);
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
  if (!isPlainObject(value)) {
    fail('builder_agent_delegation_result_admission_service_invalid');
  }
  const own = Object.keys(value);
  if (own.length !== keys.length) {
    fail('builder_agent_delegation_result_admission_service_invalid');
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      fail('builder_agent_delegation_result_admission_service_invalid');
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_delegation_result_admission_service_invalid');
  }
  return descriptor.value;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    fail('builder_agent_delegation_result_admission_service_invalid');
  }
  return value;
}

function safeOwnerId(value) {
  return safePattern(value, OWNER_ID_PATTERN);
}

function safeDelegationResultId(value) {
  return safePattern(value, DELEGATION_RESULT_ID_PATTERN);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('builder_agent_delegation_result_admission_service_invalid');
  }
  return value;
}

function storeMethod(store, name) {
  const descriptor = Object.getOwnPropertyDescriptor(store, name);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
    fail('builder_agent_delegation_result_admission_service_invalid');
  }
  return descriptor.value.bind(store);
}

function safeStore(value, expectedVersion, methods) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) {
    fail('builder_agent_delegation_result_admission_service_invalid');
  }
  const versionDescriptor = Object.getOwnPropertyDescriptor(value, 'store_version');
  if (
    !versionDescriptor
    || !Object.hasOwn(versionDescriptor, 'value')
    || versionDescriptor.value !== expectedVersion
  ) fail('builder_agent_delegation_result_admission_service_invalid');
  const selected = { store_version: expectedVersion };
  for (const method of methods) selected[method] = storeMethod(value, method);
  return freezeDeep(selected);
}

function safeStores(rawStores) {
  exactObject(rawStores, SERVICE_KEYS);
  return freezeDeep({
    result_store: safeStore(
      valueAt(rawStores, 'result_store'),
      BUILDER_AGENT_DELEGATION_RESULT_STORE_VERSION,
      ['read_result', 'list_parent_task_results', 'list_child_task_results'],
    ),
    admission_store: safeStore(
      valueAt(rawStores, 'admission_store'),
      BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_VERSION,
      ['record_admission', 'read_admission', 'read_admission_for_result', 'list_parent_task_admissions', 'list_child_task_admissions'],
    ),
  });
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentDelegationResultAdmissionServiceError) {
    return new BuilderAgentDelegationResultAdmissionServiceError(error.code);
  }
  if (error instanceof BuilderAgentDelegationResultAdmissionContractError) {
    return new BuilderAgentDelegationResultAdmissionServiceError(
      'builder_agent_delegation_result_admission_service_invalid',
    );
  }
  if (
    error instanceof BuilderAgentDelegationResultStoreError
    || error instanceof BuilderAgentDelegationResultAdmissionStoreError
  ) {
    if (/_conflict$/u.test(error.code) || /_not_found$/u.test(error.code)) {
      return new BuilderAgentDelegationResultAdmissionServiceError(
        'builder_agent_delegation_result_admission_service_conflict',
      );
    }
    if (/_unavailable$/u.test(error.code)) {
      return new BuilderAgentDelegationResultAdmissionServiceError(
        'builder_agent_delegation_result_admission_service_unavailable',
      );
    }
    return new BuilderAgentDelegationResultAdmissionServiceError(
      'builder_agent_delegation_result_admission_service_invalid',
    );
  }
  return new BuilderAgentDelegationResultAdmissionServiceError(
    'builder_agent_delegation_result_admission_service_unavailable',
  );
}

function serviceEvidence() {
  return freezeDeep({
    service_authority: 'main_owned_agent_delegation_result_admission_service',
    result_store_authority: 'main_owned_agent_delegation_result_store',
    admission_store_authority: 'main_owned_agent_delegation_result_admission_store',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    child_assignment_authority: false,
    child_run_authority: false,
    provider_dispatch: false,
    model_dispatch: false,
    tool_dispatch: false,
    permission_grant_authority: false,
    credential_storage: 'not_present',
    source_access: 'not_present',
    source_read: 'not_present',
    source_write: 'not_present',
    process_run: false,
    network_access: false,
    revision_authority: false,
    review_authority: 'required_later',
    artifact_authority: false,
    parent_materialization_authority: false,
    recovery_model: 'idempotent_store_replay',
  });
}

function readRecordedResultFact(stores, ownerId, delegationResultId) {
  const resultRead = stores.result_store.read_result({
    delegation_result_id: delegationResultId,
    owner_id: ownerId,
  });
  if (
    resultRead.status !== 'ready'
    || !resultRead.delegation_result
    || !resultRead.delegation_result.delegation
    || !resultRead.delegation_result.result
    || resultRead.delegation_result.result.delegation_result_id !== delegationResultId
    || resultRead.delegation_result.result.owner_id !== ownerId
  ) fail('builder_agent_delegation_result_admission_service_conflict');
  const result = resultRead.delegation_result.result;
  const parentTaskResults = stores.result_store.list_parent_task_results({
    owner_id: ownerId,
    project_id: result.project_id,
    parent_task_id: result.parent_task_id,
  });
  if (
    parentTaskResults.status !== 'ready'
    || !parentTaskResults.delegation_results.some(
      (entry) => entry.result.delegation_result_id === delegationResultId,
    )
  ) fail('builder_agent_delegation_result_admission_service_invalid');
  const childTaskResults = stores.result_store.list_child_task_results({
    owner_id: ownerId,
    project_id: result.project_id,
    child_task_id: result.child_task_id,
  });
  if (
    childTaskResults.status !== 'ready'
    || !childTaskResults.delegation_results.some(
      (entry) => entry.result.delegation_result_id === delegationResultId,
    )
  ) fail('builder_agent_delegation_result_admission_service_invalid');
  return freezeDeep({ result_read: resultRead, parent_task_results: parentTaskResults, child_task_results: childTaskResults });
}

function recordDelegationResultAdmission(stores, rawRequest) {
  exactObject(rawRequest, RECORD_ADMISSION_KEYS);
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const delegationResultId = safeDelegationResultId(valueAt(rawRequest, 'delegation_result_id'));
  const nowMs = safeTimestamp(valueAt(rawRequest, 'now_ms'));
  const resultEvidence = readRecordedResultFact(stores, ownerId, delegationResultId);
  const delegation = resultEvidence.result_read.delegation_result.delegation;
  const result = resultEvidence.result_read.delegation_result.result;
  const admission = createBuilderAgentDelegationResultAdmissionRecord(
    valueAt(rawRequest, 'admission_input'),
    result,
    delegation,
  );
  if (
    admission.owner_id !== ownerId
    || admission.delegation_result_id !== delegationResultId
    || admission.admitted_at_ms !== nowMs
  ) fail('builder_agent_delegation_result_admission_service_invalid');

  const admissionWrite = stores.admission_store.record_admission({ delegation, result, admission });
  const admissionRead = stores.admission_store.read_admission({
    delegation_result_admission_id: admission.delegation_result_admission_id,
    owner_id: ownerId,
  });
  if (
    admissionRead.status !== 'ready'
    || !admissionRead.delegation_result_admission
    || admissionRead.delegation_result_admission.admission.delegation_result_admission_id
      !== admission.delegation_result_admission_id
  ) fail('builder_agent_delegation_result_admission_service_invalid');
  const admissionForResult = stores.admission_store.read_admission_for_result({
    delegation_result_id: delegationResultId,
    owner_id: ownerId,
  });
  if (
    admissionForResult.status !== 'ready'
    || !admissionForResult.delegation_result_admission
    || admissionForResult.delegation_result_admission.admission.delegation_result_admission_id
      !== admission.delegation_result_admission_id
  ) fail('builder_agent_delegation_result_admission_service_invalid');
  const parentTaskAdmissions = stores.admission_store.list_parent_task_admissions({
    owner_id: ownerId,
    project_id: admission.project_id,
    parent_task_id: admission.parent_task_id,
  });
  if (
    parentTaskAdmissions.status !== 'ready'
    || !parentTaskAdmissions.delegation_result_admissions.some(
      (entry) => entry.admission.delegation_result_admission_id
        === admission.delegation_result_admission_id,
    )
  ) fail('builder_agent_delegation_result_admission_service_invalid');
  const childTaskAdmissions = stores.admission_store.list_child_task_admissions({
    owner_id: ownerId,
    project_id: admission.project_id,
    child_task_id: admission.child_task_id,
  });
  if (
    childTaskAdmissions.status !== 'ready'
    || !childTaskAdmissions.delegation_result_admissions.some(
      (entry) => entry.admission.delegation_result_admission_id
        === admission.delegation_result_admission_id,
    )
  ) fail('builder_agent_delegation_result_admission_service_invalid');

  return freezeDeep({
    result_version: BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_SERVICE_RESULT_VERSION,
    service_version: BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_SERVICE_VERSION,
    operation: 'agent_delegation_result_admission_recorded',
    status: 'ready',
    admission_status: admission.admission_status,
    result_status: admission.result.status,
    delegation_result_admission: admission,
    result_read: resultEvidence.result_read,
    parent_task_results: resultEvidence.parent_task_results,
    child_task_results: resultEvidence.child_task_results,
    admission_write: admissionWrite,
    admission_read: admissionRead,
    admission_for_result: admissionForResult,
    parent_task_admissions: parentTaskAdmissions,
    child_task_admissions: childTaskAdmissions,
    operations: {
      admission_store: admissionWrite.operation,
    },
    evidence: serviceEvidence(),
  });
}

function createBuilderAgentDelegationResultAdmissionService(rawStores) {
  const stores = safeStores(rawStores);
  return freezeDeep({
    service_version: BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_SERVICE_VERSION,

    record_delegation_result_admission(rawRequest) {
      try { return recordDelegationResultAdmission(stores, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_SERVICE_VERSION,
  BuilderAgentDelegationResultAdmissionServiceError,
  createBuilderAgentDelegationResultAdmissionService,
});
