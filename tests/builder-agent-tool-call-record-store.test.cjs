'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');

const {
  BUILDER_PERMISSION_DECISION_VERSION,
  BUILDER_PERMISSION_POLICY_VERSION,
} = require('../electron/builder-permission-authority-contract.cjs');
const {
  createBuilderToolPermissionAdmission,
} = require('../electron/builder-tool-permission-admission.cjs');
const {
  DEFAULT_BUILDER_TOOL_SESSION_LIMITS,
  createBuilderToolSessionPolicy,
} = require('../electron/builder-tool-session-policy.cjs');
const {
  createBuilderToolCallRecord,
} = require('../electron/builder-tool-call-records.cjs');
const {
  BUILDER_AGENT_TOOL_CALL_RECORD_STORE_READ_RESULT_VERSION,
  BUILDER_AGENT_TOOL_CALL_RECORD_STORE_RESULT_VERSION,
  BUILDER_AGENT_TOOL_CALL_RECORD_STORE_SCHEMA_VERSION,
  BUILDER_AGENT_TOOL_CALL_RECORD_STORE_USER_VERSION,
  BUILDER_AGENT_TOOL_CALL_RECORD_STORE_VERSION,
  BuilderAgentToolCallRecordStoreError,
  createBuilderAgentToolCallRecordStore,
} = require('../electron/builder-agent-tool-call-record-store.cjs');

const OWNER_ID = 'builder-user:11111111-1111-4111-8111-111111111111';
const OTHER_OWNER_ID = 'builder-user:12111111-1111-4111-8111-111111111111';
const AGENT_ID = 'builder-agent:22222222-2222-4222-8222-222222222222';
const PROJECT_UUID = '33333333-3333-4333-8333-333333333333';
const PROJECT_ID = `builder-project:${PROJECT_UUID}`;
const CONVERSATION_ID = `builder-conversation:${PROJECT_UUID}`;
const TURN_ID = 'builder-turn:77777777-7777-4777-8777-777777777777';
const TASK_ID = 'builder-task:55555555-5555-4555-8555-555555555555';
const RUN_ID = 'builder-run:66666666-6666-4666-8666-666666666666';
const PERMISSION_ID = `builder-permission:${'d'.repeat(64)}`;

function temporaryDatabase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-agent-tool-call-records-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  return path.join(root, 'store.sqlite');
}

function toolCallId(index) {
  return `builder-tool-call:123e4567-e89b-42d3-a456-${index.toString(16).padStart(12, '0')}`;
}

function admissionId(index) {
  return `builder-agent-supervised-action-admission:${index.toString(16).padStart(64, '0')}`;
}

function stepId(index) {
  return `builder-run-step:123e4567-e89b-42d3-a456-${index.toString(16).padStart(12, '0')}`;
}

async function permissionAdmission(index, overrides = {}) {
  const actorId = overrides.actor_id ?? AGENT_ID;
  const evaluatedAtMs = overrides.evaluated_at_ms ?? 50 + index;
  const guard = createBuilderToolPermissionAdmission({
    actor_id: actorId,
    now_ms: () => evaluatedAtMs,
    evaluate_permission: async (body) => ({
      decision_version: BUILDER_PERMISSION_DECISION_VERSION,
      policy_version: BUILDER_PERMISSION_POLICY_VERSION,
      actor_id: actorId,
      action: body.action,
      resource: body.resource,
      evaluated_at_ms: body.now_ms,
      decision: 'allowed',
      reason: 'matching_active_grant',
      permission_id: PERMISSION_ID,
      permission_authority: 'builder_permission_facts_deny_by_default_v1',
      ui_selection_authority: 'not_permission',
      ...(overrides.decision ?? {}),
    }),
  });
  return guard.admit({
    tool_call_id: toolCallId(index),
    tool_name: 'filesystem.read',
    project_id: PROJECT_ID,
    action: 'filesystem.read',
    resource: {
      resource_kind: 'filesystem',
      project_id: PROJECT_ID,
      resource_id: `project:/src/file-${index}.tsx`,
    },
  });
}

