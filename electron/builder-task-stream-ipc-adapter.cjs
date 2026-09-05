'use strict';

const { types: utilTypes } = require('node:util');
const { createHash } = require('node:crypto');
const { builderPerformanceTrace } = require('./builder-performance-trace.cjs');

const READ_TASK_STREAM_CHANNEL = 'clawfabric-builder:task-stream:read';
const TASK_STREAM_CHANGED_CHANNEL = 'clawfabric-builder:task-stream:changed';
const OPTION_KEYS = Object.freeze(['readStream', 'mainWindowRef']);
const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TASK_ADDRESS_ID_PATTERN =
  /^builder-task-address:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const AGENT_ID_PATTERN =
  /^builder-agent:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CURSOR_PROTOCOL_VERSION = 'builder-task-stream-cursor.v1';
const CURSOR_READ_RESULT_VERSION = 'builder-task-stream-cursor-read-result.v1';
const SNAPSHOT_DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const INCREMENTAL_TOP_LEVEL_PATCH_KEYS = Object.freeze([
  'context_status_projection',
  'provider_context_disclosure_status_projection',
  'context_usage_projection',
  'draft_checkpoint_status_projection',
  'draft_checkpoint_timeline_projection',
  'review_state_projection',
  'check_run_outcome_projection',
  'candidate_activity',
  'agent_activity_projection',
]);
const INCREMENTAL_TOP_LEVEL_CLEARED_KEYS = '__cleared_top_level_keys';
const MAX_CURSOR_CACHE_ENTRIES = 64;
const MAX_PLAIN_DATA_NODES = 20_000;
const MAX_PLAIN_DATA_ENTRIES = 20_000;
const MAX_PLAIN_DATA_UTF8_BYTES = 4 * 1024 * 1024;
const MAX_PLAIN_DATA_DEPTH = 64;
const ERROR_MESSAGES = Object.freeze({
  builder_task_stream_forbidden: 'Project activity is unavailable.',
  builder_task_stream_invalid: 'The project activity request could not be verified.',
  builder_task_stream_unavailable: 'Project activity is unavailable.',
});

class BuilderTaskStreamIpcError extends Error {
  constructor(code = 'builder_task_stream_unavailable') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_task_stream_unavailable';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderTaskStreamIpcError';
    this.code = selected;
    this.retryable = selected === 'builder_task_stream_unavailable';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function ipcError(code) {
  return new BuilderTaskStreamIpcError(code);
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
    : 'builder_task_stream_unavailable');
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
      readStream: stableMethod(value, 'readStream'),
      mainWindowRef: stableMethod(value, 'mainWindowRef'),
    });
  } catch {
    throw ipcError();
  }
}

function safeReadRequest(value) {
  try {
    if (!isPlainObject(value)) throw ipcError('builder_task_stream_invalid');
    const keys = Reflect.ownKeys(value);
    const cursorDescriptor = Object.getOwnPropertyDescriptor(value, 'cursor');
    const hasCursor = cursorDescriptor !== undefined;
    let cursor = null;
    if (hasCursor) {
      if (
        !cursorDescriptor.enumerable
        || !Object.hasOwn(cursorDescriptor, 'value')
        || !isPlainObject(cursorDescriptor.value)
      ) throw ipcError('builder_task_stream_invalid');
      const cursorKeys = Reflect.ownKeys(cursorDescriptor.value);
      const cursorDescriptors = Object.getOwnPropertyDescriptors(cursorDescriptor.value);
      const protocolVersion = cursorDescriptors.protocol_version;
      const snapshotDigest = cursorDescriptors.snapshot_digest;
      if (
        cursorKeys.length !== 2
        || cursorKeys.some((key) => typeof key !== 'string' || ![
          'protocol_version', 'snapshot_digest',
        ].includes(key))
        || !protocolVersion
        || !protocolVersion.enumerable
        || !Object.hasOwn(protocolVersion, 'value')
        || protocolVersion.value !== CURSOR_PROTOCOL_VERSION
        || !snapshotDigest
        || !snapshotDigest.enumerable
        || !Object.hasOwn(snapshotDigest, 'value')
        || (snapshotDigest.value !== null && (
          typeof snapshotDigest.value !== 'string'
          || !SNAPSHOT_DIGEST_PATTERN.test(snapshotDigest.value)
        ))
      ) throw ipcError('builder_task_stream_invalid');
      cursor = Object.freeze({
        protocol_version: CURSOR_PROTOCOL_VERSION,
        snapshot_digest: snapshotDigest.value,
      });
    }
    if (
      keys.length === (hasCursor ? 2 : 1)
      && keys.every((key) => typeof key === 'string' && ['agent_id', 'cursor'].includes(key))
    ) {
      const agentDescriptor = Object.getOwnPropertyDescriptor(value, 'agent_id');
      if (
        !agentDescriptor
        || agentDescriptor.enumerable !== true
        || !Object.hasOwn(agentDescriptor, 'value')
        || typeof agentDescriptor.value !== 'string'
        || !AGENT_ID_PATTERN.test(agentDescriptor.value)
      ) throw ipcError('builder_task_stream_invalid');
      return Object.freeze({
        authority_request: Object.freeze({ agent_id: agentDescriptor.value }),
        cursor,
      });
    }
    if (
      keys.length !== (hasCursor ? 3 : 2)
      || keys.some((key) => typeof key !== 'string' || ![
        'project_id', 'task_address_id', 'cursor',
      ].includes(key))
    ) throw ipcError('builder_task_stream_invalid');
    const projectDescriptor = Object.getOwnPropertyDescriptor(value, 'project_id');
    const taskDescriptor = Object.getOwnPropertyDescriptor(value, 'task_address_id');
    if (
      !projectDescriptor
      || projectDescriptor.enumerable !== true
      || !Object.hasOwn(projectDescriptor, 'value')
      || !taskDescriptor
      || taskDescriptor.enumerable !== true
      || !Object.hasOwn(taskDescriptor, 'value')
    ) {
      throw ipcError('builder_task_stream_invalid');
    }
    const projectId = projectDescriptor.value;
    const taskAddressId = taskDescriptor.value;
    if (typeof projectId !== 'string' || !PROJECT_ID_PATTERN.test(projectId)) {
      throw ipcError('builder_task_stream_invalid');
    }
    if (typeof taskAddressId !== 'string' || !TASK_ADDRESS_ID_PATTERN.test(taskAddressId)) {
      throw ipcError('builder_task_stream_invalid');
    }
    return Object.freeze({
      authority_request: Object.freeze({ project_id: projectId, task_address_id: taskAddressId }),
      cursor,
    });
  } catch (error) {
    if (error instanceof BuilderTaskStreamIpcError) throw error;
    throw ipcError('builder_task_stream_invalid');
  }
}

