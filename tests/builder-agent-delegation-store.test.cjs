'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');

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
  BUILDER_AGENT_DELEGATION_STORE_READ_RESULT_VERSION,
  BUILDER_AGENT_DELEGATION_STORE_RESULT_VERSION,
  BUILDER_AGENT_DELEGATION_STORE_SCHEMA_VERSION,
  BUILDER_AGENT_DELEGATION_STORE_USER_VERSION,
  BUILDER_AGENT_DELEGATION_STORE_VERSION,
  BuilderAgentDelegationStoreError,
  createBuilderAgentDelegationStore,
} = require('../electron/builder-agent-delegation-store.cjs');

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-agent-delegations-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'agent-delegations.sqlite');
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

function delegation(assignmentRecord, activeStatus, leaseRecord, targetVersion, targetDefinition, overrides = {}) {
  return createBuilderAgentDelegationRecord(
    delegationInput(assignmentRecord, activeStatus, leaseRecord, targetVersion, overrides),
    assignmentRecord,
    activeStatus,
    leaseRecord,
    targetVersion,
    targetDefinition,
  );
}

function recordRequest(assignmentRecord, activeStatus, leaseRecord, targetDefinition, targetVersion, delegationRecord) {
  return {
    assignment: assignmentRecord,
    status: activeStatus,
    lease: leaseRecord,
    target_definition: targetDefinition,
    target_version: targetVersion,
    delegation: delegationRecord,
  };
}

function assertStoreError(fn, code = null) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderAgentDelegationStoreError);
      if (code !== null) assert.equal(error.code, code);
      const text = `${error.name}:${error.message}:${error.stack}`;
      assert.doesNotMatch(text, /private|credential|api\.deepseek|secret-value|source text|raw delegation|child output/iu);
      return true;
    },
  );
}

test('records delegation receipts then restores them after restart', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentDelegationStore(databasePath);
  const { activeStatus, assignmentRecord, leaseRecord, targetDefinition, targetVersion } = fixture();
  const delegationRecord = delegation(assignmentRecord, activeStatus, leaseRecord, targetVersion, targetDefinition);

  assert.equal(store.store_version, BUILDER_AGENT_DELEGATION_STORE_VERSION);
  const recorded = store.record_delegation(
    recordRequest(assignmentRecord, activeStatus, leaseRecord, targetDefinition, targetVersion, delegationRecord),
  );
  assert.equal(recorded.result_version, BUILDER_AGENT_DELEGATION_STORE_RESULT_VERSION);
  assert.equal(recorded.operation, 'delegation_recorded');
  assert.deepEqual(recorded.delegation.delegation, delegationRecord);
  assert.deepEqual(recorded.delegation.assignment, assignmentRecord);
  assert.deepEqual(recorded.delegation.status, activeStatus);
  assert.deepEqual(recorded.delegation.lease, leaseRecord);
  assert.deepEqual(recorded.delegation.target_definition, targetDefinition);
  assert.deepEqual(recorded.delegation.target_version, targetVersion);
  assert.equal(recorded.delegation_evidence.delegation_authority, 'main_owned_agent_delegation_store');
  assert.equal(recorded.delegation_evidence.renderer_authority, 'not_present');
  assert.equal(recorded.delegation_evidence.ipc_authority, 'not_present');
  assert.equal(recorded.delegation_evidence.child_assignment_authority, false);
  assert.equal(recorded.delegation_evidence.model_dispatch, false);
  assert.equal(recorded.delegation_evidence.tool_dispatch, false);
  assert.equal(recorded.delegation_evidence.permission_grant_authority, false);
  assert.equal(recorded.delegation_evidence.credential_storage, 'not_present');
  assert.equal(recorded.delegation_evidence.source_read, 'not_present');
  assert.equal(recorded.delegation_evidence.source_write, 'not_present');
  assert.equal(recorded.delegation_evidence.process_run, false);
  assert.equal(recorded.delegation_evidence.network_access, false);
  assert.equal(recorded.delegation_evidence.revision_authority, false);
  assert.equal(recorded.delegation_evidence.review_authority, false);
  assert.equal(recorded.delegation_evidence.artifact_authority, false);
  assert.equal(recorded.delegation_evidence.schema_version, BUILDER_AGENT_DELEGATION_STORE_SCHEMA_VERSION);
  assert.equal(recorded.delegation_evidence.user_version, BUILDER_AGENT_DELEGATION_STORE_USER_VERSION);
  assert.match(recorded.delegation_evidence.schema_fingerprint_digest, /^[a-f0-9]{64}$/u);

  assert.equal(
    store.record_delegation(
      recordRequest(assignmentRecord, activeStatus, leaseRecord, targetDefinition, targetVersion, delegationRecord),
    ).operation,
    'delegation_replayed',
  );

  const read = store.read_delegation({ delegation_id: delegationRecord.delegation_id, owner_id: OWNER_ID });
  assert.equal(read.result_version, BUILDER_AGENT_DELEGATION_STORE_READ_RESULT_VERSION);
  assert.equal(read.status, 'ready');
  assert.deepEqual(read.delegation.delegation, delegationRecord);
  assert.equal(Object.isFrozen(read), true);
  assert.equal(Object.isFrozen(read.delegation), true);

  const parentList = store.list_parent_task_delegations({
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    parent_task_id: TASK_ID,
  });
  assert.equal(parentList.status, 'ready');
  assert.equal(parentList.delegations.length, 1);
  assert.deepEqual(parentList.delegations[0].delegation, delegationRecord);

  const childList = store.list_child_task_delegations({
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    child_task_id: CHILD_TASK_ID,
  });
  assert.equal(childList.status, 'ready');
  assert.equal(childList.delegations.length, 1);
  assert.deepEqual(childList.delegations[0].delegation, delegationRecord);
  store.close();

  const restarted = createBuilderAgentDelegationStore(databasePath);
  const restored = restarted.read_delegation({ delegation_id: delegationRecord.delegation_id, owner_id: OWNER_ID });
  assert.equal(restored.status, 'ready');
  assert.deepEqual(restored.delegation.delegation, delegationRecord);
  assert.deepEqual(restored.delegation.target_version, targetVersion);
  restarted.close();
});

