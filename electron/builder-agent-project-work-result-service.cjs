'use strict';

const { types: utilTypes } = require('node:util');

const {
  BuilderAgentProjectWorkContractError,
  createBuilderAgentProjectWorkResultRecord,
} = require('./builder-agent-project-work-contract.cjs');
const {
  BUILDER_AGENT_PROJECT_WORK_STORE_VERSION,
  BuilderAgentProjectWorkStoreError,
} = require('./builder-agent-project-work-store.cjs');
const {
  BUILDER_AGENT_BUDGET_AUDIT_STORE_VERSION,
  BuilderAgentBudgetAuditStoreError,
} = require('./builder-agent-budget-audit-store.cjs');
const {
  BUILDER_AGENT_SUPERVISION_LEASE_STORE_VERSION,
  BuilderAgentSupervisionLeaseStoreError,
} = require('./builder-agent-supervision-lease-store.cjs');

const BUILDER_AGENT_PROJECT_WORK_RESULT_SERVICE_VERSION =
  'builder-agent-project-work-result-service.v1';
const BUILDER_AGENT_PROJECT_WORK_RESULT_SERVICE_RESULT_VERSION =
  'builder-agent-project-work-result-service-result.v1';
const BUDGET_AUDIT_ID_PATTERN = /^builder-agent-budget-audit:[0-9a-f]{64}$/u;
const SERVICE_KEYS = Object.freeze(['lease_store', 'budget_audit_store', 'project_work_store']);
const RECORD_RESULT_KEYS = Object.freeze([
  'assignment',
  'active_status',
  'lease',
  'budget_audit_id',
  'result_input',
  'now_ms',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_project_work_result_service_invalid:
    'Builder agent project work result could not be verified.',
  builder_agent_project_work_result_service_conflict:
    'Builder agent project work result changed before it could be recorded.',
  builder_agent_project_work_result_service_unavailable:
    'Builder agent project work result service is unavailable.',
});

class BuilderAgentProjectWorkResultServiceError extends Error {
  constructor(code = 'builder_agent_project_work_result_service_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_project_work_result_service_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentProjectWorkResultServiceError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentProjectWorkResultServiceError(code);
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
  if (!isPlainObject(value)) fail('builder_agent_project_work_result_service_invalid');
  const own = Object.keys(value);
  if (own.length !== keys.length) fail('builder_agent_project_work_result_service_invalid');
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) fail('builder_agent_project_work_result_service_invalid');
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_project_work_result_service_invalid');
  }
  return descriptor.value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('builder_agent_project_work_result_service_invalid');
  }
  return value;
}

function safeBudgetAuditId(value) {
  if (typeof value !== 'string' || !BUDGET_AUDIT_ID_PATTERN.test(value)) {
    fail('builder_agent_project_work_result_service_invalid');
  }
  return value;
}

function storeMethod(store, name) {
  const descriptor = Object.getOwnPropertyDescriptor(store, name);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
    fail('builder_agent_project_work_result_service_invalid');
  }
  return descriptor.value.bind(store);
}

function safeStore(value, expectedVersion, methods) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) {
    fail('builder_agent_project_work_result_service_invalid');
  }
  const versionDescriptor = Object.getOwnPropertyDescriptor(value, 'store_version');
  if (
    !versionDescriptor
    || !Object.hasOwn(versionDescriptor, 'value')
    || versionDescriptor.value !== expectedVersion
  ) fail('builder_agent_project_work_result_service_invalid');
  const selected = { store_version: expectedVersion };
  for (const method of methods) selected[method] = storeMethod(value, method);
  return freezeDeep(selected);
}

function safeStores(rawStores) {
  exactObject(rawStores, SERVICE_KEYS);
  return freezeDeep({
    lease_store: safeStore(
      valueAt(rawStores, 'lease_store'),
      BUILDER_AGENT_SUPERVISION_LEASE_STORE_VERSION,
      ['read_assignment_leases'],
    ),
    budget_audit_store: safeStore(
      valueAt(rawStores, 'budget_audit_store'),
      BUILDER_AGENT_BUDGET_AUDIT_STORE_VERSION,
      ['read_audit', 'list_lease_audits'],
    ),
    project_work_store: safeStore(
      valueAt(rawStores, 'project_work_store'),
      BUILDER_AGENT_PROJECT_WORK_STORE_VERSION,
      ['record_result', 'read_result', 'list_task_results'],
    ),
  });
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentProjectWorkResultServiceError) {
    return new BuilderAgentProjectWorkResultServiceError(error.code);
  }
  if (error instanceof BuilderAgentProjectWorkContractError) {
    return new BuilderAgentProjectWorkResultServiceError(
      'builder_agent_project_work_result_service_invalid',
    );
  }
  if (
    error instanceof BuilderAgentProjectWorkStoreError
    || error instanceof BuilderAgentBudgetAuditStoreError
    || error instanceof BuilderAgentSupervisionLeaseStoreError
  ) {
    if (/_conflict$/u.test(error.code)) {
      return new BuilderAgentProjectWorkResultServiceError(
        'builder_agent_project_work_result_service_conflict',
      );
    }
    if (/_unavailable$/u.test(error.code)) {
      return new BuilderAgentProjectWorkResultServiceError(
        'builder_agent_project_work_result_service_unavailable',
      );
    }
    return new BuilderAgentProjectWorkResultServiceError(
      'builder_agent_project_work_result_service_invalid',
    );
  }
  return new BuilderAgentProjectWorkResultServiceError(
    'builder_agent_project_work_result_service_unavailable',
  );
}

