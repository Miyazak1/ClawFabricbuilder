import { describe, expect, it, vi } from 'vitest';

import {
  BuilderDesktopTaskStreamPortError,
  createBuilderDesktopTaskStreamPort,
} from './builderDesktopTaskStreamPort';

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';

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

describe('createBuilderDesktopTaskStreamPort', () => {
  it('forwards one read-only task stream request as fresh plain data', async () => {
    const read = vi.fn(async (request: unknown) => ({ request, stream: absentWire() }));
    const subscribeChanged = vi.fn(() => () => undefined);
    const port = createBuilderDesktopTaskStreamPort({ read, subscribeChanged });
    const request = { project_id: PROJECT_ID };
    const result = await port.read(request);

    expect(read).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID });
    expect(read.mock.calls[0][0]).not.toBe(request);
    expect(result).toEqual({ request, stream: absentWire() });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen((result as { stream: object }).stream)).toBe(true);
    expect(subscribeChanged).not.toHaveBeenCalled();
  });

  it('subscribes to project-id-only change events as fresh frozen data', () => {
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
    emit({ event_version: 'builder-task-stream-changed.v1', project_id: 'bad' });
    emit({ event_version: 'builder-task-stream-changed.v1', project_id: PROJECT_ID, extra: true });
    dispose();
    dispose();

    expect(subscribeChanged).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledExactlyOnceWith({
      event_version: 'builder-task-stream-changed.v1',
      project_id: PROJECT_ID,
    });
    expect(Object.isFrozen(listener.mock.calls[0][0])).toBe(true);
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
      await expect(port.read(request as { project_id: string })).rejects.toBeInstanceOf(
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

    await expect(port.read({ project_id: PROJECT_ID })).rejects.toBeInstanceOf(
      BuilderDesktopTaskStreamPortError,
    );
    expect(getterCalls).toBe(0);
  });
});
