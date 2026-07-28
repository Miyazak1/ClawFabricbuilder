'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');

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
  BUILDER_AGENT_BUDGET_AUDIT_RECORD_KIND,
  BUILDER_AGENT_BUDGET_AUDIT_RECORD_VERSION,
  createBuilderAgentBudgetAuditRecord,
} = require('../electron/builder-agent-budget-audit-contract.cjs');
const {
  BUILDER_AGENT_BUDGET_AUDIT_STORE_READ_RESULT_VERSION,
  BUILDER_AGENT_BUDGET_AUDIT_STORE_RESULT_VERSION,
  BUILDER_AGENT_BUDGET_AUDIT_STORE_SCHEMA_VERSION,
  BUILDER_AGENT_BUDGET_AUDIT_STORE_USER_VERSION,
  BUILDER_AGENT_BUDGET_AUDIT_STORE_VERSION,
  BuilderAgentBudgetAuditStoreError,
  createBuilderAgentBudgetAuditStore,
} = require('../electron/builder-agent-budget-audit-store.cjs');

const OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174000';
const OTHER_OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174001';
const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174004';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174005';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174006';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174007';
const SUPERVISOR_ID = 'builder-supervisor:123e4567-e89b-42d3-a456-426614174008';

function temporaryDatabase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-agent-budget-audits-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'agent-budget-audits.sqlite');
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

function assignmentInput(agentVersion, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_ASSIGNMENT_RECORD_VERSION,
    agent_id: AGENT_ID,
    agent_version_id: agentVersion.agent_version_id,
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
    ...overrides,
  };
}

function statusInput(assignmentRecord, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_ASSIGNMENT_STATUS_RECORD_VERSION,
    assignment_id: assignmentRecord.assignment_id,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    decided_by: OWNER_ID,
    next_status: 'active',
    reason: 'Owner started supervised work.',
    decided_at_ms: 40,
    ...overrides,
  };
}

function leaseInput(assignmentRecord, activeStatus, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_SUPERVISION_LEASE_RECORD_VERSION,
    assignment_id: assignmentRecord.assignment_id,
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
    ...overrides,
  };
}

function fixture(overrides = {}) {
  const agentDefinition = createBuilderAgentDefinitionRecord(definitionInput());
  const agentVersion = createBuilderAgentVersionRecord(versionInput(), agentDefinition);
  const assignmentRecord = createBuilderAgentAssignmentRecord(
    assignmentInput(agentVersion, overrides.assignment ?? {}),
    agentVersion,
    agentDefinition,
  );
  const activeStatus = createBuilderAgentAssignmentStatusRecord(
    statusInput(assignmentRecord, overrides.status ?? {}),
    assignmentRecord,
  );
  const leaseRecord = createBuilderAgentSupervisionLeaseRecord(
    leaseInput(assignmentRecord, activeStatus, overrides.lease ?? {}),
    assignmentRecord,
    activeStatus,
  );
  return { activeStatus, assignmentRecord, leaseRecord };
}

function auditInput(assignmentRecord, activeStatus, leaseRecord, overrides = {}) {
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
    assignment_id: assignmentRecord.assignment_id,
    assignment_status_id: activeStatus.assignment_status_id,
    lease_id: leaseRecord.lease_id,
    agent_id: AGENT_ID,
    agent_version_id: assignmentRecord.agent_version_id,
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    lease_holder_id: SUPERVISOR_ID,
    observed_at_ms: 90,
    requested_next_action: requestedNextAction,
    budget_limits: assignmentRecord.budget,
    budget_usage: budgetUsage,
    outcome,
    audit_contract: 'assignment_budget_checked_before_agent_work',
    ...overrides,
  };
}

function audit(assignmentRecord, activeStatus, leaseRecord, overrides = {}) {
  return createBuilderAgentBudgetAuditRecord(
    auditInput(assignmentRecord, activeStatus, leaseRecord, overrides),
    assignmentRecord,
    activeStatus,
    leaseRecord,
  );
}

function auditRequest(assignmentRecord, activeStatus, leaseRecord, auditRecord) {
  return {
    assignment: assignmentRecord,
    status: activeStatus,
    lease: leaseRecord,
    audit: auditRecord,
  };
}

function assertStoreError(fn, code = null) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderAgentBudgetAuditStoreError);
      if (code !== null) assert.equal(error.code, code);
      const text = `${error.name}:${error.message}:${error.stack}`;
      assert.doesNotMatch(text, /private|credential|api\.deepseek|secret-value|source text|raw audit|budget body/iu);
      return true;
    },
  );
}

