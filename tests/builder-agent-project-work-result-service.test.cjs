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
  createBuilderAgentSupervisionLeaseStore,
} = require('../electron/builder-agent-supervision-lease-store.cjs');
const {
  BUILDER_AGENT_BUDGET_AUDIT_RECORD_KIND,
  BUILDER_AGENT_BUDGET_AUDIT_RECORD_VERSION,
  createBuilderAgentBudgetAuditRecord,
} = require('../electron/builder-agent-budget-audit-contract.cjs');
const {
  BUILDER_AGENT_BUDGET_AUDIT_STORE_VERSION,
  createBuilderAgentBudgetAuditStore,
} = require('../electron/builder-agent-budget-audit-store.cjs');
const {
  createBuilderAgentTaskContextSnapshot,
} = require('../electron/builder-agent-task-context-snapshot.cjs');
const {
  createBuilderAgentSupervisedActionAdmission,
} = require('../electron/builder-agent-supervised-action-admission.cjs');
const {
  BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_VERSION,
  createBuilderAgentSupervisedActionAdmissionStore,
} = require('../electron/builder-agent-supervised-action-admission-store.cjs');
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
  BUILDER_AGENT_PROJECT_WORK_RESULT_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_PROJECT_WORK_RESULT_SERVICE_VERSION,
  BuilderAgentProjectWorkResultServiceError,
  createBuilderAgentProjectWorkResultService,
} = require('../electron/builder-agent-project-work-result-service.cjs');

const OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174000';
const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174004';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174005';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174006';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174007';
const SUPERVISOR_ID = 'builder-supervisor:123e4567-e89b-42d3-a456-426614174008';
const MEMORY_ID = `builder-agent-memory:${'a'.repeat(64)}`;
const MESSAGE_ID = 'builder-message:123e4567-e89b-42d3-a456-426614174009';
const ARTIFACT_ID = `builder-artifact:${'b'.repeat(64)}`;
const RUN_EVENT_ID = `builder-run-event:${'c'.repeat(64)}`;
const PERMISSION_ID = `builder-permission:${'d'.repeat(64)}`;

function temporaryRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function openStores(root) {
  return {
    lease_store: createBuilderAgentSupervisionLeaseStore(path.join(root, 'leases.sqlite')),
    budget_audit_store: createBuilderAgentBudgetAuditStore(path.join(root, 'budget-audits.sqlite')),
    supervised_action_admission_store: createBuilderAgentSupervisedActionAdmissionStore(
      path.join(root, 'action-admissions.sqlite'),
    ),
    project_work_store: createBuilderAgentProjectWorkStore(path.join(root, 'project-work.sqlite')),
  };
}

function closeStores(stores) {
  stores.lease_store.close();
  stores.budget_audit_store.close();
  stores.supervised_action_admission_store.close();
  stores.project_work_store.close();
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
  return { activeStatus, assignment, definition, lease, version };
}

function budgetAuditInput(facts, overrides = {}) {
  const budgetUsage = overrides.budget_usage ?? {
    step_count: 4,
    tool_call_count: 1,
    runtime_ms: 8_000,
    private_source_bytes: 1_024,
  };
  const requestedNextAction = overrides.requested_next_action ?? 'finish_for_review';
  const outcome = overrides.outcome ?? {
    decision: 'allowed',
    reason: 'none',
  };
  return {
    record_version: BUILDER_AGENT_BUDGET_AUDIT_RECORD_VERSION,
    record_kind: BUILDER_AGENT_BUDGET_AUDIT_RECORD_KIND,
    assignment_id: facts.assignment.assignment_id,
    assignment_status_id: facts.activeStatus.assignment_status_id,
    lease_id: facts.lease.lease_id,
    agent_id: AGENT_ID,
    agent_version_id: facts.assignment.agent_version_id,
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    lease_holder_id: SUPERVISOR_ID,
    observed_at_ms: 90,
    requested_next_action: requestedNextAction,
    budget_limits: facts.assignment.budget,
    budget_usage: budgetUsage,
    outcome,
    audit_contract: 'assignment_budget_checked_before_agent_work',
    ...overrides,
  };
}

function budgetAudit(facts, overrides = {}) {
  return createBuilderAgentBudgetAuditRecord(
    budgetAuditInput(facts, overrides),
    facts.assignment,
    facts.activeStatus,
    facts.lease,
  );
}

function actionRequestId(index = 1) {
  return `builder-agent-action-request:123e4567-e89b-42d3-a456-${index.toString(16).padStart(12, '0')}`;
}