function sessionPolicy(index, overrides = {}) {
  return createBuilderToolSessionPolicy({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    issued_at_ms: 49 + index,
    limits: { ...DEFAULT_BUILDER_TOOL_SESSION_LIMITS },
    ...overrides,
  });
}

async function fixture(index = 1, overrides = {}) {
  const admission = await permissionAdmission(index, overrides.permission_admission ?? {});
  const record = createBuilderToolCallRecord({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    step_id: overrides.step_id ?? stepId(index),
    session_policy: sessionPolicy(index, overrides.session_policy ?? {}),
    admission,
    requested_at_ms: overrides.requested_at_ms ?? 51 + index,
  });
  return {
    admission_id: overrides.admission_id ?? admissionId(index),
    record,
  };
}

function recordRequest(entry, overrides = {}) {
  return {
    owner_id: overrides.owner_id ?? OWNER_ID,
    supervised_action_admission_id: overrides.supervised_action_admission_id ?? entry.admission_id,
    tool_call_record: entry.record,
  };
}

function readToolCallRequest(entry, overrides = {}) {
  return {
    tool_call_id: entry.record.tool_call_id,
    owner_id: OWNER_ID,
    ...overrides,
  };
}

function admissionReadRequest(entry, overrides = {}) {
  return {
    supervised_action_admission_id: entry.admission_id,
    owner_id: OWNER_ID,
    ...overrides,
  };
}

function taskListRequest(overrides = {}) {
  return {
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    task_id: TASK_ID,
    ...overrides,
  };
}

function runListRequest(overrides = {}) {
  return {
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    ...overrides,
  };
}

function assertStoreError(fn, expectedCode = 'builder_agent_tool_call_record_store_invalid') {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderAgentToolCallRecordStoreError);
      assert.equal(error.code, expectedCode);
      assert.doesNotMatch(
        `${error.name}\n${error.message}\n${error.stack}`,
        /secret-value|api\.deepseek|private marker|raw prompt|source text|file content|patch body|credential|stdout|stderr|project:\/src\/file/iu,
      );
      return true;
    },
  );
}

