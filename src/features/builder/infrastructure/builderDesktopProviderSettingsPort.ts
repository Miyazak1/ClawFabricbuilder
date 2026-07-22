import {
  requireCanonicalBuilderProviderEndpoint,
  sanitizeBuilderProviderCredential,
  sanitizeBuilderProviderModel,
} from '../domain/builderProviderSettings';

export type BuilderProviderSettingsConfig = Readonly<{
  provider_id: string;
  base_url: string;
  model: string;
  timeout_ms: number;
  temperature: number | null;
  max_tokens: number | null;
  config_digest: string;
}>;

export type BuilderProviderSettingsCurrent = Readonly<{
  configured: boolean;
  config: BuilderProviderSettingsConfig | null;
  credential_status: 'missing' | 'stored';
}>;

export type BuilderProviderSettingsStatus = Readonly<{
  configured: boolean;
  config_digest: string | null;
  credential_status: 'missing' | 'stored';
}>;

export type BuilderProviderSettingsWriteRequest = Readonly<{
  config: Readonly<{
    base_url: string;
    model: string;
    timeout_ms: number;
    temperature: number | null;
    max_tokens: number | null;
  }>;
  credential: string;
}>;

export type BuilderProviderSettingsPort = Readonly<{
  readCurrent(): Promise<BuilderProviderSettingsCurrent>;
  replaceCurrent(request: BuilderProviderSettingsWriteRequest): Promise<BuilderProviderSettingsCurrent>;
  status(): Promise<BuilderProviderSettingsStatus>;
}>;

type BuilderProviderSettingsBridge = Readonly<{
  readCurrent(): Promise<unknown>;
  replaceCurrent(request: unknown): Promise<unknown>;
  status(): Promise<unknown>;
}>;

const BRIDGE_KEYS = new Set(['readCurrent', 'replaceCurrent', 'status']);
const CONFIG_KEYS = new Set([
  'provider_id',
  'base_url',
  'model',
  'timeout_ms',
  'temperature',
  'max_tokens',
  'config_digest',
]);
const CURRENT_KEYS = new Set(['result_version', 'operation', 'configured', 'config', 'credential_status']);
const STATUS_KEYS = new Set(['status_version', 'configured', 'config_digest', 'credential_status']);
const WRITE_KEYS = new Set(['config', 'credential']);
const WRITE_CONFIG_KEYS = new Set(['base_url', 'model', 'timeout_ms', 'temperature', 'max_tokens']);
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MAX_TEXT_BYTES = 64 * 1024;
const UTF8_ENCODER = new TextEncoder();

export class BuilderDesktopProviderSettingsPortError extends Error {
  readonly code = 'builder_provider_settings_unavailable';

  constructor() {
    super('AI provider settings are unavailable.');
    this.name = 'BuilderDesktopProviderSettingsPortError';
  }
}

function portError(): BuilderDesktopProviderSettingsPortError {
  return new BuilderDesktopProviderSettingsPortError();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function descriptorsFor(
  value: unknown,
  keys: ReadonlySet<string>,
): Record<string, PropertyDescriptor> {
  if (!isPlainObject(value)) throw portError();
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.size
    || actual.some((key) => typeof key !== 'string' || !keys.has(key))
  ) throw portError();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (
      !descriptor
      || !descriptor.enumerable
      || 'get' in descriptor
      || 'set' in descriptor
    ) throw portError();
  }
  return descriptors;
}

function accountText(value: string): string {
  if (value.length === 0 || value.trim() !== value) throw portError();
  if (UTF8_ENCODER.encode(value).byteLength > MAX_TEXT_BYTES) throw portError();
  return value;
}

function optionalNumber(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw portError();
  return value;
}

function sanitizeConfig(value: unknown): BuilderProviderSettingsConfig {
  const descriptors = descriptorsFor(value, CONFIG_KEYS);
  const providerId = accountText(descriptors.provider_id.value);
  const baseUrl = requireCanonicalBuilderProviderEndpoint(descriptors.base_url.value);
  const model = sanitizeBuilderProviderModel(descriptors.model.value);
  const timeoutMs = descriptors.timeout_ms.value;
  const temperature = optionalNumber(descriptors.temperature.value);
  const maxTokens = optionalNumber(descriptors.max_tokens.value);
  const configDigest = descriptors.config_digest.value;
  if (
    typeof providerId !== 'string'
    || providerId !== 'builder-default'
    || typeof timeoutMs !== 'number'
    || !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1_000
    || timeoutMs > 120_000
    || (temperature !== null && (temperature < 0 || temperature > 2))
    || (maxTokens !== null && (!Number.isSafeInteger(maxTokens) || maxTokens < 256 || maxTokens > 65_536))
    || typeof configDigest !== 'string'
    || !DIGEST_PATTERN.test(configDigest)
  ) throw portError();
  return Object.freeze({
    provider_id: providerId,
    base_url: baseUrl,
    model,
    timeout_ms: timeoutMs,
    temperature,
    max_tokens: maxTokens,
    config_digest: configDigest,
  });
}

