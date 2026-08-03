'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');

const {
  BUILDER_AGENT_DEFINITION_RECORD_VERSION,
  BUILDER_AGENT_VERSION_RECORD_VERSION,
  createBuilderAgentDefinitionRecord,
  createBuilderAgentVersionRecord,
} = require('../electron/builder-agent-definition-contract.cjs');
const {
  BUILDER_AGENT_ASSIGNMENT_RECORD_VERSION,
  BUILDER_AGENT_ASSIGNMENT_STATUS_RECORD_VERSION,
  createBuilderAgentAssignmentRecord,
  createBuilderAgentAssignmentStatusRecord,
} = require('../electron/builder-agent-assignment-contract.cjs');
const {
  BUILDER_AGENT_SUPERVISION_LEASE_RECORD_VERSION,
  createBuilderAgentSupervisionLeaseRecord,
} = require('../electron/builder-agent-supervision-lease-contract.cjs');
const {
  BUILDER_AGENT_BUDGET_AUDIT_RECORD_KIND,
  BUILDER_AGENT_BUDGET_AUDIT_RECORD_VERSION,
  createBuilderAgentBudgetAuditRecord,
} = require('../electron/builder-agent-budget-audit-contract.cjs');
const {
  createBuilderAgentTaskContextSnapshot,
} = require('../electron/builder-agent-task-context-snapshot.cjs');
const {
  createBuilderAgentSupervisedActionAdmission,
} = require('../electron/builder-agent-supervised-action-admission.cjs');
const {
  createBuilderAgentPrivateSourceContextRecord,
} = require('../electron/builder-agent-private-source-context-record.cjs');
const {
  BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_STORE_READ_RESULT_VERSION,
  BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_STORE_RESULT_VERSION,
  BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_STORE_SCHEMA_VERSION,
  BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_STORE_USER_VERSION,
  BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_STORE_VERSION,
  BuilderAgentPrivateSourceContextRecordStoreError,
  createBuilderAgentPrivateSourceContextRecordStore,
} = require('../electron/builder-agent-private-source-context-record-store.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');

const OWNER_ID = 'builder-user:11111111-1111-4111-8111-111111111111';
const OTHER_OWNER_ID = 'builder-user:12111111-1111-4111-8111-111111111111';
const AGENT_ID = 'builder-agent:22222222-2222-4222-8222-222222222222';
const PROJECT_UUID = '33333333-3333-4333-8333-333333333333';
const PROJECT_ID = `builder-project:${PROJECT_UUID}`;
const CONVERSATION_ID = `builder-conversation:${PROJECT_UUID}`;
const TASK_ID = 'builder-task:55555555-5555-4555-8555-555555555555';
const RUN_ID = 'builder-run:66666666-6666-4666-8666-666666666666';
const SUPERVISOR_ID = 'builder-supervisor:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MESSAGE_ID = 'builder-message:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MEMORY_ID = `builder-agent-memory:${'a'.repeat(64)}`;
const ARTIFACT_ID = `builder-artifact:${'b'.repeat(64)}`;
const RUN_EVENT_ID = `builder-run-event:${'c'.repeat(64)}`;
const PERMISSION_REF_ID = `builder-permission:${'d'.repeat(64)}`;
const REQUEST_DIGEST = `sha256:${'1'.repeat(64)}`;
const SOURCE_CONTEXT_AUTHORITY = Object.freeze({
  collector_authority: 'main_tool_source_context_collector_v1',
  permission_authority: 'main_permission_decision_before_tool_dispatch_v1',
  policy_authority: 'main_tool_session_policy_contract_v1',
  conversation_authority: 'trusted_conversation_main_service_methods',
  execution_authority: 'main_tool_filesystem_read_execution_service_v1',
  renderer_authority: 'not_present',
  provider_dispatch: false,
  credential_readback: false,
  raw_output_storage: 'not_durable',
  conversation_event: 'tool_request_and_fixed_result_only',
  git_authority: 'not_present',
  revision_admission: 'not_created',
});

