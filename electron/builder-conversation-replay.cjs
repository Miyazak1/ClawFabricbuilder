'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  CONVERSATION_AUTHORITY,
  MAX_EVENT_SEQUENCE,
  BuilderConversationRecordError,
  sanitizeBuilderConversationEvent,
} = require('./builder-conversation-records.cjs');
const {
  admitBuilderToolCallSessionState,
  admitBuilderToolResultSessionState,
} = require('./builder-tool-session-state-gate.cjs');

const CONVERSATION_REPLAY_VERSION = 'builder-conversation-replay.v2';
const RUN_PROGRESS_ORDER = Object.freeze([
  'context_ready',
  'provider_request_started',
  'provider_response_received',
  'result_preparing',
]);

class BuilderConversationReplayError extends Error {
  constructor() {
    super('The local conversation history could not be reconstructed.');
    this.name = 'BuilderConversationReplayError';
    this.code = 'builder_conversation_replay_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderConversationReplayError(); }

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function assertDenseArray(value) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length < 1
    || value.length > MAX_EVENT_SEQUENCE) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === 'symbol')) fail();
  const expectedKeys = new Set(['length', ...Array.from({ length: value.length }, (_, index) => String(index))]);
  if (keys.length !== expectedKeys.size || keys.some((key) => !expectedKeys.has(key))) fail();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
}

function samePrevious(record, previous) {
  if (previous === null) return record.previous_event === null;
  return record.previous_event !== null
    && record.previous_event.sequence === previous.sequence
    && record.previous_event.event_id === previous.event_id
    && record.previous_event.event_digest === previous.event_digest;
}

function headDigest(head) {
  return `sha256:${nodeCrypto.createHash('sha256').update(JSON.stringify({
    event_digest: head.event_digest,
    event_id: head.event_id,
    sequence: head.sequence,
  }), 'utf8').digest('hex')}`;
}

function addMessage(state, message, role, kind) {
  if (state.messageIds.has(message.message_id)) fail();
  state.messageIds.add(message.message_id);
  return { message_id: message.message_id, role, kind, text: message.text };
}

function cloneToolCallRecord(record) {
  return {
    ...record,
    resource: { ...record.resource },
    permission_admission_receipt: {
      ...record.permission_admission_receipt,
      resource: { ...record.permission_admission_receipt.resource },
    },
    lifecycle: { ...record.lifecycle },
    authority: { ...record.authority },
  };
}

function cloneToolResultRecord(record) {
  return {
    ...record,
    tool_call_record: cloneToolCallRecord(record.tool_call_record),
    result: { ...record.result },
    lifecycle: { ...record.lifecycle },
    authority: { ...record.authority },
  };
}

function cloneAgentStepProgressAdmission(record) {
  return {
    ...record,
    result: record.result === null ? null : { ...record.result },
    summary: { ...record.summary },
    source: { ...record.source },
    lifecycle: { ...record.lifecycle },
    authority: { ...record.authority },
  };
}

function compactToolSessionCalls(toolCalls) {
  return toolCalls.map((toolCall) => ({
    step_id: toolCall.step_id,
    tool_call_id: toolCall.tool_call_id,
    tool_call_record: toolCall.tool_call_record,
    tool_result_record: toolCall.tool_result_record,
  }));
}

function admitToolSessionState(fn, input) {
  try {
    Reflect.apply(fn, undefined, [input]);
  } catch {
    fail();
  }
}

function requireActiveTurn(state, turnId) {
  if (state.activeTurnId !== turnId) fail();
  const turn = state.turns.get(turnId);
  if (!turn || turn.status !== 'active') fail();
  return turn;
}

