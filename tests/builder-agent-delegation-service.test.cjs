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
  BUILDER_AGENT_ASSIGNMENT_STORE_VERSION,
  createBuilderAgentAssignmentStore,
} = require('../electron/builder-agent-assignment-store.cjs');
const {
  BUILDER_AGENT_SUPERVISION_LEASE_RECORD_VERSION,
  createBuilderAgentSupervisionLeaseRecord,
} = require('../electron/builder-agent-supervision-lease-contract.cjs');
const {
  BUILDER_AGENT_SUPERVISION_LEASE_STORE_VERSION,
  createBuilderAgentSupervisionLeaseStore,
} = require('../electron/builder-agent-supervision-lease-store.cjs');
const {
  BUILDER_AGENT_DELEGATION_RECORD_KIND,
  BUILDER_AGENT_DELEGATION_RECORD_VERSION,
} = require('../electron/builder-agent-delegation-contract.cjs');
const {
  BUILDER_AGENT_DELEGATION_STORE_VERSION,
  createBuilderAgentDelegationStore,
} = require('../electron/builder-agent-delegation-store.cjs');
const {
  BUILDER_AGENT_DELEGATION_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_DELEGATION_SERVICE_VERSION,
  BuilderAgentDelegationServiceError,
  createBuilderAgentDelegationService,
} = require('../electron/builder-agent-delegation-service.cjs');

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
  };
}

