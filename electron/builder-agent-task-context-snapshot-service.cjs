'use strict';

const { types: utilTypes } = require('node:util');

const {
  BuilderAgentBudgetAuditStoreError,
  BUILDER_AGENT_BUDGET_AUDIT_STORE_VERSION,
} = require('./builder-agent-budget-audit-store.cjs');
const {
  BuilderAgentSupervisionLeaseStoreError,
  BUILDER_AGENT_SUPERVISION_LEASE_STORE_VERSION,
} = require('./builder-agent-supervision-lease-store.cjs');
const {
  BuilderAgentTaskContextSnapshotError,
  createBuilderAgentTaskContextSnapshot,
} = require('./builder-agent-task-context-snapshot.cjs');
const {
  BuilderAgentTaskContextSnapshotStoreError,
  BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_STORE_VERSION,
} = require('./builder-agent-task-context-snapshot-store.cjs');

const BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_SERVICE_VERSION =
  'builder-agent-task-context-snapshot-service.v1';
const BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_SERVICE_RESULT_VERSION =
  'builder-agent-task-context-snapshot-service-result.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const BUDGET_AUDIT_ID_PATTERN = /^builder-agent-budget-audit:[0-9a-f]{64}$/u;
const SERVICE_KEYS = Object.freeze([
  'lease_store',
  'budget_audit_store',
  'context_snapshot_store',
]);
const RECORD_CONTEXT_SNAPSHOT_KEYS = Object.freeze([
  'agent_definition',
  'agent_version',
  'assignment',
  'active_status',
  'lease',
  'budget_audit_id',
  'included_memory_ids',
  'included_message_ids',
  'included_artifact_ids',
  'included_run_event_ids',
  'included_permission_ids',
  'parent_task_context_projection',
  'base_project_revision',
  'token_budget',
  'now_ms',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_task_context_snapshot_service_invalid:
    'Builder agent task context snapshot could not be verified.',
  builder_agent_task_context_snapshot_service_conflict:
    'Builder agent task context snapshot changed before it could be recorded.',
  builder_agent_task_context_snapshot_service_unavailable:
    'Builder agent task context snapshot service is unavailable.',
});

class BuilderAgentTaskContextSnapshotServiceError extends Error {
  constructor(code = 'builder_agent_task_context_snapshot_service_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_task_context_snapshot_service_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentTaskContextSnapshotServiceError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentTaskContextSnapshotServiceError(code);
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
  if (!isPlainObject(value)) fail('builder_agent_task_context_snapshot_service_invalid');
  const own = Reflect.ownKeys(value);
  if (
    own.length !== keys.length
    || own.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail('builder_agent_task_context_snapshot_service_invalid');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_agent_task_context_snapshot_service_invalid');
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_task_context_snapshot_service_invalid');
  }
  return descriptor.value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('builder_agent_task_context_snapshot_service_invalid');
  }
  return value;
}

function safeBudgetAuditId(value) {
  if (typeof value !== 'string' || !BUDGET_AUDIT_ID_PATTERN.test(value)) {
    fail('builder_agent_task_context_snapshot_service_invalid');
  }
  return value;
}

function safeOwnerId(value) {
  if (typeof value !== 'string' || !OWNER_ID_PATTERN.test(value)) {
    fail('builder_agent_task_context_snapshot_service_invalid');
  }
  return value;
}

function storeMethod(store, name) {
  const descriptor = Object.getOwnPropertyDescriptor(store, name);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
    fail('builder_agent_task_context_snapshot_service_invalid');
  }
  return descriptor.value.bind(store);
}

function safeStore(value, expectedVersion, methods) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) {
    fail('builder_agent_task_context_snapshot_service_invalid');
  }
  const versionDescriptor = Object.getOwnPropertyDescriptor(value, 'store_version');
  if (
    !versionDescriptor
    || !Object.hasOwn(versionDescriptor, 'value')
    || versionDescriptor.value !== expectedVersion
  ) fail('builder_agent_task_context_snapshot_service_invalid');
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
    context_snapshot_store: safeStore(
      valueAt(rawStores, 'context_snapshot_store'),
      BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_STORE_VERSION,
      [
        'record_snapshot',
        'read_snapshot',
        'read_snapshot_for_budget_audit',
        'list_task_snapshots',
        'list_run_snapshots',
      ],
    ),
  });
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentTaskContextSnapshotServiceError) {
    return new BuilderAgentTaskContextSnapshotServiceError(error.code);
  }
  if (error instanceof BuilderAgentTaskContextSnapshotError) {
    return new BuilderAgentTaskContextSnapshotServiceError(
      'builder_agent_task_context_snapshot_service_invalid',
    );
  }
  if (
    error instanceof BuilderAgentTaskContextSnapshotStoreError
    || error instanceof BuilderAgentBudgetAuditStoreError
    || error instanceof BuilderAgentSupervisionLeaseStoreError
  ) {
    if (/_conflict$/u.test(error.code)) {
      return new BuilderAgentTaskContextSnapshotServiceError(
        'builder_agent_task_context_snapshot_service_conflict',
      );
    }
    if (/_unavailable$/u.test(error.code)) {
      return new BuilderAgentTaskContextSnapshotServiceError(
        'builder_agent_task_context_snapshot_service_unavailable',
      );
    }
    return new BuilderAgentTaskContextSnapshotServiceError(
      'builder_agent_task_context_snapshot_service_invalid',
    );
  }
  return new BuilderAgentTaskContextSnapshotServiceError(
    'builder_agent_task_context_snapshot_service_unavailable',
  );
}

