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
  BUILDER_AGENT_PROJECT_WORK_RESULT_RECORD_KIND,
  BUILDER_AGENT_PROJECT_WORK_RESULT_RECORD_VERSION,
  BuilderAgentProjectWorkContractError,
  createBuilderAgentProjectWorkResultRecord,
  sanitizeBuilderAgentProjectWorkResultRecord,
} = require('../electron/builder-agent-project-work-contract.cjs');

const OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174000';
const OTHER_OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174001';
const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174004';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174005';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174006';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174007';
const SUPERVISOR_ID = 'builder-supervisor:123e4567-e89b-42d3-a456-426614174008';

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

function assignmentInput(agentVersionRecord, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_ASSIGNMENT_RECORD_VERSION,
    agent_id: AGENT_ID,
    agent_version_id: agentVersionRecord.agent_version_id,
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

function fixture() {
  const agentDefinition = createBuilderAgentDefinitionRecord(definitionInput());
  const agentVersion = createBuilderAgentVersionRecord(versionInput(), agentDefinition);
  const assignmentRecord = createBuilderAgentAssignmentRecord(
    assignmentInput(agentVersion),
    agentVersion,
    agentDefinition,
  );
  const activeStatus = createBuilderAgentAssignmentStatusRecord(statusInput(assignmentRecord), assignmentRecord);
  const leaseRecord = createBuilderAgentSupervisionLeaseRecord(
    leaseInput(assignmentRecord, activeStatus),
    assignmentRecord,
    activeStatus,
  );
  return { activeStatus, agentDefinition, agentVersion, assignmentRecord, leaseRecord };
}

function resultInput(assignmentRecord, activeStatus, leaseRecord, overrides = {}) {
  const workKind = overrides.work_kind ?? 'project_edit';
  const result = overrides.result ?? {
    status: 'proposed',
    summary_code: workKind === 'project_edit'
      ? 'project_edit_candidate_ready_for_review'
      : 'project_check_plan_ready_for_review',
  };
  return {
    record_version: BUILDER_AGENT_PROJECT_WORK_RESULT_RECORD_VERSION,
    record_kind: BUILDER_AGENT_PROJECT_WORK_RESULT_RECORD_KIND,
    assignment_id: assignmentRecord.assignment_id,
    assignment_status_id: activeStatus.assignment_status_id,
    lease_id: leaseRecord.lease_id,
    agent_id: AGENT_ID,
    agent_version_id: assignmentRecord.agent_version_id,
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    lease_holder_id: SUPERVISOR_ID,
    work_kind: workKind,
    observed_at_ms: 90,
    result,
    review_contract: 'owner_review_required_before_materialization',
    materialization_boundary: 'no_source_mutation_no_check_run',
    ...overrides,
  };
}

function assertWorkError(fn) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderAgentProjectWorkContractError);
      assert.equal(error.code, 'builder_agent_project_work_contract_invalid');
      const text = `${error.name}:${error.message}:${error.stack}`;
      assert.doesNotMatch(text, /secret-value|api\.deepseek|private marker|source text|raw patch/iu);
      return true;
    },
  );
}

