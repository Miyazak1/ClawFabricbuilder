'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');

const {
  createBuilderContextCompactionSummary,
} = require('../electron/builder-context-compaction-summary.cjs');
const {
  BUILDER_CONTEXT_COMPACTION_SUMMARY_STORE_READ_RESULT_VERSION,
  BUILDER_CONTEXT_COMPACTION_SUMMARY_STORE_RESULT_VERSION,
  BUILDER_CONTEXT_COMPACTION_SUMMARY_STORE_SCHEMA_VERSION,
  BUILDER_CONTEXT_COMPACTION_SUMMARY_STORE_USER_VERSION,
  BUILDER_CONTEXT_COMPACTION_SUMMARY_STORE_VERSION,
  BuilderContextCompactionSummaryStoreError,
  createBuilderContextCompactionSummaryStore,
} = require('../electron/builder-context-compaction-summary-store.cjs');

const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174500';
const OTHER_CONVERSATION_ID = 'builder-conversation:223e4567-e89b-42d3-a456-426614174500';
const TASK_ADDRESS_ID = 'builder-task-address:123e4567-e89b-42d3-a456-426614174501';

function temporaryDatabase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-context-compaction-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  return path.join(root, 'context-compaction.sqlite');
}

function digest(char) {
  return `sha256:${char.repeat(64)}`;
}

function eventId(char) {
  return `builder-conversation-event:${char.repeat(64)}`;
}

function summary(index = 1, overrides = {}) {
  return createBuilderContextCompactionSummary({
    conversation_id: CONVERSATION_ID,
    task_address_id: TASK_ADDRESS_ID,
    source_event_start_id: eventId(String(index)),
    source_event_end_id: eventId(String(index + 1)),
    source_event_count: 10 + index,
    token_budget_before: 80_000,
    token_budget_after: 12_000 + index,
    summary: `Compacted conversation context ${index}. The user intent remains review-gated implementation.`,
    durable_decisions: [`Decision ${index} remains durable.`],
    unresolved_questions: [],
    omitted_large_outputs: [{
      source_kind: 'tool_output',
      source_digest: digest(String(index)),
      reason: 'Large output omitted; digest retained.',
    }],
    source_refs: [
      { source_kind: 'user_message', source_digest: digest('a') },
      { source_kind: 'assistant_message', source_digest: digest('b') },
    ],
    created_at_ms: 1_000 + index,
    ...overrides,
  });
}

function assertStoreError(fn, expectedCode = 'builder_context_compaction_summary_store_invalid') {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof BuilderContextCompactionSummaryStoreError);
    assert.equal(error.code, expectedCode);
    assert.doesNotMatch(
      `${error.name}:${error.message}:${error.stack}`,
      /secret-value|api[_-]?key|credential|provider|source_tree|C:\\|raw prompt|private marker|Bearer/iu,
    );
    return true;
  });
}

test('records context compaction summaries and restores latest after restart', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderContextCompactionSummaryStore(databasePath);
  const first = summary(1);
  const second = summary(2, { created_at_ms: 1_500 });

  const recorded = store.record_context_compaction_summary({ context_compaction_summary: first });
  assert.equal(store.store_version, BUILDER_CONTEXT_COMPACTION_SUMMARY_STORE_VERSION);
  assert.equal(recorded.result_version, BUILDER_CONTEXT_COMPACTION_SUMMARY_STORE_RESULT_VERSION);
  assert.equal(recorded.operation, 'context_compaction_summary_recorded');
  assert.deepEqual(recorded.context_compaction_summary.context_compaction_summary, first);
  assert.equal(
    recorded.compaction_summary_evidence.compaction_summary_authority,
    'main_owned_context_compaction_summary_store',
  );
  assert.equal(
    recorded.compaction_summary_evidence.compaction_summary_contract_authority,
    'main_context_compaction_summary_contract_v1',
  );
  assert.equal(recorded.compaction_summary_evidence.schema_version, BUILDER_CONTEXT_COMPACTION_SUMMARY_STORE_SCHEMA_VERSION);
  assert.equal(recorded.compaction_summary_evidence.user_version, BUILDER_CONTEXT_COMPACTION_SUMMARY_STORE_USER_VERSION);
  assert.equal(recorded.compaction_summary_evidence.renderer_authority, 'not_present');
  assert.equal(recorded.compaction_summary_evidence.ipc_authority, 'not_present');
  assert.equal(recorded.compaction_summary_evidence.conversation_append, false);
  assert.equal(recorded.compaction_summary_evidence.conversation_delete, false);
  assert.equal(recorded.compaction_summary_evidence.provider_dispatch, false);
  assert.equal(recorded.compaction_summary_evidence.tool_dispatch, false);
  assert.equal(recorded.compaction_summary_evidence.source_write, 'not_present');
  assert.equal(recorded.compaction_summary_evidence.git_mutation, false);
  assert.equal(recorded.compaction_summary_evidence.permission_grant_authority, false);
  assert.equal(recorded.compaction_summary_evidence.readiness_authority, 'not_authoritative_for_readiness');
  assert.match(recorded.compaction_summary_evidence.schema_fingerprint_digest, /^sha256:[0-9a-f]{64}$/u);

  const replayed = store.record_context_compaction_summary({ context_compaction_summary: first });
  assert.equal(replayed.operation, 'context_compaction_summary_replayed');
  assert.deepEqual(replayed.context_compaction_summary.context_compaction_summary, first);

  store.record_context_compaction_summary({ context_compaction_summary: second });
  const read = store.read_context_compaction_summary({
    conversation_id: CONVERSATION_ID,
    summary_id: first.summary_id,
  });
  assert.equal(read.result_version, BUILDER_CONTEXT_COMPACTION_SUMMARY_STORE_READ_RESULT_VERSION);
  assert.equal(read.status, 'ready');
  assert.deepEqual(read.context_compaction_summary.context_compaction_summary, first);

  const latest = store.read_latest_context_compaction_summary({
    conversation_id: CONVERSATION_ID,
    task_address_id: TASK_ADDRESS_ID,
  });
  assert.equal(latest.status, 'ready');
  assert.equal(latest.context_compaction_summary.context_compaction_summary.summary_id, second.summary_id);
  store.close();

  const restarted = createBuilderContextCompactionSummaryStore(databasePath);
  const restored = restarted.read_latest_context_compaction_summary({
    conversation_id: CONVERSATION_ID,
    task_address_id: TASK_ADDRESS_ID,
  });
  assert.equal(restored.status, 'ready');
  assert.equal(restored.context_compaction_summary.context_compaction_summary.summary_id, second.summary_id);
  restarted.close();
});

