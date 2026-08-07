'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  BuilderSessionTaskAddressRecordingServiceError,
  SERVICE_VERSION,
  createBuilderSessionTaskAddressRecordingService,
} = require('../electron/builder-session-task-address-recording-service.cjs');
const {
  createBuilderSessionTaskAddressStore,
} = require('../electron/builder-session-task-address-store.cjs');
const {
  createBuilderConversationMainService,
} = require('../electron/builder-conversation-main-service.cjs');
const {
  createBuilderProductMetadataDatabase,
} = require('../electron/builder-product-metadata-database.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174200';
const OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174201';
const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174202';
const SESSION_UUID = '123e4567-e89b-42d3-a456-426614174301';
const TASK_ADDRESS_UUID = '123e4567-e89b-42d3-a456-426614174302';
const REQUEST_DIGEST = `sha256:${'a'.repeat(64)}`;
const QUESTION_DIGEST = `sha256:${'b'.repeat(64)}`;

function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-address-recording-'));
  return root;
}

function uuidFactory(start = 1) {
  let next = start;
  return () => `00000000-0000-4000-8000-${String(next++).padStart(12, '0')}`;
}

function fixedUuidFactory(values = [SESSION_UUID, TASK_ADDRESS_UUID]) {
  let next = 0;
  return () => values[next++] ?? `123e4567-e89b-42d3-a456-${String(next).padStart(12, '0')}`;
}

function fixture(t) {
  const root = temporaryRoot(t);
  const metadata = createBuilderProductMetadataDatabase(path.join(root, 'builder.sqlite'));
  const conversation = createBuilderConversationMainService({
    metadataAuthority: metadata,
    createUuid: uuidFactory(),
    nowMs: () => 1_000,
  });
  const addressStore = createBuilderSessionTaskAddressStore(path.join(root, 'session-task-addresses.sqlite'));
  t.after(() => {
    try { addressStore.close(); } catch { /* closed in test */ }
    try { metadata.close(); } catch { /* closed in test */ }
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, metadata, conversation, addressStore };
}

function service(addressStore, overrides = {}) {
  return createBuilderSessionTaskAddressRecordingService({
    address_store: addressStore,
    create_uuid: fixedUuidFactory(),
    now_ms: () => 2_000,
    created_by: OWNER_ID,
    agent_id: AGENT_ID,
    ...overrides,
  });
}

function workContext(conversation, instruction = 'Build a focused management dashboard') {
  return conversation.begin_work({
    project_id: PROJECT_ID,
    instruction,
    request_digest: REQUEST_DIGEST,
    base_revision: null,
  });
}

function questionContext(conversation) {
  return conversation.begin_question({
    project_id: PROJECT_ID,
    question: 'What should we build first?',
    request_digest: QUESTION_DIGEST,
    base_revision: null,
  });
}

function assertRecordingError(fn) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderSessionTaskAddressRecordingServiceError);
      assert.equal(error.code, 'builder_session_task_address_recording_invalid');
      const text = `${error.name}:${error.message}:${error.stack}`;
      assert.doesNotMatch(
        text,
        /secret-value|credential|provider|source_tree|C:\\|api[_-]?key|Authorization|Bearer|SQLITE|raw prompt/iu,
      );
      return true;
    },
  );
}

test('records Session and Task Address facts from a real work conversation context', (t) => {
  const item = fixture(t);
  const context = workContext(item.conversation);
  const recorder = service(item.addressStore);
  const recorded = recorder.record_addresses_from_conversation_context({ context });

  assert.equal(recorder.service_version, SERVICE_VERSION);
  assert.equal(recorded.result_version, 'builder-session-task-address-recording-result.v1');
  assert.equal(recorded.operation, 'session_task_addresses_recorded');
  assert.equal(recorded.project_id, PROJECT_ID);
  assert.equal(recorded.conversation_id, context.conversation.conversation_id);
  assert.equal(recorded.turn_id, context.ids.turn_id);
  assert.equal(recorded.run_id, context.ids.run_id);
  assert.equal(recorded.low_level_task_id, context.ids.task_id);
  assert.equal(recorded.authority.address_recording, 'main_owned_from_conversation_context');
  assert.equal(recorded.authority.renderer_authority, 'not_present');
  assert.equal(recorded.authority.ipc_authority, 'not_present');
  assert.equal(recorded.authority.conversation_append, false);
  assert.equal(recorded.authority.provider_dispatch, false);
  assert.equal(recorded.authority.source_mutation, false);
  assert.equal(recorded.authority.git_mutation, false);
  assert.equal(recorded.authority.permission_grant, false);
  assert.equal(recorded.authority.migration, false);
  assert.equal(recorded.authority.archive_delete_fork_export, false);

  const session = recorded.session_address.session_address;
  const task = recorded.task_address.task_address;
  assert.equal(session.session_id, `builder-session:${SESSION_UUID}`);
  assert.equal(session.project_id, PROJECT_ID);
  assert.equal(session.root_conversation_id, context.conversation.conversation_id);
  assert.equal(session.current_task_id, `builder-task-address:${TASK_ADDRESS_UUID}`);
  assert.equal(session.display_id, 'S-123E4567');
  assert.equal(task.task_address_id, session.current_task_id);
  assert.equal(task.session_id, session.session_id);
  assert.equal(task.project_id, PROJECT_ID);
  assert.equal(task.agent_id, AGENT_ID);
  assert.equal(task.conversation_id, context.conversation.conversation_id);
  assert.equal(task.status, 'active');
  assert.equal(task.goal, 'Build a focused management dashboard');
  assert.notEqual(task.task_address_id, context.ids.task_id);

  assert.deepEqual(
    item.addressStore.read_session_address({
      project_id: PROJECT_ID,
      session_id: session.session_id,
    }).session_address.session_address,
    session,
  );
  assert.deepEqual(
    item.addressStore.read_task_address({
      project_id: PROJECT_ID,
      task_address_id: task.task_address_id,
    }).task_address.task_address,
    task,
  );

  item.addressStore.close();
  const restarted = createBuilderSessionTaskAddressStore(path.join(item.root, 'session-task-addresses.sqlite'));
  assert.deepEqual(
    restarted.read_task_address({
      project_id: PROJECT_ID,
      task_address_id: task.task_address_id,
    }).task_address.task_address,
    task,
  );
  restarted.close();
});