function serviceEvidence() {
  return freezeDeep({
    service_authority: 'main_owned_agent_task_context_snapshot_service',
    lease_store_authority: 'main_owned_agent_supervision_lease_store',
    budget_audit_store_authority: 'main_owned_agent_budget_audit_store',
    context_snapshot_store_authority: 'main_owned_agent_task_context_snapshot_store',
    context_snapshot_contract_authority: 'main_agent_task_context_snapshot_contract_v1',
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

function budgetAuditFact(auditRead) {
  if (auditRead.status !== 'ready') fail('builder_agent_task_context_snapshot_service_conflict');
  const entry = auditRead.budget_audit;
  if (!entry || !entry.audit) fail('builder_agent_task_context_snapshot_service_invalid');
  return entry.audit;
}

function requireStoreBackedActiveLease(stores, snapshot, nowMs) {
  const leaseRead = stores.lease_store.read_assignment_leases({
    assignment_id: snapshot.assignment_id,
    owner_id: snapshot.owner_id,
    now_ms: nowMs,
  });
  if (
    leaseRead.status !== 'ready'
    || leaseRead.active_lease === null
    || leaseRead.active_lease.lease.lease_id !== snapshot.lease_id
  ) fail('builder_agent_task_context_snapshot_service_conflict');
  return leaseRead;
}

function requireAllowedBudgetAudit(stores, budgetAuditId, snapshot) {
  const auditRead = stores.budget_audit_store.read_audit({
    budget_audit_id: budgetAuditId,
    owner_id: snapshot.owner_id,
  });
  const audit = budgetAuditFact(auditRead);
  const leaseAudits = stores.budget_audit_store.list_lease_audits({
    lease_id: snapshot.lease_id,
    owner_id: snapshot.owner_id,
  });
  if (
    leaseAudits.status !== 'ready'
    || !leaseAudits.budget_audits.some(
      (entry) => entry.audit.budget_audit_id === budgetAuditId,
    )
    || snapshot.budget_audit_id !== budgetAuditId
    || audit.assignment_id !== snapshot.assignment_id
    || audit.assignment_status_id !== snapshot.assignment_status_id
    || audit.lease_id !== snapshot.lease_id
    || audit.agent_id !== snapshot.agent_id
    || audit.agent_version_id !== snapshot.agent_version_id
    || audit.owner_id !== snapshot.owner_id
    || audit.project_id !== snapshot.project_id
    || audit.conversation_id !== snapshot.conversation_id
    || audit.task_id !== snapshot.task_id
    || audit.run_id !== snapshot.run_id
    || audit.requested_next_action !== snapshot.action_admission.requested_next_action
    || audit.outcome.decision !== 'allowed'
    || audit.outcome.reason !== 'none'
    || audit.observed_at_ms > snapshot.created_at_ms
  ) fail('builder_agent_task_context_snapshot_service_invalid');
  return freezeDeep({ audit, audit_read: auditRead, lease_audits: leaseAudits });
}

function snapshotInputFromRequest(rawRequest, budgetAudit, nowMs) {
  return freezeDeep({
    agent_definition: valueAt(rawRequest, 'agent_definition'),
    agent_version: valueAt(rawRequest, 'agent_version'),
    assignment: valueAt(rawRequest, 'assignment'),
    active_status: valueAt(rawRequest, 'active_status'),
    lease: valueAt(rawRequest, 'lease'),
    budget_audit: budgetAudit,
    included_memory_ids: valueAt(rawRequest, 'included_memory_ids'),
    included_message_ids: valueAt(rawRequest, 'included_message_ids'),
    included_artifact_ids: valueAt(rawRequest, 'included_artifact_ids'),
    included_run_event_ids: valueAt(rawRequest, 'included_run_event_ids'),
    included_permission_ids: valueAt(rawRequest, 'included_permission_ids'),
    parent_task_context_projection: valueAt(rawRequest, 'parent_task_context_projection'),
    base_project_revision: valueAt(rawRequest, 'base_project_revision'),
    token_budget: valueAt(rawRequest, 'token_budget'),
    created_at_ms: nowMs,
  });
}

function verifyStoredSnapshot(stores, snapshot) {
  const snapshotRead = stores.context_snapshot_store.read_snapshot({
    snapshot_id: snapshot.snapshot_id,
    owner_id: snapshot.owner_id,
  });
  const budgetAuditSnapshotRead = stores.context_snapshot_store.read_snapshot_for_budget_audit({
    budget_audit_id: snapshot.budget_audit_id,
    owner_id: snapshot.owner_id,
  });
  const taskSnapshots = stores.context_snapshot_store.list_task_snapshots({
    owner_id: snapshot.owner_id,
    project_id: snapshot.project_id,
    task_id: snapshot.task_id,
  });
  const runSnapshots = stores.context_snapshot_store.list_run_snapshots({
    owner_id: snapshot.owner_id,
    project_id: snapshot.project_id,
    task_id: snapshot.task_id,
    run_id: snapshot.run_id,
  });
  if (
    snapshotRead.status !== 'ready'
    || snapshotRead.agent_task_context_snapshot.snapshot.snapshot_id !== snapshot.snapshot_id
    || budgetAuditSnapshotRead.status !== 'ready'
    || budgetAuditSnapshotRead.agent_task_context_snapshot.snapshot.snapshot_id !== snapshot.snapshot_id
    || taskSnapshots.status !== 'ready'
    || !taskSnapshots.agent_task_context_snapshots.some(
      (entry) => entry.snapshot.snapshot_id === snapshot.snapshot_id,
    )
    || runSnapshots.status !== 'ready'
    || !runSnapshots.agent_task_context_snapshots.some(
      (entry) => entry.snapshot.snapshot_id === snapshot.snapshot_id,
    )
  ) fail('builder_agent_task_context_snapshot_service_invalid');
  return freezeDeep({
    snapshot_read: snapshotRead,
    budget_audit_snapshot_read: budgetAuditSnapshotRead,
    task_snapshots: taskSnapshots,
    run_snapshots: runSnapshots,
  });
}

function recordTaskContextSnapshot(stores, rawRequest) {
  exactObject(rawRequest, RECORD_CONTEXT_SNAPSHOT_KEYS);
  const nowMs = safeTimestamp(valueAt(rawRequest, 'now_ms'));
  const budgetAuditId = safeBudgetAuditId(valueAt(rawRequest, 'budget_audit_id'));
  const assignment = valueAt(rawRequest, 'assignment');
  if (!isPlainObject(assignment)) fail('builder_agent_task_context_snapshot_service_invalid');
  const auditRead = stores.budget_audit_store.read_audit({
    budget_audit_id: budgetAuditId,
    owner_id: safeOwnerId(valueAt(assignment, 'owner_id')),
  });
  const budgetAudit = budgetAuditFact(auditRead);
  const snapshot = createBuilderAgentTaskContextSnapshot(
    snapshotInputFromRequest(rawRequest, budgetAudit, nowMs),
  );
  const leaseRead = requireStoreBackedActiveLease(stores, snapshot, nowMs);
  const budgetEvidence = requireAllowedBudgetAudit(stores, budgetAuditId, snapshot);
  const snapshotStoreWrite = stores.context_snapshot_store.record_snapshot({ snapshot });
  const stored = verifyStoredSnapshot(stores, snapshot);

  return freezeDeep({
    result_version: BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_SERVICE_RESULT_VERSION,
    service_version: BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_SERVICE_VERSION,
    operation: 'agent_task_context_snapshot_recorded',
    status: 'ready',
    requested_next_action: snapshot.action_admission.requested_next_action,
    snapshot,
    lease_read: leaseRead,
    budget_audit: budgetEvidence.audit,
    budget_audit_read: budgetEvidence.audit_read,
    lease_audits: budgetEvidence.lease_audits,
    snapshot_read: stored.snapshot_read,
    budget_audit_snapshot_read: stored.budget_audit_snapshot_read,
    task_snapshots: stored.task_snapshots,
    run_snapshots: stored.run_snapshots,
    operations: {
      context_snapshot_store: snapshotStoreWrite.operation,
    },
    evidence: serviceEvidence(),
  });
}

function createBuilderAgentTaskContextSnapshotService(rawStores) {
  const stores = safeStores(rawStores);
  return freezeDeep({
    service_version: BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_SERVICE_VERSION,

    record_task_context_snapshot(rawRequest) {
      try { return recordTaskContextSnapshot(stores, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_SERVICE_VERSION,
  BuilderAgentTaskContextSnapshotServiceError,
  createBuilderAgentTaskContextSnapshotService,
});
