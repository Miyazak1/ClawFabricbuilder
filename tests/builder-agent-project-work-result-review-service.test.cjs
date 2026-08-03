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
  BUILDER_AGENT_PROJECT_WORK_RESULT_RECORD_KIND,
  BUILDER_AGENT_PROJECT_WORK_RESULT_RECORD_VERSION,
  createBuilderAgentProjectWorkResultRecord,
} = require('../electron/builder-agent-project-work-contract.cjs');
const {
  BUILDER_AGENT_PROJECT_WORK_STORE_VERSION,
  createBuilderAgentProjectWorkStore,
} = require('../electron/builder-agent-project-work-store.cjs');
const {
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_RECORD_KIND,
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_RECORD_VERSION,
  createBuilderAgentProjectWorkResultReviewRecord,
} = require('../electron/builder-agent-project-work-result-review-contract.cjs');
const {
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_VERSION,
  createBuilderAgentProjectWorkResultReviewStore,
} = require('../electron/builder-agent-project-work-result-review-store.cjs');
const {
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_SERVICE_VERSION,
  BuilderAgentProjectWorkResultReviewServiceError,
  createBuilderAgentProjectWorkResultReviewService,
} = require('../electron/builder-agent-project-work-result-review-service.cjs');

const OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174000';
const OTHER_OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174001';
const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174004';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174005';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174006';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174007';
const SUPERVISOR_ID = 'builder-supervisor:123e4567-e89b-42d3-a456-426614174008';

function temporaryRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function openStores(root) {
  return {
    project_work_store: createBuilderAgentProjectWorkStore(path.join(root, 'project-work.sqlite')),
    project_work_result_review_store:
      createBuilderAgentProjectWorkResultReviewStore(path.join(root, 'project-work-result-reviews.sqlite')),
  };
}

function closeStores(stores) {
  stores.project_work_store.close();
  stores.project_work_result_review_store.close();
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

function fixture(overrides = {}) {
  const definition = createBuilderAgentDefinitionRecord(definitionInput());
  const version = createBuilderAgentVersionRecord(versionInput(), definition);
  const assignment = createBuilderAgentAssignmentRecord({
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
    ...(overrides.assignment ?? {}),
  }, version, definition);
  const activeStatus = createBuilderAgentAssignmentStatusRecord({
    record_version: BUILDER_AGENT_ASSIGNMENT_STATUS_RECORD_VERSION,
    assignment_id: assignment.assignment_id,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    decided_by: OWNER_ID,
    next_status: 'active',
    reason: 'Owner started supervised work.',
    decided_at_ms: 40,
    ...(overrides.status ?? {}),
  }, assignment);
  const lease = createBuilderAgentSupervisionLeaseRecord({
    record_version: BUILDER_AGENT_SUPERVISION_LEASE_RECORD_VERSION,
    assignment_id: assignment.assignment_id,
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
    expires_at_ms: 140,
    purpose: 'Supervise one active local assignment attempt.',
    redispatch_policy: 'lease_required_no_duplicate_dispatch',
    supervision_state: 'active_assignment_only',
    authority_boundary: 'main_supervision_lease_only',
    ...(overrides.lease ?? {}),
  }, assignment, activeStatus);
  const workResult = createBuilderAgentProjectWorkResultRecord(
    resultInput({ activeStatus, assignment, lease }, overrides.result ?? {}),
    assignment,
    activeStatus,
    lease,
  );
  return { activeStatus, assignment, definition, lease, version, workResult };
}

function resultInput(facts, overrides = {}) {
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
    assignment_id: facts.assignment.assignment_id,
    assignment_status_id: facts.activeStatus.assignment_status_id,
    lease_id: facts.lease.lease_id,
    agent_id: AGENT_ID,
    agent_version_id: facts.assignment.agent_version_id,
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: facts.assignment.run_id,
    lease_holder_id: SUPERVISOR_ID,
    work_kind: workKind,
    observed_at_ms: 100,
    result,
    review_contract: 'owner_review_required_before_materialization',
    materialization_boundary: 'no_source_mutation_no_check_run',
    ...overrides,
  };
}

