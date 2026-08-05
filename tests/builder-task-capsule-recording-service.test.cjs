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
  BUILDER_TASK_CAPSULE_STORE_VERSION,
  createBuilderTaskCapsuleStore,
} = require('../electron/builder-task-capsule-store.cjs');
const {
  BUILDER_TASK_CAPSULE_RECORDING_RESULT_VERSION,
  BUILDER_TASK_CAPSULE_RECORDING_SERVICE_VERSION,
  BuilderTaskCapsuleRecordingServiceError,
  createBuilderTaskCapsuleRecordingService,
} = require('../electron/builder-task-capsule-recording-service.cjs');

const PROJECT_ID = 'builder-project:11111111-1111-4111-8111-111111111111';
const QUESTION_DIGEST = `sha256:${'0'.repeat(64)}`;

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
      fs.rmSync(root, { force: true, recursive: true });
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

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb-task-capsule-recording-'));
  let now = 1_000;
  const metadata = createBuilderProductMetadataDatabase(path.join(root, 'builder.sqlite'));
  const conversation = createBuilderConversationMainService({
    metadataAuthority: metadata,
    createUuid: uuidFactory(),
    nowMs: () => now++,
  });
  const storePath = path.join(root, 'task-capsules.sqlite');
  const store = createBuilderTaskCapsuleStore(storePath);
  const recording = createBuilderTaskCapsuleRecordingService({
    task_capsule_store: store,
  });
  t.after(() => {
    try { store.close(); } catch { /* already closed */ }
    try { metadata.close(); } catch { /* already closed */ }
    removeRoot(root);
  });
  return {
    conversation,
    metadata,
    recording,
    root,
    store,
    storePath,
  };
}

function beginBrief(conversation) {
  const context = conversation.begin_question({
    project_id: PROJECT_ID,
    question: '我想先聊一下这个作品集首页怎么做。',
    request_digest: QUESTION_DIGEST,
    base_revision: null,
    route_decision_hint: {
      route: 'update_brief',
      confidence: 'medium',
      matched_signals: ['exploratory_work'],
      downgraded_from: null,
      downgrade_reason: null,
      required_permissions: [],
      permission_result: 'not_required',
      dispatch: 'brief_update',
    },
  });
  const terminal = conversation.complete_explanation({
    context,
    assistant_text: '可以先做一个带星空 hero、项目卡片和联系入口的单页作品集。',
  });
  const briefEvent = terminal.events.find((event) => event.event_type === 'task_brief_updated');
  assert.ok(briefEvent);
  return { briefEvent, context, terminal };
}

function assertRecordingError(fn, expectedCode) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderTaskCapsuleRecordingServiceError);
      assert.equal(error.code, expectedCode);
      const text = `${error.name}:${error.message}:${error.stack}`;
      assert.doesNotMatch(
        text,
        /secret-value|api[_-]?key|credential|provider|source_tree|C:\\|raw prompt|private marker|Bearer/iu,
      );
      return true;
    },
  );
}

