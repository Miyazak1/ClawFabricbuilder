'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_WORKBENCH_MESSAGE_ENVELOPE_VERSION,
  BUILDER_WORKBENCH_THREAD_VERSION,
} = require('../electron/builder-workbench-message-contract.cjs');
const {
  createBuilderWorkbenchMessageStore,
} = require('../electron/builder-workbench-message-store.cjs');
const {
  createBuilderWorkbenchTimelineProjection,
} = require('../electron/builder-workbench-timeline-projection.cjs');

const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174001';
const THREAD_ID = 'builder-workbench-thread:123e4567-e89b-42d3-a456-426614174002';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-workbench-message-store-'));
  const store = createBuilderWorkbenchMessageStore(path.join(root, 'messages.sqlite'));
  t.after(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  store.record_thread({
    thread: {
      thread_version: BUILDER_WORKBENCH_THREAD_VERSION,
      thread_id: THREAD_ID,
      agent_id: AGENT_ID,
      owner_id: OWNER_ID,
      thread_kind: 'conversation',
      title: 'Builder',
      created_at_ms: 10,
      updated_at_ms: 10,
    },
  });
  return store;
}

function message(index, overrides = {}) {
  const suffix = String(index).padStart(3, '0');
  return {
    envelope_version: BUILDER_WORKBENCH_MESSAGE_ENVELOPE_VERSION,
    message_id: `builder-message:123e4567-e89b-42d3-a456-426614174${suffix}`,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    source: {
      source_kind: index % 2 === 0 ? 'local_agent' : 'owner',
      source_id: index % 2 === 0 ? AGENT_ID : OWNER_ID,
      connector_id: null,
      actor_id: index % 2 === 0 ? AGENT_ID : OWNER_ID,
      external_message_id: null,
    },
    address: {
      workbench_id: 'builder-agent-workbench:123e4567-e89b-42d3-a456-426614174002',
      thread_id: THREAD_ID,
      reply_route_id: null,
      project_id: null,
      task_address_id: null,
    },
    content: {
      content_type: index % 2 === 0
        ? 'builder.chat.agent_message.v1'
        : 'builder.chat.user_message.v1',
      schema_ref: 'builder.workbench.chat_message.v1',
      schema_version: 1,
      payload: { role: index % 2 === 0 ? 'assistant' : 'user', text: `Message ${index}` },
      fallback_text: `Message ${index}`,
    },
    delivery: {
      attention: 'normal',
      visibility: 'main_stream',
      dedupe_key: `message:${index}`,
      source_sequence: `source:${index}`,
    },
    trust: {
      provenance: index % 2 === 0 ? 'local_system' : 'human',
      sensitivity: 'local',
      prompt_admission: 'candidate',
      memory_admission: index % 2 === 0 ? 'excluded' : 'candidate',
    },
    attachment_refs: [],
    proposed_action_refs: [],
    created_at_ms: 10 + index,
    received_at_ms: 10 + index,
    ...overrides,
  };
}

test('records messages idempotently and reads stable cursor pages', (t) => {
  const store = fixture(t);
  for (let index = 1; index <= 3; index += 1) store.record_message({ message: message(index) });
  assert.equal(store.record_message({ message: message(1) }).operation, 'message_exists');
  const latest = store.read_timeline({ agent_id: AGENT_ID, after_cursor: null, limit: 2 });
  assert.deepEqual(latest.items.map((item) => item.message.content.fallback_text), ['Message 2', 'Message 3']);
  assert.equal(latest.has_more, true);
  const first = store.read_timeline({ agent_id: AGENT_ID, after_cursor: 'builder-workbench-cursor:1', limit: 2 });
  assert.deepEqual(first.items.map((item) => item.local_sequence), [2, 3]);
  assert.equal(first.next_cursor, 'builder-workbench-cursor:3');
});

