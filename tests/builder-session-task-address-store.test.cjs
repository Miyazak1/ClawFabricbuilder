'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');

const {
  BUILDER_SESSION_TASK_ADDRESS_STORE_READ_RESULT_VERSION,
  BUILDER_SESSION_TASK_ADDRESS_STORE_RESULT_VERSION,
  BUILDER_SESSION_TASK_ADDRESS_STORE_SCHEMA_VERSION,
  BUILDER_SESSION_TASK_ADDRESS_STORE_USER_VERSION,
  BUILDER_SESSION_TASK_ADDRESS_STORE_VERSION,
  BuilderSessionTaskAddressStoreError,
  createBuilderSessionTaskAddressStore,
} = require('../electron/builder-session-task-address-store.cjs');
const {
  createBuilderSessionAddress,
  createBuilderTaskAddress,
} = require('../electron/builder-session-task-address.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174200';
const OTHER_PROJECT_ID = 'builder-project:223e4567-e89b-42d3-a456-426614174200';
const SESSION_ID = 'builder-session:123e4567-e89b-42d3-a456-426614174201';
const TASK_ADDRESS_ID = 'builder-task-address:123e4567-e89b-42d3-a456-426614174203';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174205';
const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174206';

function temporaryDatabase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-addresses-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  return path.join(root, 'session-task-addresses.sqlite');
}

function digest(char) {
  return `sha256:${char.repeat(64)}`;
}

function sessionAddress(overrides = {}) {
  return createBuilderSessionAddress({
    session_id: SESSION_ID,
    project_id: PROJECT_ID,
    display_id: 'S-A1B2C3',
    title: 'Management dashboard work line',
    status: 'active',
    root_conversation_id: CONVERSATION_ID,
    current_task_id: TASK_ADDRESS_ID,
    parent_session_id: null,
    forked_from_session_id: null,
    forked_from_revision_receipt_digest: null,
    created_by: 'local-user',
    created_at_ms: 1000,
    updated_at_ms: 1100,
    archived_at_ms: null,
    ...overrides,
  });
}

function taskAddress(overrides = {}) {
  return createBuilderTaskAddress({
    task_address_id: TASK_ADDRESS_ID,
    session_id: SESSION_ID,
    project_id: PROJECT_ID,
    agent_id: AGENT_ID,
    parent_task_address_id: null,
    conversation_id: CONVERSATION_ID,
    title: 'Build management dashboard',
    goal: 'Create and refine a local management dashboard for review.',
    status: 'planned',
    current_brief_id: digest('1'),
    current_plan_id: digest('2'),
    base_revision_receipt_digest: null,
    produced_revision_receipt_digest: null,
    created_by: 'local-user',
    created_at_ms: 1000,
    updated_at_ms: 1100,
    closed_at_ms: null,
    ...overrides,
  });
}

function assertStoreError(fn, expectedCode = 'builder_session_task_address_store_invalid') {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderSessionTaskAddressStoreError);
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

