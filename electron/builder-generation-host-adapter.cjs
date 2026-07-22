'use strict';

const { types: utilTypes } = require('node:util');

const {
  createBuilderGenerationPromptDescriptor,
  projectBuilderGenerationResult,
  sanitizeBuilderGenerationRequest,
} = require('./builder-generation-kernel.cjs');
const {
  createBuilderOpenAICompatibleTransport,
} = require('./builder-openai-compatible-transport.cjs');
const {
  sanitizeBuilderProviderConfig,
} = require('./builder-provider-config.cjs');
const {
  sanitizeBuilderProjectRevisionRecord,
} = require('./builder-project-revision-record.cjs');

const BUILDER_GENERATION_AVAILABILITY_VERSION = 'builder-generation-availability.v1';
const BUILDER_PROVIDER_SECRET_RESOLUTION_VERSION = 'builder-provider-secret-resolution.v1';
const REPOSITORY_RESULT_VERSION = 'builder-project-repository-result.v1';
const PERSISTENCE_EVIDENCE_KEYS = Object.freeze([
  'evidence_version', 'operation', 'authority_scope', 'cross_process_cas',
  'sudden_power_loss_durability', 'revision_file_fsync', 'immutable_revision_publish',
  'revision_parent_directory_fsync', 'head_file_fsync', 'head_publish',
  'head_parent_directory_fsync', 'reopened_hash_verified',
]);
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ERROR_MESSAGES = Object.freeze({
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

class BuilderGenerationHostAdapterError extends Error {
  constructor(code = 'builder_generation_failed') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code) ? code : 'builder_generation_failed';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderGenerationHostAdapterError';
    this.code = selected;
    this.retryable = [
      'builder_generation_provider_unavailable',
      'builder_generation_timeout',
      'builder_generation_provider_http_error',
      'builder_generation_structured_response_invalid',
      'builder_generation_static_preview_contract_rejected',
      'builder_generation_failed',
    ].includes(selected);
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderGenerationHostAdapterError(code);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys, code) {
  if (!isPlainObject(value)) fail(code);
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== 'string' || !keys.includes(key))) fail(code);
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail(code);
  }
  return value;
}

function ownValue(value, key, code) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail(code);
  return descriptor.value;
}

function requiredMethod(value) {
  if (typeof value !== 'function') fail('builder_generation_provider_unavailable');
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

function sanitizeSecretResolution(value, expectedRef) {
  const source = exactObject(
    value,
    ['resolution_version', 'secret_ref', 'credential'],
    'builder_generation_provider_unavailable',
  );
  const ref = exactObject(
    ownValue(source, 'secret_ref', 'builder_generation_provider_unavailable'),
    ['ref_version', 'provider_id', 'secret_id'],
    'builder_generation_provider_unavailable',
  );
  for (const key of ['ref_version', 'provider_id', 'secret_id']) {
    if (ownValue(ref, key, 'builder_generation_provider_unavailable') !== expectedRef[key]) {
      fail('builder_generation_provider_unavailable');
    }
  }
  const credential = ownValue(source, 'credential', 'builder_generation_provider_unavailable');
  if (
    ownValue(source, 'resolution_version', 'builder_generation_provider_unavailable')
      !== BUILDER_PROVIDER_SECRET_RESOLUTION_VERSION
    || typeof credential !== 'string'
    || credential.length === 0
    || credential.trim() !== credential
    || credential.length > 16 * 1024
    || hasUnpairedSurrogate(credential)
    || Buffer.byteLength(credential, 'utf8') > 16 * 1024
  ) fail('builder_generation_provider_unavailable');
  for (let index = 0; index < credential.length; index += 1) {
    const code = credential.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      fail('builder_generation_provider_unavailable');
    }
  }
  return credential;
}