test('keeps mutable read/archive state separate from immutable messages', (t) => {
  const store = fixture(t);
  store.record_message({ message: message(2) });
  assert.deepEqual(store.read_inbox_counts({ agent_id: AGENT_ID }), {
    unread_count: 1,
    action_required_count: 0,
  });
  store.update_message_state({
    agent_id: AGENT_ID,
    message_id: message(2).message_id,
    operation: 'mark_read',
    updated_at_ms: 30,
  });
  assert.equal(store.read_inbox_counts({ agent_id: AGENT_ID }).unread_count, 0);
  const item = store.read_timeline({ agent_id: AGENT_ID, after_cursor: null, limit: 10 }).items[0];
  assert.equal(item.message.content.fallback_text, 'Message 2');
  assert.equal(item.state.read_at_ms, 30);
});

test('acknowledges action-required messages as read and removes them from attention counts', (t) => {
  const store = fixture(t);
  const resultMessage = message(2, {
    delivery: {
      ...message(2).delivery,
      attention: 'action_required',
    },
  });
  store.record_message({ message: resultMessage });
  assert.deepEqual(store.read_inbox_counts({ agent_id: AGENT_ID }), {
    unread_count: 1,
    action_required_count: 1,
  });

  store.update_message_state({
    agent_id: AGENT_ID,
    message_id: resultMessage.message_id,
    operation: 'acknowledge',
    updated_at_ms: 30,
  });

  assert.deepEqual(store.read_inbox_counts({ agent_id: AGENT_ID }), {
    unread_count: 0,
    action_required_count: 0,
  });
  const item = store.read_timeline({ agent_id: AGENT_ID, after_cursor: null, limit: 10 }).items[0];
  assert.equal(item.state.read_at_ms, 30);
  assert.equal(item.state.acknowledged_at_ms, 30);
});

test('projects built-in Markdown and unknown plugin content through safe declarative fields', (t) => {
  const store = fixture(t);
  store.record_message({ message: message(2) });
  store.record_message({ message: message(3, {
    content: {
      content_type: 'example.forum.topic_update.v7',
      schema_ref: 'example.forum.topic_update.v7',
      schema_version: 7,
      payload: { html: '<script>not exposed</script>', title: 'Plugin update' },
      fallback_text: 'Plugin update',
    },
    source: {
      source_kind: 'forum',
      source_id: 'forum:example',
      connector_id: 'example.forum',
      actor_id: null,
      external_message_id: 'topic:7',
    },
    trust: {
      provenance: 'untrusted',
      sensitivity: 'public',
      prompt_admission: 'excluded',
      memory_admission: 'review_required',
    },
  }) });
  const projection = createBuilderWorkbenchTimelineProjection({
    message_store: store,
    task_monitor_projection: {
      read_monitor: () => ({ counts: { active: 0 }, tasks: [] }),
    },
  })
    .read_workbench({ agent_id: AGENT_ID, after_cursor: null, limit: 10 });
  assert.equal(projection.stream.items[0].presentation.body_kind, 'markdown');
  assert.equal(projection.stream.items[1].presentation_family, 'generic');
  assert.equal(projection.stream.items[1].presentation.body_text, 'Plugin update');
  assert.doesNotMatch(JSON.stringify(projection), /<script>|not exposed/u);
  assert.equal(projection.authority.permission_grant, false);
});

test('rejects conflicting replay and invalid thread relationships', (t) => {
  const store = fixture(t);
  store.record_message({ message: message(1) });
  assert.throws(() => store.record_message({ message: message(1, {
    content: { ...message(1).content, fallback_text: 'Changed' },
  }) }), { code: 'builder_workbench_message_store_conflict' });
  assert.throws(() => store.record_message({ message: message(2, {
    address: { ...message(2).address, thread_id: 'builder-workbench-thread:123e4567-e89b-42d3-a456-426614174099' },
  }) }), { code: 'builder_workbench_message_store_invalid' });
});