function contextSnapshot(facts, audit, overrides = {}) {
  return createBuilderAgentTaskContextSnapshot({
    agent_definition: facts.definition,
    agent_version: facts.version,
    assignment: facts.assignment,
    active_status: facts.activeStatus,
    lease: facts.lease,
    budget_audit: audit,
    included_memory_ids: [MEMORY_ID],
    included_message_ids: [MESSAGE_ID],
    included_artifact_ids: [ARTIFACT_ID],
    included_run_event_ids: [RUN_EVENT_ID],
    included_permission_ids: [PERMISSION_ID],
    parent_task_context_projection: null,
    base_project_revision: {
      status: 'available',
      revision_receipt_digest: `sha256:${'e'.repeat(64)}`,
      commit_oid: 'f'.repeat(40),
    },
    token_budget: {
      max_input_tokens: 32_000,
      reserved_output_tokens: 4_096,
      selection_policy: 'deterministic_task_local_budget_v1',
    },
    created_at_ms: audit.observed_at_ms + 2,
    ...overrides,
  });
}

function actionAdmission(facts, audit, overrides = {}) {
  const snapshot = overrides.snapshot ?? contextSnapshot(facts, audit, overrides.snapshot_input ?? {});
  return createBuilderAgentSupervisedActionAdmission({
    context_snapshot: snapshot,
    action_request_id: overrides.action_request_id ?? actionRequestId(overrides.request_index ?? 1),
    requested_next_action: overrides.requested_next_action ?? snapshot.action_admission.requested_next_action,
    run_status: 'running',
    interrupt_requested: false,
    cancel_requested: false,
    admitted_at_ms: overrides.admitted_at_ms ?? snapshot.created_at_ms + 2,
  });
}

function resultInput(facts, overrides = {}) {
  const workKind = overrides.work_kind ?? 'project_edit';
  const status = overrides.status ?? 'proposed';
  const summaryCode = overrides.summary_code ?? 'project_edit_candidate_ready_for_review';
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
    run_id: RUN_ID,
    lease_holder_id: SUPERVISOR_ID,
    work_kind: workKind,
    observed_at_ms: 100,
    result: {
      status,
      summary_code: summaryCode,
    },
    review_contract: 'owner_review_required_before_materialization',
    materialization_boundary: 'no_source_mutation_no_check_run',
    ...overrides,
  };
}

function workResult(facts, overrides = {}) {
  return createBuilderAgentProjectWorkResultRecord(
    resultInput(facts, overrides),
    facts.assignment,
    facts.activeStatus,
    facts.lease,
  );
}

function seedActiveLease(stores, facts) {
  stores.lease_store.record_lease({
    assignment: facts.assignment,
    status: facts.activeStatus,
    lease: facts.lease,
  });
}

function seedBudgetAudit(stores, facts, audit = budgetAudit(facts)) {
  stores.budget_audit_store.record_audit({
    assignment: facts.assignment,
    status: facts.activeStatus,
    lease: facts.lease,
    audit,
  });
  return audit;
}

function seedActionAdmission(stores, facts, audit, admission = actionAdmission(facts, audit)) {
  stores.supervised_action_admission_store.record_admission({ admission });
  return admission;
}

function request(facts, admission, overrides = {}) {
  return {
    assignment: facts.assignment,
    active_status: facts.activeStatus,
    lease: facts.lease,
    supervised_action_admission_id: admission.admission_id,
    result_input: resultInput(facts, overrides.result_input ?? {}),
    now_ms: overrides.now_ms ?? 100,
  };
}

