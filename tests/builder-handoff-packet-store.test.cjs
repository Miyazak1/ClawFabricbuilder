'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');

const {
  createBuilderHandoffPacket,
} = require('../electron/builder-handoff-packet.cjs');
const {
  BUILDER_HANDOFF_PACKET_STORE_READ_RESULT_VERSION,
  BUILDER_HANDOFF_PACKET_STORE_RESULT_VERSION,
  BUILDER_HANDOFF_PACKET_STORE_SCHEMA_VERSION,
  BUILDER_HANDOFF_PACKET_STORE_USER_VERSION,
  BUILDER_HANDOFF_PACKET_STORE_VERSION,
  BuilderHandoffPacketStoreError,
  createBuilderHandoffPacketStore,
} = require('../electron/builder-handoff-packet-store.cjs');

const SOURCE_THREAD_ID = 'builder-session:123e4567-e89b-42d3-a456-426614174700';
const TARGET_THREAD_ID = 'builder-session:123e4567-e89b-42d3-a456-426614174701';
const OTHER_TARGET_THREAD_ID = 'builder-session:123e4567-e89b-42d3-a456-426614174702';
const SOURCE_TASK_ADDRESS_ID = 'builder-task-address:123e4567-e89b-42d3-a456-426614174703';

function temporaryDatabase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-handoff-packets-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  return path.join(root, 'handoff-packets.sqlite');
}

function digest(char) {
  return `sha256:${char.repeat(64)}`;
}

function packet(index = 1, overrides = {}) {
  return createBuilderHandoffPacket({
    source_thread_id: SOURCE_THREAD_ID,
    source_task_address_id: SOURCE_TASK_ADDRESS_ID,
    target_thread_id: TARGET_THREAD_ID,
    inserted_by: 'subagent',
    summary: `Handoff ${index} imports public result context and waits for target confirmation.`,
    decisions: [`Decision ${index} is informational only.`],
    open_questions: [],
    changed_files: [{
      path: `src/file-${index}.ts`,
      change_kind: 'modified',
      file_digest: digest(String(index)),
    }],
    commit_refs: [{
      ref_kind: 'project_revision',
      ref_digest: digest('a'),
    }],
    verification_evidence: [{
      evidence_kind: 'review',
      status: 'passed',
      evidence_digest: digest('b'),
      summary: 'Source review passed.',
    }],
    requested_next_action: 'Continue only after target task confirms.',
    authority_claims: [{
      claim_kind: 'context_only',
      classification: 'informational',
      summary: 'This packet supplies context only.',
    }],
    source_refs: [
      { source_kind: 'public_summary', source_digest: digest('c') },
      { source_kind: 'saved_revision', source_digest: digest('d') },
    ],
    inserted_at_ms: 1_000 + index,
    ...overrides,
  });
}

function assertStoreError(fn, expectedCode = 'builder_handoff_packet_store_invalid') {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof BuilderHandoffPacketStoreError);
    assert.equal(error.code, expectedCode);
    assert.doesNotMatch(
      `${error.name}:${error.message}:${error.stack}`,
      /secret-value|api[_-]?key|credential|provider|source_tree|C:\\|raw prompt|private marker|Bearer/iu,
    );
    return true;
  });
}

test('records handoff packets as pending inbox facts and restores after restart', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderHandoffPacketStore(databasePath);
  const first = packet(1);
  const second = packet(2, { inserted_at_ms: 1_500 });

  const recorded = store.record_handoff_packet({ handoff_packet: first });
  assert.equal(store.store_version, BUILDER_HANDOFF_PACKET_STORE_VERSION);
  assert.equal(recorded.result_version, BUILDER_HANDOFF_PACKET_STORE_RESULT_VERSION);
  assert.equal(recorded.operation, 'handoff_packet_recorded');
  assert.equal(recorded.handoff_packet.status, 'pending');
  assert.deepEqual(recorded.handoff_packet.handoff_packet, first);
  assert.equal(recorded.handoff_packet_evidence.handoff_packet_authority, 'main_owned_handoff_packet_store');
  assert.equal(recorded.handoff_packet_evidence.handoff_packet_contract_authority, 'main_handoff_packet_contract_v1');
  assert.equal(recorded.handoff_packet_evidence.schema_version, BUILDER_HANDOFF_PACKET_STORE_SCHEMA_VERSION);
  assert.equal(recorded.handoff_packet_evidence.user_version, BUILDER_HANDOFF_PACKET_STORE_USER_VERSION);
  assert.equal(recorded.handoff_packet_evidence.renderer_authority, 'not_present');
  assert.equal(recorded.handoff_packet_evidence.ipc_authority, 'not_present');
  assert.equal(recorded.handoff_packet_evidence.provider_dispatch, false);
  assert.equal(recorded.handoff_packet_evidence.tool_dispatch, false);
  assert.equal(recorded.handoff_packet_evidence.source_write, 'not_present');
  assert.equal(recorded.handoff_packet_evidence.git_mutation, false);
  assert.equal(recorded.handoff_packet_evidence.permission_grant_authority, false);
  assert.equal(recorded.handoff_packet_evidence.plan_approval_authority, false);
  assert.equal(recorded.handoff_packet_evidence.publication_authority, false);
  assert.equal(recorded.handoff_packet_evidence.readiness_authority, 'not_authoritative_for_readiness');
  assert.match(recorded.handoff_packet_evidence.schema_fingerprint_digest, /^sha256:[0-9a-f]{64}$/u);

  const replayed = store.record_handoff_packet({ handoff_packet: first });
  assert.equal(replayed.operation, 'handoff_packet_replayed');
  assert.deepEqual(replayed.handoff_packet.handoff_packet, first);

  store.record_handoff_packet({ handoff_packet: second });
  const read = store.read_handoff_packet({
    target_thread_id: TARGET_THREAD_ID,
    handoff_id: first.handoff_id,
  });
  assert.equal(read.result_version, BUILDER_HANDOFF_PACKET_STORE_READ_RESULT_VERSION);
  assert.equal(read.status, 'pending');
  assert.deepEqual(read.handoff_packet.handoff_packet, first);

  const list = store.list_pending_handoff_packets({ target_thread_id: TARGET_THREAD_ID });
  assert.equal(list.status, 'ready');
  assert.deepEqual(
    list.handoff_packets.map((entry) => entry.handoff_packet.handoff_id),
    [first.handoff_id, second.handoff_id],
  );
  assert.equal(list.truncated, false);
  store.close();

  const restarted = createBuilderHandoffPacketStore(databasePath);
  const restored = restarted.list_pending_handoff_packets({ target_thread_id: TARGET_THREAD_ID });
  assert.equal(restored.status, 'ready');
  assert.equal(restored.handoff_packets.length, 2);
  restarted.close();
});