function closeStores(stores) {
  stores.definition_store.close();
  stores.assignment_store.close();
  stores.lease_store.close();
  stores.delegation_store.close();
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

function serviceFor(t) {
  const root = temporaryRoot('clawfabric-builder-agent-delegation-service-');
  const stores = openStores(root);
  const service = createBuilderAgentDelegationService(stores);
  t.after(() => {
    closeStores(stores);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, service, stores };
}

function request(facts, overrides = {}) {
  const delegation_input = overrides.delegation_input
    ?? delegationInput(facts, overrides.delegationInput ?? {});
  return {
    owner_id: overrides.owner_id ?? OWNER_ID,
    parent_assignment_id: overrides.parent_assignment_id ?? facts.assignment.assignment_id,
    target_agent_id: overrides.target_agent_id ?? TARGET_AGENT_ID,
    delegation_input,
    now_ms: overrides.now_ms ?? delegation_input.delegated_at_ms,
  };
}

function assertServiceError(fn, code) {
  assert.throws(
    fn,
    (error) => error instanceof BuilderAgentDelegationServiceError
      && error.code === code
      && !/private|credential|api\.deepseek|secret-value|source text|child output|raw delegation/iu.test(String(error.stack)),
  );
}

test('records a store-backed Agent Delegation without child assignment or dispatch authority', (t) => {
  const { service, stores } = serviceFor(t);
  const facts = fixture();
  seedParentAssignment(stores, facts);
  seedLease(stores, facts);
  seedTargetAgent(stores, facts);

  const result = service.record_agent_delegation(request(facts));
  assert.equal(result.result_version, BUILDER_AGENT_DELEGATION_SERVICE_RESULT_VERSION);
  assert.equal(result.service_version, BUILDER_AGENT_DELEGATION_SERVICE_VERSION);
  assert.equal(result.operation, 'agent_delegation_recorded');
  assert.equal(result.status, 'ready');
  assert.equal(result.delegation.owner_id, OWNER_ID);
  assert.equal(result.delegation.parent_assignment_id, facts.assignment.assignment_id);
  assert.equal(result.delegation.parent_lease_id, facts.lease.lease_id);
  assert.equal(result.delegation.to_agent_id, TARGET_AGENT_ID);
  assert.equal(result.delegation.child_task_id, CHILD_TASK_ID);
  assert.equal(result.parent_assignment_read.current_status, 'active');
  assert.equal(result.assignment_leases.active_lease.lease.lease_id, facts.lease.lease_id);
  assert.equal(result.target_agent_read.current_status, 'active');
  assert.equal(result.target_agent_read.current_version.agent_version_id, facts.targetVersion.agent_version_id);
  assert.equal(result.delegation_read.status, 'ready');
  assert.equal(result.parent_task_delegations.delegations.length, 1);
  assert.equal(result.child_task_delegations.delegations.length, 1);
  assert.equal(result.operations.delegation_store, 'delegation_recorded');
  assert.equal(result.evidence.service_authority, 'main_owned_agent_delegation_service');
  assert.equal(result.evidence.definition_store_authority, 'main_owned_agent_definition_store');
  assert.equal(result.evidence.assignment_store_authority, 'main_owned_agent_assignment_store');
  assert.equal(result.evidence.lease_store_authority, 'main_owned_agent_supervision_lease_store');
  assert.equal(result.evidence.delegation_store_authority, 'main_owned_agent_delegation_store');
  assert.equal(result.evidence.child_assignment_authority, false);
  assert.equal(result.evidence.child_run_authority, false);
  assert.equal(result.evidence.provider_dispatch, false);
  assert.equal(result.evidence.tool_dispatch, false);
  assert.equal(result.evidence.permission_grant_authority, false);
  assert.equal(result.evidence.source_access, 'not_present');
  assert.equal(result.evidence.source_write, 'not_present');
  assert.equal(result.evidence.revision_authority, false);
  assert.equal(result.evidence.review_authority, false);
  assert.equal(result.evidence.artifact_authority, false);

  const replay = service.record_agent_delegation(request(facts));
  assert.equal(replay.operations.delegation_store, 'delegation_replayed');
  assert.deepEqual(replay.delegation, result.delegation);
});

test('recovers Agent Delegation service state across restart through idempotent replay', () => {
  const root = temporaryRoot('clawfabric-builder-agent-delegation-service-restart-');
  const stores = openStores(root);
  const facts = fixture();
  seedParentAssignment(stores, facts);
  seedLease(stores, facts);
  seedTargetAgent(stores, facts);
  const service = createBuilderAgentDelegationService(stores);
  const first = service.record_agent_delegation(request(facts));
  closeStores(stores);

  const reopened = openStores(root);
  const restarted = createBuilderAgentDelegationService(reopened);
  const replay = restarted.record_agent_delegation(request(facts));
  assert.equal(replay.operations.delegation_store, 'delegation_replayed');
  assert.deepEqual(replay.delegation, first.delegation);
  assert.equal(replay.parent_task_delegations.delegations.length, 1);
  assert.equal(replay.child_task_delegations.delegations.length, 1);
  closeStores(reopened);
  fs.rmSync(root, { recursive: true, force: true });
});

test('fails closed for missing active parent, lease, target Agent, drift, and malformed stores', (t) => {
  {
    const { service } = serviceFor(t);
    const facts = fixture();
    assertServiceError(
      () => service.record_agent_delegation(request(facts)),
      'builder_agent_delegation_service_conflict',
    );
  }
  {
    const { service, stores } = serviceFor(t);
    const facts = fixture();
    seedParentAssignment(stores, facts);
    seedTargetAgent(stores, facts);
    assertServiceError(
      () => service.record_agent_delegation(request(facts)),
      'builder_agent_delegation_service_conflict',
    );
  }
  {
    const { service, stores } = serviceFor(t);
    const facts = fixture();
    seedParentAssignment(stores, facts);
    seedLease(stores, facts);
    assertServiceError(
      () => service.record_agent_delegation(request(facts)),
      'builder_agent_delegation_service_conflict',
    );
  }
  {
    const { service, stores } = serviceFor(t);
    const facts = fixture();
    seedParentAssignment(stores, facts);
    seedLease(stores, facts);
    seedTargetAgent(stores, facts);
    const paused = createBuilderAgentAssignmentStatusRecord(
      statusInput(facts.assignment, {
        next_status: 'paused',
        reason: 'Owner paused the parent assignment.',
        decided_at_ms: 45,
      }),
      facts.assignment,
    );
    stores.assignment_store.record_status({ status: paused });
    assertServiceError(
      () => service.record_agent_delegation(request(facts)),
      'builder_agent_delegation_service_conflict',
    );
  }
  {
    const { service, stores } = serviceFor(t);
    const facts = fixture();
    seedParentAssignment(stores, facts);
    seedLease(stores, facts);
    seedTargetAgent(stores, facts);
    assertServiceError(
      () => service.record_agent_delegation(request(facts, {
        delegationInput: { delegated_at_ms: facts.lease.expires_at_ms + 1 },
      })),
      'builder_agent_delegation_service_conflict',
    );
  }
  {
    const { service, stores } = serviceFor(t);
    const facts = fixture();
    seedParentAssignment(stores, facts);
    seedLease(stores, facts);
    seedTargetAgent(stores, facts);
    const revoked = createBuilderAgentLifecycleRecord(
      lifecycleInput(facts.targetDefinition, {
        next_status: 'revoked',
        reason: 'Owner revoked the target Agent.',
        decided_at_ms: 40,
      }),
      facts.targetDefinition,
    );
    stores.definition_store.record_lifecycle({ lifecycle: revoked });
    assertServiceError(
      () => service.record_agent_delegation(request(facts)),
      'builder_agent_delegation_service_conflict',
    );
  }
  {
    const { service, stores } = serviceFor(t);
    const facts = fixture();
    seedParentAssignment(stores, facts);
    seedLease(stores, facts);
    seedTargetAgent(stores, facts);
    assertServiceError(
      () => service.record_agent_delegation(request(facts, {
        owner_id: OTHER_OWNER_ID,
      })),
      'builder_agent_delegation_service_conflict',
    );
    assertServiceError(
      () => service.record_agent_delegation(request(facts, {
        delegationInput: {
          budget_intersection: {
            max_steps: 13,
            max_tool_calls: 1,
            max_runtime_ms: 30_000,
            max_private_source_bytes: 8_192,
          },
        },
      })),
      'builder_agent_delegation_service_invalid',
    );
    assertServiceError(
      () => service.record_agent_delegation(request(facts, {
        target_agent_id: AGENT_ID,
      })),
      'builder_agent_delegation_service_conflict',
    );
  }
  {
    const { stores } = serviceFor(t);
    assertServiceError(
      () => createBuilderAgentDelegationService({
        definition_store: { store_version: stores.definition_store.store_version },
        assignment_store: stores.assignment_store,
        lease_store: stores.lease_store,
        delegation_store: stores.delegation_store,
      }),
      'builder_agent_delegation_service_invalid',
    );
    assertServiceError(
      () => createBuilderAgentDelegationService({
        definition_store: stores.definition_store,
        assignment_store: { store_version: BUILDER_AGENT_ASSIGNMENT_STORE_VERSION },
        lease_store: stores.lease_store,
        delegation_store: stores.delegation_store,
      }),
      'builder_agent_delegation_service_invalid',
    );
    assertServiceError(
      () => createBuilderAgentDelegationService({
        definition_store: stores.definition_store,
        assignment_store: stores.assignment_store,
        lease_store: { store_version: BUILDER_AGENT_SUPERVISION_LEASE_STORE_VERSION },
        delegation_store: stores.delegation_store,
      }),
      'builder_agent_delegation_service_invalid',
    );
    assertServiceError(
      () => createBuilderAgentDelegationService({
        definition_store: stores.definition_store,
        assignment_store: stores.assignment_store,
        lease_store: stores.lease_store,
        delegation_store: { store_version: BUILDER_AGENT_DELEGATION_STORE_VERSION },
      }),
      'builder_agent_delegation_service_invalid',
    );
  }
});

test('source boundary remains main-only and exposes no child execution authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-delegation-service.cjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /require\('electron'\)|ipcMain|BrowserWindow|preload|safeStorage|provider-config|provider-secret/iu);
  assert.doesNotMatch(source, /node:child_process|require\(['"]child_process['"]\)|spawn\(|execFile\(|writeFile|rmSync/iu);
  assert.match(source, /service_authority: 'main_owned_agent_delegation_service'/u);
  assert.match(source, /child_assignment_authority: false/u);
  assert.match(source, /child_run_authority: false/u);
  assert.match(source, /provider_dispatch: false/u);
  assert.match(source, /tool_dispatch: false/u);
  assert.match(source, /permission_grant_authority: false/u);
  assert.match(source, /source_access: 'not_present'/u);
  assert.match(source, /source_write: 'not_present'/u);
  assert.match(source, /revision_authority: false/u);
  assert.match(source, /review_authority: false/u);
  assert.match(source, /artifact_authority: false/u);
});
