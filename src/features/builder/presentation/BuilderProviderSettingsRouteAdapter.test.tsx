import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { BuilderProviderSettingsRouteAdapter } from './BuilderProviderSettingsRouteAdapter';

const CONFIG_DIGEST = `sha256:${'c'.repeat(64)}`;
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

function render(element: ReactNode): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ container, root });
  act(() => root.render(element));
  return container;
}

function flush(): Promise<void> {
  return act(async () => {
    await Promise.resolve();
  });
}

function current(overrides = {}) {
  return {
    result_version: 'builder-provider-settings-ipc-adapter.v1',
    operation: 'current_loaded',
    configured: true,
    config: {
      provider_id: 'builder-default',
      base_url: 'https://provider.example/v1',
      model: 'builder-model',
      timeout_ms: 30000,
      temperature: 0.2,
      max_tokens: 8192,
      config_digest: CONFIG_DIGEST,
    },
    credential_status: 'stored',
    ...overrides,
  };
}

function status(overrides = {}) {
  return {
    status_version: 'builder-provider-settings-status.v1',
    configured: true,
    config_digest: CONFIG_DIGEST,
    credential_status: 'stored',
    ...overrides,
  };
}

function input(container: HTMLElement, id: string): HTMLInputElement {
  const element = container.querySelector<HTMLInputElement>(`#${id}`);
  if (!element) throw new Error(`Missing input: ${id}`);
  return element;
}

function buttonWithText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find((candidate) => candidate.textContent?.includes(text));
  if (!button) throw new Error(`Missing button: ${text}`);
  return button;
}

