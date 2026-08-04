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
  createBuilderAgentStepResultReceipt,
} = require('../electron/builder-agent-step-result-contract.cjs');
const {
  BUILDER_AGENT_STEP_RESULT_STORE_READ_RESULT_VERSION,
  BUILDER_AGENT_STEP_RESULT_STORE_RESULT_VERSION,
  BUILDER_AGENT_STEP_RESULT_STORE_SCHEMA_VERSION,
  BUILDER_AGENT_STEP_RESULT_STORE_USER_VERSION,
  BUILDER_AGENT_STEP_RESULT_STORE_VERSION,
  BuilderAgentStepResultStoreError,
  createBuilderAgentStepResultStore,
} = require('../electron/builder-agent-step-result-store.cjs');

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-agent-step-results-'));
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
    purpose: 'Persist supervised step results without executing them.',
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
    instructions: 'Record fixed step results after a step start receipt.',
    created_at_ms: 2,
    permission_boundary: 'explicit_permission_required',
    ...overrides,
  };
}

function stepStartReceipt(index = 1, overrides = {}) {
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
    goal: 'Persist one step result receipt.',
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
    purpose: 'Supervise one persisted step result.',
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
      revision_receipt_digest: `sha256:${'f'.repeat(64)}`,
      commit_oid: '1'.repeat(40),
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
  return createBuilderAgentStepStartReceipt({
    supervised_action_admission: admission,
    budget_audit: budgetAudit,
    step_id: stepId(index),
    step_index: index,
    started_at_ms: overrides.started_at_ms ?? admission.admitted_at_ms + 1,
  });
}

function stepResultReceipt(index = 1, overrides = {}) {
  const start = overrides.step_start_receipt ?? stepStartReceipt(index, overrides);
  return createBuilderAgentStepResultReceipt({
    step_start_receipt: start,
    observed_at_ms: overrides.observed_at_ms ?? start.started_at_ms + 10,
    result: overrides.result ?? {
      status: 'succeeded',
      summary_code: 'agent_step_completed_without_raw_output',
    },
  });
}

function recordRequest(receipt) {
  return { step_result_receipt: receipt };
}

function readResultRequest(receipt, overrides = {}) {
  return {
    owner_id: overrides.owner_id ?? OWNER_ID,
    step_result_receipt_digest:
      overrides.step_result_receipt_digest ?? receipt.step_result_receipt_digest,
  };
}

function stepStartReadRequest(receipt, overrides = {}) {
  return {
    owner_id: overrides.owner_id ?? OWNER_ID,
    step_start_receipt_digest:
      overrides.step_start_receipt_digest ?? receipt.step_start_receipt_digest,
  };
}

function admissionReadRequest(receipt, overrides = {}) {
  return {
    owner_id: overrides.owner_id ?? OWNER_ID,
    supervised_action_admission_id:
      overrides.supervised_action_admission_id ?? receipt.supervised_action_admission_id,
  };
}

function taskListRequest(overrides = {}) {
  return {
    owner_id: overrides.owner_id ?? OWNER_ID,
    project_id: overrides.project_id ?? PROJECT_ID,
    task_id: overrides.task_id ?? TASK_ID,
  };
}

function runListRequest(overrides = {}) {
  return {
    owner_id: overrides.owner_id ?? OWNER_ID,
    project_id: overrides.project_id ?? PROJECT_ID,
    task_id: overrides.task_id ?? TASK_ID,
    run_id: overrides.run_id ?? RUN_ID,
  };
}

function assertStoreError(fn, expectedCode = 'builder_agent_step_result_store_invalid') {
  assert.throws(
    fn,
    (error) => error instanceof BuilderAgentStepResultStoreError
      && error.code === expectedCode
      && !/private|credential|api\.deepseek|secret-value|source text|project:\/|permission_id|raw output|stdout|stderr/iu.test(String(error.stack)),
  );
}

