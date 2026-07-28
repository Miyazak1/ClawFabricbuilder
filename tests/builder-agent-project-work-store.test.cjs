'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');

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
  BUILDER_AGENT_PROJECT_WORK_RESULT_RECORD_KIND,
  BUILDER_AGENT_PROJECT_WORK_RESULT_RECORD_VERSION,
  createBuilderAgentProjectWorkResultRecord,
} = require('../electron/builder-agent-project-work-contract.cjs');
const {
  BUILDER_AGENT_PROJECT_WORK_STORE_READ_RESULT_VERSION,
  BUILDER_AGENT_PROJECT_WORK_STORE_RESULT_VERSION,
  BUILDER_AGENT_PROJECT_WORK_STORE_SCHEMA_VERSION,
  BUILDER_AGENT_PROJECT_WORK_STORE_USER_VERSION,
  BUILDER_AGENT_PROJECT_WORK_STORE_VERSION,
  BuilderAgentProjectWorkStoreError,
  createBuilderAgentProjectWorkStore,
} = require('../electron/builder-agent-project-work-store.cjs');

const OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174000';
const OTHER_OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174001';
const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174004';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174005';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174006';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174007';
const OTHER_RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174008';
const SUPERVISOR_ID = 'builder-supervisor:123e4567-e89b-42d3-a456-426614174009';

function temporaryDatabase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-agent-project-work-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'agent-project-work.sqlite');
}

function definitionInput(overrides = {}) {
  return {
    record_version: BUILDER_AGENT_DEFINITION_RECORD_VERSION,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    display_name: 'Builder Assistant',
    purpose: 'Help the owner plan and review local Builder work.',
    created_at_ms: 10,
    ...overrides,
  };
}

function versionInput(overrides = {}) {
  return {
    record_version: BUILDER_AGENT_VERSION_RECORD_VERSION,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    version_number: 1,
    instructions: 'Ask before changing files. Summarize proposed work before review.',
    created_at_ms: 20,
    permission_boundary: 'explicit_permission_required',
    ...overrides,
  };
}

function assignmentInput(agentVersion, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_ASSIGNMENT_RECORD_VERSION,
    agent_id: AGENT_ID,
    agent_version_id: agentVersion.agent_version_id,
    owner_id: OWNER_ID,
    assigned_by: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    goal: 'Review the current Builder task and propose the next small change.',
    created_at_ms: 30,
    permission_boundary: 'explicit_permission_required',
    supervision_policy: 'owner_supervised',
    result_contract: 'review_required_before_materialization',
    budget: {
      max_steps: 12,
      max_tool_calls: 4,
      max_runtime_ms: 120_000,
      max_private_source_bytes: 32_768,
    },
    ...overrides,
  };
}

function statusInput(assignmentRecord, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_ASSIGNMENT_STATUS_RECORD_VERSION,
    assignment_id: assignmentRecord.assignment_id,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    decided_by: OWNER_ID,
    next_status: 'active',
    reason: 'Owner started supervised work.',
    decided_at_ms: 40,
    ...overrides,
  };
}

function leaseInput(assignmentRecord, activeStatus, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_SUPERVISION_LEASE_RECORD_VERSION,
    assignment_id: assignmentRecord.assignment_id,
    assignment_status_id: activeStatus.assignment_status_id,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: assignmentRecord.run_id,
    lease_holder_id: SUPERVISOR_ID,
    lease_epoch: 1,
    acquired_at_ms: 50,
    expires_at_ms: 120,
    purpose: 'Supervise one active local assignment attempt.',
    redispatch_policy: 'lease_required_no_duplicate_dispatch',
    supervision_state: 'active_assignment_only',
    authority_boundary: 'main_supervision_lease_only',
    ...overrides,
  };
}

