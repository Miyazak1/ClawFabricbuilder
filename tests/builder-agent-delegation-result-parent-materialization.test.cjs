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
  createBuilderAgentDelegationResultRecord,
} = require('../electron/builder-agent-delegation-result-contract.cjs');
const {
  BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_RECORD_KIND,
  BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_RECORD_VERSION,
  createBuilderAgentDelegationResultAdmissionRecord,
} = require('../electron/builder-agent-delegation-result-admission-contract.cjs');
const {
  BUILDER_AGENT_DELEGATION_RESULT_REVIEW_RECORD_KIND,
  BUILDER_AGENT_DELEGATION_RESULT_REVIEW_RECORD_VERSION,
  createBuilderAgentDelegationResultReviewRecord,
} = require('../electron/builder-agent-delegation-result-review-contract.cjs');
const {
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_RECORD_KIND,
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_RECORD_VERSION,
  createBuilderAgentDelegationResultParentMaterializationEligibilityRecord,
} = require('../electron/builder-agent-delegation-result-parent-materialization-eligibility.cjs');
const {
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_CONTRACT_VERSION,
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_RECORD_KIND,
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_RECORD_VERSION,
  BuilderAgentDelegationResultParentMaterializationError,
  createBuilderAgentDelegationResultParentMaterializationRecord,
  sanitizeBuilderAgentDelegationResultParentMaterializationRecord,
} = require('../electron/builder-agent-delegation-result-parent-materialization.cjs');

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
  return { delegationRecord };
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

function admissionInput(resultRecord, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_RECORD_VERSION,
    record_kind: BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_RECORD_KIND,
    delegation_id: resultRecord.delegation_id,
    delegation_result_id: resultRecord.delegation_result_id,
    parent_assignment_id: resultRecord.parent_assignment_id,
    parent_assignment_status_id: resultRecord.parent_assignment_status_id,
    parent_lease_id: resultRecord.parent_lease_id,
    from_agent_id: resultRecord.from_agent_id,
    from_agent_version_id: resultRecord.from_agent_version_id,
    to_agent_id: resultRecord.to_agent_id,
    to_agent_version_id: resultRecord.to_agent_version_id,
    owner_id: resultRecord.owner_id,
    project_id: resultRecord.project_id,
    parent_conversation_id: resultRecord.parent_conversation_id,
    parent_task_id: resultRecord.parent_task_id,
    parent_run_id: resultRecord.parent_run_id,
    child_conversation_id: resultRecord.child_conversation_id,
    child_task_id: resultRecord.child_task_id,
    child_run_id: resultRecord.child_run_id,
    lease_holder_id: resultRecord.lease_holder_id,
    admitted_at_ms: 101,
    result: resultRecord.result,
    admission_status: 'admitted_for_parent_review',
    admission_summary_code: 'delegated_child_result_admitted_for_parent_review',
    admission_display_summary: 'Delegated result is admitted for parent review.',
    admission_contract: 'local_contribution_admitted_for_parent_review',
    parent_review_contract: 'owner_review_required_before_materialization',
    parent_materialization_boundary: 'no_direct_parent_mutation',
    ...overrides,
  };
}

function reviewInput(admissionRecord, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_DELEGATION_RESULT_REVIEW_RECORD_VERSION,
    record_kind: BUILDER_AGENT_DELEGATION_RESULT_REVIEW_RECORD_KIND,
    delegation_result_admission_id: admissionRecord.delegation_result_admission_id,
    delegation_result_id: admissionRecord.delegation_result_id,
    delegation_id: admissionRecord.delegation_id,
    parent_assignment_id: admissionRecord.parent_assignment_id,
    parent_assignment_status_id: admissionRecord.parent_assignment_status_id,
    parent_lease_id: admissionRecord.parent_lease_id,
    from_agent_id: admissionRecord.from_agent_id,
    from_agent_version_id: admissionRecord.from_agent_version_id,
    to_agent_id: admissionRecord.to_agent_id,
    to_agent_version_id: admissionRecord.to_agent_version_id,
    owner_id: admissionRecord.owner_id,
    project_id: admissionRecord.project_id,
    parent_conversation_id: admissionRecord.parent_conversation_id,
    parent_task_id: admissionRecord.parent_task_id,
    parent_run_id: admissionRecord.parent_run_id,
    child_conversation_id: admissionRecord.child_conversation_id,
    child_task_id: admissionRecord.child_task_id,
    child_run_id: admissionRecord.child_run_id,
    lease_holder_id: admissionRecord.lease_holder_id,
    reviewed_by: OWNER_ID,
    reviewed_at_ms: 102,
    result: admissionRecord.result,
    decision: 'approved_for_parent_materialization',
    decision_summary_code: 'delegated_child_result_approved_for_parent_materialization',
    decision_display_summary: 'Delegated result is approved for the parent materialization gate.',
    review_contract: 'owner_review_recorded_before_parent_materialization',
    parent_materialization_boundary: 'no_direct_parent_mutation',
    ...overrides,
  };
}

