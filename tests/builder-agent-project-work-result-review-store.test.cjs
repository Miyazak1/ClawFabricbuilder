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
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_READ_RESULT_VERSION,
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_RESULT_VERSION,
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_SCHEMA_VERSION,
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_USER_VERSION,
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_VERSION,
  BuilderAgentProjectWorkResultReviewStoreError,
  createBuilderAgentProjectWorkResultReviewStore,
} = require('../electron/builder-agent-project-work-result-review-store.cjs');

const OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174000';
const OTHER_OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174001';
const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174004';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174005';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174006';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174007';
const SUPERVISOR_ID = 'builder-supervisor:123e4567-e89b-42d3-a456-426614174008';
const SECOND_RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174009';

function temporaryDatabase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-agent-project-work-result-reviews-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'agent-project-work-result-reviews.sqlite');
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
  const review = createBuilderAgentProjectWorkResultReviewRecord(
    reviewInput(workResult, overrides.review ?? {}),
    workResult,
    assignmentRecord,
    activeStatus,
    leaseRecord,
  );
  return { activeStatus, assignmentRecord, leaseRecord, review, workResult };
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
    run_id: assignmentRecord.run_id,
    lease_holder_id: SUPERVISOR_ID,
    work_kind: workKind,
    observed_at_ms: overrides.observed_at_ms ?? 90,
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

function recordRequest(assignmentRecord, activeStatus, leaseRecord, workResult, review) {
  return {
    assignment: assignmentRecord,
    status: activeStatus,
    lease: leaseRecord,
    result: workResult,
    review,
  };
}

function assertStoreError(fn, code = null) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderAgentProjectWorkResultReviewStoreError);
      if (code !== null) assert.equal(error.code, code);
      const text = `${error.name}:${error.message}:${error.stack}`;
      assert.doesNotMatch(text, /private|credential|api\.deepseek|secret-value|source text|raw patch|diff body/iu);
      return true;
    },
  );
}

test('records project work result reviews then restores them after restart', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentProjectWorkResultReviewStore(databasePath);
  const { activeStatus, assignmentRecord, leaseRecord, review, workResult } = fixture();

  assert.equal(store.store_version, BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_VERSION);
  const recorded = store.record_review(recordRequest(assignmentRecord, activeStatus, leaseRecord, workResult, review));
  assert.equal(recorded.result_version, BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_RESULT_VERSION);
  assert.equal(recorded.operation, 'project_work_result_review_recorded');
  assert.deepEqual(recorded.project_work_result_review.review, review);
  assert.deepEqual(recorded.project_work_result_review.result, workResult);
  assert.deepEqual(recorded.project_work_result_review.assignment, assignmentRecord);
  assert.deepEqual(recorded.project_work_result_review.status, activeStatus);
  assert.deepEqual(recorded.project_work_result_review.lease, leaseRecord);
  assert.equal(
    recorded.project_work_result_review_evidence.project_work_result_review_authority,
    'main_owned_agent_project_work_result_review_store',
  );
  assert.equal(recorded.project_work_result_review_evidence.renderer_authority, 'not_present');
  assert.equal(recorded.project_work_result_review_evidence.ipc_authority, 'not_present');
  assert.equal(recorded.project_work_result_review_evidence.model_dispatch, false);
  assert.equal(recorded.project_work_result_review_evidence.tool_dispatch, false);
  assert.equal(recorded.project_work_result_review_evidence.permission_grant_authority, false);
  assert.equal(recorded.project_work_result_review_evidence.credential_storage, 'not_present');
  assert.equal(recorded.project_work_result_review_evidence.source_read, 'not_present');
  assert.equal(recorded.project_work_result_review_evidence.source_write, 'not_present');
  assert.equal(recorded.project_work_result_review_evidence.process_run, false);
  assert.equal(recorded.project_work_result_review_evidence.network_access, false);
  assert.equal(recorded.project_work_result_review_evidence.revision_authority, false);
  assert.equal(recorded.project_work_result_review_evidence.review_row_authority, false);
  assert.equal(recorded.project_work_result_review_evidence.artifact_authority, false);
  assert.equal(recorded.project_work_result_review_evidence.materialization_authority, false);
  assert.equal(
    recorded.project_work_result_review_evidence.schema_version,
    BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_SCHEMA_VERSION,
  );
  assert.equal(
    recorded.project_work_result_review_evidence.user_version,
    BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_USER_VERSION,
  );
  assert.match(recorded.project_work_result_review_evidence.schema_fingerprint_digest, /^[a-f0-9]{64}$/u);

  assert.equal(
    store.record_review(recordRequest(assignmentRecord, activeStatus, leaseRecord, workResult, review)).operation,
    'project_work_result_review_replayed',
  );

  const read = store.read_review({
    work_result_review_id: review.work_result_review_id,
    owner_id: OWNER_ID,
  });
  assert.equal(read.result_version, BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_READ_RESULT_VERSION);
  assert.equal(read.status, 'ready');
  assert.deepEqual(read.project_work_result_review.review, review);
  assert.equal(Object.isFrozen(read), true);
  assert.equal(Object.isFrozen(read.project_work_result_review), true);

  const byResult = store.read_review_for_result({
    work_result_id: workResult.work_result_id,
    owner_id: OWNER_ID,
  });
  assert.equal(byResult.status, 'ready');
  assert.deepEqual(byResult.project_work_result_review.review, review);

  const taskList = store.list_task_reviews({
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    task_id: TASK_ID,
  });
  assert.equal(taskList.status, 'ready');
  assert.equal(taskList.project_work_result_reviews.length, 1);
  assert.deepEqual(taskList.project_work_result_reviews[0].review, review);
  store.close();

  const restarted = createBuilderAgentProjectWorkResultReviewStore(databasePath);
  const restored = restarted.read_review({
    work_result_review_id: review.work_result_review_id,
    owner_id: OWNER_ID,
  });
  assert.equal(restored.status, 'ready');
  assert.deepEqual(restored.project_work_result_review.review, review);
  assert.deepEqual(restored.project_work_result_review.result, workResult);
  assert.deepEqual(restored.project_work_result_review.assignment, assignmentRecord);
  restarted.close();
});

