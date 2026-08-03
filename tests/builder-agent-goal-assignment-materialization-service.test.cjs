'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

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
  BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_RECORD_KIND,
  BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_RECORD_VERSION,
} = require('../electron/builder-agent-goal-assignment-materialization.cjs');
const {
  createBuilderAgentAssignmentStore,
} = require('../electron/builder-agent-assignment-store.cjs');
const {
  createBuilderAgentGoalAssignmentAdmissionStore,
} = require('../electron/builder-agent-goal-assignment-admission-store.cjs');
const {
  createBuilderAgentGoalAssignmentMaterializationStore,
} = require('../electron/builder-agent-goal-assignment-materialization-store.cjs');
const {
  BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_SERVICE_VERSION,
  BuilderAgentGoalAssignmentMaterializationServiceError,
  createBuilderAgentGoalAssignmentMaterializationService,
} = require('../electron/builder-agent-goal-assignment-materialization-service.cjs');

const OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174000';
const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174004';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174005';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174006';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174007';

function temporaryRoot(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return root;
}

function openStores(root) {
  return {
    admission_store: createBuilderAgentGoalAssignmentAdmissionStore(path.join(root, 'admissions.sqlite')),
    assignment_store: createBuilderAgentAssignmentStore(path.join(root, 'assignments.sqlite')),
    materialization_store: createBuilderAgentGoalAssignmentMaterializationStore(
      path.join(root, 'materializations.sqlite'),
    ),
  };
}

function closeStores(stores) {
  stores.admission_store.close();
  stores.assignment_store.close();
  stores.materialization_store.close();
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
  const definition = createBuilderAgentDefinitionRecord(definitionInput());
  const version = createBuilderAgentVersionRecord(versionInput(), definition);
  const goal = createBuilderAgentGoalRecord({
    record_version: BUILDER_AGENT_GOAL_RECORD_VERSION,
    agent_id: AGENT_ID,
    agent_version_id: version.agent_version_id,
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
  }, version, definition);
  const goalStatus = createBuilderAgentGoalStatusRecord({
    record_version: BUILDER_AGENT_GOAL_STATUS_RECORD_VERSION,
    goal_id: goal.goal_id,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    decided_by: OWNER_ID,
    next_status: 'active',
    reason: 'Owner started the continuous supervised goal.',
    decided_at_ms: 40,
  }, goal);
  return { definition, version, goal, goalStatus };
}

function request(overrides = {}) {
  const { definition, version, goal, goalStatus } = baseRecords();
  const assignmentInput = {
    record_version: BUILDER_AGENT_ASSIGNMENT_RECORD_VERSION,
    agent_id: AGENT_ID,
    agent_version_id: version.agent_version_id,
    owner_id: OWNER_ID,
    assigned_by: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    goal: goal.objective,
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
    ...(overrides.assignment_input ?? {}),
  };
  const assignment = createBuilderAgentAssignmentRecord(assignmentInput, version, definition);
  const admissionInput = {
    record_version: BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_RECORD_VERSION,
    goal_id: goal.goal_id,
    goal_status_id: goalStatus.goal_status_id,
    assignment_id: assignment.assignment_id,
    agent_id: AGENT_ID,
    agent_version_id: version.agent_version_id,
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: assignmentInput.run_id,
    admitted_by: OWNER_ID,
    admitted_at_ms: 60,
    admission_contract: 'active_goal_to_owner_supervised_assignment',
    materialization_boundary: 'assignment_record_required_before_execution',
    ...(overrides.admission_input ?? {}),
  };
  const admission = createBuilderAgentGoalAssignmentAdmissionRecord(
    admissionInput,
    goal,
    goalStatus,
    assignment,
  );
  const assignmentStatusInput = {
    record_version: BUILDER_AGENT_ASSIGNMENT_STATUS_RECORD_VERSION,
    assignment_id: assignment.assignment_id,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    decided_by: OWNER_ID,
    next_status: 'queued',
    reason: 'Owner queued this admitted Goal assignment.',
    decided_at_ms: 70,
    ...(overrides.assignment_status_input ?? {}),
  };
  const assignmentStatus = createBuilderAgentAssignmentStatusRecord(assignmentStatusInput, assignment);
  const materializationInput = {
    record_version: BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_RECORD_VERSION,
    record_kind: BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_RECORD_KIND,
    admission_id: admission.admission_id,
    goal_id: goal.goal_id,
    goal_status_id: goalStatus.goal_status_id,
    assignment_id: assignment.assignment_id,
    assignment_status_id: assignmentStatus.assignment_status_id,
    agent_id: AGENT_ID,
    agent_version_id: version.agent_version_id,
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: assignmentInput.run_id,
    materialized_by: OWNER_ID,
    materialized_at_ms: 80,
    materialization_contract: 'admitted_goal_assignment_recorded_as_queued_assignment',
    execution_boundary: 'no_run_no_execution_no_source_materialization',
    ...(overrides.materialization_input ?? {}),
  };
  return {
    definition,
    version,
    goal,
    goal_status: overrides.goal_status ?? goalStatus,
    assignment_input: assignmentInput,
    admission_input: admissionInput,
    assignment_status_input: assignmentStatusInput,
    materialization_input: materializationInput,
  };
}