function applyTurnSubmitted(state, payload) {
  if (state.activeTurnId !== null || state.turns.has(payload.turn_id)) fail();
  if (payload.task !== null && state.taskIds.has(payload.task.task_id)) fail();
  const message = addMessage(state, payload.message, 'user', 'submitted');
  if (payload.task !== null) state.taskIds.add(payload.task.task_id);
  const turn = {
    turn_id: payload.turn_id,
    mode: payload.mode,
    status: 'active',
    task: payload.task === null ? null : { ...payload.task },
    base_revision: payload.base_revision === null ? null : { ...payload.base_revision },
    route_decision: { ...payload.route_decision },
    submitted_message_id: message.message_id,
    submitted_text: message.text,
    runs: [],
    messages: [message],
    outcome: null,
  };
  state.turns.set(payload.turn_id, turn);
  state.turnOrder.push(payload.turn_id);
  state.activeTurnId = payload.turn_id;
}

function applyActiveRunUserMessage(state, payload, kind) {
  const turn = requireActiveTurn(state, payload.turn_id);
  const run = turn.runs.at(-1) ?? null;
  if (run === null ? payload.run_id !== null
    : payload.run_id !== run.run_id || run.status !== 'running'
      || run.interrupt_request_id !== null || run.cancel_request_id !== null) fail();
  const message = addMessage(state, payload.message, 'user', kind);
  turn.messages.push(message);
  return { message, run, turn };
}

function applyTurnSteered(state, payload) {
  applyActiveRunUserMessage(state, payload, 'steering');
}

function applyTurnFollowupQueued(state, payload) {
  const queued = applyActiveRunUserMessage(state, payload, 'queued_followup');
  state.queuedFollowups.set(payload.message.message_id, {
    consumed: false,
    message_id: payload.message.message_id,
    run_id: queued.run.run_id,
    text: queued.message.text,
    turn_id: queued.turn.turn_id,
  });
}

function applyTurnFollowupConsumed(state, payload) {
  const queued = state.queuedFollowups.get(payload.message_id) ?? null;
  if (
    queued === null
    || queued.consumed
    || queued.turn_id !== payload.turn_id
    || queued.run_id !== payload.run_id
  ) fail();
  const sourceTurn = state.turns.get(payload.turn_id);
  if (!sourceTurn || sourceTurn.status !== 'completed') fail();
  const consumingTurn = requireActiveTurn(state, payload.consuming_turn_id);
  if (
    consumingTurn.runs.length !== 0
    || consumingTurn.submitted_message_id !== payload.consuming_message_id
    || consumingTurn.submitted_text !== queued.text
  ) fail();
  queued.consumed = true;
}

function applyRunStarted(state, payload) {
  const turn = requireActiveTurn(state, payload.turn_id);
  if (state.runIds.has(payload.run_id)) fail();
  if (turn.mode === 'work') {
    if (turn.task === null || payload.task_id !== turn.task.task_id) fail();
  } else if (payload.task_id !== null || turn.task !== null) fail();
  const previousRun = turn.runs.at(-1) ?? null;
  if (previousRun === null) {
    if (payload.attempt_number !== 1 || payload.retry_of_run_id !== null) fail();
  } else {
    if (previousRun.status !== 'completed'
      || !['failed', 'interrupted', 'cancelled'].includes(previousRun.terminal_status)
      || payload.attempt_number !== previousRun.attempt_number + 1
      || payload.retry_of_run_id !== previousRun.run_id) fail();
  }
  state.runIds.add(payload.run_id);
  turn.runs.push({
    run_id: payload.run_id,
    attempt_number: payload.attempt_number,
    retry_of_run_id: payload.retry_of_run_id,
    input_digest: payload.input_digest,
    status: 'running',
    terminal_status: null,
    result_kind: null,
    result_digest: null,
    plan_review: null,
    candidate_result: null,
    candidate_review: null,
    context_snapshot: null,
    execution_approval: null,
    programming_run_admission: null,
    tool_calls: [],
    progress_stages: [],
    interrupt_request_id: null,
    cancel_request_id: null,
    agent_step_progress: [],
  });
}

