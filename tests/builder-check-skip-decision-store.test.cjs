'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');

const {
  createBuilderCheckSkipDecision,
} = require('../electron/builder-check-skip-decision.cjs');
const {
  BuilderCheckSkipDecisionStoreError,
  createBuilderCheckSkipDecisionStore,
} = require('../electron/builder-check-skip-decision-store.cjs');

function input(overrides = {}) {
  return {
    project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174000',
    conversation_id: 'builder-conversation:123e4567-e89b-42d3-a456-426614174000',
    turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174000',
    task_id: 'builder-task:123e4567-e89b-42d3-a456-426614174000',
    run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174000',
    draft_id: `builder-generation-draft:${'1'.repeat(64)}`,
    draft_checkpoint_id: `builder-draft-checkpoint:${'2'.repeat(64)}`,
    draft_checkpoint_sequence: 2,
    candidate_id: `builder-code-change-candidate:${'3'.repeat(64)}`,
    candidate_digest: `sha256:${'4'.repeat(64)}`,
    resulting_tree_digest: `sha256:${'5'.repeat(64)}`,
    reason_code: 'user_chose_save_without_check',
    decided_at_ms: 1_800_000_000_000,
    ...overrides,
  };
}

function harness(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-check-skip-store-'));
  const databasePath = path.join(root, 'check-skips.sqlite');
  const store = createBuilderCheckSkipDecisionStore(databasePath);
  t.after(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, databasePath, store };
}

test('records, replays, and restores a current candidate check skip decision', (t) => {
  const h = harness(t);
  const decision = createBuilderCheckSkipDecision(input());
  const recorded = h.store.record_check_skip_decision({ check_skip_decision: decision });
  assert.equal(recorded.operation, 'check_skip_decision_recorded');
  assert.deepEqual(recorded.check_skip_decision, decision);
  assert.equal(recorded.store_evidence.save_authority, false);

  const replayed = h.store.record_check_skip_decision({ check_skip_decision: decision });
  assert.equal(replayed.operation, 'check_skip_decision_replayed');
  assert.deepEqual(replayed.check_skip_decision, decision);

  assert.deepEqual(h.store.read_current_check_skip_decision({
    project_id: decision.project_id,
    candidate_id: decision.candidate_id,
  }).check_skip_decision, decision);
  h.store.close();
  const restarted = createBuilderCheckSkipDecisionStore(h.databasePath);
  assert.deepEqual(restarted.read_current_check_skip_decision({
    project_id: decision.project_id,
    candidate_id: decision.candidate_id,
  }).check_skip_decision, decision);
  restarted.close();
});

test('returns explicit absence for a different current candidate', (t) => {
  const h = harness(t);
  const decision = createBuilderCheckSkipDecision(input());
  h.store.record_check_skip_decision({ check_skip_decision: decision });
  const absent = h.store.read_current_check_skip_decision({
    project_id: decision.project_id,
    candidate_id: `builder-code-change-candidate:${'a'.repeat(64)}`,
  });
  assert.equal(absent.status, 'absent');
  assert.equal(absent.check_skip_decision, null);
});

test('rejects a second non-identical decision for the same candidate', (t) => {
  const h = harness(t);
  h.store.record_check_skip_decision({
    check_skip_decision: createBuilderCheckSkipDecision(input()),
  });
  assert.throws(
    () => h.store.record_check_skip_decision({
      check_skip_decision: createBuilderCheckSkipDecision(input({ decided_at_ms: input().decided_at_ms + 1 })),
    }),
    (error) => error instanceof BuilderCheckSkipDecisionStoreError
      && error.code === 'builder_check_skip_decision_store_conflict',
  );
});

test('fails closed on malformed requests, schema drift, and tampered rows', (t) => {
  const h = harness(t);
  const decision = createBuilderCheckSkipDecision(input());
  h.store.record_check_skip_decision({ check_skip_decision: decision });
  assert.throws(
    () => h.store.read_current_check_skip_decision({
      project_id: decision.project_id,
      candidate_id: decision.candidate_id,
      renderer: true,
    }),
    (error) => error instanceof BuilderCheckSkipDecisionStoreError,
  );
  h.store.close();
  const db = new DatabaseSync(h.databasePath);
  db.prepare('UPDATE check_skip_decisions SET candidate_digest = ? WHERE decision_id = ?').run(
    `sha256:${'f'.repeat(64)}`,
    decision.decision_id,
  );
  db.close();
  const corrupted = createBuilderCheckSkipDecisionStore(h.databasePath);
  assert.throws(
    () => corrupted.read_current_check_skip_decision({
      project_id: decision.project_id,
      candidate_id: decision.candidate_id,
    }),
    (error) => error instanceof BuilderCheckSkipDecisionStoreError
      && error.code === 'builder_check_skip_decision_store_integrity_failed',
  );
  corrupted.close();
});

test('rejects unsafe database paths and schema replacement', (t) => {
  assert.throws(
    () => createBuilderCheckSkipDecisionStore('relative.sqlite'),
    (error) => error instanceof BuilderCheckSkipDecisionStoreError,
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-check-skip-schema-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const databasePath = path.join(root, 'check-skips.sqlite');
  const db = new DatabaseSync(databasePath);
  db.exec('CREATE TABLE wrong_table (id TEXT PRIMARY KEY) STRICT');
  db.exec('PRAGMA user_version = 1');
  db.close();
  assert.throws(
    () => createBuilderCheckSkipDecisionStore(databasePath),
    (error) => error instanceof BuilderCheckSkipDecisionStoreError
      && error.code === 'builder_check_skip_decision_store_integrity_failed',
  );
});

test('source remains main-owned storage without execution or mutation authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-check-skip-decision-store.cjs'),
    'utf8',
  );
  assert.doesNotMatch(source, /electron|ipcMain|webContents|fetch\(|child_process|spawnSync|execFile|execSync|safeStorage/iu);
  assert.doesNotMatch(source, /writeFile|rename|unlink|update-ref|source_tree/iu);
  assert.match(source, /provider_dispatch: false/u);
});
