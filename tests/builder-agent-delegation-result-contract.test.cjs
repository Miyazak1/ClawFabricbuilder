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
  createBuilderAgentDelegationRecord,
} = require('../electron/builder-agent-delegation-contract.cjs');
const {
  BUILDER_AGENT_DELEGATION_RESULT_RECORD_KIND,
  BUILDER_AGENT_DELEGATION_RESULT_RECORD_VERSION,
  BuilderAgentDelegationResultContractError,
  createBuilderAgentDelegationResultRecord,
  sanitizeBuilderAgentDelegationResultRecord,
} = require('../electron/builder-agent-delegation-result-contract.cjs');

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
  const delegationRecord = createBuilderAgentDelegationRecord(
    delegationInput(assignmentRecord, activeStatus, leaseRecord, targetVersion, overrides.delegation ?? {}),
    assignmentRecord,
    activeStatus,
    leaseRecord,
    targetVersion,
    targetDefinition,
  );
  return { activeStatus, assignmentRecord, delegationRecord, leaseRecord, targetDefinition, targetVersion };
}

function permissionIntersection() {
  return {
    parent_boundary: 'explicit_permission_required',
    child_boundary: 'explicit_permission_required',
    effective_boundary: 'parent_child_intersection_only',
    external_resources: 'not_granted_by_delegation',
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

function resultInput(delegationRecord, overrides = {}) {
  const result = overrides.result ?? {
    status: 'proposed',
    summary_code: 'delegated_child_result_ready_for_parent_review',
  };
  return {
    record_version: BUILDER_AGENT_DELEGATION_RESULT_RECORD_VERSION,
    record_kind: BUILDER_AGENT_DELEGATION_RESULT_RECORD_KIND,
    delegation_id: delegationRecord.delegation_id,
    parent_assignment_id: delegationRecord.parent_assignment_id,
    parent_assignment_status_id: delegationRecord.parent_assignment_status_id,
    parent_lease_id: delegationRecord.parent_lease_id,
    from_agent_id: delegationRecord.from_agent_id,
    from_agent_version_id: delegationRecord.from_agent_version_id,
    to_agent_id: delegationRecord.to_agent_id,
    to_agent_version_id: delegationRecord.to_agent_version_id,
    owner_id: delegationRecord.owner_id,
    project_id: delegationRecord.project_id,
    parent_conversation_id: delegationRecord.parent_conversation_id,
    parent_task_id: delegationRecord.parent_task_id,
    parent_run_id: delegationRecord.parent_run_id,
    child_conversation_id: delegationRecord.child_conversation_id,
    child_task_id: delegationRecord.child_task_id,
    child_run_id: delegationRecord.child_run_id,
    lease_holder_id: delegationRecord.lease_holder_id,
    observed_at_ms: 100,
    result,
    return_contract: 'child_result_returned_for_parent_review',
    parent_materialization_boundary: 'no_direct_parent_mutation',
    ...overrides,
  };
}

function assertResultError(fn) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderAgentDelegationResultContractError);
      assert.equal(error.code, 'builder_agent_delegation_result_contract_invalid');
      const text = `${error.name}:${error.message}:${error.stack}`;
      assert.doesNotMatch(text, /secret-value|api\.deepseek|private marker|source text|raw child output|patch body/iu);
      return true;
    },
  );
}

test('creates deterministic delegated child result return records without parent mutation authority', () => {
  const { delegationRecord } = fixture();
  const result = createBuilderAgentDelegationResultRecord(resultInput(delegationRecord), delegationRecord);
  const sameResult = createBuilderAgentDelegationResultRecord(resultInput(delegationRecord), delegationRecord);
  const blocked = createBuilderAgentDelegationResultRecord(resultInput(delegationRecord, {
    result: {
      status: 'blocked',
      summary_code: 'delegated_child_result_needs_owner_attention',
    },
  }), delegationRecord);

  assert.deepEqual(result, sameResult);
  assert.match(result.delegation_result_id, /^builder-agent-delegation-result:[0-9a-f]{64}$/u);
  assert.equal(result.delegation_definition_digest, delegationRecord.parent_definition_digest);
  assert.equal(result.target_definition_digest, delegationRecord.target_definition_digest);
  assert.equal(result.delegation_id, delegationRecord.delegation_id);
  assert.equal(result.parent_task_id, TASK_ID);
  assert.equal(result.child_task_id, CHILD_TASK_ID);
  assert.equal(result.observed_at_ms, 100);
  assert.equal(result.result.status, 'proposed');
  assert.equal(result.result.display_summary, 'Delegated result is ready for parent review.');
  assert.equal(result.return_contract, 'child_result_returned_for_parent_review');
  assert.equal(result.parent_materialization_boundary, 'no_direct_parent_mutation');
  assert.equal(result.lifecycle.delegation, 'verified_recorded_delegation');
  assert.equal(result.lifecycle.child_result_return, 'recorded_for_parent_review');
  assert.equal(result.lifecycle.parent_review, 'owner_review_required');
  assert.equal(result.lifecycle.parent_materialization, 'not_performed_by_contract');
  assert.equal(result.lifecycle.child_assignment, 'not_created_by_contract');
  assert.equal(result.lifecycle.project_revision, 'not_created');
  assert.equal(result.authority.delegation_authority, 'main_agent_delegation_contract_v1');
  assert.equal(result.authority.child_assignment_authority, 'not_created_by_contract');
  assert.equal(result.authority.renderer_authority, 'not_present');
  assert.equal(result.authority.model_dispatch, false);
  assert.equal(result.authority.permission_grant, 'not_performed_by_contract');
  assert.equal(result.authority.source_write, 'not_performed_by_contract');
  assert.equal(result.authority.review_authority, 'not_created_by_contract');
  assert.equal(result.authority.artifact_authority, 'not_created_by_contract');
  assert.equal(Object.hasOwn(result, 'raw_output'), false);
  assert.equal(Object.hasOwn(result, 'patch'), false);
  assert.equal(Object.hasOwn(result, 'source_tree'), false);
  assert.equal(Object.hasOwn(result, 'permission_id'), false);
  assert.equal(Object.hasOwn(result, 'child_assignment_id'), false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.result), true);
  assert.equal(Object.isFrozen(result.lifecycle), true);
  assert.equal(Object.isFrozen(result.authority), true);
  assert.equal(blocked.result.display_summary, 'Delegated result needs owner attention.');
  assert.deepEqual(sanitizeBuilderAgentDelegationResultRecord(structuredClone(result), delegationRecord), result);
});