function applyRunContextSnapshotRecorded(state, payload) {
  const turn = requireActiveTurn(state, payload.turn_id);
  const run = turn.runs.at(-1) ?? null;
  const snapshot = payload.snapshot;
  if (
    run === null
    || run.run_id !== payload.run_id
    || run.status !== 'running'
    || run.context_snapshot !== null
    || run.progress_stages.length > 0
    || run.tool_calls.length > 0
    || run.interrupt_request_id !== null
    || run.cancel_request_id !== null
    || snapshot.turn_id !== turn.turn_id
    || snapshot.run_id !== run.run_id
    || snapshot.task_id !== (turn.task === null ? null : turn.task.task_id)
    || snapshot.included_message_ids.length < 1
    || snapshot.included_message_ids.length > 2
    || snapshot.included_message_ids[0] !== turn.messages[0].message_id
    || snapshot.route_decision.decision_id !== turn.route_decision.decision_id
    || snapshot.route_decision.route !== turn.route_decision.route
    || snapshot.route_decision.dispatch !== turn.route_decision.dispatch
  ) fail();
  if (snapshot.brief_reference.status === 'task_capsule_update') {
    if (
      state.latestTaskCapsule === null
      || snapshot.brief_reference.task_id !== state.latestTaskCapsule.task_id
      || snapshot.brief_reference.source_message_id !== state.latestTaskCapsule.source_message_id
      || snapshot.brief_reference.last_route_decision_id
        !== state.latestTaskCapsule.last_route_decision_id
      || !snapshot.included_message_ids.includes(state.latestTaskCapsule.source_message_id)
    ) fail();
  } else if (snapshot.included_message_ids.length !== 1) {
    fail();
  }
  run.context_snapshot = { ...snapshot };
}

function applyProgrammingRunAdmitted(state, payload) {
  const turn = requireActiveTurn(state, payload.turn_id);
  const run = turn.runs.at(-1) ?? null;
  const approval = payload.execution_approval;
  const admission = payload.programming_run_admission;
  if (
    turn.mode !== 'work'
    || turn.task === null
    || run === null
    || run.run_id !== payload.run_id
    || run.status !== 'running'
    || run.context_snapshot === null
    || run.execution_approval !== null
    || run.programming_run_admission !== null
    || run.progress_stages.length > 0
    || run.tool_calls.length > 0
    || approval.project_id !== state.projectId
    || approval.conversation_id !== state.conversationId
    || admission.project_id !== state.projectId
    || admission.conversation_id !== state.conversationId
    || admission.turn_id !== turn.turn_id
    || admission.task_id !== turn.task.task_id
    || admission.run_id !== run.run_id
    || admission.context_snapshot_id !== run.context_snapshot.snapshot_id
    || admission.context_digest !== run.context_snapshot.context_digest
    || admission.execution_approval_id !== approval.approval_id
    || admission.execution_approval_digest !== approval.approval_digest
  ) fail();
  run.execution_approval = { ...approval };
  run.programming_run_admission = { ...admission };
}

function applyRunProgressRecorded(state, payload) {
  const turn = requireActiveTurn(state, payload.turn_id);
  const run = turn.runs.at(-1) ?? null;
  const stageIndex = RUN_PROGRESS_ORDER.indexOf(payload.stage);
  const previousStage = run?.progress_stages.at(-1) ?? null;
  const previousIndex = previousStage === null ? -1 : RUN_PROGRESS_ORDER.indexOf(previousStage);
  const expectedIndex = previousStage === null ? 0 : previousIndex + 1;
  if (
    run === null
    || run.run_id !== payload.run_id
    || run.status !== 'running'
    || run.interrupt_request_id !== null
    || run.cancel_request_id !== null
    || stageIndex < 0
    || stageIndex !== expectedIndex
  ) fail();
  run.progress_stages.push(payload.stage);
}

