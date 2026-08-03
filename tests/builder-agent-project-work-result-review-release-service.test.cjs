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
  BUILDER_AGENT_SUPERVISION_LEASE_RELEASE_RECORD_VERSION,
  createBuilderAgentSupervisionLeaseRecord,
  createBuilderAgentSupervisionLeaseReleaseRecord,
} = require('../electron/builder-agent-supervision-lease-contract.cjs');
const {
  BUILDER_AGENT_PROJECT_WORK_RESULT_RECORD_KIND,
  BUILDER_AGENT_PROJECT_WORK_RESULT_RECORD_VERSION,
  createBuilderAgentProjectWorkResultRecord,
} = require('../electron/builder-agent-project-work-contract.cjs');
const {
  createBuilderAgentProjectWorkResultReviewRecord,
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_RECORD_KIND,
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_RECORD_VERSION,
} = require('../electron/builder-agent-project-work-result-review-contract.cjs');
const {
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_VERSION,
  createBuilderAgentProjectWorkResultReviewStore,
} = require('../electron/builder-agent-project-work-result-review-store.cjs');
const {
  BUILDER_AGENT_SUPERVISION_LEASE_STORE_VERSION,
  createBuilderAgentSupervisionLeaseStore,
} = require('../electron/builder-agent-supervision-lease-store.cjs');
const {
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_RELEASE_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_RELEASE_SERVICE_VERSION,
  BuilderAgentProjectWorkResultReviewReleaseServiceError,
  createBuilderAgentProjectWorkResultReviewReleaseService,
} = require('../electron/builder-agent-project-work-result-review-release-service.cjs');

const OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174000';
const OTHER_OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174001';
const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174004';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174005';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174006';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174007';
const SUPERVISOR_ID = 'builder-supervisor:123e4567-e89b-42d3-a456-426614174008';

const DECISION_SUMMARY = Object.freeze({
  approved_for_project_materialization: Object.freeze({
    code: 'agent_project_work_result_approved_for_project_materialization',
    display: 'Agent project work is approved for the materialization gate.',
  }),
  rejected: Object.freeze({
    code: 'agent_project_work_result_rejected_by_owner',
    display: 'Agent project work was rejected by the owner.',
  }),
  acknowledged_without_materialization: Object.freeze({
    code: 'agent_project_work_result_acknowledged_without_materialization',
    display: 'Agent project work was acknowledged without materialization.',
  }),
});

function temporaryRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function openStores(root) {
  return {
    project_work_result_review_store:
      createBuilderAgentProjectWorkResultReviewStore(path.join(root, 'project-work-result-reviews.sqlite')),
    lease_store: createBuilderAgentSupervisionLeaseStore(path.join(root, 'leases.sqlite')),
  };
}

function closeStores(stores) {
  stores.project_work_result_review_store.close();
  stores.lease_store.close();
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
  const review = createBuilderAgentProjectWorkResultReviewRecord(
    reviewInput(workResult, overrides.review ?? {}),
    workResult,
    assignment,
    activeStatus,
    lease,
  );
  return { activeStatus, assignment, definition, lease, review, version, workResult };
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
  const summary = DECISION_SUMMARY[decision];
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
    decision_summary_code: summary.code,
    decision_display_summary: summary.display,
    review_contract: 'owner_review_recorded_before_project_materialization',
    materialization_boundary: 'no_source_mutation_no_project_revision',
    ...overrides,
  };
}

function seedLease(stores, facts) {
  return stores.lease_store.record_lease({
    assignment: facts.assignment,
    status: facts.activeStatus,
    lease: facts.lease,
  });
}

function seedReview(stores, facts) {
  return stores.project_work_result_review_store.record_review({
    assignment: facts.assignment,
    status: facts.activeStatus,
    lease: facts.lease,
    result: facts.workResult,
    review: facts.review,
  });
}

