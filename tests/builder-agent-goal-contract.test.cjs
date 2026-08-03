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
  BuilderAgentGoalContractError,
  createBuilderAgentGoalRecord,
  createBuilderAgentGoalStatusRecord,
  sanitizeBuilderAgentGoalRecord,
  sanitizeBuilderAgentGoalStatusRecord,
} = require('../electron/builder-agent-goal-contract.cjs');

const OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174000';
const OTHER_OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174001';
const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const OTHER_AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174003';
const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174004';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174005';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174006';

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

function assertContractError(fn) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderAgentGoalContractError);
      assert.equal(error.code, 'builder_agent_goal_contract_invalid');
      const text = `${error.name}:${error.message}:${error.stack}`;
      assert.doesNotMatch(text, /secret-value|credential|api\.deepseek|private marker|source text/iu);
      return true;
    },
  );
}

test('creates deterministic continuous Goal and owner status records without starting work', () => {
  const agentDefinition = definition();
  const agentVersion = version(agentDefinition);
  const goal = createBuilderAgentGoalRecord(goalInput(agentVersion), agentVersion, agentDefinition);
  const sameGoal = createBuilderAgentGoalRecord(goalInput(agentVersion), agentVersion, agentDefinition);

  assert.deepEqual(goal, sameGoal);
  assert.match(goal.goal_id, /^builder-agent-goal:[0-9a-f]{64}$/u);
  assert.equal(goal.definition_digest, agentDefinition.definition_digest);
  assert.equal(goal.agent_version_id, agentVersion.agent_version_id);
  assert.equal(goal.created_by, OWNER_ID);
  assert.equal(goal.execution_contract, 'continuous_until_done_or_blocked');
  assert.equal(goal.completion_contract, 'owner_review_required_before_done');
  assert.equal(goal.lifecycle.goal, 'recorded_not_started');
  assert.equal(goal.lifecycle.assignment, 'not_created_by_contract');
  assert.equal(goal.lifecycle.run, 'not_created_by_contract');
  assert.equal(goal.authority.record_authority, 'main_agent_goal_contract_v1');
  assert.equal(goal.authority.model_dispatch, false);
  assert.equal(goal.authority.source_write, 'not_performed_by_contract');
  assert.equal(goal.authority.tool_dispatch, 'not_performed_by_contract');
  assert.equal(goal.authority.revision_authority, 'not_present');
  assert.equal(Object.isFrozen(goal), true);
  assert.equal(Object.isFrozen(goal.budget), true);
  assert.equal(Object.isFrozen(goal.lifecycle), true);
  assert.equal(Object.isFrozen(goal.authority), true);
  assert.equal(Object.hasOwn(goal, 'run_id'), false);
  assert.equal(Object.hasOwn(goal, 'assignment_id'), false);
  assert.equal(Object.hasOwn(goal, 'permission_id'), false);
  assert.equal(Object.hasOwn(goal, 'credential'), false);
  assert.equal(Object.hasOwn(goal, 'source_tree'), false);
  assert.equal(Object.hasOwn(goal, 'commit'), false);

  const status = createBuilderAgentGoalStatusRecord(statusInput(goal), goal);
  const sameStatus = createBuilderAgentGoalStatusRecord(statusInput(goal), goal);
  assert.deepEqual(status, sameStatus);
  assert.match(status.goal_status_id, /^builder-agent-goal-status:[0-9a-f]{64}$/u);
  assert.equal(status.goal_id, goal.goal_id);
  assert.equal(status.decided_by, OWNER_ID);
  assert.equal(status.next_status, 'active');
  assert.equal(status.lifecycle.status, 'owner_decision_recorded');
  assert.equal(status.authority.model_dispatch, false);
  assert.equal(status.authority.source_write, 'not_performed_by_contract');
  assert.equal(Object.isFrozen(status), true);

  assert.deepEqual(sanitizeBuilderAgentGoalRecord(structuredClone(goal), agentVersion, agentDefinition), goal);
  assert.deepEqual(sanitizeBuilderAgentGoalStatusRecord(structuredClone(status), goal), status);
});

test('allows done or blocked Goal status as owner decision records only', () => {
  const agentDefinition = definition();
  const agentVersion = version(agentDefinition);
  const goal = createBuilderAgentGoalRecord(goalInput(agentVersion), agentVersion, agentDefinition);
  const blocked = createBuilderAgentGoalStatusRecord(statusInput(goal, {
    next_status: 'blocked',
    reason: 'Waiting for owner input before continuing.',
    decided_at_ms: 41,
  }), goal);
  const completed = createBuilderAgentGoalStatusRecord(statusInput(goal, {
    next_status: 'completed',
    reason: 'Owner verified the bounded goal is done.',
    decided_at_ms: 42,
  }), goal);

  assert.equal(blocked.next_status, 'blocked');
  assert.equal(completed.next_status, 'completed');
  assert.equal(blocked.lifecycle.completion, 'status_only_without_materialization');
  assert.equal(completed.lifecycle.completion, 'status_only_without_materialization');
  assert.equal(Object.hasOwn(completed, 'artifact_id'), false);
  assert.equal(Object.hasOwn(completed, 'revision_id'), false);
});

