'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');

const {
  BUILDER_TASK_CAPSULE_STORE_READ_RESULT_VERSION,
  BUILDER_TASK_CAPSULE_STORE_RESULT_VERSION,
  BUILDER_TASK_CAPSULE_STORE_SCHEMA_VERSION,
  BUILDER_TASK_CAPSULE_STORE_USER_VERSION,
  BUILDER_TASK_CAPSULE_STORE_VERSION,
  BuilderTaskCapsuleStoreError,
  createBuilderTaskCapsuleStore,
} = require('../electron/builder-task-capsule-store.cjs');
const {
  BUILDER_TASK_CAPSULE_UPDATE_VERSION,
  BUILDER_TASK_CAPSULE_VERSION,
  BUILDER_WORKING_BRIEF_VERSION,
  createBuilderTaskCapsuleUpdate,
} = require('../electron/builder-task-capsule-contract.cjs');

const PROJECT_UUID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = `builder-project:${PROJECT_UUID}`;
const OTHER_PROJECT_ID = 'builder-project:22222222-2222-4222-8222-222222222222';
const CONVERSATION_ID = `builder-conversation:${PROJECT_UUID}`;
const TURN_ID = `builder-turn:${PROJECT_UUID}`;
const RUN_ID = `builder-run:${PROJECT_UUID}`;
const MESSAGE_ID = `builder-message:${PROJECT_UUID}`;
const ROUTE_DECISION_ID = `builder-route-decision:${PROJECT_UUID}`;
const TASK_ID = `builder-task:${PROJECT_UUID}`;

function temporaryDatabase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-task-capsules-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  return path.join(root, 'task-capsules.sqlite');
}

function uuid(index) {
  return `123e4567-e89b-42d3-a456-${index.toString(16).padStart(12, '0')}`;
}

function id(kind, index) {
  return `builder-${kind}:${uuid(index)}`;
}

function workingBrief(index = 1, overrides = {}) {
  return {
    brief_version: BUILDER_WORKING_BRIEF_VERSION,
    source: 'task_capsule_update',
    latest_user_goal: `Create a project direction from discussion ${index}.`,
    assistant_proposal: `Use the agreed layout and interaction approach ${index}.`,
    approved_plan: null,
    use_when_instruction_is_contextual: true,
    ...overrides,
  };
}

function capsule(index = 1, overrides = {}) {
  return {
    capsule_version: BUILDER_TASK_CAPSULE_VERSION,
    task_id: index === 1 ? TASK_ID : id('task', index),
    project_id: PROJECT_ID,
    title: `Task capsule ${index}`,
    goal: `Keep the contextual build target for discussion ${index}.`,
    status: 'ready',
    current_brief: workingBrief(index),
    last_route_decision_id: index === 1 ? ROUTE_DECISION_ID : id('route-decision', index),
    updated_at_ms: 1_000 + index,
    ...overrides,
  };
}

function update(index = 1, overrides = {}) {
  const { task_capsule: taskCapsuleOverrides = {}, ...rest } = overrides;
  const taskCapsule = capsule(index, taskCapsuleOverrides);
  return createBuilderTaskCapsuleUpdate({
    project_id: PROJECT_ID,
    conversation_id: index === 1 ? CONVERSATION_ID : id('conversation', index),
    turn_id: index === 1 ? TURN_ID : id('turn', index),
    run_id: index === 1 ? RUN_ID : id('run', index),
    message_id: index === 1 ? MESSAGE_ID : id('message', index),
    route_decision_id: taskCapsule.last_route_decision_id,
    task_capsule: taskCapsule,
    updated_at_ms: taskCapsule.updated_at_ms,
    ...rest,
  });
}

function assertStoreError(fn, expectedCode = 'builder_task_capsule_store_invalid') {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderTaskCapsuleStoreError);
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

