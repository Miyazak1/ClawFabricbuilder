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
  BUILDER_AGENT_STEP_RESULT_CONTRACT_VERSION,
  BUILDER_AGENT_STEP_RESULT_RECEIPT_KIND,
  BUILDER_AGENT_STEP_RESULT_RECEIPT_VERSION,
  BuilderAgentStepResultContractError,
  createBuilderAgentStepResultReceipt,
  sanitizeBuilderAgentStepResultReceipt,
} = require('../electron/builder-agent-step-result-contract.cjs');

const OWNER_ID = 'builder-user:11111111-1111-4111-8111-111111111111';
const AGENT_ID = 'builder-agent:22222222-2222-4222-8222-222222222222';
const PROJECT_UUID = '33333333-3333-4333-8333-333333333333';
const PROJECT_ID = `builder-project:${PROJECT_UUID}`;
const CONVERSATION_ID = `builder-conversation:${PROJECT_UUID}`;
const TASK_ID = 'builder-task:55555555-5555-4555-8555-555555555555';
const RUN_ID = 'builder-run:66666666-6666-4666-8666-666666666666';
const STEP_ID = 'builder-run-step:77777777-7777-4777-8777-777777777777';
const SUPERVISOR_ID = 'builder-supervisor:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MESSAGE_ID = 'builder-message:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MEMORY_ID = `builder-agent-memory:${'a'.repeat(64)}`;
const ARTIFACT_ID = `builder-artifact:${'b'.repeat(64)}`;
const RUN_EVENT_ID = `builder-run-event:${'c'.repeat(64)}`;
const PERMISSION_REF_ID = `builder-permission:${'d'.repeat(64)}`;

function requestId(index = 1) {
  return `builder-agent-action-request:123e4567-e89b-42d3-a456-${index.toString(16).padStart(12, '0')}`;
}

function stepStartFixture(index = 1) {
  const definition = createBuilderAgentDefinitionRecord({
    record_version: BUILDER_AGENT_DEFINITION_RECORD_VERSION,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    display_name: 'Builder Agent',
    purpose: 'Finish one supervised step with fixed evidence.',
    created_at_ms: 1,
  });
  const version = createBuilderAgentVersionRecord({
    record_version: BUILDER_AGENT_VERSION_RECORD_VERSION,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    version_number: 1,
    instructions: 'Record step outcomes without raw output.',
    created_at_ms: 2,
    permission_boundary: 'explicit_permission_required',
  }, definition);
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
    goal: 'Finish the next supervised step.',
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
    purpose: 'Supervise one step start.',
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
    included_permission_ids: [PERMISSION_REF_ID],
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
  const stepStartReceipt = createBuilderAgentStepStartReceipt({
    supervised_action_admission: admission,
    budget_audit: budgetAudit,
    step_id: STEP_ID,
    step_index: index,
    started_at_ms: admission.admitted_at_ms + 1,
  });
  return { admission, budgetAudit, stepStartReceipt };
}

function resultInput(stepStartReceipt, overrides = {}) {
  return {
    step_start_receipt: overrides.step_start_receipt ?? stepStartReceipt,
    observed_at_ms: overrides.observed_at_ms ?? stepStartReceipt.started_at_ms + 10,
    result: overrides.result ?? {
      status: 'succeeded',
      summary_code: 'agent_step_completed_without_raw_output',
    },
  };
}

function assertContractError(error) {
  assert.equal(error instanceof BuilderAgentStepResultContractError, true);
  assert.equal(error.code, 'builder_agent_step_result_contract_invalid');
  assert.doesNotMatch(
    `${error.message}\n${error.stack}`,
    /private|credential|api\.deepseek|secret-value|source text|project:\/|permission_id|raw output|stdout|stderr/iu,
  );
  return true;
}