test('records multiple child delegations while enforcing owner scope and child identity uniqueness', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentDelegationStore(databasePath);
  const first = fixture();
  const firstDelegation = delegation(
    first.assignmentRecord,
    first.activeStatus,
    first.leaseRecord,
    first.targetVersion,
    first.targetDefinition,
  );
  store.record_delegation(recordRequest(
    first.assignmentRecord,
    first.activeStatus,
    first.leaseRecord,
    first.targetDefinition,
    first.targetVersion,
    firstDelegation,
  ));

  const secondDelegation = delegation(
    first.assignmentRecord,
    first.activeStatus,
    first.leaseRecord,
    first.targetVersion,
    first.targetDefinition,
    {
      child_conversation_id: SECOND_CHILD_CONVERSATION_ID,
      child_task_id: SECOND_CHILD_TASK_ID,
      child_run_id: SECOND_CHILD_RUN_ID,
      delegated_goal: 'Review accessibility risks before owner review.',
      delegated_at_ms: 100,
      budget_intersection: {
        max_steps: 4,
        max_tool_calls: 1,
        max_runtime_ms: 20_000,
        max_private_source_bytes: 4_096,
      },
    },
  );
  assert.equal(
    store.record_delegation(recordRequest(
      first.assignmentRecord,
      first.activeStatus,
      first.leaseRecord,
      first.targetDefinition,
      first.targetVersion,
      secondDelegation,
    )).operation,
    'delegation_recorded',
  );

  const parentList = store.list_parent_task_delegations({
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    parent_task_id: TASK_ID,
  });
  assert.equal(parentList.delegations.length, 2);
  assert.deepEqual(parentList.delegations.map((entry) => entry.delegation.child_task_id), [
    CHILD_TASK_ID,
    SECOND_CHILD_TASK_ID,
  ]);
  assert.equal(
    store.read_delegation({ delegation_id: firstDelegation.delegation_id, owner_id: OTHER_OWNER_ID }).status,
    'absent',
  );
  assert.equal(
    store.list_parent_task_delegations({
      owner_id: OTHER_OWNER_ID,
      project_id: PROJECT_ID,
      parent_task_id: TASK_ID,
    }).status,
    'absent',
  );

  const sameChildTask = delegation(
    first.assignmentRecord,
    first.activeStatus,
    first.leaseRecord,
    first.targetVersion,
    first.targetDefinition,
    {
      child_task_id: CHILD_TASK_ID,
      child_run_id: SECOND_CHILD_RUN_ID,
      delegated_at_ms: 110,
      delegated_goal: 'A conflicting child task should not be accepted.',
    },
  );
  assertStoreError(
    () => store.record_delegation(recordRequest(
      first.assignmentRecord,
      first.activeStatus,
      first.leaseRecord,
      first.targetDefinition,
      first.targetVersion,
      sameChildTask,
    )),
    'builder_agent_delegation_store_conflict',
  );
  store.close();
});