function applyToolCallRequested(state, payload) {
  const record = payload.tool_call_record;
  const turn = requireActiveTurn(state, record.turn_id);
  const run = turn.runs.at(-1) ?? null;
  if (
    turn.mode !== 'work'
    || turn.task === null
    || turn.task.task_id !== record.task_id
    || run === null
    || run.run_id !== record.run_id
    || run.status !== 'running'
    || run.interrupt_request_id !== null
    || run.cancel_request_id !== null
    || state.stepIds.has(record.step_id)
    || state.toolCallIds.has(record.tool_call_id)
  ) fail();
  admitToolSessionState(admitBuilderToolCallSessionState, {
    project_id: state.projectId,
    conversation_id: state.conversationId,
    turn_id: record.turn_id,
    task_id: record.task_id,
    run_id: record.run_id,
    run_status: run.status,
    interrupt_requested: run.interrupt_request_id !== null,
    cancel_requested: run.cancel_request_id !== null,
    existing_tool_calls: compactToolSessionCalls(run.tool_calls),
    tool_call_record: record,
    admitted_at_ms: record.requested_at_ms,
  });
  state.stepIds.add(record.step_id);
  state.toolCallIds.add(record.tool_call_id);
  run.tool_calls.push({
    step_id: record.step_id,
    tool_call_id: record.tool_call_id,
    tool_name: record.tool_name,
    action: record.action,
    resource: { ...record.resource },
    lifecycle: { ...record.lifecycle },
    tool_call_record: cloneToolCallRecord(record),
    tool_result_record: null,
  });
}

function applyToolCallResultRecorded(state, payload) {
  const record = payload.tool_result_record;
  const turn = requireActiveTurn(state, record.turn_id);
  const run = turn.runs.at(-1) ?? null;
  const toolCall = run?.tool_calls.find((item) => item.tool_call_id === record.tool_call_id) ?? null;
  if (
    turn.mode !== 'work'
    || run === null
    || run.run_id !== record.run_id
    || run.status !== 'running'
    || run.interrupt_request_id !== null
    || run.cancel_request_id !== null
    || toolCall === null
    || toolCall.step_id !== record.step_id
    || toolCall.tool_result_record !== null
    || state.toolResultRecordDigests.has(record.record_digest)
    || toolCall.tool_call_record.record_digest !== record.tool_call_record.record_digest
  ) fail();
  admitToolSessionState(admitBuilderToolResultSessionState, {
    project_id: state.projectId,
    conversation_id: state.conversationId,
    turn_id: record.turn_id,
    task_id: record.task_id,
    run_id: record.run_id,
    run_status: run.status,
    interrupt_requested: run.interrupt_request_id !== null,
    cancel_requested: run.cancel_request_id !== null,
    existing_tool_calls: compactToolSessionCalls(run.tool_calls),
    tool_result_record: record,
    admitted_at_ms: record.observed_at_ms,
  });
  state.toolResultRecordDigests.add(record.record_digest);
  toolCall.tool_result_record = cloneToolResultRecord(record);
}

function applyAgentStepProgressRecorded(state, payload) {
  const admission = payload.progress_admission;
  const turn = requireActiveTurn(state, admission.turn_id);
  const run = turn.runs.at(-1) ?? null;
  if (
    turn.mode !== 'work'
    || turn.task === null
    || turn.task.task_id !== admission.task_id
    || run === null
    || run.run_id !== admission.run_id
    || run.status !== 'running'
    || run.interrupt_request_id !== null
    || run.cancel_request_id !== null
    || state.agentStepProgressAdmissionDigests.has(admission.admission_digest)
  ) fail();
  const existing = run.agent_step_progress.find(
    (item) => item.step_id === admission.step_id,
  ) ?? null;
  const existingResult = run.agent_step_progress.find(
    (item) => item.step_id === admission.step_id && item.recorded_state === 'result_recorded',
  ) ?? null;
  if (admission.recorded_state === 'start_recorded') {
    if (existing !== null) fail();
    run.agent_step_progress.push(cloneAgentStepProgressAdmission(admission));
  } else {
    if (
      existing === null
      || existing.recorded_state !== 'start_recorded'
      || existing.step_index !== admission.step_index
      || existingResult !== null
    ) fail();
    run.agent_step_progress.push(cloneAgentStepProgressAdmission(admission));
  }
  state.agentStepProgressAdmissionDigests.add(admission.admission_digest);
}

