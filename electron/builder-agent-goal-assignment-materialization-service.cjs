'use strict';

const { types: utilTypes } = require('node:util');

const {
  BuilderAgentDefinitionContractError,
  sanitizeBuilderAgentDefinitionRecord,
  sanitizeBuilderAgentVersionRecord,
} = require('./builder-agent-definition-contract.cjs');
const {
  BuilderAgentGoalContractError,
  sanitizeBuilderAgentGoalRecord,
  sanitizeBuilderAgentGoalStatusRecord,
} = require('./builder-agent-goal-contract.cjs');
const {
  BuilderAgentAssignmentContractError,
  createBuilderAgentAssignmentRecord,
  createBuilderAgentAssignmentStatusRecord,
} = require('./builder-agent-assignment-contract.cjs');
const {
  BUILDER_AGENT_ASSIGNMENT_STORE_VERSION,
  BuilderAgentAssignmentStoreError,
} = require('./builder-agent-assignment-store.cjs');
const {
  createBuilderAgentGoalAssignmentAdmissionRecord,
  BuilderAgentGoalAssignmentAdmissionError,
} = require('./builder-agent-goal-assignment-admission.cjs');
const {
  BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_STORE_VERSION,
  BuilderAgentGoalAssignmentAdmissionStoreError,
} = require('./builder-agent-goal-assignment-admission-store.cjs');
const {
  createBuilderAgentGoalAssignmentMaterializationRecord,
  BuilderAgentGoalAssignmentMaterializationError,
} = require('./builder-agent-goal-assignment-materialization.cjs');
const {
  BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_STORE_VERSION,
  BuilderAgentGoalAssignmentMaterializationStoreError,
} = require('./builder-agent-goal-assignment-materialization-store.cjs');

const BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_SERVICE_VERSION =
  'builder-agent-goal-assignment-materialization-service.v1';
const BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_SERVICE_RESULT_VERSION =
  'builder-agent-goal-assignment-materialization-service-result.v1';
const SERVICE_KEYS = Object.freeze([
  'admission_store',
  'assignment_store',
  'materialization_store',
]);
const MATERIALIZE_KEYS = Object.freeze([
  'definition',
  'version',
  'goal',
  'goal_status',
  'assignment_input',
  'admission_input',
  'assignment_status_input',
  'materialization_input',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_goal_assignment_materialization_service_invalid:
    'Builder agent goal assignment materialization could not be verified.',
  builder_agent_goal_assignment_materialization_service_conflict:
    'Builder agent goal assignment materialization changed before it could be recorded.',
  builder_agent_goal_assignment_materialization_service_unavailable:
    'Builder agent goal assignment materialization service is unavailable.',
});

class BuilderAgentGoalAssignmentMaterializationServiceError extends Error {
  constructor(code = 'builder_agent_goal_assignment_materialization_service_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_goal_assignment_materialization_service_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentGoalAssignmentMaterializationServiceError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentGoalAssignmentMaterializationServiceError(code);
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
  if (!isPlainObject(value)) fail('builder_agent_goal_assignment_materialization_service_invalid');
  const own = Object.keys(value);
  if (own.length !== keys.length) fail('builder_agent_goal_assignment_materialization_service_invalid');
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) fail('builder_agent_goal_assignment_materialization_service_invalid');
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_goal_assignment_materialization_service_invalid');
  }
  return descriptor.value;
}

function storeMethod(store, name) {
  const descriptor = Object.getOwnPropertyDescriptor(store, name);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
    fail('builder_agent_goal_assignment_materialization_service_invalid');
  }
  return descriptor.value.bind(store);
}

function safeStore(value, expectedVersion, methods) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) {
    fail('builder_agent_goal_assignment_materialization_service_invalid');
  }
  const versionDescriptor = Object.getOwnPropertyDescriptor(value, 'store_version');
  if (
    !versionDescriptor
    || !Object.hasOwn(versionDescriptor, 'value')
    || versionDescriptor.value !== expectedVersion
  ) fail('builder_agent_goal_assignment_materialization_service_invalid');
  const selected = { store_version: expectedVersion };
  for (const method of methods) selected[method] = storeMethod(value, method);
  return freezeDeep(selected);
}