function serviceFor(t) {
  const root = temporaryRoot('clawfabric-builder-agent-project-work-result-review-release-service-');
  const stores = openStores(root);
  const service = createBuilderAgentProjectWorkResultReviewReleaseService(stores);
  t.after(() => {
    closeStores(stores);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, service, stores };
}

function request(facts, overrides = {}) {
  return {
    owner_id: overrides.owner_id ?? OWNER_ID,
    work_result_review_id: overrides.work_result_review_id
      ?? facts.review.work_result_review_id,
    now_ms: overrides.now_ms ?? facts.review.reviewed_at_ms + 1,
  };
}

function assertServiceError(fn, code) {
  assert.throws(
    fn,
    (error) => error instanceof BuilderAgentProjectWorkResultReviewReleaseServiceError
      && error.code === code
      && !/private|credential|api\.deepseek|secret-value|source text|raw patch|diff body/iu.test(String(error.stack)),
  );
}

test('releases a reviewed project work result lease without materializing source', (t) => {
  const { service, stores } = serviceFor(t);
  const facts = fixture();
  seedLease(stores, facts);
  seedReview(stores, facts);

  const result = service.release_reviewed_project_work_result(request(facts));
  assert.equal(result.result_version, BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_RELEASE_SERVICE_RESULT_VERSION);
  assert.equal(result.service_version, BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_RELEASE_SERVICE_VERSION);
  assert.equal(result.status, 'ready');
  assert.equal(result.operation, 'agent_project_work_result_review_released');
  assert.equal(result.work_kind, 'project_edit');
  assert.equal(result.result_status, 'proposed');
  assert.equal(result.decision, 'approved_for_project_materialization');
  assert.deepEqual(result.review, facts.review);
  assert.equal(result.release.release_outcome, 'completed');
  assert.equal(result.release.lease_id, facts.lease.lease_id);
  assert.equal(result.release.reason, 'Owner review closed the supervised project work result.');
  assert.equal(result.lease_read.release.lease_release_id, result.release.lease_release_id);
  assert.equal(result.assignment_leases.active_lease, null);
  assert.equal(result.task_reviews.project_work_result_reviews.length, 1);
  assert.equal(result.operations.lease_store, 'release_recorded');
  assert.equal(result.evidence.service_authority, 'main_owned_agent_project_work_result_review_release_service');
  assert.equal(result.evidence.project_work_result_review_store_authority, 'main_owned_agent_project_work_result_review_store');
  assert.equal(result.evidence.lease_store_authority, 'main_owned_agent_supervision_lease_store');
  assert.equal(result.evidence.provider_dispatch, false);
  assert.equal(result.evidence.tool_dispatch, false);
  assert.equal(result.evidence.source_access, 'not_present');
  assert.equal(result.evidence.source_write, 'not_present');
  assert.equal(result.evidence.review_row_authority, false);
  assert.equal(result.evidence.materialization_authority, false);
  assert.equal(result.evidence.assignment_status_authority, false);

  const replay = service.release_reviewed_project_work_result(request(facts));
  assert.equal(replay.operations.lease_store, 'release_replayed');
  assert.deepEqual(replay.release, result.release);
});

test('closes blocked project-check reviews as lease completion without check or revision authority', (t) => {
  const { service, stores } = serviceFor(t);
  const facts = fixture({
    result: {
      work_kind: 'project_test',
      result: {
        status: 'blocked',
        summary_code: 'project_check_needs_owner_attention',
      },
    },
    review: {
      decision: 'acknowledged_without_materialization',
    },
  });
  seedLease(stores, facts);
  seedReview(stores, facts);

  const result = service.release_reviewed_project_work_result(request(facts));
  assert.equal(result.work_kind, 'project_test');
  assert.equal(result.result_status, 'blocked');
  assert.equal(result.decision, 'acknowledged_without_materialization');
  assert.equal(result.release.release_outcome, 'completed');
  assert.equal(result.evidence.process_run, false);
  assert.equal(result.evidence.revision_authority, false);
  assert.equal(result.evidence.artifact_authority, false);
});

test('recovers reviewed project work release state across restart through idempotent replay', () => {
  const root = temporaryRoot('clawfabric-builder-agent-project-work-result-review-release-service-restart-');
  const facts = fixture();
  const stores = openStores(root);
  seedLease(stores, facts);
  seedReview(stores, facts);
  const service = createBuilderAgentProjectWorkResultReviewReleaseService(stores);
  const first = service.release_reviewed_project_work_result(request(facts));
  closeStores(stores);

  const reopened = openStores(root);
  const restarted = createBuilderAgentProjectWorkResultReviewReleaseService(reopened);
  const replay = restarted.release_reviewed_project_work_result(request(facts));
  assert.equal(replay.operations.lease_store, 'release_replayed');
  assert.deepEqual(replay.release, first.release);
  closeStores(reopened);
  fs.rmSync(root, { recursive: true, force: true });
});

test('fails closed for absent review, missing lease, time drift, conflicting release, and malformed stores', (t) => {
  const { service, stores } = serviceFor(t);
  const facts = fixture();

  assertServiceError(
    () => service.release_reviewed_project_work_result(request(facts)),
    'builder_agent_project_work_result_review_release_service_conflict',
  );

  seedReview(stores, facts);
  assertServiceError(
    () => service.release_reviewed_project_work_result(request(facts)),
    'builder_agent_project_work_result_review_release_service_conflict',
  );

  seedLease(stores, facts);
  assertServiceError(
    () => service.release_reviewed_project_work_result(request(facts, { owner_id: OTHER_OWNER_ID })),
    'builder_agent_project_work_result_review_release_service_conflict',
  );
  assertServiceError(
    () => service.release_reviewed_project_work_result(request(facts, { now_ms: facts.review.reviewed_at_ms - 1 })),
    'builder_agent_project_work_result_review_release_service_invalid',
  );
  assertServiceError(
    () => service.release_reviewed_project_work_result(request(facts, { now_ms: facts.lease.expires_at_ms + 1 })),
    'builder_agent_project_work_result_review_release_service_invalid',
  );

  const cancelledRelease = createBuilderAgentSupervisionLeaseReleaseRecord({
    record_version: BUILDER_AGENT_SUPERVISION_LEASE_RELEASE_RECORD_VERSION,
    lease_id: facts.lease.lease_id,
    assignment_id: facts.lease.assignment_id,
    owner_id: facts.lease.owner_id,
    lease_holder_id: facts.lease.lease_holder_id,
    released_by: facts.lease.lease_holder_id,
    released_at_ms: facts.review.reviewed_at_ms + 2,
    release_outcome: 'cancelled',
    reason: 'Owner cancelled this supervised lease before close.',
  }, facts.lease);
  stores.lease_store.record_release({ release: cancelledRelease });
  assertServiceError(
    () => service.release_reviewed_project_work_result(request(facts)),
    'builder_agent_project_work_result_review_release_service_conflict',
  );

  assertServiceError(
    () => createBuilderAgentProjectWorkResultReviewReleaseService({
      project_work_result_review_store: { store_version: BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_VERSION },
      lease_store: stores.lease_store,
    }),
    'builder_agent_project_work_result_review_release_service_invalid',
  );
  assertServiceError(
    () => createBuilderAgentProjectWorkResultReviewReleaseService({
      project_work_result_review_store: stores.project_work_result_review_store,
      lease_store: { store_version: BUILDER_AGENT_SUPERVISION_LEASE_STORE_VERSION },
    }),
    'builder_agent_project_work_result_review_release_service_invalid',
  );
});

test('source boundary remains main-only and exposes no runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-project-work-result-review-release-service.cjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /require\('electron'\)|ipcMain|BrowserWindow|preload|safeStorage|provider-config|provider-secret/iu);
  assert.doesNotMatch(source, /node:child_process|require\(['"]child_process['"]\)|spawn\(|execFile\(|writeFile|rmSync/iu);
  assert.match(source, /service_authority: 'main_owned_agent_project_work_result_review_release_service'/u);
  assert.match(source, /provider_dispatch: false/u);
  assert.match(source, /tool_dispatch: false/u);
  assert.match(source, /source_access: 'not_present'/u);
  assert.match(source, /materialization_authority: false/u);
  assert.match(source, /assignment_status_authority: false/u);
  assert.match(source, /review_row_authority: false/u);
});
