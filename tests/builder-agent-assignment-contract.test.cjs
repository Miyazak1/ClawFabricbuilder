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
  BUILDER_AGENT_ASSIGNMENT_RECORD_VERSION,
  BUILDER_AGENT_ASSIGNMENT_STATUS_RECORD_VERSION,
  BuilderAgentAssignmentContractError,
  createBuilderAgentAssignmentRecord,
  createBuilderAgentAssignmentStatusRecord,
  sanitizeBuilderAgentAssignmentRecord,
  sanitizeBuilderAgentAssignmentStatusRecord,
} = require('../electron/builder-agent-assignment-contract.cjs');

const OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174000';
const OTHER_OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174001';
const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const OTHER_AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174003';
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
    purpose: 'Help the owner plan and review local Builder work.',
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
    instructions: 'Ask before changing files. Summarize proposed work before review.',
    created_at_ms: 20,
    permission_boundary: 'explicit_permission_required',
    ...overrides,
  };
}

function version(definitionRecord, overrides = {}) {
  return createBuilderAgentVersionRecord(versionInput(overrides), definitionRecord);
}

function assignmentInput(agentVersionRecord, overrides = {}) {
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
    reason: 'Owner is supervising this local task.',
    decided_at_ms: 40,
    ...overrides,
  };
}

function assertContractError(fn) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderAgentAssignmentContractError);
      assert.equal(error.code, 'builder_agent_assignment_contract_invalid');
      const text = `${error.name}:${error.message}:${error.stack}`;
      assert.doesNotMatch(text, /secret-value|credential|api\.deepseek|private marker|source text/iu);
      return true;
    },
  );
}

test('creates deterministic owner-supervised assignment and status records', () => {
  const agentDefinition = definition();
  const agentVersion = version(agentDefinition);
  const assignment = createBuilderAgentAssignmentRecord(
    assignmentInput(agentVersion),
    agentVersion,
    agentDefinition,
  );
  const sameAssignment = createBuilderAgentAssignmentRecord(
    assignmentInput(agentVersion),
    agentVersion,
    agentDefinition,
  );

  assert.deepEqual(assignment, sameAssignment);
  assert.match(assignment.assignment_id, /^builder-agent-assignment:[0-9a-f]{64}$/u);
  assert.equal(assignment.definition_digest, agentDefinition.definition_digest);
  assert.equal(assignment.agent_version_id, agentVersion.agent_version_id);
  assert.equal(assignment.assigned_by, OWNER_ID);
  assert.equal(assignment.permission_boundary, 'explicit_permission_required');
  assert.equal(assignment.supervision_policy, 'owner_supervised');
  assert.equal(assignment.result_contract, 'review_required_before_materialization');
  assert.equal(Object.isFrozen(assignment), true);
  assert.equal(Object.isFrozen(assignment.budget), true);
  assert.equal(Object.hasOwn(assignment, 'permission_id'), false);
  assert.equal(Object.hasOwn(assignment, 'provider'), false);
  assert.equal(Object.hasOwn(assignment, 'credential'), false);
  assert.equal(Object.hasOwn(assignment, 'source_tree'), false);
  assert.equal(Object.hasOwn(assignment, 'commit'), false);

  const status = createBuilderAgentAssignmentStatusRecord(statusInput(assignment), assignment);
  const sameStatus = createBuilderAgentAssignmentStatusRecord(statusInput(assignment), assignment);
  assert.deepEqual(status, sameStatus);
  assert.match(status.assignment_status_id, /^builder-agent-assignment-status:[0-9a-f]{64}$/u);
  assert.equal(status.definition_digest, agentDefinition.definition_digest);
  assert.equal(status.assignment_id, assignment.assignment_id);
  assert.equal(status.decided_by, OWNER_ID);
  assert.equal(status.next_status, 'active');
  assert.equal(Object.isFrozen(status), true);

  assert.deepEqual(
    sanitizeBuilderAgentAssignmentRecord(structuredClone(assignment), agentVersion, agentDefinition),
    assignment,
  );
  assert.deepEqual(sanitizeBuilderAgentAssignmentStatusRecord(structuredClone(status), assignment), status);
});

