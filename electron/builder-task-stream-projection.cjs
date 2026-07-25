'use strict';

const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderConversationEvent,
} = require('./builder-conversation-records.cjs');
const {
  replayBuilderConversation,
} = require('./builder-conversation-replay.cjs');

const BUILDER_TASK_STREAM_VERSION = 'builder-task-stream-read-result.v1';
const MAX_PUBLIC_ITEMS = 128;
const MAX_PUBLIC_BYTES = 4 * 1_024 * 1_024;
const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONVERSATION_ID_PATTERN =
  /^builder-conversation:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

class BuilderTaskStreamProjectionError extends Error {
  constructor() {
    super('Project activity is unavailable.');
    this.name = 'BuilderTaskStreamProjectionError';
    this.code = 'builder_task_stream_unavailable';
    this.retryable = true;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderTaskStreamProjectionError();
}

function isPlainObject(value) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || utilTypes.isProxy(value)
  ) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length
    || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return value;
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function safeProjectId(value) {
  if (typeof value !== 'string' || !PROJECT_ID_PATTERN.test(value)) fail();
  return value;
}

function safeConversationId(value, projectId) {
  if (
    typeof value !== 'string'
    || !CONVERSATION_ID_PATTERN.test(value)
    || value.slice('builder-conversation:'.length)
      !== projectId.slice('builder-project:'.length)
  ) fail();
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function denseEvents(value) {
  if (
    !Array.isArray(value)
    || utilTypes.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < 1
    || value.length > 1_024
  ) {
    fail();
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== value.length + 1
    || ownKeys.some((key) => typeof key === 'symbol')
  ) fail();
  const events = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      !descriptor
      || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
    ) fail();
    events.push(sanitizeBuilderConversationEvent(descriptor.value));
  }
  return events;
}

function messageProjection(message) {
  return {
    message_id: message.message_id,
    text: message.text,
  };
}

function publicToolLabel(action) {
  switch (action) {
    case 'context.read':
    case 'project.read':
      return 'Read project context';
    case 'project.edit':
      return 'Prepare project edit';
    case 'secret.read':
      return 'Use saved secret';
    case 'filesystem.read':
      return 'Read project file';
    case 'filesystem.write':
      return 'Prepare file change';
    case 'network.request':
      return 'Use network';
    case 'process.spawn':
      return 'Run local command';
    case 'publication.create':
      return 'Prepare publish';
    case 'permission.grant':
      return 'Change access';
    default:
      fail();
  }
}

function itemFromEvent(event) {
  const payload = event.payload;
  switch (event.event_type) {
    case 'turn_submitted':
      return {
        item_kind: 'user_message',
        sequence: event.sequence,
        turn_id: payload.turn_id,
        message: messageProjection(payload.message),
        message_kind: 'submitted',
        mode: payload.mode,
        task: payload.task === null ? null : {
          task_id: payload.task.task_id,
          title: payload.task.title,
        },
      };
    case 'turn_steered':
      return {
        item_kind: 'user_message',
        sequence: event.sequence,
        turn_id: payload.turn_id,
        message: messageProjection(payload.message),
        message_kind: 'steering',
        mode: null,
        task: null,
      };
    case 'run_started':
      return {
        item_kind: 'run_started',
        sequence: event.sequence,
        turn_id: payload.turn_id,
        run_id: payload.run_id,
        task_id: payload.task_id,
        attempt_number: payload.attempt_number,
        retry_of_run_id: payload.retry_of_run_id,
        recorded_state: 'started',
      };
    case 'run_interrupt_requested':
    case 'run_cancel_requested':
      return {
        item_kind: 'run_control_requested',
        sequence: event.sequence,
        turn_id: payload.turn_id,
        run_id: payload.run_id,
        action: event.event_type === 'run_cancel_requested' ? 'cancel' : 'interrupt',
      };
    case 'tool_call_requested': {
      const record = payload.tool_call_record;
      return {
        item_kind: 'tool_call_requested',
        sequence: event.sequence,
        turn_id: record.turn_id,
        run_id: record.run_id,
        step_id: record.step_id,
        tool_call_id: record.tool_call_id,
        tool_label: publicToolLabel(record.action),
        action: record.action,
        resource: {
          resource_kind: record.resource.resource_kind,
        },
        lifecycle: {
          permission_admission: 'verified_allowed',
          dispatch_admission: 'not_started',
          execution_admission: 'not_performed',
          result_admission: 'not_recorded',
        },
        recorded_state: 'requested',
      };
    }
    case 'tool_call_result_recorded': {
      const record = payload.tool_result_record;
      return {
        item_kind: 'tool_call_result_recorded',
        sequence: event.sequence,
        turn_id: record.turn_id,
        run_id: record.run_id,
        step_id: record.step_id,
        tool_call_id: record.tool_call_id,
        tool_label: publicToolLabel(record.action),
        action: record.action,
        resource: {
          resource_kind: record.resource_kind,
        },
        result: {
          status: record.result.status,
          summary_code: record.result.summary_code,
          display_summary: record.result.display_summary,
        },
        lifecycle: {
          result_admission: 'fixed_summary_code_recorded',
          raw_output_admission: 'not_included',
          revision_admission: 'not_created',
        },
        recorded_state: 'recorded',
      };
    }
    case 'run_completed':
      return {
        item_kind: 'run_completed',
        sequence: event.sequence,
        turn_id: payload.turn_id,
        run_id: payload.run_id,
        terminal_status: payload.terminal_status,
        result_kind: payload.result_kind,
        assistant_message: payload.assistant_message === null
          ? null
          : messageProjection(payload.assistant_message),
        candidate: payload.candidate_result === null ? null : {
          draft_id: payload.candidate_result.draft_id,
          title: payload.candidate_result.title,
          summary: payload.candidate_result.summary,
          candidate_state: 'proposed',
          source_availability: 'not_loaded',
        },
      };
    case 'candidate_rejected':
      return {
        item_kind: 'candidate_reviewed',
        sequence: event.sequence,
        turn_id: payload.turn_id,
        run_id: payload.run_id,
        draft_id: payload.draft_id,
        decision: 'rejected',
        candidate_state: 'rejected',
        saved_revision: null,
      };
    case 'candidate_accepted':
      return {
        item_kind: 'candidate_reviewed',
        sequence: event.sequence,
        turn_id: payload.turn_id,
        run_id: payload.run_id,
        draft_id: payload.draft_id,
        decision: 'accepted',
        candidate_state: 'saved',
        saved_revision: {
          revision_number: payload.revision.revision_number,
        },
      };
    case 'plan_reviewed':
      return {
        item_kind: 'plan_reviewed',
        sequence: event.sequence,
        turn_id: payload.turn_id,
        run_id: payload.run_id,
        decision: payload.decision,
        plan_state: payload.decision,
      };
    case 'turn_completed':
      return {
        item_kind: 'turn_completed',
        sequence: event.sequence,
        turn_id: payload.turn_id,
        run_id: payload.run_id,
        outcome: payload.outcome,
      };
    default:
      fail();
  }
}

