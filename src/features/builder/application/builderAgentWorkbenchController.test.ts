import { describe, expect, it, vi } from 'vitest';

import { createBuilderAgentWorkbenchController } from './builderAgentWorkbenchController';
import type { BuilderAgentWorkbenchPort, BuilderWorkbenchChangedEvent } from './builderPorts';

const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174000';
const MESSAGE_ID = 'builder-message:223e4567-e89b-42d3-a456-426614174000';

function projection(text: string) {
  return {
    projection_version: 'builder-agent-workbench-projection.v2',
    agent_id: AGENT_ID,
    stream: {
      items: [{
        message_id: MESSAGE_ID,
        thread_id: 'builder-workbench-thread:123e4567-e89b-42d3-a456-426614174000',
        presentation_family: 'conversation',
        content_type: 'builder.chat.agent_message.v1',
        source_label: 'Agent',
        fallback_text: text,
        presentation: {
          presentation_version: 'builder-workbench-declarative-presentation.v1',
          body_kind: 'markdown',
          body_text: text,
          metadata: [],
        },
        attention: 'normal',
        trust_label: 'local',
        state: { unread: true, acknowledged: false, archived: false },
        actions: [],
        task_ref: null,
        created_at_ms: 1,
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

describe('BuilderAgentWorkbenchController', () => {
  it('retains the ready projection while refreshing after invalidation', async () => {
    const changed = { current: null as ((event: BuilderWorkbenchChangedEvent) => void) | null };
    const resolveSecond = { current: null as ((value: unknown) => void) | null };
    const read = vi.fn()
      .mockResolvedValueOnce(projection('first'))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond.current = resolve; }));
    const port: BuilderAgentWorkbenchPort = {
      read,
      updateMessageState: vi.fn(),
      createTaskProposal: vi.fn(),
      decideTaskProposal: vi.fn(),
      decideAgentPlan: vi.fn(),
      controlTask: vi.fn(),
      subscribeChanged(listener) {
        changed.current = listener;
        return () => { changed.current = null; };
      },
    };
    const controller = createBuilderAgentWorkbenchController(port, AGENT_ID);
    await controller.load();
    expect(controller.getSnapshot().status).toBe('ready');
    changed.current?.({ event_version: 'builder-agent-workbench-changed.v1', agent_id: AGENT_ID });
    expect(controller.getSnapshot().status).toBe('refreshing');
    expect(controller.getSnapshot().projection?.stream.items[0].presentation.body_text).toBe('first');
    resolveSecond.current?.(projection('second'));
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getSnapshot().projection?.stream.items[0].presentation.body_text).toBe('second');
    controller.dispose();
  });

  it('updates only bounded state and then refreshes', async () => {
    const updateMessageState = vi.fn().mockResolvedValue({ operation: 'message_state_updated' });
    const port: BuilderAgentWorkbenchPort = {
      read: vi.fn().mockResolvedValue(projection('message')),
      updateMessageState,
      createTaskProposal: vi.fn(),
      decideTaskProposal: vi.fn(),
      decideAgentPlan: vi.fn(),
      controlTask: vi.fn(),
      subscribeChanged: () => () => undefined,
    };
    const controller = createBuilderAgentWorkbenchController(port, AGENT_ID);
    await controller.load();
    await controller.updateMessageState(MESSAGE_ID, 'mark_read');
    expect(updateMessageState).toHaveBeenCalledWith({
      agent_id: AGENT_ID,
      message_id: MESSAGE_ID,
      operation: 'mark_read',
    });
    controller.dispose();
  });

  it('binds task control to the selected agent and refreshes the monitor', async () => {
    const controlTask = vi.fn().mockResolvedValue({ operation: 'cancel_requested' });
    const port: BuilderAgentWorkbenchPort = {
      read: vi.fn().mockResolvedValue(projection('message')),
      updateMessageState: vi.fn(),
      createTaskProposal: vi.fn(),
      decideTaskProposal: vi.fn(),
      decideAgentPlan: vi.fn(),
      controlTask,
      subscribeChanged: () => () => undefined,
    };
    const controller = createBuilderAgentWorkbenchController(port, AGENT_ID);
    await controller.load();
    await controller.controlTask({
      project_id: 'builder-project:323e4567-e89b-42d3-a456-426614174000',
      task_address_id: 'builder-task-address:423e4567-e89b-42d3-a456-426614174000',
      operation: 'cancel_task',
    });
    expect(controlTask).toHaveBeenCalledWith({
      agent_id: AGENT_ID,
      project_id: 'builder-project:323e4567-e89b-42d3-a456-426614174000',
      task_address_id: 'builder-task-address:423e4567-e89b-42d3-a456-426614174000',
      operation: 'cancel_task',
    });
    controller.dispose();
  });
});
