'use strict';

const { types: utilTypes } = require('node:util');

const {
  BuilderAgentBudgetAuditContractError,
  createBuilderAgentBudgetAuditRecord,
} = require('./builder-agent-budget-audit-contract.cjs');
const {
  BUILDER_AGENT_BUDGET_AUDIT_STORE_VERSION,
  BuilderAgentBudgetAuditStoreError,
} = require('./builder-agent-budget-audit-store.cjs');
const {
  BUILDER_AGENT_SUPERVISION_LEASE_STORE_VERSION,
  BuilderAgentSupervisionLeaseStoreError,
} = require('./builder-agent-supervision-lease-store.cjs');

const BUILDER_AGENT_BUDGET_AUDIT_SERVICE_VERSION = 'builder-agent-budget-audit-service.v1';
const BUILDER_AGENT_BUDGET_AUDIT_SERVICE_RESULT_VERSION =
  'builder-agent-budget-audit-service-result.v1';
const SERVICE_KEYS = Object.freeze(['lease_store', 'budget_audit_store']);
const RECORD_AUDIT_KEYS = Object.freeze([
  'assignment',
  'active_status',
  'lease',
  'audit_input',
  'now_ms',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_budget_audit_service_invalid:
    'Builder agent budget audit could not be verified.',
  builder_agent_budget_audit_service_conflict:
    'Builder agent budget audit changed before it could be recorded.',
  builder_agent_budget_audit_service_unavailable:
    'Builder agent budget audit service is unavailable.',
});

class BuilderAgentBudgetAuditServiceError extends Error {
  constructor(code = 'builder_agent_budget_audit_service_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_budget_audit_service_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentBudgetAuditServiceError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentBudgetAuditServiceError(code);
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
  if (!isPlainObject(value)) fail('builder_agent_budget_audit_service_invalid');
  const own = Object.keys(value);
  if (own.length !== keys.length) fail('builder_agent_budget_audit_service_invalid');
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) fail('builder_agent_budget_audit_service_invalid');
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_budget_audit_service_invalid');
  }
  return descriptor.value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('builder_agent_budget_audit_service_invalid');
  }
  return value;
}

function storeMethod(store, name) {
  const descriptor = Object.getOwnPropertyDescriptor(store, name);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
    fail('builder_agent_budget_audit_service_invalid');
  }
  return descriptor.value.bind(store);
}

function safeStore(value, expectedVersion, methods) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) {
    fail('builder_agent_budget_audit_service_invalid');
  }
  const versionDescriptor = Object.getOwnPropertyDescriptor(value, 'store_version');
  if (
    !versionDescriptor
    || !Object.hasOwn(versionDescriptor, 'value')
    || versionDescriptor.value !== expectedVersion
  ) fail('builder_agent_budget_audit_service_invalid');
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
      ['record_audit', 'read_audit', 'list_lease_audits'],
    ),
  });
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentBudgetAuditServiceError) {
    return new BuilderAgentBudgetAuditServiceError(error.code);
  }
  if (error instanceof BuilderAgentBudgetAuditContractError) {
    return new BuilderAgentBudgetAuditServiceError('builder_agent_budget_audit_service_invalid');
  }
  if (
    error instanceof BuilderAgentBudgetAuditStoreError
    || error instanceof BuilderAgentSupervisionLeaseStoreError
  ) {
    if (/_conflict$/u.test(error.code)) {
      return new BuilderAgentBudgetAuditServiceError('builder_agent_budget_audit_service_conflict');
    }
    if (/_unavailable$/u.test(error.code)) {
      return new BuilderAgentBudgetAuditServiceError(
        'builder_agent_budget_audit_service_unavailable',
      );
    }
    return new BuilderAgentBudgetAuditServiceError('builder_agent_budget_audit_service_invalid');
  }
  return new BuilderAgentBudgetAuditServiceError('builder_agent_budget_audit_service_unavailable');
}

function serviceEvidence() {
  return freezeDeep({
    service_authority: 'main_owned_agent_budget_audit_service',
    lease_store_authority: 'main_owned_agent_supervision_lease_store',
    budget_audit_store_authority: 'main_owned_agent_budget_audit_store',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    model_dispatch: false,
    tool_dispatch: false,
    next_action_dispatch: false,
    permission_grant_authority: false,
    credential_storage: 'not_present',
    source_access: 'not_present',
    source_write: 'not_present',
    process_run: false,
    revision_authority: false,
    review_authority: false,
    artifact_authority: false,
    recovery_model: 'idempotent_store_replay',
  });
}

function recordBudgetAudit(stores, rawRequest) {
  exactObject(rawRequest, RECORD_AUDIT_KEYS);
  const assignment = valueAt(rawRequest, 'assignment');
  const activeStatus = valueAt(rawRequest, 'active_status');
  const lease = valueAt(rawRequest, 'lease');
  const nowMs = safeTimestamp(valueAt(rawRequest, 'now_ms'));
  const audit = createBuilderAgentBudgetAuditRecord(
    valueAt(rawRequest, 'audit_input'),
    assignment,
    activeStatus,
    lease,
  );
  if (nowMs !== audit.observed_at_ms) fail('builder_agent_budget_audit_service_invalid');

  const leaseRead = stores.lease_store.read_assignment_leases({
    assignment_id: audit.assignment_id,
    owner_id: audit.owner_id,
    now_ms: nowMs,
  });
  if (
    leaseRead.status !== 'ready'
    || leaseRead.active_lease === null
    || leaseRead.active_lease.lease.lease_id !== audit.lease_id
  ) fail('builder_agent_budget_audit_service_conflict');

  const auditResult = stores.budget_audit_store.record_audit({
    assignment,
    status: activeStatus,
    lease,
    audit,
  });
  const auditRead = stores.budget_audit_store.read_audit({
    budget_audit_id: audit.budget_audit_id,
    owner_id: audit.owner_id,
  });
  if (
    auditRead.status !== 'ready'
    || auditRead.budget_audit.audit.budget_audit_id !== audit.budget_audit_id
  ) fail('builder_agent_budget_audit_service_invalid');
  const leaseAudits = stores.budget_audit_store.list_lease_audits({
    lease_id: audit.lease_id,
    owner_id: audit.owner_id,
  });
  if (
    leaseAudits.status !== 'ready'
    || !leaseAudits.budget_audits.some(
      (entry) => entry.audit.budget_audit_id === audit.budget_audit_id,
    )
  ) fail('builder_agent_budget_audit_service_invalid');

  return freezeDeep({
    result_version: BUILDER_AGENT_BUDGET_AUDIT_SERVICE_RESULT_VERSION,
    service_version: BUILDER_AGENT_BUDGET_AUDIT_SERVICE_VERSION,
    operation: 'agent_budget_audit_recorded',
    status: 'ready',
    decision: audit.outcome.decision,
    audit,
    lease_read: leaseRead,
    audit_read: auditRead,
    lease_audits: leaseAudits,
    operations: {
      budget_audit_store: auditResult.operation,
    },
    evidence: serviceEvidence(),
  });
}

function createBuilderAgentBudgetAuditService(rawStores) {
  const stores = safeStores(rawStores);
  return freezeDeep({
    service_version: BUILDER_AGENT_BUDGET_AUDIT_SERVICE_VERSION,

    record_budget_audit(rawRequest) {
      try { return recordBudgetAudit(stores, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_BUDGET_AUDIT_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_BUDGET_AUDIT_SERVICE_VERSION,
  BuilderAgentBudgetAuditServiceError,
  createBuilderAgentBudgetAuditService,
});
