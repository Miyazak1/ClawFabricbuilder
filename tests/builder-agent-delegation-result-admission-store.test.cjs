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
  BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_READ_RESULT_VERSION,
  BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_RESULT_VERSION,
  BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_SCHEMA_VERSION,
  BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_USER_VERSION,
  BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_VERSION,
  BuilderAgentDelegationResultAdmissionStoreError,
  createBuilderAgentDelegationResultAdmissionStore,
} = require('../electron/builder-agent-delegation-result-admission-store.cjs');

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-agent-delegation-admissions-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'agent-delegation-result-admissions.sqlite');
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

function admissionRecord(result, delegationRecord, overrides = {}) {
  return createBuilderAgentDelegationResultAdmissionRecord(
    admissionInput(result, overrides),
    result,
    delegationRecord,
  );
}

function recordRequest(delegationRecord, result, admission) {
  return { admission, delegation: delegationRecord, result };
}

function assertStoreError(fn, code = null) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderAgentDelegationResultAdmissionStoreError);
      if (code !== null) assert.equal(error.code, code);
      const text = `${error.name}:${error.message}:${error.stack}`;
      assert.doesNotMatch(text, /private|credential|api\.deepseek|secret-value|source text|raw child output|patch body/iu);
      return true;
    },
  );
}

test('records delegation result admissions then restores them after restart', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentDelegationResultAdmissionStore(databasePath);
  const { delegationRecord } = fixture();
  const result = resultRecord(delegationRecord);
  const admission = admissionRecord(result, delegationRecord);

  assert.equal(store.store_version, BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_VERSION);
  const recorded = store.record_admission(recordRequest(delegationRecord, result, admission));
  assert.equal(recorded.result_version, BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_RESULT_VERSION);
  assert.equal(recorded.operation, 'delegation_result_admission_recorded');
  assert.deepEqual(recorded.delegation_result_admission.admission, admission);
  assert.deepEqual(recorded.delegation_result_admission.result, result);
  assert.deepEqual(recorded.delegation_result_admission.delegation, delegationRecord);
  assert.equal(
    recorded.delegation_result_admission_evidence.delegation_result_admission_authority,
    'main_owned_agent_delegation_result_admission_store',
  );
  assert.equal(recorded.delegation_result_admission_evidence.renderer_authority, 'not_present');
  assert.equal(recorded.delegation_result_admission_evidence.ipc_authority, 'not_present');
  assert.equal(recorded.delegation_result_admission_evidence.child_assignment_authority, false);
  assert.equal(recorded.delegation_result_admission_evidence.model_dispatch, false);
  assert.equal(recorded.delegation_result_admission_evidence.tool_dispatch, false);
  assert.equal(recorded.delegation_result_admission_evidence.permission_grant_authority, false);
  assert.equal(recorded.delegation_result_admission_evidence.credential_storage, 'not_present');
  assert.equal(recorded.delegation_result_admission_evidence.source_read, 'not_present');
  assert.equal(recorded.delegation_result_admission_evidence.source_write, 'not_present');
  assert.equal(recorded.delegation_result_admission_evidence.process_run, false);
  assert.equal(recorded.delegation_result_admission_evidence.network_access, false);
  assert.equal(recorded.delegation_result_admission_evidence.revision_authority, false);
  assert.equal(recorded.delegation_result_admission_evidence.review_authority, false);
  assert.equal(recorded.delegation_result_admission_evidence.artifact_authority, false);
  assert.equal(
    recorded.delegation_result_admission_evidence.schema_version,
    BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_SCHEMA_VERSION,
  );
  assert.equal(
    recorded.delegation_result_admission_evidence.user_version,
    BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_USER_VERSION,
  );
  assert.match(recorded.delegation_result_admission_evidence.schema_fingerprint_digest, /^[a-f0-9]{64}$/u);

  assert.equal(
    store.record_admission(recordRequest(delegationRecord, result, admission)).operation,
    'delegation_result_admission_replayed',
  );

  const read = store.read_admission({
    delegation_result_admission_id: admission.delegation_result_admission_id,
    owner_id: OWNER_ID,
  });
  assert.equal(read.result_version, BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_READ_RESULT_VERSION);
  assert.equal(read.status, 'ready');
  assert.deepEqual(read.delegation_result_admission.admission, admission);
  assert.equal(Object.isFrozen(read), true);
  assert.equal(Object.isFrozen(read.delegation_result_admission), true);

  const byResult = store.read_admission_for_result({
    delegation_result_id: result.delegation_result_id,
    owner_id: OWNER_ID,
  });
  assert.equal(byResult.status, 'ready');
  assert.deepEqual(byResult.delegation_result_admission.admission, admission);

  const parentList = store.list_parent_task_admissions({
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    parent_task_id: TASK_ID,
  });
  assert.equal(parentList.status, 'ready');
  assert.equal(parentList.delegation_result_admissions.length, 1);
  assert.deepEqual(parentList.delegation_result_admissions[0].admission, admission);

  const childList = store.list_child_task_admissions({
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    child_task_id: CHILD_TASK_ID,
  });
  assert.equal(childList.status, 'ready');
  assert.equal(childList.delegation_result_admissions.length, 1);
  assert.deepEqual(childList.delegation_result_admissions[0].admission, admission);
  store.close();

  const restarted = createBuilderAgentDelegationResultAdmissionStore(databasePath);
  const restored = restarted.read_admission({
    delegation_result_admission_id: admission.delegation_result_admission_id,
    owner_id: OWNER_ID,
  });
  assert.equal(restored.status, 'ready');
  assert.deepEqual(restored.delegation_result_admission.admission, admission);
  assert.deepEqual(restored.delegation_result_admission.result, result);
  assert.deepEqual(restored.delegation_result_admission.delegation, delegationRecord);
  restarted.close();
});