function serviceFor(t) {
  const root = temporaryRoot('clawfabric-builder-agent-goal-assignment-materialization-service-');
  const stores = openStores(root);
  const service = createBuilderAgentGoalAssignmentMaterializationService(stores);
  t.after(() => {
    closeStores(stores);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, stores, service };
}

function assertServiceError(fn, code) {
  assert.throws(
    fn,
    (error) => error instanceof BuilderAgentGoalAssignmentMaterializationServiceError
      && error.code === code
      && !/private|credential|api\.deepseek|secret-value|source text|raw assignment/iu.test(String(error.stack)),
  );
}

test('materializes an admitted active Goal assignment as a queued Assignment fact chain', (t) => {
  const { stores, service } = serviceFor(t);
  const result = service.materialize_goal_assignment(request());

  assert.equal(result.result_version, BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_SERVICE_RESULT_VERSION);
  assert.equal(result.service_version, BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_SERVICE_VERSION);
  assert.equal(result.status, 'ready');
  assert.equal(result.assignment_read.current_status, 'queued');
  assert.equal(result.materialization.assignment_status_id, result.assignment_read.statuses[0].assignment_status_id);
  assert.equal(result.operations.admission_store, 'admission_recorded');
  assert.equal(result.operations.assignment_store, 'assignment_recorded');
  assert.equal(result.operations.assignment_status_store, 'status_recorded');
  assert.equal(result.operations.materialization_store, 'materialization_recorded');
  assert.equal(result.evidence.service_authority, 'main_owned_agent_goal_assignment_materialization_service');
  assert.equal(result.evidence.provider_dispatch, false);
  assert.equal(result.evidence.tool_dispatch, false);
  assert.equal(result.evidence.run_authority, false);
  assert.equal(result.evidence.source_access, 'not_present');
  assert.equal(result.evidence.revision_authority, false);

  const admissionRead = stores.admission_store.read_admission({
    admission_id: result.admission.admission_id,
    owner_id: OWNER_ID,
  });
  assert.equal(admissionRead.status, 'ready');
  const assignmentRead = stores.assignment_store.read_assignment({
    assignment_id: result.assignment_read.assignment.assignment_id,
    owner_id: OWNER_ID,
  });
  assert.equal(assignmentRead.current_status, 'queued');
  const materializationRead = stores.materialization_store.read_materialization({
    materialization_id: result.materialization.materialization_id,
    owner_id: OWNER_ID,
  });
  assert.equal(materializationRead.status, 'ready');

  const replay = service.materialize_goal_assignment(request());
  assert.equal(replay.operations.admission_store, 'admission_replayed');
  assert.equal(replay.operations.assignment_store, 'assignment_replayed');
  assert.equal(replay.operations.assignment_status_store, 'status_replayed');
  assert.equal(replay.operations.materialization_store, 'materialization_replayed');
  assert.deepEqual(replay.materialization, result.materialization);
});

test('recovers across restart when earlier stores already recorded the admission and queued assignment', () => {
  const root = temporaryRoot('clawfabric-builder-agent-goal-assignment-materialization-service-restart-');
  const stores = openStores(root);
  const service = createBuilderAgentGoalAssignmentMaterializationService(stores);
  const first = service.materialize_goal_assignment(request());
  closeStores(stores);

  const reopened = openStores(root);
  const replayService = createBuilderAgentGoalAssignmentMaterializationService(reopened);
  const replay = replayService.materialize_goal_assignment(request());
  assert.equal(replay.operations.admission_store, 'admission_replayed');
  assert.equal(replay.operations.assignment_store, 'assignment_replayed');
  assert.equal(replay.operations.assignment_status_store, 'status_replayed');
  assert.equal(replay.operations.materialization_store, 'materialization_replayed');
  assert.deepEqual(replay.materialization, first.materialization);
  closeStores(reopened);
  fs.rmSync(root, { recursive: true, force: true });
});

test('fails closed before materialization for inactive goals, non-queued statuses, conflicts, and malformed stores', (t) => {
  const { stores, service } = serviceFor(t);
  const inactiveBase = baseRecords();
  const pausedGoalStatus = createBuilderAgentGoalStatusRecord({
    record_version: BUILDER_AGENT_GOAL_STATUS_RECORD_VERSION,
    goal_id: inactiveBase.goal.goal_id,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    decided_by: OWNER_ID,
    next_status: 'paused',
    reason: 'Owner paused this goal before assignment.',
    decided_at_ms: 45,
  }, inactiveBase.goal);
  assertServiceError(
    () => service.materialize_goal_assignment(request({ goal_status: pausedGoalStatus })),
    'builder_agent_goal_assignment_materialization_service_invalid',
  );
  assertServiceError(
    () => service.materialize_goal_assignment(request({
      assignment_status_input: { next_status: 'active' },
    })),
    'builder_agent_goal_assignment_materialization_service_invalid',
  );

  const first = service.materialize_goal_assignment(request());
  assertServiceError(
    () => service.materialize_goal_assignment(request({
      materialization_input: { materialized_at_ms: 81 },
    })),
    'builder_agent_goal_assignment_materialization_service_conflict',
  );
  const materializationRead = stores.materialization_store.read_materialization({
    materialization_id: first.materialization.materialization_id,
    owner_id: OWNER_ID,
  });
  assert.equal(materializationRead.status, 'ready');

  assertServiceError(
    () => createBuilderAgentGoalAssignmentMaterializationService({
      admission_store: {},
      assignment_store: stores.assignment_store,
      materialization_store: stores.materialization_store,
    }),
    'builder_agent_goal_assignment_materialization_service_invalid',
  );
});

test('source boundary remains main-only and exposes no runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-goal-assignment-materialization-service.cjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /require\('electron'\)|ipcMain|BrowserWindow|preload|safeStorage|provider-config|provider-secret/iu);
  assert.doesNotMatch(source, /node:child_process|require\(['"]child_process['"]\)|spawn\(|execFile\(|writeFile|rmSync/iu);
  assert.match(source, /service_authority: 'main_owned_agent_goal_assignment_materialization_service'/u);
  assert.match(source, /provider_dispatch: false/u);
  assert.match(source, /tool_dispatch: false/u);
  assert.match(source, /run_authority: false/u);
  assert.match(source, /source_access: 'not_present'/u);
  assert.match(source, /revision_authority: false/u);
});