test('rejects cross-owner, version drift, implicit authority, and malformed budgets', () => {
  const agentDefinition = definition();
  const agentVersion = version(agentDefinition);
  const goal = createBuilderAgentGoalRecord(goalInput(agentVersion), agentVersion, agentDefinition);
  const status = createBuilderAgentGoalStatusRecord(statusInput(goal), goal);

  assertContractError(() => createBuilderAgentGoalRecord(goalInput(agentVersion, {
    created_by: OTHER_OWNER_ID,
  }), agentVersion, agentDefinition));
  assertContractError(() => createBuilderAgentGoalRecord(goalInput(agentVersion, {
    agent_id: OTHER_AGENT_ID,
  }), agentVersion, agentDefinition));
  assertContractError(() => createBuilderAgentGoalRecord(goalInput(agentVersion, {
    agent_version_id: 'builder-agent-version:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  }), agentVersion, agentDefinition));
  assertContractError(() => createBuilderAgentGoalRecord(goalInput(agentVersion, {
    permission_boundary: 'implicit_permission',
  }), agentVersion, agentDefinition));
  assertContractError(() => createBuilderAgentGoalRecord(goalInput(agentVersion, {
    execution_contract: 'single_turn_task',
  }), agentVersion, agentDefinition));
  assertContractError(() => createBuilderAgentGoalRecord(goalInput(agentVersion, {
    completion_contract: 'auto_mark_done',
  }), agentVersion, agentDefinition));
  assertContractError(() => createBuilderAgentGoalRecord(goalInput(agentVersion, {
    budget: {
      max_steps: 0,
      max_runs: 6,
      max_tool_calls: 12,
      max_runtime_ms: 300_000,
      max_private_source_bytes: 65_536,
    },
  }), agentVersion, agentDefinition));
  assertContractError(() => createBuilderAgentGoalRecord(goalInput(agentVersion, {
    budget: {
      max_steps: 24,
      max_runs: 65,
      max_tool_calls: 12,
      max_runtime_ms: 300_000,
      max_private_source_bytes: 65_536,
    },
  }), agentVersion, agentDefinition));
  assertContractError(() => sanitizeBuilderAgentGoalRecord({
    ...goal,
    objective: `${goal.objective} changed`,
  }, agentVersion, agentDefinition));
  assertContractError(() => sanitizeBuilderAgentGoalRecord({
    ...goal,
    authority: {
      ...goal.authority,
      source_write: 'allowed',
    },
  }, agentVersion, agentDefinition));
  assertContractError(() => createBuilderAgentGoalStatusRecord(statusInput(goal, {
    decided_by: OTHER_OWNER_ID,
  }), goal));
  assertContractError(() => createBuilderAgentGoalStatusRecord(statusInput(goal, {
    next_status: 'running',
  }), goal));
  assertContractError(() => sanitizeBuilderAgentGoalStatusRecord({
    ...status,
    reason: `${status.reason} changed`,
  }, goal));
});

test('fails closed on extras, accessors, and proxies without leaking raw input', () => {
  const agentDefinition = definition();
  const agentVersion = version(agentDefinition);

  assertContractError(() => createBuilderAgentGoalRecord({
    ...goalInput(agentVersion),
    extra: true,
  }, agentVersion, agentDefinition));
  assertContractError(() => createBuilderAgentGoalRecord({
    ...goalInput(agentVersion),
    objective: 'Use credential secret-value.\n',
  }, agentVersion, agentDefinition));

  let getterCalls = 0;
  assertContractError(() => createBuilderAgentGoalRecord(Object.defineProperty(
    goalInput(agentVersion),
    'objective',
    {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 'private marker';
      },
    },
  ), agentVersion, agentDefinition));
  assert.equal(getterCalls, 0);

  let budgetGetterCalls = 0;
  assertContractError(() => createBuilderAgentGoalRecord({
    ...goalInput(agentVersion),
    budget: Object.defineProperty(
      {
        max_steps: 24,
        max_runs: 6,
        max_tool_calls: 12,
        max_runtime_ms: 300_000,
        max_private_source_bytes: 65_536,
      },
      'max_steps',
      {
        enumerable: true,
        get() {
          budgetGetterCalls += 1;
          return 24;
        },
      },
    ),
  }, agentVersion, agentDefinition));
  assert.equal(budgetGetterCalls, 0);

  let proxyTrapInvoked = false;
  const proxyTrap = () => {
    proxyTrapInvoked = true;
    throw new Error('private marker');
  };
  assertContractError(() => createBuilderAgentGoalRecord(new Proxy(goalInput(agentVersion), {
    getOwnPropertyDescriptor: proxyTrap,
    getPrototypeOf: proxyTrap,
    ownKeys: proxyTrap,
  }), agentVersion, agentDefinition));
  assert.equal(proxyTrapInvoked, false);
});

test('source remains a pure local Goal contract with no runtime authority', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'electron', 'builder-agent-goal-contract.cjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /node:fs|node:sqlite|ipc|preload|safeStorage|credential|provider|dugite|git|child_process|spawn\s*\(|exec(?:File)?\s*\(|fetch\s*\(|localStorage|sessionStorage/iu);
  assert.match(source, /continuous_until_done_or_blocked/u);
  assert.match(source, /owner_review_required_before_done/u);
  assert.match(source, /builder-agent-goal-contract\.v1/u);
});
