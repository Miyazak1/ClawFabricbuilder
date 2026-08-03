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
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_CONTRACT_VERSION,
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_RECORD_KIND,
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_RECORD_VERSION,
  BuilderAgentDelegationResultParentMaterializationEligibilityError,
  createBuilderAgentDelegationResultParentMaterializationEligibilityRecord,
  sanitizeBuilderAgentDelegationResultParentMaterializationEligibilityRecord,
} = require('../electron/builder-agent-delegation-result-parent-materialization-eligibility.cjs');

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

function proposedChain(reviewOverrides = {}) {
  const { delegationRecord } = fixture();
  const resultRecord = createBuilderAgentDelegationResultRecord(resultInput(delegationRecord), delegationRecord);
  const admissionRecord = createBuilderAgentDelegationResultAdmissionRecord(
    admissionInput(resultRecord),
    resultRecord,
    delegationRecord,
  );
  const reviewRecord = createBuilderAgentDelegationResultReviewRecord(
    reviewInput(admissionRecord, reviewOverrides),
    admissionRecord,
    resultRecord,
    delegationRecord,
  );
  return { admissionRecord, delegationRecord, resultRecord, reviewRecord };
}

function blockedChain() {
  const { delegationRecord } = fixture();
  const resultRecord = createBuilderAgentDelegationResultRecord(resultInput(delegationRecord, {
    result: {
      status: 'blocked',
      summary_code: 'delegated_child_result_needs_owner_attention',
    },
  }), delegationRecord);
  const admissionRecord = createBuilderAgentDelegationResultAdmissionRecord(
    admissionInput(resultRecord, {
      result: resultRecord.result,
      admission_summary_code: 'delegated_child_blocker_admitted_for_owner_attention',
      admission_display_summary: 'Delegated blocker is admitted for owner attention.',
    }),
    resultRecord,
    delegationRecord,
  );
  const reviewRecord = createBuilderAgentDelegationResultReviewRecord(
    reviewInput(admissionRecord, {
      result: admissionRecord.result,
      decision: 'acknowledged_without_materialization',
      decision_summary_code: 'delegated_child_result_acknowledged_without_materialization',
      decision_display_summary: 'Delegated result was acknowledged without materialization.',
    }),
    admissionRecord,
    resultRecord,
    delegationRecord,
  );
  return { admissionRecord, delegationRecord, resultRecord, reviewRecord };
}

function assertEligibilityError(fn) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderAgentDelegationResultParentMaterializationEligibilityError);
      assert.equal(
        error.code,
        'builder_agent_delegation_result_parent_materialization_eligibility_invalid',
      );
      const text = `${error.name}:${error.message}:${error.stack}`;
      assert.doesNotMatch(text, /secret-value|api\.deepseek|private marker|source text|raw child output|patch body/iu);
      return true;
    },
  );
}

