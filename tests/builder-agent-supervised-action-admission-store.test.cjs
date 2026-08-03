'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
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
  BUILDER_AGENT_BUDGET_AUDIT_RECORD_KIND,
  BUILDER_AGENT_BUDGET_AUDIT_RECORD_VERSION,
  createBuilderAgentBudgetAuditRecord,
} = require('../electron/builder-agent-budget-audit-contract.cjs');
const {
  createBuilderAgentTaskContextSnapshot,
} = require('../electron/builder-agent-task-context-snapshot.cjs');
const {
  createBuilderAgentSupervisedActionAdmission,
} = require('../electron/builder-agent-supervised-action-admission.cjs');
const {
  BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_READ_RESULT_VERSION,
  BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_RESULT_VERSION,
  BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_SCHEMA_VERSION,
  BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_USER_VERSION,
  BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_VERSION,
  BuilderAgentSupervisedActionAdmissionStoreError,
  createBuilderAgentSupervisedActionAdmissionStore,
} = require('../electron/builder-agent-supervised-action-admission-store.cjs');

const OWNER_ID = 'builder-user:11111111-1111-4111-8111-111111111111';
const OTHER_OWNER_ID = 'builder-user:12111111-1111-4111-8111-111111111111';
const AGENT_ID = 'builder-agent:22222222-2222-4222-8222-222222222222';
const PROJECT_ID = 'builder-project:33333333-3333-4333-8333-333333333333';
const CONVERSATION_ID = 'builder-conversation:44444444-4444-4444-8444-444444444444';
const TASK_ID = 'builder-task:55555555-5555-4555-8555-555555555555';
const RUN_ID = 'builder-run:66666666-6666-4666-8666-666666666666';
const SUPERVISOR_ID = 'builder-supervisor:77777777-7777-4777-8777-777777777777';
const MESSAGE_ID = 'builder-message:88888888-8888-4888-8888-888888888888';
const MEMORY_ID = `builder-agent-memory:${'a'.repeat(64)}`;
const ARTIFACT_ID = `builder-artifact:${'b'.repeat(64)}`;
const RUN_EVENT_ID = `builder-run-event:${'c'.repeat(64)}`;
const PERMISSION_ID = `builder-permission:${'d'.repeat(64)}`;

function temporaryDatabase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-agent-supervised-action-admissions-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  return path.join(root, 'store.sqlite');
}

function requestId(index) {
  return `builder-agent-action-request:123e4567-e89b-42d3-a456-${index.toString(16).padStart(12, '0')}`;
}

function definitionInput(overrides = {}) {
  return {
    record_version: BUILDER_AGENT_DEFINITION_RECORD_VERSION,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    display_name: 'Builder Agent',
    purpose: 'Persist one supervised action admission.',
    created_at_ms: 1,
    ...overrides,
  };
}

