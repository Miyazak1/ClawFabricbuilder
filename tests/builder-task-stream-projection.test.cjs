'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  CONVERSATION_AUTHORITY,
  CONVERSATION_EVENT_KIND,
  CONVERSATION_EVENT_VERSION,
  createBuilderConversationEvent,
} = require('../electron/builder-conversation-records.cjs');
const {
  BUILDER_TASK_STREAM_VERSION,
  MAX_PUBLIC_BYTES,
  MAX_PUBLIC_ITEMS,
  BuilderTaskStreamProjectionError,
  projectBuilderTaskStream,
} = require('../electron/builder-task-stream-projection.cjs');

const UUID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}`;
const DIGEST = `sha256:${'1'.repeat(64)}`;

function id(kind, index) {
  return `builder-${kind}:00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function head(event) {
  return event === null ? null : {
    sequence: event.sequence,
    event_id: event.event_id,
    event_digest: event.event_digest,
  };
}

function append(events, type, payload, index) {
  const previous = events.at(-1) ?? null;
  events.push(createBuilderConversationEvent({
    record_version: CONVERSATION_EVENT_VERSION,
    record_kind: CONVERSATION_EVENT_KIND,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    sequence: previous === null ? 1 : previous.sequence + 1,
    command_id: id('command', index),
    event_type: type,
    previous_event: head(previous),
    payload,
    authority: { ...CONVERSATION_AUTHORITY },
  }));
  return events;
}

function candidateReceipt(turnId, taskId, runId) {
  return {
    receipt_version: 'builder-git-candidate-receipt.v1',
    repository_version: 'builder-git-project-repository.v1',
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: turnId,
    task_id: taskId,
    run_id: runId,
    request_id: id('git-request', 20),
    candidate_id: `builder-code-change-candidate:${'2'.repeat(64)}`,
    candidate_digest: DIGEST,
    resulting_tree_digest: `sha256:${'3'.repeat(64)}`,
    semantic_identity_digest: `sha256:${'4'.repeat(64)}`,
    verification_receipt_digest: `sha256:${'5'.repeat(64)}`,
    object_format: 'sha1',
    commit_oid: '6'.repeat(40),
    tree_oid: '7'.repeat(40),
    parent_oid: null,
    expected_base_oid: null,
    code_authority: 'git_commit_candidate',
    product_revision_admission: 'not_recorded',
    replay: false,
  };
}

function candidateEvents() {
  const events = [];
  const turnId = id('turn', 1);
  const taskId = id('task', 2);
  const runId = id('run', 3);
  append(events, 'turn_submitted', {
    message: { message_id: id('message', 4), text: 'Build a focused timer.' },
    turn_id: turnId,
    mode: 'work',
    task: { task_id: taskId, title: 'Create Builder project' },
    base_revision: null,
  }, 5);
  append(events, 'run_started', {
    turn_id: turnId,
    run_id: runId,
    task_id: taskId,
    attempt_number: 1,
    retry_of_run_id: null,
    input_digest: `sha256:${'8'.repeat(64)}`,
  }, 6);
  append(events, 'run_completed', {
    turn_id: turnId,
    run_id: runId,
    terminal_status: 'succeeded',
    result_kind: 'candidate',
    result_digest: DIGEST,
    assistant_message: {
      message_id: id('message', 7),
      text: 'A timer draft is ready to review.',
    },
    candidate_result: {
      draft_id: `builder-generation-draft:${'9'.repeat(64)}`,
      title: 'Focused timer',
      summary: 'A focused timer draft.',
      git_candidate_receipt: candidateReceipt(turnId, taskId, runId),
    },
  }, 8);
  append(events, 'turn_completed', {
    turn_id: turnId,
    run_id: runId,
    outcome: 'candidate_ready',
  }, 9);
  return events;
}

function rejectedCandidateEvents() {
  const events = candidateEvents();
  append(events, 'candidate_rejected', {
    turn_id: id('turn', 1),
    run_id: id('run', 3),
    draft_id: `builder-generation-draft:${'9'.repeat(64)}`,
    review_id: id('review', 10),
    reviewer_id: id('user', 11),
    reviewed_at_ms: 2_000,
    decision: 'rejected',
  }, 10);
  return events;
}

function acceptedCandidateEvents() {
  const events = candidateEvents();
  append(events, 'candidate_accepted', {
    turn_id: id('turn', 1),
    run_id: id('run', 3),
    draft_id: `builder-generation-draft:${'9'.repeat(64)}`,
    review_id: id('review', 12),
    reviewer_id: id('user', 13),
    reviewed_at_ms: 3_000,
    decision: 'accepted',
    revision: {
      revision_receipt_digest: `sha256:${'a'.repeat(64)}`,
      revision_number: 3,
    },
  }, 11);
  return events;
}

