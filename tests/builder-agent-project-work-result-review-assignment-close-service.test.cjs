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
  BUILDER_AGENT_ASSIGNMENT_STORE_VERSION,
  createBuilderAgentAssignmentStore,
} = require('../electron/builder-agent-assignment-store.cjs');
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
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_RECORD_KIND,
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_RECORD_VERSION,
  createBuilderAgentProjectWorkResultReviewRecord,
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
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_ASSIGNMENT_CLOSE_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_ASSIGNMENT_CLOSE_SERVICE_VERSION,
  BuilderAgentProjectWorkResultReviewAssignmentCloseServiceError,
  createBuilderAgentProjectWorkResultReviewAssignmentCloseService,
} = require('../electron/builder-agent-project-work-result-review-assignment-close-service.cjs');

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
    assignment_store:
      createBuilderAgentAssignmentStore(path.join(root, 'assignments.sqlite')),
    project_work_result_review_store:
      createBuilderAgentProjectWorkResultReviewStore(path.join(root, 'project-work-result-reviews.sqlite')),
    lease_store: createBuilderAgentSupervisionLeaseStore(path.join(root, 'leases.sqlite')),
  };
}

function closeStores(stores) {
  stores.assignment_store.close();
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
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    decided_by: OWNER_ID,
    next_status: 'queued',
    reason: 'Owner queued this supervised local assignment.',
    decided_at_ms: 35,
    ...overrides,
  };
}

