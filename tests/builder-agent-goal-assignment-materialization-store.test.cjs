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
  BUILDER_AGENT_ASSIGNMENT_STATUS_RECORD_VERSION,
  createBuilderAgentAssignmentRecord,
  createBuilderAgentAssignmentStatusRecord,
} = require('../electron/builder-agent-assignment-contract.cjs');
const {
  BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_RECORD_VERSION,
  createBuilderAgentGoalAssignmentAdmissionRecord,
} = require('../electron/builder-agent-goal-assignment-admission.cjs');
const {
  createBuilderAgentAssignmentStore,
} = require('../electron/builder-agent-assignment-store.cjs');
const {
  createBuilderAgentGoalAssignmentAdmissionStore,
} = require('../electron/builder-agent-goal-assignment-admission-store.cjs');
const {
  BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_RECORD_KIND,
  BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_RECORD_VERSION,
  createBuilderAgentGoalAssignmentMaterializationRecord,
} = require('../electron/builder-agent-goal-assignment-materialization.cjs');
const {
  BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_STORE_READ_RESULT_VERSION,
  BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_STORE_RESULT_VERSION,
  BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_STORE_SCHEMA_VERSION,
  BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_STORE_USER_VERSION,
  BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_STORE_VERSION,
  BuilderAgentGoalAssignmentMaterializationStoreError,
  createBuilderAgentGoalAssignmentMaterializationStore,
} = require('../electron/builder-agent-goal-assignment-materialization-store.cjs');

const OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174000';
const OTHER_OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174001';
const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174004';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174005';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174006';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174007';
const OTHER_RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174008';

function temporaryDatabase(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'store.sqlite');
}