test('creates deterministic supervised project edit and project test work result records', () => {
  const { activeStatus, assignmentRecord, leaseRecord } = fixture();
  const edit = createBuilderAgentProjectWorkResultRecord(
    resultInput(assignmentRecord, activeStatus, leaseRecord),
    assignmentRecord,
    activeStatus,
    leaseRecord,
  );
  const sameEdit = createBuilderAgentProjectWorkResultRecord(
    resultInput(assignmentRecord, activeStatus, leaseRecord),
    assignmentRecord,
    activeStatus,
    leaseRecord,
  );
  const check = createBuilderAgentProjectWorkResultRecord(
    resultInput(assignmentRecord, activeStatus, leaseRecord, { work_kind: 'project_test' }),
    assignmentRecord,
    activeStatus,
    leaseRecord,
  );

  assert.deepEqual(edit, sameEdit);
  assert.match(edit.work_result_id, /^builder-agent-project-work-result:[0-9a-f]{64}$/u);
  assert.equal(edit.definition_digest, assignmentRecord.definition_digest);
  assert.equal(edit.assignment_id, assignmentRecord.assignment_id);
  assert.equal(edit.lease_id, leaseRecord.lease_id);
  assert.equal(edit.agent_version_id, assignmentRecord.agent_version_id);
  assert.equal(edit.result.status, 'proposed');
  assert.equal(edit.result.display_summary, 'Project changes are ready for review.');
  assert.equal(edit.review_contract, 'owner_review_required_before_materialization');
  assert.equal(edit.materialization_boundary, 'no_source_mutation_no_check_run');
  assert.equal(edit.lifecycle.review, 'owner_review_required');
  assert.equal(edit.lifecycle.source_materialization, 'not_performed_by_contract');
  assert.equal(edit.lifecycle.check_run, 'not_performed_by_contract');
  assert.equal(edit.lifecycle.project_revision, 'not_created');
  assert.equal(edit.authority.renderer_authority, 'not_present');
  assert.equal(edit.authority.model_dispatch, false);
  assert.equal(edit.authority.source_write, 'not_performed_by_contract');
  assert.equal(edit.authority.revision_authority, 'not_present');
  assert.equal(Object.hasOwn(edit, 'patch'), false);
  assert.equal(Object.hasOwn(edit, 'raw_output'), false);
  assert.equal(Object.hasOwn(edit, 'secret'), false);
  assert.equal(Object.hasOwn(edit, 'permission_id'), false);
  assert.equal(Object.isFrozen(edit), true);
  assert.equal(Object.isFrozen(edit.result), true);
  assert.equal(Object.isFrozen(edit.lifecycle), true);
  assert.equal(Object.isFrozen(edit.authority), true);

  assert.match(check.work_result_id, /^builder-agent-project-work-result:[0-9a-f]{64}$/u);
  assert.equal(check.work_kind, 'project_test');
  assert.equal(check.result.display_summary, 'Project checks are ready for review.');

  assert.deepEqual(
    sanitizeBuilderAgentProjectWorkResultRecord(structuredClone(edit), assignmentRecord, activeStatus, leaseRecord),
    edit,
  );
});

test('rejects inactive assignments, lease drift, identity drift, unsafe timing, and forged results', () => {
  const { activeStatus, assignmentRecord, leaseRecord } = fixture();
  const inactiveStatus = createBuilderAgentAssignmentStatusRecord(statusInput(assignmentRecord, {
    next_status: 'paused',
    reason: 'Owner paused this assignment.',
    decided_at_ms: 45,
  }), assignmentRecord);

  assertWorkError(() => createBuilderAgentProjectWorkResultRecord(
    resultInput(assignmentRecord, inactiveStatus, leaseRecord),
    assignmentRecord,
    inactiveStatus,
    leaseRecord,
  ));
  assertWorkError(() => createBuilderAgentProjectWorkResultRecord(
    resultInput(assignmentRecord, activeStatus, leaseRecord, { owner_id: OTHER_OWNER_ID }),
    assignmentRecord,
    activeStatus,
    leaseRecord,
  ));
  assertWorkError(() => createBuilderAgentProjectWorkResultRecord(
    resultInput(assignmentRecord, activeStatus, leaseRecord, { observed_at_ms: 49 }),
    assignmentRecord,
    activeStatus,
    leaseRecord,
  ));
  assertWorkError(() => createBuilderAgentProjectWorkResultRecord(
    resultInput(assignmentRecord, activeStatus, leaseRecord, { observed_at_ms: 121 }),
    assignmentRecord,
    activeStatus,
    leaseRecord,
  ));
  assertWorkError(() => createBuilderAgentProjectWorkResultRecord(
    resultInput(assignmentRecord, activeStatus, leaseRecord, {
      result: {
        status: 'proposed',
        summary_code: 'project_edit_needs_owner_attention',
      },
    }),
    assignmentRecord,
    activeStatus,
    leaseRecord,
  ));
  assertWorkError(() => createBuilderAgentProjectWorkResultRecord(
    resultInput(assignmentRecord, activeStatus, leaseRecord, {
      work_kind: 'project_test',
      result: {
        status: 'proposed',
        summary_code: 'project_edit_candidate_ready_for_review',
      },
    }),
    assignmentRecord,
    activeStatus,
    leaseRecord,
  ));
  assertWorkError(() => createBuilderAgentProjectWorkResultRecord(
    resultInput(assignmentRecord, activeStatus, leaseRecord, {
      review_contract: 'review_optional',
    }),
    assignmentRecord,
    activeStatus,
    leaseRecord,
  ));
  assertWorkError(() => createBuilderAgentProjectWorkResultRecord(
    resultInput(assignmentRecord, activeStatus, leaseRecord, {
      materialization_boundary: 'source_mutated',
    }),
    assignmentRecord,
    activeStatus,
    leaseRecord,
  ));
});

