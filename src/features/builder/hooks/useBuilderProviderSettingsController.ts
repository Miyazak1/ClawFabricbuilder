import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  BuilderProviderSettingsConfig,
  BuilderProviderSettingsPort,
  BuilderProviderSettingsWriteRequest,
} from '../infrastructure/builderDesktopProviderSettingsPort';
import type {
  BuilderProviderSettingsPanelStatus,
  BuilderProviderSettingsPanelValues,
} from '../presentation/BuilderProviderSettingsPanel';

export type BuilderProviderSettingsControllerResult = Readonly<{
  onSave(): Promise<void>;
  onValuesChange(values: BuilderProviderSettingsPanelValues): void;
  status: BuilderProviderSettingsPanelStatus;
  values: BuilderProviderSettingsPanelValues;
}>;

const VALUE_KEYS = new Set(['baseUrl', 'model', 'apiKey', 'timeoutMs', 'temperature', 'maxTokens']);
const MAX_VALUE_BYTES = 64 * 1024;
const UTF8_ENCODER = new TextEncoder();

const DEFAULT_VALUES: BuilderProviderSettingsPanelValues = Object.freeze({
  baseUrl: 'https://api.openai.com/v1',
  model: '',
  apiKey: '',
  timeoutMs: '30000',
  temperature: '0.2',
  maxTokens: '8192',
});

function fixedValues(values: BuilderProviderSettingsPanelValues): BuilderProviderSettingsPanelValues {
  return Object.freeze({
    baseUrl: values.baseUrl,
    model: values.model,
    apiKey: values.apiKey,
    timeoutMs: values.timeoutMs,
    temperature: values.temperature,
    maxTokens: values.maxTokens,
  });
}

function exactValues(value: unknown): BuilderProviderSettingsPanelValues {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid values');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error('invalid values');
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== VALUE_KEYS.size
    || keys.some((key) => typeof key !== 'string' || !VALUE_KEYS.has(key))
  ) throw new Error('invalid values');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const next = {} as Record<keyof BuilderProviderSettingsPanelValues, string>;
  for (const key of VALUE_KEYS) {
    const descriptor = descriptors[key];
    if (
      !descriptor
      || !descriptor.enumerable
      || 'get' in descriptor
      || 'set' in descriptor
      || typeof descriptor.value !== 'string'
      || UTF8_ENCODER.encode(descriptor.value).byteLength > MAX_VALUE_BYTES
    ) throw new Error('invalid values');
    next[key as keyof BuilderProviderSettingsPanelValues] = descriptor.value;
  }
  return fixedValues(next);
}

function configValues(config: BuilderProviderSettingsConfig): BuilderProviderSettingsPanelValues {
  return Object.freeze({
    baseUrl: config.base_url,
    model: config.model,
    apiKey: '',
    timeoutMs: String(config.timeout_ms),
    temperature: config.temperature === null ? '' : String(config.temperature),
    maxTokens: config.max_tokens === null ? '' : String(config.max_tokens),
  });
}

function integerValue(value: string, minimum: number, maximum: number, allowBlank: false): number;
function integerValue(value: string, minimum: number, maximum: number, allowBlank: true): number | null;
function integerValue(value: string, minimum: number, maximum: number, allowBlank: boolean): number | null {
  const trimmed = value.trim();
  if (allowBlank && trimmed === '') return null;
  if (trimmed !== value || !/^(?:0|[1-9][0-9]*)$/.test(value)) throw new Error('invalid integer');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error('invalid integer');
  return parsed;
}

function numberValue(value: string, minimum: number, maximum: number): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed !== value || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)) {
    throw new Error('invalid number');
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) throw new Error('invalid number');
  return parsed;
}

function writeRequest(values: BuilderProviderSettingsPanelValues): BuilderProviderSettingsWriteRequest {
  const safe = exactValues(values);
  const baseUrl = safe.baseUrl.trim();
  const model = safe.model.trim();
  const credential = safe.apiKey.trim();
  if (
    baseUrl !== safe.baseUrl
    || model !== safe.model
    || credential !== safe.apiKey
    || !/^https:\/\/[^\s/$.?#].[^\s]*$/i.test(baseUrl)
    || model.length === 0
    || credential.length === 0
  ) throw new Error('invalid settings');
  return Object.freeze({
    config: Object.freeze({
      base_url: baseUrl,
      model,
      timeout_ms: integerValue(safe.timeoutMs, 1_000, 120_000, false),
      temperature: numberValue(safe.temperature, 0, 2),
      max_tokens: integerValue(safe.maxTokens, 256, 65_536, true),
    }),
    credential,
  });
}

function valuesAfterCurrent(
  current: Awaited<ReturnType<BuilderProviderSettingsPort['readCurrent']>>,
): { status: BuilderProviderSettingsPanelStatus; values: BuilderProviderSettingsPanelValues } {
  if (!current.configured || current.config === null) {
    return { status: 'unconfigured', values: DEFAULT_VALUES };
  }
  return { status: 'saved', values: configValues(current.config) };
}

export function useBuilderProviderSettingsController(
  port: BuilderProviderSettingsPort,
): BuilderProviderSettingsControllerResult {
  const [status, setStatus] = useState<BuilderProviderSettingsPanelStatus>('unconfigured');
  const [values, setValues] = useState<BuilderProviderSettingsPanelValues>(DEFAULT_VALUES);
  const operationRef = useRef(0);

  useEffect(() => {
    const operation = operationRef.current + 1;
    operationRef.current = operation;
    let active = true;
    void port.readCurrent()
      .then((current) => {
        if (!active || operationRef.current !== operation) return;
        const next = valuesAfterCurrent(current);
        setStatus(next.status);
        setValues(next.values);
      })
      .catch(() => {
        if (!active || operationRef.current !== operation) return;
        setStatus('unavailable');
        setValues(DEFAULT_VALUES);
      });
    return () => {
      active = false;
    };
  }, [port]);

  const onValuesChange = useCallback((nextValues: BuilderProviderSettingsPanelValues) => {
    try {
      setValues(exactValues(nextValues));
      setStatus((currentStatus) => (currentStatus === 'unavailable' ? 'unavailable' : 'unconfigured'));
    } catch {
      setStatus('error');
    }
  }, []);

  const onSave = useCallback(async () => {
    const operation = operationRef.current + 1;
    operationRef.current = operation;
    let request: BuilderProviderSettingsWriteRequest;
    try {
      request = writeRequest(values);
    } catch {
      setStatus('error');
      return;
    }
    setStatus('saving');
    try {
      const current = await port.replaceCurrent(request);
      if (operationRef.current !== operation) return;
      const next = valuesAfterCurrent(current);
      setStatus(next.status);
      setValues(next.values);
    } catch {
      if (operationRef.current !== operation) return;
      setStatus('error');
      setValues((currentValues) => fixedValues({ ...currentValues, apiKey: '' }));
    }
  }, [port, values]);

  return useMemo(
    () => ({
      onSave,
      onValuesChange,
      status,
      values,
    }),
    [onSave, onValuesChange, status, values],
  );
}
