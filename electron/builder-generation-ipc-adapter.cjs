'use strict';

const { types: utilTypes } = require('node:util');

const GENERATE_CHANNEL = 'clawfabric-builder:code-generator:generate';
const CANCEL_CHANNEL = 'clawfabric-builder:code-generator:cancel';
const AVAILABILITY_CHANNEL = 'clawfabric-builder:code-generator:availability';
const OPTION_KEYS = Object.freeze([
  'generate',
  'cancel',
  'availability',
  'mainWindowRef',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_generation_forbidden: 'AI project generation is unavailable.',
  builder_generation_request_invalid: 'This project request could not be verified.',
  builder_generation_parent_unavailable: 'The current project version is unavailable.',
  builder_generation_provider_unavailable: 'AI project generation is not configured.',
  builder_generation_cancelled: 'AI project generation was cancelled.',
  builder_generation_timeout: 'AI project generation timed out.',
  builder_generation_response_invalid: 'The generated project could not be used.',
  builder_generation_failed: 'The project draft could not be generated.',
});
const RETRYABLE_CODES = new Set([
  'builder_generation_provider_unavailable',
  'builder_generation_timeout',
  'builder_generation_response_invalid',
  'builder_generation_failed',
]);

class BuilderGenerationIpcError extends Error {
  constructor(code = 'builder_generation_failed') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_generation_failed';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderGenerationIpcError';
    this.code = selected;
    this.retryable = RETRYABLE_CODES.has(selected);
    this.stack = `${this.name}: ${this.message}`;
  }
}

function ipcError(code) {
  return new BuilderGenerationIpcError(code);
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
    return typeof descriptor.value === 'string' && Object.hasOwn(ERROR_MESSAGES, descriptor.value)
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

function normalizeError(error) {
  return ipcError(safeErrorCode(error) ?? 'builder_generation_failed');
}

function safeOptions(value) {
  try {
    if (
      value === null
      || typeof value !== 'object'
      || Array.isArray(value)
      || utilTypes.isProxy(value)
      || Object.getPrototypeOf(value) !== Object.prototype
    ) throw ipcError();
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== OPTION_KEYS.length
      || keys.some((key) => typeof key !== 'string' || !OPTION_KEYS.includes(key))
    ) throw ipcError();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const methods = {};
    for (const key of OPTION_KEYS) {
      const descriptor = descriptors[key];
      if (
        !descriptor
        || descriptor.enumerable !== true
        || !Object.hasOwn(descriptor, 'value')
        || typeof descriptor.value !== 'function'
      ) throw ipcError();
      methods[key] = descriptor.value;
    }
    return Object.freeze(methods);
  } catch {
    throw ipcError();
  }
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
    throw ipcError('builder_generation_forbidden');
  }
}

function createBuilderGenerationIpcAdapter(rawOptions) {
  const options = safeOptions(rawOptions);

  async function invoke(event, rawArguments, method, expectedArguments) {
    try {
      assertActiveSender(event, options.mainWindowRef);
      if (rawArguments.length !== expectedArguments) {
        throw ipcError('builder_generation_request_invalid');
      }
      return await Reflect.apply(method, undefined, rawArguments);
    } catch (error) {
      throw normalizeError(error);
    }
  }

  return Object.freeze({
    adapter_id: 'builder_code_generation.controlled_ipc_adapter.v1',
    namespace: 'builderCodeGenerator',
    preload_namespace: 'window.clawfabricBuilder.codeGenerator',
    channels: Object.freeze({
      generate: Object.freeze({
        channel: GENERATE_CHANNEL,
        method: 'generate',
        invoke(event, ...rawArguments) {
          return invoke(event, rawArguments, options.generate, 1);
        },
      }),
      cancel: Object.freeze({
        channel: CANCEL_CHANNEL,
        method: 'cancel',
        invoke(event, ...rawArguments) {
          return invoke(event, rawArguments, options.cancel, 1);
        },
      }),
      availability: Object.freeze({
        channel: AVAILABILITY_CHANNEL,
        method: 'availability',
        invoke(event, ...rawArguments) {
          return invoke(event, rawArguments, options.availability, 0);
        },
      }),
    }),
    exposed_methods: Object.freeze(['generate', 'cancel', 'availability']),
    authority: Object.freeze({
      host_adapter_injected: true,
      active_renderer_required: true,
      generic_provider_authority_reused: false,
      direct_electron_registration: false,
      direct_preload_exposure: false,
      provider_settings_exposed: false,
      credential_readback: false,
    }),
  });
}

module.exports = Object.freeze({
  GENERATE_CHANNEL,
  CANCEL_CHANNEL,
  AVAILABILITY_CHANNEL,
  BuilderGenerationIpcError,
  createBuilderGenerationIpcAdapter,
});