test('creates a deterministic Agent step result receipt from a step-start receipt', () => {
  const { stepStartReceipt } = stepStartFixture();
  const receipt = createBuilderAgentStepResultReceipt(resultInput(stepStartReceipt));

  assert.equal(BUILDER_AGENT_STEP_RESULT_CONTRACT_VERSION, 'builder-agent-step-result-contract.v1');
  assert.equal(receipt.receipt_version, BUILDER_AGENT_STEP_RESULT_RECEIPT_VERSION);
  assert.equal(receipt.receipt_kind, BUILDER_AGENT_STEP_RESULT_RECEIPT_KIND);
  assert.equal(receipt.step_start_receipt_digest, stepStartReceipt.step_start_receipt_digest);
  assert.equal(receipt.supervised_action_admission_id, stepStartReceipt.supervised_action_admission_id);
  assert.equal(receipt.budget_audit_id, stepStartReceipt.budget_audit_id);
  assert.equal(receipt.step_id, STEP_ID);
  assert.equal(receipt.step_index, 1);
  assert.deepEqual(receipt.result, {
    status: 'succeeded',
    summary_code: 'agent_step_completed_without_raw_output',
    display_summary: 'Agent step completed. Details were not kept.',
    summary_digest: receipt.result.summary_digest,
  });
  assert.match(receipt.result.summary_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(receipt.lifecycle.step_start, 'verified_step_start_receipt');
  assert.equal(receipt.lifecycle.step_execution, 'not_performed_by_contract');
  assert.equal(receipt.lifecycle.result_for_review, 'not_created');
  assert.equal(receipt.authority.step_result_authority, 'main_agent_step_result_receipt_contract_v1');
  assert.equal(receipt.authority.provider_dispatch, false);
  assert.equal(receipt.authority.tool_dispatch, false);
  assert.equal(receipt.authority.source_write, 'not_present');
  assert.equal(receipt.authority.revision_authority, false);
  assert.equal(receipt.authority.review_authority, false);
  assert.equal(receipt.authority.artifact_authority, false);
  assert.match(receipt.step_result_receipt_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(Object.isFrozen(receipt), true);
  assert.equal(Object.isFrozen(receipt.result), true);
  assert.deepEqual(sanitizeBuilderAgentStepResultReceipt(structuredClone(receipt)), receipt);

  const replay = createBuilderAgentStepResultReceipt(resultInput(stepStartReceipt));
  assert.equal(replay.step_result_receipt_digest, receipt.step_result_receipt_digest);
});

test('records only fixed step result summaries without raw output', () => {
  const { stepStartReceipt } = stepStartFixture();
  const cases = [
    ['blocked', 'agent_step_needs_owner_attention', 'Agent step needs owner attention.'],
    ['failed', 'agent_step_failed_without_raw_output', 'Agent step could not finish. Details were not kept.'],
    ['cancelled', 'agent_step_cancelled_without_raw_output', 'Agent step was stopped. Details were not kept.'],
  ];

  for (const [status, summaryCode, displaySummary] of cases) {
    const receipt = createBuilderAgentStepResultReceipt(resultInput(stepStartReceipt, {
      result: { status, summary_code: summaryCode },
    }));
    assert.equal(receipt.result.status, status);
    assert.equal(receipt.result.summary_code, summaryCode);
    assert.equal(receipt.result.display_summary, displaySummary);
    assert.equal(Object.hasOwn(receipt.result, 'raw_output'), false);
    assert.equal(Object.hasOwn(receipt, 'source_context'), false);
    assert.doesNotMatch(JSON.stringify(receipt), /file_content|source_tree|stdout|stderr|api\.deepseek|secret-value/u);
  }
});

test('fails closed on forged step starts, stale timing, result drift, and raw output', () => {
  const { stepStartReceipt } = stepStartFixture();
  assert.throws(
    () => createBuilderAgentStepResultReceipt(resultInput(stepStartReceipt, {
      observed_at_ms: stepStartReceipt.started_at_ms - 1,
    })),
    assertContractError,
  );
  assert.throws(
    () => createBuilderAgentStepResultReceipt(resultInput({
      ...stepStartReceipt,
      step_start_receipt_digest: `sha256:${'0'.repeat(64)}`,
    })),
    assertContractError,
  );
  assert.throws(
    () => createBuilderAgentStepResultReceipt(resultInput(stepStartReceipt, {
      result: {
        status: 'succeeded',
        summary_code: 'agent_step_failed_without_raw_output',
      },
    })),
    assertContractError,
  );
  assert.throws(
    () => createBuilderAgentStepResultReceipt(resultInput(stepStartReceipt, {
      result: {
        status: 'succeeded',
        summary_code: 'agent_step_completed_without_raw_output',
        raw_output: 'secret-value',
      },
    })),
    assertContractError,
  );

  const receipt = createBuilderAgentStepResultReceipt(resultInput(stepStartReceipt));
  assert.throws(
    () => sanitizeBuilderAgentStepResultReceipt({
      ...receipt,
      result: {
        ...receipt.result,
        display_summary: 'Forged text.',
      },
    }),
    assertContractError,
  );
  assert.throws(
    () => sanitizeBuilderAgentStepResultReceipt({
      ...receipt,
      observed_at_ms: receipt.started_at_ms - 1,
    }),
    assertContractError,
  );
});

test('source remains a pure local Agent step result contract without runtime authority', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'electron', 'builder-agent-step-result-contract.cjs'),
    'utf8',
  );

  assert.match(source, /builder-agent-step-result-contract\.v1/u);
  assert.match(source, /main_agent_step_result_receipt_contract_v1/u);
  assert.match(source, /step_execution: 'not_performed_by_contract'/u);
  assert.match(source, /result_for_review: 'not_created'/u);
  assert.match(source, /revision_authority: false/u);
  assert.match(source, /review_authority: false/u);
  assert.match(source, /artifact_authority: false/u);
  assert.doesNotMatch(source, /require\('electron'\)|ipcMain|BrowserWindow|preload|safeStorage|provider-config|provider-secret/iu);
  assert.doesNotMatch(source, /node:fs|node:child_process|require\(['"]child_process['"]\)|spawn\(|execFile\(|writeFile|rmSync|readFile/iu);
});