function authority() {
  return {
    conversation: 'sqlite_canonical_event_replay_or_absent',
    project_source: 'not_included',
    candidate_source: 'not_loaded',
    project_revision: 'not_inferred',
  };
}

function boundResult(result) {
  const bytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
  if (bytes > MAX_PUBLIC_BYTES) fail();
  return freezeDeep(result);
}

function projectBuilderTaskStream(rawInput) {
  try {
    exactObject(rawInput, ['project_id', 'conversation']);
    const projectId = safeProjectId(valueAt(rawInput, 'project_id'));
    const rawConversation = valueAt(rawInput, 'conversation');
    if (rawConversation === null) {
      return boundResult({
        stream_version: BUILDER_TASK_STREAM_VERSION,
        project_id: projectId,
        conversation: null,
        authority: authority(),
      });
    }

    exactObject(rawConversation, ['conversation_id', 'created_at_ms', 'events']);
    const conversationId = safeConversationId(
      valueAt(rawConversation, 'conversation_id'),
      projectId,
    );
    const createdAtMs = safeTimestamp(valueAt(rawConversation, 'created_at_ms'));
    const events = denseEvents(valueAt(rawConversation, 'events'));
    const replay = replayBuilderConversation(events);
    if (
      replay.project_id !== projectId
      || replay.conversation_id !== conversationId
    ) fail();
    const visibleItems = [];
    const firstVisibleIndex = Math.max(0, events.length - MAX_PUBLIC_ITEMS);
    for (let index = firstVisibleIndex; index < events.length; index += 1) {
      visibleItems.push(itemFromEvent(events[index]));
    }
    return boundResult({
      stream_version: BUILDER_TASK_STREAM_VERSION,
      project_id: projectId,
      conversation: {
        conversation_id: conversationId,
        created_at_ms: createdAtMs,
        head_sequence: replay.head.sequence,
        recorded_active_turn_id: replay.active_turn_id,
        window: {
          first_sequence: visibleItems[0].sequence,
          last_sequence: visibleItems.at(-1).sequence,
          has_earlier: events.length > visibleItems.length,
        },
        items: visibleItems,
      },
      authority: authority(),
    });
  } catch (error) {
    if (error instanceof BuilderTaskStreamProjectionError) throw error;
    fail();
  }
}

module.exports = Object.freeze({
  BUILDER_TASK_STREAM_VERSION,
  MAX_PUBLIC_ITEMS,
  MAX_PUBLIC_BYTES,
  BuilderTaskStreamProjectionError,
  projectBuilderTaskStream,
});
