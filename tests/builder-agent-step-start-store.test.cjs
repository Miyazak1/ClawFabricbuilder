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
  createBuilderAgentStepStartReceipt,
} = require('../electron/builder-agent-step-start-contract.cjs');
const {
  BUILDER_AGENT_STEP_START_STORE_READ_RESULT_VERSION,
  BUILDER_AGENT_STEP_START_STORE_RESULT_VERSION,
  BUILDER_AGENT_STEP_START_STORE_SCHEMA_VERSION,
  BUILDER_AGENT_STEP_START_STORE_USER_VERSION,
  BUILDER_AGENT_STEP_START_STORE_VERSION,
  BuilderAgentStepStartStoreError,
  createBuilderAgentStepStartStore,
} = require('../electron/builder-agent-step-start-store.cjs');

const OWNER_ID = 'builder-user:11111111-1111-4111-8111-111111111111';
const OTHER_OWNER_ID = 'builder-user:12111111-1111-4111-8111-111111111111';
const AGENT_ID = 'builder-agent:22222222-2222-4222-8222-222222222222';
const PROJECT_UUID = '33333333-3333-4333-8333-333333333333';
const PROJECT_ID = `builder-project:${PROJECT_UUID}`;
const CONVERSATION_ID = `builder-conversation:${PROJECT_UUID}`;
const TASK_ID = 'builder-task:55555555-5555-4555-8555-555555555555';
const RUN_ID = 'builder-run:66666666-6666-4666-8666-666666666666';
const SUPERVISOR_ID = 'builder-supervisor:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MESSAGE_ID = 'builder-message:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MEMORY_ID = `builder-agent-memory:${'a'.repeat(64)}`;
const ARTIFACT_ID = `builder-artifact:${'b'.repeat(64)}`;
const RUN_EVENT_ID = `builder-run-event:${'c'.repeat(64)}`;
const PERMISSION_ID = `builder-permission:${'d'.repeat(64)}`;

function temporaryDatabase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-agent-step-starts-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  return path.join(root, 'store.sqlite');
}

function requestId(index) {
  return `builder-agent-action-request:123e4567-e89b-42d3-a456-${index.toString(16).padStart(12, '0')}`;
}

function stepId(index) {
  return `builder-run-step:123e4567-e89b-42d3-a456-${index.toString(16).padStart(12, '0')}`;
}

function definitionInput(overrides = {}) {
  return {
    record_version: BUILDER_AGENT_DEFINITION_RECORD_VERSION,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    display_name: 'Builder Agent',
    purpose: 'Persist supervised step starts without executing them.',
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
    instructions: 'Start a step only after admission and budget checks.',
    created_at_ms: 2,
    permission_boundary: 'explicit_permission_required',
    ...overrides,
  };
}

function fixture(index = 1, overrides = {}) {
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
    goal: 'Persist one step start receipt.',
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
  }, version, definition);
  const activeStatus = createBuilderAgentAssignmentStatusRecord({
    record_version: BUILDER_AGENT_ASSIGNMENT_STATUS_RECORD_VERSION,
    assignment_id: assignment.assignment_id,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    decided_by: OWNER_ID,
    next_status: 'active',
    reason: 'Owner started supervised work.',
    decided_at_ms: 4,
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
    acquired_at_ms: 20,
    expires_at_ms: 620,
    purpose: 'Supervise one persisted step start.',
    redispatch_policy: 'lease_required_no_duplicate_dispatch',
    supervision_state: 'active_assignment_only',
    authority_boundary: 'main_supervision_lease_only',
  }, assignment, activeStatus);
  const budgetAudit = createBuilderAgentBudgetAuditRecord({
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
    requested_next_action: 'start_step',
    budget_limits: assignment.budget,
    budget_usage: {
      step_count: index - 1,
      tool_call_count: 0,
      runtime_ms: 100 + index,
      private_source_bytes: 0,
    },
    outcome: {
      decision: 'allowed',
      reason: 'none',
    },
    audit_contract: 'assignment_budget_checked_before_agent_work',
    ...(overrides.budget_audit ?? {}),
  }, assignment, activeStatus, lease);
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
    requested_next_action: 'start_step',
    run_status: 'running',
    interrupt_requested: false,
    cancel_requested: false,
    admitted_at_ms: snapshot.created_at_ms + 2,
  });
  const receipt = createBuilderAgentStepStartReceipt({
    supervised_action_admission: admission,
    budget_audit: budgetAudit,
    step_id: overrides.step_id ?? stepId(index),
    step_index: index,
    started_at_ms: admission.admitted_at_ms + 1,
  });
  return { admission, budgetAudit, receipt };
}

function recordRequest(receipt) {
  return { step_start_receipt: receipt };
}

function readStepRequest(receipt, overrides = {}) {
  return {
    step_id: receipt.step_id,
    owner_id: OWNER_ID,
    ...overrides,
  };
}

function admissionReadRequest(receipt, overrides = {}) {
  return {
    supervised_action_admission_id: receipt.supervised_action_admission_id,
    owner_id: OWNER_ID,
    ...overrides,
  };
}

