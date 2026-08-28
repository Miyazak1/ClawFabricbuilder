'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  READ_TASK_STREAM_CHANNEL,
  TASK_STREAM_CHANGED_CHANNEL,
  BuilderTaskStreamIpcError,
  createBuilderTaskStreamIpcAdapter,
} = require('../electron/builder-task-stream-ipc-adapter.cjs');
const {
  builderPerformanceTrace,
  resetBuilderPerformanceTraceForTests,
} = require('../electron/builder-performance-trace.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const TASK_ADDRESS_ID = 'builder-task-address:123e4567-e89b-42d3-a456-426614174001';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174000';

test.afterEach(() => resetBuilderPerformanceTraceForTests());

function windowAuthority() {
  const webContents = Object.freeze({
    isDestroyed: () => false,
  });
  const window = Object.freeze({
    webContents,
    isDestroyed: () => false,
  });
  return { event: Object.freeze({ sender: webContents }), mainWindowRef: () => window };
}

function streamWire(overrides = {}) {
  return {
    stream_version: 'builder-task-stream-read-result.v1',
    project_id: PROJECT_ID,
    conversation: {
      conversation_id: CONVERSATION_ID,
      created_at_ms: 1,
      head_sequence: 1,
      recorded_active_turn_id: null,
      window: {
        first_sequence: 1,
        last_sequence: 1,
        has_earlier: false,
      },
      items: [
        {
          item_kind: 'user_message',
          sequence: 1,
          turn_id: 'builder-turn:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          message: {
            message_id: 'builder-message:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            text: 'Make a timer.',
          },
          message_kind: 'submitted',
          mode: 'create',
          task: null,
        },
      ],
    },
    authority: {
      conversation: 'sqlite_canonical_event_replay_or_absent',
      project_source: 'not_included',
      candidate_source: 'not_loaded',
      project_revision: 'not_inferred',
    },
    ...overrides,
  };
}

function adapter(overrides = {}) {
  const authority = windowAuthority();
  const calls = [];
  const value = createBuilderTaskStreamIpcAdapter({
    readStream: overrides.readStream ?? (async (request) => {
      calls.push(request);
      return streamWire();
    }),
    mainWindowRef: authority.mainWindowRef,
  });
  return { authority, calls, value };
}

test('task stream adapter exposes only read plus project-id change notification', async () => {
  const { authority, calls, value } = adapter();
  assert.equal(value.adapter_id, 'builder_task_stream.controlled_ipc_adapter.v1');
  assert.equal(value.namespace, 'builderTaskStream');
  assert.equal(value.preload_namespace, 'window.clawfabricBuilder.taskStream');
  assert.deepEqual(value.exposed_methods, ['read', 'subscribeChanged']);
  assert.deepEqual(Object.keys(value.channels), ['read']);
  assert.equal(value.channels.read.channel, READ_TASK_STREAM_CHANNEL);
  assert.equal(TASK_STREAM_CHANGED_CHANNEL, 'clawfabric-builder:task-stream:changed');
  assert.equal(value.authority.read_only, true);
  assert.equal(value.authority.change_notification, 'agent_id_or_project_id_only');
  assert.equal(value.authority.active_renderer_required, true);
  assert.equal(value.authority.direct_electron_registration, false);
  assert.equal(value.authority.direct_preload_exposure, false);
  assert.equal(value.authority.provider_dispatch, false);
  assert.equal(value.authority.credential_readback, false);

  const result = await value.channels.read.invoke(authority.event, {
    project_id: PROJECT_ID,
    task_address_id: TASK_ADDRESS_ID,
  });
  assert.equal(result.stream_version, 'builder-task-stream-read-result.v1');
  assert.equal(result.project_id, PROJECT_ID);
  assert.equal(result.conversation.conversation_id, CONVERSATION_ID);
  assert.equal(result.conversation.items[0].message.text, 'Make a timer.');
  assert.deepEqual(calls, [{ project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID }]);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.conversation.items), true);
  assert.equal(Object.isFrozen(result.authority), true);
});

test('task stream adapter preserves legal absent conversations without fabricating work', async () => {
  const { authority, value } = adapter({
    readStream: async () => streamWire({ conversation: null }),
  });
  const result = await value.channels.read.invoke(authority.event, {
    project_id: PROJECT_ID,
    task_address_id: TASK_ADDRESS_ID,
  });
  assert.deepEqual(result, {
    stream_version: 'builder-task-stream-read-result.v1',
    project_id: PROJECT_ID,
    conversation: null,
    authority: {
      conversation: 'sqlite_canonical_event_replay_or_absent',
      project_source: 'not_included',
      candidate_source: 'not_loaded',
      project_revision: 'not_inferred',
    },
  });
});