test('records multiple task reviews while enforcing owner scope and one review per work result', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentProjectWorkResultReviewStore(databasePath);
  const first = fixture();
  store.record_review(recordRequest(
    first.assignmentRecord,
    first.activeStatus,
    first.leaseRecord,
    first.workResult,
    first.review,
  ));

  const second = fixture({
    assignment: {
      run_id: SECOND_RUN_ID,
      goal: 'Prepare one reviewable project check.',
      created_at_ms: 31,
    },
    lease: {
      run_id: SECOND_RUN_ID,
      lease_epoch: 2,
      acquired_at_ms: 60,
      expires_at_ms: 140,
    },
    result: {
      work_kind: 'project_test',
      observed_at_ms: 100,
      result: {
        status: 'blocked',
        summary_code: 'project_check_needs_owner_attention',
      },
    },
    review: {
      decision: 'acknowledged_without_materialization',
      decision_summary_code: 'agent_project_work_result_acknowledged_without_materialization',
      decision_display_summary: 'Agent project work was acknowledged without materialization.',
    },
  });
  assert.equal(
    store.record_review(recordRequest(
      second.assignmentRecord,
      second.activeStatus,
      second.leaseRecord,
      second.workResult,
      second.review,
    )).operation,
    'project_work_result_review_recorded',
  );

  const taskList = store.list_task_reviews({
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    task_id: TASK_ID,
  });
  assert.equal(taskList.project_work_result_reviews.length, 2);
  assert.deepEqual(
    taskList.project_work_result_reviews.map((entry) => entry.review.decision),
    ['approved_for_project_materialization', 'acknowledged_without_materialization'],
  );
  assert.equal(
    store.read_review({
      work_result_review_id: first.review.work_result_review_id,
      owner_id: OTHER_OWNER_ID,
    }).status,
    'absent',
  );
  assert.equal(
    store.read_review_for_result({
      work_result_id: first.workResult.work_result_id,
      owner_id: OTHER_OWNER_ID,
    }).status,
    'absent',
  );

  const conflictingReview = createBuilderAgentProjectWorkResultReviewRecord(
    reviewInput(first.workResult, {
      decision: 'rejected',
      decision_summary_code: 'agent_project_work_result_rejected_by_owner',
      decision_display_summary: 'Agent project work was rejected by the owner.',
      reviewed_at_ms: first.review.reviewed_at_ms + 1,
    }),
    first.workResult,
    first.assignmentRecord,
    first.activeStatus,
    first.leaseRecord,
  );
  assertStoreError(
    () => store.record_review(recordRequest(
      first.assignmentRecord,
      first.activeStatus,
      first.leaseRecord,
      first.workResult,
      conflictingReview,
    )),
    'builder_agent_project_work_result_review_store_conflict',
  );
  store.close();
});