function temporaryStoreRoot(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    databasePath: path.join(root, 'store.sqlite'),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
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

function baseRecords() {
  const agentDefinition = createBuilderAgentDefinitionRecord(definitionInput());
  const agentVersion = createBuilderAgentVersionRecord(versionInput(), agentDefinition);
  const goalRecord = createBuilderAgentGoalRecord({
    record_version: BUILDER_AGENT_GOAL_RECORD_VERSION,
    agent_id: AGENT_ID,
    agent_version_id: agentVersion.agent_version_id,
    owner_id: OWNER_ID,
    created_by: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    objective: 'Review the current Builder task and propose the next small change.',
    created_at_ms: 30,
    permission_boundary: 'explicit_permission_required',
    supervision_policy: 'owner_supervised',
    execution_contract: 'continuous_until_done_or_blocked',
    completion_contract: 'owner_review_required_before_done',
    budget: {
      max_steps: 24,
      max_runs: 2,
      max_tool_calls: 8,
      max_runtime_ms: 300_000,
      max_private_source_bytes: 65_536,
    },
  }, agentVersion, agentDefinition);
  const goalStatus = createBuilderAgentGoalStatusRecord({
    record_version: BUILDER_AGENT_GOAL_STATUS_RECORD_VERSION,
    goal_id: goalRecord.goal_id,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    decided_by: OWNER_ID,
    next_status: 'active',
    reason: 'Owner started the continuous supervised goal.',
    decided_at_ms: 40,
  }, goalRecord);
  return { agentDefinition, agentVersion, goalRecord, goalStatus };
}

function admittedMaterialization(t, overrides = {}) {
  const base = baseRecords();
  const assignment = createBuilderAgentAssignmentRecord({
    record_version: BUILDER_AGENT_ASSIGNMENT_RECORD_VERSION,
    agent_id: AGENT_ID,
    agent_version_id: base.agentVersion.agent_version_id,
    owner_id: OWNER_ID,
    assigned_by: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: overrides.run_id ?? RUN_ID,
    goal: base.goalRecord.objective,
    created_at_ms: overrides.assignment_created_at_ms ?? 50,
    permission_boundary: 'explicit_permission_required',
    supervision_policy: 'owner_supervised',
    result_contract: 'review_required_before_materialization',
    budget: {
      max_steps: 12,
      max_tool_calls: 4,
      max_runtime_ms: 120_000,
      max_private_source_bytes: 32_768,
    },
  }, base.agentVersion, base.agentDefinition);
  const admission = createBuilderAgentGoalAssignmentAdmissionRecord({
    record_version: BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_RECORD_VERSION,
    goal_id: base.goalRecord.goal_id,
    goal_status_id: base.goalStatus.goal_status_id,
    assignment_id: assignment.assignment_id,
    agent_id: AGENT_ID,
    agent_version_id: assignment.agent_version_id,
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: assignment.run_id,
    admitted_by: OWNER_ID,
    admitted_at_ms: overrides.admitted_at_ms ?? 60,
    admission_contract: 'active_goal_to_owner_supervised_assignment',
    materialization_boundary: 'assignment_record_required_before_execution',
  }, base.goalRecord, base.goalStatus, assignment);
  const queuedStatus = createBuilderAgentAssignmentStatusRecord({
    record_version: BUILDER_AGENT_ASSIGNMENT_STATUS_RECORD_VERSION,
    assignment_id: assignment.assignment_id,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    decided_by: OWNER_ID,
    next_status: 'queued',
    reason: 'Owner queued this admitted Goal assignment.',
    decided_at_ms: overrides.queued_at_ms ?? 70,
  }, assignment);

  const admissionStorePath = temporaryDatabase(
    t,
    'clawfabric-builder-agent-goal-assignment-materialization-store-admissions-',
  );
  const assignmentStorePath = temporaryDatabase(
    t,
    'clawfabric-builder-agent-goal-assignment-materialization-store-assignments-',
  );
  const admissionStore = createBuilderAgentGoalAssignmentAdmissionStore(admissionStorePath);
  const assignmentStore = createBuilderAgentAssignmentStore(assignmentStorePath);
  admissionStore.record_admission({
    goal: base.goalRecord,
    goal_status: base.goalStatus,
    assignment,
    admission,
  });
  assignmentStore.record_assignment({
    definition: base.agentDefinition,
    version: base.agentVersion,
    assignment,
  });
  assignmentStore.record_status({ status: queuedStatus });
  const assignmentRead = assignmentStore.read_assignment({
    assignment_id: assignment.assignment_id,
    owner_id: OWNER_ID,
  });
  admissionStore.close();
  assignmentStore.close();

  const materialization = createBuilderAgentGoalAssignmentMaterializationRecord({
    record_version: BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_RECORD_VERSION,
    record_kind: BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_RECORD_KIND,
    admission_id: admission.admission_id,
    goal_id: admission.goal_id,
    goal_status_id: admission.goal_status_id,
    assignment_id: admission.assignment_id,
    assignment_status_id: queuedStatus.assignment_status_id,
    agent_id: AGENT_ID,
    agent_version_id: admission.agent_version_id,
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: assignment.run_id,
    materialized_by: OWNER_ID,
    materialized_at_ms: overrides.materialized_at_ms ?? 80,
    materialization_contract: 'admitted_goal_assignment_recorded_as_queued_assignment',
    execution_boundary: 'no_run_no_execution_no_source_materialization',
  }, base.goalRecord, base.goalStatus, admission, assignmentRead);

  return {
    ...base,
    admission,
    assignment,
    assignmentRead,
    materialization,
    queuedStatus,
  };
}

function recordRequest(records) {
  return {
    goal: records.goalRecord,
    goal_status: records.goalStatus,
    admission: records.admission,
    assignment_read: records.assignmentRead,
    materialization: records.materialization,
  };
}

function assertStoreError(fn, code = null) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderAgentGoalAssignmentMaterializationStoreError);
      if (code !== null) assert.equal(error.code, code);
      const text = `${error.name}:${error.message}:${error.stack}`;
      assert.doesNotMatch(text, /private|credential|api\.deepseek|secret-value|source text|raw assignment/iu);
      return true;
    },
  );
}

