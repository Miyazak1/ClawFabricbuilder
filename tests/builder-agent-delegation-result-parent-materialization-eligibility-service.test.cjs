'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_AGENT_DEFINITION_RECORD_VERSION,
  BUILDER_AGENT_LIFECYCLE_RECORD_VERSION,
  BUILDER_AGENT_VERSION_RECORD_VERSION,
  createBuilderAgentDefinitionRecord,
  createBuilderAgentLifecycleRecord,
  createBuilderAgentVersionRecord,
} = require('../electron/builder-agent-definition-contract.cjs');
const {
  createBuilderAgentDefinitionStore,
} = require('../electron/builder-agent-definition-store.cjs');
const {
  BUILDER_AGENT_ASSIGNMENT_RECORD_VERSION,
  BUILDER_AGENT_ASSIGNMENT_STATUS_RECORD_VERSION,
  createBuilderAgentAssignmentRecord,
  createBuilderAgentAssignmentStatusRecord,
} = require('../electron/builder-agent-assignment-contract.cjs');
const {
  createBuilderAgentAssignmentStore,
} = require('../electron/builder-agent-assignment-store.cjs');
const {
  BUILDER_AGENT_SUPERVISION_LEASE_RECORD_VERSION,
  createBuilderAgentSupervisionLeaseRecord,
} = require('../electron/builder-agent-supervision-lease-contract.cjs');
const {
  createBuilderAgentSupervisionLeaseStore,
} = require('../electron/builder-agent-supervision-lease-store.cjs');
const {
  BUILDER_AGENT_DELEGATION_RECORD_KIND,
  BUILDER_AGENT_DELEGATION_RECORD_VERSION,
  createBuilderAgentDelegationRecord,
} = require('../electron/builder-agent-delegation-contract.cjs');
const {
  createBuilderAgentDelegationStore,
} = require('../electron/builder-agent-delegation-store.cjs');
const {
  createBuilderAgentDelegationService,
} = require('../electron/builder-agent-delegation-service.cjs');
const {
  BUILDER_AGENT_DELEGATION_RESULT_RECORD_KIND,
  BUILDER_AGENT_DELEGATION_RESULT_RECORD_VERSION,
  createBuilderAgentDelegationResultRecord,
} = require('../electron/builder-agent-delegation-result-contract.cjs');
const {
  createBuilderAgentDelegationResultStore,
} = require('../electron/builder-agent-delegation-result-store.cjs');
const {
  createBuilderAgentDelegationResultService,
} = require('../electron/builder-agent-delegation-result-service.cjs');
const {
  BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_RECORD_KIND,
  BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_RECORD_VERSION,
  createBuilderAgentDelegationResultAdmissionRecord,
} = require('../electron/builder-agent-delegation-result-admission-contract.cjs');
const {
  createBuilderAgentDelegationResultAdmissionStore,
} = require('../electron/builder-agent-delegation-result-admission-store.cjs');
const {
  createBuilderAgentDelegationResultAdmissionService,
} = require('../electron/builder-agent-delegation-result-admission-service.cjs');
const {
  BUILDER_AGENT_DELEGATION_RESULT_REVIEW_RECORD_KIND,
  BUILDER_AGENT_DELEGATION_RESULT_REVIEW_RECORD_VERSION,
  createBuilderAgentDelegationResultReviewRecord,
} = require('../electron/builder-agent-delegation-result-review-contract.cjs');
const {
  BUILDER_AGENT_DELEGATION_RESULT_REVIEW_STORE_VERSION,
  createBuilderAgentDelegationResultReviewStore,
} = require('../electron/builder-agent-delegation-result-review-store.cjs');
const {
  createBuilderAgentDelegationResultReviewService,
} = require('../electron/builder-agent-delegation-result-review-service.cjs');
const {
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_RECORD_KIND,
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_RECORD_VERSION,
  createBuilderAgentDelegationResultParentMaterializationEligibilityRecord,
} = require('../electron/builder-agent-delegation-result-parent-materialization-eligibility.cjs');
const {
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_STORE_VERSION,
  createBuilderAgentDelegationResultParentMaterializationEligibilityStore,
} = require('../electron/builder-agent-delegation-result-parent-materialization-eligibility-store.cjs');
const {
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_SERVICE_VERSION,
  BuilderAgentDelegationResultParentMaterializationEligibilityServiceError,
  createBuilderAgentDelegationResultParentMaterializationEligibilityService,
} = require('../electron/builder-agent-delegation-result-parent-materialization-eligibility-service.cjs');

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

function temporaryRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function openStores(root) {
  return {
    definition_store: createBuilderAgentDefinitionStore(path.join(root, 'definitions.sqlite')),
    assignment_store: createBuilderAgentAssignmentStore(path.join(root, 'assignments.sqlite')),
    lease_store: createBuilderAgentSupervisionLeaseStore(path.join(root, 'leases.sqlite')),
    delegation_store: createBuilderAgentDelegationStore(path.join(root, 'delegations.sqlite')),
    result_store: createBuilderAgentDelegationResultStore(path.join(root, 'delegation-results.sqlite')),
    admission_store: createBuilderAgentDelegationResultAdmissionStore(path.join(root, 'delegation-result-admissions.sqlite')),
    review_store: createBuilderAgentDelegationResultReviewStore(path.join(root, 'delegation-result-reviews.sqlite')),
    eligibility_store: createBuilderAgentDelegationResultParentMaterializationEligibilityStore(path.join(root, 'delegation-result-eligibilities.sqlite')),
  };
}

function closeStores(stores) {
  stores.definition_store.close();
  stores.assignment_store.close();
  stores.lease_store.close();
  stores.delegation_store.close();
  stores.result_store.close();
  stores.admission_store.close();
  stores.review_store.close();
  stores.eligibility_store.close();
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

function versionInput(definition, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_VERSION_RECORD_VERSION,
    agent_id: definition.agent_id,
    owner_id: definition.owner_id,
    version_number: 1,
    instructions: 'Ask before changing files. Summarize proposed work before review.',
    created_at_ms: definition.created_at_ms + 10,
    permission_boundary: 'explicit_permission_required',
    ...overrides,
  };
}

function lifecycleInput(definition, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_LIFECYCLE_RECORD_VERSION,
    agent_id: definition.agent_id,
    owner_id: definition.owner_id,
    decided_by: definition.owner_id,
    next_status: 'active',
    reason: 'Ready for supervised local work.',
    decided_at_ms: definition.created_at_ms + 20,
    ...overrides,
  };
}

function assignmentInput(version, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_ASSIGNMENT_RECORD_VERSION,
    agent_id: AGENT_ID,
    agent_version_id: version.agent_version_id,
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

function statusInput(assignment, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_ASSIGNMENT_STATUS_RECORD_VERSION,
    assignment_id: assignment.assignment_id,
    agent_id: assignment.agent_id,
    owner_id: assignment.owner_id,
    decided_by: assignment.owner_id,
    next_status: 'queued',
    reason: 'Owner queued this supervised local assignment.',
    decided_at_ms: 35,
    ...overrides,
  };
}

