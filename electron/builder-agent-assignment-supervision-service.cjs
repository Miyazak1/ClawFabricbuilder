'use strict';

const { types: utilTypes } = require('node:util');

const {
  BuilderAgentAssignmentContractError,
  createBuilderAgentAssignmentStatusRecord,
} = require('./builder-agent-assignment-contract.cjs');
const {
  BUILDER_AGENT_ASSIGNMENT_STORE_VERSION,
  BuilderAgentAssignmentStoreError,
} = require('./builder-agent-assignment-store.cjs');
const {
  BuilderAgentSupervisionLeaseContractError,
  createBuilderAgentSupervisionLeaseRecord,
} = require('./builder-agent-supervision-lease-contract.cjs');
const {
  BUILDER_AGENT_SUPERVISION_LEASE_STORE_VERSION,
  BuilderAgentSupervisionLeaseStoreError,
} = require('./builder-agent-supervision-lease-store.cjs');

const BUILDER_AGENT_ASSIGNMENT_SUPERVISION_SERVICE_VERSION =
  'builder-agent-assignment-supervision-service.v1';
const BUILDER_AGENT_ASSIGNMENT_SUPERVISION_SERVICE_RESULT_VERSION =
  'builder-agent-assignment-supervision-service-result.v1';
const SERVICE_KEYS = Object.freeze(['assignment_store', 'lease_store']);
const ACTIVATE_KEYS = Object.freeze(['assignment', 'active_status_input', 'lease_input', 'now_ms']);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_assignment_supervision_service_invalid:
    'Builder agent assignment supervision could not be verified.',
  builder_agent_assignment_supervision_service_conflict:
    'Builder agent assignment supervision changed before it could be recorded.',
  builder_agent_assignment_supervision_service_unavailable:
    'Builder agent assignment supervision service is unavailable.',
});

class BuilderAgentAssignmentSupervisionServiceError extends Error {
  constructor(code = 'builder_agent_assignment_supervision_service_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_assignment_supervision_service_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentAssignmentSupervisionServiceError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentAssignmentSupervisionServiceError(code);
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
  if (!isPlainObject(value)) fail('builder_agent_assignment_supervision_service_invalid');
  const own = Object.keys(value);
  if (own.length !== keys.length) fail('builder_agent_assignment_supervision_service_invalid');
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) fail('builder_agent_assignment_supervision_service_invalid');
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_assignment_supervision_service_invalid');
  }
  return descriptor.value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('builder_agent_assignment_supervision_service_invalid');
  }
  return value;
}

function storeMethod(store, name) {
  const descriptor = Object.getOwnPropertyDescriptor(store, name);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
    fail('builder_agent_assignment_supervision_service_invalid');
  }
  return descriptor.value.bind(store);
}

function safeStore(value, expectedVersion, methods) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) {
    fail('builder_agent_assignment_supervision_service_invalid');
  }
  const versionDescriptor = Object.getOwnPropertyDescriptor(value, 'store_version');
  if (
    !versionDescriptor
    || !Object.hasOwn(versionDescriptor, 'value')
    || versionDescriptor.value !== expectedVersion
  ) fail('builder_agent_assignment_supervision_service_invalid');
  const selected = { store_version: expectedVersion };
  for (const method of methods) selected[method] = storeMethod(value, method);
  return freezeDeep(selected);
}

function safeStores(rawStores) {
  exactObject(rawStores, SERVICE_KEYS);
  return freezeDeep({
    assignment_store: safeStore(
      valueAt(rawStores, 'assignment_store'),
      BUILDER_AGENT_ASSIGNMENT_STORE_VERSION,
      ['record_status', 'read_assignment'],
    ),
    lease_store: safeStore(
      valueAt(rawStores, 'lease_store'),
      BUILDER_AGENT_SUPERVISION_LEASE_STORE_VERSION,
      ['record_lease', 'read_assignment_leases'],
    ),
  });
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentAssignmentSupervisionServiceError) {
    return new BuilderAgentAssignmentSupervisionServiceError(error.code);
  }
  if (
    error instanceof BuilderAgentAssignmentContractError
    || error instanceof BuilderAgentSupervisionLeaseContractError
  ) {
    return new BuilderAgentAssignmentSupervisionServiceError(
      'builder_agent_assignment_supervision_service_invalid',
    );
  }
  if (
    error instanceof BuilderAgentAssignmentStoreError
    || error instanceof BuilderAgentSupervisionLeaseStoreError
  ) {
    if (/_conflict$/u.test(error.code)) {
      return new BuilderAgentAssignmentSupervisionServiceError(
        'builder_agent_assignment_supervision_service_conflict',
      );
    }
    if (/_unavailable$/u.test(error.code)) {
      return new BuilderAgentAssignmentSupervisionServiceError(
        'builder_agent_assignment_supervision_service_unavailable',
      );
    }
    return new BuilderAgentAssignmentSupervisionServiceError(
      'builder_agent_assignment_supervision_service_invalid',
    );
  }
  return new BuilderAgentAssignmentSupervisionServiceError(
    'builder_agent_assignment_supervision_service_unavailable',
  );
}

