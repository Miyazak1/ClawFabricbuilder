// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  useBuilderProjectCatalogController,
  type UseBuilderProjectCatalogControllerResult,
} from './useBuilderProjectCatalogController';
import { PROJECT_ID, createCatalogWire } from '../../../test/builderV2Fixtures';

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

async function renderHook(listCurrent: () => Promise<unknown>) {
  let latest: UseBuilderProjectCatalogControllerResult | null = null;

  function Harness() {
    const result = useBuilderProjectCatalogController({ listCurrent });
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
    root.render(<Harness />);
  });
  return { current: () => latest!, root };
}

describe('useBuilderProjectCatalogController v2', () => {
  it('loads one verified catalog on mount', async () => {
    const listCurrent = vi.fn(async () => createCatalogWire());
    const hook = await renderHook(listCurrent);
    expect(listCurrent).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(hook.current().snapshot.status).toBe('ready');
    });
    expect(hook.current().snapshot).toMatchObject({
      status: 'ready',
      projects: [{ project_id: PROJECT_ID }],
    });
  });

  it('retains stale data after an explicit refresh failure', async () => {
    const listCurrent = vi.fn()
      .mockResolvedValueOnce(await createCatalogWire())
      .mockRejectedValueOnce(new Error('private'));
    const hook = await renderHook(listCurrent);
    await act(async () => {
      await hook.current().refresh();
    });
    expect(hook.current().snapshot).toMatchObject({
      status: 'stale',
      projects: [{ project_id: PROJECT_ID }],
    });
  });
});