function leaseInput(assignment, activeStatus, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_SUPERVISION_LEASE_RECORD_VERSION,
    assignment_id: assignment.assignment_id,
    assignment_status_id: activeStatus.assignment_status_id,
    agent_id: assignment.agent_id,
    owner_id: assignment.owner_id,
    project_id: assignment.project_id,
    conversation_id: assignment.conversation_id,
    task_id: assignment.task_id,
    run_id: assignment.run_id,
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

function permissionIntersection() {
  return {
    parent_boundary: 'explicit_permission_required',
    child_boundary: 'explicit_permission_required',
    effective_boundary: 'parent_child_intersection_only',
    external_resources: 'not_granted_by_delegation',
  };
}

function delegationInput(facts, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_DELEGATION_RECORD_VERSION,
    record_kind: BUILDER_AGENT_DELEGATION_RECORD_KIND,
    parent_assignment_id: facts.assignment.assignment_id,
    parent_assignment_status_id: facts.activeStatus.assignment_status_id,
    parent_lease_id: facts.lease.lease_id,
    from_agent_id: AGENT_ID,
    from_agent_version_id: facts.assignment.agent_version_id,
    to_agent_id: TARGET_AGENT_ID,
    to_agent_version_id: facts.targetVersion.agent_version_id,
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
  const parentDefinition = createBuilderAgentDefinitionRecord(definitionInput());
  const parentVersion = createBuilderAgentVersionRecord(versionInput(parentDefinition), parentDefinition);
  const assignment = createBuilderAgentAssignmentRecord(
    assignmentInput(parentVersion, overrides.assignment ?? {}),
    parentVersion,
    parentDefinition,
  );
  const queuedStatus = createBuilderAgentAssignmentStatusRecord(
    statusInput(assignment, overrides.queuedStatus ?? {}),
    assignment,
  );
  const activeStatus = createBuilderAgentAssignmentStatusRecord(
    statusInput(assignment, {
      next_status: 'active',
      reason: 'Owner started supervised work.',
      decided_at_ms: 40,
      ...(overrides.activeStatus ?? {}),
    }),
    assignment,
  );
  const lease = createBuilderAgentSupervisionLeaseRecord(
    leaseInput(assignment, activeStatus, overrides.lease ?? {}),
    assignment,
    activeStatus,
  );
  const targetDefinition = createBuilderAgentDefinitionRecord(definitionInput({
    agent_id: TARGET_AGENT_ID,
    display_name: 'Review Agent',
    purpose: 'Review delegated Builder work before owner acceptance.',
    created_at_ms: 12,
    ...(overrides.targetDefinition ?? {}),
  }));
  const targetVersion = createBuilderAgentVersionRecord(
    versionInput(targetDefinition, {
      instructions: 'Review delegated work and return a bounded result for owner review.',
      created_at_ms: 22,
      ...(overrides.targetVersion ?? {}),
    }),
    targetDefinition,
  );
  const targetLifecycle = createBuilderAgentLifecycleRecord(
    lifecycleInput(targetDefinition, overrides.targetLifecycle ?? {}),
    targetDefinition,
  );
  return {
    activeStatus,
    assignment,
    lease,
    parentDefinition,
    parentVersion,
    queuedStatus,
    targetDefinition,
    targetLifecycle,
    targetVersion,
  };
}

function seedParentAssignment(stores, facts) {
  stores.assignment_store.record_assignment({
    definition: facts.parentDefinition,
    version: facts.parentVersion,
    assignment: facts.assignment,
  });
  stores.assignment_store.record_status({ status: facts.queuedStatus });
  stores.assignment_store.record_status({ status: facts.activeStatus });
}

function seedLease(stores, facts) {
  stores.lease_store.record_lease({
    assignment: facts.assignment,
    status: facts.activeStatus,
    lease: facts.lease,
  });
}

function seedTargetAgent(stores, facts) {
  stores.definition_store.record_definition({ definition: facts.targetDefinition });
  stores.definition_store.record_version({ version: facts.targetVersion });
  stores.definition_store.record_lifecycle({ lifecycle: facts.targetLifecycle });
}

function pureDelegation(facts, overrides = {}) {
  return createBuilderAgentDelegationRecord(
    delegationInput(facts, overrides),
    facts.assignment,
    facts.activeStatus,
    facts.lease,
    facts.targetVersion,
    facts.targetDefinition,
  );
}

function resultInput(delegation, overrides = {}) {
  const result = overrides.result ?? {
    status: 'proposed',
    summary_code: 'delegated_child_result_ready_for_parent_review',
  };
  return {
    record_version: BUILDER_AGENT_DELEGATION_RESULT_RECORD_VERSION,
    record_kind: BUILDER_AGENT_DELEGATION_RESULT_RECORD_KIND,
    delegation_id: delegation.delegation_id,
    parent_assignment_id: delegation.parent_assignment_id,
    parent_assignment_status_id: delegation.parent_assignment_status_id,
    parent_lease_id: delegation.parent_lease_id,
    from_agent_id: delegation.from_agent_id,
    from_agent_version_id: delegation.from_agent_version_id,
    to_agent_id: delegation.to_agent_id,
    to_agent_version_id: delegation.to_agent_version_id,
    owner_id: delegation.owner_id,
    project_id: delegation.project_id,
    parent_conversation_id: delegation.parent_conversation_id,
    parent_task_id: delegation.parent_task_id,
    parent_run_id: delegation.parent_run_id,
    child_conversation_id: delegation.child_conversation_id,
    child_task_id: delegation.child_task_id,
    child_run_id: delegation.child_run_id,
    lease_holder_id: delegation.lease_holder_id,
    observed_at_ms: 100,
    result,
    return_contract: 'child_result_returned_for_parent_review',
    parent_materialization_boundary: 'no_direct_parent_mutation',
    ...overrides,
  };
}

function seedDelegationResult(stores, facts, overrides = {}) {
  seedParentAssignment(stores, facts);
  seedLease(stores, facts);
  seedTargetAgent(stores, facts);
  const delegationService = createBuilderAgentDelegationService({
    definition_store: stores.definition_store,
    assignment_store: stores.assignment_store,
    lease_store: stores.lease_store,
    delegation_store: stores.delegation_store,
  });
  const delegation = delegationService.record_agent_delegation({
    owner_id: OWNER_ID,
    parent_assignment_id: facts.assignment.assignment_id,
    target_agent_id: TARGET_AGENT_ID,
    delegation_input: delegationInput(facts, overrides.delegationInput ?? {}),
    now_ms: overrides.delegated_at_ms ?? 90,
  }).delegation;
  const resultService = createBuilderAgentDelegationResultService({
    delegation_store: stores.delegation_store,
    result_store: stores.result_store,
  });
  const result_input = resultInput(delegation, overrides.resultInput ?? {});
  const result = resultService.record_delegation_result({
    owner_id: OWNER_ID,
    delegation_id: delegation.delegation_id,
    result_input,
    now_ms: result_input.observed_at_ms,
  }).delegation_result;
  return { delegation, result };
}

function admissionSummaryFor(result) {
  if (result.result.status === 'blocked') {
    return {
      admission_summary_code: 'delegated_child_blocker_admitted_for_owner_attention',
      admission_display_summary: 'Delegated blocker is admitted for owner attention.',
    };
  }
  if (result.result.status === 'failed') {
    return {
      admission_summary_code: 'delegated_child_failure_admitted_for_owner_attention',
      admission_display_summary: 'Delegated failure is admitted for owner attention.',
    };
  }
  return {
    admission_summary_code: 'delegated_child_result_admitted_for_parent_review',
    admission_display_summary: 'Delegated result is admitted for parent review.',
  };
}

function admissionInput(result, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_RECORD_VERSION,
    record_kind: BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_RECORD_KIND,
    delegation_id: result.delegation_id,
    delegation_result_id: result.delegation_result_id,
    parent_assignment_id: result.parent_assignment_id,
    parent_assignment_status_id: result.parent_assignment_status_id,
    parent_lease_id: result.parent_lease_id,
    from_agent_id: result.from_agent_id,
    from_agent_version_id: result.from_agent_version_id,
    to_agent_id: result.to_agent_id,
    to_agent_version_id: result.to_agent_version_id,
    owner_id: result.owner_id,
    project_id: result.project_id,
    parent_conversation_id: result.parent_conversation_id,
    parent_task_id: result.parent_task_id,
    parent_run_id: result.parent_run_id,
    child_conversation_id: result.child_conversation_id,
    child_task_id: result.child_task_id,
    child_run_id: result.child_run_id,
    lease_holder_id: result.lease_holder_id,
    admitted_at_ms: result.observed_at_ms + 1,
    result: result.result,
    admission_status: 'admitted_for_parent_review',
    ...admissionSummaryFor(result),
    admission_contract: 'local_contribution_admitted_for_parent_review',
    parent_review_contract: 'owner_review_required_before_materialization',
    parent_materialization_boundary: 'no_direct_parent_mutation',
    ...overrides,
  };
}

