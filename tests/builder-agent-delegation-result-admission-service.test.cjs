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
  BUILDER_AGENT_DELEGATION_RESULT_STORE_VERSION,
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
  BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_VERSION,
  createBuilderAgentDelegationResultAdmissionStore,
} = require('../electron/builder-agent-delegation-result-admission-store.cjs');
const {
  BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_SERVICE_VERSION,
  BuilderAgentDelegationResultAdmissionServiceError,
  createBuilderAgentDelegationResultAdmissionService,
} = require('../electron/builder-agent-delegation-result-admission-service.cjs');

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
  };
}

function closeStores(stores) {
  stores.definition_store.close();
  stores.assignment_store.close();
  stores.lease_store.close();
  stores.delegation_store.close();
  stores.result_store.close();
  stores.admission_store.close();
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

function serviceFor(t) {
  const root = temporaryRoot('clawfabric-builder-agent-delegation-result-admission-service-');
  const stores = openStores(root);
  const service = openAdmissionService(stores);
  t.after(() => {
    closeStores(stores);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, service, stores };
}

function request(result, overrides = {}) {
  const admission_input = overrides.admission_input ?? admissionInput(result, overrides.admissionInput ?? {});
  return {
    owner_id: overrides.owner_id ?? OWNER_ID,
    delegation_result_id: overrides.delegation_result_id ?? result.delegation_result_id,
    admission_input,
    now_ms: overrides.now_ms ?? admission_input.admitted_at_ms,
  };
}

function assertServiceError(fn, code) {
  assert.throws(
    fn,
    (error) => error instanceof BuilderAgentDelegationResultAdmissionServiceError
      && error.code === code
      && !/private|credential|api\.deepseek|secret-value|source text|child output|raw result|patch body/iu.test(String(error.stack)),
  );
}

test('records a store-backed delegated result admission without parent materialization', (t) => {
  const { service, stores } = serviceFor(t);
  const facts = fixture();
  const { delegation, result } = seedDelegationResult(stores, facts);
  const expectedAdmission = createBuilderAgentDelegationResultAdmissionRecord(
    admissionInput(result),
    result,
    delegation,
  );

  const recorded = service.record_delegation_result_admission(request(result));
  assert.equal(recorded.result_version, BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_SERVICE_RESULT_VERSION);
  assert.equal(recorded.service_version, BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_SERVICE_VERSION);
  assert.equal(recorded.operation, 'agent_delegation_result_admission_recorded');
  assert.equal(recorded.status, 'ready');
  assert.equal(recorded.admission_status, 'admitted_for_parent_review');
  assert.equal(recorded.result_status, 'proposed');
  assert.deepEqual(recorded.delegation_result_admission, expectedAdmission);
  assert.equal(recorded.result_read.status, 'ready');
  assert.equal(recorded.parent_task_results.delegation_results.length, 1);
  assert.equal(recorded.child_task_results.delegation_results.length, 1);
  assert.equal(
    recorded.admission_read.delegation_result_admission.admission.delegation_result_admission_id,
    expectedAdmission.delegation_result_admission_id,
  );
  assert.equal(
    recorded.admission_for_result.delegation_result_admission.admission.delegation_result_admission_id,
    expectedAdmission.delegation_result_admission_id,
  );
  assert.equal(recorded.parent_task_admissions.delegation_result_admissions.length, 1);
  assert.equal(recorded.child_task_admissions.delegation_result_admissions.length, 1);
  assert.equal(recorded.operations.admission_store, 'delegation_result_admission_recorded');
  assert.equal(recorded.evidence.service_authority, 'main_owned_agent_delegation_result_admission_service');
  assert.equal(recorded.evidence.result_store_authority, 'main_owned_agent_delegation_result_store');
  assert.equal(recorded.evidence.admission_store_authority, 'main_owned_agent_delegation_result_admission_store');
  assert.equal(recorded.evidence.child_assignment_authority, false);
  assert.equal(recorded.evidence.child_run_authority, false);
  assert.equal(recorded.evidence.provider_dispatch, false);
  assert.equal(recorded.evidence.tool_dispatch, false);
  assert.equal(recorded.evidence.permission_grant_authority, false);
  assert.equal(recorded.evidence.source_access, 'not_present');
  assert.equal(recorded.evidence.source_write, 'not_present');
  assert.equal(recorded.evidence.revision_authority, false);
  assert.equal(recorded.evidence.review_authority, 'required_later');
  assert.equal(recorded.evidence.artifact_authority, false);
  assert.equal(recorded.evidence.parent_materialization_authority, false);

  const replay = service.record_delegation_result_admission(request(result));
  assert.equal(replay.operations.admission_store, 'delegation_result_admission_replayed');
  assert.deepEqual(replay.delegation_result_admission, recorded.delegation_result_admission);
});

test('admits blocked delegated child results while keeping owner review separate', (t) => {
  const { service, stores } = serviceFor(t);
  const facts = fixture();
  const { result } = seedDelegationResult(stores, facts, {
    resultInput: {
      observed_at_ms: 105,
      result: {
        status: 'blocked',
        summary_code: 'delegated_child_result_needs_owner_attention',
      },
    },
  });

  const recorded = service.record_delegation_result_admission(request(result));
  assert.equal(recorded.result_status, 'blocked');
  assert.equal(
    recorded.delegation_result_admission.admission_summary_code,
    'delegated_child_blocker_admitted_for_owner_attention',
  );
  assert.equal(recorded.evidence.process_run, false);
  assert.equal(recorded.evidence.review_authority, 'required_later');
  assert.equal(recorded.evidence.parent_materialization_authority, false);
});

test('recovers Delegation result admission service state across restart through idempotent replay', () => {
  const root = temporaryRoot('clawfabric-builder-agent-delegation-result-admission-service-restart-');
  const stores = openStores(root);
  const facts = fixture();
  const { result } = seedDelegationResult(stores, facts);
  const service = openAdmissionService(stores);
  const first = service.record_delegation_result_admission(request(result));
  closeStores(stores);

  const reopened = openStores(root);
  const restarted = openAdmissionService(reopened);
  const replay = restarted.record_delegation_result_admission(request(result));
  assert.equal(replay.operations.admission_store, 'delegation_result_admission_replayed');
  assert.deepEqual(replay.delegation_result_admission, first.delegation_result_admission);
  assert.equal(replay.parent_task_admissions.delegation_result_admissions.length, 1);
  assert.equal(replay.child_task_admissions.delegation_result_admissions.length, 1);
  closeStores(reopened);
  fs.rmSync(root, { recursive: true, force: true });
});

test('fails closed for missing result, drift, replay conflict, and malformed stores', (t) => {
  {
    const { service } = serviceFor(t);
    const facts = fixture();
    const delegation = pureDelegation(facts);
    const result = createBuilderAgentDelegationResultRecord(resultInput(delegation), delegation);
    assertServiceError(
      () => service.record_delegation_result_admission(request(result)),
      'builder_agent_delegation_result_admission_service_conflict',
    );
  }
  {
    const { service, stores } = serviceFor(t);
    const facts = fixture();
    const { result } = seedDelegationResult(stores, facts);
    assertServiceError(
      () => service.record_delegation_result_admission(request(result, { owner_id: OTHER_OWNER_ID })),
      'builder_agent_delegation_result_admission_service_conflict',
    );
    assertServiceError(
      () => service.record_delegation_result_admission(request(result, {
        admissionInput: { admitted_at_ms: result.observed_at_ms - 1 },
        now_ms: result.observed_at_ms - 1,
      })),
      'builder_agent_delegation_result_admission_service_invalid',
    );
    assertServiceError(
      () => service.record_delegation_result_admission(request(result, {
        admissionInput: {
          admission_summary_code: 'delegated_child_failure_admitted_for_owner_attention',
        },
      })),
      'builder_agent_delegation_result_admission_service_invalid',
    );
    assertServiceError(
      () => service.record_delegation_result_admission(request(result, {
        admissionInput: { parent_materialization_boundary: 'mutate_parent_task' },
      })),
      'builder_agent_delegation_result_admission_service_invalid',
    );
  }
  {
    const { service, stores } = serviceFor(t);
    const facts = fixture();
    const { result } = seedDelegationResult(stores, facts);
    service.record_delegation_result_admission(request(result));
    assertServiceError(
      () => service.record_delegation_result_admission(request(result, {
        admissionInput: { admitted_at_ms: result.observed_at_ms + 6 },
        now_ms: result.observed_at_ms + 6,
      })),
      'builder_agent_delegation_result_admission_service_conflict',
    );
  }
  {
    const { stores } = serviceFor(t);
    assertServiceError(
      () => createBuilderAgentDelegationResultAdmissionService({
        result_store: { store_version: BUILDER_AGENT_DELEGATION_RESULT_STORE_VERSION },
        admission_store: stores.admission_store,
      }),
      'builder_agent_delegation_result_admission_service_invalid',
    );
    assertServiceError(
      () => createBuilderAgentDelegationResultAdmissionService({
        result_store: stores.result_store,
        admission_store: { store_version: BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_VERSION },
      }),
      'builder_agent_delegation_result_admission_service_invalid',
    );
  }
});

test('source boundary remains main-only and exposes no review or materialization authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-delegation-result-admission-service.cjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /require\('electron'\)|ipcMain|BrowserWindow|preload|safeStorage|provider-config|provider-secret/iu);
  assert.doesNotMatch(source, /node:child_process|require\(['"]child_process['"]\)|spawn\(|execFile\(|writeFile|rmSync/iu);
  assert.match(source, /service_authority: 'main_owned_agent_delegation_result_admission_service'/u);
  assert.match(source, /child_assignment_authority: false/u);
  assert.match(source, /child_run_authority: false/u);
  assert.match(source, /provider_dispatch: false/u);
  assert.match(source, /tool_dispatch: false/u);
  assert.match(source, /permission_grant_authority: false/u);
  assert.match(source, /source_access: 'not_present'/u);
  assert.match(source, /source_write: 'not_present'/u);
  assert.match(source, /revision_authority: false/u);
  assert.match(source, /review_authority: 'required_later'/u);
  assert.match(source, /artifact_authority: false/u);
  assert.match(source, /parent_materialization_authority: false/u);
});
