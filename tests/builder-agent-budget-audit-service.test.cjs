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
  BUILDER_AGENT_BUDGET_AUDIT_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_BUDGET_AUDIT_SERVICE_VERSION,
  BuilderAgentBudgetAuditServiceError,
  createBuilderAgentBudgetAuditService,
} = require('../electron/builder-agent-budget-audit-service.cjs');

const OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174000';
const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174004';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174005';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174006';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174007';
const SUPERVISOR_ID = 'builder-supervisor:123e4567-e89b-42d3-a456-426614174008';

function temporaryRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function openStores(root) {
  return {
    lease_store: createBuilderAgentSupervisionLeaseStore(path.join(root, 'leases.sqlite')),
    budget_audit_store: createBuilderAgentBudgetAuditStore(path.join(root, 'budget-audits.sqlite')),
  };
}

function closeStores(stores) {
  stores.lease_store.close();
  stores.budget_audit_store.close();
}

function definitionInput(overrides = {}) {
  return {
    record_version: BUILDER_AGENT_DEFINITION_RECORD_VERSION,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    display_name: 'Builder Assistant',
    purpose: 'Help the owner plan and review local Builder work.',
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
    instructions: 'Ask before changing files. Summarize proposed work before review.',
    created_at_ms: 20,
    permission_boundary: 'explicit_permission_required',
    ...overrides,
  };
}

function fixture(overrides = {}) {
  const definition = createBuilderAgentDefinitionRecord(definitionInput());
  const version = createBuilderAgentVersionRecord(versionInput(), definition);
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
    goal: 'Prepare one reviewable local Builder change.',
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
    expires_at_ms: 120,
    purpose: 'Supervise one active local assignment attempt.',
    redispatch_policy: 'lease_required_no_duplicate_dispatch',
    supervision_state: 'active_assignment_only',
    authority_boundary: 'main_supervision_lease_only',
    ...(overrides.lease ?? {}),
  }, assignment, activeStatus);
  return { activeStatus, assignment, definition, lease, version };
}

