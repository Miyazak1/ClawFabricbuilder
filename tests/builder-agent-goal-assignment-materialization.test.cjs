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
  createBuilderAgentAssignmentStore,
} = require('../electron/builder-agent-assignment-store.cjs');
const {
  createBuilderAgentGoalAssignmentAdmissionStore,
} = require('../electron/builder-agent-goal-assignment-admission-store.cjs');
const {
  BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_RECORD_KIND,
  BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_RECORD_VERSION,
  BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_VERSION,
  BuilderAgentGoalAssignmentMaterializationError,
  createBuilderAgentGoalAssignmentMaterializationRecord,
  sanitizeBuilderAgentGoalAssignmentMaterializationRecord,
} = require('../electron/builder-agent-goal-assignment-materialization.cjs');

const OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174000';
const OTHER_OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174001';
const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174004';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174005';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174006';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174007';

function temporaryDatabase(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    databasePath: path.join(root, 'store.sqlite'),
    root,
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

function goalInput(agentVersion, overrides = {}) {
  return {
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
    ...overrides,
  };
}

function goalStatusInput(goalRecord, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_GOAL_STATUS_RECORD_VERSION,
    goal_id: goalRecord.goal_id,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    decided_by: OWNER_ID,
    next_status: 'active',
    reason: 'Owner started the continuous supervised goal.',
    decided_at_ms: 40,
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

function admissionInput(goalRecord, goalStatus, assignmentRecord, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_RECORD_VERSION,
    goal_id: goalRecord.goal_id,
    goal_status_id: goalStatus.goal_status_id,
    assignment_id: assignmentRecord.assignment_id,
    agent_id: AGENT_ID,
    agent_version_id: assignmentRecord.agent_version_id,
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    admitted_by: OWNER_ID,
    admitted_at_ms: 60,
    admission_contract: 'active_goal_to_owner_supervised_assignment',
    materialization_boundary: 'assignment_record_required_before_execution',
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
    next_status: 'queued',
    reason: 'Owner queued this admitted Goal assignment.',
    decided_at_ms: 70,
    ...overrides,
  };
}

function materializationInput(admissionRecord, queuedStatus, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_RECORD_VERSION,
    record_kind: BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_RECORD_KIND,
    admission_id: admissionRecord.admission_id,
    goal_id: admissionRecord.goal_id,
    goal_status_id: admissionRecord.goal_status_id,
    assignment_id: admissionRecord.assignment_id,
    assignment_status_id: queuedStatus.assignment_status_id,
    agent_id: AGENT_ID,
    agent_version_id: admissionRecord.agent_version_id,
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    materialized_by: OWNER_ID,
    materialized_at_ms: 80,
    materialization_contract: 'admitted_goal_assignment_recorded_as_queued_assignment',
    execution_boundary: 'no_run_no_execution_no_source_materialization',
    ...overrides,
  };
}

function fixture() {
  const agentDefinition = createBuilderAgentDefinitionRecord(definitionInput());
  const agentVersion = createBuilderAgentVersionRecord(versionInput(), agentDefinition);
  const goalRecord = createBuilderAgentGoalRecord(goalInput(agentVersion), agentVersion, agentDefinition);
  const goalStatus = createBuilderAgentGoalStatusRecord(goalStatusInput(goalRecord), goalRecord);
  const assignmentRecord = createBuilderAgentAssignmentRecord(
    assignmentInput(agentVersion),
    agentVersion,
    agentDefinition,
  );
  const admissionRecord = createBuilderAgentGoalAssignmentAdmissionRecord(
    admissionInput(goalRecord, goalStatus, assignmentRecord),
    goalRecord,
    goalStatus,
    assignmentRecord,
  );
  const queuedStatus = createBuilderAgentAssignmentStatusRecord(statusInput(assignmentRecord), assignmentRecord);
  return {
    admissionRecord,
    agentDefinition,
    agentVersion,
    assignmentRecord,
    goalRecord,
    goalStatus,
    queuedStatus,
  };
}

function recordAdmissionAndAssignment(t, records) {
  const admissionDatabase = temporaryDatabase(
    'clawfabric-builder-agent-goal-assignment-materialization-admissions-',
  );
  const assignmentDatabase = temporaryDatabase(
    'clawfabric-builder-agent-goal-assignment-materialization-assignments-',
  );
  const admissionStore = createBuilderAgentGoalAssignmentAdmissionStore(
    admissionDatabase.databasePath,
  );
  const assignmentStore = createBuilderAgentAssignmentStore(
    assignmentDatabase.databasePath,
  );
  admissionStore.record_admission({
    goal: records.goalRecord,
    goal_status: records.goalStatus,
    assignment: records.assignmentRecord,
    admission: records.admissionRecord,
  });
  assignmentStore.record_assignment({
    definition: records.agentDefinition,
    version: records.agentVersion,
    assignment: records.assignmentRecord,
  });
  assignmentStore.record_status({ status: records.queuedStatus });
  t.after(() => {
    admissionStore.close();
    assignmentStore.close();
    fs.rmSync(admissionDatabase.root, { recursive: true, force: true });
    fs.rmSync(assignmentDatabase.root, { recursive: true, force: true });
  });
  return {
    admissionRead: admissionStore.read_admission({
      admission_id: records.admissionRecord.admission_id,
      owner_id: OWNER_ID,
    }),
    assignmentRead: assignmentStore.read_assignment({
      assignment_id: records.assignmentRecord.assignment_id,
      owner_id: OWNER_ID,
    }),
  };
}

