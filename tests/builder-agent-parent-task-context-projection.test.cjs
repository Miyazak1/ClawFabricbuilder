'use strict';

const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
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
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_RECORD_KIND,
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_RECORD_VERSION,
  createBuilderAgentDelegationResultParentMaterializationRecord,
} = require('../electron/builder-agent-delegation-result-parent-materialization.cjs');
const {
  BUILDER_AGENT_PARENT_TASK_CONTEXT_PROJECTION_VERSION,
  BuilderAgentParentTaskContextProjectionError,
  createBuilderAgentParentTaskContextProjection,
  sanitizeBuilderAgentParentTaskContextProjection,
} = require('../electron/builder-agent-parent-task-context-projection.cjs');

const OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174000';
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

function chain(overrides = {}) {
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
  const materializationRecord = createBuilderAgentDelegationResultParentMaterializationRecord(
    materializationInput(eligibilityRecord, overrides.materialization ?? {}),
    eligibilityRecord,
    reviewRecord,
    admissionRecord,
    resultRecord,
    delegationRecord,
  );
  return {
    admission: admissionRecord,
    delegation: delegationRecord,
    eligibility: eligibilityRecord,
    materialization: materializationRecord,
    result: resultRecord,
    review: reviewRecord,
  };
}

function entryFor(record) {
  return {
    delegation: record.delegation,
    result: record.result,
    admission: record.admission,
    review: record.review,
    eligibility: record.eligibility,
    materialization: record.materialization,
  };
}

function projectionInput(overrides = {}) {
  return {
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    parent_task_id: TASK_ID,
    materializations: [entryFor(chain())],
    created_at_ms: 200,
    ...overrides,
  };
}

