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
  BUILDER_AGENT_BUDGET_AUDIT_RECORD_KIND,
  BUILDER_AGENT_BUDGET_AUDIT_RECORD_VERSION,
  createBuilderAgentBudgetAuditRecord,
} = require('../electron/builder-agent-budget-audit-contract.cjs');
const {
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
  BUILDER_AGENT_STEP_START_CONTRACT_VERSION,
  BuilderAgentStepStartContractError,
  createBuilderAgentStepStartReceipt,
  sanitizeBuilderAgentStepStartReceipt,
} = require('../electron/builder-agent-step-start-contract.cjs');
const {
  BUILDER_AGENT_STEP_START_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_STEP_START_SERVICE_VERSION,
  BuilderAgentStepStartServiceError,
  createBuilderAgentStepStartService,
} = require('../electron/builder-agent-step-start-service.cjs');

const OWNER_ID = 'builder-user:11111111-1111-4111-8111-111111111111';
const OTHER_OWNER_ID = 'builder-user:12111111-1111-4111-8111-111111111111';
const AGENT_ID = 'builder-agent:22222222-2222-4222-8222-222222222222';
const PROJECT_UUID = '33333333-3333-4333-8333-333333333333';
const PROJECT_ID = `builder-project:${PROJECT_UUID}`;
const CONVERSATION_ID = `builder-conversation:${PROJECT_UUID}`;
const TASK_ID = 'builder-task:55555555-5555-4555-8555-555555555555';
const RUN_ID = 'builder-run:66666666-6666-4666-8666-666666666666';
const STEP_ID = 'builder-run-step:77777777-7777-4777-8777-777777777777';
const SUPERVISOR_ID = 'builder-supervisor:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MESSAGE_ID = 'builder-message:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MEMORY_ID = `builder-agent-memory:${'a'.repeat(64)}`;
const ARTIFACT_ID = `builder-artifact:${'b'.repeat(64)}`;
const RUN_EVENT_ID = `builder-run-event:${'c'.repeat(64)}`;
const PERMISSION_REF_ID = `builder-permission:${'d'.repeat(64)}`;

function temporaryRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function removeRoot(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

function requestId(index = 1) {
  return `builder-agent-action-request:123e4567-e89b-42d3-a456-${index.toString(16).padStart(12, '0')}`;
}

function definitionInput(overrides = {}) {
  return {
    record_version: BUILDER_AGENT_DEFINITION_RECORD_VERSION,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    display_name: 'Builder Agent',
    purpose: 'Start one supervised step without execution.',
    created_at_ms: 1,
    ...overrides,
  };
}

function versionInput(overrides = {}) {
  return {
    record_version: BUILDER_AGENT_VERSION_RECORD_VERSION,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    version_number: 1,
    instructions: 'Prepare step work only after budget and admission checks.',
    created_at_ms: 2,
    permission_boundary: 'explicit_permission_required',
    ...overrides,
  };
}

function fixture(action = 'start_step', index = 1, overrides = {}) {
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
    goal: 'Start the next supervised step.',
    created_at_ms: 3,
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
    decided_at_ms: 4,
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
    acquired_at_ms: 20,
    expires_at_ms: 620,
    purpose: 'Supervise one step start.',
    redispatch_policy: 'lease_required_no_duplicate_dispatch',
    supervision_state: 'active_assignment_only',
    authority_boundary: 'main_supervision_lease_only',
  }, assignment, activeStatus);
  const budgetUsage = overrides.budget_usage ?? {
    step_count: index - 1,
    tool_call_count: 0,
    runtime_ms: 100 + index,
    private_source_bytes: 0,
  };
  const budgetAudit = createBuilderAgentBudgetAuditRecord({
    record_version: BUILDER_AGENT_BUDGET_AUDIT_RECORD_VERSION,
    record_kind: BUILDER_AGENT_BUDGET_AUDIT_RECORD_KIND,
    assignment_id: assignment.assignment_id,
    assignment_status_id: activeStatus.assignment_status_id,
    lease_id: lease.lease_id,
    agent_id: AGENT_ID,
    agent_version_id: assignment.agent_version_id,
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    lease_holder_id: SUPERVISOR_ID,
    observed_at_ms: 30 + index,
    requested_next_action: action,
    budget_limits: assignment.budget,
    budget_usage: budgetUsage,
    outcome: {
      decision: 'allowed',
      reason: 'none',
    },
    audit_contract: 'assignment_budget_checked_before_agent_work',
  }, assignment, activeStatus, lease);
  const snapshot = createBuilderAgentTaskContextSnapshot({
    agent_definition: definition,
    agent_version: version,
    assignment,
    active_status: activeStatus,
    lease,
    budget_audit: budgetAudit,
    included_memory_ids: [MEMORY_ID],
    included_message_ids: [MESSAGE_ID],
    included_artifact_ids: [ARTIFACT_ID],
    included_run_event_ids: [RUN_EVENT_ID],
    included_permission_ids: [PERMISSION_REF_ID],
    parent_task_context_projection: null,
    base_project_revision: {
      status: 'available',
      revision_receipt_digest: `sha256:${'f'.repeat(64)}`,
      commit_oid: '1'.repeat(40),
    },
    token_budget: {
      max_input_tokens: 32_000,
      reserved_output_tokens: 4_096,
      selection_policy: 'deterministic_task_local_budget_v1',
    },
    created_at_ms: 40 + index,
  });
  const admission = createBuilderAgentSupervisedActionAdmission({
    context_snapshot: snapshot,
    action_request_id: requestId(index),
    requested_next_action: action,
    run_status: 'running',
    interrupt_requested: false,
    cancel_requested: false,
    admitted_at_ms: snapshot.created_at_ms + 2,
  });
  return { activeStatus, admission, assignment, budgetAudit, lease };
}