test('task stream adapter returns full, unchanged, and append-only cursor results without forwarding cursor authority', async () => {
  const authority = windowAuthority();
  let current = streamWire();
  const calls = [];
  const value = createBuilderTaskStreamIpcAdapter({
    readStream: async (request) => {
      calls.push(request);
      return current;
    },
    mainWindowRef: authority.mainWindowRef,
  });
  const initialRequest = {
    project_id: PROJECT_ID,
    task_address_id: TASK_ADDRESS_ID,
    cursor: {
      protocol_version: 'builder-task-stream-cursor.v1',
      snapshot_digest: null,
    },
  };
  const full = await value.channels.read.invoke(authority.event, initialRequest);
  assert.equal(full.result_version, 'builder-task-stream-cursor-read-result.v1');
  assert.equal(full.result_kind, 'full');
  assert.match(full.snapshot_digest, /^[0-9a-f]{64}$/u);
  assert.deepEqual(full.snapshot, streamWire());

  const cursorRequest = {
    ...initialRequest,
    cursor: {
      ...initialRequest.cursor,
      snapshot_digest: full.snapshot_digest,
    },
  };
  const unchanged = await value.channels.read.invoke(authority.event, cursorRequest);
  assert.deepEqual(unchanged, {
    result_version: 'builder-task-stream-cursor-read-result.v1',
    result_kind: 'unchanged',
    base_snapshot_digest: full.snapshot_digest,
    snapshot_digest: full.snapshot_digest,
  });

  const secondItem = {
    ...current.conversation.items[0],
    sequence: 2,
    message: {
      ...current.conversation.items[0].message,
      text: 'Refine the timer.',
    },
  };
  current = streamWire({
    conversation: {
      ...current.conversation,
      head_sequence: 2,
      window: { first_sequence: 1, last_sequence: 2, has_earlier: false },
      items: [...current.conversation.items, secondItem],
    },
  });
  const incremental = await value.channels.read.invoke(authority.event, cursorRequest);
  assert.equal(incremental.result_kind, 'incremental');
  assert.equal(incremental.base_snapshot_digest, full.snapshot_digest);
  assert.notEqual(incremental.snapshot_digest, full.snapshot_digest);
  assert.deepEqual(incremental.snapshot.conversation.items, [secondItem]);
  assert.equal(incremental.snapshot.conversation.head_sequence, 2);
  assert.deepEqual(calls, Array.from({ length: 3 }, () => ({
    project_id: PROJECT_ID,
    task_address_id: TASK_ADDRESS_ID,
  })));
});

test('task stream adapter records non-cursor result bytes without stringifying the IPC result', async () => {
  const outputPath = path.join(__dirname, '..', '.tmp-task-stream-ipc-trace.json');
  const { authority, value } = adapter();
  assert.equal(builderPerformanceTrace.configure({ enabled: true, output_path: outputPath }), true);
  const originalStringify = JSON.stringify;
  let stringifyCalls = 0;
  JSON.stringify = function failStringify() {
    stringifyCalls += 1;
    throw new Error('task stream result byte accounting must not stringify the IPC result');
  };
  try {
    const result = await value.channels.read.invoke(authority.event, {
      project_id: PROJECT_ID,
      task_address_id: TASK_ADDRESS_ID,
    });
    assert.equal(result.stream_version, 'builder-task-stream-read-result.v1');
    assert.equal(stringifyCalls, 0);
    const trace = builderPerformanceTrace.snapshot();
    const metric = trace.metrics.find((entry) => entry.name === 'main.task_stream.ipc.result_bytes');
    assert.ok(metric);
    assert.ok(metric.total > 0);
  } finally {
    JSON.stringify = originalStringify;
    fs.rmSync(outputPath, { force: true });
  }
});

test('task stream adapter falls back to a full cursor result when its base cursor is unknown', async () => {
  const { authority, value } = adapter();
  const result = await value.channels.read.invoke(authority.event, {
    project_id: PROJECT_ID,
    task_address_id: TASK_ADDRESS_ID,
    cursor: {
      protocol_version: 'builder-task-stream-cursor.v1',
      snapshot_digest: 'a'.repeat(64),
    },
  });
  assert.equal(result.result_kind, 'full');
  assert.equal(result.base_snapshot_digest, null);
  assert.deepEqual(result.snapshot, streamWire());
});