test('records multiple parent admissions while enforcing owner scope and one admission per result', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentDelegationResultAdmissionStore(databasePath);
  const first = fixture();
  const firstResult = resultRecord(first.delegationRecord);
  const firstAdmission = admissionRecord(firstResult, first.delegationRecord);
  store.record_admission(recordRequest(first.delegationRecord, firstResult, firstAdmission));

  const second = fixture({
    delegation: {
      child_conversation_id: SECOND_CHILD_CONVERSATION_ID,
      child_task_id: SECOND_CHILD_TASK_ID,
      child_run_id: SECOND_CHILD_RUN_ID,
      delegated_goal: 'Review accessibility risks before owner review.',
      delegated_at_ms: 95,
    },
  });
  const secondResult = resultRecord(second.delegationRecord, {
    observed_at_ms: 105,
    result: {
      status: 'blocked',
      summary_code: 'delegated_child_result_needs_owner_attention',
    },
  });
  const secondAdmission = admissionRecord(secondResult, second.delegationRecord);
  assert.equal(
    store.record_admission(recordRequest(second.delegationRecord, secondResult, secondAdmission)).operation,
    'delegation_result_admission_recorded',
  );

  const parentList = store.list_parent_task_admissions({
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    parent_task_id: TASK_ID,
  });
  assert.equal(parentList.delegation_result_admissions.length, 2);
  assert.deepEqual(
    parentList.delegation_result_admissions.map((entry) => entry.admission.result.status),
    ['proposed', 'blocked'],
  );
  assert.equal(
    store.read_admission({
      delegation_result_admission_id: firstAdmission.delegation_result_admission_id,
      owner_id: OTHER_OWNER_ID,
    }).status,
    'absent',
  );
  assert.equal(
    store.read_admission_for_result({
      delegation_result_id: firstResult.delegation_result_id,
      owner_id: OTHER_OWNER_ID,
    }).status,
    'absent',
  );

  const conflictingAdmission = admissionRecord(firstResult, first.delegationRecord, { admitted_at_ms: 109 });
  assertStoreError(
    () => store.record_admission(recordRequest(first.delegationRecord, firstResult, conflictingAdmission)),
    'builder_agent_delegation_result_admission_store_conflict',
  );
  store.close();
});

