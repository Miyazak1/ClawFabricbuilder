import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  BuilderProviderSettingsCurrent,
  BuilderProviderSettingsPort,
  BuilderProviderSettingsStatus,
  BuilderProviderSettingsWriteRequest,
} from '../infrastructure/builderDesktopProviderSettingsPort';
import type { BuilderProviderSettingsPanelValues } from '../presentation/BuilderProviderSettingsPanel';
import {
  useBuilderProviderSettingsController,
  type BuilderProviderSettingsControllerResult,
} from './useBuilderProviderSettingsController';

const CONFIG_DIGEST = `sha256:${'b'.repeat(64)}`;
const mounted: Array<{ container: HTMLDivElement; root: Root }> = [];

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

function flush(): Promise<void> {
  return act(async () => {
    await Promise.resolve();
  });
}

function current(overrides = {}): BuilderProviderSettingsCurrent {
  return Object.freeze({
    configured: true,
    config: Object.freeze({
      provider_id: 'builder-default',
      base_url: 'https://provider.example/v1',
      model: 'builder-model',
      timeout_ms: 30000,
      temperature: 0.2,
      max_tokens: 8192,
      config_digest: CONFIG_DIGEST,
    }),
    credential_status: 'stored',
    ...overrides,
  }) as BuilderProviderSettingsCurrent;
}

function providerStatus(overrides = {}): BuilderProviderSettingsStatus {
  return Object.freeze({
    configured: true,
    config_digest: CONFIG_DIGEST,
    credential_status: 'stored',
    ...overrides,
  }) as BuilderProviderSettingsStatus;
}

function values(overrides: Partial<BuilderProviderSettingsPanelValues> = {}): BuilderProviderSettingsPanelValues {
  return Object.freeze({
    baseUrl: 'https://provider.example/v1',
    model: 'new-model',
    apiKey: 'real-key-value',
    timeoutMs: '60000',
    temperature: '',
    maxTokens: '',
    ...overrides,
  });
}

function render(element: ReactNode): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ container, root });
  act(() => root.render(element));
  return container;
}

function harness(port: BuilderProviderSettingsPort) {
  let latest: BuilderProviderSettingsControllerResult | null = null;
  function Harness() {
    latest = useBuilderProviderSettingsController(port);
    return null;
  }
  render(<Harness />);
  return {
    get current() {
      if (latest === null) throw new Error('Missing controller result');
      return latest;
    },
  };
}

describe('useBuilderProviderSettingsController', () => {
  it('loads current provider settings without echoing an API key', async () => {
    const port: BuilderProviderSettingsPort = {
      readCurrent: vi.fn(async () => current()),
      replaceCurrent: vi.fn(async () => current()),
      status: vi.fn(async () => providerStatus()),
    };
    const result = harness(port);

    await flush();

    expect(result.current.status).toBe('saved');
    expect(result.current.values).toEqual({
      baseUrl: 'https://provider.example/v1',
      model: 'builder-model',
      apiKey: '',
      timeoutMs: '30000',
      temperature: '0.2',
      maxTokens: '8192',
    });
    expect(JSON.stringify(result.current)).not.toContain('real-key-value');
  });

  it('keeps unconfigured settings editable with defaults', async () => {
    const port: BuilderProviderSettingsPort = {
      readCurrent: vi.fn(async () => current({
        configured: false,
        config: null,
        credential_status: 'missing',
      })),
      replaceCurrent: vi.fn(async () => current()),
      status: vi.fn(async () => providerStatus({
        configured: false,
        config_digest: null,
        credential_status: 'missing',
      })),
    };
    const result = harness(port);

    await flush();

    expect(result.current.status).toBe('unconfigured');
    expect(result.current.values.apiKey).toBe('');
    expect(result.current.values.baseUrl).toBe('https://api.openai.com/v1');
  });

  it('writes credentials only through replaceCurrent and clears them after save', async () => {
    const replaceCurrent = vi.fn(async (request: BuilderProviderSettingsWriteRequest) => current({
      config: Object.freeze({
        provider_id: 'builder-default',
        base_url: request.config.base_url,
        model: request.config.model,
        timeout_ms: request.config.timeout_ms,
        temperature: request.config.temperature,
        max_tokens: request.config.max_tokens,
        config_digest: CONFIG_DIGEST,
      }),
    }));
    const port: BuilderProviderSettingsPort = {
      readCurrent: vi.fn(async () => current({
        configured: false,
        config: null,
        credential_status: 'missing',
      })),
      replaceCurrent,
      status: vi.fn(async () => providerStatus({
        configured: false,
        config_digest: null,
        credential_status: 'missing',
      })),
    };
    const result = harness(port);
    await flush();

    act(() => result.current.onValuesChange(values()));
    await act(async () => {
      await result.current.onSave();
    });

    expect(replaceCurrent).toHaveBeenCalledWith({
      config: {
        base_url: 'https://provider.example/v1',
        model: 'new-model',
        timeout_ms: 60000,
        temperature: null,
        max_tokens: null,
      },
      credential: 'real-key-value',
    });
    expect(result.current.status).toBe('saved');
    expect(result.current.values.apiKey).toBe('');
    expect(JSON.stringify(result.current)).not.toContain('real-key-value');
  });

  it('fails closed for invalid saves before calling the port', async () => {
    const replaceCurrent = vi.fn(async () => current());
    const port: BuilderProviderSettingsPort = {
      readCurrent: vi.fn(async () => current({
        configured: false,
        config: null,
        credential_status: 'missing',
      })),
      replaceCurrent,
      status: vi.fn(async () => providerStatus({
        configured: false,
        config_digest: null,
        credential_status: 'missing',
      })),
    };
    const result = harness(port);
    await flush();

    act(() => result.current.onValuesChange(values({ baseUrl: 'http://provider.example/v1' })));
    await act(async () => {
      await result.current.onSave();
    });

    expect(result.current.status).toBe('error');
    expect(replaceCurrent).not.toHaveBeenCalled();
  });

  it('redacts read and save failures', async () => {
    const privateMarker = 'real-key-value-private-marker';
    const port: BuilderProviderSettingsPort = {
      readCurrent: vi.fn(async () => { throw new Error(privateMarker); }),
      replaceCurrent: vi.fn(async () => { throw new Error(privateMarker); }),
      status: vi.fn(async () => { throw new Error(privateMarker); }),
    };
    const result = harness(port);

    await flush();
    expect(result.current.status).toBe('unavailable');
    expect(JSON.stringify(result.current)).not.toContain(privateMarker);

    act(() => result.current.onValuesChange(values()));
    await act(async () => {
      await result.current.onSave();
    });
    expect(result.current.status).toBe('error');
    expect(JSON.stringify(result.current)).not.toContain(privateMarker);
    expect(JSON.stringify(result.current)).not.toContain('real-key-value');
  });
});
