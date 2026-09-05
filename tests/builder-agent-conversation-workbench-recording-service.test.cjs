'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderAgentConversationWorkbenchRecordingService,
} = require('../electron/builder-agent-conversation-workbench-recording-service.cjs');
const {
  createBuilderWorkbenchMessageStore,
} = require('../electron/builder-workbench-message-store.cjs');
const { createBuilderWorkbenchTimelineProjection } = require('../electron/builder-workbench-timeline-projection.cjs');

const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174001';

for (const outcome of ['cancelled', 'interrupted', 'failed']) {
  test(`records one durable ${outcome} notice between requests, including after restart`, (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-workbench-terminal-'));
    const databasePath = path.join(root, 'messages.sqlite');
    let store = createBuilderWorkbenchMessageStore(databasePath);
    t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
    const createService = () => createBuilderAgentConversationWorkbenchRecordingService({
      message_store: store, agent_id: AGENT_ID, owner_id: OWNER_ID,
    });
    let service = createService();
    const value = stream();
    value.conversation.head_sequence = 2;
    value.conversation.items = value.conversation.items.slice(0, 1);
    assert.equal(service.sync_agent_conversation_stream(value).recorded_count, 1);
    value.conversation.head_sequence = 4;
    value.conversation.items.push({
      item_kind: 'turn_completed', sequence: 4, outcome,
      turn_id: value.conversation.items[0].turn_id,
      run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174099',
    });
    assert.equal(service.sync_agent_conversation_stream(value).recorded_count, 1);
    assert.equal(service.sync_agent_conversation_stream(value).recorded_count, 0);
    value.conversation.head_sequence = 6;
    value.conversation.items.push({ ...value.conversation.items[0], sequence: 5,
      turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174097',
      message: { message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174098', text: 'Try the revision again.' },
    });
    assert.equal(service.sync_agent_conversation_stream(value).recorded_count, 1);
    store.close();
    store = createBuilderWorkbenchMessageStore(databasePath);
    service = createService();
    assert.equal(service.sync_agent_conversation_stream(value).recorded_count, 0);
    const timeline = store.read_timeline({ agent_id: AGENT_ID, after_cursor: null, limit: 10 });
    assert.deepEqual(timeline.items.map(({ message }) => message.content.content_type), [
      'builder.chat.user_message.v1', 'builder.chat.turn_status.v1', 'builder.chat.user_message.v1',
    ]);
    const notice = timeline.items[1].message;
    assert.equal(notice.content.payload.outcome, outcome);
    assert.equal(notice.content.payload.turn_id, value.conversation.items[0].turn_id);
    assert.equal(notice.trust.prompt_admission, 'excluded');
    assert.equal(notice.trust.memory_admission, 'excluded');
    assert.equal(notice.address.project_id, null);
    assert.equal(notice.address.task_address_id, null);
    const projection = createBuilderWorkbenchTimelineProjection({
      message_store: store, task_monitor_projection: { read_monitor: () => ({ counts: { active: 0 } }) },
    }).read_workbench({ agent_id: AGENT_ID, after_cursor: null, limit: 10 });
    assert.equal(projection.stream.items[1].presentation_family, 'conversation');
    assert.equal(projection.stream.items[1].presentation.body_kind, 'plain_text');
    assert.equal(projection.stream.items[1].presentation.body_text, notice.content.payload.text);
  });
}

function stream() {
  return {
    stream_version: 'builder-task-stream-read-result.v1',
    scope_kind: 'agent_conversation',
    agent_id: AGENT_ID,
    project_id: null,
    conversation: {
      conversation_id: 'builder-agent-conversation:123e4567-e89b-42d3-a456-426614174002',
      created_at_ms: 100,
      head_sequence: 4,
      recorded_active_turn_id: null,
      source: 'sqlite_canonical_agent_conversation',
      window: { first_sequence: 1, last_sequence: 4, has_earlier: false },
      items: [
        {
          item_kind: 'transcript_message',
          sequence: 1,
          turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174003',
          message: {
            message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174004',
            text: 'Let us discuss a Workbench.',
          },
          role: 'user',
          message_kind: 'submitted',
          context_route: 'update_brief',
          recovery_admission: 'sqlite_derived_public_transcript_only',
        },
        {
          item_kind: 'transcript_message',
          sequence: 3,
          turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174003',
          message: {
            message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174005',
            text: 'We can keep execution inside Tasks.',
          },
          role: 'assistant',
          message_kind: 'run_result',
          recovery_admission: 'sqlite_derived_public_transcript_only',
        },
      ],
    },
    authority: {},
  };
}

test('idempotently synchronizes Agent chat into typed Workbench messages', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-workbench-recording-'));
  const store = createBuilderWorkbenchMessageStore(path.join(root, 'messages.sqlite'));
  t.after(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const service = createBuilderAgentConversationWorkbenchRecordingService({
    message_store: store,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
  });
  assert.equal(service.sync_agent_conversation_stream(stream()).recorded_count, 2);
  assert.equal(service.sync_agent_conversation_stream(stream()).recorded_count, 0);
  const timeline = store.read_timeline({ agent_id: AGENT_ID, after_cursor: null, limit: 10 });
  assert.deepEqual(
    timeline.items.map((item) => [item.message.source.source_kind, item.message.content.content_type]),
    [
      ['owner', 'builder.chat.user_message.v1'],
      ['local_agent', 'builder.chat.agent_message.v1'],
    ],
  );
  assert.equal(timeline.items[0].message.content.payload.context_route, 'update_brief');
  assert.equal(timeline.items[1].message.trust.memory_admission, 'excluded');
});

test('accepts an empty Agent stream without synthesizing a Project or Task', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-workbench-empty-'));
  const store = createBuilderWorkbenchMessageStore(path.join(root, 'messages.sqlite'));
  t.after(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const service = createBuilderAgentConversationWorkbenchRecordingService({
    message_store: store,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
  });
  const result = service.sync_agent_conversation_stream({
    stream_version: 'builder-task-stream-read-result.v1',
    scope_kind: 'agent_conversation',
    agent_id: AGENT_ID,
    project_id: null,
    conversation: null,
    authority: {},
  });
  assert.equal(result.operation, 'conversation_empty');
  assert.equal(store.read_timeline({ agent_id: AGENT_ID, after_cursor: null, limit: 10 }).items.length, 0);
});

test('writes only new transcript messages and does not advance after a failed write', () => {
  const writes = [];
  let failWrite = true;
  const service = createBuilderAgentConversationWorkbenchRecordingService({
    message_store: {
      record_thread() {},
      record_message({ message }) {
        writes.push(message.message_id);
        if (failWrite && writes.length === 2) throw new Error('temporary');
        return { operation: 'message_recorded' };
      },
    },
    agent_id: AGENT_ID, owner_id: OWNER_ID,
  });
  assert.throws(() => service.sync_agent_conversation_stream(stream()), /temporary/);
  failWrite = false;
  service.sync_agent_conversation_stream(stream());
  assert.equal(writes.length, 4);
  service.sync_agent_conversation_stream(stream());
  assert.equal(writes.length, 4);
  const next = stream();
  next.conversation.head_sequence = 6;
  next.conversation.items.push({ ...next.conversation.items[0], sequence: 5,
    message: { message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174006', text: 'Revise it' } });
  service.sync_agent_conversation_stream(next);
  assert.equal(writes.length, 5);
});

test('backfilled notices keep canonical conversation order without rewriting store cursors', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-workbench-backfill-'));
  const store = createBuilderWorkbenchMessageStore(path.join(root, 'messages.sqlite'));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const createService = () => createBuilderAgentConversationWorkbenchRecordingService({
    message_store: store, agent_id: AGENT_ID, owner_id: OWNER_ID,
  });
  const value = stream();
  value.conversation.items[1] = { ...value.conversation.items[0], sequence: 5,
    turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174097',
    message: { message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174098', text: 'Next request' },
  };
  value.conversation.head_sequence = 6;
  createService().sync_agent_conversation_stream(value);
  value.conversation.items.splice(1, 0, {
    item_kind: 'turn_completed', sequence: 4, outcome: 'cancelled',
    turn_id: value.conversation.items[0].turn_id,
    run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174099',
  });
  assert.equal(createService().sync_agent_conversation_stream(value).recorded_count, 1);
  const request = { agent_id: AGENT_ID, after_cursor: null, limit: 10 };
  const stored = store.read_timeline(request);
  assert.equal(stored.items.at(-1).message.content.content_type, 'builder.chat.turn_status.v1');
  const projected = createBuilderWorkbenchTimelineProjection({
    message_store: store, task_monitor_projection: { read_monitor: () => ({ counts: { active: 0 } }) },
  }).read_workbench(request);
  assert.deepEqual(projected.stream.items.map((item) => item.content_type), [
    'builder.chat.user_message.v1', 'builder.chat.turn_status.v1', 'builder.chat.user_message.v1',
  ]);
  assert.equal(projected.stream.next_cursor, stored.next_cursor);
});