function fixture(overrides = {}) {
  const definition = createBuilderAgentDefinitionRecord(definitionInput());
  const version = createBuilderAgentVersionRecord(versionInput(), definition);
  const assignment = createBuilderAgentAssignmentRecord(
    assignmentInput(version, overrides.assignment ?? {}),
    version,
    definition,
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
  const lease = createBuilderAgentSupervisionLeaseRecord({
    record_version: BUILDER_AGENT_SUPERVISION_LEASE_RECORD_VERSION,
    assignment_id: assignment.assignment_id,
    assignment_status_id: activeStatus.assignment_status_id,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: assignment.run_id,
    lease_holder_id: SUPERVISOR_ID,
    lease_epoch: 1,
    acquired_at_ms: 50,
    expires_at_ms: 160,
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
  return {
    activeStatus,
    assignment,
    definition,
    lease,
    queuedStatus,
    review,
    version,
    workResult,
  };
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

function seedAssignment(stores, facts) {
  stores.assignment_store.record_assignment({
    definition: facts.definition,
    version: facts.version,
    assignment: facts.assignment,
  });
  stores.assignment_store.record_status({ status: facts.queuedStatus });
  stores.assignment_store.record_status({ status: facts.activeStatus });
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

function releaseInput(facts, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_SUPERVISION_LEASE_RELEASE_RECORD_VERSION,
    lease_id: facts.lease.lease_id,
    assignment_id: facts.lease.assignment_id,
    owner_id: facts.lease.owner_id,
    lease_holder_id: facts.lease.lease_holder_id,
    released_by: facts.lease.lease_holder_id,
    released_at_ms: facts.review.reviewed_at_ms + 1,
    release_outcome: 'completed',
    reason: 'Owner review closed the supervised project work result.',
    ...overrides,
  };
}

function seedRelease(stores, facts, overrides = {}) {
  const release = createBuilderAgentSupervisionLeaseReleaseRecord(
    releaseInput(facts, overrides),
    facts.lease,
  );
  const result = stores.lease_store.record_release({ release });
  return result.release;
}

function serviceFor(t) {
  const root = temporaryRoot('clawfabric-builder-agent-project-work-result-review-assignment-close-service-');
  const stores = openStores(root);
  const service = createBuilderAgentProjectWorkResultReviewAssignmentCloseService(stores);
  t.after(() => {
    closeStores(stores);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, service, stores };
}

function completedStatusInput(facts, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_ASSIGNMENT_STATUS_RECORD_VERSION,
    assignment_id: facts.assignment.assignment_id,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    decided_by: OWNER_ID,
    next_status: 'completed',
    reason: 'Owner reviewed and closed this supervised assignment attempt.',
    decided_at_ms: facts.review.reviewed_at_ms + 2,
    ...overrides,
  };
}

function request(facts, overrides = {}) {
  const completed_status_input = overrides.completed_status_input
    ?? completedStatusInput(facts, overrides.completedStatusInput ?? {});
  return {
    owner_id: overrides.owner_id ?? OWNER_ID,
    work_result_review_id: overrides.work_result_review_id
      ?? facts.review.work_result_review_id,
    completed_status_input,
    now_ms: overrides.now_ms ?? completed_status_input.decided_at_ms,
  };
}

function assertServiceError(fn, code) {
  assert.throws(
    fn,
    (error) => error instanceof BuilderAgentProjectWorkResultReviewAssignmentCloseServiceError
      && error.code === code
      && !/private|credential|api\.deepseek|secret-value|source text|raw patch|diff body/iu.test(String(error.stack)),
  );
}

test('closes a reviewed project work Assignment only after the reviewed lease is released', (t) => {
  const { service, stores } = serviceFor(t);
  const facts = fixture();
  seedAssignment(stores, facts);
  seedLease(stores, facts);
  seedReview(stores, facts);
  seedRelease(stores, facts);

  const result = service.close_reviewed_project_work_assignment(request(facts));
  assert.equal(result.result_version, BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_ASSIGNMENT_CLOSE_SERVICE_RESULT_VERSION);
  assert.equal(result.service_version, BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_ASSIGNMENT_CLOSE_SERVICE_VERSION);
  assert.equal(result.status, 'ready');
  assert.equal(result.operation, 'agent_project_work_result_review_assignment_closed');
  assert.equal(result.work_kind, 'project_edit');
  assert.equal(result.result_status, 'proposed');
  assert.equal(result.decision, 'approved_for_project_materialization');
  assert.deepEqual(result.review, facts.review);
  assert.equal(result.completed_status.next_status, 'completed');
  assert.equal(result.completed_status.assignment_id, facts.assignment.assignment_id);
  assert.equal(result.lease_read.release.release_outcome, 'completed');
  assert.equal(result.assignment_leases.active_lease, null);
  assert.equal(result.assignment_read_before.current_status, 'active');
  assert.equal(result.assignment_read.current_status, 'completed');
  assert.equal(result.task_reviews.project_work_result_reviews.length, 1);
  assert.equal(result.task_assignments.assignments.length, 1);
  assert.equal(result.operations.assignment_status_store, 'status_recorded');
  assert.equal(result.evidence.service_authority, 'main_owned_agent_project_work_result_review_assignment_close_service');
  assert.equal(result.evidence.assignment_status_authority, 'main_owned_agent_assignment_store');
  assert.equal(result.evidence.project_work_result_review_store_authority, 'main_owned_agent_project_work_result_review_store');
  assert.equal(result.evidence.lease_store_authority, 'main_owned_agent_supervision_lease_store');
  assert.equal(result.evidence.provider_dispatch, false);
  assert.equal(result.evidence.tool_dispatch, false);
  assert.equal(result.evidence.source_access, 'not_present');
  assert.equal(result.evidence.source_write, 'not_present');
  assert.equal(result.evidence.review_row_authority, false);
  assert.equal(result.evidence.artifact_authority, false);
  assert.equal(result.evidence.materialization_authority, false);
  assert.equal(result.evidence.goal_status_authority, false);

  const replay = service.close_reviewed_project_work_assignment(request(facts));
  assert.equal(replay.operations.assignment_status_store, 'status_replayed');
  assert.equal(replay.assignment_read_before.current_status, 'completed');
  assert.deepEqual(replay.completed_status, result.completed_status);
});

test('closes acknowledged blocked project-check assignments without Goal or materialization authority', (t) => {
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
  seedAssignment(stores, facts);
  seedLease(stores, facts);
  seedReview(stores, facts);
  seedRelease(stores, facts);

  const result = service.close_reviewed_project_work_assignment(request(facts));
  assert.equal(result.work_kind, 'project_test');
  assert.equal(result.result_status, 'blocked');
  assert.equal(result.decision, 'acknowledged_without_materialization');
  assert.equal(result.completed_status.next_status, 'completed');
  assert.equal(result.assignment_read.current_status, 'completed');
  assert.equal(result.evidence.process_run, false);
  assert.equal(result.evidence.revision_authority, false);
  assert.equal(result.evidence.artifact_authority, false);
  assert.equal(result.evidence.goal_status_authority, false);
});

test('recovers reviewed project work assignment close state across restart through idempotent replay', () => {
  const root = temporaryRoot('clawfabric-builder-agent-project-work-result-review-assignment-close-service-restart-');
  const facts = fixture();
  const stores = openStores(root);
  seedAssignment(stores, facts);
  seedLease(stores, facts);
  seedReview(stores, facts);
  seedRelease(stores, facts);
  const service = createBuilderAgentProjectWorkResultReviewAssignmentCloseService(stores);
  const first = service.close_reviewed_project_work_assignment(request(facts));
  closeStores(stores);

  const reopened = openStores(root);
  const restarted = createBuilderAgentProjectWorkResultReviewAssignmentCloseService(reopened);
  const replay = restarted.close_reviewed_project_work_assignment(request(facts));
  assert.equal(replay.operations.assignment_status_store, 'status_replayed');
  assert.deepEqual(replay.completed_status, first.completed_status);
  assert.equal(replay.assignment_read.current_status, 'completed');
  closeStores(reopened);
  fs.rmSync(root, { recursive: true, force: true });
});

test('fails closed for absent review, missing assignment, missing release, stale close, terminal conflict, and malformed stores', (t) => {
  const { service, stores } = serviceFor(t);
  const facts = fixture();

  assertServiceError(
    () => service.close_reviewed_project_work_assignment(request(facts)),
    'builder_agent_project_work_result_review_assignment_close_service_conflict',
  );

  seedLease(stores, facts);
  seedReview(stores, facts);
  seedRelease(stores, facts);
  assertServiceError(
    () => service.close_reviewed_project_work_assignment(request(facts)),
    'builder_agent_project_work_result_review_assignment_close_service_conflict',
  );

  const missingReleaseFacts = fixture({ assignment: { run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174009' } });
  seedAssignment(stores, missingReleaseFacts);
  seedLease(stores, missingReleaseFacts);
  seedReview(stores, missingReleaseFacts);
  assertServiceError(
    () => service.close_reviewed_project_work_assignment(request(missingReleaseFacts)),
    'builder_agent_project_work_result_review_assignment_close_service_conflict',
  );
  seedRelease(stores, missingReleaseFacts);
  assertServiceError(
    () => service.close_reviewed_project_work_assignment(request(missingReleaseFacts, {
      now_ms: missingReleaseFacts.review.reviewed_at_ms,
      completedStatusInput: { decided_at_ms: missingReleaseFacts.review.reviewed_at_ms },
    })),
    'builder_agent_project_work_result_review_assignment_close_service_conflict',
  );
  assertServiceError(
    () => service.close_reviewed_project_work_assignment(request(missingReleaseFacts, {
      completedStatusInput: { next_status: 'cancelled' },
    })),
    'builder_agent_project_work_result_review_assignment_close_service_invalid',
  );
  assertServiceError(
    () => service.close_reviewed_project_work_assignment(request(missingReleaseFacts, {
      owner_id: OTHER_OWNER_ID,
    })),
    'builder_agent_project_work_result_review_assignment_close_service_conflict',
  );

  const terminalFacts = fixture({ assignment: { run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174010' } });
  seedAssignment(stores, terminalFacts);
  seedLease(stores, terminalFacts);
  seedReview(stores, terminalFacts);
  seedRelease(stores, terminalFacts);
  stores.assignment_store.record_status({
    status: createBuilderAgentAssignmentStatusRecord(
      completedStatusInput(terminalFacts, {
        next_status: 'cancelled',
        reason: 'Owner cancelled this supervised assignment attempt.',
      }),
      terminalFacts.assignment,
    ),
  });
  assertServiceError(
    () => service.close_reviewed_project_work_assignment(request(terminalFacts)),
    'builder_agent_project_work_result_review_assignment_close_service_conflict',
  );

  assertServiceError(
    () => createBuilderAgentProjectWorkResultReviewAssignmentCloseService({
      assignment_store: { store_version: BUILDER_AGENT_ASSIGNMENT_STORE_VERSION },
      project_work_result_review_store: stores.project_work_result_review_store,
      lease_store: stores.lease_store,
    }),
    'builder_agent_project_work_result_review_assignment_close_service_invalid',
  );
  assertServiceError(
    () => createBuilderAgentProjectWorkResultReviewAssignmentCloseService({
      assignment_store: stores.assignment_store,
      project_work_result_review_store: { store_version: BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_VERSION },
      lease_store: stores.lease_store,
    }),
    'builder_agent_project_work_result_review_assignment_close_service_invalid',
  );
  assertServiceError(
    () => createBuilderAgentProjectWorkResultReviewAssignmentCloseService({
      assignment_store: stores.assignment_store,
      project_work_result_review_store: stores.project_work_result_review_store,
      lease_store: { store_version: BUILDER_AGENT_SUPERVISION_LEASE_STORE_VERSION },
    }),
    'builder_agent_project_work_result_review_assignment_close_service_invalid',
  );
});

test('source boundary remains main-only and exposes no runtime, Goal, or source authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-project-work-result-review-assignment-close-service.cjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /require\('electron'\)|ipcMain|BrowserWindow|preload|safeStorage|provider-config|provider-secret/iu);
  assert.doesNotMatch(source, /node:child_process|require\(['"]child_process['"]\)|spawn\(|execFile\(|writeFile|rmSync/iu);
  assert.match(source, /service_authority: 'main_owned_agent_project_work_result_review_assignment_close_service'/u);
  assert.match(source, /assignment_status_authority: 'main_owned_agent_assignment_store'/u);
  assert.match(source, /provider_dispatch: false/u);
  assert.match(source, /tool_dispatch: false/u);
  assert.match(source, /source_access: 'not_present'/u);
  assert.match(source, /source_write: 'not_present'/u);
  assert.match(source, /materialization_authority: false/u);
  assert.match(source, /goal_status_authority: false/u);
  assert.match(source, /review_row_authority: false/u);
});