function eligibilityInput(reviewRecord, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_RECORD_VERSION,
    record_kind: BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_RECORD_KIND,
    delegation_result_review_id: reviewRecord.delegation_result_review_id,
    delegation_result_admission_id: reviewRecord.delegation_result_admission_id,
    delegation_result_id: reviewRecord.delegation_result_id,
    delegation_id: reviewRecord.delegation_id,
    parent_assignment_id: reviewRecord.parent_assignment_id,
    parent_assignment_status_id: reviewRecord.parent_assignment_status_id,
    parent_lease_id: reviewRecord.parent_lease_id,
    from_agent_id: reviewRecord.from_agent_id,
    from_agent_version_id: reviewRecord.from_agent_version_id,
    to_agent_id: reviewRecord.to_agent_id,
    to_agent_version_id: reviewRecord.to_agent_version_id,
    owner_id: reviewRecord.owner_id,
    project_id: reviewRecord.project_id,
    parent_conversation_id: reviewRecord.parent_conversation_id,
    parent_task_id: reviewRecord.parent_task_id,
    parent_run_id: reviewRecord.parent_run_id,
    child_conversation_id: reviewRecord.child_conversation_id,
    child_task_id: reviewRecord.child_task_id,
    child_run_id: reviewRecord.child_run_id,
    lease_holder_id: reviewRecord.lease_holder_id,
    eligibility_recorded_by: OWNER_ID,
    eligibility_recorded_at_ms: 103,
    result: reviewRecord.result,
    decision: 'approved_for_parent_materialization',
    eligibility_status: 'eligible_for_parent_materialization_gate',
    eligibility_summary_code: 'delegated_child_result_eligible_for_parent_materialization_gate',
    eligibility_display_summary: 'Delegated result is eligible for the later parent materialization gate.',
    eligibility_contract: 'owner_reviewed_delegated_result_recorded_for_later_parent_materialization',
    parent_materialization_boundary: 'no_direct_parent_mutation',
    ...overrides,
  };
}

function materializationInput(eligibilityRecord, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_RECORD_VERSION,
    record_kind: BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_RECORD_KIND,
    delegation_result_parent_materialization_eligibility_id:
      eligibilityRecord.delegation_result_parent_materialization_eligibility_id,
    delegation_result_review_id: eligibilityRecord.delegation_result_review_id,
    delegation_result_admission_id: eligibilityRecord.delegation_result_admission_id,
    delegation_result_id: eligibilityRecord.delegation_result_id,
    delegation_id: eligibilityRecord.delegation_id,
    parent_assignment_id: eligibilityRecord.parent_assignment_id,
    parent_assignment_status_id: eligibilityRecord.parent_assignment_status_id,
    parent_lease_id: eligibilityRecord.parent_lease_id,
    from_agent_id: eligibilityRecord.from_agent_id,
    from_agent_version_id: eligibilityRecord.from_agent_version_id,
    to_agent_id: eligibilityRecord.to_agent_id,
    to_agent_version_id: eligibilityRecord.to_agent_version_id,
    owner_id: eligibilityRecord.owner_id,
    project_id: eligibilityRecord.project_id,
    parent_conversation_id: eligibilityRecord.parent_conversation_id,
    parent_task_id: eligibilityRecord.parent_task_id,
    parent_run_id: eligibilityRecord.parent_run_id,
    child_conversation_id: eligibilityRecord.child_conversation_id,
    child_task_id: eligibilityRecord.child_task_id,
    child_run_id: eligibilityRecord.child_run_id,
    lease_holder_id: eligibilityRecord.lease_holder_id,
    materialized_by: OWNER_ID,
    materialized_at_ms: 104,
    result: eligibilityRecord.result,
    decision: 'approved_for_parent_materialization',
    eligibility_status: 'eligible_for_parent_materialization_gate',
    parent_context_status: 'materialized_as_parent_task_context_receipt',
    materialization_summary_code: 'delegated_child_result_materialized_as_parent_context_receipt',
    materialization_display_summary:
      'Delegated result is recorded as a parent task context receipt for later owner-supervised use.',
    materialization_contract: 'approved_delegated_result_recorded_as_parent_task_context_receipt',
    parent_materialization_boundary: 'no_source_no_artifact_no_revision_mutation',
    ...overrides,
  };
}

