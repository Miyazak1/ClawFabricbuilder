'use strict';

const { types: utilTypes } = require('node:util');

const {
  BUILDER_PROVIDER_ID,
  BUILDER_PROVIDER_SECRET_ID,
  BUILDER_PROVIDER_SECRET_REF_VERSION,
  sanitizeBuilderProviderConfig,
} = require('./builder-provider-config.cjs');

const READ_CURRENT_CHANNEL = 'clawfabric-builder:provider-settings:read-current';
const REPLACE_CURRENT_CHANNEL = 'clawfabric-builder:provider-settings:replace-current';
const STATUS_CHANNEL = 'clawfabric-builder:provider-settings:status';
const OPTION_KEYS = Object.freeze([
  'readCurrent',
  'writeCurrent',
  'mainWindowRef',
]);
const WRITE_KEYS = Object.freeze(['config', 'credential']);
const WRITE_CONFIG_KEYS = Object.freeze([
  'base_url',
  'model',
  'timeout_ms',
  'temperature',
  'max_tokens',
]);
const CONFIG_KEYS = Object.freeze([
  'provider_id',
  'base_url',
  'model',
  'timeout_ms',
  'temperature',
  'max_tokens',
  'config_digest',
]);
const REPOSITORY_RESULT_KEYS = Object.freeze([
  'result_version',
  'config',
  'secret_binding',
  'restart_restore',
  'persistence_evidence',
]);
const REPOSITORY_RESULT_VERSION = ['builder-provider-config', 'repository.v1'].join('-');
const ERROR_MESSAGES = Object.freeze({
  builder_provider_settings_forbidden: 'AI provider settings are unavailable.',
  builder_provider_settings_request_invalid: 'AI provider settings could not verify the request.',
  builder_provider_settings_not_found: 'AI provider settings are not configured.',
  builder_provider_settings_unavailable: 'AI provider settings are unavailable.',
  builder_provider_settings_integrity_failed: 'AI provider settings could not be verified.',
  builder_provider_settings_persistence_failed: 'AI provider settings could not be saved.',
  builder_provider_settings_failed: 'AI provider settings are unavailable.',
});
const REPOSITORY_ERROR_CODES = Object.freeze({
  builder_provider_config_repository_invalid: 'builder_provider_settings_request_invalid',
  builder_provider_config_repository_not_found: 'builder_provider_settings_not_found',
  builder_provider_config_repository_unavailable: 'builder_provider_settings_unavailable',
  builder_provider_config_repository_integrity_failed: 'builder_provider_settings_integrity_failed',
  builder_provider_config_repository_persistence_failed: 'builder_provider_settings_persistence_failed',
  builder_provider_config_repository_cleanup_failed: 'builder_provider_settings_persistence_failed',
});
const RETRYABLE_CODES = new Set([
  'builder_provider_settings_unavailable',
  'builder_provider_settings_persistence_failed',
  'builder_provider_settings_failed',
]);

class BuilderProviderSettingsIpcError extends Error {
  constructor(code = 'builder_provider_settings_failed') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_provider_settings_failed';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderProviderSettingsIpcError';
    this.code = selected;
    this.retryable = RETRYABLE_CODES.has(selected);
    this.stack = `${this.name}: ${this.message}`;
  }
}

function ipcError(code) {
  return new BuilderProviderSettingsIpcError(code);
}

function safeErrorCode(error) {
  try {
    if (
      error === null
      || (typeof error !== 'object' && typeof error !== 'function')
      || utilTypes.isProxy(error)
    ) return null;
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
    if (typeof descriptor.value !== 'string') return null;
    if (Object.hasOwn(ERROR_MESSAGES, descriptor.value)) return descriptor.value;
    return Object.hasOwn(REPOSITORY_ERROR_CODES, descriptor.value)
      ? REPOSITORY_ERROR_CODES[descriptor.value]
      : null;
  } catch {
    return null;
  }
}

function normalizeError(error) {
  return ipcError(safeErrorCode(error) ?? 'builder_provider_settings_failed');
}

function isPlainObject(value) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || utilTypes.isProxy(value)
  ) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys, code) {
  if (!isPlainObject(value)) throw ipcError(code);
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) throw ipcError(code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      throw ipcError(code);
    }
  }
  return descriptors;
}

