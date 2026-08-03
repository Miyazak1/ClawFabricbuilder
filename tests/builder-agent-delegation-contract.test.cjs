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
  createBuilderAgentAssignmentRecord,
  createBuilderAgentAssignmentStatusRecord,
} = require('../electron/builder-agent-assignment-contract.cjs');
const {
  BUILDER_AGENT_SUPERVISION_LEASE_RECORD_VERSION,
  createBuilderAgentSupervisionLeaseRecord,
} = require('../electron/builder-agent-supervision-lease-contract.cjs');
const {
  BUILDER_AGENT_DELEGATION_RECORD_KIND,
  BUILDER_AGENT_DELEGATION_RECORD_VERSION,
  BuilderAgentDelegationContractError,
  createBuilderAgentDelegationRecord,
  sanitizeBuilderAgentDelegationRecord,
} = require('../electron/builder-agent-delegation-contract.cjs');

const OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174000';
const OTHER_OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174001';
const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const TARGET_AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174003';
const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174004';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174005';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174006';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174007';
const SUPERVISOR_ID = 'builder-supervisor:123e4567-e89b-42d3-a456-426614174008';
const CHILD_CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174009';
const CHILD_TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174010';
const CHILD_RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174011';

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
    goal: 'Prepare one reviewable local Builder change.',
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
    run_id: RUN_ID,
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

function targetDefinitionInput(overrides = {}) {
  return definitionInput({
    agent_id: TARGET_AGENT_ID,
    display_name: 'Review Agent',
    purpose: 'Review scoped Builder work before owner acceptance.',
    created_at_ms: 12,
    ...overrides,
  });
}

function targetVersionInput(overrides = {}) {
  return versionInput({
    agent_id: TARGET_AGENT_ID,
    instructions: 'Review delegated work and return a bounded result for owner review.',
    created_at_ms: 22,
    ...overrides,
  });
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
  const targetDefinition = createBuilderAgentDefinitionRecord(targetDefinitionInput(overrides.targetDefinition ?? {}));
  const targetVersion = createBuilderAgentVersionRecord(
    targetVersionInput(overrides.targetVersion ?? {}),
    targetDefinition,
  );
  return { activeStatus, assignmentRecord, leaseRecord, targetDefinition, targetVersion };
}

function permissionIntersection(overrides = {}) {
  return {
    parent_boundary: 'explicit_permission_required',
    child_boundary: 'explicit_permission_required',
    effective_boundary: 'parent_child_intersection_only',
    external_resources: 'not_granted_by_delegation',
    ...overrides,
  };
}

function delegationInput(assignmentRecord, activeStatus, leaseRecord, targetVersion, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_DELEGATION_RECORD_VERSION,
    record_kind: BUILDER_AGENT_DELEGATION_RECORD_KIND,
    parent_assignment_id: assignmentRecord.assignment_id,
    parent_assignment_status_id: activeStatus.assignment_status_id,
    parent_lease_id: leaseRecord.lease_id,
    from_agent_id: AGENT_ID,
    from_agent_version_id: assignmentRecord.agent_version_id,
    to_agent_id: TARGET_AGENT_ID,
    to_agent_version_id: targetVersion.agent_version_id,
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    parent_conversation_id: CONVERSATION_ID,
    parent_task_id: TASK_ID,
    parent_run_id: RUN_ID,
    child_conversation_id: CHILD_CONVERSATION_ID,
    child_task_id: CHILD_TASK_ID,
    child_run_id: CHILD_RUN_ID,
    lease_holder_id: SUPERVISOR_ID,
    delegated_goal: 'Review the draft layout risks and return findings for owner review.',
    delegated_at_ms: 90,
    permission_intersection: permissionIntersection(),
    budget_intersection: {
      max_steps: 5,
      max_tool_calls: 2,
      max_runtime_ms: 30_000,
      max_private_source_bytes: 8_192,
    },
    cancellation_policy: 'parent_cancellation_propagates_to_child',
    result_contract: 'child_result_returns_for_parent_review',
    materialization_boundary: 'no_direct_parent_mutation',
    ...overrides,
  };
}

function assertDelegationError(fn) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderAgentDelegationContractError);
      assert.equal(error.code, 'builder_agent_delegation_contract_invalid');
      const text = `${error.name}:${error.message}:${error.stack}`;
      assert.doesNotMatch(text, /secret-value|api\.deepseek|private marker|source text|raw delegation/iu);
      return true;
    },
  );
}