function fixture(overrides = {}) {
  const agentDefinition = createBuilderAgentDefinitionRecord(definitionInput());
  const agentVersion = createBuilderAgentVersionRecord(versionInput(), agentDefinition);
  const assignmentRecord = createBuilderAgentAssignmentRecord(
    assignmentInput(agentVersion, overrides.assignment ?? {}),
    agentVersion,
    agentDefinition,
  );
  const activeStatus = createBuilderAgentAssignmentStatusRecord(
    statusInput(assignmentRecord, overrides.status ?? {}),
    assignmentRecord,
  );
  const leaseRecord = createBuilderAgentSupervisionLeaseRecord(
    leaseInput(assignmentRecord, activeStatus, overrides.lease ?? {}),
    assignmentRecord,
    activeStatus,
  );
  return { activeStatus, agentDefinition, agentVersion, assignmentRecord, leaseRecord };
}

function resultInput(assignmentRecord, activeStatus, leaseRecord, overrides = {}) {
  const workKind = overrides.work_kind ?? 'project_edit';
  const result = overrides.result ?? {
    status: 'proposed',
    summary_code: workKind === 'project_edit'
      ? 'project_edit_candidate_ready_for_review'
      : 'project_check_plan_ready_for_review',
  };
  return {
    record_version: BUILDER_AGENT_PROJECT_WORK_RESULT_RECORD_VERSION,
    record_kind: BUILDER_AGENT_PROJECT_WORK_RESULT_RECORD_KIND,
    assignment_id: assignmentRecord.assignment_id,
    assignment_status_id: activeStatus.assignment_status_id,
    lease_id: leaseRecord.lease_id,
    agent_id: AGENT_ID,
    agent_version_id: assignmentRecord.agent_version_id,
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: assignmentRecord.run_id,
    lease_holder_id: SUPERVISOR_ID,
    work_kind: workKind,
    observed_at_ms: 90,
    result,
    review_contract: 'owner_review_required_before_materialization',
    materialization_boundary: 'no_source_mutation_no_check_run',
    ...overrides,
  };
}

function workResult(assignmentRecord, activeStatus, leaseRecord, overrides = {}) {
  return createBuilderAgentProjectWorkResultRecord(
    resultInput(assignmentRecord, activeStatus, leaseRecord, overrides),
    assignmentRecord,
    activeStatus,
    leaseRecord,
  );
}

function recordRequest(assignmentRecord, activeStatus, leaseRecord, resultRecord) {
  return {
    assignment: assignmentRecord,
    status: activeStatus,
    lease: leaseRecord,
    result: resultRecord,
  };
}

function assertStoreError(fn, code = null) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderAgentProjectWorkStoreError);
      if (code !== null) assert.equal(error.code, code);
      const text = `${error.name}:${error.message}:${error.stack}`;
      assert.doesNotMatch(text, /private|credential|api\.deepseek|secret-value|source text|raw result|patch body/iu);
      return true;
    },
  );
}