function serviceFor(t) {
  const root = temporaryRoot('clawfabric-builder-agent-step-start-service-');
  const budgetStore = createBuilderAgentBudgetAuditStore(
    path.join(root, 'budget-audits.sqlite'),
  );
  const admissionStore = createBuilderAgentSupervisedActionAdmissionStore(
    path.join(root, 'action-admissions.sqlite'),
  );
  const service = createBuilderAgentStepStartService({
    budget_audit_store: budgetStore,
    supervised_action_admission_store: admissionStore,
  });
  t.after(() => {
    budgetStore.close();
    admissionStore.close();
    removeRoot(root);
  });
  return { admissionStore, budgetStore, service };
}

function seedStores(stores, records, { seedBudget = true, seedAdmission = true } = {}) {
  if (seedBudget) {
    stores.budgetStore.record_audit({
      assignment: records.assignment,
      status: records.activeStatus,
      lease: records.lease,
      audit: records.budgetAudit,
    });
  }
  if (seedAdmission) stores.admissionStore.record_admission({ admission: records.admission });
}

function request(records, overrides = {}) {
  return {
    owner_id: overrides.owner_id ?? OWNER_ID,
    supervised_action_admission_id:
      overrides.supervised_action_admission_id ?? records.admission.admission_id,
    step_id: overrides.step_id ?? STEP_ID,
    step_index: overrides.step_index ?? records.budgetAudit.budget_usage.step_count + 1,
    started_at_ms: overrides.started_at_ms ?? records.admission.admitted_at_ms + 1,
  };
}

function assertServiceError(error, code = 'builder_agent_step_start_service_invalid') {
  assert.equal(error instanceof BuilderAgentStepStartServiceError, true);
  assert.equal(error.code, code);
  assert.doesNotMatch(
    `${error.message}\n${error.stack}`,
    /private|credential|api\.deepseek|secret-value|source text|project:\/|permission_id|raw output|stdout|stderr/iu,
  );
  return true;
}

function assertContractError(error) {
  assert.equal(error instanceof BuilderAgentStepStartContractError, true);
  assert.equal(error.code, 'builder_agent_step_start_contract_invalid');
  assert.doesNotMatch(
    `${error.message}\n${error.stack}`,
    /private|credential|api\.deepseek|secret-value|source text|project:\/|permission_id|raw output|stdout|stderr/iu,
  );
  return true;
}

