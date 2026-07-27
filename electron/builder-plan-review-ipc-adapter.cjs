'use strict';

const { types: utilTypes } = require('node:util');

const REVIEW_PLAN_CHANNEL = 'clawfabric-builder:plan-review:review';
const OPTION_KEYS = Object.freeze(['reviewPlan', 'mainWindowRef']);
const REVIEW_PLAN_REQUEST_KEYS = Object.freeze([
  'project_id',
  'conversation_id',
  'turn_id',
  'run_id',
  'decision',
]);
const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONVERSATION_ID_PATTERN =
  /^builder-conversation:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TURN_ID_PATTERN =
  /^builder-turn:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RUN_ID_PATTERN =
  /^builder-run:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_PLAIN_DATA_NODES = 256;
const MAX_PLAIN_DATA_ENTRIES = 256;
const MAX_PLAIN_DATA_UTF8_BYTES = 64 * 1024;
const MAX_PLAIN_DATA_DEPTH = 16;
const ERROR_MESSAGES = Object.freeze({
  builder_plan_review_forbidden: 'Plan review is unavailable.',
  builder_plan_review_invalid: 'The plan review request could not be verified.',
  builder_plan_review_unavailable: 'Plan review is unavailable.',
});

class BuilderPlanReviewIpcError extends Error {
  constructor(code = 'builder_plan_review_unavailable') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_plan_review_unavailable';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderPlanReviewIpcError';
    this.code = selected;
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function ipcError(code) {
  return new BuilderPlanReviewIpcError(code);
}

function safeErrorCode(error) {
  try {
    if (
      error === null
      || (typeof error !== 'object' && typeof error !== 'function')
      || utilTypes.isProxy(error)
    ) return null;
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    return descriptor
      && Object.hasOwn(descriptor, 'value')
      && typeof descriptor.value === 'string'
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

function normalizeError(error) {
  const code = safeErrorCode(error);
  return ipcError(code !== null && Object.hasOwn(ERROR_MESSAGES, code)
    ? code
    : 'builder_plan_review_unavailable');
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

function stableMethod(value, key) {
  if (!isPlainObject(value)) throw ipcError();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (
    !descriptor
    || descriptor.enumerable !== true
    || !Object.hasOwn(descriptor, 'value')
    || typeof descriptor.value !== 'function'
    || utilTypes.isProxy(descriptor.value)
  ) throw ipcError();
  return descriptor.value;
}

function safeOptions(value) {
  try {
    if (!isPlainObject(value)) throw ipcError();
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== OPTION_KEYS.length
      || keys.some((key) => typeof key !== 'string' || !OPTION_KEYS.includes(key))
    ) throw ipcError();
    return Object.freeze({
      reviewPlan: stableMethod(value, 'reviewPlan'),
      mainWindowRef: stableMethod(value, 'mainWindowRef'),
    });
  } catch {
    throw ipcError();
  }
}

function exactDescriptor(source, key) {
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    throw ipcError('builder_plan_review_invalid');
  }
  return descriptor.value;
}

function safeReviewRequest(value) {
  try {
    if (!isPlainObject(value)) throw ipcError('builder_plan_review_invalid');
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== REVIEW_PLAN_REQUEST_KEYS.length
      || keys.some((key) => typeof key !== 'string' || !REVIEW_PLAN_REQUEST_KEYS.includes(key))
    ) throw ipcError('builder_plan_review_invalid');
    const projectId = exactDescriptor(value, 'project_id');
    const conversationId = exactDescriptor(value, 'conversation_id');
    const turnId = exactDescriptor(value, 'turn_id');
    const runId = exactDescriptor(value, 'run_id');
    const decision = exactDescriptor(value, 'decision');
    if (
      typeof projectId !== 'string'
      || !PROJECT_ID_PATTERN.test(projectId)
      || typeof conversationId !== 'string'
      || !CONVERSATION_ID_PATTERN.test(conversationId)
      || conversationId.slice('builder-conversation:'.length) !== projectId.slice('builder-project:'.length)
      || typeof turnId !== 'string'
      || !TURN_ID_PATTERN.test(turnId)
      || typeof runId !== 'string'
      || !RUN_ID_PATTERN.test(runId)
      || (decision !== 'approved' && decision !== 'rejected')
    ) throw ipcError('builder_plan_review_invalid');
    return Object.freeze({
      project_id: projectId,
      conversation_id: conversationId,
      turn_id: turnId,
      run_id: runId,
      decision,
    });
  } catch (error) {
    if (error instanceof BuilderPlanReviewIpcError) throw error;
    throw ipcError('builder_plan_review_invalid');
  }
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
  const prototype = Object.getPrototypeOf(value);
  if (
    (isArray && prototype !== Array.prototype)
    || (!isArray && prototype !== Object.prototype && prototype !== null)
    || (isArray && value.length > MAX_PLAIN_DATA_ENTRIES - state.entries)
  ) throw ipcError();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) throw ipcError();
  const entryCount = keys.length - (isArray ? 1 : 0);
  if (entryCount > MAX_PLAIN_DATA_ENTRIES - state.entries) throw ipcError();
  state.entries += entryCount;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(descriptors).length !== keys.length
    || (isArray && (keys.length !== value.length + 1 || !Object.hasOwn(descriptors, 'length')))
  ) throw ipcError();
  const output = isArray ? [] : {};
  for (const key of keys) {
    accountUtf8(key, state);
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw ipcError();
    if (isArray && key === 'length') continue;
    if (
      !descriptor.enumerable
      || (isArray && !/^(?:0|[1-9][0-9]*)$/u.test(key))
      || (!isArray && ['__proto__', 'prototype', 'constructor'].includes(key))
    ) throw ipcError();
    output[key] = clonePlainData(descriptor.value, state, depth + 1);
  }
  return Object.freeze(output);
}