test('records addresses when the conversation context already contains prior history', (t) => {
  const item = fixture(t);
  const context = workContext(item.conversation);
  const recorder = service(item.addressStore);
  const historicalContext = {
    ...context,
    events: [
      ...context.events,
      ...context.events,
      ...context.events,
      ...context.events,
      ...context.events,
    ],
  };

  const recorded = recorder.record_addresses_from_conversation_context({
    context: historicalContext,
  });

  assert.equal(recorded.operation, 'session_task_addresses_recorded');
  assert.equal(recorded.project_id, PROJECT_ID);
  assert.equal(recorded.conversation_id, context.conversation.conversation_id);
  assert.equal(recorded.turn_id, context.ids.turn_id);
  assert.equal(recorded.run_id, context.ids.run_id);
});

test('rejects question, failed, cancelled, stale-time, and forged contexts before recording addresses', (t) => {
  const item = fixture(t);
  const recorder = service(item.addressStore);
  const question = questionContext(item.conversation);
  const work = workContext(item.conversation, 'Build the approved layout');

  assertRecordingError(() => recorder.record_addresses_from_conversation_context({ context: question }));
  assertRecordingError(() => recorder.record_addresses_from_conversation_context({
    context: {
      ...work,
      run_terminal_failure_code: 'provider_connection_failed',
    },
  }));
  assertRecordingError(() => recorder.record_addresses_from_conversation_context({
    context: {
      ...work,
      cancel_requested: true,
    },
  }));
  assertRecordingError(() => service(item.addressStore, {
    now_ms: () => 1,
  }).record_addresses_from_conversation_context({ context: work }));
  assertRecordingError(() => recorder.record_addresses_from_conversation_context({
    context: {
      ...work,
      ids: {
        ...work.ids,
        task_id: 'builder-task:123e4567-e89b-42d3-a456-426614174999',
      },
    },
  }));

  assert.equal(item.addressStore.read_session_address({
    project_id: PROJECT_ID,
    session_id: `builder-session:${SESSION_UUID}`,
  }).status, 'absent');
});

test('fails closed on malformed options, extras, accessors, and proxies', (t) => {
  const item = fixture(t);
  const context = workContext(item.conversation);
  const recorder = service(item.addressStore);

  assertRecordingError(() => createBuilderSessionTaskAddressRecordingService({
    address_store: item.addressStore,
    create_uuid: fixedUuidFactory(),
    now_ms: () => 2_000,
    created_by: OWNER_ID,
    agent_id: AGENT_ID,
    extra: true,
  }));
  assertRecordingError(() => createBuilderSessionTaskAddressRecordingService({
    address_store: {},
    create_uuid: fixedUuidFactory(),
    now_ms: () => 2_000,
    created_by: OWNER_ID,
    agent_id: AGENT_ID,
  }));
  assertRecordingError(() => recorder.record_addresses_from_conversation_context({
    context,
    extra: true,
  }));

  let getterCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'context', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('secret-value');
    },
  });
  assertRecordingError(() => recorder.record_addresses_from_conversation_context(accessor));
  assert.equal(getterCalls, 0);

  let proxyTrapInvoked = false;
  const proxyTrap = () => {
    proxyTrapInvoked = true;
    throw new Error('private proxy marker');
  };
  assertRecordingError(() => recorder.record_addresses_from_conversation_context(new Proxy(
    { context },
    {
      getOwnPropertyDescriptor: proxyTrap,
      getPrototypeOf: proxyTrap,
      ownKeys: proxyTrap,
    },
  )));
  assert.equal(proxyTrapInvoked, false);
});

test('source boundary stays main-only without renderer, provider, source, Git, or migration authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-session-task-address-recording-service.cjs'),
    'utf8',
  );
  assert.match(source, /main_owned_from_conversation_context/u);
  assert.match(source, /record_addresses_from_conversation_context/u);
  assert.match(source, /record_session_address/u);
  assert.match(source, /record_task_address/u);
  assert.match(source, /conversation_append: false/u);
  assert.match(source, /provider_dispatch: false/u);
  assert.match(source, /source_mutation: false/u);
  assert.match(source, /git_mutation: false/u);
  assert.match(source, /migration: false/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:sqlite|node:fs|node:path|node:http|node:https|http|https)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|dugite|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|spawn\s*\(|writeFile|rmSync|shell:\s*true|localStorage|sessionStorage|indexedDB|better-sqlite|eval\s*\(|new Function|provider_secret|credential_secret|source_tree|commit_oid|tree_oid|stdout|stderr/iu,
  );
});