function serviceEvidence() {
  return freezeDeep({
    service_authority: 'main_owned_agent_assignment_supervision_service',
    assignment_store_authority: 'main_owned_agent_assignment_store',
    lease_store_authority: 'main_owned_agent_supervision_lease_store',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    tool_dispatch: false,
    run_authority: false,
    permission_grant_authority: false,
    credential_storage: 'not_present',
    source_access: 'not_present',
    revision_authority: false,
    review_authority: false,
    artifact_authority: false,
    recovery_model: 'idempotent_store_replay',
  });
}

function activateAssignment(stores, rawRequest) {
  exactObject(rawRequest, ACTIVATE_KEYS);
  const assignment = valueAt(rawRequest, 'assignment');
  const nowMs = safeTimestamp(valueAt(rawRequest, 'now_ms'));
  const activeStatus = createBuilderAgentAssignmentStatusRecord(
    valueAt(rawRequest, 'active_status_input'),
    assignment,
  );
  if (activeStatus.next_status !== 'active') {
    fail('builder_agent_assignment_supervision_service_invalid');
  }
  const preflightAssignmentRead = stores.assignment_store.read_assignment({
    assignment_id: activeStatus.assignment_id,
    owner_id: activeStatus.owner_id,
  });
  if (
    preflightAssignmentRead.status !== 'ready'
    || preflightAssignmentRead.assignment.assignment_id !== activeStatus.assignment_id
    || (
      preflightAssignmentRead.current_status !== 'queued'
      && preflightAssignmentRead.current_status !== 'active'
    )
  ) fail('builder_agent_assignment_supervision_service_conflict');
  const lease = createBuilderAgentSupervisionLeaseRecord(
    valueAt(rawRequest, 'lease_input'),
    preflightAssignmentRead.assignment,
    activeStatus,
  );
  if (nowMs < lease.acquired_at_ms || nowMs >= lease.expires_at_ms) {
    fail('builder_agent_assignment_supervision_service_invalid');
  }
  const statusResult = stores.assignment_store.record_status({ status: activeStatus });
  const assignmentRead = stores.assignment_store.read_assignment({
    assignment_id: activeStatus.assignment_id,
    owner_id: activeStatus.owner_id,
  });
  if (
    assignmentRead.status !== 'ready'
    || assignmentRead.current_status !== 'active'
    || assignmentRead.assignment.assignment_id !== activeStatus.assignment_id
  ) fail('builder_agent_assignment_supervision_service_invalid');

  const leaseResult = stores.lease_store.record_lease({
    assignment: assignmentRead.assignment,
    status: activeStatus,
    lease,
  });
  const leaseRead = stores.lease_store.read_assignment_leases({
    assignment_id: lease.assignment_id,
    owner_id: lease.owner_id,
    now_ms: nowMs,
  });
  if (
    leaseRead.status !== 'ready'
    || leaseRead.active_lease === null
    || leaseRead.active_lease.lease.lease_id !== lease.lease_id
  ) fail('builder_agent_assignment_supervision_service_invalid');

  return freezeDeep({
    result_version: BUILDER_AGENT_ASSIGNMENT_SUPERVISION_SERVICE_RESULT_VERSION,
    service_version: BUILDER_AGENT_ASSIGNMENT_SUPERVISION_SERVICE_VERSION,
    operation: 'assignment_supervision_started',
    status: 'ready',
    assignment_read: assignmentRead,
    active_status: activeStatus,
    lease,
    lease_read: leaseRead,
    operations: {
      assignment_status_store: statusResult.operation,
      lease_store: leaseResult.operation,
    },
    evidence: serviceEvidence(),
  });
}

function createBuilderAgentAssignmentSupervisionService(rawStores) {
  const stores = safeStores(rawStores);
  return freezeDeep({
    service_version: BUILDER_AGENT_ASSIGNMENT_SUPERVISION_SERVICE_VERSION,

    activate_assignment(rawRequest) {
      try { return activateAssignment(stores, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_ASSIGNMENT_SUPERVISION_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_ASSIGNMENT_SUPERVISION_SERVICE_VERSION,
  BuilderAgentAssignmentSupervisionServiceError,
  createBuilderAgentAssignmentSupervisionService,
});
