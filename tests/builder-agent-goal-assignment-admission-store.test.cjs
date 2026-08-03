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
  BUILDER_AGENT_GOAL_RECORD_VERSION,
  BUILDER_AGENT_GOAL_STATUS_RECORD_VERSION,
  createBuilderAgentGoalRecord,
  createBuilderAgentGoalStatusRecord,
} = require('../electron/builder-agent-goal-contract.cjs');
const {
  BUILDER_AGENT_ASSIGNMENT_RECORD_VERSION,
  createBuilderAgentAssignmentRecord,
} = require('../electron/builder-agent-assignment-contract.cjs');
const {
  BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_RECORD_VERSION,
  createBuilderAgentGoalAssignmentAdmissionRecord,
} = require('../electron/builder-agent-goal-assignment-admission.cjs');
const {
  BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_STORE_READ_RESULT_VERSION,
  BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_STORE_RESULT_VERSION,
  BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_STORE_SCHEMA_VERSION,
  BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_STORE_USER_VERSION,
  BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_STORE_VERSION,
  BuilderAgentGoalAssignmentAdmissionStoreError,
  createBuilderAgentGoalAssignmentAdmissionStore,
} = require('../electron/builder-agent-goal-assignment-admission-store.cjs');

const OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174000';
const OTHER_OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174001';
const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174004';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174005';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174006';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174007';
const OTHER_RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174008';
const OTHER_PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174009';

function temporaryDatabase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-agent-goal-assignment-admissions-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'agent-goal-assignment-admissions.sqlite');
}

function definitionInput(overrides = {}) {
  return {
    record_version: BUILDER_AGENT_DEFINITION_RECORD_VERSION,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    display_name: 'Builder Assistant',
    purpose: 'Help the owner continue bounded local Builder work.',
    created_at_ms: 10,
    ...overrides,
  };
}

function definition(overrides = {}) {
  return createBuilderAgentDefinitionRecord(definitionInput(overrides));
}

function versionInput(overrides = {}) {
  return {
    record_version: BUILDER_AGENT_VERSION_RECORD_VERSION,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    version_number: 1,
    instructions: 'Ask before changing files. Keep working only inside approved bounds.',
    created_at_ms: 20,
    permission_boundary: 'explicit_permission_required',
    ...overrides,
  };
}

function version(definitionRecord, overrides = {}) {
  return createBuilderAgentVersionRecord(versionInput(overrides), definitionRecord);
}

function goalInput(agentVersionRecord, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_GOAL_RECORD_VERSION,
    agent_id: AGENT_ID,
    agent_version_id: agentVersionRecord.agent_version_id,
    owner_id: OWNER_ID,
    created_by: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    objective: 'Keep improving the Builder conversation workspace until the owner can review a working result.',
    created_at_ms: 30,
    permission_boundary: 'explicit_permission_required',
    supervision_policy: 'owner_supervised',
    execution_contract: 'continuous_until_done_or_blocked',
    completion_contract: 'owner_review_required_before_done',
    budget: {
      max_steps: 24,
      max_runs: 6,
      max_tool_calls: 12,
      max_runtime_ms: 300_000,
      max_private_source_bytes: 65_536,
    },
    ...overrides,
  };
}

function goal(agentDefinition, agentVersion, overrides = {}) {
  return createBuilderAgentGoalRecord(goalInput(agentVersion, overrides), agentVersion, agentDefinition);
}

function statusInput(goalRecord, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_GOAL_STATUS_RECORD_VERSION,
    goal_id: goalRecord.goal_id,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    decided_by: OWNER_ID,
    next_status: 'active',
    reason: 'Owner accepted the bounded goal.',
    decided_at_ms: 40,
    ...overrides,
  };
}

function status(goalRecord, overrides = {}) {
  return createBuilderAgentGoalStatusRecord(statusInput(goalRecord, overrides), goalRecord);
}

