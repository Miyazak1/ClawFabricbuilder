'use strict';

const { types: utilTypes } = require('node:util');

const {
  BuilderAgentStepStartContractError,
  createBuilderAgentStepStartReceipt,
  sanitizeBuilderAgentStepStartReceipt,
} = require('./builder-agent-step-start-contract.cjs');
const {
  BUILDER_AGENT_BUDGET_AUDIT_STORE_VERSION,
  BuilderAgentBudgetAuditStoreError,
} = require('./builder-agent-budget-audit-store.cjs');
const {
  BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_VERSION,
  BuilderAgentSupervisedActionAdmissionStoreError,
} = require('./builder-agent-supervised-action-admission-store.cjs');

const BUILDER_AGENT_STEP_START_SERVICE_VERSION =
  'builder-agent-step-start-service.v1';
const BUILDER_AGENT_STEP_START_SERVICE_RESULT_VERSION =
  'builder-agent-step-start-service-result.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const STEP_ID_PATTERN = new RegExp(`^builder-run-step:${UUID_SOURCE}$`, 'u');
const ADMISSION_ID_PATTERN = /^builder-agent-supervised-action-admission:[0-9a-f]{64}$/u;
const SERVICE_KEYS = Object.freeze([
  'budget_audit_store',
  'supervised_action_admission_store',
]);
const START_STEP_KEYS = Object.freeze([
  'owner_id',
  'supervised_action_admission_id',
  'step_id',
  'step_index',
  'started_at_ms',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_step_start_service_invalid:
    'Builder agent step start could not be verified.',
  builder_agent_step_start_service_conflict:
    'Builder agent step start changed before it could be admitted.',
  builder_agent_step_start_service_unavailable:
    'Builder agent step start service is unavailable.',
});

class BuilderAgentStepStartServiceError extends Error {
  constructor(code = 'builder_agent_step_start_service_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_step_start_service_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentStepStartServiceError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentStepStartServiceError(code);
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
  if (!isPlainObject(value)) fail('builder_agent_step_start_service_invalid');
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail('builder_agent_step_start_service_invalid');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_agent_step_start_service_invalid');
    }
  }
  return value;
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_step_start_service_invalid');
  }
  return descriptor.value;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    fail('builder_agent_step_start_service_invalid');
  }
  return value;
}

function safeOwnerId(value) {
  return safePattern(value, OWNER_ID_PATTERN);
}

function safeAdmissionId(value) {
  return safePattern(value, ADMISSION_ID_PATTERN);
}

function safeStepId(value) {
  return safePattern(value, STEP_ID_PATTERN);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('builder_agent_step_start_service_invalid');
  }
  return value;
}

function safeStepIndex(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 256) {
    fail('builder_agent_step_start_service_invalid');
  }
  return value;
}

function storeMethod(store, name) {
  const descriptor = Object.getOwnPropertyDescriptor(store, name);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
    fail('builder_agent_step_start_service_invalid');
  }
  return descriptor.value.bind(store);
}

function safeStore(value, expectedVersion, methods) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) {
    fail('builder_agent_step_start_service_invalid');
  }
  const versionDescriptor = Object.getOwnPropertyDescriptor(value, 'store_version');
  if (
    !versionDescriptor
    || !Object.hasOwn(versionDescriptor, 'value')
    || versionDescriptor.value !== expectedVersion
  ) fail('builder_agent_step_start_service_invalid');
  const selected = { store_version: expectedVersion };
  for (const method of methods) selected[method] = storeMethod(value, method);
  return freezeDeep(selected);
}

function safeStores(rawStores) {
  exactObject(rawStores, SERVICE_KEYS);
  return freezeDeep({
    budget_audit_store: safeStore(
      valueAt(rawStores, 'budget_audit_store'),
      BUILDER_AGENT_BUDGET_AUDIT_STORE_VERSION,
      ['read_audit', 'list_lease_audits'],
    ),
    supervised_action_admission_store: safeStore(
      valueAt(rawStores, 'supervised_action_admission_store'),
      BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_VERSION,
      ['read_admission', 'list_task_admissions', 'list_run_admissions'],
    ),
  });
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentStepStartServiceError) {
    return new BuilderAgentStepStartServiceError(error.code);
  }
  if (error instanceof BuilderAgentStepStartContractError) {
    return new BuilderAgentStepStartServiceError(
      'builder_agent_step_start_service_invalid',
    );
  }
  if (
    error instanceof BuilderAgentBudgetAuditStoreError
    || error instanceof BuilderAgentSupervisedActionAdmissionStoreError
  ) {
    if (/_conflict$/u.test(error.code)) {
      return new BuilderAgentStepStartServiceError(
        'builder_agent_step_start_service_conflict',
      );
    }
    if (/_unavailable$/u.test(error.code)) {
      return new BuilderAgentStepStartServiceError(
        'builder_agent_step_start_service_unavailable',
      );
    }
    return new BuilderAgentStepStartServiceError(
      'builder_agent_step_start_service_invalid',
    );
  }
  return new BuilderAgentStepStartServiceError(
    'builder_agent_step_start_service_unavailable',
  );
}

