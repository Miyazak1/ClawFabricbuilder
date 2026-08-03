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
  BuilderAgentDelegationResultAdmissionContractError,
  createBuilderAgentDelegationResultAdmissionRecord,
  sanitizeBuilderAgentDelegationResultAdmissionRecord,
} = require('../electron/builder-agent-delegation-result-admission-contract.cjs');

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

function assertAdmissionError(fn) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderAgentDelegationResultAdmissionContractError);
      assert.equal(error.code, 'builder_agent_delegation_result_admission_contract_invalid');
      const text = `${error.name}:${error.message}:${error.stack}`;
      assert.doesNotMatch(text, /secret-value|api\.deepseek|private marker|source text|raw child output|patch body/iu);
      return true;
    },
  );
}

test('creates deterministic local admissions for delegated results without parent materialization', () => {
  const { delegationRecord } = fixture();
  const resultRecord = createBuilderAgentDelegationResultRecord(resultInput(delegationRecord), delegationRecord);
  const admission = createBuilderAgentDelegationResultAdmissionRecord(
    admissionInput(resultRecord),
    resultRecord,
    delegationRecord,
  );
  const sameAdmission = createBuilderAgentDelegationResultAdmissionRecord(
    admissionInput(resultRecord),
    resultRecord,
    delegationRecord,
  );
  const blockedResult = createBuilderAgentDelegationResultRecord(resultInput(delegationRecord, {
    result: {
      status: 'blocked',
      summary_code: 'delegated_child_result_needs_owner_attention',
    },
  }), delegationRecord);
  const blockedAdmission = createBuilderAgentDelegationResultAdmissionRecord(
    admissionInput(blockedResult, {
      result: blockedResult.result,
      admission_summary_code: 'delegated_child_blocker_admitted_for_owner_attention',
      admission_display_summary: 'Delegated blocker is admitted for owner attention.',
    }),
    blockedResult,
    delegationRecord,
  );

  assert.deepEqual(admission, sameAdmission);
  assert.match(admission.delegation_result_admission_id, /^builder-agent-delegation-result-admission:[0-9a-f]{64}$/u);
  assert.match(admission.delegation_result_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(admission.delegation_definition_digest, delegationRecord.parent_definition_digest);
  assert.equal(admission.target_definition_digest, delegationRecord.target_definition_digest);
  assert.equal(admission.delegation_id, delegationRecord.delegation_id);
  assert.equal(admission.delegation_result_id, resultRecord.delegation_result_id);
  assert.equal(admission.parent_task_id, TASK_ID);
  assert.equal(admission.child_task_id, CHILD_TASK_ID);
  assert.equal(admission.result.display_summary, 'Delegated result is ready for parent review.');
  assert.equal(admission.admission_status, 'admitted_for_parent_review');
  assert.equal(admission.admission_summary_code, 'delegated_child_result_admitted_for_parent_review');
  assert.equal(admission.admission_contract, 'local_contribution_admitted_for_parent_review');
  assert.equal(admission.parent_review_contract, 'owner_review_required_before_materialization');
  assert.equal(admission.parent_materialization_boundary, 'no_direct_parent_mutation');
  assert.equal(admission.lifecycle.delegation, 'verified_recorded_delegation');
  assert.equal(admission.lifecycle.child_result_return, 'verified_recorded_child_result');
  assert.equal(admission.lifecycle.local_contribution_admission, 'recorded_for_parent_review');
  assert.equal(admission.lifecycle.parent_review, 'owner_review_required');
  assert.equal(admission.lifecycle.parent_materialization, 'not_performed_by_contract');
  assert.equal(admission.lifecycle.project_revision, 'not_created');
  assert.equal(admission.authority.delegation_result_authority, 'main_agent_delegation_result_contract_v1');
  assert.equal(admission.authority.local_contribution_authority, 'local_admission_receipt_only');
  assert.equal(admission.authority.renderer_authority, 'not_present');
  assert.equal(admission.authority.model_dispatch, false);
  assert.equal(admission.authority.source_write, 'not_performed_by_contract');
  assert.equal(admission.authority.review_authority, 'not_created_by_contract');
  assert.equal(admission.authority.artifact_authority, 'not_created_by_contract');
  assert.equal(Object.hasOwn(admission, 'raw_output'), false);
  assert.equal(Object.hasOwn(admission, 'patch'), false);
  assert.equal(Object.hasOwn(admission, 'source_tree'), false);
  assert.equal(Object.hasOwn(admission, 'review_id'), false);
  assert.equal(Object.hasOwn(admission, 'artifact_id'), false);
  assert.equal(Object.isFrozen(admission), true);
  assert.equal(Object.isFrozen(admission.result), true);
  assert.equal(Object.isFrozen(admission.lifecycle), true);
  assert.equal(Object.isFrozen(admission.authority), true);
  assert.equal(blockedAdmission.admission_summary_code, 'delegated_child_blocker_admitted_for_owner_attention');
  assert.deepEqual(
    sanitizeBuilderAgentDelegationResultAdmissionRecord(structuredClone(admission), resultRecord, delegationRecord),
    admission,
  );
});

test('rejects result drift, premature admissions, wrong summaries, and materialization authority', () => {
  const { delegationRecord } = fixture();
  const resultRecord = createBuilderAgentDelegationResultRecord(resultInput(delegationRecord), delegationRecord);

  assertAdmissionError(() => createBuilderAgentDelegationResultAdmissionRecord(
    admissionInput(resultRecord, { admitted_at_ms: 99 }),
    resultRecord,
    delegationRecord,
  ));
  assertAdmissionError(() => createBuilderAgentDelegationResultAdmissionRecord(
    admissionInput(resultRecord, { owner_id: OTHER_OWNER_ID }),
    resultRecord,
    delegationRecord,
  ));
  assertAdmissionError(() => createBuilderAgentDelegationResultAdmissionRecord(
    admissionInput(resultRecord, { delegation_result_id: 'builder-agent-delegation-result:'.concat('0'.repeat(64)) }),
    resultRecord,
    delegationRecord,
  ));
  assertAdmissionError(() => createBuilderAgentDelegationResultAdmissionRecord(
    admissionInput(resultRecord, {
      result: {
        status: 'blocked',
        summary_code: 'delegated_child_result_needs_owner_attention',
        display_summary: 'Delegated result needs owner attention.',
      },
    }),
    resultRecord,
    delegationRecord,
  ));
  assertAdmissionError(() => createBuilderAgentDelegationResultAdmissionRecord(
    admissionInput(resultRecord, { admission_summary_code: 'delegated_child_failure_admitted_for_owner_attention' }),
    resultRecord,
    delegationRecord,
  ));
  assertAdmissionError(() => createBuilderAgentDelegationResultAdmissionRecord(
    admissionInput(resultRecord, { admission_contract: 'direct_parent_review_created' }),
    resultRecord,
    delegationRecord,
  ));
  assertAdmissionError(() => createBuilderAgentDelegationResultAdmissionRecord(
    admissionInput(resultRecord, { parent_materialization_boundary: 'mutate_parent_task' }),
    resultRecord,
    delegationRecord,
  ));
  assertAdmissionError(() => sanitizeBuilderAgentDelegationResultAdmissionRecord({
    ...createBuilderAgentDelegationResultAdmissionRecord(admissionInput(resultRecord), resultRecord, delegationRecord),
    authority: {
      ...createBuilderAgentDelegationResultAdmissionRecord(
        admissionInput(resultRecord),
        resultRecord,
        delegationRecord,
      ).authority,
      review_authority: 'created',
    },
  }, resultRecord, delegationRecord));
  assertAdmissionError(() => createBuilderAgentDelegationResultAdmissionRecord(
    admissionInput(resultRecord),
    {
      ...resultRecord,
      authority: {
        ...resultRecord.authority,
        review_authority: 'created',
      },
    },
    delegationRecord,
  ));
});

test('fails closed on extras, accessors, proxies, and forged result records', () => {
  const { delegationRecord } = fixture();
  const resultRecord = createBuilderAgentDelegationResultRecord(resultInput(delegationRecord), delegationRecord);
  assertAdmissionError(() => createBuilderAgentDelegationResultAdmissionRecord({
    ...admissionInput(resultRecord),
    raw_output: 'secret-value',
  }, resultRecord, delegationRecord));

  let getterCalls = 0;
  const accessor = admissionInput(resultRecord);
  Object.defineProperty(accessor, 'result', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('private getter marker');
    },
  });
  assertAdmissionError(() => createBuilderAgentDelegationResultAdmissionRecord(
    accessor,
    resultRecord,
    delegationRecord,
  ));
  assert.equal(getterCalls, 0);

  let proxyTrapInvoked = false;
  const proxyTrap = () => {
    proxyTrapInvoked = true;
    throw new Error('private proxy marker');
  };
  assertAdmissionError(() => createBuilderAgentDelegationResultAdmissionRecord(new Proxy(
    admissionInput(resultRecord),
    {
      getOwnPropertyDescriptor: proxyTrap,
      getPrototypeOf: proxyTrap,
      ownKeys: proxyTrap,
    },
  ), resultRecord, delegationRecord));
  assert.equal(proxyTrapInvoked, false);

  assertAdmissionError(() => createBuilderAgentDelegationResultAdmissionRecord(
    admissionInput(resultRecord),
    {
      ...resultRecord,
      lifecycle: {
        ...resultRecord.lifecycle,
        parent_materialization: 'performed',
      },
    },
    delegationRecord,
  ));
  assertAdmissionError(() => createBuilderAgentDelegationResultAdmissionRecord(
    admissionInput(resultRecord),
    resultRecord,
    {
      ...delegationRecord,
      authority: {
        ...delegationRecord.authority,
        model_dispatch: true,
      },
    },
  ));
});

test('source remains a pure local delegation admission contract without runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-delegation-result-admission-contract.cjs'),
    'utf8',
  );
  assert.match(source, /main_agent_delegation_result_admission_contract_v1/u);
  assert.match(source, /local_contribution_admitted_for_parent_review/u);
  assert.match(source, /no_direct_parent_mutation/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:http|node:https|http|https|node:fs|fs)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|dugite|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|shell:\s*true|localStorage|sessionStorage|indexedDB|better-sqlite|eval\s*\(|new Function/iu,
  );
});
