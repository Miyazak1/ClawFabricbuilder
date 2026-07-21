'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const BUILDER_PROVIDER_CONFIG_VERSION = 'builder-provider-config.v1';
const BUILDER_PROVIDER_SECRET_REF_VERSION = 'builder-provider-secret-ref.v1';
const BUILDER_PROVIDER_ID = 'builder-default';
const BUILDER_PROVIDER_SECRET_ID = 'builder-provider-secret:default';
const CONFIG_INPUT_KEYS = Object.freeze([
  'base_url', 'model', 'timeout_ms', 'temperature', 'max_tokens', 'secret_ref',
]);
const CONFIG_KEYS = Object.freeze([
  'config_version', 'provider_id', 'base_url', 'model', 'timeout_ms',
  'temperature', 'max_tokens', 'secret_ref', 'config_digest',
]);
const SECRET_REF_KEYS = Object.freeze(['ref_version', 'provider_id', 'secret_id']);
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

class BuilderProviderConfigError extends Error {
  constructor() {
    super('AI provider settings could not be verified.');
    this.name = 'BuilderProviderConfigError';
    this.code = 'builder_provider_config_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderProviderConfigError();
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== 'string' || !keys.includes(key))) fail();
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return value;
}

function ownValue(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  fail();
}

function digest(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function hasUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function safeText(value, maximum) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || value.length > maximum
    || hasUnpairedSurrogate(value)
  ) fail();
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) fail();
  }
  return value;
}

function safeBaseUrl(value) {
  const text = safeText(value, 2048);
  try {
    const parsed = new URL(text);
    if (!['http:', 'https:'].includes(parsed.protocol)
      || parsed.username || parsed.password || parsed.search || parsed.hash) fail();
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname.toLowerCase());
    if (parsed.protocol === 'http:' && !loopback) fail();
    return parsed.toString().replace(/\/$/u, '');
  } catch (error) {
    if (error instanceof BuilderProviderConfigError) throw error;
    fail();
  }
}

function sanitizeSecretRef(value) {
  exactObject(value, SECRET_REF_KEYS);
  if (
    ownValue(value, 'ref_version') !== BUILDER_PROVIDER_SECRET_REF_VERSION
    || ownValue(value, 'provider_id') !== BUILDER_PROVIDER_ID
    || ownValue(value, 'secret_id') !== BUILDER_PROVIDER_SECRET_ID
  ) fail();
  return {
    ref_version: BUILDER_PROVIDER_SECRET_REF_VERSION,
    provider_id: BUILDER_PROVIDER_ID,
    secret_id: BUILDER_PROVIDER_SECRET_ID,
  };
}

function configBody(source) {
  const timeoutMs = ownValue(source, 'timeout_ms');
  const temperature = ownValue(source, 'temperature');
  const maxTokens = ownValue(source, 'max_tokens');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) fail();
  if (temperature !== null
    && (typeof temperature !== 'number'
      || !Number.isFinite(temperature)
      || Object.is(temperature, -0)
      || temperature < 0
      || temperature > 2)) fail();
  if (maxTokens !== null
    && (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 131072)) fail();
  return {
    config_version: BUILDER_PROVIDER_CONFIG_VERSION,
    provider_id: BUILDER_PROVIDER_ID,
    base_url: safeBaseUrl(ownValue(source, 'base_url')),
    model: safeText(ownValue(source, 'model'), 200),
    timeout_ms: timeoutMs,
    temperature,
    max_tokens: maxTokens,
    secret_ref: sanitizeSecretRef(ownValue(source, 'secret_ref')),
  };
}

function createBuilderProviderConfig(value) {
  try {
    const source = exactObject(value, CONFIG_INPUT_KEYS);
    const body = configBody(source);
    return freezeDeep({ ...body, config_digest: digest(body) });
  } catch (error) {
    if (error instanceof BuilderProviderConfigError) throw error;
    fail();
  }
}

function sanitizeBuilderProviderConfig(value) {
  try {
    const source = exactObject(value, CONFIG_KEYS);
    if (
      ownValue(source, 'config_version') !== BUILDER_PROVIDER_CONFIG_VERSION
      || ownValue(source, 'provider_id') !== BUILDER_PROVIDER_ID
    ) fail();
    const body = configBody(source);
    const configDigest = ownValue(source, 'config_digest');
    if (typeof configDigest !== 'string' || !DIGEST_PATTERN.test(configDigest) || digest(body) !== configDigest) fail();
    return freezeDeep({ ...body, config_digest: configDigest });
  } catch (error) {
    if (error instanceof BuilderProviderConfigError) throw error;
    fail();
  }
}

module.exports = Object.freeze({
  BUILDER_PROVIDER_CONFIG_VERSION,
  BUILDER_PROVIDER_SECRET_REF_VERSION,
  BUILDER_PROVIDER_ID,
  BUILDER_PROVIDER_SECRET_ID,
  BuilderProviderConfigError,
  createBuilderProviderConfig,
  sanitizeBuilderProviderConfig,
});