function assertMaterializationError(fn) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderAgentGoalAssignmentMaterializationError);
      assert.equal(error.code, 'builder_agent_goal_assignment_materialization_invalid');
      const text = `${error.name}:${error.message}:${error.stack}`;
      assert.doesNotMatch(text, /private|credential|api\.deepseek|secret-value|source text|raw assignment/iu);
      return true;
    },
  );
}

test('creates a receipt only after an admitted Goal assignment is recorded as queued', (t) => {
  const records = fixture();
  const { assignmentRead } = recordAdmissionAndAssignment(t, records);

  assert.equal(BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_VERSION, 'builder-agent-goal-assignment-materialization.v1');
  assert.equal(assignmentRead.current_status, 'queued');
  assert.equal(assignmentRead.statuses.length, 1);

  const materialization = createBuilderAgentGoalAssignmentMaterializationRecord(
    materializationInput(records.admissionRecord, records.queuedStatus),
    records.goalRecord,
    records.goalStatus,
    records.admissionRecord,
    assignmentRead,
  );

  assert.match(materialization.materialization_id, /^builder-agent-goal-assignment-materialization:[0-9a-f]{64}$/u);
  assert.equal(materialization.admission_id, records.admissionRecord.admission_id);
  assert.equal(materialization.assignment_id, records.assignmentRecord.assignment_id);
  assert.equal(materialization.assignment_status_id, records.queuedStatus.assignment_status_id);
  assert.equal(materialization.lifecycle.assignment_store, 'recorded_as_owner_supervised_assignment');
  assert.equal(materialization.lifecycle.run, 'not_started_by_materialization');
  assert.equal(materialization.authority.record_authority, 'main_agent_goal_assignment_materialization_contract_v1');
  assert.equal(materialization.authority.admission_authority, 'main_owned_agent_goal_assignment_admission_store');
  assert.equal(materialization.authority.assignment_authority, 'main_owned_agent_assignment_store');
  assert.equal(materialization.authority.renderer_authority, 'not_present');
  assert.equal(materialization.authority.model_dispatch, false);
  assert.equal(materialization.authority.tool_dispatch, 'not_performed_by_materialization');
  assert.equal(materialization.authority.source_read, 'not_performed_by_materialization');
  assert.equal(materialization.authority.source_write, 'not_performed_by_materialization');
  assert.equal(materialization.authority.revision_authority, 'not_present');
  assert.equal(materialization.authority.review_authority, 'not_present');
  assert.equal(materialization.authority.artifact_authority, 'not_present');
  assert.equal(Object.isFrozen(materialization), true);

  assert.deepEqual(
    sanitizeBuilderAgentGoalAssignmentMaterializationRecord(
      materialization,
      records.goalRecord,
      records.goalStatus,
      records.admissionRecord,
      assignmentRead,
    ),
    materialization,
  );
});

test('is deterministic for the same stored assignment read evidence', (t) => {
  const records = fixture();
  const { assignmentRead } = recordAdmissionAndAssignment(t, records);
  const input = materializationInput(records.admissionRecord, records.queuedStatus);
  const first = createBuilderAgentGoalAssignmentMaterializationRecord(
    input,
    records.goalRecord,
    records.goalStatus,
    records.admissionRecord,
    assignmentRead,
  );
  const second = createBuilderAgentGoalAssignmentMaterializationRecord(
    input,
    records.goalRecord,
    records.goalStatus,
    records.admissionRecord,
    assignmentRead,
  );

  assert.deepEqual(second, first);
});

test('rejects assignment reads that are absent, progressed, or not backed by the assignment store', (t) => {
  const records = fixture();
  const { assignmentRead } = recordAdmissionAndAssignment(t, records);
  const input = materializationInput(records.admissionRecord, records.queuedStatus);

  assertMaterializationError(() => createBuilderAgentGoalAssignmentMaterializationRecord(
    input,
    records.goalRecord,
    records.goalStatus,
    records.admissionRecord,
    { ...assignmentRead, status: 'absent', assignment: null },
  ));
  assertMaterializationError(() => createBuilderAgentGoalAssignmentMaterializationRecord(
    input,
    records.goalRecord,
    records.goalStatus,
    records.admissionRecord,
    { ...assignmentRead, current_status: 'active' },
  ));
  assertMaterializationError(() => createBuilderAgentGoalAssignmentMaterializationRecord(
    input,
    records.goalRecord,
    records.goalStatus,
    records.admissionRecord,
    { ...assignmentRead, statuses: [records.queuedStatus, records.queuedStatus] },
  ));
  assertMaterializationError(() => createBuilderAgentGoalAssignmentMaterializationRecord(
    input,
    records.goalRecord,
    records.goalStatus,
    records.admissionRecord,
    {
      ...assignmentRead,
      evidence: {
        ...assignmentRead.evidence,
        assignment_authority: 'renderer_shadow_assignment_store',
      },
    },
  ));
});

