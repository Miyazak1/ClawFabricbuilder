'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
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
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_STORE_READ_RESULT_VERSION,
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_STORE_RESULT_VERSION,
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_STORE_SCHEMA_VERSION,
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_STORE_USER_VERSION,
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_STORE_VERSION,
  BuilderAgentDelegationResultParentMaterializationEligibilityStoreError,
  createBuilderAgentDelegationResultParentMaterializationEligibilityStore,
} = require('../electron/builder-agent-delegation-result-parent-materialization-eligibility-store.cjs');

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
const SECOND_CHILD_CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174012';
const SECOND_CHILD_TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174013';
const SECOND_CHILD_RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174014';

function temporaryDatabase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-agent-delegation-eligibilities-'));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });
  return path.join(root, 'store.sqlite');
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

function resultRecord(delegationRecord, overrides = {}) {
  return createBuilderAgentDelegationResultRecord(resultInput(delegationRecord, overrides), delegationRecord);
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
    admission_summary_code: 'delegated_child_result_admitted_for_parent_review',
    admission_display_summary: 'Delegated result is admitted for parent review.',
    admission_contract: 'local_contribution_admitted_for_parent_review',
    parent_review_contract: 'owner_review_required_before_materialization',
    parent_materialization_boundary: 'no_direct_parent_mutation',
    ...overrides,
  };
}

function admissionRecord(result, delegationRecord, overrides = {}) {
  return createBuilderAgentDelegationResultAdmissionRecord(
    admissionInput(result, overrides),
    result,
    delegationRecord,
  );
}

function reviewInput(admission, overrides = {}) {
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
    decision: 'approved_for_parent_materialization',
    decision_summary_code: 'delegated_child_result_approved_for_parent_materialization',
    decision_display_summary: 'Delegated result is approved for the parent materialization gate.',
    review_contract: 'owner_review_recorded_before_parent_materialization',
    parent_materialization_boundary: 'no_direct_parent_mutation',
    ...overrides,
  };
}

function reviewRecord(admission, result, delegationRecord, overrides = {}) {
  return createBuilderAgentDelegationResultReviewRecord(
    reviewInput(admission, overrides),
    admission,
    result,
    delegationRecord,
  );
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

function eligibilityRecord(review, admission, result, delegationRecord, overrides = {}) {
  return createBuilderAgentDelegationResultParentMaterializationEligibilityRecord(
    eligibilityInput(review, overrides),
    review,
    admission,
    result,
    delegationRecord,
  );
}

function chain(overrides = {}) {
  const { delegationRecord } = fixture(overrides.fixture ?? {});
  const result = resultRecord(delegationRecord, overrides.result ?? {});
  const admission = admissionRecord(result, delegationRecord, overrides.admission ?? {});
  const review = reviewRecord(admission, result, delegationRecord, overrides.review ?? {});
  const eligibility = eligibilityRecord(review, admission, result, delegationRecord, overrides.eligibility ?? {});
  return { admission, delegationRecord, eligibility, result, review };
}

function recordRequest(entry) {
  return {
    admission: entry.admission,
    delegation: entry.delegationRecord,
    eligibility: entry.eligibility,
    result: entry.result,
    review: entry.review,
  };
}

function assertStoreError(fn, code = null) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderAgentDelegationResultParentMaterializationEligibilityStoreError);
      if (code !== null) assert.equal(error.code, code);
      const text = `${error.name}:${error.message}:${error.stack}`;
      assert.doesNotMatch(text, /private|credential|api\.deepseek|secret-value|source text|raw child output|patch body/iu);
      return true;
    },
  );
}

