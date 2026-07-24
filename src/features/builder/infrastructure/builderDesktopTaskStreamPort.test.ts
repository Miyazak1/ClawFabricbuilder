import { describe, expect, it, vi } from 'vitest';

import {
  BuilderDesktopTaskStreamPortError,
  createBuilderDesktopTaskStreamPort,
} from './builderDesktopTaskStreamPort';

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';

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
    const port = createBuilderDesktopTaskStreamPort({ read });
    const request = { project_id: PROJECT_ID };
    const result = await port.read(request);

    expect(read).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID });
    expect(read.mock.calls[0][0]).not.toBe(request);
    expect(result).toEqual({ request, stream: absentWire() });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen((result as { stream: object }).stream)).toBe(true);
  });

  it.each([
    null,
    {},
    { read: async (): Promise<unknown> => null, saveDraft: async (): Promise<unknown> => null },
    { open: async (): Promise<unknown> => null },
  ])('rejects malformed bridge %j', (bridge) => {
    expect(() => createBuilderDesktopTaskStreamPort(bridge)).toThrow(
      BuilderDesktopTaskStreamPortError,
    );
  });

  it('rejects malformed read requests before invoking the bridge', async () => {
    const read = vi.fn(async () => absentWire());
    const port = createBuilderDesktopTaskStreamPort({ read });

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
    });

    await expect(port.read({ project_id: PROJECT_ID })).rejects.toBeInstanceOf(
      BuilderDesktopTaskStreamPortError,
    );
    expect(getterCalls).toBe(0);
  });
});
