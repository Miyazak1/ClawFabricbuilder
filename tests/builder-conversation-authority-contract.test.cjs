'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const {
  BUILDER_CONVERSATION_AUTHORITY_CONTRACT_VERSION,
  BUILDER_CONVERSATION_AUTHORITY_RESULT_VERSION,
  MAX_APPEND_EVENTS,
  MAX_CONVERSATION_BYTES,
  MAX_CONVERSATION_EVENTS,
  BuilderConversationAuthorityContractError,
  eventHead,
  sanitizeAppendConversationEventsRequest,
  sanitizeLoadConversationRequest,
} = require('../electron/builder-conversation-authority-contract.cjs');
const {
  createBuilderConversationEvent,
} = require('../electron/builder-conversation-records.cjs');

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}`;
const DIGEST = `sha256:${'a'.repeat(64)}`;

function previous(event) {
  return event === null ? null : {
    sequence: event.sequence,
    event_id: event.event_id,
    event_digest: event.event_digest,
  };
}

function routeDecision(payload) {
  const route = payload.mode === 'work' ? 'build' : 'answer';
  return {
    decision_id: `builder-route-decision:${payload.message.message_id.slice('builder-message:'.length)}`,
    decision_version: 'builder-composer-route-decision.v1',
    project_id: PROJECT_ID,
    message_id: payload.message.message_id,
    task_id: payload.task === null ? null : payload.task.task_id,
    route,
    confidence: 'high',
    matched_signals: [payload.mode === 'work' ? 'clear_build' : 'read_only'],
    downgraded_from: null,
    downgrade_reason: null,
    required_permissions: route === 'build' ? ['write_project'] : [],
    permission_result: route === 'build' ? 'allowed' : 'not_required',
    dispatch: route === 'build' ? 'build' : 'reply',
    decided_at_ms: 1,
  };
}

function event(sequence, type, payload, previousEvent = null) {
  const basePayload = type === 'run_completed'
    ? { ...payload, plan_admission: payload.plan_admission ?? null }
    : payload;
  const normalizedPayload = type === 'turn_submitted'
    ? {
      ...basePayload,
      route_decision: Object.hasOwn(basePayload, 'route_decision')
        ? basePayload.route_decision
        : routeDecision(basePayload),
    }
    : basePayload;
  return createBuilderConversationEvent({
    record_version: 'builder-conversation-event.v2',
    record_kind: 'builder_conversation_event',
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    sequence,
    command_id: `builder-command:00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    event_type: type,
    previous_event: previous(previousEvent),
    payload: normalizedPayload,
    authority: {
      context_authority: 'project_local_conversation',
      permission_admission: 'not_granted',
      execution_admission: 'not_granted',
      revision_admission: 'not_created',
    },
  });
}

function batch() {
  const first = event(1, 'turn_submitted', {
    message: {
      message_id: 'builder-message:00000000-0000-4000-8000-000000000001',
      text: 'Build a small timer.',
    },
    turn_id: 'builder-turn:00000000-0000-4000-8000-000000000002',
    mode: 'work',
    task: {
      task_id: 'builder-task:00000000-0000-4000-8000-000000000003',
      title: 'Create Builder project',
    },
    base_revision: null,
  });
  const second = event(2, 'run_started', {
    turn_id: first.payload.turn_id,
    run_id: 'builder-run:00000000-0000-4000-8000-000000000004',
    task_id: first.payload.task.task_id,
    attempt_number: 1,
    retry_of_run_id: null,
    input_digest: DIGEST,
  }, first);
  return [first, second];
}

function request(overrides = {}) {
  return {
    project: { project_id: PROJECT_ID, created_at_ms: 10 },
    conversation: {
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      created_at_ms: 10,
    },
    expected_head: null,
    events: batch(),
    recorded_at_ms: 11,
    ...overrides,
  };
}

function assertContractError(fn) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof BuilderConversationAuthorityContractError);
    assert.equal(error.code, 'builder_conversation_authority_invalid');
    assert.equal(error.message, 'Builder conversation authority input could not be verified.');
    assert.equal(error.stack, `${error.name}: ${error.message}`);
    return true;
  });
}

