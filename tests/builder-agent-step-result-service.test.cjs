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
  createBuilderAgentBudgetAuditStore,
} = require('../electron/builder-agent-budget-audit-store.cjs');
const {
  createBuilderAgentTaskContextSnapshot,
} = require('../electron/builder-agent-task-context-snapshot.cjs');
const {
  createBuilderAgentSupervisedActionAdmission,
} = require('../electron/builder-agent-supervised-action-admission.cjs');
const {
  BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_VERSION,
  createBuilderAgentSupervisedActionAdmissionStore,
} = require('../electron/builder-agent-supervised-action-admission-store.cjs');
const {
  BUILDER_AGENT_STEP_START_STORE_VERSION,
  createBuilderAgentStepStartStore,
} = require('../electron/builder-agent-step-start-store.cjs');
const {
  createBuilderAgentStepStartService,
} = require('../electron/builder-agent-step-start-service.cjs');
const {
  BUILDER_AGENT_STEP_RESULT_STORE_VERSION,
  createBuilderAgentStepResultStore,
} = require('../electron/builder-agent-step-result-store.cjs');
const {
  BUILDER_AGENT_STEP_RESULT_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_STEP_RESULT_SERVICE_VERSION,
  BuilderAgentStepResultServiceError,
  createBuilderAgentStepResultService,
} = require('../electron/builder-agent-step-result-service.cjs');

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
    purpose: 'Record one supervised step result without executing it.',
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
    instructions: 'Record fixed step results only after a step start receipt.',
    created_at_ms: 2,
    permission_boundary: 'explicit_permission_required',
    ...overrides,
  };
}

function fixture(index = 1) {
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
    goal: 'Record one supervised step result.',
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
    purpose: 'Supervise one step result.',
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
  return { activeStatus, admission, assignment, budgetAudit, lease };
}

function serviceFor(t) {
  const root = temporaryRoot('clawfabric-builder-agent-step-result-service-');
  const budgetStore = createBuilderAgentBudgetAuditStore(
    path.join(root, 'budget-audits.sqlite'),
  );
  const admissionStore = createBuilderAgentSupervisedActionAdmissionStore(
    path.join(root, 'action-admissions.sqlite'),
  );
  const stepStartStore = createBuilderAgentStepStartStore(
    path.join(root, 'step-starts.sqlite'),
  );
  const stepResultStore = createBuilderAgentStepResultStore(
    path.join(root, 'step-results.sqlite'),
  );
  const stepStartService = createBuilderAgentStepStartService({
    budget_audit_store: budgetStore,
    step_start_store: stepStartStore,
    supervised_action_admission_store: admissionStore,
  });
  const service = createBuilderAgentStepResultService({
    step_result_store: stepResultStore,
    step_start_store: stepStartStore,
  });
  t.after(() => {
    budgetStore.close();
    admissionStore.close();
    stepStartStore.close();
    stepResultStore.close();
    removeRoot(root);
  });
  return {
    admissionStore,
    budgetStore,
    service,
    stepResultStore,
    stepStartService,
    stepStartStore,
  };
}

function seedStores(stores, records) {
  stores.budgetStore.record_audit({
    assignment: records.assignment,
    status: records.activeStatus,
    lease: records.lease,
    audit: records.budgetAudit,
  });
  stores.admissionStore.record_admission({ admission: records.admission });
}

function admitStepStart(stores, records, index = 1) {
  seedStores(stores, records);
  return stores.stepStartService.admit_agent_step_start({
    owner_id: OWNER_ID,
    supervised_action_admission_id: records.admission.admission_id,
    step_id: stepId(index),
    step_index: records.budgetAudit.budget_usage.step_count + 1,
    started_at_ms: records.admission.admitted_at_ms + 1,
  });
}

function resultRequest(stepStartResult, overrides = {}) {
  const receipt = stepStartResult.step_start_receipt;
  return {
    owner_id: overrides.owner_id ?? OWNER_ID,
    step_id: overrides.step_id ?? receipt.step_id,
    step_start_receipt_digest:
      overrides.step_start_receipt_digest ?? receipt.step_start_receipt_digest,
    observed_at_ms: overrides.observed_at_ms ?? receipt.started_at_ms + 10,
    result: overrides.result ?? {
      status: 'succeeded',
      summary_code: 'agent_step_completed_without_raw_output',
    },
  };
}

function assertServiceError(error, code = 'builder_agent_step_result_service_invalid') {
  assert.equal(error instanceof BuilderAgentStepResultServiceError, true);
  assert.equal(error.code, code);
  assert.doesNotMatch(
    `${error.message}\n${error.stack}`,
    /private|credential|api\.deepseek|secret-value|source text|project:\/|permission_id|raw output|stdout|stderr/iu,
  );
  return true;
}

