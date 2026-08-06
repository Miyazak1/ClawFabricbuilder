'use strict';

const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderRunContextSnapshot,
} = require('../electron/builder-run-context-snapshot.cjs');
const {
  CONVERSATION_AUTHORITY,
  CONVERSATION_EVENT_KIND,
  CONVERSATION_EVENT_VERSION,
  createBuilderConversationPlanAdmission,
  createBuilderConversationEvent,
} = require('../electron/builder-conversation-records.cjs');
const {
  BUILDER_PERMISSION_DECISION_VERSION,
  BUILDER_PERMISSION_POLICY_VERSION,
} = require('../electron/builder-permission-authority-contract.cjs');
const {
  createBuilderToolPermissionAdmission,
} = require('../electron/builder-tool-permission-admission.cjs');
const {
  DEFAULT_BUILDER_TOOL_SESSION_LIMITS,
  createBuilderToolSessionPolicy,
} = require('../electron/builder-tool-session-policy.cjs');
const {
  createBuilderToolCallRecord,
} = require('../electron/builder-tool-call-records.cjs');
const {
  createBuilderToolDispatchAdmission,
} = require('../electron/builder-tool-dispatch-admission.cjs');
const {
  FILESYSTEM_READ_TOOL_ADAPTER_ID,
  createBuilderToolAdapterSelectionAdmission,
} = require('../electron/builder-tool-adapter-selection-admission.cjs');
const {
  FILESYSTEM_READ_TOOL_RUNTIME_ID,
  createBuilderToolRuntimeInvocationAdmission,
} = require('../electron/builder-tool-runtime-invocation-admission.cjs');
const {
  createBuilderToolResultRecord,
} = require('../electron/builder-tool-result-records.cjs');
const {
  createBuilderAgentStepProgressConversationAdmission,
} = require('../electron/builder-agent-step-progress-conversation-admission.cjs');
const {
  BUILDER_TASK_STREAM_VERSION,
  MAX_PUBLIC_BYTES,
  MAX_PUBLIC_ITEMS,
  BuilderTaskStreamProjectionError,
  projectBuilderTaskStream,
} = require('../electron/builder-task-stream-projection.cjs');

const UUID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}`;
const DIGEST = `sha256:${'1'.repeat(64)}`;
const PERMISSION_ID = `builder-permission:${'a'.repeat(64)}`;

function id(kind, index) {
  return `builder-${kind}:00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function routeDecision(payload, overrides = {}) {
  const route = payload.mode === 'work' ? 'build' : 'answer';
  return {
    decision_id: `builder-route-decision:${payload.message.message_id.slice('builder-message:'.length)}`,
    decision_version: 'builder-composer-route-decision.v1',
    project_id: PROJECT_ID,
    message_id: payload.message.message_id,
    task_id: payload.task === null ? null : payload.task.task_id,
    route,
    confidence: 'high',
    matched_signals: [payload.mode === 'work' ? 'clear_build' : 'read_only'],
    downgraded_from: null,
    downgrade_reason: null,
    required_permissions: route === 'build' ? ['write_project'] : [],
    permission_result: route === 'build' ? 'allowed' : 'not_required',
    dispatch: route === 'build' ? 'build' : 'reply',
    decided_at_ms: 1,
    ...overrides,
  };
}

function head(event) {
  return event === null ? null : {
    sequence: event.sequence,
    event_id: event.event_id,
    event_digest: event.event_digest,
  };
}

function eventHeadDigest(event) {
  return `sha256:${nodeCrypto.createHash('sha256').update(JSON.stringify({
    event_digest: event.event_digest,
    event_id: event.event_id,
    sequence: event.sequence,
  }), 'utf8').digest('hex')}`;
}

function append(events, type, payload, index) {
  const previous = events.at(-1) ?? null;
  const basePayload = type === 'run_completed'
    ? { ...payload, plan_admission: payload.plan_admission ?? null }
    : payload;
  const normalizedPayload = type === 'turn_submitted'
    ? {
      ...basePayload,
      route_decision: Object.hasOwn(basePayload, 'route_decision')
        ? basePayload.route_decision
        : routeDecision(basePayload),
    }
    : basePayload;
  events.push(createBuilderConversationEvent({
    record_version: CONVERSATION_EVENT_VERSION,
    record_kind: CONVERSATION_EVENT_KIND,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    sequence: previous === null ? 1 : previous.sequence + 1,
    command_id: id('command', index),
    event_type: type,
    previous_event: head(previous),
    payload: normalizedPayload,
    authority: { ...CONVERSATION_AUTHORITY },
  }));
  return events;
}

function planAdmission(previous, callRecord, resultRecord) {
  return createBuilderConversationPlanAdmission({
    admission_version: 'builder-conversation-plan-admission.v1',
    admission_kind: 'builder_conversation_plan_admission',
    admission_authority: 'trusted_conversation_main_service_complete_plan_v1',
    project_id: callRecord.project_id,
    conversation_id: callRecord.conversation_id,
    turn_id: callRecord.turn_id,
    task_id: callRecord.task_id,
    run_id: callRecord.run_id,
    attempt_number: 1,
    plan_record_digest: DIGEST,
    source_context_result_version: 'builder-tool-source-context-result.v1',
    collector_authority: 'main_tool_source_context_collector_v1',
    context_digest: `sha256:${'d'.repeat(64)}`,
    context_status: 'succeeded',
    file_count: 1,
    total_content_bytes: 32,
    head_sequence: previous.sequence,
    head_digest: eventHeadDigest(previous),
    tool_reads: [{
      resource_id: callRecord.resource.resource_id,
      tool_call_id: callRecord.tool_call_id,
      tool_call_record_digest: callRecord.record_digest,
      tool_result_record_digest: resultRecord.record_digest,
      result_summary_digest: resultRecord.result.summary_digest,
      result_status: 'succeeded',
    }],
  });
}

function candidateReceipt(turnId, taskId, runId) {
  return {
    receipt_version: 'builder-git-candidate-receipt.v1',
    repository_version: 'builder-git-project-repository.v1',
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: turnId,
    task_id: taskId,
    run_id: runId,
    request_id: id('git-request', 20),
    candidate_id: `builder-code-change-candidate:${'2'.repeat(64)}`,
    candidate_digest: DIGEST,
    resulting_tree_digest: `sha256:${'3'.repeat(64)}`,
    semantic_identity_digest: `sha256:${'4'.repeat(64)}`,
    verification_receipt_digest: `sha256:${'5'.repeat(64)}`,
    object_format: 'sha1',
    commit_oid: '6'.repeat(40),
    tree_oid: '7'.repeat(40),
    parent_oid: null,
    expected_base_oid: null,
    code_authority: 'git_commit_candidate',
    product_revision_admission: 'not_recorded',
    replay: false,
  };
}