function safeOptions(value) {
  try {
    const descriptors = exactObject(value, OPTION_KEYS, 'builder_provider_settings_failed');
    const methods = {};
    for (const key of OPTION_KEYS) {
      if (typeof descriptors[key].value !== 'function') throw ipcError();
      methods[key] = descriptors[key].value;
    }
    return Object.freeze(methods);
  } catch {
    throw ipcError();
  }
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function activeWebContents(mainWindowRef) {
  try {
    const windowRef = Reflect.apply(mainWindowRef, undefined, []);
    if (!windowRef || (typeof windowRef.isDestroyed === 'function' && windowRef.isDestroyed())) {
      return null;
    }
    const webContents = windowRef.webContents;
    if (
      !webContents
      || (typeof webContents.isDestroyed === 'function' && webContents.isDestroyed())
    ) return null;
    return webContents;
  } catch {
    return null;
  }
}

function assertActiveSender(event, mainWindowRef) {
  const webContents = activeWebContents(mainWindowRef);
  if (!webContents || !event || event.sender !== webContents) {
    throw ipcError('builder_provider_settings_forbidden');
  }
}

function redactedConfig(value) {
  let sanitized;
  try {
    sanitized = sanitizeBuilderProviderConfig(value);
  } catch {
    throw ipcError('builder_provider_settings_integrity_failed');
  }
  const descriptors = {};
  for (const key of CONFIG_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(sanitized, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      throw ipcError('builder_provider_settings_integrity_failed');
    }
    descriptors[key] = descriptor;
  }
  const redacted = {};
  for (const key of CONFIG_KEYS) redacted[key] = descriptors[key].value;
  return freezeDeep(redacted);
}

function exactRepositoryEnvelope(value) {
  const descriptors = exactObject(
    value,
    REPOSITORY_RESULT_KEYS,
    'builder_provider_settings_integrity_failed',
  );
  if (descriptors.result_version.value !== REPOSITORY_RESULT_VERSION) {
    throw ipcError('builder_provider_settings_integrity_failed');
  }
  return descriptors;
}

function redactedEnvelope(result, operation) {
  const descriptors = exactRepositoryEnvelope(result);
  return freezeDeep({
    result_version: 'builder-provider-settings-ipc-adapter.v1',
    operation,
    configured: true,
    config: redactedConfig(descriptors.config.value),
    credential_status: 'stored',
  });
}

function unconfiguredEnvelope(operation) {
  return freezeDeep({
    result_version: 'builder-provider-settings-ipc-adapter.v1',
    operation,
    configured: false,
    config: null,
    credential_status: 'missing',
  });
}

function safeWriteRequest(value) {
  const descriptors = exactObject(value, WRITE_KEYS, 'builder_provider_settings_request_invalid');
  const configDescriptors = exactObject(
    descriptors.config.value,
    WRITE_CONFIG_KEYS,
    'builder_provider_settings_request_invalid',
  );
  return freezeDeep({
    config: {
      base_url: configDescriptors.base_url.value,
      model: configDescriptors.model.value,
      timeout_ms: configDescriptors.timeout_ms.value,
      temperature: configDescriptors.temperature.value,
      max_tokens: configDescriptors.max_tokens.value,
      secret_ref: {
        ref_version: BUILDER_PROVIDER_SECRET_REF_VERSION,
        provider_id: BUILDER_PROVIDER_ID,
        secret_id: BUILDER_PROVIDER_SECRET_ID,
      },
    },
    credential: descriptors.credential.value,
  });
}

function isNotFound(error) {
  return safeErrorCode(error) === 'builder_provider_settings_not_found';
}

function createBuilderProviderSettingsIpcAdapter(rawOptions) {
  const options = safeOptions(rawOptions);

  function invoke(event, rawArguments, method, expectedArguments, operation) {
    try {
      assertActiveSender(event, options.mainWindowRef);
      if (rawArguments.length !== expectedArguments) {
        throw ipcError('builder_provider_settings_request_invalid');
      }
      const result = Reflect.apply(method, undefined, rawArguments);
      return redactedEnvelope(result, operation);
    } catch (error) {
      throw normalizeError(error);
    }
  }

  return Object.freeze({
    adapter_id: 'builder_provider_settings.controlled_ipc_adapter.v1',
    namespace: 'providerSettings',
    preload_namespace: 'window.clawfabricBuilder.providerSettings',
    channels: Object.freeze({
      readCurrent: Object.freeze({
        channel: READ_CURRENT_CHANNEL,
        method: 'readCurrent',
        invoke(event, ...rawArguments) {
          try {
            return invoke(event, rawArguments, options.readCurrent, 0, 'current_loaded');
          } catch (error) {
            if (isNotFound(error)) return unconfiguredEnvelope('current_loaded');
            throw error;
          }
        },
      }),
      replaceCurrent: Object.freeze({
        channel: REPLACE_CURRENT_CHANNEL,
        method: 'replaceCurrent',
        invoke(event, ...rawArguments) {
          try {
            assertActiveSender(event, options.mainWindowRef);
            if (rawArguments.length !== 1) {
              throw ipcError('builder_provider_settings_request_invalid');
            }
            const result = Reflect.apply(
              options.writeCurrent,
              undefined,
              [safeWriteRequest(rawArguments[0])],
            );
            return redactedEnvelope(result, 'current_replaced');
          } catch (error) {
            throw normalizeError(error);
          }
        },
      }),
      status: Object.freeze({
        channel: STATUS_CHANNEL,
        method: 'status',
        invoke(event, ...rawArguments) {
          try {
            const current = invoke(event, rawArguments, options.readCurrent, 0, 'status_loaded');
            return freezeDeep({
              status_version: 'builder-provider-settings-status.v1',
              configured: current.configured,
              config_digest: current.config.config_digest,
              credential_status: current.credential_status,
            });
          } catch (error) {
            if (isNotFound(error)) {
              return freezeDeep({
                status_version: 'builder-provider-settings-status.v1',
                configured: false,
                config_digest: null,
                credential_status: 'missing',
              });
            }
            throw error;
          }
        },
      }),
    }),
    exposed_methods: Object.freeze(['readCurrent', 'replaceCurrent', 'status']),
    authority: Object.freeze({
      provider_config_repository_injected: true,
      active_renderer_required: true,
      generic_provider_authority_reused: false,
      direct_electron_registration: false,
      direct_preload_exposure: false,
      credential_readback: false,
      encrypted_secret_readback: false,
      secret_binding_readback: false,
      persistence_evidence_readback: false,
    }),
  });
}

module.exports = Object.freeze({
  READ_CURRENT_CHANNEL,
  REPLACE_CURRENT_CHANNEL,
  STATUS_CHANNEL,
  BuilderProviderSettingsIpcError,
  createBuilderProviderSettingsIpcAdapter,
});
