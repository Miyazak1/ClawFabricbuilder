'use strict';

const { types: utilTypes } = require('node:util');

const {
  BuilderAgentDelegationResultContractError,
  createBuilderAgentDelegationResultRecord,
} = require('./builder-agent-delegation-result-contract.cjs');
const {
  BUILDER_AGENT_DELEGATION_STORE_VERSION,
  BuilderAgentDelegationStoreError,
} = require('./builder-agent-delegation-store.cjs');
const {
  BUILDER_AGENT_DELEGATION_RESULT_STORE_VERSION,
  BuilderAgentDelegationResultStoreError,
} = require('./builder-agent-delegation-result-store.cjs');

const BUILDER_AGENT_DELEGATION_RESULT_SERVICE_VERSION =
  'builder-agent-delegation-result-service.v1';
const BUILDER_AGENT_DELEGATION_RESULT_SERVICE_RESULT_VERSION =
  'builder-agent-delegation-result-service-result.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const DELEGATION_ID_PATTERN = /^builder-agent-delegation:[0-9a-f]{64}$/u;
const SERVICE_KEYS = Object.freeze(['delegation_store', 'result_store']);
const RECORD_RESULT_KEYS = Object.freeze([
  'owner_id',
  'delegation_id',
  'result_input',
  'now_ms',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_delegation_result_service_invalid:
    'Builder agent delegation result could not be verified.',
  builder_agent_delegation_result_service_conflict:
    'Builder agent delegation result changed before it could be recorded.',
  builder_agent_delegation_result_service_unavailable:
    'Builder agent delegation result service is unavailable.',
});

class BuilderAgentDelegationResultServiceError extends Error {
  constructor(code = 'builder_agent_delegation_result_service_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_delegation_result_service_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentDelegationResultServiceError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentDelegationResultServiceError(code);
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
  if (!isPlainObject(value)) fail('builder_agent_delegation_result_service_invalid');
  const own = Object.keys(value);
  if (own.length !== keys.length) fail('builder_agent_delegation_result_service_invalid');
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) fail('builder_agent_delegation_result_service_invalid');
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_delegation_result_service_invalid');
  }
  return descriptor.value;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    fail('builder_agent_delegation_result_service_invalid');
  }
  return value;
}

function safeOwnerId(value) {
  return safePattern(value, OWNER_ID_PATTERN);
}

function safeDelegationId(value) {
  return safePattern(value, DELEGATION_ID_PATTERN);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('builder_agent_delegation_result_service_invalid');
  }
  return value;
}

function storeMethod(store, name) {
  const descriptor = Object.getOwnPropertyDescriptor(store, name);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
    fail('builder_agent_delegation_result_service_invalid');
  }
  return descriptor.value.bind(store);
}

function safeStore(value, expectedVersion, methods) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) {
    fail('builder_agent_delegation_result_service_invalid');
  }
  const versionDescriptor = Object.getOwnPropertyDescriptor(value, 'store_version');
  if (
    !versionDescriptor
    || !Object.hasOwn(versionDescriptor, 'value')
    || versionDescriptor.value !== expectedVersion
  ) fail('builder_agent_delegation_result_service_invalid');
  const selected = { store_version: expectedVersion };
  for (const method of methods) selected[method] = storeMethod(value, method);
  return freezeDeep(selected);
}

function safeStores(rawStores) {
  exactObject(rawStores, SERVICE_KEYS);
  return freezeDeep({
    delegation_store: safeStore(
      valueAt(rawStores, 'delegation_store'),
      BUILDER_AGENT_DELEGATION_STORE_VERSION,
      ['read_delegation', 'list_parent_task_delegations', 'list_child_task_delegations'],
    ),
    result_store: safeStore(
      valueAt(rawStores, 'result_store'),
      BUILDER_AGENT_DELEGATION_RESULT_STORE_VERSION,
      ['record_result', 'read_result', 'list_parent_task_results', 'list_child_task_results'],
    ),
  });
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentDelegationResultServiceError) {
    return new BuilderAgentDelegationResultServiceError(error.code);
  }
  if (error instanceof BuilderAgentDelegationResultContractError) {
    return new BuilderAgentDelegationResultServiceError(
      'builder_agent_delegation_result_service_invalid',
    );
  }
  if (
    error instanceof BuilderAgentDelegationStoreError
    || error instanceof BuilderAgentDelegationResultStoreError
  ) {
    if (/_conflict$/u.test(error.code) || /_not_found$/u.test(error.code)) {
      return new BuilderAgentDelegationResultServiceError(
        'builder_agent_delegation_result_service_conflict',
      );
    }
    if (/_unavailable$/u.test(error.code)) {
      return new BuilderAgentDelegationResultServiceError(
        'builder_agent_delegation_result_service_unavailable',
      );
    }
    return new BuilderAgentDelegationResultServiceError(
      'builder_agent_delegation_result_service_invalid',
    );
  }
  return new BuilderAgentDelegationResultServiceError(
    'builder_agent_delegation_result_service_unavailable',
  );
}

