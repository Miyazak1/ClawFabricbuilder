'use strict';

const { types: utilTypes } = require('node:util');

const {
  BuilderAgentDefinitionContractError,
} = require('./builder-agent-definition-contract.cjs');
const {
  BUILDER_AGENT_DEFINITION_STORE_VERSION,
  BuilderAgentDefinitionStoreError,
} = require('./builder-agent-definition-store.cjs');
const {
  BuilderAgentAssignmentContractError,
} = require('./builder-agent-assignment-contract.cjs');
const {
  BUILDER_AGENT_ASSIGNMENT_STORE_VERSION,
  BuilderAgentAssignmentStoreError,
} = require('./builder-agent-assignment-store.cjs');
const {
  BuilderAgentSupervisionLeaseContractError,
} = require('./builder-agent-supervision-lease-contract.cjs');
const {
  BUILDER_AGENT_SUPERVISION_LEASE_STORE_VERSION,
  BuilderAgentSupervisionLeaseStoreError,
} = require('./builder-agent-supervision-lease-store.cjs');
const {
  BuilderAgentDelegationContractError,
  createBuilderAgentDelegationRecord,
} = require('./builder-agent-delegation-contract.cjs');
const {
  BUILDER_AGENT_DELEGATION_STORE_VERSION,
  BuilderAgentDelegationStoreError,
} = require('./builder-agent-delegation-store.cjs');

const BUILDER_AGENT_DELEGATION_SERVICE_VERSION = 'builder-agent-delegation-service.v1';
const BUILDER_AGENT_DELEGATION_SERVICE_RESULT_VERSION =
  'builder-agent-delegation-service-result.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const AGENT_ID_PATTERN = new RegExp(`^builder-agent:${UUID_SOURCE}$`, 'u');
const ASSIGNMENT_ID_PATTERN = /^builder-agent-assignment:[0-9a-f]{64}$/u;
const SERVICE_KEYS = Object.freeze([
  'definition_store',
  'assignment_store',
  'lease_store',
  'delegation_store',
]);
const RECORD_DELEGATION_KEYS = Object.freeze([
  'owner_id',
  'parent_assignment_id',
  'target_agent_id',
  'delegation_input',
  'now_ms',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_delegation_service_invalid: 'Builder agent delegation could not be verified.',
  builder_agent_delegation_service_conflict:
    'Builder agent delegation changed before it could be recorded.',
  builder_agent_delegation_service_unavailable: 'Builder agent delegation service is unavailable.',
});

class BuilderAgentDelegationServiceError extends Error {
  constructor(code = 'builder_agent_delegation_service_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_delegation_service_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentDelegationServiceError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentDelegationServiceError(code);
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
  if (!isPlainObject(value)) fail('builder_agent_delegation_service_invalid');
  const own = Object.keys(value);
  if (own.length !== keys.length) fail('builder_agent_delegation_service_invalid');
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) fail('builder_agent_delegation_service_invalid');
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_delegation_service_invalid');
  }
  return descriptor.value;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    fail('builder_agent_delegation_service_invalid');
  }
  return value;
}

function safeOwnerId(value) {
  return safePattern(value, OWNER_ID_PATTERN);
}

function safeAgentId(value) {
  return safePattern(value, AGENT_ID_PATTERN);
}

function safeAssignmentId(value) {
  return safePattern(value, ASSIGNMENT_ID_PATTERN);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('builder_agent_delegation_service_invalid');
  }
  return value;
}

function storeMethod(store, name) {
  const descriptor = Object.getOwnPropertyDescriptor(store, name);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
    fail('builder_agent_delegation_service_invalid');
  }
  return descriptor.value.bind(store);
}

function safeStore(value, expectedVersion, methods) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) {
    fail('builder_agent_delegation_service_invalid');
  }
  const versionDescriptor = Object.getOwnPropertyDescriptor(value, 'store_version');
  if (
    !versionDescriptor
    || !Object.hasOwn(versionDescriptor, 'value')
    || versionDescriptor.value !== expectedVersion
  ) fail('builder_agent_delegation_service_invalid');
  const selected = { store_version: expectedVersion };
  for (const method of methods) selected[method] = storeMethod(value, method);
  return freezeDeep(selected);
}