test('admits a fixed Agent step result only after a recorded step start', (t) => {
  const stores = serviceFor(t);
  const records = fixture(1);
  const stepStart = admitStepStart(stores, records, 1);

  const result = stores.service.admit_agent_step_result(resultRequest(stepStart));
  assert.equal(result.result_version, BUILDER_AGENT_STEP_RESULT_SERVICE_RESULT_VERSION);
  assert.equal(result.service_version, BUILDER_AGENT_STEP_RESULT_SERVICE_VERSION);
  assert.equal(result.operation, 'agent_step_result_admitted');
  assert.equal(result.status, 'ready');
  assert.equal(result.result_status, 'succeeded');
  assert.equal(result.result_summary_code, 'agent_step_completed_without_raw_output');
  assert.equal(result.step_result_receipt.receipt_version, 'builder-agent-step-result-receipt.v1');
  assert.equal(result.step_result_receipt.receipt_kind, 'builder_agent_step_result_receipt');
  assert.equal(result.step_result_receipt.step_start_receipt_digest, stepStart.step_start_receipt.step_start_receipt_digest);
  assert.equal(result.step_result_receipt.step_id, stepStart.step_start_receipt.step_id);
  assert.equal(result.step_result_receipt.result.display_summary, 'Agent step completed. Details were not kept.');
  assert.match(result.step_result_receipt.step_result_receipt_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(result.step_result_receipt.lifecycle.step_execution, 'not_performed_by_contract');
  assert.equal(result.step_result_receipt.authority.provider_dispatch, false);
  assert.equal(result.step_result_receipt.authority.tool_dispatch, false);
  assert.equal(result.step_result_store_write.operation, 'agent_step_result_recorded');
  assert.equal(result.step_result_read.status, 'ready');
  assert.equal(result.step_start_step_result_read.status, 'ready');
  assert.equal(result.admission_step_result_read.status, 'ready');
  assert.equal(result.task_step_results.agent_step_results.length, 1);
  assert.equal(result.run_step_results.agent_step_results.length, 1);
  assert.equal(result.step_start_read.status, 'ready');
  assert.equal(result.admission_step_start_read.status, 'ready');
  assert.equal(result.task_step_starts.agent_step_starts.length, 1);
  assert.equal(result.run_step_starts.agent_step_starts.length, 1);
  assert.equal(result.operations.step_result_store, 'agent_step_result_recorded');
  assert.equal(result.evidence.service_authority, 'main_owned_agent_step_result_service');
  assert.equal(result.evidence.step_result_store_authority, 'main_owned_agent_step_result_store');
  assert.equal(result.evidence.step_result_receipt_authority, 'main_agent_step_result_receipt_contract_v1');
  assert.equal(result.evidence.step_start_store_authority, 'main_owned_agent_step_start_store');
  assert.equal(result.evidence.step_execution, false);
  assert.equal(result.evidence.provider_dispatch, false);
  assert.equal(result.evidence.tool_dispatch, false);
  assert.equal(result.evidence.raw_output_storage, false);
  assert.equal(result.evidence.revision_authority, false);

  const replay = stores.service.admit_agent_step_result(resultRequest(stepStart));
  assert.deepEqual(replay.step_result_receipt, result.step_result_receipt);
  assert.equal(replay.operations.step_result_store, 'agent_step_result_replayed');
});

test('lists multiple Agent step results while preserving owner and Run scope', (t) => {
  const stores = serviceFor(t);
  const firstStart = admitStepStart(stores, fixture(1), 1);
  const secondStart = admitStepStart(stores, fixture(2), 2);
  stores.service.admit_agent_step_result(resultRequest(firstStart));
  const blocked = stores.service.admit_agent_step_result(resultRequest(secondStart, {
    result: {
      status: 'blocked',
      summary_code: 'agent_step_needs_owner_attention',
    },
  }));

  assert.equal(blocked.result_status, 'blocked');
  assert.equal(blocked.step_result_receipt.result.display_summary, 'Agent step needs owner attention.');
  assert.deepEqual(
    blocked.task_step_results.agent_step_results.map(
      (entry) => entry.step_result_receipt.step_index,
    ),
    [1, 2],
  );
  assert.equal(
    stores.stepResultStore.read_step_result({
      owner_id: OTHER_OWNER_ID,
      step_result_receipt_digest: blocked.step_result_receipt.step_result_receipt_digest,
    }).status,
    'absent',
  );
  assert.equal(
    stores.stepResultStore.list_run_step_results({
      owner_id: OTHER_OWNER_ID,
      project_id: PROJECT_ID,
      task_id: TASK_ID,
      run_id: RUN_ID,
    }).status,
    'absent',
  );
});

test('fails closed without a recorded step start or when the result conflicts', (t) => {
  const missingStart = serviceFor(t);
  assert.throws(
    () => missingStart.service.admit_agent_step_result({
      owner_id: OWNER_ID,
      step_id: stepId(1),
      step_start_receipt_digest: `sha256:${'1'.repeat(64)}`,
      observed_at_ms: 50,
      result: {
        status: 'succeeded',
        summary_code: 'agent_step_completed_without_raw_output',
      },
    }),
    (error) => assertServiceError(error, 'builder_agent_step_result_service_conflict'),
  );

  const stores = serviceFor(t);
  const stepStart = admitStepStart(stores, fixture(3), 3);
  assert.throws(
    () => stores.service.admit_agent_step_result(resultRequest(stepStart, {
      step_start_receipt_digest: `sha256:${'2'.repeat(64)}`,
    })),
    (error) => assertServiceError(error),
  );
  assert.throws(
    () => stores.service.admit_agent_step_result(resultRequest(stepStart, {
      observed_at_ms: stepStart.step_start_receipt.started_at_ms - 1,
    })),
    (error) => assertServiceError(error),
  );

  stores.service.admit_agent_step_result(resultRequest(stepStart));
  assert.throws(
    () => stores.service.admit_agent_step_result(resultRequest(stepStart, {
      result: {
        status: 'failed',
        summary_code: 'agent_step_failed_without_raw_output',
      },
    })),
    (error) => assertServiceError(error, 'builder_agent_step_result_service_conflict'),
  );
});

test('rejects malformed stores and hostile requests without leaking private material', (t) => {
  const stores = serviceFor(t);
  const stepStart = admitStepStart(stores, fixture(4), 4);

  assert.throws(
    () => createBuilderAgentStepResultService({
      step_result_store: { store_version: 'wrong-version' },
      step_start_store: {
        store_version: BUILDER_AGENT_STEP_START_STORE_VERSION,
      },
    }),
    (error) => assertServiceError(error),
  );
  assert.throws(
    () => createBuilderAgentStepResultService({
      step_result_store: {
        store_version: BUILDER_AGENT_STEP_RESULT_STORE_VERSION,
      },
      step_start_store: { store_version: 'wrong-version' },
    }),
    (error) => assertServiceError(error),
  );
  assert.throws(
    () => createBuilderAgentStepResultService({
      step_result_store: stores.stepResultStore,
      step_start_store: {
        store_version: BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_VERSION,
      },
    }),
    (error) => assertServiceError(error),
  );

  let getterCalls = 0;
  const hostile = resultRequest(stepStart);
  Object.defineProperty(hostile, 'result', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return {
        status: 'succeeded',
        summary_code: 'agent_step_completed_without_raw_output',
      };
    },
  });
  assert.throws(
    () => stores.service.admit_agent_step_result(hostile),
    (error) => assertServiceError(error),
  );
  assert.equal(getterCalls, 0);
  assert.throws(
    () => stores.service.admit_agent_step_result(new Proxy(resultRequest(stepStart), {})),
    (error) => assertServiceError(error),
  );
  assert.throws(
    () => stores.service.admit_agent_step_result({
      ...resultRequest(stepStart),
      raw_prompt: 'secret-value',
    }),
    (error) => assertServiceError(error),
  );
});