function sanitizeCurrent(value: unknown): BuilderProviderSettingsCurrent {
  const descriptors = descriptorsFor(value, CURRENT_KEYS);
  if (
    descriptors.result_version.value !== 'builder-provider-settings-ipc-adapter.v1'
    || !['current_loaded', 'current_replaced'].includes(descriptors.operation.value)
    || typeof descriptors.configured.value !== 'boolean'
  ) throw portError();
  const credentialStatus = descriptors.credential_status.value;
  if (credentialStatus !== 'missing' && credentialStatus !== 'stored') throw portError();
  if (descriptors.configured.value === false) {
    if (descriptors.config.value !== null || credentialStatus !== 'missing') throw portError();
    return Object.freeze({
      configured: false,
      config: null,
      credential_status: 'missing',
    });
  }
  if (credentialStatus !== 'stored') throw portError();
  return Object.freeze({
    configured: true,
    config: sanitizeConfig(descriptors.config.value),
    credential_status: 'stored',
  });
}

function sanitizeStatus(value: unknown): BuilderProviderSettingsStatus {
  const descriptors = descriptorsFor(value, STATUS_KEYS);
  if (
    descriptors.status_version.value !== 'builder-provider-settings-status.v1'
    || typeof descriptors.configured.value !== 'boolean'
  ) throw portError();
  const credentialStatus = descriptors.credential_status.value;
  if (credentialStatus !== 'missing' && credentialStatus !== 'stored') throw portError();
  const configDigest = descriptors.config_digest.value;
  if (descriptors.configured.value === false) {
    if (configDigest !== null || credentialStatus !== 'missing') throw portError();
    return Object.freeze({
      configured: false,
      config_digest: null,
      credential_status: 'missing',
    });
  }
  if (typeof configDigest !== 'string' || !DIGEST_PATTERN.test(configDigest) || credentialStatus !== 'stored') {
    throw portError();
  }
  return Object.freeze({
    configured: true,
    config_digest: configDigest,
    credential_status: 'stored',
  });
}

function sanitizeWriteRequest(value: BuilderProviderSettingsWriteRequest): unknown {
  const descriptors = descriptorsFor(value, WRITE_KEYS);
  const configDescriptors = descriptorsFor(descriptors.config.value, WRITE_CONFIG_KEYS);
  const baseUrl = requireCanonicalBuilderProviderEndpoint(configDescriptors.base_url.value);
  const model = sanitizeBuilderProviderModel(configDescriptors.model.value);
  const timeoutMs = configDescriptors.timeout_ms.value;
  const temperature = optionalNumber(configDescriptors.temperature.value);
  const maxTokens = optionalNumber(configDescriptors.max_tokens.value);
  const credential = sanitizeBuilderProviderCredential(descriptors.credential.value);
  if (
    typeof timeoutMs !== 'number'
    || !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1_000
    || timeoutMs > 120_000
    || (temperature !== null && (temperature < 0 || temperature > 2))
    || (maxTokens !== null && (!Number.isSafeInteger(maxTokens) || maxTokens < 256 || maxTokens > 65_536))
  ) throw portError();
  return Object.freeze({
    config: Object.freeze({
      base_url: baseUrl,
      model,
      timeout_ms: timeoutMs,
      temperature,
      max_tokens: maxTokens,
    }),
    credential,
  });
}

function sanitizeBridge(value: unknown): BuilderProviderSettingsBridge {
  const descriptors = descriptorsFor(value, BRIDGE_KEYS);
  const methods = {} as Record<string, (...args: unknown[]) => Promise<unknown>>;
  for (const key of BRIDGE_KEYS) {
    const method = descriptors[key].value;
    if (typeof method !== 'function') throw portError();
    methods[key] = method as (...args: unknown[]) => Promise<unknown>;
  }
  return Object.freeze({
    readCurrent: methods.readCurrent,
    replaceCurrent: methods.replaceCurrent,
    status: methods.status,
  });
}

async function callCurrent(
  receiver: BuilderProviderSettingsBridge,
  method: () => Promise<unknown>,
): Promise<BuilderProviderSettingsCurrent> {
  try {
    return sanitizeCurrent(await Reflect.apply(method, receiver, []));
  } catch {
    throw portError();
  }
}

async function callStatus(
  receiver: BuilderProviderSettingsBridge,
): Promise<BuilderProviderSettingsStatus> {
  try {
    return sanitizeStatus(await Reflect.apply(receiver.status, receiver, []));
  } catch {
    throw portError();
  }
}

async function callReplace(
  receiver: BuilderProviderSettingsBridge,
  request: BuilderProviderSettingsWriteRequest,
): Promise<BuilderProviderSettingsCurrent> {
  try {
    return sanitizeCurrent(await Reflect.apply(receiver.replaceCurrent, receiver, [
      sanitizeWriteRequest(request),
    ]));
  } catch {
    throw portError();
  }
}

export function createBuilderDesktopProviderSettingsPort(
  value: unknown,
): BuilderProviderSettingsPort {
  const bridge = sanitizeBridge(value);
  return Object.freeze({
    readCurrent() {
      return callCurrent(bridge, bridge.readCurrent);
    },
    replaceCurrent(request) {
      return callReplace(bridge, request);
    },
    status() {
      return callStatus(bridge);
    },
  });
}
