'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_AGENT_DEFINITION_RECORD_VERSION,
  BUILDER_AGENT_VERSION_RECORD_VERSION,
  createBuilderAgentDefinitionRecord,
  createBuilderAgentVersionRecord,
} = require('../electron/builder-agent-definition-contract.cjs');
const {
  BUILDER_AGENT_ASSIGNMENT_RECORD_VERSION,
  BUILDER_AGENT_ASSIGNMENT_STATUS_RECORD_VERSION,
  createBuilderAgentAssignmentRecord,
  createBuilderAgentAssignmentStatusRecord,
} = require('../electron/builder-agent-assignment-contract.cjs');
const {
  BUILDER_AGENT_SUPERVISION_LEASE_RECORD_VERSION,
  createBuilderAgentSupervisionLeaseRecord,
} = require('../electron/builder-agent-supervision-lease-contract.cjs');
const {
  BUILDER_AGENT_SUPERVISION_LEASE_STORE_VERSION,
  createBuilderAgentSupervisionLeaseStore,
} = require('../electron/builder-agent-supervision-lease-store.cjs');
const {
  BUILDER_AGENT_BUDGET_AUDIT_RECORD_KIND,
  BUILDER_AGENT_BUDGET_AUDIT_RECORD_VERSION,
  createBuilderAgentBudgetAuditRecord,
} = require('../electron/builder-agent-budget-audit-contract.cjs');
const {
  BUILDER_AGENT_BUDGET_AUDIT_STORE_VERSION,
  createBuilderAgentBudgetAuditStore,
} = require('../electron/builder-agent-budget-audit-store.cjs');
const {
  createBuilderAgentTaskContextSnapshot,
} = require('../electron/builder-agent-task-context-snapshot.cjs');
const {
  BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_STORE_VERSION,
  createBuilderAgentTaskContextSnapshotStore,
} = require('../electron/builder-agent-task-context-snapshot-store.cjs');
const {
  BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_SERVICE_VERSION,
  BuilderAgentTaskContextSnapshotServiceError,
  createBuilderAgentTaskContextSnapshotService,
} = require('../electron/builder-agent-task-context-snapshot-service.cjs');

const OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174000';
const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174004';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174005';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174006';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174007';
const SUPERVISOR_ID = 'builder-supervisor:123e4567-e89b-42d3-a456-426614174008';
const MEMORY_ID = `builder-agent-memory:${'a'.repeat(64)}`;
const MESSAGE_ID = 'builder-message:123e4567-e89b-42d3-a456-426614174009';
const SECOND_MESSAGE_ID = 'builder-message:123e4567-e89b-42d3-a456-426614174010';
const ARTIFACT_ID = `builder-artifact:${'b'.repeat(64)}`;
const RUN_EVENT_ID = `builder-run-event:${'c'.repeat(64)}`;
const PERMISSION_ID = `builder-permission:${'d'.repeat(64)}`;

function temporaryRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function openStores(root) {
  return {
    lease_store: createBuilderAgentSupervisionLeaseStore(path.join(root, 'leases.sqlite')),
    budget_audit_store: createBuilderAgentBudgetAuditStore(path.join(root, 'budget-audits.sqlite')),
    context_snapshot_store: createBuilderAgentTaskContextSnapshotStore(
      path.join(root, 'task-context-snapshots.sqlite'),
    ),
  };
}

function closeStores(stores) {
  stores.lease_store.close();
  stores.budget_audit_store.close();
  stores.context_snapshot_store.close();
}

function definitionInput(overrides = {}) {
  return {
    record_version: BUILDER_AGENT_DEFINITION_RECORD_VERSION,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    display_name: 'Builder Assistant',
    purpose: 'Prepare bounded task context before supervised work.',
    created_at_ms: 10,
    ...overrides,
  };
}

function versionInput(overrides = {}) {
  return {
    record_version: BUILDER_AGENT_VERSION_RECORD_VERSION,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    version_number: 1,
    instructions: 'Use bounded context only after owner-supervised admission.',
    created_at_ms: 20,
    permission_boundary: 'explicit_permission_required',
    ...overrides,
  };
}