function applyCandidateReviewed(state, payload) {
  if (state.activeTurnId !== null || state.reviewIds.has(payload.review_id)) fail();
  const turn = state.turns.get(payload.turn_id);
  if (!turn || turn.status !== 'completed' || turn.outcome !== 'candidate_ready') fail();
  const run = turn.runs.find((item) => item.run_id === payload.run_id);
  if (
    !run
    || run.status !== 'completed'
    || run.terminal_status !== 'succeeded'
    || run.result_kind !== 'candidate'
    || run.candidate_result === null
    || run.candidate_result.draft_id !== payload.draft_id
    || run.candidate_review !== null
  ) fail();
  state.reviewIds.add(payload.review_id);
  run.candidate_review = {
    draft_id: payload.draft_id,
    review_id: payload.review_id,
    reviewer_id: payload.reviewer_id,
    reviewed_at_ms: payload.reviewed_at_ms,
    decision: payload.decision,
    revision: payload.decision === 'accepted' ? { ...payload.revision } : null,
  };
}

function applyPlanReviewed(state, payload) {
  if (state.activeTurnId !== null || state.reviewIds.has(payload.review_id)) fail();
  const turn = state.turns.get(payload.turn_id);
  if (!turn || turn.status !== 'completed' || turn.outcome !== 'plan_proposed') fail();
  const run = turn.runs.find((item) => item.run_id === payload.run_id);
  if (
    !run
    || run.status !== 'completed'
    || run.terminal_status !== 'succeeded'
    || run.result_kind !== 'plan'
    || run.result_digest !== payload.plan_result_digest
    || run.plan_review !== null
  ) fail();
  state.reviewIds.add(payload.review_id);
  run.plan_review = {
    plan_result_digest: payload.plan_result_digest,
    review_id: payload.review_id,
    reviewer_id: payload.reviewer_id,
    reviewed_at_ms: payload.reviewed_at_ms,
    decision: payload.decision,
  };
}

function applyRunCancelRequested(state, payload) {
  const turn = requireActiveTurn(state, payload.turn_id);
  const run = turn.runs.at(-1) ?? null;
  if (run === null || run.run_id !== payload.run_id
    || run.status !== 'running' || run.interrupt_request_id !== null
    || run.cancel_request_id !== null || state.cancelRequestIds.has(payload.request_id)) fail();
  state.cancelRequestIds.add(payload.request_id);
  run.cancel_request_id = payload.request_id;
}

function applyRunInterruptRequested(state, payload) {
  const turn = requireActiveTurn(state, payload.turn_id);
  const run = turn.runs.at(-1) ?? null;
  if (run === null || run.run_id !== payload.run_id
    || run.status !== 'running' || run.interrupt_request_id !== null
    || run.cancel_request_id !== null
    || state.interruptRequestIds.has(payload.request_id)) fail();
  state.interruptRequestIds.add(payload.request_id);
  run.interrupt_request_id = payload.request_id;
}