function temporaryDatabase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-agent-source-context-records-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  return path.join(root, 'store.sqlite');
}

function id(kind, index) {
  return `builder-${kind}:123e4567-e89b-42d3-a456-${index.toString(16).padStart(12, '0')}`;
}

function actionRequestId(index = 1) {
  return `builder-agent-action-request:123e4567-e89b-42d3-a456-${index.toString(16).padStart(12, '0')}`;
}

function commandIds(index = 1, overrides = {}) {
  return {
    turn_command_id: id('command', 1 + index),
    run_command_id: id('command', 10 + index),
    terminal_command_id: id('command', 20 + index),
    turn_terminal_command_id: id('command', 30 + index),
    cancel_command_id: id('command', 40 + index),
    cancel_request_id: id('cancel-request', 50 + index),
    interrupt_command_id: id('command', 60 + index),
    interrupt_request_id: id('interrupt-request', 70 + index),
    message_id: id('message', 80 + index),
    assistant_message_id: id('message', 90 + index),
    turn_id: id('turn', 100 + index),
    task_id: TASK_ID,
    run_id: RUN_ID,
    ...overrides,
  };
}

function admissionFixture(action = 'read_private_source', index = 1) {
  const definition = createBuilderAgentDefinitionRecord({
    record_version: BUILDER_AGENT_DEFINITION_RECORD_VERSION,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    display_name: 'Builder Agent',
    purpose: 'Persist digest-only private source context receipts.',
    created_at_ms: 1,
  });
  const version = createBuilderAgentVersionRecord({
    record_version: BUILDER_AGENT_VERSION_RECORD_VERSION,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    version_number: 1,
    instructions: 'Use private source context through store-backed digest receipts.',
    created_at_ms: 2,
    permission_boundary: 'explicit_permission_required',
  }, definition);
  const assignment = createBuilderAgentAssignmentRecord({
    record_version: BUILDER_AGENT_ASSIGNMENT_RECORD_VERSION,
    agent_id: AGENT_ID,
    agent_version_id: version.agent_version_id,
    owner_id: OWNER_ID,
    assigned_by: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    goal: 'Persist private source context as digest evidence.',
    created_at_ms: 3,
    permission_boundary: 'explicit_permission_required',
    supervision_policy: 'owner_supervised',
    result_contract: 'review_required_before_materialization',
    budget: {
      max_steps: 12,
      max_tool_calls: 4,
      max_runtime_ms: 120_000,
      max_private_source_bytes: 32_768,
    },
  }, version, definition);
  const activeStatus = createBuilderAgentAssignmentStatusRecord({
    record_version: BUILDER_AGENT_ASSIGNMENT_STATUS_RECORD_VERSION,
    assignment_id: assignment.assignment_id,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    decided_by: OWNER_ID,
    next_status: 'active',
    reason: 'Owner started supervised work.',
    decided_at_ms: 4,
  }, assignment);
  const lease = createBuilderAgentSupervisionLeaseRecord({
    record_version: BUILDER_AGENT_SUPERVISION_LEASE_RECORD_VERSION,
    assignment_id: assignment.assignment_id,
    assignment_status_id: activeStatus.assignment_status_id,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    lease_holder_id: SUPERVISOR_ID,
    lease_epoch: 1,
    acquired_at_ms: 20,
    expires_at_ms: 620,
    purpose: 'Supervise one private source context record.',
    redispatch_policy: 'lease_required_no_duplicate_dispatch',
    supervision_state: 'active_assignment_only',
    authority_boundary: 'main_supervision_lease_only',
  }, assignment, activeStatus);
  const budgetAudit = createBuilderAgentBudgetAuditRecord({
    record_version: BUILDER_AGENT_BUDGET_AUDIT_RECORD_VERSION,
    record_kind: BUILDER_AGENT_BUDGET_AUDIT_RECORD_KIND,
    assignment_id: assignment.assignment_id,
    assignment_status_id: activeStatus.assignment_status_id,
    lease_id: lease.lease_id,
    agent_id: AGENT_ID,
    agent_version_id: assignment.agent_version_id,
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    lease_holder_id: SUPERVISOR_ID,
    observed_at_ms: 30 + index,
    requested_next_action: action,
    budget_limits: assignment.budget,
    budget_usage: {
      step_count: index,
      tool_call_count: 0,
      runtime_ms: 100 + index,
      private_source_bytes: 0,
    },
    outcome: {
      decision: 'allowed',
      reason: 'none',
    },
    audit_contract: 'assignment_budget_checked_before_agent_work',
  }, assignment, activeStatus, lease);
  const snapshot = createBuilderAgentTaskContextSnapshot({
    agent_definition: definition,
    agent_version: version,
    assignment,
    active_status: activeStatus,
    lease,
    budget_audit: budgetAudit,
    included_memory_ids: [MEMORY_ID],
    included_message_ids: [MESSAGE_ID],
    included_artifact_ids: [ARTIFACT_ID],
    included_run_event_ids: [RUN_EVENT_ID],
    included_permission_ids: [PERMISSION_REF_ID],
    parent_task_context_projection: null,
    base_project_revision: {
      status: 'available',
      revision_receipt_digest: `sha256:${'f'.repeat(64)}`,
      commit_oid: '1'.repeat(40),
    },
    token_budget: {
      max_input_tokens: 32_000,
      reserved_output_tokens: 4_096,
      selection_policy: 'deterministic_task_local_budget_v1',
    },
    created_at_ms: 40 + index,
  });
  return createBuilderAgentSupervisedActionAdmission({
    context_snapshot: snapshot,
    action_request_id: actionRequestId(index),
    requested_next_action: action,
    run_status: 'running',
    interrupt_requested: false,
    cancel_requested: false,
    admitted_at_ms: snapshot.created_at_ms + 2,
  });
}

