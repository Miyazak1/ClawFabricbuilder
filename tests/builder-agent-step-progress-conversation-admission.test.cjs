'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_AGENT_STEP_PROGRESS_CONVERSATION_ADMISSION_CONTRACT_VERSION,
  BUILDER_AGENT_STEP_PROGRESS_CONVERSATION_ADMISSION_RECORD_KIND,
  BUILDER_AGENT_STEP_PROGRESS_CONVERSATION_ADMISSION_RECORD_VERSION,
  BuilderAgentStepProgressConversationAdmissionError,
  createBuilderAgentStepProgressConversationAdmission,
  sanitizeBuilderAgentStepProgressConversationAdmission,
} = require('../electron/builder-agent-step-progress-conversation-admission.cjs');

const PROJECT_UUID = '33333333-3333-4333-8333-333333333333';
const PROJECT_ID = `builder-project:${PROJECT_UUID}`;
const CONVERSATION_ID = `builder-conversation:${PROJECT_UUID}`;
const TURN_ID = 'builder-turn:44444444-4444-4444-8444-444444444444';
const TASK_ID = 'builder-task:55555555-5555-4555-8555-555555555555';
const RUN_ID = 'builder-run:66666666-6666-4666-8666-666666666666';

function stepId(index) {
  return `builder-run-step:77777777-7777-4777-8777-${String(index).padStart(12, '0')}`;
}

function projectionAuthority() {
  return {
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
  };
}

function readEvidence() {
  return {
    service_authority: 'main_owned_agent_step_progress_read_service',
    projection_authority: 'main_owned_step_start_and_result_store_projection',
    step_start_store_authority: 'main_owned_agent_step_start_store',
    step_result_store_authority: 'main_owned_agent_step_result_store',
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
    recovery_model: 'read_only_store_projection_replay',
  };
}

function progressItem(index, recordedState = 'start_recorded') {
  if (recordedState === 'start_recorded') {
    return {
      item_kind: 'agent_step_progress',
      step_id: stepId(index),
      step_index: index,
      recorded_state: 'start_recorded',
      result: null,
      summary: {
        status: 'started',
        display_summary: 'Agent step start was recorded.',
      },
    };
  }
  return {
    item_kind: 'agent_step_progress',
    step_id: stepId(index),
    step_index: index,
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
  };
}

function readResult(items, overrides = {}) {
  const stepResultCount = items.filter((item) => item.result !== null).length;
  return {
    result_version: 'builder-agent-step-progress-read-service-result.v1',
    service_version: 'builder-agent-step-progress-read-service.v1',
    operation: 'agent_step_progress_projected',
    status: 'ready',
    projection: {
      projection_version: 'builder-agent-step-progress-projection.v1',
      project_id: PROJECT_ID,
      task_id: TASK_ID,
      run_id: RUN_ID,
      progress: {
        window: {
          first_step_index: items[0].step_index,
          last_step_index: items.at(-1).step_index,
          has_earlier: false,
        },
        items,
      },
      authority: projectionAuthority(),
    },
    read_summary: {
      step_start_status: 'ready',
      step_result_status: stepResultCount === 0 ? 'absent' : 'ready',
      step_start_count: items.length,
      step_result_count: stepResultCount,
      truncated: false,
    },
    evidence: readEvidence(),
    ...overrides,
  };
}

function request(overrides = {}) {
  const { selected = progressItem(1), ...requestOverrides } = overrides;
  return {
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    run_status: 'running',
    interrupt_requested: false,
    cancel_requested: false,
    read_result: readResult([selected, progressItem(2, 'result_recorded')]),
    step_id: selected.step_id,
    step_index: selected.step_index,
    recorded_state: selected.recorded_state,
    admitted_at_ms: 1_000,
    ...requestOverrides,
  };
}

function assertAdmissionError(error) {
  assert.equal(error instanceof BuilderAgentStepProgressConversationAdmissionError, true);
  assert.equal(error.code, 'builder_agent_step_progress_conversation_admission_invalid');
  assert.equal(error.retryable, false);
  assert.doesNotMatch(
    `${error.message}\n${error.stack}`,
    /receipt_digest|admission_id|budget_audit|assignment_id|lease_id|provider_secret|credential_secret|secret-value|api\.deepseek|stdout|stderr|commit_oid|tree_oid|source text|project:\/|permission_id/iu,
  );
  return true;
}

