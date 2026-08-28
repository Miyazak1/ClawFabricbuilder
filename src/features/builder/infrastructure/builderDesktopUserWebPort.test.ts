import { describe, expect, it, vi } from 'vitest';

import {
  BuilderDesktopUserWebPortError,
  createBuilderDesktopUserWebPort,
} from './builderDesktopUserWebPort';

function status(overrides: Record<string, unknown> = {}) {
  return {
    status_version: 'builder-user-web-status.v1',
    status: 'ready',
    current_url: 'https://example.com/',
    can_go_back: false,
    can_go_forward: false,
    can_reload: true,
    can_stop: true,
    navigation_block_count: 0,
    permission_block_count: 0,
    download_block_count: 0,
    window_open_block_count: 0,
    message: 'Page ready.',
    updated_at_ms: 10,
    authority: {
      user_web_authority: 'builder_main_user_web_v1',
      renderer_authority: 'explicit_navigation_and_layout_only',
      provider_authority: 'none',
      provider_observation: false,
      command_execution: false,
      dependency_installation: false,
      project_write: false,
      downloads: 'blocked_pending_separate_admission',
      permissions: 'denied',
      popup_windows: 'blocked',
      partition_visibility: 'main_private',
    },
    ...overrides,
  };
}

function bridge(result: unknown = status()) {
  return {
    navigate: vi.fn(async () => result),
    goBack: vi.fn(async () => result),
    goForward: vi.fn(async () => result),
    reload: vi.fn(async () => result),
    stop: vi.fn(async () => result),
    readStatus: vi.fn(async () => result),
    updateLayout: vi.fn(async () => result),
  };
}

describe('Builder desktop User Web port', () => {
  it('accepts the bounded Main projection without exposing a partition', async () => {
    const rawBridge = bridge();
    const port = createBuilderDesktopUserWebPort(rawBridge);
    const result = await port.navigate({ url: 'https://example.com/' });

    expect(rawBridge.navigate).toHaveBeenCalledExactlyOnceWith({ url: 'https://example.com/' });
    expect(result.status).toBe('ready');
    expect(result.authority.provider_observation).toBe(false);
    expect(result).not.toHaveProperty('partition');
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('rejects projection drift and private partition leakage', async () => {
    const port = createBuilderDesktopUserWebPort(bridge(status({ partition: 'private' })));
    await expect(port.readStatus()).rejects.toBeInstanceOf(BuilderDesktopUserWebPortError);
  });
});