test('records session and task addresses and restores them after restart', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderSessionTaskAddressStore(databasePath);
  const session = sessionAddress();
  const task = taskAddress();

  assert.equal(store.store_version, BUILDER_SESSION_TASK_ADDRESS_STORE_VERSION);
  const recordedSession = store.record_session_address({ session_address: session });
  assert.equal(recordedSession.result_version, BUILDER_SESSION_TASK_ADDRESS_STORE_RESULT_VERSION);
  assert.equal(recordedSession.operation, 'session_address_recorded');
  assert.deepEqual(recordedSession.session_address.session_address, session);
  assert.equal(recordedSession.address_evidence.address_authority, 'main_owned_session_task_address_store');
  assert.equal(recordedSession.address_evidence.address_contract_authority, 'main_session_task_address_contract_v1');
  assert.equal(recordedSession.address_evidence.renderer_authority, 'not_present');
  assert.equal(recordedSession.address_evidence.ipc_authority, 'not_present');
  assert.equal(recordedSession.address_evidence.conversation_append, false);
  assert.equal(recordedSession.address_evidence.provider_dispatch, false);
  assert.equal(recordedSession.address_evidence.source_write, 'not_present');
  assert.equal(recordedSession.address_evidence.git_mutation, false);
  assert.equal(recordedSession.address_evidence.permission_grant_authority, false);
  assert.equal(recordedSession.address_evidence.export_materialization, false);
  assert.equal(recordedSession.address_evidence.archive_authority, false);
  assert.equal(recordedSession.address_evidence.delete_authority, false);
  assert.equal(recordedSession.address_evidence.fork_authority, false);
  assert.equal(recordedSession.address_evidence.schema_version, BUILDER_SESSION_TASK_ADDRESS_STORE_SCHEMA_VERSION);
  assert.equal(recordedSession.address_evidence.user_version, BUILDER_SESSION_TASK_ADDRESS_STORE_USER_VERSION);
  assert.match(recordedSession.address_evidence.schema_fingerprint_digest, /^sha256:[0-9a-f]{64}$/u);

  const replayedSession = store.record_session_address({ session_address: session });
  assert.equal(replayedSession.operation, 'session_address_replayed');
  assert.deepEqual(replayedSession.session_address.session_address, session);

  const recordedTask = store.record_task_address({ task_address: task });
  assert.equal(recordedTask.operation, 'task_address_recorded');
  assert.deepEqual(recordedTask.task_address.task_address, task);

  const replayedTask = store.record_task_address({ task_address: task });
  assert.equal(replayedTask.operation, 'task_address_replayed');
  assert.deepEqual(replayedTask.task_address.task_address, task);

  const readSession = store.read_session_address({ project_id: PROJECT_ID, session_id: SESSION_ID });
  assert.equal(readSession.result_version, BUILDER_SESSION_TASK_ADDRESS_STORE_READ_RESULT_VERSION);
  assert.equal(readSession.status, 'ready');
  assert.deepEqual(readSession.session_address.session_address, session);
  assert.equal(Object.isFrozen(readSession.session_address.session_address), true);

  const readTask = store.read_task_address({ project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID });
  assert.equal(readTask.status, 'ready');
  assert.deepEqual(readTask.task_address.task_address, task);
  store.close();

  const restarted = createBuilderSessionTaskAddressStore(databasePath);
  assert.deepEqual(
    restarted.read_session_address({ project_id: PROJECT_ID, session_id: SESSION_ID }).session_address.session_address,
    session,
  );
  assert.deepEqual(
    restarted.read_task_address({ project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID }).task_address.task_address,
    task,
  );
  restarted.close();
});

test('rejects task addresses before their session and keeps project reads scoped', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderSessionTaskAddressStore(databasePath);
  const session = sessionAddress();
  const task = taskAddress();

  assertStoreError(
    () => store.record_task_address({ task_address: task }),
    'builder_session_task_address_store_conflict',
  );
  store.record_session_address({ session_address: session });
  store.record_task_address({ task_address: task });

  assert.equal(
    store.read_session_address({ project_id: OTHER_PROJECT_ID, session_id: SESSION_ID }).status,
    'absent',
  );
  assert.equal(
    store.read_task_address({ project_id: OTHER_PROJECT_ID, task_address_id: TASK_ADDRESS_ID }).status,
    'absent',
  );

  const wrongProjectTask = taskAddress({
    task_address_id: 'builder-task-address:323e4567-e89b-42d3-a456-426614174203',
    project_id: OTHER_PROJECT_ID,
  });
  assertStoreError(
    () => store.record_task_address({ task_address: wrongProjectTask }),
    'builder_session_task_address_store_conflict',
  );
  store.close();
});