function openAdmissionService(stores) {
  return createBuilderAgentDelegationResultAdmissionService({
    result_store: stores.result_store,
    admission_store: stores.admission_store,
  });
}

function seedDelegationResultAdmission(stores, facts, overrides = {}) {
  const { delegation, result } = seedDelegationResult(stores, facts, overrides);
  const admissionService = openAdmissionService(stores);
  const admission_input = admissionInput(result, overrides.admissionInput ?? {});
  const admission = admissionService.record_delegation_result_admission({
    owner_id: OWNER_ID,
    delegation_result_id: result.delegation_result_id,
    admission_input,
    now_ms: admission_input.admitted_at_ms,
  }).delegation_result_admission;
  return { admission, delegation, result };
}

function decisionSummaryFor(decision) {
  if (decision === 'rejected') {
    return {
      decision_summary_code: 'delegated_child_result_rejected_by_owner',
      decision_display_summary: 'Delegated result was rejected by the owner.',
    };
  }
  if (decision === 'acknowledged_without_materialization') {
    return {
      decision_summary_code: 'delegated_child_result_acknowledged_without_materialization',
      decision_display_summary: 'Delegated result was acknowledged without materialization.',
    };
  }
  return {
    decision_summary_code: 'delegated_child_result_approved_for_parent_materialization',
    decision_display_summary: 'Delegated result is approved for the parent materialization gate.',
  };
}

