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
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_STORE_VERSION,
  createBuilderAgentDelegationResultParentMaterializationEligibilityStore,
} = require('../electron/builder-agent-delegation-result-parent-materialization-eligibility-store.cjs');
const {
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_RECORD_KIND,
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_RECORD_VERSION,
  createBuilderAgentDelegationResultParentMaterializationRecord,
} = require('../electron/builder-agent-delegation-result-parent-materialization.cjs');
const {
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_STORE_VERSION,
  createBuilderAgentDelegationResultParentMaterializationStore,
} = require('../electron/builder-agent-delegation-result-parent-materialization-store.cjs');
const {
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_SERVICE_VERSION,
  BuilderAgentDelegationResultParentMaterializationServiceError,
  createBuilderAgentDelegationResultParentMaterializationService,
} = require('../electron/builder-agent-delegation-result-parent-materialization-service.cjs');

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

function temporaryRoot() {
  return fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clawfabric-builder-agent-delegation-parent-materialization-service-',
  ));
}

function openStores(root) {
  return {
    eligibility_store: createBuilderAgentDelegationResultParentMaterializationEligibilityStore(
      path.join(root, 'eligibilities.sqlite'),
    ),
    materialization_store: createBuilderAgentDelegationResultParentMaterializationStore(
      path.join(root, 'materializations.sqlite'),
    ),
  };
}