test('rejects mismatched owner, timing, admission, and field tampering', (t) => {
  const records = fixture();
  const { assignmentRead } = recordAdmissionAndAssignment(t, records);
  const input = materializationInput(records.admissionRecord, records.queuedStatus);

  assertMaterializationError(() => createBuilderAgentGoalAssignmentMaterializationRecord(
    { ...input, owner_id: OTHER_OWNER_ID },
    records.goalRecord,
    records.goalStatus,
    records.admissionRecord,
    assignmentRead,
  ));
  assertMaterializationError(() => createBuilderAgentGoalAssignmentMaterializationRecord(
    { ...input, materialized_by: OTHER_OWNER_ID },
    records.goalRecord,
    records.goalStatus,
    records.admissionRecord,
    assignmentRead,
  ));
  assertMaterializationError(() => createBuilderAgentGoalAssignmentMaterializationRecord(
    { ...input, materialized_at_ms: records.queuedStatus.decided_at_ms - 1 },
    records.goalRecord,
    records.goalStatus,
    records.admissionRecord,
    assignmentRead,
  ));
  assertMaterializationError(() => createBuilderAgentGoalAssignmentMaterializationRecord(
    { ...input, materialization_contract: 'start_execution_now' },
    records.goalRecord,
    records.goalStatus,
    records.admissionRecord,
    assignmentRead,
  ));
  assertMaterializationError(() => createBuilderAgentGoalAssignmentMaterializationRecord(
    { ...input, execution_boundary: 'run_started' },
    records.goalRecord,
    records.goalStatus,
    records.admissionRecord,
    assignmentRead,
  ));
  assertMaterializationError(() => createBuilderAgentGoalAssignmentMaterializationRecord(
    input,
    records.goalRecord,
    records.goalStatus,
    {
      ...records.admissionRecord,
      record_version: BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_RECORD_VERSION,
      materialization_boundary: 'assignment_record_optional',
    },
    assignmentRead,
  ));
});

test('fails closed on malformed objects and accessor/proxy input', (t) => {
  const records = fixture();
  const { assignmentRead } = recordAdmissionAndAssignment(t, records);
  const input = materializationInput(records.admissionRecord, records.queuedStatus);

  assertMaterializationError(() => createBuilderAgentGoalAssignmentMaterializationRecord(
    { ...input, extra: true },
    records.goalRecord,
    records.goalStatus,
    records.admissionRecord,
    assignmentRead,
  ));
  assertMaterializationError(() => createBuilderAgentGoalAssignmentMaterializationRecord(
    Object.defineProperty({ ...input }, 'owner_id', { get: () => OWNER_ID, enumerable: true }),
    records.goalRecord,
    records.goalStatus,
    records.admissionRecord,
    assignmentRead,
  ));
  assertMaterializationError(() => createBuilderAgentGoalAssignmentMaterializationRecord(
    new Proxy(input, {}),
    records.goalRecord,
    records.goalStatus,
    records.admissionRecord,
    assignmentRead,
  ));
  assertMaterializationError(() => sanitizeBuilderAgentGoalAssignmentMaterializationRecord(
    {
      ...createBuilderAgentGoalAssignmentMaterializationRecord(
        input,
        records.goalRecord,
        records.goalStatus,
        records.admissionRecord,
        assignmentRead,
      ),
      authority: {
        ...createBuilderAgentGoalAssignmentMaterializationRecord(
          input,
          records.goalRecord,
          records.goalStatus,
          records.admissionRecord,
          assignmentRead,
        ).authority,
        model_dispatch: true,
      },
    },
    records.goalRecord,
    records.goalStatus,
    records.admissionRecord,
    assignmentRead,
  ));
});

test('source boundary remains main-only without execution authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-goal-assignment-materialization.cjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /require\('electron'\)|ipcMain|BrowserWindow|preload|safeStorage|provider-config|provider-secret/iu);
  assert.doesNotMatch(source, /child_process|spawn|execFile|exec\(|node:sqlite|DatabaseSync|git\s|writeFile|rmSync/iu);
  assert.match(source, /model_dispatch: false/u);
  assert.match(source, /source_write: 'not_performed_by_materialization'/u);
  assert.match(source, /revision_authority: 'not_present'/u);
});