function proposedChain() {
  const { delegationRecord } = fixture();
  const resultRecord = createBuilderAgentDelegationResultRecord(resultInput(delegationRecord), delegationRecord);
  const admissionRecord = createBuilderAgentDelegationResultAdmissionRecord(
    admissionInput(resultRecord),
    resultRecord,
    delegationRecord,
  );
  const reviewRecord = createBuilderAgentDelegationResultReviewRecord(
    reviewInput(admissionRecord),
    admissionRecord,
    resultRecord,
    delegationRecord,
  );
  const eligibilityRecord = createBuilderAgentDelegationResultParentMaterializationEligibilityRecord(
    eligibilityInput(reviewRecord),
    reviewRecord,
    admissionRecord,
    resultRecord,
    delegationRecord,
  );
  return { admissionRecord, delegationRecord, eligibilityRecord, resultRecord, reviewRecord };
}

function assertParentMaterializationError(fn) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderAgentDelegationResultParentMaterializationError);
      assert.equal(
        error.code,
        'builder_agent_delegation_result_parent_materialization_invalid',
      );
      const text = `${error.name}:${error.message}:${error.stack}`;
      assert.doesNotMatch(text, /secret-value|api\.deepseek|private marker|source text|raw child output|patch body/iu);
      return true;
    },
  );
}

