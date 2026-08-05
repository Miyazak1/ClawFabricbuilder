'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BUILDER_CONVERSATION_AUTHORITY_RESULT_VERSION,
  eventHead,
} = require('../electron/builder-conversation-authority-contract.cjs');
const {
  createBuilderConversationEvent,
} = require('../electron/builder-conversation-records.cjs');
const {
  replayBuilderConversation,
} = require('../electron/builder-conversation-replay.cjs');
const {
  BUILDER_CONVERSATION_EXPORT_VERSION,
  BuilderConversationExportError,
  createBuilderConversationExport,
} = require('../electron/builder-conversation-export.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174000';
const DRAFT_ID = `builder-generation-draft:${'5'.repeat(64)}`;

function uuid(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function digest(char) {
  return `sha256:${char.repeat(64)}`;
}

function prior(event) {
  return event === null ? null : {
    sequence: event.sequence,
    event_id: event.event_id,
    event_digest: event.event_digest,
  };
}

function routeDecision(payload, route) {
  return {
    decision_id: `builder-route-decision:${payload.message.message_id.slice('builder-message:'.length)}`,
    decision_version: 'builder-composer-route-decision.v1',
    project_id: PROJECT_ID,
    message_id: payload.message.message_id,
    task_id: payload.task === null ? null : payload.task.task_id,
    route,
    confidence: 'high',
    matched_signals: [route === 'build' ? 'clear_build' : 'read_only'],
    downgraded_from: null,
    downgrade_reason: null,
    required_permissions: route === 'build' ? ['write_project'] : [],
    permission_result: route === 'build' ? 'allowed' : 'not_required',
    dispatch: route === 'build' ? 'build' : 'reply',
    decided_at_ms: 1,
  };
}

function conversationEvent(sequence, type, payload, previousEvent = null) {
  const basePayload = type === 'run_completed'
    ? { ...payload, plan_admission: payload.plan_admission ?? null }
    : payload;
  const normalizedPayload = type === 'turn_submitted'
    ? {
      ...basePayload,
      route_decision: routeDecision(
        basePayload,
        basePayload.mode === 'work' ? 'build' : 'answer',
      ),
    }
    : basePayload;
  return createBuilderConversationEvent({
    record_version: 'builder-conversation-event.v2',
    record_kind: 'builder_conversation_event',
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    sequence,
    command_id: `builder-command:${uuid(100 + sequence)}`,
    event_type: type,
    previous_event: prior(previousEvent),
    payload: normalizedPayload,
    authority: {
      context_authority: 'project_local_conversation',
      permission_admission: 'not_granted',
      execution_admission: 'not_granted',
      revision_admission: 'not_created',
    },
  });
}

function conversationEvents() {
  const firstSubmitted = conversationEvent(1, 'turn_submitted', {
    message: {
      message_id: `builder-message:${uuid(201)}`,
      text: 'What should this dashboard include?',
    },
    turn_id: `builder-turn:${uuid(202)}`,
    mode: 'question',
    task: null,
    base_revision: null,
  });
  const firstStarted = conversationEvent(2, 'run_started', {
    turn_id: firstSubmitted.payload.turn_id,
    run_id: `builder-run:${uuid(203)}`,
    task_id: null,
    attempt_number: 1,
    retry_of_run_id: null,
    input_digest: digest('a'),
  }, firstSubmitted);
  const firstCompleted = conversationEvent(3, 'run_completed', {
    turn_id: firstSubmitted.payload.turn_id,
    run_id: firstStarted.payload.run_id,
    terminal_status: 'succeeded',
    result_kind: 'explanation',
    result_digest: digest('b'),
    assistant_message: {
      message_id: `builder-message:${uuid(204)}`,
      text: 'Use a compact task list, status filters, and a progress summary.',
    },
    candidate_result: null,
  }, firstStarted);
  const firstTurnCompleted = conversationEvent(4, 'turn_completed', {
    turn_id: firstSubmitted.payload.turn_id,
    run_id: firstStarted.payload.run_id,
    outcome: 'answered',
  }, firstCompleted);

  const secondSubmitted = conversationEvent(5, 'turn_submitted', {
    message: {
      message_id: `builder-message:${uuid(205)}`,
      text: 'Build that dashboard.',
    },
    turn_id: `builder-turn:${uuid(206)}`,
    mode: 'work',
    task: {
      task_id: `builder-task:${uuid(207)}`,
      title: 'Build dashboard',
    },
    base_revision: null,
  }, firstTurnCompleted);
  const secondStarted = conversationEvent(6, 'run_started', {
    turn_id: secondSubmitted.payload.turn_id,
    run_id: `builder-run:${uuid(208)}`,
    task_id: secondSubmitted.payload.task.task_id,
    attempt_number: 1,
    retry_of_run_id: null,
    input_digest: digest('c'),
  }, secondSubmitted);
  const secondCompleted = conversationEvent(7, 'run_completed', {
    turn_id: secondSubmitted.payload.turn_id,
    run_id: secondStarted.payload.run_id,
    terminal_status: 'succeeded',
    result_kind: 'candidate',
    result_digest: digest('d'),
    assistant_message: {
      message_id: `builder-message:${uuid(209)}`,
      text: 'The dashboard draft is ready to review.',
    },
    candidate_result: {
      draft_id: DRAFT_ID,
      title: 'Dashboard draft',
      summary: 'A local dashboard draft ready for review.',
      git_candidate_receipt: {
        receipt_version: 'builder-git-candidate-receipt.v1',
        repository_version: 'builder-git-project-repository.v1',
        project_id: PROJECT_ID,
        conversation_id: CONVERSATION_ID,
        turn_id: secondSubmitted.payload.turn_id,
        task_id: secondSubmitted.payload.task.task_id,
        run_id: secondStarted.payload.run_id,
        request_id: `builder-git-request:${uuid(210)}`,
        candidate_id: `builder-code-change-candidate:${'6'.repeat(64)}`,
        candidate_digest: digest('d'),
        resulting_tree_digest: digest('f'),
        semantic_identity_digest: digest('1'),
        verification_receipt_digest: digest('2'),
        object_format: 'sha1',
        commit_oid: '1'.repeat(40),
        tree_oid: '2'.repeat(40),
        parent_oid: null,
        expected_base_oid: null,
        code_authority: 'git_commit_candidate',
        product_revision_admission: 'not_recorded',
        replay: false,
      },
    },
  }, secondStarted);
  const secondTurnCompleted = conversationEvent(8, 'turn_completed', {
    turn_id: secondSubmitted.payload.turn_id,
    run_id: secondStarted.payload.run_id,
    outcome: 'candidate_ready',
  }, secondCompleted);

  return [
    firstSubmitted,
    firstStarted,
    firstCompleted,
    firstTurnCompleted,
    secondSubmitted,
    secondStarted,
    secondCompleted,
    secondTurnCompleted,
  ];
}

function loadedConversation(events = conversationEvents()) {
  return {
    result_version: BUILDER_CONVERSATION_AUTHORITY_RESULT_VERSION,
    operation: 'conversation_loaded',
    conversation: {
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      created_at_ms: 1,
    },
    action_events: [],
    current_head: events.length === 0 ? null : eventHead(events.at(-1)),
    events,
    snapshot: events.length === 0 ? null : replayBuilderConversation(events),
    metadata_evidence: {},
  };
}

function assertExportError(forbidden = []) {
  return (error) => {
    assert.ok(error instanceof BuilderConversationExportError);
    assert.equal(error.code, 'builder_conversation_export_invalid');
    const text = JSON.stringify({
      name: error.name,
      code: error.code,
      message: error.message,
      stack: error.stack,
    });
    assert.doesNotMatch(text, /credential-marker|commit_oid|tree_oid|candidate_digest|SQLITE/u);
    for (const marker of forbidden) assert.doesNotMatch(text, new RegExp(marker, 'iu'));
    return true;
  };
}

test('exports a replayed conversation to read-only JSONL and Markdown without leaking receipts', () => {
  const exported = createBuilderConversationExport({
    loaded_conversation: loadedConversation(),
    exported_at_ms: 1234,
  });

  assert.equal(exported.export_version, BUILDER_CONVERSATION_EXPORT_VERSION);
  assert.match(exported.export_id, /^builder-conversation-export:[0-9a-f]{64}$/u);
  assert.equal(exported.project_id, PROJECT_ID);
  assert.equal(exported.conversation_id, CONVERSATION_ID);
  assert.equal(exported.source.event_count, 8);
  assert.equal(exported.source.current_sequence, 8);
  assert.equal(exported.formats.jsonl.media_type, 'application/x-ndjson');
  assert.match(exported.formats.jsonl.text, /"entry_kind":"message"/u);
  assert.match(exported.formats.jsonl.text, /"text":"Build that dashboard\."/u);
  assert.match(exported.formats.jsonl.text, /"candidate":\{"draft_id":"builder-generation-draft:/u);
  assert.equal(exported.formats.markdown.media_type, 'text/markdown; charset=utf-8');
  assert.match(exported.formats.markdown.text, /# ClawFabric Conversation Export/u);
  assert.match(exported.formats.markdown.text, /### User\s+Build that dashboard\./u);
  assert.match(exported.formats.markdown.text, /Candidate: Dashboard draft/u);
  assert.equal(exported.lifecycle.export_materialization, 'not_performed');
  assert.equal(exported.lifecycle.sqlite_delete, 'not_performed');
  assert.equal(exported.lifecycle.git_mutation, 'not_performed');
  assert.equal(Object.isFrozen(exported), true);
  assert.doesNotMatch(
    JSON.stringify(exported),
    /git_candidate_receipt|commit_oid|tree_oid|candidate_digest|verification_receipt|provider_payload|credential|source_tree/iu,
  );
});

test('exports an empty loaded conversation as an explicit empty derived mirror', () => {
  const exported = createBuilderConversationExport({
    loaded_conversation: loadedConversation([]),
    exported_at_ms: 1234,
  });

  assert.equal(exported.source.event_count, 0);
  assert.equal(exported.source.current_sequence, 0);
  assert.match(exported.formats.jsonl.text, /"event_count":0/u);
  assert.match(exported.formats.markdown.text, /No conversation events have been recorded yet\./u);
});

test('keeps conversation exports deterministic and read-only', () => {
  const input = {
    loaded_conversation: loadedConversation(),
    exported_at_ms: 5678,
  };

  const first = createBuilderConversationExport(input);
  const second = createBuilderConversationExport(structuredClone(input));

  assert.deepEqual(second, first);
  assert.equal(first.lifecycle.sqlite_vacuum, 'not_performed');
  assert.equal(first.lifecycle.export_materialization, 'not_performed');
  assert.equal(first.lifecycle.renderer_authority, 'not_present');
  assert.equal(first.lifecycle.provider_dispatch, 'not_performed');
});

test('fails closed on malformed exports, proxies, accessors, and replay drift', () => {
  let traps = 0;
  assert.throws(
    () => createBuilderConversationExport(new Proxy({
      loaded_conversation: loadedConversation(),
      exported_at_ms: 1234,
    }, {
      ownKeys() {
        traps += 1;
        return [];
      },
    })),
    assertExportError(),
  );
  assert.equal(traps, 0);

  const extra = {
    loaded_conversation: loadedConversation(),
    exported_at_ms: 1234,
    source_path: 'credential-marker',
  };
  assert.throws(() => createBuilderConversationExport(extra), assertExportError(['credential-marker']));

  const accessor = {
    loaded_conversation: loadedConversation(),
    exported_at_ms: 1234,
  };
  Object.defineProperty(accessor.loaded_conversation.conversation, 'project_id', {
    enumerable: true,
    get: () => { throw new Error('credential-marker'); },
  });
  assert.throws(() => createBuilderConversationExport(accessor), assertExportError(['credential-marker']));

  const operationDrift = loadedConversation();
  operationDrift.operation = 'events_appended';
  assert.throws(
    () => createBuilderConversationExport({
      loaded_conversation: operationDrift,
      exported_at_ms: 1234,
    }),
    assertExportError(),
  );

  const headDrift = loadedConversation();
  headDrift.current_head = null;
  assert.throws(
    () => createBuilderConversationExport({
      loaded_conversation: headDrift,
      exported_at_ms: 1234,
    }),
    assertExportError(),
  );
});
