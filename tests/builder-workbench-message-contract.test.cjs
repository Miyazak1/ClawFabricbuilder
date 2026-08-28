'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BUILDER_WORKBENCH_MESSAGE_ENVELOPE_VERSION,
  BUILDER_WORKBENCH_MESSAGE_STATE_VERSION,
  BUILDER_WORKBENCH_THREAD_VERSION,
  builderWorkbenchMessageDigest,
  sanitizeBuilderWorkbenchMessageEnvelope,
  sanitizeBuilderWorkbenchMessageState,
  sanitizeBuilderWorkbenchThread,
} = require('../electron/builder-workbench-message-contract.cjs');

const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174001';
const MESSAGE_ID = 'builder-message:123e4567-e89b-42d3-a456-426614174003';
const THREAD_ID = 'builder-workbench-thread:123e4567-e89b-42d3-a456-426614174002';

function message(overrides = {}) {
  return {
    envelope_version: BUILDER_WORKBENCH_MESSAGE_ENVELOPE_VERSION,
    message_id: MESSAGE_ID,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    source: {
      source_kind: 'owner',
      source_id: OWNER_ID,
      connector_id: null,
      actor_id: OWNER_ID,
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
      content_type: 'builder.chat.user_message.v1',
      schema_ref: 'builder.workbench.chat_message.v1',
      schema_version: 1,
      payload: {
        role: 'user',
        sequence: 1,
        text: 'Let us discuss the product first.',
      },
      fallback_text: 'Let us discuss the product first.',
    },
    delivery: {
      attention: 'normal',
      visibility: 'main_stream',
      dedupe_key: MESSAGE_ID,
      source_sequence: 'agent-conversation:1',
    },
    trust: {
      provenance: 'human',
      sensitivity: 'local',
      prompt_admission: 'candidate',
      memory_admission: 'candidate',
    },
    attachment_refs: [],
    proposed_action_refs: [],
    created_at_ms: 10,
    received_at_ms: 10,
    ...overrides,
  };
}

test('sanitizes a canonical Workbench message and produces a stable digest', () => {
  const first = sanitizeBuilderWorkbenchMessageEnvelope(message());
  const second = sanitizeBuilderWorkbenchMessageEnvelope({
    ...message(),
    content: {
      ...message().content,
      payload: { text: 'Let us discuss the product first.', sequence: 1, role: 'user' },
    },
  });
  assert.equal(first.content.payload.text, 'Let us discuss the product first.');
  assert.equal(Object.isFrozen(first), true);
  assert.equal(builderWorkbenchMessageDigest(first), builderWorkbenchMessageDigest(second));
});

test('accepts an unknown namespaced content type as canonical data for safe fallback projection', () => {
  const value = sanitizeBuilderWorkbenchMessageEnvelope(message({
    content: {
      content_type: 'example.forum.topic_update.v7',
      schema_ref: 'example.forum.topic_update.v7',
      schema_version: 7,
      payload: { title: 'A future plugin message' },
      fallback_text: 'A future plugin message',
    },
    trust: {
      provenance: 'untrusted',
      sensitivity: 'public',
      prompt_admission: 'excluded',
      memory_admission: 'review_required',
    },
  }));
  assert.equal(value.content.content_type, 'example.forum.topic_update.v7');
  assert.equal(value.trust.prompt_admission, 'excluded');
});

test('sanitizes separate Workbench thread and user-state records', () => {
  const thread = sanitizeBuilderWorkbenchThread({
    thread_version: BUILDER_WORKBENCH_THREAD_VERSION,
    thread_id: THREAD_ID,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    thread_kind: 'conversation',
    title: 'Builder',
    created_at_ms: 10,
    updated_at_ms: 10,
  });
  const state = sanitizeBuilderWorkbenchMessageState({
    state_version: BUILDER_WORKBENCH_MESSAGE_STATE_VERSION,
    message_id: MESSAGE_ID,
    read_at_ms: null,
    acknowledged_at_ms: null,
    archived_at_ms: null,
    muted: false,
    saved: false,
    selected_reaction: null,
    updated_at_ms: 10,
  });
  assert.equal(thread.thread_kind, 'conversation');
  assert.equal(state.read_at_ms, null);
});

test('fails closed on accessors, proxies, oversized payloads, and authority-like extra keys', () => {
  assert.throws(() => sanitizeBuilderWorkbenchMessageEnvelope({
    ...message(),
    permission_grant: true,
  }), { code: 'builder_workbench_message_contract_invalid' });
  assert.throws(() => sanitizeBuilderWorkbenchMessageEnvelope(new Proxy(message(), {})), {
    code: 'builder_workbench_message_contract_invalid',
  });
  const accessor = message();
  Object.defineProperty(accessor, 'message_id', { enumerable: true, get() { return MESSAGE_ID; } });
  assert.throws(() => sanitizeBuilderWorkbenchMessageEnvelope(accessor), {
    code: 'builder_workbench_message_contract_invalid',
  });
  assert.throws(() => sanitizeBuilderWorkbenchMessageEnvelope(message({
    content: {
      ...message().content,
      payload: { text: 'x'.repeat(70_000) },
    },
  })), { code: 'builder_workbench_message_contract_invalid' });
});