function reviewInput(admission, overrides = {}) {
  const decision = overrides.decision
    ?? (admission.result.status === 'proposed'
      ? 'approved_for_parent_materialization'
      : 'acknowledged_without_materialization');
  return {
    record_version: BUILDER_AGENT_DELEGATION_RESULT_REVIEW_RECORD_VERSION,
    record_kind: BUILDER_AGENT_DELEGATION_RESULT_REVIEW_RECORD_KIND,
    delegation_result_admission_id: admission.delegation_result_admission_id,
    delegation_result_id: admission.delegation_result_id,
    delegation_id: admission.delegation_id,
    parent_assignment_id: admission.parent_assignment_id,
    parent_assignment_status_id: admission.parent_assignment_status_id,
    parent_lease_id: admission.parent_lease_id,
    from_agent_id: admission.from_agent_id,
    from_agent_version_id: admission.from_agent_version_id,
    to_agent_id: admission.to_agent_id,
    to_agent_version_id: admission.to_agent_version_id,
    owner_id: admission.owner_id,
    project_id: admission.project_id,
    parent_conversation_id: admission.parent_conversation_id,
    parent_task_id: admission.parent_task_id,
    parent_run_id: admission.parent_run_id,
    child_conversation_id: admission.child_conversation_id,
    child_task_id: admission.child_task_id,
    child_run_id: admission.child_run_id,
    lease_holder_id: admission.lease_holder_id,
    reviewed_by: OWNER_ID,
    reviewed_at_ms: admission.admitted_at_ms + 1,
    result: admission.result,
    decision,
    ...decisionSummaryFor(decision),
    review_contract: 'owner_review_recorded_before_parent_materialization',
    parent_materialization_boundary: 'no_direct_parent_mutation',
    ...overrides,
  };
}

function openReviewService(stores) {
  return createBuilderAgentDelegationResultReviewService({
    admission_store: stores.admission_store,
    review_store: stores.review_store,
  });
}

function seedDelegationResultReview(stores, facts, overrides = {}) {
  const { admission, delegation, result } = seedDelegationResultAdmission(stores, facts, overrides);
  const reviewService = openReviewService(stores);
  const review_input = reviewInput(admission, overrides.reviewInput ?? {});
  const review = reviewService.record_delegation_result_review({
    owner_id: OWNER_ID,
    delegation_result_admission_id: admission.delegation_result_admission_id,
    review_input,
    now_ms: review_input.reviewed_at_ms,
  }).delegation_result_review;
  return { admission, delegation, result, review };
}

function eligibilityInput(review, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_RECORD_VERSION,
    record_kind: BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_RECORD_KIND,
    delegation_result_review_id: review.delegation_result_review_id,
    delegation_result_admission_id: review.delegation_result_admission_id,
    delegation_result_id: review.delegation_result_id,
    delegation_id: review.delegation_id,
    parent_assignment_id: review.parent_assignment_id,
    parent_assignment_status_id: review.parent_assignment_status_id,
    parent_lease_id: review.parent_lease_id,
    from_agent_id: review.from_agent_id,
    from_agent_version_id: review.from_agent_version_id,
    to_agent_id: review.to_agent_id,
    to_agent_version_id: review.to_agent_version_id,
    owner_id: review.owner_id,
    project_id: review.project_id,
    parent_conversation_id: review.parent_conversation_id,
    parent_task_id: review.parent_task_id,
    parent_run_id: review.parent_run_id,
    child_conversation_id: review.child_conversation_id,
    child_task_id: review.child_task_id,
    child_run_id: review.child_run_id,
    lease_holder_id: review.lease_holder_id,
    eligibility_recorded_by: OWNER_ID,
    eligibility_recorded_at_ms: review.reviewed_at_ms + 1,
    result: review.result,
    decision: 'approved_for_parent_materialization',
    eligibility_status: 'eligible_for_parent_materialization_gate',
    eligibility_summary_code: 'delegated_child_result_eligible_for_parent_materialization_gate',
    eligibility_display_summary: 'Delegated result is eligible for the later parent materialization gate.',
    eligibility_contract: 'owner_reviewed_delegated_result_recorded_for_later_parent_materialization',
    parent_materialization_boundary: 'no_direct_parent_mutation',
    ...overrides,
  };
}

