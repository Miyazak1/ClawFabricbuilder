import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  BuilderProviderSettingsPanel,
  type BuilderProviderSettingsPanelFieldErrors,
  type BuilderProviderSettingsPanelProps,
  type BuilderProviderSettingsPanelValues,
} from './BuilderProviderSettingsPanel';

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

function values(overrides: Partial<BuilderProviderSettingsPanelValues> = {}): BuilderProviderSettingsPanelValues {
  return {
    baseUrl: 'https://provider.example/v1',
    model: 'builder-model',
    apiKey: 'real-key-value',
    timeoutMs: '30000',
    temperature: '0.2',
    maxTokens: '8192',
    ...overrides,
  };
}

function fieldErrors(
  overrides: Partial<BuilderProviderSettingsPanelFieldErrors> = {},
): BuilderProviderSettingsPanelFieldErrors {
  return {
    baseUrl: null,
    model: null,
    apiKey: null,
    timeoutMs: null,
    temperature: null,
    maxTokens: null,
    ...overrides,
  };
}

function props(overrides: Partial<BuilderProviderSettingsPanelProps> = {}): BuilderProviderSettingsPanelProps {
  return {
    canSave: true,
    fieldErrors: fieldErrors(),
    status: 'unconfigured',
    values: values(),
    onValuesChange: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  };
}

function input(container: HTMLElement, id: string): HTMLInputElement {
  const element = container.querySelector<HTMLInputElement>(`#${id}`);
  if (!element) throw new Error(`Missing input: ${id}`);
  return element;
}

function buttonWithText(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find((button) => button.textContent?.includes(text));
}