function fixture(overrides = {}) {
  const definition = createBuilderAgentDefinitionRecord(definitionInput(overrides.definition ?? {}));
  const version = createBuilderAgentVersionRecord(versionInput(overrides.version ?? {}), definition);
  const assignment = createBuilderAgentAssignmentRecord({
    record_version: BUILDER_AGENT_ASSIGNMENT_RECORD_VERSION,
    agent_id: AGENT_ID,
    agent_version_id: version.agent_version_id,
    owner_id: OWNER_ID,
    assigned_by: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    goal: 'Prepare one bounded context snapshot before execution.',
    created_at_ms: 30,
    permission_boundary: 'explicit_permission_required',
    supervision_policy: 'owner_supervised',
    result_contract: 'review_required_before_materialization',
    budget: {
      max_steps: 12,
      max_tool_calls: 4,
      max_runtime_ms: 120_000,
      max_private_source_bytes: 32_768,
    },
    ...(overrides.assignment ?? {}),
  }, version, definition);
  const activeStatus = createBuilderAgentAssignmentStatusRecord({
    record_version: BUILDER_AGENT_ASSIGNMENT_STATUS_RECORD_VERSION,
    assignment_id: assignment.assignment_id,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    decided_by: OWNER_ID,
    next_status: 'active',
    reason: 'Owner started supervised work.',
    decided_at_ms: 40,
    ...(overrides.activeStatus ?? {}),
  }, assignment);
  const lease = createBuilderAgentSupervisionLeaseRecord({
    record_version: BUILDER_AGENT_SUPERVISION_LEASE_RECORD_VERSION,
    assignment_id: assignment.assignment_id,
    assignment_status_id: activeStatus.assignment_status_id,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    lease_holder_id: SUPERVISOR_ID,
    lease_epoch: 1,
    acquired_at_ms: 50,
    expires_at_ms: 180,
    purpose: 'Supervise one context snapshot before work.',
    redispatch_policy: 'lease_required_no_duplicate_dispatch',
    supervision_state: 'active_assignment_only',
    authority_boundary: 'main_supervision_lease_only',
    ...(overrides.lease ?? {}),
  }, assignment, activeStatus);
  return { activeStatus, assignment, definition, lease, version };
}

function auditInput(facts, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_BUDGET_AUDIT_RECORD_VERSION,
    record_kind: BUILDER_AGENT_BUDGET_AUDIT_RECORD_KIND,
    assignment_id: facts.assignment.assignment_id,
    assignment_status_id: facts.activeStatus.assignment_status_id,
    lease_id: facts.lease.lease_id,
    agent_id: AGENT_ID,
    agent_version_id: facts.assignment.agent_version_id,
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    lease_holder_id: SUPERVISOR_ID,
    observed_at_ms: 90,
    requested_next_action: 'start_step',
    budget_limits: facts.assignment.budget,
    budget_usage: {
      step_count: 2,
      tool_call_count: 0,
      runtime_ms: 2_000,
      private_source_bytes: 0,
    },
    outcome: {
      decision: 'allowed',
      reason: 'none',
    },
    audit_contract: 'assignment_budget_checked_before_agent_work',
    ...overrides,
  };
}

function auditRecord(facts, overrides = {}) {
  return createBuilderAgentBudgetAuditRecord(
    auditInput(facts, overrides),
    facts.assignment,
    facts.activeStatus,
    facts.lease,
  );
}

function baseRevision() {
  return Object.freeze({
    status: 'available',
    revision_receipt_digest: `sha256:${'e'.repeat(64)}`,
    commit_oid: 'f'.repeat(40),
  });
}

function tokenBudget() {
  return Object.freeze({
    max_input_tokens: 32_000,
    reserved_output_tokens: 4_096,
    selection_policy: 'deterministic_task_local_budget_v1',
  });
}

function seedLease(stores, facts) {
  stores.lease_store.record_lease({
    assignment: facts.assignment,
    status: facts.activeStatus,
    lease: facts.lease,
  });
}

function seedAudit(stores, facts, overrides = {}) {
  const audit = auditRecord(facts, overrides);
  stores.budget_audit_store.record_audit({
    assignment: facts.assignment,
    status: facts.activeStatus,
    lease: facts.lease,
    audit,
  });
  return audit;
}

function request(facts, audit, overrides = {}) {
  return {
    agent_definition: facts.definition,
    agent_version: facts.version,
    assignment: facts.assignment,
    active_status: facts.activeStatus,
    lease: facts.lease,
    budget_audit_id: audit.budget_audit_id,
    included_memory_ids: [MEMORY_ID],
    included_message_ids: [MESSAGE_ID, SECOND_MESSAGE_ID],
    included_artifact_ids: [ARTIFACT_ID],
    included_run_event_ids: [RUN_EVENT_ID],
    included_permission_ids: [PERMISSION_ID],
    parent_task_context_projection: null,
    base_project_revision: baseRevision(),
    token_budget: tokenBudget(),
    now_ms: 100,
    ...overrides,
  };
}

