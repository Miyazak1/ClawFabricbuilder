'use strict';

const { types: utilTypes } = require('node:util');

const {
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_STORE_VERSION,
  BuilderAgentDelegationResultParentMaterializationEligibilityStoreError,
} = require('./builder-agent-delegation-result-parent-materialization-eligibility-store.cjs');
const {
  BuilderAgentDelegationResultParentMaterializationError,
  createBuilderAgentDelegationResultParentMaterializationRecord,
} = require('./builder-agent-delegation-result-parent-materialization.cjs');
const {
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_STORE_VERSION,
  BuilderAgentDelegationResultParentMaterializationStoreError,
} = require('./builder-agent-delegation-result-parent-materialization-store.cjs');

const BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_SERVICE_VERSION =
  'builder-agent-delegation-result-parent-materialization-service.v1';
const BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_SERVICE_RESULT_VERSION =
  'builder-agent-delegation-result-parent-materialization-service-result.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const ELIGIBILITY_ID_PATTERN =
  /^builder-agent-delegation-result-parent-materialization-eligibility:[0-9a-f]{64}$/u;
const SERVICE_KEYS = Object.freeze(['eligibility_store', 'materialization_store']);
const RECORD_MATERIALIZATION_KEYS = Object.freeze([
  'owner_id',
  'delegation_result_parent_materialization_eligibility_id',
  'materialization_input',
  'now_ms',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_delegation_result_parent_materialization_service_invalid:
    'Builder agent delegation result parent materialization could not be verified.',
  builder_agent_delegation_result_parent_materialization_service_conflict:
    'Builder agent delegation result parent materialization changed before it could be recorded.',
  builder_agent_delegation_result_parent_materialization_service_unavailable:
    'Builder agent delegation result parent materialization service is unavailable.',
});

class BuilderAgentDelegationResultParentMaterializationServiceError extends Error {
  constructor(code = 'builder_agent_delegation_result_parent_materialization_service_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_delegation_result_parent_materialization_service_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentDelegationResultParentMaterializationServiceError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentDelegationResultParentMaterializationServiceError(code);
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
    fail('builder_agent_delegation_result_parent_materialization_service_invalid');
  }
  const own = Object.keys(value);
  if (own.length !== keys.length) {
    fail('builder_agent_delegation_result_parent_materialization_service_invalid');
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      fail('builder_agent_delegation_result_parent_materialization_service_invalid');
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_delegation_result_parent_materialization_service_invalid');
  }
  return descriptor.value;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    fail('builder_agent_delegation_result_parent_materialization_service_invalid');
  }
  return value;
}

function safeOwnerId(value) {
  return safePattern(value, OWNER_ID_PATTERN);
}

function safeEligibilityId(value) {
  return safePattern(value, ELIGIBILITY_ID_PATTERN);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('builder_agent_delegation_result_parent_materialization_service_invalid');
  }
  return value;
}

function storeMethod(store, name) {
  const descriptor = Object.getOwnPropertyDescriptor(store, name);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
    fail('builder_agent_delegation_result_parent_materialization_service_invalid');
  }
  return descriptor.value.bind(store);
}

function safeStore(value, expectedVersion, methods) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) {
    fail('builder_agent_delegation_result_parent_materialization_service_invalid');
  }
  const versionDescriptor = Object.getOwnPropertyDescriptor(value, 'store_version');
  if (
    !versionDescriptor
    || !Object.hasOwn(versionDescriptor, 'value')
    || versionDescriptor.value !== expectedVersion
  ) fail('builder_agent_delegation_result_parent_materialization_service_invalid');
  const selected = { store_version: expectedVersion };
  for (const method of methods) selected[method] = storeMethod(value, method);
  return freezeDeep(selected);
}

function safeStores(rawStores) {
  exactObject(rawStores, SERVICE_KEYS);
  return freezeDeep({
    eligibility_store: safeStore(
      valueAt(rawStores, 'eligibility_store'),
      BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_STORE_VERSION,
      [
        'read_eligibility',
        'list_parent_task_eligibilities',
        'list_child_task_eligibilities',
      ],
    ),
    materialization_store: safeStore(
      valueAt(rawStores, 'materialization_store'),
      BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_STORE_VERSION,
      [
        'record_materialization',
        'read_materialization',
        'read_materialization_for_eligibility',
        'list_parent_task_materializations',
        'list_child_task_materializations',
      ],
    ),
  });
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentDelegationResultParentMaterializationServiceError) {
    return new BuilderAgentDelegationResultParentMaterializationServiceError(error.code);
  }
  if (error instanceof BuilderAgentDelegationResultParentMaterializationError) {
    return new BuilderAgentDelegationResultParentMaterializationServiceError(
      'builder_agent_delegation_result_parent_materialization_service_invalid',
    );
  }
  if (
    error instanceof BuilderAgentDelegationResultParentMaterializationEligibilityStoreError
    || error instanceof BuilderAgentDelegationResultParentMaterializationStoreError
  ) {
    if (/_conflict$/u.test(error.code) || /_not_found$/u.test(error.code)) {
      return new BuilderAgentDelegationResultParentMaterializationServiceError(
        'builder_agent_delegation_result_parent_materialization_service_conflict',
      );
    }
    if (/_unavailable$/u.test(error.code)) {
      return new BuilderAgentDelegationResultParentMaterializationServiceError(
        'builder_agent_delegation_result_parent_materialization_service_unavailable',
      );
    }
    return new BuilderAgentDelegationResultParentMaterializationServiceError(
      'builder_agent_delegation_result_parent_materialization_service_invalid',
    );
  }
  return new BuilderAgentDelegationResultParentMaterializationServiceError(
    'builder_agent_delegation_result_parent_materialization_service_unavailable',
  );
}