function runContextSnapshot({ turnId, taskId, runId, routeDecisionRecord, messageId }) {
  return createBuilderRunContextSnapshot({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: turnId,
    run_id: runId,
    task_id: taskId,
    message_id: messageId,
    route_decision: routeDecisionRecord,
    latest_task_capsule: null,
    working_context_state: null,
    context_assembly: null,
    base_revision: null,
    created_at_ms: 4_000,
  });
}

function agentStepProgressItem(index, recordedState = 'start_recorded', resultStatus = 'succeeded') {
  if (recordedState === 'start_recorded') {
    return {
      item_kind: 'agent_step_progress',
      step_id: id('run-step', index),
      step_index: index,
      recorded_state: 'start_recorded',
      result: null,
      summary: {
        status: 'started',
        display_summary: 'Agent step start was recorded.',
      },
    };
  }
  const summary = {
    succeeded: {
      summary_code: 'agent_step_completed_without_raw_output',
      display_summary: 'Agent step completed. Details were not kept.',
    },
    blocked: {
      summary_code: 'agent_step_needs_owner_attention',
      display_summary: 'Agent step needs owner attention.',
    },
    failed: {
      summary_code: 'agent_step_failed_without_raw_output',
      display_summary: 'Agent step could not finish. Details were not kept.',
    },
    cancelled: {
      summary_code: 'agent_step_cancelled_without_raw_output',
      display_summary: 'Agent step was stopped. Details were not kept.',
    },
  }[resultStatus];
  return {
    item_kind: 'agent_step_progress',
    step_id: id('run-step', index),
    step_index: index,
    recorded_state: 'result_recorded',
    result: {
      status: resultStatus,
      summary_code: summary.summary_code,
      display_summary: summary.display_summary,
    },
    summary: {
      status: resultStatus,
      display_summary: summary.display_summary,
    },
  };
}

function agentStepProgressReadResult({ taskId, runId, items }) {
  const stepResultCount = items.filter((item) => item.result !== null).length;
  return {
    result_version: 'builder-agent-step-progress-read-service-result.v1',
    service_version: 'builder-agent-step-progress-read-service.v1',
    operation: 'agent_step_progress_projected',
    status: 'ready',
    projection: {
      projection_version: 'builder-agent-step-progress-projection.v1',
      project_id: PROJECT_ID,
      task_id: taskId,
      run_id: runId,
      progress: {
        window: {
          first_step_index: items[0].step_index,
          last_step_index: items.at(-1).step_index,
          has_earlier: false,
        },
        items,
      },
      authority: {
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
      },
    },
    read_summary: {
      step_start_status: 'ready',
      step_result_status: stepResultCount === 0 ? 'absent' : 'ready',
      step_start_count: items.length,
      step_result_count: stepResultCount,
      truncated: false,
    },
    evidence: {
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
    },
  };
}

function agentStepProgressAdmission({
  turnId,
  taskId,
  runId,
  index,
  recordedState = 'start_recorded',
  resultStatus = 'succeeded',
}) {
  const selected = agentStepProgressItem(index, recordedState, resultStatus);
  const readItems = index === 1
    ? [selected, agentStepProgressItem(2, 'result_recorded')]
    : [agentStepProgressItem(1), selected];
  return createBuilderAgentStepProgressConversationAdmission({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: turnId,
    task_id: taskId,
    run_id: runId,
    run_status: 'running',
    interrupt_requested: false,
    cancel_requested: false,
    read_result: agentStepProgressReadResult({ taskId, runId, items: readItems }),
    step_id: selected.step_id,
    step_index: selected.step_index,
    recorded_state: selected.recorded_state,
    admitted_at_ms: 4_000 + index,
  });
}

async function toolCallRecord({
  turnId = id('turn', 1),
  taskId = id('task', 2),
  runId = id('run', 3),
  stepId = id('run-step', 4),
  toolCallId = id('tool-call', 5),
} = {}) {
  const sessionPolicy = createBuilderToolSessionPolicy({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: turnId,
    task_id: taskId,
    run_id: runId,
    issued_at_ms: 49,
    limits: { ...DEFAULT_BUILDER_TOOL_SESSION_LIMITS },
  });
  const guard = createBuilderToolPermissionAdmission({
    actor_id: id('user', 6),
    now_ms: () => 50,
    evaluate_permission: async (body) => ({
      decision_version: BUILDER_PERMISSION_DECISION_VERSION,
      policy_version: BUILDER_PERMISSION_POLICY_VERSION,
      actor_id: id('user', 6),
      action: body.action,
      resource: body.resource,
      evaluated_at_ms: body.now_ms,
      decision: 'allowed',
      reason: 'matching_active_grant',
      permission_id: PERMISSION_ID,
      permission_authority: 'builder_permission_facts_deny_by_default_v1',
      ui_selection_authority: 'not_permission',
    }),
  });
  const admission = await guard.admit({
    tool_call_id: toolCallId,
    tool_name: 'filesystem.read',
    project_id: PROJECT_ID,
    action: 'filesystem.read',
    resource: {
      resource_kind: 'filesystem',
      project_id: PROJECT_ID,
      resource_id: 'project:/src/app.tsx',
    },
  });
  return createBuilderToolCallRecord({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: turnId,
    task_id: taskId,
    run_id: runId,
    step_id: stepId,
    session_policy: sessionPolicy,
    admission,
    requested_at_ms: 51,
  });
}

function toolResultRecord(record, overrides = {}) {
  const {
    runtime_invocation_admission: runtime = toolRuntimeAdmission(record),
    ...rest
  } = overrides;
  return createBuilderToolResultRecord({
    runtime_invocation_admission: runtime,
    tool_call_record: record,
    observed_at_ms: 60,
    result: {
      status: 'failed',
      summary_code: 'output_rejected',
    },
    ...rest,
  });
}

function existingToolCall(record) {
  return {
    step_id: record.step_id,
    tool_call_id: record.tool_call_id,
    tool_call_record: record,
    tool_result_record: null,
  };
}

function idIndex(value) {
  return Number.parseInt(value.slice(-12), 10);
}

