'use strict';

const { types: utilTypes } = require('node:util');

const GENERATE_CHANNEL = 'clawfabric-builder:code-generator:generate';
const GENERATE_APPROVED_PLAN_CHANNEL = 'clawfabric-builder:code-generator:generate-approved-plan';
const SUBMIT_CHANNEL = 'clawfabric-builder:code-generator:submit';
const GENERATION_STARTED_CHANNEL = 'clawfabric-builder:code-generator:started';
const GENERATION_OUTPUT_CHANNEL = 'clawfabric-builder:code-generator:output';
const RETRY_GENERATE_CHANNEL = 'clawfabric-builder:code-generator:retry';
const ANSWER_CHANNEL = 'clawfabric-builder:code-generator:answer';
const CANCEL_CHANNEL = 'clawfabric-builder:code-generator:cancel';
const STEER_CHANNEL = 'clawfabric-builder:code-generator:steer';
const AVAILABILITY_CHANNEL = 'clawfabric-builder:code-generator:availability';
const RESTORE_DRAFT_CHANNEL = 'clawfabric-builder:code-generator:restore-draft';
const REJECT_DRAFT_CHANNEL = 'clawfabric-builder:code-generator:reject-draft';
const GENERATE_RESULT_VERSION = 'builder-generation-ipc-result.v1';
const MAX_PLAIN_DATA_NODES = 20_000;
const MAX_PLAIN_DATA_ENTRIES = 20_000;
const MAX_PLAIN_DATA_UTF8_BYTES = 1024 * 1024;
const MAX_PLAIN_DATA_DEPTH = 64;
const OPTION_KEYS = Object.freeze([
  'generate',
  'generateApprovedPlan',
  'submit',
  'retry',
  'answer',
  'restoreDraft',
  'rejectDraft',
  'cancel',
  'steer',
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
  builder_generation_provider_http_error: 'The AI service could not make this project.',
  builder_generation_structured_response_invalid: 'The generated project could not be prepared.',
  builder_generation_static_preview_contract_rejected: 'The generated project is not supported by the static preview.',
  builder_generation_failed: 'The project draft could not be generated.',
});
const PUBLIC_FAILURE_RETRYABILITY = Object.freeze({
  builder_generation_parent_unavailable: true,
  builder_generation_provider_unavailable: false,
  builder_generation_timeout: true,
  builder_generation_provider_http_error: true,
  builder_generation_structured_response_invalid: true,
  builder_generation_static_preview_contract_rejected: true,
  builder_generation_failed: true,
});
const RETRYABLE_CODES = new Set(
  Object.entries(PUBLIC_FAILURE_RETRYABILITY)
    .filter(([, retryable]) => retryable)
    .map(([code]) => code),
);
const CONTROL_ERROR_CODES = new Set([
  'builder_generation_forbidden',
  'builder_generation_request_invalid',
  'builder_generation_parent_unavailable',
  'builder_generation_provider_unavailable',
  'builder_generation_cancelled',
  'builder_generation_timeout',
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
  const code = safeErrorCode(error);
  return ipcError(code !== null && CONTROL_ERROR_CODES.has(code) ? code : 'builder_generation_failed');
}

function accountUtf8(value, state) {
  if (value.length > MAX_PLAIN_DATA_UTF8_BYTES - state.utf8Bytes) throw ipcError();
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes > MAX_PLAIN_DATA_UTF8_BYTES - state.utf8Bytes) throw ipcError();
  state.utf8Bytes += bytes;
}

function clonePlainData(value, state = {
  entries: 0,
  nodes: 0,
  seen: new WeakSet(),
  utf8Bytes: 0,
}, depth = 0) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    accountUtf8(value, state);
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (
    typeof value !== 'object'
    || utilTypes.isProxy(value)
    || state.seen.has(value)
    || depth > MAX_PLAIN_DATA_DEPTH
    || state.nodes >= MAX_PLAIN_DATA_NODES
  ) throw ipcError();
  state.seen.add(value);
  state.nodes += 1;
  const isArray = Array.isArray(value);
  if (isArray && value.length > MAX_PLAIN_DATA_ENTRIES - state.entries) throw ipcError();
  const prototype = Object.getPrototypeOf(value);
  if ((isArray && prototype !== Array.prototype)
    || (!isArray && prototype !== Object.prototype && prototype !== null)) throw ipcError();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) throw ipcError();
  const entryCount = keys.length - (isArray ? 1 : 0);
  if (entryCount > MAX_PLAIN_DATA_ENTRIES - state.entries) throw ipcError();
  for (const key of keys) accountUtf8(key, state);
  state.entries += entryCount;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length) throw ipcError();
  if (isArray && (keys.length !== value.length + 1 || !Object.hasOwn(descriptors, 'length'))) {
    throw ipcError();
  }
  const output = isArray ? [] : {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw ipcError();
    if (isArray && key === 'length') continue;
    if (!descriptor.enumerable || (isArray && !/^(?:0|[1-9][0-9]*)$/u.test(key))) throw ipcError();
    if (!isArray && ['__proto__', 'prototype', 'constructor'].includes(key)) throw ipcError();
    output[key] = clonePlainData(descriptor.value, state, depth + 1);
  }
  return Object.freeze(output);
}

