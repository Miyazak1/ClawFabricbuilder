'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
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
  BUILDER_AGENT_STEP_START_STORE_READ_RESULT_VERSION,
} = require('../electron/builder-agent-step-start-store.cjs');
const {
  createBuilderAgentStepResultReceipt,
} = require('../electron/builder-agent-step-result-contract.cjs');
const {
  BUILDER_AGENT_STEP_RESULT_STORE_READ_RESULT_VERSION,
} = require('../electron/builder-agent-step-result-store.cjs');
const {
  BUILDER_AGENT_STEP_PROGRESS_PROJECTION_VERSION,
  MAX_AGENT_STEP_PROGRESS_BYTES,
  MAX_AGENT_STEP_PROGRESS_INPUTS,
  MAX_AGENT_STEP_PROGRESS_ITEMS,
  BuilderAgentStepProgressProjectionError,
  projectBuilderAgentStepProgress,
} = require('../electron/builder-agent-step-progress-projection.cjs');

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
    purpose: 'Project sanitized Agent step progress.',
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
    instructions: 'Project recorded step starts and results without raw output.',
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
    goal: 'Project one supervised step progress item.',
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
    purpose: 'Supervise one projected step.',
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
    step_id: overrides.step_id ?? stepId(index),
    step_index: index,
    started_at_ms: overrides.started_at_ms ?? admission.admitted_at_ms + 1,
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

function stepStartList(receipts) {
  return {
    result_version: BUILDER_AGENT_STEP_START_STORE_READ_RESULT_VERSION,
    step_start_authority: 'main_owned_agent_step_start_store',
    status: receipts.length === 0 ? 'absent' : 'ready',
    agent_step_starts: receipts.map((receipt) => ({ step_start_receipt: receipt })),
    truncated: false,
    evidence: { ignored: 'not_projected' },
  };
}

function stepResultList(receipts) {
  return {
    result_version: BUILDER_AGENT_STEP_RESULT_STORE_READ_RESULT_VERSION,
    step_result_authority: 'main_owned_agent_step_result_store',
    status: receipts.length === 0 ? 'absent' : 'ready',
    agent_step_results: receipts.map((receipt) => ({ step_result_receipt: receipt })),
    truncated: false,
    evidence: { ignored: 'not_projected' },
  };
}

function input(starts, results, overrides = {}) {
  return {
    owner_id: overrides.owner_id ?? OWNER_ID,
    project_id: overrides.project_id ?? PROJECT_ID,
    task_id: overrides.task_id ?? TASK_ID,
    run_id: overrides.run_id ?? RUN_ID,
    step_starts: overrides.step_starts ?? stepStartList(starts),
    step_results: overrides.step_results ?? stepResultList(results),
  };
}

function assertProjectionError(error) {
  assert.equal(error instanceof BuilderAgentStepProgressProjectionError, true);
  assert.equal(error.code, 'builder_agent_step_progress_unavailable');
  assert.equal(error.message, 'Agent progress is unavailable.');
  assert.equal(error.retryable, true);
  assert.equal(error.stack, `${error.name}: ${error.message}`);
  return true;
}

