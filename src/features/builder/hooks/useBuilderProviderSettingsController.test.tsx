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

function deferred<T>() {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, reject, resolve };
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
    expect(result.current.canSave).toBe(false);
    expect(result.current.fieldErrors).toEqual({
      baseUrl: null,
      model: null,
      apiKey: null,
      timeoutMs: null,
      temperature: null,
      maxTokens: null,
    });
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
    expect(result.current.values.baseUrl).toBe('');
    expect(result.current.values.model).toBe('');
  });

  it('keeps user edits when the initial settings read settles later', async () => {
    const initialRead = deferred<BuilderProviderSettingsCurrent>();
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
      readCurrent: vi.fn(() => initialRead.promise),
      replaceCurrent,
      status: vi.fn(async () => providerStatus()),
    };
    const result = harness(port);
    const edited = values({
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      apiKey: 'deepseek-key-value',
    });

    act(() => result.current.onValuesChange(edited));
    await act(async () => {
      initialRead.resolve(current());
      await initialRead.promise;
    });

    expect(result.current.status).toBe('unconfigured');
    expect(result.current.canSave).toBe(true);
    expect(result.current.values).toEqual(edited);
    expect(result.current.values.model).not.toBe('builder-model');

    await act(async () => {
      await result.current.onSave();
    });
    expect(replaceCurrent).toHaveBeenCalledWith({
      config: {
        base_url: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
        timeout_ms: 60000,
        temperature: null,
        max_tokens: null,
      },
      credential: 'deepseek-key-value',
    });
    expect(result.current.status).toBe('saved');
    expect(result.current.values.apiKey).toBe('');
  });

  it('ignores a late initial read failure after the user begins editing', async () => {
    const initialRead = deferred<BuilderProviderSettingsCurrent>();
    const port: BuilderProviderSettingsPort = {
      readCurrent: vi.fn(() => initialRead.promise),
      replaceCurrent: vi.fn(async () => current()),
      status: vi.fn(async () => providerStatus()),
    };
    const result = harness(port);
    const edited = values({ baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' });

    act(() => result.current.onValuesChange(edited));
    await act(async () => {
      initialRead.reject(new Error('private read marker'));
      await initialRead.promise.catch(() => undefined);
    });

    expect(result.current.status).toBe('unconfigured');
    expect(result.current.values).toEqual(edited);
    expect(JSON.stringify(result.current)).not.toContain('private read marker');
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

    act(() => result.current.onValuesChange(values({
      baseUrl: 'http://127.0.0.1:11434/v1/',
    })));
    expect(result.current.canSave).toBe(true);
    await act(async () => {
      await result.current.onSave();
    });

    expect(replaceCurrent).toHaveBeenCalledWith({
      config: {
        base_url: 'http://127.0.0.1:11434/v1',
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
    expect(result.current.fieldErrors.baseUrl).toBe('Enter an HTTPS address or a local provider address.');
    await act(async () => {
      await result.current.onSave();
    });

    expect(result.current.status).toBe('error');
    expect(replaceCurrent).not.toHaveBeenCalled();
  });

  it('reports fixed field errors without reflecting invalid values', async () => {
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

    act(() => result.current.onValuesChange(values({
      apiKey: '',
      baseUrl: 'http://remote.example/private-marker',
      maxTokens: '100',
      model: ' ',
      temperature: '3',
      timeoutMs: '999',
    })));

    expect(result.current.fieldErrors).toEqual({
      apiKey: 'Enter an API key.',
      baseUrl: 'Enter an HTTPS address or a local provider address.',
      maxTokens: 'Use a whole number from 256 to 65536, or leave it blank.',
      model: 'Enter a model name.',
      temperature: 'Use a number from 0 to 2, or leave it blank.',
      timeoutMs: 'Use a whole number from 1000 to 120000.',
    });
    expect(JSON.stringify(result.current.fieldErrors)).not.toContain('private-marker');
  });

  it('reports fixed text boundary errors for model and API key before saving', async () => {
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

    act(() => result.current.onValuesChange(values({
      apiKey: `key${String.fromCharCode(0xd800)}`,
      model: 'm'.repeat(201),
    })));
    await act(async () => {
      await result.current.onSave();
    });

    expect(result.current.canSave).toBe(false);
    expect(result.current.fieldErrors.model).toBe('Enter a model name.');
    expect(result.current.fieldErrors.apiKey).toBe('Enter an API key.');
    expect(JSON.stringify(result.current)).not.toContain(String.fromCharCode(0xd800));
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