function toolRuntimeAdmission(record) {
  const index = idIndex(record.step_id);
  const dispatch = createBuilderToolDispatchAdmission({
    project_id: record.project_id,
    conversation_id: record.conversation_id,
    turn_id: record.turn_id,
    task_id: record.task_id,
    run_id: record.run_id,
    run_status: 'running',
    interrupt_requested: false,
    cancel_requested: false,
    existing_tool_calls: [existingToolCall(record)],
    tool_call_record: record,
    dispatch_request_id: id('tool-dispatch-request', index + 20),
    admitted_at_ms: record.requested_at_ms,
  });
  const selection = createBuilderToolAdapterSelectionAdmission({
    dispatch_admission: dispatch,
    tool_call_record: record,
    adapter_id: FILESYSTEM_READ_TOOL_ADAPTER_ID,
    adapter_selection_id: id('tool-adapter-selection', index + 21),
    selected_at_ms: dispatch.admitted_at_ms,
  });
  return createBuilderToolRuntimeInvocationAdmission({
    adapter_selection_admission: selection,
    tool_call_record: record,
    runtime_id: FILESYSTEM_READ_TOOL_RUNTIME_ID,
    runtime_invocation_id: id('tool-runtime-invocation', index + 22),
    runtime_admitted_at_ms: selection.selected_at_ms,
  });
}

function candidateEvents() {
  const events = [];
  const turnId = id('turn', 1);
  const taskId = id('task', 2);
  const runId = id('run', 3);
  append(events, 'turn_submitted', {
    message: { message_id: id('message', 4), text: 'Build a focused timer.' },
    turn_id: turnId,
    mode: 'work',
    task: { task_id: taskId, title: 'Create Builder project' },
    base_revision: null,
  }, 5);
  append(events, 'run_started', {
    turn_id: turnId,
    run_id: runId,
    task_id: taskId,
    attempt_number: 1,
    retry_of_run_id: null,
    input_digest: `sha256:${'8'.repeat(64)}`,
  }, 6);
  append(events, 'run_completed', {
    turn_id: turnId,
    run_id: runId,
    terminal_status: 'succeeded',
    result_kind: 'candidate',
    result_digest: DIGEST,
    assistant_message: {
      message_id: id('message', 7),
      text: 'A timer draft is ready to review.',
    },
    candidate_result: {
      draft_id: `builder-generation-draft:${'9'.repeat(64)}`,
      title: 'Focused timer',
      summary: 'A focused timer draft.',
      git_candidate_receipt: candidateReceipt(turnId, taskId, runId),
    },
  }, 8);
  append(events, 'turn_completed', {
    turn_id: turnId,
    run_id: runId,
    outcome: 'candidate_ready',
  }, 9);
  return events;
}

async function toolCallEvents() {
  const events = [];
  const turnId = id('turn', 30);
  const taskId = id('task', 31);
  const runId = id('run', 32);
  append(events, 'turn_submitted', {
    message: { message_id: id('message', 33), text: 'Inspect the project source.' },
    turn_id: turnId,
    mode: 'work',
    task: { task_id: taskId, title: 'Inspect source' },
    base_revision: null,
  }, 34);
  append(events, 'run_started', {
    turn_id: turnId,
    run_id: runId,
    task_id: taskId,
    attempt_number: 1,
    retry_of_run_id: null,
    input_digest: DIGEST,
  }, 35);
  append(events, 'tool_call_requested', {
    tool_call_record: await toolCallRecord({
      turnId,
      taskId,
      runId,
      stepId: id('run-step', 36),
      toolCallId: id('tool-call', 37),
    }),
  }, 36);
  return events;
}

async function toolResultEvents() {
  const events = await toolCallEvents();
  append(events, 'tool_call_result_recorded', {
    tool_result_record: toolResultRecord(events.at(-1).payload.tool_call_record),
  }, 37);
  return events;
}

function rejectedCandidateEvents() {
  const events = candidateEvents();
  append(events, 'candidate_rejected', {
    turn_id: id('turn', 1),
    run_id: id('run', 3),
    draft_id: `builder-generation-draft:${'9'.repeat(64)}`,
    review_id: id('review', 10),
    reviewer_id: id('user', 11),
    reviewed_at_ms: 2_000,
    decision: 'rejected',
  }, 10);
  return events;
}

function acceptedCandidateEvents() {
  const events = candidateEvents();
  append(events, 'candidate_accepted', {
    turn_id: id('turn', 1),
    run_id: id('run', 3),
    draft_id: `builder-generation-draft:${'9'.repeat(64)}`,
    review_id: id('review', 12),
    reviewer_id: id('user', 13),
    reviewed_at_ms: 3_000,
    decision: 'accepted',
    revision: {
      revision_receipt_digest: `sha256:${'a'.repeat(64)}`,
      revision_number: 3,
    },
  }, 11);
  return events;
}

async function planReviewEvents(decision = 'approved') {
  const events = [];
  const turnId = id('turn', 40);
  const taskId = id('task', 41);
  const runId = id('run', 42);
  append(events, 'turn_submitted', {
    message: { message_id: id('message', 43), text: 'Inspect and plan the project.' },
    turn_id: turnId,
    mode: 'work',
    task: { task_id: taskId, title: 'Plan project update' },
    base_revision: null,
  }, 44);
  append(events, 'run_started', {
    turn_id: turnId,
    run_id: runId,
    task_id: taskId,
    attempt_number: 1,
    retry_of_run_id: null,
    input_digest: DIGEST,
  }, 45);
  const callRecord = await toolCallRecord({
    turnId,
    taskId,
    runId,
    stepId: id('run-step', 46),
    toolCallId: id('tool-call', 47),
  });
  append(events, 'tool_call_requested', {
    tool_call_record: callRecord,
  }, 46);
  const resultRecord = toolResultRecord(callRecord, {
    result: {
      status: 'succeeded',
      summary_code: 'completed_without_raw_output',
    },
  });
  append(events, 'tool_call_result_recorded', {
    tool_result_record: resultRecord,
  }, 47);
  append(events, 'run_completed', {
    turn_id: turnId,
    run_id: runId,
    terminal_status: 'succeeded',
    result_kind: 'plan',
    result_digest: DIGEST,
    assistant_message: {
      message_id: id('message', 48),
      text: 'Review the proposed plan before project files change.',
    },
    candidate_result: null,
    plan_admission: planAdmission(events.at(-1), callRecord, resultRecord),
  }, 48);
  append(events, 'turn_completed', {
    turn_id: turnId,
    run_id: runId,
    outcome: 'plan_proposed',
  }, 49);
  append(events, 'plan_reviewed', {
    turn_id: turnId,
    run_id: runId,
    plan_result_digest: DIGEST,
    review_id: id('review', 50),
    reviewer_id: id('user', 51),
    reviewed_at_ms: 4_000,
    decision,
  }, 50);
  return events;
}

