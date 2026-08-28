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
  sanitizeBuilderConversationEvent,
} = require('../electron/builder-conversation-records.cjs');
const {
  sha256Canonical,
} = require('../electron/builder-git-receipt-contract.cjs');

const PROJECT_ID = 'builder-project:11111111-1111-4111-8111-111111111111';
const CONVERSATION_ID = 'builder-conversation:11111111-1111-4111-8111-111111111111';
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

function append(events, eventType, payload, index) {
  const previous = events.at(-1) ?? null;
  const event = createBuilderConversationEvent({
    record_version: CONVERSATION_EVENT_VERSION,
    record_kind: CONVERSATION_EVENT_KIND,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    sequence: previous === null ? 1 : previous.sequence + 1,
    command_id: id('command', index),
    event_type: eventType,
    previous_event: head(previous),
    payload,
    authority: { ...CONVERSATION_AUTHORITY },
  });
  events.push(event);
  return event;
}

function routeDecision(messageId) {
  return {
    decision_id: id('route-decision', 1),
    decision_version: 'builder-composer-route-decision.v1',
    project_id: PROJECT_ID,
    message_id: messageId,
    task_id: id('task', 1),
    route: 'build',
    confidence: 'high',
    matched_signals: ['clear_build'],
    downgraded_from: null,
    downgrade_reason: null,
    required_permissions: ['write_project'],
    permission_result: 'allowed',
    dispatch: 'build',
    decided_at_ms: 1,
  };
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
    request_id: id('git-request', 1),
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

function rehash(event) {
  event.command_digest = sha256Canonical({
    command_id: event.command_id,
    conversation_id: event.conversation_id,
    event_type: event.event_type,
    payload: event.payload,
    project_id: event.project_id,
  });
  const unsigned = { ...event };
  delete unsigned.event_digest;
  event.event_digest = sha256Canonical(unsigned);
  return event;
}

function historicalCandidateEvent() {
  const events = [];
  const turnId = id('turn', 1);
  const taskId = id('task', 1);
  const runId = id('run', 1);
  const messageId = id('message', 1);
  append(events, 'turn_submitted', {
    message: { message_id: messageId, text: 'Synthetic candidate request.' },
    turn_id: turnId,
    mode: 'work',
    task: { task_id: taskId, title: 'Synthetic task' },
    base_revision: null,
    route_decision: routeDecision(messageId),
  }, 1);
  append(events, 'run_started', {
    turn_id: turnId,
    run_id: runId,
    task_id: taskId,
    attempt_number: 1,
    retry_of_run_id: null,
    input_digest: DIGEST,
  }, 2);
  const current = append(events, 'run_completed', {
    turn_id: turnId,
    run_id: runId,
    terminal_status: 'succeeded',
    result_kind: 'candidate',
    result_digest: DIGEST,
    assistant_message: { message_id: id('message', 2), text: 'Synthetic candidate ready.' },
    candidate_result: {
      draft_id: `builder-generation-draft:${'9'.repeat(64)}`,
      title: 'Synthetic draft',
      summary: 'Synthetic summary.',
      git_candidate_receipt: candidateReceipt(turnId, taskId, runId),
      current_materialization: { status: 'materialized' },
    },
    plan_admission: null,
  }, 3);
  const historical = JSON.parse(JSON.stringify(current));
  delete historical.payload.candidate_result.current_materialization;
  return rehash(historical);
}

test('freezes the anonymous historical schema inventory without user content', () => {
  const fixturePath = path.join(
    __dirname,
    'fixtures',
    'builder-conversation-schema-compatibility.v1.json',
  );
  const fixtureText = fs.readFileSync(fixturePath, 'utf8');
  const fixture = JSON.parse(fixtureText);
  assert.equal(fixture.fixture_version, 'builder-conversation-schema-compatibility-fixture.v1');
  assert.equal(fixture.content_policy, 'structural_keys_and_anonymous_counts_only');
  assert.equal(fixture.observed_counts.run_completed_total, 357);
  assert.equal(fixture.observed_counts.migration_required, 55);
  assert.equal(
    fixture.cases.find((item) => item.case_id === 'historical_candidate_materialization_absent')
      .reason_code,
    'legacy_candidate_materialization_absent',
  );
  assert.doesNotMatch(fixtureText, /https?:|[A-Z]:\\|prompt|credential|source_tree|message_text/iu);
});

test('proves the historical omission is digest-valid but requires an explicit chain migration', () => {
  const historical = historicalCandidateEvent();
  assert.equal(
    historical.command_digest,
    sha256Canonical({
      command_id: historical.command_id,
      conversation_id: historical.conversation_id,
      event_type: historical.event_type,
      payload: historical.payload,
      project_id: historical.project_id,
    }),
  );
  const historicalUnsigned = { ...historical };
  delete historicalUnsigned.event_digest;
  assert.equal(historical.event_digest, sha256Canonical(historicalUnsigned));
  assert.throws(() => sanitizeBuilderConversationEvent(historical));

  const migrated = JSON.parse(JSON.stringify(historical));
  migrated.payload.candidate_result.current_materialization = { status: 'not_recorded' };
  rehash(migrated);
  assert.equal(
    sanitizeBuilderConversationEvent(migrated).payload.candidate_result.current_materialization.status,
    'not_recorded',
  );
  assert.notEqual(migrated.event_digest, historical.event_digest);
});

