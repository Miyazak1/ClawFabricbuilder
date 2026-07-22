import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  BuilderProviderSettingsValidationError,
  BUILDER_PROVIDER_ENDPOINT_MAX_LENGTH,
  BUILDER_PROVIDER_CREDENTIAL_MAX_BYTES,
  BUILDER_PROVIDER_MODEL_MAX_LENGTH,
  canonicalizeBuilderProviderEndpoint,
  requireCanonicalBuilderProviderEndpoint,
  sanitizeBuilderProviderCredential,
  sanitizeBuilderProviderModel,
} from './builderProviderSettings';

describe('Builder provider settings domain helpers', () => {
  it('canonicalizes HTTPS and exact loopback HTTP provider endpoints', () => {
    expect(canonicalizeBuilderProviderEndpoint('https://api.example/v1/')).toBe('https://api.example/v1');
    expect(canonicalizeBuilderProviderEndpoint('http://127.0.0.1:11434/v1/')).toBe(
      'http://127.0.0.1:11434/v1',
    );
    expect(canonicalizeBuilderProviderEndpoint('http://localhost:8080/api/v1/')).toBe(
      'http://localhost:8080/api/v1',
    );
    expect(canonicalizeBuilderProviderEndpoint('http://[::1]:9090/v1/')).toBe(
      'http://[::1]:9090/v1',
    );
  });

  it('is idempotent for every accepted provider endpoint', () => {
    for (const endpoint of [
      'https://api.example',
      'https://api.example/v1/',
      'http://127.0.0.1:11434/v1/',
      'http://localhost:8080/api/v1/',
      'http://[::1]:9090/v1/',
    ]) {
      const canonical = canonicalizeBuilderProviderEndpoint(endpoint);
      expect(canonicalizeBuilderProviderEndpoint(canonical)).toBe(canonical);
    }
  });

  it('requires canonical endpoints when checking trusted settings evidence', () => {
    expect(requireCanonicalBuilderProviderEndpoint('https://api.example/v1')).toBe('https://api.example/v1');
    expect(() => requireCanonicalBuilderProviderEndpoint('https://api.example/v1/')).toThrow(
      BuilderProviderSettingsValidationError,
    );
  });

  it('uses one fixed generic validation error without reflecting invalid values', () => {
    let error: unknown;
    try {
      canonicalizeBuilderProviderEndpoint('http://remote.example/private-marker');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(BuilderProviderSettingsValidationError);
    expect(error).toMatchObject({
      code: 'builder_provider_settings_invalid',
      message: 'AI provider settings are invalid.',
      name: 'BuilderProviderSettingsValidationError',
    });
    expect(JSON.stringify(error)).not.toContain('private-marker');
  });

  it.each([
    ['remote cleartext', 'http://api.example/v1'],
    ['credentials', 'https://user:pass@api.example/v1'],
    ['search', 'https://api.example/v1?token=value'],
    ['hash', 'https://api.example/v1#token'],
    ['repeated trailing slash', 'https://api.example/v1//'],
    ['other protocol', 'file:///tmp/provider'],
    ['blank', ''],
    ['trim drift', ' https://api.example/v1'],
    ['control character', 'https://api.example/\u0001'],
    ['lone surrogate', `https://api.example/${String.fromCharCode(0xd800)}`],
    ['oversized', `https://api.example/${'a'.repeat(BUILDER_PROVIDER_ENDPOINT_MAX_LENGTH)}`],
  ])('rejects %s endpoints', (_label, value) => {
    expect(() => canonicalizeBuilderProviderEndpoint(value)).toThrow(BuilderProviderSettingsValidationError);
  });

  it('stays independent from UI, host, network, browser, and legacy authorities', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'features', 'builder', 'domain', 'builderProviderSettings.ts'),
      'utf8',
    );

    expect(source).not.toMatch(
      /react|electron|bridge|fetch\s*\(|localStorage|sessionStorage|indexedDB|ChatCreatePage|chat_planner|Canvas|\bJob\b/i,
    );
  });

  it('accepts model text within the main provider config boundary', () => {
    expect(sanitizeBuilderProviderModel('gpt-5.4')).toBe('gpt-5.4');
    expect(sanitizeBuilderProviderModel('m'.repeat(BUILDER_PROVIDER_MODEL_MAX_LENGTH))).toBe(
      'm'.repeat(BUILDER_PROVIDER_MODEL_MAX_LENGTH),
    );
  });

  it.each([
    ['blank', ''],
    ['trim drift', ' model'],
    ['control', 'model\u0001'],
    ['lone surrogate', `model${String.fromCharCode(0xd800)}`],
    ['too long', 'm'.repeat(BUILDER_PROVIDER_MODEL_MAX_LENGTH + 1)],
  ])('rejects %s model text', (_label, value) => {
    expect(() => sanitizeBuilderProviderModel(value)).toThrow(BuilderProviderSettingsValidationError);
  });

  it('accepts credential text within the main secret boundary', () => {
    expect(sanitizeBuilderProviderCredential('real-key-value')).toBe('real-key-value');
    expect(sanitizeBuilderProviderCredential('k'.repeat(BUILDER_PROVIDER_CREDENTIAL_MAX_BYTES))).toBe(
      'k'.repeat(BUILDER_PROVIDER_CREDENTIAL_MAX_BYTES),
    );
  });

  it.each([
    ['blank', ''],
    ['trim drift', ' key'],
    ['control', 'key\u0001'],
    ['lone surrogate', `key${String.fromCharCode(0xd800)}`],
    ['too many code units', 'k'.repeat(BUILDER_PROVIDER_CREDENTIAL_MAX_BYTES + 1)],
    ['too many UTF-8 bytes', '\u{1f600}'.repeat((BUILDER_PROVIDER_CREDENTIAL_MAX_BYTES / 4) + 1)],
  ])('rejects %s credential text', (_label, value) => {
    expect(() => sanitizeBuilderProviderCredential(value)).toThrow(BuilderProviderSettingsValidationError);
  });
});