test('records budget audits then restores them after restart', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentBudgetAuditStore(databasePath);
  const { activeStatus, assignmentRecord, leaseRecord } = fixture();
  const firstAudit = audit(assignmentRecord, activeStatus, leaseRecord);

  assert.equal(store.store_version, BUILDER_AGENT_BUDGET_AUDIT_STORE_VERSION);
  const recorded = store.record_audit(auditRequest(assignmentRecord, activeStatus, leaseRecord, firstAudit));
  assert.equal(recorded.result_version, BUILDER_AGENT_BUDGET_AUDIT_STORE_RESULT_VERSION);
  assert.equal(recorded.operation, 'budget_audit_recorded');
  assert.deepEqual(recorded.budget_audit.audit, firstAudit);
  assert.deepEqual(recorded.budget_audit.assignment, assignmentRecord);
  assert.deepEqual(recorded.budget_audit.status, activeStatus);
  assert.deepEqual(recorded.budget_audit.lease, leaseRecord);
  assert.equal(recorded.budget_audit_evidence.budget_audit_authority, 'main_owned_agent_budget_audit_store');
  assert.equal(recorded.budget_audit_evidence.renderer_authority, 'not_present');
  assert.equal(recorded.budget_audit_evidence.ipc_authority, 'not_present');
  assert.equal(recorded.budget_audit_evidence.model_dispatch, false);
  assert.equal(recorded.budget_audit_evidence.tool_dispatch, false);
  assert.equal(recorded.budget_audit_evidence.permission_grant_authority, false);
  assert.equal(recorded.budget_audit_evidence.credential_storage, 'not_present');
  assert.equal(recorded.budget_audit_evidence.source_read, 'not_present');
  assert.equal(recorded.budget_audit_evidence.source_write, 'not_present');
  assert.equal(recorded.budget_audit_evidence.process_run, false);
  assert.equal(recorded.budget_audit_evidence.revision_authority, false);
  assert.equal(recorded.budget_audit_evidence.review_authority, false);
  assert.equal(recorded.budget_audit_evidence.schema_version, BUILDER_AGENT_BUDGET_AUDIT_STORE_SCHEMA_VERSION);
  assert.equal(recorded.budget_audit_evidence.user_version, BUILDER_AGENT_BUDGET_AUDIT_STORE_USER_VERSION);
  assert.match(recorded.budget_audit_evidence.schema_fingerprint_digest, /^[a-f0-9]{64}$/u);

  assert.equal(
    store.record_audit(auditRequest(assignmentRecord, activeStatus, leaseRecord, firstAudit)).operation,
    'budget_audit_replayed',
  );

  const read = store.read_audit({ budget_audit_id: firstAudit.budget_audit_id, owner_id: OWNER_ID });
  assert.equal(read.result_version, BUILDER_AGENT_BUDGET_AUDIT_STORE_READ_RESULT_VERSION);
  assert.equal(read.status, 'ready');
  assert.deepEqual(read.budget_audit.audit, firstAudit);
  assert.equal(Object.isFrozen(read), true);
  assert.equal(Object.isFrozen(read.budget_audit), true);

  const taskList = store.list_task_audits({ owner_id: OWNER_ID, project_id: PROJECT_ID, task_id: TASK_ID });
  assert.equal(taskList.status, 'ready');
  assert.equal(taskList.budget_audits.length, 1);
  assert.deepEqual(taskList.budget_audits[0].audit, firstAudit);

  const leaseList = store.list_lease_audits({ owner_id: OWNER_ID, lease_id: leaseRecord.lease_id });
  assert.equal(leaseList.status, 'ready');
  assert.equal(leaseList.budget_audits.length, 1);
  assert.deepEqual(leaseList.budget_audits[0].audit, firstAudit);
  store.close();

  const restarted = createBuilderAgentBudgetAuditStore(databasePath);
  const restored = restarted.read_audit({ budget_audit_id: firstAudit.budget_audit_id, owner_id: OWNER_ID });
  assert.equal(restored.status, 'ready');
  assert.deepEqual(restored.budget_audit.audit, firstAudit);
  assert.deepEqual(restored.budget_audit.lease, leaseRecord);
  restarted.close();
});

test('records multiple audits per lease while enforcing owner scope', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentBudgetAuditStore(databasePath);
  const { activeStatus, assignmentRecord, leaseRecord } = fixture();
  const allowed = audit(assignmentRecord, activeStatus, leaseRecord);
  const denied = audit(assignmentRecord, activeStatus, leaseRecord, {
    observed_at_ms: 91,
    requested_next_action: 'call_tool',
    budget_usage: {
      step_count: 3,
      tool_call_count: assignmentRecord.budget.max_tool_calls,
      runtime_ms: 4_000,
      private_source_bytes: 1_024,
    },
    outcome: {
      decision: 'denied',
      reason: 'max_tool_calls_reached',
    },
  });

  store.record_audit(auditRequest(assignmentRecord, activeStatus, leaseRecord, allowed));
  store.record_audit(auditRequest(assignmentRecord, activeStatus, leaseRecord, denied));

  const leaseList = store.list_lease_audits({ owner_id: OWNER_ID, lease_id: leaseRecord.lease_id });
  assert.equal(leaseList.budget_audits.length, 2);
  assert.deepEqual(leaseList.budget_audits.map((entry) => entry.audit.outcome.decision), ['allowed', 'denied']);
  assert.equal(
    store.read_audit({ budget_audit_id: allowed.budget_audit_id, owner_id: OTHER_OWNER_ID }).status,
    'absent',
  );
  assert.equal(
    store.list_task_audits({ owner_id: OTHER_OWNER_ID, project_id: PROJECT_ID, task_id: TASK_ID }).status,
    'absent',
  );
  assert.equal(
    store.list_lease_audits({ owner_id: OTHER_OWNER_ID, lease_id: leaseRecord.lease_id }).status,
    'absent',
  );
  store.close();
});