function changeInput(element: HTMLInputElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setter) throw new Error('Missing input value setter');
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('BuilderProviderSettingsRouteAdapter', () => {
  it('loads provider settings through the dedicated bridge without exposing a credential', async () => {
    const bridge = {
      readCurrent: vi.fn(async () => current()),
      replaceCurrent: vi.fn(async () => current({ operation: 'current_replaced' })),
      status: vi.fn(async () => status()),
    };

    const container = render(<BuilderProviderSettingsRouteAdapter providerSettingsBridge={bridge} />);
    await flush();

    expect(container.textContent).toContain('Provider settings saved.');
    expect(input(container, 'builder-provider-base-url').value).toBe('https://provider.example/v1');
    expect(input(container, 'builder-provider-model').value).toBe('builder-model');
    expect(input(container, 'builder-provider-api-key').value).toBe('');
    expect(container.textContent).not.toContain('real-key-value');
    expect(bridge.readCurrent).toHaveBeenCalledWith();
    expect(bridge.status).not.toHaveBeenCalled();
  });

  it('saves a new API key once and clears it from the route-local form state', async () => {
    const replaceCurrent = vi.fn(async (request: unknown) => {
      void request;
      return current({
        operation: 'current_replaced',
        config: {
          provider_id: 'builder-default',
          base_url: 'https://provider.example/v1',
          model: 'new-model',
          timeout_ms: 60000,
          temperature: null,
          max_tokens: null,
          config_digest: CONFIG_DIGEST,
        },
      });
    });
    const bridge = {
      readCurrent: vi.fn(async () => current({
        configured: false,
        config: null,
        credential_status: 'missing',
      })),
      replaceCurrent,
      status: vi.fn(async () => status({
        configured: false,
        config_digest: null,
        credential_status: 'missing',
      })),
    };
    const container = render(<BuilderProviderSettingsRouteAdapter providerSettingsBridge={bridge} />);
    await flush();

    changeInput(input(container, 'builder-provider-base-url'), 'https://provider.example/v1');
    changeInput(input(container, 'builder-provider-model'), 'new-model');
    changeInput(input(container, 'builder-provider-api-key'), 'real-key-value');
    changeInput(input(container, 'builder-provider-timeout'), '60000');
    changeInput(input(container, 'builder-provider-temperature'), '');
    changeInput(input(container, 'builder-provider-max-tokens'), '');
    await act(async () => {
      buttonWithText(container, 'Save provider').click();
      await Promise.resolve();
    });

    expect(replaceCurrent).toHaveBeenCalledTimes(1);
    expect(replaceCurrent.mock.calls[0][0]).toEqual({
      config: {
        base_url: 'https://provider.example/v1',
        model: 'new-model',
        timeout_ms: 60000,
        temperature: null,
        max_tokens: null,
      },
      credential: 'real-key-value',
    });
    expect(container.textContent).toContain('Provider settings saved.');
    expect(input(container, 'builder-provider-api-key').value).toBe('');
    expect(container.textContent).not.toContain('real-key-value');
  });

  it('hides pristine unconfigured field errors while keeping save disabled', async () => {
    const bridge = {
      readCurrent: vi.fn(async () => current({
        configured: false,
        config: null,
        credential_status: 'missing',
      })),
      replaceCurrent: vi.fn(async () => current({ operation: 'current_replaced' })),
      status: vi.fn(async () => status({
        configured: false,
        config_digest: null,
        credential_status: 'missing',
      })),
    };
    const container = render(<BuilderProviderSettingsRouteAdapter providerSettingsBridge={bridge} />);
    await flush();

    expect(container.textContent).toContain('Connect an AI provider before making projects.');
    expect(container.querySelector('#builder-provider-base-url-error')).toBeNull();
    expect(container.querySelector('#builder-provider-model-error')).toBeNull();
    expect(container.querySelector('#builder-provider-api-key-error')).toBeNull();
    expect(input(container, 'builder-provider-base-url').getAttribute('aria-invalid')).toBe('false');
    expect(input(container, 'builder-provider-model').getAttribute('aria-invalid')).toBe('false');
    expect(input(container, 'builder-provider-api-key').getAttribute('aria-invalid')).toBe('false');
    expect(buttonWithText(container, 'Save provider').disabled).toBe(true);
    expect(bridge.replaceCurrent).not.toHaveBeenCalled();
  });

  it('maps controller field errors into the panel without calling the bridge', async () => {
    const replaceCurrent = vi.fn(async () => current({ operation: 'current_replaced' }));
    const bridge = {
      readCurrent: vi.fn(async () => current({
        configured: false,
        config: null,
        credential_status: 'missing',
      })),
      replaceCurrent,
      status: vi.fn(async () => status({
        configured: false,
        config_digest: null,
        credential_status: 'missing',
      })),
    };
    const container = render(<BuilderProviderSettingsRouteAdapter providerSettingsBridge={bridge} />);
    await flush();

    changeInput(input(container, 'builder-provider-base-url'), 'http://remote.example/private-marker');

    expect(input(container, 'builder-provider-base-url').getAttribute('aria-invalid')).toBe('true');
    expect(input(container, 'builder-provider-base-url').getAttribute('aria-describedby')).toBe(
      'builder-provider-base-url-error',
    );
    expect(container.querySelector('#builder-provider-base-url-error')?.textContent).toBe(
      'Enter an HTTPS address or a local provider address.',
    );
    expect(container.textContent).not.toContain('private-marker');
    expect(buttonWithText(container, 'Save provider').disabled).toBe(true);
    await act(async () => {
      buttonWithText(container, 'Save provider').click();
      await Promise.resolve();
    });
    expect(replaceCurrent).not.toHaveBeenCalled();
  });

  it('rejects non-idempotent provider addresses before the bridge write path', async () => {
    const replaceCurrent = vi.fn(async () => current({ operation: 'current_replaced' }));
    const bridge = {
      readCurrent: vi.fn(async () => current({
        configured: false,
        config: null,
        credential_status: 'missing',
      })),
      replaceCurrent,
      status: vi.fn(async () => status({
        configured: false,
        config_digest: null,
        credential_status: 'missing',
      })),
    };
    const container = render(<BuilderProviderSettingsRouteAdapter providerSettingsBridge={bridge} />);
    await flush();

    changeInput(input(container, 'builder-provider-base-url'), 'https://provider.example/v1//');
    changeInput(input(container, 'builder-provider-model'), 'new-model');
    changeInput(input(container, 'builder-provider-api-key'), 'real-key-value');

    expect(container.querySelector('#builder-provider-base-url-error')?.textContent).toBe(
      'Enter an HTTPS address or a local provider address.',
    );
    expect(buttonWithText(container, 'Save provider').disabled).toBe(true);
    await act(async () => {
      buttonWithText(container, 'Save provider').click();
      await Promise.resolve();
    });
    expect(replaceCurrent).not.toHaveBeenCalled();
  });

  it('rejects model and API key text outside the main provider boundaries before bridge writes', async () => {
    const replaceCurrent = vi.fn(async () => current({ operation: 'current_replaced' }));
    const bridge = {
      readCurrent: vi.fn(async () => current({
        configured: false,
        config: null,
        credential_status: 'missing',
      })),
      replaceCurrent,
      status: vi.fn(async () => status({
        configured: false,
        config_digest: null,
        credential_status: 'missing',
      })),
    };
    const container = render(<BuilderProviderSettingsRouteAdapter providerSettingsBridge={bridge} />);
    await flush();

    changeInput(input(container, 'builder-provider-base-url'), 'https://provider.example/v1');
    changeInput(input(container, 'builder-provider-model'), 'm'.repeat(201));
    changeInput(input(container, 'builder-provider-api-key'), 'k'.repeat((16 * 1024) + 1));

    expect(container.querySelector('#builder-provider-model-error')?.textContent).toBe('Enter a model name.');
    expect(container.querySelector('#builder-provider-api-key-error')?.textContent).toBe('Enter an API key.');
    expect(buttonWithText(container, 'Save provider').disabled).toBe(true);
    await act(async () => {
      buttonWithText(container, 'Save provider').click();
      await Promise.resolve();
    });
    expect(replaceCurrent).not.toHaveBeenCalled();
  });

  it('fails closed for invalid bridge authority without route or legacy fallback', async () => {
    const container = render(
      <BuilderProviderSettingsRouteAdapter providerSettingsBridge={{ readCurrent: vi.fn() }} />,
    );

    await flush();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Provider settings are unavailable right now.',
    );
    expect(buttonWithText(container, 'Save provider').disabled).toBe(true);
    expect(container.textContent).not.toContain('Chat');
    expect(container.textContent).not.toContain('AppLayout');
  });
});
