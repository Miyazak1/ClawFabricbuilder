import { describe, expect, it, vi } from 'vitest';

import {
  BuilderDesktopTaskStreamPortError,
  createBuilderDesktopTaskStreamPort,
} from './builderDesktopTaskStreamPort';

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const TASK_ADDRESS_ID = 'builder-task-address:123e4567-e89b-42d3-a456-426614174001';
const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const SNAPSHOT_DIGEST = 'a'.repeat(64);

function capturedListener(value: unknown): (event: unknown) => void {
  if (typeof value !== 'function') throw new Error('missing task stream listener');
  return value as (event: unknown) => void;
}

function absentWire(projectId = PROJECT_ID): unknown {
  return {
    stream_version: 'builder-task-stream-read-result.v1',
    project_id: projectId,
    conversation: null,
    authority: {
      conversation: 'sqlite_canonical_event_replay_or_absent',
      project_source: 'not_included',
      candidate_source: 'not_loaded',
      project_revision: 'not_inferred',
    },
  };
}

function agentTranscriptWire(
  items: readonly unknown[],
  headSequence: number,
  firstSequence = 1,
): unknown {
  return {
    stream_version: 'builder-task-stream-read-result.v1',
    scope_kind: 'agent_conversation',
    agent_id: AGENT_ID,
    project_id: null,
    conversation: {
      conversation_id: 'builder-agent-conversation:123e4567-e89b-42d3-a456-426614174003',
      created_at_ms: 1,
      head_sequence: headSequence,
      recorded_active_turn_id: null,
      source: 'sqlite_canonical_agent_conversation',
      window: {
        first_sequence: firstSequence,
        last_sequence: headSequence,
        has_earlier: firstSequence > 1,
      },
      items,
    },
    authority: {
      conversation: 'sqlite_canonical_agent_conversation',
      project_source: 'not_included',
      candidate_source: 'not_loaded',
      project_revision: 'not_inferred',
    },
  };
}

function transcriptItem(sequence: number, role: 'assistant' | 'user', text: string): unknown {
  const id = `123e4567-e89b-42d3-a456-${sequence.toString(16).padStart(12, '0')}`;
  return {
    item_kind: 'transcript_message',
    sequence,
    turn_id: `builder-turn:${id}`,
    message: {
      message_id: `builder-message:${id}`,
      text,
    },
    role,
    message_kind: role === 'user' ? 'submitted' : 'run_result',
    recovery_admission: 'sqlite_derived_public_transcript_only',
  };
}