test('sanitizes a bounded canonical event batch against one exact expected head', () => {
  const safe = sanitizeAppendConversationEventsRequest(request());
  assert.equal(BUILDER_CONVERSATION_AUTHORITY_CONTRACT_VERSION,
    'builder-conversation-authority-contract.v1');
  assert.equal(BUILDER_CONVERSATION_AUTHORITY_RESULT_VERSION,
    'builder-conversation-authority-result.v1');
  assert.equal(MAX_APPEND_EVENTS, 4);
  assert.equal(MAX_CONVERSATION_EVENTS, 1024);
  assert.equal(MAX_CONVERSATION_BYTES, 24 * 1024 * 1024);
  assert.equal(Object.isFrozen(safe), true);
  assert.equal(Object.isFrozen(safe.events), true);
  assert.deepEqual(safe.events, batch());
  assert.deepEqual(eventHead(safe.events.at(-1)), {
    sequence: 2,
    event_id: safe.events.at(-1).event_id,
    event_digest: safe.events.at(-1).event_digest,
  });
  assert.deepEqual(sanitizeLoadConversationRequest({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
  }), {
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
  });
});

test('accepts a continuation only when its first event follows the exact prior head', () => {
  const initial = batch();
  const expectedHead = eventHead(initial.at(-1));
  const completed = event(3, 'run_completed', {
    turn_id: initial[0].payload.turn_id,
    run_id: initial[1].payload.run_id,
    terminal_status: 'succeeded',
    result_kind: 'explanation',
    result_digest: DIGEST,
    assistant_message: {
      message_id: 'builder-message:00000000-0000-4000-8000-000000000005',
      text: 'The project context is ready.',
    },
    candidate_result: null,
  }, initial[1]);
  const terminal = event(4, 'turn_completed', {
    turn_id: initial[0].payload.turn_id,
    run_id: initial[1].payload.run_id,
    outcome: 'responded',
  }, completed);
  const safe = sanitizeAppendConversationEventsRequest(request({
    expected_head: expectedHead,
    events: [completed, terminal],
  }));
  assert.deepEqual(safe.expected_head, expectedHead);
  assert.equal(safe.events[0].sequence, 3);
  assert.equal(safe.events[1].previous_event.event_digest, completed.event_digest);
});

test('rejects project drift, head drift, sparse arrays, proxies, extras, and invalid timestamps', () => {
  const original = request();
  const cases = [
    { ...original, extra: true },
    { ...original, recorded_at_ms: -1 },
    { ...original, conversation: { ...original.conversation, project_id:
      'builder-project:00000000-0000-4000-8000-000000000099' } },
    { ...original, conversation: { ...original.conversation, conversation_id:
      'builder-conversation:00000000-0000-4000-8000-000000000099' } },
    { ...original, expected_head: eventHead(original.events[0]) },
    { ...original, events: [] },
    { ...original, events: [...original.events, ...original.events, original.events[0]] },
  ];
  const sparse = new Array(2);
  sparse[0] = original.events[0];
  cases.push({ ...original, events: sparse });
  cases.push({ ...original, events: new Proxy(original.events, {}) });
  for (const forged of cases) assertContractError(() => sanitizeAppendConversationEventsRequest(forged));

  assertContractError(() => sanitizeLoadConversationRequest({
    project_id: PROJECT_ID,
    conversation_id: 'builder-conversation:00000000-0000-4000-8000-000000000099',
  }));
});

test('remains a pure contract with no SQLite, filesystem, IPC, provider, or renderer authority', () => {
  const source = fs.readFileSync(
    require.resolve('../electron/builder-conversation-authority-contract.cjs'),
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /node:sqlite|DatabaseSync|node:fs|node:path|ipcMain|ipcRenderer|BrowserWindow|preload|fetch\s*\(|https?:|safeStorage|provider|credential|builder-conversation-repository/iu,
  );
});