function serviceEvidence() {
  return freezeDeep({
    service_authority: 'main_owned_agent_project_work_result_service',
    lease_store_authority: 'main_owned_agent_supervision_lease_store',
    budget_audit_store_authority: 'main_owned_agent_budget_audit_store',
    project_work_store_authority: 'main_owned_agent_project_work_store',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    model_dispatch: false,
    tool_dispatch: false,
    permission_grant_authority: false,
    credential_storage: 'not_present',
    source_access: 'not_present',
    source_write: 'not_present',
    process_run: false,
    revision_authority: false,
    review_authority: 'required_later',
    artifact_authority: false,
    materialization_authority: false,
    recovery_model: 'idempotent_store_replay',
  });
}

function budgetAuditFact(auditRead) {
  if (auditRead.status !== 'ready') fail('builder_agent_project_work_result_service_conflict');
  const entry = auditRead.budget_audit;
  if (!entry || !entry.audit) fail('builder_agent_project_work_result_service_invalid');
  return entry.audit;
}

function requireAllowedFinishForReviewBudgetAudit(stores, budgetAuditId, result) {
  const auditRead = stores.budget_audit_store.read_audit({
    budget_audit_id: budgetAuditId,
    owner_id: result.owner_id,
  });
  const audit = budgetAuditFact(auditRead);
  const leaseAudits = stores.budget_audit_store.list_lease_audits({
    lease_id: result.lease_id,
    owner_id: result.owner_id,
  });
  if (
    leaseAudits.status !== 'ready'
    || !leaseAudits.budget_audits.some(
      (entry) => entry.audit.budget_audit_id === budgetAuditId,
    )
    || audit.assignment_id !== result.assignment_id
    || audit.assignment_status_id !== result.assignment_status_id
    || audit.lease_id !== result.lease_id
    || audit.agent_id !== result.agent_id
    || audit.agent_version_id !== result.agent_version_id
    || audit.owner_id !== result.owner_id
    || audit.project_id !== result.project_id
    || audit.conversation_id !== result.conversation_id
    || audit.task_id !== result.task_id
    || audit.run_id !== result.run_id
    || audit.requested_next_action !== 'finish_for_review'
    || audit.outcome.decision !== 'allowed'
    || audit.outcome.reason !== 'none'
    || audit.observed_at_ms > result.observed_at_ms
  ) fail('builder_agent_project_work_result_service_invalid');
  return freezeDeep({ audit, audit_read: auditRead, lease_audits: leaseAudits });
}

function recordProjectWorkResult(stores, rawRequest) {
  exactObject(rawRequest, RECORD_RESULT_KEYS);
  const assignment = valueAt(rawRequest, 'assignment');
  const activeStatus = valueAt(rawRequest, 'active_status');
  const lease = valueAt(rawRequest, 'lease');
  const budgetAuditId = safeBudgetAuditId(valueAt(rawRequest, 'budget_audit_id'));
  const nowMs = safeTimestamp(valueAt(rawRequest, 'now_ms'));
  const result = createBuilderAgentProjectWorkResultRecord(
    valueAt(rawRequest, 'result_input'),
    assignment,
    activeStatus,
    lease,
  );
  if (nowMs !== result.observed_at_ms) fail('builder_agent_project_work_result_service_invalid');

  const leaseRead = stores.lease_store.read_assignment_leases({
    assignment_id: result.assignment_id,
    owner_id: result.owner_id,
    now_ms: nowMs,
  });
  if (
    leaseRead.status !== 'ready'
    || leaseRead.active_lease === null
    || leaseRead.active_lease.lease.lease_id !== result.lease_id
  ) fail('builder_agent_project_work_result_service_conflict');
  const budgetEvidence = requireAllowedFinishForReviewBudgetAudit(stores, budgetAuditId, result);

  const resultStoreWrite = stores.project_work_store.record_result({
    assignment,
    status: activeStatus,
    lease,
    result,
  });
  const resultRead = stores.project_work_store.read_result({
    work_result_id: result.work_result_id,
    owner_id: result.owner_id,
  });
  if (
    resultRead.status !== 'ready'
    || resultRead.work_result.result.work_result_id !== result.work_result_id
  ) fail('builder_agent_project_work_result_service_invalid');
  const taskResults = stores.project_work_store.list_task_results({
    owner_id: result.owner_id,
    project_id: result.project_id,
    task_id: result.task_id,
  });
  if (
    taskResults.status !== 'ready'
    || !taskResults.work_results.some(
      (entry) => entry.result.work_result_id === result.work_result_id,
    )
  ) fail('builder_agent_project_work_result_service_invalid');

  return freezeDeep({
    result_version: BUILDER_AGENT_PROJECT_WORK_RESULT_SERVICE_RESULT_VERSION,
    service_version: BUILDER_AGENT_PROJECT_WORK_RESULT_SERVICE_VERSION,
    operation: 'agent_project_work_result_recorded',
    status: 'ready',
    work_kind: result.work_kind,
    result_status: result.result.status,
    result,
    lease_read: leaseRead,
    budget_audit: budgetEvidence.audit,
    budget_audit_read: budgetEvidence.audit_read,
    lease_audits: budgetEvidence.lease_audits,
    result_read: resultRead,
    task_results: taskResults,
    operations: {
      project_work_store: resultStoreWrite.operation,
    },
    evidence: serviceEvidence(),
  });
}

function createBuilderAgentProjectWorkResultService(rawStores) {
  const stores = safeStores(rawStores);
  return freezeDeep({
    service_version: BUILDER_AGENT_PROJECT_WORK_RESULT_SERVICE_VERSION,

    record_project_work_result(rawRequest) {
      try { return recordProjectWorkResult(stores, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_PROJECT_WORK_RESULT_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_PROJECT_WORK_RESULT_SERVICE_VERSION,
  BuilderAgentProjectWorkResultServiceError,
  createBuilderAgentProjectWorkResultService,
});
