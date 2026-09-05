import { describe, expect, it, vi } from 'vitest';

import {
  BuilderDesktopAgentTestBrowserPortError,
  createBuilderDesktopAgentTestBrowserPort,
} from './builderDesktopAgentTestBrowserPort';

const RUN_ID = 'builder-run:22222222-2222-4222-8222-222222222222';

describe('Builder desktop Agent Test Browser port', () => {
  it('passes only run-bound layout and accepts a bounded public receipt', async () => {
    const updateLayout = vi.fn(async (request) => ({
      result_version: 'builder-agent-test-browser-layout-result.v1',
      owner_run_id: request.owner_run_id,
      operation: 'layout_updated',
      visible: request.view_bounds !== null,
      applied_bounds: request.view_bounds,
    }));
    const port = createBuilderDesktopAgentTestBrowserPort({
      stop: vi.fn(),
      subscribeLifecycle: () => () => undefined,
      updateLayout,
    });
    const request = {
      owner_run_id: RUN_ID,
      view_bounds: { x: 900, y: 100, width: 360, height: 600 },
    };
    const result = await port.updateLayout(request);

    expect(updateLayout).toHaveBeenCalledExactlyOnceWith(request);
    expect(result).toEqual({
      result_version: 'builder-agent-test-browser-layout-result.v1',
      owner_run_id: RUN_ID,
      operation: 'layout_updated',
      visible: true,
      applied_bounds: request.view_bounds,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(result).not.toHaveProperty('session_id');
    expect(result).not.toHaveProperty('partition');
  });

  it('rejects private or inconsistent result drift', async () => {
    const port = createBuilderDesktopAgentTestBrowserPort({
      stop: vi.fn(),
      subscribeLifecycle: () => () => undefined,
      updateLayout: vi.fn(async () => ({
        result_version: 'builder-agent-test-browser-layout-result.v1',
        owner_run_id: RUN_ID,
        operation: 'not_active',
        visible: false,
        applied_bounds: null,
        partition: 'private',
      })),
    });
    await expect(port.updateLayout({ owner_run_id: RUN_ID, view_bounds: null }))
      .rejects.toBeInstanceOf(BuilderDesktopAgentTestBrowserPortError);
  });

  it('projects bounded lifecycle facts and unsubscribes through the bridge', () => {
    let publish: ((value: unknown) => void) | null = null;
    const unsubscribe = vi.fn();
    const port = createBuilderDesktopAgentTestBrowserPort({
      stop: vi.fn(),
      subscribeLifecycle(listener: (value: unknown) => void) {
        publish = listener;
        return unsubscribe;
      },
      updateLayout: vi.fn(),
    });
    const listener = vi.fn();
    const dispose = port.subscribeLifecycle(listener);
    expect(publish).not.toBeNull();
    (publish as unknown as (value: unknown) => void)({
      event_version: 'builder-agent-test-browser-lifecycle-event.v1',
      owner_run_id: RUN_ID,
      session_id: `builder-browser-session:${'3'.repeat(64)}`,
      lifecycle: 'opened',
    });
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      owner_run_id: RUN_ID,
      lifecycle: 'opened',
    }));
    dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