function versionInput(overrides = {}) {
  return {
    record_version: BUILDER_AGENT_VERSION_RECORD_VERSION,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    version_number: 1,
    instructions: 'Admit bounded actions only after a store-backed context snapshot.',
    created_at_ms: 2,
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
    goal: 'Persist one supervised action admission without execution authority.',
    created_at_ms: 3,
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

function activeStatusInput(assignment, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_ASSIGNMENT_STATUS_RECORD_VERSION,
    assignment_id: assignment.assignment_id,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    decided_by: OWNER_ID,
    next_status: 'active',
    reason: 'Owner activated this supervised assignment.',
    decided_at_ms: 4,
    ...overrides,
  };
}

function leaseInput(assignment, activeStatus, overrides = {}) {
  return {
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
    acquired_at_ms: 20,
    expires_at_ms: 620,
    purpose: 'Supervise one persisted action admission.',
    redispatch_policy: 'lease_required_no_duplicate_dispatch',
    supervision_state: 'active_assignment_only',
    authority_boundary: 'main_supervision_lease_only',
    ...overrides,
  };
}

function budgetAuditInput(assignment, activeStatus, lease, action, index, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_BUDGET_AUDIT_RECORD_VERSION,
    record_kind: BUILDER_AGENT_BUDGET_AUDIT_RECORD_KIND,
    assignment_id: assignment.assignment_id,
    assignment_status_id: activeStatus.assignment_status_id,
    lease_id: lease.lease_id,
    agent_id: AGENT_ID,
    agent_version_id: assignment.agent_version_id,
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    lease_holder_id: SUPERVISOR_ID,
    observed_at_ms: 30 + index,
    requested_next_action: action,
    budget_limits: assignment.budget,
    budget_usage: {
      step_count: action === 'start_step' ? index - 1 : index,
      tool_call_count: 0,
      runtime_ms: 100 + index,
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

function fixture(action = 'start_step', index = 1) {
  const definition = createBuilderAgentDefinitionRecord(definitionInput());
  const version = createBuilderAgentVersionRecord(versionInput(), definition);
  const assignment = createBuilderAgentAssignmentRecord(
    assignmentInput(version),
    version,
    definition,
  );
  const activeStatus = createBuilderAgentAssignmentStatusRecord(activeStatusInput(assignment), assignment);
  const lease = createBuilderAgentSupervisionLeaseRecord(
    leaseInput(assignment, activeStatus),
    assignment,
    activeStatus,
  );
  const budgetAudit = createBuilderAgentBudgetAuditRecord(
    budgetAuditInput(assignment, activeStatus, lease, action, index),
    assignment,
    activeStatus,
    lease,
  );
  const snapshot = createBuilderAgentTaskContextSnapshot({
    agent_definition: definition,
    agent_version: version,
    assignment,
    active_status: activeStatus,
    lease,
    budget_audit: budgetAudit,
    included_memory_ids: [MEMORY_ID],
    included_message_ids: [MESSAGE_ID],
    included_artifact_ids: [ARTIFACT_ID],
    included_run_event_ids: [RUN_EVENT_ID],
    included_permission_ids: [PERMISSION_ID],
    parent_task_context_projection: null,
    base_project_revision: {
      status: 'available',
      revision_receipt_digest: `sha256:${'e'.repeat(64)}`,
      commit_oid: 'f'.repeat(40),
    },
    token_budget: {
      max_input_tokens: 32_000,
      reserved_output_tokens: 4_096,
      selection_policy: 'deterministic_task_local_budget_v1',
    },
    created_at_ms: 40 + index,
  });
  const admission = createBuilderAgentSupervisedActionAdmission({
    context_snapshot: snapshot,
    action_request_id: requestId(index),
    requested_next_action: action,
    run_status: 'running',
    interrupt_requested: false,
    cancel_requested: false,
    admitted_at_ms: 45 + index,
  });
  return { admission, snapshot };
}

function recordRequest(records) {
  return { admission: records.admission };
}

function readRequest(records, overrides = {}) {
  return {
    admission_id: records.admission.admission_id,
    owner_id: OWNER_ID,
    ...overrides,
  };
}

function snapshotReadRequest(records, overrides = {}) {
  return {
    snapshot_id: records.snapshot.snapshot_id,
    owner_id: OWNER_ID,
    ...overrides,
  };
}

function listTaskRequest(overrides = {}) {
  return {
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    task_id: TASK_ID,
    ...overrides,
  };
}

function listRunRequest(overrides = {}) {
  return {
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    ...overrides,
  };
}

function assertStoreError(fn, expectedCode = 'builder_agent_supervised_action_admission_store_invalid') {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderAgentSupervisedActionAdmissionStoreError);
      assert.equal(error.code, expectedCode);
      const text = `${error.name}:${error.message}:${error.stack}`;
      assert.doesNotMatch(text, /secret-value|api\.deepseek|private marker|raw prompt|source text|file content|patch body|credential/iu);
      return true;
    },
  );
}