test('returns absent for other conversations and empty latest reads', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderContextCompactionSummaryStore(databasePath);
  const record = summary(1);
  store.record_context_compaction_summary({ context_compaction_summary: record });

  assert.equal(
    store.read_context_compaction_summary({
      conversation_id: OTHER_CONVERSATION_ID,
      summary_id: record.summary_id,
    }).status,
    'absent',
  );
  assert.equal(
    store.read_latest_context_compaction_summary({
      conversation_id: OTHER_CONVERSATION_ID,
      task_address_id: TASK_ADDRESS_ID,
    }).status,
    'absent',
  );
  store.close();
});

test('rejects conflicting range replay, malformed input, accessors, proxies, and tampered rows', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderContextCompactionSummaryStore(databasePath);
  const record = summary(1);
  store.record_context_compaction_summary({ context_compaction_summary: record });

  const conflicting = summary(1, {
    summary: 'Compacted conversation context 1. A conflicting summary should not replace the range.',
  });
  assertStoreError(
    () => store.record_context_compaction_summary({ context_compaction_summary: conflicting }),
    'builder_context_compaction_summary_store_conflict',
  );
  assertStoreError(() => store.record_context_compaction_summary({
    context_compaction_summary: record,
    extra: true,
  }));
  assertStoreError(() => store.read_context_compaction_summary({
    conversation_id: CONVERSATION_ID,
    summary_id: record.summary_id,
    extra: true,
  }));

  let getterCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'context_compaction_summary', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('private marker');
    },
  });
  assertStoreError(() => store.record_context_compaction_summary(accessor));
  assert.equal(getterCalls, 0);

  let proxyTrapInvoked = false;
  const proxyTrap = () => {
    proxyTrapInvoked = true;
    throw new Error('private proxy marker');
  };
  assertStoreError(() => store.record_context_compaction_summary(new Proxy(
    { context_compaction_summary: record },
    {
      getOwnPropertyDescriptor: proxyTrap,
      getPrototypeOf: proxyTrap,
      ownKeys: proxyTrap,
    },
  )));
  assert.equal(proxyTrapInvoked, false);
  store.close();

  const raw = new DatabaseSync(databasePath);
  raw.prepare('UPDATE context_compaction_summaries SET digest = ? WHERE summary_id = ?')
    .run(digest('9'), record.summary_id);
  raw.close();

  const reopened = createBuilderContextCompactionSummaryStore(databasePath);
  assertStoreError(
    () => reopened.read_context_compaction_summary({
      conversation_id: CONVERSATION_ID,
      summary_id: record.summary_id,
    }),
    'builder_context_compaction_summary_store_integrity_failed',
  );
  reopened.close();
});

test('rejects schema drift and unsafe database paths', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderContextCompactionSummaryStore(databasePath);
  store.close();

  const raw = new DatabaseSync(databasePath);
  raw.exec('DROP INDEX context_compaction_summaries_latest_idx');
  raw.close();
  assertStoreError(
    () => createBuilderContextCompactionSummaryStore(databasePath),
    'builder_context_compaction_summary_store_integrity_failed',
  );

  assertStoreError(() => createBuilderContextCompactionSummaryStore('relative.sqlite'));
  const missingParent = path.join(path.dirname(databasePath), 'missing', 'x.sqlite');
  assertStoreError(
    () => createBuilderContextCompactionSummaryStore(missingParent),
    'builder_context_compaction_summary_store_unavailable',
  );
});

test('source remains a main-owned store without renderer, provider, command, or Git authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-context-compaction-summary-store.cjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /ipcMain|contextBridge|BrowserWindow|shell\.|child_process|fetch\(|XMLHttpRequest/iu);
  assert.doesNotMatch(source, /safeStorage|provider_secret|apiKey|process\.env|git\s+(?:commit|add|push)/iu);
});