test('records Goal assignment materializations then restores them after restart', (t) => {
  const database = temporaryStoreRoot(
    t,
    'clawfabric-builder-agent-goal-assignment-materialization-store-',
  );
  const store = createBuilderAgentGoalAssignmentMaterializationStore(database.databasePath);
  t.after(() => database.cleanup());
  const records = admittedMaterialization(t);

  assert.equal(store.store_version, BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_STORE_VERSION);
  const result = store.record_materialization(recordRequest(records));
  assert.equal(result.result_version, BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_STORE_RESULT_VERSION);
  assert.equal(result.operation, 'materialization_recorded');
  assert.deepEqual(result.materialization, records.materialization);
  assert.equal(result.materialization_evidence.materialization_authority, 'main_owned_agent_goal_assignment_materialization_store');
  assert.equal(result.materialization_evidence.renderer_authority, 'not_present');
  assert.equal(result.materialization_evidence.ipc_authority, 'not_present');
  assert.equal(result.materialization_evidence.provider_dispatch, false);
  assert.equal(result.materialization_evidence.tool_dispatch, false);
  assert.equal(result.materialization_evidence.run_authority, false);
  assert.equal(result.materialization_evidence.permission_grant_authority, false);
  assert.equal(result.materialization_evidence.credential_storage, 'not_present');
  assert.equal(result.materialization_evidence.source_access, 'not_present');
  assert.equal(result.materialization_evidence.revision_authority, false);
  assert.equal(result.materialization_evidence.review_authority, false);
  assert.equal(result.materialization_evidence.artifact_authority, false);
  assert.equal(
    result.materialization_evidence.schema_version,
    BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_STORE_SCHEMA_VERSION,
  );
  assert.equal(
    result.materialization_evidence.user_version,
    BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_STORE_USER_VERSION,
  );
  assert.match(result.materialization_evidence.schema_fingerprint_digest, /^[a-f0-9]{64}$/u);
  assert.equal(
    store.record_materialization(recordRequest(records)).operation,
    'materialization_replayed',
  );

  const read = store.read_materialization({
    materialization_id: records.materialization.materialization_id,
    owner_id: OWNER_ID,
  });
  assert.equal(read.result_version, BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_STORE_READ_RESULT_VERSION);
  assert.equal(read.status, 'ready');
  assert.deepEqual(read.goal, records.goalRecord);
  assert.deepEqual(read.goal_status, records.goalStatus);
  assert.deepEqual(read.admission, records.admission);
  assert.deepEqual(read.assignment_read, records.assignmentRead);
  assert.deepEqual(read.materialization, records.materialization);
  assert.equal(Object.isFrozen(read), true);

  assert.deepEqual(
    store.read_materialization_by_assignment({
      assignment_id: records.assignment.assignment_id,
      owner_id: OWNER_ID,
    }).materialization,
    records.materialization,
  );
  assert.deepEqual(
    store.read_materialization_by_admission({
      admission_id: records.admission.admission_id,
      owner_id: OWNER_ID,
    }).materialization,
    records.materialization,
  );
  store.close();

  const restarted = createBuilderAgentGoalAssignmentMaterializationStore(database.databasePath);
  const restored = restarted.read_materialization({
    materialization_id: records.materialization.materialization_id,
    owner_id: OWNER_ID,
  });
  assert.equal(restored.status, 'ready');
  assert.deepEqual(restored.materialization, records.materialization);
  restarted.close();
});

test('enforces owner scope, one materialization per admission and assignment, and task listing', (t) => {
  const database = temporaryStoreRoot(
    t,
    'clawfabric-builder-agent-goal-assignment-materialization-store-',
  );
  const store = createBuilderAgentGoalAssignmentMaterializationStore(database.databasePath);
  t.after(() => {
    store.close();
    database.cleanup();
  });
  const first = admittedMaterialization(t);
  const second = admittedMaterialization(t, {
    admitted_at_ms: 90,
    assignment_created_at_ms: 85,
    materialized_at_ms: 110,
    queued_at_ms: 100,
    run_id: OTHER_RUN_ID,
  });
  store.record_materialization(recordRequest(first));

  assert.equal(
    store.read_materialization({
      materialization_id: first.materialization.materialization_id,
      owner_id: OTHER_OWNER_ID,
    }).status,
    'absent',
  );
  assert.equal(
    store.read_materialization_by_assignment({
      assignment_id: first.assignment.assignment_id,
      owner_id: OTHER_OWNER_ID,
    }).status,
    'absent',
  );
  assert.equal(
    store.read_materialization_by_admission({
      admission_id: first.admission.admission_id,
      owner_id: OTHER_OWNER_ID,
    }).status,
    'absent',
  );

  const conflicting = admittedMaterialization(t, { materialized_at_ms: 81 });
  assert.notEqual(conflicting.materialization.materialization_id, first.materialization.materialization_id);
  assertStoreError(
    () => store.record_materialization(recordRequest(conflicting)),
    'builder_agent_goal_assignment_materialization_store_conflict',
  );

  store.record_materialization(recordRequest(second));
  const listed = store.list_task_materializations({
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    task_id: TASK_ID,
  });
  assert.equal(listed.status, 'ready');
  assert.equal(listed.materializations.length, 2);
  assert.deepEqual(listed.materializations[0].materialization, first.materialization);
  assert.deepEqual(listed.materializations[1].materialization, second.materialization);
});