test('source boundary remains a main-only step-result admission gate without execution authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-step-result-service.cjs'),
    'utf8',
  );

  assert.match(source, /builder-agent-step-result-service\.v1/u);
  assert.match(source, /createBuilderAgentStepResultReceipt/u);
  assert.match(source, /sanitizeBuilderAgentStepResultReceipt/u);
  assert.match(source, /main_owned_agent_step_result_service/u);
  assert.match(source, /main_owned_agent_step_result_store/u);
  assert.match(source, /main_agent_step_result_receipt_contract_v1/u);
  assert.match(source, /main_owned_agent_step_start_store/u);
  assert.match(source, /read_step_start/u);
  assert.match(source, /read_step_result_for_step_start/u);
  assert.match(source, /step_execution: false/u);
  assert.match(source, /provider_dispatch: false/u);
  assert.match(source, /tool_dispatch: false/u);
  assert.match(source, /raw_output_storage: false/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:fs|fs|node:sqlite|node:http|node:https|http|https|node:child_process|child_process)['"]\)|DatabaseSync|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|fetch\s*\(|https?:|Authorization|Bearer|execFile|spawn\s*\(|writeFile|readFile|createReadStream|eval\s*\(|new Function|shell:\s*true|record_grant|record_revocation|provider_secret|credential_secret|commit_oid|tree_oid|stdout|stderr|file_content|source_tree|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
  );
});