function sanitizeParentEnvelope(value, request) {
  const envelope = exactObject(
    value,
    ['result_version', 'record', 'restart_restore', 'persistence_evidence'],
    'builder_generation_parent_unavailable',
  );
  if (
    ownValue(envelope, 'result_version', 'builder_generation_parent_unavailable') !== REPOSITORY_RESULT_VERSION
    || ownValue(envelope, 'restart_restore', 'builder_generation_parent_unavailable') !== true
  ) fail('builder_generation_parent_unavailable');
  const persistenceEvidence = exactObject(
    ownValue(envelope, 'persistence_evidence', 'builder_generation_parent_unavailable'),
    PERSISTENCE_EVIDENCE_KEYS,
    'builder_generation_parent_unavailable',
  );
  const expectedEvidence = {
    evidence_version: REPOSITORY_RESULT_VERSION,
    operation: 'revision_loaded',
    authority_scope: 'single_main_process_serialized_expected_head',
    cross_process_cas: 'not_proven',
    sudden_power_loss_durability: 'not_proven',
    revision_file_fsync: 'not_performed',
    immutable_revision_publish: 'not_performed',
    revision_parent_directory_fsync: 'not_performed',
    head_file_fsync: 'not_performed',
    head_publish: 'not_performed',
    head_parent_directory_fsync: 'not_performed',
    reopened_hash_verified: true,
  };
  for (const key of PERSISTENCE_EVIDENCE_KEYS) {
    if (ownValue(persistenceEvidence, key, 'builder_generation_parent_unavailable') !== expectedEvidence[key]) {
      fail('builder_generation_parent_unavailable');
    }
  }
  let record;
  try {
    record = sanitizeBuilderProjectRevisionRecord(
      ownValue(envelope, 'record', 'builder_generation_parent_unavailable'),
    );
  } catch {
    fail('builder_generation_parent_unavailable');
  }
  if (
    record.project_id !== request.project_id
    || record.revision !== request.parent_revision.revision
    || record.revision_digest !== request.parent_revision.revision_digest
  ) fail('builder_generation_parent_unavailable');
  return record;
}

function sanitizeTransportResult(value) {
  const source = exactObject(
    value,
    ['transport_version', 'generated_text'],
    'builder_generation_structured_response_invalid',
  );
  if (ownValue(source, 'transport_version', 'builder_generation_structured_response_invalid')
    !== 'builder-openai-compatible-transport.v1') fail('builder_generation_structured_response_invalid');
  const generatedText = ownValue(source, 'generated_text', 'builder_generation_structured_response_invalid');
  if (typeof generatedText !== 'string') fail('builder_generation_structured_response_invalid');
  return generatedText;
}

function sanitizeCancelRequest(value) {
  const source = exactObject(value, ['request_id'], 'builder_generation_request_invalid');
  const requestId = ownValue(source, 'request_id', 'builder_generation_request_invalid');
  if (typeof requestId !== 'string' || !DIGEST_PATTERN.test(requestId)) fail('builder_generation_request_invalid');
  return requestId;
}

function mapTransportError(error, signal) {
  let code = '';
  if (error !== null && (typeof error === 'object' || typeof error === 'function') && !utilTypes.isProxy(error)) {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    if (descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string') {
      code = descriptor.value;
    }
  }
  if (signal.aborted || code === 'builder_provider_cancelled') fail('builder_generation_cancelled');
  if (code === 'builder_provider_timeout') fail('builder_generation_timeout');
  if (code === 'builder_provider_http_error') fail('builder_generation_provider_http_error');
  if (code === 'builder_provider_structured_response_invalid'
    || code === 'builder_provider_response_too_large') fail('builder_generation_structured_response_invalid');
  if (code === 'builder_provider_unavailable'
    || code === 'builder_provider_request_invalid') fail('builder_generation_provider_unavailable');
  fail('builder_generation_failed');
}

function mapKernelError(error) {
  let code = '';
  if (error !== null && (typeof error === 'object' || typeof error === 'function') && !utilTypes.isProxy(error)) {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    if (descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string') {
      code = descriptor.value;
    }
  }
  if (code === 'builder_generation_static_preview_contract_rejected') {
    fail('builder_generation_static_preview_contract_rejected');
  }
  if (code === 'builder_generation_structured_response_invalid') {
    fail('builder_generation_structured_response_invalid');
  }
  fail('builder_generation_failed');
}

