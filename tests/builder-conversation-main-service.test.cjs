'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderConversationMainService,
} = require('../electron/builder-conversation-main-service.cjs');
const {
  createBuilderProductMetadataDatabase,
} = require('../electron/builder-product-metadata-database.cjs');
const {
  replayBuilderConversation,
} = require('../electron/builder-conversation-replay.cjs');

const PROJECT_ID = 'builder-project:11111111-1111-4111-8111-111111111111';
const REQUEST_DIGEST = `sha256:${'1'.repeat(64)}`;
const CANDIDATE_DIGEST = `sha256:${'2'.repeat(64)}`;
const BASE_REVISION = Object.freeze({
  revision_receipt_digest: `sha256:${'3'.repeat(64)}`,
  commit_oid: '4'.repeat(40),
});

function uuidFactory(start = 1) {
  let value = start;
  return () => {
    const suffix = value.toString(16).padStart(12, '0');
    value += 1;
    return `00000000-0000-4000-8000-${suffix}`;
  };
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb-cms-'));
  const database = createBuilderProductMetadataDatabase(path.join(root, 'builder.sqlite'));
  let now = 1_000;
  const service = createBuilderConversationMainService({
    metadataAuthority: database,
    createUuid: uuidFactory(),
    nowMs: () => now++,
  });
  return {
    root,
    database,
    service,
    close() {
      database.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function begin(service, baseRevision = null, instruction = 'Build a focused timer') {
  return service.begin_work({
    project_id: PROJECT_ID,
    instruction,
    request_digest: REQUEST_DIGEST,
    base_revision: baseRevision,
  });
}

function candidateResult(context) {
  return {
    draft_id: `builder-generation-draft:${'5'.repeat(64)}`,
    title: 'Focused timer',
    summary: 'A focused timer draft.',
    git_candidate_receipt: {
      receipt_version: 'builder-git-candidate-receipt.v1',
      repository_version: 'builder-git-project-repository.v1',
      project_id: PROJECT_ID,
      conversation_id: context.conversation.conversation_id,
      turn_id: context.ids.turn_id,
      task_id: context.ids.task_id,
      run_id: context.ids.run_id,
      request_id: `builder-git-request:${uuidFactory(900)()}`,
      candidate_id: `builder-code-change-candidate:${'6'.repeat(64)}`,
      candidate_digest: CANDIDATE_DIGEST,
      resulting_tree_digest: `sha256:${'7'.repeat(64)}`,
      semantic_identity_digest: `sha256:${'8'.repeat(64)}`,
      verification_receipt_digest: `sha256:${'9'.repeat(64)}`,
      object_format: 'sha1',
      commit_oid: 'a'.repeat(40),
      tree_oid: 'b'.repeat(40),
      parent_oid: null,
      expected_base_oid: null,
      code_authority: 'git_commit_candidate',
      product_revision_admission: 'not_recorded',
      replay: false,
    },
  };
}

test('records start and terminal events before allowing a later turn to continue', () => {
  const item = fixture();
  try {
    const first = begin(item.service);
    assert.equal(first.start_head.sequence, 2);
    assert.deepEqual(first.events.map((event) => event.event_type), [
      'turn_submitted',
      'run_started',
    ]);

    const terminal = item.service.complete_candidate({
      context: first,
      candidate_result: candidateResult(first),
      assistant_text: 'A timer draft is ready to review.',
    });
    assert.equal(terminal.head.sequence, 4);
    assert.equal(terminal.snapshot.active_turn_id, null);
    assert.equal(terminal.snapshot.turns[0].outcome, 'candidate_ready');
    assert.equal(terminal.snapshot.turns[0].messages[1].role, 'assistant');

    const second = begin(item.service, BASE_REVISION, 'Make the timer more compact');
    assert.equal(second.start_head.sequence, 6);
    assert.deepEqual(second.events.slice(-2).map((event) => event.event_type), [
      'turn_submitted',
      'run_started',
    ]);
  } finally {
    item.close();
  }
});

test('recovers a running turn as interrupted without redispatching a provider', () => {
  const item = fixture();
  let restartedDatabase = null;
  try {
    const abandoned = begin(item.service);
    assert.equal(abandoned.start_head.sequence, 2);

    item.database.close();
    restartedDatabase = createBuilderProductMetadataDatabase(
      path.join(item.root, 'builder.sqlite'),
    );
    const restartedService = createBuilderConversationMainService({
      metadataAuthority: restartedDatabase,
      createUuid: uuidFactory(200),
      nowMs: () => 2_000,
    });
    const resumed = begin(restartedService, BASE_REVISION, 'Try a new direction');
    assert.equal(resumed.start_head.sequence, 7);
    assert.deepEqual(resumed.events.map((event) => event.event_type), [
      'turn_submitted',
      'run_started',
      'run_interrupt_requested',
      'run_completed',
      'turn_completed',
      'turn_submitted',
      'run_started',
    ]);
    const replayed = replayBuilderConversation(resumed.events);
    assert.equal(replayed.turns[0].outcome, 'interrupted');
    assert.equal(replayed.turns[1].status, 'active');
  } finally {
    if (restartedDatabase !== null) restartedDatabase.close();
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test('records fixed failed, cancelled, and timeout-interrupted terminal outcomes', () => {
  const cases = [
    ['builder_generation_failed', 'failed', 4],
    ['builder_generation_cancelled', 'cancelled', 5],
    ['builder_generation_timeout', 'interrupted', 5],
  ];
  for (const [failureCode, outcome, expectedSequence] of cases) {
    const item = fixture();
    try {
      const context = begin(item.service);
      const terminal = item.service.complete_failure({
        context,
        failure_code: failureCode,
      });
      assert.equal(terminal.head.sequence, expectedSequence);
      assert.equal(terminal.snapshot.turns[0].outcome, outcome);
      assert.equal(
        terminal.snapshot.turns[0].runs[0].terminal_status,
        outcome,
      );
      assert.doesNotMatch(JSON.stringify(terminal), /provider\.example|credential|api[_-]?key/iu);
    } finally {
      item.close();
    }
  }
});

test('rejects forged contexts and stays isolated from provider, IPC, renderer, and Git authority', () => {
  const item = fixture();
  try {
    assert.throws(() => item.service.complete_candidate({
      context: Object.freeze({}),
      candidate_result: candidateResult(begin(item.service)),
      assistant_text: 'Ready.',
    }), { code: 'builder_conversation_main_service_unavailable' });
  } finally {
    item.close();
  }

  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-conversation-main-service.cjs'),
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /BrowserWindow|ipcMain|ipcRenderer|preload|fetch\(|openai|deepseek|safeStorage|persist_candidate_commit/iu,
  );
});