test('rejects delegation drift, premature results, malformed outcomes, and direct materialization', () => {
  const { delegationRecord } = fixture();
  assertResultError(() => createBuilderAgentDelegationResultRecord(
    resultInput(delegationRecord, { observed_at_ms: 89 }),
    delegationRecord,
  ));
  assertResultError(() => createBuilderAgentDelegationResultRecord(
    resultInput(delegationRecord, { owner_id: OTHER_OWNER_ID }),
    delegationRecord,
  ));
  assertResultError(() => createBuilderAgentDelegationResultRecord(
    resultInput(delegationRecord, { child_task_id: TASK_ID }),
    delegationRecord,
  ));
  assertResultError(() => createBuilderAgentDelegationResultRecord(
    resultInput(delegationRecord, {
      result: {
        status: 'proposed',
        summary_code: 'delegated_child_result_needs_owner_attention',
      },
    }),
    delegationRecord,
  ));
  assertResultError(() => createBuilderAgentDelegationResultRecord(
    resultInput(delegationRecord, { return_contract: 'direct_parent_mutation_allowed' }),
    delegationRecord,
  ));
  assertResultError(() => createBuilderAgentDelegationResultRecord(
    resultInput(delegationRecord, { parent_materialization_boundary: 'mutate_parent_task' }),
    delegationRecord,
  ));
  assertResultError(() => sanitizeBuilderAgentDelegationResultRecord({
    ...createBuilderAgentDelegationResultRecord(resultInput(delegationRecord), delegationRecord),
    authority: {
      ...createBuilderAgentDelegationResultRecord(resultInput(delegationRecord), delegationRecord).authority,
      review_authority: 'created',
    },
  }, delegationRecord));
});

test('fails closed on extras, accessors, proxies, and forged delegation records', () => {
  const { delegationRecord } = fixture();
  assertResultError(() => createBuilderAgentDelegationResultRecord({
    ...resultInput(delegationRecord),
    extra: 'secret-value',
  }, delegationRecord));

  let getterCalls = 0;
  const accessor = resultInput(delegationRecord);
  Object.defineProperty(accessor, 'result', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('private getter marker');
    },
  });
  assertResultError(() => createBuilderAgentDelegationResultRecord(accessor, delegationRecord));
  assert.equal(getterCalls, 0);

  let proxyTrapInvoked = false;
  const proxyTrap = () => {
    proxyTrapInvoked = true;
    throw new Error('private proxy marker');
  };
  assertResultError(() => createBuilderAgentDelegationResultRecord(new Proxy(resultInput(delegationRecord), {
    getOwnPropertyDescriptor: proxyTrap,
    getPrototypeOf: proxyTrap,
    ownKeys: proxyTrap,
  }), delegationRecord));
  assert.equal(proxyTrapInvoked, false);

  assertResultError(() => createBuilderAgentDelegationResultRecord(resultInput(delegationRecord), {
    ...delegationRecord,
    authority: {
      ...delegationRecord.authority,
      model_dispatch: true,
    },
  }));
  assertResultError(() => createBuilderAgentDelegationResultRecord(resultInput(delegationRecord), {
    ...delegationRecord,
    lifecycle: {
      ...delegationRecord.lifecycle,
      child_assignment: 'created',
    },
  }));
});

test('source remains a pure local delegation result contract without runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-delegation-result-contract.cjs'),
    'utf8',
  );
  assert.match(source, /main_agent_delegation_result_contract_v1/u);
  assert.match(source, /child_result_returned_for_parent_review/u);
  assert.match(source, /no_direct_parent_mutation/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:http|node:https|http|https|node:fs|fs)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|dugite|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|shell:\s*true|localStorage|sessionStorage|indexedDB|better-sqlite|eval\s*\(|new Function/iu,
  );
});