function createBuilderGenerationHostAdapter(options = {}) {
  const readProviderConfig = requiredMethod(options.readProviderConfig);
  const resolveSecret = requiredMethod(options.resolveSecret);
  const loadParentRevision = requiredMethod(options.loadParentRevision);
  const transport = options.transport === undefined
    ? createBuilderOpenAICompatibleTransport()
    : requiredMethod(options.transport);
  const inFlight = new Map();

  function providerAuthority() {
    try {
      const config = sanitizeBuilderProviderConfig(Reflect.apply(readProviderConfig, undefined, []));
      const credential = sanitizeSecretResolution(
        Reflect.apply(resolveSecret, undefined, [config.secret_ref]),
        config.secret_ref,
      );
      return { config, credential };
    } catch {
      fail('builder_generation_provider_unavailable');
    }
  }

  async function parentRecord(request, signal) {
    if (request.parent_revision === null) return null;
    if (signal.aborted) fail('builder_generation_cancelled');
    let envelope;
    let removeAbortListener = () => {};
    try {
      const resolution = Promise.resolve(Reflect.apply(loadParentRevision, undefined, [{
        project_id: request.project_id,
        revision: request.parent_revision.revision,
        revision_digest: request.parent_revision.revision_digest,
      }]));
      const aborted = new Promise((_resolve, reject) => {
        const onAbort = () => reject(new BuilderGenerationHostAdapterError('builder_generation_cancelled'));
        removeAbortListener = () => signal.removeEventListener('abort', onAbort);
        signal.addEventListener('abort', onAbort, { once: true });
      });
      envelope = await Promise.race([resolution, aborted]);
    } catch {
      if (signal.aborted) fail('builder_generation_cancelled');
      fail('builder_generation_parent_unavailable');
    } finally {
      try { removeAbortListener(); } catch { /* best-effort listener cleanup */ }
    }
    if (signal.aborted) fail('builder_generation_cancelled');
    return sanitizeParentEnvelope(envelope, request);
  }

  async function run(request, controller) {
    const parent = await parentRecord(request, controller.signal);
    let descriptor;
    try {
      descriptor = createBuilderGenerationPromptDescriptor({
        request,
        parent_revision_record: parent,
      });
    } catch {
      fail('builder_generation_parent_unavailable');
    }
    if (controller.signal.aborted) fail('builder_generation_cancelled');
    const { config, credential } = providerAuthority();
    let transportResult;
    try {
      transportResult = await Reflect.apply(transport, undefined, [{
        base_url: config.base_url,
        model: config.model,
        credential,
        messages: [
          { role: 'system', content: descriptor.system_instruction },
          { role: 'user', content: descriptor.user_instruction },
        ],
        timeout_ms: config.timeout_ms,
        ...(config.temperature === null ? {} : { temperature: config.temperature }),
        ...(config.max_tokens === null ? {} : { max_tokens: config.max_tokens }),
      }, { signal: controller.signal }]);
    } catch (error) {
      mapTransportError(error, controller.signal);
    }
    if (controller.signal.aborted) fail('builder_generation_cancelled');
    const generatedText = sanitizeTransportResult(transportResult);
    try {
      return projectBuilderGenerationResult({
        request,
        parent_revision_record: parent,
        generated_text: generatedText,
      });
    } catch (error) {
      mapKernelError(error);
    }
  }

  function generate(rawRequest) {
    let request;
    try { request = sanitizeBuilderGenerationRequest(rawRequest); } catch {
      return Promise.reject(new BuilderGenerationHostAdapterError('builder_generation_request_invalid'));
    }
    const existing = inFlight.get(request.request_digest);
    if (existing) return existing.promise;
    const controller = new AbortController();
    const entry = { controller, promise: null };
    entry.promise = run(request, controller).finally(() => {
      if (inFlight.get(request.request_digest) === entry) inFlight.delete(request.request_digest);
    });
    inFlight.set(request.request_digest, entry);
    return entry.promise;
  }

  function cancel(rawRequest) {
    const requestId = sanitizeCancelRequest(rawRequest);
    const entry = inFlight.get(requestId);
    if (!entry) return Object.freeze({ request_id: requestId, cancelled: false });
    entry.controller.abort();
    return Object.freeze({ request_id: requestId, cancelled: true });
  }

  function availability() {
    try {
      providerAuthority();
      return Object.freeze({
        version: BUILDER_GENERATION_AVAILABILITY_VERSION,
        available: true,
        reason: 'ready',
        supports_cancel: true,
      });
    } catch {
      return Object.freeze({
        version: BUILDER_GENERATION_AVAILABILITY_VERSION,
        available: false,
        reason: 'not_configured',
        supports_cancel: true,
      });
    }
  }

  return Object.freeze({ generate, cancel, availability });
}

module.exports = Object.freeze({
  BUILDER_GENERATION_AVAILABILITY_VERSION,
  BUILDER_PROVIDER_SECRET_RESOLUTION_VERSION,
  BuilderGenerationHostAdapterError,
  createBuilderGenerationHostAdapter,
});