test('creates and sanitizes a reusable deterministic Agent step-start receipt contract', () => {
  const records = fixture('start_step', 1);
  const receipt = createBuilderAgentStepStartReceipt({
    supervised_action_admission: records.admission,
    budget_audit: records.budgetAudit,
    step_id: STEP_ID,
    step_index: 1,
    started_at_ms: records.admission.admitted_at_ms + 1,
  });

  assert.equal(BUILDER_AGENT_STEP_START_CONTRACT_VERSION, 'builder-agent-step-start-contract.v1');
  assert.equal(receipt.receipt_version, 'builder-agent-step-start-receipt.v1');
  assert.equal(receipt.receipt_kind, 'builder_agent_step_start_receipt');
  assert.equal(receipt.supervised_action_admission_id, records.admission.admission_id);
  assert.equal(receipt.budget_audit_id, records.budgetAudit.budget_audit_id);
  assert.equal(receipt.step_index, 1);
  assert.equal(receipt.budget_step_count_before, 0);
  assert.equal(receipt.lifecycle.step_execution, 'not_started');
  assert.equal(receipt.authority.step_start_authority, 'main_agent_step_start_receipt_contract_v1');
  assert.match(receipt.step_start_receipt_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(sanitizeBuilderAgentStepStartReceipt(receipt), receipt);

  const replay = createBuilderAgentStepStartReceipt({
    supervised_action_admission: records.admission,
    budget_audit: records.budgetAudit,
    step_id: STEP_ID,
    step_index: 1,
    started_at_ms: records.admission.admitted_at_ms + 1,
  });
  assert.equal(replay.step_start_receipt_digest, receipt.step_start_receipt_digest);
});

test('step-start receipt contract rejects action, budget, timing, and digest drift', () => {
  const records = fixture('start_step', 2);
  const wrongAction = fixture('call_tool', 3);
  assert.throws(
    () => createBuilderAgentStepStartReceipt({
      supervised_action_admission: wrongAction.admission,
      budget_audit: wrongAction.budgetAudit,
      step_id: STEP_ID,
      step_index: wrongAction.budgetAudit.budget_usage.step_count + 1,
      started_at_ms: wrongAction.admission.admitted_at_ms + 1,
    }),
    assertContractError,
  );
  assert.throws(
    () => createBuilderAgentStepStartReceipt({
      supervised_action_admission: records.admission,
      budget_audit: records.budgetAudit,
      step_id: STEP_ID,
      step_index: records.budgetAudit.budget_usage.step_count,
      started_at_ms: records.admission.admitted_at_ms + 1,
    }),
    assertContractError,
  );
  assert.throws(
    () => createBuilderAgentStepStartReceipt({
      supervised_action_admission: records.admission,
      budget_audit: {
        ...records.budgetAudit,
        outcome: {
          ...records.budgetAudit.outcome,
          display_summary: 'Forged.',
        },
      },
      step_id: STEP_ID,
      step_index: records.budgetAudit.budget_usage.step_count + 1,
      started_at_ms: records.admission.admitted_at_ms + 1,
    }),
    assertContractError,
  );
  assert.throws(
    () => createBuilderAgentStepStartReceipt({
      supervised_action_admission: records.admission,
      budget_audit: {
        ...records.budgetAudit,
        project_id: 'builder-project:not-a-uuid',
      },
      step_id: STEP_ID,
      step_index: records.budgetAudit.budget_usage.step_count + 1,
      started_at_ms: records.admission.admitted_at_ms + 1,
    }),
    assertContractError,
  );

  const receipt = createBuilderAgentStepStartReceipt({
    supervised_action_admission: records.admission,
    budget_audit: records.budgetAudit,
    step_id: STEP_ID,
    step_index: records.budgetAudit.budget_usage.step_count + 1,
    started_at_ms: records.admission.admitted_at_ms + 1,
  });
  assert.throws(
    () => sanitizeBuilderAgentStepStartReceipt({
      ...receipt,
      step_index: receipt.step_index + 1,
    }),
    assertContractError,
  );
});

test('admits a deterministic Agent step start only after start-step admission and budget audit', (t) => {
  const stores = serviceFor(t);
  const records = fixture('start_step', 1);
  seedStores(stores, records);

  const result = stores.service.admit_agent_step_start(request(records));
  assert.equal(result.result_version, BUILDER_AGENT_STEP_START_SERVICE_RESULT_VERSION);
  assert.equal(result.service_version, BUILDER_AGENT_STEP_START_SERVICE_VERSION);
  assert.equal(result.operation, 'agent_step_start_admitted');
  assert.equal(result.status, 'ready');
  assert.equal(result.requested_next_action, 'start_step');
  assert.equal(result.next_gate, 'agent_step_runner_required_later');
  assert.equal(result.supervised_action_admission.admission_id, records.admission.admission_id);
  assert.equal(result.supervised_action_admission_read.status, 'ready');
  assert.equal(result.action_task_admissions.supervised_action_admissions.length, 1);
  assert.equal(result.action_run_admissions.supervised_action_admissions.length, 1);
  assert.equal(result.budget_audit.budget_audit_id, records.budgetAudit.budget_audit_id);
  assert.equal(result.budget_audit_read.status, 'ready');
  assert.equal(result.lease_audits.status, 'ready');
  assert.equal(result.step_start_receipt.receipt_version, 'builder-agent-step-start-receipt.v1');
  assert.equal(result.step_start_receipt.receipt_kind, 'builder_agent_step_start_receipt');
  assert.equal(result.step_start_receipt.step_id, STEP_ID);
  assert.equal(result.step_start_receipt.step_index, 1);
  assert.equal(result.step_start_receipt.budget_step_count_before, 0);
  assert.equal(result.step_start_receipt.budget_max_steps, 12);
  assert.match(result.step_start_receipt.step_start_receipt_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(result.step_start_receipt.lifecycle.step_execution, 'not_started');
  assert.equal(result.step_start_receipt.authority.provider_dispatch, false);
  assert.equal(result.step_start_receipt.authority.tool_dispatch, false);
  assert.equal(result.step_start_receipt.authority.execution_authority, false);
  assert.equal(result.evidence.service_authority, 'main_owned_agent_step_start_service');
  assert.equal(result.evidence.step_start_receipt_authority, 'main_agent_step_start_receipt_contract_v1');
  assert.equal(result.evidence.provider_dispatch, false);
  assert.equal(result.evidence.tool_dispatch, false);
  assert.equal(result.evidence.step_execution, false);
  assert.equal(result.evidence.source_access, 'not_present');
  assert.equal(result.evidence.revision_authority, false);

  const replay = stores.service.admit_agent_step_start(request(records));
  assert.deepEqual(replay.step_start_receipt, result.step_start_receipt);
});

test('fails closed without start-step admission, budget audit, or correct step sequence', (t) => {
  const missingAdmission = serviceFor(t);
  const missingAdmissionRecords = fixture('start_step', 2);
  seedStores(missingAdmission, missingAdmissionRecords, { seedAdmission: false });
  assert.throws(
    () => missingAdmission.service.admit_agent_step_start(request(missingAdmissionRecords)),
    (error) => assertServiceError(error, 'builder_agent_step_start_service_conflict'),
  );

  const missingBudget = serviceFor(t);
  const missingBudgetRecords = fixture('start_step', 3);
  seedStores(missingBudget, missingBudgetRecords, { seedBudget: false });
  assert.throws(
    () => missingBudget.service.admit_agent_step_start(request(missingBudgetRecords)),
    (error) => assertServiceError(error, 'builder_agent_step_start_service_conflict'),
  );

  const wrongAction = serviceFor(t);
  const wrongActionRecords = fixture('call_tool', 4);
  seedStores(wrongAction, wrongActionRecords);
  assert.throws(
    () => wrongAction.service.admit_agent_step_start(request(wrongActionRecords)),
    (error) => assertServiceError(error),
  );

  const drift = serviceFor(t);
  const driftRecords = fixture('start_step', 5);
  seedStores(drift, driftRecords);
  assert.throws(
    () => drift.service.admit_agent_step_start(request(driftRecords, {
      owner_id: OTHER_OWNER_ID,
    })),
    (error) => assertServiceError(error, 'builder_agent_step_start_service_conflict'),
  );
  assert.throws(
    () => drift.service.admit_agent_step_start(request(driftRecords, {
      step_index: driftRecords.budgetAudit.budget_usage.step_count,
    })),
    (error) => assertServiceError(error),
  );
  assert.throws(
    () => drift.service.admit_agent_step_start(request(driftRecords, {
      started_at_ms: driftRecords.admission.admitted_at_ms - 1,
    })),
    (error) => assertServiceError(error),
  );
});

test('rejects malformed stores and hostile requests without leaking private material', (t) => {
  const stores = serviceFor(t);
  const records = fixture('start_step', 6);
  seedStores(stores, records);

  assert.throws(
    () => createBuilderAgentStepStartService({
      budget_audit_store: {
        store_version: 'wrong-version',
      },
      supervised_action_admission_store: {
        store_version: BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_VERSION,
      },
    }),
    (error) => assertServiceError(error),
  );

  let getterCalls = 0;
  const hostile = request(records);
  Object.defineProperty(hostile, 'step_index', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return records.budgetAudit.budget_usage.step_count + 1;
    },
  });
  assert.throws(
    () => stores.service.admit_agent_step_start(hostile),
    (error) => assertServiceError(error),
  );
  assert.equal(getterCalls, 0);
  assert.throws(
    () => stores.service.admit_agent_step_start(new Proxy(request(records), {})),
    (error) => assertServiceError(error),
  );
});