test('fails closed on malformed input, hostile accessors, proxies, and tampered rows', (t) => {
  const database = temporaryStoreRoot(
    t,
    'clawfabric-builder-agent-goal-assignment-materialization-store-',
  );
  const store = createBuilderAgentGoalAssignmentMaterializationStore(database.databasePath);
  const records = admittedMaterialization(t);

  assertStoreError(() => store.record_materialization({ ...recordRequest(records), extra: true }));
  assertStoreError(() => store.record_materialization(Object.defineProperty(
    { ...recordRequest(records) },
    'goal',
    { get: () => records.goalRecord, enumerable: true },
  )));
  assertStoreError(() => store.record_materialization(new Proxy(recordRequest(records), {})));
  store.record_materialization(recordRequest(records));
  store.close();

  const db = new DatabaseSync(database.databasePath);
  db.prepare(
    `UPDATE agent_goal_assignment_materializations
      SET materialization_json = ?
      WHERE materialization_id = ?`,
  ).run(
    JSON.stringify({ forged: true }),
    records.materialization.materialization_id,
  );
  db.close();

  const reopened = createBuilderAgentGoalAssignmentMaterializationStore(database.databasePath);
  assertStoreError(
    () => reopened.read_materialization({
      materialization_id: records.materialization.materialization_id,
      owner_id: OWNER_ID,
    }),
    'builder_agent_goal_assignment_materialization_store_integrity_failed',
  );
  reopened.close();
  database.cleanup();
});

test('rejects schema drift and unsafe database paths', (t) => {
  const database = temporaryStoreRoot(
    t,
    'clawfabric-builder-agent-goal-assignment-materialization-store-',
  );
  const store = createBuilderAgentGoalAssignmentMaterializationStore(database.databasePath);
  store.close();

  const db = new DatabaseSync(database.databasePath);
  db.exec('CREATE TABLE unexpected_shadow(id TEXT) STRICT');
  db.close();
  assertStoreError(
    () => createBuilderAgentGoalAssignmentMaterializationStore(database.databasePath),
    'builder_agent_goal_assignment_materialization_store_integrity_failed',
  );
  database.cleanup();

  assertStoreError(
    () => createBuilderAgentGoalAssignmentMaterializationStore('relative.sqlite'),
    'builder_agent_goal_assignment_materialization_store_invalid',
  );
  assertStoreError(
    () => createBuilderAgentGoalAssignmentMaterializationStore(
      path.join(os.tmpdir(), 'missing-parent-for-materialization-store', 'store.sqlite'),
    ),
    'builder_agent_goal_assignment_materialization_store_unavailable',
  );
});

test('source boundary remains a main-only materialization store without runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-goal-assignment-materialization-store.cjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /require\('electron'\)|ipcMain|BrowserWindow|preload|safeStorage|provider-config|provider-secret/iu);
  assert.doesNotMatch(source, /node:child_process|require\(['"]child_process['"]\)|spawn\(|execFile\(|writeFile|rmSync|readFileSync/iu);
  assert.match(source, /materialization_authority: 'main_owned_agent_goal_assignment_materialization_store'/u);
  assert.match(source, /provider_dispatch: false/u);
  assert.match(source, /tool_dispatch: false/u);
  assert.match(source, /run_authority: false/u);
  assert.match(source, /source_access: 'not_present'/u);
  assert.match(source, /revision_authority: false/u);
});
