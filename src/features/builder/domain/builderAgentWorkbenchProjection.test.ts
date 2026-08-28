import { describe, expect, it } from 'vitest';

import {
  BuilderAgentWorkbenchProjectionError,
  sanitizeBuilderAgentWorkbenchProjection,
} from './builderAgentWorkbenchProjection';

const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174000';

function wire(contentType = 'plugin.forum.update.v1') {
  return {
    projection_version: 'builder-agent-workbench-projection.v2',
    agent_id: AGENT_ID,
    stream: {
      items: [{
        message_id: 'builder-message:223e4567-e89b-42d3-a456-426614174000',
        thread_id: null,
        presentation_family: 'generic',
        content_type: contentType,
        source_label: 'Forum',
        fallback_text: 'A safe fallback.',
        presentation: {
          presentation_version: 'builder-workbench-declarative-presentation.v1',
          body_kind: 'plain_text',
          body_text: 'A safe fallback.',
          metadata: [],
        },
        attention: 'normal',
        trust_label: 'external',
        state: { unread: true, acknowledged: false, archived: false },
        actions: [],
        task_ref: null,
        created_at_ms: 12,
      }],
      after_cursor: null,
      next_cursor: 'builder-workbench-cursor:1',
      has_more: false,
    },
    task_monitor: {
      projection_version: 'builder-workbench-task-monitor.v2',
      agent_id: AGENT_ID,
      tasks: [],
      counts: { active: 0, attention: 0, recent: 0 },
      authority: {
        task_identity: 'main_owned_session_task_address_store',
        task_state: 'sqlite_canonical_event_replay_plus_task_attention',
        renderer_authority: 'selection_only',
        provider_dispatch: false,
        permission_grant: false,
        source_read: false,
        source_write: false,
      },
    },
    inbox: { unread_count: 1, action_required_count: 0, mention_count: 0, active_task_count: 0 },
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
  };
}

describe('BuilderAgentWorkbenchProjection', () => {
  it('accepts safe generic fallbacks without exposing plugin payloads', () => {
    const projection = sanitizeBuilderAgentWorkbenchProjection(wire());
    expect(projection.stream.items[0].presentation.body_text).toBe('A safe fallback.');
    expect(projection.authority.plugin_payload_exposure).toBe('not_exposed');
    expect(Object.isFrozen(projection)).toBe(true);
  });

  it('accepts only declarative task-proposal actions without execution authority', () => {
    const value = wire('builder.task.proposal.v1');
    (value.stream.items[0].actions as unknown[]).push({
      action_version: 'builder-workbench-task-proposal-action.v1',
      action_id: `builder-workbench-action:${'a'.repeat(64)}`,
      proposal_id: 'builder-task-proposal:323e4567-e89b-42d3-a456-426614174000',
      status: 'pending',
      objective: 'Build a timer.',
      requested_outcome: 'build',
      execution_mode: 'foreground',
      project_id: null,
      task_address_id: null,
      conversation_id: null,
      operations: ['approve_existing_project', 'reject'],
    });
    const projection = sanitizeBuilderAgentWorkbenchProjection(value);
    expect(projection.stream.items[0].actions[0]).toMatchObject({
      status: 'pending',
      project_id: null,
      operations: ['approve_existing_project', 'reject'],
    });
    expect(projection.authority.provider_dispatch).toBe(false);
  });

  it.each([
    { ...wire(), raw_plugin_payload: { html: '<script />' } },
    { ...wire(), authority: { ...wire().authority, permission_grant: true } },
    { ...wire(), stream: { ...wire().stream, next_cursor: 'cursor:1' } },
    { ...wire(), stream: { ...wire().stream, items: [{ ...wire().stream.items[0], actions: [{ type: 'execute' }] }] } },
  ])('fails closed on authority expansion or non-declarative data', (value) => {
    expect(() => sanitizeBuilderAgentWorkbenchProjection(value)).toThrow(
      BuilderAgentWorkbenchProjectionError,
    );
  });
});