test('creates deterministic Conversation admission records for Agent step progress', () => {
  const started = createBuilderAgentStepProgressConversationAdmission(request({
    selected: progressItem(1),
  }));
  const completed = createBuilderAgentStepProgressConversationAdmission(request({
    selected: progressItem(2, 'result_recorded'),
    admitted_at_ms: 1_010,
  }));

  assert.equal(
    BUILDER_AGENT_STEP_PROGRESS_CONVERSATION_ADMISSION_CONTRACT_VERSION,
    'builder-agent-step-progress-conversation-admission-contract.v1',
  );
  assert.equal(started.record_version, BUILDER_AGENT_STEP_PROGRESS_CONVERSATION_ADMISSION_RECORD_VERSION);
  assert.equal(started.record_kind, BUILDER_AGENT_STEP_PROGRESS_CONVERSATION_ADMISSION_RECORD_KIND);
  assert.equal(started.project_id, PROJECT_ID);
  assert.equal(started.conversation_id, CONVERSATION_ID);
  assert.equal(started.turn_id, TURN_ID);
  assert.equal(started.task_id, TASK_ID);
  assert.equal(started.run_id, RUN_ID);
  assert.equal(started.step_id, stepId(1));
  assert.equal(started.recorded_state, 'start_recorded');
  assert.equal(started.result, null);
  assert.equal(started.summary.display_summary, 'Agent step start was recorded.');
  assert.equal(started.source.read_service_version, 'builder-agent-step-progress-read-service.v1');
  assert.equal(started.source.step_start_count, 2);
  assert.equal(started.source.step_result_count, 1);
  assert.equal(started.lifecycle.conversation_admission, 'ready_for_later_conversation_event');
  assert.equal(started.lifecycle.task_stream_projection, 'not_recorded_by_contract');
  assert.equal(started.authority.record_authority, 'main_agent_step_progress_conversation_admission_contract_v1');
  assert.equal(started.authority.renderer_authority, 'not_present');
  assert.equal(started.authority.ipc_authority, 'not_present');
  assert.equal(started.authority.provider_dispatch, false);
  assert.equal(started.authority.step_execution, false);
  assert.equal(Object.isFrozen(started), true);
  assert.deepEqual(sanitizeBuilderAgentStepProgressConversationAdmission(started), started);

  assert.equal(completed.step_id, stepId(2));
  assert.equal(completed.recorded_state, 'result_recorded');
  assert.equal(completed.result.status, 'succeeded');
  assert.equal(completed.summary.status, 'succeeded');
  assert.notEqual(completed.admission_digest, started.admission_digest);
  assert.deepEqual(
    createBuilderAgentStepProgressConversationAdmission(request({
      selected: progressItem(2, 'result_recorded'),
      admitted_at_ms: 1_010,
    })),
    completed,
  );
  assert.doesNotMatch(
    JSON.stringify(completed),
    /receipt_digest|admission_id|budget_audit|assignment_id|lease_id|agent_id|owner_id|provider_secret|credential_secret|secret-value|api\.deepseek|stdout|stderr|commit_oid|tree_oid|revision_receipt|review_id|artifact_id/iu,
  );
});

test('rejects inactive runs, drifted read results, and unselected progress items', () => {
  assert.throws(
    () => createBuilderAgentStepProgressConversationAdmission(request({ run_status: 'completed' })),
    assertAdmissionError,
  );
  assert.throws(
    () => createBuilderAgentStepProgressConversationAdmission(request({ cancel_requested: true })),
    assertAdmissionError,
  );
  assert.throws(
    () => createBuilderAgentStepProgressConversationAdmission(request({
      conversation_id: 'builder-conversation:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    })),
    assertAdmissionError,
  );
  assert.throws(
    () => createBuilderAgentStepProgressConversationAdmission(request({
      step_id: stepId(9),
    })),
    assertAdmissionError,
  );
  const drifted = readResult([progressItem(1)], {
    projection: {
      ...readResult([progressItem(1)]).projection,
      project_id: 'builder-project:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    },
  });
  assert.throws(
    () => createBuilderAgentStepProgressConversationAdmission(request({ read_result: drifted })),
    assertAdmissionError,
  );
  assert.throws(
    () => createBuilderAgentStepProgressConversationAdmission(request({
      read_result: {
        ...readResult([progressItem(1)]),
        status: 'absent',
      },
    })),
    assertAdmissionError,
  );
});

test('sanitizer rejects forged records and hidden authority expansion', () => {
  const record = createBuilderAgentStepProgressConversationAdmission(request({
    selected: progressItem(2, 'result_recorded'),
  }));
  assert.throws(
    () => sanitizeBuilderAgentStepProgressConversationAdmission({
      ...record,
      provider_secret: 'secret-value',
    }),
    assertAdmissionError,
  );
  assert.throws(
    () => sanitizeBuilderAgentStepProgressConversationAdmission({
      ...record,
      admission_digest: `sha256:${'f'.repeat(64)}`,
    }),
    assertAdmissionError,
  );
  assert.throws(
    () => sanitizeBuilderAgentStepProgressConversationAdmission({
      ...record,
      authority: {
        ...record.authority,
        ipc_authority: 'renderer_controlled',
      },
    }),
    assertAdmissionError,
  );
  assert.throws(
    () => sanitizeBuilderAgentStepProgressConversationAdmission({
      ...record,
      result: {
        status: 'failed',
        summary_code: 'agent_step_completed_without_raw_output',
        display_summary: 'Agent step completed. Details were not kept.',
      },
    }),
    assertAdmissionError,
  );
});

test('source boundary remains pure Conversation admission evidence without runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-step-progress-conversation-admission.cjs'),
    'utf8',
  );
  assert.match(source, /builder-agent-step-progress-conversation-admission-contract\.v1/u);
  assert.match(source, /main_agent_step_progress_conversation_admission_contract_v1/u);
  assert.match(source, /ready_for_later_conversation_event/u);
  assert.match(source, /task_stream_projection: 'not_recorded_by_contract'/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:fs|fs|node:sqlite|node:http|node:https|http|https|node:child_process|child_process)['"]\)|DatabaseSync|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|fetch\s*\(|https?:|Authorization|Bearer|execFile|spawn\s*\(|writeFile|readFile|createReadStream|eval\s*\(|new Function|shell:\s*true|record_grant|record_revocation|provider_secret|credential_secret|commit_oid|tree_oid|stdout|stderr|file_content|source_tree|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
  );
});