test('records supervised action admissions then restores them after restart', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentSupervisedActionAdmissionStore(databasePath);
  const records = fixture('start_step', 1);
  const recorded = store.record_admission(recordRequest(records));

  assert.equal(store.store_version, BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_VERSION);
  assert.equal(recorded.result_version, BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_RESULT_VERSION);
  assert.equal(recorded.operation, 'supervised_action_admission_recorded');
  assert.deepEqual(recorded.supervised_action_admission.admission, records.admission);
  assert.equal(
    recorded.admission_evidence.admission_authority,
    'main_owned_agent_supervised_action_admission_store',
  );
  assert.equal(
    recorded.admission_evidence.admission_contract_authority,
    'main_agent_supervised_action_admission_contract_v1',
  );
  assert.equal(recorded.admission_evidence.renderer_authority, 'not_present');
  assert.equal(recorded.admission_evidence.ipc_authority, 'not_present');
  assert.equal(recorded.admission_evidence.provider_dispatch, false);
  assert.equal(recorded.admission_evidence.model_dispatch, false);
  assert.equal(recorded.admission_evidence.tool_dispatch, false);
  assert.equal(recorded.admission_evidence.permission_grant_authority, false);
  assert.equal(recorded.admission_evidence.credential_storage, 'not_present');
  assert.equal(recorded.admission_evidence.source_access, 'not_present');
  assert.equal(recorded.admission_evidence.source_read, 'not_present');
  assert.equal(recorded.admission_evidence.source_write, 'not_present');
  assert.equal(recorded.admission_evidence.process_run, false);
  assert.equal(recorded.admission_evidence.network_access, false);
  assert.equal(recorded.admission_evidence.revision_authority, false);
  assert.equal(recorded.admission_evidence.review_authority, false);
  assert.equal(recorded.admission_evidence.artifact_authority, false);
  assert.equal(recorded.admission_evidence.raw_context_storage, false);
  assert.equal(recorded.admission_evidence.next_action_dispatch, false);
  assert.equal(recorded.admission_evidence.recovery_model, 'idempotent_store_replay');
  assert.equal(
    recorded.admission_evidence.schema_version,
    BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_SCHEMA_VERSION,
  );
  assert.equal(
    recorded.admission_evidence.user_version,
    BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_USER_VERSION,
  );
  assert.match(recorded.admission_evidence.schema_fingerprint_digest, /^sha256:[0-9a-f]{64}$/u);

  assert.equal(
    store.record_admission(recordRequest(records)).operation,
    'supervised_action_admission_replayed',
  );

  const read = store.read_admission(readRequest(records));
  assert.equal(read.result_version, BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_READ_RESULT_VERSION);
  assert.equal(read.status, 'ready');
  assert.deepEqual(read.supervised_action_admission.admission, records.admission);
  assert.equal(Object.isFrozen(read.supervised_action_admission.admission), true);

  const bySnapshot = store.read_admission_for_snapshot(snapshotReadRequest(records));
  assert.equal(bySnapshot.status, 'ready');
  assert.deepEqual(bySnapshot.supervised_action_admission.admission, records.admission);

  const taskList = store.list_task_admissions(listTaskRequest());
  assert.equal(taskList.status, 'ready');
  assert.equal(taskList.supervised_action_admissions.length, 1);
  assert.deepEqual(taskList.supervised_action_admissions[0].admission, records.admission);

  const runList = store.list_run_admissions(listRunRequest());
  assert.equal(runList.status, 'ready');
  assert.equal(runList.supervised_action_admissions.length, 1);
  assert.deepEqual(runList.supervised_action_admissions[0].admission, records.admission);
  store.close();

  const restarted = createBuilderAgentSupervisedActionAdmissionStore(databasePath);
  const restored = restarted.read_admission(readRequest(records));
  assert.equal(restored.status, 'ready');
  assert.deepEqual(restored.supervised_action_admission.admission, records.admission);
  restarted.close();
});

test('records all next actions while enforcing owner scope and one admission per snapshot', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentSupervisedActionAdmissionStore(databasePath);
  const actions = ['start_step', 'call_tool', 'read_private_source', 'finish_for_review'];
  const records = actions.map((action, index) => fixture(action, index + 1));
  for (const record of records) store.record_admission(recordRequest(record));

  const taskList = store.list_task_admissions(listTaskRequest());
  assert.equal(taskList.supervised_action_admissions.length, 4);
  assert.deepEqual(
    taskList.supervised_action_admissions.map((entry) => entry.admission.requested_next_action),
    actions,
  );
  assert.equal(
    store.read_admission(readRequest(records[0], { owner_id: OTHER_OWNER_ID })).status,
    'absent',
  );
  assert.equal(
    store.read_admission_for_snapshot(snapshotReadRequest(records[0], { owner_id: OTHER_OWNER_ID })).status,
    'absent',
  );

  const conflicting = createBuilderAgentSupervisedActionAdmission({
    context_snapshot: records[0].snapshot,
    action_request_id: requestId(99),
    requested_next_action: records[0].snapshot.action_admission.requested_next_action,
    run_status: 'running',
    interrupt_requested: false,
    cancel_requested: false,
    admitted_at_ms: records[0].admission.admitted_at_ms + 1,
  });
  assertStoreError(
    () => store.record_admission({ admission: conflicting }),
    'builder_agent_supervised_action_admission_store_conflict',
  );
  store.close();
});