function explanationHistory(turnCount) {
  const events = [];
  for (let turn = 1; turn <= turnCount; turn += 1) {
    const seed = turn * 10;
    const turnId = id('turn', turn);
    const runId = id('run', turn);
    append(events, 'turn_submitted', {
      message: { message_id: id('message', seed), text: `Explain change ${turn}.` },
      turn_id: turnId,
      mode: 'question',
      task: null,
      base_revision: null,
    }, seed);
    append(events, 'run_started', {
      turn_id: turnId,
      run_id: runId,
      task_id: null,
      attempt_number: 1,
      retry_of_run_id: null,
      input_digest: DIGEST,
    }, seed + 1);
    append(events, 'run_completed', {
      turn_id: turnId,
      run_id: runId,
      terminal_status: 'succeeded',
      result_kind: 'explanation',
      result_digest: DIGEST,
      assistant_message: {
        message_id: id('message', seed + 1),
        text: `Change ${turn} is recorded.`,
      },
      candidate_result: null,
    }, seed + 2);
    append(events, 'turn_completed', {
      turn_id: turnId,
      run_id: runId,
      outcome: 'answered',
    }, seed + 3);
  }
  return events;
}

function input(events) {
  return {
    project_id: PROJECT_ID,
    conversation: {
      conversation_id: CONVERSATION_ID,
      created_at_ms: 1_000,
      events,
    },
  };
}

function assertProjectionError(error) {
  assert.equal(error instanceof BuilderTaskStreamProjectionError, true);
  assert.equal(error.code, 'builder_task_stream_unavailable');
  assert.equal(error.message, 'Project activity is unavailable.');
  assert.equal(error.retryable, true);
  assert.equal(error.stack, `${error.name}: ${error.message}`);
  return true;
}

test('projects canonical events into bounded renderer-safe activity items', () => {
  const stream = projectBuilderTaskStream(input(candidateEvents()));
  assert.equal(stream.stream_version, BUILDER_TASK_STREAM_VERSION);
  assert.equal(stream.project_id, PROJECT_ID);
  assert.equal(stream.conversation.head_sequence, 4);
  assert.equal(stream.conversation.recorded_active_turn_id, null);
  assert.deepEqual(stream.conversation.window, {
    first_sequence: 1,
    last_sequence: 4,
    has_earlier: false,
  });
  assert.equal(stream.conversation.items[0].item_kind, 'user_message');
  assert.deepEqual(stream.conversation.items[1], {
    item_kind: 'run_started',
    sequence: 2,
    turn_id: id('turn', 1),
    run_id: id('run', 3),
    task_id: id('task', 2),
    attempt_number: 1,
    retry_of_run_id: null,
    recorded_state: 'started',
  });
  assert.deepEqual(stream.conversation.items[2].candidate, {
    draft_id: `builder-generation-draft:${'9'.repeat(64)}`,
    title: 'Focused timer',
    summary: 'A focused timer draft.',
    candidate_state: 'proposed',
    source_availability: 'not_loaded',
  });
  assert.deepEqual(stream.authority, {
    conversation: 'sqlite_canonical_event_replay_or_absent',
    project_source: 'not_included',
    candidate_source: 'not_loaded',
    project_revision: 'not_inferred',
  });
  assert.equal(Object.isFrozen(stream), true);
  assert.equal(Object.isFrozen(stream.conversation.items), true);
  assert.equal(Object.isFrozen(stream.conversation.items[2].candidate), true);
});

test('represents a missing conversation as a legal empty result', () => {
  assert.deepEqual(projectBuilderTaskStream({
    project_id: PROJECT_ID,
    conversation: null,
  }), {
    stream_version: BUILDER_TASK_STREAM_VERSION,
    project_id: PROJECT_ID,
    conversation: null,
    authority: {
      conversation: 'sqlite_canonical_event_replay_or_absent',
      project_source: 'not_included',
      candidate_source: 'not_loaded',
      project_revision: 'not_inferred',
    },
  });
});

test('projects rejected candidates without exposing review identity or Git evidence', () => {
  const stream = projectBuilderTaskStream(input(rejectedCandidateEvents()));
  assert.deepEqual(stream.conversation.items.at(-1), {
    item_kind: 'candidate_reviewed',
    sequence: 5,
    turn_id: id('turn', 1),
    run_id: id('run', 3),
    draft_id: `builder-generation-draft:${'9'.repeat(64)}`,
    decision: 'rejected',
    candidate_state: 'rejected',
    saved_revision: null,
  });
  assert.doesNotMatch(
    JSON.stringify(stream),
    /review_id|reviewer_id|reviewed_at_ms|git_candidate_receipt|candidate_digest|commit_oid|tree_oid|credential|provider/iu,
  );
});