function explanationHistory(turnCount) {
  const events = [];
  for (let turn = 1; turn <= turnCount; turn += 1) {
    const seed = turn * 10;
    const turnId = id('turn', turn);
    const runId = id('run', turn);
    append(events, 'turn_submitted', {
      message: { message_id: id('message', seed), text: `Explain change ${turn}.` },
      turn_id: turnId,
      mode: 'question',
      task: null,
      base_revision: null,
    }, seed);
    append(events, 'run_started', {
      turn_id: turnId,
      run_id: runId,
      task_id: null,
      attempt_number: 1,
      retry_of_run_id: null,
      input_digest: DIGEST,
    }, seed + 1);
    append(events, 'run_completed', {
      turn_id: turnId,
      run_id: runId,
      terminal_status: 'succeeded',
      result_kind: 'explanation',
      result_digest: DIGEST,
      assistant_message: {
        message_id: id('message', seed + 1),
        text: `Change ${turn} is recorded.`,
      },
      candidate_result: null,
    }, seed + 2);
    append(events, 'turn_completed', {
      turn_id: turnId,
      run_id: runId,
      outcome: 'answered',
    }, seed + 3);
  }
  return events;
}

function input(events) {
  return {
    project_id: PROJECT_ID,
    conversation: {
      conversation_id: CONVERSATION_ID,
      created_at_ms: 1_000,
      events,
    },
  };
}

function contextStatusProjection(overrides = {}) {
  const base = {
    projection_version: 'builder-context-status-projection.v1',
    label: 'Handoff received',
    tone: 'warning',
    next_action_hint: 'Review the handoff before the next change.',
    has_pending_handoff: true,
    pending_handoff_count: 1,
    needs_confirmation: true,
    can_contextual_execute: false,
    authority: {
      projection_authority: 'main_owned_context_status_projection_v1',
      working_context_state: 'verified_not_exposed',
      pending_handoff_packets: 'pending_count_only',
      renderer_authority: 'not_present',
      ipc_authority: 'not_present',
      provider_dispatch: false,
      tool_dispatch: false,
      source_read: 'not_present',
      source_write: 'not_present',
      git_mutation: false,
      permission_grant: false,
      revision_admission: 'not_created',
      secret_access: 'not_present',
    },
  };
  return {
    ...base,
    ...overrides,
    authority: {
      ...base.authority,
      ...(overrides.authority ?? {}),
    },
  };
}

function assertProjectionError(error) {
  assert.equal(error instanceof BuilderTaskStreamProjectionError, true);
  assert.equal(error.code, 'builder_task_stream_unavailable');
  assert.equal(error.message, 'Project activity is unavailable.');
  assert.equal(error.retryable, true);
  assert.equal(error.stack, `${error.name}: ${error.message}`);
  return true;
}

test('projects canonical events into bounded renderer-safe activity items', () => {
  const stream = projectBuilderTaskStream(input(candidateEvents()));
  assert.equal(stream.stream_version, BUILDER_TASK_STREAM_VERSION);
  assert.equal(stream.project_id, PROJECT_ID);
  assert.equal(stream.conversation.head_sequence, 4);
  assert.equal(stream.conversation.recorded_active_turn_id, null);
  assert.deepEqual(stream.conversation.window, {
    first_sequence: 1,
    last_sequence: 4,
    has_earlier: false,
  });
  assert.equal(stream.conversation.items[0].item_kind, 'user_message');
  assert.deepEqual(stream.conversation.items[1], {
    item_kind: 'run_started',
    sequence: 2,
    turn_id: id('turn', 1),
    run_id: id('run', 3),
    task_id: id('task', 2),
    attempt_number: 1,
    retry_of_run_id: null,
    recorded_state: 'started',
  });
  assert.deepEqual(stream.conversation.items[2].candidate, {
    draft_id: `builder-generation-draft:${'9'.repeat(64)}`,
    title: 'Focused timer',
    summary: 'A focused timer draft.',
    candidate_state: 'proposed',
    source_availability: 'not_loaded',
  });
  assert.deepEqual(stream.authority, {
    conversation: 'sqlite_canonical_event_replay_or_absent',
    project_source: 'not_included',
    candidate_source: 'not_loaded',
    project_revision: 'not_inferred',
  });
  assert.equal(Object.isFrozen(stream), true);
  assert.equal(Object.isFrozen(stream.conversation.items), true);
  assert.equal(Object.isFrozen(stream.conversation.items[2].candidate), true);
});

test('projects queued active-run follow-ups as bounded user messages', () => {
  const events = [];
  append(events, 'turn_submitted', {
    message: { message_id: id('message', 66), text: 'Build a calmer dashboard.' },
    turn_id: id('turn', 60),
    mode: 'work',
    task: { task_id: id('task', 61), title: 'Build dashboard' },
    base_revision: null,
  }, 66);
  append(events, 'run_started', {
    turn_id: id('turn', 60),
    run_id: id('run', 62),
    task_id: id('task', 61),
    attempt_number: 1,
    retry_of_run_id: null,
    input_digest: DIGEST,
  }, 67);
  append(events, 'turn_followup_queued', {
    turn_id: id('turn', 60),
    run_id: id('run', 62),
    message: {
      message_id: id('message', 68),
      text: 'After this, make the summary shorter.',
    },
  }, 68);

  const stream = projectBuilderTaskStream(input(events));

  assert.equal(stream.conversation.recorded_active_turn_id, id('turn', 60));
  assert.deepEqual(stream.conversation.items[2], {
    item_kind: 'user_message',
    sequence: 3,
    turn_id: id('turn', 60),
    message: {
      message_id: id('message', 68),
      text: 'After this, make the summary shorter.',
    },
    message_kind: 'queued_followup',
    mode: null,
    task: null,
  });
  assert.doesNotMatch(
    JSON.stringify(stream),
    /provider|credential|git_candidate_receipt|commit_oid|tree_oid|source_tree|save_admission|running|live|input_digest/iu,
  );
});