function requestCacheKey(request) {
  return Object.hasOwn(request, 'agent_id')
    ? `agent:${request.agent_id}`
    : `task:${request.project_id}:${request.task_address_id}`;
}

function snapshotDigest(snapshot) {
  return createHash('sha256').update(JSON.stringify(snapshot), 'utf8').digest('hex');
}

function valueDescriptor(value, key) {
  if (!isPlainObject(value)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor
    && descriptor.enumerable
    && Object.hasOwn(descriptor, 'value')
    ? descriptor.value
    : null;
}

function incrementalSnapshot(previous, current) {
  const previousConversation = valueDescriptor(previous, 'conversation');
  const currentConversation = valueDescriptor(current, 'conversation');
  if (!isPlainObject(previousConversation) || !isPlainObject(currentConversation)) return null;
  for (const key of ['stream_version', 'project_id', 'scope_kind', 'agent_id']) {
    if (valueDescriptor(previous, key) !== valueDescriptor(current, key)) return null;
  }
  for (const key of ['conversation_id', 'created_at_ms', 'source']) {
    if (valueDescriptor(previousConversation, key) !== valueDescriptor(currentConversation, key)) return null;
  }
  const previousWindow = valueDescriptor(previousConversation, 'window');
  const currentWindow = valueDescriptor(currentConversation, 'window');
  const previousItems = valueDescriptor(previousConversation, 'items');
  const currentItems = valueDescriptor(currentConversation, 'items');
  const previousHead = valueDescriptor(previousConversation, 'head_sequence');
  const currentHead = valueDescriptor(currentConversation, 'head_sequence');
  const previousLast = valueDescriptor(previousWindow, 'last_sequence');
  if (
    !isPlainObject(previousWindow)
    || !isPlainObject(currentWindow)
    || !Array.isArray(previousItems)
    || !Array.isArray(currentItems)
    || !Number.isSafeInteger(previousHead)
    || !Number.isSafeInteger(currentHead)
    || !Number.isSafeInteger(previousLast)
    || currentHead < previousHead
  ) return null;
  const previousBySequence = new Map(previousItems.map((item) => [
    valueDescriptor(item, 'sequence'), item,
  ]));
  for (const item of currentItems) {
    const sequence = valueDescriptor(item, 'sequence');
    if (!Number.isSafeInteger(sequence)) return null;
    if (sequence <= previousLast) {
      const previousItem = previousBySequence.get(sequence);
      if (previousItem === undefined || JSON.stringify(previousItem) !== JSON.stringify(item)) return null;
    }
  }
  const suffix = currentItems.filter((item) => valueDescriptor(item, 'sequence') > previousLast);
  const patch = {};
  for (const [key, value] of Object.entries(current)) {
    if (
      INCREMENTAL_TOP_LEVEL_PATCH_KEYS.includes(key)
      && Object.hasOwn(previous, key)
      && JSON.stringify(valueDescriptor(previous, key)) === JSON.stringify(value)
    ) {
      continue;
    }
    patch[key] = value;
  }
  const clearedKeys = INCREMENTAL_TOP_LEVEL_PATCH_KEYS.filter((key) => (
    Object.hasOwn(previous, key) && !Object.hasOwn(current, key)
  ));
  if (clearedKeys.length > 0) patch[INCREMENTAL_TOP_LEVEL_CLEARED_KEYS] = Object.freeze(clearedKeys);
  return Object.freeze({
    ...patch,
    conversation: Object.freeze({
      ...currentConversation,
      items: Object.freeze(suffix),
    }),
  });
}

function cursorResponse(cache, request, snapshot) {
  const digest = snapshotDigest(snapshot);
  const key = requestCacheKey(request.authority_request);
  const previous = cache.get(key) ?? null;
  const requestedDigest = request.cursor?.snapshot_digest ?? null;
  let result;
  if (requestedDigest !== null && previous?.digest === requestedDigest) {
    if (digest === requestedDigest) {
      builderPerformanceTrace.increment('main.task_stream.cursor.unchanged_count');
      result = Object.freeze({
        result_version: CURSOR_READ_RESULT_VERSION,
        result_kind: 'unchanged',
        base_snapshot_digest: requestedDigest,
        snapshot_digest: digest,
      });
    } else {
      const incremental = incrementalSnapshot(previous.snapshot, snapshot);
      if (incremental !== null) {
        builderPerformanceTrace.increment('main.task_stream.cursor.incremental_count');
        result = Object.freeze({
          result_version: CURSOR_READ_RESULT_VERSION,
          result_kind: 'incremental',
          base_snapshot_digest: requestedDigest,
          snapshot_digest: digest,
          snapshot: incremental,
        });
      }
    }
  }
  if (result === undefined) {
    builderPerformanceTrace.increment('main.task_stream.cursor.full_count');
    result = Object.freeze({
      result_version: CURSOR_READ_RESULT_VERSION,
      result_kind: 'full',
      base_snapshot_digest: null,
      snapshot_digest: digest,
      snapshot,
    });
  }
  cache.delete(key);
  cache.set(key, Object.freeze({ digest, snapshot }));
  while (cache.size > MAX_CURSOR_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
  return result;
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

function clonePlainDataWithStats(value) {
  const state = {
    entries: 0,
    nodes: 0,
    seen: new WeakSet(),
    utf8Bytes: 0,
  };
  return Object.freeze({
    value: clonePlainData(value, state),
    utf8Bytes: state.utf8Bytes,
  });
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
    throw ipcError('builder_task_stream_forbidden');
  }
}

function createBuilderTaskStreamIpcAdapter(rawOptions) {
  const options = safeOptions(rawOptions);
  const cursorCache = new Map();

  async function invokeRead(event, rawArguments) {
    try {
      assertActiveSender(event, options.mainWindowRef);
      if (rawArguments.length !== 1) {
        throw ipcError('builder_task_stream_invalid');
      }
      builderPerformanceTrace.increment('main.task_stream.read.count');
      const request = safeReadRequest(rawArguments[0]);
      const snapshotClone = await builderPerformanceTrace.measureAsync(
        'main.task_stream.ipc.duration_ms',
        async () => clonePlainDataWithStats(await Reflect.apply(options.readStream, undefined, [
          request.authority_request,
        ])),
      );
      const snapshot = snapshotClone.value;
      const resultClone = request.cursor === null
        ? snapshotClone
        : clonePlainDataWithStats(cursorResponse(cursorCache, request, snapshot));
      const result = resultClone.value;
      if (builderPerformanceTrace.enabled()) {
        builderPerformanceTrace.observe(
          'main.task_stream.ipc.result_bytes',
          resultClone.utf8Bytes,
        );
      }
      return result;
    } catch (error) {
      throw normalizeError(error);
    }
  }

  return Object.freeze({
    adapter_id: 'builder_task_stream.controlled_ipc_adapter.v1',
    namespace: 'builderTaskStream',
    preload_namespace: 'window.clawfabricBuilder.taskStream',
    channels: Object.freeze({
      read: Object.freeze({
        channel: READ_TASK_STREAM_CHANNEL,
        method: 'read',
        invoke(event, ...rawArguments) {
          return invokeRead(event, rawArguments);
        },
      }),
    }),
    exposed_methods: Object.freeze(['read', 'subscribeChanged']),
    authority: Object.freeze({
      renderer_authority: 'agent_or_project_task_address_only',
      main_owned_sqlite_authority: true,
      main_owned_git_authority: false,
      active_renderer_required: true,
      read_only: true,
      change_notification: 'agent_id_or_project_id_only',
      provider_dispatch: false,
      credential_readback: false,
      direct_electron_registration: false,
      direct_preload_exposure: false,
    }),
  });
}

module.exports = Object.freeze({
  READ_TASK_STREAM_CHANNEL,
  TASK_STREAM_CHANGED_CHANNEL,
  BuilderTaskStreamIpcError,
  createBuilderTaskStreamIpcAdapter,
});