test('records delegation result parent materialization eligibilities then restores them after restart', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentDelegationResultParentMaterializationEligibilityStore(databasePath);
  const entry = chain();

  assert.equal(store.store_version, BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_STORE_VERSION);
  const recorded = store.record_eligibility(recordRequest(entry));
  assert.equal(
    recorded.result_version,
    BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_STORE_RESULT_VERSION,
  );
  assert.equal(recorded.operation, 'delegation_result_parent_materialization_eligibility_recorded');
  assert.deepEqual(recorded.delegation_result_parent_materialization_eligibility.eligibility, entry.eligibility);
  assert.deepEqual(recorded.delegation_result_parent_materialization_eligibility.review, entry.review);
  assert.deepEqual(recorded.delegation_result_parent_materialization_eligibility.admission, entry.admission);
  assert.deepEqual(recorded.delegation_result_parent_materialization_eligibility.result, entry.result);
  assert.deepEqual(recorded.delegation_result_parent_materialization_eligibility.delegation, entry.delegationRecord);
  assert.equal(
    recorded.delegation_result_parent_materialization_eligibility_evidence
      .delegation_result_parent_materialization_eligibility_authority,
    'main_owned_agent_delegation_result_parent_materialization_eligibility_store',
  );
  assert.equal(
    recorded.delegation_result_parent_materialization_eligibility_evidence.renderer_authority,
    'not_present',
  );
  assert.equal(recorded.delegation_result_parent_materialization_eligibility_evidence.ipc_authority, 'not_present');
  assert.equal(recorded.delegation_result_parent_materialization_eligibility_evidence.model_dispatch, false);
  assert.equal(recorded.delegation_result_parent_materialization_eligibility_evidence.tool_dispatch, false);
  assert.equal(recorded.delegation_result_parent_materialization_eligibility_evidence.source_read, 'not_present');
  assert.equal(recorded.delegation_result_parent_materialization_eligibility_evidence.source_write, 'not_present');
  assert.equal(recorded.delegation_result_parent_materialization_eligibility_evidence.process_run, false);
  assert.equal(recorded.delegation_result_parent_materialization_eligibility_evidence.network_access, false);
  assert.equal(recorded.delegation_result_parent_materialization_eligibility_evidence.revision_authority, false);
  assert.equal(recorded.delegation_result_parent_materialization_eligibility_evidence.review_row_authority, false);
  assert.equal(recorded.delegation_result_parent_materialization_eligibility_evidence.artifact_authority, false);
  assert.equal(
    recorded.delegation_result_parent_materialization_eligibility_evidence.parent_materialization_authority,
    false,
  );
  assert.equal(
    recorded.delegation_result_parent_materialization_eligibility_evidence.schema_version,
    BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_STORE_SCHEMA_VERSION,
  );
  assert.equal(
    recorded.delegation_result_parent_materialization_eligibility_evidence.user_version,
    BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_STORE_USER_VERSION,
  );
  assert.match(
    recorded.delegation_result_parent_materialization_eligibility_evidence.schema_fingerprint_digest,
    /^[a-f0-9]{64}$/u,
  );

  assert.equal(
    store.record_eligibility(recordRequest(entry)).operation,
    'delegation_result_parent_materialization_eligibility_replayed',
  );

  const read = store.read_eligibility({
    delegation_result_parent_materialization_eligibility_id:
      entry.eligibility.delegation_result_parent_materialization_eligibility_id,
    owner_id: OWNER_ID,
  });
  assert.equal(read.result_version, BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_STORE_READ_RESULT_VERSION);
  assert.equal(read.status, 'ready');
  assert.deepEqual(read.delegation_result_parent_materialization_eligibility.eligibility, entry.eligibility);
  assert.equal(Object.isFrozen(read), true);
  assert.equal(Object.isFrozen(read.delegation_result_parent_materialization_eligibility), true);

  const byReview = store.read_eligibility_for_review({
    delegation_result_review_id: entry.review.delegation_result_review_id,
    owner_id: OWNER_ID,
  });
  assert.equal(byReview.status, 'ready');
  assert.deepEqual(byReview.delegation_result_parent_materialization_eligibility.eligibility, entry.eligibility);

  const parentList = store.list_parent_task_eligibilities({
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    parent_task_id: TASK_ID,
  });
  assert.equal(parentList.status, 'ready');
  assert.equal(parentList.delegation_result_parent_materialization_eligibilities.length, 1);
  assert.deepEqual(parentList.delegation_result_parent_materialization_eligibilities[0].eligibility, entry.eligibility);

  const childList = store.list_child_task_eligibilities({
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    child_task_id: CHILD_TASK_ID,
  });
  assert.equal(childList.status, 'ready');
  assert.equal(childList.delegation_result_parent_materialization_eligibilities.length, 1);
  assert.deepEqual(childList.delegation_result_parent_materialization_eligibilities[0].eligibility, entry.eligibility);
  store.close();

  const restarted = createBuilderAgentDelegationResultParentMaterializationEligibilityStore(databasePath);
  const restored = restarted.read_eligibility({
    delegation_result_parent_materialization_eligibility_id:
      entry.eligibility.delegation_result_parent_materialization_eligibility_id,
    owner_id: OWNER_ID,
  });
  assert.equal(restored.status, 'ready');
  assert.deepEqual(restored.delegation_result_parent_materialization_eligibility.eligibility, entry.eligibility);
  assert.deepEqual(restored.delegation_result_parent_materialization_eligibility.review, entry.review);
  assert.deepEqual(restored.delegation_result_parent_materialization_eligibility.admission, entry.admission);
  assert.deepEqual(restored.delegation_result_parent_materialization_eligibility.result, entry.result);
  assert.deepEqual(restored.delegation_result_parent_materialization_eligibility.delegation, entry.delegationRecord);
  restarted.close();
});