test('source boundary remains a main-only step-start admission gate without execution authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-step-start-service.cjs'),
    'utf8',
  );

  assert.match(source, /builder-agent-step-start-service\.v1/u);
  assert.match(source, /createBuilderAgentStepStartReceipt/u);
  assert.match(source, /sanitizeBuilderAgentStepStartReceipt/u);
  assert.match(source, /main_owned_agent_step_start_service/u);
  assert.match(source, /main_agent_step_start_receipt_contract_v1/u);
  assert.match(source, /main_owned_agent_budget_audit_store/u);
  assert.match(source, /main_owned_agent_supervised_action_admission_store/u);
  assert.match(source, /admission\.requested_next_action !== 'start_step'/u);
  assert.match(source, /agent_step_runner_required_later/u);
  assert.match(source, /step_execution: false/u);
  assert.match(source, /provider_dispatch: false/u);
  assert.match(source, /tool_dispatch: false/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:fs|fs|node:http|node:https|http|https|node:child_process|child_process)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|fetch\s*\(|https?:|Authorization|Bearer|execFile|spawn\s*\(|writeFile|readFile|createReadStream|eval\s*\(|new Function|shell:\s*true|record_grant|record_revocation|provider_secret|credential_secret|commit_oid|tree_oid|stdout|stderr|file_content|source_tree|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
  );
});

test('step-start receipt contract remains pure main-side evidence without stores or execution', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-step-start-contract.cjs'),
    'utf8',
  );

  assert.match(source, /builder-agent-step-start-contract\.v1/u);
  assert.match(source, /builder-agent-step-start-receipt\.v1/u);
  assert.match(source, /main_agent_step_start_receipt_contract_v1/u);
  assert.match(source, /sanitizeBuilderAgentSupervisedActionAdmission/u);
  assert.match(source, /step_execution: 'not_started'/u);
  assert.match(source, /provider_dispatch: false/u);
  assert.match(source, /tool_dispatch: false/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:fs|fs|node:sqlite|node:http|node:https|http|https|node:child_process|child_process)['"]\)|DatabaseSync|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|fetch\s*\(|https?:|Authorization|Bearer|execFile|spawn\s*\(|writeFile|readFile|createReadStream|eval\s*\(|new Function|shell:\s*true|record_grant|record_revocation|provider_secret|credential_secret|commit_oid|tree_oid|stdout|stderr|file_content|source_tree|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
  );
});