function verifyPlanAdmission(state, turn, run, payload) {
  const admission = payload.plan_admission;
  const priorHead = state.priorHead;
  if (
    admission === null
    || priorHead === null
    || turn.mode !== 'work'
    || turn.task === null
    || admission.project_id !== state.projectId
    || admission.conversation_id !== state.conversationId
    || admission.turn_id !== turn.turn_id
    || admission.task_id !== turn.task.task_id
    || admission.run_id !== run.run_id
    || admission.attempt_number !== run.attempt_number
    || admission.plan_record_digest !== payload.result_digest
    || admission.head_sequence !== priorHead.sequence
    || admission.head_digest !== headDigest(priorHead)
    || admission.file_count !== admission.tool_reads.length
    || run.tool_calls.length !== admission.tool_reads.length
  ) fail();
  const byToolCallId = new Map();
  for (const toolCall of run.tool_calls) {
    if (byToolCallId.has(toolCall.tool_call_id)) fail();
    byToolCallId.set(toolCall.tool_call_id, toolCall);
  }
  const seenToolCalls = new Set();
  for (const read of admission.tool_reads) {
    const toolCall = byToolCallId.get(read.tool_call_id) ?? null;
    const resultRecord = toolCall?.tool_result_record ?? null;
    if (
      toolCall === null
      || resultRecord === null
      || seenToolCalls.has(read.tool_call_id)
      || toolCall.tool_name !== 'filesystem.read'
      || toolCall.action !== 'filesystem.read'
      || toolCall.resource.resource_kind !== 'filesystem'
      || toolCall.resource.project_id !== state.projectId
      || toolCall.resource.resource_id !== read.resource_id
      || toolCall.tool_call_record.record_digest !== read.tool_call_record_digest
      || resultRecord.record_digest !== read.tool_result_record_digest
      || resultRecord.result.summary_digest !== read.result_summary_digest
      || resultRecord.result.status !== 'succeeded'
      || read.result_status !== 'succeeded'
    ) fail();
    seenToolCalls.add(read.tool_call_id);
  }
}

function applyRunCompleted(state, payload) {
  const turn = requireActiveTurn(state, payload.turn_id);
  const run = turn.runs.at(-1) ?? null;
  if (run === null || run.run_id !== payload.run_id || run.status !== 'running') fail();
  const interrupted = run.interrupt_request_id !== null;
  const cancelled = run.cancel_request_id !== null;
  if ((payload.terminal_status === 'interrupted' && !interrupted)
    || (payload.terminal_status === 'cancelled' && !cancelled)
    || (interrupted && payload.terminal_status !== 'interrupted')
    || (cancelled && payload.terminal_status !== 'cancelled')
    || (interrupted && cancelled)) fail();
  if (payload.terminal_status === 'succeeded') {
    if (turn.mode === 'question' && payload.result_kind !== 'explanation') fail();
    if (turn.mode === 'work'
      && !['explanation', 'plan', 'candidate'].includes(payload.result_kind)) fail();
    if (payload.result_kind === 'plan') {
      verifyPlanAdmission(state, turn, run, payload);
    } else if (run.tool_calls.length > 0 || payload.plan_admission !== null) fail();
  } else if (payload.plan_admission !== null) {
    fail();
  }
  run.status = 'completed';
  run.terminal_status = payload.terminal_status;
  run.result_kind = payload.result_kind;
  run.result_digest = payload.result_digest;
  run.candidate_result = payload.candidate_result === null ? null : {
    draft_id: payload.candidate_result.draft_id,
    title: payload.candidate_result.title,
    summary: payload.candidate_result.summary,
    git_candidate_receipt: { ...payload.candidate_result.git_candidate_receipt },
  };
  if (payload.assistant_message !== null) {
    turn.messages.push(addMessage(state, payload.assistant_message, 'assistant', 'run_result'));
  }
}

function applyTaskBriefUpdated(state, payload) {
  const turn = requireActiveTurn(state, payload.turn_id);
  const run = turn.runs.at(-1) ?? null;
  if (
    turn.mode !== 'question'
    || turn.task !== null
    || turn.route_decision.route !== 'update_brief'
    || turn.route_decision.dispatch !== 'brief_update'
    || turn.route_decision.message_id !== payload.message_id
    || payload.task_capsule.last_route_decision_id !== turn.route_decision.decision_id
    || payload.task_capsule.project_id !== state.projectId
    || state.taskIds.has(payload.task_capsule.task_id)
    || run === null
    || run.run_id !== payload.run_id
    || run.status !== 'completed'
    || run.terminal_status !== 'succeeded'
    || run.result_kind !== 'explanation'
  ) fail();
  state.taskIds.add(payload.task_capsule.task_id);
  state.latestTaskCapsule = {
    source_message_id: payload.message_id,
    ...payload.task_capsule,
    current_brief: { ...payload.task_capsule.current_brief },
  };
}