function taskListRequest(overrides = {}) {
  return {
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    task_id: TASK_ID,
    ...overrides,
  };
}

function runListRequest(overrides = {}) {
  return {
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    ...overrides,
  };
}

function assertStoreError(fn, expectedCode = 'builder_agent_step_start_store_invalid') {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderAgentStepStartStoreError);
      assert.equal(error.code, expectedCode);
      const text = `${error.name}:${error.message}:${error.stack}`;
      assert.doesNotMatch(text, /secret-value|api\.deepseek|private marker|raw prompt|source text|file content|patch body|credential|stdout|stderr/iu);
      return true;
    },
  );
}

test('records Agent step starts then restores them after restart', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentStepStartStore(databasePath);
  const { receipt } = fixture(1);
  const recorded = store.record_step_start(recordRequest(receipt));

  assert.equal(store.store_version, BUILDER_AGENT_STEP_START_STORE_VERSION);
  assert.equal(recorded.result_version, BUILDER_AGENT_STEP_START_STORE_RESULT_VERSION);
  assert.equal(recorded.operation, 'agent_step_start_recorded');
  assert.deepEqual(recorded.agent_step_start.step_start_receipt, receipt);
  assert.equal(recorded.step_start_evidence.step_start_authority, 'main_owned_agent_step_start_store');
  assert.equal(
    recorded.step_start_evidence.step_start_receipt_authority,
    'main_agent_step_start_receipt_contract_v1',
  );
  assert.equal(recorded.step_start_evidence.renderer_authority, 'not_present');
  assert.equal(recorded.step_start_evidence.ipc_authority, 'not_present');
  assert.equal(recorded.step_start_evidence.provider_dispatch, false);
  assert.equal(recorded.step_start_evidence.model_dispatch, false);
  assert.equal(recorded.step_start_evidence.tool_dispatch, false);
  assert.equal(recorded.step_start_evidence.step_execution, false);
  assert.equal(recorded.step_start_evidence.permission_grant_authority, false);
  assert.equal(recorded.step_start_evidence.credential_storage, 'not_present');
  assert.equal(recorded.step_start_evidence.source_access, 'not_present');
  assert.equal(recorded.step_start_evidence.source_read, 'not_present');
  assert.equal(recorded.step_start_evidence.source_write, 'not_present');
  assert.equal(recorded.step_start_evidence.process_run, false);
  assert.equal(recorded.step_start_evidence.network_access, false);
  assert.equal(recorded.step_start_evidence.revision_authority, false);
  assert.equal(recorded.step_start_evidence.review_authority, false);
  assert.equal(recorded.step_start_evidence.artifact_authority, false);
  assert.equal(recorded.step_start_evidence.raw_context_storage, false);
  assert.equal(recorded.step_start_evidence.recovery_model, 'idempotent_store_replay');
  assert.equal(recorded.step_start_evidence.schema_version, BUILDER_AGENT_STEP_START_STORE_SCHEMA_VERSION);
  assert.equal(recorded.step_start_evidence.user_version, BUILDER_AGENT_STEP_START_STORE_USER_VERSION);
  assert.match(recorded.step_start_evidence.schema_fingerprint_digest, /^sha256:[0-9a-f]{64}$/u);

  assert.equal(
    store.record_step_start(recordRequest(receipt)).operation,
    'agent_step_start_replayed',
  );

  const read = store.read_step_start(readStepRequest(receipt));
  assert.equal(read.result_version, BUILDER_AGENT_STEP_START_STORE_READ_RESULT_VERSION);
  assert.equal(read.status, 'ready');
  assert.deepEqual(read.agent_step_start.step_start_receipt, receipt);
  assert.equal(Object.isFrozen(read.agent_step_start.step_start_receipt), true);

  const byAdmission = store.read_step_start_for_admission(admissionReadRequest(receipt));
  assert.equal(byAdmission.status, 'ready');
  assert.deepEqual(byAdmission.agent_step_start.step_start_receipt, receipt);

  const taskList = store.list_task_step_starts(taskListRequest());
  assert.equal(taskList.status, 'ready');
  assert.equal(taskList.agent_step_starts.length, 1);
  assert.deepEqual(taskList.agent_step_starts[0].step_start_receipt, receipt);

  const runList = store.list_run_step_starts(runListRequest());
  assert.equal(runList.status, 'ready');
  assert.equal(runList.agent_step_starts.length, 1);
  assert.deepEqual(runList.agent_step_starts[0].step_start_receipt, receipt);
  store.close();

  const restarted = createBuilderAgentStepStartStore(databasePath);
  const restored = restarted.read_step_start(readStepRequest(receipt));
  assert.equal(restored.status, 'ready');
  assert.deepEqual(restored.agent_step_start.step_start_receipt, receipt);
  restarted.close();
});

