'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');
const { createBuilderConversationMainService } = require('../electron/builder-conversation-main-service.cjs');

const projectId = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const conversationId = 'builder-conversation:123e4567-e89b-42d3-a456-426614174000';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-fingerprint-cache-'));
  const databasePath = path.join(root, 'metadata.sqlite');
  let checks = 0;
  let failCommit = false;
  class ObservedDatabase extends DatabaseSync {
    prepare(sql) {
      if (sql === 'PRAGMA foreign_key_check') checks += 1;
      return super.prepare(sql);
    }
    exec(sql) {
      if (failCommit && sql === 'COMMIT') { failCommit = false; throw new Error('Injected commit failure'); }
      return super.exec(sql);
    }
  }
  const filename = path.resolve(__dirname, '../electron/builder-product-metadata-database.cjs');
  const localRequire = Module.createRequire(filename);
  const loaded = { exports: {} };
  vm.runInThisContext(Module.wrap(fs.readFileSync(filename, 'utf8')), { filename })(
    loaded.exports, (name) => name === 'node:sqlite' ? { DatabaseSync: ObservedDatabase } : localRequire(name),
    loaded, filename, path.dirname(filename),
  );
  const metadata = loaded.exports.createBuilderProductMetadataDatabase(databasePath);
  const service = createBuilderConversationMainService({ metadataAuthority: metadata, createUuid: randomUUID, nowMs: Date.now });
  const context = service.begin_work({ project_id: projectId, conversation_id: conversationId,
    instruction: 'Make a timer', request_digest: `sha256:${'a'.repeat(64)}`, base_revision: null });
  t.after(() => {
    metadata.close();
    assert.equal(path.dirname(fs.realpathSync.native(root)).toLowerCase(), fs.realpathSync.native(os.tmpdir()).toLowerCase());
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { metadata, service, context, databasePath, checks: () => checks,
    failNextCommit: () => { failCommit = true; },
    read: () => metadata.load_conversation({ project_id: projectId, conversation_id: conversationId }) };
}

test('reuses integrity evidence only while local rows and external data are unchanged', (t) => {
  const item = fixture(t);
  const original = item.read().metadata_evidence.schema_fingerprint_digest;
  const before = item.checks();
  assert.equal(item.read().metadata_evidence.schema_fingerprint_digest, original);
  assert.equal(item.checks(), before);
  item.service.complete_failure({ context: item.context, failure_code: 'builder_tool_step_failed' });
  assert.ok(item.checks() > before, 'local writes must rescan integrity');
  const raw = new DatabaseSync(item.databasePath);
  try {
    raw.exec('PRAGMA foreign_keys = OFF');
    raw.prepare('INSERT INTO conversations (project_id, conversation_id, created_at_ms) VALUES (?, ?, ?)')
      .run('builder-project:123e4567-e89b-42d3-a456-426614174099', 'builder-conversation:123e4567-e89b-42d3-a456-426614174099', 1);
    const beforeExternal = item.checks();
    assert.notEqual(item.read().metadata_evidence.schema_fingerprint_digest, original);
    assert.ok(item.checks() > beforeExternal);
    const invalidCount = item.checks();
    item.read();
    assert.ok(item.checks() > invalidCount, 'invalid integrity results must not be cached');
    raw.prepare('DELETE FROM conversations WHERE created_at_ms = 1').run();
    assert.equal(item.read().metadata_evidence.schema_fingerprint_digest, original);
  } finally { raw.close(); }
});

test('invalidates schema fingerprints after DDL and user-version changes', (t) => {
  const item = fixture(t);
  const original = item.read().metadata_evidence.schema_fingerprint_digest;
  const raw = new DatabaseSync(item.databasePath);
  try {
    raw.exec('CREATE TABLE extra_fact (id TEXT PRIMARY KEY) STRICT');
    assert.notEqual(item.read().metadata_evidence.schema_fingerprint_digest, original);
    raw.exec('DROP TABLE extra_fact');
    assert.equal(item.read().metadata_evidence.schema_fingerprint_digest, original);
    const version = raw.prepare('PRAGMA user_version').get().user_version;
    raw.exec('PRAGMA user_version = 999');
    assert.notEqual(item.read().metadata_evidence.schema_fingerprint_digest, original);
    raw.exec(`PRAGMA user_version = ${version}`);
    assert.equal(item.read().metadata_evidence.schema_fingerprint_digest, original);
  } finally { raw.close(); }
});

test('discards cached transaction evidence when a commit fails and rolls back', (t) => {
  const item = fixture(t);
  const before = item.read();
  item.failNextCommit();
  assert.throws(() => item.read());
  const checks = item.checks();
  const recovered = item.read();
  assert.ok(item.checks() > checks);
  assert.deepEqual(recovered.current_head, before.current_head);
  assert.equal(recovered.metadata_evidence.schema_fingerprint_digest, before.metadata_evidence.schema_fingerprint_digest);
});