test('creates deterministic scoped delegation records without granting execution authority', () => {
  const { activeStatus, assignmentRecord, leaseRecord, targetDefinition, targetVersion } = fixture();
  const delegation = createBuilderAgentDelegationRecord(
    delegationInput(assignmentRecord, activeStatus, leaseRecord, targetVersion),
    assignmentRecord,
    activeStatus,
    leaseRecord,
    targetVersion,
    targetDefinition,
  );
  const sameDelegation = createBuilderAgentDelegationRecord(
    delegationInput(assignmentRecord, activeStatus, leaseRecord, targetVersion),
    assignmentRecord,
    activeStatus,
    leaseRecord,
    targetVersion,
    targetDefinition,
  );

  assert.deepEqual(delegation, sameDelegation);
  assert.match(delegation.delegation_id, /^builder-agent-delegation:[0-9a-f]{64}$/u);
  assert.equal(delegation.parent_definition_digest, assignmentRecord.definition_digest);
  assert.equal(delegation.target_definition_digest, targetDefinition.definition_digest);
  assert.equal(delegation.parent_assignment_id, assignmentRecord.assignment_id);
  assert.equal(delegation.parent_assignment_status_id, activeStatus.assignment_status_id);
  assert.equal(delegation.parent_lease_id, leaseRecord.lease_id);
  assert.equal(delegation.from_agent_id, AGENT_ID);
  assert.equal(delegation.to_agent_id, TARGET_AGENT_ID);
  assert.equal(delegation.child_task_id, CHILD_TASK_ID);
  assert.deepEqual(delegation.permission_intersection, permissionIntersection());
  assert.deepEqual(delegation.budget_intersection, {
    max_steps: 5,
    max_tool_calls: 2,
    max_runtime_ms: 30_000,
    max_private_source_bytes: 8_192,
  });
  assert.equal(delegation.cancellation_policy, 'parent_cancellation_propagates_to_child');
  assert.equal(delegation.result_contract, 'child_result_returns_for_parent_review');
  assert.equal(delegation.materialization_boundary, 'no_direct_parent_mutation');
  assert.equal(delegation.lifecycle.child_assignment, 'not_created_by_contract');
  assert.equal(delegation.lifecycle.permission_grant, 'not_created');
  assert.equal(delegation.lifecycle.tool_dispatch, 'not_performed_by_contract');
  assert.equal(delegation.lifecycle.project_revision, 'not_created');
  assert.equal(delegation.authority.child_assignment_authority, 'not_created_by_contract');
  assert.equal(delegation.authority.renderer_authority, 'not_present');
  assert.equal(delegation.authority.model_dispatch, false);
  assert.equal(delegation.authority.permission_grant, 'not_performed_by_contract');
  assert.equal(delegation.authority.source_write, 'not_performed_by_contract');
  assert.equal(delegation.authority.tool_dispatch, 'not_performed_by_contract');
  assert.equal(delegation.authority.revision_authority, 'not_present');
  assert.equal(Object.hasOwn(delegation, 'provider'), false);
  assert.equal(Object.hasOwn(delegation, 'credential'), false);
  assert.equal(Object.hasOwn(delegation, 'source_tree'), false);
  assert.equal(Object.hasOwn(delegation, 'permission_id'), false);
  assert.equal(Object.hasOwn(delegation, 'child_assignment_id'), false);
  assert.equal(Object.isFrozen(delegation), true);
  assert.equal(Object.isFrozen(delegation.permission_intersection), true);
  assert.equal(Object.isFrozen(delegation.budget_intersection), true);
  assert.deepEqual(
    sanitizeBuilderAgentDelegationRecord(
      structuredClone(delegation),
      assignmentRecord,
      activeStatus,
      leaseRecord,
      targetVersion,
      targetDefinition,
    ),
    delegation,
  );
});

