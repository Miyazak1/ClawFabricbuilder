'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  BuilderContextCompactionRecordingServiceError,
  SERVICE_VERSION,
  createBuilderContextCompactionRecordingService,
} = require('../electron/builder-context-compaction-recording-service.cjs');
const {
  createBuilderContextCompactionSummaryStore,
} = require('../electron/builder-context-compaction-summary-store.cjs');
const {
  createBuilderConversationMainService,
} = require('../electron/builder-conversation-main-service.cjs');
const {
  BUILDER_CONVERSATION_AUTHORITY_RESULT_VERSION,
  eventHead,
} = require('../electron/builder-conversation-authority-contract.cjs');
const {
  createBuilderConversationCompactionProjection,
} = require('../electron/builder-conversation-export.cjs');
const {
  createBuilderConversationEvent,
} = require('../electron/builder-conversation-records.cjs');
const {
  replayBuilderConversation,
} = require('../electron/builder-conversation-replay.cjs');
const {
  createBuilderProductMetadataDatabase,
} = require('../electron/builder-product-metadata-database.cjs');
const {
  createBuilderSessionAddress,
  createBuilderTaskAddress,
} = require('../electron/builder-session-task-address.cjs');
const {
  createBuilderSessionTaskAddressStore,
} = require('../electron/builder-session-task-address-store.cjs');

