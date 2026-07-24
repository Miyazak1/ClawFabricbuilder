'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CONVERSATION_EVENT_VERSION,
  CONVERSATION_EVENT_KIND,
  CONVERSATION_AUTHORITY,
  createBuilderConversationEvent,
} = require('../electron/builder-conversation-records.cjs');
const {
  CONVERSATION_REPLAY_VERSION,
  BuilderConversationReplayError,
  replayBuilderConversation,
} = require('../electron/builder-conversation-replay.cjs');

const PROJECT_ID = 'builder-project:22222222-2222-4222-8222-222222222222';
const CONVERSATION_ID = 'builder-conversation:22222222-2222-4222-8222-222222222222';
const RESULT_A = `sha256:${'a'.repeat(64)}`;
const RESULT_B = `sha256:${'b'.repeat(64)}`;
const COMMIT_OID = 'c'.repeat(40);
const BASE_REVISION = Object.freeze({
  revision_receipt_digest: RESULT_A,
  commit_oid: COMMIT_OID,
});

function uuid(index) { return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`; }
function id(kind, index) { return `builder-${kind}:${uuid(index)}`; }

function idIndex(value) {
  return Number.parseInt(value.slice(-12), 16);
}

function candidateResult(turnId, runId, candidateDigest) {
  const index = idIndex(runId);
  return {
    draft_id: `builder-generation-draft:${index.toString(16).padStart(64, '0')}`,
    title: 'Generated project',
    summary: 'A generated project candidate.',
    git_candidate_receipt: {
      receipt_version: 'builder-git-candidate-receipt.v1',
      repository_version: 'builder-git-project-repository.v1',
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      turn_id: turnId,
      task_id: id('task', index),
      run_id: runId,
      request_id: id('git-request', index),
      candidate_id: `builder-code-change-candidate:${index.toString(16).padStart(64, '0')}`,
      candidate_digest: candidateDigest,
      resulting_tree_digest: RESULT_A,
      semantic_identity_digest: RESULT_B,
      verification_receipt_digest: RESULT_A,
      object_format: 'sha1',
      commit_oid: '1'.repeat(40),
      tree_oid: '2'.repeat(40),
      parent_oid: null,
      expected_base_oid: null,
      code_authority: 'git_commit_candidate',
      product_revision_admission: 'not_recorded',
      replay: false,
    },
  };
}

function append(events, eventType, payload, commandIndex = events.length + 1) {
  const previous = events.at(-1) ?? null;
  const normalizedPayload = eventType === 'run_completed'
    ? {
      ...payload,
      candidate_result: payload.candidate_result
        ?? (payload.result_kind === 'candidate'
          ? candidateResult(payload.turn_id, payload.run_id, payload.result_digest)
          : null),
    }
    : payload;
  const event = createBuilderConversationEvent({
    record_version: CONVERSATION_EVENT_VERSION,
    record_kind: CONVERSATION_EVENT_KIND,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    sequence: events.length + 1,
    command_id: id('command', commandIndex),
    event_type: eventType,
    previous_event: previous === null ? null : {
      sequence: previous.sequence, event_id: previous.event_id, event_digest: previous.event_digest,
    },
    payload: normalizedPayload,
    authority: { ...CONVERSATION_AUTHORITY },
  });
  return [...events, event];
}

function assertReplayError(error) {
  assert.equal(error instanceof BuilderConversationReplayError, true);
  assert.equal(error.code, 'builder_conversation_replay_invalid');
  assert.equal(error.message, 'The local conversation history could not be reconstructed.');
  return true;
}

function completeHistory() {
  let events = [];
  events = append(events, 'turn_submitted', {
    message: { message_id: id('message', 1), text: 'Build a focus timer.' },
    turn_id: id('turn', 1), mode: 'work',
    task: { task_id: id('task', 1), title: 'Build focus timer' },
    base_revision: BASE_REVISION,
  });
  events = append(events, 'run_started', {
    turn_id: id('turn', 1), run_id: id('run', 1), task_id: id('task', 1),
    attempt_number: 1, retry_of_run_id: null, input_digest: RESULT_A,
  });
  events = append(events, 'run_completed', {
    turn_id: id('turn', 1), run_id: id('run', 1), terminal_status: 'failed',
    result_kind: 'failure', result_digest: RESULT_A,
    assistant_message: { message_id: id('message', 2), text: 'The first attempt needs another pass.' },
  });
  events = append(events, 'run_started', {
    turn_id: id('turn', 1), run_id: id('run', 2), task_id: id('task', 1),
    attempt_number: 2, retry_of_run_id: id('run', 1), input_digest: RESULT_B,
  });
  events = append(events, 'turn_steered', {
    turn_id: id('turn', 1), run_id: id('run', 2),
    message: { message_id: id('message', 3), text: 'Use a calmer layout.' },
  });
  events = append(events, 'run_interrupt_requested', {
    turn_id: id('turn', 1), run_id: id('run', 2), request_id: id('interrupt-request', 1),
  });
  events = append(events, 'run_completed', {
    turn_id: id('turn', 1), run_id: id('run', 2), terminal_status: 'interrupted',
    result_kind: 'failure', result_digest: RESULT_B, assistant_message: null,
  });
  events = append(events, 'turn_completed', {
    turn_id: id('turn', 1), run_id: id('run', 2), outcome: 'interrupted',
  });
  events = append(events, 'turn_submitted', {
    message: { message_id: id('message', 4), text: 'What did the first attempt change?' },
    turn_id: id('turn', 2), mode: 'question', task: null, base_revision: null,
  });
  events = append(events, 'run_started', {
    turn_id: id('turn', 2), run_id: id('run', 3), task_id: null,
    attempt_number: 1, retry_of_run_id: null, input_digest: RESULT_A,
  });
  events = append(events, 'run_completed', {
    turn_id: id('turn', 2), run_id: id('run', 3), terminal_status: 'succeeded',
    result_kind: 'explanation', result_digest: RESULT_A,
    assistant_message: { message_id: id('message', 5), text: 'It prepared a timer layout.' },
  });
  events = append(events, 'turn_completed', {
    turn_id: id('turn', 2), run_id: id('run', 3), outcome: 'answered',
  });
  return events;
}

test('replays command events into a fresh frozen project-local task stream', () => {
  const events = completeHistory();
  const replay = replayBuilderConversation(events.map((event) => structuredClone(event)));
  assert.equal(replay.project_id, PROJECT_ID);
  assert.equal(replay.replay_version, CONVERSATION_REPLAY_VERSION);
  assert.equal(replay.replay_version, 'builder-conversation-replay.v2');
  assert.equal(replay.conversation_id, CONVERSATION_ID);
  assert.equal(replay.event_count, 12);
  assert.equal(replay.active_turn_id, null);
  assert.equal(replay.turns.length, 2);
  assert.deepEqual(replay.turns[0].base_revision, BASE_REVISION);
  assert.deepEqual(replay.turns[0].runs.map((run) => ({
    attempt: run.attempt_number, retry: run.retry_of_run_id, terminal: run.terminal_status,
  })), [
    { attempt: 1, retry: null, terminal: 'failed' },
    { attempt: 2, retry: id('run', 1), terminal: 'interrupted' },
  ]);
  assert.equal(replay.turns[0].messages[1].kind, 'run_result');
  assert.equal(replay.turns[1].runs[0].result_kind, 'explanation');
  assert.equal(replay.turns[1].runs[0].input_digest, RESULT_A);
  assert.equal(replay.turns[1].runs[0].result_digest, RESULT_A);
  assert.equal(replay.turns[1].messages.at(-1).role, 'assistant');
  assert.equal(Object.isFrozen(replay), true);
  assert.equal(Object.isFrozen(replay.turns[0].runs), true);
  assert.notEqual(replay.turns[0].messages, events[0].payload.message);
});

test('keeps an active turn reconstructible before terminal events arrive', () => {
  const partial = completeHistory().slice(0, 5);
  const replay = replayBuilderConversation(partial);
  assert.equal(replay.active_turn_id, id('turn', 1));
  assert.equal(replay.turns[0].status, 'active');
  assert.equal(replay.turns[0].runs.at(-1).status, 'running');
  assert.equal(replay.turns[0].messages.at(-1).kind, 'steering');
});

test('keeps cancellation distinct from interruption and permits a deliberate retry', () => {
  let events = [];
  events = append(events, 'turn_submitted', {
    message: { message_id: id('message', 30), text: 'Build a small counter.' },
    turn_id: id('turn', 30), mode: 'work',
    task: { task_id: id('task', 30), title: 'Build counter' }, base_revision: null,
  }, 30);
  events = append(events, 'run_started', {
    turn_id: id('turn', 30), run_id: id('run', 30), task_id: id('task', 30),
    attempt_number: 1, retry_of_run_id: null, input_digest: RESULT_A,
  }, 31);
  events = append(events, 'run_cancel_requested', {
    turn_id: id('turn', 30), run_id: id('run', 30),
    request_id: id('cancel-request', 30),
  }, 32);
  events = append(events, 'run_completed', {
    turn_id: id('turn', 30), run_id: id('run', 30), terminal_status: 'cancelled',
    result_kind: 'failure', result_digest: RESULT_A, assistant_message: null,
  }, 33);
  events = append(events, 'run_started', {
    turn_id: id('turn', 30), run_id: id('run', 31), task_id: id('task', 30),
    attempt_number: 2, retry_of_run_id: id('run', 30), input_digest: RESULT_B,
  }, 34);
  const replay = replayBuilderConversation(events);
  assert.equal(replay.turns[0].runs[0].terminal_status, 'cancelled');
  assert.equal(replay.turns[0].runs[0].cancel_request_id, id('cancel-request', 30));
  assert.equal(replay.turns[0].runs[0].interrupt_request_id, null);
  assert.equal(replay.turns[0].runs[1].retry_of_run_id, id('run', 30));
  assert.equal(replay.turns[0].runs[1].status, 'running');
});

test('keeps work explanations, plans, and candidates distinct from saved revisions', () => {
  const cases = [
    { resultKind: 'explanation', outcome: 'responded', seed: 40 },
    { resultKind: 'plan', outcome: 'plan_proposed', seed: 50 },
    { resultKind: 'candidate', outcome: 'candidate_ready', seed: 60 },
  ];
  for (const { resultKind, outcome, seed } of cases) {
    let events = [];
    events = append(events, 'turn_submitted', {
      message: { message_id: id('message', seed), text: 'Help improve this project.' },
      turn_id: id('turn', seed), mode: 'work',
      task: { task_id: id('task', seed), title: 'Improve project' }, base_revision: null,
    }, seed);
    events = append(events, 'run_started', {
      turn_id: id('turn', seed), run_id: id('run', seed), task_id: id('task', seed),
      attempt_number: 1, retry_of_run_id: null, input_digest: RESULT_A,
    }, seed + 1);
    events = append(events, 'run_completed', {
      turn_id: id('turn', seed), run_id: id('run', seed), terminal_status: 'succeeded',
      result_kind: resultKind, result_digest: RESULT_B,
      assistant_message: { message_id: id('message', seed + 1), text: 'Here is the result.' },
    }, seed + 2);
    events = append(events, 'turn_completed', {
      turn_id: id('turn', seed), run_id: id('run', seed), outcome,
    }, seed + 3);
    const replay = replayBuilderConversation(events);
    assert.equal(replay.turns[0].runs[0].result_kind, resultKind);
    assert.equal(replay.turns[0].outcome, outcome);
    assert.equal(replay.authority.revision_admission, 'not_created');
    assert.equal(Object.hasOwn(replay.turns[0], 'revision'), false);
  }
});

test('records candidate rejection only after a completed candidate run', () => {
  let events = [];
  events = append(events, 'turn_submitted', {
    message: { message_id: id('message', 100), text: 'Build a tiny project.' },
    turn_id: id('turn', 100), mode: 'work',
    task: { task_id: id('task', 100), title: 'Build project' }, base_revision: null,
  }, 100);
  events = append(events, 'run_started', {
    turn_id: id('turn', 100), run_id: id('run', 100), task_id: id('task', 100),
    attempt_number: 1, retry_of_run_id: null, input_digest: RESULT_A,
  }, 101);
  events = append(events, 'run_completed', {
    turn_id: id('turn', 100), run_id: id('run', 100), terminal_status: 'succeeded',
    result_kind: 'candidate', result_digest: RESULT_B,
    assistant_message: { message_id: id('message', 101), text: 'A candidate is ready.' },
  }, 102);
  events = append(events, 'turn_completed', {
    turn_id: id('turn', 100), run_id: id('run', 100), outcome: 'candidate_ready',
  }, 103);
  events = append(events, 'candidate_rejected', {
    turn_id: id('turn', 100),
    run_id: id('run', 100),
    draft_id: `builder-generation-draft:${'0'.repeat(62)}64`,
    review_id: id('review', 100),
    reviewer_id: id('user', 100),
    reviewed_at_ms: 1234,
    decision: 'rejected',
  }, 104);

  const replay = replayBuilderConversation(events);
  assert.deepEqual(replay.turns[0].runs[0].candidate_review, {
    draft_id: `builder-generation-draft:${'0'.repeat(62)}64`,
    review_id: id('review', 100),
    reviewer_id: id('user', 100),
    reviewed_at_ms: 1234,
    decision: 'rejected',
    revision: null,
  });
  assert.equal(replay.authority.revision_admission, 'not_created');

  assert.throws(() => replayBuilderConversation([...events, events.at(-1)]), assertReplayError);
  assert.throws(() => replayBuilderConversation(append([...events], 'candidate_rejected', {
    turn_id: id('turn', 100),
    run_id: id('run', 100),
    draft_id: `builder-generation-draft:${'0'.repeat(62)}64`,
    review_id: id('review', 101),
    reviewer_id: id('user', 100),
    reviewed_at_ms: 1235,
    decision: 'rejected',
  }, 106)), assertReplayError);
  assert.throws(() => replayBuilderConversation(append(events.slice(0, 3), 'candidate_rejected', {
    turn_id: id('turn', 100),
    run_id: id('run', 100),
    draft_id: `builder-generation-draft:${'0'.repeat(62)}64`,
    review_id: id('review', 101),
    reviewer_id: id('user', 100),
    reviewed_at_ms: 1235,
    decision: 'rejected',
  }, 105)), assertReplayError);
});

test('records candidate acceptance as a review fact without making conversation a revision authority', () => {
  let events = [];
  events = append(events, 'turn_submitted', {
    message: { message_id: id('message', 120), text: 'Build a tiny project.' },
    turn_id: id('turn', 120), mode: 'work',
    task: { task_id: id('task', 120), title: 'Build project' }, base_revision: null,
  }, 120);
  events = append(events, 'run_started', {
    turn_id: id('turn', 120), run_id: id('run', 120), task_id: id('task', 120),
    attempt_number: 1, retry_of_run_id: null, input_digest: RESULT_A,
  }, 121);
  events = append(events, 'run_completed', {
    turn_id: id('turn', 120), run_id: id('run', 120), terminal_status: 'succeeded',
    result_kind: 'candidate', result_digest: RESULT_B,
    assistant_message: { message_id: id('message', 121), text: 'A candidate is ready.' },
  }, 122);
  events = append(events, 'turn_completed', {
    turn_id: id('turn', 120), run_id: id('run', 120), outcome: 'candidate_ready',
  }, 123);
  events = append(events, 'candidate_accepted', {
    turn_id: id('turn', 120),
    run_id: id('run', 120),
    draft_id: `builder-generation-draft:${'0'.repeat(62)}78`,
    review_id: id('review', 120),
    reviewer_id: id('user', 120),
    reviewed_at_ms: 5678,
    decision: 'accepted',
    revision: {
      revision_receipt_digest: `sha256:${'8'.repeat(64)}`,
      revision_number: 2,
    },
  }, 124);

  const replay = replayBuilderConversation(events);
  assert.deepEqual(replay.turns[0].runs[0].candidate_review, {
    draft_id: `builder-generation-draft:${'0'.repeat(62)}78`,
    review_id: id('review', 120),
    reviewer_id: id('user', 120),
    reviewed_at_ms: 5678,
    decision: 'accepted',
    revision: {
      revision_receipt_digest: `sha256:${'8'.repeat(64)}`,
      revision_number: 2,
    },
  });
  assert.equal(replay.authority.revision_admission, 'not_created');

  assert.throws(() => replayBuilderConversation(append([...events], 'candidate_rejected', {
    turn_id: id('turn', 120),
    run_id: id('run', 120),
    draft_id: `builder-generation-draft:${'0'.repeat(62)}78`,
    review_id: id('review', 121),
    reviewer_id: id('user', 120),
    reviewed_at_ms: 5679,
    decision: 'rejected',
  }, 125)), assertReplayError);
});

test('requires terminal outcomes to honor durable interrupt and cancel requests', () => {
  function running(seed) {
    let events = [];
    events = append(events, 'turn_submitted', {
      message: { message_id: id('message', seed), text: 'Build a local note card.' },
      turn_id: id('turn', seed), mode: 'work',
      task: { task_id: id('task', seed), title: 'Build note card' }, base_revision: null,
    }, seed);
    return append(events, 'run_started', {
      turn_id: id('turn', seed), run_id: id('run', seed), task_id: id('task', seed),
      attempt_number: 1, retry_of_run_id: null, input_digest: RESULT_A,
    }, seed + 1);
  }

  let interruptedRequest = running(70);
  interruptedRequest = append(interruptedRequest, 'run_interrupt_requested', {
    turn_id: id('turn', 70), run_id: id('run', 70),
    request_id: id('interrupt-request', 70),
  }, 72);
  const successAfterInterruptRequest = append(interruptedRequest, 'run_completed', {
    turn_id: id('turn', 70), run_id: id('run', 70), terminal_status: 'succeeded',
    result_kind: 'candidate', result_digest: RESULT_B,
    assistant_message: { message_id: id('message', 71), text: 'The result arrived first.' },
  }, 73);
  assert.throws(() => replayBuilderConversation(successAfterInterruptRequest), assertReplayError);

  let cancelledRequest = running(80);
  cancelledRequest = append(cancelledRequest, 'run_cancel_requested', {
    turn_id: id('turn', 80), run_id: id('run', 80), request_id: id('cancel-request', 80),
  }, 82);
  const failureAfterCancelRequest = append(cancelledRequest, 'run_completed', {
    turn_id: id('turn', 80), run_id: id('run', 80), terminal_status: 'failed',
    result_kind: 'failure', result_digest: RESULT_B,
    assistant_message: { message_id: id('message', 81), text: 'The attempt failed first.' },
  }, 83);
  assert.throws(() => replayBuilderConversation(failureAfterCancelRequest), assertReplayError);

  assert.throws(() => replayBuilderConversation(append(interruptedRequest, 'run_cancel_requested', {
    turn_id: id('turn', 70), run_id: id('run', 70), request_id: id('cancel-request', 70),
  }, 74)), assertReplayError);
  assert.throws(() => replayBuilderConversation(append(cancelledRequest, 'run_interrupt_requested', {
    turn_id: id('turn', 80), run_id: id('run', 80), request_id: id('interrupt-request', 80),
  }, 84)), assertReplayError);
});

test('rejects invalid lifecycle transitions, retry drift, and terminal mismatch', () => {
  const submitted = completeHistory().slice(0, 1);
  const cases = [];
  cases.push(append(submitted, 'run_started', {
    turn_id: id('turn', 1), run_id: id('run', 9), task_id: id('task', 1),
    attempt_number: 2, retry_of_run_id: null, input_digest: RESULT_A,
  }));
  cases.push(append(submitted, 'turn_completed', {
    turn_id: id('turn', 1), run_id: null, outcome: 'candidate_ready',
  }));
  const running = append(submitted, 'run_started', {
    turn_id: id('turn', 1), run_id: id('run', 9), task_id: id('task', 1),
    attempt_number: 1, retry_of_run_id: null, input_digest: RESULT_A,
  });
  cases.push(append(running, 'run_completed', {
    turn_id: id('turn', 1), run_id: id('run', 9), terminal_status: 'interrupted',
    result_kind: 'failure', result_digest: RESULT_A, assistant_message: null,
  }));
  const succeeded = append(running, 'run_completed', {
    turn_id: id('turn', 1), run_id: id('run', 9), terminal_status: 'succeeded',
    result_kind: 'candidate', result_digest: RESULT_A,
    assistant_message: { message_id: id('message', 9), text: 'A candidate is ready.' },
  });
  cases.push(append(succeeded, 'run_started', {
    turn_id: id('turn', 1), run_id: id('run', 10), task_id: id('task', 1),
    attempt_number: 2, retry_of_run_id: id('run', 9), input_digest: RESULT_B,
  }));
  cases.push(append(succeeded, 'turn_completed', {
    turn_id: id('turn', 1), run_id: id('run', 9), outcome: 'failed',
  }));
  let question = [];
  question = append(question, 'turn_submitted', {
    message: { message_id: id('message', 20), text: 'Explain this.' },
    turn_id: id('turn', 20), mode: 'question', task: null, base_revision: null,
  }, 20);
  question = append(question, 'run_started', {
    turn_id: id('turn', 20), run_id: id('run', 20), task_id: null,
    attempt_number: 1, retry_of_run_id: null, input_digest: RESULT_A,
  }, 21);
  cases.push(append(question, 'run_completed', {
    turn_id: id('turn', 20), run_id: id('run', 20), terminal_status: 'succeeded',
    result_kind: 'candidate', result_digest: RESULT_A,
    assistant_message: { message_id: id('message', 21), text: 'Wrong result kind.' },
  }, 22));
  for (const events of cases) {
    assert.throws(() => replayBuilderConversation(events), assertReplayError);
  }
});

test('rejects duplicate command identity and forged array authority', () => {
  const events = completeHistory().slice(0, 2);
  const prior = events.at(-1);
  const duplicateCommand = createBuilderConversationEvent({
    record_version: CONVERSATION_EVENT_VERSION,
    record_kind: CONVERSATION_EVENT_KIND,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    sequence: 3,
    command_id: events[0].command_id,
    event_type: 'turn_steered',
    previous_event: {
      sequence: prior.sequence, event_id: prior.event_id, event_digest: prior.event_digest,
    },
    payload: {
      turn_id: id('turn', 1), run_id: id('run', 1),
      message: { message_id: id('message', 8), text: 'Change direction.' },
    },
    authority: { ...CONVERSATION_AUTHORITY },
  });
  assert.throws(() => replayBuilderConversation([...events, duplicateCommand]), assertReplayError);
  assert.throws(() => replayBuilderConversation(new Proxy(events, {})), assertReplayError);
  const sparse = [...events];
  delete sparse[0];
  assert.throws(() => replayBuilderConversation(sparse), assertReplayError);
  const accessor = [...events];
  Object.defineProperty(accessor, '0', { enumerable: true, get() { return events[0]; } });
  assert.throws(() => replayBuilderConversation(accessor), assertReplayError);
  const symbol = [...events];
  symbol[Symbol('hidden')] = true;
  assert.throws(() => replayBuilderConversation(symbol), assertReplayError);
});

test('contains all transition rules in replay and none in the SQLite persistence layer', () => {
  const fs = require('node:fs');
  const replaySource = fs.readFileSync(
    require.resolve('../electron/builder-conversation-replay.cjs'), 'utf8',
  );
  const databaseSource = fs.readFileSync(
    require.resolve('../electron/builder-product-metadata-database.cjs'), 'utf8',
  );
  for (const eventType of [
    'turn_submitted', 'turn_steered', 'run_started', 'run_interrupt_requested',
    'run_cancel_requested', 'candidate_rejected',
    'run_completed', 'turn_completed',
  ]) {
    assert.match(replaySource, new RegExp(eventType, 'u'));
    assert.doesNotMatch(databaseSource, new RegExp(eventType, 'u'));
  }
  assert.match(databaseSource, /replayBuilderConversation/u);
});