function assignmentInput(agentVersionRecord, objective, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_ASSIGNMENT_RECORD_VERSION,
    agent_id: AGENT_ID,
    agent_version_id: agentVersionRecord.agent_version_id,
    owner_id: OWNER_ID,
    assigned_by: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    goal: objective,
    created_at_ms: 50,
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

function assignment(agentDefinition, agentVersion, goalRecord, overrides = {}) {
  return createBuilderAgentAssignmentRecord(
    assignmentInput(agentVersion, goalRecord.objective, overrides),
    agentVersion,
    agentDefinition,
  );
}

function admissionInput(goalRecord, statusRecord, assignmentRecord, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_RECORD_VERSION,
    goal_id: goalRecord.goal_id,
    goal_status_id: statusRecord.goal_status_id,
    assignment_id: assignmentRecord.assignment_id,
    agent_id: goalRecord.agent_id,
    agent_version_id: goalRecord.agent_version_id,
    owner_id: goalRecord.owner_id,
    project_id: goalRecord.project_id,
    conversation_id: goalRecord.conversation_id,
    task_id: goalRecord.task_id,
    run_id: assignmentRecord.run_id,
    admitted_by: goalRecord.owner_id,
    admitted_at_ms: 60,
    admission_contract: 'active_goal_to_owner_supervised_assignment',
    materialization_boundary: 'assignment_record_required_before_execution',
    ...overrides,
  };
}

function admission(goalRecord, statusRecord, assignmentRecord, overrides = {}) {
  return createBuilderAgentGoalAssignmentAdmissionRecord(
    admissionInput(goalRecord, statusRecord, assignmentRecord, overrides),
    goalRecord,
    statusRecord,
    assignmentRecord,
  );
}

function fixture(overrides = {}) {
  const agentDefinition = definition();
  const agentVersion = version(agentDefinition);
  const goalRecord = goal(agentDefinition, agentVersion, overrides.goal ?? {});
  const activeStatus = status(goalRecord, overrides.status ?? {});
  const assignmentRecord = assignment(agentDefinition, agentVersion, goalRecord, overrides.assignment ?? {});
  const admissionRecord = admission(goalRecord, activeStatus, assignmentRecord, overrides.admission ?? {});
  return {
    activeStatus,
    admissionRecord,
    agentDefinition,
    agentVersion,
    assignmentRecord,
    goalRecord,
  };
}

function admissionRequest(records) {
  return {
    goal: records.goalRecord,
    goal_status: records.activeStatus,
    assignment: records.assignmentRecord,
    admission: records.admissionRecord,
  };
}

function readRequest(records, overrides = {}) {
  return {
    admission_id: records.admissionRecord.admission_id,
    owner_id: OWNER_ID,
    ...overrides,
  };
}

function readByAssignmentRequest(records, overrides = {}) {
  return {
    assignment_id: records.assignmentRecord.assignment_id,
    owner_id: OWNER_ID,
    ...overrides,
  };
}

function listRequest(overrides = {}) {
  return {
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    task_id: TASK_ID,
    ...overrides,
  };
}

function assertStoreError(fn, code = null) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderAgentGoalAssignmentAdmissionStoreError);
      if (code !== null) assert.equal(error.code, code);
      const text = `${error.name}:${error.message}:${error.stack}`;
      assert.doesNotMatch(text, /private|credential|api\.deepseek|secret-value|source text|raw admission/iu);
      return true;
    },
  );
}

