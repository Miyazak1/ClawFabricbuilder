'use strict';

const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const test = require('node:test');

const {
  CONVERSATION_EVENT_VERSION,
  CONVERSATION_EVENT_KIND,
  CONVERSATION_AUTHORITY,
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
  CONVERSATION_REPLAY_VERSION,
  BuilderConversationReplayError,
  replayBuilderConversation,
} = require('../electron/builder-conversation-replay.cjs');

const PROJECT_ID = 'builder-project:22222222-2222-4222-8222-222222222222';
const CONVERSATION_ID = 'builder-conversation:22222222-2222-4222-8222-222222222222';
const RESULT_A = `sha256:${'a'.repeat(64)}`;
const RESULT_B = `sha256:${'b'.repeat(64)}`;
const COMMIT_OID = 'c'.repeat(40);
const PERMISSION_ID = `builder-permission:${'a'.repeat(64)}`;
const BASE_REVISION = Object.freeze({
  revision_receipt_digest: RESULT_A,
  commit_oid: COMMIT_OID,
});

function uuid(index) { return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`; }
function id(kind, index) { return `builder-${kind}:${uuid(index)}`; }

function idIndex(value) {
  return Number.parseInt(value.slice(-12), 16);
}

function candidateResult(turnId, runId, candidateDigest) {
  const index = idIndex(runId);
  return {
    draft_id: `builder-generation-draft:${index.toString(16).padStart(64, '0')}`,
    title: 'Generated project',
    summary: 'A generated project candidate.',
    git_candidate_receipt: {
      receipt_version: 'builder-git-candidate-receipt.v1',
      repository_version: 'builder-git-project-repository.v1',
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      turn_id: turnId,
      task_id: id('task', index),
      run_id: runId,
      request_id: id('git-request', index),
      candidate_id: `builder-code-change-candidate:${index.toString(16).padStart(64, '0')}`,
      candidate_digest: candidateDigest,
      resulting_tree_digest: RESULT_A,
      semantic_identity_digest: RESULT_B,
      verification_receipt_digest: RESULT_A,
      object_format: 'sha1',
      commit_oid: '1'.repeat(40),
      tree_oid: '2'.repeat(40),
      parent_oid: null,
      expected_base_oid: null,
      code_authority: 'git_commit_candidate',
      product_revision_admission: 'not_recorded',
      replay: false,
    },
  };
}

async function toolCallRecord({
  turnId = id('turn', 1),
  taskId = id('task', 1),
  runId = id('run', 1),
  stepId = id('run-step', 1),
  toolCallId = id('tool-call', 1),
  issuedAtMs = 49,
  requestedAtMs = 51,
  limits = {},
} = {}) {
  const sessionPolicy = createBuilderToolSessionPolicy({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: turnId,
    task_id: taskId,
    run_id: runId,
    issued_at_ms: issuedAtMs,
    limits: { ...DEFAULT_BUILDER_TOOL_SESSION_LIMITS, ...limits },
  });
  const guard = createBuilderToolPermissionAdmission({
    actor_id: id('user', 1),
    now_ms: () => 50,
    evaluate_permission: async (body) => ({
      decision_version: BUILDER_PERMISSION_DECISION_VERSION,
      policy_version: BUILDER_PERMISSION_POLICY_VERSION,
      actor_id: id('user', 1),
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
    requested_at_ms: requestedAtMs,
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

function eventHeadDigest(event) {
  return `sha256:${nodeCrypto.createHash('sha256').update(JSON.stringify({
    event_digest: event.event_digest,
    event_id: event.event_id,
    sequence: event.sequence,
  }), 'utf8').digest('hex')}`;
}

function planAdmission(previous, callRecord, resultRecord, resultDigest = RESULT_B, overrides = {}) {
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
    plan_record_digest: resultDigest,
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
    ...overrides,
  });
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

function append(events, eventType, payload, commandIndex = events.length + 1) {
  const previous = events.at(-1) ?? null;
  const normalizedPayload = eventType === 'run_completed'
    ? {
      ...payload,
      candidate_result: payload.candidate_result
        ?? (payload.result_kind === 'candidate'
          ? candidateResult(payload.turn_id, payload.run_id, payload.result_digest)
          : null),
      plan_admission: payload.plan_admission ?? null,
    }
    : payload;
  const event = createBuilderConversationEvent({
    record_version: CONVERSATION_EVENT_VERSION,
    record_kind: CONVERSATION_EVENT_KIND,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    sequence: events.length + 1,
    command_id: id('command', commandIndex),
    event_type: eventType,
    previous_event: previous === null ? null : {
      sequence: previous.sequence, event_id: previous.event_id, event_digest: previous.event_digest,
    },
    payload: normalizedPayload,
    authority: { ...CONVERSATION_AUTHORITY },
  });
  return [...events, event];
}

function assertReplayError(error) {
  assert.equal(error instanceof BuilderConversationReplayError, true);
  assert.equal(error.code, 'builder_conversation_replay_invalid');
  assert.equal(error.message, 'The local conversation history could not be reconstructed.');
  return true;
}

function completeHistory() {
  let events = [];
  events = append(events, 'turn_submitted', {
    message: { message_id: id('message', 1), text: 'Build a focus timer.' },
    turn_id: id('turn', 1), mode: 'work',
    task: { task_id: id('task', 1), title: 'Build focus timer' },
    base_revision: BASE_REVISION,
  });
  events = append(events, 'run_started', {
    turn_id: id('turn', 1), run_id: id('run', 1), task_id: id('task', 1),
    attempt_number: 1, retry_of_run_id: null, input_digest: RESULT_A,
  });
  events = append(events, 'run_completed', {
    turn_id: id('turn', 1), run_id: id('run', 1), terminal_status: 'failed',
    result_kind: 'failure', result_digest: RESULT_A,
    assistant_message: { message_id: id('message', 2), text: 'The first attempt needs another pass.' },
  });
  events = append(events, 'run_started', {
    turn_id: id('turn', 1), run_id: id('run', 2), task_id: id('task', 1),
    attempt_number: 2, retry_of_run_id: id('run', 1), input_digest: RESULT_B,
  });
  events = append(events, 'turn_steered', {
    turn_id: id('turn', 1), run_id: id('run', 2),
    message: { message_id: id('message', 3), text: 'Use a calmer layout.' },
  });
  events = append(events, 'run_interrupt_requested', {
    turn_id: id('turn', 1), run_id: id('run', 2), request_id: id('interrupt-request', 1),
  });
  events = append(events, 'run_completed', {
    turn_id: id('turn', 1), run_id: id('run', 2), terminal_status: 'interrupted',
    result_kind: 'failure', result_digest: RESULT_B, assistant_message: null,
  });
  events = append(events, 'turn_completed', {
    turn_id: id('turn', 1), run_id: id('run', 2), outcome: 'interrupted',
  });
  events = append(events, 'turn_submitted', {
    message: { message_id: id('message', 4), text: 'What did the first attempt change?' },
    turn_id: id('turn', 2), mode: 'question', task: null, base_revision: null,
  });
  events = append(events, 'run_started', {
    turn_id: id('turn', 2), run_id: id('run', 3), task_id: null,
    attempt_number: 1, retry_of_run_id: null, input_digest: RESULT_A,
  });
  events = append(events, 'run_completed', {
    turn_id: id('turn', 2), run_id: id('run', 3), terminal_status: 'succeeded',
    result_kind: 'explanation', result_digest: RESULT_A,
    assistant_message: { message_id: id('message', 5), text: 'It prepared a timer layout.' },
  });
  events = append(events, 'turn_completed', {
    turn_id: id('turn', 2), run_id: id('run', 3), outcome: 'answered',
  });
  return events;
}

test('replays command events into a fresh frozen project-local task stream', () => {
  const events = completeHistory();
  const replay = replayBuilderConversation(events.map((event) => structuredClone(event)));
  assert.equal(replay.project_id, PROJECT_ID);
  assert.equal(replay.replay_version, CONVERSATION_REPLAY_VERSION);
  assert.equal(replay.replay_version, 'builder-conversation-replay.v2');
  assert.equal(replay.conversation_id, CONVERSATION_ID);
  assert.equal(replay.event_count, 12);
  assert.equal(replay.active_turn_id, null);
  assert.equal(replay.turns.length, 2);
  assert.deepEqual(replay.turns[0].base_revision, BASE_REVISION);
  assert.deepEqual(replay.turns[0].runs.map((run) => ({
    attempt: run.attempt_number, retry: run.retry_of_run_id, terminal: run.terminal_status,
  })), [
    { attempt: 1, retry: null, terminal: 'failed' },
    { attempt: 2, retry: id('run', 1), terminal: 'interrupted' },
  ]);
  assert.equal(replay.turns[0].messages[1].kind, 'run_result');
  assert.equal(replay.turns[1].runs[0].result_kind, 'explanation');
  assert.equal(replay.turns[1].runs[0].input_digest, RESULT_A);
  assert.equal(replay.turns[1].runs[0].result_digest, RESULT_A);
  assert.equal(replay.turns[1].messages.at(-1).role, 'assistant');
  assert.equal(Object.isFrozen(replay), true);
  assert.equal(Object.isFrozen(replay.turns[0].runs), true);
  assert.notEqual(replay.turns[0].messages, events[0].payload.message);
});

test('keeps an active turn reconstructible before terminal events arrive', () => {
  const partial = completeHistory().slice(0, 5);
  const replay = replayBuilderConversation(partial);
  assert.equal(replay.active_turn_id, id('turn', 1));
  assert.equal(replay.turns[0].status, 'active');
  assert.equal(replay.turns[0].runs.at(-1).status, 'running');
  assert.equal(replay.turns[0].messages.at(-1).kind, 'steering');
});

test('replays fixed run progress only in order while the run is active', () => {
  let events = [];
  events = append(events, 'turn_submitted', {
    message: { message_id: id('message', 10), text: 'Build a small timer.' },
    turn_id: id('turn', 10),
    mode: 'work',
    task: { task_id: id('task', 10), title: 'Build timer' },
    base_revision: null,
  }, 10);
  events = append(events, 'run_started', {
    turn_id: id('turn', 10),
    run_id: id('run', 10),
    task_id: id('task', 10),
    attempt_number: 1,
    retry_of_run_id: null,
    input_digest: RESULT_A,
  }, 11);
  events = append(events, 'run_progress_recorded', {
    turn_id: id('turn', 10),
    run_id: id('run', 10),
    stage: 'context_ready',
  }, 12);
  events = append(events, 'run_progress_recorded', {
    turn_id: id('turn', 10),
    run_id: id('run', 10),
    stage: 'provider_request_started',
  }, 13);

  const replay = replayBuilderConversation(events);
  assert.deepEqual(replay.turns[0].runs[0].progress_stages, [
    'context_ready',
    'provider_request_started',
  ]);
  assert.equal(Object.isFrozen(replay.turns[0].runs[0].progress_stages), true);
  assert.throws(() => replayBuilderConversation(append(events.slice(0, 2), 'run_progress_recorded', {
    turn_id: id('turn', 10),
    run_id: id('run', 10),
    stage: 'provider_request_started',
  }, 14)), assertReplayError);
  assert.throws(() => replayBuilderConversation(append([...events], 'run_progress_recorded', {
    turn_id: id('turn', 10),
    run_id: id('run', 10),
    stage: 'provider_request_started',
  }, 15)), assertReplayError);
  const controlled = append([...events], 'run_cancel_requested', {
    turn_id: id('turn', 10),
    run_id: id('run', 10),
    request_id: id('cancel-request', 10),
  }, 16);
  assert.throws(() => replayBuilderConversation(append(controlled, 'run_progress_recorded', {
    turn_id: id('turn', 10),
    run_id: id('run', 10),
    stage: 'provider_response_received',
  }, 17)), assertReplayError);
});

test('replays tool call requests and fixed-code results only inside an active work run', async () => {
  let events = [];
  events = append(events, 'turn_submitted', {
    message: { message_id: id('message', 200), text: 'Inspect the source files.' },
    turn_id: id('turn', 200),
    mode: 'work',
    task: { task_id: id('task', 200), title: 'Inspect source files' },
    base_revision: BASE_REVISION,
  }, 200);
  events = append(events, 'run_started', {
    turn_id: id('turn', 200),
    run_id: id('run', 200),
    task_id: id('task', 200),
    attempt_number: 1,
    retry_of_run_id: null,
    input_digest: RESULT_A,
  }, 201);
  const record = await toolCallRecord({
    turnId: id('turn', 200),
    taskId: id('task', 200),
    runId: id('run', 200),
    stepId: id('run-step', 200),
    toolCallId: id('tool-call', 200),
  });
  events = append(events, 'tool_call_requested', {
    tool_call_record: record,
  }, 202);
  const resultRecord = toolResultRecord(record);
  events = append(events, 'tool_call_result_recorded', {
    tool_result_record: resultRecord,
  }, 203);

  const replay = replayBuilderConversation(events);
  assert.equal(replay.active_turn_id, id('turn', 200));
  assert.equal(replay.turns[0].runs[0].tool_calls.length, 1);
  assert.deepEqual(replay.turns[0].runs[0].tool_calls[0].lifecycle, {
    permission_admission: 'verified_allowed',
    session_policy_admission: 'verified_main_run_policy',
    dispatch_admission: 'not_started',
    execution_admission: 'not_performed',
    result_admission: 'not_recorded',
    revision_admission: 'not_created',
  });
  assert.equal(replay.turns[0].runs[0].tool_calls[0].tool_call_record.record_digest, record.record_digest);
  assert.deepEqual(replay.turns[0].runs[0].tool_calls[0].tool_result_record.result, {
    status: 'failed',
    summary_code: 'output_rejected',
    display_summary: 'The tool output was not accepted.',
    summary_digest: resultRecord.result.summary_digest,
  });
  assert.equal(
    replay.turns[0].runs[0].tool_calls[0].tool_result_record.lifecycle.result_admission,
    'fixed_summary_code_recorded',
  );
  assert.equal(Object.isFrozen(replay.turns[0].runs[0].tool_calls[0].tool_call_record), true);
  assert.equal(Object.isFrozen(replay.turns[0].runs[0].tool_calls[0].tool_result_record), true);

  assert.throws(() => replayBuilderConversation(append([...events], 'tool_call_requested', {
    tool_call_record: record,
  }, 204)), assertReplayError);
  assert.throws(() => replayBuilderConversation(append([...events], 'tool_call_result_recorded', {
    tool_result_record: resultRecord,
  }, 205)), assertReplayError);
  assert.throws(() => replayBuilderConversation(append([...events], 'run_completed', {
    turn_id: id('turn', 200),
    run_id: id('run', 200),
    terminal_status: 'succeeded',
    result_kind: 'explanation',
    result_digest: RESULT_B,
    assistant_message: { message_id: id('message', 201), text: 'I inspected the files.' },
  }, 206)), assertReplayError);

  const pendingOnly = events.slice(0, 3);
  const parallelRecord = await toolCallRecord({
    turnId: id('turn', 200),
    taskId: id('task', 200),
    runId: id('run', 200),
    stepId: id('run-step', 202),
    toolCallId: id('tool-call', 202),
    requestedAtMs: 80,
  });
  assert.throws(() => replayBuilderConversation(append(pendingOnly, 'tool_call_requested', {
    tool_call_record: parallelRecord,
  }, 211)), assertReplayError);

  const driftedPolicyRecord = await toolCallRecord({
    turnId: id('turn', 200),
    taskId: id('task', 200),
    runId: id('run', 200),
    stepId: id('run-step', 203),
    toolCallId: id('tool-call', 203),
    issuedAtMs: 50,
    requestedAtMs: 90,
  });
  assert.throws(() => replayBuilderConversation(append([...events], 'tool_call_requested', {
    tool_call_record: driftedPolicyRecord,
  }, 207)), assertReplayError);

  const beforeRequest = events.slice(0, 2);
  assert.throws(() => replayBuilderConversation(append(beforeRequest, 'tool_call_result_recorded', {
    tool_result_record: resultRecord,
  }, 208)), assertReplayError);

  const controlled = append([...events], 'run_cancel_requested', {
    turn_id: id('turn', 200),
    run_id: id('run', 200),
    request_id: id('cancel-request', 200),
  }, 209);
  const lateRecord = await toolCallRecord({
    turnId: id('turn', 200),
    taskId: id('task', 200),
    runId: id('run', 200),
    stepId: id('run-step', 201),
    toolCallId: id('tool-call', 201),
  });
  assert.throws(() => replayBuilderConversation(append(controlled, 'tool_call_requested', {
    tool_call_record: lateRecord,
  }, 210)), assertReplayError);
});

test('permits only successful plan terminal after closed tool calls', async () => {
  const record = await toolCallRecord({
    turnId: id('turn', 70),
    taskId: id('task', 70),
    runId: id('run', 70),
    stepId: id('run-step', 70),
    toolCallId: id('tool-call', 70),
  });
  const succeeded = toolResultRecord(record, {
    result: {
      status: 'succeeded',
      summary_code: 'completed_without_raw_output',
    },
  });
  let events = [];
  events = append(events, 'turn_submitted', {
    message: { message_id: id('message', 70), text: 'Inspect and plan a focused update.' },
    turn_id: id('turn', 70), mode: 'work',
    task: { task_id: id('task', 70), title: 'Plan update' }, base_revision: null,
  }, 70);
  events = append(events, 'run_started', {
    turn_id: id('turn', 70), run_id: id('run', 70), task_id: id('task', 70),
    attempt_number: 1, retry_of_run_id: null, input_digest: RESULT_A,
  }, 71);
  events = append(events, 'tool_call_requested', {
    tool_call_record: record,
  }, 72);
  const pendingPlan = append(events, 'run_completed', {
    turn_id: id('turn', 70), run_id: id('run', 70), terminal_status: 'succeeded',
    result_kind: 'plan', result_digest: RESULT_B,
    assistant_message: { message_id: id('message', 71), text: 'Here is a proposed plan.' },
    plan_admission: planAdmission(events.at(-1), record, succeeded),
  }, 73);
  assert.throws(() => replayBuilderConversation(pendingPlan), assertReplayError);

  const withSucceededResult = append(events, 'tool_call_result_recorded', {
    tool_result_record: succeeded,
  }, 73);
  const planCompleted = append(withSucceededResult, 'run_completed', {
    turn_id: id('turn', 70), run_id: id('run', 70), terminal_status: 'succeeded',
    result_kind: 'plan', result_digest: RESULT_B,
    assistant_message: { message_id: id('message', 71), text: 'Here is a proposed plan.' },
    plan_admission: planAdmission(withSucceededResult.at(-1), record, succeeded),
  }, 74);
  const planTurnCompleted = append(planCompleted, 'turn_completed', {
    turn_id: id('turn', 70), run_id: id('run', 70), outcome: 'plan_proposed',
  }, 75);
  const replay = replayBuilderConversation(planTurnCompleted);
  assert.equal(replay.turns[0].runs[0].result_kind, 'plan');
  assert.equal(replay.turns[0].runs[0].plan_review, null);
  assert.equal(replay.turns[0].outcome, 'plan_proposed');

  const approvedPlan = append(planTurnCompleted, 'plan_reviewed', {
    turn_id: id('turn', 70),
    run_id: id('run', 70),
    plan_result_digest: RESULT_B,
    review_id: id('review', 70),
    reviewer_id: id('user', 70),
    reviewed_at_ms: 77,
    decision: 'approved',
  }, 76);
  assert.deepEqual(replayBuilderConversation(approvedPlan).turns[0].runs[0].plan_review, {
    plan_result_digest: RESULT_B,
    review_id: id('review', 70),
    reviewer_id: id('user', 70),
    reviewed_at_ms: 77,
    decision: 'approved',
  });
  assert.throws(() => replayBuilderConversation(append(approvedPlan, 'plan_reviewed', {
    turn_id: id('turn', 70),
    run_id: id('run', 70),
    plan_result_digest: RESULT_B,
    review_id: id('review', 71),
    reviewer_id: id('user', 71),
    reviewed_at_ms: 78,
    decision: 'rejected',
  }, 77)), assertReplayError);
  assert.throws(() => replayBuilderConversation(append(planTurnCompleted, 'plan_reviewed', {
    turn_id: id('turn', 70),
    run_id: id('run', 70),
    plan_result_digest: RESULT_A,
    review_id: id('review', 72),
    reviewer_id: id('user', 72),
    reviewed_at_ms: 79,
    decision: 'approved',
  }, 78)), assertReplayError);
  assert.throws(() => replayBuilderConversation(append(planCompleted, 'plan_reviewed', {
    turn_id: id('turn', 70),
    run_id: id('run', 70),
    plan_result_digest: RESULT_B,
    review_id: id('review', 73),
    reviewer_id: id('user', 73),
    reviewed_at_ms: 80,
    decision: 'approved',
  }, 79)), assertReplayError);

  const failed = toolResultRecord(record);
  const withFailedResult = append(events, 'tool_call_result_recorded', {
    tool_result_record: failed,
  }, 73);
  assert.throws(() => replayBuilderConversation(append(withFailedResult, 'run_completed', {
    turn_id: id('turn', 70), run_id: id('run', 70), terminal_status: 'succeeded',
    result_kind: 'plan', result_digest: RESULT_B,
    assistant_message: { message_id: id('message', 71), text: 'Here is a proposed plan.' },
    plan_admission: planAdmission(withFailedResult.at(-1), record, succeeded),
  }, 74)), assertReplayError);
  assert.throws(() => replayBuilderConversation(append(withSucceededResult, 'run_completed', {
    turn_id: id('turn', 70), run_id: id('run', 70), terminal_status: 'succeeded',
    result_kind: 'candidate', result_digest: RESULT_B,
    assistant_message: { message_id: id('message', 71), text: 'A candidate is ready.' },
  }, 74)), assertReplayError);
});

test('keeps cancellation distinct from interruption and permits a deliberate retry', () => {
  let events = [];
  events = append(events, 'turn_submitted', {
    message: { message_id: id('message', 30), text: 'Build a small counter.' },
    turn_id: id('turn', 30), mode: 'work',
    task: { task_id: id('task', 30), title: 'Build counter' }, base_revision: null,
  }, 30);
  events = append(events, 'run_started', {
    turn_id: id('turn', 30), run_id: id('run', 30), task_id: id('task', 30),
    attempt_number: 1, retry_of_run_id: null, input_digest: RESULT_A,
  }, 31);
  events = append(events, 'run_cancel_requested', {
    turn_id: id('turn', 30), run_id: id('run', 30),
    request_id: id('cancel-request', 30),
  }, 32);
  events = append(events, 'run_completed', {
    turn_id: id('turn', 30), run_id: id('run', 30), terminal_status: 'cancelled',
    result_kind: 'failure', result_digest: RESULT_A, assistant_message: null,
  }, 33);
  events = append(events, 'run_started', {
    turn_id: id('turn', 30), run_id: id('run', 31), task_id: id('task', 30),
    attempt_number: 2, retry_of_run_id: id('run', 30), input_digest: RESULT_B,
  }, 34);
  const replay = replayBuilderConversation(events);
  assert.equal(replay.turns[0].runs[0].terminal_status, 'cancelled');
  assert.equal(replay.turns[0].runs[0].cancel_request_id, id('cancel-request', 30));
  assert.equal(replay.turns[0].runs[0].interrupt_request_id, null);
  assert.equal(replay.turns[0].runs[1].retry_of_run_id, id('run', 30));
  assert.equal(replay.turns[0].runs[1].status, 'running');
});

test('keeps work explanations, plans, and candidates distinct from saved revisions', async () => {
  const cases = [
    { resultKind: 'explanation', outcome: 'responded', seed: 40 },
    { resultKind: 'plan', outcome: 'plan_proposed', seed: 50 },
    { resultKind: 'candidate', outcome: 'candidate_ready', seed: 60 },
  ];
  for (const { resultKind, outcome, seed } of cases) {
    let events = [];
    events = append(events, 'turn_submitted', {
      message: { message_id: id('message', seed), text: 'Help improve this project.' },
      turn_id: id('turn', seed), mode: 'work',
      task: { task_id: id('task', seed), title: 'Improve project' }, base_revision: null,
    }, seed);
    events = append(events, 'run_started', {
      turn_id: id('turn', seed), run_id: id('run', seed), task_id: id('task', seed),
      attempt_number: 1, retry_of_run_id: null, input_digest: RESULT_A,
    }, seed + 1);
    let planAdmissionEvidence = null;
    if (resultKind === 'plan') {
      const record = await toolCallRecord({
        turnId: id('turn', seed),
        taskId: id('task', seed),
        runId: id('run', seed),
        stepId: id('run-step', seed),
        toolCallId: id('tool-call', seed),
      });
      events = append(events, 'tool_call_requested', {
        tool_call_record: record,
      }, seed + 2);
      const resultRecord = toolResultRecord(record, {
        result: {
          status: 'succeeded',
          summary_code: 'completed_without_raw_output',
        },
      });
      events = append(events, 'tool_call_result_recorded', {
        tool_result_record: resultRecord,
      }, seed + 3);
      planAdmissionEvidence = planAdmission(events.at(-1), record, resultRecord);
    }
    events = append(events, 'run_completed', {
      turn_id: id('turn', seed), run_id: id('run', seed), terminal_status: 'succeeded',
      result_kind: resultKind, result_digest: RESULT_B,
      assistant_message: { message_id: id('message', seed + 1), text: 'Here is the result.' },
      ...(planAdmissionEvidence === null ? {} : { plan_admission: planAdmissionEvidence }),
    }, resultKind === 'plan' ? seed + 4 : seed + 2);
    events = append(events, 'turn_completed', {
      turn_id: id('turn', seed), run_id: id('run', seed), outcome,
    }, resultKind === 'plan' ? seed + 5 : seed + 3);
    const replay = replayBuilderConversation(events);
    assert.equal(replay.turns[0].runs[0].result_kind, resultKind);
    assert.equal(replay.turns[0].outcome, outcome);
    assert.equal(replay.authority.revision_admission, 'not_created');
    assert.equal(Object.hasOwn(replay.turns[0], 'revision'), false);
  }
});

test('records candidate rejection only after a completed candidate run', () => {
  let events = [];
  events = append(events, 'turn_submitted', {
    message: { message_id: id('message', 100), text: 'Build a tiny project.' },
    turn_id: id('turn', 100), mode: 'work',
    task: { task_id: id('task', 100), title: 'Build project' }, base_revision: null,
  }, 100);
  events = append(events, 'run_started', {
    turn_id: id('turn', 100), run_id: id('run', 100), task_id: id('task', 100),
    attempt_number: 1, retry_of_run_id: null, input_digest: RESULT_A,
  }, 101);
  events = append(events, 'run_completed', {
    turn_id: id('turn', 100), run_id: id('run', 100), terminal_status: 'succeeded',
    result_kind: 'candidate', result_digest: RESULT_B,
    assistant_message: { message_id: id('message', 101), text: 'A candidate is ready.' },
  }, 102);
  events = append(events, 'turn_completed', {
    turn_id: id('turn', 100), run_id: id('run', 100), outcome: 'candidate_ready',
  }, 103);
  events = append(events, 'candidate_rejected', {
    turn_id: id('turn', 100),
    run_id: id('run', 100),
    draft_id: `builder-generation-draft:${'0'.repeat(62)}64`,
    review_id: id('review', 100),
    reviewer_id: id('user', 100),
    reviewed_at_ms: 1234,
    decision: 'rejected',
  }, 104);

  const replay = replayBuilderConversation(events);
  assert.deepEqual(replay.turns[0].runs[0].candidate_review, {
    draft_id: `builder-generation-draft:${'0'.repeat(62)}64`,
    review_id: id('review', 100),
    reviewer_id: id('user', 100),
    reviewed_at_ms: 1234,
    decision: 'rejected',
    revision: null,
  });
  assert.equal(replay.authority.revision_admission, 'not_created');

  assert.throws(() => replayBuilderConversation([...events, events.at(-1)]), assertReplayError);
  assert.throws(() => replayBuilderConversation(append([...events], 'candidate_rejected', {
    turn_id: id('turn', 100),
    run_id: id('run', 100),
    draft_id: `builder-generation-draft:${'0'.repeat(62)}64`,
    review_id: id('review', 101),
    reviewer_id: id('user', 100),
    reviewed_at_ms: 1235,
    decision: 'rejected',
  }, 106)), assertReplayError);
  assert.throws(() => replayBuilderConversation(append(events.slice(0, 3), 'candidate_rejected', {
    turn_id: id('turn', 100),
    run_id: id('run', 100),
    draft_id: `builder-generation-draft:${'0'.repeat(62)}64`,
    review_id: id('review', 101),
    reviewer_id: id('user', 100),
    reviewed_at_ms: 1235,
    decision: 'rejected',
  }, 105)), assertReplayError);
});

test('records candidate acceptance as a review fact without making conversation a revision authority', () => {
  let events = [];
  events = append(events, 'turn_submitted', {
    message: { message_id: id('message', 120), text: 'Build a tiny project.' },
    turn_id: id('turn', 120), mode: 'work',
    task: { task_id: id('task', 120), title: 'Build project' }, base_revision: null,
  }, 120);
  events = append(events, 'run_started', {
    turn_id: id('turn', 120), run_id: id('run', 120), task_id: id('task', 120),
    attempt_number: 1, retry_of_run_id: null, input_digest: RESULT_A,
  }, 121);
  events = append(events, 'run_completed', {
    turn_id: id('turn', 120), run_id: id('run', 120), terminal_status: 'succeeded',
    result_kind: 'candidate', result_digest: RESULT_B,
    assistant_message: { message_id: id('message', 121), text: 'A candidate is ready.' },
  }, 122);
  events = append(events, 'turn_completed', {
    turn_id: id('turn', 120), run_id: id('run', 120), outcome: 'candidate_ready',
  }, 123);
  events = append(events, 'candidate_accepted', {
    turn_id: id('turn', 120),
    run_id: id('run', 120),
    draft_id: `builder-generation-draft:${'0'.repeat(62)}78`,
    review_id: id('review', 120),
    reviewer_id: id('user', 120),
    reviewed_at_ms: 5678,
    decision: 'accepted',
    revision: {
      revision_receipt_digest: `sha256:${'8'.repeat(64)}`,
      revision_number: 2,
    },
  }, 124);

  const replay = replayBuilderConversation(events);
  assert.deepEqual(replay.turns[0].runs[0].candidate_review, {
    draft_id: `builder-generation-draft:${'0'.repeat(62)}78`,
    review_id: id('review', 120),
    reviewer_id: id('user', 120),
    reviewed_at_ms: 5678,
    decision: 'accepted',
    revision: {
      revision_receipt_digest: `sha256:${'8'.repeat(64)}`,
      revision_number: 2,
    },
  });
  assert.equal(replay.authority.revision_admission, 'not_created');

  assert.throws(() => replayBuilderConversation(append([...events], 'candidate_rejected', {
    turn_id: id('turn', 120),
    run_id: id('run', 120),
    draft_id: `builder-generation-draft:${'0'.repeat(62)}78`,
    review_id: id('review', 121),
    reviewer_id: id('user', 120),
    reviewed_at_ms: 5679,
    decision: 'rejected',
  }, 125)), assertReplayError);
});

test('requires terminal outcomes to honor durable interrupt and cancel requests', () => {
  function running(seed) {
    let events = [];
    events = append(events, 'turn_submitted', {
      message: { message_id: id('message', seed), text: 'Build a local note card.' },
      turn_id: id('turn', seed), mode: 'work',
      task: { task_id: id('task', seed), title: 'Build note card' }, base_revision: null,
    }, seed);
    return append(events, 'run_started', {
      turn_id: id('turn', seed), run_id: id('run', seed), task_id: id('task', seed),
      attempt_number: 1, retry_of_run_id: null, input_digest: RESULT_A,
    }, seed + 1);
  }

  let interruptedRequest = running(70);
  interruptedRequest = append(interruptedRequest, 'run_interrupt_requested', {
    turn_id: id('turn', 70), run_id: id('run', 70),
    request_id: id('interrupt-request', 70),
  }, 72);
  const successAfterInterruptRequest = append(interruptedRequest, 'run_completed', {
    turn_id: id('turn', 70), run_id: id('run', 70), terminal_status: 'succeeded',
    result_kind: 'candidate', result_digest: RESULT_B,
    assistant_message: { message_id: id('message', 71), text: 'The result arrived first.' },
  }, 73);
  assert.throws(() => replayBuilderConversation(successAfterInterruptRequest), assertReplayError);

  let cancelledRequest = running(80);
  cancelledRequest = append(cancelledRequest, 'run_cancel_requested', {
    turn_id: id('turn', 80), run_id: id('run', 80), request_id: id('cancel-request', 80),
  }, 82);
  const failureAfterCancelRequest = append(cancelledRequest, 'run_completed', {
    turn_id: id('turn', 80), run_id: id('run', 80), terminal_status: 'failed',
    result_kind: 'failure', result_digest: RESULT_B,
    assistant_message: { message_id: id('message', 81), text: 'The attempt failed first.' },
  }, 83);
  assert.throws(() => replayBuilderConversation(failureAfterCancelRequest), assertReplayError);

  assert.throws(() => replayBuilderConversation(append(interruptedRequest, 'run_cancel_requested', {
    turn_id: id('turn', 70), run_id: id('run', 70), request_id: id('cancel-request', 70),
  }, 74)), assertReplayError);
  assert.throws(() => replayBuilderConversation(append(cancelledRequest, 'run_interrupt_requested', {
    turn_id: id('turn', 80), run_id: id('run', 80), request_id: id('interrupt-request', 80),
  }, 84)), assertReplayError);
});

test('rejects invalid lifecycle transitions, retry drift, and terminal mismatch', () => {
  const submitted = completeHistory().slice(0, 1);
  const cases = [];
  cases.push(append(submitted, 'run_started', {
    turn_id: id('turn', 1), run_id: id('run', 9), task_id: id('task', 1),
    attempt_number: 2, retry_of_run_id: null, input_digest: RESULT_A,
  }));
  cases.push(append(submitted, 'turn_completed', {
    turn_id: id('turn', 1), run_id: null, outcome: 'candidate_ready',
  }));
  const running = append(submitted, 'run_started', {
    turn_id: id('turn', 1), run_id: id('run', 9), task_id: id('task', 1),
    attempt_number: 1, retry_of_run_id: null, input_digest: RESULT_A,
  });
  cases.push(append(running, 'run_completed', {
    turn_id: id('turn', 1), run_id: id('run', 9), terminal_status: 'interrupted',
    result_kind: 'failure', result_digest: RESULT_A, assistant_message: null,
  }));
  const succeeded = append(running, 'run_completed', {
    turn_id: id('turn', 1), run_id: id('run', 9), terminal_status: 'succeeded',
    result_kind: 'candidate', result_digest: RESULT_A,
    assistant_message: { message_id: id('message', 9), text: 'A candidate is ready.' },
  });
  cases.push(append(succeeded, 'run_started', {
    turn_id: id('turn', 1), run_id: id('run', 10), task_id: id('task', 1),
    attempt_number: 2, retry_of_run_id: id('run', 9), input_digest: RESULT_B,
  }));
  cases.push(append(succeeded, 'turn_completed', {
    turn_id: id('turn', 1), run_id: id('run', 9), outcome: 'failed',
  }));
  let question = [];
  question = append(question, 'turn_submitted', {
    message: { message_id: id('message', 20), text: 'Explain this.' },
    turn_id: id('turn', 20), mode: 'question', task: null, base_revision: null,
  }, 20);
  question = append(question, 'run_started', {
    turn_id: id('turn', 20), run_id: id('run', 20), task_id: null,
    attempt_number: 1, retry_of_run_id: null, input_digest: RESULT_A,
  }, 21);
  cases.push(append(question, 'run_completed', {
    turn_id: id('turn', 20), run_id: id('run', 20), terminal_status: 'succeeded',
    result_kind: 'candidate', result_digest: RESULT_A,
    assistant_message: { message_id: id('message', 21), text: 'Wrong result kind.' },
  }, 22));
  for (const events of cases) {
    assert.throws(() => replayBuilderConversation(events), assertReplayError);
  }
});

test('rejects duplicate command identity and forged array authority', () => {
  const events = completeHistory().slice(0, 2);
  const prior = events.at(-1);
  const duplicateCommand = createBuilderConversationEvent({
    record_version: CONVERSATION_EVENT_VERSION,
    record_kind: CONVERSATION_EVENT_KIND,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    sequence: 3,
    command_id: events[0].command_id,
    event_type: 'turn_steered',
    previous_event: {
      sequence: prior.sequence, event_id: prior.event_id, event_digest: prior.event_digest,
    },
    payload: {
      turn_id: id('turn', 1), run_id: id('run', 1),
      message: { message_id: id('message', 8), text: 'Change direction.' },
    },
    authority: { ...CONVERSATION_AUTHORITY },
  });
  assert.throws(() => replayBuilderConversation([...events, duplicateCommand]), assertReplayError);
  assert.throws(() => replayBuilderConversation(new Proxy(events, {})), assertReplayError);
  const sparse = [...events];
  delete sparse[0];
  assert.throws(() => replayBuilderConversation(sparse), assertReplayError);
  const accessor = [...events];
  Object.defineProperty(accessor, '0', { enumerable: true, get() { return events[0]; } });
  assert.throws(() => replayBuilderConversation(accessor), assertReplayError);
  const symbol = [...events];
  symbol[Symbol('hidden')] = true;
  assert.throws(() => replayBuilderConversation(symbol), assertReplayError);
});

test('contains all transition rules in replay and none in the SQLite persistence layer', () => {
  const fs = require('node:fs');
  const replaySource = fs.readFileSync(
    require.resolve('../electron/builder-conversation-replay.cjs'), 'utf8',
  );
  const databaseSource = fs.readFileSync(
    require.resolve('../electron/builder-product-metadata-database.cjs'), 'utf8',
  );
  for (const eventType of [
    'turn_submitted', 'turn_steered', 'run_started', 'run_interrupt_requested',
    'run_cancel_requested', 'tool_call_requested', 'tool_call_result_recorded', 'candidate_rejected',
    'run_completed', 'turn_completed',
  ]) {
    assert.match(replaySource, new RegExp(eventType, 'u'));
    assert.doesNotMatch(databaseSource, new RegExp(eventType, 'u'));
  }
  assert.match(replaySource, /builder-tool-session-state-gate\.cjs/u);
  assert.match(replaySource, /admitBuilderToolCallSessionState/u);
  assert.match(replaySource, /admitBuilderToolResultSessionState/u);
  assert.match(databaseSource, /replayBuilderConversation/u);
});