function serviceEvidence() {
  return freezeDeep({
    service_authority: 'main_owned_agent_step_start_service',
    step_start_receipt_authority: 'main_agent_step_start_receipt_contract_v1',
    supervised_action_admission_store_authority: 'main_owned_agent_supervised_action_admission_store',
    supervised_action_admission_authority: 'main_agent_supervised_action_admission_contract_v1',
    budget_audit_store_authority: 'main_owned_agent_budget_audit_store',
    budget_audit_authority: 'main_agent_budget_audit_contract_v1',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    model_dispatch: false,
    tool_dispatch: false,
    step_execution: false,
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
    recovery_model: 'deterministic_step_receipt_from_store_backed_action_admission',
  });
}

function admissionFact(admissionRead) {
  if (admissionRead.status !== 'ready') fail('builder_agent_step_start_service_conflict');
  const entry = admissionRead.supervised_action_admission;
  if (!entry || !entry.admission) fail('builder_agent_step_start_service_invalid');
  return entry.admission;
}

function auditFact(auditRead) {
  if (auditRead.status !== 'ready') fail('builder_agent_step_start_service_conflict');
  const entry = auditRead.budget_audit;
  if (!entry || !entry.audit) fail('builder_agent_step_start_service_invalid');
  return entry.audit;
}

function requireStartStepAdmission(stores, ownerId, admissionId) {
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
    || admission.requested_next_action !== 'start_step'
    || admission.next_gate !== 'agent_step_runner_required_later'
  ) fail('builder_agent_step_start_service_invalid');
  return freezeDeep({
    admission,
    admission_read: admissionRead,
    task_admissions: taskAdmissions,
    run_admissions: runAdmissions,
  });
}

function requireAllowedStartStepBudgetAudit(stores, admission) {
  const auditRead = stores.budget_audit_store.read_audit({
    budget_audit_id: admission.budget_audit_id,
    owner_id: admission.owner_id,
  });
  const audit = auditFact(auditRead);
  const leaseAudits = stores.budget_audit_store.list_lease_audits({
    lease_id: admission.lease_id,
    owner_id: admission.owner_id,
  });
  if (
    leaseAudits.status !== 'ready'
    || !leaseAudits.budget_audits.some(
      (entry) => entry.audit.budget_audit_id === admission.budget_audit_id,
    )
    || audit.assignment_id !== admission.assignment_id
    || audit.assignment_status_id !== admission.assignment_status_id
    || audit.lease_id !== admission.lease_id
    || audit.agent_id !== admission.agent_id
    || audit.agent_version_id !== admission.agent_version_id
    || audit.owner_id !== admission.owner_id
    || audit.project_id !== admission.project_id
    || audit.conversation_id !== admission.conversation_id
    || audit.task_id !== admission.task_id
    || audit.run_id !== admission.run_id
    || audit.requested_next_action !== 'start_step'
    || audit.outcome.decision !== 'allowed'
    || audit.outcome.reason !== 'none'
    || audit.observed_at_ms !== admission.budget_audit_observed_at_ms
    || audit.observed_at_ms > admission.admitted_at_ms
    || audit.budget_usage.step_count >= audit.budget_limits.max_steps
    || audit.budget_usage.runtime_ms >= audit.budget_limits.max_runtime_ms
  ) fail('builder_agent_step_start_service_invalid');
  return freezeDeep({ audit, audit_read: auditRead, lease_audits: leaseAudits });
}

function admitAgentStepStart(stores, rawRequest) {
  exactObject(rawRequest, START_STEP_KEYS);
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const admissionId = safeAdmissionId(valueAt(rawRequest, 'supervised_action_admission_id'));
  const stepId = safeStepId(valueAt(rawRequest, 'step_id'));
  const stepIndex = safeStepIndex(valueAt(rawRequest, 'step_index'));
  const startedAtMs = safeTimestamp(valueAt(rawRequest, 'started_at_ms'));
  const admissionEvidence = requireStartStepAdmission(stores, ownerId, admissionId);
  const budgetEvidence = requireAllowedStartStepBudgetAudit(stores, admissionEvidence.admission);
  const receipt = sanitizeBuilderAgentStepStartReceipt(createBuilderAgentStepStartReceipt({
    supervised_action_admission: admissionEvidence.admission,
    budget_audit: budgetEvidence.audit,
    step_id: stepId,
    step_index: stepIndex,
    started_at_ms: startedAtMs,
  }));
  return freezeDeep({
    result_version: BUILDER_AGENT_STEP_START_SERVICE_RESULT_VERSION,
    service_version: BUILDER_AGENT_STEP_START_SERVICE_VERSION,
    operation: 'agent_step_start_admitted',
    status: 'ready',
    requested_next_action: admissionEvidence.admission.requested_next_action,
    next_gate: admissionEvidence.admission.next_gate,
    step_start_receipt: receipt,
    supervised_action_admission: admissionEvidence.admission,
    supervised_action_admission_read: admissionEvidence.admission_read,
    action_task_admissions: admissionEvidence.task_admissions,
    action_run_admissions: admissionEvidence.run_admissions,
    budget_audit: budgetEvidence.audit,
    budget_audit_read: budgetEvidence.audit_read,
    lease_audits: budgetEvidence.lease_audits,
    evidence: serviceEvidence(),
  });
}

function createBuilderAgentStepStartService(rawStores) {
  const stores = safeStores(rawStores);
  return freezeDeep({
    service_version: BUILDER_AGENT_STEP_START_SERVICE_VERSION,

    admit_agent_step_start(rawRequest) {
      try { return admitAgentStepStart(stores, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_STEP_START_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_STEP_START_SERVICE_VERSION,
  BuilderAgentStepStartServiceError,
  createBuilderAgentStepStartService,
});