function safeStores(rawStores) {
  exactObject(rawStores, SERVICE_KEYS);
  return freezeDeep({
    definition_store: safeStore(
      valueAt(rawStores, 'definition_store'),
      BUILDER_AGENT_DEFINITION_STORE_VERSION,
      ['read_agent'],
    ),
    assignment_store: safeStore(
      valueAt(rawStores, 'assignment_store'),
      BUILDER_AGENT_ASSIGNMENT_STORE_VERSION,
      ['read_assignment', 'list_task_assignments'],
    ),
    lease_store: safeStore(
      valueAt(rawStores, 'lease_store'),
      BUILDER_AGENT_SUPERVISION_LEASE_STORE_VERSION,
      ['read_assignment_leases'],
    ),
    delegation_store: safeStore(
      valueAt(rawStores, 'delegation_store'),
      BUILDER_AGENT_DELEGATION_STORE_VERSION,
      ['record_delegation', 'read_delegation', 'list_parent_task_delegations', 'list_child_task_delegations'],
    ),
  });
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentDelegationServiceError) {
    return new BuilderAgentDelegationServiceError(error.code);
  }
  if (
    error instanceof BuilderAgentDefinitionContractError
    || error instanceof BuilderAgentAssignmentContractError
    || error instanceof BuilderAgentSupervisionLeaseContractError
    || error instanceof BuilderAgentDelegationContractError
  ) {
    return new BuilderAgentDelegationServiceError('builder_agent_delegation_service_invalid');
  }
  if (
    error instanceof BuilderAgentDefinitionStoreError
    || error instanceof BuilderAgentAssignmentStoreError
    || error instanceof BuilderAgentSupervisionLeaseStoreError
    || error instanceof BuilderAgentDelegationStoreError
  ) {
    if (/_conflict$/u.test(error.code) || /_not_found$/u.test(error.code)) {
      return new BuilderAgentDelegationServiceError('builder_agent_delegation_service_conflict');
    }
    if (/_unavailable$/u.test(error.code)) {
      return new BuilderAgentDelegationServiceError('builder_agent_delegation_service_unavailable');
    }
    return new BuilderAgentDelegationServiceError('builder_agent_delegation_service_invalid');
  }
  return new BuilderAgentDelegationServiceError('builder_agent_delegation_service_unavailable');
}

function serviceEvidence() {
  return freezeDeep({
    service_authority: 'main_owned_agent_delegation_service',
    definition_store_authority: 'main_owned_agent_definition_store',
    assignment_store_authority: 'main_owned_agent_assignment_store',
    lease_store_authority: 'main_owned_agent_supervision_lease_store',
    delegation_store_authority: 'main_owned_agent_delegation_store',
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
    review_authority: false,
    artifact_authority: false,
    recovery_model: 'idempotent_store_replay',
  });
}

function readParentAssignmentFact(stores, ownerId, parentAssignmentId) {
  const assignmentRead = stores.assignment_store.read_assignment({
    assignment_id: parentAssignmentId,
    owner_id: ownerId,
  });
  if (
    assignmentRead.status !== 'ready'
    || !assignmentRead.assignment
    || assignmentRead.current_status !== 'active'
  ) fail('builder_agent_delegation_service_conflict');
  const activeStatus = assignmentRead.statuses.at(-1) ?? null;
  if (!activeStatus || activeStatus.next_status !== 'active') {
    fail('builder_agent_delegation_service_conflict');
  }
  const taskAssignments = stores.assignment_store.list_task_assignments({
    owner_id: ownerId,
    project_id: assignmentRead.assignment.project_id,
    task_id: assignmentRead.assignment.task_id,
  });
  if (
    taskAssignments.status !== 'ready'
    || !taskAssignments.assignments.some(
      (entry) => entry.assignment.assignment_id === parentAssignmentId
        && entry.current_status === 'active',
    )
  ) fail('builder_agent_delegation_service_invalid');
  return freezeDeep({ assignment_read: assignmentRead, active_status: activeStatus, task_assignments: taskAssignments });
}

function readActiveLeaseFact(stores, ownerId, parentAssignment, activeStatus, nowMs) {
  const assignmentLeases = stores.lease_store.read_assignment_leases({
    assignment_id: parentAssignment.assignment_id,
    owner_id: ownerId,
    now_ms: nowMs,
  });
  const activeLease = assignmentLeases.active_lease;
  if (
    assignmentLeases.status !== 'ready'
    || !activeLease
    || !activeLease.lease
    || activeLease.release !== null
    || activeLease.lease.assignment_id !== parentAssignment.assignment_id
    || activeLease.lease.assignment_status_id !== activeStatus.assignment_status_id
    || activeLease.lease.owner_id !== ownerId
    || activeLease.lease.project_id !== parentAssignment.project_id
    || activeLease.lease.task_id !== parentAssignment.task_id
    || activeLease.lease.run_id !== parentAssignment.run_id
  ) fail('builder_agent_delegation_service_conflict');
  return assignmentLeases;
}