function context(index = 1, overrides = {}) {
  return {
    context_version: 'builder-conversation-run-context.v1',
    mode: 'work',
    project: {
      project_id: PROJECT_ID,
      created_at_ms: 10,
    },
    conversation: {
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      created_at_ms: 11,
    },
    request_digest: REQUEST_DIGEST,
    start_head: {
      sequence: 6 + index,
      event_id: `builder-conversation-event:${index.toString(16).padStart(64, 'a')}`,
      event_digest: `sha256:${index.toString(16).padStart(64, 'b')}`,
    },
    attempt_number: 1,
    events: [],
    run_terminal_failure_code: null,
    ids: commandIds(index),
    cancel_requested: false,
    ...overrides,
  };
}

function privateFiles(rawFiles) {
  const sourceTree = createBuilderProjectSourceTree({
    files: rawFiles.map((file) => ({ path: file.path, content: file.content })),
  });
  return sourceTree.files.map((file) => ({
    path: file.path,
    entry_kind: file.entry_kind,
    content: file.content,
    content_digest: file.content_digest,
    content_bytes: Buffer.byteLength(file.content, 'utf8'),
  }));
}

function sourceContextResult(index = 1, rawFiles = [
  { path: 'src/app.tsx', content: `export const answer = ${index};\n` },
], overrides = {}) {
  const files = privateFiles(rawFiles);
  return {
    result_version: 'builder-tool-source-context-result.v1',
    operation: 'project_source_context_collected',
    status: 'succeeded',
    context: context(index, overrides.context),
    private_source_context: {
      context_version: 'builder-private-source-context.v1',
      files,
      ...(overrides.private_source_context ?? {}),
    },
    reads: files.map((file, readIndex) => ({
      resource_id: `project:/${file.path}`,
      status: 'succeeded',
      tool_call_id: id('tool-call', index * 10 + readIndex),
    })),
    authority: {
      ...SOURCE_CONTEXT_AUTHORITY,
      ...(overrides.authority ?? {}),
    },
    ...overrides.result,
  };
}