test('records project work results then restores them after restart', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentProjectWorkStore(databasePath);
  const { activeStatus, assignmentRecord, leaseRecord } = fixture();
  const resultRecord = workResult(assignmentRecord, activeStatus, leaseRecord);

  assert.equal(store.store_version, BUILDER_AGENT_PROJECT_WORK_STORE_VERSION);
  const recorded = store.record_result(recordRequest(assignmentRecord, activeStatus, leaseRecord, resultRecord));
  assert.equal(recorded.result_version, BUILDER_AGENT_PROJECT_WORK_STORE_RESULT_VERSION);
  assert.equal(recorded.operation, 'work_result_recorded');
  assert.deepEqual(recorded.work_result.result, resultRecord);
  assert.deepEqual(recorded.work_result.assignment, assignmentRecord);
  assert.deepEqual(recorded.work_result.status, activeStatus);
  assert.deepEqual(recorded.work_result.lease, leaseRecord);
  assert.equal(recorded.work_result_evidence.work_result_authority, 'main_owned_agent_project_work_store');
  assert.equal(recorded.work_result_evidence.renderer_authority, 'not_present');
  assert.equal(recorded.work_result_evidence.ipc_authority, 'not_present');
  assert.equal(recorded.work_result_evidence.model_dispatch, false);
  assert.equal(recorded.work_result_evidence.tool_dispatch, false);
  assert.equal(recorded.work_result_evidence.permission_grant_authority, false);
  assert.equal(recorded.work_result_evidence.credential_storage, 'not_present');
  assert.equal(recorded.work_result_evidence.source_read, 'not_present');
  assert.equal(recorded.work_result_evidence.source_write, 'not_present');
  assert.equal(recorded.work_result_evidence.process_run, false);
  assert.equal(recorded.work_result_evidence.revision_authority, false);
  assert.equal(recorded.work_result_evidence.review_authority, false);
  assert.equal(recorded.work_result_evidence.schema_version, BUILDER_AGENT_PROJECT_WORK_STORE_SCHEMA_VERSION);
  assert.equal(recorded.work_result_evidence.user_version, BUILDER_AGENT_PROJECT_WORK_STORE_USER_VERSION);
  assert.match(recorded.work_result_evidence.schema_fingerprint_digest, /^[a-f0-9]{64}$/u);

  assert.equal(
    store.record_result(recordRequest(assignmentRecord, activeStatus, leaseRecord, resultRecord)).operation,
    'work_result_replayed',
  );

  const read = store.read_result({ work_result_id: resultRecord.work_result_id, owner_id: OWNER_ID });
  assert.equal(read.result_version, BUILDER_AGENT_PROJECT_WORK_STORE_READ_RESULT_VERSION);
  assert.equal(read.status, 'ready');
  assert.deepEqual(read.work_result.result, resultRecord);
  assert.equal(Object.isFrozen(read), true);
  assert.equal(Object.isFrozen(read.work_result), true);

  const listed = store.list_task_results({ owner_id: OWNER_ID, project_id: PROJECT_ID, task_id: TASK_ID });
  assert.equal(listed.status, 'ready');
  assert.equal(listed.work_results.length, 1);
  assert.deepEqual(listed.work_results[0].result, resultRecord);
  store.close();

  const restarted = createBuilderAgentProjectWorkStore(databasePath);
  const restored = restarted.read_result({ work_result_id: resultRecord.work_result_id, owner_id: OWNER_ID });
  assert.equal(restored.status, 'ready');
  assert.deepEqual(restored.work_result.result, resultRecord);
  assert.deepEqual(restored.work_result.lease, leaseRecord);
  restarted.close();
});

test('records both edit and test work kinds while enforcing owner scope and one result per lease', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentProjectWorkStore(databasePath);
  const first = fixture();
  const edit = workResult(first.assignmentRecord, first.activeStatus, first.leaseRecord);
  store.record_result(recordRequest(first.assignmentRecord, first.activeStatus, first.leaseRecord, edit));

  const second = fixture({
    assignment: { run_id: OTHER_RUN_ID, created_at_ms: 31 },
    status: { decided_at_ms: 41 },
    lease: {
      lease_epoch: 1,
      acquired_at_ms: 60,
      expires_at_ms: 130,
    },
  });
  const check = workResult(second.assignmentRecord, second.activeStatus, second.leaseRecord, {
    work_kind: 'project_test',
    observed_at_ms: 100,
  });
  assert.equal(
    store.record_result(recordRequest(second.assignmentRecord, second.activeStatus, second.leaseRecord, check))
      .operation,
    'work_result_recorded',
  );

  const listed = store.list_task_results({ owner_id: OWNER_ID, project_id: PROJECT_ID, task_id: TASK_ID });
  assert.equal(listed.work_results.length, 2);
  assert.deepEqual(listed.work_results.map((entry) => entry.result.work_kind), ['project_edit', 'project_test']);
  assert.equal(
    store.read_result({ work_result_id: edit.work_result_id, owner_id: OTHER_OWNER_ID }).status,
    'absent',
  );
  assert.equal(
    store.list_task_results({ owner_id: OTHER_OWNER_ID, project_id: PROJECT_ID, task_id: TASK_ID }).status,
    'absent',
  );

  const sameLeaseOtherResult = workResult(first.assignmentRecord, first.activeStatus, first.leaseRecord, {
    observed_at_ms: 91,
    result: {
      status: 'blocked',
      summary_code: 'project_edit_needs_owner_attention',
    },
  });
  assertStoreError(
    () => store.record_result(recordRequest(
      first.assignmentRecord,
      first.activeStatus,
      first.leaseRecord,
      sameLeaseOtherResult,
    )),
    'builder_agent_project_work_store_conflict',
  );
  store.close();
});

