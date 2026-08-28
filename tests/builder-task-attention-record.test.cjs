'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BuilderTaskAttentionRecordError,
  RECORD_VERSION,
  sanitizeBuilderTaskAttentionRecord,
} = require('../electron/builder-task-attention-record.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174101';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174101:123e4567-e89b-42d3-a456-426614174102';
const TASK_ADDRESS_ID = 'builder-task-address:123e4567-e89b-42d3-a456-426614174103';

function attention(overrides = {}) {
  return {
    record_version: RECORD_VERSION,
    attention_id: 'builder-task-attention:123e4567-e89b-42d3-a456-426614174104',
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_address_id: TASK_ADDRESS_ID,
    state: 'waiting_permission',
    reason_code: 'current_project_write',
    request_digest: `sha256:${'a'.repeat(64)}`,
    revision: 1,
    updated_at_ms: 1_000,
    ...overrides,
  };
}

test('sanitizes immutable waiting and resolved task attention facts', () => {
  const waiting = sanitizeBuilderTaskAttentionRecord(attention());
  assert.equal(waiting.state, 'waiting_permission');
  assert.equal(Object.isFrozen(waiting), true);

  const ready = sanitizeBuilderTaskAttentionRecord(attention({
    attention_id: 'builder-task-attention:223e4567-e89b-42d3-a456-426614174104',
    state: 'ready',
    reason_code: 'resolved',
    request_digest: null,
    revision: 2,
    updated_at_ms: 2_000,
  }));
  assert.equal(ready.state, 'ready');
});

test('rejects inconsistent states, malformed identities, accessors, and proxies', () => {
  const cases = [
    attention({ state: 'ready' }),
    attention({ state: 'waiting_permission', reason_code: 'resolved' }),
    attention({ project_id: 'builder-project:invalid' }),
    attention({ revision: 0 }),
    new Proxy(attention(), {}),
    Object.defineProperty(attention(), 'state', { enumerable: true, get: () => 'waiting_permission' }),
  ];
  for (const value of cases) {
    assert.throws(() => sanitizeBuilderTaskAttentionRecord(value), BuilderTaskAttentionRecordError);
  }
});