function changeInput(element: HTMLInputElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setter) throw new Error('Missing input value setter');
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('BuilderProviderSettingsPanel', () => {
  it('renders provider fields and the unconfigured state with a safe save command', () => {
    const onSave = vi.fn();
    const container = render(<BuilderProviderSettingsPanel {...props({ onSave })} />);

    expect(container.querySelector('[data-builder-provider-settings-panel="true"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-provider-settings-panel="true"]')?.className).toContain(
      'cf-builder-panel',
    );
    expect(container.querySelector('[data-builder-provider-settings-panel="true"]')?.className).toContain(
      'cf-builder-settings-card',
    );
    expect(container.querySelector('[aria-label="Connection"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Generation limits"]')).not.toBeNull();
    expect(container.querySelector('.cf-builder-settings-sections')).not.toBeNull();
    expect(container.querySelector('.cf-builder-settings-actions')).not.toBeNull();
    expect(container.querySelector('h2')?.textContent).toBe('AI provider');
    expect(container.textContent).toContain('Connect an AI provider before making projects.');
    expect(buttonWithText(container, 'Use V4 Flash')?.disabled).toBe(false);
    expect(buttonWithText(container, 'Use V4 Pro')?.disabled).toBe(false);
    expect(input(container, 'builder-provider-base-url').value).toBe('https://provider.example/v1');
    expect(input(container, 'builder-provider-base-url').placeholder).toBe('https://api.example.com/v1');
    expect(input(container, 'builder-provider-base-url').className).toContain('cf-builder-input');
    expect(input(container, 'builder-provider-model').value).toBe('builder-model');
    expect(input(container, 'builder-provider-model').placeholder).toBe('model-name');
    expect(input(container, 'builder-provider-api-key').type).toBe('password');
    expect(input(container, 'builder-provider-api-key').value).toBe('real-key-value');
    expect(input(container, 'builder-provider-timeout').value).toBe('30000');
    expect(input(container, 'builder-provider-temperature').value).toBe('0.2');
    expect(input(container, 'builder-provider-max-tokens').value).toBe('8192');
    expect(buttonWithText(container, 'Save provider')?.disabled).toBe(false);
    expect(buttonWithText(container, 'Save provider')?.className).toContain('cf-builder-primary-button');
    act(() => buttonWithText(container, 'Save provider')?.click());
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('publishes a fresh values object when a field changes', () => {
    const onValuesChange = vi.fn();
    const original = values();
    const container = render(<BuilderProviderSettingsPanel {...props({
      values: original,
      onValuesChange,
    })} />);

    changeInput(input(container, 'builder-provider-model'), 'better-model');

    expect(onValuesChange).toHaveBeenCalledWith({
      ...original,
      model: 'better-model',
    });
    expect(onValuesChange.mock.calls[0][0]).not.toBe(original);
    expect(Object.isFrozen(onValuesChange.mock.calls[0][0])).toBe(true);
  });

  it.each([
    ['Use V4 Flash', 'deepseek-v4-flash'],
    ['Use V4 Pro', 'deepseek-v4-pro'],
  ])('applies the DeepSeek preset %s without touching the API key or saving', (buttonText, model) => {
    const onValuesChange = vi.fn();
    const onSave = vi.fn();
    const original = values({
      apiKey: 'keep-this-key',
      baseUrl: 'https://provider.example/v1',
      maxTokens: '',
      model: 'builder-model',
      temperature: '',
      timeoutMs: '30000',
    });
    const container = render(<BuilderProviderSettingsPanel {...props({
      values: original,
      onSave,
      onValuesChange,
    })} />);

    act(() => buttonWithText(container, buttonText)?.click());

    expect(onValuesChange).toHaveBeenCalledExactlyOnceWith({
      ...original,
      baseUrl: 'https://api.deepseek.com/v1',
      maxTokens: '8192',
      model,
      temperature: '0.2',
      timeoutMs: '120000',
    });
    expect(onValuesChange.mock.calls[0][0].apiKey).toBe('keep-this-key');
    expect(Object.isFrozen(onValuesChange.mock.calls[0][0])).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('never echoes an already saved API key from saved or unconfigured state', () => {
    const saved = render(<BuilderProviderSettingsPanel {...props({
      status: 'saved',
      values: values({ apiKey: '' }),
    })} />);
    expect(saved.textContent).toContain('Provider settings saved.');
    expect(input(saved, 'builder-provider-api-key').value).toBe('');
    expect(input(saved, 'builder-provider-api-key').placeholder).toBe('Enter a new key');
    expect(saved.textContent).not.toContain('real-key-value');

    for (const entry of mounted.splice(0)) {
      act(() => entry.root.unmount());
      entry.container.remove();
    }

    const unconfigured = render(<BuilderProviderSettingsPanel {...props({
      status: 'unconfigured',
      values: values({
        baseUrl: '',
        model: '',
        apiKey: '',
        temperature: '',
        maxTokens: '',
      }),
    })} />);
    expect(input(unconfigured, 'builder-provider-api-key').value).toBe('');
    expect(unconfigured.textContent).not.toContain('real-key-value');
  });

  it.each([
    ['bad base URL', { baseUrl: 'http://provider.example/v1' }, { baseUrl: 'Enter an HTTPS address or a local provider address.' }, 'builder-provider-base-url'],
    ['blank model', { model: ' ' }, { model: 'Enter a model name.' }, 'builder-provider-model'],
    ['blank API key', { apiKey: '' }, { apiKey: 'Enter an API key.' }, 'builder-provider-api-key'],
    ['bad timeout', { timeoutMs: '999' }, { timeoutMs: 'Use a whole number from 1000 to 120000.' }, 'builder-provider-timeout'],
    ['bad temperature', { temperature: '3' }, { temperature: 'Use a number from 0 to 2, or leave it blank.' }, 'builder-provider-temperature'],
    ['bad max tokens', { maxTokens: '100' }, { maxTokens: 'Use a whole number from 256 to 65536, or leave it blank.' }, 'builder-provider-max-tokens'],
  ])('fails closed for %s', (_label, override, errors, inputId) => {
    const onSave = vi.fn();
    const container = render(<BuilderProviderSettingsPanel {...props({
      canSave: false,
      fieldErrors: fieldErrors(errors),
      values: values(override),
      onSave,
    })} />);

    expect(input(container, inputId).getAttribute('aria-invalid')).toBe('true');
    expect(input(container, inputId).getAttribute('aria-describedby')).toBe(`${inputId}-error`);
    expect(container.querySelector(`#${inputId}-error`)?.textContent).toBe(Object.values(errors)[0]);
    expect(buttonWithText(container, 'Save provider')?.disabled).toBe(true);
    act(() => buttonWithText(container, 'Save provider')?.click());
    expect(onSave).not.toHaveBeenCalled();
  });

  it('can hide pristine field errors without enabling save', () => {
    const onSave = vi.fn();
    const container = render(<BuilderProviderSettingsPanel {...props({
      canSave: false,
      fieldErrors: fieldErrors({
        apiKey: 'Enter an API key.',
        baseUrl: 'Enter an HTTPS address or a local provider address.',
        model: 'Enter a model name.',
      }),
      showFieldErrors: false,
      values: values({
        apiKey: '',
        baseUrl: '',
        model: '',
      }),
      onSave,
    })} />);

    expect(container.querySelector('#builder-provider-base-url-error')).toBeNull();
    expect(container.querySelector('#builder-provider-model-error')).toBeNull();
    expect(container.querySelector('#builder-provider-api-key-error')).toBeNull();
    expect(input(container, 'builder-provider-base-url').getAttribute('aria-invalid')).toBe('false');
    expect(input(container, 'builder-provider-model').getAttribute('aria-invalid')).toBe('false');
    expect(input(container, 'builder-provider-api-key').getAttribute('aria-invalid')).toBe('false');
    expect(buttonWithText(container, 'Save provider')?.disabled).toBe(true);
    act(() => buttonWithText(container, 'Save provider')?.click());
    expect(onSave).not.toHaveBeenCalled();
  });

  it('accepts a local provider address when the controller marks it valid', () => {
    const onSave = vi.fn();
    const container = render(<BuilderProviderSettingsPanel {...props({
      values: values({ baseUrl: 'http://127.0.0.1:11434/v1' }),
      onSave,
    })} />);

    expect(input(container, 'builder-provider-base-url').getAttribute('aria-invalid')).toBe('false');
    expect(buttonWithText(container, 'Save provider')?.disabled).toBe(false);
    act(() => buttonWithText(container, 'Save provider')?.click());
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('fails closed when save authority is not provided by the controller', () => {
    const onSave = vi.fn();
    const container = render(<BuilderProviderSettingsPanel
      status="unconfigured"
      values={values()}
      onSave={onSave}
    />);

    expect(buttonWithText(container, 'Save provider')?.disabled).toBe(true);
    act(() => buttonWithText(container, 'Save provider')?.click());
    expect(onSave).not.toHaveBeenCalled();
  });

  it('locks controls while saving or unavailable', () => {
    const onValuesChange = vi.fn();
    const onSave = vi.fn();
    const saving = render(<BuilderProviderSettingsPanel {...props({
      status: 'saving',
      onValuesChange,
      onSave,
    })} />);

    expect(saving.textContent).toContain('Saving provider settings...');
    expect(input(saving, 'builder-provider-base-url').disabled).toBe(true);
    expect(buttonWithText(saving, 'Saving...')?.disabled).toBe(true);
    changeInput(input(saving, 'builder-provider-model'), 'ignored-model');
    act(() => buttonWithText(saving, 'Saving...')?.click());
    expect(onValuesChange).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();

    const unavailable = render(<BuilderProviderSettingsPanel {...props({
      status: 'unavailable',
    })} />);
    expect(unavailable.querySelector('[role="alert"]')?.textContent).toContain(
      'Provider settings are unavailable right now.',
    );
    expect(buttonWithText(unavailable, 'Save provider')?.disabled).toBe(true);
    expect(buttonWithText(unavailable, 'Use V4 Flash')?.disabled).toBe(true);
    expect(buttonWithText(unavailable, 'Use V4 Pro')?.disabled).toBe(true);
  });

  it('renders error status without exposing any credential text', () => {
    const container = render(<BuilderProviderSettingsPanel {...props({
      status: 'error',
      values: values({ apiKey: '' }),
    })} />);

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Provider settings could not be saved.',
    );
    expect(container.textContent).not.toContain('real-key-value');
  });

  it('does not import global runtime, route, legacy product, or storage authority', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'features', 'builder', 'presentation', 'BuilderProviderSettingsPanel.tsx'),
      'utf8',
    );

    expect(source).toContain('BuilderProviderSettingsPanel');
    expect(source).not.toMatch(
      /\bwindow\b|globalThis|electron|ipcRenderer|fetch\(|localStorage|sessionStorage|indexedDB|ChatCreatePage|chat_planner|Canvas|\bJob\b|local-provider-executor|react-router|router|safeStorage/i,
    );
    expect(source).not.toMatch(/from ['"]\.\.\/domain\/builderProviderSettings['"]/);
    expect(source).not.toMatch(/credential|secret|encrypted/i);
  });
});