test('projects accepted candidates as saved versions without exposing revision evidence', () => {
  const stream = projectBuilderTaskStream(input(acceptedCandidateEvents()));
  assert.deepEqual(stream.conversation.items.at(-1), {
    item_kind: 'candidate_reviewed',
    sequence: 5,
    turn_id: id('turn', 1),
    run_id: id('run', 3),
    draft_id: `builder-generation-draft:${'9'.repeat(64)}`,
    decision: 'accepted',
    candidate_state: 'saved',
    saved_revision: { revision_number: 3 },
  });
  assert.doesNotMatch(
    JSON.stringify(stream),
    /review_id|reviewer_id|reviewed_at_ms|revision_receipt|candidate_digest|commit_oid|tree_oid|credential|provider|source_tree/iu,
  );
});

test('describes a persisted start as recorded rather than claiming a live run', () => {
  const stream = projectBuilderTaskStream(input(candidateEvents().slice(0, 2)));
  assert.equal(stream.conversation.recorded_active_turn_id, id('turn', 1));
  assert.equal(stream.conversation.items.at(-1).recorded_state, 'started');
  assert.doesNotMatch(JSON.stringify(stream), /running|live|save_admission|save_available/iu);
});

test('replays the complete chain before exposing only the latest 128 items', () => {
  const events = explanationHistory(33);
  const stream = projectBuilderTaskStream(input(events));
  assert.equal(MAX_PUBLIC_ITEMS, 128);
  assert.equal(MAX_PUBLIC_BYTES, 4 * 1_024 * 1_024);
  assert.equal(stream.conversation.items.length, 128);
  assert.deepEqual(stream.conversation.window, {
    first_sequence: 5,
    last_sequence: 132,
    has_earlier: true,
  });
  assert.equal(stream.conversation.head_sequence, 132);
  assert.ok(Buffer.byteLength(JSON.stringify(stream), 'utf8') <= MAX_PUBLIC_BYTES);

  const forged = structuredClone(events);
  forged[0].payload.message.text = 'tampered before the visible window';
  assert.throws(() => projectBuilderTaskStream(input(forged)), assertProjectionError);
});

test('does not expose Git receipts, digests, commands, or provider material', () => {
  const serialized = JSON.stringify(projectBuilderTaskStream(input(candidateEvents())));
  assert.doesNotMatch(
    serialized,
    /git_candidate_receipt|candidate_digest|result_digest|input_digest|event_digest|event_id|command_id|commit_oid|tree_oid|base_revision|provider|credential|secret|save_admission/iu,
  );
});

test('rejects forged input with one fixed redacted error', () => {
  const valid = input(candidateEvents());
  const extra = structuredClone(valid);
  extra.internal = 'private-marker';
  const sparse = [...valid.conversation.events];
  delete sparse[1];
  let getterCalls = 0;
  const accessorEvents = [...valid.conversation.events];
  Object.defineProperty(accessorEvents, '1', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return valid.conversation.events[1];
    },
  });
  const customPrototypeEvents = [...valid.conversation.events];
  Object.setPrototypeOf(customPrototypeEvents, {
    map() {
      getterCalls += 1;
      return [];
    },
  });
  assert.throws(() => projectBuilderTaskStream(extra), assertProjectionError);
  assert.throws(() => projectBuilderTaskStream({
    project_id: PROJECT_ID,
    conversation: {
      ...valid.conversation,
      events: sparse,
    },
  }), assertProjectionError);
  assert.throws(() => projectBuilderTaskStream(input(accessorEvents)), assertProjectionError);
  assert.throws(
    () => projectBuilderTaskStream(input(customPrototypeEvents)),
    assertProjectionError,
  );
  assert.throws(() => projectBuilderTaskStream(new Proxy(valid, {})), assertProjectionError);
  assert.equal(getterCalls, 0);
  assert.doesNotMatch(assertProjectionError.toString(), /private-marker/u);
});

test('stays pure and cannot read SQLite, Git, IPC, renderer, provider, or source files', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-task-stream-projection.cjs'),
    'utf8',
  );
  assert.match(source, /MAX_PUBLIC_ITEMS = 128/u);
  assert.match(source, /MAX_PUBLIC_BYTES = 4 \* 1_024 \* 1_024/u);
  assert.match(source, /replayBuilderConversation/u);
  assert.doesNotMatch(source, /events\.map\(itemFromEvent\)/u);
  assert.doesNotMatch(
    source,
    /node:sqlite|node:fs|builder-product-metadata|builder-git|ipcMain|ipcRenderer|BrowserWindow|preload|fetch\s*\(|provider|credential|source_tree/iu,
  );
});