function serviceEvidence() {
  return freezeDeep({
    service_authority: 'main_owned_agent_delegation_result_service',
    delegation_store_authority: 'main_owned_agent_delegation_store',
    result_store_authority: 'main_owned_agent_delegation_result_store',
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

function readRecordedDelegationFact(stores, ownerId, delegationId) {
  const delegationRead = stores.delegation_store.read_delegation({
    delegation_id: delegationId,
    owner_id: ownerId,
  });
  if (
    delegationRead.status !== 'ready'
    || !delegationRead.delegation
    || !delegationRead.delegation.delegation
    || delegationRead.delegation.delegation.delegation_id !== delegationId
    || delegationRead.delegation.delegation.owner_id !== ownerId
  ) fail('builder_agent_delegation_result_service_conflict');
  const delegation = delegationRead.delegation.delegation;
  const parentTaskDelegations = stores.delegation_store.list_parent_task_delegations({
    owner_id: ownerId,
    project_id: delegation.project_id,
    parent_task_id: delegation.parent_task_id,
  });
  if (
    parentTaskDelegations.status !== 'ready'
    || !parentTaskDelegations.delegations.some(
      (entry) => entry.delegation.delegation_id === delegationId,
    )
  ) fail('builder_agent_delegation_result_service_invalid');
  const childTaskDelegations = stores.delegation_store.list_child_task_delegations({
    owner_id: ownerId,
    project_id: delegation.project_id,
    child_task_id: delegation.child_task_id,
  });
  if (
    childTaskDelegations.status !== 'ready'
    || !childTaskDelegations.delegations.some(
      (entry) => entry.delegation.delegation_id === delegationId,
    )
  ) fail('builder_agent_delegation_result_service_invalid');
  return freezeDeep({ delegation_read: delegationRead, parent_task_delegations: parentTaskDelegations, child_task_delegations: childTaskDelegations });
}

function recordDelegationResult(stores, rawRequest) {
  exactObject(rawRequest, RECORD_RESULT_KEYS);
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const delegationId = safeDelegationId(valueAt(rawRequest, 'delegation_id'));
  const nowMs = safeTimestamp(valueAt(rawRequest, 'now_ms'));
  const delegationEvidence = readRecordedDelegationFact(stores, ownerId, delegationId);
  const delegation = delegationEvidence.delegation_read.delegation.delegation;
  const result = createBuilderAgentDelegationResultRecord(
    valueAt(rawRequest, 'result_input'),
    delegation,
  );
  if (
    result.owner_id !== ownerId
    || result.delegation_id !== delegationId
    || result.observed_at_ms !== nowMs
  ) fail('builder_agent_delegation_result_service_invalid');

  const resultWrite = stores.result_store.record_result({ delegation, result });
  const resultRead = stores.result_store.read_result({
    delegation_result_id: result.delegation_result_id,
    owner_id: ownerId,
  });
  if (
    resultRead.status !== 'ready'
    || !resultRead.delegation_result
    || resultRead.delegation_result.result.delegation_result_id !== result.delegation_result_id
  ) fail('builder_agent_delegation_result_service_invalid');
  const parentTaskResults = stores.result_store.list_parent_task_results({
    owner_id: ownerId,
    project_id: result.project_id,
    parent_task_id: result.parent_task_id,
  });
  if (
    parentTaskResults.status !== 'ready'
    || !parentTaskResults.delegation_results.some(
      (entry) => entry.result.delegation_result_id === result.delegation_result_id,
    )
  ) fail('builder_agent_delegation_result_service_invalid');
  const childTaskResults = stores.result_store.list_child_task_results({
    owner_id: ownerId,
    project_id: result.project_id,
    child_task_id: result.child_task_id,
  });
  if (
    childTaskResults.status !== 'ready'
    || !childTaskResults.delegation_results.some(
      (entry) => entry.result.delegation_result_id === result.delegation_result_id,
    )
  ) fail('builder_agent_delegation_result_service_invalid');

  return freezeDeep({
    result_version: BUILDER_AGENT_DELEGATION_RESULT_SERVICE_RESULT_VERSION,
    service_version: BUILDER_AGENT_DELEGATION_RESULT_SERVICE_VERSION,
    operation: 'agent_delegation_result_recorded',
    status: 'ready',
    result_status: result.result.status,
    delegation_result: result,
    delegation_read: delegationEvidence.delegation_read,
    parent_task_delegations: delegationEvidence.parent_task_delegations,
    child_task_delegations: delegationEvidence.child_task_delegations,
    result_write: resultWrite,
    result_read: resultRead,
    parent_task_results: parentTaskResults,
    child_task_results: childTaskResults,
    operations: {
      result_store: resultWrite.operation,
    },
    evidence: serviceEvidence(),
  });
}

function createBuilderAgentDelegationResultService(rawStores) {
  const stores = safeStores(rawStores);
  return freezeDeep({
    service_version: BUILDER_AGENT_DELEGATION_RESULT_SERVICE_VERSION,

    record_delegation_result(rawRequest) {
      try { return recordDelegationResult(stores, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_DELEGATION_RESULT_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_DELEGATION_RESULT_SERVICE_VERSION,
  BuilderAgentDelegationResultServiceError,
  createBuilderAgentDelegationResultService,
});