test('rejects hostile input, malformed reads, and tampered rows', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentProjectWorkResultReviewStore(databasePath);
  const { activeStatus, assignmentRecord, leaseRecord, review, workResult } = fixture();

  assertStoreError(() => store.record_review({
    ...recordRequest(assignmentRecord, activeStatus, leaseRecord, workResult, review),
    extra: true,
  }));
  assertStoreError(() => store.read_review({
    work_result_review_id: review.work_result_review_id,
    owner_id: OWNER_ID,
    extra: true,
  }));
  assertStoreError(() => store.read_review_for_result({
    work_result_id: workResult.work_result_id,
    owner_id: OWNER_ID,
    extra: true,
  }));
  assertStoreError(() => store.list_task_reviews({
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    task_id: TASK_ID,
    extra: true,
  }));

  let getterCalls = 0;
  const accessor = recordRequest(assignmentRecord, activeStatus, leaseRecord, workResult, review);
  Object.defineProperty(accessor, 'review', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('private credential getter');
    },
  });
  assertStoreError(() => store.record_review(accessor));
  assert.equal(getterCalls, 0);

  let proxyTrapInvoked = false;
  const proxyTrap = () => {
    proxyTrapInvoked = true;
    throw new Error('private proxy marker');
  };
  assertStoreError(() => store.record_review(new Proxy(
    recordRequest(assignmentRecord, activeStatus, leaseRecord, workResult, review),
    {
      getOwnPropertyDescriptor: proxyTrap,
      getPrototypeOf: proxyTrap,
      ownKeys: proxyTrap,
    },
  )));
  assert.equal(proxyTrapInvoked, false);

  store.record_review(recordRequest(assignmentRecord, activeStatus, leaseRecord, workResult, review));
  store.close();

  const raw = new DatabaseSync(databasePath);
  raw.prepare(
    'UPDATE agent_project_work_result_reviews SET decision_summary_code = ? WHERE work_result_review_id = ?',
  ).run('agent_project_work_result_rejected_by_owner', review.work_result_review_id);
  raw.close();

  const corrupted = createBuilderAgentProjectWorkResultReviewStore(databasePath);
  assertStoreError(
    () => corrupted.read_review({
      work_result_review_id: review.work_result_review_id,
      owner_id: OWNER_ID,
    }),
    'builder_agent_project_work_result_review_store_integrity_failed',
  );
  corrupted.close();
});

test('rejects schema drift and unsafe database paths', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentProjectWorkResultReviewStore(databasePath);
  store.close();

  const raw = new DatabaseSync(databasePath);
  raw.exec('CREATE TABLE unexpected_project_work_result_review_fact (id TEXT PRIMARY KEY) STRICT');
  raw.close();

  assertStoreError(
    () => createBuilderAgentProjectWorkResultReviewStore(databasePath),
    'builder_agent_project_work_result_review_store_integrity_failed',
  );
  assertStoreError(
    () => createBuilderAgentProjectWorkResultReviewStore(
      path.join('relative', 'agent-project-work-result-reviews.sqlite'),
    ),
    'builder_agent_project_work_result_review_store_invalid',
  );

  const notDatabasePath = path.join(path.dirname(databasePath), 'not-a-database.sqlite');
  fs.writeFileSync(notDatabasePath, 'not sqlite private credential marker');
  assertStoreError(
    () => createBuilderAgentProjectWorkResultReviewStore(notDatabasePath),
    'builder_agent_project_work_result_review_store_unavailable',
  );
});

test('source boundary remains a main-only Agent project work result review store without runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-project-work-result-review-store.cjs'),
    'utf8',
  );
  assert.match(source, /main_owned_agent_project_work_result_review_store/u);
  assert.match(source, /record_review/u);
  assert.match(source, /read_review/u);
  assert.match(source, /read_review_for_result/u);
  assert.match(source, /list_task_reviews/u);
  assert.match(source, /node:sqlite/u);
  assert.match(source, /utilTypes\.isProxy/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:http|node:https|http|https)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|dugite|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|shell:\s*true|localStorage|sessionStorage|indexedDB|better-sqlite|eval\s*\(|new Function/iu,
  );
});