test('creates deterministic parent materialization eligibility only from approved proposed reviews', () => {
  const { admissionRecord, delegationRecord, resultRecord, reviewRecord } = proposedChain();
  const eligibility = createBuilderAgentDelegationResultParentMaterializationEligibilityRecord(
    eligibilityInput(reviewRecord),
    reviewRecord,
    admissionRecord,
    resultRecord,
    delegationRecord,
  );
  const sameEligibility = createBuilderAgentDelegationResultParentMaterializationEligibilityRecord(
    eligibilityInput(reviewRecord),
    reviewRecord,
    admissionRecord,
    resultRecord,
    delegationRecord,
  );

  assert.equal(
    BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_CONTRACT_VERSION,
    'builder-agent-delegation-result-parent-materialization-eligibility-contract.v1',
  );
  assert.deepEqual(eligibility, sameEligibility);
  assert.match(
    eligibility.delegation_result_parent_materialization_eligibility_id,
    /^builder-agent-delegation-result-parent-materialization-eligibility:[0-9a-f]{64}$/u,
  );
  assert.match(eligibility.delegation_result_review_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(eligibility.delegation_result_review_id, reviewRecord.delegation_result_review_id);
  assert.equal(eligibility.delegation_result_admission_id, admissionRecord.delegation_result_admission_id);
  assert.equal(eligibility.delegation_result_id, resultRecord.delegation_result_id);
  assert.equal(eligibility.delegation_id, delegationRecord.delegation_id);
  assert.equal(eligibility.parent_task_id, TASK_ID);
  assert.equal(eligibility.child_task_id, CHILD_TASK_ID);
  assert.deepEqual(eligibility.result, reviewRecord.result);
  assert.equal(eligibility.decision, 'approved_for_parent_materialization');
  assert.equal(eligibility.eligibility_status, 'eligible_for_parent_materialization_gate');
  assert.equal(
    eligibility.eligibility_contract,
    'owner_reviewed_delegated_result_recorded_for_later_parent_materialization',
  );
  assert.equal(eligibility.parent_materialization_boundary, 'no_direct_parent_mutation');
  assert.equal(eligibility.lifecycle.owner_review, 'verified_owner_approved_for_parent_materialization');
  assert.equal(eligibility.lifecycle.parent_materialization_eligibility, 'recorded_for_later_gate');
  assert.equal(eligibility.lifecycle.parent_materialization, 'not_performed_by_contract');
  assert.equal(eligibility.lifecycle.project_revision, 'not_created');
  assert.equal(eligibility.lifecycle.artifact, 'not_created');
  assert.equal(
    eligibility.authority.record_authority,
    'main_agent_delegation_result_parent_materialization_eligibility_contract_v1',
  );
  assert.equal(eligibility.authority.delegation_result_review_authority, 'main_agent_delegation_result_review_contract_v1');
  assert.equal(eligibility.authority.parent_materialization_eligibility_authority, 'local_receipt_only');
  assert.equal(eligibility.authority.renderer_authority, 'not_present');
  assert.equal(eligibility.authority.model_dispatch, false);
  assert.equal(eligibility.authority.source_write, 'not_performed_by_contract');
  assert.equal(eligibility.authority.artifact_authority, 'not_created_by_contract');
  assert.equal(Object.hasOwn(eligibility, 'raw_output'), false);
  assert.equal(Object.hasOwn(eligibility, 'patch'), false);
  assert.equal(Object.hasOwn(eligibility, 'source_tree'), false);
  assert.equal(Object.hasOwn(eligibility, 'review_id'), false);
  assert.equal(Object.hasOwn(eligibility, 'artifact_id'), false);
  assert.equal(Object.isFrozen(eligibility), true);
  assert.equal(Object.isFrozen(eligibility.result), true);
  assert.equal(Object.isFrozen(eligibility.lifecycle), true);
  assert.equal(Object.isFrozen(eligibility.authority), true);
  assert.deepEqual(
    sanitizeBuilderAgentDelegationResultParentMaterializationEligibilityRecord(
      structuredClone(eligibility),
      reviewRecord,
      admissionRecord,
      resultRecord,
      delegationRecord,
    ),
    eligibility,
  );
});

test('rejects rejected or acknowledged child result reviews', () => {
  const rejected = proposedChain({
    decision: 'rejected',
    decision_summary_code: 'delegated_child_result_rejected_by_owner',
    decision_display_summary: 'Delegated result was rejected by the owner.',
  });
  assertEligibilityError(() => createBuilderAgentDelegationResultParentMaterializationEligibilityRecord(
    eligibilityInput(rejected.reviewRecord),
    rejected.reviewRecord,
    rejected.admissionRecord,
    rejected.resultRecord,
    rejected.delegationRecord,
  ));

  const blocked = blockedChain();
  assertEligibilityError(() => createBuilderAgentDelegationResultParentMaterializationEligibilityRecord(
    eligibilityInput(blocked.reviewRecord),
    blocked.reviewRecord,
    blocked.admissionRecord,
    blocked.resultRecord,
    blocked.delegationRecord,
  ));
});

test('rejects timing, owner, identity, and parent mutation authority drift', () => {
  const { admissionRecord, delegationRecord, resultRecord, reviewRecord } = proposedChain();
  const input = eligibilityInput(reviewRecord);

  assertEligibilityError(() => createBuilderAgentDelegationResultParentMaterializationEligibilityRecord(
    { ...input, eligibility_recorded_at_ms: reviewRecord.reviewed_at_ms - 1 },
    reviewRecord,
    admissionRecord,
    resultRecord,
    delegationRecord,
  ));
  assertEligibilityError(() => createBuilderAgentDelegationResultParentMaterializationEligibilityRecord(
    { ...input, eligibility_recorded_by: OTHER_OWNER_ID },
    reviewRecord,
    admissionRecord,
    resultRecord,
    delegationRecord,
  ));
  assertEligibilityError(() => createBuilderAgentDelegationResultParentMaterializationEligibilityRecord(
    { ...input, delegation_result_review_id: 'builder-agent-delegation-result-review:'.concat('0'.repeat(64)) },
    reviewRecord,
    admissionRecord,
    resultRecord,
    delegationRecord,
  ));
  assertEligibilityError(() => createBuilderAgentDelegationResultParentMaterializationEligibilityRecord(
    { ...input, decision: 'rejected' },
    reviewRecord,
    admissionRecord,
    resultRecord,
    delegationRecord,
  ));
  assertEligibilityError(() => createBuilderAgentDelegationResultParentMaterializationEligibilityRecord(
    { ...input, eligibility_status: 'materialized_into_parent_task' },
    reviewRecord,
    admissionRecord,
    resultRecord,
    delegationRecord,
  ));
  assertEligibilityError(() => createBuilderAgentDelegationResultParentMaterializationEligibilityRecord(
    { ...input, eligibility_contract: 'mutate_parent_task_now' },
    reviewRecord,
    admissionRecord,
    resultRecord,
    delegationRecord,
  ));
  assertEligibilityError(() => createBuilderAgentDelegationResultParentMaterializationEligibilityRecord(
    { ...input, parent_materialization_boundary: 'mutate_parent_task' },
    reviewRecord,
    admissionRecord,
    resultRecord,
    delegationRecord,
  ));
  assertEligibilityError(() => sanitizeBuilderAgentDelegationResultParentMaterializationEligibilityRecord({
    ...createBuilderAgentDelegationResultParentMaterializationEligibilityRecord(
      input,
      reviewRecord,
      admissionRecord,
      resultRecord,
      delegationRecord,
    ),
    lifecycle: {
      ...createBuilderAgentDelegationResultParentMaterializationEligibilityRecord(
        input,
        reviewRecord,
        admissionRecord,
        resultRecord,
        delegationRecord,
      ).lifecycle,
      parent_materialization: 'performed',
    },
  }, reviewRecord, admissionRecord, resultRecord, delegationRecord));
});

test('fails closed on extras, accessors, proxies, and forged review records', () => {
  const { admissionRecord, delegationRecord, resultRecord, reviewRecord } = proposedChain();
  assertEligibilityError(() => createBuilderAgentDelegationResultParentMaterializationEligibilityRecord({
    ...eligibilityInput(reviewRecord),
    raw_output: 'secret-value',
  }, reviewRecord, admissionRecord, resultRecord, delegationRecord));

  let getterCalls = 0;
  const accessor = eligibilityInput(reviewRecord);
  Object.defineProperty(accessor, 'result', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('private getter marker');
    },
  });
  assertEligibilityError(() => createBuilderAgentDelegationResultParentMaterializationEligibilityRecord(
    accessor,
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
  assertEligibilityError(() => createBuilderAgentDelegationResultParentMaterializationEligibilityRecord(new Proxy(
    eligibilityInput(reviewRecord),
    {
      getOwnPropertyDescriptor: proxyTrap,
      getPrototypeOf: proxyTrap,
      ownKeys: proxyTrap,
    },
  ), reviewRecord, admissionRecord, resultRecord, delegationRecord));
  assert.equal(proxyTrapInvoked, false);

  assertEligibilityError(() => createBuilderAgentDelegationResultParentMaterializationEligibilityRecord(
    eligibilityInput(reviewRecord),
    {
      ...reviewRecord,
      decision: 'rejected',
      decision_summary_code: 'delegated_child_result_rejected_by_owner',
      decision_display_summary: 'Delegated result was rejected by the owner.',
    },
    admissionRecord,
    resultRecord,
    delegationRecord,
  ));
});

test('source remains a pure eligibility receipt without runtime or parent mutation authority', () => {
  const source = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'electron',
      'builder-agent-delegation-result-parent-materialization-eligibility.cjs',
    ),
    'utf8',
  );
  assert.match(source, /main_agent_delegation_result_parent_materialization_eligibility_contract_v1/u);
  assert.match(source, /recorded_for_later_gate/u);
  assert.match(source, /no_direct_parent_mutation/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:http|node:https|http|https|node:fs|fs)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|dugite|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|shell:\s*true|localStorage|sessionStorage|indexedDB|better-sqlite|eval\s*\(|new Function/iu,
  );
});
