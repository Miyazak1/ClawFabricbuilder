'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
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
  createBuilderAgentAssignmentRecord,
} = require('../electron/builder-agent-assignment-contract.cjs');
const {
  BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_RECORD_VERSION,
  BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_VERSION,
  BuilderAgentGoalAssignmentAdmissionError,
  createBuilderAgentGoalAssignmentAdmissionRecord,
  sanitizeBuilderAgentGoalAssignmentAdmissionRecord,
} = require('../electron/builder-agent-goal-assignment-admission.cjs');

const OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174000';
const OTHER_OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174001';
const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174004';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174005';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174006';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174007';

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

function assertAdmissionError(fn) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderAgentGoalAssignmentAdmissionError);
      assert.equal(error.code, 'builder_agent_goal_assignment_admission_invalid');
      const text = `${error.name}:${error.message}:${error.stack}`;
      assert.doesNotMatch(text, /secret-value|credential|api\.deepseek|private marker|source text/iu);
      return true;
    },
  );
}

test('creates deterministic active Goal to Assignment admission without starting work', () => {
  const agentDefinition = definition();
  const agentVersion = version(agentDefinition);
  const goalRecord = goal(agentDefinition, agentVersion);
  const active = status(goalRecord);
  const assignmentRecord = assignment(agentDefinition, agentVersion, goalRecord);
  const admissionRecord = admission(goalRecord, active, assignmentRecord);
  const sameAdmission = admission(goalRecord, active, assignmentRecord);

  assert.equal(BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_VERSION, 'builder-agent-goal-assignment-admission.v1');
  assert.deepEqual(admissionRecord, sameAdmission);
  assert.match(admissionRecord.admission_id, /^builder-agent-goal-assignment-admission:[0-9a-f]{64}$/u);
  assert.equal(admissionRecord.definition_digest, goalRecord.definition_digest);
  assert.equal(admissionRecord.goal_id, goalRecord.goal_id);
  assert.equal(admissionRecord.goal_status_id, active.goal_status_id);
  assert.equal(admissionRecord.assignment_id, assignmentRecord.assignment_id);
  assert.equal(admissionRecord.run_id, assignmentRecord.run_id);
  assert.equal(admissionRecord.admission_contract, 'active_goal_to_owner_supervised_assignment');
  assert.equal(admissionRecord.materialization_boundary, 'assignment_record_required_before_execution');
  assert.deepEqual(admissionRecord.budget_bound, {
    goal_max_steps: 24,
    assignment_max_steps: 12,
    goal_max_tool_calls: 12,
    assignment_max_tool_calls: 4,
    goal_max_runtime_ms: 300_000,
    assignment_max_runtime_ms: 120_000,
    goal_max_private_source_bytes: 65_536,
    assignment_max_private_source_bytes: 32_768,
    goal_max_runs: 6,
    assignment_run_scope: 'single_assignment_run',
  });
  assert.equal(admissionRecord.lifecycle.goal, 'active_goal_verified');
  assert.equal(admissionRecord.lifecycle.assignment, 'admitted_not_recorded');
  assert.equal(admissionRecord.lifecycle.run, 'not_started_by_admission');
  assert.equal(admissionRecord.authority.record_authority, 'main_agent_goal_assignment_admission_contract_v1');
  assert.equal(admissionRecord.authority.goal_authority, 'main_agent_goal_contract_v1');
  assert.equal(admissionRecord.authority.assignment_authority, 'main_agent_assignment_contract_v1');
  assert.equal(admissionRecord.authority.renderer_authority, 'not_present');
  assert.equal(admissionRecord.authority.model_dispatch, false);
  assert.equal(admissionRecord.authority.tool_dispatch, 'not_performed_by_admission');
  assert.equal(admissionRecord.authority.source_read, 'not_performed_by_admission');
  assert.equal(admissionRecord.authority.source_write, 'not_performed_by_admission');
  assert.equal(admissionRecord.authority.permission_grant_authority, 'not_present');
  assert.equal(admissionRecord.authority.revision_authority, 'not_present');
  assert.equal(admissionRecord.authority.review_authority, 'not_present');
  assert.equal(admissionRecord.authority.artifact_authority, 'not_present');
  assert.equal(Object.isFrozen(admissionRecord), true);
  assert.equal(Object.isFrozen(admissionRecord.budget_bound), true);
  assert.equal(Object.isFrozen(admissionRecord.lifecycle), true);
  assert.equal(Object.isFrozen(admissionRecord.authority), true);
  assert.equal(Object.hasOwn(admissionRecord, 'permission_id'), false);
  assert.equal(Object.hasOwn(admissionRecord, 'provider'), false);
  assert.equal(Object.hasOwn(admissionRecord, 'credential'), false);
  assert.equal(Object.hasOwn(admissionRecord, 'source_tree'), false);
  assert.equal(Object.hasOwn(admissionRecord, 'commit'), false);

  assert.deepEqual(
    sanitizeBuilderAgentGoalAssignmentAdmissionRecord(
      structuredClone(admissionRecord),
      goalRecord,
      active,
      assignmentRecord,
    ),
    admissionRecord,
  );
});

