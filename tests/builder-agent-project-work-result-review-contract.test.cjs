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
  createBuilderAgentProjectWorkResultRecord,
} = require('../electron/builder-agent-project-work-contract.cjs');
const {
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_RECORD_KIND,
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_RECORD_VERSION,
  BuilderAgentProjectWorkResultReviewContractError,
  createBuilderAgentProjectWorkResultReviewRecord,
  sanitizeBuilderAgentProjectWorkResultReviewRecord,
} = require('../electron/builder-agent-project-work-result-review-contract.cjs');

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
  const workResult = createBuilderAgentProjectWorkResultRecord(
    resultInput(assignmentRecord, activeStatus, leaseRecord, overrides.result ?? {}),
    assignmentRecord,
    activeStatus,
    leaseRecord,
  );
  return { activeStatus, assignmentRecord, leaseRecord, workResult };
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

function reviewInput(workResult, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_RECORD_VERSION,
    record_kind: BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_RECORD_KIND,
    work_result_id: workResult.work_result_id,
    assignment_id: workResult.assignment_id,
    assignment_status_id: workResult.assignment_status_id,
    lease_id: workResult.lease_id,
    agent_id: workResult.agent_id,
    agent_version_id: workResult.agent_version_id,
    owner_id: workResult.owner_id,
    project_id: workResult.project_id,
    conversation_id: workResult.conversation_id,
    task_id: workResult.task_id,
    run_id: workResult.run_id,
    lease_holder_id: workResult.lease_holder_id,
    work_kind: workResult.work_kind,
    reviewed_by: OWNER_ID,
    reviewed_at_ms: workResult.observed_at_ms + 1,
    result: workResult.result,
    decision: 'approved_for_project_materialization',
    decision_summary_code: 'agent_project_work_result_approved_for_project_materialization',
    decision_display_summary: 'Agent project work is approved for the materialization gate.',
    review_contract: 'owner_review_recorded_before_project_materialization',
    materialization_boundary: 'no_source_mutation_no_project_revision',
    ...overrides,
  };
}

function assertReviewError(fn) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderAgentProjectWorkResultReviewContractError);
      assert.equal(error.code, 'builder_agent_project_work_result_review_contract_invalid');
      const text = `${error.name}:${error.message}:${error.stack}`;
      assert.doesNotMatch(text, /secret-value|api\.deepseek|private marker|source text|raw patch|diff body/iu);
      return true;
    },
  );
}