test('rejects hostile input, inactive assignment status, malformed reads, and tampered rows', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentBudgetAuditStore(databasePath);
  const { activeStatus, assignmentRecord, leaseRecord } = fixture();
  const firstAudit = audit(assignmentRecord, activeStatus, leaseRecord);

  assertStoreError(() => store.record_audit({
    ...auditRequest(assignmentRecord, activeStatus, leaseRecord, firstAudit),
    extra: true,
  }));
  assertStoreError(() => store.read_audit({
    budget_audit_id: firstAudit.budget_audit_id,
    owner_id: OWNER_ID,
    extra: true,
  }));
  assertStoreError(() => store.list_task_audits({
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    task_id: TASK_ID,
    extra: true,
  }));
  assertStoreError(() => store.list_lease_audits({
    lease_id: leaseRecord.lease_id,
    owner_id: OWNER_ID,
    extra: true,
  }));

  let getterCalls = 0;
  const accessor = auditRequest(assignmentRecord, activeStatus, leaseRecord, firstAudit);
  Object.defineProperty(accessor, 'audit', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('private credential getter');
    },
  });
  assertStoreError(() => store.record_audit(accessor));
  assert.equal(getterCalls, 0);

  let proxyTrapInvoked = false;
  const proxyTrap = () => {
    proxyTrapInvoked = true;
    throw new Error('private proxy marker');
  };
  assertStoreError(() => store.record_audit(new Proxy(
    auditRequest(assignmentRecord, activeStatus, leaseRecord, firstAudit),
    {
      getOwnPropertyDescriptor: proxyTrap,
      getPrototypeOf: proxyTrap,
      ownKeys: proxyTrap,
    },
  )));
  assert.equal(proxyTrapInvoked, false);

  const pausedStatus = createBuilderAgentAssignmentStatusRecord({
    ...statusInput(assignmentRecord),
    next_status: 'paused',
    reason: 'Owner paused this assignment.',
    decided_at_ms: 42,
  }, assignmentRecord);
  assertStoreError(
    () => store.record_audit(auditRequest(assignmentRecord, pausedStatus, leaseRecord, firstAudit)),
    'builder_agent_budget_audit_store_invalid',
  );

  store.record_audit(auditRequest(assignmentRecord, activeStatus, leaseRecord, firstAudit));
  store.close();

  const raw = new DatabaseSync(databasePath);
  raw.prepare('UPDATE agent_budget_audits SET decision = ? WHERE budget_audit_id = ?')
    .run('denied', firstAudit.budget_audit_id);
  raw.close();

  const corrupted = createBuilderAgentBudgetAuditStore(databasePath);
  assertStoreError(
    () => corrupted.read_audit({ budget_audit_id: firstAudit.budget_audit_id, owner_id: OWNER_ID }),
    'builder_agent_budget_audit_store_integrity_failed',
  );
  corrupted.close();
});

test('rejects schema drift and unsafe database paths', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentBudgetAuditStore(databasePath);
  store.close();

  const raw = new DatabaseSync(databasePath);
  raw.exec('CREATE TABLE unexpected_budget_audit_fact (id TEXT PRIMARY KEY) STRICT');
  raw.close();

  assertStoreError(
    () => createBuilderAgentBudgetAuditStore(databasePath),
    'builder_agent_budget_audit_store_integrity_failed',
  );
  assertStoreError(
    () => createBuilderAgentBudgetAuditStore(path.join('relative', 'agent-budget-audits.sqlite')),
    'builder_agent_budget_audit_store_invalid',
  );

  const notDatabasePath = path.join(path.dirname(databasePath), 'not-a-database.sqlite');
  fs.writeFileSync(notDatabasePath, 'not sqlite private credential marker');
  assertStoreError(
    () => createBuilderAgentBudgetAuditStore(notDatabasePath),
    'builder_agent_budget_audit_store_unavailable',
  );
});

test('source boundary remains a main-only Agent budget audit store without runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-budget-audit-store.cjs'),
    'utf8',
  );
  assert.match(source, /main_owned_agent_budget_audit_store/u);
  assert.match(source, /record_audit/u);
  assert.match(source, /read_audit/u);
  assert.match(source, /list_task_audits/u);
  assert.match(source, /list_lease_audits/u);
  assert.match(source, /node:sqlite/u);
  assert.match(source, /utilTypes\.isProxy/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:http|node:https|http|https)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|dugite|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|shell:\s*true|localStorage|sessionStorage|indexedDB|better-sqlite|eval\s*\(|new Function/iu,
  );
});