function openEligibilityService(stores) {
  return createBuilderAgentDelegationResultParentMaterializationEligibilityService({
    review_store: stores.review_store,
    eligibility_store: stores.eligibility_store,
  });
}

function serviceFor(t) {
  const root = temporaryRoot('clawfabric-builder-agent-delegation-result-parent-materialization-eligibility-service-');
  const stores = openStores(root);
  const service = openEligibilityService(stores);
  t.after(() => {
    closeStores(stores);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, service, stores };
}

function request(review, overrides = {}) {
  const eligibility_input = overrides.eligibility_input
    ?? eligibilityInput(review, overrides.eligibilityInput ?? {});
  return {
    owner_id: overrides.owner_id ?? OWNER_ID,
    delegation_result_review_id:
      overrides.delegation_result_review_id ?? review.delegation_result_review_id,
    eligibility_input,
    now_ms: overrides.now_ms ?? eligibility_input.eligibility_recorded_at_ms,
  };
}

function assertServiceError(fn, code) {
  assert.throws(
    fn,
    (error) => error instanceof BuilderAgentDelegationResultParentMaterializationEligibilityServiceError
      && error.code === code
      && !/private|credential|api\.deepseek|secret-value|source text|child output|raw result|patch body/iu.test(String(error.stack)),
  );
}

test('records a store-backed delegated result parent materialization eligibility without parent mutation', (t) => {
  const { service, stores } = serviceFor(t);
  const facts = fixture();
  const { admission, delegation, result, review } = seedDelegationResultReview(stores, facts);
  const expectedEligibility = createBuilderAgentDelegationResultParentMaterializationEligibilityRecord(
    eligibilityInput(review),
    review,
    admission,
    result,
    delegation,
  );

  const recorded = service.record_delegation_result_parent_materialization_eligibility(request(review));
  assert.equal(
    recorded.result_version,
    BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_SERVICE_RESULT_VERSION,
  );
  assert.equal(
    recorded.service_version,
    BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_SERVICE_VERSION,
  );
  assert.equal(recorded.operation, 'agent_delegation_result_parent_materialization_eligibility_recorded');
  assert.equal(recorded.status, 'ready');
  assert.equal(recorded.result_status, 'proposed');
  assert.equal(recorded.decision, 'approved_for_parent_materialization');
  assert.equal(recorded.eligibility_status, 'eligible_for_parent_materialization_gate');
  assert.deepEqual(recorded.delegation_result_parent_materialization_eligibility, expectedEligibility);
  assert.equal(recorded.review_read.status, 'ready');
  assert.equal(recorded.parent_task_reviews.delegation_result_reviews.length, 1);
  assert.equal(recorded.child_task_reviews.delegation_result_reviews.length, 1);
  assert.equal(
    recorded.eligibility_read.delegation_result_parent_materialization_eligibility
      .eligibility.delegation_result_parent_materialization_eligibility_id,
    expectedEligibility.delegation_result_parent_materialization_eligibility_id,
  );
  assert.equal(
    recorded.eligibility_for_review.delegation_result_parent_materialization_eligibility
      .eligibility.delegation_result_parent_materialization_eligibility_id,
    expectedEligibility.delegation_result_parent_materialization_eligibility_id,
  );
  assert.equal(
    recorded.parent_task_eligibilities.delegation_result_parent_materialization_eligibilities.length,
    1,
  );
  assert.equal(
    recorded.child_task_eligibilities.delegation_result_parent_materialization_eligibilities.length,
    1,
  );
  assert.equal(
    recorded.operations.eligibility_store,
    'delegation_result_parent_materialization_eligibility_recorded',
  );
  assert.equal(
    recorded.evidence.service_authority,
    'main_owned_agent_delegation_result_parent_materialization_eligibility_service',
  );
  assert.equal(recorded.evidence.review_store_authority, 'main_owned_agent_delegation_result_review_store');
  assert.equal(
    recorded.evidence.eligibility_store_authority,
    'main_owned_agent_delegation_result_parent_materialization_eligibility_store',
  );
  assert.equal(recorded.evidence.child_assignment_authority, false);
  assert.equal(recorded.evidence.child_run_authority, false);
  assert.equal(recorded.evidence.provider_dispatch, false);
  assert.equal(recorded.evidence.tool_dispatch, false);
  assert.equal(recorded.evidence.permission_grant_authority, false);
  assert.equal(recorded.evidence.source_access, 'not_present');
  assert.equal(recorded.evidence.source_write, 'not_present');
  assert.equal(recorded.evidence.revision_authority, false);
  assert.equal(recorded.evidence.review_authority, 'local_decision_receipt_only');
  assert.equal(recorded.evidence.review_row_authority, false);
  assert.equal(recorded.evidence.artifact_authority, false);
  assert.equal(recorded.evidence.parent_materialization_authority, false);

  const replay = service.record_delegation_result_parent_materialization_eligibility(request(review));
  assert.equal(
    replay.operations.eligibility_store,
    'delegation_result_parent_materialization_eligibility_replayed',
  );
  assert.deepEqual(
    replay.delegation_result_parent_materialization_eligibility,
    recorded.delegation_result_parent_materialization_eligibility,
  );
});

test('rejects rejected or acknowledged delegated child results without materialization', (t) => {
  {
    const { service, stores } = serviceFor(t);
    const facts = fixture();
    const { review } = seedDelegationResultReview(stores, facts, {
      reviewInput: {
        decision: 'rejected',
        decision_summary_code: 'delegated_child_result_rejected_by_owner',
        decision_display_summary: 'Delegated result was rejected by the owner.',
      },
    });
    assertServiceError(
      () => service.record_delegation_result_parent_materialization_eligibility(request(review)),
      'builder_agent_delegation_result_parent_materialization_eligibility_service_invalid',
    );
  }
  {
    const { service, stores } = serviceFor(t);
    const facts = fixture();
    const { review } = seedDelegationResultReview(stores, facts, {
      resultInput: {
        observed_at_ms: 105,
        result: {
          status: 'blocked',
          summary_code: 'delegated_child_result_needs_owner_attention',
        },
      },
    });
    assert.equal(review.decision, 'acknowledged_without_materialization');
    assertServiceError(
      () => service.record_delegation_result_parent_materialization_eligibility(request(review)),
      'builder_agent_delegation_result_parent_materialization_eligibility_service_invalid',
    );
  }
});

test('recovers Delegation result parent materialization eligibility service state across restart', () => {
  const root = temporaryRoot('clawfabric-builder-agent-delegation-result-parent-materialization-eligibility-service-restart-');
  const stores = openStores(root);
  const facts = fixture();
  const { review } = seedDelegationResultReview(stores, facts);
  const service = openEligibilityService(stores);
  const first = service.record_delegation_result_parent_materialization_eligibility(request(review));
  closeStores(stores);

  const reopened = openStores(root);
  const restarted = openEligibilityService(reopened);
  const replay = restarted.record_delegation_result_parent_materialization_eligibility(request(review));
  assert.equal(
    replay.operations.eligibility_store,
    'delegation_result_parent_materialization_eligibility_replayed',
  );
  assert.deepEqual(
    replay.delegation_result_parent_materialization_eligibility,
    first.delegation_result_parent_materialization_eligibility,
  );
  assert.equal(
    replay.parent_task_eligibilities.delegation_result_parent_materialization_eligibilities.length,
    1,
  );
  assert.equal(
    replay.child_task_eligibilities.delegation_result_parent_materialization_eligibilities.length,
    1,
  );
  closeStores(reopened);
  fs.rmSync(root, { recursive: true, force: true });
});

test('fails closed for missing review, drift, replay conflict, and malformed stores', (t) => {
  {
    const { service } = serviceFor(t);
    const facts = fixture();
    const delegation = pureDelegation(facts);
    const result = createBuilderAgentDelegationResultRecord(resultInput(delegation), delegation);
    const admission = createBuilderAgentDelegationResultAdmissionRecord(
      admissionInput(result),
      result,
      delegation,
    );
    const review = createBuilderAgentDelegationResultReviewRecord(
      reviewInput(admission),
      admission,
      result,
      delegation,
    );
    assertServiceError(
      () => service.record_delegation_result_parent_materialization_eligibility(request(review)),
      'builder_agent_delegation_result_parent_materialization_eligibility_service_conflict',
    );
  }
  {
    const { service, stores } = serviceFor(t);
    const facts = fixture();
    const { review } = seedDelegationResultReview(stores, facts);
    assertServiceError(
      () => service.record_delegation_result_parent_materialization_eligibility(request(review, { owner_id: OTHER_OWNER_ID })),
      'builder_agent_delegation_result_parent_materialization_eligibility_service_conflict',
    );
    assertServiceError(
      () => service.record_delegation_result_parent_materialization_eligibility(request(review, { now_ms: review.reviewed_at_ms + 3 })),
      'builder_agent_delegation_result_parent_materialization_eligibility_service_invalid',
    );
    assertServiceError(
      () => service.record_delegation_result_parent_materialization_eligibility(request(review, {
        eligibilityInput: {
          eligibility_summary_code: 'delegated_child_result_materialized_into_parent',
        },
      })),
      'builder_agent_delegation_result_parent_materialization_eligibility_service_invalid',
    );
    assertServiceError(
      () => service.record_delegation_result_parent_materialization_eligibility(request(review, {
        eligibilityInput: { parent_materialization_boundary: 'mutate_parent_task' },
      })),
      'builder_agent_delegation_result_parent_materialization_eligibility_service_invalid',
    );
  }
  {
    const { service, stores } = serviceFor(t);
    const facts = fixture();
    const { review } = seedDelegationResultReview(stores, facts);
    service.record_delegation_result_parent_materialization_eligibility(request(review));
    assertServiceError(
      () => service.record_delegation_result_parent_materialization_eligibility(request(review, {
        eligibilityInput: { eligibility_recorded_at_ms: review.reviewed_at_ms + 6 },
        now_ms: review.reviewed_at_ms + 6,
      })),
      'builder_agent_delegation_result_parent_materialization_eligibility_service_conflict',
    );
  }
  {
    const { stores } = serviceFor(t);
    assertServiceError(
      () => createBuilderAgentDelegationResultParentMaterializationEligibilityService({
        review_store: { store_version: BUILDER_AGENT_DELEGATION_RESULT_REVIEW_STORE_VERSION },
        eligibility_store: stores.eligibility_store,
      }),
      'builder_agent_delegation_result_parent_materialization_eligibility_service_invalid',
    );
    assertServiceError(
      () => createBuilderAgentDelegationResultParentMaterializationEligibilityService({
        review_store: stores.review_store,
        eligibility_store: {
          store_version: BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_STORE_VERSION,
        },
      }),
      'builder_agent_delegation_result_parent_materialization_eligibility_service_invalid',
    );
  }
});

test('source boundary remains main-only and exposes no parent materialization authority', () => {
  const source = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'electron',
      'builder-agent-delegation-result-parent-materialization-eligibility-service.cjs',
    ),
    'utf8',
  );

  assert.doesNotMatch(source, /require\('electron'\)|ipcMain|BrowserWindow|preload|safeStorage|provider-config|provider-secret/iu);
  assert.doesNotMatch(source, /node:child_process|require\(['"]child_process['"]\)|spawn\(|execFile\(|writeFile|rmSync/iu);
  assert.match(
    source,
    /service_authority:\s*'main_owned_agent_delegation_result_parent_materialization_eligibility_service'/u,
  );
  assert.match(source, /child_assignment_authority: false/u);
  assert.match(source, /child_run_authority: false/u);
  assert.match(source, /provider_dispatch: false/u);
  assert.match(source, /tool_dispatch: false/u);
  assert.match(source, /permission_grant_authority: false/u);
  assert.match(source, /source_access: 'not_present'/u);
  assert.match(source, /source_write: 'not_present'/u);
  assert.match(source, /revision_authority: false/u);
  assert.match(source, /review_authority: 'local_decision_receipt_only'/u);
  assert.match(source, /review_row_authority: false/u);
  assert.match(source, /artifact_authority: false/u);
  assert.match(source, /parent_materialization_authority: false/u);
});