test('records Agent tool call records then restores them after restart', async (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentToolCallRecordStore(databasePath);
  const entry = await fixture(1);
  const recorded = store.record_tool_call(recordRequest(entry));

  assert.equal(store.store_version, BUILDER_AGENT_TOOL_CALL_RECORD_STORE_VERSION);
  assert.equal(recorded.result_version, BUILDER_AGENT_TOOL_CALL_RECORD_STORE_RESULT_VERSION);
  assert.equal(recorded.operation, 'agent_tool_call_record_recorded');
  assert.deepEqual(recorded.agent_tool_call_record.tool_call_record, entry.record);
  assert.equal(recorded.agent_tool_call_record.owner_id, OWNER_ID);
  assert.equal(recorded.agent_tool_call_record.supervised_action_admission_id, entry.admission_id);
  assert.equal(recorded.tool_call_record_evidence.tool_call_record_authority, 'main_owned_agent_tool_call_record_store');
  assert.equal(
    recorded.tool_call_record_evidence.tool_call_record_contract_authority,
    'main_tool_call_record_contract_v1',
  );
  assert.equal(recorded.tool_call_record_evidence.renderer_authority, 'not_present');
  assert.equal(recorded.tool_call_record_evidence.ipc_authority, 'not_present');
  assert.equal(recorded.tool_call_record_evidence.provider_dispatch, false);
  assert.equal(recorded.tool_call_record_evidence.model_dispatch, false);
  assert.equal(recorded.tool_call_record_evidence.tool_dispatch, false);
  assert.equal(recorded.tool_call_record_evidence.execution_authority, false);
  assert.equal(recorded.tool_call_record_evidence.permission_grant_authority, false);
  assert.equal(recorded.tool_call_record_evidence.credential_storage, 'not_present');
  assert.equal(recorded.tool_call_record_evidence.source_access, 'not_present');
  assert.equal(recorded.tool_call_record_evidence.source_read, 'not_present');
  assert.equal(recorded.tool_call_record_evidence.source_write, 'not_present');
  assert.equal(recorded.tool_call_record_evidence.raw_output_storage, 'not_present');
  assert.equal(recorded.tool_call_record_evidence.process_run, false);
  assert.equal(recorded.tool_call_record_evidence.network_access, false);
  assert.equal(recorded.tool_call_record_evidence.revision_authority, false);
  assert.equal(recorded.tool_call_record_evidence.review_authority, false);
  assert.equal(recorded.tool_call_record_evidence.artifact_authority, false);
  assert.equal(recorded.tool_call_record_evidence.recovery_model, 'idempotent_store_replay');
  assert.equal(recorded.tool_call_record_evidence.schema_version, BUILDER_AGENT_TOOL_CALL_RECORD_STORE_SCHEMA_VERSION);
  assert.equal(recorded.tool_call_record_evidence.user_version, BUILDER_AGENT_TOOL_CALL_RECORD_STORE_USER_VERSION);
  assert.match(recorded.tool_call_record_evidence.schema_fingerprint_digest, /^sha256:[0-9a-f]{64}$/u);

  assert.equal(
    store.record_tool_call(recordRequest(entry)).operation,
    'agent_tool_call_record_replayed',
  );

  const read = store.read_tool_call(readToolCallRequest(entry));
  assert.equal(read.result_version, BUILDER_AGENT_TOOL_CALL_RECORD_STORE_READ_RESULT_VERSION);
  assert.equal(read.status, 'ready');
  assert.deepEqual(read.agent_tool_call_record.tool_call_record, entry.record);
  assert.equal(Object.isFrozen(read.agent_tool_call_record.tool_call_record), true);

  const byAdmission = store.read_tool_call_for_admission(admissionReadRequest(entry));
  assert.equal(byAdmission.status, 'ready');
  assert.deepEqual(byAdmission.agent_tool_call_record.tool_call_record, entry.record);

  const taskList = store.list_task_tool_calls(taskListRequest());
  assert.equal(taskList.status, 'ready');
  assert.equal(taskList.agent_tool_call_records.length, 1);
  assert.deepEqual(taskList.agent_tool_call_records[0].tool_call_record, entry.record);

  const runList = store.list_run_tool_calls(runListRequest());
  assert.equal(runList.status, 'ready');
  assert.equal(runList.agent_tool_call_records.length, 1);
  assert.deepEqual(runList.agent_tool_call_records[0].tool_call_record, entry.record);
  store.close();

  const restarted = createBuilderAgentToolCallRecordStore(databasePath);
  const restored = restarted.read_tool_call(readToolCallRequest(entry));
  assert.equal(restored.status, 'ready');
  assert.deepEqual(restored.agent_tool_call_record.tool_call_record, entry.record);
  restarted.close();
});

test('records multiple tool calls while enforcing owner scope and one record per admission', async (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentToolCallRecordStore(databasePath);
  const first = await fixture(1);
  const second = await fixture(2);
  store.record_tool_call(recordRequest(first));
  store.record_tool_call(recordRequest(second));

  const taskList = store.list_task_tool_calls(taskListRequest());
  assert.equal(taskList.agent_tool_call_records.length, 2);
  assert.deepEqual(
    taskList.agent_tool_call_records.map((entry) => entry.tool_call_record.tool_call_id),
    [first.record.tool_call_id, second.record.tool_call_id],
  );
  assert.equal(
    store.read_tool_call(readToolCallRequest(first, { owner_id: OTHER_OWNER_ID })).status,
    'absent',
  );
  assert.equal(
    store.read_tool_call_for_admission(
      admissionReadRequest(first, { owner_id: OTHER_OWNER_ID }),
    ).status,
    'absent',
  );
  assert.equal(
    store.list_task_tool_calls(taskListRequest({ owner_id: OTHER_OWNER_ID })).status,
    'absent',
  );
  assert.equal(
    store.list_run_tool_calls(runListRequest({ owner_id: OTHER_OWNER_ID })).status,
    'absent',
  );

  const conflicting = await fixture(99);
  assertStoreError(
    () => store.record_tool_call(recordRequest(conflicting, {
      supervised_action_admission_id: first.admission_id,
    })),
    'builder_agent_tool_call_record_store_conflict',
  );
  store.close();
});