test('projects queued follow-up consumption as a compact receipt', () => {
  const events = [];
  append(events, 'turn_submitted', {
    message: { message_id: id('message', 660), text: 'Build a calmer dashboard.' },
    turn_id: id('turn', 660),
    mode: 'work',
    task: { task_id: id('task', 661), title: 'Build dashboard' },
    base_revision: null,
  }, 660);
  append(events, 'run_started', {
    turn_id: id('turn', 660),
    run_id: id('run', 662),
    task_id: id('task', 661),
    attempt_number: 1,
    retry_of_run_id: null,
    input_digest: DIGEST,
  }, 661);
  append(events, 'turn_followup_queued', {
    turn_id: id('turn', 660),
    run_id: id('run', 662),
    message: {
      message_id: id('message', 663),
      text: 'Then make the summary shorter.',
    },
  }, 662);
  append(events, 'run_completed', {
    turn_id: id('turn', 660),
    run_id: id('run', 662),
    terminal_status: 'succeeded',
    result_kind: 'candidate',
    result_digest: DIGEST,
    assistant_message: { message_id: id('message', 664), text: 'The draft is ready.' },
    candidate_result: {
      draft_id: `builder-generation-draft:${'6'.repeat(64)}`,
      title: 'Generated dashboard',
      summary: 'A generated dashboard candidate.',
      git_candidate_receipt: {
        receipt_version: 'builder-git-candidate-receipt.v1',
        repository_version: 'builder-git-project-repository.v1',
        project_id: PROJECT_ID,
        conversation_id: CONVERSATION_ID,
        turn_id: id('turn', 660),
        task_id: id('task', 661),
        run_id: id('run', 662),
        request_id: id('git-request', 662),
        candidate_id: `builder-code-change-candidate:${'7'.repeat(64)}`,
        candidate_digest: DIGEST,
        resulting_tree_digest: DIGEST,
        semantic_identity_digest: DIGEST,
        verification_receipt_digest: DIGEST,
        object_format: 'sha1',
        commit_oid: '2'.repeat(40),
        tree_oid: '3'.repeat(40),
        parent_oid: null,
        expected_base_oid: null,
        code_authority: 'git_commit_candidate',
        product_revision_admission: 'not_recorded',
        replay: false,
      },
    },
  }, 663);
  append(events, 'turn_completed', {
    turn_id: id('turn', 660),
    run_id: id('run', 662),
    outcome: 'candidate_ready',
  }, 664);
  append(events, 'turn_submitted', {
    message: { message_id: id('message', 665), text: 'Then make the summary shorter.' },
    turn_id: id('turn', 666),
    mode: 'work',
    task: { task_id: id('task', 667), title: 'Shorten summary' },
    base_revision: null,
  }, 665);
  append(events, 'turn_followup_consumed', {
    turn_id: id('turn', 660),
    run_id: id('run', 662),
    message_id: id('message', 663),
    consuming_turn_id: id('turn', 666),
    consuming_message_id: id('message', 665),
  }, 666);

  const stream = projectBuilderTaskStream(input(events));

  assert.deepEqual(stream.conversation.items.at(-1), {
    item_kind: 'queued_followup_consumed',
    sequence: 7,
    turn_id: id('turn', 660),
    run_id: id('run', 662),
    message_id: id('message', 663),
    consumed_by: {
      turn_id: id('turn', 666),
      message_id: id('message', 665),
    },
    recorded_state: 'consumed',
  });
  assert.doesNotMatch(
    JSON.stringify(stream),
    /provider|credential|git_candidate_receipt|commit_oid|tree_oid|source_tree|save_admission|permission_admission/iu,
  );
});

test('projects task brief updates as compact renderer-safe context items', () => {
  const events = [];
  append(events, 'turn_submitted', {
    message: { message_id: id('message', 210), text: '我想先聊一下这个作品集首页怎么做。' },
    turn_id: id('turn', 210),
    mode: 'question',
    task: null,
    base_revision: null,
    route_decision: routeDecision({
      message: { message_id: id('message', 210), text: '我想先聊一下这个作品集首页怎么做。' },
      mode: 'question',
      task: null,
    }, {
      route: 'update_brief',
      confidence: 'medium',
      matched_signals: ['exploratory_work'],
      dispatch: 'brief_update',
    }),
  }, 210);
  append(events, 'run_started', {
    turn_id: id('turn', 210),
    run_id: id('run', 211),
    task_id: null,
    attempt_number: 1,
    retry_of_run_id: null,
    input_digest: DIGEST,
  }, 211);
  append(events, 'run_completed', {
    turn_id: id('turn', 210),
    run_id: id('run', 211),
    terminal_status: 'succeeded',
    result_kind: 'explanation',
    result_digest: DIGEST,
    assistant_message: {
      message_id: id('message', 212),
      text: '可以先做一个单页作品集，包含 hero、项目卡片和联系入口。',
    },
    candidate_result: null,
  }, 212);
  append(events, 'task_brief_updated', {
    turn_id: id('turn', 210),
    run_id: id('run', 211),
    message_id: id('message', 210),
    task_capsule: {
      capsule_version: 'builder-task-capsule.v1',
      task_id: id('task', 213),
      project_id: PROJECT_ID,
      title: 'Current project brief',
      goal: '我想先聊一下这个作品集首页怎么做。',
      status: 'ready',
      current_brief: {
        brief_version: 'builder-working-brief.v1',
        source: 'task_capsule_update',
        latest_user_goal: '我想先聊一下这个作品集首页怎么做。',
        assistant_proposal: '可以先做一个单页作品集，包含 hero、项目卡片和联系入口。',
        approved_plan: null,
        use_when_instruction_is_contextual: true,
      },
      last_route_decision_id: events[0].payload.route_decision.decision_id,
      updated_at_ms: 4_000,
    },
  }, 213);
  append(events, 'turn_completed', {
    turn_id: id('turn', 210),
    run_id: id('run', 211),
    outcome: 'answered',
  }, 214);

  const stream = projectBuilderTaskStream(input(events));

  assert.deepEqual(stream.conversation.items[3], {
    item_kind: 'task_brief_updated',
    sequence: 4,
    turn_id: id('turn', 210),
    run_id: id('run', 211),
    task: {
      task_id: id('task', 213),
      title: 'Current project brief',
    },
    brief: {
      status: 'ready',
      summary: '我想先聊一下这个作品集首页怎么做。 可以先做一个单页作品集，包含 hero、项目卡片和联系入口。',
      contextual_build_ready: true,
    },
    recorded_state: 'updated',
  });
  assert.doesNotMatch(
    JSON.stringify(stream),
    /route_decision|builder-route-decision|provider|credential|source_tree|revision_receipt|commit_oid/iu,
  );
});