const UUID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}`;
const TASK_CONVERSATION_ID =
  `builder-conversation:${UUID}:11111111-1111-4111-8111-111111111115`;
const SESSION_ID = 'builder-session:11111111-1111-4111-8111-111111111112';
const TASK_ADDRESS_ID = 'builder-task-address:11111111-1111-4111-8111-111111111113';
const AGENT_ID = 'builder-agent:11111111-1111-4111-8111-111111111114';
const REQUEST_DIGEST = `sha256:${'1'.repeat(64)}`;

function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb-context-compaction-recording-'));
  return root;
}

function uuidFactory() {
  let value = 1;
  return () => `00000000-0000-4000-8000-${String(value++).padStart(12, '0')}`;
}

function sessionAddress() {
  return createBuilderSessionAddress({
    session_id: SESSION_ID,
    project_id: PROJECT_ID,
    display_id: 'S-A1B2C3',
    title: 'Local coding session',
    status: 'active',
    root_conversation_id: CONVERSATION_ID,
    current_task_id: TASK_ADDRESS_ID,
    parent_session_id: null,
    forked_from_session_id: null,
    forked_from_revision_receipt_digest: null,
    created_by: 'local-user',
    created_at_ms: 1000,
    updated_at_ms: 1000,
    archived_at_ms: null,
  });
}

function taskAddress() {
  return createBuilderTaskAddress({
    task_address_id: TASK_ADDRESS_ID,
    session_id: SESSION_ID,
    project_id: PROJECT_ID,
    agent_id: AGENT_ID,
    parent_task_address_id: null,
    conversation_id: TASK_CONVERSATION_ID,
    title: 'Build the local project',
    goal: 'Make a recoverable local coding change.',
    status: 'active',
    current_brief_id: `sha256:${'2'.repeat(64)}`,
    current_plan_id: null,
    base_revision_receipt_digest: null,
    produced_revision_receipt_digest: null,
    created_by: 'local-user',
    created_at_ms: 1000,
    updated_at_ms: 1000,
    closed_at_ms: null,
  });
}

function fixture(t) {
  const root = temporaryRoot();
  const metadata = createBuilderProductMetadataDatabase(path.join(root, 'builder.sqlite'));
  const addressStore = createBuilderSessionTaskAddressStore(path.join(root, 'addresses.sqlite'));
  const compactionStore = createBuilderContextCompactionSummaryStore(path.join(root, 'compactions.sqlite'));
  addressStore.record_session_address({ session_address: sessionAddress() });
  addressStore.record_task_address({ task_address: taskAddress() });
  let now = 2_000;
  const conversation = createBuilderConversationMainService({
    metadataAuthority: metadata,
    createUuid: uuidFactory(),
    nowMs: () => now++,
  });
  const recorder = createBuilderContextCompactionRecordingService({
    context_compaction_summary_store: compactionStore,
    session_task_address_store: addressStore,
    now_ms: () => now++,
    minimum_source_event_count: 2,
  });
  t.after(() => {
    compactionStore.close();
    addressStore.close();
    metadata.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { addressStore, compactionStore, conversation, metadata, recorder };
}

function beginQuestion(conversation) {
  return conversation.begin_question({
    project_id: PROJECT_ID,
    conversation_id: TASK_CONVERSATION_ID,
    question: 'Summarize the current task and keep the project direction compact.',
    request_digest: REQUEST_DIGEST,
    base_revision: null,
  });
}

function syntheticLargeLoadedConversation() {
  let id = 10_000;
  let previousEvent = null;
  const events = [];
  const questionBody = 'q'.repeat(7_900);
  const answerBody = 'a'.repeat(7_900);
  const nextUuid = () => `00000000-0000-4000-8000-${String(id++).padStart(12, '0')}`;
  const append = (eventType, payload) => {
    const event = createBuilderConversationEvent({
      record_version: 'builder-conversation-event.v2',
      record_kind: 'builder_conversation_event',
      project_id: PROJECT_ID,
      conversation_id: TASK_CONVERSATION_ID,
      sequence: events.length + 1,
      command_id: `builder-command:${nextUuid()}`,
      event_type: eventType,
      previous_event: previousEvent === null ? null : eventHead(previousEvent),
      payload,
      authority: {
        context_authority: 'project_local_conversation',
        permission_admission: 'not_granted',
        execution_admission: 'not_granted',
        revision_admission: 'not_created',
      },
    });
    events.push(event);
    previousEvent = event;
  };
  for (let index = 0; index < 255; index += 1) {
    const messageId = `builder-message:${nextUuid()}`;
    const assistantMessageId = `builder-message:${nextUuid()}`;
    const turnId = `builder-turn:${nextUuid()}`;
    const runId = `builder-run:${nextUuid()}`;
    append('turn_submitted', {
      message: { message_id: messageId, text: `Question ${index}: ${questionBody}` },
      turn_id: turnId,
      mode: 'question',
      task: null,
      base_revision: null,
      route_decision: {
        decision_id: `builder-route-decision:${nextUuid()}`,
        decision_version: 'builder-composer-route-decision.v1',
        project_id: PROJECT_ID,
        message_id: messageId,
        task_id: null,
        route: 'answer',
        confidence: 'high',
        matched_signals: ['read_only'],
        downgraded_from: null,
        downgrade_reason: null,
        required_permissions: [],
        permission_result: 'not_required',
        dispatch: 'reply',
        decided_at_ms: index + 1,
      },
    });
    append('run_started', {
      turn_id: turnId,
      run_id: runId,
      task_id: null,
      attempt_number: 1,
      retry_of_run_id: null,
      input_digest: `sha256:${'2'.repeat(64)}`,
    });
    append('run_completed', {
      turn_id: turnId,
      run_id: runId,
      terminal_status: 'succeeded',
      result_kind: 'explanation',
      result_digest: `sha256:${'3'.repeat(64)}`,
      assistant_message: {
        message_id: assistantMessageId,
        text: `Answer ${index}: ${answerBody}`,
      },
      candidate_result: null,
      plan_admission: null,
    });
    append('turn_completed', {
      turn_id: turnId,
      run_id: runId,
      outcome: 'answered',
    });
  }
  return {
    result_version: BUILDER_CONVERSATION_AUTHORITY_RESULT_VERSION,
    operation: 'conversation_loaded',
    conversation: {
      project_id: PROJECT_ID,
      conversation_id: TASK_CONVERSATION_ID,
      created_at_ms: 1,
    },
    action_events: [],
    current_head: eventHead(events.at(-1)),
    events,
    snapshot: replayBuilderConversation(events),
    metadata_evidence: {},
  };
}

test('records a bounded compaction summary from a committed public conversation', (t) => {
  const item = fixture(t);
  const context = beginQuestion(item.conversation);
  item.conversation.complete_explanation({
    context,
    assistant_text: 'Use the current task direction and keep secrets out of summaries.',
  });
  const loaded = item.metadata.load_conversation({
    project_id: PROJECT_ID,
    conversation_id: TASK_CONVERSATION_ID,
  });

  const recorded = item.recorder.record_committed_conversation_compaction({
    loaded_conversation: loaded,
  });

  assert.equal(item.recorder.service_version, SERVICE_VERSION);
  assert.equal(recorded.operation, 'compaction_summary_recorded');
  assert.equal(recorded.project_id, PROJECT_ID);
  assert.equal(recorded.conversation_id, TASK_CONVERSATION_ID);
  assert.equal(recorded.task_address_id, TASK_ADDRESS_ID);
  assert.match(recorded.summary_id, /^builder-context-compaction-summary:[0-9a-f]{64}$/u);
  assert.equal(recorded.authority.provider_dispatch, false);
  assert.equal(recorded.authority.source_mutation, false);
  assert.equal(recorded.authority.git_mutation, false);
  assert.equal(recorded.authority.permission_grant, false);
  assert.equal(recorded.authority.readiness_authority, 'not_authoritative_for_readiness');

  const latest = item.compactionStore.read_latest_context_compaction_summary({
    conversation_id: TASK_CONVERSATION_ID,
    task_address_id: TASK_ADDRESS_ID,
  });
  assert.equal(latest.status, 'ready');
  const summary = latest.context_compaction_summary.context_compaction_summary;
  assert.equal(summary.summary_id, recorded.summary_id);
  assert.equal(summary.task_address_id, TASK_ADDRESS_ID);
  assert.doesNotMatch(summary.summary, /C:\\|api_key|secret/iu);
  assert.match(summary.summary, /Conversation checkpoint through event sequence/u);
});

test('replays the same source range idempotently and skips short conversations', (t) => {
  const item = fixture(t);
  const context = beginQuestion(item.conversation);
  const loadedRunning = item.metadata.load_conversation({
    project_id: PROJECT_ID,
    conversation_id: TASK_CONVERSATION_ID,
  });

  const skippedRecorder = createBuilderContextCompactionRecordingService({
    context_compaction_summary_store: item.compactionStore,
    session_task_address_store: item.addressStore,
    now_ms: () => 3_000,
    minimum_source_event_count: 16,
  });
  assert.equal(
    skippedRecorder.record_committed_conversation_compaction({
      loaded_conversation: loadedRunning,
    }).operation,
    'compaction_not_needed',
  );

  item.conversation.complete_explanation({ context, assistant_text: 'The answer is ready.' });
  const loadedComplete = item.metadata.load_conversation({
    project_id: PROJECT_ID,
    conversation_id: TASK_CONVERSATION_ID,
  });
  const first = item.recorder.record_committed_conversation_compaction({
    loaded_conversation: loadedComplete,
  });
  const second = item.recorder.record_committed_conversation_compaction({
    loaded_conversation: loadedComplete,
  });
  assert.equal(first.operation, 'compaction_summary_recorded');
  assert.equal(second.operation, 'compaction_summary_replayed');
  assert.equal(first.summary_id, second.summary_id);
});

test('records a bounded projection for a valid conversation whose public transcript exceeds 4 MiB', (t) => {
  const item = fixture(t);
  const loaded = syntheticLargeLoadedConversation();
  const projection = createBuilderConversationCompactionProjection({
    loaded_conversation: loaded,
  });

  assert.equal(projection.source.event_count, 1_020);
  assert.equal(projection.public_text_byte_length > 4 * 1_024 * 1_024, true);
  assert.equal(projection.recent_public_entries.length, 32);
  assert.match(projection.omitted_public_entries_digest, /^sha256:[0-9a-f]{64}$/u);

  const recorded = item.recorder.record_committed_conversation_compaction({
    loaded_conversation: loaded,
  });
  assert.equal(recorded.operation, 'compaction_summary_recorded');
  assert.equal(recorded.source_event_count, 1_020);
  assert.equal(recorded.authority.source, 'sqlite_conversation_replay_bounded_projection');
});

test('fails closed for malformed services and keeps source boundary main-only', () => {
  assert.throws(
    () => createBuilderContextCompactionRecordingService({
      context_compaction_summary_store: {},
      session_task_address_store: {},
      now_ms: () => 1,
      minimum_source_event_count: 1,
    }),
    (error) => {
      assert.ok(error instanceof BuilderContextCompactionRecordingServiceError);
      assert.equal(error.code, 'builder_context_compaction_recording_invalid');
      assert.doesNotMatch(`${error.message}\n${error.stack}`, /secret|credential|C:\\|Authorization/iu);
      return true;
    },
  );

  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-context-compaction-recording-service.cjs'),
    'utf8',
  );
  assert.match(source, /main_owned_context_compaction_recording_service/u);
  assert.match(source, /createBuilderContextCompactionSummary/u);
  assert.match(source, /record_context_compaction_summary/u);
  assert.match(source, /read_current_session_task_for_conversation/u);
  assert.doesNotMatch(
    source,
    /ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|fetch\s*\(|https?:|builder-provider|builder-git|dugite|child_process|execFile|spawn\s*\(|writeFile|rmSync|permission_grant:\s*true|source_mutation:\s*true|git_mutation:\s*true/iu,
  );
});
