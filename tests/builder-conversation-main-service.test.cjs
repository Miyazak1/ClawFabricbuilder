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
const {
  CONVERSATION_AUTHORITY,
  CONVERSATION_EVENT_KIND,
  CONVERSATION_EVENT_VERSION,
  createBuilderConversationEvent,
} = require('../electron/builder-conversation-records.cjs');

const PROJECT_ID = 'builder-project:11111111-1111-4111-8111-111111111111';
const REQUEST_DIGEST = `sha256:${'1'.repeat(64)}`;
const QUESTION_DIGEST = `sha256:${'0'.repeat(64)}`;
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

function removeRoot(root) {
  let lastError = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (!error || typeof error !== 'object' || !['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(error.code)) {
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 * (attempt + 1));
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error('Temporary test directory could not be removed.');
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
      removeRoot(root);
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

function beginQuestion(service, baseRevision = null, question = 'What changed in this project?') {
  return service.begin_question({
    project_id: PROJECT_ID,
    question,
    request_digest: QUESTION_DIGEST,
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

function rejectCandidate(item, context, terminal, candidate) {
  const rejected = createBuilderConversationEvent({
    record_version: CONVERSATION_EVENT_VERSION,
    record_kind: CONVERSATION_EVENT_KIND,
    project_id: PROJECT_ID,
    conversation_id: context.conversation.conversation_id,
    sequence: terminal.head.sequence + 1,
    command_id: `builder-command:${uuidFactory(700)()}`,
    event_type: 'candidate_rejected',
    previous_event: terminal.head,
    payload: {
      turn_id: context.ids.turn_id,
      run_id: context.ids.run_id,
      draft_id: candidate.draft_id,
      review_id: `builder-review:${uuidFactory(701)()}`,
      reviewer_id: `builder-user:${uuidFactory(702)()}`,
      reviewed_at_ms: 7_000,
      decision: 'rejected',
    },
    authority: { ...CONVERSATION_AUTHORITY },
  });
  return item.database.append_conversation_events({
    project: context.project,
    conversation: context.conversation,
    expected_head: terminal.head,
    events: [rejected],
    recorded_at_ms: 7_000,
  });
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

test('records a question explanation without creating task, candidate, or revision facts', () => {
  const item = fixture();
  let restartedDatabase = null;
  try {
    const context = beginQuestion(item.service);
    assert.equal(context.mode, 'question');
    assert.equal(context.ids.task_id, null);
    assert.equal(context.start_head.sequence, 2);
    assert.deepEqual(context.events.map((event) => event.event_type), [
      'turn_submitted',
      'run_started',
    ]);
    assert.equal(context.events[0].payload.mode, 'question');
    assert.equal(context.events[0].payload.task, null);
    assert.equal(context.events[1].payload.task_id, null);

    const terminal = item.service.complete_explanation({
      context,
      assistant_text: 'This project is saved locally and can be revised without creating a new version.',
    });
    assert.equal(terminal.head.sequence, 4);
    assert.equal(terminal.snapshot.active_turn_id, null);
    assert.equal(terminal.snapshot.turns[0].mode, 'question');
    assert.equal(terminal.snapshot.turns[0].task, null);
    assert.equal(terminal.snapshot.turns[0].outcome, 'answered');
    assert.equal(terminal.snapshot.turns[0].runs[0].result_kind, 'explanation');
    assert.equal(terminal.snapshot.turns[0].runs[0].candidate_result, null);

    const followup = beginQuestion(item.service, null, 'Can I ask another question before saving?');
    assert.equal(followup.project.created_at_ms, context.project.created_at_ms);
    assert.equal(followup.conversation.created_at_ms, context.conversation.created_at_ms);
    assert.equal(followup.start_head.sequence, 6);
    assert.equal(followup.events[0].payload.mode, 'question');
    assert.equal(followup.events[0].payload.task, null);
    const followupTerminal = item.service.complete_explanation({
      context: followup,
      assistant_text: 'Yes. Questions can continue without creating a saved version.',
    });
    assert.equal(followupTerminal.head.sequence, 8);

    const stream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(stream.conversation.head_sequence, 8);
    assert.equal(stream.conversation.items[0].mode, 'question');
    assert.equal(stream.conversation.items[0].task, null);
    assert.equal(stream.conversation.items[1].task_id, null);
    assert.equal(stream.conversation.items[2].result_kind, 'explanation');
    assert.equal(stream.conversation.items[2].candidate, null);
    assert.equal(stream.conversation.items[3].outcome, 'answered');
    assert.equal(stream.conversation.items[4].mode, 'question');
    assert.equal(stream.conversation.items[4].task, null);
    assert.equal(stream.conversation.items[6].result_kind, 'explanation');
    assert.equal(stream.conversation.items[6].candidate, null);
    assert.equal(stream.conversation.items[7].outcome, 'answered');
    assert.doesNotMatch(
      JSON.stringify(stream),
      /candidate_digest|git_candidate_receipt|commit_oid|tree_oid|revision_receipt|save_admission|provider|credential/iu,
    );

    item.database.close();
    restartedDatabase = createBuilderProductMetadataDatabase(
      path.join(item.root, 'builder.sqlite'),
    );
    const restartedService = createBuilderConversationMainService({
      metadataAuthority: restartedDatabase,
      createUuid: uuidFactory(800),
      nowMs: () => 8_000,
    });
    assert.deepEqual(restartedService.read_stream({ project_id: PROJECT_ID }), stream);
  } finally {
    if (restartedDatabase !== null) restartedDatabase.close();
    try { item.database.close(); } catch { /* already closed during restart check */ }
    removeRoot(item.root);
  }
});

test('restores the same renderer-safe task stream after a real database restart', () => {
  const item = fixture();
  let restartedDatabase = null;
  try {
    const context = begin(item.service);
    item.service.complete_candidate({
      context,
      candidate_result: candidateResult(context),
      assistant_text: 'A timer draft is ready to review.',
    });
    const before = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(before.stream_version, 'builder-task-stream-read-result.v1');
    assert.equal(before.conversation.head_sequence, 4);
    assert.equal(before.conversation.items[1].recorded_state, 'started');
    assert.equal(before.conversation.items[2].candidate.candidate_state, 'proposed');
    assert.equal(before.conversation.items[2].candidate.source_availability, 'not_loaded');
    assert.doesNotMatch(
      JSON.stringify(before),
      /git_candidate_receipt|candidate_digest|commit_oid|tree_oid|credential|provider|running|save_admission/iu,
    );

    item.database.close();
    restartedDatabase = createBuilderProductMetadataDatabase(
      path.join(item.root, 'builder.sqlite'),
    );
    const restartedService = createBuilderConversationMainService({
      metadataAuthority: restartedDatabase,
      createUuid: uuidFactory(300),
      nowMs: () => 3_000,
    });
    assert.deepEqual(restartedService.read_stream({ project_id: PROJECT_ID }), before);
  } finally {
    if (restartedDatabase !== null) restartedDatabase.close();
    try { item.database.close(); } catch { /* already closed during restart check */ }
    removeRoot(item.root);
  }
});

test('restores a main-only candidate draft proof after a real database restart', () => {
  const item = fixture();
  let restartedDatabase = null;
  try {
    const context = begin(item.service);
    const candidate = candidateResult(context);
    item.service.complete_candidate({
      context,
      candidate_result: candidate,
      assistant_text: 'A timer draft is ready to review.',
    });
    const before = item.service.read_candidate_draft({ draft_id: candidate.draft_id });
    assert.equal(before.result_version, 'builder-conversation-candidate-draft-read-result.v1');
    assert.equal(before.draft_id, candidate.draft_id);
    assert.equal(before.conversation_head.sequence, 4);
    assert.equal(before.base_revision, null);
    assert.equal(before.candidate_result.git_candidate_receipt.candidate_digest, CANDIDATE_DIGEST);
    assert.doesNotMatch(JSON.stringify(before), /source_tree|provider|credential|running|live/iu);

    item.database.close();
    restartedDatabase = createBuilderProductMetadataDatabase(
      path.join(item.root, 'builder.sqlite'),
    );
    const restartedService = createBuilderConversationMainService({
      metadataAuthority: restartedDatabase,
      createUuid: uuidFactory(500),
      nowMs: () => 5_000,
    });
    assert.deepEqual(
      restartedService.read_candidate_draft({ draft_id: candidate.draft_id }),
      before,
    );
  } finally {
    if (restartedDatabase !== null) restartedDatabase.close();
    try { item.database.close(); } catch { /* already closed during restart check */ }
    removeRoot(item.root);
  }
});

test('does not restore or verify a candidate after durable rejection', () => {
  const item = fixture();
  let restartedDatabase = null;
  try {
    const context = begin(item.service);
    const candidate = candidateResult(context);
    const terminal = item.service.complete_candidate({
      context,
      candidate_result: candidate,
      assistant_text: 'A timer draft is ready to review.',
    });
    rejectCandidate(item, context, terminal, candidate);

    const stream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(stream.conversation.head_sequence, 5);
    assert.deepEqual(stream.conversation.items.at(-1), {
      item_kind: 'candidate_reviewed',
      sequence: 5,
      turn_id: context.ids.turn_id,
      run_id: context.ids.run_id,
      draft_id: candidate.draft_id,
      decision: 'rejected',
      candidate_state: 'rejected',
    });
    assert.doesNotMatch(
      JSON.stringify(stream),
      /review_id|reviewer_id|reviewed_at_ms|git_candidate_receipt|candidate_digest|commit_oid|tree_oid|provider|credential/iu,
    );
    assert.throws(
      () => item.service.read_candidate_draft({ draft_id: candidate.draft_id }),
      { code: 'builder_conversation_main_service_unavailable' },
    );
    assert.throws(
      () => item.service.verify_candidate({
        project_id: PROJECT_ID,
        conversation_id: context.conversation.conversation_id,
        turn_id: context.ids.turn_id,
        task_id: context.ids.task_id,
        run_id: context.ids.run_id,
        candidate_digest: CANDIDATE_DIGEST,
        conversation_head: terminal.head,
      }),
      { code: 'builder_conversation_main_service_unavailable' },
    );

    item.database.close();
    restartedDatabase = createBuilderProductMetadataDatabase(
      path.join(item.root, 'builder.sqlite'),
    );
    const restartedService = createBuilderConversationMainService({
      metadataAuthority: restartedDatabase,
      createUuid: uuidFactory(750),
      nowMs: () => 7_500,
    });
    assert.throws(
      () => restartedService.read_candidate_draft({ draft_id: candidate.draft_id }),
      { code: 'builder_conversation_main_service_unavailable' },
    );
    assert.deepEqual(restartedService.read_stream({ project_id: PROJECT_ID }), stream);
  } finally {
    if (restartedDatabase !== null) restartedDatabase.close();
    try { item.database.close(); } catch { /* already closed during restart check */ }
    removeRoot(item.root);
  }
});

test('returns a legal empty stream when the project has no conversation', () => {
  const item = fixture();
  try {
    assert.deepEqual(item.service.read_stream({ project_id: PROJECT_ID }), {
      stream_version: 'builder-task-stream-read-result.v1',
      project_id: PROJECT_ID,
      conversation: null,
      authority: {
        conversation: 'sqlite_canonical_event_replay_or_absent',
        project_source: 'not_included',
        candidate_source: 'not_loaded',
        project_revision: 'not_inferred',
      },
    });
    assert.throws(() => item.service.read_stream({
      project_id: PROJECT_ID,
      extra: 'private-marker',
    }), {
      code: 'builder_task_stream_unavailable',
      message: 'Project activity is unavailable.',
      retryable: true,
    });
  } finally {
    item.close();
  }
});

test('reads a restarted active run as recorded without mutating durable events', () => {
  const item = fixture();
  let restartedDatabase = null;
  try {
    const context = begin(item.service);
    const request = {
      project_id: PROJECT_ID,
      conversation_id: context.conversation.conversation_id,
    };
    const beforeRestart = item.database.load_conversation(request);
    assert.equal(beforeRestart.current_head.sequence, 2);

    item.database.close();
    restartedDatabase = createBuilderProductMetadataDatabase(
      path.join(item.root, 'builder.sqlite'),
    );
    const durableBeforeRead = restartedDatabase.load_conversation(request);
    const restartedService = createBuilderConversationMainService({
      metadataAuthority: restartedDatabase,
      createUuid: uuidFactory(400),
      nowMs: () => 4_000,
    });
    const stream = restartedService.read_stream({ project_id: PROJECT_ID });
    assert.equal(stream.conversation.head_sequence, 2);
    assert.equal(stream.conversation.recorded_active_turn_id, context.ids.turn_id);
    assert.equal(stream.conversation.items.at(-1).recorded_state, 'started');
    assert.doesNotMatch(JSON.stringify(stream), /running|live/iu);
    const durableAfterRead = restartedDatabase.load_conversation(request);
    assert.deepEqual(durableAfterRead, durableBeforeRead);
  } finally {
    if (restartedDatabase !== null) restartedDatabase.close();
    try { item.database.close(); } catch { /* already closed during restart check */ }
    removeRoot(item.root);
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
    try { item.database.close(); } catch { /* already closed during restart check */ }
    removeRoot(item.root);
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
    const work = begin(item.service);
    const question = beginQuestion(item.service, BASE_REVISION);
    assert.throws(() => item.service.complete_candidate({
      context: Object.freeze({}),
      candidate_result: candidateResult(work),
      assistant_text: 'Ready.',
    }), { code: 'builder_conversation_main_service_unavailable' });
    assert.throws(() => item.service.complete_candidate({
      context: question,
      candidate_result: candidateResult(work),
      assistant_text: 'Ready.',
    }), { code: 'builder_conversation_main_service_unavailable' });
    assert.throws(() => item.service.complete_explanation({
      context: work,
      assistant_text: 'This is an answer.',
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
    /BrowserWindow|ipcMain|ipcRenderer|preload|fetch\(|openai|deepseek|safeStorage|persist_candidate_commit|builder-git-project-repository/iu,
  );
});