test('rejects hostile input, malformed reads, and tampered rows', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentDelegationResultAdmissionStore(databasePath);
  const { delegationRecord } = fixture();
  const result = resultRecord(delegationRecord);
  const admission = admissionRecord(result, delegationRecord);

  assertStoreError(() => store.record_admission({
    ...recordRequest(delegationRecord, result, admission),
    extra: true,
  }));
  assertStoreError(() => store.read_admission({
    delegation_result_admission_id: admission.delegation_result_admission_id,
    owner_id: OWNER_ID,
    extra: true,
  }));
  assertStoreError(() => store.read_admission_for_result({
    delegation_result_id: result.delegation_result_id,
    owner_id: OWNER_ID,
    extra: true,
  }));
  assertStoreError(() => store.list_parent_task_admissions({
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    parent_task_id: TASK_ID,
    extra: true,
  }));
  assertStoreError(() => store.list_child_task_admissions({
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    child_task_id: CHILD_TASK_ID,
    extra: true,
  }));

  let getterCalls = 0;
  const accessor = recordRequest(delegationRecord, result, admission);
  Object.defineProperty(accessor, 'admission', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('private credential getter');
    },
  });
  assertStoreError(() => store.record_admission(accessor));
  assert.equal(getterCalls, 0);

  let proxyTrapInvoked = false;
  const proxyTrap = () => {
    proxyTrapInvoked = true;
    throw new Error('private proxy marker');
  };
  assertStoreError(() => store.record_admission(new Proxy(recordRequest(delegationRecord, result, admission), {
    getOwnPropertyDescriptor: proxyTrap,
    getPrototypeOf: proxyTrap,
    ownKeys: proxyTrap,
  })));
  assert.equal(proxyTrapInvoked, false);

  store.record_admission(recordRequest(delegationRecord, result, admission));
  store.close();

  const raw = new DatabaseSync(databasePath);
  raw.prepare(
    'UPDATE agent_delegation_result_admissions SET admission_summary_code = ? WHERE delegation_result_admission_id = ?',
  ).run('delegated_child_failure_admitted_for_owner_attention', admission.delegation_result_admission_id);
  raw.close();

  const corrupted = createBuilderAgentDelegationResultAdmissionStore(databasePath);
  assertStoreError(
    () => corrupted.read_admission({
      delegation_result_admission_id: admission.delegation_result_admission_id,
      owner_id: OWNER_ID,
    }),
    'builder_agent_delegation_result_admission_store_integrity_failed',
  );
  corrupted.close();
});

test('rejects schema drift and unsafe database paths', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentDelegationResultAdmissionStore(databasePath);
  store.close();

  const raw = new DatabaseSync(databasePath);
  raw.exec('CREATE TABLE unexpected_delegation_result_admission_fact (id TEXT PRIMARY KEY) STRICT');
  raw.close();

  assertStoreError(
    () => createBuilderAgentDelegationResultAdmissionStore(databasePath),
    'builder_agent_delegation_result_admission_store_integrity_failed',
  );
  assertStoreError(
    () => createBuilderAgentDelegationResultAdmissionStore(path.join('relative', 'agent-delegation-result-admissions.sqlite')),
    'builder_agent_delegation_result_admission_store_invalid',
  );

  const notDatabasePath = path.join(path.dirname(databasePath), 'not-a-database.sqlite');
  fs.writeFileSync(notDatabasePath, 'not sqlite private credential marker');
  assertStoreError(
    () => createBuilderAgentDelegationResultAdmissionStore(notDatabasePath),
    'builder_agent_delegation_result_admission_store_unavailable',
  );
});

test('source boundary remains a main-only Agent delegation result admission store without runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-delegation-result-admission-store.cjs'),
    'utf8',
  );
  assert.match(source, /main_owned_agent_delegation_result_admission_store/u);
  assert.match(source, /record_admission/u);
  assert.match(source, /read_admission/u);
  assert.match(source, /read_admission_for_result/u);
  assert.match(source, /list_parent_task_admissions/u);
  assert.match(source, /list_child_task_admissions/u);
  assert.match(source, /node:sqlite/u);
  assert.match(source, /utilTypes\.isProxy/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:http|node:https|http|https)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|dugite|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|shell:\s*true|localStorage|sessionStorage|indexedDB|better-sqlite|eval\s*\(|new Function/iu,
  );
});