test('fails closed on extras, accessors, and proxies without leaking raw input', () => {
  const { activeStatus, assignmentRecord, leaseRecord } = fixture();

  assertWorkError(() => createBuilderAgentProjectWorkResultRecord({
    ...resultInput(assignmentRecord, activeStatus, leaseRecord),
    extra: true,
  }, assignmentRecord, activeStatus, leaseRecord));
  assertWorkError(() => createBuilderAgentProjectWorkResultRecord({
    ...resultInput(assignmentRecord, activeStatus, leaseRecord),
    result: {
      status: 'failed',
      summary_code: 'source text secret-value',
    },
  }, assignmentRecord, activeStatus, leaseRecord));

  let getterCalls = 0;
  assertWorkError(() => createBuilderAgentProjectWorkResultRecord(Object.defineProperty(
    resultInput(assignmentRecord, activeStatus, leaseRecord),
    'work_kind',
    {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 'private marker';
      },
    },
  ), assignmentRecord, activeStatus, leaseRecord));
  assert.equal(getterCalls, 0);

  let nestedGetterCalls = 0;
  assertWorkError(() => createBuilderAgentProjectWorkResultRecord({
    ...resultInput(assignmentRecord, activeStatus, leaseRecord),
    result: Object.defineProperty(
      {
        status: 'proposed',
        summary_code: 'project_edit_candidate_ready_for_review',
      },
      'status',
      {
        enumerable: true,
        get() {
          nestedGetterCalls += 1;
          return 'private marker';
        },
      },
    ),
  }, assignmentRecord, activeStatus, leaseRecord));
  assert.equal(nestedGetterCalls, 0);

  let proxyTrapInvoked = false;
  const proxyTrap = () => {
    proxyTrapInvoked = true;
    throw new Error('private marker');
  };
  assertWorkError(() => createBuilderAgentProjectWorkResultRecord(new Proxy(
    resultInput(assignmentRecord, activeStatus, leaseRecord),
    {
      getOwnPropertyDescriptor: proxyTrap,
      getPrototypeOf: proxyTrap,
      ownKeys: proxyTrap,
    },
  ), assignmentRecord, activeStatus, leaseRecord));
  assert.equal(proxyTrapInvoked, false);
});

test('source remains a pure local project work contract with no runtime authority', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'electron', 'builder-agent-project-work-contract.cjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /node:fs|node:sqlite|ipc|preload|safeStorage|credential|provider|dugite|builder-git|child_process|spawn|exec|fetch|localStorage|sessionStorage/iu);
  assert.match(source, /owner_review_required_before_materialization/u);
  assert.match(source, /no_source_mutation_no_check_run/u);
  assert.match(source, /builder-agent-project-work-contract\.v1/u);
});
