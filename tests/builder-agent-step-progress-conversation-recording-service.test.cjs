'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderAgentDefinitionRecord,
  createBuilderAgentVersionRecord,
  BUILDER_AGENT_DEFINITION_RECORD_VERSION,
  BUILDER_AGENT_VERSION_RECORD_VERSION,
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
  createBuilderAgentStepStartStore,
} = require('../electron/builder-agent-step-start-store.cjs');
const {
  createBuilderAgentStepResultReceipt,
} = require('../electron/builder-agent-step-result-contract.cjs');
const {
  createBuilderAgentStepResultStore,
} = require('../electron/builder-agent-step-result-store.cjs');
const {
  createBuilderAgentStepProgressReadService,
} = require('../electron/builder-agent-step-progress-read-service.cjs');
const {
  BUILDER_AGENT_STEP_PROGRESS_CONVERSATION_RECORDING_RESULT_VERSION,
  BUILDER_AGENT_STEP_PROGRESS_CONVERSATION_RECORDING_SERVICE_VERSION,
  BuilderAgentStepProgressConversationRecordingServiceError,
  createBuilderAgentStepProgressConversationRecordingService,
} = require('../electron/builder-agent-step-progress-conversation-recording-service.cjs');
const {
  createBuilderConversationMainService,
} = require('../electron/builder-conversation-main-service.cjs');
const {
  createBuilderProductMetadataDatabase,
} = require('../electron/builder-product-metadata-database.cjs');

const OWNER_ID = 'builder-user:11111111-1111-4111-8111-111111111111';
const AGENT_ID = 'builder-agent:22222222-2222-4222-8222-222222222222';
const PROJECT_UUID = '33333333-3333-4333-8333-333333333333';
const PROJECT_ID = `builder-project:${PROJECT_UUID}`;
const SUPERVISOR_ID = 'builder-supervisor:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MESSAGE_ID = 'builder-message:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MEMORY_ID = `builder-agent-memory:${'a'.repeat(64)}`;
const ARTIFACT_ID = `builder-artifact:${'b'.repeat(64)}`;
const RUN_EVENT_ID = `builder-run-event:${'c'.repeat(64)}`;
const PERMISSION_ID = `builder-permission:${'d'.repeat(64)}`;
const REQUEST_DIGEST = `sha256:${'1'.repeat(64)}`;

function temporaryRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function removeRoot(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

function uuidFactory(start = 1) {
  let value = start;
  return () => {
    const suffix = value.toString(16).padStart(12, '0');
    value += 1;
    return `00000000-0000-4000-8000-${suffix}`;
  };
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
    purpose: 'Record one sanitized Agent progress item.',
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
    instructions: 'Record progress without exposing receipts or runtime output.',
    created_at_ms: 2,
    permission_boundary: 'explicit_permission_required',
    ...overrides,
  };
}