test('records multiple step starts while enforcing owner scope and one start per admission', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentStepStartStore(databasePath);
  const first = fixture(1);
  const second = fixture(2);
  store.record_step_start(recordRequest(first.receipt));
  store.record_step_start(recordRequest(second.receipt));

  const taskList = store.list_task_step_starts(taskListRequest());
  assert.equal(taskList.agent_step_starts.length, 2);
  assert.deepEqual(
    taskList.agent_step_starts.map((entry) => entry.step_start_receipt.step_index),
    [1, 2],
  );
  assert.equal(
    store.read_step_start(readStepRequest(first.receipt, { owner_id: OTHER_OWNER_ID })).status,
    'absent',
  );
  assert.equal(
    store.read_step_start_for_admission(
      admissionReadRequest(first.receipt, { owner_id: OTHER_OWNER_ID }),
    ).status,
    'absent',
  );
  assert.equal(
    store.list_task_step_starts(taskListRequest({ owner_id: OTHER_OWNER_ID })).status,
    'absent',
  );
  assert.equal(
    store.list_run_step_starts(runListRequest({ owner_id: OTHER_OWNER_ID })).status,
    'absent',
  );

  const conflictingReceipt = createBuilderAgentStepStartReceipt({
    supervised_action_admission: first.admission,
    budget_audit: first.budgetAudit,
    step_id: stepId(99),
    step_index: 1,
    started_at_ms: first.admission.admitted_at_ms + 1,
  });
  assertStoreError(
    () => store.record_step_start(recordRequest(conflictingReceipt)),
    'builder_agent_step_start_store_conflict',
  );
  store.close();
});

test('rejects hostile input, malformed reads, and tampered rows', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentStepStartStore(databasePath);
  const { receipt } = fixture(1);

  assertStoreError(() => store.record_step_start({ ...recordRequest(receipt), raw_prompt: 'secret-value' }));
  assertStoreError(() => store.read_step_start({ ...readStepRequest(receipt), extra: true }));
  assertStoreError(() => store.read_step_start_for_admission({ ...admissionReadRequest(receipt), extra: true }));
  assertStoreError(() => store.list_task_step_starts({ ...taskListRequest(), extra: true }));
  assertStoreError(() => store.list_run_step_starts({ ...runListRequest(), extra: true }));

  let getterCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'step_start_receipt', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('private marker');
    },
  });
  assertStoreError(() => store.record_step_start(accessor));
  assert.equal(getterCalls, 0);

  let proxyTrapInvoked = false;
  const proxyTrap = () => {
    proxyTrapInvoked = true;
    throw new Error('private proxy marker');
  };
  assertStoreError(() => store.record_step_start(new Proxy(
    recordRequest(receipt),
    {
      getOwnPropertyDescriptor: proxyTrap,
      getPrototypeOf: proxyTrap,
      ownKeys: proxyTrap,
    },
  )));
  assert.equal(proxyTrapInvoked, false);

  store.record_step_start(recordRequest(receipt));
  store.close();

  const raw = new DatabaseSync(databasePath);
  raw.prepare(
    `UPDATE agent_step_starts
      SET owner_id = ?
      WHERE step_id = ?`,
  ).run(OTHER_OWNER_ID, receipt.step_id);
  raw.close();

  const reopened = createBuilderAgentStepStartStore(databasePath);
  assertStoreError(
    () => reopened.read_step_start(readStepRequest(receipt)),
    'builder_agent_step_start_store_integrity_failed',
  );
  reopened.close();
});

test('rejects schema drift and unsafe database paths', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentStepStartStore(databasePath);
  store.close();

  assertStoreError(
    () => createBuilderAgentStepStartStore(path.join('relative', 'store.sqlite')),
    'builder_agent_step_start_store_invalid',
  );
  assertStoreError(
    () => createBuilderAgentStepStartStore(
      path.join(os.tmpdir(), 'missing-parent-for-step-start-store', 'store.sqlite'),
    ),
    'builder_agent_step_start_store_unavailable',
  );

  const raw = new DatabaseSync(databasePath);
  raw.exec('CREATE TABLE unexpected_agent_step_start_fact(id TEXT) STRICT');
  raw.close();
  assertStoreError(
    () => createBuilderAgentStepStartStore(databasePath),
    'builder_agent_step_start_store_integrity_failed',
  );
});

test('source boundary remains a main-only Agent step-start store without execution authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-step-start-store.cjs'),
    'utf8',
  );
  assert.match(source, /main_owned_agent_step_start_store/u);
  assert.match(source, /main_agent_step_start_receipt_contract_v1/u);
  assert.match(source, /record_step_start/u);
  assert.match(source, /read_step_start_for_admission/u);
  assert.match(source, /list_task_step_starts/u);
  assert.match(source, /list_run_step_starts/u);
  assert.match(source, /node:sqlite/u);
  assert.match(source, /step_execution: false/u);
  assert.match(source, /raw_context_storage: false/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:http|node:https|http|https)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|dugite|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|spawn\s*\(|writeFile|rmSync|shell:\s*true|localStorage|sessionStorage|indexedDB|better-sqlite|eval\s*\(|new Function|record_grant|provider_secret|credential_secret|file_content|source_tree|commit_oid|tree_oid|stdout|stderr/iu,
  );
});