function safeStores(rawStores) {
  exactObject(rawStores, SERVICE_KEYS);
  return freezeDeep({
    admission_store: safeStore(
      valueAt(rawStores, 'admission_store'),
      BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_STORE_VERSION,
      ['record_admission'],
    ),
    assignment_store: safeStore(
      valueAt(rawStores, 'assignment_store'),
      BUILDER_AGENT_ASSIGNMENT_STORE_VERSION,
      ['record_assignment', 'record_status', 'read_assignment'],
    ),
    materialization_store: safeStore(
      valueAt(rawStores, 'materialization_store'),
      BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_STORE_VERSION,
      ['record_materialization'],
    ),
  });
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentGoalAssignmentMaterializationServiceError) {
    return new BuilderAgentGoalAssignmentMaterializationServiceError(error.code);
  }
  if (
    error instanceof BuilderAgentDefinitionContractError
    || error instanceof BuilderAgentGoalContractError
    || error instanceof BuilderAgentAssignmentContractError
    || error instanceof BuilderAgentGoalAssignmentAdmissionError
    || error instanceof BuilderAgentGoalAssignmentMaterializationError
  ) {
    return new BuilderAgentGoalAssignmentMaterializationServiceError(
      'builder_agent_goal_assignment_materialization_service_invalid',
    );
  }
  if (
    error instanceof BuilderAgentAssignmentStoreError
    || error instanceof BuilderAgentGoalAssignmentAdmissionStoreError
    || error instanceof BuilderAgentGoalAssignmentMaterializationStoreError
  ) {
    if (/_conflict$/u.test(error.code)) {
      return new BuilderAgentGoalAssignmentMaterializationServiceError(
        'builder_agent_goal_assignment_materialization_service_conflict',
      );
    }
    if (/_unavailable$/u.test(error.code)) {
      return new BuilderAgentGoalAssignmentMaterializationServiceError(
        'builder_agent_goal_assignment_materialization_service_unavailable',
      );
    }
    return new BuilderAgentGoalAssignmentMaterializationServiceError(
      'builder_agent_goal_assignment_materialization_service_invalid',
    );
  }
  return new BuilderAgentGoalAssignmentMaterializationServiceError(
    'builder_agent_goal_assignment_materialization_service_unavailable',
  );
}

function serviceEvidence() {
  return freezeDeep({
    service_authority: 'main_owned_agent_goal_assignment_materialization_service',
    admission_store_authority: 'main_owned_agent_goal_assignment_admission_store',
    assignment_store_authority: 'main_owned_agent_assignment_store',
    materialization_store_authority: 'main_owned_agent_goal_assignment_materialization_store',
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

function materializeGoalAssignment(stores, rawRequest) {
  exactObject(rawRequest, MATERIALIZE_KEYS);
  const definition = sanitizeBuilderAgentDefinitionRecord(valueAt(rawRequest, 'definition'));
  const version = sanitizeBuilderAgentVersionRecord(valueAt(rawRequest, 'version'), definition);
  const goal = sanitizeBuilderAgentGoalRecord(valueAt(rawRequest, 'goal'), version, definition);
  const goalStatus = sanitizeBuilderAgentGoalStatusRecord(valueAt(rawRequest, 'goal_status'), goal);
  if (goalStatus.next_status !== 'active') {
    fail('builder_agent_goal_assignment_materialization_service_invalid');
  }
  const assignment = createBuilderAgentAssignmentRecord(
    valueAt(rawRequest, 'assignment_input'),
    version,
    definition,
  );
  const admission = createBuilderAgentGoalAssignmentAdmissionRecord(
    valueAt(rawRequest, 'admission_input'),
    goal,
    goalStatus,
    assignment,
  );
  const admissionResult = stores.admission_store.record_admission({
    goal,
    goal_status: goalStatus,
    assignment,
    admission,
  });

  const assignmentResult = stores.assignment_store.record_assignment({
    definition,
    version,
    assignment,
  });
  const assignmentStatus = createBuilderAgentAssignmentStatusRecord(
    valueAt(rawRequest, 'assignment_status_input'),
    assignment,
  );
  if (assignmentStatus.next_status !== 'queued') {
    fail('builder_agent_goal_assignment_materialization_service_invalid');
  }
  const statusResult = stores.assignment_store.record_status({ status: assignmentStatus });
  const assignmentRead = stores.assignment_store.read_assignment({
    assignment_id: assignment.assignment_id,
    owner_id: assignment.owner_id,
  });
  const materialization = createBuilderAgentGoalAssignmentMaterializationRecord(
    valueAt(rawRequest, 'materialization_input'),
    goal,
    goalStatus,
    admission,
    assignmentRead,
  );
  const materializationResult = stores.materialization_store.record_materialization({
    goal,
    goal_status: goalStatus,
    admission,
    assignment_read: assignmentRead,
    materialization,
  });
  return freezeDeep({
    result_version: BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_SERVICE_RESULT_VERSION,
    service_version: BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_SERVICE_VERSION,
    operation: 'goal_assignment_materialized',
    status: 'ready',
    goal,
    goal_status: goalStatus,
    admission,
    assignment_read: assignmentRead,
    materialization,
    operations: {
      admission_store: admissionResult.operation,
      assignment_store: assignmentResult.operation,
      assignment_status_store: statusResult.operation,
      materialization_store: materializationResult.operation,
    },
    evidence: serviceEvidence(),
  });
}

function createBuilderAgentGoalAssignmentMaterializationService(rawStores) {
  const stores = safeStores(rawStores);
  return freezeDeep({
    service_version: BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_SERVICE_VERSION,

    materialize_goal_assignment(rawRequest) {
      try { return materializeGoalAssignment(stores, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_SERVICE_VERSION,
  BuilderAgentGoalAssignmentMaterializationServiceError,
  createBuilderAgentGoalAssignmentMaterializationService,
});