function serviceEvidence() {
  return freezeDeep({
    service_authority: 'main_owned_agent_delegation_result_parent_materialization_service',
    eligibility_store_authority:
      'main_owned_agent_delegation_result_parent_materialization_eligibility_store',
    materialization_store_authority:
      'main_owned_agent_delegation_result_parent_materialization_store',
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
    review_authority: 'local_decision_receipt_only',
    review_row_authority: false,
    artifact_authority: false,
    parent_context_authority: 'local_parent_task_context_receipt_only',
    parent_materialization_authority: 'receipt_only',
    parent_source_mutation_authority: false,
    recovery_model: 'idempotent_store_replay',
  });
}

function readRecordedEligibilityFact(stores, ownerId, eligibilityId) {
  const eligibilityRead = stores.eligibility_store.read_eligibility({
    delegation_result_parent_materialization_eligibility_id: eligibilityId,
    owner_id: ownerId,
  });
  if (
    eligibilityRead.status !== 'ready'
    || !eligibilityRead.delegation_result_parent_materialization_eligibility
    || !eligibilityRead.delegation_result_parent_materialization_eligibility.delegation
    || !eligibilityRead.delegation_result_parent_materialization_eligibility.result
    || !eligibilityRead.delegation_result_parent_materialization_eligibility.admission
    || !eligibilityRead.delegation_result_parent_materialization_eligibility.review
    || !eligibilityRead.delegation_result_parent_materialization_eligibility.eligibility
    || eligibilityRead.delegation_result_parent_materialization_eligibility
      .eligibility.delegation_result_parent_materialization_eligibility_id !== eligibilityId
    || eligibilityRead.delegation_result_parent_materialization_eligibility
      .eligibility.owner_id !== ownerId
  ) fail('builder_agent_delegation_result_parent_materialization_service_conflict');
  const eligibility =
    eligibilityRead.delegation_result_parent_materialization_eligibility.eligibility;
  const parentTaskEligibilities = stores.eligibility_store.list_parent_task_eligibilities({
    owner_id: ownerId,
    project_id: eligibility.project_id,
    parent_task_id: eligibility.parent_task_id,
  });
  if (
    parentTaskEligibilities.status !== 'ready'
    || !parentTaskEligibilities.delegation_result_parent_materialization_eligibilities.some(
      (entry) => entry.eligibility.delegation_result_parent_materialization_eligibility_id
        === eligibilityId,
    )
  ) fail('builder_agent_delegation_result_parent_materialization_service_invalid');
  const childTaskEligibilities = stores.eligibility_store.list_child_task_eligibilities({
    owner_id: ownerId,
    project_id: eligibility.project_id,
    child_task_id: eligibility.child_task_id,
  });
  if (
    childTaskEligibilities.status !== 'ready'
    || !childTaskEligibilities.delegation_result_parent_materialization_eligibilities.some(
      (entry) => entry.eligibility.delegation_result_parent_materialization_eligibility_id
        === eligibilityId,
    )
  ) fail('builder_agent_delegation_result_parent_materialization_service_invalid');
  return freezeDeep({
    eligibility_read: eligibilityRead,
    parent_task_eligibilities: parentTaskEligibilities,
    child_task_eligibilities: childTaskEligibilities,
  });
}