function fixture(index = 1, overrides = {}) {
  const admission = admissionFixture(overrides.admission_action ?? 'read_private_source', index);
  const record = createBuilderAgentPrivateSourceContextRecord({
    supervised_action_admission: admission,
    source_context_result: sourceContextResult(
      index,
      overrides.raw_files,
      overrides.source_context_result ?? {},
    ),
  });
  return { admission, record };
}

function recordRequest(record) {
  return { private_source_context_record: record };
}

function readRecordRequest(record, overrides = {}) {
  return {
    record_digest: record.record_digest,
    owner_id: OWNER_ID,
    ...overrides,
  };
}

function admissionReadRequest(record, overrides = {}) {
  return {
    supervised_action_admission_id: record.supervised_action_admission_id,
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

function assertStoreError(fn, expectedCode = 'builder_agent_private_source_context_record_store_invalid') {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderAgentPrivateSourceContextRecordStoreError);
      assert.equal(error.code, expectedCode);
      const text = `${error.name}:${error.message}:${error.stack}`;
      assert.doesNotMatch(
        text,
        /secret-value|api\.deepseek|private marker|raw prompt|source text|file content|patch body|credential|stdout|stderr|project:\/|src\/app|export const/iu,
      );
      return true;
    },
  );
}

test('records private source context records then restores them after restart', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentPrivateSourceContextRecordStore(databasePath);
  const { record } = fixture(1);
  const recorded = store.record_private_source_context(recordRequest(record));

  assert.equal(store.store_version, BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_STORE_VERSION);
  assert.equal(recorded.result_version, BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_STORE_RESULT_VERSION);
  assert.equal(recorded.operation, 'agent_private_source_context_record_recorded');
  assert.deepEqual(recorded.agent_private_source_context_record.private_source_context_record, record);
  assert.equal(
    recorded.private_source_context_record_evidence.private_source_context_record_authority,
    'main_owned_agent_private_source_context_record_store',
  );
  assert.equal(
    recorded.private_source_context_record_evidence.private_source_context_record_contract_authority,
    'main_agent_private_source_context_record_contract_v1',
  );
  assert.equal(recorded.private_source_context_record_evidence.renderer_authority, 'not_present');
  assert.equal(recorded.private_source_context_record_evidence.ipc_authority, 'not_present');
  assert.equal(recorded.private_source_context_record_evidence.provider_dispatch, false);
  assert.equal(recorded.private_source_context_record_evidence.model_dispatch, false);
  assert.equal(recorded.private_source_context_record_evidence.tool_dispatch, false);
  assert.equal(recorded.private_source_context_record_evidence.execution_authority, false);
  assert.equal(recorded.private_source_context_record_evidence.permission_grant_authority, false);
  assert.equal(recorded.private_source_context_record_evidence.credential_storage, 'not_present');
  assert.equal(
    recorded.private_source_context_record_evidence.source_access,
    'digest_only_private_source_context_receipt',
  );
  assert.equal(recorded.private_source_context_record_evidence.source_read, 'not_performed_by_store');
  assert.equal(recorded.private_source_context_record_evidence.source_write, 'not_present');
  assert.equal(recorded.private_source_context_record_evidence.raw_source_storage, 'not_present');
  assert.equal(recorded.private_source_context_record_evidence.process_run, false);
  assert.equal(recorded.private_source_context_record_evidence.network_access, false);
  assert.equal(recorded.private_source_context_record_evidence.revision_authority, false);
  assert.equal(recorded.private_source_context_record_evidence.review_authority, false);
  assert.equal(recorded.private_source_context_record_evidence.artifact_authority, false);
  assert.equal(recorded.private_source_context_record_evidence.recovery_model, 'idempotent_store_replay');
  assert.equal(
    recorded.private_source_context_record_evidence.schema_version,
    BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_STORE_SCHEMA_VERSION,
  );
  assert.equal(
    recorded.private_source_context_record_evidence.user_version,
    BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_STORE_USER_VERSION,
  );
  assert.match(
    recorded.private_source_context_record_evidence.schema_fingerprint_digest,
    /^sha256:[0-9a-f]{64}$/u,
  );
  assert.doesNotMatch(
    JSON.stringify(recorded),
    /src\/app|export const|"private_source_context"|"resource_id"|provider_secret|credential_secret|commit_oid|tree_oid/iu,
  );

  assert.equal(
    store.record_private_source_context(recordRequest(record)).operation,
    'agent_private_source_context_record_replayed',
  );

  const read = store.read_private_source_context(readRecordRequest(record));
  assert.equal(read.result_version, BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_STORE_READ_RESULT_VERSION);
  assert.equal(read.status, 'ready');
  assert.deepEqual(read.agent_private_source_context_record.private_source_context_record, record);
  assert.equal(Object.isFrozen(read.agent_private_source_context_record.private_source_context_record), true);

  const byAdmission = store.read_private_source_context_for_admission(admissionReadRequest(record));
  assert.equal(byAdmission.status, 'ready');
  assert.deepEqual(byAdmission.agent_private_source_context_record.private_source_context_record, record);

  const taskList = store.list_task_private_source_contexts(taskListRequest());
  assert.equal(taskList.status, 'ready');
  assert.equal(taskList.agent_private_source_context_records.length, 1);
  assert.deepEqual(taskList.agent_private_source_context_records[0].private_source_context_record, record);

  const runList = store.list_run_private_source_contexts(runListRequest());
  assert.equal(runList.status, 'ready');
  assert.equal(runList.agent_private_source_context_records.length, 1);
  assert.deepEqual(runList.agent_private_source_context_records[0].private_source_context_record, record);
  store.close();

  const restarted = createBuilderAgentPrivateSourceContextRecordStore(databasePath);
  const restored = restarted.read_private_source_context(readRecordRequest(record));
  assert.equal(restored.status, 'ready');
  assert.deepEqual(restored.agent_private_source_context_record.private_source_context_record, record);
  restarted.close();
});