test('creates deterministic parent context materialization receipts from eligible delegated results', () => {
  const { admissionRecord, delegationRecord, eligibilityRecord, resultRecord, reviewRecord } = proposedChain();
  const materialization = createBuilderAgentDelegationResultParentMaterializationRecord(
    materializationInput(eligibilityRecord),
    eligibilityRecord,
    reviewRecord,
    admissionRecord,
    resultRecord,
    delegationRecord,
  );
  const sameMaterialization = createBuilderAgentDelegationResultParentMaterializationRecord(
    materializationInput(eligibilityRecord),
    eligibilityRecord,
    reviewRecord,
    admissionRecord,
    resultRecord,
    delegationRecord,
  );

  assert.equal(
    BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_CONTRACT_VERSION,
    'builder-agent-delegation-result-parent-materialization-contract.v1',
  );
  assert.deepEqual(materialization, sameMaterialization);
  assert.match(
    materialization.delegation_result_parent_materialization_id,
    /^builder-agent-delegation-result-parent-materialization:[0-9a-f]{64}$/u,
  );
  assert.match(
    materialization.delegation_result_parent_materialization_eligibility_digest,
    /^sha256:[0-9a-f]{64}$/u,
  );
  assert.equal(
    materialization.delegation_result_parent_materialization_eligibility_id,
    eligibilityRecord.delegation_result_parent_materialization_eligibility_id,
  );
  assert.equal(materialization.delegation_result_review_id, reviewRecord.delegation_result_review_id);
  assert.equal(materialization.delegation_result_admission_id, admissionRecord.delegation_result_admission_id);
  assert.equal(materialization.delegation_result_id, resultRecord.delegation_result_id);
  assert.equal(materialization.delegation_id, delegationRecord.delegation_id);
  assert.equal(materialization.parent_task_id, TASK_ID);
  assert.equal(materialization.child_task_id, CHILD_TASK_ID);
  assert.deepEqual(materialization.result, eligibilityRecord.result);
  assert.equal(materialization.parent_context_status, 'materialized_as_parent_task_context_receipt');
  assert.equal(
    materialization.materialization_contract,
    'approved_delegated_result_recorded_as_parent_task_context_receipt',
  );
  assert.equal(materialization.parent_materialization_boundary, 'no_source_no_artifact_no_revision_mutation');
  assert.equal(
    materialization.lifecycle.parent_materialization_eligibility,
    'verified_eligible_for_parent_materialization_gate',
  );
  assert.equal(
    materialization.lifecycle.parent_context_materialization,
    'recorded_as_parent_task_context_receipt',
  );
  assert.equal(materialization.lifecycle.parent_source_mutation, 'not_performed_by_contract');
  assert.equal(materialization.lifecycle.project_revision, 'not_created');
  assert.equal(materialization.lifecycle.artifact, 'not_created');
  assert.equal(
    materialization.authority.record_authority,
    'main_agent_delegation_result_parent_materialization_contract_v1',
  );
  assert.equal(
    materialization.authority.parent_materialization_eligibility_authority,
    'main_agent_delegation_result_parent_materialization_eligibility_contract_v1',
  );
  assert.equal(materialization.authority.parent_context_authority, 'local_parent_task_context_receipt_only');
  assert.equal(materialization.authority.renderer_authority, 'not_present');
  assert.equal(materialization.authority.model_dispatch, false);
  assert.equal(materialization.authority.source_write, 'not_performed_by_contract');
  assert.equal(materialization.authority.artifact_authority, 'not_created_by_contract');
  assert.equal(Object.hasOwn(materialization, 'raw_output'), false);
  assert.equal(Object.hasOwn(materialization, 'patch'), false);
  assert.equal(Object.hasOwn(materialization, 'source_tree'), false);
  assert.equal(Object.hasOwn(materialization, 'review_id'), false);
  assert.equal(Object.hasOwn(materialization, 'artifact_id'), false);
  assert.equal(Object.isFrozen(materialization), true);
  assert.equal(Object.isFrozen(materialization.result), true);
  assert.equal(Object.isFrozen(materialization.lifecycle), true);
  assert.equal(Object.isFrozen(materialization.authority), true);
  assert.deepEqual(
    sanitizeBuilderAgentDelegationResultParentMaterializationRecord(
      structuredClone(materialization),
      eligibilityRecord,
      reviewRecord,
      admissionRecord,
      resultRecord,
      delegationRecord,
    ),
    materialization,
  );
});

test('rejects timing, owner, identity, eligibility, and parent mutation drift', () => {
  const { admissionRecord, delegationRecord, eligibilityRecord, resultRecord, reviewRecord } = proposedChain();
  const input = materializationInput(eligibilityRecord);

  assertParentMaterializationError(() => createBuilderAgentDelegationResultParentMaterializationRecord(
    { ...input, materialized_at_ms: eligibilityRecord.eligibility_recorded_at_ms - 1 },
    eligibilityRecord,
    reviewRecord,
    admissionRecord,
    resultRecord,
    delegationRecord,
  ));
  assertParentMaterializationError(() => createBuilderAgentDelegationResultParentMaterializationRecord(
    { ...input, materialized_by: OTHER_OWNER_ID },
    eligibilityRecord,
    reviewRecord,
    admissionRecord,
    resultRecord,
    delegationRecord,
  ));
  assertParentMaterializationError(() => createBuilderAgentDelegationResultParentMaterializationRecord(
    {
      ...input,
      delegation_result_parent_materialization_eligibility_id:
        'builder-agent-delegation-result-parent-materialization-eligibility:'.concat('0'.repeat(64)),
    },
    eligibilityRecord,
    reviewRecord,
    admissionRecord,
    resultRecord,
    delegationRecord,
  ));
  assertParentMaterializationError(() => createBuilderAgentDelegationResultParentMaterializationRecord(
    { ...input, decision: 'rejected' },
    eligibilityRecord,
    reviewRecord,
    admissionRecord,
    resultRecord,
    delegationRecord,
  ));
  assertParentMaterializationError(() => createBuilderAgentDelegationResultParentMaterializationRecord(
    { ...input, eligibility_status: 'not_eligible' },
    eligibilityRecord,
    reviewRecord,
    admissionRecord,
    resultRecord,
    delegationRecord,
  ));
  assertParentMaterializationError(() => createBuilderAgentDelegationResultParentMaterializationRecord(
    { ...input, parent_context_status: 'mutated_parent_task' },
    eligibilityRecord,
    reviewRecord,
    admissionRecord,
    resultRecord,
    delegationRecord,
  ));
  assertParentMaterializationError(() => createBuilderAgentDelegationResultParentMaterializationRecord(
    { ...input, parent_materialization_boundary: 'write_source_tree' },
    eligibilityRecord,
    reviewRecord,
    admissionRecord,
    resultRecord,
    delegationRecord,
  ));
  assertParentMaterializationError(() => sanitizeBuilderAgentDelegationResultParentMaterializationRecord({
    ...createBuilderAgentDelegationResultParentMaterializationRecord(
      input,
      eligibilityRecord,
      reviewRecord,
      admissionRecord,
      resultRecord,
      delegationRecord,
    ),
    lifecycle: {
      ...createBuilderAgentDelegationResultParentMaterializationRecord(
        input,
        eligibilityRecord,
        reviewRecord,
        admissionRecord,
        resultRecord,
        delegationRecord,
      ).lifecycle,
      artifact: 'created',
    },
  }, eligibilityRecord, reviewRecord, admissionRecord, resultRecord, delegationRecord));
});