describe('createBuilderDesktopTaskStreamPort', () => {
  it('forwards one read-only task stream request as fresh plain data', async () => {
    const read = vi.fn(async (request: unknown) => ({ request, stream: absentWire() }));
    const subscribeChanged = vi.fn(() => () => undefined);
    const port = createBuilderDesktopTaskStreamPort({ read, subscribeChanged });
    const request = { project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID };
    const result = await port.read(request);

    expect(read).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      task_address_id: TASK_ADDRESS_ID,
      cursor: {
        protocol_version: 'builder-task-stream-cursor.v1',
        snapshot_digest: null,
      },
    });
    expect(read.mock.calls[0][0]).not.toBe(request);
    expect(result).toEqual({
      request: {
        ...request,
        cursor: {
          protocol_version: 'builder-task-stream-cursor.v1',
          snapshot_digest: null,
        },
      },
      stream: absentWire(),
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen((result as { stream: object }).stream)).toBe(true);
    expect(subscribeChanged).not.toHaveBeenCalled();
  });

  it('reuses an unchanged cursor snapshot and merges an incremental public window', async () => {
    const firstItem = transcriptItem(1, 'user', 'Start the work.');
    const secondItem = transcriptItem(2, 'assistant', 'Work complete.');
    const fullSnapshot = agentTranscriptWire([firstItem], 1);
    const incrementalSnapshot = agentTranscriptWire([secondItem], 2);
    const read = vi.fn()
      .mockResolvedValueOnce({
        result_version: 'builder-task-stream-cursor-read-result.v1',
        result_kind: 'full',
        base_snapshot_digest: null,
        snapshot_digest: SNAPSHOT_DIGEST,
        snapshot: fullSnapshot,
      })
      .mockResolvedValueOnce({
        result_version: 'builder-task-stream-cursor-read-result.v1',
        result_kind: 'unchanged',
        base_snapshot_digest: SNAPSHOT_DIGEST,
        snapshot_digest: SNAPSHOT_DIGEST,
      })
      .mockResolvedValueOnce({
        result_version: 'builder-task-stream-cursor-read-result.v1',
        result_kind: 'incremental',
        base_snapshot_digest: SNAPSHOT_DIGEST,
        snapshot_digest: 'b'.repeat(64),
        snapshot: incrementalSnapshot,
      });
    const port = createBuilderDesktopTaskStreamPort({ read, subscribeChanged: () => () => undefined });

    const first = await port.read({ agent_id: AGENT_ID });
    const unchanged = await port.read({ agent_id: AGENT_ID });
    const incremental = await port.read({ agent_id: AGENT_ID }) as {
      conversation: { items: readonly unknown[]; head_sequence: number };
    };

    expect(unchanged).toBe(first);
    expect(incremental.conversation.items).toHaveLength(2);
    expect(incremental.conversation.items).toEqual([firstItem, secondItem]);
    expect(incremental.conversation.head_sequence).toBe(2);
    expect(read).toHaveBeenNthCalledWith(2, {
      agent_id: AGENT_ID,
      cursor: {
        protocol_version: 'builder-task-stream-cursor.v1',
        snapshot_digest: SNAPSHOT_DIGEST,
      },
    });
  });

  it('evicts entries before first_sequence when the incremental public window advances', async () => {
    const initialItems = Array.from({ length: 512 }, (_, index) => (
      transcriptItem(index + 1, index % 2 === 0 ? 'user' : 'assistant', `Message ${index + 1}`)
    ));
    const appended = transcriptItem(513, 'user', 'Message 513');
    const read = vi.fn()
      .mockResolvedValueOnce({
        result_version: 'builder-task-stream-cursor-read-result.v1',
        result_kind: 'full',
        base_snapshot_digest: null,
        snapshot_digest: SNAPSHOT_DIGEST,
        snapshot: agentTranscriptWire(initialItems, 512),
      })
      .mockResolvedValueOnce({
        result_version: 'builder-task-stream-cursor-read-result.v1',
        result_kind: 'incremental',
        base_snapshot_digest: SNAPSHOT_DIGEST,
        snapshot_digest: 'b'.repeat(64),
        snapshot: agentTranscriptWire([appended], 513, 2),
      });
    const port = createBuilderDesktopTaskStreamPort({
      read,
      subscribeChanged: () => () => undefined,
    });

    await port.read({ agent_id: AGENT_ID });
    const advanced = await port.read({ agent_id: AGENT_ID }) as {
      conversation: { items: readonly { sequence: number }[]; window: { first_sequence: number } };
    };

    expect(advanced.conversation.items).toHaveLength(512);
    expect(advanced.conversation.items[0]?.sequence).toBe(2);
    expect(advanced.conversation.items.at(-1)?.sequence).toBe(513);
    expect(advanced.conversation.window.first_sequence).toBe(2);
  });

  it('retries a legacy v1 read once when cursor negotiation is unavailable', async () => {
    const read = vi.fn()
      .mockRejectedValueOnce(new Error('old main'))
      .mockResolvedValueOnce(absentWire())
      .mockResolvedValueOnce(absentWire());
    const port = createBuilderDesktopTaskStreamPort({ read, subscribeChanged: () => () => undefined });

    await expect(port.read({ project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID }))
      .resolves.toEqual(absentWire());
    await expect(port.read({ project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID }))
      .resolves.toEqual(absentWire());

    expect(read).toHaveBeenCalledTimes(3);
    expect(read).toHaveBeenNthCalledWith(2, {
      project_id: PROJECT_ID,
      task_address_id: TASK_ADDRESS_ID,
    });
    expect(read).toHaveBeenNthCalledWith(3, {
      project_id: PROJECT_ID,
      task_address_id: TASK_ADDRESS_ID,
    });
  });

  it('subscribes to legacy and typed change events as fresh frozen data', () => {
    let captured: ((event: unknown) => void) | null = null;
    const unsubscribe = vi.fn();
    const listener = vi.fn();
    const subscribeChanged = vi.fn((next: (event: unknown) => void) => {
      captured = next;
      return unsubscribe;
    });
    const port = createBuilderDesktopTaskStreamPort({
      read: async () => absentWire(),
      subscribeChanged,
    });

    const dispose = port.subscribeChanged(listener);
    const emit = capturedListener(captured);
    emit({ event_version: 'builder-task-stream-changed.v1', project_id: PROJECT_ID });
    emit({
      event_version: 'builder-task-stream-changed.v2',
      project_id: PROJECT_ID,
      change_kind: 'live_only',
      cursor: 12,
    });
    emit({ event_version: 'builder-task-stream-changed.v1', project_id: 'bad' });
    emit({ event_version: 'builder-task-stream-changed.v1', project_id: PROJECT_ID, extra: true });
    dispose();
    dispose();

    expect(subscribeChanged).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenNthCalledWith(1, {
      event_version: 'builder-task-stream-changed.v1',
      project_id: PROJECT_ID,
    });
    expect(listener).toHaveBeenNthCalledWith(2, {
      event_version: 'builder-task-stream-changed.v2',
      project_id: PROJECT_ID,
      change_kind: 'live_only',
      cursor: 12,
    });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(Object.isFrozen(listener.mock.calls[0][0])).toBe(true);
    expect(Object.isFrozen(listener.mock.calls[1][0])).toBe(true);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it.each([
    null,
    {},
    { read: async (): Promise<unknown> => null },
    {
      read: async (): Promise<unknown> => null,
      subscribeChanged: async (): Promise<unknown> => null,
      saveDraft: async (): Promise<unknown> => null,
    },
    { open: async (): Promise<unknown> => null },
  ])('rejects malformed bridge %j', (bridge) => {
    expect(() => createBuilderDesktopTaskStreamPort(bridge)).toThrow(
      BuilderDesktopTaskStreamPortError,
    );
  });

  it('rejects malformed read requests before invoking the bridge', async () => {
    const read = vi.fn(async () => absentWire());
    const port = createBuilderDesktopTaskStreamPort({ read, subscribeChanged: () => () => undefined });

    for (const request of [
      null,
      { project_id: 'bad' },
      { project_id: PROJECT_ID, conversation_id: 'renderer-forged' },
    ]) {
      await expect(port.read(request as { project_id: string; task_address_id: string })).rejects.toBeInstanceOf(
        BuilderDesktopTaskStreamPortError,
      );
    }
    expect(read).not.toHaveBeenCalled();
  });

  it('redacts hostile bridge responses without invoking accessors', async () => {
    let getterCalls = 0;
    const port = createBuilderDesktopTaskStreamPort({
      read: async () => Object.defineProperty({}, 'secret', {
        enumerable: true,
        get() {
          getterCalls += 1;
          return 'never';
        },
      }),
      subscribeChanged: () => () => undefined,
    });

    await expect(port.read({ project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID })).rejects.toBeInstanceOf(
      BuilderDesktopTaskStreamPortError,
    );
    expect(getterCalls).toBe(0);
  });
});