test('records multiple parent eligibilities while enforcing owner scope and one eligibility per review', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentDelegationResultParentMaterializationEligibilityStore(databasePath);
  const first = chain();
  store.record_eligibility(recordRequest(first));

  const second = chain({
    fixture: {
      delegation: {
        child_conversation_id: SECOND_CHILD_CONVERSATION_ID,
        child_task_id: SECOND_CHILD_TASK_ID,
        child_run_id: SECOND_CHILD_RUN_ID,
        delegated_goal: 'Review accessibility risks before parent materialization.',
        delegated_at_ms: 95,
      },
    },
    result: { observed_at_ms: 105 },
  });
  assert.equal(
    store.record_eligibility(recordRequest(second)).operation,
    'delegation_result_parent_materialization_eligibility_recorded',
  );

  const parentList = store.list_parent_task_eligibilities({
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    parent_task_id: TASK_ID,
  });
  assert.equal(parentList.delegation_result_parent_materialization_eligibilities.length, 2);
  assert.deepEqual(
    parentList.delegation_result_parent_materialization_eligibilities.map(
      (item) => item.eligibility.delegation_result_review_id,
    ),
    [first.review.delegation_result_review_id, second.review.delegation_result_review_id],
  );
  assert.equal(
    store.read_eligibility({
      delegation_result_parent_materialization_eligibility_id:
        first.eligibility.delegation_result_parent_materialization_eligibility_id,
      owner_id: OTHER_OWNER_ID,
    }).status,
    'absent',
  );
  assert.equal(
    store.read_eligibility_for_review({
      delegation_result_review_id: first.review.delegation_result_review_id,
      owner_id: OTHER_OWNER_ID,
    }).status,
    'absent',
  );

  const conflictingEligibility = eligibilityRecord(first.review, first.admission, first.result, first.delegationRecord, {
    eligibility_recorded_at_ms: first.eligibility.eligibility_recorded_at_ms + 1,
  });
  assertStoreError(
    () => store.record_eligibility({
      ...recordRequest(first),
      eligibility: conflictingEligibility,
    }),
    'builder_agent_delegation_result_parent_materialization_eligibility_store_conflict',
  );
  store.close();
});

