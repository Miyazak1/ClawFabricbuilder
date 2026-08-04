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
  BUILDER_AGENT_STEP_START_STORE_VERSION,
  createBuilderAgentStepStartStore,
} = require('../electron/builder-agent-step-start-store.cjs');
const {
  createBuilderAgentStepResultReceipt,
} = require('../electron/builder-agent-step-result-contract.cjs');
const {
  BUILDER_AGENT_STEP_RESULT_STORE_VERSION,
  createBuilderAgentStepResultStore,
} = require('../electron/builder-agent-step-result-store.cjs');
const {
  BUILDER_AGENT_STEP_PROGRESS_READ_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_STEP_PROGRESS_READ_SERVICE_VERSION,
  BuilderAgentStepProgressReadServiceError,
  createBuilderAgentStepProgressReadService,
} = require('../electron/builder-agent-step-progress-read-service.cjs');

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

function temporaryRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function removeRoot(root) {
  fs.rmSync(root, { recursive: true, force: true });
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
    purpose: 'Read sanitized Agent step progress.',
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
    instructions: 'Read recorded step starts and results without exposing receipts.',
    created_at_ms: 2,
    permission_boundary: 'explicit_permission_required',
    ...overrides,
  };
}

function stepStartReceipt(index = 1) {
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
    goal: 'Read one supervised step progress item.',
    created_at_ms: 3,
    permission_boundary: 'explicit_permission_required',
    supervision_policy: 'owner_supervised',
    result_contract: 'review_required_before_materialization',
    budget: {
      max_steps: 256,
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
    purpose: 'Supervise one progress read.',
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
    started_at_ms: admission.admitted_at_ms + 1,
  });
}

function stepResultReceipt(start, overrides = {}) {
  return createBuilderAgentStepResultReceipt({
    step_start_receipt: start,
    observed_at_ms: overrides.observed_at_ms ?? start.started_at_ms + 10,
    result: overrides.result ?? {
      status: 'succeeded',
      summary_code: 'agent_step_completed_without_raw_output',
    },
  });
}

function openStores(root) {
  const stepStartStore = createBuilderAgentStepStartStore(
    path.join(root, 'step-starts.sqlite'),
  );
  const stepResultStore = createBuilderAgentStepResultStore(
    path.join(root, 'step-results.sqlite'),
  );
  const service = createBuilderAgentStepProgressReadService({
    step_result_store: stepResultStore,
    step_start_store: stepStartStore,
  });
  return { service, stepResultStore, stepStartStore };
}

function closeStores(stores) {
  stores.stepStartStore.close();
  stores.stepResultStore.close();
}

function request(overrides = {}) {
  return {
    owner_id: overrides.owner_id ?? OWNER_ID,
    project_id: overrides.project_id ?? PROJECT_ID,
    task_id: overrides.task_id ?? TASK_ID,
    run_id: overrides.run_id ?? RUN_ID,
  };
}

function assertServiceError(error, code = 'builder_agent_step_progress_read_service_invalid') {
  assert.equal(error instanceof BuilderAgentStepProgressReadServiceError, true);
  assert.equal(error.code, code);
  assert.equal(error.retryable, code === 'builder_agent_step_progress_read_service_unavailable');
  assert.doesNotMatch(
    `${error.message}\n${error.stack}`,
    /private|credential|api\.deepseek|secret-value|source text|project:\/|permission_id|raw output|stdout|stderr/iu,
  );
  return true;
}

test('reads sanitized Agent step progress from main-owned stores', (t) => {
  const root = temporaryRoot('clawfabric-builder-agent-step-progress-read-');
  const stores = openStores(root);
  t.after(() => {
    closeStores(stores);
    removeRoot(root);
  });
  const first = stepStartReceipt(1);
  const second = stepStartReceipt(2);
  stores.stepStartStore.record_step_start({ step_start_receipt: first });
  stores.stepStartStore.record_step_start({ step_start_receipt: second });
  stores.stepResultStore.record_step_result({
    step_result_receipt: stepResultReceipt(first),
  });

  const result = stores.service.read_agent_step_progress(request());

  assert.equal(result.result_version, BUILDER_AGENT_STEP_PROGRESS_READ_SERVICE_RESULT_VERSION);
  assert.equal(result.service_version, BUILDER_AGENT_STEP_PROGRESS_READ_SERVICE_VERSION);
  assert.equal(result.operation, 'agent_step_progress_projected');
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.read_summary, {
    step_start_status: 'ready',
    step_result_status: 'ready',
    step_start_count: 2,
    step_result_count: 1,
    truncated: false,
  });
  assert.equal(result.projection.progress.items.length, 2);
  assert.equal(result.projection.progress.items[0].recorded_state, 'result_recorded');
  assert.equal(result.projection.progress.items[1].recorded_state, 'start_recorded');
  assert.equal(result.evidence.service_authority, 'main_owned_agent_step_progress_read_service');
  assert.equal(result.evidence.projection_authority, 'main_owned_step_start_and_result_store_projection');
  assert.equal(result.evidence.step_execution, false);
  assert.equal(result.evidence.provider_dispatch, false);
  assert.equal(result.evidence.tool_dispatch, false);
  assert.equal(result.evidence.raw_output_storage, false);
  assert.equal(Object.isFrozen(result), true);
  assert.doesNotMatch(
    JSON.stringify(result),
    /receipt_digest|admission_id|budget_audit|assignment_id|lease_id|agent_id|owner_id|provider_secret|credential_secret|secret-value|api\.deepseek|stdout|stderr|commit_oid|tree_oid|revision_receipt|review_id|artifact_id/iu,
  );
});