test('rejects hostile input, inactive assignment status, malformed reads, and tampered rows', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentDelegationStore(databasePath);
  const { activeStatus, assignmentRecord, leaseRecord, targetDefinition, targetVersion } = fixture();
  const delegationRecord = delegation(assignmentRecord, activeStatus, leaseRecord, targetVersion, targetDefinition);

  assertStoreError(() => store.record_delegation({
    ...recordRequest(assignmentRecord, activeStatus, leaseRecord, targetDefinition, targetVersion, delegationRecord),
    extra: true,
  }));
  assertStoreError(() => store.read_delegation({
    delegation_id: delegationRecord.delegation_id,
    owner_id: OWNER_ID,
    extra: true,
  }));
  assertStoreError(() => store.list_parent_task_delegations({
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    parent_task_id: TASK_ID,
    extra: true,
  }));
  assertStoreError(() => store.list_child_task_delegations({
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    child_task_id: CHILD_TASK_ID,
    extra: true,
  }));

  let getterCalls = 0;
  const accessor = recordRequest(assignmentRecord, activeStatus, leaseRecord, targetDefinition, targetVersion, delegationRecord);
  Object.defineProperty(accessor, 'delegation', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('private credential getter');
    },
  });
  assertStoreError(() => store.record_delegation(accessor));
  assert.equal(getterCalls, 0);

  let proxyTrapInvoked = false;
  const proxyTrap = () => {
    proxyTrapInvoked = true;
    throw new Error('private proxy marker');
  };
  assertStoreError(() => store.record_delegation(new Proxy(
    recordRequest(assignmentRecord, activeStatus, leaseRecord, targetDefinition, targetVersion, delegationRecord),
    {
      getOwnPropertyDescriptor: proxyTrap,
      getPrototypeOf: proxyTrap,
      ownKeys: proxyTrap,
    },
  )));
  assert.equal(proxyTrapInvoked, false);

  const pausedStatus = createBuilderAgentAssignmentStatusRecord({
    ...statusInput(assignmentRecord),
    next_status: 'paused',
    reason: 'Owner paused this assignment.',
    decided_at_ms: 42,
  }, assignmentRecord);
  assertStoreError(
    () => store.record_delegation(recordRequest(
      assignmentRecord,
      pausedStatus,
      leaseRecord,
      targetDefinition,
      targetVersion,
      delegationRecord,
    )),
    'builder_agent_delegation_store_invalid',
  );

  store.record_delegation(
    recordRequest(assignmentRecord, activeStatus, leaseRecord, targetDefinition, targetVersion, delegationRecord),
  );
  store.close();

  const raw = new DatabaseSync(databasePath);
  raw.prepare('UPDATE agent_delegations SET child_max_steps = ? WHERE delegation_id = ?')
    .run(6, delegationRecord.delegation_id);
  raw.close();

  const corrupted = createBuilderAgentDelegationStore(databasePath);
  assertStoreError(
    () => corrupted.read_delegation({ delegation_id: delegationRecord.delegation_id, owner_id: OWNER_ID }),
    'builder_agent_delegation_store_integrity_failed',
  );
  corrupted.close();
});

test('rejects schema drift and unsafe database paths', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentDelegationStore(databasePath);
  store.close();

  const raw = new DatabaseSync(databasePath);
  raw.exec('CREATE TABLE unexpected_delegation_fact (id TEXT PRIMARY KEY) STRICT');
  raw.close();

  assertStoreError(
    () => createBuilderAgentDelegationStore(databasePath),
    'builder_agent_delegation_store_integrity_failed',
  );
  assertStoreError(
    () => createBuilderAgentDelegationStore(path.join('relative', 'agent-delegations.sqlite')),
    'builder_agent_delegation_store_invalid',
  );

  const notDatabasePath = path.join(path.dirname(databasePath), 'not-a-database.sqlite');
  fs.writeFileSync(notDatabasePath, 'not sqlite private credential marker');
  assertStoreError(
    () => createBuilderAgentDelegationStore(notDatabasePath),
    'builder_agent_delegation_store_unavailable',
  );
});

test('source boundary remains a main-only Agent delegation store without runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-delegation-store.cjs'),
    'utf8',
  );
  assert.match(source, /main_owned_agent_delegation_store/u);
  assert.match(source, /record_delegation/u);
  assert.match(source, /read_delegation/u);
  assert.match(source, /list_parent_task_delegations/u);
  assert.match(source, /list_child_task_delegations/u);
  assert.match(source, /node:sqlite/u);
  assert.match(source, /utilTypes\.isProxy/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:http|node:https|http|https)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|dugite|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|shell:\s*true|localStorage|sessionStorage|indexedDB|better-sqlite|eval\s*\(|new Function/iu,
  );
});
