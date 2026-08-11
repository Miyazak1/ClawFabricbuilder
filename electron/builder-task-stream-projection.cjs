'use strict';

const { types: utilTypes } = require('node:util');

const {
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
  sanitizeBuilderReviewStateProjection,
} = require('./builder-review-state-projection.cjs');
const {
  projectBuilderAgentActivity,
} = require('./builder-agent-activity-projection.cjs');

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

function itemFromEvent(event, progressStagesByRun) {
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

function safeOptionalReviewStateProjection(rawInput) {
  if (!Object.hasOwn(rawInput, 'review_state_projection')) return undefined;
  const value = valueAt(rawInput, 'review_state_projection');
  if (value === null) return null;
  return sanitizeBuilderReviewStateProjection(value);
}

function withOptionalStatusProjections(
  result,
  contextStatusProjection,
  providerContextDisclosureStatusProjection,
  draftCheckpointStatusProjection,
  reviewStateProjection,
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
    ...(reviewStateProjection === undefined
      ? {}
      : { review_state_projection: reviewStateProjection }),
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

function projectBuilderTaskStream(rawInput) {
  try {
    exactObjectWithOptional(rawInput, ['project_id', 'conversation'], [
      'context_status_projection',
      'provider_context_disclosure_status_projection',
      'draft_checkpoint_status_projection',
      'review_state_projection',
    ]);
    const projectId = safeProjectId(valueAt(rawInput, 'project_id'));
    const contextStatusProjection = safeOptionalContextStatusProjection(rawInput);
    const providerContextDisclosureStatusProjection =
      safeOptionalProviderContextDisclosureStatusProjection(rawInput);
    const draftCheckpointStatusProjection = safeOptionalDraftCheckpointStatusProjection(rawInput);
    const reviewStateProjection = safeOptionalReviewStateProjection(rawInput);
    const rawConversation = valueAt(rawInput, 'conversation');
    if (rawConversation === null) {
      if (reviewStateProjection !== undefined && reviewStateProjection !== null) fail();
      return boundResult(withOptionalStatusProjections({
        stream_version: BUILDER_TASK_STREAM_VERSION,
        project_id: projectId,
        conversation: null,
        authority: authority(),
      }, contextStatusProjection, providerContextDisclosureStatusProjection, draftCheckpointStatusProjection,
      reviewStateProjection, undefined));
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
    if (
      reviewStateProjection !== undefined
      && reviewStateProjection !== null
      && reviewStateProjection.draft_id !== latestUnreviewedDraftId(replay)
    ) fail();
    const visibleItems = [];
    const firstVisibleIndex = Math.max(0, events.length - MAX_PUBLIC_ITEMS);
    const progressStagesByRun = latestProgressStagesByRun(events);
    for (let index = firstVisibleIndex; index < events.length; index += 1) {
      const item = itemFromEvent(events[index], progressStagesByRun);
      if (item !== null) visibleItems.push(item);
    }
    const agentActivityProjection = projectBuilderAgentActivity({
      project_id: projectId,
      conversation_id: conversationId,
      head_sequence: replay.head.sequence,
      active_turn_id: replay.active_turn_id,
      latest_run: latestRunActivityFacts(replay),
      review_state_projection: reviewStateProjection ?? null,
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
          last_sequence: visibleItems.at(-1).sequence,
          has_earlier: firstVisibleIndex > 0,
        },
        items: visibleItems,
      },
      authority: authority(),
    }, contextStatusProjection, providerContextDisclosureStatusProjection, draftCheckpointStatusProjection,
    reviewStateProjection, agentActivityProjection));
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