test('records Agent step results then restores them after restart', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentStepResultStore(databasePath);
  assert.equal(store.store_version, BUILDER_AGENT_STEP_RESULT_STORE_VERSION);
  const receipt = stepResultReceipt();
  const recorded = store.record_step_result(recordRequest(receipt));

  assert.equal(recorded.result_version, BUILDER_AGENT_STEP_RESULT_STORE_RESULT_VERSION);
  assert.equal(recorded.operation, 'agent_step_result_recorded');
  assert.deepEqual(recorded.agent_step_result.step_result_receipt, receipt);
  assert.equal(recorded.step_result_evidence.step_result_authority, 'main_owned_agent_step_result_store');
  assert.equal(
    recorded.step_result_evidence.step_result_receipt_authority,
    'main_agent_step_result_receipt_contract_v1',
  );
  assert.equal(recorded.step_result_evidence.provider_dispatch, false);
  assert.equal(recorded.step_result_evidence.tool_dispatch, false);
  assert.equal(recorded.step_result_evidence.step_execution, false);
  assert.equal(recorded.step_result_evidence.raw_output_storage, false);
  assert.equal(recorded.step_result_evidence.recovery_model, 'idempotent_store_replay');
  assert.equal(recorded.step_result_evidence.schema_version, BUILDER_AGENT_STEP_RESULT_STORE_SCHEMA_VERSION);
  assert.equal(recorded.step_result_evidence.user_version, BUILDER_AGENT_STEP_RESULT_STORE_USER_VERSION);
  assert.match(recorded.step_result_evidence.schema_fingerprint_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(
    store.record_step_result(recordRequest(receipt)).operation,
    'agent_step_result_replayed',
  );

  const read = store.read_step_result(readResultRequest(receipt));
  assert.equal(read.result_version, BUILDER_AGENT_STEP_RESULT_STORE_READ_RESULT_VERSION);
  assert.equal(read.status, 'ready');
  assert.deepEqual(read.agent_step_result.step_result_receipt, receipt);
  assert.equal(Object.isFrozen(read.agent_step_result.step_result_receipt), true);
  const byStepStart = store.read_step_result_for_step_start(stepStartReadRequest(receipt));
  assert.deepEqual(byStepStart.agent_step_result.step_result_receipt, receipt);
  const byAdmission = store.read_step_result_for_admission(admissionReadRequest(receipt));
  assert.deepEqual(byAdmission.agent_step_result.step_result_receipt, receipt);
  const taskList = store.list_task_step_results(taskListRequest());
  assert.equal(taskList.agent_step_results.length, 1);
  assert.deepEqual(taskList.agent_step_results[0].step_result_receipt, receipt);
  const runList = store.list_run_step_results(runListRequest());
  assert.equal(runList.agent_step_results.length, 1);
  assert.deepEqual(runList.agent_step_results[0].step_result_receipt, receipt);
  store.close();

  const restarted = createBuilderAgentStepResultStore(databasePath);
  const restored = restarted.read_step_result(readResultRequest(receipt));
  assert.equal(restored.status, 'ready');
  assert.deepEqual(restored.agent_step_result.step_result_receipt, receipt);
  restarted.close();
});

test('records multiple step results while enforcing owner scope and one result per started step', (t) => {
  const store = createBuilderAgentStepResultStore(temporaryDatabase(t));
  const first = stepResultReceipt(1);
  const second = stepResultReceipt(2, {
    result: {
      status: 'blocked',
      summary_code: 'agent_step_needs_owner_attention',
    },
  });
  store.record_step_result(recordRequest(first));
  store.record_step_result(recordRequest(second));

  const taskList = store.list_task_step_results(taskListRequest());
  assert.equal(taskList.agent_step_results.length, 2);
  assert.deepEqual(
    taskList.agent_step_results.map((entry) => entry.step_result_receipt.step_index),
    [1, 2],
  );
  assert.equal(
    store.read_step_result(readResultRequest(first, { owner_id: OTHER_OWNER_ID })).status,
    'absent',
  );
  assert.equal(
    store.read_step_result_for_step_start(
      stepStartReadRequest(first, { owner_id: OTHER_OWNER_ID }),
    ).status,
    'absent',
  );
  assert.equal(
    store.list_task_step_results(taskListRequest({ owner_id: OTHER_OWNER_ID })).status,
    'absent',
  );

  const conflictingReceipt = stepResultReceipt(1, {
    step_start_receipt: stepStartReceipt(1),
    result: {
      status: 'failed',
      summary_code: 'agent_step_failed_without_raw_output',
    },
  });
  assertStoreError(
    () => store.record_step_result(recordRequest(conflictingReceipt)),
    'builder_agent_step_result_store_conflict',
  );
  store.close();
});