function closeStores(stores) {
  stores.eligibility_store.close();
  stores.materialization_store.close();
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
  const targetDefinition = createBuilderAgentDefinitionRecord(
    targetDefinitionInput(overrides.targetDefinition ?? {}),
  );
  const targetVersion = createBuilderAgentVersionRecord(
    targetVersionInput(overrides.targetVersion ?? {}),
    targetDefinition,
  );
  const delegationRecord = createBuilderAgentDelegationRecord(
    delegationInput(
      assignmentRecord,
      activeStatus,
      leaseRecord,
      targetVersion,
      overrides.delegation ?? {},
    ),
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
    record_version:
      BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_RECORD_VERSION,
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

function proposedChain(overrides = {}) {
  const { delegationRecord } = fixture(overrides.fixture ?? {});
  const resultRecord = createBuilderAgentDelegationResultRecord(
    resultInput(delegationRecord, overrides.result ?? {}),
    delegationRecord,
  );
  const admissionRecord = createBuilderAgentDelegationResultAdmissionRecord(
    admissionInput(resultRecord, overrides.admission ?? {}),
    resultRecord,
    delegationRecord,
  );
  const reviewRecord = createBuilderAgentDelegationResultReviewRecord(
    reviewInput(admissionRecord, overrides.review ?? {}),
    admissionRecord,
    resultRecord,
    delegationRecord,
  );
  const eligibilityRecord = createBuilderAgentDelegationResultParentMaterializationEligibilityRecord(
    eligibilityInput(reviewRecord, overrides.eligibility ?? {}),
    reviewRecord,
    admissionRecord,
    resultRecord,
    delegationRecord,
  );
  return { admissionRecord, delegationRecord, eligibilityRecord, resultRecord, reviewRecord };
}

function materializationRecord(entry, overrides = {}) {
  return createBuilderAgentDelegationResultParentMaterializationRecord(
    materializationInput(entry.eligibilityRecord, overrides),
    entry.eligibilityRecord,
    entry.reviewRecord,
    entry.admissionRecord,
    entry.resultRecord,
    entry.delegationRecord,
  );
}

function chain(overrides = {}) {
  const { admissionRecord, delegationRecord, eligibilityRecord, resultRecord, reviewRecord } =
    proposedChain(overrides);
  return {
    admission: admissionRecord,
    delegation: delegationRecord,
    eligibility: eligibilityRecord,
    materialization: materializationRecord(
      { admissionRecord, delegationRecord, eligibilityRecord, resultRecord, reviewRecord },
      overrides.materialization ?? {},
    ),
    result: resultRecord,
    review: reviewRecord,
  };
}

function seedEligibility(stores, entry) {
  return stores.eligibility_store.record_eligibility({
    delegation: entry.delegation,
    result: entry.result,
    admission: entry.admission,
    review: entry.review,
    eligibility: entry.eligibility,
  });
}

function openService(stores) {
  return createBuilderAgentDelegationResultParentMaterializationService({
    eligibility_store: stores.eligibility_store,
    materialization_store: stores.materialization_store,
  });
}

function serviceFor(t) {
  const root = temporaryRoot();
  const stores = openStores(root);
  const service = openService(stores);
  t.after(() => {
    try { closeStores(stores); } catch { /* best-effort test cleanup */ }
    fs.rmSync(root, { force: true, recursive: true });
  });
  return { root, service, stores };
}

function request(eligibilityRecord, overrides = {}) {
  const materialization_input = overrides.materialization_input
    ?? materializationInput(eligibilityRecord, overrides.materializationInput ?? {});
  return {
    owner_id: overrides.owner_id ?? OWNER_ID,
    delegation_result_parent_materialization_eligibility_id:
      overrides.delegation_result_parent_materialization_eligibility_id
      ?? eligibilityRecord.delegation_result_parent_materialization_eligibility_id,
    materialization_input,
    now_ms: overrides.now_ms ?? materialization_input.materialized_at_ms,
  };
}

function assertServiceError(fn, code) {
  assert.throws(
    fn,
    (error) => error instanceof BuilderAgentDelegationResultParentMaterializationServiceError
      && error.code === code
      && !/private|credential|api\.deepseek|secret-value|source text|child output|raw result|patch body/iu.test(String(error.stack)),
  );
}

test('records a store-backed delegated result parent materialization without source mutation', (t) => {
  const { service, stores } = serviceFor(t);
  const entry = chain();
  seedEligibility(stores, entry);

  const recorded = service.record_delegation_result_parent_materialization(request(entry.eligibility));

  assert.equal(
    BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_SERVICE_VERSION,
    'builder-agent-delegation-result-parent-materialization-service.v1',
  );
  assert.equal(
    recorded.result_version,
    BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_SERVICE_RESULT_VERSION,
  );
  assert.equal(recorded.operation, 'agent_delegation_result_parent_materialization_recorded');
  assert.equal(recorded.status, 'ready');
  assert.equal(recorded.result_status, 'proposed');
  assert.equal(recorded.decision, 'approved_for_parent_materialization');
  assert.equal(recorded.eligibility_status, 'eligible_for_parent_materialization_gate');
  assert.equal(recorded.parent_context_status, 'materialized_as_parent_task_context_receipt');
  assert.deepEqual(recorded.delegation_result_parent_materialization, entry.materialization);
  assert.equal(recorded.operations.materialization_store, 'delegation_result_parent_materialization_recorded');
  assert.deepEqual(
    recorded.materialization_read.delegation_result_parent_materialization.materialization,
    entry.materialization,
  );
  assert.deepEqual(
    recorded.materialization_for_eligibility.delegation_result_parent_materialization.materialization,
    entry.materialization,
  );
  assert.equal(recorded.parent_task_eligibilities.delegation_result_parent_materialization_eligibilities.length, 1);
  assert.equal(recorded.child_task_eligibilities.delegation_result_parent_materialization_eligibilities.length, 1);
  assert.equal(recorded.parent_task_materializations.delegation_result_parent_materializations.length, 1);
  assert.equal(recorded.child_task_materializations.delegation_result_parent_materializations.length, 1);
  assert.equal(
    recorded.evidence.service_authority,
    'main_owned_agent_delegation_result_parent_materialization_service',
  );
  assert.equal(recorded.evidence.materialization_store_authority, 'main_owned_agent_delegation_result_parent_materialization_store');
  assert.equal(recorded.evidence.parent_context_authority, 'local_parent_task_context_receipt_only');
  assert.equal(recorded.evidence.parent_materialization_authority, 'receipt_only');
  assert.equal(recorded.evidence.parent_source_mutation_authority, false);
  assert.equal(recorded.evidence.artifact_authority, false);
  assert.equal(recorded.evidence.source_write, 'not_present');
  assert.equal(recorded.evidence.ipc_authority, 'not_present');
  assert.equal(Object.isFrozen(service), true);
  assert.equal(Object.isFrozen(recorded), true);
});

test('recovers parent materialization service state across restart through idempotent replay', (t) => {
  const root = temporaryRoot();
  let stores;
  let reopened;
  t.after(() => {
    if (stores) {
      try { closeStores(stores); } catch { /* best-effort test cleanup */ }
    }
    if (reopened) {
      try { closeStores(reopened); } catch { /* best-effort test cleanup */ }
    }
    fs.rmSync(root, { force: true, recursive: true });
  });
  stores = openStores(root);
  const entry = chain();
  seedEligibility(stores, entry);
  const service = openService(stores);
  const first = service.record_delegation_result_parent_materialization(request(entry.eligibility));
  closeStores(stores);

  reopened = openStores(root);
  const restarted = openService(reopened);
  const replay = restarted.record_delegation_result_parent_materialization(request(entry.eligibility));
  assert.equal(
    replay.operations.materialization_store,
    'delegation_result_parent_materialization_replayed',
  );
  assert.deepEqual(
    replay.delegation_result_parent_materialization,
    first.delegation_result_parent_materialization,
  );
  assert.equal(replay.parent_task_materializations.delegation_result_parent_materializations.length, 1);
  assert.equal(replay.child_task_materializations.delegation_result_parent_materializations.length, 1);
  closeStores(reopened);
});

test('fails closed for missing eligibility, drift, and replay conflict', (t) => {
  {
    const { service } = serviceFor(t);
    const entry = chain();
    assertServiceError(
      () => service.record_delegation_result_parent_materialization(request(entry.eligibility)),
      'builder_agent_delegation_result_parent_materialization_service_conflict',
    );
  }
  {
    const { service, stores } = serviceFor(t);
    const entry = chain();
    seedEligibility(stores, entry);
    assertServiceError(
      () => service.record_delegation_result_parent_materialization(
        request(entry.eligibility, { owner_id: OTHER_OWNER_ID }),
      ),
      'builder_agent_delegation_result_parent_materialization_service_conflict',
    );
    assertServiceError(
      () => service.record_delegation_result_parent_materialization(
        request(entry.eligibility, { now_ms: entry.eligibility.eligibility_recorded_at_ms + 8 }),
      ),
      'builder_agent_delegation_result_parent_materialization_service_invalid',
    );
    assertServiceError(
      () => service.record_delegation_result_parent_materialization(request(entry.eligibility, {
        materializationInput: {
          materialization_summary_code: 'delegated_child_result_mutated_parent_context',
        },
      })),
      'builder_agent_delegation_result_parent_materialization_service_invalid',
    );
    assertServiceError(
      () => service.record_delegation_result_parent_materialization(request(entry.eligibility, {
        materializationInput: { parent_materialization_boundary: 'source_revision_created' },
      })),
      'builder_agent_delegation_result_parent_materialization_service_invalid',
    );
  }
  {
    const { service, stores } = serviceFor(t);
    const entry = chain();
    seedEligibility(stores, entry);
    service.record_delegation_result_parent_materialization(request(entry.eligibility));
    assertServiceError(
      () => service.record_delegation_result_parent_materialization(request(entry.eligibility, {
        materializationInput: { materialized_at_ms: entry.materialization.materialized_at_ms + 1 },
        now_ms: entry.materialization.materialized_at_ms + 1,
      })),
      'builder_agent_delegation_result_parent_materialization_service_conflict',
    );
  }
});

test('fails closed on malformed stores, hostile inputs, and redacted errors', (t) => {
  const { service, stores } = serviceFor(t);
  const entry = chain();
  seedEligibility(stores, entry);

  assertServiceError(
    () => createBuilderAgentDelegationResultParentMaterializationService({
      eligibility_store: { store_version: BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_STORE_VERSION },
      materialization_store: stores.materialization_store,
    }),
    'builder_agent_delegation_result_parent_materialization_service_invalid',
  );
  assertServiceError(
    () => createBuilderAgentDelegationResultParentMaterializationService({
      eligibility_store: stores.eligibility_store,
      materialization_store: {
        store_version: BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_STORE_VERSION,
      },
    }),
    'builder_agent_delegation_result_parent_materialization_service_invalid',
  );
  assertServiceError(
    () => service.record_delegation_result_parent_materialization({
      ...request(entry.eligibility),
      raw_output: 'secret-value',
    }),
    'builder_agent_delegation_result_parent_materialization_service_invalid',
  );
  const accessor = request(entry.eligibility);
  Object.defineProperty(accessor, 'materialization_input', {
    enumerable: true,
    get() {
      throw new Error('private getter marker');
    },
  });
  assertServiceError(
    () => service.record_delegation_result_parent_materialization(accessor),
    'builder_agent_delegation_result_parent_materialization_service_invalid',
  );
  assertServiceError(
    () => service.record_delegation_result_parent_materialization(
      new Proxy(request(entry.eligibility), {}),
    ),
    'builder_agent_delegation_result_parent_materialization_service_invalid',
  );
});

test('source boundary remains main-only and exposes no runtime or source authority', () => {
  const source = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'electron',
      'builder-agent-delegation-result-parent-materialization-service.cjs',
    ),
    'utf8',
  );

  assert.doesNotMatch(source, /require\('electron'\)|ipcMain|BrowserWindow|preload|safeStorage|provider-config|provider-secret/iu);
  assert.doesNotMatch(source, /node:child_process|require\(['"]child_process['"]\)|spawn\(|execFile\(|writeFile|rmSync/iu);
  assert.doesNotMatch(source, /builder-provider|builder-git|dugite|fetch\s*\(|https?:|Authorization|Bearer|localStorage|sessionStorage|indexedDB|eval\s*\(|new Function/iu);
  assert.match(
    source,
    /service_authority:\s*'main_owned_agent_delegation_result_parent_materialization_service'/u,
  );
  assert.match(source, /eligibility_store_authority:\s*'main_owned_agent_delegation_result_parent_materialization_eligibility_store'/u);
  assert.match(source, /materialization_store_authority:\s*'main_owned_agent_delegation_result_parent_materialization_store'/u);
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
  assert.match(source, /parent_context_authority: 'local_parent_task_context_receipt_only'/u);
  assert.match(source, /parent_materialization_authority: 'receipt_only'/u);
  assert.match(source, /parent_source_mutation_authority: false/u);
});