test('projects route downgrade facts without exposing private route evidence', () => {
  const events = [];
  const turnId = id('turn', 240);
  const runId = id('run', 241);
  const messageId = id('message', 242);
  append(events, 'turn_submitted', {
    message: { message_id: messageId, text: '那就写' },
    turn_id: turnId,
    mode: 'question',
    task: null,
    base_revision: null,
    route_decision: routeDecision({
      message: { message_id: messageId, text: '那就写' },
      mode: 'question',
      task: null,
    }, {
      route: 'clarify',
      confidence: 'medium',
      matched_signals: ['clear_build'],
      downgraded_from: 'build',
      downgrade_reason: 'missing_prior_build_context',
      dispatch: 'reply',
    }),
  }, 240);
  append(events, 'run_started', {
    turn_id: turnId,
    run_id: runId,
    task_id: null,
    attempt_number: 1,
    retry_of_run_id: null,
    input_digest: DIGEST,
  }, 241);
  append(events, 'run_context_snapshot_recorded', {
    turn_id: turnId,
    run_id: runId,
    snapshot: runContextSnapshot({
      turnId,
      taskId: null,
      runId,
      messageId,
      routeDecisionRecord: events[0].payload.route_decision,
    }),
  }, 242);

  const stream = projectBuilderTaskStream(input(events));

  assert.deepEqual(stream.conversation.items[2], {
    item_kind: 'run_context_snapshot_recorded',
    sequence: 3,
    turn_id: turnId,
    run_id: runId,
    task_id: null,
    context: {
      recorded_state: 'recorded',
      route: 'clarify',
      dispatch: 'reply',
      downgraded_from: 'build',
      downgrade_reason: 'missing_prior_build_context',
      brief: 'not_available',
      base: 'new_project_or_unsaved',
      permission_result: 'not_required',
      command_execution: 'not_included',
      network_access: 'not_included',
    },
  });
  assert.doesNotMatch(
    JSON.stringify(stream),
    /route_decision|builder-route-decision|confidence|required_permissions|provider|credential|source_tree|revision_receipt|commit_oid/iu,
  );
});

test('represents a missing conversation as a legal empty result', () => {
  assert.deepEqual(projectBuilderTaskStream({
    project_id: PROJECT_ID,
    conversation: null,
  }), {
    stream_version: BUILDER_TASK_STREAM_VERSION,
    project_id: PROJECT_ID,
    conversation: null,
    authority: {
      conversation: 'sqlite_canonical_event_replay_or_absent',
      project_source: 'not_included',
      candidate_source: 'not_loaded',
      project_revision: 'not_inferred',
    },
  });
});

test('projects fixed run progress as renderer-safe status items', () => {
  const events = [];
  append(events, 'turn_submitted', {
    message: { message_id: id('message', 80), text: 'Build a focused timer.' },
    turn_id: id('turn', 80),
    mode: 'work',
    task: { task_id: id('task', 81), title: 'Create Builder project' },
    base_revision: null,
  }, 82);
  append(events, 'run_started', {
    turn_id: id('turn', 80),
    run_id: id('run', 83),
    task_id: id('task', 81),
    attempt_number: 1,
    retry_of_run_id: null,
    input_digest: DIGEST,
  }, 83);
  append(events, 'run_progress_recorded', {
    turn_id: id('turn', 80),
    run_id: id('run', 83),
    stage: 'context_ready',
  }, 84);
  append(events, 'run_progress_recorded', {
    turn_id: id('turn', 80),
    run_id: id('run', 83),
    stage: 'provider_request_started',
  }, 85);
  append(events, 'run_progress_recorded', {
    turn_id: id('turn', 80),
    run_id: id('run', 83),
    stage: 'provider_response_received',
  }, 86);
  append(events, 'run_progress_recorded', {
    turn_id: id('turn', 80),
    run_id: id('run', 83),
    stage: 'result_preparing',
  }, 87);

  const stream = projectBuilderTaskStream(input(events));

  assert.deepEqual(stream.conversation.items.slice(2), [
    {
      item_kind: 'run_progress_recorded',
      sequence: 3,
      turn_id: id('turn', 80),
      run_id: id('run', 83),
      stage: 'context_ready',
      recorded_state: 'recorded',
    },
    {
      item_kind: 'run_progress_recorded',
      sequence: 4,
      turn_id: id('turn', 80),
      run_id: id('run', 83),
      stage: 'provider_request_started',
      recorded_state: 'recorded',
    },
    {
      item_kind: 'run_progress_recorded',
      sequence: 5,
      turn_id: id('turn', 80),
      run_id: id('run', 83),
      stage: 'provider_response_received',
      recorded_state: 'recorded',
    },
    {
      item_kind: 'run_progress_recorded',
      sequence: 6,
      turn_id: id('turn', 80),
      run_id: id('run', 83),
      stage: 'result_preparing',
      recorded_state: 'recorded',
    },
  ]);
  assert.doesNotMatch(
    JSON.stringify(stream),
    /provider_secret|credential|source_tree|git_candidate_receipt|commit_oid|tree_oid|input_digest|prompt|token/iu,
  );
});