function activeWebContents(mainWindowRef) {
  try {
    const windowRef = Reflect.apply(mainWindowRef, undefined, []);
    if (!windowRef || (typeof windowRef.isDestroyed === 'function' && windowRef.isDestroyed())) {
      return null;
    }
    const webContents = windowRef.webContents;
    if (!webContents || (typeof webContents.isDestroyed === 'function' && webContents.isDestroyed())) {
      return null;
    }
    return webContents;
  } catch {
    return null;
  }
}

function assertActiveSender(event, mainWindowRef) {
  if (!event || event.sender !== activeWebContents(mainWindowRef)) {
    throw ipcError('builder_plan_review_forbidden');
  }
}

function createBuilderPlanReviewIpcAdapter(rawOptions) {
  const options = safeOptions(rawOptions);

  async function invokeReview(event, rawArguments) {
    try {
      assertActiveSender(event, options.mainWindowRef);
      if (rawArguments.length !== 1) {
        throw ipcError('builder_plan_review_invalid');
      }
      return clonePlainData(await Reflect.apply(options.reviewPlan, undefined, [
        safeReviewRequest(rawArguments[0]),
      ]));
    } catch (error) {
      throw normalizeError(error);
    }
  }

  return Object.freeze({
    adapter_id: 'builder_plan_review.controlled_ipc_adapter.v1',
    namespace: 'builderPlanReview',
    preload_namespace: 'window.clawfabricBuilder.planReview',
    channels: Object.freeze({
      review: Object.freeze({
        channel: REVIEW_PLAN_CHANNEL,
        method: 'review',
        invoke(event, ...rawArguments) {
          return invokeReview(event, rawArguments);
        },
      }),
    }),
    exposed_methods: Object.freeze(['review']),
    authority: Object.freeze({
      renderer_authority: 'plan_review_request_only',
      main_owned_sqlite_authority: true,
      main_owned_git_authority: false,
      active_renderer_required: true,
      review_fact_recording: true,
      source_mutation: false,
      save_authority: false,
      project_revision_authority: false,
      provider_dispatch: false,
      credential_readback: false,
      direct_electron_registration: false,
      direct_preload_exposure: false,
    }),
  });
}

module.exports = Object.freeze({
  REVIEW_PLAN_CHANNEL,
  BuilderPlanReviewIpcError,
  createBuilderPlanReviewIpcAdapter,
});
