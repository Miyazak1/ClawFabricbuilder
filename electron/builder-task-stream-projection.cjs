'use strict';

const { types: utilTypes } = require('node:util');

const {
  MAX_EVENT_SEQUENCE,
  projectBuilderPublicMessageText,
  sanitizeBuilderConversationEvent,
} = require('./builder-conversation-records.cjs');
const {
  replayBuilderConversation,
} = require('./builder-conversation-replay.cjs');
const {
  sanitizeBuilderContextStatusProjection,
} = require('./builder-context-status-projection.cjs');
const {
  sanitizeBuilderProviderContextDisclosureStatusProjection,
} = require('./builder-provider-context-disclosure-status-projection.cjs');
const {
  sanitizeBuilderDraftCheckpointStatusProjection,
} = require('./builder-draft-checkpoint-status-projection.cjs');
const {
  sanitizeBuilderDraftCheckpointTimelineProjection,
} = require('./builder-draft-checkpoint-timeline-projection.cjs');
const {
  sanitizeBuilderReviewStateProjection,
} = require('./builder-review-state-projection.cjs');
const {
  projectBuilderAgentActivity,
} = require('./builder-agent-activity-projection.cjs');
const {
  sanitizeBuilderCheckRunOutcomeProjection,
} = require('./builder-check-run-outcome-projection.cjs');
const {
  CONVERSATION_ID_PATTERN,
  sanitizeBuilderConversationAddress,
} = require('./builder-conversation-address.cjs');

const BUILDER_TASK_STREAM_VERSION = 'builder-task-stream-read-result.v1';
const MAX_PUBLIC_ITEMS = 512;
const MAX_PUBLIC_BYTES = 4 * 1_024 * 1_024;
const MAX_PUBLIC_MESSAGE_CODE_POINTS = 8_192;
const MAX_PUBLIC_MESSAGE_UTF8_BYTES = 16 * 1_024;
const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MESSAGE_ID_PATTERN =
  /^builder-message:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TURN_ID_PATTERN =
  /^builder-turn:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_AUTHORITY_PROJECTION_CACHES = 32;
const authorityProjectionCaches = new Map();

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

function exactObjectWithOptional(value, requiredKeys, optionalKeys) {
  if (!isPlainObject(value)) fail();
  const allowed = [...requiredKeys, ...optionalKeys];
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length < requiredKeys.length
    || ownKeys.length > allowed.length
    || ownKeys.some((key) => typeof key !== 'string' || !allowed.includes(key))
    || requiredKeys.some((key) => !ownKeys.includes(key))
  ) fail();
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
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
  if (typeof value !== 'string' || !CONVERSATION_ID_PATTERN.test(value)) fail();
  try {
    return sanitizeBuilderConversationAddress(projectId, value);
  } catch {
    fail();
  }
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeSequence(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_EVENT_SEQUENCE) fail();
  return value;
}

function safeId(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function denseEvents(value) {
  if (
    !Array.isArray(value)
    || utilTypes.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < 1
    || value.length > MAX_EVENT_SEQUENCE
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

function denseTranscriptEntries(value) {
  if (
    !Array.isArray(value)
    || utilTypes.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > MAX_EVENT_SEQUENCE
  ) fail();
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== value.length + 1
    || ownKeys.some((key) => typeof key === 'symbol')
  ) fail();
  const entries = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      !descriptor
      || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
    ) fail();
    entries.push(descriptor.value);
  }
  return entries;
}

function messageProjection(message) {
  return {
    message_id: message.message_id,
    text: message.text,
  };
}

function transcriptItemFromEntry(entry, sequence) {
  exactObject(entry, ['entry_kind', 'turn_id', 'message_id', 'role', 'kind', 'text']);
  if (valueAt(entry, 'entry_kind') !== 'message') fail();
  const role = valueAt(entry, 'role');
  const kind = valueAt(entry, 'kind');
  if (role !== 'user' && role !== 'assistant') fail();
  if (!['submitted', 'steering', 'queued_followup', 'run_result'].includes(kind)) fail();
  return {
    item_kind: 'transcript_message',
    sequence,
    turn_id: safeId(valueAt(entry, 'turn_id'), TURN_ID_PATTERN),
    message: {
      message_id: safeId(valueAt(entry, 'message_id'), MESSAGE_ID_PATTERN),
      text: projectBuilderPublicMessageText(valueAt(entry, 'text')),
    },
    role,
    message_kind: kind,
    recovery_admission: 'sqlite_derived_public_transcript_only',
  };
}