function applyTurnCompleted(state, payload) {
  const turn = requireActiveTurn(state, payload.turn_id);
  const run = turn.runs.at(-1) ?? null;
  if (run === null || payload.run_id !== run.run_id || run.status !== 'completed') fail();
  {
    let expectedOutcome = run.terminal_status;
    if (run.terminal_status === 'succeeded') {
      if (turn.mode === 'question') expectedOutcome = 'answered';
      else if (run.result_kind === 'candidate') expectedOutcome = 'candidate_ready';
      else if (run.result_kind === 'plan') expectedOutcome = 'plan_proposed';
      else expectedOutcome = 'responded';
    }
    if (payload.outcome !== expectedOutcome) fail();
  }
  turn.status = 'completed';
  turn.outcome = payload.outcome;
  state.activeTurnId = null;
}

const TRANSITIONS = Object.freeze({
  turn_submitted: applyTurnSubmitted,
  turn_steered: applyTurnSteered,
  turn_followup_queued: applyTurnFollowupQueued,
  turn_followup_consumed: applyTurnFollowupConsumed,
  candidate_rejected: applyCandidateReviewed,
  candidate_accepted: applyCandidateReviewed,
  plan_reviewed: applyPlanReviewed,
  run_started: applyRunStarted,
  run_context_snapshot_recorded: applyRunContextSnapshotRecorded,
  programming_run_admitted: applyProgrammingRunAdmitted,
  run_progress_recorded: applyRunProgressRecorded,
  run_interrupt_requested: applyRunInterruptRequested,
  run_cancel_requested: applyRunCancelRequested,
  tool_call_requested: applyToolCallRequested,
  tool_call_result_recorded: applyToolCallResultRecorded,
  agent_step_progress_recorded: applyAgentStepProgressRecorded,
  run_completed: applyRunCompleted,
  task_brief_updated: applyTaskBriefUpdated,
  turn_completed: applyTurnCompleted,
});

function publicTurn(turn) {
  return {
    turn_id: turn.turn_id,
    mode: turn.mode,
    status: turn.status,
    task: turn.task === null ? null : { ...turn.task },
    base_revision: turn.base_revision === null ? null : { ...turn.base_revision },
    runs: turn.runs.map((run) => {
      const publicRun = { ...run };
      delete publicRun.agent_step_progress;
      return {
        ...publicRun,
        context_snapshot: run.context_snapshot === null ? null : {
          ...run.context_snapshot,
          included_message_ids: [...run.context_snapshot.included_message_ids],
          route_decision: {
            ...run.context_snapshot.route_decision,
            matched_signals: [...run.context_snapshot.route_decision.matched_signals],
          },
          brief_reference: { ...run.context_snapshot.brief_reference },
          context_refs: {
            working_context_state_id: run.context_snapshot.context_refs.working_context_state_id,
            working_context_state_updated_at_ms:
              run.context_snapshot.context_refs.working_context_state_updated_at_ms,
            compaction_refs: run.context_snapshot.context_refs.compaction_refs.map((ref) => ({ ...ref })),
            handoff_refs: run.context_snapshot.context_refs.handoff_refs.map((ref) => ({ ...ref })),
          },
          base_revision: run.context_snapshot.base_revision === null
            ? null
            : { ...run.context_snapshot.base_revision },
          permissions: {
            ...run.context_snapshot.permissions,
            required_permissions: [...run.context_snapshot.permissions.required_permissions],
          },
          capabilities: { ...run.context_snapshot.capabilities },
        },
        execution_approval: run.execution_approval === null ? null : {
          ...run.execution_approval,
          project_understanding_ref: run.execution_approval.project_understanding_ref === null
            ? null
            : { ...run.execution_approval.project_understanding_ref },
          permission_decision_ref: { ...run.execution_approval.permission_decision_ref },
          lifecycle: { ...run.execution_approval.lifecycle },
          authority: { ...run.execution_approval.authority },
        },
        programming_run_admission: run.programming_run_admission === null ? null : {
          ...run.programming_run_admission,
          lifecycle: { ...run.programming_run_admission.lifecycle },
          authority: { ...run.programming_run_admission.authority },
        },
        progress_stages: [...run.progress_stages],
        tool_calls: run.tool_calls.map((toolCall) => ({
          ...toolCall,
          resource: { ...toolCall.resource },
          lifecycle: { ...toolCall.lifecycle },
          tool_call_record: cloneToolCallRecord(toolCall.tool_call_record),
          tool_result_record: toolCall.tool_result_record === null
            ? null
            : cloneToolResultRecord(toolCall.tool_result_record),
        })),
        plan_review: run.plan_review === null ? null : { ...run.plan_review },
        candidate_result: run.candidate_result === null ? null : {
          ...run.candidate_result,
          git_candidate_receipt: { ...run.candidate_result.git_candidate_receipt },
        },
        candidate_review: run.candidate_review === null ? null : {
          ...run.candidate_review,
          revision: run.candidate_review.revision === null
            ? null
            : { ...run.candidate_review.revision },
        },
      };
    }),
    messages: turn.messages.map((message) => ({ ...message })),
    outcome: turn.outcome,
  };
}