function stepStartReceipt(context, index = 1) {
  const definition = createBuilderAgentDefinitionRecord(definitionInput());
  const version = createBuilderAgentVersionRecord(versionInput(), definition);
  const assignment = createBuilderAgentAssignmentRecord({
    record_version: BUILDER_AGENT_ASSIGNMENT_RECORD_VERSION,
    agent_id: AGENT_ID,
    agent_version_id: version.agent_version_id,
    owner_id: OWNER_ID,
    assigned_by: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: context.conversation.conversation_id,
    task_id: context.ids.task_id,
    run_id: context.ids.run_id,
    goal: 'Record one supervised progress item.',
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
    conversation_id: context.conversation.conversation_id,
    task_id: context.ids.task_id,
    run_id: context.ids.run_id,
    lease_holder_id: SUPERVISOR_ID,
    lease_epoch: 1,
    acquired_at_ms: 20,
    expires_at_ms: 620,
    purpose: 'Supervise one progress recording.',
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
    conversation_id: context.conversation.conversation_id,
    task_id: context.ids.task_id,
    run_id: context.ids.run_id,
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

function openRuntime(root, uuidStart = 1) {
  const database = createBuilderProductMetadataDatabase(path.join(root, 'builder.sqlite'));
  let now = 1_000;
  const conversationService = createBuilderConversationMainService({
    metadataAuthority: database,
    createUuid: uuidFactory(uuidStart),
    nowMs: () => now++,
  });
  const stepStartStore = createBuilderAgentStepStartStore(
    path.join(root, 'step-starts.sqlite'),
  );
  const stepResultStore = createBuilderAgentStepResultStore(
    path.join(root, 'step-results.sqlite'),
  );
  const stepProgressReadService = createBuilderAgentStepProgressReadService({
    step_result_store: stepResultStore,
    step_start_store: stepStartStore,
  });
  const recordingService = createBuilderAgentStepProgressConversationRecordingService({
    conversation_service: conversationService,
    step_progress_read_service: stepProgressReadService,
  });
  return {
    conversationService,
    database,
    recordingService,
    stepProgressReadService,
    stepResultStore,
    stepStartStore,
    close() {
      stepStartStore.close();
      stepResultStore.close();
      database.close();
    },
  };
}

function beginWork(conversationService) {
  return conversationService.begin_work({
    project_id: PROJECT_ID,
    instruction: 'Build a focused timer',
    request_digest: REQUEST_DIGEST,
    base_revision: null,
  });
}

function request(context, step, recordedState = 'start_recorded', overrides = {}) {
  return {
    context,
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: context.conversation.conversation_id,
    turn_id: context.ids.turn_id,
    task_id: context.ids.task_id,
    run_id: context.ids.run_id,
    step_id: step.step_id,
    step_index: step.step_index,
    recorded_state: recordedState,
    admitted_at_ms: overrides.admitted_at_ms ?? 90,
    ...overrides,
  };
}

function assertServiceError(error, code = 'builder_agent_step_progress_conversation_recording_service_invalid') {
  assert.equal(error instanceof BuilderAgentStepProgressConversationRecordingServiceError, true);
  assert.equal(error.code, code);
  assert.equal(error.retryable, code === 'builder_agent_step_progress_conversation_recording_service_unavailable');
  assert.doesNotMatch(
    `${error.message}\n${error.stack}`,
    /receipt_digest|admission_id|budget_audit|assignment_id|lease_id|provider_secret|credential_secret|secret-value|api\.deepseek|stdout|stderr|commit_oid|tree_oid|source text|project:\/|permission_id/iu,
  );
  return true;
}

test('records store-backed Agent step progress into Conversation without runtime authority', (t) => {
  const root = temporaryRoot('clawfabric-builder-agent-step-progress-conversation-recording-');
  const runtime = openRuntime(root);
  t.after(() => {
    runtime.close();
    removeRoot(root);
  });

  const context = beginWork(runtime.conversationService);
  const step = stepStartReceipt(context, 1);
  runtime.stepStartStore.record_step_start({ step_start_receipt: step });

  const started = runtime.recordingService.record_agent_step_progress(
    request(context, step, 'start_recorded'),
  );

  assert.equal(started.result_version, BUILDER_AGENT_STEP_PROGRESS_CONVERSATION_RECORDING_RESULT_VERSION);
  assert.equal(started.service_version, BUILDER_AGENT_STEP_PROGRESS_CONVERSATION_RECORDING_SERVICE_VERSION);
  assert.equal(started.operation, 'agent_step_progress_conversation_recorded');
  assert.equal(started.status, 'ready');
  assert.equal(started.recorded_state, 'start_recorded');
  assert.equal(started.context.start_head.sequence, 3);
  assert.equal(started.evidence.service_authority, 'main_owned_agent_step_progress_conversation_recording_service');
  assert.equal(started.evidence.conversation_event, 'agent_step_progress_recorded');
  assert.equal(started.evidence.ipc_authority, 'not_present');
  assert.equal(started.evidence.provider_dispatch, false);
  assert.equal(started.evidence.tool_dispatch, false);
  assert.equal(started.evidence.step_execution, false);

  runtime.stepResultStore.record_step_result({
    step_result_receipt: stepResultReceipt(step),
  });
  const completed = runtime.recordingService.record_agent_step_progress(
    request(started.context, step, 'result_recorded', { admitted_at_ms: 91 }),
  );
  assert.equal(completed.recorded_state, 'result_recorded');
  assert.equal(completed.context.start_head.sequence, 4);

  const stream = runtime.conversationService.read_stream({ project_id: PROJECT_ID });
  assert.deepEqual(stream.conversation.items.slice(2, 4), [
    {
      item_kind: 'agent_step_progress_recorded',
      sequence: 3,
      turn_id: context.ids.turn_id,
      run_id: context.ids.run_id,
      task_id: context.ids.task_id,
      step_id: step.step_id,
      step_index: 1,
      recorded_state: 'start_recorded',
      result: null,
      summary: {
        status: 'started',
        display_summary: 'Agent step start was recorded.',
      },
      lifecycle: {
        conversation_admission: 'verified_public_progress',
        raw_output_admission: 'not_included',
        revision_admission: 'not_created',
      },
    },
    {
      item_kind: 'agent_step_progress_recorded',
      sequence: 4,
      turn_id: context.ids.turn_id,
      run_id: context.ids.run_id,
      task_id: context.ids.task_id,
      step_id: step.step_id,
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
      lifecycle: {
        conversation_admission: 'verified_public_progress',
        raw_output_admission: 'not_included',
        revision_admission: 'not_created',
      },
    },
  ]);
  assert.doesNotMatch(
    JSON.stringify(stream),
    /progress_admission|admission_digest|read_service|step_start_count|step_result_count|receipt_digest|assignment_id|lease_id|agent_id|owner_id|provider|credential|source_tree|stdout|stderr|commit_oid|tree_oid|review_id|artifact_id|prompt|token/iu,
  );
});

test('rejects stale or non-current Agent step progress recording without partial events', (t) => {
  const root = temporaryRoot('clawfabric-builder-agent-step-progress-conversation-recording-reject-');
  const runtime = openRuntime(root, 300);
  t.after(() => {
    runtime.close();
    removeRoot(root);
  });

  const context = beginWork(runtime.conversationService);
  const step = stepStartReceipt(context, 1);
  assert.throws(
    () => runtime.recordingService.record_agent_step_progress(
      request(context, step, 'start_recorded'),
    ),
    (error) => assertServiceError(error, 'builder_agent_step_progress_conversation_recording_service_conflict'),
  );

  const resultBeforeStartRoot = temporaryRoot(
    'clawfabric-builder-agent-step-progress-conversation-recording-result-before-start-',
  );
  const resultBeforeStartRuntime = openRuntime(resultBeforeStartRoot, 500);
  t.after(() => {
    resultBeforeStartRuntime.close();
    removeRoot(resultBeforeStartRoot);
  });
  const resultBeforeStartContext = beginWork(resultBeforeStartRuntime.conversationService);
  const resultBeforeStartStep = stepStartReceipt(resultBeforeStartContext, 1);
  resultBeforeStartRuntime.stepStartStore.record_step_start({
    step_start_receipt: resultBeforeStartStep,
  });
  resultBeforeStartRuntime.stepResultStore.record_step_result({
    step_result_receipt: stepResultReceipt(resultBeforeStartStep),
  });
  assert.throws(
    () => resultBeforeStartRuntime.recordingService.record_agent_step_progress(
      request(resultBeforeStartContext, resultBeforeStartStep, 'result_recorded'),
    ),
    (error) => assertServiceError(
      error,
      'builder_agent_step_progress_conversation_recording_service_conflict',
    ),
  );
  assert.equal(
    resultBeforeStartRuntime.conversationService.read_stream({ project_id: PROJECT_ID })
      .conversation.items.length,
    2,
  );

  runtime.stepStartStore.record_step_start({ step_start_receipt: step });
  const started = runtime.recordingService.record_agent_step_progress(
    request(context, step, 'start_recorded'),
  );
  assert.throws(
    () => runtime.recordingService.record_agent_step_progress(
      request(started.context, step, 'start_recorded', { admitted_at_ms: 91 }),
    ),
    (error) => assertServiceError(error, 'builder_agent_step_progress_conversation_recording_service_conflict'),
  );
  runtime.stepResultStore.record_step_result({
    step_result_receipt: stepResultReceipt(step),
  });
  assert.throws(
    () => runtime.recordingService.record_agent_step_progress(
      request(started.context, step, 'result_recorded', {
        step_id: stepId(2),
        admitted_at_ms: 92,
      }),
    ),
    (error) => assertServiceError(error),
  );
  assert.throws(
    () => runtime.recordingService.record_agent_step_progress(
      request(started.context, step, 'result_recorded', { admitted_at_ms: 100_000 }),
    ),
    (error) => assertServiceError(error, 'builder_agent_step_progress_conversation_recording_service_conflict'),
  );

  const stream = runtime.conversationService.read_stream({ project_id: PROJECT_ID });
  assert.equal(stream.conversation.items.length, 3);
  assert.equal(stream.conversation.items[2].recorded_state, 'start_recorded');
});

test('fails closed on malformed services and stays out of stores, IPC, provider, and source authority', () => {
  assert.throws(
    () => createBuilderAgentStepProgressConversationRecordingService({
      conversation_service: {
        service_version: 'builder-conversation-main-service.v1',
        record_agent_step_progress() {},
      },
      step_progress_read_service: {
        service_version: 'builder-agent-step-progress-read-service.v1',
        read_agent_step_progress() {},
      },
      extra: true,
    }),
    (error) => assertServiceError(error),
  );
  assert.throws(
    () => createBuilderAgentStepProgressConversationRecordingService(new Proxy({}, {})),
    (error) => assertServiceError(error),
  );

  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-step-progress-conversation-recording-service.cjs'),
    'utf8',
  );
  assert.match(source, /builder-agent-step-progress-conversation-recording-service\.v1/u);
  assert.match(source, /record_agent_step_progress/u);
  assert.doesNotMatch(
    source,
    /builder-agent-step-start-store|builder-agent-step-result-store|builder-product-metadata|node:fs|node:path|ipcMain|ipcRenderer|BrowserWindow|provider-config|provider-secret|safeStorage|dugite|simple-git|source-tree|filesystem-read|runtime-invocation|process\.env/iu,
  );
});