test('records multiple source context records while enforcing owner scope and one record per admission', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentPrivateSourceContextRecordStore(databasePath);
  const first = fixture(1);
  const second = fixture(2);
  store.record_private_source_context(recordRequest(first.record));
  store.record_private_source_context(recordRequest(second.record));

  const taskList = store.list_task_private_source_contexts(taskListRequest());
  assert.equal(taskList.agent_private_source_context_records.length, 2);
  assert.deepEqual(
    taskList.agent_private_source_context_records.map(
      (entry) => entry.private_source_context_record.context_binding.head_sequence,
    ),
    [7, 8],
  );
  assert.equal(
    store.read_private_source_context(readRecordRequest(first.record, { owner_id: OTHER_OWNER_ID })).status,
    'absent',
  );
  assert.equal(
    store.read_private_source_context_for_admission(
      admissionReadRequest(first.record, { owner_id: OTHER_OWNER_ID }),
    ).status,
    'absent',
  );
  assert.equal(
    store.list_task_private_source_contexts(taskListRequest({ owner_id: OTHER_OWNER_ID })).status,
    'absent',
  );
  assert.equal(
    store.list_run_private_source_contexts(runListRequest({ owner_id: OTHER_OWNER_ID })).status,
    'absent',
  );

  const conflicting = createBuilderAgentPrivateSourceContextRecord({
    supervised_action_admission: first.admission,
    source_context_result: sourceContextResult(99, [
      { path: 'src/app.tsx', content: 'export const changed = true;\n' },
    ]),
  });
  assertStoreError(
    () => store.record_private_source_context(recordRequest(conflicting)),
    'builder_agent_private_source_context_record_store_conflict',
  );
  store.close();
});