function replayBuilderConversation(rawEvents) {
  assertDenseArray(rawEvents);
  const events = rawEvents.map((raw) => {
    try { return sanitizeBuilderConversationEvent(raw); } catch (error) {
      if (error instanceof BuilderConversationRecordError) fail();
      throw error;
    }
  });
  const first = events[0];
  if (first.sequence !== 1 || first.event_type !== 'turn_submitted'
    || first.previous_event !== null) fail();

  const state = {
    projectId: first.project_id,
    conversationId: first.conversation_id,
    eventIds: new Set(),
    commandIds: new Map(),
    messageIds: new Set(),
    taskIds: new Set(),
    runIds: new Set(),
    stepIds: new Set(),
    toolCallIds: new Set(),
    toolResultRecordDigests: new Set(),
    agentStepProgressAdmissionDigests: new Set(),
    interruptRequestIds: new Set(),
    cancelRequestIds: new Set(),
    reviewIds: new Set(),
    turns: new Map(),
    turnOrder: [],
    activeTurnId: null,
    queuedFollowups: new Map(),
    latestTaskCapsule: null,
    priorHead: null,
  };

  let previous = null;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.project_id !== state.projectId || event.conversation_id !== state.conversationId
      || event.sequence !== index + 1 || !samePrevious(event, previous)
      || state.eventIds.has(event.event_id)) fail();
    const priorCommandDigest = state.commandIds.get(event.command_id);
    if (priorCommandDigest !== undefined) fail();
    state.eventIds.add(event.event_id);
    state.commandIds.set(event.command_id, event.command_digest);
    const transition = TRANSITIONS[event.event_type];
    if (typeof transition !== 'function') fail();
    state.priorHead = previous === null ? null : {
      sequence: previous.sequence,
      event_id: previous.event_id,
      event_digest: previous.event_digest,
    };
    transition(state, event.payload);
    previous = event;
  }

  return freezeDeep({
    replay_version: CONVERSATION_REPLAY_VERSION,
    project_id: state.projectId,
    conversation_id: state.conversationId,
    event_count: events.length,
    head: {
      sequence: previous.sequence,
      event_id: previous.event_id,
      event_digest: previous.event_digest,
    },
    active_turn_id: state.activeTurnId,
    turns: state.turnOrder.map((turnId) => publicTurn(state.turns.get(turnId))),
    authority: { ...CONVERSATION_AUTHORITY },
  });
}

function safeReplay(rawEvents) {
  try { return replayBuilderConversation(rawEvents); } catch (error) {
    if (error instanceof BuilderConversationReplayError) throw error;
    fail();
  }
}

module.exports = Object.freeze({
  CONVERSATION_REPLAY_VERSION,
  BuilderConversationReplayError,
  replayBuilderConversation: safeReplay,
});