function serviceFor(t) {
  const root = temporaryRoot('clawfabric-builder-agent-project-work-result-service-');
  const stores = openStores(root);
  const service = createBuilderAgentProjectWorkResultService(stores);
  t.after(() => {
    closeStores(stores);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, service, stores };
}

function assertServiceError(fn, code) {
  assert.throws(
    fn,
    (error) => error instanceof BuilderAgentProjectWorkResultServiceError
      && error.code === code
      && !/private|credential|api\.deepseek|secret-value|source text|raw result/iu.test(String(error.stack)),
  );
}

test('records a project work result only after a finish-for-review action admission', (t) => {
  const { service, stores } = serviceFor(t);
  const facts = fixture();
  const audit = budgetAudit(facts);
  const admission = actionAdmission(facts, audit);
  const expectedResult = workResult(facts);
  seedActiveLease(stores, facts);
  seedBudgetAudit(stores, facts, audit);
  seedActionAdmission(stores, facts, audit, admission);

  const result = service.record_project_work_result(request(facts, admission));
  assert.equal(result.result_version, BUILDER_AGENT_PROJECT_WORK_RESULT_SERVICE_RESULT_VERSION);
  assert.equal(result.service_version, BUILDER_AGENT_PROJECT_WORK_RESULT_SERVICE_VERSION);
  assert.equal(result.status, 'ready');
  assert.equal(result.work_kind, 'project_edit');
  assert.equal(result.result_status, 'proposed');
  assert.deepEqual(result.result, expectedResult);
  assert.equal(result.supervised_action_admission.admission_id, admission.admission_id);
  assert.equal(result.supervised_action_admission.requested_next_action, 'finish_for_review');
  assert.equal(result.supervised_action_admission.next_gate, 'project_work_result_required_later');
  assert.equal(result.supervised_action_admission_read.status, 'ready');
  assert.equal(result.action_task_admissions.supervised_action_admissions.length, 1);
  assert.equal(result.action_run_admissions.supervised_action_admissions.length, 1);
  assert.equal(result.budget_audit.budget_audit_id, audit.budget_audit_id);
  assert.equal(result.budget_audit.requested_next_action, 'finish_for_review');
  assert.equal(result.budget_audit.outcome.decision, 'allowed');
  assert.equal(result.lease_read.active_lease.lease.lease_id, facts.lease.lease_id);
  assert.equal(result.result_read.work_result.result.work_result_id, expectedResult.work_result_id);
  assert.equal(result.task_results.work_results.length, 1);
  assert.equal(result.operations.project_work_store, 'work_result_recorded');
  assert.equal(result.evidence.service_authority, 'main_owned_agent_project_work_result_service');
  assert.equal(
    result.evidence.supervised_action_admission_store_authority,
    'main_owned_agent_supervised_action_admission_store',
  );
  assert.equal(result.evidence.provider_dispatch, false);
  assert.equal(result.evidence.tool_dispatch, false);
  assert.equal(result.evidence.source_access, 'not_present');
  assert.equal(result.evidence.materialization_authority, false);
  assert.equal(result.evidence.review_authority, 'required_later');

  const replay = service.record_project_work_result(request(facts, admission));
  assert.equal(replay.operations.project_work_store, 'work_result_replayed');
  assert.deepEqual(replay.result, result.result);
});

test('records a blocked project test result while keeping review and materialization separate', (t) => {
  const { service, stores } = serviceFor(t);
  const facts = fixture({
    lease: { lease_epoch: 2, acquired_at_ms: 60, expires_at_ms: 150 },
  });
  const audit = budgetAudit(facts, { observed_at_ms: 95 });
  const admission = actionAdmission(facts, audit);
  seedActiveLease(stores, facts);
  seedBudgetAudit(stores, facts, audit);
  seedActionAdmission(stores, facts, audit, admission);

  const result = service.record_project_work_result(request(facts, admission, {
    now_ms: 105,
    result_input: {
      work_kind: 'project_test',
      observed_at_ms: 105,
      result: {
        status: 'blocked',
        summary_code: 'project_check_needs_owner_attention',
      },
    },
  }));
  assert.equal(result.work_kind, 'project_test');
  assert.equal(result.result_status, 'blocked');
  assert.equal(result.result.result.display_summary, 'Project checks need owner attention.');
  assert.equal(result.evidence.process_run, false);
  assert.equal(result.evidence.artifact_authority, false);
});

test('recovers project work result service state across restart through idempotent store replay', () => {
  const root = temporaryRoot('clawfabric-builder-agent-project-work-result-service-restart-');
  const facts = fixture();
  const stores = openStores(root);
  seedActiveLease(stores, facts);
  const audit = seedBudgetAudit(stores, facts);
  const admission = seedActionAdmission(stores, facts, audit);
  const service = createBuilderAgentProjectWorkResultService(stores);
  const first = service.record_project_work_result(request(facts, admission));
  closeStores(stores);

  const reopened = openStores(root);
  const restarted = createBuilderAgentProjectWorkResultService(reopened);
  const replay = restarted.record_project_work_result(request(facts, admission));
  assert.equal(replay.operations.project_work_store, 'work_result_replayed');
  assert.deepEqual(replay.result, first.result);
  closeStores(reopened);
  fs.rmSync(root, { recursive: true, force: true });
});

test('fails closed before recording results for missing, wrong, denied, or stale action evidence', (t) => {
  const { service, stores } = serviceFor(t);
  const facts = fixture();
  const audit = budgetAudit(facts);
  const admission = actionAdmission(facts, audit);
  seedActiveLease(stores, facts);
  seedBudgetAudit(stores, facts, audit);

  assertServiceError(
    () => service.record_project_work_result(request(facts, admission)),
    'builder_agent_project_work_result_service_conflict',
  );
  assert.equal(
    stores.project_work_store.list_task_results({
      owner_id: OWNER_ID,
      project_id: PROJECT_ID,
      task_id: TASK_ID,
    }).status,
    'absent',
  );

  const startStepAudit = seedBudgetAudit(stores, facts, budgetAudit(facts, {
    observed_at_ms: 91,
    requested_next_action: 'start_step',
  }));
  const startStepAdmission = seedActionAdmission(
    stores,
    facts,
    startStepAudit,
    actionAdmission(facts, startStepAudit, { request_index: 2 }),
  );
  assertServiceError(
    () => service.record_project_work_result(request(facts, startStepAdmission)),
    'builder_agent_project_work_result_service_invalid',
  );

  const deniedToolAudit = seedBudgetAudit(stores, facts, budgetAudit(facts, {
    observed_at_ms: 92,
    requested_next_action: 'call_tool',
    budget_usage: {
      step_count: 4,
      tool_call_count: facts.assignment.budget.max_tool_calls,
      runtime_ms: 8_000,
      private_source_bytes: 1_024,
    },
    outcome: {
      decision: 'denied',
      reason: 'max_tool_calls_reached',
    },
  }));
  assert.throws(
    () => actionAdmission(facts, deniedToolAudit, { request_index: 3 }),
    (error) => error?.name === 'BuilderAgentTaskContextSnapshotError',
  );

  const finishAudit = seedBudgetAudit(stores, facts, budgetAudit(facts, { observed_at_ms: 93 }));
  const finishAdmission = seedActionAdmission(
    stores,
    facts,
    finishAudit,
    actionAdmission(facts, finishAudit, { request_index: 4 }),
  );
  assertServiceError(
    () => service.record_project_work_result(request(facts, finishAdmission, { now_ms: 101 })),
    'builder_agent_project_work_result_service_invalid',
  );
  assertServiceError(
    () => service.record_project_work_result(request(facts, finishAdmission, {
      now_ms: 140,
      result_input: { observed_at_ms: 140 },
    })),
    'builder_agent_project_work_result_service_conflict',
  );
  assert.equal(
    stores.project_work_store.list_task_results({
      owner_id: OWNER_ID,
      project_id: PROJECT_ID,
      task_id: TASK_ID,
    }).status,
    'absent',
  );
  assertServiceError(
    () => createBuilderAgentProjectWorkResultService({
      lease_store: stores.lease_store,
      budget_audit_store: stores.budget_audit_store,
      supervised_action_admission_store: stores.supervised_action_admission_store,
      project_work_store: { store_version: BUILDER_AGENT_PROJECT_WORK_STORE_VERSION },
    }),
    'builder_agent_project_work_result_service_invalid',
  );
  assertServiceError(
    () => createBuilderAgentProjectWorkResultService({
      lease_store: stores.lease_store,
      budget_audit_store: { store_version: BUILDER_AGENT_BUDGET_AUDIT_STORE_VERSION },
      supervised_action_admission_store: stores.supervised_action_admission_store,
      project_work_store: stores.project_work_store,
    }),
    'builder_agent_project_work_result_service_invalid',
  );
  assertServiceError(
    () => createBuilderAgentProjectWorkResultService({
      lease_store: stores.lease_store,
      budget_audit_store: stores.budget_audit_store,
      supervised_action_admission_store: {
        store_version: BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_VERSION,
      },
      project_work_store: stores.project_work_store,
    }),
    'builder_agent_project_work_result_service_invalid',
  );
});

test('source boundary remains main-only and exposes no runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-project-work-result-service.cjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /require\('electron'\)|ipcMain|BrowserWindow|preload|safeStorage|provider-config|provider-secret/iu);
  assert.doesNotMatch(source, /node:child_process|require\(['"]child_process['"]\)|spawn\(|execFile\(|writeFile|rmSync/iu);
  assert.match(source, /service_authority: 'main_owned_agent_project_work_result_service'/u);
  assert.match(source, /provider_dispatch: false/u);
  assert.match(source, /tool_dispatch: false/u);
  assert.match(source, /source_access: 'not_present'/u);
  assert.match(source, /materialization_authority: false/u);
  assert.match(source, /review_authority: 'required_later'/u);
});