test('rejects cross-owner, version drift, implicit authority, and malformed budgets', () => {
  const agentDefinition = definition();
  const agentVersion = version(agentDefinition);
  const assignment = createBuilderAgentAssignmentRecord(
    assignmentInput(agentVersion),
    agentVersion,
    agentDefinition,
  );
  const status = createBuilderAgentAssignmentStatusRecord(statusInput(assignment), assignment);

  assertContractError(() => createBuilderAgentAssignmentRecord(assignmentInput(agentVersion, {
    assigned_by: OTHER_OWNER_ID,
  }), agentVersion, agentDefinition));
  assertContractError(() => createBuilderAgentAssignmentRecord(assignmentInput(agentVersion, {
    agent_id: OTHER_AGENT_ID,
  }), agentVersion, agentDefinition));
  assertContractError(() => createBuilderAgentAssignmentRecord(assignmentInput(agentVersion, {
    agent_version_id: 'builder-agent-version:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  }), agentVersion, agentDefinition));
  assertContractError(() => createBuilderAgentAssignmentRecord(assignmentInput(agentVersion, {
    permission_boundary: 'implicit_permission',
  }), agentVersion, agentDefinition));
  assertContractError(() => createBuilderAgentAssignmentRecord(assignmentInput(agentVersion, {
    result_contract: 'direct_materialization',
  }), agentVersion, agentDefinition));
  assertContractError(() => createBuilderAgentAssignmentRecord(assignmentInput(agentVersion, {
    budget: {
      max_steps: 0,
      max_tool_calls: 4,
      max_runtime_ms: 120_000,
      max_private_source_bytes: 32_768,
    },
  }), agentVersion, agentDefinition));
  assertContractError(() => createBuilderAgentAssignmentRecord(assignmentInput(agentVersion, {
    budget: {
      max_steps: 12,
      max_tool_calls: 4,
      max_runtime_ms: 120_000,
      max_private_source_bytes: (4 * 1_024 * 1_024) + 1,
    },
  }), agentVersion, agentDefinition));
  assertContractError(() => sanitizeBuilderAgentAssignmentRecord({
    ...assignment,
    goal: `${assignment.goal} changed`,
  }, agentVersion, agentDefinition));
  assertContractError(() => createBuilderAgentAssignmentStatusRecord(statusInput(assignment, {
    decided_by: OTHER_OWNER_ID,
  }), assignment));
  assertContractError(() => createBuilderAgentAssignmentStatusRecord(statusInput(assignment, {
    next_status: 'running',
  }), assignment));
  assertContractError(() => sanitizeBuilderAgentAssignmentStatusRecord({
    ...status,
    reason: `${status.reason} changed`,
  }, assignment));
});

test('fails closed on extras, accessors, and proxies without leaking raw input', () => {
  const agentDefinition = definition();
  const agentVersion = version(agentDefinition);

  assertContractError(() => createBuilderAgentAssignmentRecord({
    ...assignmentInput(agentVersion),
    extra: true,
  }, agentVersion, agentDefinition));
  assertContractError(() => createBuilderAgentAssignmentRecord({
    ...assignmentInput(agentVersion),
    goal: 'Use credential secret-value.\n',
  }, agentVersion, agentDefinition));

  let getterCalls = 0;
  assertContractError(() => createBuilderAgentAssignmentRecord(Object.defineProperty(
    assignmentInput(agentVersion),
    'goal',
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
  assertContractError(() => createBuilderAgentAssignmentRecord({
    ...assignmentInput(agentVersion),
    budget: Object.defineProperty(
      {
        max_steps: 12,
        max_tool_calls: 4,
        max_runtime_ms: 120_000,
        max_private_source_bytes: 32_768,
      },
      'max_steps',
      {
        enumerable: true,
        get() {
          budgetGetterCalls += 1;
          return 12;
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
  assertContractError(() => createBuilderAgentAssignmentRecord(new Proxy(assignmentInput(agentVersion), {
    getOwnPropertyDescriptor: proxyTrap,
    getPrototypeOf: proxyTrap,
    ownKeys: proxyTrap,
  }), agentVersion, agentDefinition));
  assert.equal(proxyTrapInvoked, false);
});

test('source remains a pure local assignment contract with no runtime authority', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'electron', 'builder-agent-assignment-contract.cjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /node:fs|node:sqlite|ipc|preload|safeStorage|credential|provider|dugite|git|child_process|spawn|exec|fetch|localStorage|sessionStorage/iu);
  assert.match(source, /explicit_permission_required/u);
  assert.match(source, /owner_supervised/u);
  assert.match(source, /review_required_before_materialization/u);
  assert.match(source, /builder-agent-assignment-contract\.v1/u);
});