test('records task capsule updates and restores them after restart', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderTaskCapsuleStore(databasePath);
  const record = update(1);
  const recorded = store.record_task_capsule_update({ task_capsule_update: record });

  assert.equal(store.store_version, BUILDER_TASK_CAPSULE_STORE_VERSION);
  assert.equal(recorded.result_version, BUILDER_TASK_CAPSULE_STORE_RESULT_VERSION);
  assert.equal(recorded.operation, 'task_capsule_update_recorded');
  assert.deepEqual(recorded.task_capsule_update.task_capsule_update, record);
  assert.equal(recorded.task_capsule_evidence.task_capsule_authority, 'main_owned_task_capsule_store');
  assert.equal(recorded.task_capsule_evidence.task_capsule_contract_authority, 'main_task_capsule_contract_v1');
  assert.equal(recorded.task_capsule_evidence.renderer_authority, 'not_present');
  assert.equal(recorded.task_capsule_evidence.ipc_authority, 'not_present');
  assert.equal(recorded.task_capsule_evidence.conversation_append, false);
  assert.equal(recorded.task_capsule_evidence.provider_dispatch, false);
  assert.equal(recorded.task_capsule_evidence.model_dispatch, false);
  assert.equal(recorded.task_capsule_evidence.source_read, 'not_present');
  assert.equal(recorded.task_capsule_evidence.source_write, 'not_present');
  assert.equal(recorded.task_capsule_evidence.git_mutation, false);
  assert.equal(recorded.task_capsule_evidence.permission_grant_authority, false);
  assert.equal(recorded.task_capsule_evidence.review_authority, false);
  assert.equal(recorded.task_capsule_evidence.revision_authority, false);
  assert.equal(recorded.task_capsule_evidence.artifact_authority, false);
  assert.equal(recorded.task_capsule_evidence.command_execution, false);
  assert.equal(recorded.task_capsule_evidence.network_access, false);
  assert.equal(recorded.task_capsule_evidence.credential_storage, 'not_present');
  assert.equal(recorded.task_capsule_evidence.recovery_model, 'idempotent_store_replay');
  assert.equal(recorded.task_capsule_evidence.schema_version, BUILDER_TASK_CAPSULE_STORE_SCHEMA_VERSION);
  assert.equal(recorded.task_capsule_evidence.user_version, BUILDER_TASK_CAPSULE_STORE_USER_VERSION);
  assert.match(recorded.task_capsule_evidence.schema_fingerprint_digest, /^sha256:[0-9a-f]{64}$/u);

  const replayed = store.record_task_capsule_update({ task_capsule_update: record });
  assert.equal(replayed.operation, 'task_capsule_update_replayed');
  assert.deepEqual(replayed.task_capsule_update.task_capsule_update, record);

  const read = store.read_task_capsule_update({
    project_id: PROJECT_ID,
    update_id: record.update_id,
  });
  assert.equal(read.result_version, BUILDER_TASK_CAPSULE_STORE_READ_RESULT_VERSION);
  assert.equal(read.status, 'ready');
  assert.deepEqual(read.task_capsule_update.task_capsule_update, record);
  assert.equal(Object.isFrozen(read.task_capsule_update.task_capsule_update), true);

  store.close();

  const restarted = createBuilderTaskCapsuleStore(databasePath);
  const restored = restarted.read_latest_task_capsule({ project_id: PROJECT_ID });
  assert.equal(restored.status, 'ready');
  assert.deepEqual(restored.task_capsule_update.task_capsule_update, record);
  restarted.close();
});

test('reads latest project capsule and ordered task capsule history', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderTaskCapsuleStore(databasePath);
  const first = update(1);
  const second = update(2, {
    task_capsule: {
      task_id: TASK_ID,
      updated_at_ms: 2_500,
      last_route_decision_id: id('route-decision', 2),
    },
  });
  store.record_task_capsule_update({ task_capsule_update: second });
  store.record_task_capsule_update({ task_capsule_update: first });

  const latest = store.read_latest_task_capsule({ project_id: PROJECT_ID });
  assert.equal(latest.status, 'ready');
  assert.equal(latest.task_capsule_update.task_capsule_update.update_id, second.update_id);

  const list = store.list_task_capsule_updates({ project_id: PROJECT_ID, task_id: TASK_ID });
  assert.equal(list.status, 'ready');
  assert.deepEqual(
    list.task_capsule_updates.map((entry) => entry.task_capsule_update.update_id),
    [first.update_id, second.update_id],
  );
  assert.equal(list.truncated, false);

  assert.equal(
    store.read_task_capsule_update({
      project_id: OTHER_PROJECT_ID,
      update_id: first.update_id,
    }).status,
    'absent',
  );
  assert.equal(store.read_latest_task_capsule({ project_id: OTHER_PROJECT_ID }).status, 'absent');
  assert.equal(
    store.list_task_capsule_updates({
      project_id: PROJECT_ID,
      task_id: id('task', 99),
    }).status,
    'absent',
  );
  store.close();
});

