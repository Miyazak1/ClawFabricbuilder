'use strict';

const { types: utilTypes } = require('node:util');

const {
  CONVERSATION_AUTHORITY,
  MAX_EVENT_SEQUENCE,
  BuilderConversationRecordError,
  sanitizeBuilderConversationEvent,
} = require('./builder-conversation-records.cjs');

const CONVERSATION_REPLAY_VERSION = 'builder-conversation-replay.v2';

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
    runs: [],
    messages: [message],
    outcome: null,
  };
  state.turns.set(payload.turn_id, turn);
  state.turnOrder.push(payload.turn_id);
  state.activeTurnId = payload.turn_id;
}

function applyTurnSteered(state, payload) {
  const turn = requireActiveTurn(state, payload.turn_id);
  const run = turn.runs.at(-1) ?? null;
  if (run === null ? payload.run_id !== null
    : payload.run_id !== run.run_id || run.status !== 'running'
      || run.interrupt_request_id !== null || run.cancel_request_id !== null) fail();
  turn.messages.push(addMessage(state, payload.message, 'user', 'steering'));
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
    candidate_result: null,
    candidate_review: null,
    tool_calls: [],
    interrupt_request_id: null,
    cancel_request_id: null,
  });
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
  });
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
  if (run.tool_calls.length > 0 && payload.terminal_status === 'succeeded') fail();
  if (payload.terminal_status === 'succeeded') {
    if (turn.mode === 'question' && payload.result_kind !== 'explanation') fail();
    if (turn.mode === 'work'
      && !['explanation', 'plan', 'candidate'].includes(payload.result_kind)) fail();
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
  candidate_rejected: applyCandidateReviewed,
  candidate_accepted: applyCandidateReviewed,
  run_started: applyRunStarted,
  run_interrupt_requested: applyRunInterruptRequested,
  run_cancel_requested: applyRunCancelRequested,
  tool_call_requested: applyToolCallRequested,
  run_completed: applyRunCompleted,
  turn_completed: applyTurnCompleted,
});

function publicTurn(turn) {
  return {
    turn_id: turn.turn_id,
    mode: turn.mode,
    status: turn.status,
    task: turn.task === null ? null : { ...turn.task },
    base_revision: turn.base_revision === null ? null : { ...turn.base_revision },
    runs: turn.runs.map((run) => ({
      ...run,
      tool_calls: run.tool_calls.map((toolCall) => ({
        ...toolCall,
        resource: { ...toolCall.resource },
        lifecycle: { ...toolCall.lifecycle },
        tool_call_record: cloneToolCallRecord(toolCall.tool_call_record),
      })),
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
    })),
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
    interruptRequestIds: new Set(),
    cancelRequestIds: new Set(),
    reviewIds: new Set(),
    turns: new Map(),
    turnOrder: [],
    activeTurnId: null,
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
