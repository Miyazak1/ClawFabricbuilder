'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CONVERSATION_EVENT_VERSION,
  CONVERSATION_EVENT_KIND,
  CONVERSATION_AUTHORITY,
  MAX_EVENT_RECORD_BYTES,
  BuilderConversationRecordError,
  createBuilderConversationEvent,
  sanitizeBuilderConversationEvent,
  serializeBuilderConversationEvent,
} = require('../electron/builder-conversation-records.cjs');

const PROJECT_ID = 'builder-project:11111111-1111-4111-8111-111111111111';
const CONVERSATION_ID = 'builder-conversation:11111111-1111-4111-8111-111111111111';
const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const COMMIT_OID = 'b'.repeat(40);
const BASE_REVISION = Object.freeze({
  revision_receipt_digest: DIGEST_A,
  commit_oid: COMMIT_OID,
});

function uuid(index) { return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`; }
function typedId(kind, index) { return `builder-${kind}:${uuid(index)}`; }

function create(type, payload, previous = null, index = 1) {
  return createBuilderConversationEvent({
    record_version: CONVERSATION_EVENT_VERSION,
    record_kind: CONVERSATION_EVENT_KIND,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    sequence: previous === null ? 1 : previous.sequence + 1,
    command_id: typedId('command', index),
    event_type: type,
    previous_event: previous === null ? null : {
      sequence: previous.sequence,
      event_id: previous.event_id,
      event_digest: previous.event_digest,
    },
    payload,
    authority: { ...CONVERSATION_AUTHORITY },
  });
}

function assertRecordError(expected = 'builder_conversation_record_invalid') {
  return (error) => {
    assert.equal(error instanceof BuilderConversationRecordError, true);
    assert.equal(error.code, expected);
    assert.equal(error.message, 'The local conversation event could not be verified.');
    return true;
  };
}

test('creates deterministic project-bound command and event evidence with canonical bytes', () => {
  const event = create('turn_submitted', {
    message: { message_id: typedId('message', 1), text: 'Build a quiet focus timer.' },
    turn_id: typedId('turn', 1),
    mode: 'work',
    task: { task_id: typedId('task', 1), title: 'Create focus timer' },
    base_revision: BASE_REVISION,
  });
  const repeated = create('turn_submitted', {
    message: { message_id: typedId('message', 1), text: 'Build a quiet focus timer.' },
    turn_id: typedId('turn', 1),
    mode: 'work',
    task: { task_id: typedId('task', 1), title: 'Create focus timer' },
    base_revision: BASE_REVISION,
  });

  assert.deepEqual(event, repeated);
  assert.equal(event.record_version, 'builder-conversation-event.v2');
  assert.match(event.command_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(event.event_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(event.event_id, /^builder-conversation-event:[0-9a-f]{64}$/u);
  assert.equal(event.conversation_id, CONVERSATION_ID);
  assert.equal(Object.isFrozen(event), true);
  assert.equal(Object.isFrozen(event.payload.base_revision), true);
  assert.equal(sanitizeBuilderConversationEvent(structuredClone(event)).event_digest, event.event_digest);
  const serialized = serializeBuilderConversationEvent(event);
  assert.equal(serialized.endsWith('\n'), true);
  assert.equal(Buffer.byteLength(serialized, 'utf8') <= MAX_EVENT_RECORD_BYTES, true);
  assert.equal(serializeBuilderConversationEvent(JSON.parse(serialized)), serialized);
});

test('supports command payloads with exact run attempt and terminal result evidence', () => {
  const submitted = create('turn_submitted', {
    message: { message_id: typedId('message', 1), text: 'Explain this project.' },
    turn_id: typedId('turn', 1), mode: 'question', task: null, base_revision: null,
  }, null, 1);
  const started = create('run_started', {
    turn_id: typedId('turn', 1), run_id: typedId('run', 1), task_id: null,
    attempt_number: 1, retry_of_run_id: null, input_digest: DIGEST_A,
  }, submitted, 2);
  const completed = create('run_completed', {
    turn_id: typedId('turn', 1), run_id: typedId('run', 1), terminal_status: 'succeeded',
    result_kind: 'explanation', result_digest: DIGEST_A,
    assistant_message: { message_id: typedId('message', 2), text: 'This project is local.' },
    candidate_result: null,
  }, started, 3);
  const terminal = create('turn_completed', {
    turn_id: typedId('turn', 1), run_id: typedId('run', 1), outcome: 'answered',
  }, completed, 4);

  assert.equal(started.payload.attempt_number, 1);
  assert.equal(started.payload.retry_of_run_id, null);
  assert.equal(started.payload.input_digest, DIGEST_A);
  assert.equal(completed.payload.result_digest, DIGEST_A);
  assert.equal(completed.payload.result_kind, 'explanation');
  assert.deepEqual(Object.keys(terminal.payload).sort(), ['outcome', 'run_id', 'turn_id']);
});

test('supports actor-bound candidate rejection payloads without source or Git evidence', () => {
  const submitted = create('turn_submitted', {
    message: { message_id: typedId('message', 1), text: 'Build a local timer.' },
    turn_id: typedId('turn', 1),
    mode: 'work',
    task: { task_id: typedId('task', 1), title: 'Create timer' },
    base_revision: null,
  }, null, 1);
  const rejected = create('candidate_rejected', {
    turn_id: typedId('turn', 1),
    run_id: typedId('run', 1),
    draft_id: `builder-generation-draft:${'1'.repeat(64)}`,
    review_id: typedId('review', 1),
    reviewer_id: typedId('user', 1),
    reviewed_at_ms: 1234,
    decision: 'rejected',
  }, submitted, 2);

  assert.equal(rejected.payload.decision, 'rejected');
  assert.equal(rejected.payload.review_id, typedId('review', 1));
  assert.equal(rejected.payload.reviewer_id, typedId('user', 1));
  assert.equal(Object.isFrozen(rejected.payload), true);
  assert.doesNotMatch(
    JSON.stringify(rejected),
    /source_tree|git_candidate_receipt|credential|provider/iu,
  );

  for (const drift of [
    { ...rejected, payload: { ...rejected.payload, decision: 'accepted' } },
    { ...rejected, payload: { ...rejected.payload, review_id: typedId('run', 1) } },
    { ...rejected, payload: { ...rejected.payload, reviewer_id: typedId('message', 1) } },
    { ...rejected, payload: { ...rejected.payload, reviewed_at_ms: -1 } },
  ]) {
    assert.throws(() => sanitizeBuilderConversationEvent(drift), assertRecordError());
  }
});

test('supports accepted candidate review payloads with a minimal revision reference', () => {
  const submitted = create('turn_submitted', {
    message: { message_id: typedId('message', 1), text: 'Build a local timer.' },
    turn_id: typedId('turn', 1),
    mode: 'work',
    task: { task_id: typedId('task', 1), title: 'Create timer' },
    base_revision: null,
  }, null, 1);
  const accepted = create('candidate_accepted', {
    turn_id: typedId('turn', 1),
    run_id: typedId('run', 1),
    draft_id: `builder-generation-draft:${'2'.repeat(64)}`,
    review_id: typedId('review', 2),
    reviewer_id: typedId('user', 2),
    reviewed_at_ms: 5678,
    decision: 'accepted',
    revision: {
      revision_receipt_digest: `sha256:${'3'.repeat(64)}`,
      revision_number: 7,
    },
  }, submitted, 2);

  assert.equal(accepted.payload.decision, 'accepted');
  assert.deepEqual(accepted.payload.revision, {
    revision_receipt_digest: `sha256:${'3'.repeat(64)}`,
    revision_number: 7,
  });
  assert.equal(Object.isFrozen(accepted.payload.revision), true);
  assert.doesNotMatch(
    JSON.stringify(accepted),
    /source_tree|git_candidate_receipt|commit_oid|tree_oid|credential|provider/iu,
  );

  for (const drift of [
    { ...accepted, payload: { ...accepted.payload, decision: 'rejected' } },
    { ...accepted, payload: { ...accepted.payload, revision: { ...accepted.payload.revision, revision_number: 0 } } },
    { ...accepted, payload: { ...accepted.payload, revision: { ...accepted.payload.revision, commit_oid: COMMIT_OID } } },
  ]) {
    assert.throws(() => sanitizeBuilderConversationEvent(drift), assertRecordError());
  }
});

test('rejects non-derived conversation/event/command evidence and payload drift', () => {
  const event = create('turn_submitted', {
    message: { message_id: typedId('message', 1), text: 'Build a timer.' },
    turn_id: typedId('turn', 1), mode: 'question', task: null, base_revision: null,
  });
  const cases = [
    { ...event, conversation_id: `builder-conversation:${uuid(99)}` },
    { ...event, record_version: 'builder-conversation-event.v1' },
    { ...event, event_id: `builder-conversation-event:${'f'.repeat(64)}` },
    { ...event, command_digest: DIGEST_A },
    { ...event, event_digest: DIGEST_A },
    { ...event, unexpected: true },
    { ...event, payload: { ...event.payload, base_revision: { revision: 3, revision_digest: DIGEST_A } } },
    { ...event, payload: { ...event.payload, base_revision: { ...BASE_REVISION, revision: 3 } } },
    { ...event, payload: { ...event.payload, base_revision: { ...BASE_REVISION, commit_oid: DIGEST_A } } },
    { ...event, payload: { ...event.payload, source: '<html></html>' } },
    { ...event, authority: { ...event.authority, permission_admission: 'granted' } },
  ];
  for (const candidate of cases) {
    assert.throws(() => sanitizeBuilderConversationEvent(candidate), assertRecordError());
  }
});

test('rejects proxies, accessors, symbols, unsafe Unicode, paths, secrets, and oversized text', () => {
  const base = {
    record_version: CONVERSATION_EVENT_VERSION,
    record_kind: CONVERSATION_EVENT_KIND,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    sequence: 1,
    command_id: typedId('command', 1),
    event_type: 'turn_submitted',
    previous_event: null,
    payload: {
      message: { message_id: typedId('message', 1), text: 'Build a timer.' },
      turn_id: typedId('turn', 1), mode: 'question', task: null, base_revision: null,
    },
    authority: { ...CONVERSATION_AUTHORITY },
  };
  assert.throws(() => createBuilderConversationEvent(new Proxy(base, {})), assertRecordError());
  assert.throws(() => createBuilderConversationEvent({
    ...base, payload: new Proxy(base.payload, {}),
  }), assertRecordError());
  const accessor = { ...base };
  Object.defineProperty(accessor, 'payload', { enumerable: true, get() { return base.payload; } });
  assert.throws(() => createBuilderConversationEvent(accessor), assertRecordError());
  assert.throws(() => createBuilderConversationEvent({ ...base, [Symbol('hidden')]: true }), assertRecordError());

  for (const text of [
    'Open C:\\Users\\Ada\\secret.txt',
    'api_key=sk-abcdefghijklmnop',
    'bad\ud800text',
    `x${'a'.repeat(16 * 1_024)}`,
    'a'.repeat(1_000_000),
  ]) {
    assert.throws(() => createBuilderConversationEvent({
      ...base, payload: { ...base.payload, message: { ...base.payload.message, text } },
    }), assertRecordError());
  }

  const source = require('node:fs').readFileSync(
    require.resolve('../electron/builder-conversation-records.cjs'), 'utf8',
  );
  const safeTextSource = source.slice(
    source.indexOf('function safeText'),
    source.indexOf('function sanitizeMessage'),
  );
  assert.equal(safeTextSource.indexOf('value.length > maximumCodePoints * 2')
    < safeTextSource.indexOf('value.trim()'), true);
  assert.equal(safeTextSource.indexOf('value.length > maximumCodePoints * 2')
    < safeTextSource.indexOf("value.normalize('NFC')"), true);
});

test('keeps fixed errors free of rejected material and imports no product authority', () => {
  const marker = 'sk-should-never-appear-1234567890';
  assert.throws(() => createBuilderConversationEvent({ marker }), (error) => {
    assertRecordError()(error);
    assert.doesNotMatch(`${error.message}\n${error.stack}`, new RegExp(marker, 'u'));
    return true;
  });
  const source = require('node:fs').readFileSync(
    require.resolve('../electron/builder-conversation-records.cjs'), 'utf8',
  );
  assert.doesNotMatch(source, /builder-project-revision-repository|main\.cjs|preload\.cjs|provider|safeStorage/iu);
  assert.match(source, /permission_admission:\s*'not_granted'/u);
  assert.match(source, /revision_admission:\s*'not_created'/u);
});