test('records Goal assignment admissions then restores them after restart', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentGoalAssignmentAdmissionStore(databasePath);
  const records = fixture();

  assert.equal(store.store_version, BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_STORE_VERSION);
  const result = store.record_admission(admissionRequest(records));
  assert.equal(result.result_version, BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_STORE_RESULT_VERSION);
  assert.equal(result.operation, 'admission_recorded');
  assert.deepEqual(result.admission, records.admissionRecord);
  assert.equal(result.admission_evidence.admission_authority, 'main_owned_agent_goal_assignment_admission_store');
  assert.equal(result.admission_evidence.renderer_authority, 'not_present');
  assert.equal(result.admission_evidence.ipc_authority, 'not_present');
  assert.equal(result.admission_evidence.provider_dispatch, false);
  assert.equal(result.admission_evidence.tool_dispatch, false);
  assert.equal(result.admission_evidence.assignment_store_authority, false);
  assert.equal(result.admission_evidence.run_authority, false);
  assert.equal(result.admission_evidence.permission_grant_authority, false);
  assert.equal(result.admission_evidence.credential_storage, 'not_present');
  assert.equal(result.admission_evidence.source_access, 'not_present');
  assert.equal(result.admission_evidence.revision_authority, false);
  assert.equal(result.admission_evidence.review_authority, false);
  assert.equal(result.admission_evidence.artifact_authority, false);
  assert.equal(
    result.admission_evidence.schema_version,
    BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_STORE_SCHEMA_VERSION,
  );
  assert.equal(result.admission_evidence.user_version, BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_STORE_USER_VERSION);
  assert.match(result.admission_evidence.schema_fingerprint_digest, /^[a-f0-9]{64}$/u);

  assert.equal(store.record_admission(admissionRequest(records)).operation, 'admission_replayed');
  const read = store.read_admission(readRequest(records));
  assert.equal(read.result_version, BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_STORE_READ_RESULT_VERSION);
  assert.equal(read.status, 'ready');
  assert.deepEqual(read.goal, records.goalRecord);
  assert.deepEqual(read.goal_status, records.activeStatus);
  assert.deepEqual(read.assignment, records.assignmentRecord);
  assert.deepEqual(read.admission, records.admissionRecord);
  assert.equal(Object.isFrozen(read), true);

  const byAssignment = store.read_admission_by_assignment(readByAssignmentRequest(records));
  assert.equal(byAssignment.status, 'ready');
  assert.deepEqual(byAssignment.admission, records.admissionRecord);

  const listed = store.list_task_admissions(listRequest());
  assert.equal(listed.status, 'ready');
  assert.equal(listed.admissions.length, 1);
  assert.deepEqual(listed.admissions[0].admission, records.admissionRecord);
  store.close();

  const restarted = createBuilderAgentGoalAssignmentAdmissionStore(databasePath);
  const restored = restarted.read_admission(readRequest(records));
  assert.equal(restored.status, 'ready');
  assert.deepEqual(restored.goal, records.goalRecord);
  assert.deepEqual(restored.admission, records.admissionRecord);
  restarted.close();
});

test('enforces owner scope, one admission per assignment, and task listing', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentGoalAssignmentAdmissionStore(databasePath);
  const records = fixture();
  store.record_admission(admissionRequest(records));

  assertStoreError(
    () => store.record_admission(admissionRequest(fixture({
      admission: { admitted_at_ms: 61 },
    }))),
    'builder_agent_goal_assignment_admission_store_conflict',
  );

  const wrongOwner = store.read_admission(readRequest(records, { owner_id: OTHER_OWNER_ID }));
  assert.equal(wrongOwner.status, 'absent');
  assert.equal(wrongOwner.admission, null);

  const wrongOwnerAssignment = store.read_admission_by_assignment(
    readByAssignmentRequest(records, { owner_id: OTHER_OWNER_ID }),
  );
  assert.equal(wrongOwnerAssignment.status, 'absent');
  assert.equal(wrongOwnerAssignment.admission, null);

  const secondRecords = fixture({
    assignment: {
      run_id: OTHER_RUN_ID,
      created_at_ms: 70,
    },
    admission: {
      admitted_at_ms: 80,
    },
  });
  assert.equal(store.record_admission(admissionRequest(secondRecords)).operation, 'admission_recorded');
  const listed = store.list_task_admissions(listRequest());
  assert.equal(listed.admissions.length, 2);
  assert.deepEqual(listed.admissions.map((entry) => entry.admission.admission_id), [
    records.admissionRecord.admission_id,
    secondRecords.admissionRecord.admission_id,
  ]);
  store.close();
});

