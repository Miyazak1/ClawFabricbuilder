// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  useBuilderProjectHistoryController,
  type UseBuilderProjectHistoryControllerResult,
} from './useBuilderProjectHistoryController';
import { BUILDER_PROJECT_HISTORY_LIMIT } from '../domain/builderProjectHistory';
import { PROJECT_ID, createHistoryWire } from '../../../test/builderV2Fixtures';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

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

async function renderHook(
  listHistory: (request: Readonly<{ project_id: string; limit: number }>) => Promise<unknown>,
  projectId?: string | null,
) {
  let latest: UseBuilderProjectHistoryControllerResult | null = null;

  function Harness({ selectedProjectId }: Readonly<{ selectedProjectId?: string | null }>) {
    const result = useBuilderProjectHistoryController({ listHistory }, selectedProjectId);
    useEffect(() => {
      latest = result;
    }, [result]);
    return null;
  }

  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => {
    root.render(<Harness selectedProjectId={projectId} />);
  });
  return {
    current: () => latest!,
    async selectProject(selectedProjectId?: string | null) {
      await act(async () => {
        root.render(<Harness selectedProjectId={selectedProjectId} />);
      });
    },
  };
}

describe('useBuilderProjectHistoryController', () => {
  it('loads verified project history for the selected project', async () => {
    const listHistory = vi.fn(async () => createHistoryWire());
    const hook = await renderHook(listHistory, PROJECT_ID);

    await waitFor(() => {
      expect(hook.current().snapshot.status).toBe('ready');
    });
    expect(listHistory).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      limit: BUILDER_PROJECT_HISTORY_LIMIT,
    });
    expect(hook.current().snapshot.history?.revisions[0]).toMatchObject({
      revision_number: 2,
      is_current: true,
    });
  });

  it('clears when no project is selected and refreshes stale data explicitly', async () => {
    const listHistory = vi.fn()
      .mockResolvedValueOnce(await createHistoryWire())
      .mockRejectedValueOnce(new Error('private'));
    const hook = await renderHook(listHistory, PROJECT_ID);
    await waitFor(() => {
      expect(hook.current().snapshot.status).toBe('ready');
    });

    await act(async () => {
      await hook.current().refresh();
    });
    expect(hook.current().snapshot).toMatchObject({
      status: 'stale',
      history: { project_id: PROJECT_ID },
    });

    await hook.selectProject(null);
    expect(hook.current().snapshot).toMatchObject({
      status: 'idle',
      project_id: null,
      history: null,
    });
  });
});
