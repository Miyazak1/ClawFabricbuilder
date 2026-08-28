'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  BuilderTaskAttentionStoreError,
  RESULT_VERSION,
  STORE_VERSION,
  createBuilderTaskAttentionStore,
} = require('../electron/builder-task-attention-store.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174101';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174101:123e4567-e89b-42d3-a456-426614174102';
const TASK_ADDRESS_ID = 'builder-task-address:123e4567-e89b-42d3-a456-426614174103';

function temporaryDatabase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-task-attention-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  return path.join(root, 'task-attention.sqlite');
}

function attention(revision, overrides = {}) {
  const suffix = String(revision).padStart(12, '0');
  return {
    record_version: 'builder-task-attention-record.v1',
    attention_id: `builder-task-attention:123e4567-e89b-42d3-a456-${suffix}`,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_address_id: TASK_ADDRESS_ID,
    state: 'waiting_permission',
    reason_code: 'current_project_write',
    request_digest: `sha256:${'a'.repeat(64)}`,
    revision,
    updated_at_ms: revision * 1_000,
    ...overrides,
  };
}

function assertStoreError(fn, code) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof BuilderTaskAttentionStoreError);
    assert.equal(error.code, code);
    return true;
  });
}

test('restores the latest task attention after restart and records its resolution', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderTaskAttentionStore(databasePath);
  assert.equal(store.store_version, STORE_VERSION);
  assert.equal(store.read_task_attention({
    project_id: PROJECT_ID,
    task_address_id: TASK_ADDRESS_ID,
  }).status, 'absent');

  const recorded = store.record_task_attention({ attention: attention(1) });
  assert.equal(recorded.result_version, RESULT_VERSION);
  assert.equal(recorded.status, 'recorded');
  assert.equal(Object.isFrozen(recorded.attention), true);
  store.close();

  const restarted = createBuilderTaskAttentionStore(databasePath);
  const restored = restarted.read_task_attention({
    project_id: PROJECT_ID,
    task_address_id: TASK_ADDRESS_ID,
  });
  assert.equal(restored.status, 'ready');
  assert.equal(restored.attention.state, 'waiting_permission');

  restarted.record_task_attention({ attention: attention(2, {
    state: 'ready',
    reason_code: 'resolved',
    request_digest: null,
  }) });
  assert.equal(restarted.read_task_attention({
    project_id: PROJECT_ID,
    task_address_id: TASK_ADDRESS_ID,
  }).attention.state, 'ready');
  restarted.close();
});

test('rejects skipped revisions, stale timestamps, duplicate facts, and unsafe requests', (t) => {
  const store = createBuilderTaskAttentionStore(temporaryDatabase(t));
  store.record_task_attention({ attention: attention(1) });

  assertStoreError(
    () => store.record_task_attention({ attention: attention(3) }),
    'builder_task_attention_store_conflict',
  );
  assertStoreError(
    () => store.record_task_attention({ attention: attention(2, { updated_at_ms: 999 }) }),
    'builder_task_attention_store_conflict',
  );
  assertStoreError(
    () => store.record_task_attention({ attention: attention(1) }),
    'builder_task_attention_store_conflict',
  );
  assertStoreError(
    () => store.read_task_attention(new Proxy({
      project_id: PROJECT_ID,
      task_address_id: TASK_ADDRESS_ID,
    }, {})),
    'builder_task_attention_store_invalid',
  );
  store.close();
});