test('rejects conflicting replay, malformed input, accessors, proxies, and tampered rows', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderTaskCapsuleStore(databasePath);
  const record = update(1);
  store.record_task_capsule_update({ task_capsule_update: record });

  const conflicting = update(2, {
    message_id: record.message_id,
    task_capsule: {
      task_id: id('task', 2),
      last_route_decision_id: id('route-decision', 2),
    },
  });
  assertStoreError(
    () => store.record_task_capsule_update({ task_capsule_update: conflicting }),
    'builder_task_capsule_store_conflict',
  );
  assertStoreError(() => store.record_task_capsule_update({ task_capsule_update: record, extra: true }));
  assertStoreError(() => store.read_task_capsule_update({
    project_id: PROJECT_ID,
    update_id: record.update_id,
    extra: true,
  }));
  assertStoreError(() => store.read_latest_task_capsule({ project_id: PROJECT_ID, extra: true }));
  assertStoreError(() => store.list_task_capsule_updates({
    project_id: PROJECT_ID,
    task_id: TASK_ID,
    extra: true,
  }));

  let getterCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'task_capsule_update', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('private marker');
    },
  });
  assertStoreError(() => store.record_task_capsule_update(accessor));
  assert.equal(getterCalls, 0);

  let proxyTrapInvoked = false;
  const proxyTrap = () => {
    proxyTrapInvoked = true;
    throw new Error('private proxy marker');
  };
  assertStoreError(() => store.record_task_capsule_update(new Proxy(
    { task_capsule_update: record },
    {
      getOwnPropertyDescriptor: proxyTrap,
      getPrototypeOf: proxyTrap,
      ownKeys: proxyTrap,
    },
  )));
  assert.equal(proxyTrapInvoked, false);
  store.close();

  const raw = new DatabaseSync(databasePath);
  raw.prepare('UPDATE task_capsule_updates SET task_id = ? WHERE update_id = ?')
    .run(id('task', 77), record.update_id);
  raw.close();

  const reopened = createBuilderTaskCapsuleStore(databasePath);
  assertStoreError(
    () => reopened.read_task_capsule_update({ project_id: PROJECT_ID, update_id: record.update_id }),
    'builder_task_capsule_store_integrity_failed',
  );
  reopened.close();
});

test('rejects schema drift and unsafe database paths', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderTaskCapsuleStore(databasePath);
  store.close();

  assertStoreError(
    () => createBuilderTaskCapsuleStore(path.join('relative', 'store.sqlite')),
    'builder_task_capsule_store_invalid',
  );
  assertStoreError(
    () => createBuilderTaskCapsuleStore(
      path.join(os.tmpdir(), 'missing-parent-for-task-capsule-store', 'store.sqlite'),
    ),
    'builder_task_capsule_store_unavailable',
  );

  const raw = new DatabaseSync(databasePath);
  raw.exec('CREATE TABLE unexpected_task_capsule_fact(id TEXT) STRICT');
  raw.close();
  assertStoreError(
    () => createBuilderTaskCapsuleStore(databasePath),
    'builder_task_capsule_store_integrity_failed',
  );
});

test('source boundary remains a main-only Task Capsule store without execution or renderer authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-task-capsule-store.cjs'),
    'utf8',
  );
  assert.match(source, /main_owned_task_capsule_store/u);
  assert.match(source, /main_task_capsule_contract_v1/u);
  assert.match(source, /record_task_capsule_update/u);
  assert.match(source, /read_latest_task_capsule/u);
  assert.match(source, /list_task_capsule_updates/u);
  assert.match(source, /node:sqlite/u);
  assert.match(source, /conversation_append: false/u);
  assert.match(source, /provider_dispatch: false/u);
  assert.match(source, /source_write: 'not_present'/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:http|node:https|http|https)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|dugite|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|spawn\s*\(|writeFile|rmSync|shell:\s*true|localStorage|sessionStorage|indexedDB|better-sqlite|eval\s*\(|new Function|provider_secret|credential_secret|source_tree|commit_oid|tree_oid|stdout|stderr/iu,
  );
  assert.equal(BUILDER_TASK_CAPSULE_UPDATE_VERSION, 'builder-task-capsule-update.v1');
});
