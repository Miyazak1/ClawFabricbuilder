export const BUILDER_PROVIDER_ENDPOINT_MAX_LENGTH = 2048;
export const BUILDER_PROVIDER_MODEL_MAX_LENGTH = 200;
export const BUILDER_PROVIDER_CREDENTIAL_MAX_BYTES = 16 * 1024;
const UTF8_ENCODER = new TextEncoder();

export class BuilderProviderSettingsValidationError extends Error {
  readonly code = 'builder_provider_settings_invalid';

  constructor() {
    super('AI provider settings are invalid.');
    this.name = 'BuilderProviderSettingsValidationError';
  }
}

function validationError(): BuilderProviderSettingsValidationError {
  return new BuilderProviderSettingsValidationError();
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function safeEndpointText(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || value.length > BUILDER_PROVIDER_ENDPOINT_MAX_LENGTH
    || hasUnpairedSurrogate(value)
  ) throw validationError();
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) throw validationError();
  }
  return value;
}

function hasDisallowedControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function safeText(value: unknown, maximumCodeUnits: number, maximumUtf8Bytes: number): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || value.length > maximumCodeUnits
    || hasUnpairedSurrogate(value)
    || hasDisallowedControl(value)
    || UTF8_ENCODER.encode(value).byteLength > maximumUtf8Bytes
  ) throw validationError();
  return value;
}

export function sanitizeBuilderProviderModel(value: unknown): string {
  return safeText(value, BUILDER_PROVIDER_MODEL_MAX_LENGTH, BUILDER_PROVIDER_MODEL_MAX_LENGTH * 4);
}

export function sanitizeBuilderProviderCredential(value: unknown): string {
  return safeText(value, BUILDER_PROVIDER_CREDENTIAL_MAX_BYTES, BUILDER_PROVIDER_CREDENTIAL_MAX_BYTES);
}

export function canonicalizeBuilderProviderEndpoint(value: unknown): string {
  const text = safeEndpointText(value);
  try {
    const parsed = new URL(text);
    if (
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
      || parsed.username !== ''
      || parsed.password !== ''
      || parsed.search !== ''
      || parsed.hash !== ''
    ) throw validationError();
    const hostname = parsed.hostname.toLowerCase();
    const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
    if (parsed.protocol === 'http:' && !loopback) throw validationError();
    const canonical = parsed.toString().replace(/\/$/u, '');
    if (canonical.endsWith('/')) throw validationError();
    return canonical;
  } catch (error) {
    if (error instanceof BuilderProviderSettingsValidationError) throw error;
    throw validationError();
  }
}

export function requireCanonicalBuilderProviderEndpoint(value: unknown): string {
  const canonical = canonicalizeBuilderProviderEndpoint(value);
  if (value !== canonical) throw validationError();
  return canonical;
}