test('rejects hostile input, malformed reads, and tampered rows', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentSupervisedActionAdmissionStore(databasePath);
  const records = fixture('call_tool', 2);
  assertStoreError(() => store.record_admission({ ...recordRequest(records), raw_prompt: 'secret-value' }));
  assertStoreError(() => store.read_admission({ ...readRequest(records), extra: true }));
  assertStoreError(() => store.read_admission_for_snapshot({ ...snapshotReadRequest(records), extra: true }));
  assertStoreError(() => store.list_task_admissions({ ...listTaskRequest(), extra: true }));
  assertStoreError(() => store.list_run_admissions({ ...listRunRequest(), extra: true }));

  let getterCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'admission', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('private marker');
    },
  });
  assertStoreError(() => store.record_admission(accessor));
  assert.equal(getterCalls, 0);

  let proxyTrapInvoked = false;
  const proxyTrap = () => {
    proxyTrapInvoked = true;
    throw new Error('private proxy marker');
  };
  assertStoreError(() => store.record_admission(new Proxy(
    recordRequest(records),
    {
      getOwnPropertyDescriptor: proxyTrap,
      getPrototypeOf: proxyTrap,
      ownKeys: proxyTrap,
    },
  )));
  assert.equal(proxyTrapInvoked, false);

  store.record_admission(recordRequest(records));
  store.close();

  const raw = new DatabaseSync(databasePath);
  raw.prepare(
    `UPDATE agent_supervised_action_admissions
      SET admitted_at_ms = ?
      WHERE admission_id = ?`,
  ).run(records.admission.admitted_at_ms + 1, records.admission.admission_id);
  raw.close();

  const reopened = createBuilderAgentSupervisedActionAdmissionStore(databasePath);
  assertStoreError(
    () => reopened.read_admission(readRequest(records)),
    'builder_agent_supervised_action_admission_store_integrity_failed',
  );
  reopened.close();
});

test('rejects schema drift and unsafe database paths', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentSupervisedActionAdmissionStore(databasePath);
  store.close();

  assertStoreError(
    () => createBuilderAgentSupervisedActionAdmissionStore(path.join('relative', 'store.sqlite')),
    'builder_agent_supervised_action_admission_store_invalid',
  );
  assertStoreError(
    () => createBuilderAgentSupervisedActionAdmissionStore(
      path.join(os.tmpdir(), 'missing-parent-for-supervised-action-admission-store', 'store.sqlite'),
    ),
    'builder_agent_supervised_action_admission_store_unavailable',
  );

  const raw = new DatabaseSync(databasePath);
  raw.exec('CREATE TABLE unexpected_supervised_action_admission_fact(id TEXT) STRICT');
  raw.close();
  assertStoreError(
    () => createBuilderAgentSupervisedActionAdmissionStore(databasePath),
    'builder_agent_supervised_action_admission_store_integrity_failed',
  );
});

test('source boundary remains a main-only supervised action admission store without runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-supervised-action-admission-store.cjs'),
    'utf8',
  );
  assert.match(source, /main_owned_agent_supervised_action_admission_store/u);
  assert.match(source, /main_agent_supervised_action_admission_contract_v1/u);
  assert.match(source, /record_admission/u);
  assert.match(source, /read_admission_for_snapshot/u);
  assert.match(source, /list_task_admissions/u);
  assert.match(source, /list_run_admissions/u);
  assert.match(source, /node:sqlite/u);
  assert.match(source, /next_action_dispatch: false/u);
  assert.match(source, /raw_context_storage: false/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:http|node:https|http|https)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|dugite|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|spawn\s*\(|writeFile|rmSync|shell:\s*true|localStorage|sessionStorage|indexedDB|better-sqlite|eval\s*\(|new Function|record_grant|provider_secret|credential_secret|file_content|source_tree|commit_oid|tree_oid|stdout|stderr/iu,
  );
});