test('projects recorded Agent step starts and results into renderer-safe progress', () => {
  const first = stepStartReceipt(1);
  const second = stepStartReceipt(2);
  const firstResult = stepResultReceipt(first);

  const projection = projectBuilderAgentStepProgress(input([first, second], [firstResult]));

  assert.equal(projection.projection_version, BUILDER_AGENT_STEP_PROGRESS_PROJECTION_VERSION);
  assert.equal(projection.project_id, PROJECT_ID);
  assert.equal(projection.task_id, TASK_ID);
  assert.equal(projection.run_id, RUN_ID);
  assert.deepEqual(projection.progress.window, {
    first_step_index: 1,
    last_step_index: 2,
    has_earlier: false,
  });
  assert.deepEqual(projection.progress.items, [
    {
      item_kind: 'agent_step_progress',
      step_id: first.step_id,
      step_index: 1,
      recorded_state: 'result_recorded',
      result: {
        status: 'succeeded',
        summary_code: 'agent_step_completed_without_raw_output',
        display_summary: 'Agent step completed. Details were not kept.',
      },
      summary: {
        status: 'succeeded',
        display_summary: 'Agent step completed. Details were not kept.',
      },
    },
    {
      item_kind: 'agent_step_progress',
      step_id: second.step_id,
      step_index: 2,
      recorded_state: 'start_recorded',
      result: null,
      summary: {
        status: 'started',
        display_summary: 'Agent step start was recorded.',
      },
    },
  ]);
  assert.deepEqual(projection.authority, {
    agent_step_source: 'main_owned_step_start_and_result_store_projection',
    step_start_receipt: 'verified_not_exposed',
    step_result_receipt: 'verified_not_exposed',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    model_dispatch: false,
    tool_dispatch: false,
    step_execution: false,
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
    raw_output_storage: false,
    raw_context_storage: false,
  });
  assert.equal(Object.isFrozen(projection), true);
  assert.equal(Object.isFrozen(projection.progress.items), true);
  assert.ok(Buffer.byteLength(JSON.stringify(projection), 'utf8') <= MAX_AGENT_STEP_PROGRESS_BYTES);
});

test('projects all fixed terminal step result summaries without raw output', () => {
  const starts = [1, 2, 3, 4].map((index) => stepStartReceipt(index));
  const results = [
    stepResultReceipt(starts[0]),
    stepResultReceipt(starts[1], {
      result: {
        status: 'blocked',
        summary_code: 'agent_step_needs_owner_attention',
      },
    }),
    stepResultReceipt(starts[2], {
      result: {
        status: 'failed',
        summary_code: 'agent_step_failed_without_raw_output',
      },
    }),
    stepResultReceipt(starts[3], {
      result: {
        status: 'cancelled',
        summary_code: 'agent_step_cancelled_without_raw_output',
      },
    }),
  ];

  const projection = projectBuilderAgentStepProgress(input(starts, results));

  assert.deepEqual(
    projection.progress.items.map((item) => item.result),
    [
      {
        status: 'succeeded',
        summary_code: 'agent_step_completed_without_raw_output',
        display_summary: 'Agent step completed. Details were not kept.',
      },
      {
        status: 'blocked',
        summary_code: 'agent_step_needs_owner_attention',
        display_summary: 'Agent step needs owner attention.',
      },
      {
        status: 'failed',
        summary_code: 'agent_step_failed_without_raw_output',
        display_summary: 'Agent step could not finish. Details were not kept.',
      },
      {
        status: 'cancelled',
        summary_code: 'agent_step_cancelled_without_raw_output',
        display_summary: 'Agent step was stopped. Details were not kept.',
      },
    ],
  );
  assert.doesNotMatch(
    JSON.stringify(projection),
    /receipt_digest|admission_id|budget_audit|assignment_id|lease_id|agent_id|owner_id|provider_secret|credential_secret|secret-value|api\.deepseek|stdout|stderr|commit_oid|tree_oid|revision_receipt|review_id|artifact_id/iu,
  );
});

test('represents absent progress as an empty legal projection', () => {
  const projection = projectBuilderAgentStepProgress(input([], []));

  assert.equal(projection.progress.window, null);
  assert.deepEqual(projection.progress.items, []);
  assert.equal(projection.authority.step_execution, false);
});

test('bounds the public window after validating every supplied step', () => {
  const starts = [];
  const results = [];
  for (let index = 1; index <= MAX_AGENT_STEP_PROGRESS_ITEMS + 2; index += 1) {
    const start = stepStartReceipt(index);
    starts.push(start);
    results.push(stepResultReceipt(start));
  }

  const projection = projectBuilderAgentStepProgress(input(starts, results));

  assert.equal(MAX_AGENT_STEP_PROGRESS_ITEMS, 128);
  assert.equal(MAX_AGENT_STEP_PROGRESS_INPUTS, 256);
  assert.equal(projection.progress.items.length, MAX_AGENT_STEP_PROGRESS_ITEMS);
  assert.deepEqual(projection.progress.window, {
    first_step_index: 3,
    last_step_index: 130,
    has_earlier: true,
  });

  const forgedStarts = structuredClone(starts);
  forgedStarts[0].step_id = stepId(255);
  assert.throws(
    () => projectBuilderAgentStepProgress(input(forgedStarts, results)),
    assertProjectionError,
  );
});