function recordDelegationResultParentMaterialization(stores, rawRequest) {
  exactObject(rawRequest, RECORD_MATERIALIZATION_KEYS);
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const eligibilityId = safeEligibilityId(
    valueAt(rawRequest, 'delegation_result_parent_materialization_eligibility_id'),
  );
  const nowMs = safeTimestamp(valueAt(rawRequest, 'now_ms'));
  const eligibilityEvidence = readRecordedEligibilityFact(stores, ownerId, eligibilityId);
  const eligibilityFact =
    eligibilityEvidence.eligibility_read.delegation_result_parent_materialization_eligibility;
  const delegation = eligibilityFact.delegation;
  const result = eligibilityFact.result;
  const admission = eligibilityFact.admission;
  const review = eligibilityFact.review;
  const eligibility = eligibilityFact.eligibility;
  const materialization = createBuilderAgentDelegationResultParentMaterializationRecord(
    valueAt(rawRequest, 'materialization_input'),
    eligibility,
    review,
    admission,
    result,
    delegation,
  );
  if (
    materialization.owner_id !== ownerId
    || materialization.delegation_result_parent_materialization_eligibility_id !== eligibilityId
    || materialization.materialized_by !== ownerId
    || materialization.materialized_at_ms !== nowMs
  ) fail('builder_agent_delegation_result_parent_materialization_service_invalid');

  const materializationWrite = stores.materialization_store.record_materialization({
    delegation,
    result,
    admission,
    review,
    eligibility,
    materialization,
  });
  const materializationRead = stores.materialization_store.read_materialization({
    delegation_result_parent_materialization_id:
      materialization.delegation_result_parent_materialization_id,
    owner_id: ownerId,
  });
  if (
    materializationRead.status !== 'ready'
    || !materializationRead.delegation_result_parent_materialization
    || materializationRead.delegation_result_parent_materialization
      .materialization.delegation_result_parent_materialization_id
        !== materialization.delegation_result_parent_materialization_id
  ) fail('builder_agent_delegation_result_parent_materialization_service_invalid');
  const materializationForEligibility =
    stores.materialization_store.read_materialization_for_eligibility({
      delegation_result_parent_materialization_eligibility_id: eligibilityId,
      owner_id: ownerId,
    });
  if (
    materializationForEligibility.status !== 'ready'
    || !materializationForEligibility.delegation_result_parent_materialization
    || materializationForEligibility.delegation_result_parent_materialization
      .materialization.delegation_result_parent_materialization_id
        !== materialization.delegation_result_parent_materialization_id
  ) fail('builder_agent_delegation_result_parent_materialization_service_invalid');
  const parentTaskMaterializations = stores.materialization_store.list_parent_task_materializations({
    owner_id: ownerId,
    project_id: materialization.project_id,
    parent_task_id: materialization.parent_task_id,
  });
  if (
    parentTaskMaterializations.status !== 'ready'
    || !parentTaskMaterializations.delegation_result_parent_materializations.some(
      (entry) => entry.materialization.delegation_result_parent_materialization_id
        === materialization.delegation_result_parent_materialization_id,
    )
  ) fail('builder_agent_delegation_result_parent_materialization_service_invalid');
  const childTaskMaterializations = stores.materialization_store.list_child_task_materializations({
    owner_id: ownerId,
    project_id: materialization.project_id,
    child_task_id: materialization.child_task_id,
  });
  if (
    childTaskMaterializations.status !== 'ready'
    || !childTaskMaterializations.delegation_result_parent_materializations.some(
      (entry) => entry.materialization.delegation_result_parent_materialization_id
        === materialization.delegation_result_parent_materialization_id,
    )
  ) fail('builder_agent_delegation_result_parent_materialization_service_invalid');

  return freezeDeep({
    result_version:
      BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_SERVICE_RESULT_VERSION,
    service_version: BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_SERVICE_VERSION,
    operation: 'agent_delegation_result_parent_materialization_recorded',
    status: 'ready',
    result_status: materialization.result.status,
    decision: materialization.decision,
    eligibility_status: materialization.eligibility_status,
    parent_context_status: materialization.parent_context_status,
    delegation_result_parent_materialization: materialization,
    eligibility_read: eligibilityEvidence.eligibility_read,
    parent_task_eligibilities: eligibilityEvidence.parent_task_eligibilities,
    child_task_eligibilities: eligibilityEvidence.child_task_eligibilities,
    materialization_write: materializationWrite,
    materialization_read: materializationRead,
    materialization_for_eligibility: materializationForEligibility,
    parent_task_materializations: parentTaskMaterializations,
    child_task_materializations: childTaskMaterializations,
    operations: {
      materialization_store: materializationWrite.operation,
    },
    evidence: serviceEvidence(),
  });
}

function createBuilderAgentDelegationResultParentMaterializationService(rawStores) {
  const stores = safeStores(rawStores);
  return freezeDeep({
    service_version: BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_SERVICE_VERSION,

    record_delegation_result_parent_materialization(rawRequest) {
      try {
        return recordDelegationResultParentMaterialization(stores, rawRequest);
      } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_SERVICE_VERSION,
  BuilderAgentDelegationResultParentMaterializationServiceError,
  createBuilderAgentDelegationResultParentMaterializationService,
});