test('fails closed on malformed input, hostile accessors, proxies, and tampered rows', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentGoalAssignmentAdmissionStore(databasePath);
  const records = fixture();

  assertStoreError(() => store.record_admission({
    ...admissionRequest(records),
    extra: true,
  }));
  assertStoreError(() => store.read_admission({ ...readRequest(records), extra: true }));
  assertStoreError(() => store.read_admission_by_assignment({ ...readByAssignmentRequest(records), extra: true }));
  assertStoreError(() => store.list_task_admissions({ ...listRequest(), extra: true }));

  let getterCalls = 0;
  const accessor = admissionRequest(records);
  Object.defineProperty(accessor, 'admission', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('private credential getter');
    },
  });
  assertStoreError(() => store.record_admission(accessor));
  assert.equal(getterCalls, 0);

  let proxyTrapInvoked = false;
  const proxyTrap = () => {
    proxyTrapInvoked = true;
    throw new Error('private proxy marker');
  };
  assertStoreError(() => store.record_admission(new Proxy(
    admissionRequest(records),
    {
      getOwnPropertyDescriptor: proxyTrap,
      getPrototypeOf: proxyTrap,
      ownKeys: proxyTrap,
    },
  )));
  assert.equal(proxyTrapInvoked, false);

  store.record_admission(admissionRequest(records));
  store.close();

  const raw = new DatabaseSync(databasePath);
  raw.prepare('UPDATE agent_goal_assignment_admissions SET project_id = ? WHERE admission_id = ?')
    .run(OTHER_PROJECT_ID, records.admissionRecord.admission_id);
  raw.close();

  const corrupted = createBuilderAgentGoalAssignmentAdmissionStore(databasePath);
  assertStoreError(
    () => corrupted.read_admission(readRequest(records)),
    'builder_agent_goal_assignment_admission_store_integrity_failed',
  );
  corrupted.close();
});

test('rejects schema drift and unsafe database paths', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentGoalAssignmentAdmissionStore(databasePath);
  store.close();

  const raw = new DatabaseSync(databasePath);
  raw.exec('CREATE TABLE unexpected_goal_assignment_admission_fact (id TEXT PRIMARY KEY) STRICT');
  raw.close();

  assertStoreError(
    () => createBuilderAgentGoalAssignmentAdmissionStore(databasePath),
    'builder_agent_goal_assignment_admission_store_integrity_failed',
  );
  assertStoreError(
    () => createBuilderAgentGoalAssignmentAdmissionStore(path.join('relative', 'admission.sqlite')),
    'builder_agent_goal_assignment_admission_store_invalid',
  );

  const notDatabasePath = path.join(path.dirname(databasePath), 'not-a-database.sqlite');
  fs.writeFileSync(notDatabasePath, 'not sqlite private credential marker');
  assertStoreError(
    () => createBuilderAgentGoalAssignmentAdmissionStore(notDatabasePath),
    'builder_agent_goal_assignment_admission_store_unavailable',
  );
});

test('source boundary remains a main-only Goal assignment admission store without runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-goal-assignment-admission-store.cjs'),
    'utf8',
  );
  assert.match(source, /main_owned_agent_goal_assignment_admission_store/u);
  assert.match(source, /record_admission/u);
  assert.match(source, /read_admission/u);
  assert.match(source, /read_admission_by_assignment/u);
  assert.match(source, /list_task_admissions/u);
  assert.match(source, /node:sqlite/u);
  assert.match(source, /utilTypes\.isProxy/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:http|node:https|http|https|node:child_process|child_process)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|dugite|fetch\s*\(|https?:|Authorization|Bearer|execFile\s*\(|spawn\s*\(|shell:\s*true|localStorage|sessionStorage|indexedDB|better-sqlite|eval\s*\(|new Function/iu,
  );
});