function auditInput(facts, overrides = {}) {
  const budgetUsage = overrides.budget_usage ?? {
    step_count: 3,
    tool_call_count: 1,
    runtime_ms: 4_000,
    private_source_bytes: 1_024,
  };
  const requestedNextAction = overrides.requested_next_action ?? 'start_step';
  const outcome = overrides.outcome ?? {
    decision: 'allowed',
    reason: 'none',
  };
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
    requested_next_action: requestedNextAction,
    budget_limits: facts.assignment.budget,
    budget_usage: budgetUsage,
    outcome,
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

function seedActiveLease(stores, facts) {
  stores.lease_store.record_lease({
    assignment: facts.assignment,
    status: facts.activeStatus,
    lease: facts.lease,
  });
}

function request(facts, overrides = {}) {
  return {
    assignment: facts.assignment,
    active_status: facts.activeStatus,
    lease: facts.lease,
    audit_input: auditInput(facts, overrides.audit_input ?? {}),
    now_ms: overrides.now_ms ?? 90,
  };
}

function serviceFor(t) {
  const root = temporaryRoot('clawfabric-builder-agent-budget-audit-service-');
  const stores = openStores(root);
  const service = createBuilderAgentBudgetAuditService(stores);
  t.after(() => {
    closeStores(stores);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, service, stores };
}

function assertServiceError(fn, code) {
  assert.throws(
    fn,
    (error) => error instanceof BuilderAgentBudgetAuditServiceError
      && error.code === code
      && !/private|credential|api\.deepseek|secret-value|source text|raw audit/iu.test(String(error.stack)),
  );
}

test('records an allowed budget audit only after a store-backed active lease', (t) => {
  const { service, stores } = serviceFor(t);
  const facts = fixture();
  const expectedAudit = auditRecord(facts);
  seedActiveLease(stores, facts);

  const result = service.record_budget_audit(request(facts));
  assert.equal(result.result_version, BUILDER_AGENT_BUDGET_AUDIT_SERVICE_RESULT_VERSION);
  assert.equal(result.service_version, BUILDER_AGENT_BUDGET_AUDIT_SERVICE_VERSION);
  assert.equal(result.status, 'ready');
  assert.equal(result.decision, 'allowed');
  assert.deepEqual(result.audit, expectedAudit);
  assert.equal(result.lease_read.active_lease.lease.lease_id, facts.lease.lease_id);
  assert.equal(result.audit_read.budget_audit.audit.budget_audit_id, expectedAudit.budget_audit_id);
  assert.equal(result.lease_audits.budget_audits.length, 1);
  assert.equal(result.operations.budget_audit_store, 'budget_audit_recorded');
  assert.equal(result.evidence.service_authority, 'main_owned_agent_budget_audit_service');
  assert.equal(result.evidence.next_action_dispatch, false);
  assert.equal(result.evidence.provider_dispatch, false);
  assert.equal(result.evidence.tool_dispatch, false);
  assert.equal(result.evidence.source_access, 'not_present');
  assert.equal(result.evidence.revision_authority, false);

  const replay = service.record_budget_audit(request(facts));
  assert.equal(replay.operations.budget_audit_store, 'budget_audit_replayed');
  assert.deepEqual(replay.audit, result.audit);
});

test('records a denied budget audit without dispatching the next action', (t) => {
  const { service, stores } = serviceFor(t);
  const facts = fixture();
  seedActiveLease(stores, facts);

  const result = service.record_budget_audit(request(facts, {
    audit_input: {
      observed_at_ms: 91,
      requested_next_action: 'call_tool',
      budget_usage: {
        step_count: 3,
        tool_call_count: facts.assignment.budget.max_tool_calls,
        runtime_ms: 4_000,
        private_source_bytes: 1_024,
      },
      outcome: {
        decision: 'denied',
        reason: 'max_tool_calls_reached',
      },
    },
    now_ms: 91,
  }));
  assert.equal(result.decision, 'denied');
  assert.equal(result.audit.outcome.display_summary, 'Agent budget needs owner review.');
  assert.equal(result.evidence.next_action_dispatch, false);
  assert.equal(result.evidence.permission_grant_authority, false);
  assert.equal(result.evidence.review_authority, false);
});

test('recovers budget audit service state across restart through idempotent store replay', () => {
  const root = temporaryRoot('clawfabric-builder-agent-budget-audit-service-restart-');
  const facts = fixture();
  const stores = openStores(root);
  seedActiveLease(stores, facts);
  const service = createBuilderAgentBudgetAuditService(stores);
  const first = service.record_budget_audit(request(facts));
  closeStores(stores);

  const reopened = openStores(root);
  const restarted = createBuilderAgentBudgetAuditService(reopened);
  const replay = restarted.record_budget_audit(request(facts));
  assert.equal(replay.operations.budget_audit_store, 'budget_audit_replayed');
  assert.deepEqual(replay.audit, first.audit);
  closeStores(reopened);
  fs.rmSync(root, { recursive: true, force: true });
});

test('fails closed before recording audits for missing leases, stale time, drift, and malformed stores', (t) => {
  const { service, stores } = serviceFor(t);
  const facts = fixture();
  assertServiceError(
    () => service.record_budget_audit(request(facts)),
    'builder_agent_budget_audit_service_conflict',
  );
  assert.equal(
    stores.budget_audit_store.list_lease_audits({
      lease_id: facts.lease.lease_id,
      owner_id: OWNER_ID,
    }).status,
    'absent',
  );

  seedActiveLease(stores, facts);
  assertServiceError(
    () => service.record_budget_audit(request(facts, { now_ms: 91 })),
    'builder_agent_budget_audit_service_invalid',
  );
  assertServiceError(
    () => service.record_budget_audit(request(facts, {
      audit_input: { observed_at_ms: 120 },
      now_ms: 120,
    })),
    'builder_agent_budget_audit_service_conflict',
  );
  assert.equal(
    stores.budget_audit_store.list_lease_audits({
      lease_id: facts.lease.lease_id,
      owner_id: OWNER_ID,
    }).status,
    'absent',
  );
  assertServiceError(
    () => createBuilderAgentBudgetAuditService({
      lease_store: { store_version: BUILDER_AGENT_SUPERVISION_LEASE_STORE_VERSION },
      budget_audit_store: stores.budget_audit_store,
    }),
    'builder_agent_budget_audit_service_invalid',
  );
  assertServiceError(
    () => createBuilderAgentBudgetAuditService({
      lease_store: stores.lease_store,
      budget_audit_store: { store_version: BUILDER_AGENT_BUDGET_AUDIT_STORE_VERSION },
    }),
    'builder_agent_budget_audit_service_invalid',
  );
});

test('source boundary remains main-only and exposes no runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-budget-audit-service.cjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /require\('electron'\)|ipcMain|BrowserWindow|preload|safeStorage|provider-config|provider-secret/iu);
  assert.doesNotMatch(source, /node:child_process|require\(['"]child_process['"]\)|spawn\(|execFile\(|writeFile|rmSync/iu);
  assert.match(source, /service_authority: 'main_owned_agent_budget_audit_service'/u);
  assert.match(source, /provider_dispatch: false/u);
  assert.match(source, /tool_dispatch: false/u);
  assert.match(source, /next_action_dispatch: false/u);
  assert.match(source, /source_access: 'not_present'/u);
  assert.match(source, /revision_authority: false/u);
});