test('task stream adapter rejects inactive senders and malformed payloads before reading authority', async () => {
  const { authority, calls, value } = adapter();
  await assert.rejects(
    value.channels.read.invoke(Object.freeze({ sender: Object.freeze({}) }), { project_id: PROJECT_ID }),
    (error) => error instanceof BuilderTaskStreamIpcError
      && error.code === 'builder_task_stream_forbidden'
      && error.stack === `${error.name}: ${error.message}`,
  );
  for (const payload of [
    undefined,
    { project_id: 'bad' },
    { project_id: PROJECT_ID, conversation_id: CONVERSATION_ID },
  ]) {
    await assert.rejects(
      value.channels.read.invoke(authority.event, payload),
      (error) => error instanceof BuilderTaskStreamIpcError
        && error.code === 'builder_task_stream_invalid',
    );
  }
  await assert.rejects(
    value.channels.read.invoke(authority.event, { project_id: PROJECT_ID }, { extra: true }),
    (error) => error instanceof BuilderTaskStreamIpcError
      && error.code === 'builder_task_stream_invalid',
  );
  assert.deepEqual(calls, []);
});

test('task stream adapter maps service failures to fixed public errors without private details', async () => {
  const source = new Error('private sqlite marker');
  source.code = 'builder_task_stream_unavailable';
  const { authority, value } = adapter({
    readStream: async () => { throw source; },
  });
  await assert.rejects(
    value.channels.read.invoke(authority.event, { project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID }),
    (error) => error instanceof BuilderTaskStreamIpcError
      && error.code === 'builder_task_stream_unavailable'
      && error.retryable === true
      && !`${error.message}:${error.stack}`.includes('private sqlite marker'),
  );

  const unknown = adapter({
    readStream: async () => { throw new Error('private unknown marker'); },
  });
  await assert.rejects(
    unknown.value.channels.read.invoke(unknown.authority.event, { project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID }),
    (error) => error instanceof BuilderTaskStreamIpcError
      && error.code === 'builder_task_stream_unavailable'
      && !`${error.message}:${error.stack}`.includes('private unknown marker'),
  );
});

test('task stream adapter fails closed on hostile or oversized output without invoking proxy traps', async () => {
  let traps = 0;
  const hostile = new Proxy({}, {
    ownKeys() {
      traps += 1;
      throw new Error('private output marker');
    },
  });
  const { authority, value } = adapter({
    readStream: async () => hostile,
  });
  await assert.rejects(
    value.channels.read.invoke(authority.event, { project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID }),
    (error) => error instanceof BuilderTaskStreamIpcError
      && error.code === 'builder_task_stream_unavailable',
  );
  assert.equal(traps, 0);

  const accessor = adapter({
    readStream: async () => {
      const output = streamWire();
      Object.defineProperty(output, 'conversation', {
        enumerable: true,
        get() { return null; },
      });
      return output;
    },
  });
  await assert.rejects(
    accessor.value.channels.read.invoke(accessor.authority.event, { project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID }),
    { code: 'builder_task_stream_unavailable' },
  );

  const oversized = adapter({
    readStream: async () => streamWire({
      conversation: null,
      marker: 'a'.repeat((4 * 1024 * 1024) + 1),
    }),
  });
  await assert.rejects(
    oversized.value.channels.read.invoke(oversized.authority.event, { project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID }),
    { code: 'builder_task_stream_unavailable' },
  );
});

test('task stream adapter rejects malformed options without invoking getters or proxy traps', () => {
  let getterCalls = 0;
  const authority = windowAuthority();
  const accessorOptions = { readStream: async () => streamWire() };
  Object.defineProperty(accessorOptions, 'mainWindowRef', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return authority.mainWindowRef;
    },
  });
  for (const invalid of [
    null,
    {},
    { readStream: async () => streamWire(), mainWindowRef: authority.mainWindowRef, extra: true },
    accessorOptions,
    new Proxy({}, { getPrototypeOf() { throw new Error('private proxy marker'); } }),
  ]) {
    assert.throws(
      () => createBuilderTaskStreamIpcAdapter(invalid),
      (error) => error instanceof BuilderTaskStreamIpcError
        && error.code === 'builder_task_stream_unavailable'
        && !`${error.message}:${error.stack}`.includes('private'),
    );
  }
  assert.equal(getterCalls, 0);
});

test('task stream adapter source has no registration, write, package, or legacy authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-task-stream-ipc-adapter.cjs'),
    'utf8',
  );
  assert.match(source, /active_renderer_required:\s*true/u);
  assert.match(source, /read_only:\s*true/u);
  assert.match(source, /provider_dispatch:\s*false/u);
  assert.match(source, /credential_readback:\s*false/u);
  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git-|node:sqlite|fetch\s*\(|https?:|saveDraft|generate|persist_candidate_commit|write_current|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
  );
});