test('rejects conflicting replay, malformed input, accessors, proxies, and tampered rows', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderSessionTaskAddressStore(databasePath);
  const session = sessionAddress();
  const task = taskAddress();
  store.record_session_address({ session_address: session });
  store.record_task_address({ task_address: task });

  assertStoreError(
    () => store.record_session_address({
      session_address: sessionAddress({
        title: 'Changed title',
      }),
    }),
    'builder_session_task_address_store_conflict',
  );
  assertStoreError(
    () => store.record_task_address({
      task_address: taskAddress({
        title: 'Changed task title',
      }),
    }),
    'builder_session_task_address_store_conflict',
  );
  assertStoreError(() => store.record_session_address({ session_address: session, extra: true }));
  assertStoreError(() => store.record_task_address({ task_address: task, extra: true }));
  assertStoreError(() => store.read_session_address({
    project_id: PROJECT_ID,
    session_id: SESSION_ID,
    extra: true,
  }));
  assertStoreError(() => store.read_task_address({
    project_id: PROJECT_ID,
    task_address_id: TASK_ADDRESS_ID,
    extra: true,
  }));

  let getterCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'session_address', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('private marker');
    },
  });
  assertStoreError(() => store.record_session_address(accessor));
  assert.equal(getterCalls, 0);

  let proxyTrapInvoked = false;
  const proxyTrap = () => {
    proxyTrapInvoked = true;
    throw new Error('private proxy marker');
  };
  assertStoreError(() => store.record_task_address(new Proxy(
    { task_address: task },
    {
      getOwnPropertyDescriptor: proxyTrap,
      getPrototypeOf: proxyTrap,
      ownKeys: proxyTrap,
    },
  )));
  assert.equal(proxyTrapInvoked, false);
  store.close();

  const raw = new DatabaseSync(databasePath);
  raw.prepare('UPDATE task_addresses SET agent_id = ? WHERE task_address_id = ?')
    .run('builder-agent:323e4567-e89b-42d3-a456-426614174206', TASK_ADDRESS_ID);
  raw.close();

  const reopened = createBuilderSessionTaskAddressStore(databasePath);
  assertStoreError(
    () => reopened.read_task_address({ project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID }),
    'builder_session_task_address_store_integrity_failed',
  );
  reopened.close();
});

test('rejects schema drift and unsafe database paths', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderSessionTaskAddressStore(databasePath);
  store.close();

  assertStoreError(
    () => createBuilderSessionTaskAddressStore(path.join('relative', 'addresses.sqlite')),
    'builder_session_task_address_store_invalid',
  );
  assertStoreError(
    () => createBuilderSessionTaskAddressStore(
      path.join(os.tmpdir(), 'missing-parent-for-session-task-address-store', 'addresses.sqlite'),
    ),
    'builder_session_task_address_store_unavailable',
  );

  const raw = new DatabaseSync(databasePath);
  raw.exec('CREATE TABLE unexpected_address_fact(id TEXT) STRICT');
  raw.close();
  assertStoreError(
    () => createBuilderSessionTaskAddressStore(databasePath),
    'builder_session_task_address_store_integrity_failed',
  );
});

test('source boundary remains a main-only Session/Task Address store without runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-session-task-address-store.cjs'),
    'utf8',
  );
  assert.match(source, /main_owned_session_task_address_store/u);
  assert.match(source, /main_session_task_address_contract_v1/u);
  assert.match(source, /record_session_address/u);
  assert.match(source, /record_task_address/u);
  assert.match(source, /read_session_address/u);
  assert.match(source, /read_task_address/u);
  assert.match(source, /node:sqlite/u);
  assert.match(source, /conversation_append: false/u);
  assert.match(source, /provider_dispatch: false/u);
  assert.match(source, /source_write: 'not_present'/u);
  assert.match(source, /archive_authority: false/u);
  assert.match(source, /delete_authority: false/u);
  assert.match(source, /fork_authority: false/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:http|node:https|http|https)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|dugite|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|spawn\s*\(|writeFile|rmSync|shell:\s*true|localStorage|sessionStorage|indexedDB|better-sqlite|eval\s*\(|new Function|provider_secret|credential_secret|source_tree|commit_oid|tree_oid|stdout|stderr/iu,
  );
});