test('records a task capsule update from replayed conversation events', (t) => {
  const item = fixture(t);
  const { briefEvent, terminal } = beginBrief(item.conversation);

  const recorded = item.recording.record_task_capsule_from_conversation({
    events: terminal.events,
    target_sequence: briefEvent.sequence,
  });

  assert.equal(item.recording.service_version, BUILDER_TASK_CAPSULE_RECORDING_SERVICE_VERSION);
  assert.equal(recorded.result_version, BUILDER_TASK_CAPSULE_RECORDING_RESULT_VERSION);
  assert.equal(recorded.service_version, BUILDER_TASK_CAPSULE_RECORDING_SERVICE_VERSION);
  assert.equal(recorded.operation, 'task_capsule_update_recorded_from_conversation');
  assert.equal(recorded.status, 'ready');
  assert.equal(recorded.project_id, PROJECT_ID);
  assert.equal(recorded.conversation_id, briefEvent.conversation_id);
  assert.equal(recorded.target_sequence, briefEvent.sequence);
  assert.equal(recorded.task_id, briefEvent.payload.task_capsule.task_id);
  assert.equal(recorded.task_capsule_update.task_capsule.task_id, recorded.task_id);
  assert.equal(recorded.task_capsule_update.task_capsule.current_brief.source, 'task_capsule_update');
  assert.equal(recorded.store_result.operation, 'task_capsule_update_recorded');
  assert.equal(recorded.evidence.service_authority, 'main_owned_task_capsule_recording_service');
  assert.equal(recorded.evidence.conversation_replay_authority, 'builder_conversation_replay_v2');
  assert.equal(recorded.evidence.task_capsule_contract_authority, 'main_task_capsule_contract_v1');
  assert.equal(recorded.evidence.task_capsule_store_authority, 'main_owned_task_capsule_store');
  assert.equal(recorded.evidence.task_capsule_store_operation, 'task_capsule_update_recorded');
  assert.equal(recorded.evidence.conversation_append, false);
  assert.equal(recorded.evidence.renderer_authority, 'not_present');
  assert.equal(recorded.evidence.ipc_authority, 'not_present');
  assert.equal(recorded.evidence.provider_dispatch, false);
  assert.equal(recorded.evidence.model_dispatch, false);
  assert.equal(recorded.evidence.source_read, 'not_present');
  assert.equal(recorded.evidence.source_write, 'not_present');
  assert.equal(recorded.evidence.git_mutation, false);
  assert.equal(recorded.evidence.permission_grant_authority, false);
  assert.equal(recorded.evidence.review_authority, false);
  assert.equal(recorded.evidence.revision_authority, false);
  assert.equal(recorded.evidence.artifact_authority, false);
  assert.equal(recorded.evidence.command_execution, false);
  assert.equal(recorded.evidence.network_access, false);
  assert.equal(recorded.evidence.credential_storage, 'not_present');

  const latest = item.store.read_latest_task_capsule({ project_id: PROJECT_ID });
  assert.equal(latest.status, 'ready');
  assert.equal(
    latest.task_capsule_update.task_capsule_update.update_id,
    recorded.update_id,
  );

  const replayed = item.recording.record_task_capsule_from_conversation({
    events: terminal.events,
    target_sequence: briefEvent.sequence,
  });
  assert.equal(replayed.update_id, recorded.update_id);
  assert.equal(replayed.store_result.operation, 'task_capsule_update_replayed');
  assert.equal(replayed.evidence.task_capsule_store_operation, 'task_capsule_update_replayed');
  assert.deepEqual(replayed.task_capsule_update, recorded.task_capsule_update);
});

test('restores recorded task capsule updates after store restart', (t) => {
  const item = fixture(t);
  const { briefEvent, terminal } = beginBrief(item.conversation);
  const recorded = item.recording.record_task_capsule_from_conversation({
    events: terminal.events,
    target_sequence: briefEvent.sequence,
  });

  item.store.close();
  const restartedStore = createBuilderTaskCapsuleStore(item.storePath);
  try {
    const restartedService = createBuilderTaskCapsuleRecordingService({
      task_capsule_store: restartedStore,
    });
    const replayed = restartedService.record_task_capsule_from_conversation({
      events: terminal.events,
      target_sequence: briefEvent.sequence,
    });
    assert.equal(replayed.update_id, recorded.update_id);
    assert.equal(replayed.store_result.operation, 'task_capsule_update_replayed');
    assert.deepEqual(
      restartedStore.read_latest_task_capsule({ project_id: PROJECT_ID }).task_capsule_update.task_capsule_update,
      recorded.task_capsule_update,
    );
  } finally {
    restartedStore.close();
  }
});

test('fails closed for non-brief targets and incomplete replay windows', (t) => {
  const item = fixture(t);
  const { briefEvent, terminal } = beginBrief(item.conversation);

  assertRecordingError(
    () => item.recording.record_task_capsule_from_conversation({
      events: terminal.events,
      target_sequence: 1,
    }),
    'builder_task_capsule_recording_service_conflict',
  );
  assert.equal(item.store.read_latest_task_capsule({ project_id: PROJECT_ID }).status, 'absent');

  assertRecordingError(
    () => item.recording.record_task_capsule_from_conversation({
      events: [briefEvent],
      target_sequence: briefEvent.sequence,
    }),
    'builder_task_capsule_recording_service_invalid',
  );
  assert.equal(item.store.read_latest_task_capsule({ project_id: PROJECT_ID }).status, 'absent');
});

test('validates service surface without renderer, provider, source, or git authority', () => {
  assertRecordingError(
    () => createBuilderTaskCapsuleRecordingService({
      task_capsule_store: {
        store_version: BUILDER_TASK_CAPSULE_STORE_VERSION,
        read_task_capsule_update() {},
        read_latest_task_capsule() {},
      },
    }),
    'builder_task_capsule_recording_service_invalid',
  );

  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-task-capsule-recording-service.cjs'),
    'utf8',
  );
  assert.match(source, /main_owned_task_capsule_recording_service/u);
  assert.match(source, /builder_conversation_replay_v2/u);
  assert.match(source, /record_task_capsule_from_conversation/u);
  assert.doesNotMatch(
    source,
    /ipcMain|BrowserWindow|safeStorage|node:fs|node:path|node:sqlite|builder-provider|builder-git|writeFile|appendFile|execFile|spawn|fetch\(/u,
  );
});