function expectedSnapshot(facts, audit, overrides = {}) {
  return createBuilderAgentTaskContextSnapshot({
    agent_definition: facts.definition,
    agent_version: facts.version,
    assignment: facts.assignment,
    active_status: facts.activeStatus,
    lease: facts.lease,
    budget_audit: audit,
    included_memory_ids: [MEMORY_ID],
    included_message_ids: [MESSAGE_ID, SECOND_MESSAGE_ID],
    included_artifact_ids: [ARTIFACT_ID],
    included_run_event_ids: [RUN_EVENT_ID],
    included_permission_ids: [PERMISSION_ID],
    parent_task_context_projection: null,
    base_project_revision: baseRevision(),
    token_budget: tokenBudget(),
    created_at_ms: 100,
    ...overrides,
  });
}

function serviceFor(t) {
  const root = temporaryRoot('clawfabric-builder-agent-task-context-snapshot-service-');
  const stores = openStores(root);
  const service = createBuilderAgentTaskContextSnapshotService(stores);
  t.after(() => {
    closeStores(stores);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, service, stores };
}

function assertServiceError(fn, code) {
  assert.throws(
    fn,
    (error) => error instanceof BuilderAgentTaskContextSnapshotServiceError
      && error.code === code
      && !/private|credential|api\.deepseek|secret-value|source text|raw prompt|file content|patch body/iu
        .test(String(error.stack)),
  );
}

test('records a task context snapshot only after a store-backed active lease and allowed budget audit', (t) => {
  const { service, stores } = serviceFor(t);
  const facts = fixture();
  seedLease(stores, facts);
  const audit = seedAudit(stores, facts);
  const expected = expectedSnapshot(facts, audit);

  const result = service.record_task_context_snapshot(request(facts, audit));
  assert.equal(result.result_version, BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_SERVICE_RESULT_VERSION);
  assert.equal(result.service_version, BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_SERVICE_VERSION);
  assert.equal(result.operation, 'agent_task_context_snapshot_recorded');
  assert.equal(result.status, 'ready');
  assert.equal(result.requested_next_action, 'start_step');
  assert.deepEqual(result.snapshot, expected);
  assert.equal(result.lease_read.active_lease.lease.lease_id, facts.lease.lease_id);
  assert.equal(result.budget_audit.budget_audit_id, audit.budget_audit_id);
  assert.equal(result.budget_audit_read.budget_audit.audit.budget_audit_id, audit.budget_audit_id);
  assert.equal(result.lease_audits.budget_audits.length, 1);
  assert.equal(result.snapshot_read.agent_task_context_snapshot.snapshot.snapshot_id, expected.snapshot_id);
  assert.equal(
    result.budget_audit_snapshot_read.agent_task_context_snapshot.snapshot.budget_audit_id,
    audit.budget_audit_id,
  );
  assert.equal(result.task_snapshots.agent_task_context_snapshots.length, 1);
  assert.equal(result.run_snapshots.agent_task_context_snapshots.length, 1);
  assert.equal(result.operations.context_snapshot_store, 'agent_task_context_snapshot_recorded');
  assert.equal(result.evidence.service_authority, 'main_owned_agent_task_context_snapshot_service');
  assert.equal(result.evidence.next_action_dispatch, false);
  assert.equal(result.evidence.provider_dispatch, false);
  assert.equal(result.evidence.tool_dispatch, false);
  assert.equal(result.evidence.source_access, 'not_present');
  assert.equal(result.evidence.source_write, 'not_present');
  assert.equal(result.evidence.revision_authority, false);
  assert.equal(result.evidence.raw_context_storage, false);

  const replay = service.record_task_context_snapshot(request(facts, audit));
  assert.equal(replay.operations.context_snapshot_store, 'agent_task_context_snapshot_replayed');
  assert.deepEqual(replay.snapshot, result.snapshot);
});

test('recovers task context snapshot service state across restart through idempotent store replay', () => {
  const root = temporaryRoot('clawfabric-builder-agent-task-context-snapshot-service-restart-');
  const facts = fixture();
  const stores = openStores(root);
  seedLease(stores, facts);
  const audit = seedAudit(stores, facts);
  const service = createBuilderAgentTaskContextSnapshotService(stores);
  const first = service.record_task_context_snapshot(request(facts, audit));
  closeStores(stores);

  const reopened = openStores(root);
  const restarted = createBuilderAgentTaskContextSnapshotService(reopened);
  const replay = restarted.record_task_context_snapshot(request(facts, audit));
  assert.equal(replay.operations.context_snapshot_store, 'agent_task_context_snapshot_replayed');
  assert.deepEqual(replay.snapshot, first.snapshot);
  closeStores(reopened);
  fs.rmSync(root, { recursive: true, force: true });
});

test('fails closed before recording snapshots for missing leases, missing audits, denied audits, and stale leases', (t) => {
  const { service, stores } = serviceFor(t);
  const facts = fixture();
  const audit = seedAudit(stores, facts);
  assertServiceError(
    () => service.record_task_context_snapshot(request(facts, audit)),
    'builder_agent_task_context_snapshot_service_conflict',
  );
  assert.equal(
    stores.context_snapshot_store.read_snapshot_for_budget_audit({
      budget_audit_id: audit.budget_audit_id,
      owner_id: OWNER_ID,
    }).status,
    'absent',
  );

  seedLease(stores, facts);
  const unrecordedAudit = auditRecord(facts, { observed_at_ms: 91 });
  assertServiceError(
    () => service.record_task_context_snapshot(request(facts, unrecordedAudit)),
    'builder_agent_task_context_snapshot_service_conflict',
  );

  const deniedAudit = seedAudit(stores, facts, {
    observed_at_ms: 92,
    requested_next_action: 'call_tool',
    budget_usage: {
      step_count: 2,
      tool_call_count: facts.assignment.budget.max_tool_calls,
      runtime_ms: 2_000,
      private_source_bytes: 0,
    },
    outcome: {
      decision: 'denied',
      reason: 'max_tool_calls_reached',
    },
  });
  assertServiceError(
    () => service.record_task_context_snapshot(request(facts, deniedAudit, { now_ms: 100 })),
    'builder_agent_task_context_snapshot_service_invalid',
  );
  assert.equal(
    stores.context_snapshot_store.read_snapshot_for_budget_audit({
      budget_audit_id: deniedAudit.budget_audit_id,
      owner_id: OWNER_ID,
    }).status,
    'absent',
  );

  assertServiceError(
    () => service.record_task_context_snapshot(request(facts, audit, { now_ms: 180 })),
    'builder_agent_task_context_snapshot_service_conflict',
  );
  assertServiceError(
    () => createBuilderAgentTaskContextSnapshotService({
      lease_store: { store_version: BUILDER_AGENT_SUPERVISION_LEASE_STORE_VERSION },
      budget_audit_store: stores.budget_audit_store,
      context_snapshot_store: stores.context_snapshot_store,
    }),
    'builder_agent_task_context_snapshot_service_invalid',
  );
  assertServiceError(
    () => createBuilderAgentTaskContextSnapshotService({
      lease_store: stores.lease_store,
      budget_audit_store: { store_version: BUILDER_AGENT_BUDGET_AUDIT_STORE_VERSION },
      context_snapshot_store: stores.context_snapshot_store,
    }),
    'builder_agent_task_context_snapshot_service_invalid',
  );
  assertServiceError(
    () => createBuilderAgentTaskContextSnapshotService({
      lease_store: stores.lease_store,
      budget_audit_store: stores.budget_audit_store,
      context_snapshot_store: { store_version: BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_STORE_VERSION },
    }),
    'builder_agent_task_context_snapshot_service_invalid',
  );
});

test('rejects hostile input without invoking traps', (t) => {
  const { service, stores } = serviceFor(t);
  const facts = fixture();
  seedLease(stores, facts);
  const audit = seedAudit(stores, facts);
  assertServiceError(
    () => service.record_task_context_snapshot(new Proxy(request(facts, audit), {})),
    'builder_agent_task_context_snapshot_service_invalid',
  );

  let invoked = false;
  const hostile = request(facts, audit);
  Object.defineProperty(hostile, 'now_ms', {
    enumerable: true,
    get() {
      invoked = true;
      throw new Error('secret-value');
    },
  });
  assertServiceError(
    () => service.record_task_context_snapshot(hostile),
    'builder_agent_task_context_snapshot_service_invalid',
  );
  assert.equal(invoked, false);
  assert.equal(
    stores.context_snapshot_store.read_snapshot_for_budget_audit({
      budget_audit_id: audit.budget_audit_id,
      owner_id: OWNER_ID,
    }).status,
    'absent',
  );
});

test('source boundary remains main-only and exposes no runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-task-context-snapshot-service.cjs'),
    'utf8',
  );

  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:http|node:https|http|https)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|dugite|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|spawn\(|writeFile|rmSync|shell:\s*true|localStorage|sessionStorage|indexedDB|eval\s*\(|new Function/iu,
  );
  assert.match(source, /service_authority: 'main_owned_agent_task_context_snapshot_service'/u);
  assert.match(source, /context_snapshot_store_authority: 'main_owned_agent_task_context_snapshot_store'/u);
  assert.match(source, /context_snapshot_contract_authority: 'main_agent_task_context_snapshot_contract_v1'/u);
  assert.match(source, /next_action_dispatch: false/u);
  assert.match(source, /provider_dispatch: false/u);
  assert.match(source, /tool_dispatch: false/u);
  assert.match(source, /source_write: 'not_present'/u);
  assert.match(source, /raw_context_storage: false/u);
});