test('fails closed on extras, accessors, proxies, and forged eligibility records', () => {
  const { admissionRecord, delegationRecord, eligibilityRecord, resultRecord, reviewRecord } = proposedChain();
  assertParentMaterializationError(() => createBuilderAgentDelegationResultParentMaterializationRecord({
    ...materializationInput(eligibilityRecord),
    raw_output: 'secret-value',
  }, eligibilityRecord, reviewRecord, admissionRecord, resultRecord, delegationRecord));

  let getterCalls = 0;
  const accessor = materializationInput(eligibilityRecord);
  Object.defineProperty(accessor, 'result', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('private getter marker');
    },
  });
  assertParentMaterializationError(() => createBuilderAgentDelegationResultParentMaterializationRecord(
    accessor,
    eligibilityRecord,
    reviewRecord,
    admissionRecord,
    resultRecord,
    delegationRecord,
  ));
  assert.equal(getterCalls, 0);

  let proxyTrapInvoked = false;
  const proxyTrap = () => {
    proxyTrapInvoked = true;
    throw new Error('private proxy marker');
  };
  assertParentMaterializationError(() => createBuilderAgentDelegationResultParentMaterializationRecord(new Proxy(
    materializationInput(eligibilityRecord),
    {
      getOwnPropertyDescriptor: proxyTrap,
      getPrototypeOf: proxyTrap,
      ownKeys: proxyTrap,
    },
  ), eligibilityRecord, reviewRecord, admissionRecord, resultRecord, delegationRecord));
  assert.equal(proxyTrapInvoked, false);

  assertParentMaterializationError(() => createBuilderAgentDelegationResultParentMaterializationRecord(
    materializationInput(eligibilityRecord),
    {
      ...eligibilityRecord,
      eligibility_status: 'not_eligible',
      eligibility_summary_code: 'delegated_child_result_not_eligible',
      eligibility_display_summary: 'Delegated result is not eligible.',
    },
    reviewRecord,
    admissionRecord,
    resultRecord,
    delegationRecord,
  ));
});

test('source remains a pure parent context receipt without runtime or source authority', () => {
  const source = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'electron',
      'builder-agent-delegation-result-parent-materialization.cjs',
    ),
    'utf8',
  );
  assert.match(source, /main_agent_delegation_result_parent_materialization_contract_v1/u);
  assert.match(source, /recorded_as_parent_task_context_receipt/u);
  assert.match(source, /no_source_no_artifact_no_revision_mutation/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:http|node:https|http|https|node:fs|fs)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|dugite|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|shell:\s*true|localStorage|sessionStorage|indexedDB|better-sqlite|eval\s*\(|new Function/iu,
  );
});