function assertProjectionError(fn) {
  assert.throws(
    fn,
    (error) => error instanceof BuilderAgentParentTaskContextProjectionError
      && error.code === 'builder_agent_parent_task_context_projection_invalid'
      && !/secret-value|api\.deepseek|private marker|source text|raw child output|patch body|display summary/iu.test(String(error.stack)),
  );
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function rebindProjectionDigest(rawProjection) {
  const body = {
    projection_version: rawProjection.projection_version,
    owner_id: rawProjection.owner_id,
    project_id: rawProjection.project_id,
    parent_task_id: rawProjection.parent_task_id,
    context_kind: rawProjection.context_kind,
    materialized_child_result_refs: rawProjection.materialized_child_result_refs,
    available_materialization_count: rawProjection.available_materialization_count,
    included_materialization_count: rawProjection.included_materialization_count,
    truncated: rawProjection.truncated,
    created_at_ms: rawProjection.created_at_ms,
    authority: rawProjection.authority,
  };
  const digest = `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(body), 'utf8').digest('hex')}`;
  rawProjection.context_digest = digest;
  rawProjection.projection_id = `builder-agent-parent-task-context-projection:${digest.slice('sha256:'.length)}`;
  return rawProjection;
}

test('creates a digest-bound parent task context projection from materialized child results', () => {
  const first = chain({ materialization: { materialized_at_ms: 108 } });
  const second = chain({
    fixture: {
      delegation: {
        child_conversation_id: SECOND_CHILD_CONVERSATION_ID,
        child_task_id: SECOND_CHILD_TASK_ID,
        child_run_id: SECOND_CHILD_RUN_ID,
        delegated_at_ms: 91,
      },
    },
    result: { observed_at_ms: 109 },
    admission: { admitted_at_ms: 110 },
    review: { reviewed_at_ms: 111 },
    eligibility: { eligibility_recorded_at_ms: 112 },
    materialization: { materialized_at_ms: 113 },
  });
  const projection = createBuilderAgentParentTaskContextProjection(projectionInput({
    materializations: [entryFor(second), entryFor(first)],
  }));

  assert.equal(Object.isFrozen(projection), true);
  assert.equal(projection.projection_version, BUILDER_AGENT_PARENT_TASK_CONTEXT_PROJECTION_VERSION);
  assert.match(projection.projection_id, /^builder-agent-parent-task-context-projection:[0-9a-f]{64}$/u);
  assert.match(projection.context_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(projection.context_kind, 'agent_parent_task_context_from_reviewed_child_results');
  assert.equal(projection.available_materialization_count, 2);
  assert.equal(projection.included_materialization_count, 2);
  assert.equal(projection.truncated, false);
  assert.deepEqual(
    projection.materialized_child_result_refs.map((ref) => ref.child_task_id),
    [CHILD_TASK_ID, SECOND_CHILD_TASK_ID],
  );
  assert.deepEqual(
    projection.materialized_child_result_refs.map((ref) => ref.materialized_at_ms),
    [108, 113],
  );
  assert.deepEqual(
    sanitizeBuilderAgentParentTaskContextProjection(structuredClone(projection), {
      owner_id: OWNER_ID,
      project_id: PROJECT_ID,
      parent_task_id: TASK_ID,
    }),
    projection,
  );
  assert.equal(projection.authority.projection_authority, 'main_agent_parent_task_context_projection_v1');
  assert.equal(projection.authority.parent_task_context_authority, 'local_parent_task_context_projection_only');
  assert.equal(projection.authority.renderer_authority, 'not_present');
  assert.equal(projection.authority.ipc_authority, 'not_present');
  assert.equal(projection.authority.source_write, 'not_present');
  assert.equal(projection.authority.artifact_authority, false);
  assert.equal(projection.authority.parent_source_mutation_authority, false);
  assert.doesNotMatch(
    JSON.stringify(projection),
    /raw child output|patch body|source text|materialization_display_summary|decision_display_summary|eligibility_display_summary|credential_(?:secret|value)|provider_(?:config|secret)|api[_-]?key/iu,
  );
});

test('supports empty and truncated parent task context projections', () => {
  const empty = createBuilderAgentParentTaskContextProjection(projectionInput({
    materializations: [],
  }));
  assert.equal(empty.available_materialization_count, 0);
  assert.equal(empty.included_materialization_count, 0);
  assert.equal(empty.truncated, false);
  assert.deepEqual(empty.materialized_child_result_refs, []);

  const many = [];
  for (let index = 0; index < 33; index += 1) {
    const suffix = (20 + index).toString().padStart(2, '0');
    many.push(entryFor(chain({
      fixture: {
        lease: { expires_at_ms: 2_000 },
        delegation: {
          child_conversation_id: `builder-conversation:123e4567-e89b-42d3-a456-4266141740${suffix}`,
          child_task_id: `builder-task:123e4567-e89b-42d3-a456-4266141740${suffix}`,
          child_run_id: `builder-run:123e4567-e89b-42d3-a456-4266141740${suffix}`,
          delegated_at_ms: 90 + index,
        },
      },
      result: { observed_at_ms: 100 + index },
      admission: { admitted_at_ms: 200 + index },
      review: { reviewed_at_ms: 300 + index },
      eligibility: { eligibility_recorded_at_ms: 400 + index },
      materialization: { materialized_at_ms: 500 + index },
    })));
  }
  const truncated = createBuilderAgentParentTaskContextProjection(projectionInput({
    materializations: many,
  }));
  assert.equal(truncated.available_materialization_count, 33);
  assert.equal(truncated.included_materialization_count, 32);
  assert.equal(truncated.truncated, true);
  assert.equal(truncated.materialized_child_result_refs.at(0).materialized_at_ms, 500);
  assert.equal(truncated.materialized_child_result_refs.at(-1).materialized_at_ms, 531);
});

test('binds projection identity to canonical refs and parent task identity', () => {
  const projection = structuredClone(createBuilderAgentParentTaskContextProjection(projectionInput()));
  projection.materialized_child_result_refs[0].child_task_id = SECOND_CHILD_TASK_ID;
  assertProjectionError(() => sanitizeBuilderAgentParentTaskContextProjection(projection, {
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    parent_task_id: TASK_ID,
  }));

  const clean = createBuilderAgentParentTaskContextProjection(projectionInput());
  assertProjectionError(() => sanitizeBuilderAgentParentTaskContextProjection(clean, {
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    parent_task_id: SECOND_CHILD_TASK_ID,
  }));

  const twoRefs = structuredClone(createBuilderAgentParentTaskContextProjection(projectionInput({
    materializations: [
      entryFor(chain({ materialization: { materialized_at_ms: 108 } })),
      entryFor(chain({
        fixture: {
          delegation: {
            child_conversation_id: SECOND_CHILD_CONVERSATION_ID,
            child_task_id: SECOND_CHILD_TASK_ID,
            child_run_id: SECOND_CHILD_RUN_ID,
            delegated_at_ms: 91,
          },
        },
        result: { observed_at_ms: 109 },
        admission: { admitted_at_ms: 110 },
        review: { reviewed_at_ms: 111 },
        eligibility: { eligibility_recorded_at_ms: 112 },
        materialization: { materialized_at_ms: 113 },
      })),
    ],
  })));
  const duplicateRef = structuredClone(twoRefs);
  duplicateRef.materialized_child_result_refs[1] = structuredClone(
    duplicateRef.materialized_child_result_refs[0],
  );
  assertProjectionError(() => sanitizeBuilderAgentParentTaskContextProjection(
    rebindProjectionDigest(duplicateRef),
  ));
  const unsortedRefs = structuredClone(twoRefs);
  unsortedRefs.materialized_child_result_refs.reverse();
  assertProjectionError(() => sanitizeBuilderAgentParentTaskContextProjection(
    rebindProjectionDigest(unsortedRefs),
  ));
});

test('rejects hostile input, duplicates, mismatched parent identity, and raw output attempts', () => {
  assertProjectionError(() => createBuilderAgentParentTaskContextProjection({
    ...projectionInput(),
    raw_output: 'secret-value',
  }));
  assertProjectionError(() => createBuilderAgentParentTaskContextProjection({
    ...projectionInput(),
    materializations: [entryFor(chain()), entryFor(chain())],
  }));
  assertProjectionError(() => createBuilderAgentParentTaskContextProjection(projectionInput({
    materializations: [entryFor(chain({
      fixture: {
        assignment: { task_id: SECOND_CHILD_TASK_ID },
        lease: { task_id: SECOND_CHILD_TASK_ID },
        delegation: { parent_task_id: SECOND_CHILD_TASK_ID },
      },
    }))],
  })));
  assertProjectionError(() => createBuilderAgentParentTaskContextProjection(projectionInput({
    materializations: [{
      ...entryFor(chain()),
      raw_child_output: 'raw child output',
    }],
  })));
  const accessor = projectionInput();
  Object.defineProperty(accessor, 'materializations', {
    enumerable: true,
    get() {
      throw new Error('private marker');
    },
  });
  assertProjectionError(() => createBuilderAgentParentTaskContextProjection(accessor));
  assertProjectionError(() => createBuilderAgentParentTaskContextProjection(new Proxy(projectionInput(), {})));
});

test('source boundary remains a pure parent task context projection without runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-parent-task-context-projection.cjs'),
    'utf8',
  );
  assert.match(source, /builder-agent-parent-task-context-projection\.v1/u);
  assert.match(source, /local_parent_task_context_projection_only/u);
  assert.match(source, /source_write: 'not_present'/u);
  assert.match(source, /renderer_authority: 'not_present'/u);
  assert.match(source, /ipc_authority: 'not_present'/u);
  assert.match(source, /provider_dispatch: false/u);
  assert.match(source, /tool_dispatch: false/u);
  assert.match(source, /permission_grant_authority: false/u);
  assert.match(source, /parent_source_mutation_authority: false/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:fs|node:http|node:https|http|https|node:child_process|child_process)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|dugite|fetch\s*\(|https?:|Authorization|Bearer|spawn\(|execFile\(|writeFile|rmSync|localStorage|sessionStorage|indexedDB|eval\s*\(|new Function/iu,
  );
});