test('rejects identity drift, broader budgets, permission grants, and direct materialization', () => {
  const { activeStatus, assignmentRecord, leaseRecord, targetDefinition, targetVersion } = fixture();

  assertDelegationError(() => createBuilderAgentDelegationRecord(
    delegationInput(assignmentRecord, activeStatus, leaseRecord, targetVersion, { to_agent_id: AGENT_ID }),
    assignmentRecord,
    activeStatus,
    leaseRecord,
    targetVersion,
    targetDefinition,
  ));
  const crossOwner = fixture({
    targetDefinition: { owner_id: OTHER_OWNER_ID },
    targetVersion: { owner_id: OTHER_OWNER_ID },
  });
  assertDelegationError(() => createBuilderAgentDelegationRecord(
    delegationInput(
      assignmentRecord,
      activeStatus,
      leaseRecord,
      crossOwner.targetVersion,
      { to_agent_version_id: crossOwner.targetVersion.agent_version_id },
    ),
    assignmentRecord,
    activeStatus,
    leaseRecord,
    crossOwner.targetVersion,
    crossOwner.targetDefinition,
  ));
  assertDelegationError(() => createBuilderAgentDelegationRecord(
    delegationInput(assignmentRecord, activeStatus, leaseRecord, targetVersion, {
      delegated_at_ms: 49,
    }),
    assignmentRecord,
    activeStatus,
    leaseRecord,
    targetVersion,
    targetDefinition,
  ));
  assertDelegationError(() => createBuilderAgentDelegationRecord(
    delegationInput(assignmentRecord, activeStatus, leaseRecord, targetVersion, {
      delegated_at_ms: 121,
    }),
    assignmentRecord,
    activeStatus,
    leaseRecord,
    targetVersion,
    targetDefinition,
  ));
  assertDelegationError(() => createBuilderAgentDelegationRecord(
    delegationInput(assignmentRecord, activeStatus, leaseRecord, targetVersion, {
      child_task_id: TASK_ID,
    }),
    assignmentRecord,
    activeStatus,
    leaseRecord,
    targetVersion,
    targetDefinition,
  ));
  assertDelegationError(() => createBuilderAgentDelegationRecord(
    delegationInput(assignmentRecord, activeStatus, leaseRecord, targetVersion, {
      budget_intersection: {
        ...assignmentRecord.budget,
        max_steps: assignmentRecord.budget.max_steps + 1,
      },
    }),
    assignmentRecord,
    activeStatus,
    leaseRecord,
    targetVersion,
    targetDefinition,
  ));
  assertDelegationError(() => createBuilderAgentDelegationRecord(
    delegationInput(assignmentRecord, activeStatus, leaseRecord, targetVersion, {
      permission_intersection: permissionIntersection({ external_resources: 'allowed' }),
    }),
    assignmentRecord,
    activeStatus,
    leaseRecord,
    targetVersion,
    targetDefinition,
  ));
  assertDelegationError(() => createBuilderAgentDelegationRecord(
    delegationInput(assignmentRecord, activeStatus, leaseRecord, targetVersion, {
      result_contract: 'direct_child_result_materialization',
    }),
    assignmentRecord,
    activeStatus,
    leaseRecord,
    targetVersion,
    targetDefinition,
  ));

  const delegation = createBuilderAgentDelegationRecord(
    delegationInput(assignmentRecord, activeStatus, leaseRecord, targetVersion),
    assignmentRecord,
    activeStatus,
    leaseRecord,
    targetVersion,
    targetDefinition,
  );
  assertDelegationError(() => sanitizeBuilderAgentDelegationRecord(
    {
      ...delegation,
      authority: {
        ...delegation.authority,
        model_dispatch: true,
      },
    },
    assignmentRecord,
    activeStatus,
    leaseRecord,
    targetVersion,
    targetDefinition,
  ));
});

test('fails closed on extras, accessors, and proxies without leaking raw input', () => {
  const { activeStatus, assignmentRecord, leaseRecord, targetDefinition, targetVersion } = fixture();

  assertDelegationError(() => createBuilderAgentDelegationRecord(
    {
      ...delegationInput(assignmentRecord, activeStatus, leaseRecord, targetVersion),
      extra: true,
    },
    assignmentRecord,
    activeStatus,
    leaseRecord,
    targetVersion,
    targetDefinition,
  ));
  assertDelegationError(() => createBuilderAgentDelegationRecord(
    delegationInput(assignmentRecord, activeStatus, leaseRecord, targetVersion, {
      delegated_goal: 'Use credential secret-value.\n',
    }),
    assignmentRecord,
    activeStatus,
    leaseRecord,
    targetVersion,
    targetDefinition,
  ));
  assertDelegationError(() => createBuilderAgentDelegationRecord(
    Object.defineProperty(
      delegationInput(assignmentRecord, activeStatus, leaseRecord, targetVersion),
      'delegated_goal',
      {
        enumerable: true,
        get() {
          throw new Error('secret-value');
        },
      },
    ),
    assignmentRecord,
    activeStatus,
    leaseRecord,
    targetVersion,
    targetDefinition,
  ));
  assertDelegationError(() => createBuilderAgentDelegationRecord(
    new Proxy(delegationInput(assignmentRecord, activeStatus, leaseRecord, targetVersion), {}),
    assignmentRecord,
    activeStatus,
    leaseRecord,
    targetVersion,
    targetDefinition,
  ));
});

test('source remains a pure local delegation contract without runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-delegation-contract.cjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /ipcMain|contextBridge|BrowserWindow|webContents|safeStorage|fetch\(|spawn|execFile|child_process|git|provider|credential|source_tree|saveDraft|accept_review/iu);
  assert.match(source, /not_created_by_contract/u);
  assert.match(source, /not_performed_by_contract/u);
  assert.match(source, /parent_child_intersection_only/u);
  assert.match(source, /child_result_returns_for_parent_review/u);
});