function publicFailureCode(error) {
  const code = safeErrorCode(error);
  return code !== null && Object.hasOwn(PUBLIC_FAILURE_RETRYABILITY, code)
    ? code
    : null;
}

function failureEnvelope(code) {
  return Object.freeze({
    version: GENERATE_RESULT_VERSION,
    ok: false,
    error: Object.freeze({
      code,
      retryable: PUBLIC_FAILURE_RETRYABILITY[code],
    }),
  });
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

  async function invokeResult(event, rawArguments, method) {
    try {
      assertActiveSender(event, options.mainWindowRef);
      if (rawArguments.length !== 1) throw ipcError('builder_generation_request_invalid');
    } catch (error) {
      throw normalizeError(error);
    }
    try {
      const result = await Reflect.apply(method, undefined, rawArguments);
      return Object.freeze({
        version: GENERATE_RESULT_VERSION,
        ok: true,
        result: clonePlainData(result),
      });
    } catch (error) {
      const code = publicFailureCode(error);
      if (code !== null) return failureEnvelope(code);
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
          return invokeResult(event, rawArguments, options.generate);
        },
      }),
      generateApprovedPlan: Object.freeze({
        channel: GENERATE_APPROVED_PLAN_CHANNEL,
        method: 'generateApprovedPlan',
        invoke(event, ...rawArguments) {
          return invokeResult(event, rawArguments, options.generateApprovedPlan);
        },
      }),
      submit: Object.freeze({
        channel: SUBMIT_CHANNEL,
        method: 'submit',
        invoke(event, ...rawArguments) {
          return invokeResult(event, rawArguments, options.submit);
        },
      }),
      retry: Object.freeze({
        channel: RETRY_GENERATE_CHANNEL,
        method: 'retry',
        invoke(event, ...rawArguments) {
          return invokeResult(event, rawArguments, options.retry);
        },
      }),
      answer: Object.freeze({
        channel: ANSWER_CHANNEL,
        method: 'answer',
        invoke(event, ...rawArguments) {
          return invokeResult(event, rawArguments, options.answer);
        },
      }),
      restoreDraft: Object.freeze({
        channel: RESTORE_DRAFT_CHANNEL,
        method: 'restoreDraft',
        invoke(event, ...rawArguments) {
          return invokeResult(event, rawArguments, options.restoreDraft);
        },
      }),
      rejectDraft: Object.freeze({
        channel: REJECT_DRAFT_CHANNEL,
        method: 'rejectDraft',
        invoke(event, ...rawArguments) {
          return invokeResult(event, rawArguments, options.rejectDraft);
        },
      }),
      cancel: Object.freeze({
        channel: CANCEL_CHANNEL,
        method: 'cancel',
        invoke(event, ...rawArguments) {
          return invoke(event, rawArguments, options.cancel, 1);
        },
      }),
      steer: Object.freeze({
        channel: STEER_CHANNEL,
        method: 'steer',
        invoke(event, ...rawArguments) {
          return invoke(event, rawArguments, options.steer, 1);
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
    exposed_methods: Object.freeze([
      'generate',
      'generateApprovedPlan',
      'submit',
      'retry',
      'answer',
      'restoreDraft',
      'rejectDraft',
      'cancel',
      'steer',
      'availability',
    ]),
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
  GENERATE_APPROVED_PLAN_CHANNEL,
  SUBMIT_CHANNEL,
  GENERATION_STARTED_CHANNEL,
  GENERATION_OUTPUT_CHANNEL,
  RETRY_GENERATE_CHANNEL,
  ANSWER_CHANNEL,
  CANCEL_CHANNEL,
  STEER_CHANNEL,
  AVAILABILITY_CHANNEL,
  RESTORE_DRAFT_CHANNEL,
  REJECT_DRAFT_CHANNEL,
  GENERATE_RESULT_VERSION,
  BuilderGenerationIpcError,
  createBuilderGenerationIpcAdapter,
});