test('projects admitted Agent step progress without exposing admission evidence', () => {
  const events = [];
  const turnId = id('turn', 150);
  const taskId = id('task', 151);
  const runId = id('run', 152);
  append(events, 'turn_submitted', {
    message: { message_id: id('message', 153), text: 'Build a focused timer.' },
    turn_id: turnId,
    mode: 'work',
    task: { task_id: taskId, title: 'Create Builder project' },
    base_revision: null,
  }, 154);
  append(events, 'run_started', {
    turn_id: turnId,
    run_id: runId,
    task_id: taskId,
    attempt_number: 1,
    retry_of_run_id: null,
    input_digest: DIGEST,
  }, 155);
  append(events, 'agent_step_progress_recorded', {
    progress_admission: agentStepProgressAdmission({
      turnId,
      taskId,
      runId,
      index: 156,
      recordedState: 'start_recorded',
    }),
  }, 156);
  append(events, 'agent_step_progress_recorded', {
    progress_admission: agentStepProgressAdmission({
      turnId,
      taskId,
      runId,
      index: 156,
      recordedState: 'result_recorded',
      resultStatus: 'blocked',
    }),
  }, 157);

  const stream = projectBuilderTaskStream(input(events));

  assert.deepEqual(stream.conversation.items.slice(2), [
    {
      item_kind: 'agent_step_progress_recorded',
      sequence: 3,
      turn_id: turnId,
      run_id: runId,
      task_id: taskId,
      step_id: id('run-step', 156),
      step_index: 156,
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
      turn_id: turnId,
      run_id: runId,
      task_id: taskId,
      step_id: id('run-step', 156),
      step_index: 156,
      recorded_state: 'result_recorded',
      result: {
        status: 'blocked',
        summary_code: 'agent_step_needs_owner_attention',
        display_summary: 'Agent step needs owner attention.',
      },
      summary: {
        status: 'blocked',
        display_summary: 'Agent step needs owner attention.',
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
    /progress_admission|admission_digest|read_service|step_start_count|step_result_count|provider|credential|source_tree|stdout|stderr|commit_oid|tree_oid|input_digest|prompt|token/iu,
  );
});

test('projects failed runs with only a fixed public failure phase', () => {
  const events = [];
  append(events, 'turn_submitted', {
    message: { message_id: id('message', 86), text: 'Build a static blog page.' },
    turn_id: id('turn', 86),
    mode: 'work',
    task: { task_id: id('task', 87), title: 'Create static blog' },
    base_revision: null,
  }, 88);
  append(events, 'run_started', {
    turn_id: id('turn', 86),
    run_id: id('run', 89),
    task_id: id('task', 87),
    attempt_number: 1,
    retry_of_run_id: null,
    input_digest: DIGEST,
  }, 89);
  append(events, 'run_progress_recorded', {
    turn_id: id('turn', 86),
    run_id: id('run', 89),
    stage: 'context_ready',
  }, 90);
  append(events, 'run_progress_recorded', {
    turn_id: id('turn', 86),
    run_id: id('run', 89),
    stage: 'provider_request_started',
  }, 91);
  append(events, 'run_completed', {
    turn_id: id('turn', 86),
    run_id: id('run', 89),
    terminal_status: 'failed',
    result_kind: 'failure',
    result_digest: DIGEST,
    assistant_message: {
      message_id: id('message', 92),
      text: 'The AI request ended before it returned a usable draft.',
    },
    candidate_result: null,
  }, 92);
  append(events, 'turn_completed', {
    turn_id: id('turn', 86),
    run_id: id('run', 89),
    outcome: 'failed',
  }, 93);

  const stream = projectBuilderTaskStream(input(events));

  assert.deepEqual(stream.conversation.items[4], {
    item_kind: 'run_completed',
    sequence: 5,
    turn_id: id('turn', 86),
    run_id: id('run', 89),
    terminal_status: 'failed',
    result_kind: 'failure',
    failure_phase: 'provider_request_started',
    assistant_message: {
      message_id: id('message', 92),
      text: 'The AI request ended before it returned a usable draft.',
    },
    candidate: null,
  });
  assert.doesNotMatch(
    JSON.stringify(stream),
    /provider_secret|credential|source_tree|git_candidate_receipt|commit_oid|tree_oid|input_digest|result_digest|failure_code|prompt|token/iu,
  );
});

test('projects rejected candidates without exposing review identity or Git evidence', () => {
  const stream = projectBuilderTaskStream(input(rejectedCandidateEvents()));
  assert.deepEqual(stream.conversation.items.at(-1), {
    item_kind: 'candidate_reviewed',
    sequence: 5,
    turn_id: id('turn', 1),
    run_id: id('run', 3),
    draft_id: `builder-generation-draft:${'9'.repeat(64)}`,
    decision: 'rejected',
    candidate_state: 'rejected',
    saved_revision: null,
  });
  assert.doesNotMatch(
    JSON.stringify(stream),
    /review_id|reviewer_id|reviewed_at_ms|git_candidate_receipt|candidate_digest|commit_oid|tree_oid|credential|provider/iu,
  );
});

test('projects accepted candidates as saved versions without exposing revision evidence', () => {
  const stream = projectBuilderTaskStream(input(acceptedCandidateEvents()));
  assert.deepEqual(stream.conversation.items.at(-1), {
    item_kind: 'candidate_reviewed',
    sequence: 5,
    turn_id: id('turn', 1),
    run_id: id('run', 3),
    draft_id: `builder-generation-draft:${'9'.repeat(64)}`,
    decision: 'accepted',
    candidate_state: 'saved',
    saved_revision: { revision_number: 3 },
  });
  assert.doesNotMatch(
    JSON.stringify(stream),
    /review_id|reviewer_id|reviewed_at_ms|revision_receipt|candidate_digest|commit_oid|tree_oid|credential|provider|source_tree/iu,
  );
});

test('projects plan reviews as public decisions without exposing review evidence', async () => {
  const stream = projectBuilderTaskStream(input(await planReviewEvents('approved')));
  assert.deepEqual(stream.conversation.items.at(-1), {
    item_kind: 'plan_reviewed',
    sequence: 7,
    turn_id: id('turn', 40),
    run_id: id('run', 42),
    decision: 'approved',
    plan_state: 'approved',
  });
  assert.equal(stream.conversation.items[4].result_kind, 'plan');
  assert.equal(stream.conversation.items[4].candidate, null);
  assert.doesNotMatch(
    JSON.stringify(stream),
    /plan_result_digest|review_id|reviewer_id|reviewed_at_ms|plan_body|record_digest|context_digest|head_digest|credential|provider|source_tree|git_candidate_receipt|commit_oid|tree_oid/iu,
  );
});

test('describes a persisted start as recorded rather than claiming a live run', () => {
  const stream = projectBuilderTaskStream(input(candidateEvents().slice(0, 2)));
  assert.equal(stream.conversation.recorded_active_turn_id, id('turn', 1));
  assert.equal(stream.conversation.items.at(-1).recorded_state, 'started');
  assert.doesNotMatch(JSON.stringify(stream), /running|live|save_admission|save_available/iu);
});

test('projects pre-dispatch tool calls without exposing permission or resource evidence', async () => {
  const stream = projectBuilderTaskStream(input(await toolCallEvents()));
  assert.equal(stream.conversation.recorded_active_turn_id, id('turn', 30));
  assert.deepEqual(stream.conversation.items.at(-1), {
    item_kind: 'tool_call_requested',
    sequence: 3,
    turn_id: id('turn', 30),
    run_id: id('run', 32),
    step_id: id('run-step', 36),
    tool_call_id: id('tool-call', 37),
    tool_label: 'Read project file',
    action: 'filesystem.read',
    resource: {
      resource_kind: 'filesystem',
    },
    lifecycle: {
      permission_admission: 'verified_allowed',
      dispatch_admission: 'not_started',
      execution_admission: 'not_performed',
      result_admission: 'not_recorded',
    },
    recorded_state: 'requested',
  });
  assert.doesNotMatch(
    JSON.stringify(stream),
    /session_policy|permission_id|permission_admission_receipt|record_digest|evidence_digest|resource_id|project:\/src\/app\.tsx|provider|credential|source_tree|git_candidate_receipt|commit_oid|tree_oid/iu,
  );
});

test('projects fixed-code tool results without exposing records or raw output', async () => {
  const stream = projectBuilderTaskStream(input(await toolResultEvents()));
  assert.equal(stream.conversation.recorded_active_turn_id, id('turn', 30));
  assert.deepEqual(stream.conversation.items.at(-1), {
    item_kind: 'tool_call_result_recorded',
    sequence: 4,
    turn_id: id('turn', 30),
    run_id: id('run', 32),
    step_id: id('run-step', 36),
    tool_call_id: id('tool-call', 37),
    tool_label: 'Read project file',
    action: 'filesystem.read',
    resource: {
      resource_kind: 'filesystem',
    },
    result: {
      status: 'failed',
      summary_code: 'output_rejected',
      display_summary: 'The tool output was not accepted.',
    },
    lifecycle: {
      result_admission: 'fixed_summary_code_recorded',
      raw_output_admission: 'not_included',
      revision_admission: 'not_created',
    },
    recorded_state: 'recorded',
  });
  assert.doesNotMatch(
    JSON.stringify(stream),
    /tool_result_record|tool_call_record|session_policy|tool_name|permission_id|permission_admission_receipt|record_digest|summary_digest|evidence_digest|policy_digest|dispatch_request_id|dispatch_admission_digest|adapter_selection_id|adapter_selection_digest|runtime_invocation_id|runtime_invocation_digest|runtime_invocation_admission|adapter_id|runtime_id|resource_id|project:\/src\/app\.tsx|stdout|stderr|output_digest|provider|credential|source_tree|git_candidate_receipt|commit_oid|tree_oid/iu,
  );
});

test('rejects forged tool result projections before exposing public items', async () => {
  const events = structuredClone(await toolResultEvents());
  events.at(-1).payload.tool_result_record.result.display_summary = 'Raw output follows.';
  assert.throws(() => projectBuilderTaskStream(input(events)), assertProjectionError);
});

test('replays the complete chain before exposing only the latest 128 items', () => {
  const events = explanationHistory(33);
  const stream = projectBuilderTaskStream(input(events));
  assert.equal(MAX_PUBLIC_ITEMS, 128);
  assert.equal(MAX_PUBLIC_BYTES, 4 * 1_024 * 1_024);
  assert.equal(stream.conversation.items.length, 128);
  assert.deepEqual(stream.conversation.window, {
    first_sequence: 5,
    last_sequence: 132,
    has_earlier: true,
  });
  assert.equal(stream.conversation.head_sequence, 132);
  assert.ok(Buffer.byteLength(JSON.stringify(stream), 'utf8') <= MAX_PUBLIC_BYTES);

  const forged = structuredClone(events);
  forged[0].payload.message.text = 'tampered before the visible window';
  assert.throws(() => projectBuilderTaskStream(input(forged)), assertProjectionError);
});

test('does not expose Git receipts, digests, commands, or provider material', () => {
  const serialized = JSON.stringify(projectBuilderTaskStream(input(candidateEvents())));
  assert.doesNotMatch(
    serialized,
    /git_candidate_receipt|candidate_digest|result_digest|input_digest|event_digest|event_id|command_id|commit_oid|tree_oid|base_revision|policy_digest|dispatch_request_id|dispatch_admission_digest|adapter_selection_id|adapter_selection_digest|runtime_invocation_id|runtime_invocation_digest|runtime_invocation_admission|adapter_id|runtime_id|provider|credential|secret|save_admission/iu,
  );
});

test('carries optional renderer-safe context status projection without exposing context authority', () => {
  const stream = projectBuilderTaskStream({
    ...input(candidateEvents()),
    context_status_projection: contextStatusProjection(),
  });

  assert.equal(stream.context_status_projection.label, 'Handoff received');
  assert.equal(stream.context_status_projection.has_pending_handoff, true);
  assert.equal(stream.context_status_projection.pending_handoff_count, 1);
  assert.equal(stream.context_status_projection.can_contextual_execute, false);
  assert.doesNotMatch(
    JSON.stringify(stream.context_status_projection),
    /WorkingContext|Task Capsule|builder-handoff-packet|builder-task-address:|builder-conversation:|sha256:|provider_(?:secret|config|envelope)|credential|source_tree/iu,
  );
});

test('rejects forged optional context status projection before exposing it', () => {
  assert.throws(() => projectBuilderTaskStream({
    ...input(candidateEvents()),
    context_status_projection: contextStatusProjection({
      label: 'Handoff received sha256:aaaaaaaa',
    }),
  }), assertProjectionError);

  assert.throws(() => projectBuilderTaskStream({
    ...input(candidateEvents()),
    context_status_projection: contextStatusProjection({
      authority: {
        source_read: 'allowed',
      },
    }),
  }), assertProjectionError);
});

test('rejects forged input with one fixed redacted error', () => {
  const valid = input(candidateEvents());
  const extra = structuredClone(valid);
  extra.internal = 'private-marker';
  const sparse = [...valid.conversation.events];
  delete sparse[1];
  let getterCalls = 0;
  const accessorEvents = [...valid.conversation.events];
  Object.defineProperty(accessorEvents, '1', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return valid.conversation.events[1];
    },
  });
  const customPrototypeEvents = [...valid.conversation.events];
  Object.setPrototypeOf(customPrototypeEvents, {
    map() {
      getterCalls += 1;
      return [];
    },
  });
  assert.throws(() => projectBuilderTaskStream(extra), assertProjectionError);
  assert.throws(() => projectBuilderTaskStream({
    project_id: PROJECT_ID,
    conversation: {
      ...valid.conversation,
      events: sparse,
    },
  }), assertProjectionError);
  assert.throws(() => projectBuilderTaskStream(input(accessorEvents)), assertProjectionError);
  assert.throws(
    () => projectBuilderTaskStream(input(customPrototypeEvents)),
    assertProjectionError,
  );
  assert.throws(() => projectBuilderTaskStream(new Proxy(valid, {})), assertProjectionError);
  assert.equal(getterCalls, 0);
  assert.doesNotMatch(assertProjectionError.toString(), /private-marker/u);
});

test('stays pure and cannot read SQLite, Git, IPC, renderer, provider, or source files', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-task-stream-projection.cjs'),
    'utf8',
  );
  assert.match(source, /MAX_PUBLIC_ITEMS = 128/u);
  assert.match(source, /MAX_PUBLIC_BYTES = 4 \* 1_024 \* 1_024/u);
  assert.match(source, /replayBuilderConversation/u);
  assert.doesNotMatch(source, /events\.map\(itemFromEvent\)/u);
  assert.doesNotMatch(
    source,
    /node:sqlite|node:fs|builder-product-metadata|builder-git|ipcMain|ipcRenderer|BrowserWindow|preload|fetch\s*\(|provider|credential|source_tree/iu,
  );
});