function currentMaterializationProjection(value) {
  if (!isPlainObject(value)) return { status: 'not_recorded' };
  const status = valueAt(value, 'status');
  if (status === 'materialized') return { status };
  if (status === 'not_materialized') {
    return {
      status,
      label: 'Workspace sync needs attention',
      detail: 'The draft is recoverable, but the project folder could not be updated automatically.',
    };
  }
  if (status === 'not_attempted') {
    return {
      status,
      label: 'Workspace sync not enabled',
      detail: 'The draft is recoverable, but automatic project-folder sync was not available.',
    };
  }
  return { status: 'not_recorded' };
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

function latestProgressStagesByRun(events) {
  const stages = new Map();
  for (const event of events) {
    if (event.event_type !== 'run_progress_recorded') continue;
    stages.set(event.payload.run_id, event.payload.stage);
  }
  return stages;
}

function latestUnreviewedDraftId(replay) {
  for (let turnIndex = replay.turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = replay.turns[turnIndex];
    for (let runIndex = turn.runs.length - 1; runIndex >= 0; runIndex -= 1) {
      const run = turn.runs[runIndex];
      if (run.candidate_result === null) continue;
      return run.candidate_review === null ? run.candidate_result.draft_id : null;
    }
  }
  return null;
}

function failurePhase(payload, progressStagesByRun) {
  if (payload.terminal_status !== 'failed') return 'not_applicable';
  return progressStagesByRun.get(payload.run_id) ?? 'not_recorded';
}

function publicRuntimeToolActivity(sequence, activity) {
  return {
    item_kind: 'programming_runtime_tool_activity',
    sequence,
    turn_id: activity.turn_id,
    run_id: activity.run_id,
    step_id: activity.step_id,
    tool_call_id: activity.tool_call_id,
    tool_kind: activity.tool_kind,
    state: activity.state,
    active_label: activity.active_label,
    completed_label: activity.completed_label,
    target_label: activity.target_label,
    presentation: activity.presentation,
    status_label: activity.status_label,
    duration_ms: activity.duration_ms,
    summary: activity.summary,
    failure_class: activity.failure_class,
    result_ref: activity.result_ref,
    presentation_detail: activity.presentation_detail === null
      ? null
      : JSON.parse(JSON.stringify(activity.presentation_detail)),
    file_change: activity.file_change === null ? null : { ...activity.file_change },
    check_result: activity.check_result === null ? null : { ...activity.check_result },
  };
}

function runtimeAssistantMessageFromEvent(event, runtimeAssistantMessages) {
  const runtimeEvent = event.payload.runtime_event;
  const eventType = runtimeEvent.event_type;
  if (
    eventType !== 'assistant_text_delta'
    && eventType !== 'assistant_text_discarded'
    && eventType !== 'assistant_text_completed'
  ) {
    return null;
  }
  const messageId = runtimeEvent.payload.message_id;
  const existing = runtimeAssistantMessages.get(messageId) ?? {
    turn_id: runtimeEvent.turn_id,
    run_id: runtimeEvent.run_id,
    step_id: runtimeEvent.step_id,
    text: '',
    public_text_unavailable: false,
  };
  if (
    existing.turn_id !== runtimeEvent.turn_id
    || existing.run_id !== runtimeEvent.run_id
    || existing.step_id !== runtimeEvent.step_id
  ) fail();
  if (eventType === 'assistant_text_delta') {
    if (!existing.public_text_unavailable) {
      const nextText = existing.text + runtimeEvent.payload.delta_text;
      if (
        Array.from(nextText).length > MAX_PUBLIC_MESSAGE_CODE_POINTS
        || Buffer.byteLength(nextText, 'utf8') > MAX_PUBLIC_MESSAGE_UTF8_BYTES
      ) {
        existing.text = '';
        existing.public_text_unavailable = true;
      } else {
        existing.text = nextText;
      }
    }
    runtimeAssistantMessages.set(messageId, existing);
    return null;
  }
  if (eventType === 'assistant_text_discarded') {
    runtimeAssistantMessages.delete(messageId);
    return null;
  }
  runtimeAssistantMessages.delete(messageId);
  if (existing.public_text_unavailable) return null;
  if (existing.text.length === 0) fail();
  const publicText = projectBuilderPublicMessageText(existing.text);
  if (publicText === null) return null;
  return {
    item_kind: 'programming_runtime_assistant_message',
    sequence: event.sequence,
    turn_id: existing.turn_id,
    run_id: existing.run_id,
    step_id: existing.step_id,
    message: {
      message_id: messageId,
      text: publicText,
    },
  };
}

function runtimeToolActivityFromEvent(event, runtimeActivities) {
  const runtimeEvent = event.payload.runtime_event;
  const eventType = runtimeEvent.event_type;
  const toolCallId = runtimeEvent.tool_call_id;
  if (eventType === 'tool_call_started') {
    const activity = {
      turn_id: runtimeEvent.turn_id,
      run_id: runtimeEvent.run_id,
      step_id: runtimeEvent.step_id,
      tool_call_id: toolCallId,
      tool_kind: runtimeEvent.payload.tool_kind,
      state: 'running',
      active_label: runtimeEvent.payload.active_label,
      completed_label: runtimeEvent.payload.completed_label,
      target_label: runtimeEvent.payload.target_label,
      presentation: runtimeEvent.payload.presentation,
      status_label: null,
      duration_ms: null,
      summary: null,
      failure_class: null,
      result_ref: null,
      presentation_detail: null,
      file_change: null,
      check_result: null,
    };
    runtimeActivities.set(toolCallId, activity);
    return publicRuntimeToolActivity(event.sequence, activity);
  }
  if (![
    'tool_call_updated',
    'tool_call_completed',
    'tool_call_failed',
    'file_change_recorded',
    'check_result_recorded',
  ].includes(eventType)) return null;
  const activity = runtimeActivities.get(toolCallId);
  if (activity === undefined) fail();
  if (eventType === 'tool_call_updated') {
    activity.status_label = runtimeEvent.payload.status_label;
  } else if (eventType === 'file_change_recorded') {
    activity.file_change = {
      change_ref: runtimeEvent.payload.change_ref,
      change_kind: runtimeEvent.payload.change_kind,
      added_lines: runtimeEvent.payload.added_lines,
      deleted_lines: runtimeEvent.payload.deleted_lines,
    };
  } else if (eventType === 'check_result_recorded') {
    activity.check_result = {
      command_ref: runtimeEvent.payload.command_ref,
      status: runtimeEvent.payload.status,
      duration_ms: runtimeEvent.payload.duration_ms,
      summary: runtimeEvent.payload.summary,
    };
  } else if (eventType === 'tool_call_completed') {
    activity.state = 'completed';
    activity.duration_ms = runtimeEvent.payload.duration_ms;
    activity.summary = runtimeEvent.payload.summary;
    activity.result_ref = runtimeEvent.payload.result_ref;
    activity.presentation_detail = runtimeEvent.payload.presentation_detail ?? null;
  } else {
    activity.state = 'failed';
    activity.duration_ms = runtimeEvent.payload.duration_ms;
    activity.summary = runtimeEvent.payload.safe_message;
    activity.failure_class = runtimeEvent.payload.failure_class;
  }
  return publicRuntimeToolActivity(event.sequence, activity);
}

function runtimeStatusFromEvent(event) {
  const runtimeEvent = event.payload.runtime_event;
  const eventType = runtimeEvent.event_type;
  if (runtimeEvent.turn_id === null) return null;
  const base = {
    item_kind: 'programming_runtime_status',
    sequence: event.sequence,
    turn_id: runtimeEvent.turn_id,
    run_id: runtimeEvent.run_id,
    step_id: runtimeEvent.step_id,
    activity_kind: null,
    attention_class: null,
    failure_class: null,
  };
  if (eventType === 'assistant_reasoning_status') {
    return { ...base, status_kind: 'reasoning', status: runtimeEvent.payload.status };
  }
  if (eventType === 'runtime_activity_status') {
    return {
      ...base,
      status_kind: 'activity',
      activity_kind: runtimeEvent.payload.activity_kind,
      status: runtimeEvent.payload.status,
    };
  }
  if (eventType === 'run_blocked') {
    const labels = {
      permission_required: '等待你确认权限',
      user_input_required: '等待你的回答',
      workspace_unavailable: '需要选择项目文件夹',
    };
    return {
      ...base,
      status_kind: 'attention',
      attention_class: runtimeEvent.payload.blocker_class,
      status: runtimeEvent.payload.blocker_class === 'user_input_required'
        ? runtimeEvent.payload.safe_message
        : labels[runtimeEvent.payload.blocker_class],
    };
  }
  if (eventType === 'run_cancelled' || eventType === 'run_failed') {
    const labels = {
      cancelled: '运行已取消',
      timeout: '运行超时',
      provider_failure: 'AI 服务请求失败',
      runtime_failure: '运行环境未能完成任务',
      invalid_event: '运行事件校验失败',
      runtime_idle_timeout: '运行长时间没有新活动',
      run_limit_reached: '本轮已达到运行上限',
    };
    return {
      ...base,
      status_kind: eventType === 'run_cancelled' ? 'cancelled' : 'failure',
      failure_class: runtimeEvent.payload.failure_class,
      status: labels[runtimeEvent.payload.failure_class],
    };
  }
  return null;
}

function itemFromEvent(
  event,
  progressStagesByRun,
  runtimeActivities,
  runtimeAssistantMessages,
) {
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
    case 'turn_followup_queued':
      return {
        item_kind: 'user_message',
        sequence: event.sequence,
        turn_id: payload.turn_id,
        message: messageProjection(payload.message),
        message_kind: 'queued_followup',
        mode: null,
        task: null,
      };
    case 'turn_followup_consumed':
      return {
        item_kind: 'queued_followup_consumed',
        sequence: event.sequence,
        turn_id: payload.turn_id,
        run_id: payload.run_id,
        message_id: payload.message_id,
        consumed_by: {
          turn_id: payload.consuming_turn_id,
          message_id: payload.consuming_message_id,
        },
        recorded_state: 'consumed',
      };
    case 'task_brief_updated': {
      const capsule = payload.task_capsule;
      return {
        item_kind: 'task_brief_updated',
        sequence: event.sequence,
        turn_id: payload.turn_id,
        run_id: payload.run_id,
        task: {
          task_id: capsule.task_id,
          title: capsule.title,
        },
        brief: {
          status: capsule.status,
          summary: `${capsule.current_brief.latest_user_goal} ${capsule.current_brief.assistant_proposal}`,
          contextual_build_ready: capsule.current_brief.use_when_instruction_is_contextual,
        },
        recorded_state: 'updated',
      };
    }
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
    case 'run_context_snapshot_recorded': {
      const snapshot = payload.snapshot;
      return {
        item_kind: 'run_context_snapshot_recorded',
        sequence: event.sequence,
        turn_id: payload.turn_id,
        run_id: payload.run_id,
        task_id: snapshot.task_id,
        context: {
          recorded_state: 'recorded',
          route: snapshot.route_decision.route,
          dispatch: snapshot.route_decision.dispatch,
          downgraded_from: snapshot.route_decision.downgraded_from,
          downgrade_reason: snapshot.route_decision.downgrade_reason,
          brief: snapshot.brief_reference.status === 'task_capsule_update'
            ? 'available'
            : 'not_available',
          base: snapshot.base_revision === null ? 'new_project_or_unsaved' : 'project_revision',
          permission_result: snapshot.permissions.permission_result,
          command_execution: 'not_included',
          network_access: 'not_included',
        },
      };
    }
    case 'programming_run_admitted':
      return {
        item_kind: 'programming_run_admitted',
        sequence: event.sequence,
        turn_id: payload.turn_id,
        run_id: payload.run_id,
        task_id: payload.programming_run_admission.task_id,
        recorded_state: 'admitted',
      };
    case 'run_progress_recorded':
      return {
        item_kind: 'run_progress_recorded',
        sequence: event.sequence,
        turn_id: payload.turn_id,
        run_id: payload.run_id,
        stage: payload.stage,
        recorded_state: 'recorded',
      };
    case 'checkpoint_recorded':
      return {
        item_kind: 'checkpoint_recorded',
        sequence: event.sequence,
        turn_id: payload.turn_id,
        run_id: payload.run_id,
        status: payload.status,
        changed_file_count: payload.changed_file_count,
        verification_status: payload.verification_status,
      };
    case 'recovery_action_recorded':
      return {
        item_kind: 'recovery_action_recorded',
        sequence: event.sequence,
        turn_id: payload.turn_id,
        run_id: payload.run_id,
        action: payload.action,
        phase: payload.phase,
      };
    case 'programming_runtime_event_recorded':
      return runtimeAssistantMessageFromEvent(event, runtimeAssistantMessages)
        ?? runtimeToolActivityFromEvent(event, runtimeActivities)
        ?? runtimeStatusFromEvent(event);
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
    case 'agent_step_progress_recorded': {
      const admission = payload.progress_admission;
      return {
        item_kind: 'agent_step_progress_recorded',
        sequence: event.sequence,
        turn_id: admission.turn_id,
        run_id: admission.run_id,
        task_id: admission.task_id,
        step_id: admission.step_id,
        step_index: admission.step_index,
        recorded_state: admission.recorded_state,
        result: admission.result === null ? null : {
          status: admission.result.status,
          summary_code: admission.result.summary_code,
          display_summary: admission.result.display_summary,
        },
        summary: {
          status: admission.summary.status,
          display_summary: admission.summary.display_summary,
        },
        lifecycle: {
          conversation_admission: 'verified_public_progress',
          raw_output_admission: 'not_included',
          revision_admission: 'not_created',
        },
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
        failure_phase: failurePhase(payload, progressStagesByRun),
        assistant_message: payload.assistant_message === null
          ? null
          : messageProjection(payload.assistant_message),
        candidate: payload.candidate_result === null ? null : {
          draft_id: payload.candidate_result.draft_id,
          title: payload.candidate_result.title,
          summary: payload.candidate_result.summary,
          candidate_state: 'proposed',
          source_availability: 'not_loaded',
          workspace_materialization: currentMaterializationProjection(
            payload.candidate_result.current_materialization,
          ),
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

function projectTranscriptRestoredConversation({
  projectId,
  conversationId,
  rawConversation,
  contextStatusProjection,
  providerContextDisclosureStatusProjection,
  draftCheckpointStatusProjection,
  draftCheckpointTimelineProjection,
  reviewStateProjection,
  checkRunOutcomeProjection,
  candidateActivity,
}) {
  if (
    contextStatusProjection !== undefined
    || providerContextDisclosureStatusProjection !== undefined
    || draftCheckpointStatusProjection !== undefined
    || draftCheckpointTimelineProjection !== undefined
    || reviewStateProjection !== undefined
    || checkRunOutcomeProjection !== undefined
    || candidateActivity !== undefined
  ) fail();
  const source = valueAt(rawConversation, 'source');
  if (source !== 'sqlite_derived_public_transcript') fail();
  const createdAtMs = safeTimestamp(valueAt(rawConversation, 'created_at_ms'));
  const latestSourceSequence = safeSequence(valueAt(rawConversation, 'head_sequence'));
  const entries = denseTranscriptEntries(valueAt(rawConversation, 'public_entries'));
  const projectedItems = [];
  for (const entry of entries) {
    if (!isPlainObject(entry)) fail();
    if (valueAt(entry, 'entry_kind') !== 'message') continue;
    projectedItems.push(transcriptItemFromEntry(entry, projectedItems.length + 1));
  }
  if (projectedItems.length < 1) fail();
  const visibleItems = projectedItems.slice(-MAX_PUBLIC_ITEMS);
  return boundResult({
    stream_version: BUILDER_TASK_STREAM_VERSION,
    project_id: projectId,
    conversation: {
      conversation_id: conversationId,
      created_at_ms: createdAtMs,
      head_sequence: projectedItems.length,
      recorded_active_turn_id: null,
      source,
      recovery: {
        recovery_kind: 'transcript_restored',
        latest_source_sequence: latestSourceSequence,
        authority: 'sqlite_derived_non_authoritative_transcript',
      },
      window: {
        first_sequence: visibleItems[0].sequence,
        last_sequence: projectedItems.length,
        has_earlier: projectedItems.length > MAX_PUBLIC_ITEMS,
      },
      items: visibleItems,
    },
    authority: {
      ...authority(),
      conversation: 'sqlite_derived_public_transcript_restore',
    },
  });
}

function safeOptionalContextStatusProjection(rawInput) {
  if (!Object.hasOwn(rawInput, 'context_status_projection')) return undefined;
  const value = valueAt(rawInput, 'context_status_projection');
  if (value === null) return null;
  return sanitizeBuilderContextStatusProjection(value);
}

function safeOptionalProviderContextDisclosureStatusProjection(rawInput) {
  if (!Object.hasOwn(rawInput, 'provider_context_disclosure_status_projection')) return undefined;
  const value = valueAt(rawInput, 'provider_context_disclosure_status_projection');
  if (value === null) return null;
  return sanitizeBuilderProviderContextDisclosureStatusProjection(value);
}

function safeOptionalDraftCheckpointStatusProjection(rawInput) {
  if (!Object.hasOwn(rawInput, 'draft_checkpoint_status_projection')) return undefined;
  const value = valueAt(rawInput, 'draft_checkpoint_status_projection');
  if (value === null) return null;
  return sanitizeBuilderDraftCheckpointStatusProjection(value);
}

function safeOptionalDraftCheckpointTimelineProjection(rawInput) {
  if (!Object.hasOwn(rawInput, 'draft_checkpoint_timeline_projection')) return undefined;
  const value = valueAt(rawInput, 'draft_checkpoint_timeline_projection');
  if (value === null) return null;
  return sanitizeBuilderDraftCheckpointTimelineProjection(value);
}

function safeOptionalReviewStateProjection(rawInput) {
  if (!Object.hasOwn(rawInput, 'review_state_projection')) return undefined;
  const value = valueAt(rawInput, 'review_state_projection');
  if (value === null) return null;
  return sanitizeBuilderReviewStateProjection(value);
}

function safeOptionalCandidateActivity(rawInput) {
  if (!Object.hasOwn(rawInput, 'candidate_activity')) return undefined;
  const value = valueAt(rawInput, 'candidate_activity');
  if (value !== null && value !== 'check_run') fail();
  return value;
}

function safeOptionalCheckRunOutcomeProjection(rawInput) {
  if (!Object.hasOwn(rawInput, 'check_run_outcome_projection')) return undefined;
  const value = valueAt(rawInput, 'check_run_outcome_projection');
  if (value === null) return null;
  return sanitizeBuilderCheckRunOutcomeProjection(value);
}

function assertCheckRunProjectionConsistency(
  reviewStateProjection,
  checkRunOutcomeProjection,
  candidateActivity,
) {
  if (
    candidateActivity === 'check_run'
    && checkRunOutcomeProjection?.state !== 'running'
  ) fail();
  if (
    checkRunOutcomeProjection?.state === 'running'
    && candidateActivity !== 'check_run'
  ) fail();
  if (
    reviewStateProjection !== undefined
    && reviewStateProjection !== null
    && checkRunOutcomeProjection !== undefined
    && checkRunOutcomeProjection !== null
    && reviewStateProjection.check_status !== checkRunOutcomeProjection.status
  ) fail();
}

function withOptionalStatusProjections(
  result,
  contextStatusProjection,
  providerContextDisclosureStatusProjection,
  draftCheckpointStatusProjection,
  draftCheckpointTimelineProjection,
  reviewStateProjection,
  checkRunOutcomeProjection,
  agentActivityProjection,
) {
  return {
    ...result,
    ...(contextStatusProjection === undefined
      ? {}
      : { context_status_projection: contextStatusProjection }),
    ...(providerContextDisclosureStatusProjection === undefined
      ? {}
      : {
        provider_context_disclosure_status_projection:
          providerContextDisclosureStatusProjection,
      }),
    ...(draftCheckpointStatusProjection === undefined
      ? {}
      : { draft_checkpoint_status_projection: draftCheckpointStatusProjection }),
    ...(draftCheckpointTimelineProjection === undefined
      ? {}
      : { draft_checkpoint_timeline_projection: draftCheckpointTimelineProjection }),
    ...(reviewStateProjection === undefined
      ? {}
      : { review_state_projection: reviewStateProjection }),
    ...(checkRunOutcomeProjection === undefined
      ? {}
      : { check_run_outcome_projection: checkRunOutcomeProjection }),
    ...(agentActivityProjection === undefined
      ? {}
      : { agent_activity_projection: agentActivityProjection }),
  };
}

function latestRunActivityFacts(replay) {
  const turn = replay.turns.at(-1) ?? null;
  const run = turn?.runs.at(-1) ?? null;
  if (run === null) return null;
  const activeToolCall = [...run.tool_calls].reverse().find(
    (toolCall) => toolCall.tool_result_record === null,
  ) ?? null;
  return {
    turn_id: turn.turn_id,
    run_id: run.run_id,
    status: run.status,
    terminal_status: run.terminal_status,
    result_kind: run.result_kind,
    route: run.context_snapshot?.route_decision.route ?? null,
    dispatch: run.context_snapshot?.route_decision.dispatch ?? null,
    programming_run_admitted: run.programming_run_admission !== null,
    latest_progress_stage: run.progress_stages.at(-1) ?? null,
    active_tool_action: activeToolCall?.action ?? null,
    control: run.cancel_request_id !== null
      ? 'cancel'
      : run.interrupt_request_id !== null
        ? 'interrupt'
        : null,
    plan_review: run.plan_review?.decision ?? null,
    candidate_review: run.candidate_review?.decision ?? null,
  };
}

function cloneRuntimeActivity(activity) {
  return {
    ...activity,
    presentation_detail: activity.presentation_detail === null
      ? null
      : { ...activity.presentation_detail },
    file_change: activity.file_change === null ? null : { ...activity.file_change },
    check_result: activity.check_result === null ? null : { ...activity.check_result },
  };
}

function boundedAuthorityProjectionCacheSet(key, entry) {
  authorityProjectionCaches.delete(key);
  authorityProjectionCaches.set(key, entry);
  while (authorityProjectionCaches.size > MAX_AUTHORITY_PROJECTION_CACHES) {
    authorityProjectionCaches.delete(authorityProjectionCaches.keys().next().value);
  }
}

function projectAuthorityItems(projectId, conversationId, events) {
  const key = `${projectId}\u0000${conversationId}`;
  const cached = authorityProjectionCaches.get(key) ?? null;
  const canAppend = cached !== null
    && cached.eventCount <= events.length
    && cached.eventCount > 0
    && events[cached.eventCount - 1] === cached.lastEvent;
  const progressStagesByRun = canAppend
    ? new Map(cached.progressStagesByRun)
    : new Map();
  const runtimeActivities = canAppend
    ? new Map([...cached.runtimeActivities].map(([id, activity]) => [
      id,
      cloneRuntimeActivity(activity),
    ]))
    : new Map();
  const runtimeAssistantMessages = canAppend
    ? new Map([...cached.runtimeAssistantMessages].map(([id, message]) => [id, { ...message }]))
    : new Map();
  const visibleItems = canAppend ? [...cached.visibleItems] : [];
  let projectedItemCount = canAppend ? cached.projectedItemCount : 0;
  const startIndex = canAppend ? cached.eventCount : 0;

  try {
    for (let index = startIndex; index < events.length; index += 1) {
      const event = events[index];
      if (event.event_type === 'run_progress_recorded') {
        progressStagesByRun.set(event.payload.run_id, event.payload.stage);
      }
      const item = itemFromEvent(
        event,
        progressStagesByRun,
        runtimeActivities,
        runtimeAssistantMessages,
      );
      if (item === null) continue;
      projectedItemCount += 1;
      visibleItems.push(item);
      if (visibleItems.length > MAX_PUBLIC_ITEMS) visibleItems.shift();
    }
  } catch (error) {
    authorityProjectionCaches.delete(key);
    throw error;
  }

  boundedAuthorityProjectionCacheSet(key, {
    eventCount: events.length,
    lastEvent: events.at(-1),
    projectedItemCount,
    visibleItems,
    progressStagesByRun,
    runtimeActivities,
    runtimeAssistantMessages,
  });
  return {
    visibleItems,
    hasEarlier: projectedItemCount > MAX_PUBLIC_ITEMS,
  };
}

function projectBuilderTaskStreamInternal(rawInput, authorityState) {
  try {
    exactObjectWithOptional(rawInput, ['project_id', 'conversation'], [
      'context_status_projection',
      'provider_context_disclosure_status_projection',
      'draft_checkpoint_status_projection',
      'draft_checkpoint_timeline_projection',
      'review_state_projection',
      'check_run_outcome_projection',
      'candidate_activity',
    ]);
    const projectId = safeProjectId(valueAt(rawInput, 'project_id'));
    const contextStatusProjection = safeOptionalContextStatusProjection(rawInput);
    const providerContextDisclosureStatusProjection =
      safeOptionalProviderContextDisclosureStatusProjection(rawInput);
    const draftCheckpointStatusProjection = safeOptionalDraftCheckpointStatusProjection(rawInput);
    const draftCheckpointTimelineProjection =
      safeOptionalDraftCheckpointTimelineProjection(rawInput);
    const reviewStateProjection = safeOptionalReviewStateProjection(rawInput);
    const checkRunOutcomeProjection = safeOptionalCheckRunOutcomeProjection(rawInput);
    const candidateActivity = safeOptionalCandidateActivity(rawInput);
    const rawConversation = valueAt(rawInput, 'conversation');
    if (rawConversation === null) {
      if (reviewStateProjection !== undefined && reviewStateProjection !== null) fail();
      if (checkRunOutcomeProjection !== undefined && checkRunOutcomeProjection !== null) fail();
      if (candidateActivity !== undefined && candidateActivity !== null) fail();
      return boundResult(withOptionalStatusProjections({
        stream_version: BUILDER_TASK_STREAM_VERSION,
        project_id: projectId,
        conversation: null,
        authority: authority(),
      }, contextStatusProjection, providerContextDisclosureStatusProjection, draftCheckpointStatusProjection,
      draftCheckpointTimelineProjection, reviewStateProjection, checkRunOutcomeProjection, undefined));
    }

    exactObjectWithOptional(rawConversation, ['conversation_id', 'created_at_ms'], [
      'events',
      'source',
      'head_sequence',
      'public_entries',
    ]);
    const conversationId = safeConversationId(
      valueAt(rawConversation, 'conversation_id'),
      projectId,
    );
    if (Object.hasOwn(rawConversation, 'source')) {
      return projectTranscriptRestoredConversation({
        projectId,
        conversationId,
        rawConversation,
        contextStatusProjection,
        providerContextDisclosureStatusProjection,
        draftCheckpointStatusProjection,
        draftCheckpointTimelineProjection,
        reviewStateProjection,
        checkRunOutcomeProjection,
        candidateActivity,
      });
    }
    if (
      !Object.hasOwn(rawConversation, 'events')
      || Object.hasOwn(rawConversation, 'head_sequence')
      || Object.hasOwn(rawConversation, 'public_entries')
    ) fail();
    const createdAtMs = safeTimestamp(valueAt(rawConversation, 'created_at_ms'));
    const rawEvents = valueAt(rawConversation, 'events');
    let events;
    let replay;
    if (authorityState === null) {
      events = denseEvents(rawEvents);
      replay = replayBuilderConversation(events);
    } else {
      if (
        !isPlainObject(authorityState)
        || !Object.isFrozen(authorityState)
        || authorityState.events !== rawEvents
        || !Array.isArray(authorityState.events)
        || !Object.isFrozen(authorityState.events)
        || !isPlainObject(authorityState.snapshot)
        || !Object.isFrozen(authorityState.snapshot)
        || authorityState.snapshot.event_count !== authorityState.events.length
        || authorityState.snapshot.project_id !== projectId
        || authorityState.snapshot.conversation_id !== conversationId
        || authorityState.snapshot.head.sequence !== authorityState.events.length
        || authorityState.events.at(-1)?.event_digest
          !== authorityState.snapshot.head.event_digest
      ) fail();
      events = authorityState.events;
      replay = authorityState.snapshot;
    }
    if (
      replay.project_id !== projectId
      || replay.conversation_id !== conversationId
    ) fail();
    if (
      reviewStateProjection !== undefined
      && reviewStateProjection !== null
      && reviewStateProjection.draft_id !== latestUnreviewedDraftId(replay)
    ) fail();
    assertCheckRunProjectionConsistency(
      reviewStateProjection,
      checkRunOutcomeProjection,
      candidateActivity,
    );
    let visibleItems;
    let hasEarlier;
    if (authorityState === null) {
      const projectedItems = [];
      const progressStagesByRun = latestProgressStagesByRun(events);
      const runtimeActivities = new Map();
      const runtimeAssistantMessages = new Map();
      for (let index = 0; index < events.length; index += 1) {
        const item = itemFromEvent(
          events[index],
          progressStagesByRun,
          runtimeActivities,
          runtimeAssistantMessages,
        );
        if (item !== null) projectedItems.push(item);
      }
      visibleItems = projectedItems.slice(-MAX_PUBLIC_ITEMS);
      hasEarlier = projectedItems.length > MAX_PUBLIC_ITEMS;
    } else {
      ({ visibleItems, hasEarlier } = projectAuthorityItems(projectId, conversationId, events));
    }
    const agentActivityProjection = projectBuilderAgentActivity({
      project_id: projectId,
      conversation_id: conversationId,
      head_sequence: replay.head.sequence,
      active_turn_id: replay.active_turn_id,
      latest_run: latestRunActivityFacts(replay),
      review_state_projection: reviewStateProjection ?? null,
      candidate_activity: candidateActivity ?? null,
    });
    return boundResult(withOptionalStatusProjections({
      stream_version: BUILDER_TASK_STREAM_VERSION,
      project_id: projectId,
      conversation: {
        conversation_id: conversationId,
        created_at_ms: createdAtMs,
        head_sequence: replay.head.sequence,
        recorded_active_turn_id: replay.active_turn_id,
        window: {
          first_sequence: visibleItems[0].sequence,
          last_sequence: replay.head.sequence,
          has_earlier: hasEarlier,
        },
        items: visibleItems,
      },
      authority: authority(),
    }, contextStatusProjection, providerContextDisclosureStatusProjection, draftCheckpointStatusProjection,
    draftCheckpointTimelineProjection, reviewStateProjection, checkRunOutcomeProjection,
    agentActivityProjection));
  } catch (error) {
    if (error instanceof BuilderTaskStreamProjectionError) throw error;
    fail();
  }
}

function projectBuilderTaskStream(rawInput) {
  return projectBuilderTaskStreamInternal(rawInput, null);
}

function projectBuilderTaskStreamFromAuthorityState(rawInput, authorityState) {
  return projectBuilderTaskStreamInternal(rawInput, authorityState);
}

module.exports = Object.freeze({
  BUILDER_TASK_STREAM_VERSION,
  MAX_PUBLIC_ITEMS,
  MAX_PUBLIC_BYTES,
  BuilderTaskStreamProjectionError,
  projectBuilderTaskStream,
  projectBuilderTaskStreamFromAuthorityState,
});
