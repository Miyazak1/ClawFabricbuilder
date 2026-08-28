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

const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174001';

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