test('rejects hostile input, malformed reads, and tampered rows', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentPrivateSourceContextRecordStore(databasePath);
  const { record } = fixture(1);

  assertStoreError(() => store.record_private_source_context({ ...recordRequest(record), raw_prompt: 'secret-value' }));
  assertStoreError(() => store.read_private_source_context({ ...readRecordRequest(record), extra: true }));
  assertStoreError(() => store.read_private_source_context_for_admission({ ...admissionReadRequest(record), extra: true }));
  assertStoreError(() => store.list_task_private_source_contexts({ ...taskListRequest(), extra: true }));
  assertStoreError(() => store.list_run_private_source_contexts({ ...runListRequest(), extra: true }));

  let getterCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'private_source_context_record', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('private marker');
    },
  });
  assertStoreError(() => store.record_private_source_context(accessor));
  assert.equal(getterCalls, 0);

  let proxyTrapInvoked = false;
  const proxyTrap = () => {
    proxyTrapInvoked = true;
    throw new Error('private proxy marker');
  };
  assertStoreError(() => store.record_private_source_context(new Proxy(
    recordRequest(record),
    {
      getOwnPropertyDescriptor: proxyTrap,
      getPrototypeOf: proxyTrap,
      ownKeys: proxyTrap,
    },
  )));
  assert.equal(proxyTrapInvoked, false);

  store.record_private_source_context(recordRequest(record));
  store.close();

  const raw = new DatabaseSync(databasePath);
  raw.prepare(
    `UPDATE agent_private_source_context_records
      SET owner_id = ?
      WHERE record_digest = ?`,
  ).run(OTHER_OWNER_ID, record.record_digest);
  raw.close();

  const reopened = createBuilderAgentPrivateSourceContextRecordStore(databasePath);
  assertStoreError(
    () => reopened.read_private_source_context(readRecordRequest(record)),
    'builder_agent_private_source_context_record_store_integrity_failed',
  );
  reopened.close();
});

test('rejects schema drift and unsafe database paths', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentPrivateSourceContextRecordStore(databasePath);
  store.close();

  assertStoreError(
    () => createBuilderAgentPrivateSourceContextRecordStore(path.join('relative', 'store.sqlite')),
    'builder_agent_private_source_context_record_store_invalid',
  );
  assertStoreError(
    () => createBuilderAgentPrivateSourceContextRecordStore(
      path.join(os.tmpdir(), 'missing-parent-for-private-source-context-record-store', 'store.sqlite'),
    ),
    'builder_agent_private_source_context_record_store_unavailable',
  );

  const raw = new DatabaseSync(databasePath);
  raw.exec('CREATE TABLE unexpected_private_source_context_record_fact(id TEXT) STRICT');
  raw.close();
  assertStoreError(
    () => createBuilderAgentPrivateSourceContextRecordStore(databasePath),
    'builder_agent_private_source_context_record_store_integrity_failed',
  );
});

test('source boundary remains a main-only Agent private source context record store without execution authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-private-source-context-record-store.cjs'),
    'utf8',
  );

  assert.match(source, /main_owned_agent_private_source_context_record_store/u);
  assert.match(source, /main_agent_private_source_context_record_contract_v1/u);
  assert.match(source, /record_private_source_context/u);
  assert.match(source, /read_private_source_context_for_admission/u);
  assert.match(source, /list_task_private_source_contexts/u);
  assert.match(source, /list_run_private_source_contexts/u);
  assert.match(source, /node:sqlite/u);
  assert.match(source, /source_access: 'digest_only_private_source_context_receipt'/u);
  assert.match(source, /source_read: 'not_performed_by_store'/u);
  assert.match(source, /raw_source_storage: 'not_present'/u);
  assert.match(source, /tool_dispatch: false/u);
  assert.match(source, /execution_authority: false/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:http|node:https|http|https|node:child_process|child_process)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|dugite|fetch\s*\(|https?:|Authorization|Bearer|execFile|spawn\s*\(|writeFile|rmSync|shell:\s*true|localStorage|sessionStorage|indexedDB|better-sqlite|eval\s*\(|new Function|record_grant|record_revocation|provider_secret|credential_secret|file_content|source_tree|commit_oid|tree_oid|stdout|stderr/iu,
  );
});
