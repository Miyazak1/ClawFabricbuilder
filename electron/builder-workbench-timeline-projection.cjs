'use strict';

const { types: utilTypes } = require('node:util');

const PROJECTION_VERSION = 'builder-agent-workbench-projection.v2';
const BUILTIN_TYPES = Object.freeze({
  'builder.chat.user_message.v1': Object.freeze({ family: 'conversation', body_kind: 'plain_text' }),
  'builder.chat.agent_message.v1': Object.freeze({ family: 'conversation', body_kind: 'markdown' }),
  'builder.task.proposal.v1': Object.freeze({ family: 'proposal', body_kind: 'markdown' }),
  'builder.task.status.v1': Object.freeze({ family: 'status', body_kind: 'plain_text' }),
  'builder.task.result.v1': Object.freeze({ family: 'result', body_kind: 'markdown' }),
  'builder.system.notice.v1': Object.freeze({ family: 'system', body_kind: 'plain_text' }),
});

class BuilderWorkbenchTimelineProjectionError extends Error {
  constructor() {
    super('Builder Workbench timeline could not be projected.');
    this.name = 'BuilderWorkbenchTimelineProjectionError';
    this.code = 'builder_workbench_timeline_projection_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderWorkbenchTimelineProjectionError();
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function stableMethod(value, key) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) fail();
  let cursor = value;
  while (cursor !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(cursor, key);
    if (descriptor) {
      if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') fail();
      return descriptor.value;
    }
    cursor = Object.getPrototypeOf(cursor);
  }
  fail();
}

function sourceLabel(sourceKind) {
  const labels = {
    owner: 'You',
    local_agent: 'Agent',
    project_task: 'Task',
    remote_agent: 'External Agent',
    channel: 'Channel',
    forum: 'Forum',
    collaboration: 'Collaboration',
    plugin: 'Plugin',
  };
  return labels[sourceKind] ?? 'Message';
}

function trustLabel(provenance) {
  if (provenance === 'human' || provenance === 'local_system') return 'local';
  if (provenance === 'verified_remote') return 'verified';
  if (provenance === 'imported') return 'external';
  return 'untrusted';
}

function bodyText(message, builtin) {
  if (builtin === undefined) return message.content.fallback_text;
  const payload = message.content.payload;
  if (
    payload !== null
    && typeof payload === 'object'
    && !Array.isArray(payload)
    && typeof payload.text === 'string'
    && payload.text.trim().length > 0
  ) return payload.text;
  return message.content.fallback_text;
}

function createBuilderWorkbenchTimelineProjection({
  message_store: messageStore,
  proposal_store: proposalStore = null,
  task_monitor_projection: taskMonitorProjection,
}) {
  const readTimeline = stableMethod(messageStore, 'read_timeline');
  const readInboxCounts = stableMethod(messageStore, 'read_inbox_counts');
  const readProposalByAction = proposalStore === null
    ? null
    : stableMethod(proposalStore, 'read_by_action_ref');
  const readTaskMonitor = stableMethod(taskMonitorProjection, 'read_monitor');
  return freezeDeep({
    projection_version: PROJECTION_VERSION,
    read_workbench(request) {
      const timeline = Reflect.apply(readTimeline, messageStore, [request]);
      const counts = Reflect.apply(readInboxCounts, messageStore, [{ agent_id: request.agent_id }]);
      const taskMonitor = Reflect.apply(readTaskMonitor, taskMonitorProjection, [{
        agent_id: request.agent_id,
        cache_only: true,
      }]);
      const items = timeline.items.map((entry) => {
        const { message, state } = entry;
        const builtin = BUILTIN_TYPES[message.content.content_type];
        const actions = [];
        if (readProposalByAction !== null) {
          for (const actionId of message.proposed_action_refs) {
            const bundle = Reflect.apply(readProposalByAction, proposalStore, [{ action_id: actionId }]);
            if (bundle.status !== 'ready' || bundle.proposal.agent_id !== request.agent_id) continue;
            const materialization = bundle.materialization;
            const status = materialization !== null
              ? 'materialized'
              : (bundle.decision?.decision === 'reject' ? 'rejected' : 'pending');
            actions.push(freezeDeep({
              action_version: 'builder-workbench-task-proposal-action.v1',
              action_id: actionId,
              proposal_id: bundle.proposal.proposal_id,
              status,
              objective: bundle.proposal.objective,
              requested_outcome: bundle.proposal.requested_outcome,
              execution_mode: bundle.proposal.execution_mode,
              project_id: materialization?.project_id ?? bundle.decision?.project_id ?? null,
              task_address_id: materialization?.task_address_id ?? null,
              conversation_id: materialization?.conversation_id ?? null,
              operations: status === 'pending'
                ? ['approve_existing_project', 'reject']
                : (status === 'materialized' ? ['open_task'] : []),
            }));
          }
        }
        return freezeDeep({
          message_id: message.message_id,
          thread_id: message.address.thread_id,
          presentation_family: builtin?.family ?? 'generic',
          content_type: message.content.content_type,
          source_label: sourceLabel(message.source.source_kind),
          fallback_text: message.content.fallback_text,
          presentation: {
            presentation_version: 'builder-workbench-declarative-presentation.v1',
            body_kind: builtin?.body_kind ?? 'plain_text',
            body_text: bodyText(message, builtin),
            metadata: [],
          },
          attention: message.delivery.attention,
          trust_label: trustLabel(message.trust.provenance),
          state: {
            unread: state.read_at_ms === null,
            acknowledged: state.acknowledged_at_ms !== null,
            archived: state.archived_at_ms !== null,
          },
          actions,
          task_ref: message.address.project_id !== null && message.address.task_address_id !== null
            ? {
              project_id: message.address.project_id,
              task_address_id: message.address.task_address_id,
              operation: 'open_task',
            }
            : null,
          created_at_ms: message.created_at_ms,
        });
      });
      return freezeDeep({
        projection_version: PROJECTION_VERSION,
        agent_id: timeline.agent_id,
        stream: {
          items,
          after_cursor: timeline.after_cursor,
          next_cursor: timeline.next_cursor,
          has_more: timeline.has_more,
        },
        task_monitor: taskMonitor,
        inbox: {
          unread_count: counts.unread_count,
          action_required_count: counts.action_required_count,
          mention_count: 0,
          active_task_count: taskMonitor.counts.active,
        },
        authority: {
          canonical_messages: 'main_owned_workbench_message_store',
          user_state: 'main_owned_workbench_message_state_store',
          task_state: 'sqlite_canonical_event_replay_plus_task_attention',
          renderer_authority: 'selection_and_bounded_state_requests_only',
          plugin_payload_exposure: 'not_exposed',
          permission_grant: false,
          provider_dispatch: false,
          source_read: false,
          source_write: false,
        },
      });
    },
  });
}

module.exports = Object.freeze({
  PROJECTION_VERSION,
  BuilderWorkbenchTimelineProjectionError,
  createBuilderWorkbenchTimelineProjection,
});