test('recovers read progress after store restart and preserves owner scope', (t) => {
  const root = temporaryRoot('clawfabric-builder-agent-step-progress-read-restart-');
  let stores = openStores(root);
  const start = stepStartReceipt(1);
  stores.stepStartStore.record_step_start({ step_start_receipt: start });
  stores.stepResultStore.record_step_result({
    step_result_receipt: stepResultReceipt(start),
  });
  closeStores(stores);

  stores = openStores(root);
  t.after(() => {
    closeStores(stores);
    removeRoot(root);
  });
  const restored = stores.service.read_agent_step_progress(request());
  assert.equal(restored.status, 'ready');
  assert.equal(restored.projection.progress.items[0].recorded_state, 'result_recorded');
  const otherOwner = stores.service.read_agent_step_progress(request({
    owner_id: OTHER_OWNER_ID,
  }));
  assert.equal(otherOwner.status, 'absent');
  assert.deepEqual(otherOwner.projection.progress.items, []);
});

test('represents absent Agent step progress as a legal empty read result', (t) => {
  const root = temporaryRoot('clawfabric-builder-agent-step-progress-read-empty-');
  const stores = openStores(root);
  t.after(() => {
    closeStores(stores);
    removeRoot(root);
  });

  const result = stores.service.read_agent_step_progress(request());

  assert.equal(result.status, 'absent');
  assert.deepEqual(result.read_summary, {
    step_start_status: 'absent',
    step_result_status: 'absent',
    step_start_count: 0,
    step_result_count: 0,
    truncated: false,
  });
  assert.equal(result.projection.progress.window, null);
});

test('fails closed when result facts are not backed by matching Step Start facts', (t) => {
  const root = temporaryRoot('clawfabric-builder-agent-step-progress-read-orphan-');
  const stores = openStores(root);
  t.after(() => {
    closeStores(stores);
    removeRoot(root);
  });
  const start = stepStartReceipt(1);
  stores.stepResultStore.record_step_result({
    step_result_receipt: stepResultReceipt(start),
  });

  assert.throws(
    () => stores.service.read_agent_step_progress(request()),
    (error) => assertServiceError(error),
  );
});

test('rejects malformed stores and hostile requests without leaking private material', (t) => {
  const root = temporaryRoot('clawfabric-builder-agent-step-progress-read-hostile-');
  const stores = openStores(root);
  t.after(() => {
    closeStores(stores);
    removeRoot(root);
  });

  assert.throws(
    () => createBuilderAgentStepProgressReadService({
      step_result_store: { store_version: 'wrong-version' },
      step_start_store: {
        store_version: BUILDER_AGENT_STEP_START_STORE_VERSION,
      },
    }),
    (error) => assertServiceError(error),
  );
  assert.throws(
    () => createBuilderAgentStepProgressReadService({
      step_result_store: {
        store_version: BUILDER_AGENT_STEP_RESULT_STORE_VERSION,
      },
      step_start_store: { store_version: 'wrong-version' },
    }),
    (error) => assertServiceError(error),
  );
  let getterCalls = 0;
  const hostile = request();
  Object.defineProperty(hostile, 'run_id', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return RUN_ID;
    },
  });
  assert.throws(
    () => stores.service.read_agent_step_progress(hostile),
    (error) => assertServiceError(error),
  );
  assert.equal(getterCalls, 0);
  assert.throws(
    () => stores.service.read_agent_step_progress(new Proxy(request(), {})),
    (error) => assertServiceError(error),
  );
  assert.throws(
    () => stores.service.read_agent_step_progress({
      ...request(),
      provider_secret: 'secret-value',
    }),
    (error) => assertServiceError(error),
  );
});

test('source boundary remains a main-only read projection service without runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-step-progress-read-service.cjs'),
    'utf8',
  );

  assert.match(source, /builder-agent-step-progress-read-service\.v1/u);
  assert.match(source, /main_owned_agent_step_progress_read_service/u);
  assert.match(source, /main_owned_step_start_and_result_store_projection/u);
  assert.match(source, /list_run_step_starts/u);
  assert.match(source, /list_run_step_results/u);
  assert.match(source, /projectBuilderAgentStepProgress/u);
  assert.match(source, /step_execution: false/u);
  assert.match(source, /provider_dispatch: false/u);
  assert.match(source, /tool_dispatch: false/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:fs|fs|node:sqlite|node:http|node:https|http|https|node:child_process|child_process)['"]\)|DatabaseSync|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|fetch\s*\(|https?:|Authorization|Bearer|execFile|spawn\s*\(|writeFile|readFile|createReadStream|eval\s*\(|new Function|shell:\s*true|record_grant|record_revocation|provider_secret|credential_secret|commit_oid|tree_oid|stdout|stderr|file_content|source_tree|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
  );
});