function readTargetAgentFact(stores, ownerId, targetAgentId) {
  const targetRead = stores.definition_store.read_agent({
    agent_id: targetAgentId,
    owner_id: ownerId,
  });
  if (
    targetRead.status !== 'ready'
    || !targetRead.definition
    || !targetRead.current_version
    || targetRead.current_status !== 'active'
  ) fail('builder_agent_delegation_service_conflict');
  return targetRead;
}

function recordAgentDelegation(stores, rawRequest) {
  exactObject(rawRequest, RECORD_DELEGATION_KEYS);
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const parentAssignmentId = safeAssignmentId(valueAt(rawRequest, 'parent_assignment_id'));
  const targetAgentId = safeAgentId(valueAt(rawRequest, 'target_agent_id'));
  const nowMs = safeTimestamp(valueAt(rawRequest, 'now_ms'));
  const parentEvidence = readParentAssignmentFact(stores, ownerId, parentAssignmentId);
  const assignment = parentEvidence.assignment_read.assignment;
  const activeStatus = parentEvidence.active_status;
  const assignmentLeases = readActiveLeaseFact(stores, ownerId, assignment, activeStatus, nowMs);
  const lease = assignmentLeases.active_lease.lease;
  const targetRead = readTargetAgentFact(stores, ownerId, targetAgentId);
  const delegation = createBuilderAgentDelegationRecord(
    valueAt(rawRequest, 'delegation_input'),
    assignment,
    activeStatus,
    lease,
    targetRead.current_version,
    targetRead.definition,
  );
  if (
    delegation.owner_id !== ownerId
    || delegation.parent_assignment_id !== parentAssignmentId
    || delegation.to_agent_id !== targetAgentId
    || delegation.delegated_at_ms !== nowMs
  ) fail('builder_agent_delegation_service_invalid');

  const delegationWrite = stores.delegation_store.record_delegation({
    assignment,
    status: activeStatus,
    lease,
    target_definition: targetRead.definition,
    target_version: targetRead.current_version,
    delegation,
  });
  const delegationRead = stores.delegation_store.read_delegation({
    delegation_id: delegation.delegation_id,
    owner_id: ownerId,
  });
  if (
    delegationRead.status !== 'ready'
    || !delegationRead.delegation
    || delegationRead.delegation.delegation.delegation_id !== delegation.delegation_id
  ) fail('builder_agent_delegation_service_invalid');
  const parentTaskDelegations = stores.delegation_store.list_parent_task_delegations({
    owner_id: ownerId,
    project_id: delegation.project_id,
    parent_task_id: delegation.parent_task_id,
  });
  if (
    parentTaskDelegations.status !== 'ready'
    || !parentTaskDelegations.delegations.some(
      (entry) => entry.delegation.delegation_id === delegation.delegation_id,
    )
  ) fail('builder_agent_delegation_service_invalid');
  const childTaskDelegations = stores.delegation_store.list_child_task_delegations({
    owner_id: ownerId,
    project_id: delegation.project_id,
    child_task_id: delegation.child_task_id,
  });
  if (
    childTaskDelegations.status !== 'ready'
    || !childTaskDelegations.delegations.some(
      (entry) => entry.delegation.delegation_id === delegation.delegation_id,
    )
  ) fail('builder_agent_delegation_service_invalid');

  return freezeDeep({
    result_version: BUILDER_AGENT_DELEGATION_SERVICE_RESULT_VERSION,
    service_version: BUILDER_AGENT_DELEGATION_SERVICE_VERSION,
    operation: 'agent_delegation_recorded',
    status: 'ready',
    delegation,
    parent_assignment_read: parentEvidence.assignment_read,
    parent_task_assignments: parentEvidence.task_assignments,
    assignment_leases: assignmentLeases,
    target_agent_read: targetRead,
    delegation_write: delegationWrite,
    delegation_read: delegationRead,
    parent_task_delegations: parentTaskDelegations,
    child_task_delegations: childTaskDelegations,
    operations: {
      delegation_store: delegationWrite.operation,
    },
    evidence: serviceEvidence(),
  });
}

function createBuilderAgentDelegationService(rawStores) {
  const stores = safeStores(rawStores);
  return freezeDeep({
    service_version: BUILDER_AGENT_DELEGATION_SERVICE_VERSION,

    record_agent_delegation(rawRequest) {
      try { return recordAgentDelegation(stores, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_DELEGATION_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_DELEGATION_SERVICE_VERSION,
  BuilderAgentDelegationServiceError,
  createBuilderAgentDelegationService,
});
