'use strict';

const { types: utilTypes } = require('node:util');

const {
  createBuilderExplanationPromptDescriptor,
  createBuilderGenerationPromptDescriptor,
  createBuilderPlanPromptDescriptor,
  projectBuilderExplanationResult,
  projectBuilderDraftContinuationGenerationResult,
  projectBuilderGenerationResult,
  projectBuilderPlanProposalResult,
  sanitizeBuilderGenerationRequest,
} = require('./builder-generation-kernel.cjs');
const {
  createBuilderOpenAICompatibleTransport,
} = require('./builder-openai-compatible-transport.cjs');
const {
  sanitizeBuilderProviderConfig,
} = require('./builder-provider-config.cjs');

const BUILDER_GENERATION_AVAILABILITY_VERSION = 'builder-generation-availability.v1';
const BUILDER_PROVIDER_SECRET_RESOLUTION_VERSION = 'builder-provider-secret-resolution.v1';
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const GENERATION_CONTEXT_KEYS = Object.freeze([
  'project_id',
  'base_revision_evidence',
  'base_source_tree',
  'conversation_events',
  'turn_id',
  'task_id',
  'run_id',
  'git_request_id',
]);
const DRAFT_CONTINUATION_CONTEXT_KEYS = Object.freeze([
  'project_id',
  'prompt_base_source_tree',
  'candidate_base_revision_evidence',
  'candidate_base_source_tree',
  'conversation_events',
  'turn_id',
  'task_id',
  'run_id',
  'git_request_id',
]);
const EXPLANATION_CONTEXT_KEYS = Object.freeze([
  'project_id',
  'base_revision_evidence',
  'base_source_tree',
  'conversation_events',
  'turn_id',
  'task_id',
  'run_id',
]);
const PLAN_CONTEXT_KEYS = Object.freeze([
  'project_id',
  'source_context_result',
  'conversation_events',
  'turn_id',
  'task_id',
  'run_id',
  'proposed_at_ms',
]);
const RUN_PROGRESS_STAGES = Object.freeze([
  'context_ready',
  'provider_request_started',
  'provider_response_received',
  'result_preparing',
]);
const PLAN_REPAIR_USER_INSTRUCTION = [
  'The previous plan response could not be verified.',
  'Return one JSON object only.',
  'Use exactly kind, title, summary, and steps.',
  'Set kind to builder_project_plan_proposal.',
  'steps must contain 1 to 12 objects, each with exactly title, purpose, and expected_change.',
  'Keep title and each step title at 120 characters or fewer.',
  'Keep summary at 1200 characters or fewer.',
  'Keep each step purpose and expected_change at 360 characters or fewer.',
  'Do not use markdown fences or add any other fields.',
].join(' ');
const ERROR_MESSAGES = Object.freeze({
  builder_generation_request_invalid: 'This project request could not be verified.',
  builder_generation_base_unavailable: 'The current project source is unavailable.',
  builder_generation_provider_unavailable: 'AI project generation is not configured.',
  builder_generation_cancelled: 'AI project generation was cancelled.',
  builder_generation_timeout: 'AI project generation timed out.',
  builder_generation_provider_http_error: 'The AI service could not make this project.',
  builder_generation_provider_transport_error: 'The AI service could not be reached.',
  builder_generation_structured_response_invalid: 'The generated project could not be prepared.',
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
      'builder_generation_base_unavailable',
      'builder_generation_timeout',
      'builder_generation_provider_http_error',
      'builder_generation_provider_transport_error',
      'builder_generation_structured_response_invalid',
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

function requiredMethod(value, code = 'builder_generation_provider_unavailable') {
  if (typeof value !== 'function') fail(code);
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
  if (code === 'builder_provider_transport_error') fail('builder_generation_provider_transport_error');
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
  if (code === 'builder_generation_base_unavailable') fail('builder_generation_base_unavailable');
  if (code === 'builder_generation_structured_response_invalid') fail('builder_generation_structured_response_invalid');
  if (code === 'builder_generation_request_invalid') fail('builder_generation_request_invalid');
  fail('builder_generation_failed');
}

function kernelErrorCode(error) {
  try {
    if (error === null || (typeof error !== 'object' && typeof error !== 'function') || utilTypes.isProxy(error)) {
      return null;
    }
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    return descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string'
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

function createBuilderGenerationHostAdapter(options = {}) {
  const readProviderConfig = requiredMethod(options.readProviderConfig);
  const resolveSecret = requiredMethod(options.resolveSecret);
  const buildGenerationContext = requiredMethod(options.buildGenerationContext, 'builder_generation_base_unavailable');
  const buildDraftContinuationContext = options.buildDraftContinuationContext === undefined
    ? null
    : requiredMethod(options.buildDraftContinuationContext, 'builder_generation_base_unavailable');
  const buildExplanationContext = options.buildExplanationContext === undefined
    ? null
    : requiredMethod(options.buildExplanationContext, 'builder_generation_base_unavailable');
  const buildPlanContext = options.buildPlanContext === undefined
    ? null
    : requiredMethod(options.buildPlanContext, 'builder_generation_base_unavailable');
  const transport = options.transport === undefined
    ? createBuilderOpenAICompatibleTransport()
    : requiredMethod(options.transport);
  const onProgress = options.onProgress === undefined ? null : requiredMethod(options.onProgress);
  const onOutputDelta = options.onOutputDelta === undefined ? null : requiredMethod(options.onOutputDelta);
  const inFlight = new Map();
  const draftContinuationInFlight = new Map();
  const explanationInFlight = new Map();
  const planInFlight = new Map();

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

  async function boundedContext(request, signal, buildContext, keys) {
    if (signal.aborted) fail('builder_generation_cancelled');
    let removeAbortListener = () => {};
    try {
      const resolution = Promise.resolve(Reflect.apply(buildContext, undefined, [request]));
      const aborted = new Promise((_resolve, reject) => {
        const onAbort = () => reject(new BuilderGenerationHostAdapterError('builder_generation_cancelled'));
        removeAbortListener = () => signal.removeEventListener('abort', onAbort);
        signal.addEventListener('abort', onAbort, { once: true });
      });
      return exactObject(
        await Promise.race([resolution, aborted]),
        keys,
        'builder_generation_base_unavailable',
      );
    } catch {
      if (signal.aborted) fail('builder_generation_cancelled');
      fail('builder_generation_base_unavailable');
    } finally {
      try { removeAbortListener(); } catch { /* best-effort listener cleanup */ }
    }
  }

  async function progressContext(context, stage, keys, signal) {
    if (signal.aborted) fail('builder_generation_cancelled');
    if (onProgress === null) return context;
    if (!RUN_PROGRESS_STAGES.includes(stage)) fail('builder_generation_failed');
    try {
      return exactObject(
        await Reflect.apply(onProgress, undefined, [{ context, stage }]),
        keys,
        'builder_generation_base_unavailable',
      );
    } catch {
      if (signal.aborted) fail('builder_generation_cancelled');
      fail('builder_generation_failed');
    }
  }

  async function notifyOutputDelta(context, rawDelta, signal) {
    if (onOutputDelta === null || signal.aborted) return;
    try {
      const source = exactObject(rawDelta, ['delta_text'], 'builder_generation_structured_response_invalid');
      const deltaText = ownValue(source, 'delta_text', 'builder_generation_structured_response_invalid');
      if (
        typeof deltaText !== 'string'
        || deltaText.length === 0
        || hasUnpairedSurrogate(deltaText)
        || Buffer.byteLength(deltaText, 'utf8') > 64 * 1024
      ) return;
      await Promise.resolve(Reflect.apply(onOutputDelta, undefined, [Object.freeze({
        context,
        delta_text: deltaText,
      })]));
    } catch {
      // Output observation is advisory and cannot replace the final bounded generation result.
    }
  }

  async function run(request, controller) {
    let context = await boundedContext(
      request,
      controller.signal,
      buildGenerationContext,
      GENERATION_CONTEXT_KEYS,
    );
    let descriptor;
    try {
      descriptor = createBuilderGenerationPromptDescriptor({
        request,
        base_source_tree: ownValue(context, 'base_source_tree', 'builder_generation_base_unavailable'),
        conversation_events: ownValue(context, 'conversation_events', 'builder_generation_base_unavailable'),
      });
    } catch (error) {
      mapKernelError(error);
    }
    context = await progressContext(context, 'context_ready', GENERATION_CONTEXT_KEYS, controller.signal);
    if (controller.signal.aborted) fail('builder_generation_cancelled');
    const { config, credential } = providerAuthority();
    context = await progressContext(
      context,
      'provider_request_started',
      GENERATION_CONTEXT_KEYS,
      controller.signal,
    );
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
      }, {
        signal: controller.signal,
        ...(onOutputDelta === null
          ? {}
          : { on_output_delta: (delta) => notifyOutputDelta(context, delta, controller.signal) }),
      }]);
    } catch (error) {
      mapTransportError(error, controller.signal);
    }
    if (controller.signal.aborted) fail('builder_generation_cancelled');
    context = await progressContext(
      context,
      'provider_response_received',
      GENERATION_CONTEXT_KEYS,
      controller.signal,
    );
    const generatedText = sanitizeTransportResult(transportResult);
    context = await progressContext(context, 'result_preparing', GENERATION_CONTEXT_KEYS, controller.signal);
    try {
      const draft = projectBuilderGenerationResult({
        request,
        base_revision_evidence: ownValue(context, 'base_revision_evidence', 'builder_generation_base_unavailable'),
        base_source_tree: ownValue(context, 'base_source_tree', 'builder_generation_base_unavailable'),
        conversation_events: ownValue(context, 'conversation_events', 'builder_generation_base_unavailable'),
        turn_id: ownValue(context, 'turn_id', 'builder_generation_base_unavailable'),
        run_id: ownValue(context, 'run_id', 'builder_generation_base_unavailable'),
        generated_text: generatedText,
      });
      return Object.freeze({ ...draft, context });
    } catch (error) {
      mapKernelError(error);
    }
  }

  async function runDraftContinuation(request, controller) {
    if (buildDraftContinuationContext === null) fail('builder_generation_base_unavailable');
    let context = await boundedContext(
      request,
      controller.signal,
      buildDraftContinuationContext,
      DRAFT_CONTINUATION_CONTEXT_KEYS,
    );
    let descriptor;
    try {
      descriptor = createBuilderGenerationPromptDescriptor({
        request,
        base_source_tree: ownValue(
          context,
          'prompt_base_source_tree',
          'builder_generation_base_unavailable',
        ),
        conversation_events: ownValue(
          context,
          'conversation_events',
          'builder_generation_base_unavailable',
        ),
      });
    } catch (error) {
      mapKernelError(error);
    }
    context = await progressContext(
      context,
      'context_ready',
      DRAFT_CONTINUATION_CONTEXT_KEYS,
      controller.signal,
    );
    if (controller.signal.aborted) fail('builder_generation_cancelled');
    const { config, credential } = providerAuthority();
    context = await progressContext(
      context,
      'provider_request_started',
      DRAFT_CONTINUATION_CONTEXT_KEYS,
      controller.signal,
    );
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
      }, {
        signal: controller.signal,
        ...(onOutputDelta === null
          ? {}
          : { on_output_delta: (delta) => notifyOutputDelta(context, delta, controller.signal) }),
      }]);
    } catch (error) {
      mapTransportError(error, controller.signal);
    }
    if (controller.signal.aborted) fail('builder_generation_cancelled');
    context = await progressContext(
      context,
      'provider_response_received',
      DRAFT_CONTINUATION_CONTEXT_KEYS,
      controller.signal,
    );
    const generatedText = sanitizeTransportResult(transportResult);
    context = await progressContext(
      context,
      'result_preparing',
      DRAFT_CONTINUATION_CONTEXT_KEYS,
      controller.signal,
    );
    try {
      const draft = projectBuilderDraftContinuationGenerationResult({
        request,
        prompt_base_source_tree: ownValue(
          context,
          'prompt_base_source_tree',
          'builder_generation_base_unavailable',
        ),
        candidate_base_revision_evidence: ownValue(
          context,
          'candidate_base_revision_evidence',
          'builder_generation_base_unavailable',
        ),
        candidate_base_source_tree: ownValue(
          context,
          'candidate_base_source_tree',
          'builder_generation_base_unavailable',
        ),
        conversation_events: ownValue(
          context,
          'conversation_events',
          'builder_generation_base_unavailable',
        ),
        turn_id: ownValue(context, 'turn_id', 'builder_generation_base_unavailable'),
        run_id: ownValue(context, 'run_id', 'builder_generation_base_unavailable'),
        generated_text: generatedText,
      });
      return Object.freeze({ ...draft, context });
    } catch (error) {
      mapKernelError(error);
    }
  }

  async function runExplanation(request, controller) {
    if (buildExplanationContext === null) fail('builder_generation_base_unavailable');
    let context = await boundedContext(
      request,
      controller.signal,
      buildExplanationContext,
      EXPLANATION_CONTEXT_KEYS,
    );
    let descriptor;
    try {
      descriptor = createBuilderExplanationPromptDescriptor({
        request,
        base_source_tree: ownValue(context, 'base_source_tree', 'builder_generation_base_unavailable'),
        conversation_events: ownValue(context, 'conversation_events', 'builder_generation_base_unavailable'),
      });
    } catch (error) {
      mapKernelError(error);
    }
    context = await progressContext(context, 'context_ready', EXPLANATION_CONTEXT_KEYS, controller.signal);
    if (controller.signal.aborted) fail('builder_generation_cancelled');
    const { config, credential } = providerAuthority();
    context = await progressContext(
      context,
      'provider_request_started',
      EXPLANATION_CONTEXT_KEYS,
      controller.signal,
    );
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
      }, {
        signal: controller.signal,
        ...(onOutputDelta === null
          ? {}
          : { on_output_delta: (delta) => notifyOutputDelta(context, delta, controller.signal) }),
      }]);
    } catch (error) {
      mapTransportError(error, controller.signal);
    }
    if (controller.signal.aborted) fail('builder_generation_cancelled');
    context = await progressContext(
      context,
      'provider_response_received',
      EXPLANATION_CONTEXT_KEYS,
      controller.signal,
    );
    const generatedText = sanitizeTransportResult(transportResult);
    context = await progressContext(context, 'result_preparing', EXPLANATION_CONTEXT_KEYS, controller.signal);
    try {
      const answer = projectBuilderExplanationResult({
        request,
        generated_text: generatedText,
      });
      return Object.freeze({ ...answer, context });
    } catch (error) {
      mapKernelError(error);
    }
  }

  async function runPlan(request, controller) {
    if (buildPlanContext === null) fail('builder_generation_base_unavailable');
    let context = await boundedContext(
      request,
      controller.signal,
      buildPlanContext,
      PLAN_CONTEXT_KEYS,
    );
    let descriptor;
    try {
      descriptor = createBuilderPlanPromptDescriptor({
        request,
        source_context_result: ownValue(context, 'source_context_result', 'builder_generation_base_unavailable'),
      });
    } catch (error) {
      mapKernelError(error);
    }
    context = await progressContext(context, 'context_ready', PLAN_CONTEXT_KEYS, controller.signal);
    if (controller.signal.aborted) fail('builder_generation_cancelled');
    const { config, credential } = providerAuthority();
    async function requestPlanTransport(repair = false) {
      let transportResult;
      try {
        transportResult = await Reflect.apply(transport, undefined, [{
          base_url: config.base_url,
          model: config.model,
          credential,
          messages: [
            { role: 'system', content: descriptor.system_instruction },
            { role: 'user', content: descriptor.user_instruction },
            ...(repair ? [{ role: 'user', content: PLAN_REPAIR_USER_INSTRUCTION }] : []),
          ],
          timeout_ms: config.timeout_ms,
          ...(config.temperature === null ? {} : { temperature: config.temperature }),
          ...(config.max_tokens === null ? {} : { max_tokens: config.max_tokens }),
        }, {
          signal: controller.signal,
          ...(onOutputDelta === null
            ? {}
            : { on_output_delta: (delta) => notifyOutputDelta(context, delta, controller.signal) }),
        }]);
      } catch (error) {
        mapTransportError(error, controller.signal);
      }
      if (controller.signal.aborted) fail('builder_generation_cancelled');
      return sanitizeTransportResult(transportResult);
    }
    function buildPlanResult(generatedText) {
      return projectBuilderPlanProposalResult({
        request,
        source_context_result: ownValue(context, 'source_context_result', 'builder_generation_base_unavailable'),
        proposed_at_ms: ownValue(context, 'proposed_at_ms', 'builder_generation_base_unavailable'),
        generated_text: generatedText,
      });
    }
    context = await progressContext(
      context,
      'provider_request_started',
      PLAN_CONTEXT_KEYS,
      controller.signal,
    );
    const generatedText = await requestPlanTransport(false);
    context = await progressContext(
      context,
      'provider_response_received',
      PLAN_CONTEXT_KEYS,
      controller.signal,
    );
    context = await progressContext(context, 'result_preparing', PLAN_CONTEXT_KEYS, controller.signal);
    try {
      const plan = buildPlanResult(generatedText);
      return Object.freeze({ ...plan, context });
    } catch (error) {
      if (kernelErrorCode(error) !== 'builder_generation_structured_response_invalid') {
        mapKernelError(error);
      }
    }
    const repairedText = await requestPlanTransport(true);
    try {
      const plan = buildPlanResult(repairedText);
      return Object.freeze({ ...plan, context });
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

  function generateDraftContinuation(rawRequest) {
    let request;
    try { request = sanitizeBuilderGenerationRequest(rawRequest); } catch {
      return Promise.reject(new BuilderGenerationHostAdapterError('builder_generation_request_invalid'));
    }
    const existing = draftContinuationInFlight.get(request.request_digest);
    if (existing) return existing.promise;
    const controller = new AbortController();
    const entry = { controller, promise: null };
    entry.promise = runDraftContinuation(request, controller).finally(() => {
      if (draftContinuationInFlight.get(request.request_digest) === entry) {
        draftContinuationInFlight.delete(request.request_digest);
      }
    });
    draftContinuationInFlight.set(request.request_digest, entry);
    return entry.promise;
  }

  function explain(rawRequest) {
    let request;
    try { request = sanitizeBuilderGenerationRequest(rawRequest); } catch {
      return Promise.reject(new BuilderGenerationHostAdapterError('builder_generation_request_invalid'));
    }
    const existing = explanationInFlight.get(request.request_digest);
    if (existing) return existing.promise;
    const controller = new AbortController();
    const entry = { controller, promise: null };
    entry.promise = runExplanation(request, controller).finally(() => {
      if (explanationInFlight.get(request.request_digest) === entry) {
        explanationInFlight.delete(request.request_digest);
      }
    });
    explanationInFlight.set(request.request_digest, entry);
    return entry.promise;
  }

  function plan(rawRequest) {
    let request;
    try { request = sanitizeBuilderGenerationRequest(rawRequest); } catch {
      return Promise.reject(new BuilderGenerationHostAdapterError('builder_generation_request_invalid'));
    }
    const existing = planInFlight.get(request.request_digest);
    if (existing) return existing.promise;
    const controller = new AbortController();
    const entry = { controller, promise: null };
    entry.promise = runPlan(request, controller).finally(() => {
      if (planInFlight.get(request.request_digest) === entry) {
        planInFlight.delete(request.request_digest);
      }
    });
    planInFlight.set(request.request_digest, entry);
    return entry.promise;
  }

  function cancel(rawRequest) {
    const requestId = sanitizeCancelRequest(rawRequest);
    const entry = inFlight.get(requestId);
    const draftContinuationEntry = draftContinuationInFlight.get(requestId);
    const explanationEntry = explanationInFlight.get(requestId);
    const planEntry = planInFlight.get(requestId);
    if (!entry && !draftContinuationEntry && !explanationEntry && !planEntry) {
      return Object.freeze({ request_id: requestId, cancelled: false });
    }
    if (entry) entry.controller.abort();
    if (draftContinuationEntry) draftContinuationEntry.controller.abort();
    if (explanationEntry) explanationEntry.controller.abort();
    if (planEntry) planEntry.controller.abort();
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

  return Object.freeze({ generate, generateDraftContinuation, explain, plan, cancel, availability });
}

module.exports = Object.freeze({
  BUILDER_GENERATION_AVAILABILITY_VERSION,
  BUILDER_PROVIDER_SECRET_RESOLUTION_VERSION,
  BuilderGenerationHostAdapterError,
  createBuilderGenerationHostAdapter,
});
