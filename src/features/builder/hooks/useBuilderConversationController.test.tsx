// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  useBuilderConversationController,
  type UseBuilderConversationControllerResult,
} from './useBuilderConversationController';
import type { BuilderTaskStreamPort } from '../application/builderPorts';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

function absentWire(): unknown {
  return {
    stream_version: 'builder-task-stream-read-result.v1',
    project_id: PROJECT_ID,
    conversation: null,
    authority: {
      conversation: 'sqlite_canonical_event_replay_or_absent',
      project_source: 'not_included',
      candidate_source: 'not_loaded',
      project_revision: 'not_inferred',
    },
  };
}

async function waitFor(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }
  throw lastError;
}

function renderHook(port: BuilderTaskStreamPort, projectId: string | null = PROJECT_ID) {
  let latest!: UseBuilderConversationControllerResult;
  function Harness() {
    latest = useBuilderConversationController(port, projectId);
    return null;
  }
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  act(() => root.render(<Harness />));
  return () => latest;
}

describe('useBuilderConversationController', () => {
  it('loads the selected project stream on mount', async () => {
    const read = vi.fn(async () => absentWire());
    const latest = renderHook({ read });

    await waitFor(() => {
      expect(latest().snapshot.status).toBe('absent');
    });
    expect(read).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID });
    expect(latest().snapshot.conversation?.state).toBe('absent');
  });

  it('supports manual refresh without optimistic messages', async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    const read = vi.fn(() => new Promise<unknown>((next) => {
      resolvers.push(next);
    }));
    const latest = renderHook({ read });

    await waitFor(() => {
      expect(latest().snapshot.status).toBe('loading');
    });
    expect(latest().snapshot.conversation).toBeNull();
    resolvers.shift()?.(absentWire());
    await waitFor(() => {
      expect(latest().snapshot.status).toBe('absent');
    });

    let refresh!: Promise<unknown>;
    act(() => {
      refresh = latest().refresh();
    });
    await waitFor(() => {
      expect(latest().snapshot.status).toBe('refreshing');
    });
    resolvers.shift()?.(absentWire());
    await act(async () => {
      await refresh;
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(latest().snapshot.status).toBe('absent');
  });
});