test('rejects hostile input, malformed reads, and tampered rows', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentStepResultStore(databasePath);
  const receipt = stepResultReceipt();

  assertStoreError(() => store.record_step_result({ ...recordRequest(receipt), raw_prompt: 'secret-value' }));
  assertStoreError(() => store.read_step_result({ ...readResultRequest(receipt), extra: true }));
  assertStoreError(() => store.read_step_result_for_step_start({ ...stepStartReadRequest(receipt), extra: true }));
  assertStoreError(() => store.read_step_result_for_admission({ ...admissionReadRequest(receipt), extra: true }));
  assertStoreError(() => store.list_task_step_results({ ...taskListRequest(), extra: true }));
  assertStoreError(() => store.list_run_step_results({ ...runListRequest(), extra: true }));

  const accessor = {};
  Object.defineProperty(accessor, 'step_result_receipt', {
    enumerable: true,
    get() {
      throw new Error('secret-value');
    },
  });
  assertStoreError(() => store.record_step_result(accessor));
  assertStoreError(() => store.record_step_result(new Proxy(
    recordRequest(receipt),
    {},
  )));

  store.record_step_result(recordRequest(receipt));
  store.close();

  const raw = new DatabaseSync(databasePath);
  raw.exec(
    `UPDATE agent_step_results
      SET receipt_json = '{}'
      WHERE step_result_receipt_digest = '${receipt.step_result_receipt_digest}'`,
  );
  raw.close();
  const reopened = createBuilderAgentStepResultStore(databasePath);
  assertStoreError(
    () => reopened.read_step_result(readResultRequest(receipt)),
    'builder_agent_step_result_store_integrity_failed',
  );
  reopened.close();
});

test('rejects schema drift and unsafe database paths', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-step-result-schema-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const databasePath = path.join(root, 'store.sqlite');
  const store = createBuilderAgentStepResultStore(databasePath);
  store.close();
  const raw = new DatabaseSync(databasePath);
  raw.exec('CREATE TABLE unexpected_agent_step_result_fact(id TEXT) STRICT');
  raw.close();
  assertStoreError(
    () => createBuilderAgentStepResultStore(databasePath),
    'builder_agent_step_result_store_integrity_failed',
  );
  assertStoreError(
    () => createBuilderAgentStepResultStore(`${databasePath} `),
    'builder_agent_step_result_store_invalid',
  );
  const missingParent = path.join(root, 'missing', 'store.sqlite');
  assertStoreError(
    () => createBuilderAgentStepResultStore(missingParent),
    'builder_agent_step_result_store_unavailable',
  );
});

test('source boundary remains a main-only Agent step result store without runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-step-result-store.cjs'),
    'utf8',
  );

  assert.match(source, /main_owned_agent_step_result_store/u);
  assert.match(source, /main_agent_step_result_receipt_contract_v1/u);
  assert.match(source, /record_step_result/u);
  assert.match(source, /read_step_result_for_step_start/u);
  assert.match(source, /read_step_result_for_admission/u);
  assert.match(source, /list_task_step_results/u);
  assert.match(source, /list_run_step_results/u);
  assert.doesNotMatch(source, /require\('electron'\)|ipcMain|BrowserWindow|preload|safeStorage|provider-config|provider-secret/iu);
  assert.doesNotMatch(source, /node:child_process|require\(['"]child_process['"]\)|spawn\(|execFile\(|writeFile|rmSync|readFile/iu);
  assert.match(source, /step_execution: false/u);
  assert.match(source, /raw_output_storage: false/u);
  assert.match(source, /revision_authority: false/u);
  assert.match(source, /review_authority: false/u);
  assert.match(source, /artifact_authority: false/u);
});