test('keeps pending handoffs scoped to the target thread', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderHandoffPacketStore(databasePath);
  const record = packet(1);
  store.record_handoff_packet({ handoff_packet: record });

  assert.equal(store.read_handoff_packet({
    target_thread_id: OTHER_TARGET_THREAD_ID,
    handoff_id: record.handoff_id,
  }).status, 'absent');
  assert.equal(store.list_pending_handoff_packets({
    target_thread_id: OTHER_TARGET_THREAD_ID,
  }).status, 'absent');
  store.close();
});

test('rejects malformed input, accessors, proxies, and tampered rows', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderHandoffPacketStore(databasePath);
  const record = packet(1);
  store.record_handoff_packet({ handoff_packet: record });

  assertStoreError(() => store.record_handoff_packet({ handoff_packet: record, extra: true }));
  assertStoreError(() => store.read_handoff_packet({
    target_thread_id: TARGET_THREAD_ID,
    handoff_id: record.handoff_id,
    extra: true,
  }));

  let getterCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'handoff_packet', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('private marker');
    },
  });
  assertStoreError(() => store.record_handoff_packet(accessor));
  assert.equal(getterCalls, 0);

  let proxyTrapInvoked = false;
  const proxyTrap = () => {
    proxyTrapInvoked = true;
    throw new Error('private proxy marker');
  };
  assertStoreError(() => store.record_handoff_packet(new Proxy(
    { handoff_packet: record },
    {
      getOwnPropertyDescriptor: proxyTrap,
      getPrototypeOf: proxyTrap,
      ownKeys: proxyTrap,
    },
  )));
  assert.equal(proxyTrapInvoked, false);
  store.close();

  const raw = new DatabaseSync(databasePath);
  raw.prepare('UPDATE handoff_packets SET digest = ? WHERE handoff_id = ?')
    .run(digest('9'), record.handoff_id);
  raw.close();

  const reopened = createBuilderHandoffPacketStore(databasePath);
  assertStoreError(
    () => reopened.read_handoff_packet({
      target_thread_id: TARGET_THREAD_ID,
      handoff_id: record.handoff_id,
    }),
    'builder_handoff_packet_store_integrity_failed',
  );
  reopened.close();
});

test('rejects schema drift and unsafe database paths', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderHandoffPacketStore(databasePath);
  store.close();

  const raw = new DatabaseSync(databasePath);
  raw.exec('DROP INDEX handoff_packets_target_pending_idx');
  raw.close();
  assertStoreError(
    () => createBuilderHandoffPacketStore(databasePath),
    'builder_handoff_packet_store_integrity_failed',
  );

  assertStoreError(() => createBuilderHandoffPacketStore('relative.sqlite'));
  const missingParent = path.join(path.dirname(databasePath), 'missing', 'x.sqlite');
  assertStoreError(
    () => createBuilderHandoffPacketStore(missingParent),
    'builder_handoff_packet_store_unavailable',
  );
});

test('source remains a main-owned pending inbox without runtime authority', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'builder-handoff-packet-store.cjs'), 'utf8');

  assert.doesNotMatch(source, /ipcMain|contextBridge|BrowserWindow|shell\.|child_process|fetch\(|XMLHttpRequest/iu);
  assert.doesNotMatch(source, /safeStorage|provider_secret|apiKey|process\.env|git\s+(?:commit|add|push)/iu);
});
