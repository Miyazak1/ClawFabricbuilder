import { describe, expect, it, vi } from 'vitest';

import {
  BuilderDesktopAgentWorkbenchPortError,
  createBuilderDesktopAgentWorkbenchPort,
} from './builderDesktopAgentWorkbenchPort';

const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174000';
const MESSAGE_ID = 'builder-message:223e4567-e89b-42d3-a456-426614174000';

describe('BuilderDesktopAgentWorkbenchPort', () => {
  it('forwards bounded reads, state updates, and verified invalidations', async () => {
    const bridgeListener = { current: null as ((event: unknown) => void) | null };
    const read = vi.fn(async (request) => ({ request }));
    const updateMessageState = vi.fn(async (request) => ({ request }));
    const createTaskProposal = vi.fn(async (request) => ({ request }));
    const decideTaskProposal = vi.fn(async (request) => ({ request }));
    const controlTask = vi.fn(async (request) => ({ request }));
    const unsubscribe = vi.fn();
    const port = createBuilderDesktopAgentWorkbenchPort({
      read,
      updateMessageState,
      createTaskProposal,
      decideTaskProposal,
      controlTask,
      subscribeChanged(listener: (event: unknown) => void) {
        bridgeListener.current = listener;
        return unsubscribe;
      },
    });
    const request = { agent_id: AGENT_ID, after_cursor: null, limit: 200 } as const;
    expect(await port.read(request)).toEqual({ request });
    await port.updateMessageState({
      agent_id: AGENT_ID,
      message_id: MESSAGE_ID,
      operation: 'mark_read',
    });
    await port.controlTask({
      agent_id: AGENT_ID,
      project_id: 'builder-project:323e4567-e89b-42d3-a456-426614174000',
      task_address_id: 'builder-task-address:423e4567-e89b-42d3-a456-426614174000',
      operation: 'cancel_task',
    });
    expect(controlTask).toHaveBeenCalledOnce();
    const listener = vi.fn();
    const stop = port.subscribeChanged(listener);
    bridgeListener.current?.({ event_version: 'builder-agent-workbench-changed.v1', agent_id: AGENT_ID });
    bridgeListener.current?.({ event_version: 'bad', agent_id: AGENT_ID, payload: {} });
    expect(listener).toHaveBeenCalledOnce();
    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('rejects extra bridge methods and malformed ids', async () => {
    expect(() => createBuilderDesktopAgentWorkbenchPort({
      read: vi.fn(),
      updateMessageState: vi.fn(),
      createTaskProposal: vi.fn(),
      decideTaskProposal: vi.fn(),
      controlTask: vi.fn(),
      subscribeChanged: vi.fn(),
      execute: vi.fn(),
    })).toThrow(BuilderDesktopAgentWorkbenchPortError);
    const port = createBuilderDesktopAgentWorkbenchPort({
      read: vi.fn(),
      updateMessageState: vi.fn(),
      createTaskProposal: vi.fn(),
      decideTaskProposal: vi.fn(),
      controlTask: vi.fn(),
      subscribeChanged: () => () => undefined,
    });
    await expect(port.read({ agent_id: 'bad', after_cursor: null, limit: 200 }))
      .rejects.toThrow(BuilderDesktopAgentWorkbenchPortError);
  });
});