test('rejects hostile input, malformed reads, and tampered rows', async (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentToolCallRecordStore(databasePath);
  const entry = await fixture(1);

  assertStoreError(() => store.record_tool_call({ ...recordRequest(entry), raw_prompt: 'secret-value' }));
  assertStoreError(() => store.read_tool_call({ ...readToolCallRequest(entry), extra: true }));
  assertStoreError(() => store.read_tool_call_for_admission({ ...admissionReadRequest(entry), extra: true }));
  assertStoreError(() => store.list_task_tool_calls({ ...taskListRequest(), extra: true }));
  assertStoreError(() => store.list_run_tool_calls({ ...runListRequest(), extra: true }));

  let getterCalls = 0;
  const accessor = {
    owner_id: OWNER_ID,
    supervised_action_admission_id: entry.admission_id,
  };
  Object.defineProperty(accessor, 'tool_call_record', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('private marker');
    },
  });
  assertStoreError(() => store.record_tool_call(accessor));
  assert.equal(getterCalls, 0);

  let proxyTrapInvoked = false;
  const proxyTrap = () => {
    proxyTrapInvoked = true;
    throw new Error('private proxy marker');
  };
  assertStoreError(() => store.record_tool_call(new Proxy(
    recordRequest(entry),
    {
      getOwnPropertyDescriptor: proxyTrap,
      getPrototypeOf: proxyTrap,
      ownKeys: proxyTrap,
    },
  )));
  assert.equal(proxyTrapInvoked, false);

  store.record_tool_call(recordRequest(entry));
  store.close();

  const raw = new DatabaseSync(databasePath);
  raw.prepare(
    `UPDATE agent_tool_call_records
      SET owner_id = ?
      WHERE tool_call_id = ?`,
  ).run(OTHER_OWNER_ID, entry.record.tool_call_id);
  raw.close();

  const reopened = createBuilderAgentToolCallRecordStore(databasePath);
  assertStoreError(
    () => reopened.read_tool_call(readToolCallRequest(entry)),
    'builder_agent_tool_call_record_store_integrity_failed',
  );
  reopened.close();
});

test('rejects schema drift and unsafe database paths', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentToolCallRecordStore(databasePath);
  store.close();

  assertStoreError(
    () => createBuilderAgentToolCallRecordStore(path.join('relative', 'store.sqlite')),
    'builder_agent_tool_call_record_store_invalid',
  );
  assertStoreError(
    () => createBuilderAgentToolCallRecordStore(
      path.join(os.tmpdir(), 'missing-parent-for-tool-call-record-store', 'store.sqlite'),
    ),
    'builder_agent_tool_call_record_store_unavailable',
  );

  const raw = new DatabaseSync(databasePath);
  raw.exec('CREATE TABLE unexpected_agent_tool_call_record_fact(id TEXT) STRICT');
  raw.close();
  assertStoreError(
    () => createBuilderAgentToolCallRecordStore(databasePath),
    'builder_agent_tool_call_record_store_integrity_failed',
  );
});

test('source boundary remains a main-only Agent tool call record store without execution authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-tool-call-record-store.cjs'),
    'utf8',
  );

  assert.match(source, /main_owned_agent_tool_call_record_store/u);
  assert.match(source, /main_tool_call_record_contract_v1/u);
  assert.match(source, /record_tool_call/u);
  assert.match(source, /read_tool_call_for_admission/u);
  assert.match(source, /list_task_tool_calls/u);
  assert.match(source, /list_run_tool_calls/u);
  assert.match(source, /node:sqlite/u);
  assert.match(source, /tool_dispatch: false/u);
  assert.match(source, /execution_authority: false/u);
  assert.match(source, /source_access: 'not_present'/u);
  assert.match(source, /raw_output_storage: 'not_present'/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:http|node:https|http|https|node:child_process|child_process)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|dugite|fetch\s*\(|https?:|Authorization|Bearer|execFile|spawn\s*\(|writeFile|rmSync|shell:\s*true|localStorage|sessionStorage|indexedDB|better-sqlite|eval\s*\(|new Function|record_grant|record_revocation|provider_secret|credential_secret|file_content|source_tree|commit_oid|tree_oid|stdout|stderr/iu,
  );
});