test('rejects orphan, duplicate, owner-drifted, and malformed step facts', () => {
  const first = stepStartReceipt(1);
  const second = stepStartReceipt(2);
  const orphanResult = stepResultReceipt(second);
  assert.throws(
    () => projectBuilderAgentStepProgress(input([first], [orphanResult])),
    assertProjectionError,
  );
  assert.throws(
    () => projectBuilderAgentStepProgress(input([first, first], [])),
    assertProjectionError,
  );
  assert.throws(
    () => projectBuilderAgentStepProgress(input([first], [stepResultReceipt(first)], {
      owner_id: OTHER_OWNER_ID,
    })),
    assertProjectionError,
  );
  assert.throws(
    () => projectBuilderAgentStepProgress(input([first], [], {
      step_starts: {
        ...stepStartList([first]),
        result_version: 'wrong',
      },
    })),
    assertProjectionError,
  );
  assert.throws(
    () => projectBuilderAgentStepProgress(input([first], [], {
      step_results: {
        ...stepResultList([]),
        status: 'ready',
      },
    })),
    assertProjectionError,
  );
});

test('rejects hostile input with one fixed redacted error', () => {
  const start = stepStartReceipt(1);
  const result = stepResultReceipt(start);
  const valid = input([start], [result]);
  const extra = { ...valid, private_marker: 'secret-value' };
  const sparseStarts = stepStartList([start]);
  delete sparseStarts.agent_step_starts[0];
  let getterCalls = 0;
  const accessorStarts = stepStartList([start]);
  Object.defineProperty(accessorStarts.agent_step_starts, '0', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return { step_start_receipt: start };
    },
  });
  const customPrototypeResults = stepResultList([result]);
  Object.setPrototypeOf(customPrototypeResults.agent_step_results, {
    map() {
      getterCalls += 1;
      return [];
    },
  });

  assert.throws(() => projectBuilderAgentStepProgress(extra), assertProjectionError);
  assert.throws(
    () => projectBuilderAgentStepProgress(input([start], [result], {
      step_starts: sparseStarts,
    })),
    assertProjectionError,
  );
  assert.throws(
    () => projectBuilderAgentStepProgress(input([start], [result], {
      step_starts: accessorStarts,
    })),
    assertProjectionError,
  );
  assert.throws(
    () => projectBuilderAgentStepProgress(input([start], [result], {
      step_results: customPrototypeResults,
    })),
    assertProjectionError,
  );
  assert.throws(() => projectBuilderAgentStepProgress(new Proxy(valid, {})), assertProjectionError);
  assert.equal(getterCalls, 0);
  assert.doesNotMatch(assertProjectionError.toString(), /secret-value/u);
});

test('source boundary remains a pure renderer-safe projection with no runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-step-progress-projection.cjs'),
    'utf8',
  );

  assert.match(source, /builder-agent-step-progress-projection\.v1/u);
  assert.match(source, /main_owned_step_start_and_result_store_projection/u);
  assert.match(source, /sanitizeBuilderAgentStepStartReceipt/u);
  assert.match(source, /sanitizeBuilderAgentStepResultReceipt/u);
  assert.match(source, /MAX_AGENT_STEP_PROGRESS_ITEMS = 128/u);
  assert.match(source, /step_execution: false/u);
  assert.match(source, /provider_dispatch: false/u);
  assert.match(source, /tool_dispatch: false/u);
  assert.match(source, /raw_output_storage: false/u);
  assert.doesNotMatch(
    source,
    /node:sqlite|node:fs|require\(['"]fs['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|fetch\s*\(|https?:|Authorization|Bearer|execFile|spawn\s*\(|writeFile|readFile|createReadStream|eval\s*\(|new Function|shell:\s*true|record_grant|provider_secret|credential_secret|commit_oid|tree_oid|stdout|stderr|file_content|source_tree|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
  );
});