test('creates deterministic owner decisions over project work results without materialization authority', () => {
  const { activeStatus, assignmentRecord, leaseRecord, workResult } = fixture();
  const review = createBuilderAgentProjectWorkResultReviewRecord(
    reviewInput(workResult),
    workResult,
    assignmentRecord,
    activeStatus,
    leaseRecord,
  );
  const sameReview = createBuilderAgentProjectWorkResultReviewRecord(
    reviewInput(workResult),
    workResult,
    assignmentRecord,
    activeStatus,
    leaseRecord,
  );
  const rejectedReview = createBuilderAgentProjectWorkResultReviewRecord(
    reviewInput(workResult, {
      decision: 'rejected',
      decision_summary_code: 'agent_project_work_result_rejected_by_owner',
      decision_display_summary: 'Agent project work was rejected by the owner.',
    }),
    workResult,
    assignmentRecord,
    activeStatus,
    leaseRecord,
  );

  assert.deepEqual(review, sameReview);
  assert.notEqual(review.work_result_review_id, rejectedReview.work_result_review_id);
  assert.match(review.work_result_review_id, /^builder-agent-project-work-result-review:[0-9a-f]{64}$/u);
  assert.match(review.work_result_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(review.definition_digest, workResult.definition_digest);
  assert.equal(review.work_result_id, workResult.work_result_id);
  assert.equal(review.assignment_id, assignmentRecord.assignment_id);
  assert.equal(review.lease_id, leaseRecord.lease_id);
  assert.equal(review.result.status, 'proposed');
  assert.equal(review.decision, 'approved_for_project_materialization');
  assert.equal(
    review.decision_summary_code,
    'agent_project_work_result_approved_for_project_materialization',
  );
  assert.equal(review.review_contract, 'owner_review_recorded_before_project_materialization');
  assert.equal(review.materialization_boundary, 'no_source_mutation_no_project_revision');
  assert.equal(review.lifecycle.project_work_result, 'verified_recorded_for_owner_review');
  assert.equal(review.lifecycle.owner_review, 'recorded');
  assert.equal(review.lifecycle.source_materialization, 'not_performed_by_contract');
  assert.equal(review.lifecycle.check_run, 'not_performed_by_contract');
  assert.equal(review.lifecycle.project_revision, 'not_created');
  assert.equal(review.lifecycle.artifact, 'not_created');
  assert.equal(review.authority.project_work_result_authority, 'main_agent_project_work_contract_v1');
  assert.equal(review.authority.owner_review_authority, 'main_owner_review_decision_receipt');
  assert.equal(review.authority.review_authority, 'local_decision_receipt_only');
  assert.equal(review.authority.artifact_authority, 'not_created_by_contract');
  assert.equal(review.authority.renderer_authority, 'not_present');
  assert.equal(review.authority.model_dispatch, false);
  assert.equal(review.authority.source_write, 'not_performed_by_contract');
  assert.equal(Object.hasOwn(review, 'patch'), false);
  assert.equal(Object.hasOwn(review, 'source_tree'), false);
  assert.equal(Object.hasOwn(review, 'review_id'), false);
  assert.equal(Object.hasOwn(review, 'artifact_id'), false);
  assert.equal(Object.hasOwn(review, 'project_revision_id'), false);
  assert.equal(Object.isFrozen(review), true);
  assert.equal(Object.isFrozen(review.result), true);
  assert.equal(Object.isFrozen(review.lifecycle), true);
  assert.equal(Object.isFrozen(review.authority), true);
  assert.deepEqual(
    sanitizeBuilderAgentProjectWorkResultReviewRecord(
      structuredClone(review),
      workResult,
      assignmentRecord,
      activeStatus,
      leaseRecord,
    ),
    review,
  );
});

test('acknowledges blocked or failed project work without approval materialization', () => {
  const { activeStatus, assignmentRecord, leaseRecord, workResult } = fixture({
    result: {
      result: {
        status: 'blocked',
        summary_code: 'project_edit_needs_owner_attention',
      },
    },
  });
  const review = createBuilderAgentProjectWorkResultReviewRecord(
    reviewInput(workResult, {
      result: workResult.result,
      decision: 'acknowledged_without_materialization',
      decision_summary_code: 'agent_project_work_result_acknowledged_without_materialization',
      decision_display_summary: 'Agent project work was acknowledged without materialization.',
    }),
    workResult,
    assignmentRecord,
    activeStatus,
    leaseRecord,
  );

  assert.equal(review.result.status, 'blocked');
  assert.equal(review.decision, 'acknowledged_without_materialization');
  assert.equal(review.lifecycle.source_materialization, 'not_performed_by_contract');
  assertReviewError(() => createBuilderAgentProjectWorkResultReviewRecord(
    reviewInput(workResult, {
      result: workResult.result,
      decision: 'approved_for_project_materialization',
    }),
    workResult,
    assignmentRecord,
    activeStatus,
    leaseRecord,
  ));
});

test('rejects premature reviews, forged owners, drift, and materialization authority', () => {
  const { activeStatus, assignmentRecord, leaseRecord, workResult } = fixture();

  assertReviewError(() => createBuilderAgentProjectWorkResultReviewRecord(
    reviewInput(workResult, { reviewed_at_ms: workResult.observed_at_ms - 1 }),
    workResult,
    assignmentRecord,
    activeStatus,
    leaseRecord,
  ));
  assertReviewError(() => createBuilderAgentProjectWorkResultReviewRecord(
    reviewInput(workResult, { reviewed_by: OTHER_OWNER_ID }),
    workResult,
    assignmentRecord,
    activeStatus,
    leaseRecord,
  ));
  assertReviewError(() => createBuilderAgentProjectWorkResultReviewRecord(
    reviewInput(workResult, { owner_id: OTHER_OWNER_ID }),
    workResult,
    assignmentRecord,
    activeStatus,
    leaseRecord,
  ));
  assertReviewError(() => createBuilderAgentProjectWorkResultReviewRecord(
    reviewInput(workResult, { work_result_id: 'builder-agent-project-work-result:'.concat('0'.repeat(64)) }),
    workResult,
    assignmentRecord,
    activeStatus,
    leaseRecord,
  ));
  assertReviewError(() => createBuilderAgentProjectWorkResultReviewRecord(
    reviewInput(workResult, {
      result: {
        status: 'blocked',
        summary_code: 'project_edit_needs_owner_attention',
        display_summary: 'Project changes need owner attention.',
      },
    }),
    workResult,
    assignmentRecord,
    activeStatus,
    leaseRecord,
  ));
  assertReviewError(() => createBuilderAgentProjectWorkResultReviewRecord(
    reviewInput(workResult, { decision: 'acknowledged_without_materialization' }),
    workResult,
    assignmentRecord,
    activeStatus,
    leaseRecord,
  ));
  assertReviewError(() => createBuilderAgentProjectWorkResultReviewRecord(
    reviewInput(workResult, { decision_summary_code: 'agent_project_work_result_rejected_by_owner' }),
    workResult,
    assignmentRecord,
    activeStatus,
    leaseRecord,
  ));
  assertReviewError(() => createBuilderAgentProjectWorkResultReviewRecord(
    reviewInput(workResult, { review_contract: 'create_generic_review_row' }),
    workResult,
    assignmentRecord,
    activeStatus,
    leaseRecord,
  ));
  assertReviewError(() => createBuilderAgentProjectWorkResultReviewRecord(
    reviewInput(workResult, { materialization_boundary: 'mutate_source_tree' }),
    workResult,
    assignmentRecord,
    activeStatus,
    leaseRecord,
  ));
  assertReviewError(() => sanitizeBuilderAgentProjectWorkResultReviewRecord({
    ...createBuilderAgentProjectWorkResultReviewRecord(
      reviewInput(workResult),
      workResult,
      assignmentRecord,
      activeStatus,
      leaseRecord,
    ),
    authority: {
      ...createBuilderAgentProjectWorkResultReviewRecord(
        reviewInput(workResult),
        workResult,
        assignmentRecord,
        activeStatus,
        leaseRecord,
      ).authority,
      artifact_authority: 'created',
    },
  }, workResult, assignmentRecord, activeStatus, leaseRecord));
});

test('fails closed on extras, accessors, proxies, and forged project work results', () => {
  const { activeStatus, assignmentRecord, leaseRecord, workResult } = fixture();

  assertReviewError(() => createBuilderAgentProjectWorkResultReviewRecord({
    ...reviewInput(workResult),
    raw_patch: 'secret-value',
  }, workResult, assignmentRecord, activeStatus, leaseRecord));

  let getterCalls = 0;
  const accessor = reviewInput(workResult);
  Object.defineProperty(accessor, 'result', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('private marker');
    },
  });
  assertReviewError(() => createBuilderAgentProjectWorkResultReviewRecord(
    accessor,
    workResult,
    assignmentRecord,
    activeStatus,
    leaseRecord,
  ));
  assert.equal(getterCalls, 0);

  let proxyTrapInvoked = false;
  const proxyTrap = () => {
    proxyTrapInvoked = true;
    throw new Error('private marker');
  };
  assertReviewError(() => createBuilderAgentProjectWorkResultReviewRecord(new Proxy(
    reviewInput(workResult),
    {
      getOwnPropertyDescriptor: proxyTrap,
      getPrototypeOf: proxyTrap,
      ownKeys: proxyTrap,
    },
  ), workResult, assignmentRecord, activeStatus, leaseRecord));
  assert.equal(proxyTrapInvoked, false);

  assertReviewError(() => createBuilderAgentProjectWorkResultReviewRecord(
    reviewInput(workResult),
    {
      ...workResult,
      lifecycle: {
        ...workResult.lifecycle,
        source_materialization: 'performed',
      },
    },
    assignmentRecord,
    activeStatus,
    leaseRecord,
  ));
});

test('source remains a pure local project work result review contract without runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-project-work-result-review-contract.cjs'),
    'utf8',
  );
  assert.match(source, /main_agent_project_work_result_review_contract_v1/u);
  assert.match(source, /owner_review_recorded_before_project_materialization/u);
  assert.match(source, /no_source_mutation_no_project_revision/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:http|node:https|http|https|node:fs|fs|node:sqlite)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|dugite|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|shell:\s*true|localStorage|sessionStorage|indexedDB|better-sqlite|eval\s*\(|new Function/iu,
  );
});