test('rejects hostile input, malformed reads, and tampered rows', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentDelegationResultParentMaterializationEligibilityStore(databasePath);
  const entry = chain();

  assertStoreError(() => store.record_eligibility({
    ...recordRequest(entry),
    extra: true,
  }));
  assertStoreError(() => store.read_eligibility({
    delegation_result_parent_materialization_eligibility_id:
      entry.eligibility.delegation_result_parent_materialization_eligibility_id,
    owner_id: OWNER_ID,
    extra: true,
  }));
  assertStoreError(() => store.read_eligibility_for_review({
    delegation_result_review_id: entry.review.delegation_result_review_id,
    owner_id: OWNER_ID,
    extra: true,
  }));
  assertStoreError(() => store.list_parent_task_eligibilities({
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    parent_task_id: TASK_ID,
    extra: true,
  }));
  assertStoreError(() => store.list_child_task_eligibilities({
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    child_task_id: CHILD_TASK_ID,
    extra: true,
  }));

  let getterCalls = 0;
  const accessor = recordRequest(entry);
  Object.defineProperty(accessor, 'eligibility', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('private credential getter');
    },
  });
  assertStoreError(() => store.record_eligibility(accessor));
  assert.equal(getterCalls, 0);

  let proxyTrapInvoked = false;
  const proxyTrap = () => {
    proxyTrapInvoked = true;
    throw new Error('private proxy marker');
  };
  assertStoreError(() => store.record_eligibility(new Proxy(recordRequest(entry), {
    getOwnPropertyDescriptor: proxyTrap,
    getPrototypeOf: proxyTrap,
    ownKeys: proxyTrap,
  })));
  assert.equal(proxyTrapInvoked, false);

  assertStoreError(() => store.record_eligibility({
    ...recordRequest(entry),
    review: {
      ...entry.review,
      decision: 'rejected',
      decision_summary_code: 'delegated_child_result_rejected_by_owner',
      decision_display_summary: 'Delegated result was rejected by the owner.',
    },
  }));

  store.record_eligibility(recordRequest(entry));
  store.close();

  const raw = new DatabaseSync(databasePath);
  raw.prepare(
    `UPDATE agent_delegation_result_parent_materialization_eligibilities
      SET eligibility_json = replace(eligibility_json, ?, ?)
      WHERE delegation_result_parent_materialization_eligibility_id = ?`,
  ).run(
    'eligible_for_parent_materialization_gate',
    'materialized_into_parent_task',
    entry.eligibility.delegation_result_parent_materialization_eligibility_id,
  );
  raw.close();

  const reopened = createBuilderAgentDelegationResultParentMaterializationEligibilityStore(databasePath);
  assertStoreError(
    () => reopened.read_eligibility({
      delegation_result_parent_materialization_eligibility_id:
        entry.eligibility.delegation_result_parent_materialization_eligibility_id,
      owner_id: OWNER_ID,
    }),
    'builder_agent_delegation_result_parent_materialization_eligibility_store_integrity_failed',
  );
  reopened.close();
});

test('rejects schema drift and unsafe database paths', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentDelegationResultParentMaterializationEligibilityStore(databasePath);
  store.close();

  assertStoreError(
    () => createBuilderAgentDelegationResultParentMaterializationEligibilityStore(path.join('relative', 'store.sqlite')),
    'builder_agent_delegation_result_parent_materialization_eligibility_store_invalid',
  );

  const raw = new DatabaseSync(databasePath);
  raw.exec('PRAGMA user_version = 2');
  raw.close();
  assertStoreError(
    () => createBuilderAgentDelegationResultParentMaterializationEligibilityStore(databasePath),
    'builder_agent_delegation_result_parent_materialization_eligibility_store_integrity_failed',
  );
});

test('source boundary remains a main-only eligibility store without runtime or parent materialization authority', () => {
  const source = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'electron',
      'builder-agent-delegation-result-parent-materialization-eligibility-store.cjs',
    ),
    'utf8',
  );
  assert.match(source, /main_owned_agent_delegation_result_parent_materialization_eligibility_store/u);
  assert.match(source, /parent_materialization_authority: false/u);
  assert.match(source, /source_write: 'not_present'/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:http|node:https|http|https)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|dugite|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|shell:\s*true|localStorage|sessionStorage|indexedDB|eval\s*\(|new Function/iu,
  );
});