test('rejects inactive goals, assignment drift, wider budgets, and direct materialization', () => {
  const agentDefinition = definition();
  const agentVersion = version(agentDefinition);
  const goalRecord = goal(agentDefinition, agentVersion);
  const active = status(goalRecord);
  const blocked = status(goalRecord, {
    next_status: 'blocked',
    reason: 'Waiting for owner input before continuing.',
  });
  const assignmentRecord = assignment(agentDefinition, agentVersion, goalRecord);
  const admissionRecord = admission(goalRecord, active, assignmentRecord);

  assertAdmissionError(() => admission(goalRecord, blocked, assignmentRecord));
  assertAdmissionError(() => admission(goalRecord, active, createBuilderAgentAssignmentRecord(
    assignmentInput(agentVersion, 'Different goal text.'),
    agentVersion,
    agentDefinition,
  )));
  assertAdmissionError(() => admission(goalRecord, active, createBuilderAgentAssignmentRecord(
    assignmentInput(agentVersion, goalRecord.objective, {
      budget: {
        max_steps: 25,
        max_tool_calls: 4,
        max_runtime_ms: 120_000,
        max_private_source_bytes: 32_768,
      },
    }),
    agentVersion,
    agentDefinition,
  )));
  assertAdmissionError(() => admission(goalRecord, active, assignmentRecord, {
    admitted_by: OTHER_OWNER_ID,
  }));
  assertAdmissionError(() => admission(goalRecord, active, assignmentRecord, {
    admitted_at_ms: 39,
  }));
  assertAdmissionError(() => admission(goalRecord, active, assignmentRecord, {
    materialization_boundary: 'assignment_record_can_execute_directly',
  }));
  assertAdmissionError(() => sanitizeBuilderAgentGoalAssignmentAdmissionRecord({
    ...admissionRecord,
    authority: {
      ...admissionRecord.authority,
      source_write: 'allowed',
    },
  }, goalRecord, active, assignmentRecord));
  assertAdmissionError(() => sanitizeBuilderAgentGoalAssignmentAdmissionRecord({
    ...admissionRecord,
    budget_bound: {
      ...admissionRecord.budget_bound,
      assignment_max_steps: 24,
    },
  }, goalRecord, active, assignmentRecord));
});

test('fails closed on extras, accessors, and proxies without leaking raw input', () => {
  const agentDefinition = definition();
  const agentVersion = version(agentDefinition);
  const goalRecord = goal(agentDefinition, agentVersion);
  const active = status(goalRecord);
  const assignmentRecord = assignment(agentDefinition, agentVersion, goalRecord);

  assertAdmissionError(() => createBuilderAgentGoalAssignmentAdmissionRecord({
    ...admissionInput(goalRecord, active, assignmentRecord),
    extra: true,
  }, goalRecord, active, assignmentRecord));
  assertAdmissionError(() => createBuilderAgentGoalAssignmentAdmissionRecord({
    ...admissionInput(goalRecord, active, assignmentRecord),
    admission_contract: 'Use credential secret-value.',
  }, goalRecord, active, assignmentRecord));

  let getterCalls = 0;
  assertAdmissionError(() => createBuilderAgentGoalAssignmentAdmissionRecord(Object.defineProperty(
    admissionInput(goalRecord, active, assignmentRecord),
    'goal_id',
    {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 'private marker';
      },
    },
  ), goalRecord, active, assignmentRecord));
  assert.equal(getterCalls, 0);

  let proxyTrapInvoked = false;
  const proxyTrap = () => {
    proxyTrapInvoked = true;
    throw new Error('private marker');
  };
  assertAdmissionError(() => createBuilderAgentGoalAssignmentAdmissionRecord(new Proxy(
    admissionInput(goalRecord, active, assignmentRecord),
    {
      getOwnPropertyDescriptor: proxyTrap,
      getPrototypeOf: proxyTrap,
      ownKeys: proxyTrap,
    },
  ), goalRecord, active, assignmentRecord));
  assert.equal(proxyTrapInvoked, false);
  assertAdmissionError(() => createBuilderAgentGoalAssignmentAdmissionRecord(
    admissionInput(goalRecord, active, assignmentRecord),
    new Proxy(goalRecord, {
      getOwnPropertyDescriptor: proxyTrap,
      getPrototypeOf: proxyTrap,
      ownKeys: proxyTrap,
    }),
    active,
    assignmentRecord,
  ));
  assert.equal(proxyTrapInvoked, false);
});

test('source remains a pure local Goal admission contract with no runtime authority', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'electron', 'builder-agent-goal-assignment-admission.cjs'),
    'utf8',
  );

  assert.match(source, /active_goal_to_owner_supervised_assignment/u);
  assert.match(source, /assignment_record_required_before_execution/u);
  assert.match(source, /not_started_by_admission/u);
  assert.doesNotMatch(source, /node:fs|node:sqlite|ipc|preload|safeStorage|credential|provider|dugite|git|child_process|spawn\s*\(|exec(?:File)?\s*\(|fetch\s*\(|localStorage|sessionStorage|BrowserWindow/iu);
});