test('rejects hostile input, inactive assignment status, malformed reads, and tampered rows', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentProjectWorkStore(databasePath);
  const { activeStatus, assignmentRecord, leaseRecord } = fixture();
  const resultRecord = workResult(assignmentRecord, activeStatus, leaseRecord);

  assertStoreError(() => store.record_result({
    ...recordRequest(assignmentRecord, activeStatus, leaseRecord, resultRecord),
    extra: true,
  }));
  assertStoreError(() => store.read_result({
    work_result_id: resultRecord.work_result_id,
    owner_id: OWNER_ID,
    extra: true,
  }));
  assertStoreError(() => store.list_task_results({
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    task_id: TASK_ID,
    extra: true,
  }));

  let getterCalls = 0;
  const accessor = recordRequest(assignmentRecord, activeStatus, leaseRecord, resultRecord);
  Object.defineProperty(accessor, 'result', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('private credential getter');
    },
  });
  assertStoreError(() => store.record_result(accessor));
  assert.equal(getterCalls, 0);

  let proxyTrapInvoked = false;
  const proxyTrap = () => {
    proxyTrapInvoked = true;
    throw new Error('private proxy marker');
  };
  assertStoreError(() => store.record_result(new Proxy(
    recordRequest(assignmentRecord, activeStatus, leaseRecord, resultRecord),
    {
      getOwnPropertyDescriptor: proxyTrap,
      getPrototypeOf: proxyTrap,
      ownKeys: proxyTrap,
    },
  )));
  assert.equal(proxyTrapInvoked, false);

  const pausedStatus = createBuilderAgentAssignmentStatusRecord({
    ...statusInput(assignmentRecord),
    next_status: 'paused',
    reason: 'Owner paused this assignment.',
    decided_at_ms: 42,
  }, assignmentRecord);
  assertStoreError(
    () => store.record_result(recordRequest(assignmentRecord, pausedStatus, leaseRecord, resultRecord)),
    'builder_agent_project_work_store_invalid',
  );

  store.record_result(recordRequest(assignmentRecord, activeStatus, leaseRecord, resultRecord));
  store.close();

  const raw = new DatabaseSync(databasePath);
  raw.prepare('UPDATE agent_project_work_results SET result_status = ? WHERE work_result_id = ?')
    .run('failed', resultRecord.work_result_id);
  raw.close();

  const corrupted = createBuilderAgentProjectWorkStore(databasePath);
  assertStoreError(
    () => corrupted.read_result({ work_result_id: resultRecord.work_result_id, owner_id: OWNER_ID }),
    'builder_agent_project_work_store_integrity_failed',
  );
  corrupted.close();
});

test('rejects schema drift and unsafe database paths', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentProjectWorkStore(databasePath);
  store.close();

  const raw = new DatabaseSync(databasePath);
  raw.exec('CREATE TABLE unexpected_project_work_fact (id TEXT PRIMARY KEY) STRICT');
  raw.close();

  assertStoreError(
    () => createBuilderAgentProjectWorkStore(databasePath),
    'builder_agent_project_work_store_integrity_failed',
  );
  assertStoreError(
    () => createBuilderAgentProjectWorkStore(path.join('relative', 'agent-project-work.sqlite')),
    'builder_agent_project_work_store_invalid',
  );

  const notDatabasePath = path.join(path.dirname(databasePath), 'not-a-database.sqlite');
  fs.writeFileSync(notDatabasePath, 'not sqlite private credential marker');
  assertStoreError(
    () => createBuilderAgentProjectWorkStore(notDatabasePath),
    'builder_agent_project_work_store_unavailable',
  );
});

test('source boundary remains a main-only Agent project work store without runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-project-work-store.cjs'),
    'utf8',
  );
  assert.match(source, /main_owned_agent_project_work_store/u);
  assert.match(source, /record_result/u);
  assert.match(source, /read_result/u);
  assert.match(source, /list_task_results/u);
  assert.match(source, /node:sqlite/u);
  assert.match(source, /utilTypes\.isProxy/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:http|node:https|http|https)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|dugite|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|shell:\s*true|localStorage|sessionStorage|indexedDB|better-sqlite|eval\s*\(|new Function/iu,
  );
});