function reviewInput(workResult, overrides = {}) {
  const decision = overrides.decision ?? 'approved_for_project_materialization';
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
    decision,
    decision_summary_code: decision === 'rejected'
      ? 'agent_project_work_result_rejected_by_owner'
      : 'agent_project_work_result_approved_for_project_materialization',
    decision_display_summary: decision === 'rejected'
      ? 'Agent project work was rejected by the owner.'
      : 'Agent project work is approved for the materialization gate.',
    review_contract: 'owner_review_recorded_before_project_materialization',
    materialization_boundary: 'no_source_mutation_no_project_revision',
    ...overrides,
  };
}

function seedWorkResult(stores, facts) {
  return stores.project_work_store.record_result({
    assignment: facts.assignment,
    status: facts.activeStatus,
    lease: facts.lease,
    result: facts.workResult,
  });
}

function serviceFor(t) {
  const root = temporaryRoot('clawfabric-builder-agent-project-work-result-review-service-');
  const stores = openStores(root);
  const service = createBuilderAgentProjectWorkResultReviewService(stores);
  t.after(() => {
    closeStores(stores);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, service, stores };
}

function request(facts, overrides = {}) {
  const review = reviewInput(facts.workResult, overrides.review_input ?? {});
  return {
    owner_id: overrides.owner_id ?? OWNER_ID,
    work_result_id: overrides.work_result_id ?? facts.workResult.work_result_id,
    review_input: review,
    now_ms: overrides.now_ms ?? review.reviewed_at_ms,
  };
}

function assertServiceError(fn, code) {
  assert.throws(
    fn,
    (error) => error instanceof BuilderAgentProjectWorkResultReviewServiceError
      && error.code === code
      && !/private|credential|api\.deepseek|secret-value|source text|raw patch|diff body/iu.test(String(error.stack)),
  );
}

test('records a project work result review only for a store-backed project work result', (t) => {
  const { service, stores } = serviceFor(t);
  const facts = fixture();
  const expectedReview = createBuilderAgentProjectWorkResultReviewRecord(
    reviewInput(facts.workResult),
    facts.workResult,
    facts.assignment,
    facts.activeStatus,
    facts.lease,
  );
  seedWorkResult(stores, facts);

  const result = service.record_project_work_result_review(request(facts));
  assert.equal(result.result_version, BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_SERVICE_RESULT_VERSION);
  assert.equal(result.service_version, BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_SERVICE_VERSION);
  assert.equal(result.status, 'ready');
  assert.equal(result.operation, 'agent_project_work_result_review_recorded');
  assert.equal(result.work_kind, 'project_edit');
  assert.equal(result.result_status, 'proposed');
  assert.equal(result.decision, 'approved_for_project_materialization');
  assert.deepEqual(result.review, expectedReview);
  assert.deepEqual(result.project_work_result, facts.workResult);
  assert.equal(result.result_read.work_result.result.work_result_id, facts.workResult.work_result_id);
  assert.equal(result.review_read.project_work_result_review.review.work_result_review_id, expectedReview.work_result_review_id);
  assert.equal(result.review_for_result.project_work_result_review.review.work_result_review_id, expectedReview.work_result_review_id);
  assert.equal(result.task_results.work_results.length, 1);
  assert.equal(result.task_reviews.project_work_result_reviews.length, 1);
  assert.equal(result.operations.project_work_result_review_store, 'project_work_result_review_recorded');
  assert.equal(result.evidence.service_authority, 'main_owned_agent_project_work_result_review_service');
  assert.equal(result.evidence.project_work_store_authority, 'main_owned_agent_project_work_store');
  assert.equal(
    result.evidence.project_work_result_review_store_authority,
    'main_owned_agent_project_work_result_review_store',
  );
  assert.equal(result.evidence.provider_dispatch, false);
  assert.equal(result.evidence.tool_dispatch, false);
  assert.equal(result.evidence.source_access, 'not_present');
  assert.equal(result.evidence.source_write, 'not_present');
  assert.equal(result.evidence.review_authority, 'local_decision_receipt_only');
  assert.equal(result.evidence.review_row_authority, false);
  assert.equal(result.evidence.materialization_authority, false);

  const replay = service.record_project_work_result_review(request(facts));
  assert.equal(replay.operations.project_work_result_review_store, 'project_work_result_review_replayed');
  assert.deepEqual(replay.review, result.review);
});

test('records acknowledgement for blocked project checks without source or revision authority', (t) => {
  const { service, stores } = serviceFor(t);
  const facts = fixture({
    result: {
      work_kind: 'project_test',
      result: {
        status: 'blocked',
        summary_code: 'project_check_needs_owner_attention',
      },
    },
  });
  seedWorkResult(stores, facts);

  const result = service.record_project_work_result_review(request(facts, {
    review_input: {
      decision: 'acknowledged_without_materialization',
      decision_summary_code: 'agent_project_work_result_acknowledged_without_materialization',
      decision_display_summary: 'Agent project work was acknowledged without materialization.',
    },
  }));
  assert.equal(result.work_kind, 'project_test');
  assert.equal(result.result_status, 'blocked');
  assert.equal(result.decision, 'acknowledged_without_materialization');
  assert.equal(result.evidence.artifact_authority, false);
  assert.equal(result.evidence.revision_authority, false);
  assert.equal(result.evidence.process_run, false);
});

test('recovers project work result review service state across restart through idempotent store replay', () => {
  const root = temporaryRoot('clawfabric-builder-agent-project-work-result-review-service-restart-');
  const facts = fixture();
  const stores = openStores(root);
  seedWorkResult(stores, facts);
  const service = createBuilderAgentProjectWorkResultReviewService(stores);
  const first = service.record_project_work_result_review(request(facts));
  closeStores(stores);

  const reopened = openStores(root);
  const restarted = createBuilderAgentProjectWorkResultReviewService(reopened);
  const replay = restarted.record_project_work_result_review(request(facts));
  assert.equal(replay.operations.project_work_result_review_store, 'project_work_result_review_replayed');
  assert.deepEqual(replay.review, first.review);
  closeStores(reopened);
  fs.rmSync(root, { recursive: true, force: true });
});

test('fails closed for absent results, owner drift, time drift, conflicting reviews, and malformed stores', (t) => {
  const { service, stores } = serviceFor(t);
  const facts = fixture();

  assertServiceError(
    () => service.record_project_work_result_review(request(facts)),
    'builder_agent_project_work_result_review_service_conflict',
  );
  assert.equal(
    stores.project_work_result_review_store.list_task_reviews({
      owner_id: OWNER_ID,
      project_id: PROJECT_ID,
      task_id: TASK_ID,
    }).status,
    'absent',
  );

  seedWorkResult(stores, facts);
  assertServiceError(
    () => service.record_project_work_result_review(request(facts, { owner_id: OTHER_OWNER_ID })),
    'builder_agent_project_work_result_review_service_conflict',
  );
  assertServiceError(
    () => service.record_project_work_result_review(request(facts, { now_ms: facts.workResult.observed_at_ms })),
    'builder_agent_project_work_result_review_service_invalid',
  );

  service.record_project_work_result_review(request(facts));
  assertServiceError(
    () => service.record_project_work_result_review(request(facts, {
      review_input: {
        reviewed_at_ms: facts.workResult.observed_at_ms + 2,
        decision: 'rejected',
        decision_summary_code: 'agent_project_work_result_rejected_by_owner',
        decision_display_summary: 'Agent project work was rejected by the owner.',
      },
      now_ms: facts.workResult.observed_at_ms + 2,
    })),
    'builder_agent_project_work_result_review_service_conflict',
  );
  assertServiceError(
    () => createBuilderAgentProjectWorkResultReviewService({
      project_work_store: { store_version: BUILDER_AGENT_PROJECT_WORK_STORE_VERSION },
      project_work_result_review_store: stores.project_work_result_review_store,
    }),
    'builder_agent_project_work_result_review_service_invalid',
  );
  assertServiceError(
    () => createBuilderAgentProjectWorkResultReviewService({
      project_work_store: stores.project_work_store,
      project_work_result_review_store: { store_version: BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_VERSION },
    }),
    'builder_agent_project_work_result_review_service_invalid',
  );
});

test('source boundary remains main-only and exposes no runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-project-work-result-review-service.cjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /require\('electron'\)|ipcMain|BrowserWindow|preload|safeStorage|provider-config|provider-secret/iu);
  assert.doesNotMatch(source, /node:child_process|require\(['"]child_process['"]\)|spawn\(|execFile\(|writeFile|rmSync/iu);
  assert.match(source, /service_authority: 'main_owned_agent_project_work_result_review_service'/u);
  assert.match(source, /provider_dispatch: false/u);
  assert.match(source, /tool_dispatch: false/u);
  assert.match(source, /source_access: 'not_present'/u);
  assert.match(source, /materialization_authority: false/u);
  assert.match(source, /review_authority: 'local_decision_receipt_only'/u);
  assert.match(source, /review_row_authority: false/u);
});
